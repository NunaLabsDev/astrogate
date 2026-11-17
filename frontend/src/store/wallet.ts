import { create } from 'zustand'
import { Networks, StellarWalletsKit } from '@creit.tech/stellar-wallets-kit'
import { defaultModules } from '@creit.tech/stellar-wallets-kit/modules/utils'
import {
  WalletConnectModule,
  WalletConnectTargetChain,
} from '@creit.tech/stellar-wallets-kit/modules/wallet-connect'
import type { Signer } from '@stellar/stellar-sdk/contract'
import { BRAND } from '../lib/brand'
import { NETWORK_NAME } from '../lib/network'
import { walletSigner } from '../lib/signer'
import { readStorageString, removeStorageKey, writeStorageString } from '../lib/storage'
import {
  clearVaultFromTelegramCloud,
  createHotWalletAccount,
  defaultVaultStorage,
  getHotWalletSigner,
  importHotWalletAccount,
  lockHotVault,
  markHotAccountBackedUp,
  pushVaultToTelegramCloud,
  readHotVaultSnapshot,
  removeHotAccount as removeVaultAccount,
  renameHotAccount as renameVaultAccount,
  revealHotAccountSecret,
  selectHotAccount as selectVaultAccount,
  syncVaultWithTelegramCloud,
  unlockHotVault,
  wipeHotVault,
  type HotAccountMeta,
} from '../lib/hot-wallet'
import {
  MAX_DEMO_ACCOUNTS,
  createDemoAccounts,
  createSingleDemoAccount,
  demoLabelForIndex,
  demoSigner,
  loadActiveDemo,
  loadDemoAccounts,
  loadDemoMode,
  saveActiveDemo,
  saveDemoAccounts,
  saveDemoMode,
  type DemoAccount,
} from '../lib/demo'

const wcProjectId = import.meta.env.VITE_WC_PROJECT_ID?.trim() ?? ''

/** Origin tolerante a SSR (el smoke test renderiza en node sin window). */
function appOrigin(): string {
  return globalThis.location?.origin ?? 'https://astrogate.local'
}

/**
 * Módulos de wallet: los nativos siempre; WalletConnect v2 (Freighter Mobile,
 * xBull móvil, etc. vía QR) solo si hay `VITE_WC_PROJECT_ID` de Reown Cloud
 * (https://cloud.reown.com, gratis). Nuestros flujos solo necesitan
 * signTransaction/signAndSubmitTransaction, y WalletConnect los cubre.
 */
function walletModules() {
  if (!wcProjectId) return defaultModules()
  const targetChain =
    NETWORK_NAME === 'mainnet'
      ? WalletConnectTargetChain.PUBLIC
      : WalletConnectTargetChain.TESTNET
  return defaultModules().concat(
    new WalletConnectModule({
      projectId: wcProjectId,
      metadata: {
        name: `${BRAND.emoji} ${BRAND.name}`,
        description: BRAND.manifestDescription,
        url: appOrigin(),
        icons: [`${appOrigin()}/icon-192.png`],
      },
      allowedChains: [targetChain],
    }),
  )
}

/**
 * Kit singleton inicializado LAZY (la llamada de la UI lo dispara).
 * Inicializarlo en import-time ejecutaría side-effects (connect eager de
 * WalletConnect) en cada carga aunque nadie use wallet.
 *
 * OJO: en kit >= 2.x `authModal`/`disconnect` son MÉTODOS ESTÁTICOS, por lo
 * que aquí se guarda la clase (`typeof StellarWalletsKit`), no una instancia.
 */
let kit: typeof StellarWalletsKit | null = null
function walletKit(): typeof StellarWalletsKit {
  if (!kit) {
    StellarWalletsKit.init({
      modules: walletModules(),
      network: NETWORK_NAME === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET,
    })
    kit = StellarWalletsKit
  }
  return kit
}

export type WalletMode = 'wallet' | 'hot' | 'demo'
export type WalletModalView = 'connect' | 'unlock' | 'manage'

const HOT_MODE_KEY = 'astrogate.hot.mode.v1'
function loadHotMode(): boolean {
  return readStorageString(HOT_MODE_KEY) === '1'
}
function saveHotMode(active: boolean): void {
  if (active) writeStorageString(HOT_MODE_KEY, '1')
  else removeStorageKey(HOT_MODE_KEY)
}

type WalletState = {
  publicKey: string | null
  pending: boolean
  error: string | null
  mode: WalletMode
  /** Embedded self-custodial Hot Wallet Vault metadata & lock state. */
  hotAccounts: HotAccountMeta[]
  hotActiveId: string | null
  hotUnlocked: boolean
  telegramCloudSynced: boolean
  walletModalOpen: boolean
  walletModalView: WalletModalView
  /** Cuentas desechables de testnet (modo prueba, sin wallet). */
  demoAccounts: DemoAccount[]
  demoActive: number
  demoPending: boolean
  demoStage: string | null
  demoError: string | null
  openWalletModal: (view?: WalletModalView) => void
  closeWalletModal: () => void
  hydrateFromTelegramCloud: () => Promise<void>
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  createHotWallet: (params: {
    pin: string
    label?: string
  }) => Promise<{ revealedSecret: string; publicKey: string }>
  importHotWallet: (params: {
    secret: string
    pin: string
    label?: string
  }) => Promise<void>
  unlockHotWallet: (pin: string) => Promise<void>
  lockHotWallet: () => void
  selectHotAccount: (id: string) => void
  renameHotAccount: (id: string, label: string) => void
  confirmHotBackup: (id: string) => void
  revealHotSecret: (id: string, pin: string) => Promise<string>
  removeHotAccount: (id: string, pin: string) => Promise<void>
  wipeHotWallet: () => void
  startDemo: () => Promise<void>
  addDemoAccount: () => Promise<void>
  resetDemoAccounts: () => Promise<void>
  selectDemo: (index: number) => void
  /** Firmante de la cuenta activa (hot wallet desbloqueada, wallet externa o cuenta demo). */
  getSigner: () => Signer | null
  /** Igual que getSigner, pero si hay una Hot Wallet bloqueada abre el sheet de PIN automáticamente. */
  requireSignerOrPrompt: () => Signer | null
}

const isMainnet = NETWORK_NAME === 'mainnet'
const storedDemo = isMainnet ? [] : loadDemoAccounts()
const storedDemoActive = Math.min(
  loadActiveDemo(),
  Math.max(storedDemo.length - 1, 0),
)
const initialHot = readHotVaultSnapshot()
const startInDemo = !isMainnet && storedDemo.length > 0 && loadDemoMode()
const startInHot = !startInDemo && initialHot.exists && loadHotMode()

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error'
}

export const useWallet = create<WalletState>((set, get) => ({
  publicKey: startInDemo
    ? (storedDemo[storedDemoActive]?.publicKey ?? null)
    : startInHot
      ? initialHot.activePublicKey
      : null,
  pending: false,
  error: null,
  mode: startInDemo ? 'demo' : startInHot ? 'hot' : 'wallet',
  hotAccounts: initialHot.accounts,
  hotActiveId: initialHot.activeId,
  hotUnlocked: initialHot.unlocked,
  telegramCloudSynced: false,
  walletModalOpen: false,
  walletModalView: 'connect',
  demoAccounts: storedDemo,
  demoActive: storedDemoActive,
  demoPending: false,
  demoStage: null,
  demoError: null,

  openWalletModal: (view) =>
    set((state) => ({
      walletModalOpen: true,
      walletModalView:
        view ??
        (state.hotAccounts.length > 0
          ? state.hotUnlocked && state.mode === 'hot' && state.publicKey
            ? 'manage'
            : 'unlock'
          : 'connect'),
      error: null,
    })),

  closeWalletModal: () => set({ walletModalOpen: false, error: null }),

  hydrateFromTelegramCloud: async () => {
    const syncRes = await syncVaultWithTelegramCloud()
    if (!syncRes.synced) return
    const snap = readHotVaultSnapshot()
    const shouldActivateHot =
      snap.exists &&
      snap.activePublicKey &&
      (syncRes.restoredFromCloud ||
        (get().mode !== 'demo' && !get().publicKey && loadHotMode()))

    if (shouldActivateHot) {
      saveHotMode(true)
      set({
        mode: 'hot',
        publicKey: snap.activePublicKey,
        hotAccounts: snap.accounts,
        hotActiveId: snap.activeId,
        hotUnlocked: snap.unlocked,
        telegramCloudSynced: true,
      })
      return
    }
    set({
      hotAccounts: snap.accounts,
      hotActiveId: snap.activeId,
      telegramCloudSynced: true,
    })
  },

  connect: async () => {
    set({ pending: true, error: null })
    try {
      const { address } = await walletKit().authModal()
      saveDemoMode(false)
      saveHotMode(false)
      set({
        publicKey: address,
        mode: 'wallet',
        walletModalOpen: false,
      })
    } catch (error) {
      const message = messageOf(error)
      const dismissed =
        /close|cancel|dismiss|abort/i.test(message) ||
        message.toLowerCase().startsWith('error: code: ')
      // Cerrar el modal no es un error de estado: se descarta silenciosamente.
      if (!dismissed) set({ error: message })
    } finally {
      set({ pending: false })
    }
  },

  disconnect: async () => {
    if (get().pending) return // anti doble-click
    set({ pending: true })
    try {
      if (get().mode === 'demo') {
        saveDemoMode(false)
        set({ mode: 'wallet', publicKey: null })
        return
      }
      if (get().mode === 'hot') {
        lockHotVault()
        saveHotMode(false)
        set({
          mode: 'wallet',
          publicKey: null,
          hotUnlocked: false,
          walletModalOpen: false,
        })
        return
      }
      await walletKit().disconnect()
      set({ publicKey: null })
    } finally {
      set({ pending: false })
    }
  },

  createHotWallet: async ({ pin, label }) => {
    set({ pending: true, error: null })
    try {
      const res = await createHotWalletAccount({ pin, label })
      saveDemoMode(false)
      saveHotMode(true)
      set({
        mode: 'hot',
        publicKey: res.activePublicKey,
        hotAccounts: res.accounts,
        hotActiveId: res.activeId,
        hotUnlocked: true,
      })
      void pushVaultToTelegramCloud(defaultVaultStorage.load()).then((ok) => {
        if (ok) set({ telegramCloudSynced: true })
      })
      return {
        revealedSecret: res.revealedSecret,
        publicKey: res.activePublicKey,
      }
    } catch (error) {
      const message = messageOf(error)
      set({ error: message })
      throw error
    } finally {
      set({ pending: false })
    }
  },

  importHotWallet: async ({ secret, pin, label }) => {
    set({ pending: true, error: null })
    try {
      const res = await importHotWalletAccount({ secret, pin, label })
      saveDemoMode(false)
      saveHotMode(true)
      set({
        mode: 'hot',
        publicKey: res.activePublicKey,
        hotAccounts: res.accounts,
        hotActiveId: res.activeId,
        hotUnlocked: true,
      })
      void pushVaultToTelegramCloud(defaultVaultStorage.load()).then((ok) => {
        if (ok) set({ telegramCloudSynced: true })
      })
    } catch (error) {
      const message = messageOf(error)
      set({ error: message })
      throw error
    } finally {
      set({ pending: false })
    }
  },

  unlockHotWallet: async (pin) => {
    set({ pending: true, error: null })
    try {
      const res = await unlockHotVault({ pin })
      saveDemoMode(false)
      saveHotMode(true)
      set({
        mode: 'hot',
        publicKey: res.activePublicKey,
        hotAccounts: res.accounts,
        hotActiveId: res.activeId,
        hotUnlocked: true,
      })
      void pushVaultToTelegramCloud(defaultVaultStorage.load()).then((ok) => {
        if (ok) set({ telegramCloudSynced: true })
      })
    } catch (error) {
      const message = messageOf(error)
      set({ error: message })
      throw error
    } finally {
      set({ pending: false })
    }
  },

  lockHotWallet: () => {
    lockHotVault()
    set({ hotUnlocked: false })
  },

  selectHotAccount: (id) => {
    const res = selectVaultAccount(id)
    saveDemoMode(false)
    saveHotMode(true)
    const snap = readHotVaultSnapshot()
    set({
      mode: 'hot',
      hotActiveId: res.activeId,
      publicKey: res.activePublicKey,
      hotAccounts: snap.accounts,
      hotUnlocked: snap.unlocked,
    })
    void pushVaultToTelegramCloud(defaultVaultStorage.load())
  },

  renameHotAccount: (id, label) => {
    const accounts = renameVaultAccount(id, label)
    set({ hotAccounts: accounts })
    void pushVaultToTelegramCloud(defaultVaultStorage.load())
  },

  confirmHotBackup: (id) => {
    const accounts = markHotAccountBackedUp(id)
    set({ hotAccounts: accounts })
    void pushVaultToTelegramCloud(defaultVaultStorage.load())
  },

  revealHotSecret: async (id, pin) => {
    const secret = await revealHotAccountSecret({ id, pin })
    const snap = readHotVaultSnapshot()
    set({ hotAccounts: snap.accounts })
    void pushVaultToTelegramCloud(defaultVaultStorage.load())
    return secret
  },

  removeHotAccount: async (id, pin) => {
    const accounts = await removeVaultAccount({ id, pin })
    if (accounts.length === 0) {
      saveHotMode(false)
      void clearVaultFromTelegramCloud()
      set({
        mode: 'wallet',
        publicKey: null,
        hotAccounts: [],
        hotActiveId: null,
        hotUnlocked: false,
        walletModalOpen: false,
      })
      return
    }
    const snap = readHotVaultSnapshot()
    set({
      hotAccounts: accounts,
      hotActiveId: snap.activeId,
      publicKey: snap.activePublicKey,
      hotUnlocked: snap.unlocked,
    })
    void pushVaultToTelegramCloud(defaultVaultStorage.load())
  },

  wipeHotWallet: () => {
    wipeHotVault()
    saveHotMode(false)
    void clearVaultFromTelegramCloud()
    set({
      mode: get().mode === 'hot' ? 'wallet' : get().mode,
      publicKey: get().mode === 'hot' ? null : get().publicKey,
      hotAccounts: [],
      hotActiveId: null,
      hotUnlocked: false,
      telegramCloudSynced: false,
      walletModalOpen: false,
    })
  },

  startDemo: async () => {
    if (isMainnet) {
      throw new Error('Demo accounts are disabled on Stellar Mainnet.')
    }
    const { demoAccounts, demoActive } = get()
    if (demoAccounts.length > 0) {
      const index = Math.min(demoActive, demoAccounts.length - 1)
      saveActiveDemo(index)
      saveDemoMode(true)
      saveHotMode(false)
      set({
        mode: 'demo',
        demoActive: index,
        publicKey: demoAccounts[index].publicKey,
        demoError: null,
        walletModalOpen: false,
      })
      return
    }

    set({
      demoPending: true,
      demoStage: 'Generating testnet accounts…',
      demoError: null,
    })
    try {
      const { accounts, failed } = await createDemoAccounts(
        ({ index, status }) => {
          const label = demoLabelForIndex(index)
          set({
            demoStage:
              status === 'funding'
                ? `Funding account ${label} with 10,000 XLM…`
                : `Account ${label} ready ✓`,
          })
        },
      )
      saveDemoAccounts(accounts)
      saveActiveDemo(0)
      saveDemoMode(true)
      saveHotMode(false)
      set({
        demoAccounts: accounts,
        demoActive: 0,
        mode: 'demo',
        publicKey: accounts[0].publicKey,
        demoStage: null,
      })
      if (failed > 0) {
        set({
          demoError: `Funded ${accounts.length} of ${accounts.length + failed} accounts (Friendbot rate limit). You can add more from the menu.`,
        })
      }
    } catch (error) {
      set({ demoError: messageOf(error) })
    } finally {
      set({ demoPending: false, demoStage: null })
    }
  },

  addDemoAccount: async () => {
    if (isMainnet) return
    const { demoAccounts, demoPending } = get()
    if (demoPending) return
    if (demoAccounts.length >= MAX_DEMO_ACCOUNTS) {
      set({
        demoError: `You have reached the maximum of ${MAX_DEMO_ACCOUNTS} test accounts in this browser.`,
      })
      return
    }
    const nextIndex = demoAccounts.length
    const label = demoLabelForIndex(nextIndex)
    set({
      demoPending: true,
      demoStage: `Creating and funding account ${label} with 10,000 XLM…`,
      demoError: null,
    })
    try {
      const newAccount = await createSingleDemoAccount(label)
      const updated = [...demoAccounts, newAccount]
      saveDemoAccounts(updated)
      saveActiveDemo(nextIndex)
      saveDemoMode(true)
      set({
        demoAccounts: updated,
        demoActive: nextIndex,
        mode: 'demo',
        publicKey: newAccount.publicKey,
        demoStage: null,
      })
    } catch (error) {
      set({ demoError: messageOf(error) })
    } finally {
      set({ demoPending: false, demoStage: null })
    }
  },

  resetDemoAccounts: async () => {
    if (isMainnet || get().demoPending) return
    set({
      demoPending: true,
      demoStage: 'Regenerating new testnet accounts…',
      demoError: null,
    })
    try {
      const { accounts, failed } = await createDemoAccounts(
        ({ index, status }) => {
          const label = demoLabelForIndex(index)
          set({
            demoStage:
              status === 'funding'
                ? `Funding new account ${label} with 10,000 XLM…`
                : `Account ${label} ready ✓`,
          })
        },
      )
      saveDemoAccounts(accounts)
      saveActiveDemo(0)
      saveDemoMode(true)
      saveHotMode(false)
      set({
        demoAccounts: accounts,
        demoActive: 0,
        mode: 'demo',
        publicKey: accounts[0].publicKey,
        demoStage: null,
      })
      if (failed > 0) {
        set({
          demoError: `Funded ${accounts.length} of ${accounts.length + failed} accounts (Friendbot rate limit).`,
        })
      }
    } catch (error) {
      set({ demoError: messageOf(error) })
    } finally {
      set({ demoPending: false, demoStage: null })
    }
  },

  selectDemo: (index) => {
    const account = get().demoAccounts[index]
    if (!account) return
    saveActiveDemo(index)
    saveDemoMode(true)
    saveHotMode(false)
    set({
      mode: 'demo',
      demoActive: index,
      publicKey: account.publicKey,
      demoError: null,
      walletModalOpen: false,
    })
  },

  getSigner: () => {
    const { mode, publicKey, demoAccounts, demoActive } = get()
    if (!publicKey) return null
    if (mode === 'hot') {
      return getHotWalletSigner(publicKey)
    }
    if (mode === 'demo') {
      const account = demoAccounts[demoActive]
      return account ? demoSigner(account) : null
    }
    return walletSigner(publicKey)
  },

  requireSignerOrPrompt: () => {
    const signer = get().getSigner()
    if (signer) return signer
    const { mode, hotUnlocked, openWalletModal } = get()
    if (mode === 'hot' && !hotUnlocked) {
      openWalletModal('unlock')
    }
    return null
  },
}))
