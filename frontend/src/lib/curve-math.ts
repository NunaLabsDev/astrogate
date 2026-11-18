/**
 * Pure, runtime-agnostic Fair-Flywheel v4.3 bonding-curve constants and
 * integer quoting formulas (1:1 parity with `contracts/launchpad/src/contract.rs`).
 *
 * Kept strictly free of Vite (`import.meta.env`) and DOM globals so both
 * browser code (`tokenomics.ts`) and Cloudflare Worker / Node runtimes share
 * the exact same math without duplication.
 */

export const STROOPS_PER_UNIT = 10_000_000n
export const FAIR_LAUNCH_TOTAL_BASIS = 10_000_000n
export const LAUNCH_CREATION_FEE_XLM = 7
export const LAUNCH_CREATION_FEE_STROOPS = 70_000_000n
export const MIN_SEED_XLM = 2
export const MIN_SEED_XLM_STROOPS = 20_000_000n
export const FAIR_LAUNCH_DECIMALS = 7
export const GRADUATION_TARGET_XLM = 1_000
export const LP_LOCK_YEARS = 7

export const CURVE_ALLOCATION_BPS = 6_600n
export const DEX_ALLOCATION_BPS = 3_300n
export const DEV_ALLOCATION_BPS = 70n
export const BURN_VAULT_ALLOCATION_BPS = 0n
export const CREATOR_ALLOCATION_BPS = 30n
export const POOL_ALLOCATION_BPS = 9_900n

export const FAIR_INITIAL_SUPPLY_BASE = FAIR_LAUNCH_TOTAL_BASIS * STROOPS_PER_UNIT
export const CURVE_TOKENS_ALLOC_BASE = 6_600_000n * STROOPS_PER_UNIT
export const DEX_TOKENS_ALLOC_BASE = 3_300_000n * STROOPS_PER_UNIT
export const DEV_TOKENS_ALLOC_BASE = 70_000n * STROOPS_PER_UNIT
export const BURN_VAULT_TOKENS_ALLOC_BASE = 0n
export const CREATOR_VESTING_ALLOC_BASE = 30_000n * STROOPS_PER_UNIT

export const CURVE_VIRTUAL_XLM_START_STROOPS = 1_000n * STROOPS_PER_UNIT
export const CURVE_REAL_XLM_GOAL_STROOPS = 1_000n * STROOPS_PER_UNIT
export const CURVE_VIRTUAL_TOKEN_START_BASE = 13_200_000n * STROOPS_PER_UNIT

export const TREASURY_FEE_BPS = 50n
export const POOL_FLOOR_FEE_BPS = 30n
export const SELL_FLOOR_EARLY_BPS = 200n
export const SELL_FLOOR_LATE_BPS = 100n
export const BASE_CURVE_FEE_BPS = TREASURY_FEE_BPS + POOL_FLOOR_FEE_BPS
export const WHALE_FREE_SHARE_BPS = 10_000n
export const MAX_WHALE_SURCHARGE_BPS = 0n

export const STELLAR_BURN_ADDRESS =
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'

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

export function divCeil(a: bigint, b: bigint): bigint {
  return (a + b - 1n) / b
}

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
