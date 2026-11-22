import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router'
import { MarketList } from '../components/MarketList'
import { useTokenList } from '../hooks/useTokenList'
import { useXlmUsdPrice } from '../hooks/useXlmUsdPrice'
import { buildAstroDexMarketUrl } from '../lib/ecosystem'
import { partitionMarketTokens } from '../lib/market'
import { formatUsdPrice } from '../lib/soroswap'
import type { LaunchpadToken } from '../lib/token'
import { DEFAULT_XLM_USD_PRICE } from '../lib/xlm'

/**
 * Dedicated Soroswap DEX market (`/dex`) for graduated Launchpad tokens and
 * live AMM liquidity pools, intentionally separated from the closed bonding curve game.
 */
export function DexPage() {
  const navigate = useNavigate()
  const list = useTokenList()
  const { data: xlmUsd = DEFAULT_XLM_USD_PRICE } = useXlmUsdPrice()

  const { liveCurves, graduatedDex } = useMemo(
    () => partitionMarketTokens(list.data ?? []),
    [list.data],
  )

  const totalDexXlm = useMemo(() => {
    const stroops = graduatedDex.reduce((sum, t) => sum + t.pool.reserveXlm, 0n)
    return Number(stroops) / 1e7
  }, [graduatedDex])

  const totalDexUsd = totalDexXlm * xlmUsd
  const astroDexUrl = buildAstroDexMarketUrl()

  function openToken(token: LaunchpadToken) {
    navigate(`/token/${token.id}`)
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="rounded-2xl sm:rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-emerald-950/40 via-slate-900/80 to-cyan-950/35 p-4 sm:p-5 shadow-lg space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
                🎓 Soroswap AMM Connected
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/35 bg-sky-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-sky-300">
                🛡️ 7-Year LP Lock
              </span>
            </div>
            <h1 className="text-xl font-black sm:text-3xl text-white tracking-tight truncate">
              Soroswap DEX Market
            </h1>
            <p className="text-xs sm:text-sm text-slate-300">
              Graduated tokens trading on open Soroswap liquidity pools · 0.30% LP fee, Pair History charts &amp; P2P transfers
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {astroDexUrl ? (
              <a
                href={astroDexUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-[40px] sm:min-h-[44px] shrink-0 items-center justify-center rounded-xl sm:rounded-2xl border border-cyan-400/45 bg-cyan-500/15 px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-bold text-cyan-200 hover:bg-cyan-500/25 transition whitespace-nowrap"
              >
                📊 Pro Terminal on AstroDex
              </a>
            ) : null}
            <Link
              to="/"
              className="inline-flex min-h-[40px] sm:min-h-[44px] shrink-0 items-center justify-center rounded-xl sm:rounded-2xl border border-amber-400/40 bg-amber-500/15 px-3.5 sm:px-4 py-2 text-xs sm:text-sm font-bold text-amber-200 hover:bg-amber-500/25 transition whitespace-nowrap"
            >
              🔥 Live Curves ({liveCurves.length})
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs font-mono tabular-nums">
          <div className="rounded-xl border border-emerald-500/20 bg-slate-950/60 px-3 py-2">
            <p className="font-sans text-[11px] text-slate-400">Graduated Tokens</p>
            <p className="mt-0.5 text-base font-black text-emerald-300">
              {graduatedDex.length}
            </p>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-slate-950/60 px-3 py-2">
            <p className="font-sans text-[11px] text-slate-400">DEX Pool Reserves</p>
            <p className="mt-0.5 text-base font-black text-white">
              {totalDexXlm.toFixed(1)} XLM
            </p>
          </div>
          <div className="col-span-2 sm:col-span-1 rounded-xl border border-emerald-500/20 bg-slate-950/60 px-3 py-2">
            <p className="font-sans text-[11px] text-slate-400">Est. Pool TVL (USD)</p>
            <p className="mt-0.5 text-base font-black text-cyan-300">
              ≈ ${formatUsdPrice(totalDexUsd)}
            </p>
          </div>
        </div>
      </div>

      <MarketList selectedId={null} onSelect={openToken} mode="graduated" />
    </div>
  )
}
