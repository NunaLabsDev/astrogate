/**
 * Pure, runtime-agnostic Fair-Flywheel v4.5 bonding-curve constants and
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
export const CREATOR_ALLOCATION_BPS = 30n
export const SPARK_JACKPOT_BPS = 5n
export const CROWN_JACKPOT_BPS = 10n
export const GRADUATION_JACKPOT_BPS = 25n
export const TOTAL_JACKPOT_BPS = 40n
export const DEV_ALLOCATION_BPS = 30n
export const BURN_VAULT_ALLOCATION_BPS = 0n
export const POOL_ALLOCATION_BPS = 9_900n

export const FAIR_INITIAL_SUPPLY_BASE = FAIR_LAUNCH_TOTAL_BASIS * STROOPS_PER_UNIT
export const CURVE_TOKENS_ALLOC_BASE = 6_600_000n * STROOPS_PER_UNIT
export const DEX_TOKENS_ALLOC_BASE = 3_300_000n * STROOPS_PER_UNIT
export const CREATOR_VESTING_ALLOC_BASE = 30_000n * STROOPS_PER_UNIT
export const SPARK_JACKPOT_TOKENS = 5_000
export const CROWN_JACKPOT_TOKENS = 10_000
export const GRADUATION_JACKPOT_TOKENS = 25_000
export const TOTAL_JACKPOT_TOKENS = 40_000
export const SPARK_JACKPOT_TOKENS_ALLOC_BASE = 5_000n * STROOPS_PER_UNIT
export const CROWN_JACKPOT_TOKENS_ALLOC_BASE = 10_000n * STROOPS_PER_UNIT
export const GRADUATION_JACKPOT_TOKENS_ALLOC_BASE = 25_000n * STROOPS_PER_UNIT
export const TOTAL_JACKPOT_TOKENS_ALLOC_BASE = 40_000n * STROOPS_PER_UNIT
export const DEV_TOKENS_ALLOC_BASE = 30_000n * STROOPS_PER_UNIT
export const BURN_VAULT_TOKENS_ALLOC_BASE = 0n

export const CURVE_VIRTUAL_XLM_START_STROOPS = 1_000n * STROOPS_PER_UNIT
export const CURVE_REAL_XLM_GOAL_STROOPS = 1_000n * STROOPS_PER_UNIT
export const CURVE_VIRTUAL_TOKEN_START_BASE = 13_200_000n * STROOPS_PER_UNIT

export const STAGE_1_XLM = 250
export const STAGE_2_XLM = 500
export const STAGE_1_XLM_STROOPS = 250n * STROOPS_PER_UNIT
export const STAGE_2_XLM_STROOPS = 500n * STROOPS_PER_UNIT

export const BUY_TREASURY_EARLY_BPS = 20n
export const BUY_FLOOR_EARLY_BPS = 10n
export const BUY_TREASURY_MID_BPS = 30n
export const BUY_FLOOR_MID_BPS = 20n
export const BUY_TREASURY_SPRINT_BPS = 15n
export const BUY_FLOOR_SPRINT_BPS = 10n

export const TREASURY_FEE_BPS = 30n
export const POOL_FLOOR_FEE_BPS = 20n
export const SELL_TREASURY_EARLY_BPS = 30n
export const SELL_FLOOR_EARLY_BPS = 90n
export const SELL_TREASURY_MID_BPS = 40n
export const SELL_FLOOR_MID_BPS = 140n
export const SELL_TREASURY_SPRINT_BPS = 30n
export const SELL_FLOOR_SPRINT_BPS = 120n
export const SELL_FLOOR_LATE_BPS = SELL_FLOOR_SPRINT_BPS
export const BASE_CURVE_FEE_BPS = BUY_TREASURY_MID_BPS + BUY_FLOOR_MID_BPS
export const WHALE_FREE_SHARE_BPS = 10_000n
export const MAX_WHALE_SURCHARGE_BPS = 0n

export const BUYBACK_MAX_CHUNK_BPS = 25n
export const BUYBACK_MAX_CHUNK_STROOPS = 8_000_000n // 0.8000000 XLM
export const BUYBACK_MIN_DUST_STROOPS = 10_000n // 0.0010000 XLM
export const BUYBACK_KEEPER_BOUNTY_BPS = 200n // 2%
export const BUYBACK_MAX_BOUNTY_STROOPS = 500_000n // 0.0500000 XLM

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

export type CurveStageId = 'early' | 'mid' | 'sprint'

export type CurveStageInfo = {
  stage: 1 | 2 | 3
  id: CurveStageId
  label: string
  badge: string
  buyFeeBps: bigint
  sellFeeBps: bigint
  buyTreasuryBps: bigint
  buyFloorBps: bigint
  sellFloorBps: bigint
  buyFeePercent: string
  sellFeePercent: string
  sellFloorPercent: string
  progressPercent: number
  currentXlm: number
  remainingToNextStageXlm: number
  remainingToGoalXlm: number
  nextCheckpointTargetXlm: number
  nextCheckpointRewardTokens: number
  nextCheckpointLabel: string
  sparkClaimed: boolean
  crownClaimed: boolean
}

export function curveFeeBpsForOrder(
  curveXlmNet: bigint = 0n,
): { treasuryBps: bigint; floorBps: bigint; totalBps: bigint } {
  const safeNet = curveXlmNet < 0n ? 0n : curveXlmNet
  if (safeNet < STAGE_1_XLM_STROOPS) {
    return {
      treasuryBps: BUY_TREASURY_EARLY_BPS,
      floorBps: BUY_FLOOR_EARLY_BPS,
      totalBps: BUY_TREASURY_EARLY_BPS + BUY_FLOOR_EARLY_BPS,
    }
  }
  if (safeNet < STAGE_2_XLM_STROOPS) {
    return {
      treasuryBps: BUY_TREASURY_MID_BPS,
      floorBps: BUY_FLOOR_MID_BPS,
      totalBps: BUY_TREASURY_MID_BPS + BUY_FLOOR_MID_BPS,
    }
  }
  return {
    treasuryBps: BUY_TREASURY_SPRINT_BPS,
    floorBps: BUY_FLOOR_SPRINT_BPS,
    totalBps: BUY_TREASURY_SPRINT_BPS + BUY_FLOOR_SPRINT_BPS,
  }
}

export function curveSellFeeBps(curveXlmNet: bigint): {
  treasuryBps: bigint
  floorBps: bigint
  totalBps: bigint
} {
  const safeNet = curveXlmNet < 0n ? 0n : curveXlmNet
  if (safeNet < STAGE_1_XLM_STROOPS) {
    return {
      treasuryBps: SELL_TREASURY_EARLY_BPS,
      floorBps: SELL_FLOOR_EARLY_BPS,
      totalBps: SELL_TREASURY_EARLY_BPS + SELL_FLOOR_EARLY_BPS,
    }
  }
  if (safeNet < STAGE_2_XLM_STROOPS) {
    return {
      treasuryBps: SELL_TREASURY_MID_BPS,
      floorBps: SELL_FLOOR_MID_BPS,
      totalBps: SELL_TREASURY_MID_BPS + SELL_FLOOR_MID_BPS,
    }
  }
  return {
    treasuryBps: SELL_TREASURY_SPRINT_BPS,
    floorBps: SELL_FLOOR_SPRINT_BPS,
    totalBps: SELL_TREASURY_SPRINT_BPS + SELL_FLOOR_SPRINT_BPS,
  }
}

/**
 * Exact gross XLM needed (including current stage buy fee) to cross the next
 * unclaimed checkpoint (`250 XLM` +5K Spark, `500 XLM` +10K Crown, or `1,000 XLM` +25K Grad).
 */
export function curveNextCheckpointStroops(
  curveXlmNet: bigint,
  burnMilestoneStage = 0,
): {
  targetXlm: number
  rewardTokens: number
  label: string
  grossXlmNeededStroops: bigint
} {
  const safeNet = curveXlmNet < 0n ? 0n : curveXlmNet
  const { totalBps } = curveFeeBpsForOrder(safeNet)

  if (safeNet < STAGE_1_XLM_STROOPS && burnMilestoneStage < 1) {
    const delta = STAGE_1_XLM_STROOPS - safeNet
    return {
      targetXlm: STAGE_1_XLM,
      rewardTokens: SPARK_JACKPOT_TOKENS,
      label: '⚡ Spark Bonus',
      grossXlmNeededStroops: divCeil(delta * 10_000n, 10_000n - totalBps),
    }
  }
  if (safeNet < STAGE_2_XLM_STROOPS && burnMilestoneStage < 2) {
    const delta = STAGE_2_XLM_STROOPS - safeNet
    return {
      targetXlm: STAGE_2_XLM,
      rewardTokens: CROWN_JACKPOT_TOKENS,
      label: '👑 King Crown',
      grossXlmNeededStroops: divCeil(delta * 10_000n, 10_000n - totalBps),
    }
  }
  const delta =
    CURVE_REAL_XLM_GOAL_STROOPS > safeNet
      ? CURVE_REAL_XLM_GOAL_STROOPS - safeNet
      : 0n
  return {
    targetXlm: GRADUATION_TARGET_XLM,
    rewardTokens: GRADUATION_JACKPOT_TOKENS,
    label: '🏆 Graduation Jackpot',
    grossXlmNeededStroops:
      delta > 0n ? divCeil(delta * 10_000n, 10_000n - totalBps) : 0n,
  }
}

export function curveStageInfo(
  curveXlmNet: bigint,
  burnMilestoneStage = 0,
): CurveStageInfo {
  const safeNet = curveXlmNet < 0n ? 0n : curveXlmNet
  const currentXlm = Number(safeNet) / 1e7
  const progressPercent = Math.min(100, Math.max(0, (currentXlm / GRADUATION_TARGET_XLM) * 100))
  const remainingToGoalXlm = Math.max(0, GRADUATION_TARGET_XLM - currentXlm)
  const buy = curveFeeBpsForOrder(safeNet)
  const sell = curveSellFeeBps(safeNet)
  const buyFeePercent = (Number(buy.totalBps) / 100).toFixed(2)
  const sellFeePercent = (Number(sell.totalBps) / 100).toFixed(2)
  const sellFloorPercent = (Number(sell.floorBps) / 100).toFixed(2)
  const nextCheckpoint = curveNextCheckpointStroops(safeNet, burnMilestoneStage)
  const sparkClaimed = burnMilestoneStage >= 1 || safeNet >= STAGE_1_XLM_STROOPS
  const crownClaimed = burnMilestoneStage >= 2 || safeNet >= STAGE_2_XLM_STROOPS

  if (safeNet < STAGE_1_XLM_STROOPS) {
    return {
      stage: 1,
      id: 'early',
      label: 'Spark Ignition',
      badge: '🌱 Stage 1 · 0.30% Buy · Target: +5K Spark at 250 XLM',
      buyFeeBps: buy.totalBps,
      sellFeeBps: sell.totalBps,
      buyTreasuryBps: buy.treasuryBps,
      buyFloorBps: buy.floorBps,
      sellFloorBps: sell.floorBps,
      buyFeePercent,
      sellFeePercent,
      sellFloorPercent,
      progressPercent,
      currentXlm,
      remainingToNextStageXlm: Math.max(0, STAGE_1_XLM - currentXlm),
      remainingToGoalXlm,
      nextCheckpointTargetXlm: nextCheckpoint.targetXlm,
      nextCheckpointRewardTokens: nextCheckpoint.rewardTokens,
      nextCheckpointLabel: nextCheckpoint.label,
      sparkClaimed,
      crownClaimed,
    }
  }
  if (safeNet < STAGE_2_XLM_STROOPS) {
    return {
      stage: 2,
      id: 'mid',
      label: 'Crown Rush',
      badge: '👑 Stage 2 · 0.50% Buy · Target: +10K Crown at 500 XLM',
      buyFeeBps: buy.totalBps,
      sellFeeBps: sell.totalBps,
      buyTreasuryBps: buy.treasuryBps,
      buyFloorBps: buy.floorBps,
      sellFloorBps: sell.floorBps,
      buyFeePercent,
      sellFeePercent,
      sellFloorPercent,
      progressPercent,
      currentXlm,
      remainingToNextStageXlm: Math.max(0, STAGE_2_XLM - currentXlm),
      remainingToGoalXlm,
      nextCheckpointTargetXlm: nextCheckpoint.targetXlm,
      nextCheckpointRewardTokens: nextCheckpoint.rewardTokens,
      nextCheckpointLabel: nextCheckpoint.label,
      sparkClaimed,
      crownClaimed,
    }
  }
  return {
    stage: 3,
    id: 'sprint',
    label: 'Final Sprint',
    badge: '🔥 Stage 3 · 0.25% Sprint Buy · Target: +25K Jackpot at 1,000 XLM',
    buyFeeBps: buy.totalBps,
    sellFeeBps: sell.totalBps,
    buyTreasuryBps: buy.treasuryBps,
    buyFloorBps: buy.floorBps,
    sellFloorBps: sell.floorBps,
    buyFeePercent,
    sellFeePercent,
    sellFloorPercent,
    progressPercent,
    currentXlm,
    remainingToNextStageXlm: remainingToGoalXlm,
    remainingToGoalXlm,
    nextCheckpointTargetXlm: nextCheckpoint.targetXlm,
    nextCheckpointRewardTokens: nextCheckpoint.rewardTokens,
    nextCheckpointLabel: nextCheckpoint.label,
    sparkClaimed,
    crownClaimed,
  }
}

/**
 * Exact gross XLM stroops needed to reach 1,000 net XLM and graduate the curve
 * without leaving any excess unspent XLM.
 */
export function curveMaxBuyXlmStroops(curveXlmNet: bigint): bigint {
  const safeNet = curveXlmNet < 0n ? 0n : curveXlmNet
  const remaining =
    CURVE_REAL_XLM_GOAL_STROOPS > safeNet
      ? CURVE_REAL_XLM_GOAL_STROOPS - safeNet
      : 0n
  if (remaining <= 0n) return 0n
  const { totalBps } = curveFeeBpsForOrder(safeNet)
  return divCeil(remaining * 10_000n, 10_000n - totalBps)
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

  const { treasuryBps, floorBps, totalBps } = curveFeeBpsForOrder(curveXlmNet)
  const treasuryFeeFull = (maxXlmIn * treasuryBps) / 10_000n
  const floorBonusFull = (maxXlmIn * floorBps) / 10_000n
  const netFull = maxXlmIn - treasuryFeeFull - floorBonusFull

  if (netFull >= remainingToGoalXlm) {
    const netXlmToCurve = remainingToGoalXlm
    const {
      treasuryBps: ctBps,
      floorBps: cfBps,
      totalBps: ctotalBps,
    } = curveFeeBpsForOrder(curveXlmNet)
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
