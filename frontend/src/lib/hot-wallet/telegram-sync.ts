/**
 * Encrypted cross-device persistence for AstroGate's Hot Wallet Vault via
 * `Telegram.WebApp.CloudStorage`.
 *
 * Security invariants:
 * - Only AES-GCM-256 + PBKDF2-SHA256 encrypted payloads leave the WebView.
 *   Plaintext secret keys (`S...`) or PINs NEVER touch Telegram CloudStorage.
 * - Splits metadata (`ag_vault_meta_v1`) and each wallet record (`ag_vault_w_<id>`)
 *   into individual keys to stay well under Telegram's 4,096-byte-per-key limit.
 */
import {
  isTelegramCloudAvailable,
  telegramCloudGetItems,
  telegramCloudGetKeys,
  telegramCloudRemoveItems,
  telegramCloudSetItem,
} from '../telegram'
import { defaultVaultStorage } from './storage'
import type {
  EncryptedWalletRecord,
  HotVaultStorageAdapter,
  HotVaultStore,
} from './types'

const CLOUD_META_KEY = 'ag_vault_meta_v1'
const CLOUD_WALLET_PREFIX = 'ag_vault_w_'

interface CloudVaultMeta {
  v: 1
  activeId: string
  ids: string[]
  updatedAt: number
}

function walletCloudKey(id: string): string {
  return `${CLOUD_WALLET_PREFIX}${id}`
}

function isValidWalletRecord(raw: unknown): raw is EncryptedWalletRecord {
  if (typeof raw !== 'object' || raw === null) return false
  const w = raw as Partial<EncryptedWalletRecord>
  return (
    typeof w.meta?.id === 'string' &&
    typeof w.meta?.publicKey === 'string' &&
    w.meta.publicKey.startsWith('G') &&
    typeof w.crypto?.ciphertext === 'string' &&
    typeof w.crypto?.iv === 'string' &&
    typeof w.crypto?.salt === 'string'
  )
}

function parseCloudMeta(raw: string | undefined): CloudVaultMeta | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<CloudVaultMeta>
    if (
      parsed.v === 1 &&
      typeof parsed.activeId === 'string' &&
      Array.isArray(parsed.ids)
    ) {
      return {
        v: 1,
        activeId: parsed.activeId,
        ids: parsed.ids.filter((id): id is string => typeof id === 'string'),
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      }
    }
  } catch {
    return null
  }
  return null
}

/** Pushes the local encrypted vault state to Telegram CloudStorage. */
export async function pushVaultToTelegramCloud(
  store: HotVaultStore | null,
): Promise<boolean> {
  if (!isTelegramCloudAvailable()) return false
  if (!store || store.wallets.length === 0) {
    return clearVaultFromTelegramCloud()
  }

  const meta: CloudVaultMeta = {
    v: 1,
    activeId: store.activeId,
    ids: store.wallets.map((w) => w.meta.id),
    updatedAt: Date.now(),
  }

  const tasks: Array<Promise<boolean>> = [
    telegramCloudSetItem(CLOUD_META_KEY, JSON.stringify(meta)),
    ...store.wallets.map((w) =>
      telegramCloudSetItem(walletCloudKey(w.meta.id), JSON.stringify(w)),
    ),
  ]

  // Garbage-collect stale wallet keys removed locally
  const existingKeys = await telegramCloudGetKeys()
  const validSet = new Set(store.wallets.map((w) => walletCloudKey(w.meta.id)))
  const stale = existingKeys.filter(
    (k) => k.startsWith(CLOUD_WALLET_PREFIX) && !validSet.has(k),
  )
  if (stale.length > 0) {
    tasks.push(telegramCloudRemoveItems(stale))
  }

  const results = await Promise.all(tasks)
  return results.every(Boolean)
}

/** Erases all encrypted vault keys from Telegram CloudStorage when user resets vault. */
export async function clearVaultFromTelegramCloud(): Promise<boolean> {
  if (!isTelegramCloudAvailable()) return false
  const keys = await telegramCloudGetKeys()
  const vaultKeys = keys.filter(
    (k) => k === CLOUD_META_KEY || k.startsWith(CLOUD_WALLET_PREFIX),
  )
  if (vaultKeys.length === 0) return true
  return telegramCloudRemoveItems(vaultKeys)
}

/** Loads encrypted vault records stored under the user's Telegram profile. */
export async function loadVaultFromTelegramCloud(): Promise<HotVaultStore | null> {
  if (!isTelegramCloudAvailable()) return null
  const metaMap = await telegramCloudGetItems([CLOUD_META_KEY])
  const meta = parseCloudMeta(metaMap[CLOUD_META_KEY])
  if (!meta || meta.ids.length === 0) return null

  const walletKeys = meta.ids.map(walletCloudKey)
  const items = await telegramCloudGetItems(walletKeys)
  const wallets: EncryptedWalletRecord[] = []
  for (const key of walletKeys) {
    const raw = items[key]
    if (!raw) continue
    try {
      const parsed: unknown = JSON.parse(raw)
      if (isValidWalletRecord(parsed)) {
        wallets.push(parsed)
      }
    } catch {
      // Skip malformed entry cleanly
    }
  }
  if (wallets.length === 0) return null

  const activeId = wallets.some((w) => w.meta.id === meta.activeId)
    ? meta.activeId
    : wallets[0]!.meta.id

  return {
    v: 1,
    activeId,
    wallets,
    failedAttempts: 0,
    lockUntil: 0,
  }
}

/**
 * Reconciles encrypted device vault with Telegram CloudStorage:
 * - Restores encrypted accounts if iOS/Android cleared local WebView storage or user switched device.
 * - Pushes newly created local accounts to Telegram CloudStorage if cloud lacked them.
 */
export async function syncVaultWithTelegramCloud(
  adapter: HotVaultStorageAdapter = defaultVaultStorage,
): Promise<{
  synced: boolean
  restoredFromCloud: boolean
  store: HotVaultStore | null
}> {
  if (!isTelegramCloudAvailable()) {
    return { synced: false, restoredFromCloud: false, store: adapter.load() }
  }

  const localStore = adapter.load()
  const cloudStore = await loadVaultFromTelegramCloud()

  if (!localStore && !cloudStore) {
    return { synced: true, restoredFromCloud: false, store: null }
  }

  if (!localStore && cloudStore) {
    adapter.save(cloudStore)
    return { synced: true, restoredFromCloud: true, store: cloudStore }
  }

  if (localStore && !cloudStore) {
    await pushVaultToTelegramCloud(localStore)
    return { synced: true, restoredFromCloud: false, store: localStore }
  }

  // Both exist: merge any accounts present in cloud but missing locally (and vice versa)
  const local = localStore!
  const cloud = cloudStore!
  const byPk = new Map<string, EncryptedWalletRecord>()
  for (const w of cloud.wallets) {
    byPk.set(w.meta.publicKey, w)
  }
  let addedFromCloud = false
  for (const w of cloud.wallets) {
    if (!local.wallets.some((lw) => lw.meta.publicKey === w.meta.publicKey)) {
      addedFromCloud = true
    }
  }
  for (const w of local.wallets) {
    const existing = byPk.get(w.meta.publicKey)
    byPk.set(
      w.meta.publicKey,
      existing
        ? {
            ...w,
            meta: {
              ...w.meta,
              backedUp: Boolean(w.meta.backedUp || existing.meta.backedUp),
            },
          }
        : w,
    )
  }

  const merged: HotVaultStore = {
    v: 1,
    activeId: local.activeId,
    wallets: Array.from(byPk.values()),
    failedAttempts: local.failedAttempts,
    lockUntil: local.lockUntil,
  }
  adapter.save(merged)
  if (merged.wallets.length !== cloud.wallets.length) {
    await pushVaultToTelegramCloud(merged)
  }
  return { synced: true, restoredFromCloud: addedFromCloud, store: merged }
}
