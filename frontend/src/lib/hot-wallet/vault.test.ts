import { afterEach, describe, expect, it } from 'vitest'
import { Keypair } from '@stellar/stellar-sdk'
import type { HotVaultStorageAdapter, HotVaultStore } from './types'
import { decryptSecretWithPin, encryptSecretWithPin } from './crypto'
import {
  clearVaultFromTelegramCloud,
  syncVaultWithTelegramCloud,
} from './telegram-sync'
import {
  buildTelegramLinkMessage,
  createHotWalletAccount,
  exportEncryptedVaultBundle,
  getHotWalletSigner,
  importEncryptedVaultBundle,
  importHotWalletAccount,
  isHotAccountUnlocked,
  lockHotVault,
  readHotVaultSnapshot,
  removeHotAccount,
  revealHotAccountSecret,
  saveTelegramWalletLink,
  selectHotAccount,
  setPrimaryHotAccount,
  signTelegramWalletLink,
  unlockHotVault,
  VAULT_BUNDLE_PREFIX,
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
  delete (globalThis as { window?: unknown }).window
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

  it('sincroniza y restaura el vault CIFRADO en Telegram CloudStorage sin perder la wallet al borrar local', async () => {
    const cloudMap = new Map<string, string>()
    ;(globalThis as { window?: unknown }).window = {
      Telegram: {
        WebApp: {
          platform: 'ios',
          isVersionAtLeast: () => true,
          CloudStorage: {
            setItem: (k: string, val: string, cb?: (err: string | null, ok?: boolean) => void) => {
              cloudMap.set(k, val)
              cb?.(null, true)
            },
            getItem: (k: string, cb: (err: string | null, val?: string) => void) => {
              cb(null, cloudMap.get(k) ?? '')
            },
            getItems: (keys: string[], cb: (err: string | null, vals?: Record<string, string>) => void) => {
              const out: Record<string, string> = {}
              for (const k of keys) if (cloudMap.has(k)) out[k] = cloudMap.get(k)!
              cb(null, out)
            },
            removeItem: (k: string, cb?: (err: string | null, ok?: boolean) => void) => {
              cloudMap.delete(k)
              cb?.(null, true)
            },
            removeItems: (keys: string[], cb?: (err: string | null, ok?: boolean) => void) => {
              for (const k of keys) cloudMap.delete(k)
              cb?.(null, true)
            },
            getKeys: (cb: (err: string | null, keys?: string[]) => void) => {
              cb(null, Array.from(cloudMap.keys()))
            },
          },
        },
      },
    }

    const phoneAdapter = createMemoryAdapter()
    const created = await createHotWalletAccount({
      pin: '551199',
      label: 'Phone',
      adapter: phoneAdapter,
    })

    // Sync local encrypted vault up to Telegram CloudStorage
    const pushSync = await syncVaultWithTelegramCloud(phoneAdapter)
    expect(pushSync.synced).toBe(true)
    expect(pushSync.restoredFromCloud).toBe(false)
    // Verify plaintext S... key NEVER stored in CloudStorage
    const allCloudValues = Array.from(cloudMap.values()).join(' ')
    expect(allCloudValues).not.toContain(created.revealedSecret)

    // Simulate WebView wiping localStorage or opening on Telegram Desktop
    lockHotVault()
    const desktopAdapter = createMemoryAdapter()
    expect(readHotVaultSnapshot(desktopAdapter).exists).toBe(false)

    const pullSync = await syncVaultWithTelegramCloud(desktopAdapter)
    expect(pullSync.synced).toBe(true)
    expect(pullSync.restoredFromCloud).toBe(true)
    expect(readHotVaultSnapshot(desktopAdapter).activePublicKey).toBe(
      created.activePublicKey,
    )

    // User unlocks restored wallet seamlessly with their existing PIN
    await unlockHotVault({ pin: '551199', adapter: desktopAdapter })
    expect(isHotAccountUnlocked(created.activePublicKey)).toBe(true)

    expect(await clearVaultFromTelegramCloud()).toBe(true)
    expect(cloudMap.size).toBe(0)
  })

  it('soporta cuenta Primary para @username, firma Ed25519 de vínculo y exportación/importación portátil AGVAULT1', async () => {
    const sourceAdapter = createMemoryAdapter()
    const w1 = await createHotWalletAccount({
      pin: '246810',
      label: 'Main',
      adapter: sourceAdapter,
    })
    const w2 = await createHotWalletAccount({
      pin: '246810',
      label: 'Trading',
      adapter: sourceAdapter,
    })

    // Initially primary is the first account
    expect(readHotVaultSnapshot(sourceAdapter).primaryPublicKey).toBe(
      w1.activePublicKey,
    )

    // Switch primary receiving wallet to sub-wallet #2
    const primaryRes = setPrimaryHotAccount(w2.activeId, sourceAdapter)
    expect(primaryRes.primaryPublicKey).toBe(w2.activePublicKey)

    // Sign canonical Telegram @username binding proof with Primary wallet
    const signed = signTelegramWalletLink({
      network: 'testnet',
      tgUserId: 778899,
      username: '@AstroTrader',
      timestamp: 1_760_000_000,
      adapter: sourceAdapter,
    })
    expect(signed.username).toBe('astrotrader')
    expect(signed.primaryPublicKey).toBe(w2.activePublicKey)
    expect(signed.wallets).toEqual([w1.activePublicKey, w2.activePublicKey])
    expect(signed.message).toBe(
      buildTelegramLinkMessage({
        network: 'testnet',
        tgUserId: 778899,
        username: 'astrotrader',
        primaryPublicKey: w2.activePublicKey,
        wallets: [w1.activePublicKey, w2.activePublicKey],
        timestamp: 1_760_000_000,
      }),
    )

    const sigBytes = Uint8Array.from(
      signed.signatureHex.match(/.{2}/g)!.map((h) => Number.parseInt(h, 16)),
    )
    expect(
      Keypair.fromPublicKey(w2.activePublicKey).verify(
        new TextEncoder().encode(signed.message),
        sigBytes,
      ),
    ).toBe(true)

    saveTelegramWalletLink(
      {
        tgUserId: 778899,
        username: 'astrotrader',
        primaryPublicKey: w2.activePublicKey,
        linkedAt: 1_760_000_000_000,
        verifiedTelegram: true,
      },
      sourceAdapter,
    )

    // Export encrypted bundle (Telegram -> Web sync) and ensure secrets never appear in plaintext
    const bundle = await exportEncryptedVaultBundle({
      pin: '246810',
      adapter: sourceAdapter,
    })
    expect(bundle.startsWith(VAULT_BUNDLE_PREFIX)).toBe(true)
    const decodedBundle = Buffer.from(
      bundle.slice(VAULT_BUNDLE_PREFIX.length),
      'base64',
    ).toString('utf8')
    expect(decodedBundle).not.toContain(w1.revealedSecret)
    expect(decodedBundle).not.toContain(w2.revealedSecret)

    // Restore onto a clean browser device with PIN
    lockHotVault()
    const webAdapter = createMemoryAdapter()
    await expect(
      importEncryptedVaultBundle({
        bundle,
        pin: '000000',
        adapter: webAdapter,
      }),
    ).rejects.toThrow(/Incorrect wallet PIN/i)

    const restored = await importEncryptedVaultBundle({
      bundle,
      pin: '246810',
      adapter: webAdapter,
    })
    expect(restored.importedCount).toBe(2)
    expect(restored.primaryPublicKey).toBe(w2.activePublicKey)
    expect(restored.telegramLink?.username).toBe('astrotrader')
    expect(isHotAccountUnlocked(w1.activePublicKey)).toBe(true)
    expect(isHotAccountUnlocked(w2.activePublicKey)).toBe(true)
  })
})
