import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  computeStellarMinReserveStroops,
  DEFAULT_XLM_USD_PRICE,
  fetchXlmBalance,
  fetchXlmBalanceRaw,
  fetchXlmBalanceStroops,
  validateXlmReserve,
  xlmToStroops,
} from './xlm'

afterEach(() => {
  vi.unstubAllGlobals()
  if (typeof localStorage !== 'undefined') localStorage.clear()
})

describe('xlmToStroops', () => {
  it('convierte XLM a stroops sin decimales flotantes', () => {
    expect(xlmToStroops(1)).toBe(10_000_000n)
    expect(xlmToStroops('1')).toBe(10_000_000n)
    expect(xlmToStroops(0.1)).toBe(1_000_000n)
    expect(xlmToStroops('0.1')).toBe(1_000_000n)
    expect(xlmToStroops(0.29)).toBe(2_900_000n)
    expect(xlmToStroops('0.29')).toBe(2_900_000n)
    expect(xlmToStroops(0.0000001)).toBe(1n)
    expect(xlmToStroops('0.0000001')).toBe(1n)
    expect(xlmToStroops(10_000)).toBe(100_000_000_000n)
    expect(xlmToStroops('10,000')).toBe(100_000_000_000n)
  })

  it('devuelve 0 para valores inválidos o no positivos', () => {
    expect(xlmToStroops(0)).toBe(0n)
    expect(xlmToStroops(-1)).toBe(0n)
    expect(xlmToStroops(Number.NaN)).toBe(0n)
    expect(xlmToStroops(Number.POSITIVE_INFINITY)).toBe(0n)
  })
})

describe('fetchXlmBalance', () => {
  it('resuelve 0 para cuentas aún inexistentes (Horizon 404)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('resource missing', { status: 404 })),
    )
    await expect(fetchXlmBalance('GTEST')).resolves.toBe(0)
  })

  it('lanza error para fallos de Horizon distintos de 404 (no simula balance 0)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('server error', { status: 500 })),
    )
    await expect(fetchXlmBalance('GTEST')).rejects.toThrow('500')
  })

  it('extrae el balance nativo sobre una respuesta 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            balances: [
              { asset_type: 'credit_alphanum4', balance: '1.0' },
              { asset_type: 'native', balance: '42.5' },
            ],
          }),
          { status: 200 },
        ),
      ),
    )
    await expect(fetchXlmBalance('GTEST')).resolves.toBe(42.5)
    await expect(fetchXlmBalanceRaw('GTEST')).resolves.toBe('42.5')
    await expect(fetchXlmBalanceStroops('GTEST')).resolves.toBe(425_000_000n)
  })
})

describe('fetchXlmUsdPrice', () => {
  it('cae al precio por defecto cuando todos los oracles fallan', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 503 })),
    )
    const { fetchXlmUsdPrice } = await import('./xlm')
    await expect(fetchXlmUsdPrice()).resolves.toBe(DEFAULT_XLM_USD_PRICE)
  })
})

describe('validateXlmReserve', () => {
  it('protege la reserva mínima de 1 XLM más el gasto de la tx', () => {
    expect(validateXlmReserve(undefined)).toBeNull()
    expect(validateXlmReserve(1.5)).toBeNull()
    expect(validateXlmReserve(1.0)).toBeNull()
    expect(validateXlmReserve(0.95)).toContain('at least 1 XLM')
    expect(validateXlmReserve(5, 4_0000000n)).toBeNull()
    expect(validateXlmReserve(5, 4_5000000n)).toContain('need at least 5.5 XLM')
    expect(validateXlmReserve(5, 6_0000000n)).toContain('Insufficient XLM balance')
  })

  it('calcula reserva exacta con subentries, sponsorships y selling liabilities', () => {
    // 2 base + 6 subentries = 8 * 0.5 = 4.0 XLM + 0.5 XLM liabilities = 4.5 XLM
    const minRes = computeStellarMinReserveStroops({
      subentry_count: 6,
      num_sponsoring: 0,
      num_sponsored: 0,
      selling_liabilities: '0.5',
    })
    expect(minRes).toBe(45_000_000n)
    // Con 4.5 XLM base + 0.5 XLM headroom = 5.0 XLM buffer -> gastar 1 XLM requiere 6 XLM
    expect(validateXlmReserve(5.5, 10_000_000n, minRes)).toContain('need at least 6 XLM')
    expect(validateXlmReserve(6.0, 10_000_000n, minRes)).toBeNull()
  })
})
