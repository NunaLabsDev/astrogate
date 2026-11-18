import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import type { TokenListing } from '../lib/discovery'
import type { LaunchpadToken } from '../lib/token'
import { effectiveLiquidityStroops, pickGraduatingCandidates } from '../lib/market'
import { tokenPriceInXlmNumber } from '../lib/soroswap'
import {
  FAIR_LAUNCH_TOTAL_BASIS,
  GRADUATION_TARGET_XLM,
  graduationProgressForListing,
} from '../lib/tokenomics'
import { DEFAULT_XLM_USD_PRICE } from '../lib/xlm'
import { useXlmUsdPrice } from '../hooks/useXlmUsdPrice'
import { useTokenInfo } from '../hooks/useTokenInfo'
import { useTokenMetadata } from '../hooks/useTokenMetadata'
import { TokenArt } from './TokenArt'

export const CAROUSEL_INTERVAL_MS = 4_000

export function KingOfTheHill({
  tokens,
  pending = false,
  onSelect,
}: {
  tokens: TokenListing[]
  pending?: boolean
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

  // Ungraduated Fair-Flywheel launches have a fixed 10M supply — skip extra RPC reads on each 4s slide tick.
  const isVerifiedUngraduated = Boolean(
    active?.verifiedLaunchpad && !active.curve?.graduated,
  )
  const activeInfo = useTokenInfo(
    active && !isVerifiedUngraduated ? active.id : '',
  )
  const activeMeta = useTokenMetadata(active?.id ?? '')

  // Reserve identical vertical space during initial market fetch so list never jumps (0 CLS).
  if (pending && !active) {
    return (
      <div
        aria-hidden="true"
        className="h-[196px] sm:h-[156px] rounded-2xl border border-amber-500/20 bg-slate-900/60 p-3.5 sm:p-4 animate-pulse flex flex-col justify-between"
      >
        <div className="flex items-center justify-between">
          <div className="h-5 w-32 rounded-full bg-slate-800" />
          <div className="h-6 w-20 rounded-lg bg-slate-800" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-14 w-14 rounded-xl bg-slate-800 shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-5 w-40 rounded bg-slate-800" />
            <div className="h-3.5 w-48 rounded bg-slate-800/70" />
          </div>
        </div>
        <div className="h-9 w-full rounded-xl bg-slate-800/70" />
      </div>
    )
  }

  if (!active) return null

  const grad = graduationProgressForListing(active)
  const priceXlm = tokenPriceInXlmNumber(active.pool, active.decimals)
  const displayLiquidity = effectiveLiquidityStroops(active)
  const reserveXlmNum = Number(displayLiquidity) / 1e7
  const totalSupply = isVerifiedUngraduated
    ? Number(FAIR_LAUNCH_TOTAL_BASIS)
    : activeInfo.data
      ? Number(activeInfo.data.totalSupply) / 10 ** activeInfo.data.decimals
      : 0
  const marketCapUsd = priceXlm * totalSupply * xlmUsd

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
      className="relative min-h-[196px] sm:min-h-[156px] overflow-hidden rounded-2xl border border-amber-500/40 bg-gradient-to-br from-amber-950/35 via-slate-900/95 to-emerald-950/30 p-3.5 sm:p-4 shadow-lg flex flex-col justify-between gap-2.5"
    >
      {/* Top row: locked single line */}
      <div className="flex h-7 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-400/20 px-2 py-0.5 text-xs font-bold text-amber-300">
            🔥 Graduating Soon
          </span>
          <span className="hidden xs:inline-flex truncate rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-300">
            #{activeIndex + 1} Curve
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {candidates.length > 1 ? (
            <>
              <button
                type="button"
                onClick={stepPrev}
                aria-label="Previous graduating token"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-900/80 text-sm font-bold text-slate-200 hover:border-amber-400/60"
              >
                ‹
              </button>
              <span className="min-w-[36px] text-center font-mono text-xs tabular-nums text-slate-300">
                {activeIndex + 1}/{candidates.length}
              </span>
              <button
                type="button"
                onClick={stepNext}
                aria-label="Next graduating token"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-900/80 text-sm font-bold text-slate-200 hover:border-amber-400/60"
              >
                ›
              </button>
            </>
          ) : (
            <span className="text-xs font-mono text-emerald-300">1/1</span>
          )}
        </div>
      </div>

      {/* Main content row: fixed heights & truncation so 4s transitions produce 0 CLS */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-amber-400/70 shadow-md">
            <TokenArt
              id={active.id}
              symbol={active.symbol}
              logoUrl={activeMeta.data?.logoUrl}
              className="h-full w-full"
            />
            <span
              aria-hidden="true"
              className="absolute right-0 top-0 rounded-bl-md bg-amber-400 px-1 py-0.5 text-[10px] font-bold leading-none text-slate-950"
            >
              #{activeIndex + 1}
            </span>
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="h-6 truncate text-base sm:text-lg font-extrabold text-slate-100 leading-6">
              ${active.symbol}{' '}
              <span className="text-xs sm:text-sm font-normal text-slate-400">
                · {active.name}
              </span>
            </h3>

            <div className="mt-1 flex h-5 items-center gap-3 text-xs text-slate-300 font-mono tabular-nums whitespace-nowrap overflow-hidden">
              <span className="text-emerald-300 font-semibold">
                {reserveXlmNum.toFixed(1)}/{GRADUATION_TARGET_XLM.toLocaleString('en-US')} XLM
              </span>
              <span className="text-slate-500">·</span>
              <span className="text-amber-300 font-semibold truncate">
                MCap {marketCapUsd > 0 ? `$${marketCapUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:min-w-[240px]">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between text-xs font-mono tabular-nums">
              <span className="text-slate-400 truncate">To DEX</span>
              <span className="font-bold text-amber-300">
                {grad.percent.toFixed(1)}%
              </span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full border border-amber-500/30 bg-slate-950">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-400 via-emerald-400 to-teal-300 transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(5, grad.percent))}%` }}
              />
            </div>
          </div>

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
              className="inline-flex min-h-[38px] shrink-0 items-center rounded-xl bg-amber-400 px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-300 whitespace-nowrap"
            >
              🔥 Trade →
            </button>
          ) : (
            <Link
              to={`/token/${active.id}`}
              className="inline-flex min-h-[38px] shrink-0 items-center rounded-xl bg-amber-400 px-3.5 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-300 whitespace-nowrap"
            >
              🔥 Trade →
            </Link>
          )}
        </div>
      </div>

      {/* Fixed-height dot slot so layout never shifts when indicators mount */}
      <div
        className="flex h-2 items-center justify-center gap-1.5"
        aria-label="Select graduating token slide"
      >
        {candidates.length > 1
          ? candidates.map((candidate, idx) => (
              <button
                key={candidate.id}
                type="button"
                onClick={() => setSlideIndex(idx)}
                aria-label={`Show ${candidate.symbol} (${idx + 1} of ${candidates.length})`}
                aria-current={idx === activeIndex ? 'true' : undefined}
                className={`h-1.5 rounded-full transition-all ${
                  idx === activeIndex
                    ? 'w-5 bg-amber-400'
                    : 'w-1.5 bg-slate-600 hover:bg-slate-400'
                }`}
              />
            ))
          : null}
      </div>
    </div>
  )
}
