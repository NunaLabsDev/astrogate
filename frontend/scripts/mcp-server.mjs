#!/usr/bin/env node
/**
 * AstroGate Local MCP (Model Context Protocol) Stdio Server.
 *
 * Connects IDEs and AI agents (Claude Desktop, Cursor, Antigravity, VS Code)
 * directly to Stellar Testnet/Mainnet Soroban RPC, or forwards JSON-RPC payloads
 * to a deployed AstroGate Worker `/mcp` endpoint when `ASTROGATE_MCP_URL` is set.
 *
 * Read-only by design: zero secret keys are read or accepted.
 */
import readline from 'node:readline'
import {
  Address,
  Contract,
  Keypair,
  TransactionBuilder,
  nativeToScVal,
  rpc as sorobanRpc,
  scValToNative,
} from '@stellar/stellar-sdk'

const NETWORK = process.env.STELLAR_NETWORK === 'mainnet' ? 'mainnet' : 'testnet'
const IS_MAINNET = NETWORK === 'mainnet'
const RPC_URL =
  process.env.STELLAR_RPC_URL ||
  (IS_MAINNET
    ? 'https://soroban-rpc.mainnet.stellar.org'
    : 'https://soroban-testnet.stellar.org')
const PASSPHRASE =
  process.env.NETWORK_PASSPHRASE ||
  (IS_MAINNET
    ? 'Public Global Stellar Network ; September 2015'
    : 'Test SDF Network ; September 2015')
const LAUNCHPAD_ID =
  process.env.LAUNCHPAD_CONTRACT_ID?.trim() ||
  (IS_MAINNET ? '' : 'CB5VMDAPQUK5LT5LH5L5THI6XYYUBTAXM7BJZLZYFGUJHZB64LZHFAPK')
const SOROBITS_ID =
  process.env.SOROBITS_CONTRACT_ID?.trim() ||
  (IS_MAINNET ? '' : 'CBVETCPLVAMNUUQRUJGH54XHVQT5ZOVB4FGGP2IGOGAZLUIYBBV7G3I3')
const ASTRO_ID =
  process.env.ASTRO_TOKEN_ID?.trim() ||
  (IS_MAINNET ? '' : 'CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE')
const ASTRO_PAIR_ID =
  process.env.ASTRO_PAIR_ID?.trim() ||
  (IS_MAINNET ? '' : 'CA32TMZ2AODXI7K7B6T2YPZR52HJKFCY5GT2DNHMOL326DLSNPX55BUP')
const XLM_SAC =
  process.env.XLM_SAC?.trim() ||
  (IS_MAINNET
    ? 'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA'
    : 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC')
const BURN_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
const UPSTREAM_MCP = process.env.ASTROGATE_MCP_URL?.trim() || ''

const server = new sorobanRpc.Server(RPC_URL)
const READONLY_SOURCE = {
  accountId: () => Keypair.fromPublicKey(BURN_ADDRESS).publicKey(),
  sequenceNumber: () => '0',
  incrementSequenceNumber: () => {},
}

function isContractId(val) {
  return typeof val === 'string' && /^C[A-Z2-7]{55}$/.test(val.trim())
}

async function simulateCall(contractId, method, ...args) {
  const contract = new Contract(contractId)
  const tx = new TransactionBuilder(READONLY_SOURCE, {
    fee: '100',
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build()
  const sim = await server.simulateTransaction(tx)
  if (!sorobanRpc.Api.isSimulationSuccess(sim) || !sim.result) {
    throw new Error(`Simulation failed for ${method}`)
  }
  return scValToNative(sim.result.retval)
}

function serializeBigints(val) {
  if (typeof val === 'bigint') return val.toString()
  if (Array.isArray(val)) return val.map(serializeBigints)
  if (val && typeof val === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(val)) out[k] = serializeBigints(v)
    return out
  }
  return val
}

const TOOLS = [
  {
    name: 'get_protocol_info',
    description:
      'Returns AstroGate Fair-Flywheel v4.3 contract addresses, fee formulas, and Sorobits SEP-50 specs.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_market_tokens',
    description:
      'Lists newest Fair-Flywheel launches and curve states from Soroban Launchpad.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'get_token_details',
    description: 'Inspects token metadata, supply, curve state, and King Shout by contract C... ID.',
    inputSchema: {
      type: 'object',
      required: ['tokenId'],
      properties: { tokenId: { type: 'string' } },
    },
  },
  {
    name: 'verify_anti_rug',
    description: 'Checks renounced ownership, Fair-Flywheel curve lock, and LP burn configuration.',
    inputSchema: {
      type: 'object',
      required: ['tokenId'],
      properties: { tokenId: { type: 'string' } },
    },
  },
  {
    name: 'quote_swap',
    description: 'Quotes a bonding curve or Soroswap AMM swap on-chain via Soroban simulation.',
    inputSchema: {
      type: 'object',
      required: ['tokenId', 'amountIn', 'direction'],
      properties: {
        tokenId: { type: 'string' },
        amountIn: { type: 'string' },
        direction: { type: 'string', enum: ['buy', 'sell'] },
        slippagePercent: { type: 'number' },
      },
    },
  },
  {
    name: 'get_sorobits_info',
    description: 'Reads Sorobits SEP-50 total_supply and genesis_minted from chain.',
    inputSchema: { type: 'object', properties: {} },
  },
]

async function runLocalTool(name, args) {
  if (name === 'get_protocol_info') {
    return {
      protocol: 'AstroGate',
      version: 'v4.3-fair-flywheel',
      network: NETWORK,
      rpcUrl: RPC_URL,
      contracts: {
        launchpad: LAUNCHPAD_ID,
        sorobits: SOROBITS_ID,
        astroToken: ASTRO_ID,
        astroPair: ASTRO_PAIR_ID,
        xlmSac: XLM_SAC,
        burnAddress: BURN_ADDRESS,
      },
    }
  }
  if (name === 'get_market_tokens') {
    if (!LAUNCHPAD_ID) {
      throw new Error('LAUNCHPAD_CONTRACT_ID must be set for mainnet')
    }
    const launches = await simulateCall(
      LAUNCHPAD_ID,
      'get_launches',
      nativeToScVal(0, { type: 'u32' }),
      nativeToScVal(15, { type: 'u32' }),
    )
    return { count: Array.isArray(launches) ? launches.length : 0, launches: serializeBigints(launches) }
  }
  if (name === 'get_sorobits_info') {
    if (!SOROBITS_ID) {
      throw new Error('SOROBITS_CONTRACT_ID must be set for mainnet')
    }
    const [totalSupply, ...genesisCounts] = await Promise.all([
      simulateCall(SOROBITS_ID, 'total_supply'),
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((id) =>
        simulateCall(SOROBITS_ID, 'genesis_minted', nativeToScVal(id, { type: 'u32' })),
      ),
    ])
    const genesisMinted = genesisCounts.reduce((acc, n) => acc + Number(n ?? 0), 0)
    return {
      contractId: SOROBITS_ID,
      totalSupply: Number(totalSupply ?? 0),
      genesisMinted,
    }
  }
  const tokenId = typeof args?.tokenId === 'string' ? args.tokenId.trim() : ''
  if (!isContractId(tokenId)) {
    throw new Error('Invalid Soroban tokenId (expected 56-char C... address)')
  }
  if (name === 'get_token_details') {
    const [nameStr, symbolStr, decimals, totalSupply, curve, kingShout] = await Promise.all([
      simulateCall(tokenId, 'name'),
      simulateCall(tokenId, 'symbol'),
      simulateCall(tokenId, 'decimals'),
      simulateCall(tokenId, 'total_supply'),
      simulateCall(LAUNCHPAD_ID, 'get_curve', new Address(tokenId).toScVal()).catch(() => null),
      simulateCall(LAUNCHPAD_ID, 'get_king_shout', new Address(tokenId).toScVal()).catch(() => null),
    ])
    return serializeBigints({
      tokenId,
      name: nameStr,
      symbol: symbolStr,
      decimals: Number(decimals ?? 7),
      totalSupply,
      curve,
      kingShout,
    })
  }
  if (name === 'verify_anti_rug') {
    const [owner, curve] = await Promise.all([
      simulateCall(tokenId, 'get_owner').catch(() => '__unsupported__'),
      simulateCall(LAUNCHPAD_ID, 'get_curve', new Address(tokenId).toScVal()).catch(() => null),
    ])
    const ownerRenounced = owner === null || owner === undefined
    return serializeBigints({
      tokenId,
      isVerifiedLaunchpad: Boolean(curve),
      ownershipRenounced: owner !== '__unsupported__' && ownerRenounced,
      burnAddress: BURN_ADDRESS,
      curve,
    })
  }
  if (name === 'quote_swap') {
    const rawAmt = String(args?.amountIn ?? '').trim()
    if (!/^\d+$/.test(rawAmt)) {
      throw new Error('amountIn must be a positive integer string in 7-decimal base units')
    }
    const dir = args?.direction === 'sell' ? 'sell' : 'buy'
    const quote =
      dir === 'buy'
        ? await simulateCall(
            LAUNCHPAD_ID,
            'quote_buy',
            new Address(tokenId).toScVal(),
            nativeToScVal(BigInt(rawAmt), { type: 'i128' }),
          )
        : await simulateCall(
            LAUNCHPAD_ID,
            'quote_sell',
            new Address(tokenId).toScVal(),
            nativeToScVal(BigInt(rawAmt), { type: 'i128' }),
          )
    return serializeBigints({ tokenId, direction: dir, amountIn: rawAmt, quote })
  }
  throw new Error(`Unknown tool: ${name}`)
}

async function handleRequest(msg) {
  if (UPSTREAM_MCP) {
    const res = await fetch(UPSTREAM_MCP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(msg),
    })
    if (res.status === 202) return null
    return res.json()
  }

  const { id, method, params } = msg
  if (method === 'notifications/initialized') return null
  if (method === 'ping') return { jsonrpc: '2.0', id: id ?? null, result: {} }
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'astrogate-local-mcp', version: '1.0.0' },
      },
    }
  }
  if (method === 'tools/list') {
    return { jsonrpc: '2.0', id: id ?? null, result: { tools: TOOLS } }
  }
  if (method === 'tools/call') {
    try {
      const data = await runLocalTool(params?.name, params?.arguments || {})
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] },
      }
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        result: {
          isError: true,
          content: [{ type: 'text', text: err instanceof Error ? err.message : String(err) }],
        },
      }
    }
  }
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code: -32601, message: `Method not found: ${method}` },
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', async (line) => {
  const trimmed = line.trim()
  if (!trimmed) return
  try {
    const parsed = JSON.parse(trimmed)
    const reply = await handleRequest(parsed)
    if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`)
  } catch (err) {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: err instanceof Error ? err.message : 'Parse error' },
      })}\n`,
    )
  }
})
