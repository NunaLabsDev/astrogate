/** Native XLM decimals: 7 decimals (stroops). */
export const XLM_DECIMALS = 7

/** Minimum base fee + 1 XLM fallback buffer kept when account reserve details are unavailable. */
export const XLM_FEE_BUFFER = 10_000_000n

/** Base Stellar reserve per entry (0.5 XLM = 5,000,000 stroops). */
const STELLAR_BASE_RESERVE_STROOPS = 5_000_000n
/** Soroban fee buffer kept on top of exact protocol minimum reserve (0.5 XLM). */
const SOROBAN_FEE_HEADROOM_STROOPS = 5_000_000n

import { HORIZON_URL, networkStorageKey } from './network'
import { readStorageJson, writeStorageJson } from './storage'
import { formatAmount, parseAmount } from './format'

const accountMinReserveCache = new Map<string, bigint>()

/**
 * Computes Stellar minimum balance (`0.5 XLM * (2 + subentry_count + num_sponsoring - num_sponsored) + selling_liabilities`).
 */
export function computeStellarMinReserveStroops(accountData: {
  subentry_count?: number
  num_sponsoring?: number
  num_sponsored?: number
  selling_liabilities?: string
}): bigint {
  const subentries = Math.max(0, Math.trunc(accountData.subentry_count ?? 0))
  const sponsoring = Math.max(0, Math.trunc(accountData.num_sponsoring ?? 0))
  const sponsored = Math.max(0, Math.trunc(accountData.num_sponsored ?? 0))
  const entries = Math.max(2, 2 + subentries + sponsoring - sponsored)
  const baseReserve = BigInt(entries) * STELLAR_BASE_RESERVE_STROOPS
  const liabilities = accountData.selling_liabilities
    ? parseAmount(accountData.selling_liabilities, XLM_DECIMALS)
    : 0n
  return baseReserve + liabilities
}

export function getCachedMinReserveStroops(account?: string | null): bigint | undefined {
  if (!account) return undefined
  return accountMinReserveCache.get(account)
}

/**
 * Validates that an account holds at least `spentXlmStroops + requiredBuffer`,
 * accounting for Stellar's exact subentry/sponsorship reserve (minimum 1 XLM)
 * plus Soroban resource fee headroom.
 * Returns `null` when valid or balance is not loaded yet (`undefined`).
 */
export function validateXlmReserve(
  xlmBalance: number | undefined,
  spentXlmStroops = 0n,
  minReserveOrAccount?: bigint | string | null,
): string | null {
  if (xlmBalance === undefined) return null
  const balanceStroops = xlmToStroops(xlmBalance)
  if (spentXlmStroops > 0n && spentXlmStroops > balanceStroops) {
    return `Insufficient XLM balance (${formatAmount(balanceStroops, XLM_DECIMALS)} XLM available).`
  }

  const explicitMin =
    typeof minReserveOrAccount === 'bigint'
      ? minReserveOrAccount
      : typeof minReserveOrAccount === 'string'
        ? accountMinReserveCache.get(minReserveOrAccount)
        : undefined
  const reserveFloor =
    explicitMin !== undefined
      ? explicitMin + SOROBAN_FEE_HEADROOM_STROOPS
      : XLM_FEE_BUFFER
  const effectiveBuffer =
    reserveFloor > XLM_FEE_BUFFER ? reserveFloor : XLM_FEE_BUFFER

  const required = spentXlmStroops + effectiveBuffer
  if (balanceStroops < required) {
    if (spentXlmStroops > 0n) {
      return `Insufficient XLM balance. You have ${formatAmount(balanceStroops, XLM_DECIMALS)} XLM, but need at least ${formatAmount(required, XLM_DECIMALS)} XLM (including ${formatAmount(effectiveBuffer, XLM_DECIMALS)} XLM network reserve & fee buffer).`
    }
    return `Leave at least ${formatAmount(effectiveBuffer, XLM_DECIMALS)} XLM in your wallet to cover transaction fees and Stellar minimum reserve.`
  }
  return null
}

/** Horizon account not yet funded/created resolves to zero balance (not an error). */
export async function fetchXlmBalance(publicKey: string): Promise<number> {
  const raw = await fetchXlmBalanceRaw(publicKey)
  return Number(raw)
}

/**
 * Fetches the lossless raw string balance from Horizon and caches exact subentry reserve.
 * Resolves to "0" for 404 unfunded accounts.
 */
export async function fetchXlmBalanceRaw(publicKey: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  let response: Response
  try {
    response = await fetch(
      `${HORIZON_URL}/accounts/${encodeURIComponent(publicKey)}`,
      { signal: controller.signal },
    )
  } finally {
    clearTimeout(timer)
  }
  if (response.status === 404) {
    accountMinReserveCache.delete(publicKey)
    return '0'
  }
  if (!response.ok) {
    throw new Error(`Horizon responded ${response.status} for ${publicKey}`)
  }
  const data = (await response.json()) as {
    subentry_count?: number
    num_sponsoring?: number
    num_sponsored?: number
    balances?: Array<{
      asset_type?: string
      balance?: string
      selling_liabilities?: string
    }>
  }
  const native = data.balances?.find(
    (balance) => balance.asset_type === 'native',
  )
  const minReserve = computeStellarMinReserveStroops({
    subentry_count: data.subentry_count,
    num_sponsoring: data.num_sponsoring,
    num_sponsored: data.num_sponsored,
    selling_liabilities: native?.selling_liabilities,
  })
  accountMinReserveCache.set(publicKey, minReserve)
  return native?.balance ?? '0'
}

/**
 * Fetches the native XLM balance directly in Stroops without passing through Number float.
 */
export async function fetchXlmBalanceStroops(publicKey: string): Promise<bigint> {
  const raw = await fetchXlmBalanceRaw(publicKey)
  return parseAmount(raw, XLM_DECIMALS)
}

/**
 * Converts a Horizon XLM balance (number or string) to stroops.
 * Uses integer string parsing without floating point inaccuracies.
 */
export function xlmToStroops(value: number | string): bigint {
  if (typeof value === 'string') {
    return parseAmount(value, XLM_DECIMALS)
  }
  if (!Number.isFinite(value) || value <= 0) return 0n
  return parseAmount(value.toFixed(XLM_DECIMALS), XLM_DECIMALS)
}

/** Spot reference price of 1 XLM in USDC if all live oracle queries fail. */
export const DEFAULT_XLM_USD_PRICE = 0.141

const XLM_PRICE_STORAGE_KEY = networkStorageKey('astrogate.xlm-price.v1')
const CACHE_TTL_MS = 60 * 1000 // 1 minute live freshness

/**
 * Live oracles for the XLM/USDC spot price, in waterfall order.
 * - Coinbase: real-time XLM-USD/USDC equivalent, no rate limits.
 * - Binance: real-time XLMUSDC spot ticker.
 * - CoinGecko: simple price endpoint.
 * CryptoCompare is intentionally excluded: its public API blocks browser CORS.
 */
const XLM_USD_ORACLES: Array<{
  url: string
  parse: (json: unknown) => number | undefined
}> = [
  {
    url: 'https://api.coinbase.com/v2/prices/XLM-USD/spot',
    parse: (json) => {
      const amount = Number(
        (json as { data?: { amount?: string } }).data?.amount,
      )
      return Number.isFinite(amount) && amount > 0 ? amount : undefined
    },
  },
  {
    url: 'https://api.binance.com/api/v3/ticker/price?symbol=XLMUSDC',
    parse: (json) => {
      const amount = Number((json as { price?: string }).price)
      return Number.isFinite(amount) && amount > 0 ? amount : undefined
    },
  },
  {
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd',
    parse: (json) => {
      const amount = (json as { stellar?: { usd?: number } }).stellar?.usd
      return typeof amount === 'number' && Number.isFinite(amount) && amount > 0
        ? amount
        : undefined
    },
  },
]

/**
 * Fetches the real-time spot price of 1 XLM in USD using a multi-oracle
 * waterfall. Fallback: cached recent price or DEFAULT_XLM_USD_PRICE.
 */
export async function fetchXlmUsdPrice(): Promise<number> {
  const cached = readStorageJson<{ price?: number; ts?: number }>(
    XLM_PRICE_STORAGE_KEY,
  )
  if (
    cached &&
    typeof cached.price === 'number' &&
    cached.price > 0 &&
    typeof cached.ts === 'number' &&
    Date.now() - cached.ts < CACHE_TTL_MS
  ) {
    return cached.price
  }

  for (const oracle of XLM_USD_ORACLES) {
    try {
      const signal =
        typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
          ? AbortSignal.timeout(5_000)
          : undefined
      const res = await fetch(oracle.url, {
        headers: { Accept: 'application/json' },
        signal,
      })
      if (!res.ok) continue
      const json = await res.json()
      const amount = oracle.parse(json)
      if (amount !== undefined) {
        savePriceToCache(amount)
        return amount
      }
    } catch {
      // Continue to next provider
    }
  }

  return DEFAULT_XLM_USD_PRICE
}

function savePriceToCache(price: number): void {
  writeStorageJson(XLM_PRICE_STORAGE_KEY, { price, ts: Date.now() })
}
