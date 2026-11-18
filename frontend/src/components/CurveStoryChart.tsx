import { useMemo, useState } from 'react'
import type { CurveState } from '../lib/token'
import { classifyTokenEvent, type TokenEvent } from '../lib/token-events'
import { formatAmount } from '../lib/format'
import {
  CROWN_JACKPOT_TOKENS,
  curveStageInfo,
  GRADUATION_JACKPOT_TOKENS,
  GRADUATION_TARGET_XLM,
  sanitizeXlmUsdPrice,
  SPARK_JACKPOT_TOKENS,
  STAGE_1_XLM,
  STAGE_2_XLM,
} from '../lib/tokenomics'
import { DEFAULT_XLM_USD_PRICE } from '../lib/xlm'

const SVG_W = 600
const SVG_H = 195
const PAD_L = 18
const PAD_R = 18
const PAD_T = 24
const PAD_B = 28

const PREVIEW_CHECKPOINTS = [
  {
    xlm: 250,
    pctLabel: '25%',
    title: '⚡ 250 XLM · Spark',
    prizeTokens: SPARK_JACKPOT_TOKENS,
    zoneFee: '0.30%→0.50% buy · 1.20%→1.80% sell',
  },
  {
    xlm: 500,
    pctLabel: '50%',
    title: '👑 500 XLM · Crown',
    prizeTokens: CROWN_JACKPOT_TOKENS,
    zoneFee: '0.50%→0.25% buy · 1.80%→1.50% sell',
  },
  {
    xlm: 750,
    pctLabel: '75%',
    title: '🔥 750 XLM · Sprint',
    prizeTokens: 0,
    zoneFee: '0.25% sprint buy · 1.50% sell',
  },
  {
    xlm: 1_000,
    pctLabel: '100%',
    title: '🏆 1,000 XLM · DEX',
    prizeTokens: GRADUATION_JACKPOT_TOKENS,
    zoneFee: 'Graduates to Soroswap AMM (0.30% LP)',
  },
] as const

/** Exact bonding-curve spot multiplier (1.00x at 0 XLM -> 4.00x at 1,000 XLM). */
function spotMultiplierAtXlm(xlmNet: number): number {
  const clamped = Math.max(0, Math.min(GRADUATION_TARGET_XLM, xlmNet))
  const ratio = (1_000 + clamped) / 1_000
  return ratio * ratio
}

function toChartXY(xlmNet: number): { x: number; y: number; mult: number } {
  const clamped = Math.max(0, Math.min(GRADUATION_TARGET_XLM, xlmNet))
  const t = clamped / GRADUATION_TARGET_XLM
  const mult = spotMultiplierAtXlm(clamped)
  const normY = (mult - 1) / 3 // 0 at 1.00x, 1 at 4.00x
  const innerW = SVG_W - PAD_L - PAD_R
  const innerH = SVG_H - PAD_T - PAD_B
  return {
    x: PAD_L + t * innerW,
    y: PAD_T + (1 - normY) * innerH,
    mult,
  }
}

export function CurveStoryChart({
  curve,
  symbol = 'TOKEN',
  decimals = 7,
  events = [],
  xlmUsd = DEFAULT_XLM_USD_PRICE,
}: {
  curve: CurveState
  symbol?: string
  decimals?: number
  events?: TokenEvent[]
  xlmUsd?: number
}) {
  const safeUsd = sanitizeXlmUsdPrice(xlmUsd)
  const [selectedCheckpointXlm, setSelectedCheckpointXlm] = useState<number | null>(null)
  const stage = useMemo(
    () => curveStageInfo(curve.curve_xlm_net, curve.burn_milestone_stage),
    [curve.curve_xlm_net, curve.burn_milestone_stage],
  )
  const currentPos = useMemo(
    () => toChartXY(stage.currentXlm),
    [stage.currentXlm],
  )

  const curvePath = useMemo(() => {
    const pts: string[] = []
    const steps = 40
    for (let i = 0; i <= steps; i++) {
      const xlm = (GRADUATION_TARGET_XLM * i) / steps
      const { x, y } = toChartXY(xlm)
      pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`)
    }
    return pts.join(' ')
  }, [])

  const filledAreaPath = useMemo(() => {
    const targetXlm = Math.max(5, Math.min(GRADUATION_TARGET_XLM, stage.currentXlm))
    const steps = 28
    const baseY = SVG_H - PAD_B
    const pts: string[] = [`M${PAD_L},${baseY}`]
    for (let i = 0; i <= steps; i++) {
      const xlm = (targetXlm * i) / steps
      const { x, y } = toChartXY(xlm)
      pts.push(`L${x.toFixed(1)},${y.toFixed(1)}`)
    }
    pts.push(`L${currentPos.x.toFixed(1)},${baseY} Z`)
    return pts.join(' ')
  }, [stage.currentXlm, currentPos.x])

  const trades = useMemo(() => {
    return events.filter((ev) => {
      const role = classifyTokenEvent(ev, null)
      return role === 'buy' || role === 'sell'
    })
  }, [events])

  const buyCount = useMemo(
    () => trades.filter((ev) => classifyTokenEvent(ev, null) === 'buy').length,
    [trades],
  )
  const sellCount = useMemo(
    () => trades.filter((ev) => classifyTokenEvent(ev, null) === 'sell').length,
    [trades],
  )

  const remainingUpsidePct = Math.max(
    0,
    ((4 / Math.max(1, currentPos.mult)) - 1) * 100,
  )
  const stage1Pos = toChartXY(STAGE_1_XLM)
  const stage2Pos = toChartXY(STAGE_2_XLM)
  const goalPos = toChartXY(GRADUATION_TARGET_XLM)
  const previewPos =
    selectedCheckpointXlm !== null ? toChartXY(selectedCheckpointXlm) : null
  const previewMeta =
    selectedCheckpointXlm !== null
      ? PREVIEW_CHECKPOINTS.find((c) => c.xlm === selectedCheckpointXlm) ?? null
      : null

  const deltaToNextCheckpoint = Math.max(0, stage.nextCheckpointTargetXlm - stage.currentXlm)

  const stages = [
    {
      num: 1 as const,
      title: '🌱 Spark Ignition',
      range: '0 – 250 XLM (0–25%)',
      buy: '0.30%',
      sell: '1.20%',
      perk: stage.sparkClaimed
        ? `⚡ +${SPARK_JACKPOT_TOKENS.toLocaleString('en-US')} Spark Claimed ✓`
        : `⚡ Hit 250 XLM → +${SPARK_JACKPOT_TOKENS.toLocaleString('en-US')} Spark`,
      activeCls: 'border-emerald-400/70 bg-emerald-950/35 ring-1 ring-emerald-400/30',
    },
    {
      num: 2 as const,
      title: '👑 Crown Rush',
      range: '250 – 500 XLM (25–50%)',
      buy: '0.50%',
      sell: '1.80%',
      perk: stage.crownClaimed
        ? `👑 +${CROWN_JACKPOT_TOKENS.toLocaleString('en-US')} Crown Claimed ✓`
        : `👑 Hit 500 XLM → +${CROWN_JACKPOT_TOKENS.toLocaleString('en-US')} Crown`,
      activeCls: 'border-indigo-400/70 bg-indigo-950/35 ring-1 ring-indigo-400/30',
    },
    {
      num: 3 as const,
      title: '🔥 Final Sprint',
      range: '500 – 1,000 XLM (50–100%)',
      buy: '0.25%',
      sell: '1.50%',
      perk: `🏆 Hit 1,000 XLM → +${GRADUATION_JACKPOT_TOKENS.toLocaleString('en-US')} Jackpot`,
      activeCls: 'border-amber-400/70 bg-amber-950/35 ring-1 ring-amber-400/30',
    },
  ]

  return (
    <section className="rounded-2xl border border-sky-500/30 bg-gradient-to-br from-slate-900/90 via-slate-950/90 to-indigo-950/35 p-4 sm:p-5 shadow-lg space-y-4 overflow-hidden">
      {/* Top Arena Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/40 bg-sky-500/15 px-2.5 py-0.5 text-[11px] font-bold text-sky-300">
              🚀 Closed Launchpad Arena
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/40 bg-amber-500/15 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
              {stage.badge}
            </span>
          </div>
          <div className="flex flex-wrap items-baseline gap-2.5 tabular-nums pt-0.5">
            <span className="font-mono text-2xl sm:text-3xl font-black text-white">
              {currentPos.mult.toFixed(2)}×
            </span>
            <span className="text-xs font-mono text-emerald-300 font-semibold">
              → 4.00× at Soroswap (+{remainingUpsidePct.toFixed(0)}% curve left)
            </span>
          </div>
          <p className="text-xs text-slate-400 font-mono tabular-nums">
            {stage.currentXlm.toFixed(1)} / {GRADUATION_TARGET_XLM} XLM funded (≈ $
            {(stage.currentXlm * safeUsd).toFixed(2)} USDC) ·{' '}
            <span className="text-amber-300 font-semibold">
              Next prize in {deltaToNextCheckpoint.toFixed(1)} XLM ({stage.nextCheckpointLabel}{' '}
              +{stage.nextCheckpointRewardTokens.toLocaleString('en-US')} ${symbol})
            </span>
          </p>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 px-3 py-2 text-right font-mono tabular-nums shrink-0">
          <p className="text-[10px] uppercase tracking-wider text-amber-300 font-bold">
            🎁 Next Checkpoint Prize
          </p>
          <p className="text-sm font-black text-white">
            +{stage.nextCheckpointRewardTokens.toLocaleString('en-US')} ${symbol}
          </p>
          <p className="text-[10px] text-slate-400">
            At {stage.nextCheckpointTargetXlm} XLM · 40K ladder
          </p>
        </div>
      </div>

      {/* Gamified 3-Zone SVG Bonding Curve */}
      <div className="relative rounded-xl border border-slate-800/90 bg-slate-950/90 p-2 sm:p-3">
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          role="img"
          aria-label={`Bonding curve progress ${stage.progressPercent.toFixed(1)}%, current multiplier ${currentPos.mult.toFixed(2)}x`}
          className="h-44 sm:h-48 w-full block overflow-visible"
        >
          <defs>
            <linearGradient id="curveFillGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.42" />
              <stop offset="45%" stopColor="#38bdf8" stopOpacity="0.38" />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.48" />
            </linearGradient>
            <linearGradient id="curveStrokeGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#34d399" />
              <stop offset="45%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#fbbf24" />
            </linearGradient>
          </defs>

          {/* 3-Zone Background Bands */}
          <rect
            x={PAD_L}
            y={PAD_T}
            width={stage1Pos.x - PAD_L}
            height={SVG_H - PAD_T - PAD_B}
            fill="#10b981"
            opacity="0.08"
          />
          <rect
            x={stage1Pos.x}
            y={PAD_T}
            width={stage2Pos.x - stage1Pos.x}
            height={SVG_H - PAD_T - PAD_B}
            fill="#6366f1"
            opacity="0.08"
          />
          <rect
            x={stage2Pos.x}
            y={PAD_T}
            width={goalPos.x - stage2Pos.x}
            height={SVG_H - PAD_T - PAD_B}
            fill="#f59e0b"
            opacity="0.1"
          />

          {/* Zone Labels */}
          <text
            x={(PAD_L + stage1Pos.x) / 2}
            y={15}
            fill="#6ee7b7"
            fontSize="10"
            fontWeight="bold"
            textAnchor="middle"
          >
            🌱 0.30% · +5K
          </text>
          <text
            x={(stage1Pos.x + stage2Pos.x) / 2}
            y={15}
            fill="#a5b4fc"
            fontSize="10"
            fontWeight="bold"
            textAnchor="middle"
          >
            👑 0.50% · +10K
          </text>
          <text
            x={(stage2Pos.x + goalPos.x) / 2}
            y={15}
            fill="#fcd34d"
            fontSize="10"
            fontWeight="bold"
            textAnchor="middle"
          >
            🔥 0.25% Sprint · 🏆 +25K
          </text>

          {/* Stage Dividers */}
          <line
            x1={stage1Pos.x}
            y1={PAD_T}
            x2={stage1Pos.x}
            y2={SVG_H - PAD_B}
            stroke="#334155"
            strokeDasharray="3 3"
          />
          <line
            x1={stage2Pos.x}
            y1={PAD_T}
            x2={stage2Pos.x}
            y2={SVG_H - PAD_B}
            stroke="#334155"
            strokeDasharray="3 3"
          />

          {/* Ghost Full Curve Track */}
          <path
            d={curvePath}
            fill="none"
            stroke="#334155"
            strokeWidth="2.5"
            strokeDasharray="5 5"
          />

          {/* Filled Curve Progress Area */}
          <path d={filledAreaPath} fill="url(#curveFillGrad)" />

          {/* Active Solid Curve Line up to current point */}
          <path
            d={curvePath}
            fill="none"
            stroke="url(#curveStrokeGrad)"
            strokeWidth="3"
            strokeLinecap="round"
            opacity="0.85"
          />

          {/* Checkpoint Beacons: 250 XLM Spark (+5K), 500 XLM Crown (+10K), 1,000 XLM Grad (+25K) */}
          <circle
            cx={stage1Pos.x}
            cy={stage1Pos.y}
            r="5"
            fill={stage.sparkClaimed ? '#10b981' : '#34d399'}
            stroke="#0f172a"
            strokeWidth="2"
          />
          <text
            x={stage1Pos.x}
            y={stage1Pos.y - 10}
            fill={stage.sparkClaimed ? '#6ee7b7' : '#a7f3d0'}
            fontSize="9.5"
            fontWeight="bold"
            textAnchor="middle"
          >
            {stage.sparkClaimed ? '⚡+5K ✓' : '⚡+5K'}
          </text>

          <circle
            cx={stage2Pos.x}
            cy={stage2Pos.y}
            r="5"
            fill={stage.crownClaimed ? '#10b981' : '#818cf8'}
            stroke="#0f172a"
            strokeWidth="2"
          />
          <text
            x={stage2Pos.x}
            y={stage2Pos.y - 10}
            fill={stage.crownClaimed ? '#6ee7b7' : '#c7d2fe'}
            fontSize="9.5"
            fontWeight="bold"
            textAnchor="middle"
          >
            {stage.crownClaimed ? '👑+10K ✓' : '👑+10K'}
          </text>

          <circle
            cx={goalPos.x}
            cy={goalPos.y}
            r="6"
            fill="#fbbf24"
            stroke="#0f172a"
            strokeWidth="2"
          />
          <text
            x={goalPos.x - 6}
            y={goalPos.y - 10}
            fill="#fbbf24"
            fontSize="10"
            fontWeight="bold"
            textAnchor="end"
          >
            🏆 DEX 4.00× (+25K)
          </text>

          {/* Optional Interactive Preview Marker */}
          {previewPos && previewMeta ? (
            <g>
              <line
                x1={previewPos.x}
                y1={PAD_T}
                x2={previewPos.x}
                y2={SVG_H - PAD_B}
                stroke="#f472b6"
                strokeWidth="1.5"
                strokeDasharray="3 2"
              />
              <circle
                cx={previewPos.x}
                cy={previewPos.y}
                r="6.5"
                fill="#f472b6"
                stroke="#ffffff"
                strokeWidth="2"
              />
            </g>
          ) : null}

          {/* Live Current Position Rocket Pin */}
          <line
            x1={currentPos.x}
            y1={currentPos.y}
            x2={currentPos.x}
            y2={SVG_H - PAD_B}
            stroke="#38bdf8"
            strokeWidth="1.5"
            strokeDasharray="2 2"
          />
          <circle
            cx={currentPos.x}
            cy={currentPos.y}
            r="11"
            fill="#38bdf8"
            opacity="0.22"
          />
          <circle
            cx={currentPos.x}
            cy={currentPos.y}
            r="5.5"
            fill="#38bdf8"
            stroke="#ffffff"
            strokeWidth="2"
          />
          <text
            x={Math.min(SVG_W - 70, Math.max(54, currentPos.x))}
            y={Math.max(36, currentPos.y - 11)}
            fill="#ffffff"
            fontSize="11"
            fontWeight="bold"
            textAnchor="middle"
          >
            🚀 {stage.progressPercent.toFixed(1)}%
          </text>

          {/* X-Axis Labels */}
          <text x={PAD_L} y={SVG_H - 8} fill="#94a3b8" fontSize="10">
            0 XLM (1.00×)
          </text>
          <text x={stage1Pos.x} y={SVG_H - 8} fill="#6ee7b7" fontSize="10" textAnchor="middle">
            250 XLM
          </text>
          <text x={stage2Pos.x} y={SVG_H - 8} fill="#a5b4fc" fontSize="10" textAnchor="middle">
            500 XLM
          </text>
          <text x={goalPos.x} y={SVG_H - 8} fill="#fbbf24" fontSize="10" textAnchor="end">
            1,000 XLM
          </text>
        </svg>

        {/* Interactive Milestone Explorer Pills */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold text-slate-400 mr-1">
              Inspect milestone:
            </span>
            {PREVIEW_CHECKPOINTS.map((cp) => {
              const active = selectedCheckpointXlm === cp.xlm
              return (
                <button
                  key={cp.xlm}
                  type="button"
                  onClick={() =>
                    setSelectedCheckpointXlm(active ? null : cp.xlm)
                  }
                  className={`rounded-lg border px-2 py-1 text-[11px] font-mono font-semibold transition ${
                    active
                      ? 'border-pink-400/70 bg-pink-500/20 text-pink-200'
                      : 'border-slate-800 bg-slate-900/70 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  {cp.pctLabel} · {cp.xlm} XLM
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-3 text-[11px] font-mono">
            <span className="text-emerald-400 font-bold">🟢 {buyCount} buys</span>
            <span className="text-rose-400 font-bold">🔴 {sellCount} sells</span>
          </div>
        </div>

        {previewPos && previewMeta ? (
          <div className="mt-2 rounded-lg border border-pink-500/30 bg-pink-950/20 px-3 py-2 text-xs flex flex-wrap items-center justify-between gap-2">
            <span className="font-bold text-pink-200">
              {previewMeta.title} → Spot {previewPos.mult.toFixed(2)}× (
              {previewMeta.xlm > stage.currentXlm
                ? `+${(((previewPos.mult / Math.max(1, currentPos.mult)) - 1) * 100).toFixed(0)}% from now`
                : 'Already passed'}
              )
            </span>
            <span className="font-mono text-slate-300">
              {previewMeta.prizeTokens > 0
                ? `+${previewMeta.prizeTokens.toLocaleString('en-US')} $${symbol} prize · `
                : ''}
              {previewMeta.zoneFee}
            </span>
          </div>
        ) : trades.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
            <span className="text-slate-400">Latest flow:</span>
            {trades.slice(0, 4).map((ev) => {
              const isBuy = classifyTokenEvent(ev, null) === 'buy'
              return (
                <span
                  key={ev.id}
                  className={`rounded-md px-1.5 py-0.5 text-[10px] ${
                    isBuy
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-rose-500/15 text-rose-300'
                  }`}
                >
                  {isBuy ? '🟢' : '🔴'} {formatAmount(ev.amount, decimals)}
                </span>
              )
            })}
          </div>
        ) : null}
      </div>

      {/* 3-Stage Fee & Checkpoint Jackpot Strip */}
      <div className="grid gap-2 sm:grid-cols-3 text-xs">
        {stages.map((item) => {
          const isActive = item.num === stage.stage
          return (
            <div
              key={item.num}
              className={`rounded-xl border p-2.5 transition ${
                isActive
                  ? item.activeCls
                  : 'border-slate-800/80 bg-slate-950/50 opacity-75'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-bold text-white">{item.title}</span>
                {isActive ? (
                  <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    NOW
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 font-mono text-[10px] text-slate-400">
                {item.range}
              </p>
              <p className="mt-1.5 font-mono text-[11px] text-slate-200">
                Buy <strong className="text-emerald-300">{item.buy}</strong> · Sell{' '}
                <strong className="text-rose-300">{item.sell}</strong>
              </p>
              <p className="mt-0.5 text-[11px] font-semibold text-amber-300">
                {item.perk}
              </p>
            </div>
          )
        })}
      </div>

      {/* Right-Now Action Explainer */}
      <div className="grid gap-2 sm:grid-cols-2 text-xs">
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-950/20 p-3 space-y-1">
          <p className="font-bold text-emerald-300">
            🟢 If you BUY right now (Stage {stage.stage})
          </p>
          <p className="text-slate-300 leading-relaxed">
            Fee is only <strong>{stage.buyFeePercent}%</strong>. You enter at{' '}
            <strong>{currentPos.mult.toFixed(2)}×</strong> before Soroswap opens at{' '}
            <strong>4.00×</strong> — pushing just{' '}
            <strong>{deltaToNextCheckpoint.toFixed(1)} XLM</strong> wins{' '}
            <strong>
              +{stage.nextCheckpointRewardTokens.toLocaleString('en-US')} ${symbol}
            </strong>{' '}
            ({stage.nextCheckpointLabel})!
          </p>
        </div>

        <div className="rounded-xl border border-rose-500/25 bg-rose-950/20 p-3 space-y-1">
          <p className="font-bold text-rose-300">
            🔴 If you SELL right now (Stage {stage.stage})
          </p>
          <p className="text-slate-300 leading-relaxed">
            Exit fee is <strong>{stage.sellFeePercent}%</strong> ({stage.sellFloorPercent}%
            feeds this token’s LP &amp; post-graduation Buyback-and-Burn floor for
            holders).
          </p>
        </div>
      </div>
    </section>
  )
}
