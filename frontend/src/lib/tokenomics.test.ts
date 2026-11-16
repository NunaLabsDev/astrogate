import { describe, expect, it } from 'vitest'
import { localAmountOut } from './soroswap'
import {
  BASE_CURVE_FEE_BPS,
  BURN_VAULT_TOKENS_ALLOC_BASE,
  calculateSupplySharePercent,
  costToBuyPoolShareStroops,
  costToBuyPoolShareXlm,
  CREATOR_VESTING_ALLOC_BASE,
  CREATOR_VESTING_SCHEDULE,
  CURVE_TOKENS_ALLOC_BASE,
  DEFAULT_OPTIMIZED_SEED_XLM,
  DEX_TOKENS_ALLOC_BASE,
  FAIR_INITIAL_SUPPLY_BASE,
  GRADUATION_TARGET_XLM,
  graduationProgress,
  localCurveQuoteBuy,
  localCurveQuoteSell,
  poolAllocationBase,
  rugProofStatus,
  SEED_LIQUIDITY_PRESETS,
  STELLAR_BURN_ADDRESS,
  STROOPS_PER_UNIT,
  WHALE_TRADE_SHARE_BPS,
  whaleThresholdBase,
} from './tokenomics'

describe('allocation math (Fair-Flywheel v4.2: 42 / 28 / 29.5 / 0.5)', () => {
  it('reparte 42% curva, 28% DEX, 29.5% quema, 0.5% vesting sobre 10M', () => {
    expect(
      CURVE_TOKENS_ALLOC_BASE +
        DEX_TOKENS_ALLOC_BASE +
        BURN_VAULT_TOKENS_ALLOC_BASE +
        CREATOR_VESTING_ALLOC_BASE,
    ).toBe(FAIR_INITIAL_SUPPLY_BASE)
    expect(poolAllocationBase(FAIR_INITIAL_SUPPLY_BASE)).toBe(
      9_950_000n * STROOPS_PER_UNIT,
    )
    expect(STELLAR_BURN_ADDRESS).toHaveLength(56)
    expect(CREATOR_VESTING_SCHEDULE).toHaveLength(5)
    expect(
      CREATOR_VESTING_SCHEDULE.reduce((sum, p) => sum + p.tokensAmount, 0),
    ).toBe(50_000)
  })

  it('devuelve 0 sobre supplies inválidos', () => {
    expect(poolAllocationBase(0n)).toBe(0n)
  })
})

describe('localCurveQuoteBuy & localCurveQuoteSell (paridad 1:1 con Rust v4.2)', () => {
  it('aplica fee plano 80 bps (0.50% treasury + 0.30% floor) en compras chicas y grandes', () => {
    const q = localCurveQuoteBuy(0n, 0n, 10n * STROOPS_PER_UNIT)
    expect(q).not.toBeNull()
    expect(q!.total_fee_bps).toBe(BASE_CURVE_FEE_BPS)
    expect(q!.treasury_fee).toBe(500_000n)
    expect(q!.floor_bonus).toBe(300_000n)
    expect(q!.will_graduate).toBe(false)
    // At 2,000 vXLM / 12.6M vTok, 10 XLM buys ~62.2K tokens
    expect(q!.tokens_out).toBeGreaterThan(60_000n * STROOPS_PER_UNIT)
    expect(q!.tokens_out).toBeLessThan(65_000n * STROOPS_PER_UNIT)

    const qLarge = localCurveQuoteBuy(0n, 0n, 200n * STROOPS_PER_UNIT)
    expect(qLarge).not.toBeNull()
    expect(qLarge!.total_fee_bps).toBe(BASE_CURVE_FEE_BPS)
  })

  it('aplica fee asimétrico anti-sniper en ventas (2.50% temprano, 1.50% tardío) hacia el floor', () => {
    const earlyBuy = localCurveQuoteBuy(0n, 0n, 100n * STROOPS_PER_UNIT)!
    const earlySell = localCurveQuoteSell(
      earlyBuy.net_xlm_to_curve,
      earlyBuy.tokens_out,
      earlyBuy.tokens_out,
    )
    expect(earlySell).not.toBeNull()
    expect(earlySell!.total_fee_bps).toBe(250n)
    expect(earlySell!.floor_bonus).toBeGreaterThan(earlySell!.treasury_fee)

    const lateSell = localCurveQuoteSell(
      600n * STROOPS_PER_UNIT,
      2_800_000n * STROOPS_PER_UNIT,
      100_000n * STROOPS_PER_UNIT,
    )
    expect(lateSell).not.toBeNull()
    expect(lateSell!.total_fee_bps).toBe(150n)
  })

  it('topa la última compra al remanente de 1,000 XLM netos y gradúa 100% de la curva (4.2M)', () => {
    const q = localCurveQuoteBuy(
      950n * STROOPS_PER_UNIT,
      4_000_000n * STROOPS_PER_UNIT,
      100n * STROOPS_PER_UNIT,
    )
    expect(q).not.toBeNull()
    expect(q!.will_graduate).toBe(true)
    expect(q!.net_xlm_to_curve).toBe(50n * STROOPS_PER_UNIT)
    expect(q!.tokens_out).toBe(200_000n * STROOPS_PER_UNIT)
    expect(q!.total_xlm_charged).toBeLessThan(100n * STROOPS_PER_UNIT)
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
