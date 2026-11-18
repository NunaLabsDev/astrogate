import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSoroswapPool } from '../hooks/useSoroswapPool'
import { useCurveState } from '../hooks/useCurveState'
import { useTokenBalance } from '../hooks/useTokenBalance'
import { useXlmBalance } from '../hooks/useXlmBalance'
import { useXlmUsdPrice } from '../hooks/useXlmUsdPrice'
import {
  errorMessage,
  formatAmount,
  parseAmount,
} from '../lib/format'
import {
  formatUsdPrice,
  localQuoteTokenForXlm,
  localQuoteXlmForToken,
  priceImpactPercent,
  SLIPPAGE_OPTIONS,
  SLIPPAGE_PERCENT,
  swapTokenForXlm,
  swapXlmForToken,
  tokenPriceInXlmNumber,
  withSlippage,
} from '../lib/soroswap'
import {
  curveVirtualReserves,
  GRADUATION_TARGET_XLM,
  graduationProgressForListing,
  localCurveQuoteBuy,
  localCurveQuoteSell,
  SOROSWAP_SWAP_FEE_PERCENT,
  whaleThresholdBase,
} from '../lib/tokenomics'
import { notifySwapAlert } from '../lib/alerts'
import { AMOUNT_PERCENTS, FORM_INPUT_CLASS, UNSUPPORTED_SIGNER_MESSAGE } from '../lib/constants'
import { explorerTxUrl } from '../lib/explorer'
import { NETWORK_NAME } from '../lib/network'
import { DEFAULT_XLM_USD_PRICE, validateXlmReserve, XLM_DECIMALS, xlmToStroops } from '../lib/xlm'
import { buyCurveToken, sellCurveToken, type LaunchpadToken } from '../lib/token'
import { useWallet } from '../store/wallet'
import { recordActivity } from '../store/activity'
import { toast } from '../lib/toast'
import { notifyTelegramPulse, triggerTelegramHaptic } from '../lib/telegram'
import { TxProgress } from './TxProgress'

const inputClass = FORM_INPUT_CLASS

type Direction = 'sell' | 'buy'

type SwapDone = {
  direction: Direction
  in: bigint
  out: bigint
  hash?: string
}

const QUICK_XLM_AMOUNTS = ['5', '10', '25', '100'] as const

function impactClass(impact: number): string {
  if (impact >= 20) return 'text-rose-300'
  if (impact >= 10) return 'text-amber-300'
  return 'text-slate-300'
}

/**
 * Buy or Sell a token against XLM using the Soroswap pair.
 */
export function SwapCard({
  token,
  onSwapped,
  onOpenLiquidityTools,
}: {
  token: LaunchpadToken
  onSwapped?: () => void
  onOpenLiquidityTools?: () => void
}) {
  const {
    publicKey,
    requireSignerOrPrompt,
    openWalletModal,
    startDemo,
    demoPending,
    pending,
  } = useWallet()
  const queryClient = useQueryClient()
  const [direction, setDirection] = useState<Direction>('buy')
  const [amount, setAmount] = useState('10')
  const [slippage, setSlippage] = useState<number>(SLIPPAGE_PERCENT)
  const [showSlippage, setShowSlippage] = useState(false)
  const [confirmHighRisk, setConfirmHighRisk] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [swapped, setSwapped] = useState<SwapDone | null>(null)

  const isBuy = direction === 'buy'
  const tokenSymbol = token.symbol ?? 'TOKEN'
  const inputDecimals = isBuy ? XLM_DECIMALS : token.decimals
  const outputDecimals = isBuy ? token.decimals : XLM_DECIMALS
  const inputSymbol = isBuy ? 'XLM' : tokenSymbol
  const outputSymbol = isBuy ? tokenSymbol : 'XLM'

  const pool = useSoroswapPool(token.id)
  const curve = useCurveState(token.id)
  const tokenBalance = useTokenBalance(publicKey, token.id)
  const xlmBalance = useXlmBalance(publicKey)
  const { data: xlmUsd = DEFAULT_XLM_USD_PRICE } = useXlmUsdPrice()

  const isBondingCurve = Boolean(curve.data && !curve.data.graduated)
  const curveReserves =
    isBondingCurve && curve.data
      ? curveVirtualReserves(curve.data.curve_xlm_net, curve.data.tokens_sold)
      : null
  const effectivePool =
    isBondingCurve && curveReserves
      ? {
          exists: true,
          pairId: '',
          reserveToken: curveReserves.virtualTokens,
          reserveXlm: curveReserves.virtualXlm,
        }
      : pool.data

  const xlmBase =
    xlmBalance.data !== undefined
      ? xlmToStroops(xlmBalance.data)
      : undefined
  const inputBalanceBase = isBuy ? xlmBase : tokenBalance.data
  const sellMaxBalance = tokenBalance.data

  const amountIn = parseAmount(amount, inputDecimals)

  const curveBuyQuote =
    isBondingCurve && isBuy && curve.data && amountIn > 0n
      ? localCurveQuoteBuy(
          curve.data.curve_xlm_net,
          curve.data.tokens_sold,
          amountIn,
        )
      : null
  const curveSellQuote =
    isBondingCurve && !isBuy && curve.data && amountIn > 0n
      ? localCurveQuoteSell(
          curve.data.curve_xlm_net,
          curve.data.tokens_sold,
          amountIn,
        )
      : null

  // Instant deterministic 0ms quote (Virtual Curve pre-grad or Soroswap DEX post-grad).
  const quoted = isBondingCurve
    ? isBuy
      ? curveBuyQuote?.tokens_out
      : curveSellQuote?.net_xlm_out
    : amountIn > 0n && pool.data?.exists
      ? isBuy
        ? localQuoteXlmForToken(amountIn, pool.data)
        : localQuoteTokenForXlm(amountIn, pool.data)
      : undefined

  const effectiveAmountIn =
    isBondingCurve && isBuy && curveBuyQuote
      ? curveBuyQuote.total_xlm_charged
      : amountIn
  const curveFeeBps = isBondingCurve
    ? isBuy
      ? (curveBuyQuote?.total_fee_bps ?? 80n)
      : (curveSellQuote?.total_fee_bps ?? 80n)
    : 30n

  const minimum = quoted !== undefined ? withSlippage(quoted, slippage) : null
  const impact =
    effectivePool?.exists && quoted !== undefined && amountIn > 0n
      ? priceImpactPercent(
          isBondingCurve && isBuy && curveBuyQuote
            ? curveBuyQuote.net_xlm_to_curve
            : amountIn,
          isBondingCurve && !isBuy && curveSellQuote
            ? curveSellQuote.gross_xlm_out
            : quoted,
          isBuy ? effectivePool.reserveXlm : effectivePool.reserveToken,
          isBuy ? effectivePool.reserveToken : effectivePool.reserveXlm,
          isBondingCurve ? 0 : SOROSWAP_SWAP_FEE_PERCENT,
        )
      : null

  const spotPriceXlm = effectivePool
    ? tokenPriceInXlmNumber(effectivePool, token.decimals)
    : 0
  const inputUsd =
    effectiveAmountIn > 0n
      ? isBuy
        ? (Number(effectiveAmountIn) / 10 ** XLM_DECIMALS) * xlmUsd
        : (Number(effectiveAmountIn) / 10 ** token.decimals) * spotPriceXlm * xlmUsd
      : 0
  const outputUsd =
    quoted !== undefined && quoted > 0n
      ? isBuy
        ? (Number(quoted) / 10 ** token.decimals) * spotPriceXlm * xlmUsd
        : (Number(quoted) / 10 ** XLM_DECIMALS) * xlmUsd
      : 0
  const tradedTokenBase = isBuy ? (quoted ?? 0n) : amountIn
  const isWhaleOrder =
    tradedTokenBase > 0n &&
    tradedTokenBase >= whaleThresholdBase(token.decimals)

  function handleSlippageInput(raw: string) {
    const cleaned = raw.replace(/[^0-9.]/g, '')
    if (!cleaned) return
    const num = Number(cleaned)
    if (Number.isFinite(num)) {
      setSlippage(Math.max(0.1, Math.min(50, num)))
      setConfirmHighRisk(false)
    }
  }

  function changeDirection(next: Direction) {
    if (busy || next === direction) return
    setDirection(next)
    setAmount('')
    setError(null)
    setSwapped(null)
    setConfirmHighRisk(false)
  }

  async function onSwap(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setSwapped(null)

    if (!publicKey) {
      setError('Connect your wallet or activate demo mode to execute a swap.')
      return
    }
    const signer = requireSignerOrPrompt()
    if (!signer) {
      if (useWallet.getState().mode !== 'hot') {
        setError(UNSUPPORTED_SIGNER_MESSAGE)
      }
      return
    }
    if (amountIn <= 0n) {
      setError('Please enter an amount greater than 0.')
      return
    }
    const MAX_SAFE_SWAP_AMOUNT = 10n ** 30n
    if (amountIn > MAX_SAFE_SWAP_AMOUNT) {
      setError('Amount is too large. Please enter a smaller trade amount.')
      return
    }
    const effectiveSpentXlm = isBuy ? effectiveAmountIn : 0n
    if (isBuy && xlmBalance.data !== undefined) {
      const balStroops = BigInt(Math.round(xlmBalance.data * 1e7))
      if (effectiveSpentXlm > balStroops) {
        setError('Insufficient XLM balance for this purchase.')
        return
      }
    }
    if (!isBuy && inputBalanceBase !== undefined && amountIn > inputBalanceBase) {
      setError(`Insufficient ${tokenSymbol} balance for this sale.`)
      return
    }
    const xlmReserveError = validateXlmReserve(
      xlmBalance.data,
      effectiveSpentXlm,
      publicKey,
    )
    if (xlmReserveError) {
      setError(xlmReserveError)
      return
    }

    const quotedAmount = quoted ?? 0n
    if (quotedAmount <= 0n) {
      setError(
        pool.isPending
          ? 'Loading pool reserves; please wait a moment.'
          : 'No quote available for that amount (pool may lack sufficient liquidity).',
      )
      return
    }

    const needsSecondTap = (impact !== null && impact >= 15) || slippage >= 10
    if (needsSecondTap && !confirmHighRisk) {
      setConfirmHighRisk(true)
      triggerTelegramHaptic('medium')
      return
    }
    setConfirmHighRisk(false)

    setBusy(true)
    let hash: string | undefined
    try {
      let actualIn = amountIn
      let received = quotedAmount
      let didGraduate = false

      if (isBondingCurve) {
        const res = isBuy
          ? await buyCurveToken({
              tokenId: token.id,
              maxXlmIn: amountIn,
              minTokensOut: withSlippage(quotedAmount, slippage),
              signer,
              onHash: (value) => {
                hash = value
              },
            })
          : await sellCurveToken({
              tokenId: token.id,
              tokenAmount: amountIn,
              minXlmOut: withSlippage(quotedAmount, slippage),
              signer,
              onHash: (value) => {
                hash = value
              },
            })
        hash = res.hash ?? hash
        actualIn = isBuy ? res.trade.xlm : res.trade.tokens
        received = isBuy ? res.trade.tokens : res.trade.xlm
        didGraduate = res.trade.graduated
      } else {
        const amounts = isBuy
          ? await swapXlmForToken({
              tokenId: token.id,
              amountIn,
              amountOutMin: withSlippage(quotedAmount, slippage),
              signer,
              onHash: (value) => {
                hash = value
              },
            })
          : await swapTokenForXlm({
              tokenId: token.id,
              amountIn,
              amountOutMin: withSlippage(quotedAmount, slippage),
              signer,
              onHash: (value) => {
                hash = value
              },
            })
        received = amounts[1] ?? quotedAmount
      }

      const inFormatted = formatAmount(actualIn, inputDecimals)
      const outFormatted = formatAmount(received, outputDecimals)
      setSwapped({ direction, in: actualIn, out: received, hash })
      setAmount('')
      recordActivity({
        kind: 'swap',
        tokenId: token.id,
        tokenSymbol,
        amount: isBuy ? outFormatted : inFormatted,
        secondaryAmount: isBuy ? inFormatted : outFormatted,
        secondarySymbol: 'XLM',
        swapDirection: direction,
        detail: isBuy ? 'buy' : 'sell',
        account: publicKey,
        hash,
      })
      toast.success(
        didGraduate
          ? '🎓 Graduated to Soroswap & Swap Completed!'
          : 'Swap completed',
        {
          message: didGraduate
            ? `${inFormatted} ${inputSymbol} → ${outFormatted} ${outputSymbol} · Soroswap pool live & LP locked 7 years!`
            : `${inFormatted} ${inputSymbol} → ${outFormatted} ${outputSymbol}`,
          hash,
        },
      )
      const postGrad = graduationProgressForListing({
        pool: effectivePool ?? {
          exists: false,
          pairId: '',
          reserveToken: 0n,
          reserveXlm: 0n,
        },
        curve: curve.data
          ? {
              ...curve.data,
              graduated: curve.data.graduated || didGraduate,
              curve_xlm_net: isBuy
                ? curve.data.curve_xlm_net +
                  (curveBuyQuote?.net_xlm_to_curve ?? actualIn)
                : curve.data.curve_xlm_net >
                    (curveSellQuote?.gross_xlm_out ?? received)
                  ? curve.data.curve_xlm_net -
                    (curveSellQuote?.gross_xlm_out ?? received)
                  : 0n,
            }
          : null,
      })
      void notifySwapAlert({
        tokenId: token.id,
        symbol: tokenSymbol,
        direction,
        xlmAmount: isBuy ? inFormatted : outFormatted,
        tokenAmount: isBuy ? outFormatted : inFormatted,
        isWhale: isWhaleOrder,
        graduationPercent: postGrad.percent,
        explorerUrl: hash ? explorerTxUrl(hash) : undefined,
      })
      if (hash) void notifyTelegramPulse(hash)
      onSwapped?.()
      triggerTelegramHaptic('success')
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['launch-curve', token.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ['soroswap-pool', token.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ['token-info', token.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ['lp-position', token.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ['lp-burn'],
        }),
        queryClient.invalidateQueries({
          queryKey: ['token-events', token.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ['token-balance', token.id],
        }),
        queryClient.invalidateQueries({
          queryKey: ['xlm-balance'],
        }),
        queryClient.invalidateQueries({
          queryKey: ['token-list'],
          refetchType: 'none',
        }),
      ])
    } catch (err) {
      triggerTelegramHaptic('error')
      const message = errorMessage(err)
      setError(message)
      if (message === 'Transaction cancelled in wallet.') {
        toast.info('Swap cancelled', {
          message: 'You cancelled the transaction in your wallet.',
        })
      } else {
        recordActivity({
          kind: 'swap',
          status: 'failed',
          tokenId: token.id,
          tokenSymbol,
          amount: formatAmount(amountIn, inputDecimals),
          swapDirection: direction,
          detail: isBuy ? 'failed buy' : 'failed sell',
          account: publicKey,
          error: message,
        })
        toast.error('Swap failed', { message })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section
      id="swap-card"
      className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 sm:p-5"
    >
      <h2 className="sr-only">Swap with XLM</h2>

      <div
        role="group"
        aria-label="Swap direction"
        className="grid grid-cols-2 gap-1.5 rounded-xl border border-slate-800 bg-slate-950/70 p-1.5"
      >
        <button
          type="button"
          aria-pressed={isBuy}
          disabled={busy}
          onClick={() => changeDirection('buy')}
          className={`min-h-[44px] rounded-lg text-sm font-bold transition-all ${
            isBuy
              ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/25'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
          }`}
        >
          Buy with XLM 🟢
        </button>
        <button
          type="button"
          aria-pressed={!isBuy}
          disabled={busy}
          onClick={() => changeDirection('sell')}
          className={`min-h-[44px] rounded-lg text-sm font-bold transition-all ${
            !isBuy
              ? 'bg-rose-500 text-slate-950 shadow-md shadow-rose-500/25'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/50'
          }`}
        >
          Sell Token 🔴
        </button>
      </div>

      {isBondingCurve && curve.data && curveReserves ? (
        <p className="mt-3 h-5 text-xs text-slate-400 flex items-center justify-between gap-2 tabular-nums whitespace-nowrap">
          <span className="inline-flex shrink-0 items-center gap-1 text-sky-300 font-semibold">
            ⚡ Bonding Curve
          </span>
          <span className="font-mono text-slate-300 truncate">
            {(Number(curve.data.curve_xlm_net) / 1e7).toFixed(1)}/{GRADUATION_TARGET_XLM} XLM ·{' '}
            {(Number(curveReserves.remainingCurveTokens) / 10 ** token.decimals).toLocaleString('en-US', { maximumFractionDigits: 0 })} {tokenSymbol}
          </span>
        </p>
      ) : effectivePool?.exists ? (
        <p className="mt-3 h-5 text-xs text-slate-400 flex items-center justify-between gap-2 tabular-nums whitespace-nowrap">
          <span className="shrink-0">Reserves</span>
          <span className="font-mono text-slate-300 truncate">
            {(Number(effectivePool.reserveToken) / 10 ** token.decimals).toLocaleString('en-US', { maximumFractionDigits: 2 })} {tokenSymbol} ·{' '}
            {(Number(effectivePool.reserveXlm) / 1e7).toFixed(1)} XLM
          </span>
        </p>
      ) : pool.isPending || curve.isPending ? (
        <p className="mt-3 h-5 text-xs text-slate-400 animate-pulse truncate">
          Syncing curve &amp; Soroswap reserves…
        </p>
      ) : (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-center">
          <p className="text-xs font-semibold text-amber-200">
            This token has no pair with XLM yet: seed liquidity first.
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            Be the first participant to initialize the AMM pool.
          </p>
          <a
            href="#advanced-tools"
            onClick={() => onOpenLiquidityTools?.()}
            className="mt-2 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-amber-400 px-3.5 py-1 text-xs font-bold text-slate-950 hover:bg-amber-300"
          >
            ⚡ Open Seed Liquidity Tool
          </a>
        </div>
      )}

      <form onSubmit={onSwap} aria-busy={busy} className="mt-4 grid gap-3">
        <label className="block text-sm">
          <div className="flex items-center justify-between">
            <span className="text-slate-300 font-medium">
              {isBuy ? 'Amount in XLM' : `Amount in ${tokenSymbol}`}
            </span>
            <div className="flex items-center gap-2">
              {inputUsd > 0 ? (
                <span className="font-mono text-xs text-slate-400">
                  ≈ ${formatUsdPrice(inputUsd)} USD
                </span>
              ) : null}
              {amount ? (
                <button
                  type="button"
                  onClick={() => setAmount('')}
                  className="text-xs text-slate-400 hover:text-slate-200 underline"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
          <input
            className={`${inputClass} mt-1`}
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value)
              setConfirmHighRisk(false)
            }}
            placeholder={isBuy ? 'e.g. 10' : 'e.g. 500000'}
            inputMode="decimal"
          />
        </label>

        {/* Quick Amount Chips — Buy uses fixed safe XLM presets (no MAX button to prevent draining gas wallet) */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
          <span>
            {isBuy ? 'Balance' : 'Your Token'}:{' '}
            <span className="font-mono text-slate-200 font-semibold">
              {publicKey && inputBalanceBase !== undefined
                ? formatAmount(inputBalanceBase, inputDecimals)
                : '—'}
            </span>
          </span>

          <div className="flex flex-wrap gap-1.5">
            {isBuy ? (
              QUICK_XLM_AMOUNTS.map((quickXlm) => (
                <button
                  key={quickXlm}
                  type="button"
                  disabled={busy}
                  onClick={() => setAmount(quickXlm)}
                  className="inline-flex min-h-[34px] items-center rounded-lg border border-slate-800 bg-slate-950/80 px-2.5 py-1 text-xs font-semibold text-emerald-300 hover:border-emerald-500 hover:bg-emerald-950/30 transition-colors"
                >
                  {quickXlm} XLM
                </button>
              ))
            ) : (
              AMOUNT_PERCENTS.map((pct) => {
                const slice =
                  sellMaxBalance !== undefined ? (sellMaxBalance * BigInt(pct)) / 100n : 0n
                return (
                  <button
                    key={pct}
                    type="button"
                    disabled={sellMaxBalance === undefined || sellMaxBalance <= 0n || busy}
                    onClick={() => {
                      if (slice > 0n) {
                        setAmount(formatAmount(slice, inputDecimals))
                      }
                    }}
                    className="inline-flex min-h-[34px] items-center rounded-lg border border-slate-800 bg-slate-950/80 px-2.5 py-1 text-xs font-semibold text-rose-300 hover:border-rose-500 hover:bg-rose-950/30 transition-colors disabled:opacity-50"
                  >
                    {pct === 100 ? 'MAX' : `${pct}%`}
                  </button>
                )
              })
            )}
          </div>
        </div>

        {/* Compact Slippage Control */}
        <div className="space-y-2 text-xs text-slate-400">
          <div className="flex items-center justify-between gap-2">
            <span>Slippage</span>
            <button
              type="button"
              aria-expanded={showSlippage}
              disabled={busy}
              onClick={() => setShowSlippage((prev) => !prev)}
              className="inline-flex min-h-[32px] items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1 font-mono text-xs text-slate-200 hover:border-slate-600 transition-colors"
            >
              <span>{slippage}%</span>
              <span className="text-slate-400">{showSlippage ? '▴' : '⚙'}</span>
            </button>
          </div>

          {showSlippage ? (
            <div className="space-y-1.5 rounded-xl border border-slate-800/80 bg-slate-950/50 p-2.5">
              <div
                role="group"
                aria-label="Slippage tolerance"
                className="flex flex-wrap items-center gap-1.5"
              >
                {SLIPPAGE_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={slippage === option}
                    disabled={busy}
                    onClick={() => setSlippage(option)}
                    className={`min-h-[32px] rounded-md border px-2.5 py-1 font-mono text-xs transition-colors ${
                      slippage === option
                        ? 'border-emerald-500 bg-emerald-500/15 font-medium text-emerald-300'
                        : 'border-slate-800 bg-slate-950/40 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    {option}%
                  </button>
                ))}
                <label className="flex items-center rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1 min-h-[32px] focus-within:border-emerald-500">
                  <span className="sr-only">Custom slippage percent</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    aria-label="Custom slippage percent"
                    value={slippage}
                    disabled={busy}
                    onChange={(e) => handleSlippageInput(e.target.value)}
                    className="w-12 bg-transparent text-right font-mono text-base sm:text-xs text-slate-200 outline-none"
                  />
                  <span className="ml-0.5 font-mono text-xs text-slate-500">%</span>
                </label>
              </div>
              {slippage >= 10 ? (
                <p className="text-xs text-amber-300">
                  High slippage ({slippage}%) — your order may execute at a worse price.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {amountIn > 0n && (effectivePool?.exists || pool.isPending || curve.isPending) ? (
          <div className="min-h-[82px] grid gap-1.5 text-sm text-slate-300 tabular-nums">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p>
                You receive ≈{' '}
                <span className="font-semibold text-emerald-400">
                  {quoted !== undefined
                    ? `${formatAmount(quoted, outputDecimals)} ${outputSymbol}`
                    : 'quoting…'}
                </span>
              </p>
              {outputUsd > 0 ? (
                <span className="font-mono text-xs text-slate-400">
                  ≈ ${formatUsdPrice(outputUsd)} USD
                </span>
              ) : null}
            </div>

            <div className="min-h-[38px] space-y-1.5 rounded-xl border border-slate-800/80 bg-slate-950/40 px-3 py-2 text-xs">
              {quoted !== undefined && quoted > 0n ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-slate-400">
                    <span>
                      Min. received:{' '}
                      <strong className="font-mono text-slate-200">
                        {formatAmount(minimum ?? 0n, outputDecimals)} {outputSymbol}
                      </strong>
                    </span>
                    <span>
                      Fee:{' '}
                      <strong className="font-mono text-slate-200">
                        {isBondingCurve
                          ? `${(Number(curveFeeBps) / 100).toFixed(2)}%`
                          : `${SOROSWAP_SWAP_FEE_PERCENT.toFixed(2)}%`}
                      </strong>
                    </span>
                  </div>

                  {impact !== null && impact >= 0.1 ? (
                    <p className={`text-xs ${impactClass(impact)}`}>
                      Price move: ~{impact.toFixed(impact >= 1 ? 1 : 2)}% with this order size.
                    </p>
                  ) : null}

                  {isBondingCurve && curveBuyQuote?.will_graduate ? (
                    <div className="mt-1 rounded-lg border border-emerald-500/50 bg-emerald-950/30 px-2.5 py-2 text-xs font-semibold text-emerald-200 space-y-0.5">
                      <div>🎓 This buy graduates ${tokenSymbol} to Soroswap DEX!</div>
                      {effectiveAmountIn < amountIn ? (
                        <div className="font-mono text-[11px] text-emerald-300">
                          Actual XLM charged: {formatAmount(effectiveAmountIn, XLM_DECIMALS)} XLM (excess unspent)
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="text-slate-500 animate-pulse">Calculating live on-chain quote…</p>
              )}
            </div>
          </div>
        ) : null}

        <div>
          {confirmHighRisk ? (
            <p className="mb-2 rounded-lg border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-xs font-medium text-amber-200">
              {impact !== null && impact >= 15
                ? `Large price move (~${impact.toFixed(1)}%).`
                : `Wide slippage (${slippage}%).`}{' '}
              Tap once more to confirm.
            </p>
          ) : null}
          {!publicKey ? (
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <button
                type="button"
                disabled={pending}
                onClick={() => openWalletModal('connect')}
                className="min-h-[48px] w-full rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 px-6 py-3.5 text-base font-black text-slate-950 shadow-lg shadow-amber-500/25 transition-all active:scale-[0.99] disabled:opacity-60"
              >
                {pending ? 'Connecting…' : '⚡ Connect / Create Wallet to Trade'}
              </button>
              {NETWORK_NAME !== 'mainnet' ? (
                <button
                  type="button"
                  disabled={demoPending || pending}
                  onClick={() => void startDemo().catch((err) => toast.error('Failed to start demo', { message: errorMessage(err) }))}
                  className="min-h-[48px] rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-3 text-xs font-bold text-sky-200 hover:bg-sky-500/20 disabled:opacity-60"
                >
                  {demoPending ? 'Funding…' : 'Testnet Demo'}
                </button>
              ) : null}
            </div>
          ) : !effectivePool?.exists ? null : (
            <button
              type="submit"
              disabled={busy || amountIn <= 0n}
              className={`min-h-[48px] w-full rounded-xl px-6 py-3.5 text-base font-black transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed ${
                confirmHighRisk
                  ? 'bg-amber-400 hover:bg-amber-300 text-slate-950 shadow-amber-400/25 active:scale-[0.99]'
                  : isBuy
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/25 active:scale-[0.99]'
                    : 'bg-rose-500 hover:bg-rose-400 text-slate-950 shadow-rose-500/25 active:scale-[0.99]'
              }`}
            >
              {busy
                ? 'Executing on-chain…'
                : confirmHighRisk
                  ? `⚠️ Confirm ${isBuy ? 'Buy' : 'Sell'} ${tokenSymbol}`
                  : isBuy
                    ? `🚀 Quick Buy ${tokenSymbol} Now`
                    : `💰 Quick Sell ${tokenSymbol} for XLM`}
            </button>
          )}
          <div className="mt-2.5 flex items-center justify-between text-xs text-slate-400">
            <span>Slippage: {slippage}%</span>
            <span className="text-emerald-400 font-medium">
              {isBondingCurve
                ? isBuy
                  ? '0.80% flat buy (0.50% Treasury + 0.30% LP floor)'
                  : `${(Number(curveFeeBps) / 100).toFixed(2)}% sell (0.50% Treasury + LP/buyback; drops to 1.50% ≥50%)`
                : `${SOROSWAP_SWAP_FEE_PERCENT.toFixed(2)}% DEX LP fee · 0% protocol fee`}
            </span>
          </div>
        </div>

        {busy ? (
          <TxProgress
            steps={[
              {
                label: isBuy
                  ? 'Signing and submitting buy order to router'
                  : 'Signing and submitting sell order to router',
                status: 'active',
              },
            ]}
          />
        ) : null}
      </form>

      {error ? (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-rose-900 bg-rose-950/40 px-3 py-2 text-sm text-rose-300"
        >
          {error}
        </p>
      ) : null}

      {swapped ? (
        <div className="mt-4 rounded-lg border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          <p>
            Swap executed ✓{' '}
            {formatAmount(
              swapped.in,
              swapped.direction === 'buy' ? XLM_DECIMALS : token.decimals,
            )}{' '}
            {swapped.direction === 'buy' ? 'XLM' : tokenSymbol} →{' '}
            {formatAmount(
              swapped.out,
              swapped.direction === 'buy' ? token.decimals : XLM_DECIMALS,
            )}{' '}
            {swapped.direction === 'buy' ? tokenSymbol : 'XLM'}
          </p>
          {swapped.hash ? (
            <a
              href={explorerTxUrl(swapped.hash)}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-xs underline underline-offset-2"
            >
              View on Stellar Explorer ↗
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
