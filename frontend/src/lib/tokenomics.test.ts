import { describe, expect, it } from 'vitest'
import { localAmountOut } from './soroswap'
import {
  BURN_VAULT_TOKENS_ALLOC_BASE,
  calculateSupplySharePercent,
  costToBuyPoolShareStroops,
  costToBuyPoolShareXlm,
  CREATOR_VESTING_ALLOC_BASE,
  CREATOR_VESTING_SCHEDULE,
  CROWN_JACKPOT_TOKENS,
  CROWN_JACKPOT_TOKENS_ALLOC_BASE,
  CURVE_TOKENS_ALLOC_BASE,
  curveMaxBuyXlmStroops,
  curveNextCheckpointStroops,
  curveStageInfo,
  DEFAULT_OPTIMIZED_SEED_XLM,
  DEV_TOKENS_ALLOC_BASE,
  DEX_TOKENS_ALLOC_BASE,
  FAIR_INITIAL_SUPPLY_BASE,
  GRADUATION_JACKPOT_TOKENS,
  GRADUATION_JACKPOT_TOKENS_ALLOC_BASE,
  GRADUATION_TARGET_XLM,
  graduationProgress,
  localCurveQuoteBuy,
  localCurveQuoteSell,
  poolAllocationBase,
  rugProofStatus,
  SEED_LIQUIDITY_PRESETS,
  SPARK_JACKPOT_TOKENS,
  SPARK_JACKPOT_TOKENS_ALLOC_BASE,
  STELLAR_BURN_ADDRESS,
  STROOPS_PER_UNIT,
  TOTAL_JACKPOT_TOKENS_ALLOC_BASE,
  WHALE_TRADE_SHARE_BPS,
  whaleThresholdBase,
} from './tokenomics'

describe('allocation math (Fair-Flywheel v4.4: 66 / 33 / 0.30 / 0.40 jackpots / 0.30 dev)', () => {
  it('reparte 66% curva, 33% DEX, 0.30% vesting creador, 0.40% jackpots (5K+10K+25K), 0.30% dev sobre 10M', () => {
    expect(BURN_VAULT_TOKENS_ALLOC_BASE).toBe(0n)
    expect(
      SPARK_JACKPOT_TOKENS_ALLOC_BASE +
        CROWN_JACKPOT_TOKENS_ALLOC_BASE +
        GRADUATION_JACKPOT_TOKENS_ALLOC_BASE,
    ).toBe(TOTAL_JACKPOT_TOKENS_ALLOC_BASE)
    expect(
      CURVE_TOKENS_ALLOC_BASE +
        DEX_TOKENS_ALLOC_BASE +
        BURN_VAULT_TOKENS_ALLOC_BASE +
        CREATOR_VESTING_ALLOC_BASE +
        TOTAL_JACKPOT_TOKENS_ALLOC_BASE +
        DEV_TOKENS_ALLOC_BASE,
    ).toBe(FAIR_INITIAL_SUPPLY_BASE)
    expect(poolAllocationBase(FAIR_INITIAL_SUPPLY_BASE)).toBe(
      9_900_000n * STROOPS_PER_UNIT,
    )
    expect(STELLAR_BURN_ADDRESS).toHaveLength(56)
    expect(CREATOR_VESTING_SCHEDULE).toHaveLength(5)
    expect(
      CREATOR_VESTING_SCHEDULE.reduce((sum, p) => sum + p.tokensAmount, 0),
    ).toBe(30_000)
  })

  it('devuelve 0 sobre supplies inválidos', () => {
    expect(poolAllocationBase(0n)).toBe(0n)
  })
})

describe('localCurveQuoteBuy & localCurveQuoteSell (paridad 1:1 con Rust v4.4)', () => {
  it('aplica fees suavizadas en 3 etapas para compras (0.30% / 0.50% / 0.25%) sin penalizar ballenas', () => {
    const qEarly = localCurveQuoteBuy(0n, 0n, 10n * STROOPS_PER_UNIT)
    expect(qEarly).not.toBeNull()
    expect(qEarly!.total_fee_bps).toBe(30n)
    expect(qEarly!.treasury_fee).toBe(200_000n)
    expect(qEarly!.floor_bonus).toBe(100_000n)
    expect(qEarly!.will_graduate).toBe(false)
    expect(qEarly!.tokens_out).toBeGreaterThan(125_000n * STROOPS_PER_UNIT)
    expect(qEarly!.tokens_out).toBeLessThan(135_000n * STROOPS_PER_UNIT)

    const qLargeEarly = localCurveQuoteBuy(0n, 0n, 200n * STROOPS_PER_UNIT)
    expect(qLargeEarly).not.toBeNull()
    expect(qLargeEarly!.total_fee_bps).toBe(30n)

    const qMid = localCurveQuoteBuy(300n * STROOPS_PER_UNIT, 2_000_000n * STROOPS_PER_UNIT, 10n * STROOPS_PER_UNIT)
    expect(qMid!.total_fee_bps).toBe(50n)
    expect(curveStageInfo(300n * STROOPS_PER_UNIT, 1).stage).toBe(2)

    const qSprint = localCurveQuoteBuy(550n * STROOPS_PER_UNIT, 4_000_000n * STROOPS_PER_UNIT, 10n * STROOPS_PER_UNIT)
    expect(qSprint!.total_fee_bps).toBe(25n)
    expect(curveStageInfo(550n * STROOPS_PER_UNIT, 2).stage).toBe(3)
  })

  it('aplica fee suavizado en ventas (1.20% temprano, 1.80% mitad de camino, 1.50% sprint)', () => {
    const earlyBuy = localCurveQuoteBuy(0n, 0n, 100n * STROOPS_PER_UNIT)!
    const earlySell = localCurveQuoteSell(
      earlyBuy.net_xlm_to_curve,
      earlyBuy.tokens_out,
      earlyBuy.tokens_out,
    )
    expect(earlySell).not.toBeNull()
    expect(earlySell!.total_fee_bps).toBe(120n)
    expect(earlySell!.floor_bonus).toBeGreaterThan(earlySell!.treasury_fee)

    const midSell = localCurveQuoteSell(
      350n * STROOPS_PER_UNIT,
      2_600_000n * STROOPS_PER_UNIT,
      100_000n * STROOPS_PER_UNIT,
    )
    expect(midSell).not.toBeNull()
    expect(midSell!.total_fee_bps).toBe(180n)

    const sprintSell = localCurveQuoteSell(
      600n * STROOPS_PER_UNIT,
      4_500_000n * STROOPS_PER_UNIT,
      100_000n * STROOPS_PER_UNIT,
    )
    expect(sprintSell).not.toBeNull()
    expect(sprintSell!.total_fee_bps).toBe(150n)
  })

  it('calcula curveNextCheckpointStroops exacto sin re-prometer checkpoints ya reclamados', () => {
    const cp1 = curveNextCheckpointStroops(100n * STROOPS_PER_UNIT, 0)
    expect(cp1.targetXlm).toBe(250)
    expect(cp1.rewardTokens).toBe(SPARK_JACKPOT_TOKENS)
    const q1 = localCurveQuoteBuy(100n * STROOPS_PER_UNIT, 1_000_000n * STROOPS_PER_UNIT, cp1.grossXlmNeededStroops)!
    expect(100n * STROOPS_PER_UNIT + q1.net_xlm_to_curve).toBeGreaterThanOrEqual(250n * STROOPS_PER_UNIT)

    // Si alguien vendió por debajo de 250 XLM pero burn_milestone_stage ya es 1, el siguiente premio es 500 XLM (+10K)
    const cpAfterDrop = curveNextCheckpointStroops(200n * STROOPS_PER_UNIT, 1)
    expect(cpAfterDrop.targetXlm).toBe(500)
    expect(cpAfterDrop.rewardTokens).toBe(CROWN_JACKPOT_TOKENS)

    const cp3 = curveNextCheckpointStroops(600n * STROOPS_PER_UNIT, 2)
    expect(cp3.targetXlm).toBe(1_000)
    expect(cp3.rewardTokens).toBe(GRADUATION_JACKPOT_TOKENS)
  })

  it('topa la última compra al remanente de 1,000 XLM netos y curveMaxBuyXlmStroops cuadra exacto', () => {
    const netNow = 950n * STROOPS_PER_UNIT
    const soldNow = 6_250_000n * STROOPS_PER_UNIT
    const exactMax = curveMaxBuyXlmStroops(netNow)
    const exactQuote = localCurveQuoteBuy(netNow, soldNow, exactMax)!
    expect(exactQuote.will_graduate).toBe(true)
    expect(exactQuote.total_xlm_charged).toBe(exactMax)
    expect(exactQuote.net_xlm_to_curve).toBe(50n * STROOPS_PER_UNIT)

    const q = localCurveQuoteBuy(netNow, soldNow, 100n * STROOPS_PER_UNIT)
    expect(q).not.toBeNull()
    expect(q!.will_graduate).toBe(true)
    expect(q!.net_xlm_to_curve).toBe(50n * STROOPS_PER_UNIT)
    expect(q!.tokens_out).toBe(350_000n * STROOPS_PER_UNIT)
    expect(q!.total_xlm_charged).toBe(exactMax)
  })

  it('cotiza venta en curva sin exceder el vault neto', () => {
    const buy = localCurveQuoteBuy(0n, 0n, 20n * STROOPS_PER_UNIT)!
    const sell = localCurveQuoteSell(
      buy.net_xlm_to_curve,
      buy.tokens_out,
      buy.tokens_out,
    )
    expect(sell).not.toBeNull()
    expect(sell!.net_xlm_out).toBeLessThan(20n * STROOPS_PER_UNIT)
    expect(sell!.gross_xlm_out).toBeLessThanOrEqual(buy.net_xlm_to_curve)
  })
})

describe('whale threshold', () => {
  it('marca ballena a partir del 1% del supply del fair launch (100K) en base units', () => {
    expect(WHALE_TRADE_SHARE_BPS).toBe(100n)
    // 1% de 10M con 7 decimales = 100K tokens = 100K * 1e7 base units.
    expect(whaleThresholdBase(7)).toBe(100_000n * 10_000_000n)
  })

  it('escala con los decimales del token y tolera valores inválidos', () => {
    expect(whaleThresholdBase(0)).toBe(100_000n)
    expect(whaleThresholdBase(-3)).toBe(100_000n)
    expect(whaleThresholdBase(2.9)).toBe(100_000n * 100n)
    expect(whaleThresholdBase()).toBe(whaleThresholdBase(7))
  })
})

describe('graduationProgress', () => {
  const stroops = 10_000_000n

  it('clasifica etapas desde sin liquidez hasta graduado en 1000 XLM', () => {
    expect(GRADUATION_TARGET_XLM).toBe(1_000)
    expect(graduationProgress(0n).stage).toBe('no-pool')
    expect(graduationProgress(50n * stroops).stage).toBe('seed')
    expect(graduationProgress(250n * stroops).stage).toBe('rising')
    expect(graduationProgress(250n * stroops).percent).toBe(25)
    expect(graduationProgress(600n * stroops).stage).toBe('heating')
    const grad = graduationProgress(1_000n * stroops)
    expect(grad.stage).toBe('graduated')
    expect(grad.graduated).toBe(true)
    expect(grad.percent).toBe(100)

    // NaN en targetXlm no rompe el cálculo
    const nanTarget = graduationProgress(250n * stroops, Number.NaN)
    expect(nanTarget.stage).toBe('rising')
    expect(nanTarget.percent).toBe(25)
  })
})

describe('rugProofStatus (fail-closed)', () => {
  const pool = {
    exists: true,
    pairId: 'CPAIR',
    reserveToken: 990n,
    reserveXlm: 100n,
  }

  it('solo verifica con owner renunciado + pool + 100% LP quemado', () => {
    expect(
      rugProofStatus({ owner: null, ownerSupported: true, pool, lpFullyBurned: true }),
    ).toBe('verified')
  })

  it('no certifica si los LP no están quemados aunque el owner esté renunciado', () => {
    expect(
      rugProofStatus({ owner: null, ownerSupported: true, pool, lpFullyBurned: false }),
    ).toBe('lp-not-burned')
    expect(
      rugProofStatus({ owner: null, ownerSupported: true, pool, lpFullyBurned: undefined }),
    ).toBe('checking')
  })

  it('distingue owner activo, token externo y ausencia de pool', () => {
    expect(
      rugProofStatus({ owner: 'GOWNER', ownerSupported: true, pool, lpFullyBurned: true }),
    ).toBe('owner-active')
    expect(
      rugProofStatus({ owner: null, ownerSupported: false, pool, lpFullyBurned: true }),
    ).toBe('unknown')
    expect(
      rugProofStatus({
        owner: null,
        ownerSupported: true,
        pool: { ...pool, exists: false, reserveXlm: 0n },
        lpFullyBurned: true,
      }),
    ).toBe('no-pool')
  })
})

describe('fair seed & supply share math', () => {
  it('define una semilla inicial balanceada de 10 XLM y presets', () => {
    expect(DEFAULT_OPTIMIZED_SEED_XLM).toBe(10)
    expect(SEED_LIQUIDITY_PRESETS.length).toBeGreaterThanOrEqual(4)
    const recommended = SEED_LIQUIDITY_PRESETS.find((p) => p.isRecommended)
    expect(recommended?.xlm).toBe(10)
  })

  it('calcula el porcentaje de tokens adquiridos sobre el pool sin bloquear libre comercio', () => {
    const poolTokens = 9_950_000n * 10_000_000n // 9.95M tokens con 7 decimales
    const order100K = 100_000n * 10_000_000n
    const percent = calculateSupplySharePercent(order100K, poolTokens)
    // 100K / 9.95M ≈ 1.005% -> 1.00%
    expect(percent).toBeCloseTo(1.0, 1)

    // Usa totalBase por defecto con unidades escaladas a Stroops (10^7)
    const defaultPercent = calculateSupplySharePercent(order100K)
    expect(defaultPercent).toBeCloseTo(1.0, 1)

    // Si orden es 0 o negativo
    expect(calculateSupplySharePercent(0n, poolTokens)).toBe(0)
  })

  it('computes exact anti-sniper/anti-whale cost for acquiring p% of pool', () => {
    const reserveXlm10 = 10n * 10_000_000n // 10 XLM in stroops
    const reserveTokens = 9_950_000n * 10_000_000n

    const cost10Pct = costToBuyPoolShareStroops(reserveXlm10, 10)
    const xlm10Pct = costToBuyPoolShareXlm(reserveXlm10, 10)
    expect(xlm10Pct).toBeCloseTo(1.1145, 3)

    const out10 = localAmountOut(cost10Pct, reserveXlm10, reserveTokens)
    expect(calculateSupplySharePercent(out10, reserveTokens)).toBeCloseTo(10, 1)

    const cost50Pct = costToBuyPoolShareXlm(reserveXlm10, 50)
    expect(cost50Pct).toBeCloseTo(10.03, 2)

    expect(costToBuyPoolShareStroops(0n, 10)).toBe(0n)
    expect(costToBuyPoolShareStroops(reserveXlm10, 0)).toBe(0n)
    expect(costToBuyPoolShareStroops(reserveXlm10, Number.NaN)).toBe(0n)
  })
})
