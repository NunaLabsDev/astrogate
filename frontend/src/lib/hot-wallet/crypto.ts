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

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

export function base64ToBytes(encoded: string): Uint8Array {
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

function copyToBufferView(bytes: Uint8Array): {
  view: Uint8Array<ArrayBuffer>
  buffer: ArrayBuffer
  wipe: () => void
} {
  const buffer = new ArrayBuffer(bytes.byteLength)
  const view = new Uint8Array(buffer)
  view.set(bytes)
  return {
    view,
    buffer,
    wipe: () => view.fill(0),
  }
}

async function deriveAesKey(
  pin: string,
  salt: Uint8Array,
  iterations: number,
  usage: KeyUsage[],
): Promise<CryptoKey> {
  const subtle = requireSubtle()
  const pinBytes = new TextEncoder().encode(pin)
  const pinCopy = copyToBufferView(pinBytes)
  const saltCopy = copyToBufferView(salt)
  try {
    const baseKey = await subtle.importKey(
      'raw',
      pinCopy.buffer,
      'PBKDF2',
      false,
      ['deriveKey'],
    )
    return await subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: saltCopy.buffer,
        iterations,
        hash: 'SHA-256',
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      usage,
    )
  } finally {
    pinBytes.fill(0)
    pinCopy.wipe()
    saltCopy.wipe()
  }
}

/** Encrypts a Stellar secret seed under a user PIN using a fresh random salt, IV, and optional AAD. */
export async function encryptSecretWithPin(
  secret: string,
  pin: string,
  iterations = VAULT_PBKDF2_ITERATIONS,
  aad?: string,
): Promise<EncryptedSecretPayload> {
  const subtle = requireSubtle()
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const aesKey = await deriveAesKey(pin, salt, iterations, ['encrypt'])
  const plaintext = new TextEncoder().encode(secret)
  const plaintextCopy = copyToBufferView(plaintext)
  const ivCopy = copyToBufferView(iv)
  const aadCopy = aad ? copyToBufferView(new TextEncoder().encode(aad)) : undefined
  try {
    const encrypted = await subtle.encrypt(
      aadCopy
        ? { name: 'AES-GCM', iv: ivCopy.buffer, additionalData: aadCopy.buffer }
        : { name: 'AES-GCM', iv: ivCopy.buffer },
      aesKey,
      plaintextCopy.buffer,
    )
    return {
      v: 1,
      kdf: 'PBKDF2-SHA256',
      iterations,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    }
  } finally {
    plaintext.fill(0)
    plaintextCopy.wipe()
    ivCopy.wipe()
    aadCopy?.wipe()
    salt.fill(0)
    iv.fill(0)
  }
}

/**
 * Decrypts a Stellar secret seed; verifies optional AAD (falling back to legacy v1
 * payloads without AAD if needed) and throws `'Incorrect wallet PIN.'` on auth failure.
 */
export async function decryptSecretWithPin(
  payload: EncryptedSecretPayload,
  pin: string,
  aad?: string,
): Promise<string> {
  const subtle = requireSubtle()
  const salt = base64ToBytes(payload.salt)
  const iv = base64ToBytes(payload.iv)
  const ciphertext = base64ToBytes(payload.ciphertext)
  const aesKey = await deriveAesKey(pin, salt, payload.iterations, ['decrypt'])
  const ivCopy = copyToBufferView(iv)
  const ctCopy = copyToBufferView(ciphertext)
  const aadCopy = aad ? copyToBufferView(new TextEncoder().encode(aad)) : undefined
  try {
    const decrypted = await subtle.decrypt(
      aadCopy
        ? { name: 'AES-GCM', iv: ivCopy.buffer, additionalData: aadCopy.buffer }
        : { name: 'AES-GCM', iv: ivCopy.buffer },
      aesKey,
      ctCopy.buffer,
    )
    const view = new Uint8Array(decrypted)
    try {
      return new TextDecoder().decode(view)
    } finally {
      view.fill(0)
    }
  } catch {
    if (aadCopy) {
      // Backwards compatibility for pre-AAD v1 encrypted payloads on device/CloudStorage.
      try {
        const legacyDecrypted = await subtle.decrypt(
          { name: 'AES-GCM', iv: ivCopy.buffer },
          aesKey,
          ctCopy.buffer,
        )
        const view = new Uint8Array(legacyDecrypted)
        try {
          return new TextDecoder().decode(view)
        } finally {
          view.fill(0)
        }
      } catch {
        // Fall through to PIN error
      }
    }
    throw new Error('Incorrect wallet PIN.')
  } finally {
    salt.fill(0)
    iv.fill(0)
    ciphertext.fill(0)
    ivCopy.wipe()
    ctCopy.wipe()
    aadCopy?.wipe()
  }
}

/** Generates a 256-bit random key encoded as base64 for hardware-backed biometric storage. */
export function generateRandomKeyBase64(): string {
  const raw = globalThis.crypto.getRandomValues(new Uint8Array(32))
  try {
    return bytesToBase64(raw)
  } finally {
    raw.fill(0)
  }
}

async function importRawAesKey(
  rawKeyBytes: Uint8Array,
  usage: KeyUsage[],
  hkdfInfo?: string,
): Promise<CryptoKey> {
  const subtle = requireSubtle()
  const keyCopy = copyToBufferView(rawKeyBytes)
  const infoCopy = hkdfInfo
    ? copyToBufferView(new TextEncoder().encode(hkdfInfo))
    : undefined
  const zeroSalt = hkdfInfo ? new ArrayBuffer(32) : undefined
  try {
    if (infoCopy && zeroSalt) {
      const base = await subtle.importKey('raw', keyCopy.buffer, 'HKDF', false, ['deriveKey'])
      return await subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: zeroSalt, info: infoCopy.buffer },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        usage,
      )
    }
    return await subtle.importKey('raw', keyCopy.buffer, { name: 'AES-GCM' }, false, usage)
  } finally {
    keyCopy.wipe()
    infoCopy?.wipe()
  }
}

/** Encrypts a UTF-8 secret (e.g. vault PIN) with a 256-bit hardware-held key. */
export async function encryptStringWithRawKey(
  plaintextValue: string,
  rawKeyBytes: Uint8Array,
  aad?: string,
  hkdfInfo?: string,
): Promise<{ iv: string; ciphertext: string }> {
  const subtle = requireSubtle()
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ivCopy = copyToBufferView(iv)
  const plaintext = new TextEncoder().encode(plaintextValue)
  const plaintextCopy = copyToBufferView(plaintext)
  const aadCopy = aad ? copyToBufferView(new TextEncoder().encode(aad)) : undefined
  try {
    const aesKey = await importRawAesKey(rawKeyBytes, ['encrypt'], hkdfInfo)
    const encrypted = await subtle.encrypt(
      aadCopy
        ? { name: 'AES-GCM', iv: ivCopy.buffer, additionalData: aadCopy.buffer }
        : { name: 'AES-GCM', iv: ivCopy.buffer },
      aesKey,
      plaintextCopy.buffer,
    )
    return {
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    }
  } finally {
    iv.fill(0)
    ivCopy.wipe()
    plaintext.fill(0)
    plaintextCopy.wipe()
    aadCopy?.wipe()
  }
}

/** Decrypts a UTF-8 secret wrapped with `encryptStringWithRawKey`. */
export async function decryptStringWithRawKey(
  payload: { iv: string; ciphertext: string },
  rawKeyBytes: Uint8Array,
  aad?: string,
  hkdfInfo?: string,
): Promise<string> {
  const subtle = requireSubtle()
  const iv = base64ToBytes(payload.iv)
  const ct = base64ToBytes(payload.ciphertext)
  const ivCopy = copyToBufferView(iv)
  const ctCopy = copyToBufferView(ct)
  const aadCopy = aad ? copyToBufferView(new TextEncoder().encode(aad)) : undefined
  try {
    const aesKey = await importRawAesKey(rawKeyBytes, ['decrypt'], hkdfInfo)
    const decrypted = await subtle.decrypt(
      aadCopy
        ? { name: 'AES-GCM', iv: ivCopy.buffer, additionalData: aadCopy.buffer }
        : { name: 'AES-GCM', iv: ivCopy.buffer },
      aesKey,
      ctCopy.buffer,
    )
    const view = new Uint8Array(decrypted)
    try {
      return new TextDecoder().decode(view)
    } finally {
      view.fill(0)
    }
  } finally {
    iv.fill(0)
    ct.fill(0)
    ivCopy.wipe()
    ctCopy.wipe()
    aadCopy?.wipe()
  }
}
