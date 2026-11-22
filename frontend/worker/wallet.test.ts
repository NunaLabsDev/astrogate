import { Keypair } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'
import type { Env } from './types'
import { resolveWalletIdentity } from './wallet'

describe('AstroGate Worker resolveWalletIdentity AstroWallet precedence', () => {
  it('prioritizes Pillar 1 AstroWallet AstroID directory over stale local ASTRO_KV records', async () => {
    const staleKvPub = Keypair.random().publicKey()
    const astroWalletPub = Keypair.random().publicKey()

    const kvStore = new Map<string, string>([
      [
        'wlink:testnet:uid:777888',
        JSON.stringify({
          network: 'testnet',
          username: 'pilot_stale',
          tgUserId: 777888,
          primaryPublicKey: staleKvPub,
          wallets: [staleKvPub],
          verifiedTelegram: true,
          updatedAt: 1_000,
        }),
      ],
    ])

    const env = {
      STELLAR_NETWORK: 'testnet',
      ASTRO_KV: {
        get: async (key: string) => kvStore.get(key) ?? null,
        put: async () => undefined,
        delete: async () => undefined,
      },
      ASTROWALLET: {
        fetch: async (input: RequestInfo | URL) => {
          const url = typeof input === 'string' ? input : input instanceof Request ? input.url : input.toString()
          expect(url).toContain('/v1/identity/resolve?q=777888')
          return new Response(
            JSON.stringify({
              ok: true,
              found: true,
              username: 'pilot_astroid',
              telegramUserId: '777888',
              primaryAddress: astroWalletPub,
              accounts: [{ address: astroWalletPub }],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        },
      },
    } as unknown as Env

    const resolved = await resolveWalletIdentity('777888', env)
    expect(resolved?.primaryPublicKey).toBe(astroWalletPub)
    expect(resolved?.username).toBe('pilot_astroid')
  })

  it('falls back to local ASTRO_KV when AstroWallet binding is absent or misses', async () => {
    const kvPub = Keypair.random().publicKey()
    const kvStore = new Map<string, string>([
      [
        'wlink:testnet:uid:999000',
        JSON.stringify({
          network: 'testnet',
          username: 'legacy_pilot',
          tgUserId: 999000,
          primaryPublicKey: kvPub,
          wallets: [kvPub],
          verifiedTelegram: true,
          updatedAt: 2_000,
        }),
      ],
    ])

    const env = {
      STELLAR_NETWORK: 'testnet',
      ASTRO_KV: {
        get: async (key: string) => kvStore.get(key) ?? null,
        put: async () => undefined,
        delete: async () => undefined,
      },
    } as unknown as Env

    const resolved = await resolveWalletIdentity('999000', env)
    expect(resolved?.primaryPublicKey).toBe(kvPub)
  })
})
