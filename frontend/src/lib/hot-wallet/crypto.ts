/**
 * Client-side authenticated encryption for Stellar secret keys (`S...`).
 * Uses native WebCrypto (`PBKDF2-SHA256` + `AES-GCM-256`) with zero external dependencies.
 */
import type { EncryptedSecretPayload } from './types'

export const VAULT_PBKDF2_ITERATIONS = 210_000

const SALT_BYTES = 16
const IV_BYTES = 12

function requireSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error(
      'WebCrypto AES-GCM is unavailable in this environment (HTTPS required).',
    )
  }
  return subtle
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

function base64ToBytes(encoded: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(encoded, 'base64'))
  }
  const binary = atob(encoded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i)
  }
  return out
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

async function deriveAesKey(
  pin: string,
  salt: Uint8Array,
  iterations: number,
  usage: KeyUsage[],
): Promise<CryptoKey> {
  const subtle = requireSubtle()
  const pinBytes = new TextEncoder().encode(pin)
  const baseKey = await subtle.importKey(
    'raw',
    toArrayBuffer(pinBytes),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: toArrayBuffer(salt),
      iterations,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    usage,
  )
}

/** Encrypts a Stellar secret seed under a user PIN using a fresh random salt & IV. */
export async function encryptSecretWithPin(
  secret: string,
  pin: string,
  iterations = VAULT_PBKDF2_ITERATIONS,
): Promise<EncryptedSecretPayload> {
  const subtle = requireSubtle()
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const aesKey = await deriveAesKey(pin, salt, iterations, ['encrypt'])
  const plaintext = new TextEncoder().encode(secret)
  const encrypted = await subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    aesKey,
    toArrayBuffer(plaintext),
  )
  return {
    v: 1,
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
  }
}

/** Decrypts a Stellar secret seed; throws `'Invalid PIN or corrupted vault.'` on auth failure. */
export async function decryptSecretWithPin(
  payload: EncryptedSecretPayload,
  pin: string,
): Promise<string> {
  const subtle = requireSubtle()
  const salt = base64ToBytes(payload.salt)
  const iv = base64ToBytes(payload.iv)
  const ciphertext = base64ToBytes(payload.ciphertext)
  const aesKey = await deriveAesKey(pin, salt, payload.iterations, ['decrypt'])
  try {
    const decrypted = await subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      aesKey,
      toArrayBuffer(ciphertext),
    )
    return new TextDecoder().decode(decrypted)
  } catch {
    throw new Error('Incorrect wallet PIN.')
  }
}
