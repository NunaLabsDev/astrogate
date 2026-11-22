/**
 * Network configuration. Defaults to public Stellar testnet; supports strict
 * `testnet` | `mainnet` switching via `VITE_STELLAR_NETWORK` and environment overrides.
 *
 * NOTE (RPC and Failover Architecture):
 * - Transaction submission is pinned to `RPC_URL` to avoid sequence/ledger desync.
 * - Read-only queries, health checks, and event polling use `RPC_POOL` and `executeWithRpcFailover`
 *   with exponential backoff against rate limits (HTTP 429) and transient downtime.
 */
export type StellarNetworkName = 'testnet' | 'mainnet'

function resolveNetworkName(raw?: string): StellarNetworkName {
  const clean = raw?.trim().toLowerCase()
  if (!clean) return 'testnet'
  if (clean === 'testnet' || clean === 'mainnet') return clean
  throw new Error(
    `Invalid VITE_STELLAR_NETWORK="${raw}". Expected "testnet" or "mainnet".`,
  )
}

export const NETWORK_NAME: StellarNetworkName = resolveNetworkName(
  import.meta.env.VITE_STELLAR_NETWORK as string | undefined,
)

const NETWORK_PRESETS: Record<
  StellarNetworkName,
  {
    passphrase: string
    rpcUrl: string
    fallbackRpcUrl: string
    horizonUrl: string
    soroswapFactory: string
    soroswapRouter: string
    xlmSac: string
    astroTokenId: string
    astroWasmHash: string
    launchpadContractId: string
    launchpadWasmHash: string
    sorobitsContractId: string
    sorobitsWasmHash: string
    treasuryAddress: string
  }
> = {
  testnet: {
    passphrase: 'Test SDF Network ; September 2015',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    fallbackRpcUrl: 'https://rpc-testnet.stellar.org',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    soroswapFactory: 'CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY',
    soroswapRouter: 'CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD',
    xlmSac: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC',
    astroTokenId: 'CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE',
    astroWasmHash:
      'bc3ababa6a10d8385101ac29ecdac84e9375d628df190c0f4f88defe4544f0e6',
    launchpadContractId:
      'CB5VMDAPQUK5LT5LH5L5THI6XYYUBTAXM7BJZLZYFGUJHZB64LZHFAPK',
    launchpadWasmHash:
      '9db8d446725715069d85c51c4fb1b897bb93d036507a6b95fe085c64f4aaa4e9',
    sorobitsContractId:
      'CBVETCPLVAMNUUQRUJGH54XHVQT5ZOVB4FGGP2IGOGAZLUIYBBV7G3I3',
    sorobitsWasmHash:
      'bc5c0d36b9add840685f734709a32945a88e0353d49b57b938d54ae68a7d5adf',
    treasuryAddress: 'GDQT2KMQ5I2EFDK3WG42YBHRIC4B7OXL7K2G3IC2Z6LPTJEEOMXD7NQE',
  },
  mainnet: {
    passphrase: 'Public Global Stellar Network ; September 2015',
    rpcUrl: 'https://soroban-rpc.mainnet.stellar.org',
    fallbackRpcUrl: 'https://mainnet.sorobanrpc.com',
    horizonUrl: 'https://horizon.stellar.org',
    // Mainnet Soroswap / AstroGate contract IDs must be supplied via VITE_* env vars at build time.
    soroswapFactory:
      (import.meta.env.VITE_SOROSWAP_FACTORY as string | undefined)?.trim() ||
      '',
    soroswapRouter:
      (import.meta.env.VITE_SOROSWAP_ROUTER as string | undefined)?.trim() || '',
    xlmSac:
      (import.meta.env.VITE_XLM_SAC as string | undefined)?.trim() ||
      'CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA',
    astroTokenId:
      (import.meta.env.VITE_ASTRO_TOKEN_ID as string | undefined)?.trim() || '',
    astroWasmHash:
      (import.meta.env.VITE_ASTRO_WASM_HASH as string | undefined)?.trim() || '',
    launchpadContractId:
      (import.meta.env.VITE_LAUNCHPAD_CONTRACT_ID as string | undefined)?.trim() ||
      '',
    launchpadWasmHash:
      (import.meta.env.VITE_LAUNCHPAD_WASM_HASH as string | undefined)?.trim() ||
      '',
    sorobitsContractId:
      (import.meta.env.VITE_SOROBITS_CONTRACT_ID as string | undefined)?.trim() ||
      '',
    sorobitsWasmHash:
      (import.meta.env.VITE_SOROBITS_WASM_HASH as string | undefined)?.trim() ||
      '',
    treasuryAddress:
      (import.meta.env.VITE_DEVELOPER_TREASURY_ADDRESS as string | undefined)?.trim() ||
      '',
  },
}

const activePreset = NETWORK_PRESETS[NETWORK_NAME]

export const NETWORK_PASSPHRASE = activePreset.passphrase

export const RPC_URL =
  (import.meta.env.VITE_SOROBAN_RPC_URL as string | undefined)?.trim() ||
  activePreset.rpcUrl

/**
 * High-availability RPC failover pool for read-only simulations and event queries.
 * Orders primary endpoint first, followed by official and fallback nodes for the same network.
 */
export const RPC_POOL: string[] = Array.from(
  new Set(
    [
      (import.meta.env.VITE_SOROBAN_RPC_URL as string | undefined)?.trim(),
      RPC_URL,
      activePreset.fallbackRpcUrl,
    ].filter(Boolean) as string[],
  ),
)

export const HORIZON_URL =
  (import.meta.env.VITE_HORIZON_URL as string | undefined)?.trim() ||
  activePreset.horizonUrl

/** Soroswap canonical AMM contracts for active network. */
export const SOROSWAP_FACTORY = activePreset.soroswapFactory
export const SOROSWAP_ROUTER = activePreset.soroswapRouter
export const XLM_SAC = activePreset.xlmSac

/** Flagship genesis meme token (ASTRO on testnet; configurable on mainnet). */
export const ASTRO_TOKEN_ID = activePreset.astroTokenId

/**
 * SHA-256 hash of the token contract bytecode deployed on the active network.
 */
export const ASTRO_WASM_HASH = activePreset.astroWasmHash

/**
 * Fair-Flywheel Launchpad v4.3 contract ID for active network.
 */
export const LAUNCHPAD_CONTRACT_ID = activePreset.launchpadContractId

/**
 * SHA-256 hash of the launchpad v4.3 contract bytecode.
 */
export const LAUNCHPAD_WASM_HASH = activePreset.launchpadWasmHash

/**
 * Sorobits (SBIT) 100% On-Chain 32x32 Genomic SEP-50 NFT contract.
 */
export const SOROBITS_CONTRACT_ID = activePreset.sorobitsContractId

/**
 * SHA-256 hash of the Sorobits SEP-50 contract bytecode.
 */
export const SOROBITS_WASM_HASH = activePreset.sorobitsWasmHash

/**
 * Official AstroGate Developers Treasury address.
 */
export const DEVELOPER_TREASURY_ADDRESS =
  (import.meta.env.VITE_DEVELOPER_TREASURY_ADDRESS as string | undefined)?.trim() ||
  activePreset.treasuryAddress

/**
 * Standard Soroban inclusion fee (stroops) used as headroom on mainnet and testnet
 * to prevent surge-pricing transaction drops.
 */
export const DEFAULT_SOROBAN_INCLUSION_FEE =
  NETWORK_NAME === 'mainnet' ? '10000' : '1000'

/**
 * Active Launchpad contract allowlist for the selected network.
 * Future Mainnet contract migrations can list read-only legacy Launchpad IDs via
 * `VITE_LEGACY_LAUNCHPAD_CONTRACTS` without mixing external unrelated pairs.
 */
export const SUPPORTED_LAUNCHPAD_CONTRACTS: string[] = Array.from(
  new Set(
    [
      LAUNCHPAD_CONTRACT_ID,
      ...((import.meta.env.VITE_LEGACY_LAUNCHPAD_CONTRACTS as string | undefined)
        ?.split(',')
        .map((id) => id.trim())
        .filter(Boolean) ?? []),
    ].filter(Boolean),
  ),
)

/**
 * Deterministic contract-generation suffix for contract-derived caches (IndexedDB,
 * reserve snapshots, creations, activity). Changing Launchpad WASM or contract IDs
 * cleanly isolates stale test data while preserving user wallets (`networkStorageKey`).
 */
export const CONTRACT_GENERATION_TAG = [
  LAUNCHPAD_CONTRACT_ID.slice(0, 6) || 'lp',
  LAUNCHPAD_WASM_HASH.slice(0, 6) || 'v44',
  SOROBITS_CONTRACT_ID.slice(0, 6) || 'sb',
]
  .join('_')
  .toLowerCase()

/**
 * Scopes persistent storage keys by Stellar network so testnet and mainnet
 * state never collide on the same origin while keeping existing testnet keys intact.
 */
export function networkStorageKey(baseKey: string): string {
  if (NETWORK_NAME === 'testnet') return baseKey
  return baseKey.startsWith('astrogate.')
    ? baseKey.replace(/^astrogate\./, `astrogate.${NETWORK_NAME}.`)
    : `${NETWORK_NAME}.${baseKey}`
}

/**
 * Scopes contract-dependent caches (token feed, snapshots, creations, activity)
 * by active network AND contract generation so legacy deployments never pollute UI.
 * Never use this for Hot Wallet keys (use `networkStorageKey`).
 */
export function contractStorageKey(baseKey: string): string {
  const scopedNetwork = networkStorageKey(baseKey)
  return scopedNetwork.startsWith('astrogate.')
    ? scopedNetwork.replace(/^astrogate\./, `astrogate.${CONTRACT_GENERATION_TAG}.`)
    : `${CONTRACT_GENERATION_TAG}.${scopedNetwork}`
}

/**
 * Standard event polling ledger window (~14h on testnet, 5s ledgers).
 * Single source of truth for discovery.ts and token-events.ts.
 */
export const EVENT_WINDOW_LEDGERS = 10_000

/**
 * Quick health check for the Soroban RPC node with timeout protection and HTTP status verification.
 * Returns node availability, latest ledger sequence, and roundtrip latency.
 */
export async function checkRpcHealth(
  url = RPC_URL,
  timeoutMs = 5000,
): Promise<{
  ok: boolean
  sequence?: number
  latencyMs?: number
  error?: string
}> {
  const start = performance.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'getLatestLedger',
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }

    const latencyMs = Math.round(performance.now() - start)
    if (!res.ok) {
      return {
        ok: false,
        latencyMs,
        error: `HTTP ${res.status}: ${res.statusText || 'Error'}`,
      }
    }

    const data = (await res.json()) as {
      result?: { sequence?: number }
      error?: { message?: string }
    }

    if (typeof data?.result?.sequence === 'number') {
      return { ok: true, sequence: data.result.sequence, latencyMs }
    }
    return {
      ok: false,
      latencyMs,
      error: data?.error?.message ?? 'Invalid RPC response',
    }
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start)
    const isTimeout = (err as Error)?.name === 'AbortError'
    return {
      ok: false,
      latencyMs,
      error: isTimeout ? `Request timed out after ${timeoutMs}ms` : ((err as Error)?.message ?? 'Network unreachable'),
    }
  }
}

/**
 * Determines whether an error is transient and retryable (e.g. rate limit 429, 502/503/504, timeout).
 */
export function isRetryableRpcError(error: unknown): boolean {
  if (!error) return false
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase()
  return (
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('timeout') ||
    msg.includes('aborted') ||
    msg.includes('econnrefused') ||
    msg.includes('network unreachable') ||
    msg.includes('fetch failed')
  )
}

/**
 * Executes a read-only RPC query with automatic failover and exponential backoff across RPC pool nodes.
 */
export async function executeWithRpcFailover<T>(
  action: (rpcUrl: string) => Promise<T>,
  pool: string[] = RPC_POOL,
  options?: {
    maxRetries?: number
    initialDelayMs?: number
  },
): Promise<T> {
  const maxRetries = options?.maxRetries ?? 2
  const initialDelay = options?.initialDelayMs ?? 150
  let lastError: unknown

  for (const url of pool) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await action(url)
      } catch (err) {
        lastError = err
        if (!isRetryableRpcError(err)) {
          throw err
        }
        if (attempt === maxRetries) {
          break
        }
        // Exponential backoff with jitter
        const delay = initialDelay * Math.pow(2, attempt) + Math.random() * 50
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError
}
