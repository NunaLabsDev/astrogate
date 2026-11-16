/**
 * Modular, self-custodial Stellar Hot Wallet domain types.
 * Designed so storage adapters, key derivation, and signers remain decoupled
 * and easy to scale (multi-account, BIP39, hardware/cloud encrypted sync).
 */

export interface HotAccountMeta {
  id: string
  label: string
  publicKey: string
  createdAt: number
  /** True once the user explicitly acknowledged/exported their recovery secret. */
  backedUp: boolean
}

export interface EncryptedSecretPayload {
  v: 1
  kdf: 'PBKDF2-SHA256'
  iterations: number
  /** Base64 random 16-byte salt. */
  salt: string
  /** Base64 random 12-byte AES-GCM nonce. */
  iv: string
  /** Base64 AES-GCM ciphertext + 128-bit auth tag over Stellar secret seed (`S...`). */
  ciphertext: string
}

export interface EncryptedWalletRecord {
  meta: HotAccountMeta
  crypto: EncryptedSecretPayload
}

export interface HotVaultStore {
  v: 1
  activeId: string
  wallets: EncryptedWalletRecord[]
  failedAttempts: number
  /** Unix timestamp (ms) until next unlock attempt is permitted after repeated failures. */
  lockUntil: number
}

/** Storage adapter abstraction to allow swappable persistence backends (localStorage, IndexedDB, etc.). */
export interface HotVaultStorageAdapter {
  load(): HotVaultStore | null
  save(store: HotVaultStore): void
  clear(): void
}
