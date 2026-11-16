import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTokenInfo } from '../hooks/useTokenInfo'
import { useTokenBalance } from '../hooks/useTokenBalance'
import { useSoroswapPool } from '../hooks/useSoroswapPool'
import { useCurveState } from '../hooks/useCurveState'
import { useReserveHistory } from '../hooks/useReserveHistory'
import { useTokenEvents } from '../hooks/useTokenEvents'
import { useXlmUsdPrice } from '../hooks/useXlmUsdPrice'
import { useWallet } from '../store/wallet'
import { useWatchlist } from '../store/watchlist'
import { useCopy } from '../hooks/useCopy'
import {
  formatAmount,
  sanitizeHttpUrl,
  sanitizeTelegramUrl,
  sanitizeTwitterUrl,
  shortAddress,
} from '../lib/format'
import { explorerContractUrl, explorerAccountUrl, explorerTxUrl } from '../lib/explorer'
import { classifyTokenEvent } from '../lib/token-events'
import {
  tokenPriceInXlmNumber,
  formatTokenPrice,
  formatUsdPrice,
  SOROSWAP_MINIMUM_LIQUIDITY,
} from '../lib/soroswap'
import { TokenArt } from '../components/TokenArt'
import { SwapCard } from '../components/SwapCard'
import { ReserveChart } from '../components/ReserveChart'
import { TokenHypeBar } from '../components/TokenHypeBar'
import { LiquidityForm } from '../components/LiquidityForm'
import { LiquidityPosition } from '../components/LiquidityPosition'
import { TransferCard } from '../components/TransferCard'
import { BurnCard } from '../components/BurnCard'
import { MintCard } from '../components/MintCard'
import { ShareButton } from '../components/ShareButton'
import { NotFoundPage } from './NotFoundPage'
import { useTokenMetadata } from '../hooks/useTokenMetadata'
import { useLpBurnInfo } from '../hooks/useLpBurnInfo'
import { useTokenShouts } from '../hooks/useTokenShouts'
import { isValidContractAddress } from '../lib/address'
import { analyzeTokenHolders, type HolderRiskLevel } from '../lib/holders'
import {
  calculateSupplySharePercent,
  curveVirtualReserves,
  DEVELOPER_TREASURY_ADDRESS,
  GRADUATION_TARGET_XLM,
  graduationProgressForListing,
  MILESTONE_2_PAIR_XLM,
  rugProofStatus,
  SOROSWAP_SWAP_FEE_PERCENT,
  STELLAR_BURN_ADDRESS,
  STROOPS_PER_UNIT,
  whaleThresholdBase,
  type RugProofStatus,
} from '../lib/tokenomics'
import {
  claimCreatorVesting,
  extendTokenTtl,
  triggerMilestoneBurn,
  type LaunchpadToken,
} from '../lib/token'
import { DEFAULT_XLM_USD_PRICE, validateXlmReserve, XLM_DECIMALS } from '../lib/xlm'
import { useXlmBalance } from '../hooks/useXlmBalance'
import { errorMessage } from '../lib/format'
import { toast } from '../lib/toast'

function formatGroupedAmount(amount: bigint, decimals: number): string {
  const plain = formatAmount(amount, decimals)
  const [whole, frac] = plain.split('.')
  const grouped = Number(whole).toLocaleString('en-US')
  return frac ? `${grouped}.${frac.slice(0, 2)}` : grouped
}

/** Badge honesto: solo "Rug-Proof" cuando la quema de LP está verificada. */
function SecurityBadge({ status }: { status: RugProofStatus }) {
  switch (status) {
    case 'verified':
      return (
        <span
          className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 flex items-center gap-1"
          title="Verified on-chain: ownership renounced and 100% of withdrawable LP held by the burn address"
        >
          <span>🛡️</span> Rug-Proof
        </span>
      )
    case 'lp-not-burned':
      return (
        <span
          className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-amber-300"
          title="Minting is renounced, but LP tokens exist outside the burn address: their holders can withdraw liquidity"
        >
          ⚠️ LP not burned
        </span>
      )
    case 'unknown':
      return (
        <span
          className="rounded-full bg-slate-500/15 border border-slate-500/30 px-2 py-0.5 text-[10px] font-semibold text-slate-300"
          title="External SEP-41 token (no get_owner): anti-rug guarantees cannot be verified"
        >
          External token
        </span>
      )
    default:
      return null
  }
}

function HolderRiskBadge({
  risk,
  label,
  topSinglePct,
}: {
  risk: HolderRiskLevel
  label: string
  topSinglePct: number
}) {
  const styles: Record<HolderRiskLevel, string> = {
    low: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
    medium: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
    high: 'bg-rose-500/15 border-rose-500/40 text-rose-300',
  }
  const icon = risk === 'low' ? '🟢' : risk === 'medium' ? '🟡' : '🔴'
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold flex items-center gap-1 ${styles[risk]}`}
      title={`Largest observed wallet outside AMM pool: ${topSinglePct.toFixed(1)}% of total supply`}
    >
      <span>{icon}</span> {label}
    </span>
  )
}

export function TokenPage() {
  const { id = '' } = useParams<{ id: string }>()
  const isMockToken = typeof window === 'undefined' && id.startsWith('C')
  const validId = isValidContractAddress(id) || isMockToken
  const queryId = validId ? id : ''

  const queryClient = useQueryClient()
  const publicKey = useWallet((state) => state.publicKey)
  const getSigner = useWallet((state) => state.getSigner)
  const connect = useWallet((state) => state.connect)
  const info = useTokenInfo(queryId)
  const userBalance = useTokenBalance(publicKey, queryId)
  const xlmBalance = useXlmBalance(publicKey)
  const creatorBalance = useTokenBalance(info.data?.creator ?? null, queryId)
  const pool = useSoroswapPool(queryId || null)
  const curve = useCurveState(queryId || null)
  const isBondingCurve = Boolean(curve.data && !curve.data.graduated)
  const effectivePool = useMemo(() => {
    if (isBondingCurve && curve.data) {
      const v = curveVirtualReserves(
        curve.data.curve_xlm_net,
        curve.data.tokens_sold,
      )
      return {
        exists: true,
        pairId: '',
        reserveToken: v.virtualTokens,
        reserveXlm: v.virtualXlm,
      }
    }
    return pool.data
  }, [isBondingCurve, curve.data, pool.data])
  const history = useReserveHistory(queryId, effectivePool)
  const events = useTokenEvents(queryId)
  const shouts = useTokenShouts(queryId)
  const { data: xlmUsd = DEFAULT_XLM_USD_PRICE } = useXlmUsdPrice()
  const meta = useTokenMetadata(queryId)
  const lpBurn = useLpBurnInfo(pool.data?.pairId)
  const isFav = useWatchlist((s) => s.favorites.includes(id))
  const toggleFav = useWatchlist((s) => s.toggle)
  const { copied, copy } = useCopy()
  const [openAdvanced, setOpenAdvanced] = useState(
    () => typeof window !== 'undefined' && window.location.hash === '#advanced-tools',
  )
  const [activeTab, setActiveTab] = useState<
    'thread' | 'trades' | 'holders' | 'audit'
  >('thread')
  const [extendingTtl, setExtendingTtl] = useState(false)
  const [busyFlywheel, setBusyFlywheel] = useState<'milestone' | 'vesting' | null>(null)

  const holderAnalysis = useMemo(
    () =>
      analyzeTokenHolders({
        totalSupply: info.data?.totalSupply ?? 0n,
        reserveToken: pool.data?.reserveToken ?? 0n,
        pairId: pool.data?.pairId,
        creator: info.data?.creator,
        creatorBalance: creatorBalance.data,
        userAddress: publicKey,
        userBalance: userBalance.data,
        events: events.data,
      }),
    [
      info.data?.totalSupply,
      pool.data?.reserveToken,
      pool.data?.pairId,
      info.data?.creator,
      creatorBalance.data,
      publicKey,
      userBalance.data,
      events.data,
    ],
  )

  async function onExtendTtl() {
    if (!publicKey) {
      void connect()
      return
    }
    const xlmReserveError = validateXlmReserve(xlmBalance.data)
    if (xlmReserveError) {
      toast.error('Insufficient XLM reserve', { message: xlmReserveError })
      return
    }
    const signer = getSigner()
    if (!signer) {
      toast.error('Active wallet does not support signing')
      return
    }
    setExtendingTtl(true)
    try {
      const { hash } = await extendTokenTtl({ tokenId: id, signer })
      toast.success('90-day TTL refreshed on-chain', { hash })
    } catch (err) {
      toast.error('Could not extend TTL', { message: errorMessage(err) })
    } finally {
      setExtendingTtl(false)
    }
  }

  async function onTriggerMilestoneBurn() {
    if (!publicKey) {
      void connect()
      return
    }
    const signer = getSigner()
    if (!signer) {
      toast.error('Active wallet does not support signing')
      return
    }
    setBusyFlywheel('milestone')
    try {
      const { burned, hash } = await triggerMilestoneBurn({ tokenId: id, signer })
      toast.success('🔥 Milestone Proof-of-Burn executed!', {
        message: `Burned ${formatAmount(burned, token.decimals)} $${token.symbol} permanently`,
        hash,
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['launch-curve', id] }),
        queryClient.invalidateQueries({ queryKey: ['token-info', id] }),
      ])
    } catch (err) {
      toast.error('Milestone burn unavailable', { message: errorMessage(err) })
    } finally {
      setBusyFlywheel(null)
    }
  }

  async function onClaimCreatorVesting() {
    if (!publicKey) {
      void connect()
      return
    }
    const signer = getSigner()
    if (!signer) {
      toast.error('Active wallet does not support signing')
      return
    }
    setBusyFlywheel('vesting')
    try {
      const { claimed, hash } = await claimCreatorVesting({ tokenId: id, signer })
      toast.success('⏳ Creator vesting tranche claimed!', {
        message: `Received ${formatAmount(claimed, token.decimals)} $${token.symbol}`,
        hash,
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['launch-curve', id] }),
        queryClient.invalidateQueries({ queryKey: ['token-balance', id] }),
      ])
    } catch (err) {
      toast.error('Nothing unlocked yet', { message: errorMessage(err) })
    } finally {
      setBusyFlywheel(null)
    }
  }

  const token: LaunchpadToken = {
    id,
    decimals: info.data?.decimals ?? 7,
    symbol: info.data?.symbol,
  }

  const trades = useMemo(() => {
    if (!events.data) return []
    return events.data.filter((ev) => {
      const role = classifyTokenEvent(ev, pool.data?.pairId)
      return role === 'buy' || role === 'sell'
    })
  }, [events.data, pool.data?.pairId])

  if (!validId) return <NotFoundPage />

  if (info.isPending) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 animate-pulse">
          <p className="text-sm text-slate-400">
            Reading token {shortAddress(id)} on testnet…
          </p>
          <div className="mt-4 flex items-center gap-4">
            <div className="h-16 w-16 rounded-2xl bg-slate-800" />
            <div className="space-y-2">
              <div className="h-6 w-48 rounded bg-slate-800" />
              <div className="h-3 w-64 rounded bg-slate-800/70" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (info.isError) {
    return (
      <section className="rounded-2xl border border-rose-900 bg-rose-950/30 p-6">
        <h1 className="text-xl font-bold text-rose-200">
          Unable to load token
        </h1>
        <p className="mt-2 text-sm text-slate-400">
          {id} does not appear to be a valid contract on testnet, or RPC timed out.
        </p>
        <div className="mt-4 flex gap-3">
          <button
            type="button"
            onClick={() => void info.refetch()}
            className="min-h-[40px] rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-emerald-400"
          >
            Retry
          </button>
          <Link
            to="/market"
            className="inline-flex min-h-[40px] items-center rounded-xl border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:text-white"
          >
            Back to Market
          </Link>
        </div>
      </section>
    )
  }

  const priceNumber = effectivePool ? tokenPriceInXlmNumber(effectivePool, token.decimals) : 0
  const priceUsd = priceNumber > 0 ? priceNumber * xlmUsd : 0
  const liquidity =
    isBondingCurve && curve.data
      ? curve.data.curve_xlm_net
      : (pool.data?.reserveXlm ?? 0n)
  const liquidityXlmNum = Number(liquidity) / 10 ** XLM_DECIMALS
  const liquidityUsd = liquidityXlmNum * xlmUsd
  const totalSupplyWhole =
    Number(info.data.totalSupply) / 10 ** info.data.decimals
  const marketCapXlm = priceNumber > 0 ? totalSupplyWhole * priceNumber : 0
  const marketCapUsd = marketCapXlm * xlmUsd

  const reserveToken = effectivePool?.reserveToken ?? 0n
  const poolSupplyPct =
    reserveToken > 0n && info.data.totalSupply > 0n && !isBondingCurve
      ? calculateSupplySharePercent(reserveToken, info.data.totalSupply)
      : 0
  const circulatingWalletsBase =
    !isBondingCurve && info.data.totalSupply > reserveToken
      ? info.data.totalSupply - reserveToken
      : (curve.data?.tokens_sold ?? 0n)
  const walletsSupplyPct =
    circulatingWalletsBase > 0n && info.data.totalSupply > 0n
      ? calculateSupplySharePercent(circulatingWalletsBase, info.data.totalSupply)
      : 0
  const burnedSupplyBase =
    info.data.initialSupply && info.data.initialSupply > info.data.totalSupply
      ? info.data.initialSupply - info.data.totalSupply
      : 0n
  const whaleThreshold = whaleThresholdBase(token.decimals)

  const userBalBase = userBalance.data ?? 0n
  const userBalValueXlm =
    userBalBase > 0n && effectivePool?.exists && effectivePool.reserveToken > 0n
      ? (userBalBase * effectivePool.reserveXlm) / effectivePool.reserveToken
      : 0n
  const userBalValueUsd = (Number(userBalValueXlm) / 10 ** XLM_DECIMALS) * xlmUsd

  const owner = info.data.owner
  const isOwner = Boolean(publicKey && owner === publicKey)
  const security = rugProofStatus({
    owner,
    ownerSupported: info.data.ownerSupported,
    pool: pool.data,
    lpFullyBurned: lpBurn.data?.fullyBurned,
  })

  const grad = graduationProgressForListing({
    pool: effectivePool ?? { exists: false, pairId: '', reserveToken: 0n, reserveXlm: 0n },
    curve: curve.data,
  })
  const graduationPercent = Math.min(100, Math.round(grad.percent))

  const safeTelegram = sanitizeTelegramUrl(meta.data?.telegram)
  const safeWebsite = sanitizeHttpUrl(meta.data?.website)
  const safeTwitter = sanitizeTwitterUrl(meta.data?.twitter)
  const shareUrl =
    typeof window !== 'undefined' ? window.location.href : `/token/${id}`

  return (
    <div className="space-y-6">
      {/* 1. Sleek Minimalist Header */}
      <div className="liquid-glass rounded-2xl p-4 sm:p-5 border border-sky-500/20 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          {/* Token Visual Avatar */}
          <div className="relative h-14 w-14 shrink-0 rounded-2xl overflow-hidden bg-slate-950 border border-sky-500/30 shadow-md">
            <TokenArt
              id={id}
              symbol={token.symbol}
              logoUrl={meta.data?.logoUrl}
              className="h-full w-full"
            />
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                {info.data.name}
              </h1>
              <span className="rounded-lg bg-sky-500/20 border border-sky-500/30 px-2 py-0.5 font-mono text-xs font-bold text-sky-300">
                ${token.symbol}
              </span>
              <SecurityBadge status={security} />
              {isBondingCurve && info.data.verifiedLaunchpad && owner === null ? (
                <span
                  className="rounded-full bg-sky-500/15 border border-sky-500/30 px-2 py-0.5 text-[10px] font-semibold text-sky-300 flex items-center gap-1"
                  title="Mint renounced & reserves locked in Launchpad v4 Virtual Bonding Curve"
                >
                  ⚡ Fair Curve Vault
                </span>
              ) : null}
              <HolderRiskBadge
                risk={holderAnalysis.riskLevel}
                label={holderAnalysis.riskLabel}
                topSinglePct={holderAnalysis.topSingleWalletPercent}
              />
              {isOwner ? (
                <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                  Creator
                </span>
              ) : null}
            </div>

            {/* Contract & Socials Bar */}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <button
                type="button"
                onClick={() => void copy(id)}
                className="font-mono text-slate-300 hover:text-white transition flex items-center gap-1 bg-slate-900/60 px-2 py-0.5 rounded-lg border border-slate-800"
                title="Copy full contract address"
              >
                <span>{shortAddress(id)}</span>
                <span>{copied ? '✓' : '📋'}</span>
              </button>

              <button
                type="button"
                aria-pressed={isFav}
                onClick={() => toggleFav(id)}
                className={`rounded-lg border px-2 py-0.5 text-xs transition ${
                  isFav
                    ? 'border-amber-400/60 bg-amber-500/15 text-amber-300 font-semibold'
                    : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-amber-200'
                }`}
                title={isFav ? 'Remove from watchlist' : 'Add to watchlist'}
              >
                {isFav ? '★ Watchlisted' : '☆ Watch'}
              </button>

              <ShareButton
                text={`Check out $${token.symbol ?? 'TOKEN'} on AstroGate:`}
                url={shareUrl}
                label="Share"
              />

              {safeTelegram ? (
                <a
                  href={safeTelegram}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-400 hover:text-sky-300 hover:underline"
                >
                  Telegram ↗
                </a>
              ) : null}
              {safeTwitter ? (
                <a
                  href={safeTwitter}
                  target="_blank"
                  rel="noreferrer"
                  className="text-slate-300 hover:text-white hover:underline"
                >
                  Twitter ↗
                </a>
              ) : null}
              {safeWebsite ? (
                <a
                  href={safeWebsite}
                  target="_blank"
                  rel="noreferrer"
                  className="text-cyan-300 hover:text-cyan-200 hover:underline"
                >
                  Website ↗
                </a>
              ) : null}
              <a
                href={explorerContractUrl(id)}
                target="_blank"
                rel="noreferrer"
                className="text-slate-400 hover:text-slate-200 hover:underline"
              >
                Explorer ↗
              </a>
            </div>
            {meta.data?.description ? (
              <p className="mt-2 max-w-xl text-xs text-slate-300 leading-relaxed">
                {meta.data.description}
              </p>
            ) : null}
          </div>
        </div>

        {/* Spot Price & Graduation Progress Bar */}
        <div className="flex flex-col sm:items-end gap-1.5 font-mono pt-2 md:pt-0 border-t md:border-t-0 border-slate-800">
          <div className="flex items-baseline gap-2">
            <span className="text-lg sm:text-xl font-black text-white">
              {priceNumber > 0 ? `${formatTokenPrice(priceNumber)} XLM` : '—'}
            </span>
            {priceUsd > 0 ? (
              <span className="text-xs text-slate-400">
                ≈ ${formatUsdPrice(priceUsd)}
              </span>
            ) : null}
          </div>

          <div className="w-full sm:w-52 space-y-1">
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>Graduation Progress</span>
              <span className="font-bold text-amber-300">
                {graduationPercent}% ({GRADUATION_TARGET_XLM.toLocaleString('en-US')} XLM)
              </span>
            </div>
            <div className="h-1.5 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800">
              <div
                className="h-full bg-gradient-to-r from-sky-400 via-indigo-400 to-amber-400 rounded-full"
                style={{ width: `${graduationPercent}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Graduation Alert Banner */}
      {grad.stage === 'heating' || grad.graduated ? (
        <div
          className={`flex flex-wrap items-center justify-between gap-2 rounded-2xl border px-4 py-2.5 text-xs font-medium ${
            grad.graduated
              ? 'border-emerald-500/40 bg-emerald-950/30 text-emerald-200'
              : 'border-amber-500/50 bg-amber-950/30 text-amber-200'
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`h-2 w-2 rounded-full ${
                grad.graduated
                  ? 'bg-emerald-400'
                  : 'bg-amber-400 animate-pulse'
              }`}
            />
            <span>
              {grad.graduated
                ? `🎓 Graduated on Soroswap DEX! ${liquidityXlmNum.toFixed(1)} XLM pool depth unlocked.`
                : `🔥 Almost Graduated! ${graduationPercent}% of ${GRADUATION_TARGET_XLM.toLocaleString('en-US')} XLM target (${Math.max(0, GRADUATION_TARGET_XLM - grad.currentXlm).toFixed(1)} XLM remaining).`}
            </span>
          </div>
          <span className="font-mono text-[11px] font-bold">
            {grad.currentXlm.toFixed(1)} / {GRADUATION_TARGET_XLM.toLocaleString('en-US')} XLM
          </span>
        </div>
      ) : null}

      {/* Market Telemetry Strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 font-mono">
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-3.5">
          <p className="text-[11px] uppercase tracking-wide text-slate-400 font-sans">
            Market Cap
          </p>
          <p className="mt-1 text-base font-bold text-white">
            {marketCapUsd > 0 ? `$${formatUsdPrice(marketCapUsd)}` : '—'}
          </p>
          <p className="text-[11px] text-slate-400">
            {marketCapXlm > 0 ? `${marketCapXlm.toFixed(2)} XLM` : 'No active pool'}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-3.5">
          <p className="text-[11px] uppercase tracking-wide text-slate-400 font-sans">
            {isBondingCurve ? 'Curve Real Vault (TVL)' : 'Pool Liquidity (TVL)'}
          </p>
          <p className="mt-1 text-base font-bold text-emerald-300">
            {effectivePool?.exists
              ? `${formatGroupedAmount(liquidity, XLM_DECIMALS)} XLM`
              : '0 XLM'}
          </p>
          <p className="text-[11px] text-slate-400">
            {liquidityUsd > 0 ? `≈ $${formatUsdPrice(liquidityUsd)} USD` : 'Seed pool to launch'}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-3.5">
          <p className="text-[11px] uppercase tracking-wide text-slate-400 font-sans">
            {isBondingCurve ? 'Curve Remaining Supply' : 'AMM Token Reserve'}
          </p>
          <p className="mt-1 text-base font-bold text-sky-300">
            {isBondingCurve && curve.data
              ? `${formatGroupedAmount(
                  curveVirtualReserves(curve.data.curve_xlm_net, curve.data.tokens_sold)
                    .remainingCurveTokens,
                  token.decimals,
                )}`
              : pool.data?.exists
                ? `${formatGroupedAmount(reserveToken, token.decimals)}`
                : '0'}
          </p>
          <p className="text-[11px] text-slate-400">
            {isBondingCurve && curve.data
              ? `${formatAmount(curve.data.tokens_sold, token.decimals)} bought · 3M DEX locked`
              : pool.data?.exists
                ? `${poolSupplyPct.toFixed(2)}% of total supply`
                : '100% outside pool'}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/40 p-3.5">
          <p className="text-[11px] uppercase tracking-wide text-slate-400 font-sans">
            Your Balance
          </p>
          <p className="mt-1 text-base font-bold text-white truncate">
            {!publicKey
              ? 'Not connected'
              : userBalance.isPending
                ? '…'
                : `${formatGroupedAmount(userBalBase, token.decimals)} $${token.symbol}`}
          </p>
          <p className="text-[11px] text-slate-400">
            {!publicKey
              ? 'Connect wallet to view'
              : userBalValueXlm > 0n
                ? `≈ ${formatAmount(userBalValueXlm, XLM_DECIMALS)} XLM ($${formatUsdPrice(userBalValueUsd)})`
                : '0 XLM value'}
          </p>
        </div>
      </div>

      {/* 2. Main Arena: Gráfico + Chat on Left, Buy & Sell on Right */}
      <div className="grid gap-6 lg:grid-cols-12 items-start">
        {/* Left Column: Gráfico (Chart) + Tabs [Thread | Trades] */}
        <div className="min-w-0 space-y-4 lg:col-span-7">
          {/* Gráfico */}
          <ReserveChart
            history={history}
            symbol={token.symbol}
            decimals={token.decimals}
            events={events.data}
            pool={effectivePool}
            curve={curve.data}
            totalSupply={info.data.totalSupply}
            xlmUsd={xlmUsd}
          />

          {curve.data ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-amber-500/30 bg-slate-900/50 p-3.5 text-xs space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-amber-300">
                    🔥 Milestone Proof-of-Burn Vault
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    Stage {curve.data.burn_milestone_stage} / 2
                  </span>
                </div>
                <p className="text-[11px] text-slate-300">
                  {curve.data.burn_milestone_stage === 0
                    ? `2,970,000 $${token.symbol} vaulted: 1.485M burns on graduation + 1.485M at ${MILESTONE_2_PAIR_XLM.toLocaleString('en-US')} XLM DEX depth.`
                    : curve.data.burn_milestone_stage === 1
                      ? `1,485,000 burned at graduation ✓ · 1,485,000 remaining unlocks at ${MILESTONE_2_PAIR_XLM.toLocaleString('en-US')} XLM DEX depth.`
                      : `All 2,970,000 $${token.symbol} vault tokens permanently burned via token.burn() ✓`}
                </p>
                {curve.data.graduated && curve.data.burn_milestone_stage === 1 ? (
                  <button
                    type="button"
                    disabled={
                      busyFlywheel !== null ||
                      !pool.data?.exists ||
                      pool.data.reserveXlm < BigInt(MILESTONE_2_PAIR_XLM) * STROOPS_PER_UNIT
                    }
                    onClick={() => void onTriggerMilestoneBurn()}
                    className="w-full rounded-xl bg-amber-500 px-3 py-2 text-[11px] font-black text-slate-950 hover:bg-amber-400 disabled:opacity-45 transition"
                  >
                    {busyFlywheel === 'milestone'
                      ? 'Burning Milestone 2…'
                      : pool.data?.exists &&
                          pool.data.reserveXlm >= BigInt(MILESTONE_2_PAIR_XLM) * STROOPS_PER_UNIT
                        ? '🔥 Trigger Milestone 2 Burn (1.485M)'
                        : `Locked until ${MILESTONE_2_PAIR_XLM.toLocaleString('en-US')} XLM Soroswap Depth`}
                  </button>
                ) : null}
              </div>

              <div className="rounded-2xl border border-sky-500/30 bg-slate-900/50 p-3.5 text-xs space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-sky-300">
                    ⏳ Creator 15-Day Vesting (0.3%)
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    {formatAmount(curve.data.creator_claimed, token.decimals)} /{' '}
                    {formatAmount(curve.data.creator_vesting_total, token.decimals)}
                  </span>
                </div>
                <p className="text-[11px] text-slate-300">
                  30,000 ${token.symbol} locked until graduation, then 5 tranches of 20% (6,000) every 3 days.
                </p>
                {curve.data.graduated &&
                publicKey === curve.data.creator &&
                curve.data.creator_claimed < curve.data.creator_vesting_total ? (
                  <button
                    type="button"
                    disabled={busyFlywheel !== null}
                    onClick={() => void onClaimCreatorVesting()}
                    className="w-full rounded-xl bg-sky-500 px-3 py-2 text-[11px] font-black text-slate-950 hover:bg-sky-400 disabled:opacity-50 transition"
                  >
                    {busyFlywheel === 'vesting'
                      ? 'Claiming Tranche…'
                      : '⏳ Claim Unlocked Creator Vesting'}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* Tabbed Interactive Section: Thread | Live Trades | Holders & Risk | Audit & Contract */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-800/80 pb-2">
              <button
                type="button"
                onClick={() => setActiveTab('thread')}
                className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition flex items-center gap-1.5 ${
                  activeTab === 'thread'
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-400/30 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>💬 Thread</span>
                {shouts.data && shouts.data.length > 0 ? (
                  <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-mono text-amber-300">
                    {shouts.data.length}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('trades')}
                className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition flex items-center gap-1.5 ${
                  activeTab === 'trades'
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-400/30 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>⚡ Live Trades</span>
                <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-300">
                  {trades.length}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('holders')}
                className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition flex items-center gap-1.5 ${
                  activeTab === 'holders'
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-400/30 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>👥 Holders &amp; Risk</span>
                <span
                  className={`h-2 w-2 rounded-full ${
                    holderAnalysis.riskLevel === 'low'
                      ? 'bg-emerald-400'
                      : holderAnalysis.riskLevel === 'medium'
                        ? 'bg-amber-400'
                        : 'bg-rose-400'
                  }`}
                />
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('audit')}
                className={`rounded-xl px-3.5 py-1.5 text-xs font-bold transition flex items-center gap-1.5 ${
                  activeTab === 'audit'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <span>🛡️ Audit &amp; Contract</span>
              </button>
            </div>

            {activeTab === 'thread' ? (
              <TokenHypeBar
                tokenId={id}
                symbol={token.symbol ?? 'TOKEN'}
                pairId={pool.data?.pairId}
                decimals={token.decimals}
              />
            ) : activeTab === 'holders' ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 shadow-sm space-y-4 text-xs">
                <div
                  className={`rounded-xl border p-3.5 space-y-1.5 ${
                    holderAnalysis.riskLevel === 'low'
                      ? 'border-emerald-500/30 bg-emerald-950/20 text-emerald-200'
                      : holderAnalysis.riskLevel === 'medium'
                        ? 'border-amber-500/30 bg-amber-950/20 text-amber-200'
                        : 'border-rose-500/40 bg-rose-950/25 text-rose-200'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-bold text-sm">
                      {holderAnalysis.riskLevel === 'low'
                        ? '🟢'
                        : holderAnalysis.riskLevel === 'medium'
                          ? '🟡'
                          : '🔴'}{' '}
                      {holderAnalysis.riskLabel}
                    </span>
                    <span className="font-mono text-[11px] opacity-90">
                      Top Wallet: {holderAnalysis.topSingleWalletPercent.toFixed(2)}% · Top 10: {holderAnalysis.top10WalletsPercent.toFixed(2)}%
                    </span>
                  </div>
                  <p className="text-[11px] opacity-90 leading-relaxed">
                    {holderAnalysis.riskSummary}
                  </p>
                </div>

                {/* Supply Distribution Bar */}
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-slate-300">
                    <span>
                      🟩 Pool AMM: <strong>{poolSupplyPct.toFixed(1)}%</strong>
                    </span>
                    <span>
                      🟨 Creator: <strong>{holderAnalysis.creatorSharePercent.toFixed(2)}%</strong>
                    </span>
                    <span>
                      🟦 Traders / Outside:{' '}
                      <strong>
                        {Math.max(
                          0,
                          walletsSupplyPct - holderAnalysis.creatorSharePercent,
                        ).toFixed(2)}
                        %
                      </strong>
                    </span>
                  </div>
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-900 border border-slate-800">
                    <div
                      className="bg-emerald-500"
                      style={{ width: `${Math.max(0, Math.min(100, poolSupplyPct))}%` }}
                      title={`AMM Pool: ${poolSupplyPct.toFixed(2)}%`}
                    />
                    <div
                      className="bg-amber-400"
                      style={{
                        width: `${Math.max(0, Math.min(100 - poolSupplyPct, holderAnalysis.creatorSharePercent))}%`,
                      }}
                      title={`Creator: ${holderAnalysis.creatorSharePercent.toFixed(2)}%`}
                    />
                    <div
                      className="bg-sky-400"
                      style={{
                        width: `${Math.max(
                          0,
                          Math.min(
                            100,
                            walletsSupplyPct - holderAnalysis.creatorSharePercent,
                          ),
                        )}%`,
                      }}
                      title="External Trader Wallets"
                    />
                  </div>
                </div>

                {/* Top Observed Addresses */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 border-b border-slate-800/80 pb-1.5">
                    <span>Observed Custody &amp; Top Wallets</span>
                    <span>Balance · Supply %</span>
                  </div>
                  {holderAnalysis.holders.length === 0 ? (
                    <p className="py-4 text-center text-slate-500">
                      No holder movements observed in recent ledger window.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-800/50 max-h-64 overflow-y-auto font-mono">
                      {holderAnalysis.holders.slice(0, 15).map((entry) => {
                        const tagBadge =
                          entry.tag === 'pool'
                            ? { text: 'AMM Pool', cls: 'bg-emerald-500/20 text-emerald-300' }
                            : entry.tag === 'creator'
                              ? { text: 'Creator', cls: 'bg-amber-500/20 text-amber-300' }
                              : entry.tag === 'burn'
                                ? { text: 'Burned', cls: 'bg-slate-700/40 text-slate-300' }
                                : { text: 'Wallet', cls: 'bg-sky-500/20 text-sky-300' }
                        const url =
                          entry.tag === 'pool'
                            ? explorerContractUrl(entry.address)
                            : explorerAccountUrl(entry.address)
                        return (
                          <div
                            key={entry.address}
                            className="py-2 flex items-center justify-between gap-2 text-[11px]"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold shrink-0 ${tagBadge.cls}`}>
                                {tagBadge.text}
                              </span>
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="truncate text-slate-300 hover:text-sky-300 hover:underline"
                              >
                                {shortAddress(entry.address)} ↗
                              </a>
                            </div>
                            <div className="shrink-0 text-right">
                              <span className="text-white font-semibold">
                                {formatGroupedAmount(entry.balance, token.decimals)}
                              </span>{' '}
                              <span className="text-slate-400">
                                ({entry.sharePercent.toFixed(2)}%)
                              </span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                <p className="text-[10px] text-slate-500">
                  Live estimate built directly from Soroswap pool reserves, creator balance, and recent RPC SEP-41 transfer events without a centralized indexer.
                </p>
              </div>
            ) : activeTab === 'audit' ? (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 shadow-sm space-y-4 text-xs">
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-3">
                    <p className="text-slate-400">Launchpad Registry</p>
                    <p className="mt-1 font-semibold text-white">
                      {info.data.verifiedLaunchpad
                        ? '✓ AstroGate Fair Launch (On-Chain)'
                        : 'Soroswap External Discovery'}
                    </p>
                    {info.data.creator ? (
                      <a
                        href={explorerAccountUrl(info.data.creator)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block font-mono text-[11px] text-sky-400 hover:underline"
                      >
                        Creator {shortAddress(info.data.creator)} ↗
                      </a>
                    ) : null}
                  </div>

                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-3">
                    <p className="text-slate-400">Mint Ownership</p>
                    <p className="mt-1 font-semibold text-white">
                      {!info.data.ownerSupported
                        ? 'Unknown (no get_owner)'
                        : info.data.owner === null ||
                            info.data.owner === STELLAR_BURN_ADDRESS
                          ? '✓ Renounced Forever (0 supply inflation)'
                          : `⚠️ Active: ${shortAddress(info.data.owner)}`}
                    </p>
                  </div>

                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-3">
                    <p className="text-slate-400">Soroswap LP Lock</p>
                    <p className="mt-1 font-semibold text-white">
                      {lpBurn.isPending
                        ? 'Verifying LP burn…'
                        : lpBurn.data?.fullyBurned
                          ? '✓ 100% Withdrawable LP Burned'
                          : lpBurn.data
                            ? `${lpBurn.data.burnedPercent.toFixed(1)}% in burn address`
                            : 'No AMM pair'}
                    </p>
                    {lpBurn.data ? (
                      <div className="mt-1.5 space-y-1">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-900">
                          <div
                            className={`h-full rounded-full ${
                              lpBurn.data.fullyBurned
                                ? 'bg-emerald-400'
                                : 'bg-amber-400'
                            }`}
                            style={{
                              width: `${Math.min(100, Math.max(0, lpBurn.data.burnedPercent))}%`,
                            }}
                          />
                        </div>
                        <p className="font-mono text-[10px] text-slate-400">
                          {formatAmount(lpBurn.data.burnedLp, XLM_DECIMALS)} /{' '}
                          {formatAmount(lpBurn.data.totalSupply, XLM_DECIMALS)} LP @{' '}
                          <a
                            href={explorerAccountUrl(STELLAR_BURN_ADDRESS)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-sky-400 hover:underline"
                          >
                            {shortAddress(STELLAR_BURN_ADDRESS)} ↗
                          </a>
                        </p>
                        <p className="font-mono text-[10px] text-slate-500">
                          + {SOROSWAP_MINIMUM_LIQUIDITY.toString()} stroops locked permanently in Pair
                        </p>
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-3">
                    <p className="text-slate-400">Live Supply & Contracts</p>
                    <p className="mt-1 font-mono font-semibold text-white">
                      {formatGroupedAmount(info.data.totalSupply, info.data.decimals)} ${token.symbol}
                    </p>
                    {burnedSupplyBase > 0n ? (
                      <p className="mt-0.5 font-mono text-[10px] text-amber-300">
                        🔥 {formatGroupedAmount(burnedSupplyBase, info.data.decimals)} burned permanently
                      </p>
                    ) : null}
                    {pool.data?.pairId ? (
                      <a
                        href={explorerContractUrl(pool.data.pairId)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block font-mono text-[11px] text-sky-400 hover:underline"
                      >
                        Pair {shortAddress(pool.data.pairId)} ↗
                      </a>
                    ) : null}
                  </div>
                </div>

                {/* Where Tokens & XLM Live Breakdown */}
                <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-3.5 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-slate-200">
                      📊 Token & XLM Custody Breakdown
                    </p>
                    {info.data.initialSupply ? (
                      <span className="font-mono text-[11px] text-slate-400">
                        Initial Cap:{' '}
                        {formatGroupedAmount(info.data.initialSupply, info.data.decimals)}
                      </span>
                    ) : null}
                  </div>

                  <div className="space-y-1.5 font-mono text-[11px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-slate-400">Soroswap AMM Pool (Tradable)</span>
                      <span className="text-emerald-300 font-semibold">
                        {formatGroupedAmount(reserveToken, token.decimals)} ${token.symbol} (
                        {poolSupplyPct.toFixed(2)}%) + {formatGroupedAmount(liquidity, XLM_DECIMALS)} XLM
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-slate-400">Holder Wallets (Creator + Buyers)</span>
                      <span className="text-sky-300 font-semibold">
                        {formatGroupedAmount(circulatingWalletsBase, token.decimals)} ${token.symbol} (
                        {walletsSupplyPct.toFixed(2)}%)
                      </span>
                    </div>
                    {info.data.xlmLpAmount !== undefined && info.data.tokenLpAmount !== undefined ? (
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-slate-400">Genesis Pool Seed</span>
                        <span className="text-slate-300">
                          {formatGroupedAmount(info.data.tokenLpAmount, info.data.decimals)} ${token.symbol} +{' '}
                          {formatAmount(info.data.xlmLpAmount, XLM_DECIMALS)} XLM
                        </span>
                      </div>
                    ) : null}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-slate-400">Swap Fee Flow</span>
                      <span className="text-slate-300">
                        {SOROSWAP_SWAP_FEE_PERCENT.toFixed(2)}% LP → Pool · 0% Protocol Fee · 0% Transfer Tax
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-slate-400">Developer Treasury</span>
                      <a
                        href={explorerAccountUrl(DEVELOPER_TREASURY_ADDRESS)}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-sky-400 hover:text-sky-300"
                      >
                        {shortAddress(DEVELOPER_TREASURY_ADDRESS)} ↗
                      </a>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                  <span className="text-[11px] text-slate-400">
                    Keep Soroban token & registry state alive for 90 days.
                  </span>
                  <button
                    type="button"
                    disabled={extendingTtl}
                    onClick={() => void onExtendTtl()}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:border-sky-500 hover:text-sky-300 disabled:opacity-50"
                  >
                    {extendingTtl ? 'Extending TTL…' : '⏳ Refresh 90-Day TTL'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-4 shadow-sm space-y-2">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800/80 text-[11px] font-mono text-slate-400">
                  <span>Action · Amount</span>
                  <span>Trader · Ledger · Tx</span>
                </div>
                {trades.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-6">
                    No on-chain swaps recorded yet. Trade to initiate the curve!
                  </p>
                ) : (
                  <div className="divide-y divide-slate-800/50 max-h-72 overflow-y-auto">
                    {trades.map((ev) => {
                      const isBuy = classifyTokenEvent(ev, pool.data?.pairId) === 'buy'
                      const isWhale = ev.amount >= whaleThreshold
                      return (
                        <div
                          key={ev.id}
                          className="py-2 flex items-center justify-between gap-2 text-xs font-mono"
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                isBuy
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-rose-500/20 text-rose-300'
                              }`}
                            >
                              {isBuy ? '🟢 BUY' : '🔴 SELL'}
                            </span>
                            <span className="text-white font-bold">
                              {formatAmount(ev.amount, token.decimals)} ${token.symbol}
                            </span>
                            {isWhale ? (
                              <span
                                className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300"
                                title="Trade ≥ 1% of fair-launch supply"
                              >
                                🐋 Whale
                              </span>
                            ) : null}
                          </div>
                          <div className="flex items-center gap-2 text-slate-400 text-[11px] shrink-0">
                            <span>by {shortAddress((isBuy ? ev.to : ev.from) ?? '')}</span>
                            <span className="text-slate-500">#{ev.ledger}</span>
                            {ev.txHash ? (
                              <a
                                href={explorerTxUrl(ev.txHash)}
                                target="_blank"
                                rel="noreferrer"
                                className="text-sky-400 hover:text-sky-300 underline"
                              >
                                tx ↗
                              </a>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Comprar y Vender (SwapCard) Sticky */}
        <div className="min-w-0 space-y-4 lg:col-span-5 lg:sticky lg:top-20">
          <SwapCard
            token={token}
            onOpenLiquidityTools={() => setOpenAdvanced(true)}
          />
          {/* Posición LP del usuario + retirada atómica (remove_liquidity).
              Fuera del acordeón: solo se pinta si la wallet tiene LP. */}
          <LiquidityPosition token={token} />

          {/* Collapsed Advanced Developer Tools */}
          <details
            id="advanced-tools"
            open={openAdvanced}
            onToggle={(e) => setOpenAdvanced(e.currentTarget.open)}
            className="group rounded-2xl border border-slate-800/80 bg-slate-950/40 p-3.5 transition-all"
          >
            <summary className="flex cursor-pointer select-none items-center justify-between text-xs font-bold text-slate-400 hover:text-white">
              <span className="flex items-center gap-1.5">
                <span>🛠️</span> Advanced Tools & Liquidity
              </span>
              <span className="text-[10px] text-slate-500 transition-transform group-open:rotate-180">
                ▼
              </span>
            </summary>

            <div className="mt-4 space-y-4 border-t border-slate-800/80 pt-4">
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-300">Add Community Liquidity</div>
                <LiquidityForm token={token} />
              </div>

              <div className="grid gap-3">
                <TransferCard token={token} />
                <BurnCard token={token} />
                {isOwner ? <MintCard token={token} /> : null}
              </div>

              {owner ? (
                <div className="text-[11px] font-mono text-slate-500">
                  Owner:{' '}
                  <a
                    href={explorerAccountUrl(owner)}
                    target="_blank"
                    rel="noreferrer"
                    className="underline text-slate-400"
                  >
                    {shortAddress(owner)}
                  </a>
                </div>
              ) : null}
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}
