import { Link, useNavigate } from 'react-router'
import { MarketList } from '../components/MarketList'
import type { LaunchpadToken } from '../lib/token'

/**
 * Minimalist Telegram-first market feed: compact single-row header,
 * zero layout shift spotlight, and scannable token cards.
 */
export function HomePage() {
  const navigate = useNavigate()

  function openToken(token: LaunchpadToken) {
    navigate(`/token/${token.id}`)
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      <div className="flex items-center justify-between gap-3 px-0.5">
        <div className="min-w-0">
          <h1 className="text-xl font-black sm:text-3xl text-white tracking-tight truncate">
            Memecoin Market
          </h1>
          <p className="text-xs sm:text-sm text-slate-400 truncate">
            Fair Soroban launches · 100% LP burned
          </p>
        </div>

        <Link
          to="/create"
          className="inline-flex min-h-[40px] sm:min-h-[44px] shrink-0 items-center justify-center rounded-xl sm:rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-500 px-3.5 sm:px-5 py-2 text-xs sm:text-sm font-black text-slate-950 shadow-lg shadow-sky-500/20 hover:from-sky-400 hover:to-cyan-400 transition-all active:scale-[0.99] whitespace-nowrap"
        >
          🚀 Launch Coin
        </Link>
      </div>

          <MarketList selectedId={null} onSelect={openToken} />

      <Link
        to="/sorobits"
        className="flex items-center justify-between gap-3 rounded-2xl border border-cyan-400/20 bg-slate-900/70 px-3.5 py-2.5 backdrop-blur-md transition-colors hover:border-cyan-400/45 hover:bg-slate-900"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex -space-x-1.5 shrink-0">
            {(['pioneer', 'launcher', 'graduate', 'legend'] as const).map((slug) => (
              <img
                key={slug}
                src={`/badges/${slug}.png`}
                alt=""
                width={32}
                height={32}
                className="h-8 w-8 rounded-lg border border-slate-800 bg-slate-950"
                style={{ imageRendering: 'pixelated' }}
              />
            ))}
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs sm:text-sm font-bold text-white">
              Sorobits (SBIT) · 100% On-Chain 32×32 NFTs
            </p>
            <p className="truncate text-[11px] text-slate-400">
              Season-1 Stellar Heritage collection stored in Soroban
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-xl bg-cyan-500/15 px-2.5 py-1 text-xs font-bold text-cyan-300 border border-cyan-400/30">
          Explore →
        </span>
      </Link>
    </div>
  )
}
