import { Client as AstroTokenClient } from '../contracts'
import { Client as LaunchpadClient } from '../contracts/launchpad'
import type {
  BuyQuote,
  CurveState,
  SellQuote,
  ShoutRecord,
  TradeResult,
} from '../contracts/launchpad/types'
import {
  DEFAULT_SOROBAN_INCLUSION_FEE,
  executeWithRpcFailover,
  isRetryableRpcError,
  LAUNCHPAD_CONTRACT_ID,
  NETWORK_PASSPHRASE,
  RPC_URL,
} from './network'
import { enqueueAccountTx } from './tx-queue'
import type { Signer } from '@stellar/stellar-sdk/contract'

export type { BuyQuote, CurveState, SellQuote, ShoutRecord, TradeResult }

/** Token del launchpad recién creado por el usuario. */
export interface LaunchpadToken {
  /** Id del contrato desplegado. */
  id: string
  /** Decimales del token. */
  decimals: number
  /** Símbolo si se conoce (para el arte generativo de la UI). */
  symbol?: string
}

/**
 * Cliente de un token SEP-41. Sin `signer` es de solo lectura (simulación).
 */
export function tokenClient(
  contractId: string,
  signer?: Signer,
  rpcUrl: string = RPC_URL,
): AstroTokenClient {
  return new AstroTokenClient({
    contractId,
    rpcUrl,
    networkPassphrase: NETWORK_PASSPHRASE,
    publicKey: signer?.address,
    signTransaction: signer,
    signAuthEntry: signer,
  })
}

/** Balance SEP-41 de una cuenta, sin acoplar la UI al cliente generado. */
export async function fetchTokenBalance(
  contractId: string,
  account: string,
): Promise<bigint> {
  return executeWithRpcFailover(async (rpcUrl) => {
    const client = tokenClient(contractId, undefined, rpcUrl)
    const tx = await client.balance({ account })
    return tx.result
  })
}

/**
 * Cliente del launchpad atómico en testnet. Sin `signer` es de solo lectura.
 */
export function launchpadClient(
  signer?: Signer,
  rpcUrl: string = RPC_URL,
): LaunchpadClient {
  return new LaunchpadClient({
    contractId: LAUNCHPAD_CONTRACT_ID,
    rpcUrl,
    networkPassphrase: NETWORK_PASSPHRASE,
    publicKey: signer?.address,
    signTransaction: signer,
    signAuthEntry: signer,
  })
}

/**
 * Single-transaction fair launch using the atomic launchpad contract:
 * Deploys the token, creates/seeds the Soroswap AMM pair, burns 100% LP to the burn address,
 * and renounces token ownership atomically in one signature.
 */
export async function launchTokenAtomic(params: {
  name: string
  symbol: string
  decimals: number
  initialSupply: bigint
  tokenLpAmount: bigint
  xlmLpAmount: bigint
  signer: Signer
  onHash?: (hash: string) => void
}): Promise<{ token: string; pair: string | null; lpMinted: bigint; hash?: string }> {
  const { name, symbol, decimals, initialSupply, tokenLpAmount, xlmLpAmount, signer, onHash } =
    params
  return enqueueAccountTx(signer.address, async () => {
    const client = launchpadClient(signer)
    const salt = crypto.getRandomValues(new Uint8Array(32))

    const tx = await client.launch_token(
      {
        params: {
          creator: signer.address,
          name,
          symbol,
          decimals,
          initial_supply: initialSupply,
          token_lp_amount: tokenLpAmount,
          xlm_lp_amount: xlmLpAmount,
          salt,
        },
      },
      { fee: DEFAULT_SOROBAN_INCLUSION_FEE },
    )

    const sent = await tx.signAndSend()
    const hash = sent.sendTransactionResponse?.hash
    if (hash) onHash?.(hash)

    const unwrap = sent.result
    if (unwrap.isErr()) {
      const err = unwrap.unwrapErr()
      throw new Error(err?.message ?? `Atomic launchpad error: ${JSON.stringify(err)}`)
    }
    const result = unwrap.unwrap()
    return {
      token: result.token,
      pair: result.pair,
      lpMinted: result.lp_minted,
      hash,
    }
  })
}

/**
 * Minimalist fair launch (`launch_fair`): supply (10M), decimals (7), and
 * 7-year locked LP are enforced on-chain; stores optional compact JSON metadata.
 */
export async function launchFairAtomic(params: {
  name: string
  symbol: string
  xlmLpAmount: bigint
  meta?: string
  signer: Signer
  onHash?: (hash: string) => void
}): Promise<{ token: string; pair: string | null; lpMinted: bigint; hash?: string }> {
  const { name, symbol, xlmLpAmount, meta = '', signer, onHash } = params
  return enqueueAccountTx(signer.address, async () => {
    const client = launchpadClient(signer)
    const salt = crypto.getRandomValues(new Uint8Array(32))

    const tx = await client.launch_fair(
      {
        params: {
          creator: signer.address,
          name,
          symbol,
          xlm_lp_amount: xlmLpAmount,
          meta,
          salt,
        },
      },
      { fee: DEFAULT_SOROBAN_INCLUSION_FEE },
    )

    const sent = await tx.signAndSend()
    const hash = sent.sendTransactionResponse?.hash
    if (hash) onHash?.(hash)

    const unwrap = sent.result
    if (unwrap.isErr()) {
      const err = unwrap.unwrapErr()
      throw new Error(err?.message ?? `Atomic launchpad error: ${JSON.stringify(err)}`)
    }
    const result = unwrap.unwrap()
    return {
      token: result.token,
      pair: result.pair,
      lpMinted: result.lp_minted,
      hash,
    }
  })
}

/**
 * On-chain Burn-to-Chat: permanently burns holder tokens and writes a message
 * into Launchpad's persistent `TokenShouts` log + emits `ShoutEvent`.
 */
export async function burnAndShout(params: {
  tokenId: string
  amount: bigint
  message: string
  signer: Signer
  onHash?: (hash: string) => void
}): Promise<{ hash?: string }> {
  const { tokenId, amount, message, signer, onHash } = params
  return enqueueAccountTx(signer.address, async () => {
    const client = launchpadClient(signer)
    const tx = await client.burn_shout(
      {
        sender: signer.address,
        token: tokenId,
        amount,
        message,
      },
      { fee: DEFAULT_SOROBAN_INCLUSION_FEE },
    )
    const sent = await tx.signAndSend()
    const hash = sent.sendTransactionResponse?.hash
    if (hash) onHash?.(hash)

    const unwrap = sent.result
    if (unwrap.isErr()) {
      const err = unwrap.unwrapErr()
      throw new Error(err?.message ?? `Burn shout error: ${JSON.stringify(err)}`)
    }
    return { hash }
  })
}

/**
 * Fetches live Fair-Flywheel v4 bonding curve, graduation, burn vault, and
 * creator vesting state for a token from Launchpad storage.
 */
export async function fetchCurveState(
  tokenId: string,
): Promise<CurveState | null> {
  if (!tokenId) return null
  try {
    return await executeWithRpcFailover(async (rpcUrl) => {
      const tx = await launchpadClient(undefined, rpcUrl).get_curve({
        token: tokenId,
      })
      return tx.result ?? null
    })
  } catch (err) {
    // Propagate transient RPC/network errors so React Query retries instead of
    // silently misclassifying an active bonding curve as an unseeded pool.
    if (isRetryableRpcError(err)) {
      throw err
    }
    return null
  }
}

/**
 * Fetches the active pinned King Shout (`>= 1,000` burned tokens) for a token.
 */
export async function fetchKingShout(
  tokenId: string,
): Promise<ShoutRecord | null> {
  if (!tokenId) return null
  try {
    return await executeWithRpcFailover(async (rpcUrl) => {
      const tx = await launchpadClient(undefined, rpcUrl).get_king_shout({
        token: tokenId,
      })
      return tx.result ?? null
    })
  } catch {
    return null
  }
}

/** Quotes an XLM -> token buy directly against the on-chain Launchpad curve. */
export async function quoteCurveBuyRpc(
  tokenId: string,
  xlmAmount: bigint,
): Promise<BuyQuote> {
  return executeWithRpcFailover(async (rpcUrl) => {
    const tx = await launchpadClient(undefined, rpcUrl).quote_buy({
      token: tokenId,
      xlm_amount: xlmAmount,
    })
    const res = tx.result
    if (res.isErr()) {
      const err = res.unwrapErr()
      throw new Error(err?.message ?? `Quote buy error: ${JSON.stringify(err)}`)
    }
    return res.unwrap()
  })
}

/** Quotes a token -> XLM sell directly against the on-chain Launchpad curve. */
export async function quoteCurveSellRpc(
  tokenId: string,
  tokenAmount: bigint,
): Promise<SellQuote> {
  return executeWithRpcFailover(async (rpcUrl) => {
    const tx = await launchpadClient(undefined, rpcUrl).quote_sell({
      token: tokenId,
      token_amount: tokenAmount,
    })
    const res = tx.result
    if (res.isErr()) {
      const err = res.unwrapErr()
      throw new Error(err?.message ?? `Quote sell error: ${JSON.stringify(err)}`)
    }
    return res.unwrap()
  })
}

/** Buys tokens on an active Fair-Flywheel v4 virtual bonding curve (may auto-graduate). */
export async function buyCurveToken(params: {
  tokenId: string
  maxXlmIn: bigint
  minTokensOut: bigint
  signer: Signer
  onHash?: (hash: string) => void
}): Promise<{ trade: TradeResult; hash?: string }> {
  const { tokenId, maxXlmIn, minTokensOut, signer, onHash } = params
  return enqueueAccountTx(signer.address, async () => {
    const tx = await launchpadClient(signer).buy_curve(
      {
        buyer: signer.address,
        token: tokenId,
        max_xlm_in: maxXlmIn,
        min_tokens_out: minTokensOut,
      },
      { fee: DEFAULT_SOROBAN_INCLUSION_FEE },
    )
    const sent = await tx.signAndSend()
    const hash = sent.sendTransactionResponse?.hash
    if (hash) onHash?.(hash)

    const unwrap = sent.result
    if (unwrap.isErr()) {
      const err = unwrap.unwrapErr()
      throw new Error(err?.message ?? `Curve buy error: ${JSON.stringify(err)}`)
    }
    return { trade: unwrap.unwrap(), hash }
  })
}

/** Sells tokens back to an active Fair-Flywheel v4 virtual bonding curve. */
export async function sellCurveToken(params: {
  tokenId: string
  tokenAmount: bigint
  minXlmOut: bigint
  signer: Signer
  onHash?: (hash: string) => void
}): Promise<{ trade: TradeResult; hash?: string }> {
  const { tokenId, tokenAmount, minXlmOut, signer, onHash } = params
  return enqueueAccountTx(signer.address, async () => {
    const tx = await launchpadClient(signer).sell_curve(
      {
        seller: signer.address,
        token: tokenId,
        token_amount: tokenAmount,
        min_xlm_out: minXlmOut,
      },
      { fee: DEFAULT_SOROBAN_INCLUSION_FEE },
    )
    const sent = await tx.signAndSend()
    const hash = sent.sendTransactionResponse?.hash
    if (hash) onHash?.(hash)

    const unwrap = sent.result
    if (unwrap.isErr()) {
      const err = unwrap.unwrapErr()
      throw new Error(err?.message ?? `Curve sell error: ${JSON.stringify(err)}`)
    }
    return { trade: unwrap.unwrap(), hash }
  })
}

/** Claims unlocked post-graduation 15-day vesting tranches (creator only). */
export async function claimCreatorVesting(params: {
  tokenId: string
  signer: Signer
  onHash?: (hash: string) => void
}): Promise<{ claimed: bigint; hash?: string }> {
  const { tokenId, signer, onHash } = params
  return enqueueAccountTx(signer.address, async () => {
    const tx = await launchpadClient(signer).claim_creator_vesting(
      {
        creator: signer.address,
        token: tokenId,
      },
      { fee: DEFAULT_SOROBAN_INCLUSION_FEE },
    )
    const sent = await tx.signAndSend()
    const hash = sent.sendTransactionResponse?.hash
    if (hash) onHash?.(hash)

    const unwrap = sent.result
    if (unwrap.isErr()) {
      const err = unwrap.unwrapErr()
      throw new Error(err?.message ?? `Claim vesting error: ${JSON.stringify(err)}`)
    }
    return { claimed: unwrap.unwrap(), hash }
  })
}

/** Refunds the remaining curve XLM vault in 1 tx if ungraduated for >= 7 days with 0 external holders (creator only). */
export async function refundStalledLaunch(params: {
  tokenId: string
  signer: Signer
  onHash?: (hash: string) => void
}): Promise<{ refunded: bigint; hash?: string }> {
  const { tokenId, signer, onHash } = params
  return enqueueAccountTx(signer.address, async () => {
    const tx = await launchpadClient(signer).refund_stalled_launch(
      {
        creator: signer.address,
        token: tokenId,
      },
      { fee: DEFAULT_SOROBAN_INCLUSION_FEE },
    )
    const sent = await tx.signAndSend()
    const hash = sent.sendTransactionResponse?.hash
    if (hash) onHash?.(hash)

    const unwrap = sent.result
    if (unwrap.isErr()) {
      const err = unwrap.unwrapErr()
      throw new Error(err?.message ?? `Stalled refund error: ${JSON.stringify(err)}`)
    }
    return { refunded: unwrap.unwrap(), hash }
  })
}

/** Permissionlessly triggers Stage 2 Milestone Burn (1,475,000 tokens) at >= 1,800 XLM pair depth. */
export async function triggerMilestoneBurn(params: {
  tokenId: string
  signer: Signer
  onHash?: (hash: string) => void
}): Promise<{ burned: bigint; hash?: string }> {
  const { tokenId, signer, onHash } = params
  return enqueueAccountTx(signer.address, async () => {
    const tx = await launchpadClient(signer).trigger_milestone_burn(
      { token: tokenId },
      { fee: DEFAULT_SOROBAN_INCLUSION_FEE },
    )
    const sent = await tx.signAndSend()
    const hash = sent.sendTransactionResponse?.hash
    if (hash) onHash?.(hash)

    const unwrap = sent.result
    if (unwrap.isErr()) {
      const err = unwrap.unwrapErr()
      throw new Error(err?.message ?? `Milestone burn error: ${JSON.stringify(err)}`)
    }
    return { burned: unwrap.unwrap(), hash }
  })
}

/** Permissionlessly swaps graduated buyback reserve on Soroswap DEX & permanently burns acquired tokens. */
export async function triggerBuybackBurn(params: {
  tokenId: string
  signer: Signer
  onHash?: (hash: string) => void
}): Promise<{ burned: bigint; hash?: string }> {
  const { tokenId, signer, onHash } = params
  return enqueueAccountTx(signer.address, async () => {
    const tx = await launchpadClient(signer).trigger_buyback_burn(
      { token: tokenId },
      { fee: DEFAULT_SOROBAN_INCLUSION_FEE },
    )
    const sent = await tx.signAndSend()
    const hash = sent.sendTransactionResponse?.hash
    if (hash) onHash?.(hash)

    const unwrap = sent.result
    if (unwrap.isErr()) {
      const err = unwrap.unwrapErr()
      throw new Error(err?.message ?? `Buyback burn error: ${JSON.stringify(err)}`)
    }
    return { burned: unwrap.unwrap(), hash }
  })
}

/**
 * Refreshes 90-day TTL on-chain for a token contract and its Launchpad registry record.
 * Note: Permissionless `extend_ttl` / `extend_launch_ttl` calls emit zero auths and zero
 * `readWrite` keys in Soroban host simulation, so Stellar SDK flags them `isReadCall`;
 * `{ force: true }` is required to broadcast the on-chain TTL extension transaction.
 */
export async function extendTokenTtl(params: {
  tokenId: string
  signer: Signer
}): Promise<{ hash?: string }> {
  const { tokenId, signer } = params
  return enqueueAccountTx(signer.address, async () => {
    let lastHash: string | undefined
    let lastError: unknown

    try {
      const tokTx = await tokenClient(tokenId, signer).extend_ttl({
        fee: DEFAULT_SOROBAN_INCLUSION_FEE,
      })
      const sentTok = await tokTx.signAndSend({ force: true })
      lastHash = sentTok.sendTransactionResponse?.hash ?? lastHash
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
      if (msg.includes('cancel') || msg.includes('reject') || msg.includes('declined')) {
        throw err
      }
      lastError = err
      // Non-AstroToken SACs may not expose `extend_ttl`; still extend Launchpad entry.
    }

    try {
      const lpTx = await launchpadClient(signer).extend_launch_ttl(
        { token: tokenId },
        { fee: DEFAULT_SOROBAN_INCLUSION_FEE },
      )
      const sentLp = await lpTx.signAndSend({ force: true })
      lastHash = sentLp.sendTransactionResponse?.hash ?? lastHash
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
      if (msg.includes('cancel') || msg.includes('reject') || msg.includes('declined')) {
        throw err
      }
      lastError = err
      throw lastError instanceof Error
        ? lastError
        : new Error('Could not extend Launchpad registry TTL on-chain.')
    }

    return { hash: lastHash }
  })
}

