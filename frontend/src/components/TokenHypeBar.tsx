import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTokenShouts } from '../hooks/useTokenShouts'
import { useKingShout } from '../hooks/useKingShout'
import { useTokenBalance } from '../hooks/useTokenBalance'
import { useXlmBalance } from '../hooks/useXlmBalance'
import { validateXlmReserve } from '../lib/xlm'
import {
  clampDecimals,
  errorMessage,
  formatAmount,
  parseAmount,
  shortAddress,
} from '../lib/format'
import { burnAndShout } from '../lib/token'
import { HYPE_SHOUT_BURN, KING_SHOUT_BURN, MIN_SHOUT_BURN } from '../lib/tokenomics'
import { toast } from '../lib/toast'
import { useWallet } from '../store/wallet'
import { recordActivity } from '../store/activity'
import { UNSUPPORTED_SIGNER_MESSAGE } from '../lib/constants'
import {
  getTelegramWebApp,
  notifyTelegramPulse,
  TELEGRAM_COMMUNITY_URL,
  triggerTelegramHaptic,
} from '../lib/telegram'
import { DEFAULT_XLM_USD_PRICE } from '../lib/xlm'

const BURN_PRESETS = [
  { amount: String(MIN_SHOUT_BURN), tier: '💬 Chat' },
  { amount: String(HYPE_SHOUT_BURN), tier: '🔥 Hype' },
  { amount: String(KING_SHOUT_BURN), tier: '👑 King' },
] as const

/**
 * Pure on-chain Burn-to-Chat thread backed by Launchpad `burn_shout` + `get_shouts`.
 * Every message permanently burns holder tokens and is verifiable on Stellar Soroban.
 */
export function TokenHypeBar({
  tokenId,
  symbol,
  decimals = 7,
  spotPriceXlm = 0,
  xlmUsd = DEFAULT_XLM_USD_PRICE,
  onBuyClick,
}: {
  tokenId: string
  symbol: string
  pairId?: string | null
  decimals?: number
  spotPriceXlm?: number
  xlmUsd?: number
  onBuyClick?: () => void
}) {
  const { publicKey, requireSignerOrPrompt, openWalletModal } = useWallet()
  const queryClient = useQueryClient()
  const shouts = useTokenShouts(tokenId)
  const kingShout = useKingShout(tokenId)
  const balance = useTokenBalance(publicKey, tokenId)
  const xlmBalance = useXlmBalance(publicKey)

  const [message, setMessage] = useState('')
  const [burnAmountInput, setBurnAmountInput] = useState(String(MIN_SHOUT_BURN))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmHighBurnKey, setConfirmHighBurnKey] = useState<string | null>(null)

  const safeDecimals = clampDecimals(decimals)
  const burnAmountBase = parseAmount(burnAmountInput, safeDecimals)
  const burnWholeTokens = Number(burnAmountBase) / 10 ** safeDecimals
  const isHighBurn = burnWholeTokens >= 500
  const currentConfirmKey = `${burnAmountInput}:${message.trim()}`
  const confirmingHighBurn = isHighBurn && confirmHighBurnKey === currentConfirmKey
  const minShoutBase = BigInt(MIN_SHOUT_BURN) * 10n ** BigInt(safeDecimals)
  const utf8Bytes = new TextEncoder().encode(message.trim()).length

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!publicKey) {
      openWalletModal('connect')
      return
    }
    const signer = requireSignerOrPrompt()
    if (!signer) {
      if (useWallet.getState().mode !== 'hot') {
        setError(UNSUPPORTED_SIGNER_MESSAGE)
      }
      return
    }

    const cleanMsg = message.trim()
    if (!cleanMsg) {
      setError('Enter a short message to publish on-chain.')
      return
    }
    if (utf8Bytes > 160) {
      setError('Message exceeds 160 bytes UTF-8.')
      return
    }
    if (burnAmountBase < minShoutBase) {
      setError(`Minimum Burn-to-Chat amount is ${MIN_SHOUT_BURN} $${symbol}.`)
      return
    }
    if (balance.data !== undefined && burnAmountBase > balance.data) {
      setError(`Insufficient $${symbol} balance to burn.`)
      return
    }
    const xlmReserveError = validateXlmReserve(xlmBalance.data, 0n, publicKey)
    if (xlmReserveError) {
      setError(xlmReserveError)
      return
    }
    if (isHighBurn && confirmHighBurnKey !== currentConfirmKey) {
      setConfirmHighBurnKey(currentConfirmKey)
      return
    }

    setConfirmHighBurnKey(null)
    setBusy(true)
    try {
      const { hash } = await burnAndShout({
        tokenId,
        amount: burnAmountBase,
        message: cleanMsg,
        signer,
      })

      setMessage('')
      recordActivity({
        kind: 'burn',
        tokenId,
        tokenSymbol: symbol,
        amount: formatAmount(burnAmountBase, decimals),
        detail: `Burn-to-Chat: ${cleanMsg}`,
        account: publicKey,
        hash,
      })
      toast.success('On-chain shout published', {
        message: `Burned ${formatAmount(burnAmountBase, decimals)} $${symbol}`,
        hash,
      })
      triggerTelegramHaptic('success')
      if (hash) void notifyTelegramPulse(hash)

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['token-shouts', tokenId] }),
        queryClient.invalidateQueries({ queryKey: ['king-shout', tokenId] }),
        queryClient.invalidateQueries({ queryKey: ['token-events', tokenId] }),
        queryClient.invalidateQueries({ queryKey: ['token-balance', tokenId] }),
        queryClient.invalidateQueries({ queryKey: ['token-info', tokenId] }),
        queryClient.invalidateQueries({ queryKey: ['xlm-balance'] }),
      ])
    } catch (err) {
      const msg = errorMessage(err)
      setError(msg)
      triggerTelegramHaptic('error')
      toast.error('Failed to publish shout', { message: msg })
    } finally {
      setBusy(false)
    }
  }

  const list = shouts.data ?? []
  const burnCostXlm = spotPriceXlm > 0 ? burnWholeTokens * spotPriceXlm : 0
  const burnCostUsd = burnCostXlm * xlmUsd
  const missingBalance =
    Boolean(publicKey) &&
    balance.data !== undefined &&
    burnAmountBase > balance.data

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 shadow-sm space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
        <div>
          <p className="text-sm font-semibold text-white">🔥 3-Tier Burn-to-Chat &amp; 👑 King Shout</p>
          <p className="text-xs text-slate-400">
            Burns shrink supply via <code className="text-amber-300">token.burn()</code>. ≥ {KING_SHOUT_BURN.toLocaleString('en-US')} ${symbol} takes King (24h half-life).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={TELEGRAM_COMMUNITY_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              const tg = getTelegramWebApp()
              if (tg?.openTelegramLink) {
                e.preventDefault()
                tg.openTelegramLink(TELEGRAM_COMMUNITY_URL)
              }
            }}
            className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-0.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 transition"
          >
            💬 Telegram Chat
          </a>
          <span className="rounded-full border border-slate-800 bg-slate-950 px-2.5 py-0.5 font-mono text-xs text-slate-400">
            {list.length} {list.length === 1 ? 'shout' : 'shouts'}
          </span>
        </div>
      </div>

      {kingShout.data ? (
        <div className="rounded-xl border border-amber-400/50 bg-gradient-to-r from-amber-500/15 via-amber-950/30 to-slate-950 px-3 py-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-amber-300">
              👑 KING SHOUT · {shortAddress(kingShout.data.sender)}
            </span>
            <span className="font-mono font-bold text-amber-200">
              🔥 {formatAmount(kingShout.data.amount, decimals)} ${symbol} burned
            </span>
          </div>
          <p className="mt-1 font-medium text-amber-50 break-words">
            {kingShout.data.message}
          </p>
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-slate-400">Burn:</span>
            {BURN_PRESETS.map((preset) => {
              const presetXlm = spotPriceXlm > 0 ? Number(preset.amount) * spotPriceXlm : 0
              return (
                <button
                  key={preset.amount}
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setBurnAmountInput(preset.amount)
                    setConfirmHighBurnKey(null)
                  }}
                  className={`min-h-[34px] rounded-lg border px-2.5 py-1.5 font-mono text-xs transition ${
                    burnAmountInput === preset.amount
                      ? 'border-amber-500/60 bg-amber-500/15 text-amber-300 font-bold'
                      : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {preset.tier} · {preset.amount}
                  {presetXlm > 0 ? ` (~${presetXlm.toFixed(2)} XLM)` : ''}
                </button>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-slate-400">
            {burnCostXlm > 0 ? (
              <span className="text-amber-300/90">
                ≈ {burnCostXlm.toFixed(2)} XLM (${burnCostUsd.toFixed(2)})
              </span>
            ) : null}
            {balance.data !== undefined ? (
              <span>
                Bal: {formatAmount(balance.data, decimals)} ${symbol}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={160}
            disabled={busy}
            placeholder={
              publicKey
                ? `Burn ${burnAmountInput || String(MIN_SHOUT_BURN)} $${symbol} to post permanently…`
                : `Connect wallet to burn ≥ ${MIN_SHOUT_BURN} $${symbol} & shout…`
            }
            className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-base sm:text-sm text-slate-100 outline-none focus:border-amber-500"
          />
          {missingBalance && onBuyClick ? (
            <button
              type="button"
              onClick={onBuyClick}
              className="min-h-[40px] shrink-0 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black text-slate-950 hover:bg-emerald-400 transition"
            >
              Buy ${symbol} to Shout →
            </button>
          ) : confirmingHighBurn ? (
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="submit"
                disabled={busy}
                className="min-h-[40px] rounded-xl bg-rose-500 px-3.5 py-2 text-xs font-black text-white hover:bg-rose-400 transition disabled:opacity-50"
              >
                {busy
                  ? 'Burning…'
                  : `Confirm Burn ${burnAmountInput} $${symbol}`}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmHighBurnKey(null)}
                className="min-h-[40px] rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300 hover:text-white transition"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="submit"
              disabled={busy || (Boolean(publicKey) && !message.trim())}
              className="min-h-[40px] shrink-0 rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-slate-950 hover:bg-amber-400 transition disabled:opacity-50"
            >
              {busy
                ? 'Burning…'
                : publicKey
                  ? `🔥 Burn & Shout`
                  : '🔌 Connect to Shout'}
            </button>
          )}
        </div>

        {error ? (
          <p role="alert" className="text-xs text-rose-300">
            {error}
          </p>
        ) : null}
      </form>

      {shouts.isPending ? (
        <p className="py-4 text-center text-xs text-slate-500">
          Loading on-chain shouts…
        </p>
      ) : list.length === 0 ? (
        <p className="py-4 text-center text-xs text-slate-500">
          No on-chain shouts yet. Burn ${symbol} to post the first permanent message.
        </p>
      ) : (
        <ul className="divide-y divide-slate-800/60 max-h-72 overflow-y-auto">
          {list.map((shout, idx) => (
            <li
              key={`${shout.sender}-${shout.ledger}-${idx}`}
              className="py-2.5 space-y-1 text-xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-mono">
                  <span className="font-semibold text-slate-200">
                    {shortAddress(shout.sender)}
                  </span>
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                    🔥 -{formatAmount(shout.amount, decimals)} ${symbol}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-slate-500">
                  #{shout.ledger}
                </span>
              </div>
              <p className="text-slate-200 break-words leading-relaxed">
                {shout.message}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
