import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWallet } from '../store/wallet'
import { useXlmBalance } from '../hooks/useXlmBalance'
import { fundTestnetAddress } from '../lib/demo'
import { errorMessage, shortAddress } from '../lib/format'
import { NETWORK_NAME } from '../lib/network'
import {
  isTelegramCloudAvailable,
  readTelegramUser,
  triggerTelegramHaptic,
} from '../lib/telegram'
import { toast } from '../lib/toast'
import { MAX_HOT_WALLETS, MIN_VAULT_PIN_LENGTH } from '../lib/hot-wallet'

type ConnectTab = 'create' | 'import' | 'external'

/**
 * Mobile-first bottom-sheet / centered dialog for AstroGate's embedded
 * self-custodial Hot Wallet Vault + External Wallet options.
 */
export function HotWalletModal() {
  const walletModalOpen = useWallet((state) => state.walletModalOpen)
  if (!walletModalOpen) return null
  return <HotWalletDialog />
}

function HotWalletDialog() {
  const queryClient = useQueryClient()
  const {
    publicKey,
    mode,
    pending,
    hotAccounts,
    hotActiveId,
    hotUnlocked,
    telegramCloudSynced,
    walletModalView,
    demoPending,
    closeWalletModal,
    openWalletModal,
    connect,
    startDemo,
    createHotWallet,
    importHotWallet,
    unlockHotWallet,
    lockHotWallet,
    selectHotAccount,
    renameHotAccount,
    confirmHotBackup,
    revealHotSecret,
    removeHotAccount,
    wipeHotWallet,
  } = useWallet()

  const activeAccount =
    hotAccounts.find((a) => a.id === hotActiveId) ?? hotAccounts[0] ?? null
  const xlmBalance = useXlmBalance(publicKey)
  const tgCloudReady = isTelegramCloudAvailable()
  const tgUser = readTelegramUser()

  const [tab, setTab] = useState<ConnectTab>('create')
  const [label, setLabel] = useState('')
  const [pin, setPin] = useState('')
  const [secretInput, setSecretInput] = useState('')
  const [justCreated, setJustCreated] = useState<{
    publicKey: string
    secret: string
    accountId: string
  } | null>(null)
  const [showCreatedSecret, setShowCreatedSecret] = useState(false)
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)
  const [exportPin, setExportPin] = useState('')
  const [unlockPin, setUnlockPin] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [busy, setBusy] = useState(false)
  const [funding, setFunding] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const hasExistingVault = hotAccounts.length > 0

  async function copyText(text: string, labelText: string) {
    try {
      await navigator.clipboard.writeText(text)
      triggerTelegramHaptic('light')
      toast.success(`${labelText} copied`)
    } catch {
      toast.error('Clipboard permission denied')
    }
  }

  async function handleFund(address: string) {
    if (NETWORK_NAME === 'mainnet') return
    setFunding(true)
    setLocalError(null)
    try {
      await fundTestnetAddress(address)
      triggerTelegramHaptic('success')
      toast.success('Wallet funded with +10,000 Testnet XLM')
      await queryClient.invalidateQueries({ queryKey: ['xlm-balance'] })
    } catch (err) {
      const msg = errorMessage(err)
      setLocalError(msg)
      toast.error('Faucet failed', { message: msg })
    } finally {
      setFunding(false)
    }
  }

  async function onCreateSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLocalError(null)
    setBusy(true)
    try {
      const res = await createHotWallet({
        pin,
        label: label || undefined,
      })
      const snapAccounts = useWallet.getState().hotAccounts
      const newest = snapAccounts.find((a) => a.publicKey === res.publicKey)
      setJustCreated({
        publicKey: res.publicKey,
        secret: res.revealedSecret,
        accountId: newest?.id ?? '',
      })
      setShowCreatedSecret(false)
      setPin('')
      setLabel('')
      triggerTelegramHaptic('success')
    } catch (err) {
      triggerTelegramHaptic('error')
      setLocalError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onImportSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLocalError(null)
    setBusy(true)
    try {
      await importHotWallet({
        secret: secretInput,
        pin,
        label: label || undefined,
      })
      triggerTelegramHaptic('success')
      toast.success('Stellar wallet imported & encrypted locally')
      setSecretInput('')
      setPin('')
      setLabel('')
      closeWalletModal()
    } catch (err) {
      triggerTelegramHaptic('error')
      setLocalError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onUnlockSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLocalError(null)
    setBusy(true)
    try {
      await unlockHotWallet(unlockPin)
      triggerTelegramHaptic('success')
      toast.success('Hot wallet unlocked')
      setUnlockPin('')
      closeWalletModal()
    } catch (err) {
      triggerTelegramHaptic('error')
      setLocalError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onRevealSecret(e: React.FormEvent) {
    e.preventDefault()
    if (!activeAccount) return
    setLocalError(null)
    setBusy(true)
    try {
      const secret = await revealHotSecret(activeAccount.id, exportPin)
      setRevealedSecret(secret)
      setExportPin('')
      triggerTelegramHaptic('medium')
    } catch (err) {
      triggerTelegramHaptic('error')
      setLocalError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onRemoveAccount(id: string) {
    if (!exportPin.trim()) {
      setLocalError('Enter your vault PIN in the box above before deleting a wallet.')
      return
    }
    setLocalError(null)
    setBusy(true)
    try {
      await removeHotAccount(id, exportPin)
      setExportPin('')
      toast.success('Account removed from vault')
    } catch (err) {
      setLocalError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="AstroGate Wallet Vault"
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-md p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeWalletModal()
      }}
    >
      <div className="liquid-glass w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-slate-700/80 bg-slate-950/95 p-5 pb-7 sm:p-6 shadow-2xl max-h-[90vh] overflow-y-auto space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base sm:text-lg font-extrabold text-white tracking-tight">
              {justCreated
                ? '🔐 Wallet Ready — Save Your Key'
                : walletModalView === 'unlock'
                  ? '🔓 Unlock Your Wallet'
                  : walletModalView === 'manage'
                    ? '⚡ AstroGate Self-Custody Vault'
                    : '⚡ Connect or Create Wallet'}
            </h2>
            <p className="text-[11px] text-slate-400">
              Non-custodial AES-GCM vault · keys never leave your device.
            </p>
            {tgCloudReady ? (
              <p className="mt-1 inline-flex items-center gap-1 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold text-sky-300">
                ☁️{' '}
                {telegramCloudSynced ? 'Synced' : 'Syncing'} encrypted to{' '}
                {tgUser.username
                  ? `@${tgUser.username}`
                  : tgUser.firstName ?? 'Telegram profile'}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => {
              setJustCreated(null)
              closeWalletModal()
            }}
            aria-label="Close wallet dialog"
            className="min-h-[40px] min-w-[40px] rounded-xl border border-slate-800 bg-slate-900/80 text-slate-300 hover:text-white flex items-center justify-center text-sm font-bold"
          >
            ✕
          </button>
        </div>

        {localError ? (
          <div
            role="alert"
            className="rounded-xl border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-xs text-rose-200"
          >
            {localError}
          </div>
        ) : null}

        {/* Post-Creation Onboarding Card (Reveal Secret + 1-tap Testnet Faucet) */}
        {justCreated ? (
          <div className="space-y-3">
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-emerald-300">
                  Public Address (Receive XLM & Tokens)
                </span>
                <button
                  type="button"
                  onClick={() => void copyText(justCreated.publicKey, 'Address')}
                  className="text-sky-300 hover:text-sky-200 font-semibold"
                >
                  📋 Copy
                </button>
              </div>
              <p className="font-mono text-[11px] break-all text-slate-200">
                {justCreated.publicKey}
              </p>
            </div>

            <div className="rounded-2xl border border-amber-500/40 bg-amber-950/20 p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-bold text-amber-300">
                  Secret Recovery Key (S...)
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowCreatedSecret((v) => !v)}
                    className="rounded-lg border border-amber-500/40 px-2 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/15"
                  >
                    {showCreatedSecret ? '🙈 Hide' : '👁 Reveal'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void copyText(justCreated.secret, 'Secret Key')}
                    className="rounded-lg border border-amber-500/40 px-2 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/15"
                  >
                    📋 Copy
                  </button>
                </div>
              </div>
              <p
                style={{ userSelect: showCreatedSecret ? 'text' : 'none' }}
                className="font-mono text-xs break-all rounded-xl bg-slate-950/80 border border-slate-800 p-2.5 text-amber-100"
              >
                {showCreatedSecret
                  ? justCreated.secret
                  : 'S•••••••••••••••••••••••••••••••••••••••••••••••••••••••'}
              </p>
              <p className="text-[11px] text-amber-200/80 leading-relaxed">
                Save this secret key offline or import it into Freighter/LOBSTR anytime. You can also reveal it later with your PIN.
              </p>
            </div>

            {NETWORK_NAME !== 'mainnet' ? (
              <button
                type="button"
                disabled={funding}
                onClick={() => void handleFund(justCreated.publicKey)}
                className="w-full min-h-[44px] rounded-2xl border border-amber-400/50 bg-amber-500/20 px-4 py-2.5 text-sm font-bold text-amber-200 hover:bg-amber-500/30 disabled:opacity-50 transition"
              >
                {funding
                  ? 'Funding from Friendbot…'
                  : '🚰 Fund +10,000 Testnet XLM (Free)'}
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => {
                if (justCreated.accountId) {
                  confirmHotBackup(justCreated.accountId)
                }
                setJustCreated(null)
                closeWalletModal()
              }}
              className="w-full min-h-[46px] rounded-2xl bg-emerald-500 px-4 py-2.5 text-sm font-black text-slate-950 hover:bg-emerald-400 transition"
            >
              ✓ I Saved My Key — Start Trading
            </button>
          </div>
        ) : walletModalView === 'unlock' && activeAccount ? (
          /* Unlock Sheet */
          <form onSubmit={onUnlockSubmit} className="space-y-3">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-3 flex items-center justify-between gap-2 text-xs">
              <div>
                <p className="font-bold text-white">{activeAccount.label}</p>
                <p className="font-mono text-slate-400">
                  {shortAddress(activeAccount.publicKey)}
                </p>
              </div>
              {xlmBalance.data !== undefined ? (
                <span className="font-mono font-bold text-emerald-300">
                  {xlmBalance.data.toLocaleString('en-US', {
                    maximumFractionDigits: 2,
                  })}{' '}
                  XLM
                </span>
              ) : null}
            </div>

            <label className="block space-y-1 text-xs">
              <span className="font-medium text-slate-300">
                Enter your Wallet PIN to sign
              </span>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                autoFocus
                required
                minLength={MIN_VAULT_PIN_LENGTH}
                value={unlockPin}
                onChange={(e) => setUnlockPin(e.target.value)}
                placeholder="4+ digit PIN"
                className="w-full min-h-[46px] rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-base font-mono text-white outline-none focus:border-sky-400"
              />
            </label>

            <button
              type="submit"
              disabled={busy}
              className="w-full min-h-[46px] rounded-2xl bg-sky-500 px-4 py-2.5 text-sm font-black text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition"
            >
              {busy ? 'Decrypting Key…' : '🔓 Unlock & Sign'}
            </button>

            <div className="flex items-center justify-between pt-1 text-[11px] text-slate-400">
              <button
                type="button"
                onClick={() => openWalletModal('connect')}
                className="hover:text-white underline"
              >
                Use another wallet
              </button>
              <button
                type="button"
                onClick={() => {
                  wipeHotWallet()
                  toast.success('Vault cleared from device')
                }}
                className="text-rose-400 hover:text-rose-300"
              >
                Reset local vault
              </button>
            </div>
          </form>
        ) : walletModalView === 'manage' && mode === 'hot' && activeAccount ? (
          /* Sovereign Self-Custody Management Dashboard */
          <div className="space-y-4">
            <div className="rounded-2xl border border-sky-500/30 bg-sky-950/20 p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-white">
                    {activeAccount.label}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      activeAccount.backedUp
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {activeAccount.backedUp ? '✓ Key Saved' : '⚠ Backup Key'}
                  </span>
                </div>
                <span className="font-mono text-xs font-bold text-emerald-300">
                  {xlmBalance.data !== undefined
                    ? `${xlmBalance.data.toLocaleString('en-US', { maximumFractionDigits: 2 })} XLM`
                    : '… XLM'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <code className="text-[11px] font-mono text-slate-300 truncate">
                  {activeAccount.publicKey}
                </code>
                <button
                  type="button"
                  onClick={() =>
                    void copyText(activeAccount.publicKey, 'Public address')
                  }
                  className="shrink-0 rounded-lg border border-slate-700 px-2 py-1 text-[11px] text-sky-300 hover:bg-slate-800"
                >
                  📋 Copy
                </button>
              </div>
              {NETWORK_NAME !== 'mainnet' ? (
                <button
                  type="button"
                  disabled={funding}
                  onClick={() => void handleFund(activeAccount.publicKey)}
                  className="w-full min-h-[38px] rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-bold text-amber-200 hover:bg-amber-500/25 disabled:opacity-50"
                >
                  {funding ? 'Funding…' : '🚰 Fund +10,000 Testnet XLM'}
                </button>
              ) : null}
            </div>

            {/* Multi-Wallet Switcher inside Vault */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-300">
                  Your Vault Wallets ({hotAccounts.length}/{MAX_HOT_WALLETS})
                </span>
                <button
                  type="button"
                  onClick={() => openWalletModal('connect')}
                  className="text-sky-300 hover:text-sky-200 font-semibold"
                >
                  + Add / Import
                </button>
              </div>
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {hotAccounts.map((acc) => {
                  const isCurrent = acc.id === activeAccount.id
                  return (
                    <div
                      key={acc.id}
                      className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
                        isCurrent
                          ? 'border-sky-500/50 bg-sky-500/10'
                          : 'border-slate-800 bg-slate-900/40'
                      }`}
                    >
                      {renamingId === acc.id ? (
                        <form
                          className="flex flex-1 items-center gap-1.5"
                          onSubmit={(e) => {
                            e.preventDefault()
                            renameHotAccount(acc.id, renameValue)
                            setRenamingId(null)
                          }}
                        >
                          <input
                            type="text"
                            maxLength={24}
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-white outline-none"
                          />
                          <button
                            type="submit"
                            className="rounded-lg bg-sky-500 px-2 py-1 text-[11px] font-bold text-slate-950"
                          >
                            Save
                          </button>
                        </form>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => selectHotAccount(acc.id)}
                            className="flex-1 text-left"
                          >
                            <span className="font-bold text-white">
                              {acc.label}
                            </span>{' '}
                            <span className="font-mono text-slate-400">
                              {shortAddress(acc.publicKey)}
                            </span>
                          </button>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setRenamingId(acc.id)
                                setRenameValue(acc.label)
                              }}
                              title="Rename wallet"
                              className="rounded px-1.5 py-1 text-slate-400 hover:text-white"
                            >
                              ✏️
                            </button>
                            {hotAccounts.length > 1 ? (
                              <button
                                type="button"
                                onClick={() => void onRemoveAccount(acc.id)}
                                title="Remove wallet (requires PIN below)"
                                className="rounded px-1.5 py-1 text-rose-400 hover:text-rose-300"
                              >
                                🗑
                              </button>
                            ) : null}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Export / Reveal Secret Key (Total User Sovereignty) */}
            <form
              onSubmit={onRevealSecret}
              className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3 space-y-2"
            >
              <p className="text-xs font-semibold text-amber-300">
                🔑 Export Private Key (`S...`)
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  inputMode="numeric"
                  required
                  minLength={MIN_VAULT_PIN_LENGTH}
                  value={exportPin}
                  onChange={(e) => setExportPin(e.target.value)}
                  placeholder="Enter Vault PIN"
                  className="flex-1 min-h-[40px] rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-mono text-white outline-none focus:border-amber-400"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[40px] rounded-xl bg-amber-500/20 border border-amber-500/40 px-3 text-xs font-bold text-amber-200 hover:bg-amber-500/30"
                >
                  Reveal
                </button>
              </div>
              {revealedSecret ? (
                <div className="rounded-xl border border-amber-500/40 bg-slate-950 p-2.5 space-y-1.5">
                  <p className="font-mono text-[11px] break-all text-amber-100">
                    {revealedSecret}
                  </p>
                  <button
                    type="button"
                    onClick={() => void copyText(revealedSecret, 'Secret key')}
                    className="text-[11px] font-semibold text-sky-300 hover:text-sky-200"
                  >
                    📋 Copy Secret Key
                  </button>
                </div>
              ) : null}
            </form>

            {/* Quick Lock & Switch Controls */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  if (hotUnlocked) {
                    lockHotWallet()
                    toast.success('Wallet locked (signing disabled in RAM)')
                    closeWalletModal()
                  } else {
                    openWalletModal('unlock')
                  }
                }}
                className="min-h-[42px] rounded-xl border border-slate-700 bg-slate-900 px-3 text-xs font-bold text-slate-200 hover:bg-slate-800"
              >
                {hotUnlocked ? '🔒 Lock Signing' : '🔓 Unlock Signing'}
              </button>
              {!confirmWipe ? (
                <button
                  type="button"
                  onClick={() => setConfirmWipe(true)}
                  className="min-h-[42px] rounded-xl border border-rose-500/30 bg-rose-950/20 px-3 text-xs font-bold text-rose-300 hover:bg-rose-950/40"
                >
                  Erase Device Vault
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    wipeHotWallet()
                    toast.success('Local vault erased')
                  }}
                  className="min-h-[42px] rounded-xl bg-rose-600 px-3 text-xs font-black text-white hover:bg-rose-500"
                >
                  Confirm Wipe
                </button>
              )}
            </div>
          </div>
        ) : (
          /* Connect / Create / Import / External Flow */
          <div className="space-y-4">
            <div
              role="tablist"
              aria-label="Wallet setup options"
              className="grid grid-cols-3 gap-1 rounded-2xl bg-slate-900/90 p-1 border border-slate-800"
            >
              {(
                [
                  ['create', '⚡ Create'],
                  ['import', '📥 Import'],
                  ['external', '🔌 External'],
                ] as const
              ).map(([key, title]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => {
                    setTab(key)
                    setLocalError(null)
                  }}
                  className={`min-h-[40px] rounded-xl text-xs font-bold transition ${
                    tab === key
                      ? 'bg-sky-500 text-slate-950 shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {title}
                </button>
              ))}
            </div>

            {tab === 'create' ? (
              <form onSubmit={onCreateSubmit} className="space-y-3">
                <p className="text-xs text-slate-300 leading-relaxed">
                  {hasExistingVault
                    ? 'Add another wallet inside your AstroGate Vault using your existing PIN.'
                    : 'Generate a real self-custodial Stellar wallet directly on your phone. Works seamlessly inside Telegram Mini App & browsers.'}
                </p>

                <label className="block space-y-1 text-xs">
                  <span className="font-medium text-slate-300">
                    Wallet Name (optional)
                  </span>
                  <input
                    type="text"
                    maxLength={24}
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder={`Wallet ${hotAccounts.length + 1}`}
                    className="w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-950 px-3.5 text-sm text-white outline-none focus:border-sky-400"
                  />
                </label>

                <label className="block space-y-1 text-xs">
                  <span className="font-medium text-slate-300">
                    {hasExistingVault
                      ? 'Enter Existing Vault PIN'
                      : 'Choose Encryption PIN (4+ digits)'}
                  </span>
                  <input
                    type="password"
                    inputMode="numeric"
                    required
                    minLength={MIN_VAULT_PIN_LENGTH}
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    placeholder="e.g. 482910"
                    className="w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-950 px-3.5 text-base font-mono text-white outline-none focus:border-sky-400"
                  />
                </label>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full min-h-[46px] rounded-2xl bg-gradient-to-r from-sky-400 to-emerald-400 px-4 py-2.5 text-sm font-black text-slate-950 hover:opacity-95 disabled:opacity-50 transition"
                >
                  {busy
                    ? 'Encrypting Locally…'
                    : hasExistingVault
                      ? '+ Create New Account in Vault'
                      : '⚡ Create Instant Stellar Wallet'}
                </button>
              </form>
            ) : tab === 'import' ? (
              <form onSubmit={onImportSubmit} className="space-y-3">
                <p className="text-xs text-slate-300">
                  Import an existing Stellar Secret Key (`S...`) from LOBSTR, Freighter, or backup. Encrypted on-device with your PIN.
                </p>

                <label className="block space-y-1 text-xs">
                  <span className="font-medium text-slate-300">
                    Stellar Secret Seed (`S...`)
                  </span>
                  <input
                    type="password"
                    required
                    value={secretInput}
                    onChange={(e) => setSecretInput(e.target.value)}
                    placeholder="S..."
                    className="w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-950 px-3.5 text-xs font-mono text-white outline-none focus:border-sky-400"
                  />
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <label className="block space-y-1 text-xs">
                    <span className="font-medium text-slate-300">Name</span>
                    <input
                      type="text"
                      maxLength={24}
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                      placeholder="Imported"
                      className="w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-950 px-3 text-sm text-white outline-none focus:border-sky-400"
                    />
                  </label>

                  <label className="block space-y-1 text-xs">
                    <span className="font-medium text-slate-300">
                      {hasExistingVault ? 'Vault PIN' : 'New PIN'}
                    </span>
                    <input
                      type="password"
                      inputMode="numeric"
                      required
                      minLength={MIN_VAULT_PIN_LENGTH}
                      value={pin}
                      onChange={(e) => setPin(e.target.value)}
                      placeholder="4+ digits"
                      className="w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-950 px-3 text-base font-mono text-white outline-none focus:border-sky-400"
                    />
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full min-h-[46px] rounded-2xl bg-sky-500 px-4 py-2.5 text-sm font-black text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition"
                >
                  {busy ? 'Importing & Encrypting…' : '📥 Import & Encrypt Wallet'}
                </button>
              </form>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-300 leading-relaxed">
                  Connect an external Stellar wallet app or browser extension (Freighter, xBull, LOBSTR, Albedo, or WalletConnect).
                </p>

                {hasExistingVault ? (
                  <button
                    type="button"
                    onClick={() =>
                      openWalletModal(hotUnlocked ? 'manage' : 'unlock')
                    }
                    className="w-full min-h-[44px] rounded-2xl border border-sky-500/40 bg-sky-500/10 px-4 text-xs font-bold text-sky-200 hover:bg-sky-500/20"
                  >
                    ⚡ Resume My In-App Hot Wallet ({hotAccounts.length})
                  </button>
                ) : null}

                <button
                  type="button"
                  disabled={pending}
                  onClick={() => void connect()}
                  className="w-full min-h-[46px] rounded-2xl bg-amber-500 px-4 py-2.5 text-sm font-black text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition"
                >
                  {pending
                    ? 'Waiting for Wallet…'
                    : '🔌 Open Stellar Wallets Kit'}
                </button>

                {NETWORK_NAME !== 'mainnet' ? (
                  <button
                    type="button"
                    disabled={demoPending}
                    onClick={() => void startDemo()}
                    className="w-full min-h-[44px] rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 text-xs font-bold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    {demoPending
                      ? 'Funding Demo Accounts…'
                      : '🧪 Quick Testnet Demo (3 Sandbox Accounts)'}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
