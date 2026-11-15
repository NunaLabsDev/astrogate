import { describe, expect, it } from 'vitest'
import { localAmountOut } from './soroswap'
import {
  calculateSupplySharePercent,
  costToBuyPoolShareStroops,
  costToBuyPoolShareXlm,
  DEFAULT_OPTIMIZED_SEED_XLM,
  graduationProgress,
  poolAllocationBase,
  rugProofStatus,
  SEED_LIQUIDITY_PRESETS,
  STELLAR_BURN_ADDRESS,
  WHALE_TRADE_SHARE_BPS,
  whaleThresholdBase,
} from './tokenomics'

describe('allocation math (single source for 99.5M/500K figures)', () => {
  it('reparte 0.5% creador y 99.5% pool sobre el supply estándar de 100M', () => {
    const oneHundredMillion = 100_000_000n * 10_000_000n // 100M con 7 decimales
    expect(poolAllocationBase(oneHundredMillion)).toBe(99_500_000n * 10_000_000n) // 99.5M (99.5%)
    expect(STELLAR_BURN_ADDRESS).toHaveLength(56)
  })

  it('devuelve 0 sobre supplies inválidos', () => {
    expect(poolAllocationBase(0n)).toBe(0n)
  })
})

describe('whale threshold', () => {
  it('marca ballena a partir del 1% del supply del fair launch (1M) en base units', () => {
    expect(WHALE_TRADE_SHARE_BPS).toBe(100n)
    // 1% de 100M con 7 decimales = 1M tokens = 1M * 1e7 base units.
    expect(whaleThresholdBase(7)).toBe(1_000_000n * 10_000_000n)
  })

  it('escala con los decimales del token y tolera valores inválidos', () => {
    expect(whaleThresholdBase(0)).toBe(1_000_000n)
    expect(whaleThresholdBase(-3)).toBe(1_000_000n)
    expect(whaleThresholdBase(2.9)).toBe(1_000_000n * 100n)
    expect(whaleThresholdBase()).toBe(whaleThresholdBase(7))
  })
})

describe('graduationProgress', () => {
  const stroops = 10_000_000n

  it('clasifica etapas desde sin liquidez hasta graduado en 2000 XLM', () => {
    expect(graduationProgress(0n).stage).toBe('no-pool')
    expect(graduationProgress(100n * stroops).stage).toBe('seed')
    expect(graduationProgress(500n * stroops).stage).toBe('rising')
    expect(graduationProgress(500n * stroops).percent).toBe(25)
    expect(graduationProgress(1_200n * stroops).stage).toBe('heating')
    const grad = graduationProgress(2_500n * stroops)
    expect(grad.stage).toBe('graduated')
    expect(grad.graduated).toBe(true)
    expect(grad.percent).toBe(100)

    // NaN en targetXlm no rompe el cálculo
    const nanTarget = graduationProgress(500n * stroops, Number.NaN)
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
    const poolTokens = 99_500_000n * 10_000_000n // 99.5M tokens con 7 decimales
    const order1M = 1_000_000n * 10_000_000n
    const percent = calculateSupplySharePercent(order1M, poolTokens)
    // 1M / 99.5M ≈ 1.005% -> 1.00%
    expect(percent).toBeCloseTo(1.0, 1)

    // Usa totalBase por defecto con unidades escaladas a Stroops (10^7)
    const defaultPercent = calculateSupplySharePercent(order1M)
    expect(defaultPercent).toBeCloseTo(1.0, 1)

    // Si orden es 0 o negativo
    expect(calculateSupplySharePercent(0n, poolTokens)).toBe(0)
  })

  it('computes exact anti-sniper/anti-whale cost for acquiring p% of pool', () => {
    const reserveXlm10 = 10n * 10_000_000n // 10 XLM in stroops
    const reserveTokens = 99_500_000n * 10_000_000n

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
