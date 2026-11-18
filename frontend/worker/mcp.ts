import {
  auditTokenApi,
  buildProtocolOverview,
  getSorobitsApi,
  inspectTokenApi,
  listMarketTokensApi,
  quoteTokenSwapApi,
} from './protocol'
import type { Env } from './types'
import { resolveWalletIdentity } from './wallet'

interface JsonRpcRequest {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

export const MCP_TOOLS = [
  {
    name: 'get_protocol_info',
    description:
      'Returns AstroGate Fair-Flywheel v4.3 contract addresses, fee formulas, anti-MEV bounds, and Sorobits SEP-50 specs.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_market_tokens',
    description:
      'Lists active Fair-Flywheel bonding curves and graduated Soroswap DEX pairs with live XLM reserves.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_token_details',
    description:
      'Inspects a specific token contract by Soroban address (C...), returning curve progress, burn vault stage, DEX reserve, and Burn-to-Chat shouts.',
    inputSchema: {
      type: 'object',
      required: ['tokenId'],
      properties: {
        tokenId: {
          type: 'string',
          description: '56-character Stellar Soroban contract ID starting with C',
        },
      },
    },
  },
  {
    name: 'verify_anti_rug',
    description:
      'Verifies on-chain anti-rug invariants for a token: renounced ownership (owner() == None), Fair-Flywheel v4.3 registry, curve/LP lock (7-year contract lock or blackhole burn), and supply state.',
    inputSchema: {
      type: 'object',
      required: ['tokenId'],
      properties: {
        tokenId: {
          type: 'string',
          description: '56-character Stellar Soroban contract ID starting with C',
        },
      },
    },
  },
  {
    name: 'quote_swap',
    description:
      'Calculates an exact deterministic swap quote (bounding curve pre-graduation or Soroswap AMM post-graduation) with slippage minimum.',
    inputSchema: {
      type: 'object',
      required: ['tokenId', 'amountIn', 'direction'],
      properties: {
        tokenId: {
          type: 'string',
          description: '56-character Stellar Soroban contract ID starting with C',
        },
        amountIn: {
          type: 'string',
          description: 'Positive integer string in 7-decimal base units (1 XLM = 10000000)',
        },
        direction: {
          type: 'string',
          enum: ['buy', 'sell'],
          description: 'buy = XLM -> Token, sell = Token -> XLM',
        },
        slippagePercent: {
          type: 'number',
          description: 'Slippage tolerance percentage between 0.1 and 25 (default 2)',
        },
      },
    },
  },
  {
    name: 'get_sorobits_info',
    description:
      'Returns Sorobits SEP-50 NFT contract supply, RLE SVG render bounds, and Season-1 Genesis Archetypes.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'resolve_wallet',
    description:
      'Resolves a Telegram @username, numeric Telegram user ID, or Stellar G... address to its linked primary Stellar wallet and verified Telegram status.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: 'Telegram @username, numeric user ID, or Stellar G... address',
        },
      },
    },
  },
] as const

export const MCP_RESOURCES = [
  {
    uri: 'astrogate://protocol/overview',
    name: 'AstroGate Protocol Overview',
    description: 'Fair-Flywheel v4.3 contracts, tokenomics, anti-MEV constants, and audit entrypoints',
    mimeType: 'application/json',
  },
  {
    uri: 'astrogate://market/snapshot',
    name: 'AstroGate Live Market Snapshot',
    description: 'Active bonding curves and graduated Soroswap pairs on Stellar',
    mimeType: 'application/json',
  },
] as const

const MCP_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
}

function rpcResult(id: string | number | null | undefined, result: unknown) {
  return { jsonrpc: '2.0', id: id ?? null, result }
}

function rpcError(
  id: string | number | null | undefined,
  code: number,
  message: string,
) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
  env: Env,
): Promise<unknown> {
  if (name === 'get_protocol_info') {
    return buildProtocolOverview(env)
  }
  if (name === 'get_market_tokens') {
    return listMarketTokensApi(env)
  }
  if (name === 'get_sorobits_info') {
    return getSorobitsApi(env)
  }
  if (name === 'resolve_wallet') {
    const query = typeof args.query === 'string' ? args.query.trim() : ''
    const link = await resolveWalletIdentity(query, env)
    if (!link) throw new Error('Wallet link not found')
    return link
  }
  if (name === 'get_token_details') {
    const tokenId = typeof args.tokenId === 'string' ? args.tokenId.trim() : ''
    const res = await inspectTokenApi(tokenId, env)
    if (!res) throw new Error('Token not found')
    return res
  }
  if (name === 'verify_anti_rug') {
    const tokenId = typeof args.tokenId === 'string' ? args.tokenId.trim() : ''
    const res = await auditTokenApi(tokenId, env)
    if (!res) throw new Error('Token not found')
    return res
  }
  if (name === 'quote_swap') {
    const tokenId = typeof args.tokenId === 'string' ? args.tokenId.trim() : ''
    const amountRaw =
      typeof args.amountIn === 'string'
        ? args.amountIn.trim()
        : typeof args.amountIn === 'number' && Number.isSafeInteger(args.amountIn)
          ? String(args.amountIn)
          : ''
    if (!/^\d+$/.test(amountRaw)) {
      throw new Error('amountIn must be a positive integer string in 7-decimal base units')
    }
    const direction = args.direction === 'sell' ? 'sell' : 'buy'
    const slippagePercent =
      typeof args.slippagePercent === 'number' ? args.slippagePercent : 2
    return quoteTokenSwapApi(
      {
        tokenId,
        amountInStroops: BigInt(amountRaw),
        direction,
        slippagePercent,
      },
      env,
    )
  }
  throw new Error(`Unknown tool: ${name}`)
}

export async function handleMcpRpcPayload(
  payload: JsonRpcRequest,
  env: Env,
): Promise<Record<string, unknown> | null> {
  const { id, method, params } = payload
  if (method === 'notifications/initialized') {
    return null
  }
  if (method === 'ping') {
    return rpcResult(id, {})
  }
  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: '2025-03-26',
      capabilities: {
        tools: { listChanged: false },
        resources: { listChanged: false },
      },
      serverInfo: {
        name: 'astrogate-mcp',
        version: '1.0.0',
      },
    })
  }
  if (method === 'tools/list') {
    return rpcResult(id, { tools: MCP_TOOLS })
  }
  if (method === 'resources/list') {
    return rpcResult(id, { resources: MCP_RESOURCES })
  }
  if (method === 'resources/read') {
    const uri = typeof params?.uri === 'string' ? params.uri : ''
    if (uri === 'astrogate://protocol/overview') {
      return rpcResult(id, {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(buildProtocolOverview(env), null, 2),
          },
        ],
      })
    }
    if (uri === 'astrogate://market/snapshot') {
      const snap = await listMarketTokensApi(env)
      return rpcResult(id, {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(snap, null, 2),
          },
        ],
      })
    }
    return rpcError(id, -32602, `Unknown resource URI: ${uri}`)
  }
  if (method === 'tools/call') {
    const name = typeof params?.name === 'string' ? params.name : ''
    const rawArgs =
      params?.arguments && typeof params.arguments === 'object'
        ? (params.arguments as Record<string, unknown>)
        : {}
    try {
      const result = await runTool(name, rawArgs, env)
      return rpcResult(id, {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Tool execution error'
      return rpcResult(id, {
        isError: true,
        content: [{ type: 'text', text: msg }],
      })
    }
  }
  return rpcError(id, -32601, `Method not found: ${String(method ?? '')}`)
}

export async function handleMcpHttpRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url)
  if (url.pathname !== '/mcp') return null

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: MCP_HEADERS })
  }
  if (request.method === 'GET') {
    return Response.json(
      {
        name: 'astrogate-mcp',
        version: '1.0.0',
        transport: 'streamable-http-jsonrpc',
        tools: MCP_TOOLS.map((t) => t.name),
        resources: MCP_RESOURCES.map((r) => r.uri),
      },
      { headers: MCP_HEADERS },
    )
  }
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: MCP_HEADERS })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json(rpcError(null, -32700, 'Parse error'), {
      status: 400,
      headers: MCP_HEADERS,
    })
  }

  if (Array.isArray(body)) {
    const out = await Promise.all(
      body.map((item) => handleMcpRpcPayload((item ?? {}) as JsonRpcRequest, env)),
    )
    const filtered = out.filter((res): res is Record<string, unknown> => res !== null)
    return filtered.length === 0
      ? new Response(null, { status: 202, headers: MCP_HEADERS })
      : Response.json(filtered, { headers: MCP_HEADERS })
  }

  const response = await handleMcpRpcPayload((body ?? {}) as JsonRpcRequest, env)
  if (response === null) {
    return new Response(null, { status: 202, headers: MCP_HEADERS })
  }
  return Response.json(response, { headers: MCP_HEADERS })
}
