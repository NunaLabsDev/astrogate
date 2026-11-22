import { Keypair } from '@stellar/stellar-sdk'
import { describe, expect, it } from 'vitest'
import {
  buildAstroDexMarketUrl,
  buildAstroWalletConnectUrl,
  buildSorobitsMarketplaceUrl,
  getAstroWalletApiBaseUrl,
  resolveAstroWalletIdentity,
} from './ecosystem'

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
})
