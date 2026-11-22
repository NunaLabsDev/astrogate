import { afterEach, describe, expect, it } from 'vitest'
import { clearStorageMemoryFallbackForTests, readStorageString } from '../storage'
import {
  disableBiometricUnlock,
  enableBiometricUnlock,
  getBiometricCapability,
  unlockWithBiometrics,
} from './biometrics'

function installTelegramBiometricMock(options?: { available?: boolean; granted?: boolean }) {
  let savedToken = ''
  let granted = options?.granted ?? false
  const available = options?.available ?? true
  const bm = {
    isInited: false,
    isBiometricAvailable: available,
    biometricType: 'finger' as const,
    isAccessRequested: false,
    get isAccessGranted() {
      return granted
    },
    get isBiometricTokenSaved() {
      return savedToken.length > 0
    },
    deviceId: 'ios-device-xyz',
    init(cb?: () => void) {
      bm.isInited = true
      cb?.()
      return bm
    },
    requestAccess(_params: { reason?: string }, cb?: (ok: boolean) => void) {
      bm.isAccessRequested = true
      granted = options?.granted ?? true
      cb?.(granted)
      return bm
    },
    authenticate(_params: { reason?: string }, cb?: (ok: boolean, tok?: string) => void) {
      if (!granted || !savedToken) {
        cb?.(false)
      } else {
        cb?.(true, savedToken)
      }
      return bm
    },
    updateBiometricToken(token: string, cb?: (ok: boolean) => void) {
      if (!granted) {
        cb?.(false)
      } else {
        savedToken = token
        cb?.(true)
      }
      return bm
    },
    openSettings() {
      return bm
    },
  }

  ;(globalThis as { window?: unknown }).window = {
    Telegram: {
      WebApp: {
        platform: 'ios',
        isVersionAtLeast: () => true,
        BiometricManager: bm,
      },
    },
  }
  return { getToken: () => savedToken, setToken: (t: string) => (savedToken = t), bm }
}

afterEach(() => {
  clearStorageMemoryFallbackForTests()
  delete (globalThis as { window?: unknown }).window
})

describe('Hot Wallet Hardware Biometrics (Telegram BiometricManager)', () => {
  it('enrolls with hardware keystore K_bio, wraps PIN via AES-GCM, and unlocks cleanly', async () => {
    const mock = installTelegramBiometricMock({ available: true, granted: true })

    const capBefore = await getBiometricCapability()
    expect(capBefore.provider).toBe('telegram')
    expect(capBefore.available).toBe(true)
    expect(capBefore.biometricType).toBe('finger')
    expect(capBefore.enrolled).toBe(false)

    const userPin = 'astro-vault-9988'
    const enrolled = await enableBiometricUnlock(userPin)
    expect(enrolled.enabled).toBe(true)

    // Ensure raw PIN is NEVER stored in localStorage or inside BiometricManager token
    const storedEnvelope = readStorageString('astrogate.hotvault.bio.v1')
    expect(storedEnvelope).toBeTruthy()
    expect(storedEnvelope).not.toContain(userPin)
    expect(mock.getToken()).not.toContain(userPin)
    expect(mock.getToken().length).toBeGreaterThanOrEqual(32)

    const capAfter = await getBiometricCapability()
    expect(capAfter.enrolled).toBe(true)

    const unlockedPin = await unlockWithBiometrics()
    expect(unlockedPin).toBe(userPin)

    await disableBiometricUnlock()
    expect(mock.getToken()).toBe('')
    expect((await getBiometricCapability()).enrolled).toBe(false)
    await expect(unlockWithBiometrics()).rejects.toThrow(/not set up/i)
  })

  it('clears corrupted/mismatched biometric envelope if OS keystore key changed', async () => {
    const mock = installTelegramBiometricMock({ available: true, granted: true })
    await enableBiometricUnlock('pin-123456')

    // Rotate token outside app -> authentication returns wrong key -> envelope auto-cleared
    mock.setToken('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=')
    await expect(unlockWithBiometrics()).rejects.toThrow(/invalid/i)
    expect(readStorageString('astrogate.hotvault.bio.v1')).toBeNull()
  })
})
