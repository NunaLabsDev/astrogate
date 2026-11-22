/**
 * Pluggable persistence layer for the encrypted Stellar Hot Wallet vault.
 * Secrets are ALWAYS stored encrypted (AES-GCM); plaintext never hits storage.
 */
import { networkStorageKey } from '../network'
import { readStorageJson, removeStorageKey, writeStorageJson } from '../storage'
import type {
  HotVaultStorageAdapter,
  HotVaultStore,
  TelegramWalletLinkMeta,
} from './types'

const BASE_VAULT_STORAGE_KEY = 'astrogate.hotvault.v1'
const WALLET_ID_RE = /^[\w-]{4,64}$/

export function vaultStorageKey(): string {
  return networkStorageKey(BASE_VAULT_STORAGE_KEY)
}

const MIN_SAFE_ITERATIONS = 100_000
const MAX_SAFE_ITERATIONS = 2_000_000

export function parseTelegramWalletLinkMeta(
  raw: unknown,
): TelegramWalletLinkMeta | null {
  if (typeof raw !== 'object' || raw === null) return null
  const link = raw as Partial<TelegramWalletLinkMeta>
  if (
    typeof link.username !== 'string' ||
    !link.username.trim() ||
    typeof link.primaryPublicKey !== 'string' ||
    !link.primaryPublicKey.startsWith('G')
  ) {
    return null
  }
  return {
    ...(typeof link.tgUserId === 'number' && Number.isFinite(link.tgUserId)
      ? { tgUserId: link.tgUserId }
      : {}),
    username: link.username.trim().replace(/^@/, '').toLowerCase(),
    primaryPublicKey: link.primaryPublicKey,
    linkedAt:
      typeof link.linkedAt === 'number' && Number.isFinite(link.linkedAt)
        ? link.linkedAt
        : 0,
    ...(typeof link.verifiedTelegram === 'boolean'
      ? { verifiedTelegram: link.verifiedTelegram }
      : {}),
  }
}

function isValidStore(raw: unknown): raw is HotVaultStore {
  if (typeof raw !== 'object' || raw === null) return false
  const store = raw as Partial<HotVaultStore>
  if (
    store.v !== 1 ||
    typeof store.activeId !== 'string' ||
    (store.primaryId !== undefined && typeof store.primaryId !== 'string') ||
    !Array.isArray(store.wallets)
  ) {
    return false
  }
  const seenIds = new Set<string>()
  return store.wallets.every((w) => {
    const valid =
      typeof w?.meta?.id === 'string' &&
      WALLET_ID_RE.test(w.meta.id) &&
      !seenIds.has(w.meta.id) &&
      typeof w?.meta?.publicKey === 'string' &&
      w.meta.publicKey.startsWith('G') &&
      w?.crypto?.v === 1 &&
      w?.crypto?.kdf === 'PBKDF2-SHA256' &&
      typeof w?.crypto?.iterations === 'number' &&
      w.crypto.iterations >= MIN_SAFE_ITERATIONS &&
      w.crypto.iterations <= MAX_SAFE_ITERATIONS &&
      typeof w?.crypto?.ciphertext === 'string' &&
      typeof w?.crypto?.iv === 'string' &&
      typeof w?.crypto?.salt === 'string'
    if (valid && w?.meta?.id) seenIds.add(w.meta.id)
    return valid
  })
}

export const defaultVaultStorage: HotVaultStorageAdapter = {
  load(): HotVaultStore | null {
    const parsed = readStorageJson<unknown>(vaultStorageKey())
    if (!isValidStore(parsed)) return null
    return {
      ...parsed,
      telegramLink: parseTelegramWalletLinkMeta(parsed.telegramLink),
      cloudBackupEnabled: Boolean(parsed.cloudBackupEnabled),
    }
  },
  save(store: HotVaultStore): void {
    writeStorageJson(vaultStorageKey(), store)
  },
  clear(): void {
    removeStorageKey(vaultStorageKey())
  },
}
