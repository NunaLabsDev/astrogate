/**
 * Network configuration. Defaults to public Stellar testnet; supports environment overrides.
 *
 * NOTE (RPC and Failover Architecture):
 * - Transaction submission is pinned to `RPC_URL` to avoid sequence/ledger desync.
 * - Read-only queries, health checks, and event polling use `RPC_POOL` and `executeWithRpcFailover`
 *   with exponential backoff against rate limits (HTTP 429) and transient downtime.
 */
export const NETWORK_NAME =
  (import.meta.env.VITE_STELLAR_NETWORK as string | undefined) || 'testnet'

export const NETWORK_PASSPHRASE =
  NETWORK_NAME === 'mainnet'
    ? 'Public Global Stellar Network ; September 2015'
    : 'Test SDF Network ; September 2015'

export const RPC_URL =
  (import.meta.env.VITE_SOROBAN_RPC_URL as string | undefined) ||
  'https://soroban-testnet.stellar.org'

/**
 * High-availability RPC failover pool for read-only simulations and event queries.
 * Orders primary endpoint first, followed by official and fallback nodes for the same network.
 */
export const RPC_POOL: string[] = Array.from(
  new Set(
    [
      import.meta.env.VITE_SOROBAN_RPC_URL,
      RPC_URL,
      NETWORK_NAME === 'mainnet'
        ? 'https://soroban-rpc.mainnet.stellar.org'
        : 'https://rpc-testnet.stellar.org',
    ].filter(Boolean) as string[],
  ),
)

export const HORIZON_URL =
  (import.meta.env.VITE_HORIZON_URL as string | undefined) ||
  'https://horizon-testnet.stellar.org'

/** Soroswap deployed on testnet (canonical AMM contracts). */
export const SOROSWAP_FACTORY = 'CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY'
export const SOROSWAP_ROUTER = 'CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD'
export const XLM_SAC = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'

/** Flagship genesis meme token deployed on testnet (ASTRO). */
export const ASTRO_TOKEN_ID = 'CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE'

/**
 * SHA-256 hash of the token contract bytecode already deployed on testnet.
 * The launchpad deploys new instances with this hash without re-uploading the binary.
 */
export const ASTRO_WASM_HASH =
  '465288c836c13bfaf22aa3a1af3d7ef251d3500ba6af9beb06046bfe486ca23d'

/**
 * Fair-Flywheel Launchpad v4.2 deployed on testnet (10M fixed supply, 42/28/29.5/0.5,
 * 2,000 vXLM -> 1,000 real XLM goal [2.25x], flat 0.80% buys, 2.50%->1.50% anti-sniper sells,
 * 7 XLM creation fee -> treasury, seed lock until grad, Soroswap buyback-burn,
 * P2P curve transfer lock, 15d post-grad vesting, 50/500/5,000 decaying King Shout).
 */
export const LAUNCHPAD_CONTRACT_ID =
  'CAQWAH6OSK4PWMKRDVWYBVPW4P4ETPAJAMIGDQGWHWFEGX65IMDAH5Y5'

/**
 * SHA-256 hash of the launchpad v4.2 contract bytecode deployed on testnet.
 */
export const LAUNCHPAD_WASM_HASH =
  '47309c0845ff41a14e883cc02e421a6bf3ec80a3da8c38f4fe1300768ba104dc'

/**
 * Official AstroGate Developers Treasury address on Stellar Testnet.
 */
export const DEVELOPER_TREASURY_ADDRESS =
  (import.meta.env.VITE_DEVELOPER_TREASURY_ADDRESS as string | undefined) ||
  'GDQT2KMQ5I2EFDK3WG42YBHRIC4B7OXL7K2G3IC2Z6LPTJEEOMXD7NQE'

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
