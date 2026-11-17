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

export const LAUNCHPAD_CONTRACT_ID =
  'CAQWAH6OSK4PWMKRDVWYBVPW4P4ETPAJAMIGDQGWHWFEGX65IMDAH5Y5'
export const SOROBITS_CONTRACT_ID =
  'CABTTF2UFJQKQT5PZECGSE5EDIAXH7ET6TSGLZVAPJCN7WC4N7DHIBAT'
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

function makeSorobits(rpcUrl: string): SorobitsClient {
  return new SorobitsClient({
    contractId: SOROBITS_CONTRACT_ID,
    rpcUrl,
    networkPassphrase: NETWORK_PASSPHRASE,
    publicKey: READONLY_SOURCE,
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

export async function fetchTokenShoutsData(
  tokenId: string,
  env: Env,
): Promise<TokenShoutsData | null> {
  const rpcUrl = env.STELLAR_RPC_URL || DEFAULT_RPC_URL
  const token = makeToken(tokenId, rpcUrl)
  const lp = makeLaunchpad(rpcUrl)
  try {
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
  } catch {
    return null
  }
}

export async function fetchTokenMetaSummary(
  tokenId: string,
  env: Env,
): Promise<{ symbol: string; name: string; decimals: number }> {
  if (tokenId === ASTRO_TOKEN_ID) {
    return { symbol: 'ASTRO', name: 'Astro Test', decimals: 7 }
  }
  const rpcUrl = env.STELLAR_RPC_URL || DEFAULT_RPC_URL
  const token = makeToken(tokenId, rpcUrl)
  try {
    const [nameTx, symTx, decTx] = await withTimeout(
      Promise.all([token.name(), token.symbol(), token.decimals()]),
      3500,
    )
    return {
      symbol: String(symTx.result || 'TOK'),
      name: String(nameTx.result || 'Token'),
      decimals: Number(decTx.result ?? 7),
    }
  } catch {
    return { symbol: 'TOK', name: 'AstroGate Token', decimals: 7 }
  }
}

export async function fetchLaunchpadEventsByTxHash(
  txHash: string,
  env: Env,
): Promise<LaunchpadParsedEvent[]> {
  const rpcUrl = env.STELLAR_RPC_URL || DEFAULT_RPC_URL
  const server = new sorobanRpc.Server(rpcUrl)
  try {
    const txRes = await withTimeout(server.getTransaction(txHash), 4500)
    if (txRes.status !== sorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return []
    }
    const evRes = await withTimeout(
      server.getEvents({
        startLedger: txRes.ledger,
        endLedger: txRes.ledger + 1,
        filters: [{ type: 'contract', contractIds: [LAUNCHPAD_CONTRACT_ID] }],
        limit: 50,
      }),
      4000,
    )
    const parsed: LaunchpadParsedEvent[] = []
    for (const ev of evRes.events ?? []) {
      if (ev.txHash && ev.txHash.toLowerCase() !== txHash.toLowerCase()) {
        continue
      }
      const item = parseLaunchpadContractEvent({
        id: ev.id,
        ledger: ev.ledger,
        txHash: ev.txHash ?? txHash,
        topic: ev.topic,
        value: ev.value,
      })
      if (item) parsed.push(item)
    }
    return parsed
  } catch {
    return []
  }
}

export async function fetchRecentLaunchpadEvents(
  startLedger: number | undefined,
  env: Env,
): Promise<{ events: LaunchpadParsedEvent[]; latestLedger: number }> {
  const rpcUrl = env.STELLAR_RPC_URL || DEFAULT_RPC_URL
  const server = new sorobanRpc.Server(rpcUrl)
  try {
    const latest = await withTimeout(server.getLatestLedger(), 3500)
    const latestSeq = Number(latest.sequence ?? 0)
    const fromLedger =
      startLedger && startLedger > 0
        ? startLedger
        : Math.max(1, latestSeq - 30)
    if (fromLedger > latestSeq) {
      return { events: [], latestLedger: latestSeq }
    }
    const evRes = await withTimeout(
      server.getEvents({
        startLedger: fromLedger,
        endLedger: latestSeq + 1,
        filters: [{ type: 'contract', contractIds: [LAUNCHPAD_CONTRACT_ID] }],
        limit: 50,
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
    return { events: parsed, latestLedger: latestSeq }
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
  if (clean === 'ASTRO') return ASTRO_TOKEN_ID

  const rpcUrl = env.STELLAR_RPC_URL || DEFAULT_RPC_URL
  const lp = makeLaunchpad(rpcUrl)
  try {
    const countTx = await withTimeout(lp.get_launch_count(), 3500)
    const total = Number(countTx.result ?? 0)
    if (total <= 0) return null
    const limit = Math.min(25, total)
    const offset = Math.max(0, total - limit)
    const launchesTx = await withTimeout(
      lp.get_launches({ offset, limit }),
      4000,
    )
    const records = (launchesTx.result ?? []).slice().reverse()
    const match = records.find(
      (r) => String(r.symbol || '').trim().toUpperCase() === clean,
    )
    return match?.token ?? null
  } catch {
    return null
  }
}

export async function fetchUserQuestStatus(
  accountId: string,
  env: Env,
): Promise<QuestProgressSummary> {
  const rpcUrl = env.STELLAR_RPC_URL || DEFAULT_RPC_URL
  const lp = makeLaunchpad(rpcUrl)
  const sb = makeSorobits(rpcUrl)
  const server = new sorobanRpc.Server(rpcUrl)

  const [account, launchesInfo, recentEvents, sorobitsIds] = await Promise.all([
    fetchHorizonAccountSummary(accountId, env),
    (async () => {
      try {
        const countTx = await withTimeout(lp.get_launch_count(), 3500)
        const total = Number(countTx.result ?? 0)
        if (total <= 0) return { launched: 0, graduatedIds: new Set<string>(), createdGrad: 0 }
        const limit = Math.min(50, total)
        const offset = Math.max(0, total - limit)
        const launchesTx = await withTimeout(
          lp.get_launches({ offset, limit }),
          4000,
        )
        const records = launchesTx.result ?? []
        const graduatedIds = new Set<string>()
        let launched = 0
        let createdGrad = 0
        for (const rec of records) {
          if (rec.pair) graduatedIds.add(rec.token)
          if (rec.creator === accountId) {
            launched += 1
            if (rec.pair) createdGrad += 1
          }
        }
        return { launched, graduatedIds, createdGrad }
      } catch {
        return { launched: 0, graduatedIds: new Set<string>(), createdGrad: 0 }
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
            filters: [{ type: 'contract', contractIds: [LAUNCHPAD_CONTRACT_ID] }],
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
        const res = await withTimeout(sb.tokens_of({ owner: accountId }), 3500)
        return (res.result ?? []).map((id) => Number(id))
      } catch {
        return [] as number[]
      }
    })(),
  ])

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
      launchedCount: Math.max(launchesInfo.launched, eventLaunchCount),
      shoutCount,
      graduatedCount: launchesInfo.createdGrad + tradedGradCount,
      swapCount,
      assetCount: account?.assetCount ?? 0,
      kingBurnCount,
    }),
    sorobitsIds,
    sorobitsBalance: sorobitsIds.length,
  }
}
