/**
 * Fair-Flywheel v4.5 Tokenomics (AstroGate 66 / 33 / 0.30 / 0.40 Escrowed Checkpoints / 0.30 on Stellar).
 *
 * Fair & Sustainable Flywheel Rules:
 * 1. Standard Supply: 10,000,000 tokens (7 decimals, aligned with 1 XLM = 10^7 stroops).
 * 2. 66.0% (6,600,000 tokens): Virtual Bonding Curve (`1,000 vXLM -> 1,000 real XLM goal`),
 *    4.00x curve appreciation with softened 3-stage fees (`0.30%` <250 XLM, `0.50%` 250-500 XLM,
 *    `0.25%` 500-1,000 XLM sprint) and gentle sells (`1.20% / 1.80% / 1.50%`) feeding LP/Buyback floor.
 * 3. 33.0% (3,300,000 tokens): Reserved for Soroswap DEX Pool at graduation + >= 1,000 real XLM,
 *    with 0.00% graduation cliff and 100% LP time-locked in-contract for 7 years (`reclaim_expired_lp`).
 * 4. 0.30% (30,000 tokens): 15-day post-graduation creator vesting (5 tranches of 6,000 every 3 days),
 *    plus creator's initial paid curve seed locked until graduation.
 * 5. 0.40% (40,000 tokens): Escrowed 3-Checkpoint Jackpot Ladder (+5K Spark at 250 XLM, +10K Crown at 500 XLM
 *    escrowed on-chain until graduation via `claim_jackpot`, plus +25K Graduation Jackpot at 1,000 XLM).
 * 6. 0.30% (30,000 tokens): Developer / Protocol Ecosystem allocation transferred to treasury on graduation.
 * 7. Anti-MEV Organic Deflation: Zero idle burn vault; chunked DEX Buyback & Burn bounded by
 *    min(0.25% pool XLM, 0.8000000 XLM) with a 2% keeper gas rebate (capped at 0.0500000 XLM) + Burn-to-Chat.
 */
import { clampDecimals } from './format'
import type { PoolState } from './soroswap'
import { DEFAULT_XLM_USD_PRICE } from './xlm'
import {
  BASE_CURVE_FEE_BPS,
  BURN_VAULT_ALLOCATION_BPS,
  BURN_VAULT_TOKENS_ALLOC_BASE,
  BUY_FLOOR_EARLY_BPS,
  BUY_FLOOR_MID_BPS,
  BUY_FLOOR_SPRINT_BPS,
  BUY_TREASURY_EARLY_BPS,
  BUY_TREASURY_MID_BPS,
  BUY_TREASURY_SPRINT_BPS,
  BUYBACK_KEEPER_BOUNTY_BPS,
  BUYBACK_MAX_BOUNTY_STROOPS,
  BUYBACK_MAX_CHUNK_BPS,
  BUYBACK_MAX_CHUNK_STROOPS,
  BUYBACK_MIN_DUST_STROOPS,
  CREATOR_ALLOCATION_BPS,
  CREATOR_VESTING_ALLOC_BASE,
  CROWN_JACKPOT_BPS,
  CROWN_JACKPOT_TOKENS,
  CROWN_JACKPOT_TOKENS_ALLOC_BASE,
  CURVE_ALLOCATION_BPS,
  CURVE_REAL_XLM_GOAL_STROOPS,
  CURVE_TOKENS_ALLOC_BASE,
  CURVE_VIRTUAL_TOKEN_START_BASE,
  CURVE_VIRTUAL_XLM_START_STROOPS,
  DEV_ALLOCATION_BPS,
  DEV_TOKENS_ALLOC_BASE,
  DEX_ALLOCATION_BPS,
  DEX_TOKENS_ALLOC_BASE,
  FAIR_INITIAL_SUPPLY_BASE,
  FAIR_LAUNCH_DECIMALS,
  FAIR_LAUNCH_TOTAL_BASIS,
  GRADUATION_JACKPOT_BPS,
  GRADUATION_JACKPOT_TOKENS,
  GRADUATION_JACKPOT_TOKENS_ALLOC_BASE,
  GRADUATION_TARGET_XLM,
  LAUNCH_CREATION_FEE_STROOPS,
  LAUNCH_CREATION_FEE_XLM,
  LP_LOCK_YEARS,
  MAX_WHALE_SURCHARGE_BPS,
  MIN_SEED_XLM,
  MIN_SEED_XLM_STROOPS,
  POOL_ALLOCATION_BPS,
  POOL_FLOOR_FEE_BPS,
  SELL_FLOOR_EARLY_BPS,
  SELL_FLOOR_LATE_BPS,
  SELL_FLOOR_MID_BPS,
  SELL_FLOOR_SPRINT_BPS,
  SELL_TREASURY_EARLY_BPS,
  SELL_TREASURY_MID_BPS,
  SELL_TREASURY_SPRINT_BPS,
  SPARK_JACKPOT_BPS,
  SPARK_JACKPOT_TOKENS,
  SPARK_JACKPOT_TOKENS_ALLOC_BASE,
  STAGE_1_XLM,
  STAGE_1_XLM_STROOPS,
  STAGE_2_XLM,
  STAGE_2_XLM_STROOPS,
  STELLAR_BURN_ADDRESS,
  STROOPS_PER_UNIT,
  TOTAL_JACKPOT_BPS,
  TOTAL_JACKPOT_TOKENS,
  TOTAL_JACKPOT_TOKENS_ALLOC_BASE,
  TREASURY_FEE_BPS,
  WHALE_FREE_SHARE_BPS,
  curveFeeBpsForOrder,
  curveMaxBuyXlmStroops,
  curveNextCheckpointStroops,
  curveSellFeeBps,
  curveStageInfo,
  curveVirtualReserves,
  divCeil,
  localCurveQuoteBuy,
  localCurveQuoteSell,
  type CurveStageId,
  type CurveStageInfo,
  type LocalBuyQuote,
  type LocalSellQuote,
} from './curve-math'

export { DEVELOPER_TREASURY_ADDRESS } from './network'
export {
  BASE_CURVE_FEE_BPS,
  BURN_VAULT_ALLOCATION_BPS,
  BURN_VAULT_TOKENS_ALLOC_BASE,
  BUY_FLOOR_EARLY_BPS,
  BUY_FLOOR_MID_BPS,
  BUY_FLOOR_SPRINT_BPS,
  BUY_TREASURY_EARLY_BPS,
  BUY_TREASURY_MID_BPS,
  BUY_TREASURY_SPRINT_BPS,
  BUYBACK_KEEPER_BOUNTY_BPS,
  BUYBACK_MAX_BOUNTY_STROOPS,
  BUYBACK_MAX_CHUNK_BPS,
  BUYBACK_MAX_CHUNK_STROOPS,
  BUYBACK_MIN_DUST_STROOPS,
  CREATOR_ALLOCATION_BPS,
  CREATOR_VESTING_ALLOC_BASE,
  CROWN_JACKPOT_BPS,
  CROWN_JACKPOT_TOKENS,
  CROWN_JACKPOT_TOKENS_ALLOC_BASE,
  CURVE_ALLOCATION_BPS,
  CURVE_REAL_XLM_GOAL_STROOPS,
  CURVE_TOKENS_ALLOC_BASE,
  CURVE_VIRTUAL_TOKEN_START_BASE,
  CURVE_VIRTUAL_XLM_START_STROOPS,
  DEV_ALLOCATION_BPS,
  DEV_TOKENS_ALLOC_BASE,
  DEX_ALLOCATION_BPS,
  DEX_TOKENS_ALLOC_BASE,
  FAIR_INITIAL_SUPPLY_BASE,
  FAIR_LAUNCH_DECIMALS,
  FAIR_LAUNCH_TOTAL_BASIS,
  GRADUATION_JACKPOT_BPS,
  GRADUATION_JACKPOT_TOKENS,
  GRADUATION_JACKPOT_TOKENS_ALLOC_BASE,
  GRADUATION_TARGET_XLM,
  LAUNCH_CREATION_FEE_STROOPS,
  LAUNCH_CREATION_FEE_XLM,
  LP_LOCK_YEARS,
  MAX_WHALE_SURCHARGE_BPS,
  MIN_SEED_XLM,
  MIN_SEED_XLM_STROOPS,
  POOL_ALLOCATION_BPS,
  POOL_FLOOR_FEE_BPS,
  SELL_FLOOR_EARLY_BPS,
  SELL_FLOOR_LATE_BPS,
  SELL_FLOOR_MID_BPS,
  SELL_FLOOR_SPRINT_BPS,
  SELL_TREASURY_EARLY_BPS,
  SELL_TREASURY_MID_BPS,
  SELL_TREASURY_SPRINT_BPS,
  SPARK_JACKPOT_BPS,
  SPARK_JACKPOT_TOKENS,
  SPARK_JACKPOT_TOKENS_ALLOC_BASE,
  STAGE_1_XLM,
  STAGE_1_XLM_STROOPS,
  STAGE_2_XLM,
  STAGE_2_XLM_STROOPS,
  STELLAR_BURN_ADDRESS,
  STROOPS_PER_UNIT,
  TOTAL_JACKPOT_BPS,
  TOTAL_JACKPOT_TOKENS,
  TOTAL_JACKPOT_TOKENS_ALLOC_BASE,
  TREASURY_FEE_BPS,
  WHALE_FREE_SHARE_BPS,
  curveFeeBpsForOrder,
  curveMaxBuyXlmStroops,
  curveNextCheckpointStroops,
  curveSellFeeBps,
  curveStageInfo,
  curveVirtualReserves,
  divCeil,
  localCurveQuoteBuy,
  localCurveQuoteSell,
  type CurveStageId,
  type CurveStageInfo,
  type LocalBuyQuote,
  type LocalSellQuote,
}

/**
 * Protocol Monetization Model (100% AstroGate Developers Treasury, Fair-Flywheel v4.5):
 * 1. Fair launch deployment: 7 XLM fixed creation fee (`LAUNCH_CREATION_FEE_XLM`) straight to Treasury.
 * 2. Curve buys: 3-stage softened fee (`0.30%` <250 XLM, `0.50%` 250-500 XLM, `0.25%` 500-1,000 XLM).
 * 3. Curve sells: asymmetric `1.20% / 1.80% / 1.50%` feeding LP & anti-MEV post-grad Buyback-and-Burn.
 * 4. Graduated Soroswap swaps: standard 0.30% LP fee stays in 7-year time-locked LP.
 */
export const PROTOCOL_DEPLOY_FEE_XLM = 7
export const DEVELOPER_TRADING_FEE_BPS = TREASURY_FEE_BPS
export const DEVELOPER_GRADUATION_FEE_XLM = 0

/** Milestone Proof-of-Burn Stage 2 trigger on graduated Soroswap pair. */
export const MILESTONE_2_PAIR_XLM = 1_800

/** 3-tier Burn-to-Chat thresholds in readable tokens. */
export const MIN_SHOUT_BURN = 50
export const HYPE_SHOUT_BURN = 500
export const KING_SHOUT_BURN = 5_000

/** Ensure a fallback XLM/USD price is finite and positive; else use the default. */
export function sanitizeXlmUsdPrice(xlmUsdPrice: number): number {
  return Number.isFinite(xlmUsdPrice) && xlmUsdPrice > 0
    ? xlmUsdPrice
    : DEFAULT_XLM_USD_PRICE
}

/**
 * Creator allocation share of `initialSupplyBase`, scaled by BPS.
 * Single source of truth for the "9.95M / 50K" figures shown across the UI.
 */
export function allocationOfBps(totalBase: bigint, bps: bigint): bigint {
  if (totalBase <= 0n) return 0n
  return (totalBase * bps) / 10_000n
}

/** Pool share of a total supply in base units (99.5%). */
export function poolAllocationBase(totalBase: bigint): bigint {
  return allocationOfBps(totalBase, POOL_ALLOCATION_BPS)
}

/**
 * Trade size tagged as "whale" by the UI: >= 1% of the standard fair-launch
 * supply (100K readable tokens on a 10M launch), converted to base units.
 */
export const WHALE_TRADE_SHARE_BPS = 100n

/** Whale threshold in base units for a token with `decimals` decimals. */
export function whaleThresholdBase(
  decimals: number = FAIR_LAUNCH_DECIMALS,
): bigint {
  const safeDecimals = clampDecimals(decimals)
  return (
    allocationOfBps(FAIR_LAUNCH_TOTAL_BASIS, WHALE_TRADE_SHARE_BPS) *
    10n ** BigInt(safeDecimals)
  )
}

/**
 * Natural AMM Market Share & Anti-Sniper Indicator:
 * Rather than artificially blocking trades, constant-product AMM slippage naturally
 * penalizes oversized orders. This helper informs users of their order's supply share.
 */
export function calculateSupplySharePercent(
  amountTokensBase: bigint,
  totalBase: bigint = poolAllocationBase(
    FAIR_LAUNCH_TOTAL_BASIS * 10n ** BigInt(FAIR_LAUNCH_DECIMALS),
  ),
): number {
  if (totalBase <= 0n || amountTokensBase <= 0n) return 0
  const bps = (amountTokensBase * 10_000n) / totalBase
  return Number(bps) / 100
}

/**
 * Inverse constant-product AMM formula (`x * y = k` with 0.30% Soroswap fee):
 * Calculates the exact XLM input (in stroops) required to acquire `targetSharePercent`
 * (e.g. 2%, 5%, 10%) of a pool's token reserve.
 * Useful both as an Anti-Sniper Depth indicator on token launch and as a 1-click
 * Anti-Whale cap in SwapCard.
 */
export function costToBuyPoolShareStroops(
  reserveXlmStroops: bigint,
  targetSharePercent: number,
): bigint {
  if (
    reserveXlmStroops <= 0n ||
    !Number.isFinite(targetSharePercent) ||
    targetSharePercent <= 0
  ) {
    return 0n
  }
  const bps = Math.min(9_500, Math.max(1, Math.round(targetSharePercent * 100)))
  const numerator = reserveXlmStroops * 1_000n * BigInt(bps)
  const denominator = 997n * BigInt(10_000 - bps)
  if (denominator <= 0n) return 0n
  return (numerator + denominator - 1n) / denominator
}

/** Readable XLM amount required to buy `targetSharePercent` of a pool. */
export function costToBuyPoolShareXlm(
  reserveXlmStroops: bigint,
  targetSharePercent: number,
): number {
  return Number(costToBuyPoolShareStroops(reserveXlmStroops, targetSharePercent)) / 1e7
}

/**
 * Real XLM vault target in readable units for a Virtual Bonding Curve to graduate to Soroswap DEX.
 * Calibrated to 1,000 real XLM (`GRADUATION_TARGET_XLM` re-exported from `curve-math.ts`).
 */

/** Soroswap pair swap fee (30 bps = 0.30%). */
export const SOROSWAP_SWAP_FEE_PERCENT = 0.3

export type GraduationStage =
  | 'no-pool'
  | 'seed'
  | 'rising'
  | 'heating'
  | 'graduated'

export type GraduationStatus = {
  stage: GraduationStage
  label: string
  /** Progress 0 to 100%. */
  percent: number
  /** Current XLM in reserve. */
  currentXlm: number
  /** Target XLM for graduation. */
  targetXlm: number
  graduated: boolean
}

/**
 * Post-graduation creator vesting enforced on-chain by Launchpad v4.3 (`claim_creator_vesting`):
 * 0.3% (30,000 tokens) unlocks strictly in 5 tranches of 20% (6,000 tokens) every 3 days (15d total),
 * alongside 100% of creator's paid launch_fair seed buy unlocked at graduation.
 */
export const CREATOR_GRADUATION_LOCK_DAYS = 15
export const CREATOR_VESTING_PHASES_COUNT = 5
export const CREATOR_VESTING_INTERVAL_DAYS = 3
export const CREATOR_VESTING_PERCENT_PER_PHASE = 20

export type VestingPhase = {
  phase: number
  day: number
  percent: number
  tokensAmount: number
  label: string
}

export const CREATOR_VESTING_SCHEDULE: VestingPhase[] = [
  {
    phase: 1,
    day: 3,
    percent: 20,
    tokensAmount: 6_000,
    label: 'Phase 1 (Day 3): 20% (6K tokens) after 72h DEX consolidation',
  },
  {
    phase: 2,
    day: 6,
    percent: 20,
    tokensAmount: 6_000,
    label: 'Phase 2 (Day 6): 20% (6K tokens)',
  },
  {
    phase: 3,
    day: 9,
    percent: 20,
    tokensAmount: 6_000,
    label: 'Phase 3 (Day 9): 20% (6K tokens)',
  },
  {
    phase: 4,
    day: 12,
    percent: 20,
    tokensAmount: 6_000,
    label: 'Phase 4 (Day 12): 20% (6K tokens)',
  },
  {
    phase: 5,
    day: 15,
    percent: 20,
    tokensAmount: 6_000,
    label: 'Phase 5 (Day 15): 20% (6K tokens) — Final 100% unlock',
  },
]

/* Curve math functions re-exported from ./curve-math */

/**
 * Exact XLM cost (stroops) on the Virtual Curve to purchase `targetSharePercent` of the 10M total supply,
 * before trading fees, using `k = vXlm * vTok`. Returns 0n if target exceeds remaining curve tokens.
 */
export function curveCostForTotalSupplyShareXlm(
  curveXlmNet: bigint,
  tokensSold: bigint,
  targetSharePercent: number,
): number {
  if (!Number.isFinite(targetSharePercent) || targetSharePercent <= 0) return 0
  const { virtualXlm, virtualTokens, remainingCurveTokens } =
    curveVirtualReserves(curveXlmNet, tokensSold)
  const wantedTokens =
    (FAIR_INITIAL_SUPPLY_BASE * BigInt(Math.round(targetSharePercent * 100))) /
    10_000n
  if (wantedTokens <= 0n || wantedTokens > remainingCurveTokens) return 0
  const newVTok = virtualTokens - wantedTokens
  if (newVTok <= 0n) return 0
  const netXlmNeeded = divCeil(virtualXlm * virtualTokens, newVTok) - virtualXlm
  return Number(netXlmNeeded) / 1e7
}

/**
 * Exact max XLM order size (in stroops) that fits inside `orderShareBps` of current virtual XLM.
 * `200 bps` (2%) is the exact ceiling with ZERO progressive anti-whale surcharge in Launchpad v4.1.
 */
export function curveSafeOrderXlmStroops(
  curveXlmNet: bigint,
  orderShareBps: bigint = WHALE_FREE_SHARE_BPS,
): bigint {
  const safeNet = curveXlmNet < 0n ? 0n : curveXlmNet
  const vXlm = CURVE_VIRTUAL_XLM_START_STROOPS + safeNet
  return (vXlm * orderShareBps) / 10_000n
}

/**
 * Default balanced initial buy on the Fair-Flywheel v4.3 Virtual Curve (`1,000 vXLM -> 1,000 real XLM`).
 */
export const DEFAULT_OPTIMIZED_SEED_XLM = 10

export type SeedPreset = {
  xlm: number
  label: string
  desc: string
  isRecommended?: boolean
}

export const SEED_LIQUIDITY_PRESETS: SeedPreset[] = [
  {
    xlm: 5,
    label: '5 XLM',
    desc: 'Light Seed — ultra-low cost for micro-memes',
  },
  {
    xlm: 10,
    label: '10 XLM',
    desc: 'Recommended ⭐ — optimal balance & natural anti-sniper depth',
    isRecommended: true,
  },
  {
    xlm: 20,
    label: '20 XLM',
    desc: 'Deep — deeper initial curve backing for community launches',
  },
  {
    xlm: 50,
    label: '50 XLM',
    desc: 'Whale — for DAOs and established projects',
  },
]

/**
 * Calculates graduation progress for a token based on its XLM reserve (stroops, 7 decimals).
 */
export function graduationProgress(
  reserveXlmStroops: bigint,
  targetXlm: number = GRADUATION_TARGET_XLM,
): GraduationStatus {
  const safeTarget =
    Number.isFinite(targetXlm) && targetXlm > 0 ? targetXlm : GRADUATION_TARGET_XLM
  const currentXlm = Number(reserveXlmStroops) / 1e7
  if (!Number.isFinite(currentXlm) || currentXlm <= 0) {
    return {
      stage: 'no-pool',
      label: 'No initial liquidity',
      percent: 0,
      currentXlm: 0,
      targetXlm: safeTarget,
      graduated: false,
    }
  }

  const rawPercent = (currentXlm / safeTarget) * 100
  const percent = Math.min(100, Math.round(rawPercent * 10) / 10)
  const graduated = currentXlm >= safeTarget

  if (graduated) {
    return {
      stage: 'graduated',
      label: '🎓 Graduated on Soroswap DEX',
      percent: 100,
      currentXlm,
      targetXlm: safeTarget,
      graduated: true,
    }
  }
  if (percent >= 50) {
    return {
      stage: 'heating',
      label: '🔥 King of the Hill (final stretch)',
      percent,
      currentXlm,
      targetXlm: safeTarget,
      graduated: false,
    }
  }
  if (percent >= 10) {
    return {
      stage: 'rising',
      label: '⚡ Bonding curve surging',
      percent,
      currentXlm,
      targetXlm: safeTarget,
      graduated: false,
    }
  }
  return {
    stage: 'seed',
    label: '🌱 Seed stage',
    percent: Math.max(1, percent),
    currentXlm,
    targetXlm: safeTarget,
    graduated: false,
  }
}

/**
 * Computes graduation progress for either a Fair-Flywheel v4 bonding curve token
 * (using `curve_xlm_net` / 1,000 XLM) or a legacy/Soroswap pair (using `pool.reserveXlm`).
 */
export function graduationProgressForListing(listing: {
  pool: PoolState
  curve?: {
    graduated: boolean
    curve_xlm_net: bigint
  } | null
}): GraduationStatus {
  if (listing.curve) {
    if (listing.curve.graduated) {
      const displayXlm =
        listing.pool.reserveXlm > CURVE_REAL_XLM_GOAL_STROOPS
          ? listing.pool.reserveXlm
          : CURVE_REAL_XLM_GOAL_STROOPS
      return graduationProgress(displayXlm, GRADUATION_TARGET_XLM)
    }
    return graduationProgress(listing.curve.curve_xlm_net, GRADUATION_TARGET_XLM)
  }
  return graduationProgress(listing.pool.reserveXlm, GRADUATION_TARGET_XLM)
}

/**
 * Veredicto anti-rug que la UI puede mostrar sin mentir:
 * - `verified`: owner renunciado (contrato con `get_owner`) + pool con XLM +
 *   100% de los LP retirables en la burn address.
 * - `lp-not-burned`: mint renunciado, pero hay LP fuera de la burn address
 *   (quien los tenga puede retirar la liquidez).
 * - `owner-active`: el creador aún puede acuñar.
 * - `unknown`: token externo sin `get_owner()`; no hay garantías verificables.
 * - `no-pool`: no hay liquidez que proteger.
 * - `checking`: lectura de LP en curso (no se muestra nada definitivo).
 */
export type RugProofStatus =
  | 'verified'
  | 'lp-not-burned'
  | 'owner-active'
  | 'unknown'
  | 'no-pool'
  | 'checking'

export function rugProofStatus(params: {
  owner: string | null
  ownerSupported: boolean
  pool: PoolState | undefined
  /** `undefined` mientras se lee `fetchBurnedLpInfo`. */
  lpFullyBurned: boolean | undefined
}): RugProofStatus {
  const { owner, ownerSupported, pool, lpFullyBurned } = params
  if (!ownerSupported) return 'unknown'
  if (owner !== null) return 'owner-active'
  if (!pool?.exists || pool.reserveXlm <= 0n) return 'no-pool'
  if (lpFullyBurned === undefined) return 'checking'
  return lpFullyBurned ? 'verified' : 'lp-not-burned'
}
