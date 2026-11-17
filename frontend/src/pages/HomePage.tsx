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
    </div>
  )
}
