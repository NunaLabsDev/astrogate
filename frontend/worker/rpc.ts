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
import type {
  AccountSummaryData,
  Env,
  MarketTokenSummary,
  TokenInspectorData,
} from './types'

export const LAUNCHPAD_CONTRACT_ID =
  'CAQWAH6OSK4PWMKRDVWYBVPW4P4ETPAJAMIGDQGWHWFEGX65IMDAH5Y5'
export const ASTRO_TOKEN_ID =
  'CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE'
export const ASTRO_PAIR_ID =
  'CA32TMZ2AODXI7K7B6T2YPZR52HJKFCY5GT2DNHMOL326DLSNPX55BUP'
export const XLM_SAC =
  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
export const SOROSWAP_FACTORY =
  'CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY'
export const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015'
export const DEFAULT_RPC_URL = 'https://soroban-testnet.stellar.org'
export const DEFAULT_HORIZON_URL = 'https://horizon-testnet.stellar.org'

const READONLY_SOURCE = Keypair.fromPublicKey(
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
).publicKey()

async function withTimeout<T>(promise: Promise<T>, ms = 4500): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('RPC timeout')), ms),
    ),
  ])
}

function makeLaunchpad(rpcUrl: string): LaunchpadClient {
  return new LaunchpadClient({
    contractId: LAUNCHPAD_CONTRACT_ID,
    rpcUrl,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
}

function makeToken(tokenId: string, rpcUrl: string): AstroTokenClient {
  return new AstroTokenClient({
    contractId: tokenId,
    rpcUrl,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
}

async function simulatePairXlmReserve(
  pairId: string,
  rpcUrl: string,
): Promise<bigint | null> {
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
        networkPassphrase: NETWORK_PASSPHRASE,
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
    return token0 === XLM_SAC ? r0 : r1
  } catch {
    return null
  }
}

async function simulateFactoryPair(
  tokenId: string,
  rpcUrl: string,
): Promise<string | null> {
  try {
    const server = new sorobanRpc.Server(rpcUrl)
    const factory = new Contract(SOROSWAP_FACTORY)
    const sourceAccount = {
      accountId: () => READONLY_SOURCE,
      sequenceNumber: () => '0',
      incrementSequenceNumber: () => {},
    }
    const tx = new TransactionBuilder(sourceAccount, {
      fee: '100',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        factory.call(
          'get_pair',
          new Address(tokenId).toScVal(),
          new Address(XLM_SAC).toScVal(),
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

export async function fetchLiveMarketSnapshot(env: Env): Promise<{
  items: MarketTokenSummary[]
  rpcFailed: boolean
}> {
  const rpcUrl = env.STELLAR_RPC_URL || DEFAULT_RPC_URL
  const lp = makeLaunchpad(rpcUrl)

  try {
    const countTx = await withTimeout(lp.get_launch_count(), 4000)
    const total = Number(countTx.result ?? 0)
    const limit = 5
    const offset = Math.max(0, total - limit)

    const [launchesTx, astroReserve] = await Promise.all([
      total > 0
        ? withTimeout(lp.get_launches({ offset, limit }), 4000)
        : Promise.resolve(null),
      simulatePairXlmReserve(ASTRO_PAIR_ID, rpcUrl),
    ])

    const records = (launchesTx?.result ?? []).slice().reverse()
    const summaries = await Promise.all(
      records.map(async (rec): Promise<MarketTokenSummary> => {
        try {
          const curveTx = await withTimeout(
            lp.get_curve({ token: rec.token }),
            3500,
          )
          const curve = curveTx.result
          const graduated = curve ? curve.graduated : Boolean(rec.pair)
          const pairId = curve?.pair ?? rec.pair ?? null
          const dexRes =
            graduated && pairId
              ? await simulatePairXlmReserve(pairId, rpcUrl)
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

    // Prioritize active curves close to graduation, then graduated pairs
    summaries.sort((a, b) => {
      if (a.graduated !== b.graduated) return a.graduated ? 1 : -1
      if (!a.graduated && b.curveXlmNet !== a.curveXlmNet) {
        return b.curveXlmNet > a.curveXlmNet ? 1 : -1
      }
      return b.reserveXlmStroops > a.reserveXlmStroops ? 1 : -1
    })

    // Include genesis ASTRO flagship if not already in the top list
    if (!summaries.some((item) => item.id === ASTRO_TOKEN_ID)) {
      summaries.push({
        id: ASTRO_TOKEN_ID,
        name: 'Astro Test',
        symbol: 'ASTRO',
        graduated: true,
        curveXlmNet: 10_000_000_000n,
        pairId: ASTRO_PAIR_ID,
        reserveXlmStroops: astroReserve ?? 0n,
      })
    }

    return { items: summaries.slice(0, 5), rpcFailed: false }
  } catch {
    // Graceful fallback: check genesis ASTRO pair directly before failing
    const astroReserve = await simulatePairXlmReserve(ASTRO_PAIR_ID, rpcUrl)
    if (astroReserve !== null) {
      return {
        items: [
          {
            id: ASTRO_TOKEN_ID,
            name: 'Astro Test',
            symbol: 'ASTRO',
            graduated: true,
            curveXlmNet: 10_000_000_000n,
            pairId: ASTRO_PAIR_ID,
            reserveXlmStroops: astroReserve,
          },
        ],
        rpcFailed: false,
      }
    }
    return { items: [], rpcFailed: true }
  }
}

export async function fetchLiveTokenInspectorData(
  tokenId: string,
  env: Env,
): Promise<TokenInspectorData | null> {
  const rpcUrl = env.STELLAR_RPC_URL || DEFAULT_RPC_URL
  const token = makeToken(tokenId, rpcUrl)
  const lp = makeLaunchpad(rpcUrl)

  try {
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
    if (!pairId && tokenId === ASTRO_TOKEN_ID) {
      pairId = ASTRO_PAIR_ID
    } else if (!pairId && (!curveRaw || curveRaw.graduated)) {
      pairId = await simulateFactoryPair(tokenId, rpcUrl)
    }

    const dexReserveXlm = pairId
      ? await simulatePairXlmReserve(pairId, rpcUrl)
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
  } catch {
    return null
  }
}

export async function fetchHorizonAccountSummary(
  accountId: string,
  env: Env,
): Promise<AccountSummaryData | null> {
  const horizonUrl = (env.HORIZON_URL || DEFAULT_HORIZON_URL).replace(
    /\/+$/,
    '',
  )
  try {
    const res = await withTimeout(
      fetch(`${horizonUrl}/accounts/${accountId}`, {
        headers: { Accept: 'application/json' },
      }),
      4000,
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
  }
}
