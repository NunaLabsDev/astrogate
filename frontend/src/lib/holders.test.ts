import { describe, expect, it } from 'vitest'
import { analyzeTokenHolders } from './holders'
import { LAUNCHPAD_CONTRACT_ID } from './network'
import type { TokenEvent } from './token-events'

const UNIT = 10_000_000n // 7 decimals
const TOTAL = 10_000_000n * UNIT // 10M
const PAIR = 'CPAIR111111111111111111111111111111111111111111111111111'
const CREATOR = 'GCREATOR111111111111111111111111111111111111111111111111'
const ALICE = 'GALICE11111111111111111111111111111111111111111111111111'
const BOB = 'GBOB1111111111111111111111111111111111111111111111111111'

describe('analyzeTokenHolders', () => {
  it('classifies freshly launched fair-launch distribution (99.5% pool, 0.5% creator) as low risk', () => {
    const reserveToken = 9_950_000n * UNIT
    const creatorBalance = 50_000n * UNIT
    const events: TokenEvent[] = [
      {
        id: 'ev-1',
        kind: 'transfer',
        from: PAIR,
        to: ALICE,
        amount: 200_000n * UNIT, // 2%
        ledger: 100,
        at: '2026-01-01T00:00:00Z',
      },
    ]

    const result = analyzeTokenHolders({
      totalSupply: TOTAL,
      reserveToken: 9_750_000n * UNIT,
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
        amount: 1_200_000n * UNIT, // 12%
        ledger: 105,
        at: '2026-01-01T00:01:00Z',
      },
    ]

    const result = analyzeTokenHolders({
      totalSupply: TOTAL,
      reserveToken: 8_750_000n * UNIT,
      pairId: PAIR,
      creator: CREATOR,
      creatorBalance: 50_000n * UNIT,
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
        amount: 3_500_000n * UNIT, // 35%
        ledger: 110,
        at: '2026-01-01T00:02:00Z',
      },
      {
        id: 'ev-partial-sell',
        kind: 'transfer',
        from: ALICE,
        to: PAIR,
        amount: 100_000n * UNIT,
        ledger: 111,
        at: '2026-01-01T00:03:00Z',
      },
    ]

    const result = analyzeTokenHolders({
      totalSupply: TOTAL,
      reserveToken: 6_450_000n * UNIT,
      pairId: PAIR,
      creator: CREATOR,
      creatorBalance: 50_000n * UNIT,
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
        amount: 9_950_000n * UNIT,
        ledger: 500,
        at: '2026-01-01T00:05:00Z',
      },
      {
        id: '0000500-0000000002',
        kind: 'transfer',
        from: LAUNCHPAD_CONTRACT_ID,
        to: CREATOR,
        amount: 50_000n * UNIT,
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
      reserveToken: 9_950_000n * UNIT,
      pairId: PAIR,
      creator: CREATOR,
      creatorBalance: 50_000n * UNIT,
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
    // Rolling event slice missed prior sells, leaving ALICE & BOB inflated at 1.5M each (3M),
    // while on-chain reserves + authoritative balances leave only 1M outside pool+auth.
    const events: TokenEvent[] = [
      {
        id: '0000600-0000000002',
        kind: 'transfer',
        from: PAIR,
        to: BOB,
        amount: 1_500_000n * UNIT,
        ledger: 600,
        at: '2026-01-01T00:06:00Z',
      },
      {
        id: '0000599-0000000001',
        kind: 'transfer',
        from: PAIR,
        to: ALICE,
        amount: 1_500_000n * UNIT,
        ledger: 599,
        at: '2026-01-01T00:05:55Z',
      },
    ]

    const userAddr = 'GUSER111111111111111111111111111111111111111111111111111'
    const result = analyzeTokenHolders({
      totalSupply: TOTAL,
      reserveToken: 8_550_000n * UNIT,
      pairId: PAIR,
      creator: CREATOR,
      creatorBalance: 50_000n * UNIT,
      userAddress: userAddr,
      userBalance: 400_000n * UNIT,
      events,
    })

    const totalObserved = result.holders.reduce((sum, h) => sum + h.balance, 0n)
    expect(totalObserved).toBeLessThanOrEqual(TOTAL)
    expect(result.holders.find((h) => h.address === userAddr)?.balance).toBe(400_000n * UNIT)
    // Remaining 1M split equally between ALICE and BOB (500K each)
    expect(result.holders.find((h) => h.address === ALICE)?.balance).toBe(500_000n * UNIT)
    expect(result.holders.find((h) => h.address === BOB)?.balance).toBe(500_000n * UNIT)
  })

  it('ignores self-transfers and keeps circular multi-wallet churn bounded by totalSupply', () => {
    const charlie = 'GCHARLIE111111111111111111111111111111111111111111111111'
    const events: TokenEvent[] = [
      {
        id: '0000700-0000000004',
        kind: 'transfer',
        from: charlie,
        to: ALICE,
        amount: 200_000n * UNIT,
        ledger: 700,
        at: '2026-01-01T00:07:04Z',
      },
      {
        id: '0000700-0000000003',
        kind: 'transfer',
        from: BOB,
        to: charlie,
        amount: 200_000n * UNIT,
        ledger: 700,
        at: '2026-01-01T00:07:03Z',
      },
      {
        id: '0000700-0000000002',
        kind: 'transfer',
        from: ALICE,
        to: BOB,
        amount: 200_000n * UNIT,
        ledger: 700,
        at: '2026-01-01T00:07:02Z',
      },
      {
        id: '0000700-0000000001',
        kind: 'transfer',
        from: ALICE,
        to: ALICE,
        amount: 5_000_000n * UNIT, // Malicious self-transfer noise outside buy window
        ledger: 700,
        at: '2026-01-01T00:07:01Z',
      },
    ]

    const result = analyzeTokenHolders({
      totalSupply: TOTAL,
      reserveToken: 9_750_000n * UNIT,
      pairId: PAIR,
      creator: CREATOR,
      creatorBalance: 50_000n * UNIT,
      events,
    })

    const aliceEntry = result.holders.find((h) => h.address === ALICE)
    expect(aliceEntry?.balance).toBe(200_000n * UNIT)
    expect(result.holders.find((h) => h.address === BOB)).toBeUndefined()
    expect(result.holders.find((h) => h.address === charlie)).toBeUndefined()
    expect(result.riskLevel).toBe('low')
  })
})
