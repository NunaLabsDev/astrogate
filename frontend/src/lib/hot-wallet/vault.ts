/**
 * Sovereign, self-custodial Stellar Hot Wallet manager.
 *
 * Security model:
 * - Encrypted secrets (`AES-GCM-256` + `PBKDF2-SHA256`) live strictly on the user's device.
 * - Unlocked `Keypair` instances stay exclusively in volatile JS RAM (`sessionKeys`)
 *   and are wiped immediately on lock or disconnect.
 * - Exposes standard Stellar `@stellar/stellar-sdk/contract` `Signer` so Launchpad,
 *   Soroswap, Burn-to-Chat, and Vesting Claim work identically across Testnet & Mainnet.
 */
import { Keypair, StrKey } from '@stellar/stellar-sdk'
import { KeypairSigner } from '@stellar/stellar-sdk/contract'
import type { Signer } from '@stellar/stellar-sdk/contract'
import { NETWORK_PASSPHRASE } from '../network'
import { decryptSecretWithPin, encryptSecretWithPin } from './crypto'
import { defaultVaultStorage } from './storage'
import type {
  EncryptedWalletRecord,
  HotAccountMeta,
  HotVaultStorageAdapter,
  HotVaultStore,
} from './types'

export const MIN_VAULT_PIN_LENGTH = 4
export const MAX_HOT_WALLETS = 10
const LOCK_THRESHOLD_ATTEMPTS = 5

/** Volatile RAM-only unlocked keypairs keyed by Stellar public key (`G...`). */
const sessionKeys = new Map<string, Keypair>()

function generateAccountId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function validateVaultPin(pin: string): string {
  const normalized = pin.trim()
  if (normalized.length < MIN_VAULT_PIN_LENGTH) {
    throw new Error(
      `PIN must be at least ${MIN_VAULT_PIN_LENGTH} characters or digits.`,
    )
  }
  return normalized
}

function cleanLabel(label: string | undefined, index: number): string {
  const trimmed = (label ?? '').trim()
  return trimmed.length > 0 ? trimmed.slice(0, 24) : `Wallet ${index + 1}`
}

function getBackoffMs(failedAttempts: number): number {
  if (failedAttempts < LOCK_THRESHOLD_ATTEMPTS) return 0
  const power = Math.min(failedAttempts - LOCK_THRESHOLD_ATTEMPTS, 4)
  return 15_000 * 2 ** power // 15s -> 30s -> 60s -> 120s -> 240s
}

function assertNotRateLimited(store: HotVaultStore, now = Date.now()): void {
  if (store.lockUntil > now) {
    const secs = Math.ceil((store.lockUntil - now) / 1000)
    throw new Error(`Too many wrong PIN attempts. Wait ${secs}s and retry.`)
  }
}

export function readHotVaultSnapshot(
  adapter: HotVaultStorageAdapter = defaultVaultStorage,
): {
  exists: boolean
  accounts: HotAccountMeta[]
  activeId: string | null
  activePublicKey: string | null
  unlocked: boolean
} {
  const store = adapter.load()
  if (!store || store.wallets.length === 0) {
    return {
      exists: false,
      accounts: [],
      activeId: null,
      activePublicKey: null,
      unlocked: false,
    }
  }
  const active =
    store.wallets.find((w) => w.meta.id === store.activeId) ?? store.wallets[0]!
  return {
    exists: true,
    accounts: store.wallets.map((w) => w.meta),
    activeId: active.meta.id,
    activePublicKey: active.meta.publicKey,
    unlocked: sessionKeys.has(active.meta.publicKey),
  }
}

export function isHotAccountUnlocked(publicKey: string): boolean {
  return sessionKeys.has(publicKey)
}

export function lockHotVault(): void {
  sessionKeys.clear()
}

export function getHotWalletSigner(publicKey: string): Signer | null {
  const kp = sessionKeys.get(publicKey)
  if (!kp) return null
  return new KeypairSigner(kp, NETWORK_PASSPHRASE)
}

/** Creates a brand-new encrypted wallet vault or appends a fresh account if unlocked/PIN matches. */
export async function createHotWalletAccount(params: {
  pin: string
  label?: string
  adapter?: HotVaultStorageAdapter
}): Promise<{
  accounts: HotAccountMeta[]
  activeId: string
  activePublicKey: string
  revealedSecret: string
}> {
  const adapter = params.adapter ?? defaultVaultStorage
  const pin = validateVaultPin(params.pin)
  const existing = adapter.load()

  if (existing && existing.wallets.length > 0) {
    assertNotRateLimited(existing)
    if (existing.wallets.length >= MAX_HOT_WALLETS) {
      throw new Error(`Maximum ${MAX_HOT_WALLETS} hot wallets reached in vault.`)
    }
    // Verify PIN matches the existing vault before adding a sibling account.
    await verifyPinAgainstStore(existing, pin, adapter)
  }

  const keypair = Keypair.random()
  const secret = keypair.secret()
  const publicKey = keypair.publicKey()
  const crypto = await encryptSecretWithPin(secret, pin)
  const meta: HotAccountMeta = {
    id: generateAccountId(),
    label: cleanLabel(params.label, existing?.wallets.length ?? 0),
    publicKey,
    createdAt: Date.now(),
    backedUp: false,
  }
  const record: EncryptedWalletRecord = { meta, crypto }
  const nextStore: HotVaultStore = {
    v: 1,
    activeId: meta.id,
    wallets: [...(existing?.wallets ?? []), record],
    failedAttempts: 0,
    lockUntil: 0,
  }
  adapter.save(nextStore)
  sessionKeys.set(publicKey, keypair)

  return {
    accounts: nextStore.wallets.map((w) => w.meta),
    activeId: meta.id,
    activePublicKey: publicKey,
    revealedSecret: secret,
  }
}

/** Imports an existing Stellar secret seed (`S...`) under user's vault PIN. */
export async function importHotWalletAccount(params: {
  secret: string
  pin: string
  label?: string
  adapter?: HotVaultStorageAdapter
}): Promise<{
  accounts: HotAccountMeta[]
  activeId: string
  activePublicKey: string
}> {
  const adapter = params.adapter ?? defaultVaultStorage
  const pin = validateVaultPin(params.pin)
  const cleanSecret = params.secret.trim()

  if (!StrKey.isValidEd25519SecretSeed(cleanSecret)) {
    throw new Error('Invalid Stellar secret key (must start with S...).')
  }
  const keypair = Keypair.fromSecret(cleanSecret)
  const publicKey = keypair.publicKey()

  const existing = adapter.load()
  if (existing && existing.wallets.length > 0) {
    assertNotRateLimited(existing)
    if (existing.wallets.some((w) => w.meta.publicKey === publicKey)) {
      throw new Error('This Stellar wallet is already in your AstroGate Vault.')
    }
    if (existing.wallets.length >= MAX_HOT_WALLETS) {
      throw new Error(`Maximum ${MAX_HOT_WALLETS} hot wallets reached in vault.`)
    }
    await verifyPinAgainstStore(existing, pin, adapter)
  }

  const crypto = await encryptSecretWithPin(cleanSecret, pin)
  const meta: HotAccountMeta = {
    id: generateAccountId(),
    label: cleanLabel(params.label, existing?.wallets.length ?? 0),
    publicKey,
    createdAt: Date.now(),
    backedUp: true,
  }
  const nextStore: HotVaultStore = {
    v: 1,
    activeId: meta.id,
    wallets: [...(existing?.wallets ?? []), { meta, crypto }],
    failedAttempts: 0,
    lockUntil: 0,
  }
  adapter.save(nextStore)
  sessionKeys.set(publicKey, keypair)

  return {
    accounts: nextStore.wallets.map((w) => w.meta),
    activeId: meta.id,
    activePublicKey: publicKey,
  }
}

function recordFailedAttempt(
  store: HotVaultStore,
  adapter: HotVaultStorageAdapter,
): void {
  const failedAttempts = (store.failedAttempts ?? 0) + 1
  const lockUntil =
    failedAttempts >= LOCK_THRESHOLD_ATTEMPTS
      ? Date.now() + getBackoffMs(failedAttempts)
      : 0
  adapter.save({ ...store, failedAttempts, lockUntil })
}

async function verifyPinAgainstStore(
  store: HotVaultStore,
  pin: string,
  adapter: HotVaultStorageAdapter,
): Promise<void> {
  assertNotRateLimited(store)
  const first = store.wallets[0]
  if (!first) return
  try {
    await decryptSecretWithPin(first.crypto, pin)
  } catch (err) {
    recordFailedAttempt(store, adapter)
    throw err
  }
}

/** Decrypts all accounts in the stored vault into volatile RAM for signing. */
export async function unlockHotVault(params: {
  pin: string
  adapter?: HotVaultStorageAdapter
}): Promise<{
  accounts: HotAccountMeta[]
  activeId: string
  activePublicKey: string
}> {
  const adapter = params.adapter ?? defaultVaultStorage
  const store = adapter.load()
  if (!store || store.wallets.length === 0) {
    throw new Error('No AstroGate Hot Wallet found on this device.')
  }
  assertNotRateLimited(store)

  try {
    const unlockedPairs: Array<[string, Keypair]> = []
    for (const record of store.wallets) {
      const secret = await decryptSecretWithPin(record.crypto, params.pin.trim())
      unlockedPairs.push([record.meta.publicKey, Keypair.fromSecret(secret)])
    }
    for (const [pk, kp] of unlockedPairs) {
      sessionKeys.set(pk, kp)
    }
    if (store.failedAttempts !== 0 || store.lockUntil !== 0) {
      adapter.save({ ...store, failedAttempts: 0, lockUntil: 0 })
    }
    const active =
      store.wallets.find((w) => w.meta.id === store.activeId) ?? store.wallets[0]!
    return {
      accounts: store.wallets.map((w) => w.meta),
      activeId: active.meta.id,
      activePublicKey: active.meta.publicKey,
    }
  } catch (err) {
    recordFailedAttempt(store, adapter)
    throw err
  }
}

export function selectHotAccount(
  id: string,
  adapter: HotVaultStorageAdapter = defaultVaultStorage,
): { activeId: string; activePublicKey: string } {
  const store = adapter.load()
  if (!store) throw new Error('Hot wallet vault not found.')
  const found = store.wallets.find((w) => w.meta.id === id)
  if (!found) throw new Error('Account not found in vault.')
  adapter.save({ ...store, activeId: found.meta.id })
  return { activeId: found.meta.id, activePublicKey: found.meta.publicKey }
}

export function renameHotAccount(
  id: string,
  label: string,
  adapter: HotVaultStorageAdapter = defaultVaultStorage,
): HotAccountMeta[] {
  const store = adapter.load()
  if (!store) throw new Error('Hot wallet vault not found.')
  const trimmed = label.trim().slice(0, 24)
  if (!trimmed) throw new Error('Wallet name cannot be empty.')
  const wallets = store.wallets.map((w) =>
    w.meta.id === id ? { ...w, meta: { ...w.meta, label: trimmed } } : w,
  )
  adapter.save({ ...store, wallets })
  return wallets.map((w) => w.meta)
}

export function markHotAccountBackedUp(
  id: string,
  adapter: HotVaultStorageAdapter = defaultVaultStorage,
): HotAccountMeta[] {
  const store = adapter.load()
  if (!store) return []
  const wallets = store.wallets.map((w) =>
    w.meta.id === id ? { ...w, meta: { ...w.meta, backedUp: true } } : w,
  )
  adapter.save({ ...store, wallets })
  return wallets.map((w) => w.meta)
}

/** Re-verifies PIN to reveal the raw `S...` seed so the user retains 100% sovereign control. */
export async function revealHotAccountSecret(params: {
  id: string
  pin: string
  adapter?: HotVaultStorageAdapter
}): Promise<string> {
  const adapter = params.adapter ?? defaultVaultStorage
  const store = adapter.load()
  if (!store) throw new Error('Hot wallet vault not found.')
  assertNotRateLimited(store)

  const record = store.wallets.find((w) => w.meta.id === params.id)
  if (!record) throw new Error('Wallet account not found.')

  try {
    const secret = await decryptSecretWithPin(record.crypto, params.pin.trim())
    const wallets = store.wallets.map((w) =>
      w.meta.id === params.id
        ? { ...w, meta: { ...w.meta, backedUp: true } }
        : w,
    )
    adapter.save({ ...store, wallets, failedAttempts: 0, lockUntil: 0 })
    return secret
  } catch (err) {
    recordFailedAttempt(store, adapter)
    throw err
  }
}

export async function removeHotAccount(params: {
  id: string
  pin: string
  adapter?: HotVaultStorageAdapter
}): Promise<HotAccountMeta[]> {
  const adapter = params.adapter ?? defaultVaultStorage
  const store = adapter.load()
  if (!store) return []
  await verifyPinAgainstStore(store, params.pin.trim(), adapter)

  const target = store.wallets.find((w) => w.meta.id === params.id)
  if (target) {
    sessionKeys.delete(target.meta.publicKey)
  }
  const remaining = store.wallets.filter((w) => w.meta.id !== params.id)
  if (remaining.length === 0) {
    adapter.clear()
    sessionKeys.clear()
    return []
  }
  const nextActiveId = remaining.some((w) => w.meta.id === store.activeId)
    ? store.activeId
    : remaining[0]!.meta.id
  adapter.save({
    ...store,
    activeId: nextActiveId,
    wallets: remaining,
    failedAttempts: 0,
    lockUntil: 0,
  })
  return remaining.map((w) => w.meta)
}

export function wipeHotVault(
  adapter: HotVaultStorageAdapter = defaultVaultStorage,
): void {
  sessionKeys.clear()
  adapter.clear()
}
