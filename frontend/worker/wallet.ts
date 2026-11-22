import { Keypair } from '@stellar/stellar-sdk'
import { resolveWorkerNetwork } from './rpc'
import type { Env } from './types'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const MAX_WALLETS_PER_USER = 10
const MAX_BUNDLE_CHARS = 16_384
const LINK_TIMESTAMP_WINDOW_SECONDS = 300
const NONCE_TTL_SECONDS = 600
const SECRET_SEED_PATTERN = /\bS[A-Z2-7]{55}\b/

export interface StoredWalletLink {
  network: 'testnet' | 'mainnet'
  username: string
  tgUserId: number
  primaryPublicKey: string
  wallets: string[]
  verifiedTelegram: boolean
  updatedAt: number
}

interface StoredPkPointer {
  username: string
  tgUserId: number
  primaryPublicKey: string
  updatedAt: number
}

const memoryWalletKv = new Map<string, { value: string; expiresAt: number }>()

async function kvGet(key: string, env: Env): Promise<string | null> {
  if (env.ASTRO_KV) {
    return env.ASTRO_KV.get(key)
  }
  const hit = memoryWalletKv.get(key)
  if (!hit) return null
  if (hit.expiresAt > 0 && Date.now() > hit.expiresAt) {
    memoryWalletKv.delete(key)
    return null
  }
  return hit.value
}

async function kvPut(
  key: string,
  value: string,
  env: Env,
  expirationTtl?: number,
): Promise<void> {
  if (env.ASTRO_KV) {
    await env.ASTRO_KV.put(
      key,
      value,
      expirationTtl ? { expirationTtl } : undefined,
    )
    return
  }
  memoryWalletKv.set(key, {
    value,
    expiresAt: expirationTtl ? Date.now() + expirationTtl * 1000 : 0,
  })
}

function crc16XModem(bytes: Uint8Array): number {
  let crc = 0x0000
  for (let i = 0; i < bytes.length; i += 1) {
    let code = ((crc >>> 8) & 0xff) ^ bytes[i]!
    code ^= code >>> 4
    crc = ((crc << 8) & 0xffff) ^ code ^ ((code << 5) & 0xffff) ^ ((code << 12) & 0xffff)
  }
  return crc & 0xffff
}

/**
 * Pure RFC4648 base32 + CRC16-XModem decoder for Stellar `G...` public keys.
 * Returns raw 32-byte Ed25519 public key or null when invalid.
 */
export function decodeStellarPublicKey(address: string): Uint8Array | null {
  if (!/^G[A-Z2-7]{55}$/.test(address)) return null
  let buffer = 0
  let bitsLeft = 0
  const decoded = new Uint8Array(35)
  let outIdx = 0

  for (let i = 0; i < address.length; i += 1) {
    const val = BASE32_ALPHABET.indexOf(address[i]!)
    if (val < 0) return null
    buffer = (buffer << 5) | val
    bitsLeft += 5
    if (bitsLeft >= 8) {
      bitsLeft -= 8
      if (outIdx >= decoded.length) return null
      decoded[outIdx++] = (buffer >>> bitsLeft) & 0xff
    }
  }
  if (outIdx !== 35 || bitsLeft !== 0) return null
  // Stellar public key version byte: 6 << 3 === 48 ('G')
  if (decoded[0] !== 48) return null
  const payload = decoded.subarray(0, 33)
  const expectedChecksum = decoded[33]! | (decoded[34]! << 8)
  if (crc16XModem(payload) !== expectedChecksum) return null
  return decoded.slice(1, 33)
}

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]{128}$/i.test(hex)) return null
  const out = new Uint8Array(64)
  for (let i = 0; i < 64; i += 1) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

/**
 * Verifies a 64-byte Ed25519 hex signature against a Stellar `G...` public key
 * using WebCrypto in Cloudflare Workers, with `@stellar/stellar-sdk` fallback.
 */
export async function verifyStellarEd25519Signature(
  publicKey: string,
  message: string,
  signatureHex: string,
): Promise<boolean> {
  const pubKeyBytes = decodeStellarPublicKey(publicKey)
  const sigBytes = hexToBytes(signatureHex)
  if (!pubKeyBytes || !sigBytes) return false

  const msgBytes = new TextEncoder().encode(message)
  try {
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      toArrayBuffer(pubKeyBytes),
      { name: 'Ed25519' },
      false,
      ['verify'],
    )
    return await crypto.subtle.verify(
      'Ed25519',
      cryptoKey,
      toArrayBuffer(sigBytes),
      toArrayBuffer(msgBytes),
    )
  } catch {
    try {
      return Keypair.fromPublicKey(publicKey).verify(msgBytes, sigBytes)
    } catch {
      return false
    }
  }
}

export function normalizeTelegramUsername(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase()
}

export function buildCanonicalTelegramLinkMessage(params: {
  network: string
  tgUserId: number
  username: string
  primaryPublicKey: string
  wallets: string[]
  timestamp: number
}): string {
  const cleanUsername = normalizeTelegramUsername(params.username)
  return `astrogate:link:v1:${params.network}:${params.tgUserId}:${cleanUsername}:${params.primaryPublicKey}:${params.wallets.join(',')}:${params.timestamp}`
}

function containsSecretSeedInValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return SECRET_SEED_PATTERN.test(value)
  }
  if (Array.isArray(value)) {
    return value.some(containsSecretSeedInValue)
  }
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).some(containsSecretSeedInValue)
  }
  return false
}

function decodeAndCheckVaultBundleSafe(bundle: string): boolean {
  if (!bundle.startsWith('AGVAULT1:')) return false
  if (bundle.length > MAX_BUNDLE_CHARS) return false
  try {
    const base64 = bundle.slice('AGVAULT1:'.length)
    const bin = atob(base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) {
      bytes[i] = bin.charCodeAt(i)
    }
    const decodedJson = new TextDecoder().decode(bytes)
    if (SECRET_SEED_PATTERN.test(decodedJson)) return false
    const parsed = JSON.parse(decodedJson) as { v?: number; wallets?: unknown[] }
    return parsed.v === 1 && Array.isArray(parsed.wallets) && parsed.wallets.length > 0
  } catch {
    return false
  }
}

export interface LinkWalletInput {
  username: string
  tgUserId: number
  primaryPublicKey: string
  wallets: string[]
  timestamp: number
  signatureHex: string
  verifiedTelegram: boolean
  canSyncVault?: boolean
  encryptedVaultBundle?: string
  nowSeconds?: number
}

export class WalletLinkError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function linkWalletIdentity(
  input: LinkWalletInput,
  env: Env,
): Promise<StoredWalletLink> {
  const { network } = resolveWorkerNetwork(env)
  if (input.tgUserId > 0 && !input.verifiedTelegram) {
    throw new WalletLinkError(
      'Telegram user ID requires verified Telegram initData.',
      401,
    )
  }
  const cleanUsername = normalizeTelegramUsername(input.username)
  if (!/^[a-z0-9_]{3,32}$/.test(cleanUsername)) {
    throw new WalletLinkError(
      'Invalid Telegram username (expected 3-32 alphanumeric/underscore characters).',
      400,
    )
  }
  if (!decodeStellarPublicKey(input.primaryPublicKey)) {
    throw new WalletLinkError('Invalid primary Stellar public key (G...).', 400)
  }
  if (
    !Array.isArray(input.wallets) ||
    input.wallets.length === 0 ||
    input.wallets.length > MAX_WALLETS_PER_USER
  ) {
    throw new WalletLinkError(
      `Wallets list must contain 1..=${MAX_WALLETS_PER_USER} Stellar addresses.`,
      400,
    )
  }

  const dedupedWallets = Array.from(new Set(input.wallets.map((w) => w.trim())))
  if (
    dedupedWallets.some((w) => !decodeStellarPublicKey(w)) ||
    !dedupedWallets.includes(input.primaryPublicKey)
  ) {
    throw new WalletLinkError(
      'All wallets must be valid Stellar public keys and include primaryPublicKey.',
      400,
    )
  }

  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (
    !Number.isFinite(input.timestamp) ||
    Math.abs(nowSeconds - input.timestamp) > LINK_TIMESTAMP_WINDOW_SECONDS
  ) {
    throw new WalletLinkError(
      'Link signature timestamp expired or outside +/-5m window.',
      401,
    )
  }

  if (
    containsSecretSeedInValue({
      username: input.username,
      primaryPublicKey: input.primaryPublicKey,
      wallets: dedupedWallets,
      signatureHex: input.signatureHex,
    })
  ) {
    throw new WalletLinkError(
      'Secret seeds (S...) must never be transmitted to the server.',
      400,
    )
  }

  const cleanSig = input.signatureHex.trim().toLowerCase()
  if (!/^[0-9a-f]{128}$/.test(cleanSig)) {
    throw new WalletLinkError('Invalid Ed25519 signature format.', 400)
  }

  if (input.encryptedVaultBundle !== undefined) {
    const canSync = input.canSyncVault ?? input.verifiedTelegram
    if (!canSync) {
      throw new WalletLinkError(
        'Encrypted vault sync requires verified Telegram initData.',
        401,
      )
    }
    if (!decodeAndCheckVaultBundleSafe(input.encryptedVaultBundle)) {
      throw new WalletLinkError(
        'Invalid or unsafe encrypted vault bundle payload.',
        400,
      )
    }
  }

  const nonceKey = `wnonce:${network}:${cleanSig}`
  const usedNonce = await kvGet(nonceKey, env)
  if (usedNonce) {
    throw new WalletLinkError('Link signature already consumed (replay rejected).', 409)
  }

  const unameKey = `wlink:${network}:uname:${cleanUsername}`
  if (!input.verifiedTelegram) {
    const existingRaw = await kvGet(unameKey, env)
    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw) as StoredWalletLink
        const sameOwner = existing.primaryPublicKey === input.primaryPublicKey
        if (!sameOwner) {
          throw new WalletLinkError(
            'This @username is already claimed by another wallet.',
            403,
          )
        }
      } catch (err) {
        if (err instanceof WalletLinkError) throw err
        throw new WalletLinkError(
          'This @username is already claimed by another wallet.',
          403,
        )
      }
    }
  }

  const canonicalMsg = buildCanonicalTelegramLinkMessage({
    network,
    tgUserId: input.tgUserId,
    username: cleanUsername,
    primaryPublicKey: input.primaryPublicKey,
    wallets: dedupedWallets,
    timestamp: input.timestamp,
  })
  const sigValid = await verifyStellarEd25519Signature(
    input.primaryPublicKey,
    canonicalMsg,
    cleanSig,
  )
  if (!sigValid) {
    throw new WalletLinkError('Invalid Ed25519 wallet signature.', 401)
  }

  // Consume signature nonce before persisting directory records
  await kvPut(nonceKey, '1', env, NONCE_TTL_SECONDS)

  const record: StoredWalletLink = {
    network,
    username: cleanUsername,
    tgUserId: input.tgUserId,
    primaryPublicKey: input.primaryPublicKey,
    wallets: dedupedWallets,
    verifiedTelegram: input.verifiedTelegram,
    updatedAt: nowSeconds * 1000,
  }
  const serialized = JSON.stringify(record)

  const writes: Array<Promise<void>> = [kvPut(unameKey, serialized, env)]
  if (input.tgUserId > 0) {
    writes.push(kvPut(`wlink:${network}:uid:${input.tgUserId}`, serialized, env))
    if (input.encryptedVaultBundle) {
      writes.push(
        kvPut(`wvault:${network}:uid:${input.tgUserId}`, input.encryptedVaultBundle, env),
      )
    }
  }

  const pkPointer: StoredPkPointer = {
    username: cleanUsername,
    tgUserId: input.tgUserId,
    primaryPublicKey: input.primaryPublicKey,
    updatedAt: record.updatedAt,
  }
  const pkSerialized = JSON.stringify(pkPointer)
  writes.push(kvPut(`wlink:${network}:pk:${input.primaryPublicKey}`, pkSerialized, env))
  await Promise.all(writes)

  return record
}

export async function resolveWalletIdentity(
  rawQuery: string,
  env: Env,
): Promise<StoredWalletLink | null> {
  const query = rawQuery.trim()
  if (!query) return null
  const { network } = resolveWorkerNetwork(env)

  if (decodeStellarPublicKey(query)) {
    const pkRaw = await kvGet(`wlink:${network}:pk:${query}`, env)
    if (!pkRaw) return null
    try {
      const ptr = JSON.parse(pkRaw) as StoredPkPointer
      const fullRaw =
        (ptr.tgUserId > 0
          ? await kvGet(`wlink:${network}:uid:${ptr.tgUserId}`, env)
          : null) ??
        (await kvGet(`wlink:${network}:uname:${ptr.username}`, env))
      if (fullRaw) return JSON.parse(fullRaw) as StoredWalletLink
      return {
        network,
        username: ptr.username,
        tgUserId: ptr.tgUserId,
        primaryPublicKey: ptr.primaryPublicKey,
        wallets: [query],
        verifiedTelegram: ptr.tgUserId > 0,
        updatedAt: ptr.updatedAt,
      }
    } catch {
      return null
    }
  }

  if (/^\d+$/.test(query)) {
    const raw = await kvGet(`wlink:${network}:uid:${query}`, env)
    if (!raw) return null
    try {
      return JSON.parse(raw) as StoredWalletLink
    } catch {
      return null
    }
  }

  const cleanUsername = normalizeTelegramUsername(query)
  if (!/^[a-z0-9_]{3,32}$/.test(cleanUsername)) return null
  const raw = await kvGet(`wlink:${network}:uname:${cleanUsername}`, env)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredWalletLink
  } catch {
    return null
  }
}

export async function getVerifiedWalletVault(
  tgUserId: number,
  env: Env,
): Promise<{
  link: StoredWalletLink | null
  encryptedVaultBundle: string | null
}> {
  const { network } = resolveWorkerNetwork(env)
  const [linkRaw, vaultRaw] = await Promise.all([
    kvGet(`wlink:${network}:uid:${tgUserId}`, env),
    kvGet(`wvault:${network}:uid:${tgUserId}`, env),
  ])
  let link: StoredWalletLink | null = null
  if (linkRaw) {
    try {
      link = JSON.parse(linkRaw) as StoredWalletLink
    } catch {
      link = null
    }
  }
  return { link, encryptedVaultBundle: vaultRaw ?? null }
}
