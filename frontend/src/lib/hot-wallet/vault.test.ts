import { afterEach, describe, expect, it } from 'vitest'
import { Keypair } from '@stellar/stellar-sdk'
import type { HotVaultStorageAdapter, HotVaultStore } from './types'
import { decryptSecretWithPin, encryptSecretWithPin } from './crypto'
import {
  createHotWalletAccount,
  getHotWalletSigner,
  importHotWalletAccount,
  isHotAccountUnlocked,
  lockHotVault,
  readHotVaultSnapshot,
  removeHotAccount,
  revealHotAccountSecret,
  selectHotAccount,
  unlockHotVault,
  wipeHotVault,
} from './vault'

function createMemoryAdapter(): HotVaultStorageAdapter {
  let state: HotVaultStore | null = null
  return {
    load: () => (state ? structuredClone(state) : null),
    save: (next) => {
      state = structuredClone(next)
    },
    clear: () => {
      state = null
    },
  }
}

afterEach(() => {
  lockHotVault()
})

describe('hot-wallet crypto', () => {
  it('cifra y descifra una semilla Stellar S... con AES-GCM + PBKDF2', async () => {
    const kp = Keypair.random()
    const payload = await encryptSecretWithPin(kp.secret(), '482910', 10_000)

    expect(payload.v).toBe(1)
    expect(payload.kdf).toBe('PBKDF2-SHA256')
    expect(payload.ciphertext).not.toContain(kp.secret())

    const plain = await decryptSecretWithPin(payload, '482910')
    expect(plain).toBe(kp.secret())
    await expect(decryptSecretWithPin(payload, '000000')).rejects.toThrow(
      'Incorrect wallet PIN',
    )
  })
})

describe('hot-wallet vault lifecycle', () => {
  it('crea, bloquea, desbloquea, importa, exporta y borra wallets bajo control total del usuario', async () => {
    const adapter = createMemoryAdapter()
    const created = await createHotWalletAccount({
      pin: '123456',
      label: 'Primary',
      adapter,
    })

    expect(created.activePublicKey.startsWith('G')).toBe(true)
    expect(created.revealedSecret.startsWith('S')).toBe(true)
    expect(isHotAccountUnlocked(created.activePublicKey)).toBe(true)
    expect(getHotWalletSigner(created.activePublicKey)).not.toBeNull()

    // Lock clears volatile RAM signer immediately while keeping metadata intact
    lockHotVault()
    expect(isHotAccountUnlocked(created.activePublicKey)).toBe(false)
    expect(getHotWalletSigner(created.activePublicKey)).toBeNull()

    const lockedSnap = readHotVaultSnapshot(adapter)
    expect(lockedSnap.exists).toBe(true)
    expect(lockedSnap.unlocked).toBe(false)
    expect(lockedSnap.activePublicKey).toBe(created.activePublicKey)

    // Unlock restores signer in RAM
    await unlockHotVault({ pin: '123456', adapter })
    expect(isHotAccountUnlocked(created.activePublicKey)).toBe(true)
    expect(getHotWalletSigner(created.activePublicKey)).not.toBeNull()

    // Import an external Stellar keypair under the same vault PIN
    const external = Keypair.random()
    const imported = await importHotWalletAccount({
      secret: external.secret(),
      pin: '123456',
      label: 'Imported',
      adapter,
    })
    expect(imported.accounts).toHaveLength(2)
    expect(imported.activePublicKey).toBe(external.publicKey())

    // Reveal secret requires valid PIN and marks backedUp
    const revealed = await revealHotAccountSecret({
      id: created.activeId,
      pin: '123456',
      adapter,
    })
    expect(revealed).toBe(created.revealedSecret)
    expect(
      readHotVaultSnapshot(adapter).accounts.find((a) => a.id === created.activeId)
        ?.backedUp,
    ).toBe(true)

    // Switch back and remove one account
    selectHotAccount(created.activeId, adapter)
    expect(readHotVaultSnapshot(adapter).activeId).toBe(created.activeId)

    const remaining = await removeHotAccount({
      id: imported.activeId,
      pin: '123456',
      adapter,
    })
    expect(remaining).toHaveLength(1)

    wipeHotVault(adapter)
    expect(readHotVaultSnapshot(adapter).exists).toBe(false)
    expect(getHotWalletSigner(created.activePublicKey)).toBeNull()
  })

  it('aplica rate-limit tras 5 intentos fallidos de PIN', async () => {
    const adapter = createMemoryAdapter()
    await createHotWalletAccount({ pin: '7391', adapter })
    lockHotVault()

    for (let i = 0; i < 5; i++) {
      await expect(unlockHotVault({ pin: '0000', adapter })).rejects.toThrow(
        'Incorrect wallet PIN',
      )
    }

    await expect(unlockHotVault({ pin: '7391', adapter })).rejects.toThrow(
      /Too many wrong PIN attempts/i,
    )
  })
})
