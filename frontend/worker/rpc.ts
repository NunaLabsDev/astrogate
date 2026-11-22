import {
  Address,
  Contract,
  Keypair,
  TransactionBuilder,
  rpc as sorobanRpc,
  scValToNative,
} from '@stellar/stellar-sdk'
import { Client as AstroTokenClient } from '../src/contracts'
import { Client as LaunchpadClient } from '../src/contracts/launchpad'
import { Client as SorobitsClient } from '../src/contracts/sorobits'
import {
  parseLaunchpadContractEvent,
  type LaunchpadParsedEvent,
} from './events'
import { computeQuestSummary, type QuestProgressSummary } from './quests'
import type {
  AccountSummaryData,
  Env,
  MarketTokenSummary,
  TokenInspectorData,
  TokenShoutsData,
} from './types'

import { isAccountAddr } from './views'

export const DEFAULT_LAUNCHPAD_CONTRACT_ID =
  'CB5VMDAPQUK5LT5LH5L5THI6XYYUBTAXM7BJZLZYFGUJHZB64LZHFAPK'
export const DEFAULT_SOROBITS_CONTRACT_ID =
  'CBVETCPLVAMNUUQRUJGH54XHVQT5ZOVB4FGGP2IGOGAZLUIYBBV7G3I3'
export const DEFAULT_ASTRO_TOKEN_ID =
  'CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE'
export const DEFAULT_ASTRO_PAIR_ID =
  'CA32TMZ2AODXI7K7B6T2YPZR52HJKFCY5GT2DNHMOL326DLSNPX55BUP'
export const DEFAULT_XLM_SAC =
  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
export const DEFAULT_SOROSWAP_FACTORY =
  'CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY'
export const DEFAULT_SOROSWAP_ROUTER =
  'CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD'
export const DEFAULT_TREASURY_ADDRESS =
  'GDQT2KMQ5I2EFDK3WG42YBHRIC4B7OXL7K2G3IC2Z6LPTJEEOMXD7NQE'
export const MAINNET_XLM_SAC =
  'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA'
export const LAUNCHPAD_CONTRACT_ID = DEFAULT_LAUNCHPAD_CONTRACT_ID
export const SOROBITS_CONTRACT_ID = DEFAULT_SOROBITS_CONTRACT_ID
export const ASTRO_TOKEN_ID = DEFAULT_ASTRO_TOKEN_ID
export const ASTRO_PAIR_ID = DEFAULT_ASTRO_PAIR_ID
export const XLM_SAC = DEFAULT_XLM_SAC
export const SOROSWAP_FACTORY = DEFAULT_SOROSWAP_FACTORY
export const SOROSWAP_ROUTER = DEFAULT_SOROSWAP_ROUTER
export const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015'
export const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org'
export const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org'

export interface WorkerNetworkConfig {
  network: 'testnet' | 'mainnet'
  passphrase: string
  rpcUrls: string[]
  horizonUrl: string
  launchpadContractId: string
  sorobitsContractId: string
  astroTokenId: string
  astroPairId: string
  xlmSac: string
  soroswapFactory: string
  soroswapRouter: string
  treasuryAddress: string
}

export function resolveWorkerNetwork(env: Env): WorkerNetworkConfig {
  const network = env.STELLAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
  const isMainnet = network === 'mainnet'
  const passphrase =
    env.NETWORK_PASSPHRASE ||
    (isMainnet
      ? 'Public Global Stellar Network ; September 2015'
      : NETWORK_PASSPHRASE)
  const primaryRpc =
    env.STELLAR_RPC_URL ||
    (isMainnet
      ? 'https://soroban-rpc.mainnet.stellar.org'
      : DEFAULT_RPC_URL)
  const fallbackRpc = isMainnet
    ? 'https://mainnet.sorobanrpc.com'
    : 'https://rpc-testnet.stellar.org'
  const rpcUrls = Array.from(new Set([primaryRpc, fallbackRpc]))
  const horizonUrl = (
    env.HORIZON_URL ||
    (isMainnet ? 'https://horizon.stellar.org' : DEFAULT_HORIZON_URL)
  ).replace(/\/+$/, '')

  return {
    network,
    passphrase,
    rpcUrls,
    horizonUrl,
    launchpadContractId:
      env.LAUNCHPAD_CONTRACT_ID?.trim() ||
      (isMainnet ? '' : DEFAULT_LAUNCHPAD_CONTRACT_ID),
    sorobitsContractId:
      env.SOROBITS_CONTRACT_ID?.trim() ||
      (isMainnet ? '' : DEFAULT_SOROBITS_CONTRACT_ID),
    astroTokenId:
      env.ASTRO_TOKEN_ID?.trim() || (isMainnet ? '' : DEFAULT_ASTRO_TOKEN_ID),
    astroPairId:
      env.ASTRO_PAIR_ID?.trim() || (isMainnet ? '' : DEFAULT_ASTRO_PAIR_ID),
    xlmSac:
      env.XLM_SAC?.trim() || (isMainnet ? MAINNET_XLM_SAC : DEFAULT_XLM_SAC),
    soroswapFactory:
      env.SOROSWAP_FACTORY?.trim() ||
      (isMainnet ? '' : DEFAULT_SOROSWAP_FACTORY),
    soroswapRouter:
      env.SOROSWAP_ROUTER?.trim() ||
      (isMainnet ? '' : DEFAULT_SOROSWAP_ROUTER),
    treasuryAddress:
      env.DEVELOPER_TREASURY_ADDRESS?.trim() ||
      (isMainnet ? '' : DEFAULT_TREASURY_ADDRESS),
  }
}

const READONLY_SOURCE = Keypair.fromPublicKey(
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
).publicKey()

async function withTimeout<T>(promise: Promise<T>, ms = 4500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('RPC timeout')), ms)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function withRpcFailover<T>(
  cfg: WorkerNetworkConfig,
  fn: (rpcUrl: string) => Promise<T>,
): Promise<T> {
  let lastErr: unknown
  for (const rpcUrl of cfg.rpcUrls) {
    try {
      return await fn(rpcUrl)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All Soroban RPC nodes failed')
}

function makeLaunchpad(rpcUrl: string, cfg?: WorkerNetworkConfig): LaunchpadClient {
  return new LaunchpadClient({
    contractId: cfg?.launchpadContractId ?? LAUNCHPAD_CONTRACT_ID,
    rpcUrl,
    networkPassphrase: cfg?.passphrase ?? NETWORK_PASSPHRASE,
  })
}

function makeSorobits(rpcUrl: string, cfg?: WorkerNetworkConfig): SorobitsClient {
  return new SorobitsClient({
    contractId: cfg?.sorobitsContractId ?? SOROBITS_CONTRACT_ID,
    rpcUrl,
    networkPassphrase: cfg?.passphrase ?? NETWORK_PASSPHRASE,
    publicKey: READONLY_SOURCE,
  })
}

function makeToken(tokenId: string, rpcUrl: string, cfg?: WorkerNetworkConfig): AstroTokenClient {
  return new AstroTokenClient({
    contractId: tokenId,
    rpcUrl,
    networkPassphrase: cfg?.passphrase ?? NETWORK_PASSPHRASE,
  })
}

async function simulatePairReserves(
  pairId: string,
  rpcUrl: string,
  cfg?: WorkerNetworkConfig,
): Promise<{ reserveXlm: bigint; reserveToken: bigint } | null> {
  const passphrase = cfg?.passphrase ?? NETWORK_PASSPHRASE
  const xlmSac = cfg?.xlmSac ?? XLM_SAC
  try {
    const server = new sorobanRpc.Server(rpcUrl)
    const pairContract = new Contract(pairId)
    const sourceAccount = {
      accountId: () => READONLY_SOURCE,
      sequenceNumber: () => '0',
      incrementSequenceNumber: () => {},
    }

    const buildSim = (method: string) => {
      const tx = new TransactionBuilder(sourceAccount, {
        fee: '100',
        networkPassphrase: passphrase,
      })
        .addOperation(pairContract.call(method))
        .setTimeout(30)
        .build()
      return server.simulateTransaction(tx)
    }

    const [t0Sim, reservesSim] = await withTimeout(
      Promise.all([buildSim('token_0'), buildSim('get_reserves')]),
      3500,
    )
    if (
      !sorobanRpc.Api.isSimulationSuccess(t0Sim) ||
      !sorobanRpc.Api.isSimulationSuccess(reservesSim) ||
      !t0Sim.result ||
      !reservesSim.result
    ) {
      return null
    }
    const token0 = scValToNative(t0Sim.result.retval)
    const reserves = scValToNative(reservesSim.result.retval)
    if (!Array.isArray(reserves) || reserves.length < 2) return null
    const r0 = BigInt(reserves[0] ?? 0)
    const r1 = BigInt(reserves[1] ?? 0)
    return token0 === xlmSac
      ? { reserveXlm: r0, reserveToken: r1 }
      : { reserveXlm: r1, reserveToken: r0 }
  } catch {
    return null
  }
}

async function simulatePairXlmReserve(
  pairId: string,
  rpcUrl: string,
  cfg?: WorkerNetworkConfig,
): Promise<bigint | null> {
  const res = await simulatePairReserves(pairId, rpcUrl, cfg)
  return res ? res.reserveXlm : null
}

export async function fetchPairReservesWorker(
  pairId: string,
  env: Env,
): Promise<{ reserveXlm: bigint; reserveToken: bigint } | null> {
  const cfg = resolveWorkerNetwork(env)
  try {
    return await withRpcFailover(cfg, (rpcUrl) =>
      simulatePairReserves(pairId, rpcUrl, cfg),
    )
  } catch {
    return null
  }
}

export async function fetchPairLpProtectionWorker(
  pairId: string,
  env: Env,
): Promise<{
  lpProtection: 'locked_7y' | 'burned' | 'unlocked'
  lockedLp: bigint
  deadBurnLp: bigint
  totalSupply: bigint
  lpLockedPercent: number
} | null> {
  const cfg = resolveWorkerNetwork(env)
  const burnAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
  const minLiquidity = 1_000n
  try {
    return await withRpcFailover(cfg, async (rpcUrl) => {
      const server = new sorobanRpc.Server(rpcUrl)
      const pairContract = new Contract(pairId)
      const sourceAccount = {
        accountId: () => READONLY_SOURCE,
        sequenceNumber: () => '0',
        incrementSequenceNumber: () => {},
      }
      const sim = (method: string, ...args: ReturnType<Address['toScVal']>[]) => {
        const tx = new TransactionBuilder(sourceAccount, {
          fee: '100',
          networkPassphrase: cfg.passphrase,
        })
          .addOperation(pairContract.call(method, ...args))
          .setTimeout(30)
          .build()
        return server.simulateTransaction(tx)
      }

      const [supplySim, burnSim, launchpadSim] = await withTimeout(
        Promise.all([
          sim('total_supply'),
          sim('balance', Address.fromString(burnAddress).toScVal()),
          cfg.launchpadContractId
            ? sim('balance', Address.fromString(cfg.launchpadContractId).toScVal())
            : Promise.resolve(null),
        ]),
        3500,
      )
      if (
        !sorobanRpc.Api.isSimulationSuccess(supplySim) ||
        !supplySim.result ||
        !sorobanRpc.Api.isSimulationSuccess(burnSim) ||
        !burnSim.result
      ) {
        return null
      }
      const totalSupply = BigInt(scValToNative(supplySim.result.retval) ?? 0)
      const deadBurnLp = BigInt(scValToNative(burnSim.result.retval) ?? 0)
      const lockedLp =
        launchpadSim &&
        sorobanRpc.Api.isSimulationSuccess(launchpadSim) &&
        launchpadSim.result
          ? BigInt(scValToNative(launchpadSim.result.retval) ?? 0)
          : 0n
      const combined = deadBurnLp + lockedLp
      const fullyProtected =
        totalSupply > 0n && combined > 0n && combined + minLiquidity >= totalSupply
      const lpLockedPercent = fullyProtected
        ? 100
        : totalSupply > 0n
          ? Number(((combined * 10_000n) / totalSupply)) / 100
          : 0
      const lpProtection: 'locked_7y' | 'burned' | 'unlocked' =
        lockedLp > 0n && lockedLp >= deadBurnLp
          ? 'locked_7y'
          : deadBurnLp > 0n
            ? 'burned'
            : 'unlocked'
      return {
        lpProtection,
        lockedLp,
        deadBurnLp,
        totalSupply,
        lpLockedPercent,
      }
    })
  } catch {
    return null
  }
}

export async function fetchTokenOwnerWorker(
  tokenId: string,
  env: Env,
): Promise<{ ownerSupported: boolean; owner: string | null }> {
  const cfg = resolveWorkerNetwork(env)
  try {
    return await withRpcFailover(cfg, async (rpcUrl) => {
      const token = makeToken(tokenId, rpcUrl, cfg)
      const res = await withTimeout(token.get_owner(), 3500)
      return { ownerSupported: true, owner: res.result ?? null }
    })
  } catch {
    return { ownerSupported: false, owner: null }
  }
}

export async function fetchSorobitsStatusWorker(env: Env): Promise<{
  contractId: string
  totalSupply: number
  genesisMinted: number
}> {
  const cfg = resolveWorkerNetwork(env)
  try {
    return await withRpcFailover(cfg, async (rpcUrl) => {
      const sb = makeSorobits(rpcUrl, cfg)
      const [supplyTx, ...genesisTxs] = await withTimeout(
        Promise.all([
          sb.total_supply(),
          ...[1, 2, 3, 4, 5, 6, 7, 8].map((archetype_id) =>
            sb.genesis_minted({ archetype_id }),
          ),
        ]),
        3500,
      )
      const genesisMinted = genesisTxs.reduce(
        (sum, tx) => sum + Number(tx.result ?? 0),
        0,
      )
      return {
        contractId: cfg.sorobitsContractId,
        totalSupply: Number(supplyTx.result ?? 0),
        genesisMinted,
      }
    })
  } catch {
    return {
      contractId: cfg.sorobitsContractId,
      totalSupply: 0,
      genesisMinted: 0,
    }
  }
}

async function simulateFactoryPair(
  tokenId: string,
  rpcUrl: string,
  cfg?: WorkerNetworkConfig,
): Promise<string | null> {
  const passphrase = cfg?.passphrase ?? NETWORK_PASSPHRASE
  const factoryAddr = cfg?.soroswapFactory ?? SOROSWAP_FACTORY
  const xlmSac = cfg?.xlmSac ?? XLM_SAC
  try {
    const server = new sorobanRpc.Server(rpcUrl)
    const factory = new Contract(factoryAddr)
    const sourceAccount = {
      accountId: () => READONLY_SOURCE,
      sequenceNumber: () => '0',
      incrementSequenceNumber: () => {},
    }
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase: passphrase,
    })
      .addOperation(
        factory.call(
          'get_pair',
          new Address(tokenId).toScVal(),
          new Address(xlmSac).toScVal(),
        ),
      )
      .setTimeout(30)
      .build()
    const sim = await withTimeout(server.simulateTransaction(tx), 3000)
    if (!sorobanRpc.Api.isSimulationSuccess(sim) || !sim.result) return null
    const pair = scValToNative(sim.result.retval)
    return typeof pair === 'string' && /^C[A-Z2-7]{55}$/.test(pair)
      ? pair
      : null
  } catch {
    return null
  }
}

export async function fetchLiveMarketSnapshot(
  env: Env,
  maxItems = 5,
): Promise<{
  items: MarketTokenSummary[]
  rpcFailed: boolean
}> {
  const cfg = resolveWorkerNetwork(env)

  try {
    return await withRpcFailover(cfg, async (rpcUrl) => {
      const lp = makeLaunchpad(rpcUrl, cfg)
      const countTx = await withTimeout(lp.get_launch_count(), 4000)
      const total = Number(countTx.result ?? 0)
      const limit = Math.max(10, Math.min(20, maxItems))
      // Launchpad.get_launches returns newest-first starting at offset 0.
      const launchesTx =
        total > 0
          ? await withTimeout(lp.get_launches({ offset: 0, limit }), 4000)
          : null

      const records = launchesTx?.result ?? []
      const rawSummaries = await Promise.all(
        records.map(async (rec): Promise<MarketTokenSummary | null> => {
          const cleanName = String(rec.name || '').trim()
          const cleanSym = String(rec.symbol || '').trim().toUpperCase()
          if (/^Demo \d{10,}$/i.test(cleanName) || /^(SMOKE|ADVT|E2E\d+)$/i.test(cleanSym)) {
            return null
          }
          try {
            const curveTx = await withTimeout(
              lp.get_curve({ token: rec.token }),
              3500,
            )
            const curve = curveTx.result
            if (curve && curve.burn_vault_remaining > 0n) {
              return null
            }
            const graduated = curve ? curve.graduated : Boolean(rec.pair)
            const pairId = curve?.pair ?? rec.pair ?? null
            const dexRes =
              graduated && pairId
                ? await simulatePairXlmReserve(pairId, rpcUrl, cfg)
                : null
            return {
              id: rec.token,
              name: rec.name,
              symbol: rec.symbol,
              graduated,
              curveXlmNet: curve?.curve_xlm_net ?? 0n,
              pairId,
              reserveXlmStroops: dexRes ?? curve?.real_xlm_vault ?? 0n,
            }
          } catch {
            return {
              id: rec.token,
              name: rec.name,
              symbol: rec.symbol,
              graduated: Boolean(rec.pair),
              curveXlmNet: 0n,
              pairId: rec.pair ?? null,
              reserveXlmStroops: 0n,
            }
          }
        }),
      )
      const summaries = rawSummaries.filter(
        (item): item is MarketTokenSummary => item !== null,
      )

      // Prioritize active curves close to graduation, then graduated pairs
      summaries.sort((a, b) => {
        if (a.graduated !== b.graduated) return a.graduated ? 1 : -1
        if (!a.graduated && b.curveXlmNet !== a.curveXlmNet) {
          return b.curveXlmNet > a.curveXlmNet ? 1 : -1
        }
        return b.reserveXlmStroops > a.reserveXlmStroops ? 1 : -1
      })

      return { items: summaries.slice(0, maxItems), rpcFailed: false }
    })
  } catch {
    return { items: [], rpcFailed: true }
  }
}

export async function fetchLiveTokenInspectorData(
  tokenId: string,
  env: Env,
): Promise<TokenInspectorData | null> {
  const cfg = resolveWorkerNetwork(env)

  try {
    return await withRpcFailover(cfg, async (rpcUrl) => {
      const token = makeToken(tokenId, rpcUrl, cfg)
      const lp = makeLaunchpad(rpcUrl, cfg)
      const [nameTx, symTx, decTx, supplyTx, curveTx, shoutTx] = await withTimeout(
        Promise.all([
          token.name(),
          token.symbol(),
          token.decimals(),
          token.total_supply().catch(() => ({ result: 100_000_000_000_000n })),
          lp.get_curve({ token: tokenId }).catch(() => ({ result: null })),
          lp.get_king_shout({ token: tokenId }).catch(() => ({ result: null })),
        ]),
        4500,
      )

      const curveRaw = curveTx.result
      let pairId = curveRaw?.pair ?? null
      if (!pairId && cfg.network === 'testnet' && tokenId === cfg.astroTokenId) {
        pairId = cfg.astroPairId
      } else if (!pairId && (!curveRaw || curveRaw.graduated)) {
        pairId = await simulateFactoryPair(tokenId, rpcUrl, cfg)
      }

      const dexReserveXlm = pairId
        ? await simulatePairXlmReserve(pairId, rpcUrl, cfg)
        : null

      const shoutRaw = shoutTx.result
      return {
        tokenId,
        name: String(nameTx.result || 'Token'),
        symbol: String(symTx.result || 'TOK'),
        decimals: Number(decTx.result ?? 7),
        totalSupply: BigInt(supplyTx.result ?? 0n),
        curve: curveRaw
          ? {
              graduated: curveRaw.graduated,
              curveXlmNet: curveRaw.curve_xlm_net,
              realXlmVault: curveRaw.real_xlm_vault,
              tokensSold: curveRaw.tokens_sold,
              buybackXlmReserve: curveRaw.buyback_xlm_reserve,
              burnVaultRemaining: curveRaw.burn_vault_remaining,
              burnMilestoneStage: curveRaw.burn_milestone_stage,
              pair: curveRaw.pair,
              creator: curveRaw.creator,
            }
          : null,
        kingShout: shoutRaw
          ? {
              sender: shoutRaw.sender,
              amount: shoutRaw.amount,
              message: shoutRaw.message,
            }
          : null,
        dexReserveXlm,
      }
    })
  } catch {
    return null
  }
}

export async function fetchHorizonAccountSummary(
  accountId: string,
  env: Env,
): Promise<AccountSummaryData | null> {
  if (!isAccountAddr(accountId)) return null
  const cfg = resolveWorkerNetwork(env)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const res = await fetch(
      `${cfg.horizonUrl}/accounts/${encodeURIComponent(accountId)}`,
      {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      },
    )
    if (res.status === 404) {
      return { accountId, funded: false, xlmBalance: '0.00', assetCount: 0 }
    }
    if (!res.ok) return null
    const json = (await res.json()) as {
      balances?: Array<{ asset_type?: string; balance?: string }>
    }
    const balances = Array.isArray(json.balances) ? json.balances : []
    const native = balances.find((b) => b.asset_type === 'native')
    const xlmNum = Number(native?.balance ?? '0')
    return {
      accountId,
      funded: true,
      xlmBalance: Number.isFinite(xlmNum)
        ? xlmNum.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : '0.00',
      assetCount: Math.max(0, balances.length - 1),
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function fetchTokenShoutsData(
  tokenId: string,
  env: Env,
): Promise<TokenShoutsData | null> {
  const cfg = resolveWorkerNetwork(env)
  try {
    return await withRpcFailover(cfg, async (rpcUrl) => {
      const token = makeToken(tokenId, rpcUrl, cfg)
      const lp = makeLaunchpad(rpcUrl, cfg)
      const [nameTx, symTx, decTx, kingTx, shoutsTx] = await withTimeout(
        Promise.all([
          token.name(),
          token.symbol(),
          token.decimals(),
          lp.get_king_shout({ token: tokenId }).catch(() => ({ result: null })),
          lp.get_shouts({ token: tokenId }).catch(() => ({ result: [] })),
        ]),
        4500,
      )
      const kingRaw = kingTx.result
      const shoutsRaw = Array.isArray(shoutsTx.result) ? shoutsTx.result : []
      return {
        tokenId,
        name: String(nameTx.result || 'Token'),
        symbol: String(symTx.result || 'TOK'),
        decimals: Number(decTx.result ?? 7),
        kingShout: kingRaw
          ? {
              sender: kingRaw.sender,
              amount: kingRaw.amount,
              message: kingRaw.message,
              ledger: Number(kingRaw.ledger ?? 0),
            }
          : null,
        shouts: shoutsRaw.map((s) => ({
          sender: s.sender,
          amount: s.amount,
          message: s.message,
          ledger: Number(s.ledger ?? 0),
        })),
      }
    })
  } catch {
    return null
  }
}

export async function fetchTokenMetaSummary(
  tokenId: string,
  env: Env,
): Promise<{ symbol: string; name: string; decimals: number }> {
  const cfg = resolveWorkerNetwork(env)
  if (cfg.network === 'testnet' && tokenId === cfg.astroTokenId) {
    return { symbol: 'ASTRO', name: 'Astro Test', decimals: 7 }
  }
  try {
    return await withRpcFailover(cfg, async (rpcUrl) => {
      const token = makeToken(tokenId, rpcUrl, cfg)
      const [nameTx, symTx, decTx] = await withTimeout(
        Promise.all([token.name(), token.symbol(), token.decimals()]),
        3500,
      )
      return {
        symbol: String(symTx.result || 'TOK'),
        name: String(nameTx.result || 'Token'),
        decimals: Number(decTx.result ?? 7),
      }
    })
  } catch {
    return { symbol: 'TOK', name: 'AstroGate Token', decimals: 7 }
  }
}

export async function fetchLaunchpadEventsByTxHash(
  txHash: string,
  env: Env,
  maxLedgerAge = 180,
): Promise<LaunchpadParsedEvent[]> {
  const cfg = resolveWorkerNetwork(env)
  try {
    return await withRpcFailover(cfg, async (rpcUrl) => {
      const server = new sorobanRpc.Server(rpcUrl)
      const [txRes, latestRes] = await Promise.all([
        withTimeout(server.getTransaction(txHash), 4500),
        withTimeout(server.getLatestLedger(), 3000),
      ])
      if (txRes.status !== sorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        return []
      }
      const latestSeq = Number(latestRes.sequence ?? 0)
      if (
        maxLedgerAge > 0 &&
        latestSeq > 0 &&
        latestSeq - txRes.ledger > maxLedgerAge
      ) {
        // Reject stale historical replay triggers via public pulse API; cron handles recent feed.
        return []
      }
      const contractIds = Array.from(
        new Set([cfg.launchpadContractId, cfg.sorobitsContractId].filter(Boolean)),
      )
      if (contractIds.length === 0) return []
      const evRes = await withTimeout(
        server.getEvents({
          startLedger: txRes.ledger,
          endLedger: txRes.ledger + 1,
          filters: [{ type: 'contract', contractIds }],
          limit: 50,
        }),
        4000,
      )
      const parsed: LaunchpadParsedEvent[] = []
      for (const ev of evRes.events ?? []) {
        if (ev.txHash && ev.txHash.toLowerCase() !== txHash.toLowerCase()) {
          continue
        }
        const item = parseLaunchpadContractEvent(
          {
            id: ev.id,
            ledger: ev.ledger,
            txHash: ev.txHash ?? txHash,
            topic: ev.topic,
            value: ev.value,
          },
          cfg.sorobitsContractId,
        )
        if (item) parsed.push(item)
      }
      return parsed
    })
  } catch {
    return []
  }
}

export async function fetchRecentLaunchpadEvents(
  startLedger: number | undefined,
  env: Env,
): Promise<{ events: LaunchpadParsedEvent[]; latestLedger: number }> {
  const cfg = resolveWorkerNetwork(env)
  try {
    return await withRpcFailover(cfg, async (rpcUrl) => {
      const server = new sorobanRpc.Server(rpcUrl)
      const latest = await withTimeout(server.getLatestLedger(), 3500)
      const latestSeq = Number(latest.sequence ?? 0)
      const retentionFloor = Math.max(1, latestSeq - 1_500)
      const fromLedger =
        startLedger && startLedger > 0
          ? Math.max(startLedger, retentionFloor)
          : Math.max(1, latestSeq - 30)
      if (fromLedger > latestSeq) {
        return { events: [], latestLedger: latestSeq }
      }
      const contractIds = Array.from(
        new Set([cfg.launchpadContractId, cfg.sorobitsContractId].filter(Boolean)),
      )
      if (contractIds.length === 0) {
        return { events: [], latestLedger: latestSeq }
      }
      const evRes = await withTimeout(
        server.getEvents({
          startLedger: fromLedger,
          endLedger: latestSeq + 1,
          filters: [{ type: 'contract', contractIds }],
          limit: 50,
        }),
        4500,
      )
      const parsed: LaunchpadParsedEvent[] = []
      for (const ev of evRes.events ?? []) {
        const item = parseLaunchpadContractEvent(
          {
            id: ev.id,
            ledger: ev.ledger,
            txHash: ev.txHash,
            topic: ev.topic,
            value: ev.value,
          },
          cfg.sorobitsContractId,
        )
        if (item) parsed.push(item)
      }
      return { events: parsed, latestLedger: latestSeq }
    })
  } catch {
    return { events: [], latestLedger: startLedger ?? 0 }
  }
}

export async function findTokenBySymbol(
  symbolQuery: string,
  env: Env,
): Promise<string | null> {
  const clean = symbolQuery.trim().toUpperCase()
  if (!clean) return null
  const cfg = resolveWorkerNetwork(env)
  if (cfg.network === 'testnet' && clean === 'ASTRO') return cfg.astroTokenId

  try {
    return await withRpcFailover(cfg, async (rpcUrl) => {
      const lp = makeLaunchpad(rpcUrl, cfg)
      const countTx = await withTimeout(lp.get_launch_count(), 3500)
      const total = Number(countTx.result ?? 0)
      if (total <= 0) return null
      const limit = Math.min(20, total)
      // Launchpad.get_launches is newest-first starting at offset 0.
      const launchesTx = await withTimeout(
        lp.get_launches({ offset: 0, limit }),
        4000,
      )
      const records = launchesTx.result ?? []
      const match = records.find(
        (r) => String(r.symbol || '').trim().toUpperCase() === clean,
      )
      return match?.token ?? null
    })
  } catch {
    return null
  }
}

export async function fetchUserQuestStatus(
  accountId: string,
  env: Env,
): Promise<QuestProgressSummary> {
  const cfg = resolveWorkerNetwork(env)
  const primaryRpc = cfg.rpcUrls[0] ?? DEFAULT_RPC_URL
  const lp = makeLaunchpad(primaryRpc, cfg)
  const sb = makeSorobits(primaryRpc, cfg)
  const server = new sorobanRpc.Server(primaryRpc)

  const [account, launchesInfo, recentEvents, sorobitsIds, pilotRecord] = await Promise.all([
    fetchHorizonAccountSummary(accountId, env),
    (async () => {
      try {
        const countTx = await withTimeout(lp.get_launch_count(), 3500)
        const total = Number(countTx.result ?? 0)
        if (total <= 0) {
          return {
            launched: 0,
            graduatedIds: new Set<string>(),
            createdGrad: 0,
            tokenIds: [] as string[],
          }
        }
        const limit = Math.min(20, total)
        const launchesTx = await withTimeout(
          lp.get_launches({ offset: 0, limit }),
          4000,
        )
        const records = launchesTx.result ?? []
        const graduatedIds = new Set<string>()
        const tokenIds: string[] = []
        let launched = 0
        let createdGrad = 0
        for (const rec of records) {
          tokenIds.push(rec.token)
          if (rec.pair) graduatedIds.add(rec.token)
          if (rec.creator === accountId) {
            launched += 1
            if (rec.pair) createdGrad += 1
          }
        }
        return { launched, graduatedIds, createdGrad, tokenIds }
      } catch {
        return {
          launched: 0,
          graduatedIds: new Set<string>(),
          createdGrad: 0,
          tokenIds: [] as string[],
        }
      }
    })(),
    (async () => {
      try {
        const latest = await withTimeout(server.getLatestLedger(), 3000)
        const latestSeq = Number(latest.sequence ?? 0)
        const fromLedger = Math.max(1, latestSeq - 10_000)
        const evRes = await withTimeout(
          server.getEvents({
            startLedger: fromLedger,
            endLedger: latestSeq + 1,
            filters: [{ type: 'contract', contractIds: [cfg.launchpadContractId] }],
            limit: 200,
          }),
          4500,
        )
        const parsed: LaunchpadParsedEvent[] = []
        for (const ev of evRes.events ?? []) {
          const item = parseLaunchpadContractEvent({
            id: ev.id,
            ledger: ev.ledger,
            txHash: ev.txHash,
            topic: ev.topic,
            value: ev.value,
          })
          if (item) parsed.push(item)
        }
        return parsed
      } catch {
        return [] as LaunchpadParsedEvent[]
      }
    })(),
    (async () => {
      try {
        const collected: number[] = []
        let offset = 0
        while (collected.length < 50) {
          const pageSize = 50 - collected.length
          const pageTx = await withTimeout(
            sb.tokens_of_page({ owner: accountId, offset, limit: pageSize }),
            3500,
          )
          const page = (pageTx.result ?? []).map((id) => Number(id))
          collected.push(...page)
          if (page.length < pageSize) break
          offset += page.length
        }
        return collected
      } catch {
        try {
          const res = await withTimeout(sb.tokens_of({ owner: accountId }), 3500)
          return (res.result ?? []).map((id) => Number(id)).slice(0, 50)
        } catch {
          return [] as number[]
        }
      }
    })(),
    (async () => {
      try {
        const tx = await withTimeout(lp.get_pilot({ user: accountId }), 3500)
        const rec = tx.result
        if (!rec) return null
        return {
          launches: Number(rec.launches ?? 0),
          graduations: Number(rec.graduations ?? 0),
          trades: Number(rec.trades ?? 0),
          volumeXlmStroops: BigInt(rec.volume_xlm_stroops ?? 0n),
          shouts: Number(rec.shouts ?? 0),
          kingShouts: Number(rec.king_shouts ?? 0),
          burnsTriggered: Number(rec.burns_triggered ?? 0),
        }
      } catch {
        return null
      }
    })(),
  ])

  // Verify real AstroGate Soroban ecosystem holdings (prevents arbitrary Horizon trustline spoofing for AGQ05).
  const candidateTokens = Array.from(
    new Set([
      ...(cfg.network === 'testnet' ? [cfg.astroTokenId] : []),
      ...launchesInfo.tokenIds.slice(0, 6),
    ]),
  )
  const ecoBalances = await Promise.all(
    candidateTokens.map(async (tid) => {
      try {
        const res = await withTimeout(
          makeToken(tid, primaryRpc, cfg).balance({ account: accountId }),
          2500,
        )
        return BigInt(res.result ?? 0n) > 0n ? 1 : 0
      } catch {
        return 0
      }
    }),
  )
  const ecosystemTokenCount = ecoBalances.reduce<number>((sum, n) => sum + n, 0)

  let shoutCount = 0
  let kingBurnCount = 0
  let eventLaunchCount = 0
  let swapCount = 0
  let tradedGradCount = 0
  for (const ev of recentEvents) {
    if (ev.kind === 'shout' && ev.sender === accountId) {
      shoutCount += 1
      if (ev.isKing) kingBurnCount += 1
    }
    if (ev.kind === 'launch' && ev.creator === accountId) eventLaunchCount += 1
    if (ev.kind === 'trade' && ev.trader === accountId) {
      swapCount += 1
      if (launchesInfo.graduatedIds.has(ev.tokenId)) {
        tradedGradCount += 1
      }
    }
  }

  return {
    ...computeQuestSummary({
      accountId,
      funded: Boolean(account?.funded),
      launchedCount: Math.max(
        launchesInfo.launched,
        eventLaunchCount,
        pilotRecord?.launches ?? 0,
      ),
      shoutCount: Math.max(shoutCount, pilotRecord?.shouts ?? 0),
      graduatedCount: Math.max(
        launchesInfo.createdGrad + tradedGradCount,
        pilotRecord?.graduations ?? 0,
      ),
      swapCount: Math.max(swapCount, pilotRecord?.trades ?? 0),
      assetCount: account?.assetCount ?? 0,
      ecosystemTokenCount,
      kingBurnCount: Math.max(kingBurnCount, pilotRecord?.kingShouts ?? 0),
      volumeXlmStroops: pilotRecord?.volumeXlmStroops,
      burnsTriggered: pilotRecord?.burnsTriggered,
    }),
    sorobitsIds,
    sorobitsBalance: sorobitsIds.length,
  }
}
