import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useWallet } from '../store/wallet'
import { useXlmBalance } from '../hooks/useXlmBalance'
import { fundTestnetAddress, MAX_DEMO_ACCOUNTS } from '../lib/demo'
import { buildAstroWalletConnectUrl } from '../lib/ecosystem'
import { errorMessage, shortAddress } from '../lib/format'
import { NETWORK_NAME } from '../lib/network'
import { openTelegramDeepLink } from '../lib/telegram'
import { toast } from '../lib/toast'

export function WalletButton() {
  const queryClient = useQueryClient()
  const [fundingWallet, setFundingWallet] = useState(false)
  const {
    publicKey,
    pending,
    mode,
    hotAccounts,
    hotActiveId,
    telegramLink,
    hotUnlocked,
    demoAccounts,
    demoActive,
    demoPending,
    selectDemo,
    addDemoAccount,
    startDemo,
    openWalletModal,
    disconnect,
  } = useWallet()
  const xlmBalance = useXlmBalance(publicKey)
  const activeHot =
    hotAccounts?.find((a) => a.id === hotActiveId) ?? hotAccounts?.[0] ?? null

  async function onStartDemo() {
    try {
      await startDemo()
      toast.success('Testnet demo wallet active', {
        message: 'Funded with 10,000 XLM from Friendbot.',
      })
    } catch (err) {
      toast.error('Failed to start Testnet demo', {
        message: errorMessage(err),
      })
    }
  }

  async function onAddDemoAccount() {
    try {
      await addDemoAccount()
      toast.success('Test account added', {
        message: 'Funded with 10,000 XLM from Friendbot.',
      })
    } catch (err) {
      toast.error('Failed to add test account', {
        message: errorMessage(err),
      })
    }
  }

  function onOpenWallet() {
    openWalletModal()
  }

  async function onDisconnect() {
    try {
      await disconnect()
    } catch (err) {
      toast.error('Failed to disconnect wallet', {
        message: errorMessage(err),
      })
    }
  }

  async function onFundConnectedWallet() {
    if (!publicKey) return
    setFundingWallet(true)
    try {
      await fundTestnetAddress(publicKey)
      toast.success('Wallet funded with 10,000 Testnet XLM')
      await queryClient.invalidateQueries({ queryKey: ['xlm-balance'] })
    } catch (err) {
      toast.error('Testnet faucet failed', {
        message: errorMessage(err),
      })
    } finally {
      setFundingWallet(false)
    }
  }

  if (publicKey) {
    return (
      <div className="flex flex-nowrap items-center gap-1 sm:gap-1.5">
        {mode === 'demo' ? (
          <div
            role="group"
            aria-label="Switch test account"
            className="flex items-center gap-0.5 rounded-xl border border-emerald-800/70 bg-emerald-950/30 p-0.5"
          >
            <span className="hidden sm:inline px-1.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-300">
              demo
            </span>
            {demoAccounts.map((acc, idx) => (
              <button
                key={acc.publicKey}
                type="button"
                onClick={() => selectDemo(idx)}
                aria-pressed={idx === demoActive}
                aria-label={`Use test account ${acc.label} (${shortAddress(acc.publicKey)})`}
                title={`Use account ${acc.label} (${shortAddress(acc.publicKey)})`}
                className={`min-h-[34px] min-w-[30px] sm:min-w-[34px] rounded-lg px-1.5 sm:px-2 text-xs font-semibold tabular-nums transition-colors ${
                  idx === demoActive
                    ? 'bg-emerald-500 text-slate-950 font-bold'
                    : 'text-emerald-200 hover:bg-emerald-500/20'
                }`}
              >
                {acc.label}
              </button>
            ))}
            {demoAccounts.length < MAX_DEMO_ACCOUNTS ? (
              <button
                type="button"
                disabled={demoPending}
                onClick={() => void onAddDemoAccount()}
                aria-label="Add another test account (+10,000 XLM)"
                title="Add another test account (+10,000 XLM)"
                className="min-h-[34px] min-w-[28px] rounded-lg px-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-40"
              >
                {demoPending ? '…' : '+'}
              </button>
            ) : null}
          </div>
        ) : NETWORK_NAME !== 'mainnet' ? (
          <span
            title="Connected to Stellar Testnet"
            className="hidden sm:inline-flex items-center rounded-md border border-sky-500/30 bg-sky-950/40 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-sky-300"
          >
            testnet
          </span>
        ) : null}
        {mode === 'hot' ? (
          <button
            type="button"
            onClick={() => openWalletModal(hotUnlocked ? 'manage' : 'unlock')}
            className={`min-h-[36px] inline-flex items-center gap-1 rounded-xl border px-2 sm:px-2.5 py-1 text-xs font-semibold transition ${
              hotUnlocked
                ? 'border-sky-500/40 bg-sky-500/15 text-sky-100 hover:bg-sky-500/25'
                : 'border-amber-500/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
            }`}
            title={
              hotUnlocked
                ? 'Manage Hot Wallet Vault, Backup Key & Accounts'
                : 'Wallet locked — tap to enter PIN'
            }
          >
            <span>{hotUnlocked ? '⚡' : '🔒'}</span>
            <span className="hidden sm:inline max-w-[96px] truncate">
              {telegramLink?.username
                ? `@${telegramLink.username}`
                : activeHot?.label ?? 'Vault'}
            </span>
            {xlmBalance.data !== undefined ? (
              <span className="font-mono tabular-nums text-emerald-300 whitespace-nowrap">
                {xlmBalance.data.toLocaleString('en-US', {
                  maximumFractionDigits: 1,
                })}{' '}
                XLM
              </span>
            ) : null}
            <code className="hidden md:inline text-slate-300">
              {shortAddress(publicKey)}
            </code>
          </button>
        ) : (
          <span className="hidden items-center gap-1.5 rounded-lg bg-slate-800/80 px-2.5 py-1 text-xs font-mono tabular-nums sm:inline-flex">
            {xlmBalance.data !== undefined ? (
              <span className="text-emerald-300 font-semibold">
                {xlmBalance.data.toLocaleString('en-US', {
                  maximumFractionDigits: 1,
                })}{' '}
                XLM
              </span>
            ) : null}
            {xlmBalance.data !== undefined ? (
              <span className="text-slate-600">·</span>
            ) : null}
            <code className="text-slate-200">{shortAddress(publicKey)}</code>
          </span>
        )}
        {NETWORK_NAME !== 'mainnet' &&
        mode !== 'demo' &&
        xlmBalance.data !== undefined &&
        xlmBalance.data < 5 ? (
          <button
            type="button"
            disabled={fundingWallet}
            onClick={() => void onFundConnectedWallet()}
            title="Request 10,000 free Testnet XLM from Stellar Friendbot"
            className="min-h-[36px] whitespace-nowrap rounded-xl border border-amber-500/40 bg-amber-500/15 px-2 py-1 text-xs font-bold text-amber-200 hover:bg-amber-500/25 disabled:opacity-50"
          >
            {fundingWallet ? '…' : '🚰 +10K'}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void onDisconnect()}
          aria-label="Disconnect wallet"
          title="Disconnect wallet"
          className="min-h-[36px] whitespace-nowrap rounded-xl border border-slate-700 px-2.5 py-1 text-xs hover:bg-slate-800 sm:px-3"
        >
          <span className="sm:hidden">✕</span>
          <span className="hidden sm:inline">Disconnect</span>
        </button>
      </div>
    )
  }

  const hasSavedVault = (hotAccounts?.length ?? 0) > 0
  const hasSavedDemo = (demoAccounts?.length ?? 0) > 0
  const astroWalletSsoUrl = buildAstroWalletConnectUrl()

  return (
    <div className="flex flex-nowrap items-center gap-1.5">
      {NETWORK_NAME !== 'mainnet' ? (
        <button
          type="button"
          disabled={demoPending || pending}
          onClick={() => void onStartDemo()}
          title={
            hasSavedDemo
              ? `Resume saved Testnet demo account(s) (${demoAccounts.length})`
              : 'Create a disposable Friendbot-funded Testnet wallet with 10,000 XLM'
          }
          className="min-h-[36px] sm:min-h-[40px] whitespace-nowrap rounded-xl border border-sky-500/40 bg-sky-500/10 px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm font-medium text-sky-200 hover:bg-sky-500/20 disabled:opacity-60"
        >
          {demoPending ? 'Funding…' : hasSavedDemo ? 'Resume Demo' : 'Demo'}
        </button>
      ) : null}
      {astroWalletSsoUrl ? (
        <a
          href={astroWalletSsoUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => {
            e.preventDefault()
            openTelegramDeepLink(astroWalletSsoUrl)
          }}
          title="Connect or sign via AstroWallet AstroID SSO"
          className="hidden sm:inline-flex min-h-[36px] sm:min-h-[40px] items-center whitespace-nowrap rounded-xl border border-violet-400/45 bg-violet-500/15 px-3 py-1.5 text-xs sm:text-sm font-semibold text-violet-200 hover:bg-violet-500/25"
        >
          AstroWallet SSO
        </a>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={onOpenWallet}
        className={`min-h-[36px] sm:min-h-[40px] whitespace-nowrap rounded-xl px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-bold disabled:opacity-60 ${
          hasSavedVault
            ? 'bg-amber-400 text-slate-950 hover:bg-amber-300'
            : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
        }`}
      >
        {pending
          ? 'Connecting…'
          : hasSavedVault
            ? '🔓 Unlock Vault'
            : '⚡ Wallet'}
      </button>
    </div>
  )
}
