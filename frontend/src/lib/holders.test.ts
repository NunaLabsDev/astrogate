import { describe, expect, it } from 'vitest'
import { analyzeTokenHolders } from './holders'
import { LAUNCHPAD_CONTRACT_ID } from './network'
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

  it('replays same-ledger newest-first launch_fair events accurately and excludes Launchpad contract', () => {
    // fetchTokenEvents returns newest-first; launch_fair emits mint + 2 transfers in 1 ledger
    const events: TokenEvent[] = [
      {
        id: '0000500-0000000003',
        kind: 'transfer',
        from: LAUNCHPAD_CONTRACT_ID,
        to: PAIR,
        amount: 99_500_000n * UNIT,
        ledger: 500,
        at: '2026-01-01T00:05:00Z',
      },
      {
        id: '0000500-0000000002',
        kind: 'transfer',
        from: LAUNCHPAD_CONTRACT_ID,
        to: CREATOR,
        amount: 500_000n * UNIT,
        ledger: 500,
        at: '2026-01-01T00:05:00Z',
      },
      {
        id: '0000500-0000000001',
        kind: 'mint',
        to: LAUNCHPAD_CONTRACT_ID,
        amount: TOTAL,
        ledger: 500,
        at: '2026-01-01T00:05:00Z',
      },
    ]

    const result = analyzeTokenHolders({
      totalSupply: TOTAL,
      reserveToken: 99_500_000n * UNIT,
      pairId: PAIR,
      creator: CREATOR,
      creatorBalance: 500_000n * UNIT,
      events,
    })

    expect(result.holders.some((h) => h.address === LAUNCHPAD_CONTRACT_ID)).toBe(false)
    expect(result.riskLevel).toBe('low')
    expect(result.riskLabel).toBe('Healthy Distribution')
    expect(result.poolSharePercent).toBeCloseTo(99.5, 2)
    expect(result.creatorSharePercent).toBeCloseTo(0.5, 2)
    expect(result.topSingleWalletPercent).toBeCloseTo(0.5, 2)
  })

  it('enforces strict supply conservation and merges authoritative user balance', () => {
    // Rolling event slice missed prior sells, leaving ALICE & BOB inflated at 15M each (30M),
    // while on-chain reserves + authoritative balances leave only 10M outside pool+auth.
    const events: TokenEvent[] = [
      {
        id: '0000600-0000000002',
        kind: 'transfer',
        from: PAIR,
        to: BOB,
        amount: 15_000_000n * UNIT,
        ledger: 600,
        at: '2026-01-01T00:06:00Z',
      },
      {
        id: '0000599-0000000001',
        kind: 'transfer',
        from: PAIR,
        to: ALICE,
        amount: 15_000_000n * UNIT,
        ledger: 599,
        at: '2026-01-01T00:05:55Z',
      },
    ]

    const userAddr = 'GUSER111111111111111111111111111111111111111111111111111'
    const result = analyzeTokenHolders({
      totalSupply: TOTAL,
      reserveToken: 85_500_000n * UNIT,
      pairId: PAIR,
      creator: CREATOR,
      creatorBalance: 500_000n * UNIT,
      userAddress: userAddr,
      userBalance: 4_000_000n * UNIT,
      events,
    })

    const totalObserved = result.holders.reduce((sum, h) => sum + h.balance, 0n)
    expect(totalObserved).toBeLessThanOrEqual(TOTAL)
    expect(result.holders.find((h) => h.address === userAddr)?.balance).toBe(4_000_000n * UNIT)
    // Remaining 10M split equally between ALICE and BOB (5M each)
    expect(result.holders.find((h) => h.address === ALICE)?.balance).toBe(5_000_000n * UNIT)
    expect(result.holders.find((h) => h.address === BOB)?.balance).toBe(5_000_000n * UNIT)
  })
})
