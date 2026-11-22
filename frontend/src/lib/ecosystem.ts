import { isValidStellarAddress } from './address'

export interface AstroWalletIdentityResult {
  address: string
  username: string | null
  verifiedTelegram: boolean
}

function readEnvString(key: string): string | undefined {
  const env = import.meta.env as Record<string, string | undefined> | undefined
  const val = env?.[key]?.trim()
  return val ? val : undefined
}

function cleanBotUsername(raw?: string): string | null {
  const trimmed = raw?.trim().replace(/^@/, '')
  if (!trimmed || !/^[A-Za-z0-9_]{5,32}$/.test(trimmed)) return null
  return trimmed
}

function cleanShortName(raw?: string): string | null {
  const trimmed = raw?.trim()
  if (!trimmed || !/^[A-Za-z0-9_]{3,64}$/.test(trimmed)) return null
  return trimmed
}

export function getAstroWalletApiBaseUrl(override?: string): string | null {
  const raw = override?.trim() || readEnvString('VITE_ASTROWALLET_API_BASE_URL')
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    if (
      parsed.protocol !== 'https:' &&
      !(parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'))
    ) {
      return null
    }
    return raw.replace(/\/+$/, '')
  } catch {
    return null
  }
}

export function buildAstroWalletConnectUrl(
  startParam = 't-vault',
  opts?: { botUsername?: string; shortName?: string },
): string | null {
  const bot = cleanBotUsername(
    opts?.botUsername ?? readEnvString('VITE_ASTROWALLET_BOT_USERNAME'),
  )
  if (!bot) return null
  const short = cleanShortName(
    opts?.shortName ?? readEnvString('VITE_ASTROWALLET_MINI_APP_SHORT_NAME'),
  )
  const base = short ? `https://t.me/${bot}/${short}` : `https://t.me/${bot}`
  const cleanStart = startParam.trim()
  return cleanStart ? `${base}?startapp=${encodeURIComponent(cleanStart)}` : base
}

export function buildAstroDexMarketUrl(params?: {
  tokenId?: string
  pairId?: string
  botUsername?: string
  shortName?: string
}): string | null {
  const bot = cleanBotUsername(
    params?.botUsername ?? readEnvString('VITE_ASTRODEX_BOT_USERNAME'),
  )
  if (!bot) return null
  const short = cleanShortName(
    params?.shortName ?? readEnvString('VITE_ASTRODEX_MINI_APP_SHORT_NAME'),
  )
  const base = short ? `https://t.me/${bot}/${short}` : `https://t.me/${bot}`
  const startParam = params?.pairId?.trim()
    ? `pair_${params.pairId.trim()}`
    : params?.tokenId?.trim()
      ? `token_${params.tokenId.trim()}`
      : 'tab_radar'
  return `${base}?startapp=${encodeURIComponent(startParam)}`
}

/**
 * Resolves a Telegram user ID or @username via AstroWallet's public AstroID directory
 * (`/v1/identity/resolve`). Returns null cleanly when unconfigured or offline.
 */
export async function resolveAstroWalletIdentity(
  query: string,
  opts?: { baseUrl?: string; fetchFn?: typeof fetch },
): Promise<AstroWalletIdentityResult | null> {
  const clean = query.trim().replace(/^@/, '')
  if (!clean) return null

  const base = getAstroWalletApiBaseUrl(opts?.baseUrl)
  if (!base) return null

  const fetchImpl = opts?.fetchFn ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') return null

  const signal =
    typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
      ? AbortSignal.timeout(4_500)
      : undefined

  try {
    const res = await fetchImpl(
      `${base}/v1/identity/resolve?q=${encodeURIComponent(clean)}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        ...(signal ? { signal } : {}),
      },
    )
    if (!res.ok) return null
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean
      found?: boolean
      username?: string
      primaryAddress?: string
    } | null
    if (
      json?.ok &&
      json.found &&
      typeof json.primaryAddress === 'string' &&
      isValidStellarAddress(json.primaryAddress)
    ) {
      return {
        address: json.primaryAddress,
        username: json.username?.replace(/^@/, '').toLowerCase() ?? null,
        verifiedTelegram: true,
      }
    }
  } catch {
    // Fall back gracefully to AstroGate local directory
  }
  return null
}
