/**
 * Hardware-backed Biometric Unlock for AstroGate's self-custodial Hot Wallet.
 *
 * Security invariants:
 * - Zero plaintext Stellar seeds (`S...`) ever enter biometric storage or localStorage.
 * - Zero raw PINs are stored in localStorage. Instead:
 *   - Telegram Mini App (Bot API 7.2+): hardware Keychain/Keystore via `BiometricManager`
 *     holds a random 256-bit Key Encryption Key (`K_bio`), while localStorage holds only
 *     `AES-GCM(PIN, K_bio)` bound to `(NETWORK_NAME, deviceId)`. Both OS biometric auth
 *     AND the local encrypted envelope are required to recover the PIN transiently in RAM.
 *   - Web Browsers (outside Telegram): WebAuthn Platform Authenticator with PRF extension
 *     derives a hardware-bound `K_bio` via HKDF-SHA256 for the same split envelope.
 * - Storage is strictly network-scoped (`networkStorageKey`) so Testnet and Mainnet never mix.
 */
import { NETWORK_NAME, networkStorageKey } from '../network'
import { readStorageJson, removeStorageKey, writeStorageJson } from '../storage'
import {
  authenticateTelegramBiometric,
  initTelegramBiometric,
  isTelegramBiometricSupported,
  openTelegramBiometricSettings,
  requestTelegramBiometricAccess,
  updateTelegramBiometricToken,
} from '../telegram'
import {
  base64ToBytes,
  bytesToBase64,
  decryptStringWithRawKey,
  encryptStringWithRawKey,
  generateRandomKeyBase64,
} from './crypto'

export type BiometricProvider = 'telegram' | 'webauthn' | 'none'
export type BiometricType = 'finger' | 'face' | 'passkey' | 'unknown'

export interface BiometricCapability {
  provider: BiometricProvider
  available: boolean
  biometricType: BiometricType
  enrolled: boolean
  accessGranted: boolean
  needsSettings: boolean
  label: string
}

interface TelegramBioEnvelope {
  v: 1
  provider: 'telegram'
  deviceId: string
  iv: string
  ciphertext: string
}

interface WebAuthnBioEnvelope {
  v: 1
  provider: 'webauthn'
  credentialId: string
  prfSalt: string
  iv: string
  ciphertext: string
}

type StoredBioEnvelope = TelegramBioEnvelope | WebAuthnBioEnvelope

function bioStorageKey(): string {
  return networkStorageKey('astrogate.hotvault.bio.v1')
}

function loadBioEnvelope(): StoredBioEnvelope | null {
  const parsed = readStorageJson<Partial<StoredBioEnvelope>>(bioStorageKey())
  if (!parsed || parsed.v !== 1 || !parsed.iv || !parsed.ciphertext) return null
  if (parsed.provider === 'telegram' && typeof parsed.deviceId === 'string') {
    return parsed as TelegramBioEnvelope
  }
  if (
    parsed.provider === 'webauthn' &&
    typeof parsed.credentialId === 'string' &&
    typeof parsed.prfSalt === 'string'
  ) {
    return parsed as WebAuthnBioEnvelope
  }
  return null
}

function telegramLabel(kind: 'finger' | 'face' | 'unknown'): string {
  if (kind === 'face') return 'Face ID'
  if (kind === 'finger') return 'Fingerprint'
  return 'Device Biometrics'
}

function toExactBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

async function isWebAuthnPlatformAvailable(): Promise<boolean> {
  if (
    typeof window === 'undefined' ||
    typeof globalThis.PublicKeyCredential === 'undefined' ||
    typeof navigator === 'undefined' ||
    !navigator.credentials
  ) {
    return false
  }
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

export async function getBiometricCapability(): Promise<BiometricCapability> {
  const envelope = loadBioEnvelope()

  if (isTelegramBiometricSupported()) {
    const bm = await initTelegramBiometric()
    if (bm && bm.isBiometricAvailable) {
      const enrolled = Boolean(
        envelope?.provider === 'telegram' && bm.isBiometricTokenSaved && bm.isAccessGranted,
      )
      return {
        provider: 'telegram',
        available: true,
        biometricType: bm.biometricType ?? 'unknown',
        enrolled,
        accessGranted: Boolean(bm.isAccessGranted),
        needsSettings: Boolean(bm.isAccessRequested && !bm.isAccessGranted),
        label: telegramLabel(bm.biometricType ?? 'unknown'),
      }
    }
    return {
      provider: 'telegram',
      available: false,
      biometricType: 'unknown',
      enrolled: false,
      accessGranted: false,
      needsSettings: false,
      label: 'Device Biometrics',
    }
  }

  const webAuthnAvailable = await isWebAuthnPlatformAvailable()
  return {
    provider: webAuthnAvailable ? 'webauthn' : 'none',
    available: webAuthnAvailable,
    biometricType: webAuthnAvailable ? 'passkey' : 'unknown',
    enrolled: Boolean(webAuthnAvailable && envelope?.provider === 'webauthn'),
    accessGranted: webAuthnAvailable,
    needsSettings: false,
    label: 'Passkey / Biometrics',
  }
}

export function isBiometricEnrolledLocal(): boolean {
  return loadBioEnvelope() !== null
}

export async function enableBiometricUnlock(pin: string): Promise<{
  enabled: boolean
  needsSettings?: boolean
  message?: string
}> {
  const cleanPin = pin.trim()
  if (!cleanPin) {
    return { enabled: false, message: 'Enter your Wallet PIN first.' }
  }

  if (isTelegramBiometricSupported()) {
    const bm = await initTelegramBiometric()
    if (!bm || !bm.isBiometricAvailable) {
      return {
        enabled: false,
        message: 'Biometrics are unavailable on this Telegram client.',
      }
    }
    if (!bm.isAccessGranted) {
      const granted = await requestTelegramBiometricAccess(
        'Use Fingerprint or Face ID to unlock your AstroGate Wallet on this device',
      )
      if (!granted) {
        return {
          enabled: false,
          needsSettings: true,
          message: 'Biometric permission was denied. Enable it in Telegram Biometric Settings.',
        }
      }
    }

    const tokenB64 = generateRandomKeyBase64()
    const rawKeyBytes = base64ToBytes(tokenB64)
    try {
      const updated = await updateTelegramBiometricToken(tokenB64)
      if (!updated) {
        return {
          enabled: false,
          message: 'Could not save key into device biometric enclave.',
        }
      }
      const deviceId = bm.deviceId || 'tg-device'
      const aad = `ag-bio:v1:${NETWORK_NAME}:${deviceId}`
      const wrapped = await encryptStringWithRawKey(cleanPin, rawKeyBytes, aad)
      const envelope: TelegramBioEnvelope = {
        v: 1,
        provider: 'telegram',
        deviceId,
        iv: wrapped.iv,
        ciphertext: wrapped.ciphertext,
      }
      writeStorageJson(bioStorageKey(), envelope)
      return { enabled: true }
    } finally {
      rawKeyBytes.fill(0)
    }
  }

  if (!(await isWebAuthnPlatformAvailable())) {
    return {
      enabled: false,
      message: 'Hardware biometrics / Passkeys are not available on this device.',
    }
  }

  const challenge = globalThis.crypto.getRandomValues(new Uint8Array(32))
  const userId = globalThis.crypto.getRandomValues(new Uint8Array(16))
  const prfSalt = globalThis.crypto.getRandomValues(new Uint8Array(32))
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge: toExactBuffer(challenge),
        rp: {
          name: 'AstroGate Wallet',
          ...(typeof window !== 'undefined' && window.location?.hostname
            ? { id: window.location.hostname }
            : {}),
        },
        user: {
          id: toExactBuffer(userId),
          name: `astrogate-${NETWORK_NAME}`,
          displayName: `AstroGate Wallet (${NETWORK_NAME})`,
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 30_000,
        extensions: {
          prf: {
            eval: {
              first: toExactBuffer(prfSalt),
            },
          },
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null

    if (!cred) {
      return { enabled: false, message: 'Passkey registration cancelled.' }
    }

    const ext = cred.getClientExtensionResults() as {
      prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } }
    }
    const prfFirst = ext?.prf?.results?.first
    if (!prfFirst) {
      return {
        enabled: false,
        message:
          'Your browser passkey does not support hardware PRF encryption; continue using your Vault PIN.',
      }
    }

    const prfBytes = new Uint8Array(prfFirst)
    try {
      const info = `ag-bio-webauthn:${NETWORK_NAME}`
      const aad = `ag-bio-webauthn:v1:${NETWORK_NAME}`
      const wrapped = await encryptStringWithRawKey(cleanPin, prfBytes, aad, info)
      const envelope: WebAuthnBioEnvelope = {
        v: 1,
        provider: 'webauthn',
        credentialId: bytesToBase64(new Uint8Array(cred.rawId)),
        prfSalt: bytesToBase64(prfSalt),
        iv: wrapped.iv,
        ciphertext: wrapped.ciphertext,
      }
      writeStorageJson(bioStorageKey(), envelope)
      return { enabled: true }
    } finally {
      prfBytes.fill(0)
    }
  } catch (err) {
    return {
      enabled: false,
      message: err instanceof Error ? err.message : 'Passkey setup failed.',
    }
  } finally {
    challenge.fill(0)
    userId.fill(0)
    prfSalt.fill(0)
  }
}

export async function unlockWithBiometrics(): Promise<string> {
  const envelope = loadBioEnvelope()
  if (!envelope) {
    throw new Error('Biometric unlock is not set up on this device yet.')
  }

  if (envelope.provider === 'telegram') {
    const auth = await authenticateTelegramBiometric('Unlock AstroGate Wallet')
    if (!auth.authenticated || !auth.token) {
      if (auth.authenticated && !auth.token) {
        removeStorageKey(bioStorageKey())
      }
      throw new Error('Biometric authentication cancelled or token missing.')
    }
    const rawKeyBytes = base64ToBytes(auth.token)
    try {
      const aad = `ag-bio:v1:${NETWORK_NAME}:${envelope.deviceId}`
      return await decryptStringWithRawKey(
        { iv: envelope.iv, ciphertext: envelope.ciphertext },
        rawKeyBytes,
        aad,
      )
    } catch {
      removeStorageKey(bioStorageKey())
      throw new Error('Biometric key changed or invalid. Unlock once with PIN and re-enable.')
    } finally {
      rawKeyBytes.fill(0)
    }
  }

  if (!(await isWebAuthnPlatformAvailable())) {
    throw new Error('Platform biometrics unavailable.')
  }
  const challenge = globalThis.crypto.getRandomValues(new Uint8Array(32))
  const credId = base64ToBytes(envelope.credentialId)
  const prfSalt = base64ToBytes(envelope.prfSalt)
  try {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: toExactBuffer(challenge),
        allowCredentials: [{ type: 'public-key', id: toExactBuffer(credId) }],
        userVerification: 'required',
        timeout: 30_000,
        extensions: {
          prf: {
            eval: {
              first: toExactBuffer(prfSalt),
            },
          },
        } as AuthenticationExtensionsClientInputs,
      },
    })) as PublicKeyCredential | null

    if (!assertion) {
      throw new Error('Passkey verification cancelled.')
    }
    const ext = assertion.getClientExtensionResults() as {
      prf?: { results?: { first?: ArrayBuffer } }
    }
    const prfFirst = ext?.prf?.results?.first
    if (!prfFirst) {
      removeStorageKey(bioStorageKey())
      throw new Error('Hardware PRF key missing. Unlock once with your PIN.')
    }
    const prfBytes = new Uint8Array(prfFirst)
    try {
      const info = `ag-bio-webauthn:${NETWORK_NAME}`
      const aad = `ag-bio-webauthn:v1:${NETWORK_NAME}`
      return await decryptStringWithRawKey(
        { iv: envelope.iv, ciphertext: envelope.ciphertext },
        prfBytes,
        aad,
        info,
      )
    } finally {
      prfBytes.fill(0)
    }
  } finally {
    challenge.fill(0)
    credId.fill(0)
    prfSalt.fill(0)
  }
}

export async function disableBiometricUnlock(): Promise<void> {
  removeStorageKey(bioStorageKey())
  if (isTelegramBiometricSupported()) {
    await updateTelegramBiometricToken('')
  }
}

export function openBiometricSettings(): void {
  openTelegramBiometricSettings()
}
