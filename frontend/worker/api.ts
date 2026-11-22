import {
  auditTokenApi,
  buildProtocolOverview,
  getSorobitsApi,
  inspectTokenApi,
  listMarketTokensApi,
  quoteTokenSwapApi,
} from './protocol'
import { fetchUserQuestStatus } from './rpc'
import { parseTelegramInitDataUser, verifyTelegramInitData } from './telegram-auth'
import type { Env } from './types'
import { isAccountAddr } from './views'
import {
  getVerifiedWalletVault,
  linkWalletIdentity,
  normalizeTelegramUsername,
  resolveWalletIdentity,
  WalletLinkError,
} from './wallet'

const MAX_LOGO_BYTES = 32_768
const MAX_MEMORY_LOGOS = 64
const LOGO_RATE_LIMIT_PER_MIN = 10
const WALLET_LINK_RATE_LIMIT_PER_MIN = 15
const RATE_LIMIT_WINDOW_MS = 60_000
const MAX_RATE_LIMIT_KEYS = 2_048
const logoMemoryStore = new Map<string, { bytes: Uint8Array; contentType: string }>()
const rateLimitBuckets = new Map<string, number[]>()

const SECURITY_RESPONSE_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
}

const PUBLIC_API_HEADERS: Record<string, string> = {
  ...SECURITY_RESPONSE_HEADERS,
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Logo-Sha256, X-Telegram-Init-Data',
  'Cache-Control': 'public, max-age=10',
}

function walletCorsHeaders(request: Request, env: Env): Record<string, string> {
  const url = new URL(request.url)
  const origin = request.headers.get('Origin')
  const allowedOrigins = new Set<string>(['https://astrogate.pages.dev', url.origin])
  if (env.APP_BASE_URL && env.APP_BASE_URL.startsWith('https://')) {
    allowedOrigins.add(env.APP_BASE_URL.replace(/\/+$/, ''))
  }
  const defaultAllowed =
    (env.APP_BASE_URL && env.APP_BASE_URL.startsWith('https://')
      ? env.APP_BASE_URL.replace(/\/+$/, '')
      : null) ?? 'https://astrogate.pages.dev'
  const allowedOrigin =
    origin &&
    (allowedOrigins.has(origin) || /^https:\/\/[a-z0-9-]+\.astrogate\.pages\.dev$/.test(origin))
      ? origin
      : defaultAllowed

  return {
    ...SECURITY_RESPONSE_HEADERS,
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
  }
}

function isIpRateLimited(bucket: string, request: Request, limit: number): boolean {
  const ip = request.headers.get('CF-Connecting-IP')?.trim() || 'unknown'
  const key = `${bucket}:${ip}`
  const now = Date.now()
  const cutoff = now - RATE_LIMIT_WINDOW_MS
  const existing = (rateLimitBuckets.get(key) ?? []).filter((ts) => ts > cutoff)
  if (existing.length >= limit) {
    rateLimitBuckets.set(key, existing)
    return true
  }
  existing.push(now)
  if (!rateLimitBuckets.has(key) && rateLimitBuckets.size >= MAX_RATE_LIMIT_KEYS) {
    const oldest = rateLimitBuckets.keys().next().value
    if (oldest) rateLimitBuckets.delete(oldest)
  }
  rateLimitBuckets.set(key, existing)
  return false
}

function jsonOk(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return Response.json(data, {
    status,
    headers: extraHeaders ? { ...PUBLIC_API_HEADERS, ...extraHeaders } : PUBLIC_API_HEADERS,
  })
}

function jsonError(message: string, status = 400, extraHeaders?: Record<string, string>): Response {
  return Response.json(
    { ok: false, error: message },
    {
      status,
      headers: extraHeaders ? { ...PUBLIC_API_HEADERS, ...extraHeaders } : PUBLIC_API_HEADERS,
    },
  )
}

function detectImageFormat(bytes: Uint8Array): { contentType: string; ext: 'webp' | 'png' | 'jpg' | 'gif' } | null {
  if (bytes.byteLength < 12) return null
  // WebP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { contentType: 'image/webp', ext: 'webp' }
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { contentType: 'image/png', ext: 'png' }
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { contentType: 'image/jpeg', ext: 'jpg' }
  }
  // GIF: "GIF8"
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return { contentType: 'image/gif', ext: 'gif' }
  }
  return null
}

function uint8ToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) {
    bin += String.fromCharCode(bytes[i]!)
  }
  return btoa(bin)
}

function base64ToUint8(encoded: string): Uint8Array {
  const bin = atob(encoded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) {
    out[i] = bin.charCodeAt(i)
  }
  return out
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', copy.buffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

function storeLogoInMemory(sha256: string, bytes: Uint8Array, contentType: string): void {
  if (logoMemoryStore.size >= MAX_MEMORY_LOGOS) {
    const oldest = logoMemoryStore.keys().next().value
    if (oldest) logoMemoryStore.delete(oldest)
  }
  logoMemoryStore.set(sha256, { bytes, contentType })
}

async function readDefaultEdgeCache(request: Request): Promise<Response | null> {
  try {
    const cacheStorage = (globalThis as { caches?: { default?: Cache } }).caches
    const hit = await cacheStorage?.default?.match(request)
    return hit ?? null
  } catch {
    return null
  }
}

async function writeDefaultEdgeCache(request: Request, response: Response): Promise<void> {
  try {
    const cacheStorage = (globalThis as { caches?: { default?: Cache } }).caches
    await cacheStorage?.default?.put(request, response.clone())
  } catch {
    // Edge Cache unavailable in unit tests / local node
  }
}

export function buildOpenApiSpec(origin: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'AstroGate Public Read-Only & Content-Addressed Logo API',
      version: '1.2.0',
      description:
        'Public, unauthenticated JSON API for inspecting Stellar Soroban Fair-Flywheel v4.5 launches, anti-rug proofs, swap quotes, Sorobits SEP-50 NFTs, on-chain quests, and SHA-256 content-addressed token logos.',
    },
    servers: [{ url: origin }],
    paths: {
      '/api/v1/health': {
        get: {
          summary: 'Protocol overview, contracts, and tokenomics parameters',
          responses: { '200': { description: 'Protocol metadata JSON' } },
        },
      },
      '/api/v1/tokens': {
        get: {
          summary: 'List active bonding curves and graduated Soroswap DEX pairs (edge-cached 10s)',
          responses: { '200': { description: 'Market tokens snapshot' } },
        },
      },
      '/api/v1/tokens/{id}': {
        get: {
          summary: 'Inspect a token contract, curve state, king shout, and recent shouts',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Token details' }, '404': { description: 'Token not found' } },
        },
      },
      '/api/v1/tokens/{id}/audit': {
        get: {
          summary: 'Run automated on-chain anti-rug & ownership checks for a token',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Audit verification summary' } },
        },
      },
      '/api/v1/tokens/{id}/quote': {
        get: {
          summary: 'Quote a buy or sell swap against bonding curve or Soroswap AMM',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'amountIn', in: 'query', required: true, schema: { type: 'string' } },
            { name: 'direction', in: 'query', required: false, schema: { type: 'string', enum: ['buy', 'sell'] } },
            { name: 'slippage', in: 'query', required: false, schema: { type: 'number' } },
          ],
          responses: { '200': { description: 'Deterministic swap quote' } },
        },
      },
      '/api/v1/sorobits': {
        get: {
          summary: 'Sorobits SEP-50 NFT collection stats and Genesis Archetypes (edge-cached 10s)',
          responses: { '200': { description: 'Sorobits metadata & supply' } },
        },
      },
      '/api/v1/quests/{address}': {
        get: {
          summary: 'Read verified on-chain Sorobits Season-1 quest progress for a Stellar account (G...)',
          parameters: [{ name: 'address', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Quest summary & Sorobits holdings' } },
        },
      },
      '/api/v1/logos': {
        post: {
          summary: 'Store a compressed raster token logo (<=32KB) and return its immutable SHA-256 URL',
          responses: { '200': { description: 'Content-addressed URL JSON' }, '413': { description: 'Logo > 32KB' }, '415': { description: 'Unsupported image magic bytes' } },
        },
      },
      '/api/v1/logos/{hash}.{ext}': {
        get: {
          summary: 'Fetch an immutable SHA-256 content-addressed token logo',
          parameters: [
            { name: 'hash', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'ext', in: 'path', required: true, schema: { type: 'string', enum: ['webp', 'png', 'jpg', 'gif'] } },
          ],
          responses: { '200': { description: 'Binary image bytes' }, '404': { description: 'Logo not found' } },
        },
      },
      '/api/v1/wallet/link': {
        post: {
          summary: 'Bind a Telegram @username / user ID to self-custodial Stellar wallet(s) via Ed25519 signature',
          responses: { '200': { description: 'Verified wallet directory link' }, '401': { description: 'Invalid initData or Ed25519 signature' } },
        },
      },
      '/api/v1/wallet/resolve': {
        get: {
          summary: 'Resolve a Telegram @username, user ID, or Stellar address to its linked primary address',
          parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { '200': { description: 'Linked wallet directory entry' }, '404': { description: 'Wallet link not found' } },
        },
      },
      '/api/v1/wallet/vault': {
        get: {
          summary: 'Fetch synced AES-GCM encrypted wallet vault for the authenticated Telegram Mini App user',
          responses: { '200': { description: 'Encrypted AGVAULT1 bundle and link metadata' }, '401': { description: 'Valid X-Telegram-Init-Data required' } },
        },
      },
    },
  }
}

export async function handlePublicApiRequest(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url)
  const path = url.pathname

  if (path !== '/openapi.json' && path !== '/api/v1' && !path.startsWith('/api/v1/')) {
    return null
  }

  const isRestrictedWalletRoute =
    path === '/api/v1/wallet/link' || path === '/api/v1/wallet/vault'

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: isRestrictedWalletRoute ? walletCorsHeaders(request, env) : PUBLIC_API_HEADERS,
    })
  }

  if (path === '/api/v1/wallet/link' && request.method === 'POST') {
    const walletCors = walletCorsHeaders(request, env)
    if (isIpRateLimited('wallet-link', request, WALLET_LINK_RATE_LIMIT_PER_MIN)) {
      return jsonError('Too many wallet link requests. Try again in a minute.', 429, {
        ...walletCors,
        'Retry-After': '60',
      })
    }
    try {
      const initData = request.headers.get('X-Telegram-Init-Data')?.trim()
      let verifiedTelegram = false
      let authTgUserId: number | null = null
      let authTgUsername: string | null = null

      if (initData) {
        if (!env.TELEGRAM_BOT_TOKEN) {
          return jsonOk(
            { ok: false, error: 'Telegram bot verification is not configured on this worker.' },
            503,
            walletCors,
          )
        }
        const validInit = await verifyTelegramInitData(
          initData,
          env.TELEGRAM_BOT_TOKEN,
          86_400,
        )
        if (!validInit) {
          return jsonOk(
            { ok: false, error: 'Invalid or expired Telegram initData.' },
            401,
            walletCors,
          )
        }
        const tgUser = parseTelegramInitDataUser(initData)
        if (!tgUser) {
          return jsonOk(
            { ok: false, error: 'Missing Telegram user payload in initData.' },
            401,
            walletCors,
          )
        }
        authTgUserId = tgUser.id
        authTgUsername = tgUser.username
          ? normalizeTelegramUsername(tgUser.username)
          : null
        verifiedTelegram = true
      }

      const body = (await request.json()) as {
        username?: string
        tgUserId?: number
        primaryPublicKey?: string
        wallets?: string[]
        timestamp?: number
        signatureHex?: string
        encryptedVaultBundle?: string
      }

      if (!verifiedTelegram && body.tgUserId !== undefined && Number(body.tgUserId) > 0) {
        return jsonOk(
          { ok: false, error: 'Telegram user ID requires verified Telegram initData.' },
          401,
          walletCors,
        )
      }

      const requestedUsername = body.username
        ? normalizeTelegramUsername(body.username)
        : ''
      if (authTgUsername && requestedUsername && requestedUsername !== authTgUsername) {
        return jsonOk(
          { ok: false, error: 'Username does not match verified Telegram profile.' },
          403,
          walletCors,
        )
      }

      const effectiveTgUserId = authTgUserId ?? 0
      const effectiveUsername =
        authTgUsername ?? (requestedUsername || (authTgUserId ? `tg_${authTgUserId}` : ''))
      const effectiveVerified =
        verifiedTelegram &&
        (Boolean(authTgUsername) || effectiveUsername === `tg_${authTgUserId}`)

      const link = await linkWalletIdentity(
        {
          username: effectiveUsername,
          tgUserId: effectiveTgUserId,
          primaryPublicKey: body.primaryPublicKey ?? '',
          wallets: Array.isArray(body.wallets) ? body.wallets : [],
          timestamp: Number(body.timestamp ?? 0),
          signatureHex: body.signatureHex ?? '',
          verifiedTelegram: effectiveVerified,
          canSyncVault: verifiedTelegram,
          encryptedVaultBundle: body.encryptedVaultBundle,
        },
        env,
      )
      return jsonOk({ ok: true, link }, 200, walletCors)
    } catch (err) {
      if (err instanceof WalletLinkError) {
        return jsonOk({ ok: false, error: err.message }, err.status, walletCors)
      }
      return jsonOk(
        { ok: false, error: err instanceof Error ? err.message : 'Invalid wallet link request' },
        400,
        walletCors,
      )
    }
  }

  // Content-addressed immutable token logo upload (no API key required; verified by magic bytes + SHA-256)
  if (path === '/api/v1/logos' && request.method === 'POST') {
    if (isIpRateLimited('logos', request, LOGO_RATE_LIMIT_PER_MIN)) {
      return jsonError('Too many logo uploads. Try again in a minute.', 429, {
        'Cache-Control': 'no-store',
        'Retry-After': '60',
      })
    }
    try {
      const buf = await request.arrayBuffer()
      if (buf.byteLength <= 0 || buf.byteLength > MAX_LOGO_BYTES) {
        return jsonError(`Logo payload must be 1..=${MAX_LOGO_BYTES} bytes`, 413)
      }
      const bytes = new Uint8Array(buf)
      const detected = detectImageFormat(bytes)
      if (!detected) {
        return jsonError('Unsupported image bytes (expected WebP, PNG, JPEG, or GIF)', 415)
      }
      const sha256 = await sha256Hex(bytes)
      const declaredHash = request.headers.get('X-Logo-Sha256')?.trim().toLowerCase()
      if (declaredHash && declaredHash !== sha256) {
        return jsonError('SHA-256 integrity mismatch', 400)
      }

      storeLogoInMemory(sha256, bytes, detected.contentType)
      if (env.ASTRO_KV) {
        await env.ASTRO_KV.put(
          `logo:${sha256}`,
          JSON.stringify({ contentType: detected.contentType, base64: uint8ToBase64(bytes) }),
          { expirationTtl: 31_536_000 },
        )
      }

      const publicUrl = `${url.origin}/api/v1/logos/${sha256}.${detected.ext}`
      await writeDefaultEdgeCache(
        new Request(publicUrl, { method: 'GET' }),
        new Response(bytes.slice().buffer, {
          status: 200,
          headers: {
            'Content-Type': detected.contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
            ETag: `"${sha256}"`,
            'Access-Control-Allow-Origin': '*',
            'X-Content-Type-Options': 'nosniff',
          },
        }),
      )

      return jsonOk({
        ok: true,
        sha256,
        contentType: detected.contentType,
        bytes: bytes.byteLength,
        url: publicUrl,
      })
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Logo upload failed', 400)
    }
  }

  if (request.method !== 'GET') {
    return jsonError('Method Not Allowed', 405)
  }

  try {
    const logoGetMatch = /^\/api\/v1\/logos\/([0-9a-f]{64})\.(webp|png|jpg|gif)$/.exec(path)
    if (logoGetMatch?.[1]) {
      const sha256 = logoGetMatch[1]
      const cached = await readDefaultEdgeCache(request)
      if (cached) return cached

      let entry = logoMemoryStore.get(sha256)
      if (!entry && env.ASTRO_KV) {
        const raw = await env.ASTRO_KV.get(`logo:${sha256}`)
        if (raw) {
          const parsed = JSON.parse(raw) as { contentType?: string; base64?: string }
          if (parsed.contentType && parsed.base64) {
            entry = {
              contentType: parsed.contentType,
              bytes: base64ToUint8(parsed.base64),
            }
            storeLogoInMemory(sha256, entry.bytes, entry.contentType)
          }
        }
      }
      if (!entry) {
        return jsonError('Logo not found', 404)
      }
      const res = new Response(entry.bytes.slice().buffer, {
        status: 200,
        headers: {
          'Content-Type': entry.contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
          ETag: `"${sha256}"`,
          'Access-Control-Allow-Origin': '*',
          'X-Content-Type-Options': 'nosniff',
        },
      })
      await writeDefaultEdgeCache(request, res)
      return res
    }

    if (path === '/openapi.json') {
      return jsonOk(buildOpenApiSpec(url.origin))
    }
    if (path === '/api/v1' || path === '/api/v1/health') {
      return jsonOk({ ok: true, ...buildProtocolOverview(env) })
    }
    if (path === '/api/v1/tokens') {
      const cached = await readDefaultEdgeCache(request)
      if (cached) return cached
      const data = await listMarketTokensApi(env)
      const res = jsonOk(data, 200, {
        'Cache-Control': 'public, max-age=10, stale-while-revalidate=30',
      })
      if (data.ok) await writeDefaultEdgeCache(request, res)
      return res
    }
    if (path === '/api/v1/sorobits') {
      const cached = await readDefaultEdgeCache(request)
      if (cached) return cached
      const data = await getSorobitsApi(env)
      const res = jsonOk(
        { ok: true, ...data },
        200,
        { 'Cache-Control': 'public, max-age=10, stale-while-revalidate=30' },
      )
      await writeDefaultEdgeCache(request, res)
      return res
    }

    const questMatch = /^\/api\/v1\/quests\/(G[A-Z2-7]{55})$/.exec(path)
    if (questMatch?.[1]) {
      if (!isAccountAddr(questMatch[1])) {
        return jsonError('Invalid Stellar account address', 400)
      }
      const summary = await fetchUserQuestStatus(questMatch[1], env)
      return jsonOk({ ok: true, ...summary })
    }

    const tokenAuditMatch = /^\/api\/v1\/tokens\/([A-Z0-9]+)\/audit$/.exec(path)
    if (tokenAuditMatch?.[1]) {
      const result = await auditTokenApi(tokenAuditMatch[1], env)
      if (!result) return jsonError('Token not found', 404)
      return jsonOk({ ok: true, ...result })
    }

    const tokenQuoteMatch = /^\/api\/v1\/tokens\/([A-Z0-9]+)\/quote$/.exec(path)
    if (tokenQuoteMatch?.[1]) {
      const rawAmount = (url.searchParams.get('amountIn') ?? '').trim()
      if (!/^\d+$/.test(rawAmount)) {
        return jsonError('Query parameter `amountIn` must be a positive integer string in stroops/base units')
      }
      const dirParam = (url.searchParams.get('direction') ?? 'buy').trim().toLowerCase()
      if (dirParam !== 'buy' && dirParam !== 'sell') {
        return jsonError('Query parameter `direction` must be `buy` or `sell`')
      }
      const slippageRaw = Number(url.searchParams.get('slippage') ?? '2')
      const quote = await quoteTokenSwapApi(
        {
          tokenId: tokenQuoteMatch[1],
          amountInStroops: BigInt(rawAmount),
          direction: dirParam,
          slippagePercent: Number.isFinite(slippageRaw) ? slippageRaw : 2,
        },
        env,
      )
      return jsonOk({ ok: true, ...quote })
    }

    if (path === '/api/v1/wallet/resolve') {
      const q = (url.searchParams.get('q') ?? '').trim()
      if (!q) {
        return jsonOk({ ok: false, found: false, error: 'Missing query parameter q' }, 400, {
          'Cache-Control': 'no-store',
        })
      }
      const link = await resolveWalletIdentity(q, env)
      if (!link) {
        return jsonOk({ ok: false, found: false, error: 'Wallet link not found' }, 404, {
          'Cache-Control': 'no-store',
        })
      }
      return jsonOk({ ok: true, found: true, ...link }, 200, {
        'Cache-Control': 'no-store',
      })
    }

    if (path === '/api/v1/wallet/vault') {
      const walletCors = walletCorsHeaders(request, env)
      const initData = request.headers.get('X-Telegram-Init-Data')?.trim() ?? ''
      if (!initData || !env.TELEGRAM_BOT_TOKEN) {
        return jsonOk(
          { ok: false, error: 'Verified X-Telegram-Init-Data header required' },
          401,
          walletCors,
        )
      }
      const validInit = await verifyTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN, 86_400)
      const tgUser = validInit ? parseTelegramInitDataUser(initData) : null
      if (!validInit || !tgUser) {
        return jsonOk({ ok: false, error: 'Invalid or expired Telegram initData' }, 401, walletCors)
      }
      const res = await getVerifiedWalletVault(tgUser.id, env)
      return jsonOk({ ok: true, ...res }, 200, walletCors)
    }

    const tokenDetailMatch = /^\/api\/v1\/tokens\/([A-Z0-9]+)$/.exec(path)
    if (tokenDetailMatch?.[1]) {
      const details = await inspectTokenApi(tokenDetailMatch[1], env)
      if (!details) return jsonError('Token not found', 404)
      return jsonOk({ ok: true, ...details })
    }

    return jsonError('API endpoint not found', 404)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unexpected API error'
    return jsonError(msg, 400)
  }
}
