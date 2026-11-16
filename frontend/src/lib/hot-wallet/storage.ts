/**
 * Pluggable persistence layer for the encrypted Stellar Hot Wallet vault.
 * Secrets are ALWAYS stored encrypted (AES-GCM); plaintext never hits storage.
 */
import { readStorageJson, removeStorageKey, writeStorageJson } from '../storage'
import type { HotVaultStorageAdapter, HotVaultStore } from './types'

const VAULT_STORAGE_KEY = 'astrogate.hotvault.v1'

function isValidStore(raw: unknown): raw is HotVaultStore {
  if (typeof raw !== 'object' || raw === null) return false
  const store = raw as Partial<HotVaultStore>
  return (
    store.v === 1 &&
    typeof store.activeId === 'string' &&
    Array.isArray(store.wallets) &&
    store.wallets.every(
      (w) =>
        typeof w?.meta?.id === 'string' &&
        typeof w?.meta?.publicKey === 'string' &&
        w.meta.publicKey.startsWith('G') &&
        typeof w?.crypto?.ciphertext === 'string' &&
        typeof w?.crypto?.iv === 'string' &&
        typeof w?.crypto?.salt === 'string',
    )
  )
}

export const defaultVaultStorage: HotVaultStorageAdapter = {
  load(): HotVaultStore | null {
    const parsed = readStorageJson<unknown>(VAULT_STORAGE_KEY)
    return isValidStore(parsed) ? parsed : null
  },
  save(store: HotVaultStore): void {
    writeStorageJson(VAULT_STORAGE_KEY, store)
  },
  clear(): void {
    removeStorageKey(VAULT_STORAGE_KEY)
  },
}
