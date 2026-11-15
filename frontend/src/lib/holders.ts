import { LAUNCHPAD_CONTRACT_ID } from './network'
import type { TokenEvent } from './token-events'
import { calculateSupplySharePercent, STELLAR_BURN_ADDRESS } from './tokenomics'

export type HolderRiskLevel = 'low' | 'medium' | 'high'

export type HolderEntry = {
  address: string
  balance: bigint
  sharePercent: number
  tag: 'pool' | 'creator' | 'burn' | 'holder'
}

export type HolderAnalysis = {
  riskLevel: HolderRiskLevel
  riskLabel: string
  riskSummary: string
  poolSharePercent: number
  creatorSharePercent: number
  topSingleWalletPercent: number
  top10WalletsPercent: number
  observedHoldersCount: number
  holders: HolderEntry[]
}

/**
 * Reconstructs token holder concentration and whale dump risk directly from
 * on-chain pool reserves, verified creator balance, and recent SEP-41 events
 * (without needing a centralized indexer).
 */
export function analyzeTokenHolders(params: {
  totalSupply: bigint
  reserveToken: bigint
  pairId?: string | null
  creator?: string | null
  creatorBalance?: bigint
  userAddress?: string | null
  userBalance?: bigint
  events?: readonly TokenEvent[]
}): HolderAnalysis {
  const {
    totalSupply,
    reserveToken,
    pairId,
    creator,
    creatorBalance,
    userAddress,
    userBalance,
    events = [],
  } = params

  if (totalSupply <= 0n) {
    return {
      riskLevel: 'medium',
      riskLabel: 'No Active Supply',
      riskSummary: 'Total supply is zero or unavailable from the contract.',
      poolSharePercent: 0,
      creatorSharePercent: 0,
      topSingleWalletPercent: 0,
      top10WalletsPercent: 0,
      observedHoldersCount: 0,
      holders: [],
    }
  }

  // 1. Replay observed SEP-41 events in chronological order (oldest-first).
  // fetchTokenEvents returns newest-first; reverse first so intra-ledger order
  // is preserved alongside explicit ledger + id sorting.
  const chronological = [...events]
    .reverse()
    .sort((a, b) => a.ledger - b.ledger || a.id.localeCompare(b.id))
  const netBalances = new Map<string, bigint>()

  for (const ev of chronological) {
    if (ev.amount <= 0n) continue
    if (ev.kind === 'mint' && ev.to) {
      netBalances.set(ev.to, (netBalances.get(ev.to) ?? 0n) + ev.amount)
    } else if (ev.kind === 'burn' && ev.from) {
      const next = (netBalances.get(ev.from) ?? 0n) - ev.amount
      netBalances.set(ev.from, next > 0n ? next : 0n)
    } else if (ev.kind === 'transfer') {
      // Ignore self-transfers so bounded event slices never subtract-clamp to 0 and double-credit.
      if (ev.from && ev.to && ev.from === ev.to) continue
      if (ev.from) {
        const nextFrom = (netBalances.get(ev.from) ?? 0n) - ev.amount
        netBalances.set(ev.from, nextFrom > 0n ? nextFrom : 0n)
      }
      if (ev.to) {
        netBalances.set(ev.to, (netBalances.get(ev.to) ?? 0n) + ev.amount)
      }
    }
  }

  // Launchpad is only a transient mint/split orchestrator during launch_fair.
  netBalances.delete(LAUNCHPAD_CONTRACT_ID)

  // 2. Apply authoritative on-chain balances for AMM Pool, Creator & Connected User.
  const authoritativeAddresses = new Set<string>()
  if (pairId) {
    netBalances.set(pairId, reserveToken > 0n ? reserveToken : 0n)
    authoritativeAddresses.add(pairId)
  }
  if (creator && creatorBalance !== undefined) {
    netBalances.set(creator, creatorBalance > 0n ? creatorBalance : 0n)
    authoritativeAddresses.add(creator)
  }
  if (
    userAddress &&
    userBalance !== undefined &&
    userAddress !== pairId &&
    !(userAddress === creator && creatorBalance !== undefined)
  ) {
    netBalances.set(userAddress, userBalance > 0n ? userBalance : 0n)
    authoritativeAddresses.add(userAddress)
  }

  // Enforce strict supply conservation when bounded event windows miss sells.
  const poolAmount = reserveToken > 0n ? reserveToken : 0n
  let authExternalSum = 0n
  for (const addr of authoritativeAddresses) {
    if (pairId && addr === pairId) continue
    authExternalSum += netBalances.get(addr) ?? 0n
  }
  const accountedSupply = poolAmount + authExternalSum
  const remainingOutsideBase =
    totalSupply > accountedSupply ? totalSupply - accountedSupply : 0n

  let nonAuthSum = 0n
  for (const [addr, bal] of netBalances.entries()) {
    if (authoritativeAddresses.has(addr) || bal <= 0n) continue
    nonAuthSum += bal
  }

  if (nonAuthSum > remainingOutsideBase) {
    for (const [addr, bal] of netBalances.entries()) {
      if (authoritativeAddresses.has(addr) || bal <= 0n) continue
      if (remainingOutsideBase === 0n) {
        netBalances.set(addr, 0n)
      } else {
        netBalances.set(addr, (bal * remainingOutsideBase) / nonAuthSum)
      }
    }
  }

  // 3. Build sorted list of positive-balance entries.
  const entries: HolderEntry[] = []
  for (const [address, balance] of netBalances.entries()) {
    if (balance <= 0n) continue
    const tag: HolderEntry['tag'] =
      pairId && address === pairId
        ? 'pool'
        : address === STELLAR_BURN_ADDRESS
          ? 'burn'
          : creator && address === creator
            ? 'creator'
            : 'holder'
    entries.push({
      address,
      balance,
      sharePercent: calculateSupplySharePercent(balance, totalSupply),
      tag,
    })
  }

  entries.sort((a, b) => {
    if (b.balance > a.balance) return 1
    if (b.balance < a.balance) return -1
    return 0
  })

  const poolSharePercent =
    reserveToken > 0n ? calculateSupplySharePercent(reserveToken, totalSupply) : 0
  const outsidePoolBase =
    totalSupply > reserveToken ? totalSupply - reserveToken : 0n
  const circulatingPercent =
    outsidePoolBase > 0n
      ? calculateSupplySharePercent(outsidePoolBase, totalSupply)
      : 0

  const creatorSharePercent =
    creatorBalance !== undefined
      ? calculateSupplySharePercent(creatorBalance, totalSupply)
      : creator
        ? calculateSupplySharePercent(netBalances.get(creator) ?? 0n, totalSupply)
        : 0

  // External wallets exclude AMM pool and canonical burn address.
  const externalWallets = entries.filter(
    (entry) => entry.tag !== 'pool' && entry.tag !== 'burn',
  )
  const topSingleWalletPercent = externalWallets[0]?.sharePercent ?? 0
  const rawTop10Percent = externalWallets
    .slice(0, 10)
    .reduce((sum, entry) => sum + entry.sharePercent, 0)
  const top10WalletsPercent = Math.min(
    100,
    Math.round(Math.min(rawTop10Percent, Math.max(circulatingPercent, topSingleWalletPercent)) * 100) / 100,
  )

  let riskLevel: HolderRiskLevel
  let riskLabel: string
  let riskSummary: string

  if (
    topSingleWalletPercent >= 20 ||
    (poolSharePercent > 0 && poolSharePercent < 50)
  ) {
    riskLevel = 'high'
    riskLabel = 'High Whale Risk'
    riskSummary =
      topSingleWalletPercent >= 20
        ? `Top holder controls ${topSingleWalletPercent.toFixed(1)}% of total supply. Large sells could heavily impact the curve.`
        : `Only ${poolSharePercent.toFixed(1)}% of supply remains in the AMM pool, indicating heavy external accumulation.`
  } else if (
    topSingleWalletPercent >= 10 ||
    (poolSharePercent > 0 && poolSharePercent < 70)
  ) {
    riskLevel = 'medium'
    riskLabel = 'Medium Concentration'
    riskSummary =
      topSingleWalletPercent >= 10
        ? `Largest observed wallet holds ${topSingleWalletPercent.toFixed(1)}% of total supply. Monitor top holder activity.`
        : `${poolSharePercent.toFixed(1)}% of supply sits in the AMM pool with moderate external distribution.`
  } else {
    riskLevel = 'low'
    riskLabel = 'Healthy Distribution'
    riskSummary =
      poolSharePercent > 0
        ? `${poolSharePercent.toFixed(1)}% of supply stays locked in AMM liquidity; no single wallet exceeds 10%.`
        : 'No single external wallet exceeds 10% in observed on-chain transfers.'
  }

  return {
    riskLevel,
    riskLabel,
    riskSummary,
    poolSharePercent,
    creatorSharePercent,
    topSingleWalletPercent,
    top10WalletsPercent,
    observedHoldersCount: externalWallets.length,
    holders: entries,
  }
}
