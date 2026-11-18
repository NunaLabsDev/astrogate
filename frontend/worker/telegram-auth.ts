import type { TelegramUser } from './types'

export async function safeSecretEquals(
  provided: string | null,
  expected: string | undefined,
): Promise<boolean> {
  if (!provided || !expected) return false
  const enc = new TextEncoder()
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(provided)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ])
  const bytesA = new Uint8Array(hashA)
  const bytesB = new Uint8Array(hashB)
  let diff = 0
  for (let i = 0; i < bytesA.length; i += 1) {
    diff |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0)
  }
  return diff === 0
}

/**
 * Verifies Telegram WebApp `initData` HMAC-SHA256 signature per Bot API spec:
 * secret_key = HMAC_SHA256("WebAppData", bot_token)
 * check_hash = HMAC_SHA256(secret_key, data_check_string)
 */
export async function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86_400,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!initData || !botToken) return false
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return false

  const authDate = Number(params.get('auth_date') ?? '0')
  if (!Number.isFinite(authDate) || authDate <= 0) return false
  if (nowSeconds - authDate > maxAgeSeconds) return false

  const pairs: string[] = []
  params.forEach((value, key) => {
    if (key !== 'hash') pairs.push(`${key}=${value}`)
  })
  pairs.sort()
  const dataCheckString = pairs.join('\n')

  const enc = new TextEncoder()
  const webAppKey = await crypto.subtle.importKey(
    'raw',
    enc.encode('WebAppData'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const secretKeyBytes = await crypto.subtle.sign(
    'HMAC',
    webAppKey,
    enc.encode(botToken),
  )
  const signingKey = await crypto.subtle.importKey(
    'raw',
    secretKeyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign(
    'HMAC',
    signingKey,
    enc.encode(dataCheckString),
  )
  const computedHex = Array.from(new Uint8Array(sig), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
  return safeSecretEquals(computedHex, hash.toLowerCase())
}

/** Extracts the authenticated `user` object from an already-verified `initData` string. */
export function parseTelegramInitDataUser(initData: string): TelegramUser | null {
  if (!initData) return null
  const rawUser = new URLSearchParams(initData).get('user')
  if (!rawUser) return null
  try {
    const parsed = JSON.parse(rawUser) as Partial<TelegramUser>
    if (typeof parsed.id !== 'number' || !Number.isFinite(parsed.id)) {
      return null
    }
    return {
      id: Math.trunc(parsed.id),
      is_bot: parsed.is_bot,
      first_name: parsed.first_name ?? '',
      last_name: parsed.last_name,
      username: parsed.username,
      language_code: parsed.language_code,
    }
  } catch {
    return null
  }
}
