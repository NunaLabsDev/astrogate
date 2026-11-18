import { useCallback, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useTokenList } from '../hooks/useTokenList'
import { shortAddress } from '../lib/format'
import { isValidContractAddress } from '../lib/address'
import {
  curveStageInfo,
  graduationProgressForListing,
  TOTAL_JACKPOT_TOKENS,
} from '../lib/tokenomics'
import { DEFAULT_XLM_USD_PRICE } from '../lib/xlm'
import { formatTokenPrice, formatUsdPrice, tokenPriceInXlmNumber } from '../lib/soroswap'
import { useXlmUsdPrice } from '../hooks/useXlmUsdPrice'
import { useWatchlist } from '../store/watchlist'
import {
  filterAndSortTokens,
  MARKET_SORT_OPTIONS,
  partitionMarketTokens,
  type MarketSortKey,
} from '../lib/market'
import { TokenArt } from './TokenArt'
import { KingOfTheHill } from './KingOfTheHill'
import { useTokenMetadata } from '../hooks/useTokenMetadata'
import type { LaunchpadToken } from '../lib/token'
import type { TokenListing } from '../lib/discovery'

type Props = {
  /** Token currently selected for swap. */
  selectedId: string | null
  onSelect: (token: LaunchpadToken) => void
  /** In homepage show only a subset. */
  limit?: number
  showFilters?: boolean
  /** Restrict view to Launchpad closed curves (`curves`), Graduated Soroswap DEX (`graduated`), or tabs (`all`). */
  mode?: 'all' | 'curves' | 'graduated'
}

function Price({ token }: { token: TokenListing }) {
  const { data: xlmUsd = DEFAULT_XLM_USD_PRICE } = useXlmUsdPrice()
  // Número en coma flotante: preserva fracciones exactas de stroop en pares
  // con precios cercanos al mínimo de 7 decimales en Soroswap.
  const price = tokenPriceInXlmNumber(token.pool, token.decimals)
  if (price <= 0) return <span className="text-slate-500 font-mono text-xs tabular-nums">—</span>
  const priceUsd = price * xlmUsd
  return (
    <div className="flex flex-col items-end tabular-nums">
      <span className="font-mono text-xs sm:text-sm font-semibold text-emerald-400 whitespace-nowrap">
        {formatTokenPrice(price)} XLM
      </span>
      <span className="font-mono text-xs text-slate-400 whitespace-nowrap">
        ≈ ${formatUsdPrice(priceUsd)}
      </span>
    </div>
  )
}

function MarketCard({
  token,
  selected,
  onSelect,
}: {
  token: TokenListing
  selected: boolean
  onSelect: (token: LaunchpadToken) => void
}) {
  const grad = graduationProgressForListing(token)
  const displayLiquidity =
    token.curve && !token.curve.graduated
      ? token.curve.curve_xlm_net
      : token.pool.reserveXlm
  const liquidityXlm = Number(displayLiquidity) / 1e7
  const isFav = useWatchlist((s) => s.favorites.includes(token.id))
  const toggleFav = useWatchlist((s) => s.toggle)
  const meta = useTokenMetadata(token.id)

  const isGraduated = grad.graduated
  const isHeating = grad.stage === 'heating'
  const ageLabel = token.ledger > 0 ? `#${token.ledger}` : null
  const curveStage =
    token.curve && !token.curve.graduated
      ? curveStageInfo(token.curve.curve_xlm_net, token.curve.burn_milestone_stage)
      : null
  const stageShortPill = curveStage
    ? curveStage.stage === 1
      ? '🌱 0.30% · +5K'
      : curveStage.stage === 2
        ? '👑 0.50% · +10K'
        : '🔥 0.25% · +25K'
    : null

  return (
    <li
      className={`liquid-glass-card group relative overflow-hidden rounded-2xl sm:rounded-3xl ${
        selected
          ? 'ring-2 ring-sky-400 border-sky-400/50'
          : isHeating
            ? 'ring-1 ring-amber-400/60 border-amber-500/40'
            : ''
      }`}
    >
      <button
        type="button"
        aria-label={`Select ${token.name} (${token.symbol})`}
        onClick={() =>
          onSelect({
            id: token.id,
            decimals: token.decimals,
            symbol: token.symbol,
          })
        }
        className="flex w-full cursor-pointer flex-row sm:flex-col text-left focus-visible:outline-none"
      >
        {/* Mobile Compact 64x64 Emblem | Desktop Wide Top Banner */}
        <div className="relative h-16 w-16 m-3 rounded-xl sm:m-0 sm:rounded-none sm:h-36 sm:w-full shrink-0 overflow-hidden bg-slate-950">
          <TokenArt
            id={token.id}
            symbol={token.symbol}
            logoUrl={meta.data?.logoUrl}
            className="h-full w-full transition-transform duration-500 ease-out group-hover:scale-105"
          />

          <div className="holo-sheen absolute inset-0" />
          <div className="hidden sm:block pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-slate-950/90 via-slate-950/35 to-transparent" />

          {/* Desktop overlay pills */}
          <div className="hidden sm:flex absolute top-2.5 left-2.5 flex-wrap items-center gap-1.5 pr-10">
            <span className="liquid-glass-pill rounded-full px-2.5 py-0.5 text-xs font-bold tracking-wider text-sky-300 font-mono">
              ${token.symbol}
            </span>
            {token.verifiedLaunchpad ? (
              <span
                title="Verified Fair Launch"
                className="liquid-glass-pill rounded-full border-emerald-400/50 bg-emerald-950/75 px-2 py-0.5 text-xs font-semibold text-emerald-300"
              >
                ✓ Fair
              </span>
            ) : ageLabel ? (
              <span className="liquid-glass-pill rounded-full px-2 py-0.5 font-mono text-xs text-slate-300">
                {ageLabel}
              </span>
            ) : null}
          </div>

          <div className="hidden sm:flex absolute bottom-2.5 left-2.5 items-center gap-1.5">
            {selected ? (
              <span className="liquid-glass-pill rounded-full border-sky-400/50 bg-sky-950/80 px-2.5 py-0.5 text-xs font-bold tracking-wider text-sky-300 uppercase">
                ✦ in swap
              </span>
            ) : !token.verifiedLaunchpad ? (
              <span className="liquid-glass-pill rounded-full border-slate-500/40 bg-slate-950/75 px-2.5 py-0.5 text-xs font-medium text-slate-300">
                Soroswap DEX
              </span>
            ) : isGraduated ? (
              <span className="liquid-glass-pill rounded-full border-emerald-400/40 bg-emerald-950/60 px-2.5 py-0.5 text-xs font-bold text-emerald-300">
                🎓 Soroswap DEX
              </span>
            ) : isHeating ? (
              <span className="liquid-glass-pill inline-flex items-center gap-1 rounded-full border-amber-400/60 bg-amber-950/75 px-2.5 py-0.5 text-xs font-bold text-amber-300 tabular-nums">
                {stageShortPill ?? '🔥'} · {grad.percent.toFixed(0)}%
              </span>
            ) : (
              <span className="liquid-glass-pill rounded-full px-2.5 py-0.5 text-xs font-medium text-sky-300 tabular-nums">
                {stageShortPill ?? '⚡ Curve'} · {grad.percent.toFixed(0)}%
              </span>
            )}
          </div>
        </div>

        {/* Content Body: ultra-clean minimalist horizontal row on mobile, card pedestal on desktop */}
        <div className="flex flex-1 min-w-0 flex-col justify-between gap-2 py-2.5 pr-3 sm:p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-mono text-xs sm:text-sm font-bold text-sky-300 shrink-0">
                  ${token.symbol}
                </span>
                <h3 className="truncate text-sm sm:text-base font-bold text-white group-hover:text-sky-300">
                  {token.name}
                </h3>
                {token.verifiedLaunchpad ? (
                  <span className="sm:hidden shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                    Fair
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-xs text-slate-400">
                {meta.data?.description
                  ? meta.data.description
                  : token.curve && !token.curve.graduated
                    ? `Vault ${liquidityXlm.toFixed(1)} XLM · ${grad.percent.toFixed(0)}%`
                    : `Liquidity ${liquidityXlm > 0 ? `${liquidityXlm.toFixed(1)} XLM` : 'Empty'}`}
              </p>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 pr-9 sm:pr-0">
              <Price token={token} />
            </div>
          </div>

          {/* Bottom row: progress hairline + TVL/Arrow */}
          <div className="flex items-center gap-2.5">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-900/90">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isGraduated
                    ? 'bg-gradient-to-r from-emerald-400 to-teal-300'
                    : 'bg-gradient-to-r from-sky-500 via-indigo-400 to-emerald-400'
                }`}
                style={{ width: `${Math.max(4, Math.min(100, grad.percent))}%` }}
              />
            </div>
            <span className="shrink-0 font-mono text-xs tabular-nums text-emerald-300">
              {displayLiquidity === 0n ? '0 XLM' : `${liquidityXlm.toFixed(1)} XLM`}
            </span>
          </div>

          <div className="hidden sm:flex liquid-glass-pill items-center justify-center gap-1.5 rounded-xl py-1.5 text-center text-xs font-semibold text-slate-200 group-hover:text-sky-300 transition">
            <span>
              {isGraduated || !token.verifiedLaunchpad
                ? 'Swap & LP on DEX'
                : 'Play Curve & Win Jackpots'}
            </span>
            <span aria-hidden="true">→</span>
          </div>
        </div>
      </button>

      {/* Sibling Favorite buttons avoid nested interactive <button> inside a primary action */}
      <button
        type="button"
        onClick={() => toggleFav(token.id)}
        aria-label={
          isFav ? `Remove ${token.symbol} from favorites` : `Add ${token.symbol} to favorites`
        }
        aria-pressed={isFav}
        className={`hidden sm:flex absolute top-2.5 right-2.5 z-10 liquid-glass-pill h-9 w-9 items-center justify-center rounded-full transition-transform hover:scale-110 ${
          isFav ? 'border-amber-400/50 text-amber-300' : 'text-white/80 hover:text-white'
        }`}
      >
        {isFav ? '★' : '☆'}
      </button>

      <button
        type="button"
        onClick={() => toggleFav(token.id)}
        aria-label={
          isFav ? `Remove ${token.symbol} from favorites` : `Add ${token.symbol} to favorites`
        }
        aria-pressed={isFav}
        className={`sm:hidden absolute top-2 right-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-slate-950/70 text-xs ${
          isFav ? 'text-amber-300 border-amber-400/40' : 'text-slate-400'
        }`}
      >
        {isFav ? '★' : '☆'}
      </button>
    </li>
  )
}

export function MarketList({
  selectedId,
  onSelect,
  limit,
  showFilters = true,
  mode = 'all',
}: Props) {
  const list = useTokenList()
  const [searchParams, setSearchParams] = useSearchParams()

  const [localQuery, setLocalQuery] = useState('')
  const [localSort, setLocalSort] = useState<MarketSortKey>('graduation')
  const [localFavsOnly, setLocalFavsOnly] = useState(false)
  const [localVerifiedOnly, setLocalVerifiedOnly] = useState(false)
  const [localSection, setLocalSection] = useState<'curves' | 'graduated'>('curves')

  const query = showFilters ? (searchParams.get('q') ?? localQuery) : ''
  const sort = showFilters
    ? ((searchParams.get('sort') as MarketSortKey) || localSort)
    : 'graduation'
  const favsOnly = showFilters
    ? (searchParams.has('favs') ? searchParams.get('favs') === '1' : localFavsOnly)
    : false
  const verifiedOnly = showFilters
    ? (searchParams.has('fair') ? searchParams.get('fair') === '1' : localVerifiedOnly)
    : false
  const section: 'curves' | 'graduated' =
    mode === 'curves'
      ? 'curves'
      : mode === 'graduated'
        ? 'graduated'
        : showFilters
          ? searchParams.get('tab') === 'graduated'
            ? 'graduated'
            : searchParams.get('tab') === 'curves'
              ? 'curves'
              : localSection
          : localSection

  const setQuery = useCallback(
    (newQ: string) => {
      setLocalQuery(newQ)
      if (showFilters) {
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev)
            if (newQ.trim()) next.set('q', newQ)
            else next.delete('q')
            return next
          },
          { replace: true },
        )
      }
    },
    [showFilters, setSearchParams],
  )

  const setSort = useCallback(
    (newSort: MarketSortKey) => {
      setLocalSort(newSort)
      if (showFilters) {
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev)
            if (newSort !== 'graduation') next.set('sort', newSort)
            else next.delete('sort')
            return next
          },
          { replace: true },
        )
      }
    },
    [showFilters, setSearchParams],
  )

  const setFavsOnly = useCallback(
    (newFavs: boolean) => {
      setLocalFavsOnly(newFavs)
      if (showFilters) {
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev)
            if (newFavs) next.set('favs', '1')
            else next.delete('favs')
            return next
          },
          { replace: true },
        )
      }
    },
    [showFilters, setSearchParams],
  )

  const setVerifiedOnly = useCallback(
    (next: boolean) => {
      setLocalVerifiedOnly(next)
      if (showFilters) {
        setSearchParams(
          (prev) => {
            const params = new URLSearchParams(prev)
            if (next) params.set('fair', '1')
            else params.delete('fair')
            return params
          },
          { replace: true },
        )
      }
    },
    [showFilters, setSearchParams],
  )

  const setSection = useCallback(
    (nextSection: 'curves' | 'graduated') => {
      setLocalSection(nextSection)
      if (showFilters) {
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev)
            if (nextSection === 'graduated') next.set('tab', 'graduated')
            else next.delete('tab')
            return next
          },
          { replace: true },
        )
      }
    },
    [showFilters, setSearchParams],
  )

  const resetFilters = useCallback(() => {
    setLocalQuery('')
    setLocalFavsOnly(false)
    setLocalVerifiedOnly(false)
    if (showFilters) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.delete('q')
          next.delete('favs')
          next.delete('fair')
          return next
        },
        { replace: true },
      )
    }
  }, [showFilters, setSearchParams])

  const favorites = useWatchlist((s) => s.favorites)
  const isFavorite = useCallback((id: string) => favorites.includes(id), [favorites])

  const filteredBase = useMemo(() => {
    let result = filterAndSortTokens(list.data ?? [], query, sort)
    if (favsOnly) {
      result = result.filter((t) => isFavorite(t.id))
    }
    if (verifiedOnly) {
      result = result.filter((t) => Boolean(t.verifiedLaunchpad))
    }
    return result
  }, [list.data, query, sort, favsOnly, verifiedOnly, isFavorite])

  const { liveCurves, graduatedDex } = useMemo(
    () => partitionMarketTokens(filteredBase),
    [filteredBase],
  )

  const activeList = section === 'graduated' ? graduatedDex : liveCurves
  const tokens = useMemo(
    () => (typeof limit === 'number' ? activeList.slice(0, limit) : activeList),
    [activeList, limit],
  )
  const otherSectionCount =
    section === 'graduated' ? liveCurves.length : graduatedDex.length

  const trimmedQuery = query.trim()
  const isDirectContract = isValidContractAddress(trimmedQuery)
  const exactMatchInList = tokens.some((t) => t.id === trimmedQuery)

  return (
    <section className="liquid-glass rounded-2xl sm:rounded-3xl p-3.5 sm:p-6 space-y-3.5 sm:space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-semibold truncate">
            {section === 'graduated' ? 'Soroswap DEX Market' : 'Launchpad Arena'}
          </h2>
          <p className="text-xs text-slate-400 truncate">
            {section === 'graduated'
              ? 'Graduated tokens live on Soroswap AMM · Full DEX charts, LP pools & P2P transfers'
              : `Closed bonding curves (1.00× → 4.00×) · ${TOTAL_JACKPOT_TOKENS.toLocaleString('en-US')} token 3-checkpoint jackpots`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void list.refetch()}
          disabled={list.isFetching}
          className="min-h-[36px] shrink-0 rounded-xl border border-slate-800 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-600 disabled:opacity-50"
        >
          {list.isFetching ? 'Syncing…' : 'Refresh'}
        </button>
      </div>

      {list.isPending || (list.data && list.data.length > 0) ? (
        <KingOfTheHill
          tokens={list.data ?? []}
          pending={list.isPending}
          onSelect={onSelect}
        />
      ) : null}

      <div className="flex flex-col gap-2">
        {mode === 'all' ? (
          <div
            role="tablist"
            aria-label="Market sections"
            className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-slate-950/75 p-1.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={section === 'curves'}
              onClick={() => setSection('curves')}
              className={`min-h-[44px] rounded-xl px-3 py-2 text-xs sm:text-sm font-semibold transition ${
                section === 'curves'
                  ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              🔥 Live Curves · Launchpad ({liveCurves.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={section === 'graduated'}
              onClick={() => setSection('graduated')}
              className={`min-h-[44px] rounded-xl px-3 py-2 text-xs sm:text-sm font-semibold transition ${
                section === 'graduated'
                  ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              🎓 Graduated &amp; Soroswap DEX ({graduatedDex.length})
            </button>
          </div>
        ) : null}

        {section === 'graduated' ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/25 bg-emerald-950/20 px-3.5 py-2 text-xs text-emerald-200/90">
            <span>
              Soroswap DEX pools — full Pair History charts, LP liquidity management &amp; instant XLM/token swaps.
            </span>
            {mode === 'graduated' ? (
              <Link
                to="/"
                className="shrink-0 font-bold text-amber-300 hover:underline"
              >
                🔥 {liveCurves.length} in Launchpad →
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/25 bg-amber-950/15 px-3.5 py-2 text-xs text-amber-200/90">
            <span>
              Soft 3-stage fees (0.30%→0.50%→0.25% buy) + 🏆 40,000 Jackpot Ladder (+5K at 250 · +10K at 500 · +25K at 1,000 XLM).
            </span>
            {mode === 'curves' ? (
              <Link
                to="/dex"
                className="shrink-0 rounded-lg border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-1 font-bold text-emerald-200 hover:bg-emerald-500/25 transition"
              >
                🎓 {graduatedDex.length} on Soroswap DEX →
              </Link>
            ) : null}
          </div>
        )}
      </div>

      {showFilters ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="block text-sm">
            <span className="sr-only">Search tokens</span>
            <span className="relative block">
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, symbol, or contract address…"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-3 pr-10 text-base text-slate-100 outline-none focus:border-emerald-500"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-lg text-slate-500 hover:bg-slate-800 hover:text-slate-200"
                >
                  ×
                </button>
              ) : null}
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={verifiedOnly}
              onClick={() => setVerifiedOnly(!verifiedOnly)}
              className={`min-h-[44px] rounded-lg border px-3 py-2 text-xs font-medium transition ${
                verifiedOnly
                  ? 'border-emerald-500/60 bg-emerald-950/40 text-emerald-300'
                  : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
              }`}
            >
              {verifiedOnly ? '✓ Fair Launches Only' : '✓ Fair Only'}
            </button>

            <button
              type="button"
              aria-pressed={favsOnly}
              onClick={() => setFavsOnly(!favsOnly)}
              className={`min-h-[44px] rounded-lg border px-3 py-2 text-xs font-medium transition ${
                favsOnly
                  ? 'border-amber-500/60 bg-amber-950/40 text-amber-300'
                  : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
              }`}
            >
              {favsOnly ? '★ Favorites Only' : '☆ All'}
            </button>

            <label className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className="sr-only sm:not-sr-only">Sort by</span>
              <select
                value={sort}
                onChange={(event) =>
                  setSort(event.target.value as MarketSortKey)
                }
                aria-label="Sort tokens"
                className="min-h-[44px] rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-2 text-base sm:text-sm text-slate-200 outline-none focus:border-emerald-500"
              >
                {MARKET_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      ) : null}

      <p aria-live="polite" className="min-h-[16px] text-xs text-slate-400 tabular-nums">
        {list.data ? (
          <>
            Showing {tokens.length}{' '}
            {section === 'graduated' ? 'graduated / DEX pairs' : 'live curves'}
            {query ? ` for “${query.trim()}”` : ''}
          </>
        ) : (
          'Syncing on-chain market…'
        )}
      </p>

      {list.isPending ? (
        <ul
          aria-hidden="true"
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4"
        >
          {Array.from({ length: limit ?? 4 }).map((_, idx) => (
            <li
              key={idx}
              className="flex flex-row sm:flex-col overflow-hidden rounded-2xl sm:rounded-3xl border border-slate-800/80 bg-slate-900/40"
            >
              <div className="h-16 w-16 m-3 rounded-xl sm:m-0 sm:rounded-none sm:h-36 sm:w-full shrink-0 animate-pulse bg-slate-800/60" />
              <div className="flex-1 space-y-2 py-3 pr-3 sm:p-4">
                <div className="h-4 w-28 animate-pulse rounded bg-slate-800" />
                <div className="h-3 w-40 animate-pulse rounded bg-slate-800/70" />
                <div className="h-2 w-full animate-pulse rounded bg-slate-800/50" />
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {isDirectContract && !exactMatchInList ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-800/80 bg-emerald-950/20 px-4 py-3 text-sm">
          <div className="min-w-0">
            <p className="font-medium text-emerald-200">
              Soroban Contract Detected ({shortAddress(trimmedQuery)})
            </p>
            <p className="truncate font-mono text-xs text-slate-400">
              {trimmedQuery}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              onSelect({
                id: trimmedQuery,
                decimals: 7,
                symbol: shortAddress(trimmedQuery),
              })
            }
            className="min-h-[40px] shrink-0 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-medium text-slate-950 hover:bg-emerald-400"
          >
            Open token directly →
          </button>
        </div>
      ) : null}

      {list.isError ? (
        <div className="mt-4 rounded-lg border border-rose-900 bg-rose-950/40 px-3 py-2 text-sm text-rose-300">
          Unable to read market: {list.error.message}
        </div>
      ) : null}

      {list.data && list.data.length === 0 ? (
        <p className="mt-4 text-sm text-slate-400">
          No new pairs discovered in the recent ledger window. Launch a token to premiere the market.
        </p>
      ) : null}

      {list.data && list.data.length > 0 && tokens.length === 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
          <div className="space-y-1">
            <p>
              {query || favsOnly || verifiedOnly
                ? `No ${section === 'graduated' ? 'graduated or DEX pairs' : 'live bonding curves'} match your filters.`
                : section === 'curves'
                  ? 'No active bonding curve launches right now.'
                  : 'No graduated or DEX pairs discovered yet.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {otherSectionCount > 0 ? (
              mode === 'curves' ? (
                <Link
                  to="/dex"
                  className="min-h-[40px] inline-flex items-center rounded-xl bg-emerald-500/20 border border-emerald-500/40 px-3.5 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/30"
                >
                  View {otherSectionCount} in 🎓 Soroswap DEX →
                </Link>
              ) : mode === 'graduated' ? (
                <Link
                  to="/"
                  className="min-h-[40px] inline-flex items-center rounded-xl bg-amber-500/20 border border-amber-500/40 px-3.5 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/30"
                >
                  View {otherSectionCount} in 🔥 Live Curves →
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    setSection(section === 'graduated' ? 'curves' : 'graduated')
                  }
                  className="min-h-[40px] rounded-xl bg-emerald-500/20 border border-emerald-500/40 px-3.5 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/30"
                >
                  View {otherSectionCount} in{' '}
                  {section === 'graduated' ? '🔥 Live Curves' : '🎓 Graduated & DEX'} →
                </button>
              )
            ) : null}
            {section === 'curves' && !query && !favsOnly && !verifiedOnly ? (
              <Link
                to="/create"
                className="min-h-[40px] inline-flex items-center rounded-xl bg-amber-400 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-300"
              >
                🚀 Launch Coin →
              </Link>
            ) : null}
            {(query || favsOnly || verifiedOnly) ? (
              <button
                type="button"
                onClick={resetFilters}
                className="min-h-[40px] rounded-xl border border-slate-700 px-3 py-2 text-xs font-medium text-emerald-400 hover:border-emerald-500"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {tokens.length > 0 ? (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {tokens.map((token) => (
            <MarketCard
              key={token.id}
              token={token}
              selected={token.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </section>
  )
}
