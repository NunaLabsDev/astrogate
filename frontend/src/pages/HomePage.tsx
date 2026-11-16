import { Link, useNavigate } from 'react-router'
import { MarketList } from '../components/MarketList'
import type { LaunchpadToken } from '../lib/token'

/**
 * Direct Pump.fun-style fair-launch market feed: spotlight leader, search,
 * verified fair-launch filters, and immediate entry to launch a new coin.
 */
export function HomePage() {
  const navigate = useNavigate()

  function openToken(token: LaunchpadToken) {
    navigate(`/token/${token.id}`)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="liquid-glass-pill rounded-full px-3 py-1 text-xs font-semibold text-sky-300">
              ✦ Soroban Fair Launch
            </span>
            <span className="text-xs font-mono text-slate-500">Testnet</span>
          </div>
          <h1 className="mt-2 text-2xl font-black sm:text-3xl text-white tracking-tight">
            Memecoin Market
          </h1>
          <p className="mt-1 max-w-2xl text-xs sm:text-sm text-slate-400">
            10M fixed supply · Fair-Flywheel Curve (1,250 vXLM → 1,000 XLM) · 29.7% Proof-of-Burn · 100% LP burned on Soroswap.
          </p>
        </div>

        <Link
          to="/create"
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl bg-gradient-to-r from-sky-500 to-cyan-500 px-5 py-2.5 text-sm font-black text-slate-950 shadow-lg shadow-sky-500/20 hover:from-sky-400 hover:to-cyan-400 transition-all active:scale-[0.99]"
        >
          🚀 Launch Coin
        </Link>
      </div>

      <div className="rounded-2xl border border-sky-500/20 bg-slate-900/50 px-4 py-3 text-xs text-slate-300 flex flex-wrap items-center justify-between gap-2">
        <span>
          🧪 <strong className="text-sky-300">Testnet Quick Start:</strong> Switch Freighter/xBull to <strong className="text-white">TESTNET</strong> (or tap <strong className="text-sky-200">Testnet Demo</strong>) · Need test funds? Use <strong className="text-amber-300">🚰 +10K XLM</strong> · Zero oracles, 100% on-chain Soroban.
        </span>
        <span className="font-mono text-[11px] text-slate-400">
          45% Curve · 25% Soroswap · 29.7% Burn · 0.3% 15d Vesting
        </span>
      </div>

      <MarketList selectedId={null} onSelect={openToken} />
    </div>
  )
}
