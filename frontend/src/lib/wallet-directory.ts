import { isValidStellarAddress } from './address'
import { resolveAstroWalletIdentity } from './ecosystem'
import {
  normalizeTelegramUsername,
  readHotVaultSnapshot,
  saveTelegramWalletLink,
  signTelegramWalletLink,
  type TelegramWalletLinkMeta,
} from './hot-wallet'
import { NETWORK_NAME } from './network'
import { getTelegramInitDataRaw, readTelegramUser } from './telegram'

export interface ResolvedRecipient {
  address: string
  username: string | null
  verifiedTelegram: boolean
}

function directoryEndpoints(path: string, customBase?: string): string[] {
  if (customBase) {
    return [`${customBase.replace(/\/+$/, '')}${path}`]
  }
  return [path]
}

function timeoutSignal(ms = 5_000): AbortSignal | undefined {
  return typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
    ? AbortSignal.timeout(ms)
    : undefined
}

/**
 * Signs a canonical Ed25519 proof with the active primary Stellar wallet and publishes
 * the `telegram_user_id / @username <-> Stellar address` binding to the Worker directory.
 * Falls back cleanly to local link persistence when running offline or on static previews.
 */
export async function publishWalletTelegramLink(params: {
  username: string
  tgUserId?: number
  encryptedVaultBundle?: string
  baseUrl?: string
  fetchFn?: typeof fetch
}): Promise<TelegramWalletLinkMeta> {
  const tgUser = readTelegramUser()
  const initData = getTelegramInitDataRaw()
  const effectiveTgUserId = params.tgUserId ?? tgUser.id ?? 0

  const signed = signTelegramWalletLink({
    network: NETWORK_NAME,
    tgUserId: effectiveTgUserId,
    username: params.username,
  })

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (initData) {
    headers['X-Telegram-Init-Data'] = initData
  }

  const fetchImpl = params.fetchFn ?? globalThis.fetch
  const body = JSON.stringify({
    username: signed.username,
    tgUserId: signed.tgUserId,
    primaryPublicKey: signed.primaryPublicKey,
    wallets: signed.wallets,
    timestamp: signed.timestamp,
    signatureHex: signed.signatureHex,
    ...(params.encryptedVaultBundle
      ? { encryptedVaultBundle: params.encryptedVaultBundle }
      : {}),
  })

  if (typeof fetchImpl === 'function') {
    const candidates = directoryEndpoints('/api/v1/wallet/link', params.baseUrl)
    for (const endpoint of candidates) {
      try {
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers,
          body,
          signal: timeoutSignal(),
        })
        const json = (await res.json().catch(() => null)) as {
          ok?: boolean
          error?: string
          link?: {
            username?: string
            tgUserId?: number
            primaryPublicKey?: string
            verifiedTelegram?: boolean
            updatedAt?: number
          }
        } | null

        if (res.ok && json?.ok && json.link?.primaryPublicKey) {
          const verifiedMeta: TelegramWalletLinkMeta = {
            ...(json.link.tgUserId ? { tgUserId: json.link.tgUserId } : {}),
            username: json.link.username ?? signed.username,
            primaryPublicKey: json.link.primaryPublicKey,
            linkedAt: json.link.updatedAt ?? Date.now(),
            verifiedTelegram: Boolean(json.link.verifiedTelegram),
          }
          saveTelegramWalletLink(verifiedMeta)
          return verifiedMeta
        }

        // Propagate explicit auth/ownership rejections rather than silently faking local link
        if (res.status === 401 || res.status === 403 || res.status === 409) {
          throw new Error(json?.error || `Wallet link rejected (${res.status}).`)
        }
      } catch (err) {
        if (
          err instanceof Error &&
          /rejected|already|invalid|mismatch|expired|Secret seeds/i.test(err.message)
        ) {
          throw err
        }
      }
    }
  }

  const localFallback: TelegramWalletLinkMeta = {
    ...(signed.tgUserId > 0 ? { tgUserId: signed.tgUserId } : {}),
    username: signed.username,
    primaryPublicKey: signed.primaryPublicKey,
    linkedAt: Date.now(),
    verifiedTelegram: false,
  }
  saveTelegramWalletLink(localFallback)
  return localFallback
}

/**
 * Resolves either a direct Stellar `G...` address or a `@username` handle via
 * local vault link metadata + Worker directory (`/api/v1/wallet/resolve`).
 */
export async function resolveUsernameOrAddress(
  input: string,
  options?: { baseUrl?: string; fetchFn?: typeof fetch },
): Promise<ResolvedRecipient | null> {
  const trimmed = input.trim()
  if (!trimmed) return null

  if (isValidStellarAddress(trimmed)) {
    return { address: trimmed, username: null, verifiedTelegram: false }
  }

  if (!/^@?[a-zA-Z0-9_]{3,32}$/.test(trimmed)) {
    return null
  }
  const cleanUsername = normalizeTelegramUsername(trimmed)

  const snap = readHotVaultSnapshot()
  if (
    snap.telegramLink &&
    snap.telegramLink.username === cleanUsername &&
    isValidStellarAddress(snap.telegramLink.primaryPublicKey)
  ) {
    return {
      address: snap.telegramLink.primaryPublicKey,
      username: snap.telegramLink.username,
      verifiedTelegram: Boolean(snap.telegramLink.verifiedTelegram),
    }
  }

  const fetchImpl = options?.fetchFn ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') return null

  const astroIdMatch = await resolveAstroWalletIdentity(cleanUsername, {
    fetchFn: fetchImpl,
  })
  if (astroIdMatch) {
    return astroIdMatch
  }

  const queryPath = `/api/v1/wallet/resolve?q=${encodeURIComponent(cleanUsername)}`
  for (const endpoint of directoryEndpoints(queryPath, options?.baseUrl)) {
    try {
      const res = await fetchImpl(endpoint, {
        method: 'GET',
        signal: timeoutSignal(),
      })
      if (!res.ok) continue
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean
        found?: boolean
        username?: string
        primaryPublicKey?: string
        verifiedTelegram?: boolean
      } | null
      if (
        json?.ok &&
        json.found &&
        typeof json.primaryPublicKey === 'string' &&
        isValidStellarAddress(json.primaryPublicKey)
      ) {
        return {
          address: json.primaryPublicKey,
          username: json.username ?? cleanUsername,
          verifiedTelegram: Boolean(json.verifiedTelegram),
        }
      }
    } catch {
      // Try fallback endpoint
    }
  }

  return null
}

/**
 * Fetches the authenticated Telegram Mini App user's remote encrypted `AGVAULT1`
 * bundle and verified `@username` link from `/api/v1/wallet/vault` when `initData` exists.
 */
export async function fetchRemoteTelegramWalletVault(options?: {
  baseUrl?: string
  fetchFn?: typeof fetch
}): Promise<{
  link: TelegramWalletLinkMeta | null
  encryptedVaultBundle: string | null
} | null> {
  const initData = getTelegramInitDataRaw()
  if (!initData) return null

  const fetchImpl = options?.fetchFn ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') return null

  for (const endpoint of directoryEndpoints('/api/v1/wallet/vault', options?.baseUrl)) {
    try {
      const res = await fetchImpl(endpoint, {
        method: 'GET',
        headers: { 'X-Telegram-Init-Data': initData },
        signal: timeoutSignal(),
      })
      if (!res.ok) continue
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean
        link?: {
          username?: string
          tgUserId?: number
          primaryPublicKey?: string
          verifiedTelegram?: boolean
          updatedAt?: number
        } | null
        encryptedVaultBundle?: string | null
      } | null
      if (!json?.ok) continue

      let linkMeta: TelegramWalletLinkMeta | null = null
      if (json.link?.username && json.link.primaryPublicKey) {
        linkMeta = {
          ...(json.link.tgUserId ? { tgUserId: json.link.tgUserId } : {}),
          username: normalizeTelegramUsername(json.link.username),
          primaryPublicKey: json.link.primaryPublicKey,
          linkedAt: json.link.updatedAt ?? Date.now(),
          verifiedTelegram: Boolean(json.link.verifiedTelegram),
        }
        const snap = readHotVaultSnapshot()
        if (
          snap.exists &&
          (!snap.telegramLink || linkMeta.linkedAt >= snap.telegramLink.linkedAt)
        ) {
          saveTelegramWalletLink(linkMeta)
        }
      }

      return {
        link: linkMeta,
        encryptedVaultBundle:
          typeof json.encryptedVaultBundle === 'string'
            ? json.encryptedVaultBundle
            : null,
      }
    } catch {
      // Try fallback endpoint
    }
  }
  return null
}
