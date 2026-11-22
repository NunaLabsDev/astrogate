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
import {
  base64ToBytes,
  bytesToBase64,
  decryptSecretWithPin,
  encryptSecretWithPin,
  VAULT_PBKDF2_ITERATIONS,
} from './crypto'
import { defaultVaultStorage, parseTelegramWalletLinkMeta } from './storage'
import type {
  EncryptedWalletRecord,
  HotAccountMeta,
  HotVaultStorageAdapter,
  HotVaultStore,
  TelegramWalletLinkMeta,
} from './types'

export const MIN_LEGACY_PIN_LENGTH = 4
export const MIN_VAULT_PIN_LENGTH = 6
export const MIN_CLOUD_BACKUP_PIN_LENGTH = 8
export const MAX_HOT_WALLETS = 10
export const VAULT_BUNDLE_PREFIX = 'AGVAULT1:'
const LOCK_THRESHOLD_ATTEMPTS = 5
const MIN_SAFE_ITERATIONS = 100_000
const MAX_SAFE_ITERATIONS = 2_000_000
const WALLET_ID_RE = /^[\w-]{4,64}$/

/** Volatile RAM-only unlocked keypairs keyed by Stellar public key (`G...`). */
const sessionKeys = new Map<string, Keypair>()

function generateAccountId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function validateVaultPin(pin: string): string {
  const normalized = pin.trim()
  if (normalized.length < MIN_LEGACY_PIN_LENGTH) {
    throw new Error(
      `PIN must be at least ${MIN_LEGACY_PIN_LENGTH} characters or digits.`,
    )
  }
  return normalized
}

export function validateNewVaultPin(pin: string): string {
  const normalized = pin.trim()
  if (normalized.length < MIN_VAULT_PIN_LENGTH) {
    throw new Error(
      `New Vault PIN / passphrase must be at least ${MIN_VAULT_PIN_LENGTH} characters.`,
    )
  }
  return normalized
}

export function validateCloudBackupPin(pin: string): string {
  const normalized = pin.trim()
  if (normalized.length < MIN_CLOUD_BACKUP_PIN_LENGTH) {
    throw new Error(
      `Encrypted cloud backup requires a passphrase of at least ${MIN_CLOUD_BACKUP_PIN_LENGTH} characters.`,
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

function resolvePrimaryRecord(store: HotVaultStore): EncryptedWalletRecord {
  const active =
    store.wallets.find((w) => w.meta.id === store.activeId) ?? store.wallets[0]!
  return store.wallets.find((w) => w.meta.id === store.primaryId) ?? active
}

export function readHotVaultSnapshot(
  adapter: HotVaultStorageAdapter = defaultVaultStorage,
): {
  exists: boolean
  accounts: HotAccountMeta[]
  activeId: string | null
  activePublicKey: string | null
  primaryId: string | null
  primaryPublicKey: string | null
  telegramLink: TelegramWalletLinkMeta | null
  unlocked: boolean
  cloudBackupEnabled: boolean
} {
  const store = adapter.load()
  if (!store || store.wallets.length === 0) {
    return {
      exists: false,
      accounts: [],
      activeId: null,
      activePublicKey: null,
      primaryId: null,
      primaryPublicKey: null,
      telegramLink: null,
      unlocked: false,
      cloudBackupEnabled: false,
    }
  }
  const active =
    store.wallets.find((w) => w.meta.id === store.activeId) ?? store.wallets[0]!
  const primary = resolvePrimaryRecord(store)
  return {
    exists: true,
    accounts: store.wallets.map((w) => w.meta),
    activeId: active.meta.id,
    activePublicKey: active.meta.publicKey,
    primaryId: primary.meta.id,
    primaryPublicKey: primary.meta.publicKey,
    telegramLink: store.telegramLink ?? null,
    unlocked: sessionKeys.has(active.meta.publicKey),
    cloudBackupEnabled: Boolean(store.cloudBackupEnabled),
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
  const existing = adapter.load()
  const pin =
    existing && existing.wallets.length > 0
      ? validateVaultPin(params.pin)
      : validateNewVaultPin(params.pin)

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
  const crypto = await encryptSecretWithPin(secret, pin, VAULT_PBKDF2_ITERATIONS, publicKey)
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
    primaryId: existing?.primaryId ?? meta.id,
    telegramLink: existing?.telegramLink ?? null,
    wallets: [...(existing?.wallets ?? []), record],
    failedAttempts: 0,
    lockUntil: 0,
    cloudBackupEnabled: existing?.cloudBackupEnabled ?? false,
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
  const existing = adapter.load()
  const pin =
    existing && existing.wallets.length > 0
      ? validateVaultPin(params.pin)
      : validateNewVaultPin(params.pin)
  const cleanSecret = params.secret.trim()

  if (!StrKey.isValidEd25519SecretSeed(cleanSecret)) {
    throw new Error('Invalid Stellar secret key (must start with S...).')
  }
  const keypair = Keypair.fromSecret(cleanSecret)
  const publicKey = keypair.publicKey()

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

  const crypto = await encryptSecretWithPin(
    cleanSecret,
    pin,
    VAULT_PBKDF2_ITERATIONS,
    publicKey,
  )
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
    primaryId: existing?.primaryId ?? meta.id,
    telegramLink: existing?.telegramLink ?? null,
    wallets: [...(existing?.wallets ?? []), { meta, crypto }],
    failedAttempts: 0,
    lockUntil: 0,
    cloudBackupEnabled: existing?.cloudBackupEnabled ?? false,
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
  const active =
    store.wallets.find((w) => w.meta.id === store.activeId) ?? store.wallets[0]
  if (!active) return
  try {
    const secret = await decryptSecretWithPin(active.crypto, pin, active.meta.publicKey)
    if (Keypair.fromSecret(secret).publicKey() !== active.meta.publicKey) {
      throw new Error('Vault key integrity check failed.')
    }
  } catch (err) {
    recordFailedAttempt(store, adapter)
    throw err
  }
}

/** Decrypts matching accounts in the stored vault into volatile RAM for signing. */
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

  const cleanPin = params.pin.trim()
  const unlockedPairs: Array<[string, Keypair]> = []
  for (const record of store.wallets) {
    try {
      const secret = await decryptSecretWithPin(
        record.crypto,
        cleanPin,
        record.meta.publicKey,
      )
      const kp = Keypair.fromSecret(secret)
      if (kp.publicKey() !== record.meta.publicKey) continue
      unlockedPairs.push([record.meta.publicKey, kp])
    } catch {
      // Allow partial unlock if another device merged an account under a different PIN
    }
  }

  if (unlockedPairs.length === 0) {
    recordFailedAttempt(store, adapter)
    throw new Error('Incorrect wallet PIN.')
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
    const secret = await decryptSecretWithPin(
      record.crypto,
      params.pin.trim(),
      record.meta.publicKey,
    )
    if (Keypair.fromSecret(secret).publicKey() !== record.meta.publicKey) {
      throw new Error('Vault key integrity check failed.')
    }
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
  const nextPrimaryRecord =
    (store.primaryId && remaining.find((w) => w.meta.id === store.primaryId)) ||
    remaining.find((w) => w.meta.id === nextActiveId) ||
    remaining[0]!
  const nextTelegramLink = store.telegramLink
    ? {
        ...store.telegramLink,
        primaryPublicKey: nextPrimaryRecord.meta.publicKey,
      }
    : null
  adapter.save({
    ...store,
    activeId: nextActiveId,
    primaryId: nextPrimaryRecord.meta.id,
    telegramLink: nextTelegramLink,
    wallets: remaining,
    failedAttempts: 0,
    lockUntil: 0,
  })
  return remaining.map((w) => w.meta)
}

export function setPrimaryHotAccount(
  id: string,
  adapter: HotVaultStorageAdapter = defaultVaultStorage,
): { primaryId: string; primaryPublicKey: string } {
  const store = adapter.load()
  if (!store) throw new Error('Hot wallet vault not found.')
  const found = store.wallets.find((w) => w.meta.id === id)
  if (!found) throw new Error('Account not found in vault.')
  const nextLink = store.telegramLink
    ? { ...store.telegramLink, primaryPublicKey: found.meta.publicKey }
    : null
  adapter.save({
    ...store,
    primaryId: found.meta.id,
    telegramLink: nextLink,
  })
  return { primaryId: found.meta.id, primaryPublicKey: found.meta.publicKey }
}

export function saveTelegramWalletLink(
  link: TelegramWalletLinkMeta | null,
  adapter: HotVaultStorageAdapter = defaultVaultStorage,
): void {
  const store = adapter.load()
  if (!store) return
  const matched = link
    ? store.wallets.find((w) => w.meta.publicKey === link.primaryPublicKey)
    : undefined
  adapter.save({
    ...store,
    primaryId: matched ? matched.meta.id : store.primaryId,
    telegramLink: link,
  })
}

export async function changeVaultPin(params: {
  currentPin: string
  newPin: string
  adapter?: HotVaultStorageAdapter
}): Promise<void> {
  const adapter = params.adapter ?? defaultVaultStorage
  const store = adapter.load()
  if (!store || store.wallets.length === 0) {
    throw new Error('Hot wallet vault not found.')
  }
  assertNotRateLimited(store)
  const cleanCurrent = validateVaultPin(params.currentPin)
  const cleanNext = store.cloudBackupEnabled
    ? validateCloudBackupPin(params.newPin)
    : validateNewVaultPin(params.newPin)
  await verifyPinAgainstStore(store, cleanCurrent, adapter)

  const reencrypted: EncryptedWalletRecord[] = []
  for (const w of store.wallets) {
    const secret = await decryptSecretWithPin(w.crypto, cleanCurrent, w.meta.publicKey)
    const nextCrypto = await encryptSecretWithPin(
      secret,
      cleanNext,
      VAULT_PBKDF2_ITERATIONS,
      w.meta.publicKey,
    )
    reencrypted.push({ meta: w.meta, crypto: nextCrypto })
  }
  adapter.save({
    ...store,
    wallets: reencrypted,
    failedAttempts: 0,
    lockUntil: 0,
  })
}

export async function verifyCurrentVaultPin(params: {
  pin: string
  adapter?: HotVaultStorageAdapter
}): Promise<boolean> {
  const adapter = params.adapter ?? defaultVaultStorage
  const store = adapter.load()
  if (!store || store.wallets.length === 0) {
    throw new Error('Hot wallet vault not found.')
  }
  await verifyPinAgainstStore(store, params.pin.trim(), adapter)
  return true
}

export function setVaultCloudBackupPreference(
  enabled: boolean,
  adapter: HotVaultStorageAdapter = defaultVaultStorage,
): void {
  const store = adapter.load()
  if (!store) return
  adapter.save({ ...store, cloudBackupEnabled: enabled })
}

export function isEncryptedVaultRecord(raw: unknown): raw is EncryptedWalletRecord {
  if (typeof raw !== 'object' || raw === null) return false
  const w = raw as Partial<EncryptedWalletRecord>
  return (
    typeof w.meta?.id === 'string' &&
    WALLET_ID_RE.test(w.meta.id) &&
    typeof w.meta?.label === 'string' &&
    typeof w.meta?.publicKey === 'string' &&
    StrKey.isValidEd25519PublicKey(w.meta.publicKey) &&
    w.crypto?.v === 1 &&
    w.crypto?.kdf === 'PBKDF2-SHA256' &&
    typeof w.crypto?.iterations === 'number' &&
    w.crypto.iterations >= MIN_SAFE_ITERATIONS &&
    w.crypto.iterations <= MAX_SAFE_ITERATIONS &&
    typeof w.crypto?.ciphertext === 'string' &&
    typeof w.crypto?.iv === 'string' &&
    typeof w.crypto?.salt === 'string'
  )
}

/**
 * Exports an AES-GCM encrypted portable vault bundle (`AGVAULT1:<base64>`)
 * so users can seamlessly move their wallets between Telegram Mini App and Web
 * browsers without ever exposing plaintext secret seeds (`S...`).
 */
export async function exportEncryptedVaultBundle(params: {
  pin: string
  adapter?: HotVaultStorageAdapter
}): Promise<string> {
  const adapter = params.adapter ?? defaultVaultStorage
  const store = adapter.load()
  if (!store || store.wallets.length === 0) {
    throw new Error('No AstroGate Hot Wallet found on this device.')
  }
  await verifyPinAgainstStore(store, params.pin.trim(), adapter)
  const primary = resolvePrimaryRecord(store)
  const payload = {
    v: 1 as const,
    activeId: store.activeId,
    primaryId: primary.meta.id,
    telegramLink: store.telegramLink ?? null,
    wallets: store.wallets,
  }
  const utf8 = new TextEncoder().encode(JSON.stringify(payload))
  return `${VAULT_BUNDLE_PREFIX}${bytesToBase64(utf8)}`
}

/**
 * Imports and decrypts an `AGVAULT1:` encrypted bundle using the vault PIN,
 * merging accounts cleanly without duplicates and unlocking them into volatile RAM.
 */
export async function importEncryptedVaultBundle(params: {
  bundle: string
  pin: string
  adapter?: HotVaultStorageAdapter
}): Promise<{
  accounts: HotAccountMeta[]
  activeId: string
  activePublicKey: string
  primaryId: string
  primaryPublicKey: string
  telegramLink: TelegramWalletLinkMeta | null
  importedCount: number
}> {
  const adapter = params.adapter ?? defaultVaultStorage
  const cleanBundle = params.bundle.trim()
  if (!cleanBundle.startsWith(VAULT_BUNDLE_PREFIX)) {
    throw new Error('Invalid vault bundle format (must start with AGVAULT1:).')
  }
  const pin = validateVaultPin(params.pin)

  let parsed: {
    v?: number
    activeId?: string
    primaryId?: string
    telegramLink?: unknown
    wallets?: unknown[]
  }
  try {
    const rawBytes = base64ToBytes(cleanBundle.slice(VAULT_BUNDLE_PREFIX.length))
    parsed = JSON.parse(new TextDecoder().decode(rawBytes)) as typeof parsed
  } catch {
    throw new Error('Corrupted encrypted vault bundle.')
  }

  if (parsed.v !== 1 || !Array.isArray(parsed.wallets) || parsed.wallets.length === 0) {
    throw new Error('Encrypted vault bundle contains no valid wallets.')
  }
  if (parsed.wallets.length > MAX_HOT_WALLETS) {
    throw new Error(`Vault bundle exceeds maximum ${MAX_HOT_WALLETS} wallets.`)
  }

  const incomingWallets = parsed.wallets.filter(isEncryptedVaultRecord)
  if (incomingWallets.length === 0) {
    throw new Error('Encrypted vault bundle contains no valid Stellar accounts.')
  }
  if (incomingWallets.length > MAX_HOT_WALLETS) {
    throw new Error(`Maximum ${MAX_HOT_WALLETS} hot wallets allowed per bundle.`)
  }

  const existing = adapter.load()
  if (existing && existing.wallets.length > 0) {
    assertNotRateLimited(existing)
    await verifyPinAgainstStore(existing, pin, adapter)
  }

  const existingIds = new Map<string, string>()
  for (const ew of existing?.wallets ?? []) {
    existingIds.set(ew.meta.id, ew.meta.publicKey)
  }

  const unlockedPairs: Array<[string, Keypair]> = []
  const verifiedIncoming: EncryptedWalletRecord[] = []
  const batchUsedIds = new Set<string>()
  for (const record of incomingWallets) {
    let secret: string
    try {
      secret = await decryptSecretWithPin(record.crypto, pin, record.meta.publicKey)
    } catch {
      throw new Error('Incorrect wallet PIN or corrupted vault bundle.')
    }
    const kp = Keypair.fromSecret(secret)
    if (kp.publicKey() !== record.meta.publicKey) {
      throw new Error('Vault bundle key integrity check failed.')
    }
    const collidesWithOtherPk =
      (existingIds.has(record.meta.id) && existingIds.get(record.meta.id) !== record.meta.publicKey) ||
      batchUsedIds.has(record.meta.id)
    const safeId = collidesWithOtherPk ? generateAccountId() : record.meta.id
    batchUsedIds.add(safeId)

    unlockedPairs.push([record.meta.publicKey, kp])
    verifiedIncoming.push({
      ...record,
      meta: {
        ...record.meta,
        id: safeId,
        label: cleanLabel(record.meta.label, verifiedIncoming.length),
      },
    })
  }

  const byPk = new Map<string, EncryptedWalletRecord>()
  for (const w of existing?.wallets ?? []) {
    byPk.set(w.meta.publicKey, w)
  }
  let importedCount = 0
  for (const w of verifiedIncoming) {
    const prev = byPk.get(w.meta.publicKey)
    if (!prev) importedCount += 1
    byPk.set(
      w.meta.publicKey,
      prev
        ? {
            ...prev,
            meta: {
              ...prev.meta,
              backedUp: Boolean(prev.meta.backedUp || w.meta.backedUp),
            },
          }
        : w,
    )
  }

  const mergedWallets = Array.from(byPk.values())
  if (mergedWallets.length > MAX_HOT_WALLETS) {
    throw new Error(`Maximum ${MAX_HOT_WALLETS} hot wallets reached in vault.`)
  }

  const nextActive =
    (existing && mergedWallets.find((w) => w.meta.id === existing.activeId)) ||
    (parsed.activeId && mergedWallets.find((w) => w.meta.id === parsed.activeId)) ||
    mergedWallets[0]!
  const nextPrimary =
    (existing?.primaryId && mergedWallets.find((w) => w.meta.id === existing.primaryId)) ||
    (parsed.primaryId && mergedWallets.find((w) => w.meta.id === parsed.primaryId)) ||
    nextActive

  const parsedLink = parseTelegramWalletLinkMeta(parsed.telegramLink)
  const existingLink = existing?.telegramLink ?? null
  const mergedLink =
    existingLink && parsedLink
      ? existingLink.linkedAt >= parsedLink.linkedAt
        ? existingLink
        : parsedLink
      : existingLink ?? parsedLink

  const nextStore: HotVaultStore = {
    v: 1,
    activeId: nextActive.meta.id,
    primaryId: nextPrimary.meta.id,
    telegramLink: mergedLink,
    wallets: mergedWallets,
    failedAttempts: 0,
    lockUntil: 0,
    cloudBackupEnabled: existing?.cloudBackupEnabled ?? false,
  }
  adapter.save(nextStore)
  for (const [pk, kp] of unlockedPairs) {
    sessionKeys.set(pk, kp)
  }

  return {
    accounts: mergedWallets.map((w) => w.meta),
    activeId: nextActive.meta.id,
    activePublicKey: nextActive.meta.publicKey,
    primaryId: nextPrimary.meta.id,
    primaryPublicKey: nextPrimary.meta.publicKey,
    telegramLink: mergedLink,
    importedCount,
  }
}

export function normalizeTelegramUsername(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase()
}

export function buildTelegramLinkMessage(params: {
  network: string
  tgUserId: number
  username: string
  primaryPublicKey: string
  wallets: string[]
  timestamp: number
}): string {
  const cleanUsername = normalizeTelegramUsername(params.username)
  return `astrogate:link:v1:${params.network}:${params.tgUserId}:${cleanUsername}:${params.primaryPublicKey}:${params.wallets.join(',')}:${params.timestamp}`
}

export function signTelegramWalletLink(params: {
  network: string
  tgUserId?: number
  username: string
  timestamp?: number
  adapter?: HotVaultStorageAdapter
}): {
  message: string
  signatureHex: string
  primaryPublicKey: string
  wallets: string[]
  tgUserId: number
  username: string
  timestamp: number
} {
  const adapter = params.adapter ?? defaultVaultStorage
  const store = adapter.load()
  if (!store || store.wallets.length === 0) {
    throw new Error('Create or unlock your AstroGate wallet first.')
  }
  const cleanUsername = normalizeTelegramUsername(params.username)
  if (!/^[a-z0-9_]{3,32}$/.test(cleanUsername)) {
    throw new Error('Enter a valid Telegram username (3-32 letters, numbers, or _).')
  }
  const primary = resolvePrimaryRecord(store)
  const kp = sessionKeys.get(primary.meta.publicKey)
  if (!kp) {
    throw new Error('Unlock your wallet with your PIN to sign the username link.')
  }
  const tgUserId =
    typeof params.tgUserId === 'number' && Number.isFinite(params.tgUserId)
      ? Math.trunc(params.tgUserId)
      : 0
  const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000)
  const wallets = store.wallets.map((w) => w.meta.publicKey)
  const message = buildTelegramLinkMessage({
    network: params.network,
    tgUserId,
    username: cleanUsername,
    primaryPublicKey: primary.meta.publicKey,
    wallets,
    timestamp,
  })
  const sigBytes = kp.sign(new TextEncoder().encode(message))
  const signatureHex = Array.from(sigBytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return {
    message,
    signatureHex,
    primaryPublicKey: primary.meta.publicKey,
    wallets,
    tgUserId,
    username: cleanUsername,
    timestamp,
  }
}

export function wipeHotVault(
  adapter: HotVaultStorageAdapter = defaultVaultStorage,
): void {
  sessionKeys.clear()
  adapter.clear()
}
