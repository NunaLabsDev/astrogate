import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { TokenListing } from '../lib/discovery'
import type { LaunchpadToken } from '../lib/token'
import { formatAmount } from '../lib/format'
import { effectiveLiquidityStroops, pickGraduatingCandidates } from '../lib/market'
import { tokenPriceInXlmNumber } from '../lib/soroswap'
import { GRADUATION_TARGET_XLM, graduationProgressForListing } from '../lib/tokenomics'
import { DEFAULT_XLM_USD_PRICE } from '../lib/xlm'
import { useXlmUsdPrice } from '../hooks/useXlmUsdPrice'
import { useTokenInfo } from '../hooks/useTokenInfo'
import { useTokenMetadata } from '../hooks/useTokenMetadata'
import { TokenArt } from './TokenArt'

export const CAROUSEL_INTERVAL_MS = 4_000

export function KingOfTheHill({
  tokens,
  onSelect,
}: {
  tokens: TokenListing[]
  onSelect?: (token: LaunchpadToken) => void
}) {
  const { data: xlmUsd = DEFAULT_XLM_USD_PRICE } = useXlmUsdPrice()
  const candidates = useMemo(() => pickGraduatingCandidates(tokens), [tokens])
  const [slideIndex, setSlideIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  const activeIndex = candidates.length > 0 ? slideIndex % candidates.length : 0
  const active = candidates[activeIndex] ?? null

  useEffect(() => {
    if (paused || candidates.length <= 1) return
    const timer = window.setInterval(() => {
      setSlideIndex((prev) => (prev + 1) % candidates.length)
    }, CAROUSEL_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [paused, candidates.length])

  // Supply real on-chain: siempre llamar hooks de forma incondicional antes del return.
  const activeInfo = useTokenInfo(active?.id ?? '')
  const activeMeta = useTokenMetadata(active?.id ?? '')

  if (!active) return null

  const grad = graduationProgressForListing(active)
  const priceXlm = tokenPriceInXlmNumber(active.pool, active.decimals)
  const displayLiquidity = effectiveLiquidityStroops(active)
  const reserveXlmNum = Number(displayLiquidity) / 1e7
  const liquidityUsd = reserveXlmNum * xlmUsd
  const totalSupply = activeInfo.data
    ? Number(activeInfo.data.totalSupply) / 10 ** activeInfo.data.decimals
    : 0
  const marketCapXlm = priceXlm * totalSupply
  const marketCapUsd = marketCapXlm * xlmUsd

  const stepPrev = () => {
    setSlideIndex((prev) => (prev - 1 + candidates.length) % candidates.length)
  }

  const stepNext = () => {
    setSlideIndex((prev) => (prev + 1) % candidates.length)
  }

  return (
    <div
      role="region"
      aria-roledescription="carousel"
      aria-label="Tokens graduating soon"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="relative overflow-hidden rounded-2xl border border-amber-500/40 bg-gradient-to-br from-amber-950/35 via-slate-900/95 to-emerald-950/30 p-4 shadow-lg sm:p-5"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/20 px-2.5 py-0.5 text-xs font-bold tracking-wide text-amber-300">
            🔥 Graduating Soon
          </span>
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
            {activeIndex === 0 ? '👑 Leading Curve' : `#${activeIndex + 1} on Curve`}
          </span>
        </div>

        {candidates.length > 1 ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={stepPrev}
              aria-label="Previous graduating token"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-900/80 text-sm font-bold text-slate-200 hover:border-amber-400/60 hover:text-amber-200"
            >
              ‹
            </button>
            <span className="min-w-[44px] text-center font-mono text-xs text-slate-300">
              {activeIndex + 1}/{candidates.length}
            </span>
            <button
              type="button"
              onClick={stepNext}
              aria-label="Next graduating token"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-900/80 text-sm font-bold text-slate-200 hover:border-amber-400/60 hover:text-amber-200"
            >
              ›
            </button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border-2 border-amber-400/70 shadow-md sm:h-20 sm:w-20">
            <TokenArt
              id={active.id}
              symbol={active.symbol}
              logoUrl={activeMeta.data?.logoUrl}
              className="h-full w-full"
            />
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 rounded-bl-lg bg-amber-400 px-1.5 py-0.5 text-xs font-bold text-slate-950"
            >
              #{activeIndex + 1}
            </span>
          </div>

          <div className="min-w-0">
            <h3 className="truncate text-lg font-extrabold text-slate-100 sm:text-xl">
              ${active.symbol}{' '}
              <span className="text-sm font-normal text-slate-400">
                · {active.name}
              </span>
            </h3>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300">
              <span>
                Curve Vault:{' '}
                <strong className="font-mono text-emerald-300">
                  {formatAmount(displayLiquidity, 7)} / {GRADUATION_TARGET_XLM.toLocaleString('en-US')} XLM
                </strong>{' '}
                <span className="text-slate-400">
                  (≈ ${liquidityUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })} USD)
                </span>
              </span>
              {marketCapXlm > 0 ? (
                <span>
                  MCap:{' '}
                  <strong className="font-mono text-amber-300">
                    ${marketCapUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })} USD
                  </strong>
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:min-w-[230px] sm:items-end">
          <div className="w-full">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-300">Race to Soroswap DEX</span>
              <span className="font-mono font-bold text-amber-300">
                {grad.percent.toFixed(1)}%
              </span>
            </div>
            <div className="mt-1 h-2.5 w-full overflow-hidden rounded-full border border-amber-500/30 bg-slate-950">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 via-emerald-400 to-teal-300 transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(5, grad.percent))}%` }}
              />
            </div>
          </div>

          <div className="mt-1 flex flex-wrap gap-2">
            {onSelect ? (
              <button
                type="button"
                onClick={() =>
                  onSelect({
                    id: active.id,
                    decimals: active.decimals,
                    symbol: active.symbol,
                  })
                }
                className="inline-flex min-h-[40px] items-center rounded-xl bg-amber-400 px-4 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-300"
              >
                🔥 Trade ${active.symbol} →
              </button>
            ) : (
              <Link
                to={`/token/${active.id}`}
                className="inline-flex min-h-[40px] items-center rounded-xl bg-amber-400 px-4 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-300"
              >
                🔥 Trade ${active.symbol} →
              </Link>
            )}
          </div>
        </div>
      </div>

      {candidates.length > 1 ? (
        <div
          className="mt-3 flex flex-wrap items-center justify-center gap-1.5"
          aria-label="Select graduating token slide"
        >
          {candidates.map((candidate, idx) => (
            <button
              key={candidate.id}
              type="button"
              onClick={() => setSlideIndex(idx)}
              aria-label={`Show ${candidate.symbol} (${idx + 1} of ${candidates.length})`}
              aria-current={idx === activeIndex ? 'true' : undefined}
              className={`h-2 rounded-full transition-all ${
                idx === activeIndex
                  ? 'w-6 bg-amber-400'
                  : 'w-2 bg-slate-600 hover:bg-slate-400'
              }`}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
