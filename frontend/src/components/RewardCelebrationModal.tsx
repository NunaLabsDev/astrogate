import { Link } from 'react-router'
import { explorerTxUrl } from '../lib/explorer'
import {
  CROWN_JACKPOT_TOKENS,
  GRADUATION_JACKPOT_TOKENS,
  SPARK_JACKPOT_TOKENS,
} from '../lib/tokenomics'

export type CurveRewardCelebration = {
  graduated: boolean
  rewardTokens: number
  boughtTokensFormatted: string
  spentXlmFormatted: string
  wonSpark: boolean
  wonCrown: boolean
  wonGrad: boolean
  reasonTitle: string
  reasonDetail: string
  txHash?: string
}

export function RewardCelebrationModal({
  celebration,
  symbol,
  onClose,
}: {
  celebration: CurveRewardCelebration
  symbol: string
  onClose: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="reward-celebration-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-3xl border border-amber-400/60 bg-gradient-to-br from-slate-900 via-slate-950 to-emerald-950/80 p-5 sm:p-6 shadow-2xl shadow-amber-500/20 text-center space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close reward popup"
          className="absolute right-3.5 top-3.5 flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 bg-slate-900/80 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          ×
        </button>

        {/* Animated Sorobits Mascot + Victory Banner Stage */}
        <div className="relative mx-auto flex h-32 w-56 items-center justify-center">
          <div className="absolute h-28 w-28 rounded-full bg-amber-400/20 blur-xl animate-pulse" />
          <div className="absolute h-24 w-24 rounded-full border border-emerald-400/40 animate-ping" />

          <span
            aria-hidden="true"
            className="animate-confetti-float absolute left-3 top-2 text-lg"
          >
            ✨
          </span>
          <span
            aria-hidden="true"
            className="animate-confetti-float absolute right-4 top-1 text-lg"
          >
            🚀
          </span>
          <span
            aria-hidden="true"
            className="animate-confetti-float absolute left-5 bottom-3 text-base"
          >
            🪙
          </span>

          <div className="animate-mascot-wave relative z-10 flex items-end gap-1.5">
            <div className="relative rounded-2xl border-2 border-amber-400/80 bg-slate-950 p-1.5 shadow-lg shadow-amber-500/30">
              <img
                src="/badges/pioneer.png"
                alt="Sorobits Pioneer Mascot"
                width={76}
                height={76}
                className="h-18 w-18 rounded-xl"
                style={{ imageRendering: 'pixelated' }}
              />
            </div>

            <div className="animate-flag-flutter -ml-2 mb-1 flex flex-col items-center">
              <span className="rounded-lg border border-emerald-400/70 bg-emerald-500/25 px-2 py-0.5 text-[10px] font-black text-emerald-200 shadow">
                {celebration.graduated ? '🎓 DEX!' : '🏆 WIN!'}
              </span>
              <span aria-hidden="true" className="text-2xl leading-none mt-0.5">
                🏁
              </span>
            </div>
          </div>

          {celebration.graduated ? (
            <img
              src="/badges/graduate.png"
              alt="Graduate Badge"
              width={40}
              height={40}
              className="animate-bounce absolute right-2 bottom-2 h-10 w-10 rounded-xl border border-emerald-400/70 bg-slate-950 shadow-md"
              style={{ imageRendering: 'pixelated' }}
            />
          ) : null}
        </div>

        {/* Reward Headline & Amount */}
        <div className="space-y-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-500/20 px-3 py-0.5 text-[11px] font-black uppercase tracking-wider text-amber-300">
            🎁 On-Chain Bonus Unlocked
          </span>
          <p className="font-mono text-3xl sm:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-yellow-200 to-emerald-300 tabular-nums">
            {`+${celebration.rewardTokens.toLocaleString('en-US')} $${symbol}`}
          </p>
          <h2
            id="reward-celebration-title"
            className="text-base sm:text-lg font-extrabold text-white"
          >
            {celebration.reasonTitle}
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed">
            {celebration.reasonDetail}
          </p>
        </div>

        {/* Breakdown Pills */}
        <div className="rounded-2xl border border-slate-800 bg-slate-950/75 p-3 text-xs space-y-2">
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {celebration.wonSpark ? (
              <span className="rounded-lg border border-emerald-400/50 bg-emerald-500/15 px-2 py-0.5 font-mono font-bold text-emerald-300">
                ⚡ +{SPARK_JACKPOT_TOKENS.toLocaleString('en-US')} Spark (250 XLM)
              </span>
            ) : null}
            {celebration.wonCrown ? (
              <span className="rounded-lg border border-indigo-400/50 bg-indigo-500/15 px-2 py-0.5 font-mono font-bold text-indigo-200">
                👑 +{CROWN_JACKPOT_TOKENS.toLocaleString('en-US')} Crown (500 XLM)
              </span>
            ) : null}
            {celebration.wonGrad ? (
              <span className="rounded-lg border border-amber-400/60 bg-amber-500/20 px-2 py-0.5 font-mono font-bold text-amber-200">
                🏆 +{GRADUATION_JACKPOT_TOKENS.toLocaleString('en-US')} Graduation (1,000 XLM)
              </span>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-slate-800/80 pt-2 font-mono text-[11px] text-slate-300">
            <span>Curve purchase ({celebration.spentXlmFormatted} XLM)</span>
            <span className="font-bold text-white">
              {celebration.boughtTokensFormatted} ${symbol}
            </span>
          </div>
          <div className="flex items-center justify-between gap-2 font-mono text-[11px] text-amber-300">
            <span>Checkpoint jackpot bonus</span>
            <span className="font-black">
              +{celebration.rewardTokens.toLocaleString('en-US')} ${symbol}
            </span>
          </div>
        </div>

        {/* CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[42px] flex-1 rounded-xl bg-gradient-to-r from-amber-400 to-emerald-400 px-4 py-2 text-xs sm:text-sm font-black text-slate-950 shadow-lg hover:brightness-105 transition"
          >
            🎉 Awesome! Continue
          </button>
          {celebration.graduated ? (
            <Link
              to="/dex"
              onClick={onClose}
              className="min-h-[42px] inline-flex items-center justify-center rounded-xl border border-emerald-400/50 bg-emerald-500/20 px-3.5 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-500/30 transition"
            >
              🎓 Soroswap DEX →
            </Link>
          ) : null}
        </div>

        {celebration.txHash ? (
          <a
            href={explorerTxUrl(celebration.txHash)}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-[11px] font-mono text-sky-400 hover:underline"
          >
            Verify reward transaction on Stellar Explorer ↗
          </a>
        ) : null}
      </div>
    </div>
  )
}
