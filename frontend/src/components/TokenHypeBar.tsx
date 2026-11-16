import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTokenShouts } from '../hooks/useTokenShouts'
import { useKingShout } from '../hooks/useKingShout'
import { useTokenBalance } from '../hooks/useTokenBalance'
import { useXlmBalance } from '../hooks/useXlmBalance'
import { validateXlmReserve } from '../lib/xlm'
import { errorMessage, formatAmount, parseAmount, shortAddress } from '../lib/format'
import { burnAndShout } from '../lib/token'
import { HYPE_SHOUT_BURN, KING_SHOUT_BURN, MIN_SHOUT_BURN } from '../lib/tokenomics'
import { toast } from '../lib/toast'
import { useWallet } from '../store/wallet'
import { recordActivity } from '../store/activity'
import { UNSUPPORTED_SIGNER_MESSAGE } from '../lib/constants'

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
}: {
  tokenId: string
  symbol: string
  pairId?: string | null
  decimals?: number
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

  const burnAmountBase = parseAmount(burnAmountInput, decimals)
  const minShoutBase = BigInt(MIN_SHOUT_BURN) * 10n ** BigInt(Math.max(0, Math.trunc(decimals)))
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
    const xlmReserveError = validateXlmReserve(xlmBalance.data)
    if (xlmReserveError) {
      setError(xlmReserveError)
      return
    }

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
      toast.error('Failed to publish shout', { message: msg })
    } finally {
      setBusy(false)
    }
  }

  const list = shouts.data ?? []

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 shadow-sm space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800/80">
        <div>
          <p className="text-xs font-semibold text-white">🔥 3-Tier Burn-to-Chat &amp; 👑 King Shout</p>
          <p className="text-[11px] text-slate-400">
            Burns shrink circulating supply via <code className="text-amber-300">token.burn()</code>. ≥ {KING_SHOUT_BURN.toLocaleString('en-US')} ${symbol} takes the pinned King Throne.
          </p>
        </div>
        <span className="rounded-full border border-slate-800 bg-slate-950 px-2.5 py-0.5 font-mono text-[10px] text-slate-400">
          {list.length} {list.length === 1 ? 'shout' : 'shouts'}
        </span>
      </div>

      {kingShout.data ? (
        <div className="rounded-xl border border-amber-400/50 bg-gradient-to-r from-amber-500/15 via-amber-950/30 to-slate-950 px-3 py-2.5 text-xs">
          <div className="flex items-center justify-between gap-2 text-[11px]">
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
            {BURN_PRESETS.map((preset) => (
              <button
                key={preset.amount}
                type="button"
                disabled={busy}
                onClick={() => setBurnAmountInput(preset.amount)}
                className={`rounded-md border px-2 py-0.5 font-mono text-[11px] transition ${
                  burnAmountInput === preset.amount
                    ? 'border-amber-500/60 bg-amber-500/15 text-amber-300 font-bold'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
                }`}
              >
                {preset.tier} · {preset.amount}
              </button>
            ))}
          </div>
          {balance.data !== undefined ? (
            <span className="font-mono text-[11px] text-slate-400">
              Bal: {formatAmount(balance.data, decimals)} ${symbol}
            </span>
          ) : null}
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
            className="min-w-0 flex-1 rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500"
          />
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
