import { Keypair } from '@stellar/stellar-sdk'
import { describe, expect, it, vi } from 'vitest'
import {
  buildAstroDexMarketUrl,
  buildAstroWalletConnectUrl,
  buildSorobitsMarketplaceUrl,
  getAstroWalletApiBaseUrl,
  resolveAstroWalletIdentity,
} from './ecosystem'
import { astroWalletConnectSigner } from './signer'

describe('ecosystem helpers (AstroWallet SSO & AstroDex)', () => {
  it('builds Telegram deep links when bot usernames are provided', () => {
    expect(
      buildAstroWalletConnectUrl('t-vault', {
        botUsername: '@AstroWalletAppBot',
        shortName: 'wallet',
      }),
    ).toBe('https://t.me/AstroWalletAppBot/wallet?startapp=t-vault')

    expect(
      buildAstroDexMarketUrl({
        pairId: 'CA32TMZ2AODXI7K7B6T2YPZR52HJKFCY5GT2DNHMOL326DLSNPX55BUP',
        botUsername: 'AstroDexBot',
        shortName: 'dex',
      }),
    ).toBe(
      'https://t.me/AstroDexBot/dex?startapp=pair_CA32TMZ2AODXI7K7B6T2YPZR52HJKFCY5GT2DNHMOL326DLSNPX55BUP',
    )

    expect(
      buildAstroDexMarketUrl({
        tokenId: 'CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE',
        botUsername: 'AstroDexBot',
      }),
    ).toBe(
      'https://t.me/AstroDexBot?startapp=token_CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE',
    )
  })

  it('rejects insecure API URLs and resolves valid AstroWallet AstroID responses', async () => {
    expect(getAstroWalletApiBaseUrl('http://evil.example.org')).toBeNull()
    expect(getAstroWalletApiBaseUrl('https://astrowallet.example/')).toBe(
      'https://astrowallet.example',
    )

    const pub = Keypair.random().publicKey()
    const resolved = await resolveAstroWalletIdentity('@astro_pilot', {
      baseUrl: 'https://astrowallet.example',
      fetchFn: async (input) => {
        expect(String(input)).toBe(
          'https://astrowallet.example/v1/identity/resolve?q=astro_pilot',
        )
        return new Response(
          JSON.stringify({
            ok: true,
            found: true,
            username: 'astro_pilot',
            primaryAddress: pub,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      },
    })

    expect(resolved).toEqual({
      address: pub,
      username: 'astro_pilot',
      verifiedTelegram: true,
    })

    const offline = await resolveAstroWalletIdentity('@astro_pilot', {
      baseUrl: 'https://astrowallet.example',
      fetchFn: async () => {
        throw new Error('network down')
      },
    })
    expect(offline).toBeNull()
  })

  it('builds standalone Sorobits Marketplace URLs via HTTPS base or Telegram bot deep link', () => {
    expect(
      buildSorobitsMarketplaceUrl({
        baseUrl: 'https://sorobits.market/',
        tokenId: 42,
      }),
    ).toBe('https://sorobits.market/sorobits/42')

    expect(
      buildSorobitsMarketplaceUrl({
        botUsername: '@AstroMarketBot',
        shortName: 'market',
        tokenId: 7,
      }),
    ).toBe('https://t.me/AstroMarketBot/market?startapp=sorobit_7')

    expect(buildSorobitsMarketplaceUrl({ baseUrl: 'http://evil.example' })).toBeNull()
  })

  it('routes astroWalletConnectSigner through @astrowallet/connect with botUsername, sourceAddress, and xdrSha256', async () => {
    const pub = Keypair.random().publicKey()
    const captured: { app?: { botUsername?: string }; payload?: { sourceAddress?: string; xdrSha256?: string } } = {}
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/v1/wallet/connect/requests') && init?.method === 'POST') {
        const parsed = JSON.parse(String(init.body)) as typeof captured
        captured.app = parsed.app
        captured.payload = parsed.payload
        return new Response(
          JSON.stringify({
            ok: true,
            requestId: 'ac_gate_01',
            network: 'testnet',
            action: 'sign_xdr',
            trustTier: 'official',
            sig: 'a'.repeat(32),
            resultToken: 'rt_gate_01',
            expiresAt: Math.floor(Date.now() / 1000) + 300,
            deepLink: 'https://t.me/AstroWalletAppBot/wallet?startapp=c-ac_gate_01-aaaa',
          }),
          { status: 201, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.endsWith('/api/v1/wallet/connect/requests/ac_gate_01')) {
        return new Response(
          JSON.stringify({
            ok: true,
            requestId: 'ac_gate_01',
            network: 'testnet',
            action: 'sign_xdr',
            status: 'approved',
            trustTier: 'official',
            expiresAt: Math.floor(Date.now() / 1000) + 300,
            result: {
              status: 'approved',
              address: pub,
              signedXdr: 'SIGNED_XDR_BASE64',
              completedAt: Math.floor(Date.now() / 1000),
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('not found', { status: 404 })
    }) as typeof fetch

    try {
      const signer = astroWalletConnectSigner(pub)
      const res = await signer.signTransaction('UNSIGNED_XDR_BASE64', {})
      expect(res.signedTxXdr).toBe('SIGNED_XDR_BASE64')
      expect(res.signerAddress).toBe(pub)
      expect(captured.app?.botUsername).toBe('AstroGateSorobanBot')
      expect(captured.payload?.sourceAddress).toBe(pub)
      expect(captured.payload?.xdrSha256).toMatch(/^[a-f0-9]{64}$/)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
