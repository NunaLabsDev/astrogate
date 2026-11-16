/**
 * Fair-Flywheel v4.2 Tokenomics (AstroGate 42 / 28 / 29.5 / 0.5 on Stellar / Soroban).
 *
 * Fair & Sustainable Flywheel Rules:
 * 1. Standard Supply: 10,000,000 tokens (7 decimals, aligned with 1 XLM = 10^7 stroops).
 * 2. 42.0% (4,200,000 tokens): Virtual Bonding Curve (`2,000 vXLM -> 1,000 real XLM goal`),
 *    2.25x curve appreciation with FLAT 0.80% buy fee (zero whale surcharge on buys!).
 * 3. 28.0% (2,800,000 tokens): Reserved for Soroswap DEX Pool at graduation + >= 1,000 real XLM,
 *    with 0.00% graduation cliff and 100% LP burned to `GAAAA...WHF`.
 * 4. 29.5% (2,950,000 tokens): Milestone Proof-of-Burn Vault — 1,475,000 burned via `token.burn()`
 *    at graduation + 1,475,000 permissionlessly burned once Soroswap XLM reserve >= 1,800 XLM,
 *    plus 60% of surplus curve floor fees reserved for real Soroswap Buyback & Burn.
 * 5. 0.5% (50,000 tokens): 15-day post-graduation creator vesting (5 tranches of 10,000 every 3 days),
 *    plus creator's initial paid curve seed locked until graduation.
 * 6. Renounced Ownership & Curve Lock: Minting disabled forever; P2P transfers locked until graduation.
 */
import type { PoolState } from './soroswap'
import { DEFAULT_XLM_USD_PRICE } from './xlm'

export { DEVELOPER_TREASURY_ADDRESS } from './network'

/** Stroops / smallest unit per whole unit (10^7 on Stellar). */
export const STROOPS_PER_UNIT = 10_000_000n

/** Total supply in readable units for a standard fair launch (10M, 7 decimals). */
export const FAIR_LAUNCH_TOTAL_BASIS = 10_000_000n

/** Fixed protocol creation fee charged atomically on `launch_fair` (`7 XLM -> treasury`). */
export const LAUNCH_CREATION_FEE_XLM = 7

/** Fixed creation fee in XLM stroops (`7 * 10^7`). */
export const LAUNCH_CREATION_FEE_STROOPS = 70_000_000n

/** Minimum initial curve buy required by Launchpad v4.1 (`launch_fair`: 2 XLM). */
export const MIN_SEED_XLM = 2

/** Minimum initial curve buy in XLM stroops (2 * 10^7). */
export const MIN_SEED_XLM_STROOPS = 20_000_000n

/** Decimals of every token deployed by this launchpad (native Stellar convention). */
export const FAIR_LAUNCH_DECIMALS = 7

/** Fair-Flywheel v4.2 allocation breakdown in basis points (sum = 10,000 bps). */
export const CURVE_ALLOCATION_BPS = 4_200n // 42.0% -> 4,200,000 tokens
export const DEX_ALLOCATION_BPS = 2_800n // 28.0% -> 2,800,000 tokens
export const BURN_VAULT_ALLOCATION_BPS = 2_950n // 29.5% -> 2,950,000 tokens
export const CREATOR_ALLOCATION_BPS = 50n // 0.5%  -> 50,000 tokens (15d vesting)

/** Combined non-creator community/protocol pool (99.5% = 9,950 bps). */
export const POOL_ALLOCATION_BPS = 9_950n

/** Exact Fair-Flywheel v4.2 base-unit allocations (7 decimals). */
export const FAIR_INITIAL_SUPPLY_BASE = FAIR_LAUNCH_TOTAL_BASIS * STROOPS_PER_UNIT
export const CURVE_TOKENS_ALLOC_BASE = 4_200_000n * STROOPS_PER_UNIT
export const DEX_TOKENS_ALLOC_BASE = 2_800_000n * STROOPS_PER_UNIT
export const BURN_VAULT_TOKENS_ALLOC_BASE = 2_950_000n * STROOPS_PER_UNIT
export const CREATOR_VESTING_ALLOC_BASE = 50_000n * STROOPS_PER_UNIT

/** Virtual Bonding Curve constants (1:1 parity with `contracts/launchpad/src/contract.rs` v4.2). */
export const CURVE_VIRTUAL_XLM_START_STROOPS = 2_000n * STROOPS_PER_UNIT
export const CURVE_REAL_XLM_GOAL_STROOPS = 1_000n * STROOPS_PER_UNIT
export const CURVE_VIRTUAL_TOKEN_START_BASE = 12_600_000n * STROOPS_PER_UNIT

/** Curve Fee Model (1:1 parity with Rust v4.2 contract). */
export const TREASURY_FEE_BPS = 50n // 0.50% -> Developer Treasury
export const POOL_FLOOR_FEE_BPS = 30n // 0.30% -> LP/Buyback Vault on all buys (flat 0.80% total)
export const SELL_FLOOR_EARLY_BPS = 200n // 2.00% -> LP/Buyback Vault on early curve sells (<50% goal)
export const SELL_FLOOR_LATE_BPS = 100n // 1.00% -> LP/Buyback Vault on late curve sells (>=50% goal)
export const BASE_CURVE_FEE_BPS = TREASURY_FEE_BPS + POOL_FLOOR_FEE_BPS // 80 bps (0.80%)
export const WHALE_FREE_SHARE_BPS = 10_000n // v4.2: zero buy whale surcharge
export const MAX_WHALE_SURCHARGE_BPS = 0n

/** Milestone Proof-of-Burn Stage 2 trigger on graduated Soroswap pair. */
export const MILESTONE_2_PAIR_XLM = 1_800

/** 3-tier Burn-to-Chat thresholds in readable tokens. */
export const MIN_SHOUT_BURN = 50
export const HYPE_SHOUT_BURN = 500
export const KING_SHOUT_BURN = 5_000

/**
 * Stellar Canonical Burn Address (Blackhole / Dead Account):
 * 32-byte zero Ed25519 public key (`GAAAA...WHF`).
 * No private key exists. All LP tokens sent here are permanently locked.
 */
export const STELLAR_BURN_ADDRESS =
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

/**
 * Protocol Monetization Model (100% AstroGate Developers Treasury):
 * 1. Fair launch deployment: 0 deploy fee on testnet; $1.11 USD modeled for mainnet.
 * 2. Curve trading fee: 0.50% (50 bps) to Developer Treasury + 0.30% (30 bps) to pool floor
 *    + progressive anti-whale surcharge (>2% of vXLM, up to +5.00%) 100% into pool floor.
 * 3. Graduated Soroswap swaps: standard 0.30% LP fee stays in permanently burned LP.
 */
export const PROTOCOL_DEPLOY_FEE_USD = 1.11
export const DEVELOPER_TRADING_FEE_BPS = TREASURY_FEE_BPS
export const DEVELOPER_GRADUATION_FEE_XLM = 0

/** Ensure a fallback XLM/USD price is finite and positive; else use the default. */
export function sanitizeXlmUsdPrice(xlmUsdPrice: number): number {
  return Number.isFinite(xlmUsdPrice) && xlmUsdPrice > 0
    ? xlmUsdPrice
    : DEFAULT_XLM_USD_PRICE
}

/**
 * Computes how many XLM correspond to $1.11 USD at current live XLM price.
 */
export function calculateDeployFeeInXlm(
  xlmUsdPrice: number = DEFAULT_XLM_USD_PRICE,
): number {
  const safePrice = sanitizeXlmUsdPrice(xlmUsdPrice)
  return Math.round((PROTOCOL_DEPLOY_FEE_USD / safePrice) * 100) / 100
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
  const safeDecimals = Math.max(0, Math.trunc(decimals))
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
 * Calibrated to 1,000 real XLM on top of 3,000 vXLM (`M = 1/3`), eliminating early monopoly
 * while keeping graduation achievable on Stellar with 0.00% graduation price cliff.
 */
export const GRADUATION_TARGET_XLM = 1_000

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
 * Post-graduation creator vesting enforced on-chain by Launchpad v4.2 (`claim_creator_vesting`):
 * 0.5% (50,000 tokens) unlocks strictly in 5 tranches of 20% (10,000 tokens) every 3 days (15d total),
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
    tokensAmount: 10_000,
    label: 'Phase 1 (Day 3): 20% (10K tokens) after 72h DEX consolidation',
  },
  {
    phase: 2,
    day: 6,
    percent: 20,
    tokensAmount: 10_000,
    label: 'Phase 2 (Day 6): 20% (10K tokens)',
  },
  {
    phase: 3,
    day: 9,
    percent: 20,
    tokensAmount: 10_000,
    label: 'Phase 3 (Day 9): 20% (10K tokens)',
  },
  {
    phase: 4,
    day: 12,
    percent: 20,
    tokensAmount: 10_000,
    label: 'Phase 4 (Day 12): 20% (10K tokens)',
  },
  {
    phase: 5,
    day: 15,
    percent: 20,
    tokensAmount: 10_000,
    label: 'Phase 5 (Day 15): 20% (10K tokens) — Final 100% unlock',
  },
]

export type LocalBuyQuote = {
  total_xlm_charged: bigint
  net_xlm_to_curve: bigint
  treasury_fee: bigint
  floor_bonus: bigint
  tokens_out: bigint
  will_graduate: boolean
  total_fee_bps: bigint
}

export type LocalSellQuote = {
  gross_xlm_out: bigint
  net_xlm_out: bigint
  treasury_fee: bigint
  floor_bonus: bigint
  total_fee_bps: bigint
}

function divCeil(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b
}

/** Flat 0.80% buy fee on all Fair-Flywheel v4.2 curve purchases (zero whale penalty). */
export function curveFeeBpsForOrder(
  _virtualXlmStroops?: bigint,
  _orderXlmStroops?: bigint,
): { treasuryBps: bigint; floorBps: bigint; totalBps: bigint } {
  return {
    treasuryBps: TREASURY_FEE_BPS,
    floorBps: POOL_FLOOR_FEE_BPS,
    totalBps: BASE_CURVE_FEE_BPS,
  }
}

/** Asymmetric anti-sniper curve sell fee: 2.50% (<50% goal) or 1.50% (>=50% goal). */
export function curveSellFeeBps(curveXlmNet: bigint): {
  treasuryBps: bigint
  floorBps: bigint
  totalBps: bigint
} {
  const floorBps =
    curveXlmNet < CURVE_REAL_XLM_GOAL_STROOPS / 2n
      ? SELL_FLOOR_EARLY_BPS
      : SELL_FLOOR_LATE_BPS
  return {
    treasuryBps: TREASURY_FEE_BPS,
    floorBps,
    totalBps: TREASURY_FEE_BPS + floorBps,
  }
}

export function curveVirtualReserves(
  curveXlmNet: bigint,
  tokensSold: bigint,
): {
  virtualXlm: bigint
  virtualTokens: bigint
  remainingCurveTokens: bigint
  remainingToGoalXlm: bigint
} {
  const safeNet = curveXlmNet < 0n ? 0n : curveXlmNet
  const safeSold = tokensSold < 0n ? 0n : tokensSold
  return {
    virtualXlm: CURVE_VIRTUAL_XLM_START_STROOPS + safeNet,
    virtualTokens: CURVE_VIRTUAL_TOKEN_START_BASE - safeSold,
    remainingCurveTokens:
      CURVE_TOKENS_ALLOC_BASE > safeSold
        ? CURVE_TOKENS_ALLOC_BASE - safeSold
        : 0n,
    remainingToGoalXlm:
      CURVE_REAL_XLM_GOAL_STROOPS > safeNet
        ? CURVE_REAL_XLM_GOAL_STROOPS - safeNet
        : 0n,
  }
}

/**
 * Exact 1:1 TypeScript port of Launchpad v4 `compute_buy_quote`.
 */
export function localCurveQuoteBuy(
  curveXlmNet: bigint,
  tokensSold: bigint,
  maxXlmIn: bigint,
): LocalBuyQuote | null {
  if (maxXlmIn <= 0n) return null
  const { virtualXlm, virtualTokens, remainingCurveTokens, remainingToGoalXlm } =
    curveVirtualReserves(curveXlmNet, tokensSold)
  if (remainingToGoalXlm <= 0n || remainingCurveTokens <= 0n) return null

  const { treasuryBps, floorBps, totalBps } = curveFeeBpsForOrder(
    virtualXlm,
    maxXlmIn,
  )
  const treasuryFeeFull = (maxXlmIn * treasuryBps) / 10_000n
  const floorBonusFull = (maxXlmIn * floorBps) / 10_000n
  const netFull = maxXlmIn - treasuryFeeFull - floorBonusFull

  if (netFull >= remainingToGoalXlm) {
    const netXlmToCurve = remainingToGoalXlm
    const {
      treasuryBps: ctBps,
      floorBps: cfBps,
      totalBps: ctotalBps,
    } = curveFeeBpsForOrder(virtualXlm, netXlmToCurve)
    const maxFeeRoom = maxXlmIn - netXlmToCurve
    const denom = 10_000n - ctotalBps
    const idealGross = divCeil(netXlmToCurve * 10_000n, denom)
    const rawFee = idealGross - netXlmToCurve
    const idealFee = rawFee < maxFeeRoom ? rawFee : maxFeeRoom
    const totalXlmCharged = netXlmToCurve + idealFee
    const treasuryFee = (idealFee * ctBps) / (ctBps + cfBps)
    const floorBonus = idealFee - treasuryFee

    return {
      total_xlm_charged: totalXlmCharged,
      net_xlm_to_curve: netXlmToCurve,
      treasury_fee: treasuryFee,
      floor_bonus: floorBonus,
      tokens_out: remainingCurveTokens,
      will_graduate: true,
      total_fee_bps: ctotalBps,
    }
  }

  if (netFull <= 0n) return null
  const kCur = virtualXlm * virtualTokens
  const newVXlm = virtualXlm + netFull
  const newVTok = divCeil(kCur, newVXlm)
  const tokensOut = virtualTokens - newVTok
  if (tokensOut <= 0n || tokensOut > remainingCurveTokens) return null

  return {
    total_xlm_charged: maxXlmIn,
    net_xlm_to_curve: netFull,
    treasury_fee: treasuryFeeFull,
    floor_bonus: floorBonusFull,
    tokens_out: tokensOut,
    will_graduate: false,
    total_fee_bps: totalBps,
  }
}

/**
 * Exact 1:1 TypeScript port of Launchpad v4 `compute_sell_quote`.
 */
export function localCurveQuoteSell(
  curveXlmNet: bigint,
  tokensSold: bigint,
  tokenAmount: bigint,
): LocalSellQuote | null {
  if (tokenAmount <= 0n || curveXlmNet <= 0n || tokensSold <= 0n) return null
  if (tokenAmount > tokensSold) return null
  const { virtualXlm, virtualTokens } = curveVirtualReserves(
    curveXlmNet,
    tokensSold,
  )
  const kCur = virtualXlm * virtualTokens
  const newVTok = virtualTokens + tokenAmount
  let newVXlm = divCeil(kCur, newVTok)
  if (newVXlm < CURVE_VIRTUAL_XLM_START_STROOPS) {
    newVXlm = CURVE_VIRTUAL_XLM_START_STROOPS
  }
  const grossXlmOut = virtualXlm - newVXlm
  if (grossXlmOut <= 0n || grossXlmOut > curveXlmNet) return null

  const { treasuryBps, floorBps, totalBps } = curveSellFeeBps(curveXlmNet)
  const treasuryFee = (grossXlmOut * treasuryBps) / 10_000n
  const floorBonus = (grossXlmOut * floorBps) / 10_000n
  const netXlmOut = grossXlmOut - treasuryFee - floorBonus
  if (netXlmOut <= 0n) return null

  return {
    gross_xlm_out: grossXlmOut,
    net_xlm_out: netXlmOut,
    treasury_fee: treasuryFee,
    floor_bonus: floorBonus,
    total_fee_bps: totalBps,
  }
}

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
 * Default balanced initial buy on the Fair-Flywheel v4.1 Virtual Curve:
 * 10 XLM (~$1.55 USD) puts ~79.7K tokens in the creator's wallet at the fair floor price
 * (`~1,235 stroops/token`), keeping 99.2% of supply democratized.
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
    desc: 'Light Seed — ~$0.78 USD, ultra-low cost for micro-memes',
  },
  {
    xlm: 10,
    label: '10 XLM',
    desc: 'Recommended ⭐ — ~$1.55 USD, optimal balance & natural anti-sniper depth',
    isRecommended: true,
  },
  {
    xlm: 20,
    label: '20 XLM',
    desc: 'Deep — ~$3.10 USD, deeper pool for community launches',
  },
  {
    xlm: 50,
    label: '50 XLM',
    desc: 'Whale — For DAOs and established projects',
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
