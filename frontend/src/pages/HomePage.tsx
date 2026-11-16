import { Link, useNavigate } from 'react-router'
import { MarketList } from '../components/MarketList'
import type { LaunchpadToken } from '../lib/token'
import { useWallet } from '../store/wallet'

/**
 * Minimalist mobile-first market feed: spacious hierarchy, clean cards,
 * and immediate entry to launch a new coin.
 */
export function HomePage() {
  const navigate = useNavigate()
  const publicKey = useWallet((state) => state.publicKey)

  function openToken(token: LaunchpadToken) {
    navigate(`/token/${token.id}`)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black sm:text-3xl text-white tracking-tight">
            Memecoin Market
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Fair Stellar launches on Soroban · 100% LP burned.
          </p>
        </div>

        <Link
          to="/create"
          className="inline-flex min-h-[46px] shrink-0 items-center justify-center rounded-2xl bg-gradient-to-r from-sky-500 to-cyan-500 px-5 py-2.5 text-sm font-black text-slate-950 shadow-lg shadow-sky-500/20 hover:from-sky-400 hover:to-cyan-400 transition-all active:scale-[0.99]"
        >
          🚀 Launch Coin
        </Link>
      </div>

      {!publicKey ? (
        <div className="rounded-2xl border border-sky-500/20 bg-slate-900/50 px-4 py-3 text-xs sm:text-sm text-slate-300">
          Tap <strong className="text-emerald-300">⚡ Wallet</strong> to create your encrypted Stellar wallet, or try <strong className="text-sky-200">Testnet Demo</strong> for instant free funds.
        </div>
      ) : null}

      <MarketList selectedId={null} onSelect={openToken} />
    </div>
  )
}
