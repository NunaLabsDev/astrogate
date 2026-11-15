import { describe, expect, it } from 'vitest'
import { analyzeTokenHolders } from './holders'
import type { TokenEvent } from './token-events'

const UNIT = 10_000_000n // 7 decimals
const TOTAL = 100_000_000n * UNIT // 100M
const PAIR = 'CPAIR111111111111111111111111111111111111111111111111111'
const CREATOR = 'GCREATOR111111111111111111111111111111111111111111111111'
const ALICE = 'GALICE11111111111111111111111111111111111111111111111111'
const BOB = 'GBOB1111111111111111111111111111111111111111111111111111'

describe('analyzeTokenHolders', () => {
  it('classifies freshly launched fair-launch distribution (99.5% pool, 0.5% creator) as low risk', () => {
    const reserveToken = 99_500_000n * UNIT
    const creatorBalance = 500_000n * UNIT
    const events: TokenEvent[] = [
      {
        id: 'ev-1',
        kind: 'transfer',
        from: PAIR,
        to: ALICE,
        amount: 2_000_000n * UNIT, // 2%
        ledger: 100,
        at: '2026-01-01T00:00:00Z',
      },
    ]

    const result = analyzeTokenHolders({
      totalSupply: TOTAL,
      reserveToken: 97_500_000n * UNIT,
      pairId: PAIR,
      creator: CREATOR,
      creatorBalance,
      events,
    })

    expect(result.riskLevel).toBe('low')
    expect(result.riskLabel).toBe('Healthy Distribution')
    expect(result.poolSharePercent).toBeCloseTo(97.5, 1)
    expect(result.creatorSharePercent).toBeCloseTo(0.5, 1)
    expect(result.topSingleWalletPercent).toBeCloseTo(2.0, 1)
    expect(result.top10WalletsPercent).toBeCloseTo(2.5, 1)
    expect(result.holders[0]?.tag).toBe('pool')
    expect(result.observedHoldersCount).toBe(2)

    // Without events, fresh pool + creator alone is still low risk
    const fresh = analyzeTokenHolders({
      totalSupply: TOTAL,
      reserveToken,
      pairId: PAIR,
      creator: CREATOR,
      creatorBalance,
      events: [],
    })
    expect(fresh.riskLevel).toBe('low')
  })

  it('flags medium concentration when a single wallet holds between 10% and 20%', () => {
    const events: TokenEvent[] = [
      {
        id: 'ev-buy',
        kind: 'transfer',
        from: PAIR,
        to: ALICE,
        amount: 12_000_000n * UNIT, // 12%
        ledger: 105,
        at: '2026-01-01T00:01:00Z',
      },
    ]

    const result = analyzeTokenHolders({
      totalSupply: TOTAL,
      reserveToken: 87_500_000n * UNIT,
      pairId: PAIR,
      creator: CREATOR,
      creatorBalance: 500_000n * UNIT,
      events,
    })

    expect(result.riskLevel).toBe('medium')
    expect(result.riskLabel).toBe('Medium Concentration')
    expect(result.topSingleWalletPercent).toBeCloseTo(12, 1)
  })

  it('flags high whale risk when a single wallet holds >= 20% or pool < 50%', () => {
    const events: TokenEvent[] = [
      {
        id: 'ev-whale',
        kind: 'transfer',
        from: PAIR,
        to: BOB,
        amount: 35_000_000n * UNIT, // 35%
        ledger: 110,
        at: '2026-01-01T00:02:00Z',
      },
      {
        id: 'ev-partial-sell',
        kind: 'transfer',
        from: ALICE,
        to: PAIR,
        amount: 1_000_000n * UNIT,
        ledger: 111,
        at: '2026-01-01T00:03:00Z',
      },
    ]

    const result = analyzeTokenHolders({
      totalSupply: TOTAL,
      reserveToken: 64_500_000n * UNIT,
      pairId: PAIR,
      creator: CREATOR,
      creatorBalance: 500_000n * UNIT,
      events,
    })

    expect(result.riskLevel).toBe('high')
    expect(result.riskLabel).toBe('High Whale Risk')
    expect(result.topSingleWalletPercent).toBeCloseTo(35, 1)
    expect(result.holders.some((h) => h.address === BOB && h.tag === 'holder')).toBe(true)
  })
})
