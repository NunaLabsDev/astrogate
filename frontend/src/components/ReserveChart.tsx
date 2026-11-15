import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  snapshotLiquidity,
  snapshotPrice,
  toChartPoints,
  type ReserveSnapshot,
} from '../lib/snapshots'
import {
  GRADUATION_TARGET_XLM,
  graduationProgress,
  sanitizeXlmUsdPrice,
} from '../lib/tokenomics'
import {
  classifyTokenEvent,
  type TokenEvent,
} from '../lib/token-events'
import { formatTokenPrice, formatUsdPrice, type PoolState } from '../lib/soroswap'
import { DEFAULT_XLM_USD_PRICE } from '../lib/xlm'

const WIDTH = 400
const HEIGHT = 160
const PADDING = 16
const EMPTY_SNAPSHOTS: ReserveSnapshot[] = []
const EMPTY_EVENTS: TokenEvent[] = []

type Metric = 'mcap' | 'price' | 'liquidity'

function formatMetric(value: number, metric: Metric = 'price'): string {
  if (!Number.isFinite(value)) return '—'
  if (metric === 'mcap') return `$${formatUsdPrice(value)}`
  if (metric === 'price') return formatTokenPrice(value)
  const abs = Math.abs(value)
  const digits = abs > 0 && abs < 0.01 ? 8 : 2
  return value.toLocaleString('en-US', { maximumFractionDigits: digits })
}

function formatTime(t: number): string {
  return new Date(t).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function ReserveChart({
  snapshots,
  history,
  decimals,
  symbol,
  events = EMPTY_EVENTS,
  pool,
  totalSupply,
  xlmUsd = DEFAULT_XLM_USD_PRICE,
}: {
  snapshots?: ReserveSnapshot[]
  history?: ReserveSnapshot[]
  decimals: number
  symbol?: string
  events?: TokenEvent[]
  pool?: PoolState
  totalSupply?: bigint
  xlmUsd?: number
}) {
  const effectiveXlmUsd = sanitizeXlmUsdPrice(xlmUsd)
  const hasSupply = Boolean(totalSupply && totalSupply > 0n)
  const totalSupplyWhole = useMemo(() => {
    if (!totalSupply || totalSupply <= 0n) return 0
    const safeDecimals = Math.max(0, Math.min(18, Math.trunc(decimals)))
    return Number(totalSupply) / 10 ** safeDecimals
  }, [totalSupply, decimals])

  const activeSnapshots = snapshots ?? history ?? EMPTY_SNAPSHOTS
  const [selectedMetric, setSelectedMetric] = useState<Metric>(() =>
    hasSupply ? 'mcap' : 'price',
  )
  const metric: Metric =
    selectedMetric === 'mcap' && !hasSupply ? 'price' : selectedMetric
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [chartWidth, setChartWidth] = useState(WIDTH)
  const gradientId = useId().replace(/:/g, '')

  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const updateWidth = () => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 50) {
        setChartWidth(Math.round(rect.width))
      }
    }
    updateWidth()
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const w = Math.round(entry.contentRect.width)
          if (w > 50) setChartWidth(w)
        }
      })
      ro.observe(el)
      return () => ro.disconnect()
    }
  }, [])

  const pairId = pool?.pairId ?? null

  const trades = useMemo(() => {
    return (events ?? []).filter(
      (e) =>
        e.kind === 'transfer' &&
        pairId &&
        (e.from === pairId || e.to === pairId),
    )
  }, [events, pairId])

  const buyCount = useMemo(
    () =>
      trades.filter((e) => classifyTokenEvent(e, pairId) === 'buy').length,
    [trades, pairId],
  )
  const sellCount = useMemo(
    () =>
      trades.filter((e) => classifyTokenEvent(e, pairId) === 'sell').length,
    [trades, pairId],
  )

  const grad = graduationProgress(pool?.reserveXlm ?? 0n)

  const values = useMemo(
    () =>
      activeSnapshots
        .map((snapshot) => {
          if (metric === 'liquidity') return snapshotLiquidity(snapshot)
          const priceXlm = snapshotPrice(snapshot, decimals)
          if (metric === 'mcap') return priceXlm * totalSupplyWhole * effectiveXlmUsd
          return priceXlm
        })
        .map((value) => (Number.isFinite(value) ? value : 0)),
    [decimals, metric, activeSnapshots, totalSupplyWhole, effectiveXlmUsd],
  )

  const maxRawValue = useMemo(
    () => (values.length > 0 ? Math.max(...values) : 0),
    [values],
  )
  const isLiquidityBelowTarget =
    metric === 'liquidity' && maxRawValue > 0 && maxRawValue < GRADUATION_TARGET_XLM
  const seriesPadding = isLiquidityBelowTarget ? 24 : PADDING

  const series = useMemo(
    () => toChartPoints(values, chartWidth, HEIGHT, seriesPadding),
    [values, chartWidth, seriesPadding],
  )

  const points = series.points
    .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(' ')
  const area = points
    ? `${seriesPadding},${HEIGHT - seriesPadding} ${points} ${chartWidth - seriesPadding},${
        HEIGHT - seriesPadding
      }`
    : ''

  const first = values[0] ?? 0
  const latest = values[values.length - 1] ?? 0
  const delta = first > 0 ? ((latest - first) / first) * 100 : null
  const metricLabel =
    metric === 'mcap'
      ? `Market Cap (USD for $${symbol ?? 'TOKEN'})`
      : metric === 'price'
        ? `Price (XLM per ${symbol ?? 'token'})`
        : 'Liquidity (XLM)'

  // Target line for graduation in liquidity view aligned with toChartPoints Y scale
  const targetY = useMemo(() => {
    if (metric !== 'liquidity' || series.max <= 0) return null
    if (series.max < GRADUATION_TARGET_XLM) return 12
    const span = series.max - series.min
    const normalized =
      span === 0 ? 0.5 : (GRADUATION_TARGET_XLM - series.min) / span
    const rawY = seriesPadding + (1 - normalized) * (HEIGHT - seriesPadding * 2)
    return Math.max(12, Math.min(HEIGHT - seriesPadding, rawY))
  }, [metric, series.max, series.min, seriesPadding])

  const selectedPoint =
    selectedPointIndex !== null && series.points[selectedPointIndex]
      ? {
          point: series.points[selectedPointIndex],
          snapshot: activeSnapshots[selectedPointIndex],
          value: values[selectedPointIndex],
        }
      : null

  const activeValue = selectedPoint ? (selectedPoint.value ?? latest) : latest
  const activeSnapshot = selectedPoint
    ? selectedPoint.snapshot
    : activeSnapshots[activeSnapshots.length - 1]
  const activePriceXlm = activeSnapshot ? snapshotPrice(activeSnapshot, decimals) : 0
  const activeLiqXlm = activeSnapshot ? snapshotLiquidity(activeSnapshot) : 0

  function selectNearestPoint(clientX: number) {
    if (series.points.length < 2 || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    if (rect.width <= 0) return
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
    const idx = Math.round(ratio * (series.points.length - 1))
    setSelectedPointIndex(idx)
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 sm:p-5 shadow-sm w-full max-w-full min-w-0 overflow-hidden space-y-3">
      <h2 className="sr-only">Pair History</h2>
      {/* Sleek Chart Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800/80 pb-3">
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <span className="font-mono text-2xl font-black text-white">
              {formatMetric(activeValue, metric)}
            </span>
            <span className="text-xs font-mono text-slate-400">
              {metric === 'mcap'
                ? 'Market Cap (USD)'
                : metric === 'price'
                  ? `XLM / $${symbol ?? 'TOKEN'}`
                  : 'XLM Liquidity'}
            </span>
            {delta !== null ? (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-mono font-bold ${
                  delta >= 0
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-rose-500/15 text-rose-300'
                }`}
              >
                {delta >= 0 ? '+' : ''}
                {delta.toFixed(1)}%
              </span>
            ) : null}
          </div>

          {activeSnapshot ? (
            <p className="font-mono text-[11px] text-slate-400">
              {selectedPoint ? `${formatTime(activeSnapshot.t)} · ` : 'Live · '}
              {metric === 'mcap'
                ? `Price: ${formatTokenPrice(activePriceXlm)} XLM ($${formatUsdPrice(activePriceXlm * effectiveXlmUsd)}) · TVL: ${activeLiqXlm.toFixed(1)} XLM`
                : `≈ $${formatUsdPrice(
                    (metric === 'price' ? activePriceXlm : activeLiqXlm) * effectiveXlmUsd,
                  )} USD`}
            </p>
          ) : null}
        </div>

        <div
          className="flex rounded-xl border border-slate-800 p-0.5 bg-slate-950/70"
          role="tablist"
          aria-label="Chart metric"
        >
          {hasSupply ? (
            <button
              type="button"
              role="tab"
              aria-selected={metric === 'mcap'}
              onClick={() => {
                setSelectedMetric('mcap')
                setSelectedPointIndex(null)
              }}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                metric === 'mcap'
                  ? 'bg-sky-500 text-slate-950 font-bold shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              MCap ($)
            </button>
          ) : null}
          <button
            type="button"
            role="tab"
            aria-selected={metric === 'price'}
            onClick={() => {
              setSelectedMetric('price')
              setSelectedPointIndex(null)
            }}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              metric === 'price'
                ? 'bg-sky-500 text-slate-950 font-bold shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Price
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={metric === 'liquidity'}
            onClick={() => {
              setSelectedMetric('liquidity')
              setSelectedPointIndex(null)
            }}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
              metric === 'liquidity'
                ? 'bg-sky-500 text-slate-950 font-bold shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            TVL (XLM)
          </button>
        </div>
      </div>

      {values.length >= 2 ? (
        <>
          <div className="flex items-center justify-between font-mono text-[10px] text-slate-400">
            <span>High: {formatMetric(series.max, metric)}</span>
            <span>Low: {formatMetric(series.min, metric)}</span>
          </div>

          <div
            ref={containerRef}
            onMouseMove={(e) => selectNearestPoint(e.clientX)}
            onMouseLeave={() => setSelectedPointIndex(null)}
            onTouchMove={(e) => {
              const touch = e.touches[0]
              if (touch) selectNearestPoint(touch.clientX)
            }}
            className="relative mt-1 overflow-hidden rounded-xl border border-slate-800/80 bg-slate-950/80 p-2 w-full max-w-full min-w-0"
          >
            <svg
              viewBox={`0 0 ${chartWidth} ${HEIGHT}`}
              role="img"
              aria-label={`${metricLabel}: min ${formatMetric(
                series.min,
                metric,
              )}, max ${formatMetric(series.max, metric)}, latest ${formatMetric(
                latest,
                metric,
              )}`}
              className="h-44 w-full max-w-full block overflow-hidden cursor-crosshair"
            >
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Graduation target reference line */}
              {targetY !== null && targetY >= 0 && targetY <= HEIGHT ? (
                <g>
                  <line
                    x1={seriesPadding}
                    y1={targetY}
                    x2={chartWidth - seriesPadding}
                    y2={targetY}
                    stroke="#f59e0b"
                    strokeWidth="1.5"
                    strokeDasharray="4 4"
                  />
                  <text
                    x={chartWidth - seriesPadding - 4}
                    y={Math.max(9, targetY - 3)}
                    fill="#f59e0b"
                    fontSize="9"
                    fontFamily="monospace"
                    textAnchor="end"
                  >
                    🎓 DEX Graduation ({GRADUATION_TARGET_XLM.toLocaleString('en-US')} XLM)
                  </text>
                </g>
              ) : null}

              {/* Crosshair guideline */}
              {selectedPoint ? (
                <line
                  x1={selectedPoint.point.x}
                  y1={seriesPadding}
                  x2={selectedPoint.point.x}
                  y2={HEIGHT - seriesPadding}
                  stroke="#38bdf8"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  opacity="0.7"
                />
              ) : null}

              {/* Area Under Curve */}
              <polygon points={area} fill={`url(#${gradientId})`} />

              {/* Main Curve Line */}
              <polyline
                points={points}
                fill="none"
                stroke="#10b981"
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />

              {/* Point circles with buy/sell indicators */}
              {series.points.map((pt, idx) => {
                const prev = idx > 0 ? values[idx - 1] : values[idx]
                const curr = values[idx]
                const isUp = curr !== undefined && prev !== undefined && curr >= prev
                const isSelected = selectedPointIndex === idx

                return (
                  <circle
                    key={idx}
                    cx={pt.x}
                    cy={pt.y}
                    r={isSelected ? 5.5 : 3}
                    fill={isUp ? '#10b981' : '#f43f5e'}
                    stroke={isSelected ? '#38bdf8' : '#0f172a'}
                    strokeWidth={isSelected ? '2' : '1.5'}
                    className="cursor-pointer transition-transform hover:scale-150"
                    onClick={() => setSelectedPointIndex(idx)}
                  />
                )
              })}
            </svg>
          </div>

          <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-slate-400">
            <span>{formatTime(activeSnapshots[0]?.t ?? 0)}</span>
            <span>Hover chart to inspect historical points</span>
            <span>{formatTime(activeSnapshots[activeSnapshots.length - 1]?.t ?? 0)}</span>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/40 p-6 text-center">
          <p className="text-xs text-slate-400">
            Awaiting trades · Swaps on Soroswap are plotted live automatically
          </p>
        </div>
      )}

      {/* Clean Telemetry Status Row + Graduation Mini-Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80 font-mono text-[11px] text-slate-400">
        <div className="flex items-center gap-3">
          <span className="text-emerald-400 font-bold">🟢 {buyCount} buys</span>
          <span className="text-rose-400 font-bold">🔴 {sellCount} sells</span>
        </div>
        <div className="flex items-center gap-2">
          <span>
            Graduation:{' '}
            <strong className="text-amber-300 font-bold">
              {grad.percent.toFixed(1)}%
            </strong>{' '}
            ({grad.currentXlm.toFixed(1)}/{grad.targetXlm} XLM)
          </span>
        </div>
      </div>
    </section>
  )
}
