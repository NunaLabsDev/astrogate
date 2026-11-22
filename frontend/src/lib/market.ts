import { clampDecimals } from './format'
import { GRADUATION_TARGET_XLM, STROOPS_PER_UNIT } from './tokenomics'
import type { TokenListing } from './discovery'

export function effectiveLiquidityStroops(t: TokenListing): bigint {
  if (t.curve && !t.curve.graduated) {
    return t.curve.curve_xlm_net
  }
  return t.pool.reserveXlm
}

function isGraduatedToken(t: TokenListing): boolean {
  if (t.curve) return t.curve.graduated
  return t.pool.reserveXlm >= BigInt(GRADUATION_TARGET_XLM) * STROOPS_PER_UNIT
}

/**
 * Returns true if the token belongs in the Graduated & Soroswap DEX section
 * (graduated fair launches + external/legacy Soroswap DEX pairs), false if it
 * is still on an active pre-graduation bonding curve.
 */
export function isGraduatedOrDexToken(t: TokenListing): boolean {
  if (t.curve) return t.curve.graduated
  if (t.verifiedLaunchpad) return isGraduatedToken(t)
  return true
}

/** Splits a token list into active Bonding Curves vs Graduated & Soroswap DEX pairs. */
export function partitionMarketTokens(tokens: TokenListing[]): {
  liveCurves: TokenListing[]
  graduatedDex: TokenListing[]
} {
  const liveCurves: TokenListing[] = []
  const graduatedDex: TokenListing[] = []
  for (const token of tokens) {
    if (isGraduatedOrDexToken(token)) {
      graduatedDex.push(token)
    } else {
      liveCurves.push(token)
    }
  }
  return { liveCurves, graduatedDex }
}

/**
 * Selects active pre-graduation Bonding Curve tokens ordered closest to the
 * graduation target first (for the 4-second Graduating Soon carousel).
 */
export function pickGraduatingCandidates(tokens: TokenListing[]): TokenListing[] {
  return tokens
    .filter((t) => !isGraduatedOrDexToken(t) && effectiveLiquidityStroops(t) > 0n)
    .sort((a, b) => {
      const liqCmp = compareBigInt(
        effectiveLiquidityStroops(a),
        effectiveLiquidityStroops(b),
      )
      if (liqCmp !== 0) return liqCmp
      return b.ledger - a.ledger
    })
}

export type MarketSortKey =
  | 'recent'
  | 'graduation'
  | 'liquidity'
  | 'price'
  | 'symbol'

export const MARKET_SORT_OPTIONS: Array<{
  value: MarketSortKey
  label: string
}> = [
  { value: 'graduation', label: '🎓 Graduating Soon' },
  { value: 'recent', label: '⚡ New Launches' },
  { value: 'liquidity', label: 'Highest Liquidity' },
  { value: 'price', label: 'Highest Price' },
  { value: 'symbol', label: 'Symbol A–Z' },
]

function compareBigInt(a: bigint, b: bigint): number {
  if (a === b) return 0
  return a > b ? -1 : 1
}

/**
 * Pure filter & sort logic in memory.
 */
export function filterAndSortTokens(
  tokens: TokenListing[],
  query: string,
  sort: MarketSortKey,
  limit?: number,
): TokenListing[] {
  const search = query.trim().toLowerCase()
  const filtered = search
    ? tokens.filter((token) =>
        `${token.symbol} ${token.name} ${token.id}`
          .toLowerCase()
          .includes(search),
      )
    : tokens

  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case 'graduation': {
        const aLiq = effectiveLiquidityStroops(a)
        const bLiq = effectiveLiquidityStroops(b)
        const aSeeded = a.pool.exists && aLiq > 0n
        const bSeeded = b.pool.exists && bLiq > 0n
        if (aSeeded && !bSeeded) return -1
        if (!aSeeded && bSeeded) return 1
        if (!aSeeded && !bSeeded) return b.ledger - a.ledger

        const aGrad = isGraduatedToken(a)
        const bGrad = isGraduatedToken(b)
        if (!aGrad && bGrad) return -1
        if (aGrad && !bGrad) return 1
        return compareBigInt(aLiq, bLiq)
      }
      case 'liquidity':
        return compareBigInt(
          effectiveLiquidityStroops(a),
          effectiveLiquidityStroops(b),
        )
      case 'price': {
        const aValid =
          a.pool.exists && a.pool.reserveToken > 0n && a.pool.reserveXlm > 0n
        const bValid =
          b.pool.exists && b.pool.reserveToken > 0n && b.pool.reserveXlm > 0n
        if (aValid && !bValid) return -1
        if (!aValid && bValid) return 1
        if (!aValid && !bValid) return b.ledger - a.ledger

        // Cross-multiplication prevents integer stroop underflow for micro-cap fair launch tokens
        const aDec = 10n ** BigInt(clampDecimals(a.decimals))
        const bDec = 10n ** BigInt(clampDecimals(b.decimals))
        const aVal = a.pool.reserveXlm * aDec * b.pool.reserveToken
        const bVal = b.pool.reserveXlm * bDec * a.pool.reserveToken
        return compareBigInt(aVal, bVal)
      }
      case 'symbol':
        return a.symbol.localeCompare(b.symbol)
      case 'recent':
      default:
        return b.ledger - a.ledger
    }
  })

  return limit ? sorted.slice(0, limit) : sorted
}
