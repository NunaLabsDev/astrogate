/**
 * @file AstroGate AI & Developer SDK
 * @description Lightweight, typed SDK designed for autonomous AI agents, trading bots,
 * and external developers building on Stellar/Soroban.
 */

import {
  discoverTokens,
  fetchLaunchpadRecord,
  type TokenListing,
} from '../lib/discovery'
import {
  fetchBurnedLpInfo,
  fetchPoolState,
  formatTokenPrice,
  localQuoteTokenForXlm,
  localQuoteXlmForToken,
  priceImpactPercent,
  quoteTokenForXlm,
  quoteXlmForToken,
  SOROSWAP_MINIMUM_LIQUIDITY,
  tokenPriceInXlmNumber,
  withSlippage,
  type PoolState,
} from '../lib/soroswap'
import {
  burnAndShout,
  buyCurveToken,
  claimCreatorVesting,
  claimJackpotOnChain,
  extendTokenTtl,
  fetchCurveState,
  fetchIsCurveClosed,
  fetchKingShout,
  fetchPendingJackpot,
  launchFairAtomic,
  sellCurveToken,
  tokenClient,
  triggerBuybackBurnWithBounty,
  triggerMilestoneBurn,
} from '../lib/token'
import { decodeOnChainMeta, encodeOnChainMeta } from '../lib/token-metadata'
import type { Signer } from '@stellar/stellar-sdk/contract'
import { isValidContractAddress } from '../lib/address'
import {
  ASTRO_TOKEN_ID,
  ASTRO_WASM_HASH,
  checkRpcHealth,
  DEVELOPER_TREASURY_ADDRESS,
  executeWithRpcFailover,
  LAUNCHPAD_CONTRACT_ID,
  LAUNCHPAD_WASM_HASH,
  NETWORK_NAME,
  NETWORK_PASSPHRASE,
  RPC_POOL,
  RPC_URL,
  SOROSWAP_FACTORY,
  SOROSWAP_ROUTER,
  XLM_SAC,
} from '../lib/network'
import {
  curveVirtualReserves,
  graduationProgress,
  graduationProgressForListing,
  localCurveQuoteBuy,
  localCurveQuoteSell,
  STELLAR_BURN_ADDRESS,
} from '../lib/tokenomics'
import { clampDecimals, formatAmount } from '../lib/format'
import {
  classifyTokenEvent,
  fetchTokenEvents,
  fetchTokenShouts,
  parseTokenEvent,
  type TokenEvent,
  type TokenShout,
  type TokenTradeRole,
} from '../lib/token-events'

export interface SdkTokenOverview {
  id: string
  name: string
  symbol: string
  decimals: number
  pairId: string | null
  priceXlm: string
  reserveToken: string
  reserveXlm: string
  graduationPercent: number
  isGraduated: boolean
}

export interface SdkQuoteResult {
  direction: 'buy' | 'sell'
  amountIn: string
  amountOutEstimated: string
  amountOutMinimum: string
  priceImpactPercent: number
}

export interface AntiRugAuditResult {
  tokenId: string
  pairId: string | null
  lpBurnAddress: string
  ownershipRenounced: boolean
  lpBurned: boolean
  lpProtection?: 'locked-7y' | 'burned' | 'unlocked' | 'bonding-curve'
  verifiedLaunchpad: boolean
  isAntiRugVerified: boolean
  auditNotes: string[]
}

export interface SdkTokenDetails {
  id: string
  name: string
  symbol: string
  decimals: number
  pool: PoolState
  priceXlm: string
  graduation: ReturnType<typeof graduationProgress>
}

/**
 * Retrieves the live active token market list.
 * Fast in-memory / IndexedDB read with automatic on-chain synchronization.
 */
export async function getMarketTokens(options?: {
  maxTokens?: number
}): Promise<SdkTokenOverview[]> {
  const listings = await discoverTokens(options)
  return listings.map((token: TokenListing) => {
    const grad = graduationProgressForListing(token)
    const reserveXlmDisplay =
      token.curve && !token.curve.graduated
        ? token.curve.curve_xlm_net
        : token.pool.reserveXlm
    return {
      id: token.id,
      name: token.name,
      symbol: token.symbol,
      decimals: token.decimals,
      pairId: token.pool.pairId,
      priceXlm: formatTokenPrice(tokenPriceInXlmNumber(token.pool, token.decimals)),
      reserveToken: formatAmount(token.pool.reserveToken, token.decimals),
      reserveXlm: formatAmount(reserveXlmDisplay, 7),
      graduationPercent: grad.percent,
      isGraduated: grad.graduated,
    }
  })
}

/**
 * Retrieves complete on-chain status and metadata for a specific token.
 */
export async function getTokenDetails(tokenId: string): Promise<SdkTokenDetails> {
  if (!isValidContractAddress(tokenId)) {
    throw new Error(`Invalid Stellar contract address: ${tokenId}`)
  }

  const [meta, rawPool, curve] = await Promise.all([
    executeWithRpcFailover(async (rpcUrl) => {
      const client = tokenClient(tokenId, undefined, rpcUrl)
      const [nameTx, symbolTx, decimalsTx] = await Promise.all([
        client.name().catch(() => ({ result: 'Unknown' })),
        client.symbol().catch(() => ({ result: 'UNK' })),
        client.decimals().catch(() => ({ result: 7 })),
      ])
      return {
        name: nameTx.result || 'Unknown',
        symbol: symbolTx.result || 'UNK',
        decimals: typeof decimalsTx.result === 'number' ? clampDecimals(decimalsTx.result) : 7,
      }
    }),
    fetchPoolState(tokenId),
    fetchCurveState(tokenId),
  ])

  const pool =
    !rawPool.exists && curve && !curve.graduated
      ? (() => {
          const v = curveVirtualReserves(curve.curve_xlm_net, curve.tokens_sold)
          return {
            exists: true,
            pairId: '',
            reserveToken: v.virtualTokens,
            reserveXlm: v.virtualXlm,
          }
        })()
      : rawPool

  const graduation = graduationProgressForListing({ pool, curve })

  return {
    id: tokenId,
    name: meta.name,
    symbol: meta.symbol,
    decimals: meta.decimals,
    pool,
    priceXlm: formatTokenPrice(tokenPriceInXlmNumber(pool, meta.decimals)),
    graduation,
  }
}

/**
 * Quotes an exact trade against either an active Fair-Flywheel v4 curve
 * (pre-graduation) or a Soroswap pair (post-graduation).
 * Direction: 'buy' = XLM -> Token, 'sell' = Token -> XLM.
 */
export async function quoteSwap(params: {
  tokenId: string
  amountIn: bigint
  direction: 'buy' | 'sell'
  slippagePercent?: number
}): Promise<SdkQuoteResult> {
  if (params.amountIn <= 0n) {
    throw new Error('amountIn must be greater than zero')
  }

  const slippage = params.slippagePercent ?? 2
  const curve = await fetchCurveState(params.tokenId)
  if (curve && !curve.graduated) {
    const v = curveVirtualReserves(curve.curve_xlm_net, curve.tokens_sold)
    if (params.direction === 'buy') {
      const quote = localCurveQuoteBuy(
        curve.curve_xlm_net,
        curve.tokens_sold,
        params.amountIn,
      )
      if (!quote) {
        throw new Error('Order cannot be quoted on the current bonding curve.')
      }
      const minOut = withSlippage(quote.tokens_out, slippage)
      const impact = priceImpactPercent(
        quote.net_xlm_to_curve,
        quote.tokens_out,
        v.virtualXlm,
        v.virtualTokens,
        0,
      )
      return {
        direction: 'buy',
        amountIn: quote.total_xlm_charged.toString(),
        amountOutEstimated: quote.tokens_out.toString(),
        amountOutMinimum: minOut.toString(),
        priceImpactPercent: impact,
      }
    }
    const quote = localCurveQuoteSell(
      curve.curve_xlm_net,
      curve.tokens_sold,
      params.amountIn,
    )
    if (!quote) {
      throw new Error('Sell order exceeds current bonding curve XLM depth.')
    }
    const minOut = withSlippage(quote.net_xlm_out, slippage)
    const impact = priceImpactPercent(
      params.amountIn,
      quote.gross_xlm_out,
      v.virtualTokens,
      v.virtualXlm,
      0,
    )
    return {
      direction: 'sell',
      amountIn: params.amountIn.toString(),
      amountOutEstimated: quote.net_xlm_out.toString(),
      amountOutMinimum: minOut.toString(),
      priceImpactPercent: impact,
    }
  }

  const pool = await fetchPoolState(params.tokenId)
  if (!pool.exists || pool.reserveXlm === 0n || pool.reserveToken === 0n) {
    throw new Error(`No active AMM liquidity pool found for token ${params.tokenId}`)
  }

  if (params.direction === 'buy') {
    const quoted = await quoteXlmForToken(params.amountIn, pool)
    const minOut = withSlippage(quoted, slippage)
    const impact = priceImpactPercent(
      params.amountIn,
      quoted,
      pool.reserveXlm,
      pool.reserveToken,
    )
    return {
      direction: 'buy',
      amountIn: params.amountIn.toString(),
      amountOutEstimated: quoted.toString(),
      amountOutMinimum: minOut.toString(),
      priceImpactPercent: impact,
    }
  } else {
    const quoted = await quoteTokenForXlm(params.amountIn, pool)
    const minOut = withSlippage(quoted, slippage)
    const impact = priceImpactPercent(
      params.amountIn,
      quoted,
      pool.reserveToken,
      pool.reserveXlm,
    )
    return {
      direction: 'sell',
      amountIn: params.amountIn.toString(),
      amountOutEstimated: quoted.toString(),
      amountOutMinimum: minOut.toString(),
      priceImpactPercent: impact,
    }
  }
}

/**
 * Audits a token on-chain to verify 100% Anti-Rug Fair-Launch compliance:
 * 1. Active Soroswap AMM liquidity pool exists.
 * 2. Contract ownership is renounced (zero / dead address).
 * 3. 100% of Soroswap LP tokens are permanently burned in STELLAR_BURN_ADDRESS.
 */
export async function verifyAntiRug(tokenId: string): Promise<AntiRugAuditResult> {
  if (!isValidContractAddress(tokenId)) {
    return {
      tokenId,
      pairId: null,
      lpBurnAddress: STELLAR_BURN_ADDRESS,
      ownershipRenounced: false,
      lpBurned: false,
      verifiedLaunchpad: false,
      isAntiRugVerified: false,
      auditNotes: ['Invalid Stellar contract address.'],
    }
  }

  const [pool, launchRecord, curve] = await Promise.all([
    fetchPoolState(tokenId),
    fetchLaunchpadRecord(tokenId),
    fetchCurveState(tokenId),
  ])
  const verifiedLaunchpad = Boolean(launchRecord)
  const notes: string[] = []
  if (verifiedLaunchpad) {
    notes.push('Verified in AstroGate Launchpad on-chain registry.')
  }

  // Verify owner status with RPC failover (both pre-grad curve & graduated pair).
  let ownershipRenounced = false
  try {
    const owner = await executeWithRpcFailover(async (rpcUrl) => {
      const client = tokenClient(tokenId, undefined, rpcUrl)
      const ownerTx = await client.get_owner()
      return ownerTx.result
    })
    if (!owner || owner === STELLAR_BURN_ADDRESS) {
      ownershipRenounced = true
      notes.push('Ownership successfully renounced (zero / canonical burn owner).')
    } else {
      notes.push(`Active owner address detected: ${owner}`)
    }
  } catch (err) {
    notes.push(
      `Could not verify ownership (get_owner unavailable or RPC error): ${
        (err as Error)?.message ?? 'contract error'
      }. Treated as NOT renounced.`,
    )
  }

  if (curve && !curve.graduated) {
    notes.push(
      'Active Fair-Flywheel v4.5 Virtual Bonding Curve: DEX reserves (3.3M), Creator 15d Vesting (30K), Escrowed 3-Checkpoint Jackpot Ladder (40K across 250/500/1,000 XLM), and Ecosystem (30K) are custody-locked inside Launchpad.',
    )
    return {
      tokenId,
      pairId: null,
      lpBurnAddress: STELLAR_BURN_ADDRESS,
      ownershipRenounced,
      lpBurned: false,
      lpProtection: 'bonding-curve',
      verifiedLaunchpad,
      isAntiRugVerified: ownershipRenounced && verifiedLaunchpad && curve.real_xlm_vault > 0n,
      auditNotes: notes,
    }
  }

  if (!pool.exists || !pool.pairId) {
    return {
      tokenId,
      pairId: null,
      lpBurnAddress: STELLAR_BURN_ADDRESS,
      ownershipRenounced,
      lpBurned: false,
      lpProtection: 'unlocked',
      verifiedLaunchpad,
      isAntiRugVerified: false,
      auditNotes: [...notes, 'No active Soroswap AMM pool found on-chain.'],
    }
  }

  notes.push(`Soroswap Pair verified: ${pool.pairId}`)

  // Verify LP protection (7-year Launchpad lock or canonical blackhole burn, discounting MINIMUM_LIQUIDITY)
  let lpBurned = false
  let lpProtection: 'locked-7y' | 'burned' | 'unlocked' = 'unlocked'
  try {
    const { burnedLp: burnBalance, totalSupply, fullyBurned, lpProtection: protection } =
      await fetchBurnedLpInfo(pool.pairId)
    lpProtection = protection

    if (fullyBurned) {
      lpBurned = true
      if (protection === 'locked-7y') {
        notes.push(
          `100% of withdrawable LP verified time-locked 7 years inside Launchpad ${LAUNCHPAD_CONTRACT_ID} (${burnBalance.toString()} / ${totalSupply.toString()}; ${SOROSWAP_MINIMUM_LIQUIDITY.toString()} LP permanently locked by the pair).`,
        )
      } else {
        notes.push(
          `100% of withdrawable LP verified burned in ${STELLAR_BURN_ADDRESS} (${burnBalance.toString()} / ${totalSupply.toString()}; ${SOROSWAP_MINIMUM_LIQUIDITY.toString()} LP permanently locked by the pair).`,
        )
      }
    } else if (burnBalance > 0n && totalSupply > 0n) {
      const pct = (burnBalance * 100n) / totalSupply
      notes.push(
        `Partial LP lock/burn: ${pct.toString()}% protected (${burnBalance.toString()} / ${totalSupply.toString()}).`,
      )
    } else {
      notes.push('No LP tokens locked in Launchpad or canonical burn address.')
    }
  } catch (err) {
    notes.push(
      `Could not verify LP lock/burn on pair: ${(err as Error)?.message ?? 'contract error'}`,
    )
  }

  return {
    tokenId,
    pairId: pool.pairId,
    lpBurnAddress: STELLAR_BURN_ADDRESS,
    ownershipRenounced,
    lpBurned,
    lpProtection,
    verifiedLaunchpad,
    isAntiRugVerified: ownershipRenounced && lpBurned && pool.reserveXlm > 0n,
    auditNotes: notes,
  }
}

/** Minimalist 10M fair-launch wrapper for programmatic AI agents and apps. */
export async function launchFair(params: {
  name: string
  symbol: string
  xlmLpAmount: bigint
  description?: string
  logoUrl?: string
  website?: string
  telegram?: string
  twitter?: string
  signer: Signer
  onHash?: (hash: string) => void
}) {
  const meta = encodeOnChainMeta(params)
  return launchFairAtomic({
    name: params.name,
    symbol: params.symbol,
    xlmLpAmount: params.xlmLpAmount,
    meta,
    signer: params.signer,
    onHash: params.onHash,
  })
}

/** Posts a real on-chain Burn-to-Chat shout by permanently burning holder tokens. */
export async function burnShout(params: {
  tokenId: string
  amount: bigint
  message: string
  signer: Signer
  onHash?: (hash: string) => void
}) {
  return burnAndShout(params)
}

/** Fetches the latest persistent Burn-to-Chat shouts for a token (newest first). */
export async function getTokenShouts(tokenId: string): Promise<TokenShout[]> {
  return fetchTokenShouts(tokenId)
}

export const AstroGateConstants = {
  NETWORK_NAME,
  NETWORK_PASSPHRASE,
  RPC_URL,
  RPC_POOL,
  SOROSWAP_FACTORY,
  SOROSWAP_ROUTER,
  XLM_SAC,
  ASTRO_TOKEN_ID,
  ASTRO_WASM_HASH,
  LAUNCHPAD_CONTRACT_ID,
  LAUNCHPAD_WASM_HASH,
  DEVELOPER_TREASURY_ADDRESS,
  STELLAR_BURN_ADDRESS,
}

export {
  buyCurveToken,
  checkRpcHealth,
  claimCreatorVesting,
  claimJackpotOnChain,
  classifyTokenEvent,
  decodeOnChainMeta,
  DEVELOPER_TREASURY_ADDRESS,
  encodeOnChainMeta,
  executeWithRpcFailover,
  extendTokenTtl,
  fetchCurveState,
  fetchIsCurveClosed,
  fetchKingShout,
  fetchPendingJackpot,
  fetchTokenEvents,
  fetchTokenShouts,
  graduationProgressForListing,
  isValidContractAddress,
  localCurveQuoteBuy,
  localCurveQuoteSell,
  localQuoteTokenForXlm,
  localQuoteXlmForToken,
  parseTokenEvent,
  sellCurveToken,
  triggerBuybackBurnWithBounty,
  triggerMilestoneBurn,
}
export type { TokenEvent, TokenShout, TokenTradeRole }
