import { useCallback, useEffect, useId, useRef, useState } from 'react'
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

type ConnectTab = 'create' | 'import'

/**
 * Mobile-first bottom-sheet / centered dialog for AstroGate's native
 * self-custodial Stellar Wallet (Telegram + Web), linked to `@username`.
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
    hotAccounts,
    hotActiveId,
    hotPrimaryId,
    telegramLink,
    hotUnlocked,
    telegramCloudSynced,
    walletModalView,
    demoPending,
    closeWalletModal,
    openWalletModal,
    startDemo,
    createHotWallet,
    importHotWallet,
    unlockHotWallet,
    lockHotWallet,
    selectHotAccount,
    setPrimaryHotAccount,
    linkUsernameToWallet,
    exportVaultBundle,
    importVaultBundle,
    renameHotAccount,
    confirmHotBackup,
    revealHotSecret,
    removeHotAccount,
    wipeHotWallet,
  } = useWallet()

  const activeAccount =
    hotAccounts.find((a) => a.id === hotActiveId) ?? hotAccounts[0] ?? null
  const primaryAccountId = hotPrimaryId ?? activeAccount?.id ?? null
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
  const [exportedBundle, setExportedBundle] = useState<string | null>(null)
  const [exportPin, setExportPin] = useState('')
  const [unlockPin, setUnlockPin] = useState('')
  const [usernameInput, setUsernameInput] = useState(
    () => telegramLink?.username ?? tgUser.username ?? '',
  )
  const [editingLink, setEditingLink] = useState(false)
  const [linkingUsername, setLinkingUsername] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmWipe, setConfirmWipe] = useState(false)
  const [confirmResetUnlock, setConfirmResetUnlock] = useState(false)
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [funding, setFunding] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const hasExistingVault = hotAccounts.length > 0
  const isBundleImport = secretInput.trim().startsWith('AGVAULT1:')

  const handleClose = useCallback(() => {
    setJustCreated(null)
    setShowCreatedSecret(false)
    setRevealedSecret(null)
    setExportedBundle(null)
    setExportPin('')
    setUnlockPin('')
    setPin('')
    setSecretInput('')
    setEditingLink(false)
    setConfirmWipe(false)
    setConfirmResetUnlock(false)
    setPendingRemoveId(null)
    closeWalletModal()
  }, [closeWalletModal])

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const container = dialogRef.current
    if (container && !container.contains(previousFocus)) {
      const firstFocusable = container.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      firstFocusable?.focus()
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleClose()
        return
      }
      if (e.key !== 'Tab' || !dialogRef.current) return
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      previousFocus?.focus?.()
    }
  }, [handleClose])

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
      const cleanInput = secretInput.trim()
      if (cleanInput.startsWith('AGVAULT1:')) {
        const importedCount = await importVaultBundle({ bundle: cleanInput, pin })
        triggerTelegramHaptic('success')
        toast.success(
          importedCount > 0
            ? `Synced ${importedCount} encrypted wallet(s) to this device`
            : 'Encrypted vault unlocked & synced on this device',
        )
      } else {
        await importHotWallet({
          secret: cleanInput,
          pin,
          label: label || undefined,
        })
        triggerTelegramHaptic('success')
        toast.success('Stellar wallet imported & encrypted locally')
      }
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
      setExportedBundle(null)
      setExportPin('')
      triggerTelegramHaptic('medium')
    } catch (err) {
      triggerTelegramHaptic('error')
      setLocalError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onExportBundle() {
    if (!exportPin.trim()) {
      setLocalError('Enter your Vault PIN below to export an encrypted Web/TG sync bundle.')
      return
    }
    setLocalError(null)
    setBusy(true)
    try {
      const bundle = await exportVaultBundle(exportPin)
      setExportedBundle(bundle)
      setRevealedSecret(null)
      setExportPin('')
      triggerTelegramHaptic('medium')
    } catch (err) {
      triggerTelegramHaptic('error')
      setLocalError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function onLinkUsernameSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLocalError(null)
    setLinkingUsername(true)
    try {
      const linked = await linkUsernameToWallet(usernameInput)
      setUsernameInput(linked.username)
      setEditingLink(false)
      triggerTelegramHaptic('success')
      toast.success(`@${linked.username} linked to ${shortAddress(linked.primaryPublicKey)}`)
    } catch (err) {
      triggerTelegramHaptic('error')
      setLocalError(errorMessage(err))
    } finally {
      setLinkingUsername(false)
    }
  }

  async function onSetPrimary(id: string) {
    setLocalError(null)
    try {
      await setPrimaryHotAccount(id)
      triggerTelegramHaptic('light')
      toast.success('Updated primary @username receiving wallet')
    } catch (err) {
      setLocalError(errorMessage(err))
    }
  }

  async function onRemoveAccount(id: string) {
    if (pendingRemoveId !== id) {
      setPendingRemoveId(id)
      setLocalError(null)
      return
    }
    if (!exportPin.trim()) {
      setLocalError('Enter your vault PIN in the Export / Verify PIN box below, then click Confirm.')
      return
    }
    setLocalError(null)
    setBusy(true)
    try {
      await removeHotAccount(id, exportPin)
      setExportPin('')
      setRevealedSecret(null)
      setExportedBundle(null)
      setPendingRemoveId(null)
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
      aria-labelledby={titleId}
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-slate-950/80 backdrop-blur-md p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose()
      }}
    >
      <div
        ref={dialogRef}
        className="liquid-glass w-full max-w-md rounded-t-3xl sm:rounded-3xl border border-slate-700/80 bg-slate-950/95 p-5 pb-[max(1.75rem,env(safe-area-inset-bottom))] sm:p-6 shadow-2xl max-h-[90vh] overflow-y-auto space-y-4"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 id={titleId} className="text-base sm:text-lg font-extrabold text-white tracking-tight">
              {justCreated
                ? '🔐 Wallet Ready — Save Your Key'
                : walletModalView === 'unlock'
                  ? '🔓 Unlock Native Wallet'
                  : walletModalView === 'manage'
                    ? '⚡ AstroGate Native Wallet'
                    : '⚡ AstroGate Native Wallet'}
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
            onClick={handleClose}
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
                onClick={() => {
                  setConfirmResetUnlock(false)
                  openWalletModal('connect')
                }}
                className="hover:text-white underline"
              >
                Use another wallet
              </button>
              {!confirmResetUnlock ? (
                <button
                  type="button"
                  onClick={() => setConfirmResetUnlock(true)}
                  className="text-rose-400 hover:text-rose-300"
                >
                  Reset local vault
                </button>
              ) : (
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmResetUnlock(false)
                      setUnlockPin('')
                      setRevealedSecret(null)
                      wipeHotWallet()
                      toast.success('Vault cleared from device')
                    }}
                    className="font-bold text-rose-300 underline hover:text-rose-200"
                  >
                    Confirm Reset
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmResetUnlock(false)}
                    className="text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                </span>
              )}
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

            {/* Telegram @username Identity Link Card */}
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-950/15 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div className="min-w-0">
                  <p className="font-bold text-emerald-300">
                    🪪 Telegram Identity Link
                  </p>
                  {telegramLink ? (
                    <p className="text-[11px] text-slate-200 truncate">
                      <span className="font-semibold text-white">
                        @{telegramLink.username}
                      </span>{' '}
                      →{' '}
                      <code className="font-mono text-emerald-300">
                        {shortAddress(telegramLink.primaryPublicKey)}
                      </code>
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-400">
                      Bind your @username so anyone can send XLM &amp; tokens to you directly.
                    </p>
                  )}
                </div>
                {telegramLink ? (
                  <button
                    type="button"
                    onClick={() => {
                      setUsernameInput(telegramLink.username)
                      setEditingLink((v) => !v)
                    }}
                    className="shrink-0 rounded-lg border border-emerald-500/40 px-2 py-1 text-[10px] font-bold text-emerald-200 hover:bg-emerald-500/15"
                  >
                    {editingLink
                      ? 'Close'
                      : telegramLink.verifiedTelegram
                        ? '✓ TG Verified'
                        : '✓ Signed'}
                  </button>
                ) : null}
              </div>

              {!telegramLink || editingLink ? (
                <form onSubmit={onLinkUsernameSubmit} className="flex gap-2">
                  <input
                    type="text"
                    required
                    minLength={3}
                    maxLength={33}
                    value={usernameInput}
                    onChange={(e) => setUsernameInput(e.target.value)}
                    placeholder="@username"
                    aria-label="Telegram username to link"
                    className="flex-1 min-h-[38px] rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs text-white outline-none focus:border-emerald-400"
                  />
                  <button
                    type="submit"
                    disabled={linkingUsername || !hotUnlocked}
                    title={
                      hotUnlocked
                        ? 'Sign Ed25519 link proof with your Primary wallet'
                        : 'Unlock wallet with PIN first to sign'
                    }
                    className="min-h-[38px] rounded-xl bg-emerald-500 px-3 text-xs font-black text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {linkingUsername ? 'Linking…' : 'Link @user'}
                  </button>
                </form>
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
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {hotAccounts.map((acc) => {
                  const isCurrent = acc.id === activeAccount.id
                  const isPrimary = acc.id === primaryAccountId
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
                            onClick={() => {
                              setRevealedSecret(null)
                              setExportedBundle(null)
                              setExportPin('')
                              setPendingRemoveId(null)
                              selectHotAccount(acc.id)
                            }}
                            className="flex-1 min-w-0 text-left"
                          >
                            <span className="font-bold text-white">
                              {acc.label}
                            </span>{' '}
                            <span className="font-mono text-slate-400">
                              {shortAddress(acc.publicKey)}
                            </span>
                            {isPrimary ? (
                              <span className="ml-1.5 inline-flex items-center rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold text-emerald-300">
                                ★ Primary
                              </span>
                            ) : null}
                          </button>
                          <div className="flex items-center gap-1">
                            {!isPrimary ? (
                              <button
                                type="button"
                                onClick={() => void onSetPrimary(acc.id)}
                                title="Receive @username payments in this wallet"
                                className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300 hover:border-emerald-400 hover:text-emerald-300"
                              >
                                Set Primary
                              </button>
                            ) : null}
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
                              pendingRemoveId === acc.id ? (
                                <span className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => void onRemoveAccount(acc.id)}
                                    className="rounded bg-rose-600 px-1.5 py-0.5 text-[10px] font-bold text-white hover:bg-rose-500"
                                  >
                                    Confirm
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setPendingRemoveId(null)}
                                    className="rounded px-1 py-0.5 text-[10px] text-slate-400 hover:text-white"
                                  >
                                    Cancel
                                  </button>
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  aria-label={`Remove ${acc.label}`}
                                  onClick={() => void onRemoveAccount(acc.id)}
                                  title="Remove wallet (requires PIN below)"
                                  className="rounded px-1.5 py-1 text-rose-400 hover:text-rose-300"
                                >
                                  🗑
                                </button>
                              )
                            ) : null}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Export Private Key (External Sovereignty) or Encrypted Web Sync Bundle */}
            <form
              onSubmit={onRevealSecret}
              className="rounded-2xl border border-slate-800 bg-slate-900/50 p-3 space-y-2"
            >
              <p className="text-xs font-semibold text-amber-300">
                🔑 Export Key (<code className="font-mono text-amber-200">S...</code>) or Web Sync Bundle
              </p>
              <div className="flex flex-wrap gap-2">
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="current-password"
                  required
                  minLength={MIN_VAULT_PIN_LENGTH}
                  value={exportPin}
                  onChange={(e) => setExportPin(e.target.value)}
                  placeholder="Enter Vault PIN"
                  className="flex-1 min-w-[120px] min-h-[40px] rounded-xl border border-slate-700 bg-slate-950 px-3 text-xs font-mono text-white outline-none focus:border-amber-400"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="min-h-[40px] rounded-xl bg-amber-500/20 border border-amber-500/40 px-3 text-xs font-bold text-amber-200 hover:bg-amber-500/30"
                >
                  Reveal S…
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onExportBundle()}
                  title="Export AES-GCM encrypted bundle to open all wallets on Web/Mobile"
                  className="min-h-[40px] rounded-xl bg-sky-500/20 border border-sky-500/40 px-3 text-xs font-bold text-sky-200 hover:bg-sky-500/30"
                >
                  Sync Bundle
                </button>
              </div>
              {revealedSecret ? (
                <div className="rounded-xl border border-amber-500/40 bg-slate-950 p-2.5 space-y-1.5">
                  <p className="text-[10px] text-amber-300">
                    Use this <code className="font-mono">S...</code> key to manage this account externally in Freighter or LOBSTR:
                  </p>
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
              {exportedBundle ? (
                <div className="rounded-xl border border-sky-500/40 bg-slate-950 p-2.5 space-y-1.5">
                  <p className="text-[10px] text-sky-300">
                    AES-GCM encrypted vault bundle (safe to paste in AstroGate Web with your PIN):
                  </p>
                  <p className="font-mono text-[10px] break-all text-sky-100 line-clamp-3">
                    {exportedBundle}
                  </p>
                  <button
                    type="button"
                    onClick={() => void copyText(exportedBundle, 'Encrypted sync bundle')}
                    className="text-[11px] font-semibold text-sky-300 hover:text-sky-200"
                  >
                    📋 Copy Sync Bundle
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
                    setRevealedSecret(null)
                    setExportedBundle(null)
                    setExportPin('')
                    setUnlockPin('')
                    lockHotWallet()
                    toast.success('Wallet locked (signing disabled in RAM)')
                    handleClose()
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
                    setRevealedSecret(null)
                    setExportedBundle(null)
                    setExportPin('')
                    setUnlockPin('')
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
            {hasExistingVault ? (
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-950/25 px-3.5 py-2.5 text-xs">
                <div className="min-w-0">
                  <p className="font-bold text-amber-200">
                    Saved Vault Found ({hotAccounts.length})
                  </p>
                  <p className="truncate font-mono text-[11px] text-amber-100/80">
                    {activeAccount ? `${activeAccount.label} · ${shortAddress(activeAccount.publicKey)}` : 'Unlock with your PIN'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openWalletModal('unlock')}
                  className="shrink-0 rounded-xl bg-amber-400 px-3 py-1.5 text-xs font-black text-slate-950 hover:bg-amber-300"
                >
                  🔓 Unlock
                </button>
              </div>
            ) : null}
            <div
              role="tablist"
              aria-label="Wallet setup options"
              className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-900/90 p-1 border border-slate-800"
            >
              {(
                [
                  ['create', '⚡ Create Wallet'],
                  ['import', '📥 Import Key / Vault'],
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
                    ? 'Add another Stellar wallet connected to your AstroGate profile under the same PIN.'
                    : tgUser.username
                      ? `Create your 1-tap native Stellar wallet, automatically linked to @${tgUser.username}. Export your S... key anytime.`
                      : 'Create your native self-custodial Stellar wallet. Link your @username, add sub-wallets, or export keys anytime.'}
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
                    placeholder={hasExistingVault ? `Wallet ${hotAccounts.length + 1}` : 'Main'}
                    className="w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-950 px-3.5 text-sm text-white outline-none focus:border-sky-400"
                  />
                </label>

                <label className="block space-y-1 text-xs">
                  <span className="font-medium text-slate-300">
                    {hasExistingVault
                      ? 'Enter Existing Vault PIN'
                      : 'Choose Encryption PIN (4+ digits, 6+ recommended)'}
                  </span>
                  <input
                    type="password"
                    inputMode="numeric"
                    autoComplete={hasExistingVault ? 'current-password' : 'new-password'}
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
                      ? '+ Create New Sub-Wallet'
                      : '⚡ Create Native Stellar Wallet'}
                </button>

                {NETWORK_NAME !== 'mainnet' && !hasExistingVault ? (
                  <button
                    type="button"
                    disabled={demoPending}
                    onClick={() => void startDemo()}
                    className="w-full min-h-[40px] rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    {demoPending
                      ? 'Funding Demo Accounts…'
                      : '🧪 Quick Testnet Demo (3 Sandbox Accounts)'}
                  </button>
                ) : null}
              </form>
            ) : (
              <form onSubmit={onImportSubmit} className="space-y-3">
                <p className="text-xs text-slate-300">
                  Paste an encrypted vault sync bundle (<code className="font-mono text-sky-300">AGVAULT1:…</code>) to sync between Telegram &amp; Web, or a Stellar secret key (<code className="font-mono text-sky-300">S...</code>).
                </p>

                <label className="block space-y-1 text-xs">
                  <span className="font-medium text-slate-300">
                    Secret Seed (<code className="font-mono text-sky-300">S...</code>) or Sync Bundle (<code className="font-mono text-sky-300">AGVAULT1:…</code>)
                  </span>
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    value={secretInput}
                    onChange={(e) => setSecretInput(e.target.value)}
                    placeholder="S... or AGVAULT1:..."
                    className="w-full min-h-[44px] rounded-xl border border-slate-800 bg-slate-950 px-3.5 text-xs font-mono text-white outline-none focus:border-sky-400"
                  />
                </label>

                <div className={`grid gap-2 ${isBundleImport ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {!isBundleImport ? (
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
                  ) : null}

                  <label className="block space-y-1 text-xs">
                    <span className="font-medium text-slate-300">
                      {isBundleImport
                        ? 'Bundle Vault PIN'
                        : hasExistingVault
                          ? 'Vault PIN'
                          : 'New PIN (6+ rec.)'}
                    </span>
                    <input
                      type="password"
                      inputMode="numeric"
                      autoComplete={hasExistingVault ? 'current-password' : 'new-password'}
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
                  {busy
                    ? 'Decrypting & Syncing…'
                    : isBundleImport
                      ? '📥 Restore & Unlock Encrypted Vault'
                      : '📥 Import & Encrypt Wallet'}
                </button>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
