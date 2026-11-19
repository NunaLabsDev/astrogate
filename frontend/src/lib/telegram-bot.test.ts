import { describe, expect, it } from 'vitest'
import { Keypair, nativeToScVal } from '@stellar/stellar-sdk'
import {
  handleWorkerRequest,
  pulseCorsHeaders,
  verifyTelegramInitData,
} from '../../worker/index'
import {
  parseLaunchpadContractEvent,
  renderLaunchpadEventTelegramView,
  routeLaunchpadEventTargets,
} from '../../worker/events'
import {
  answerProtocolQuestion,
  detectScamOrPhishing,
} from '../../worker/ai'
import { buildTelegramLinkMessage } from './hot-wallet/vault'
import { computePilotPerks, computeQuestSummary } from '../../worker/quests'
import { MAINNET_XLM_SAC, resolveWorkerNetwork } from '../../worker/rpc'
import {
  buildAccountInspectorView,
  buildAiAnswerView,
  buildCommunityDigestView,
  buildGroupWelcomeView,
  buildHelpView,
  buildInlineMarketResults,
  buildKingOfTheHillView,
  buildLaunchView,
  buildMarketView,
  buildModerationWarningView,
  buildQuestsView,
  buildRewardsView,
  buildSecretKeyWarningView,
  buildShoutsView,
  buildSorobitsView,
  buildTokenInspectorView,
  buildV42RulesView,
  buildWalletView,
  buildWelcomeView,
  detectStellarAddress,
  detectTickerMention,
  escapeHtml,
  miniAppStartUrl,
  parseCommandAndArg,
  progressBar,
} from '../../worker/views'
import type { InlineKeyboardMarkup } from '../../worker/types'

const SAMPLE_CONTRACT = 'CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE'
const SAMPLE_ACCOUNT = 'GDQT2KMQ5I2EFDK3WG42YBHRIC4B7OXL7K2G3IC2Z6LPTJEEOMXD7NQE'
const SAMPLE_SECRET = 'SCZANGBA5YHTNYVVV4C3U252E2B6P6F5T3U6MM63WBSBZATAQI3EBTQ4'

function assertValidCallbacks(markup: InlineKeyboardMarkup): void {
  for (const row of markup.inline_keyboard) {
    for (const btn of row) {
      if (btn.callback_data) {
        const bytes = new TextEncoder().encode(btn.callback_data).length
        expect(bytes).toBeLessThanOrEqual(64)
      }
    }
  }
}

describe('Telegram bot views & parsers', () => {
  it('parses bot slash commands with optional bot username mention', () => {
    expect(parseCommandAndArg('/start')).toEqual({ command: 'start', arg: '' })
    expect(parseCommandAndArg('/market@AstroGateSorobanBot')).toEqual({
      command: 'market',
      arg: '',
    })
    expect(parseCommandAndArg(`/token ${SAMPLE_CONTRACT}`)).toEqual({
      command: 'token',
      arg: SAMPLE_CONTRACT,
    })
    expect(parseCommandAndArg('hello world')).toEqual({
      command: null,
      arg: '',
    })
  })

  it('detects contract, account, and secret Stellar strings cleanly', () => {
    expect(detectStellarAddress(`check ${SAMPLE_CONTRACT} please`)).toEqual({
      kind: 'contract',
      value: SAMPLE_CONTRACT,
    })
    expect(detectStellarAddress(SAMPLE_ACCOUNT)).toEqual({
      kind: 'account',
      value: SAMPLE_ACCOUNT,
    })
    expect(detectStellarAddress(`oops ${SAMPLE_SECRET}`)).toEqual({
      kind: 'secret',
      value: SAMPLE_SECRET,
    })
    // Secret seed must still be detected even when preceded by a contract/account address
    expect(detectStellarAddress(`check ${SAMPLE_CONTRACT} seed ${SAMPLE_SECRET}`)).toEqual({
      kind: 'secret',
      value: SAMPLE_SECRET,
    })
    expect(detectStellarAddress('just chatting')).toBeNull()
  })

  it('escapes untrusted HTML characters cleanly', () => {
    expect(escapeHtml('<script>alert("x") &</script>')).toBe(
      '&lt;script&gt;alert("x") &amp;&lt;/script&gt;',
    )
  })

  it('renders crisp progress bars clamped to [0, 100]', () => {
    expect(progressBar(-5, 10)).toBe('░░░░░░░░░░')
    expect(progressBar(50, 10)).toBe('▓▓▓▓▓░░░░░')
    expect(progressBar(150, 10)).toBe('▓▓▓▓▓▓▓▓▓▓')
  })

  it('keeps all callback_data payloads strictly <= 64 UTF-8 bytes across all views', () => {
    const views = [
      buildWelcomeView('Ana <script>', 'es'),
      buildWelcomeView('Alex', 'en'),
      buildMarketView(
        [
          {
            id: SAMPLE_CONTRACT,
            name: 'Moon <Rock>',
            symbol: 'MOON',
            graduated: false,
            curveXlmNet: 4_500_000_000n,
            pairId: null,
            reserveXlmStroops: 0n,
          },
          {
            id: SAMPLE_CONTRACT,
            name: 'Astro Test',
            symbol: 'ASTRO',
            graduated: true,
            curveXlmNet: 10_000_000_000n,
            pairId: SAMPLE_CONTRACT,
            reserveXlmStroops: 2_500_000_000n,
          },
        ],
        'es',
      ),
      buildLaunchView('es', undefined, true),
      buildWalletView('en'),
      buildV42RulesView('es'),
      buildHelpView('es'),
      buildTokenInspectorView(
        SAMPLE_CONTRACT,
        {
          tokenId: SAMPLE_CONTRACT,
          name: 'Test <Token>',
          symbol: 'TST',
          decimals: 7,
          totalSupply: 100_000_000_000_000n,
          curve: {
            graduated: false,
            curveXlmNet: 5_000_000_000n,
            realXlmVault: 5_100_000_000n,
            tokensSold: 21_000_000_000_000n,
            buybackXlmReserve: 0n,
            burnVaultRemaining: 29_500_000_000_000n,
            burnMilestoneStage: 0,
            pair: null,
            creator: SAMPLE_ACCOUNT,
          },
          kingShout: {
            sender: SAMPLE_ACCOUNT,
            amount: 50_000_000_000n,
            message: 'LFG <Soroban> & Astro!',
          },
          dexReserveXlm: null,
        },
        'es',
      ),
      buildTokenInspectorView(SAMPLE_CONTRACT, null, 'en'),
      buildAccountInspectorView(
        SAMPLE_ACCOUNT,
        { accountId: SAMPLE_ACCOUNT, funded: true, xlmBalance: '1,234.56', assetCount: 3 },
        'es',
      ),
      buildSecretKeyWarningView('es'),
      buildSecretKeyWarningView('en', undefined, true, true),
      buildKingOfTheHillView(
        [
          {
            id: SAMPLE_CONTRACT,
            name: 'Hill <Coin>',
            symbol: 'HILL',
            graduated: false,
            curveXlmNet: 8_200_000_000n,
            pairId: null,
            reserveXlmStroops: 0n,
          },
        ],
        {
          symbol: 'HILL',
          amount: 50_000_000_000n,
          decimals: 7,
          message: 'Claiming <the> hill!',
          tokenId: SAMPLE_CONTRACT,
        },
        'en',
        undefined,
        true,
      ),
    ]

    for (const view of views) {
      assertValidCallbacks(view.reply_markup)
      expect(view.text).not.toContain('<script>')
    }
  })

  it('uses url deep links instead of web_app buttons when rendering inside groups', () => {
    const groupViews = [
      buildWelcomeView('Alex', 'en', undefined, undefined, true),
      buildMarketView(
        [
          {
            id: SAMPLE_CONTRACT,
            name: 'Astro Test',
            symbol: 'ASTRO',
            graduated: true,
            curveXlmNet: 10_000_000_000n,
            pairId: SAMPLE_CONTRACT,
            reserveXlmStroops: 2_500_000_000n,
          },
        ],
        'en',
        undefined,
        false,
        true,
      ),
      buildKingOfTheHillView([], null, 'en', undefined, true),
      buildHelpView('en', undefined, true),
      buildQuestsView('en', undefined, true),
      buildRewardsView('en', undefined, true),
      buildShoutsView(SAMPLE_CONTRACT, null, 'en', undefined, true),
      buildSorobitsView(undefined, true),
    ]

    for (const view of groupViews) {
      assertValidCallbacks(view.reply_markup)
      expect(view.text).not.toContain('Completa misiones')
      expect(view.text).not.toContain('Programa comunitario')
      if (view.photoUrl) {
        expect(view.text.length).toBeLessThanOrEqual(1024)
      }
      for (const row of view.reply_markup.inline_keyboard) {
        for (const btn of row) {
          expect(btn.web_app).toBeUndefined()
          expect(btn.text).not.toContain('Cambiar a Español')
          expect(btn.text).not.toContain('Inicio')
          if (btn.url && !btn.url.includes('t.me/share/url')) {
            // Group chat links must stay inside Telegram (never external browser URLs)
            expect(btn.url).toContain('https://t.me/')
            expect(btn.url).not.toContain('astrogate.pages.dev')
          }
        }
      }
    }

    const qView = buildQuestsView('en', undefined, true)
    expect(qView.text).toContain('Sorobits')
    expect(qView.text).not.toContain('Pixel Astro')

    const deletedWarn = buildSecretKeyWarningView('en', undefined, true, true)
    expect(deletedWarn.text).toContain('auto-deleted')
    expect(buildWelcomeView('Alex', 'en').text).toContain('Built by NunaLabs')
  })

  it('builds filtered inline query articles with NunaLabs branding and deep links', () => {
    const items = [
      {
        id: SAMPLE_CONTRACT,
        name: 'Astro Test',
        symbol: 'ASTRO',
        graduated: true,
        curveXlmNet: 10_000_000_000n,
        pairId: SAMPLE_CONTRACT,
        reserveXlmStroops: 2_500_000_000n,
      },
      {
        id: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
        name: 'Wave Dog',
        symbol: 'WAVE',
        graduated: false,
        curveXlmNet: 4_000_000_000n,
        pairId: null,
        reserveXlmStroops: 0n,
      },
    ]

    const results = buildInlineMarketResults(items, 'astro')
    expect(results).toHaveLength(1)
    expect(results[0]?.input_message_content.message_text).toContain('Built by NunaLabs')
    expect(results[0]?.reply_markup.inline_keyboard[0]?.[0]?.url).toContain(
      `start=${SAMPLE_CONTRACT}`,
    )
  })

  it('builds group-safe shouts and rewards views with NunaLabs branding', () => {
    const shoutsView = buildShoutsView(
      SAMPLE_CONTRACT,
      {
        tokenId: SAMPLE_CONTRACT,
        name: 'Astro Test',
        symbol: 'ASTRO',
        decimals: 7,
        kingShout: {
          sender: SAMPLE_ACCOUNT,
          amount: 50_000_000_000n,
          message: 'King of the hill <AST>!',
          ledger: 5769911,
        },
        shouts: [
          {
            sender: SAMPLE_ACCOUNT,
            amount: 500_000_000n,
            message: 'Burn-to-Chat live!',
            ledger: 5769910,
          },
        ],
      },
      'en',
      undefined,
      true,
    )
    assertValidCallbacks(shoutsView.reply_markup)
    expect(shoutsView.text).toContain('Built by NunaLabs')
    expect(shoutsView.text).not.toContain('<AST>')
    expect(shoutsView.reply_markup.inline_keyboard[0]?.[0]?.web_app).toBeUndefined()

    const rewardsView = buildRewardsView('en', undefined, true, undefined, {
      accountId: SAMPLE_ACCOUNT,
      funded: true,
      xlmBalance: '500.00',
      assetCount: 2,
    })
    assertValidCallbacks(rewardsView.reply_markup)
    expect(rewardsView.text).toContain('Wallet Verified')
    expect(rewardsView.text).toContain('Built by NunaLabs')
  })

  it('parses, routes, and renders Soroban shout_event for Telegram bridge', () => {
    const parsed = parseLaunchpadContractEvent({
      id: '0024781579045871616-0000000001',
      ledger: 5769911,
      txHash: 'a'.repeat(64),
      topic: [
        nativeToScVal('shout_event', { type: 'symbol' }),
        nativeToScVal(SAMPLE_CONTRACT, { type: 'address' }),
      ],
      value: nativeToScVal({
        amount: 75_000_000_000n,
        is_king: true,
        ledger: 5769911,
        message: 'LFG <Soroban>',
        sender: SAMPLE_ACCOUNT,
      }),
    })

    expect(parsed).not.toBeNull()
    expect(parsed?.kind).toBe('shout')
    if (!parsed) return

    expect(routeLaunchpadEventTargets(parsed)).toEqual({
      feed: true,
      community: false,
    })
    const card = renderLaunchpadEventTelegramView(parsed, {
      symbol: 'ASTRO',
      name: 'Astro Test',
      decimals: 7,
    })
    expect(card.text).toContain('NEW KING SHOUT')
    expect(card.text).toContain('LFG &lt;Soroban&gt;')
    expect(card.text).toContain('Built by NunaLabs')
    expect(card.reply_markup.inline_keyboard[0]?.[0]?.url).toContain(
      `start=${SAMPLE_CONTRACT}`,
    )
  })

  it('routes all automated alerts strictly to Live Feed with anti-spam thresholds and Sorobits support', () => {
    const baseTrade = {
      id: 'ev-1',
      ledger: 123,
      txHash: 'b'.repeat(64),
      tokenId: SAMPLE_CONTRACT,
      trader: SAMPLE_ACCOUNT,
      tokenAmount: 50_000_000_000n,
    }

    // Dust trade (< 2 XLM, < 80% curve) filtered out of Feed
    expect(
      routeLaunchpadEventTargets({
        ...baseTrade,
        kind: 'trade',
        isBuy: true,
        xlmAmount: 10_000_000n,
        curveXlmNet: 1_000_000_000n,
      }),
    ).toEqual({ feed: false, community: false })

    // Normal buy >= 2 XLM and normal sell >= 2 XLM both post ONLY to Feed
    const buyEv = {
      ...baseTrade,
      kind: 'trade' as const,
      isBuy: true,
      xlmAmount: 50_000_000n,
      curveXlmNet: 2_500_000_000n,
    }
    const sellEv = {
      ...baseTrade,
      kind: 'trade' as const,
      isBuy: false,
      xlmAmount: 40_000_000n,
      curveXlmNet: 2_100_000_000n,
    }
    expect(routeLaunchpadEventTargets(buyEv)).toEqual({ feed: true, community: false })
    expect(routeLaunchpadEventTargets(sellEv)).toEqual({ feed: true, community: false })
    expect(
      renderLaunchpadEventTelegramView(sellEv, { symbol: 'ASTRO', name: 'Astro', decimals: 7 })
        .text,
    ).toContain('Curve Sell')

    // Near graduation >= 80% triggers highlighted push alert ONLY in Feed
    const nearGradBuy = {
      ...baseTrade,
      kind: 'trade' as const,
      isBuy: true,
      xlmAmount: 10_000_000n,
      curveXlmNet: 8_500_000_000n,
    }
    expect(routeLaunchpadEventTargets(nearGradBuy)).toEqual({
      feed: true,
      community: false,
    })
    expect(
      renderLaunchpadEventTelegramView(nearGradBuy, {
        symbol: 'ASTRO',
        name: 'Astro',
        decimals: 7,
      }).text,
    ).toContain('Almost Graduated')

    // Graduations, launches, buyback burns, and stage-2 milestones never spam Community
    expect(
      routeLaunchpadEventTargets({
        kind: 'graduated',
        id: 'grad-1',
        ledger: 124,
        tokenId: SAMPLE_CONTRACT,
        pairId: SAMPLE_CONTRACT,
        xlmDeposited: 10_000_000_000n,
        vaultBurned: 14_750_000_000_000n,
      }),
    ).toEqual({ feed: true, community: false })
    expect(
      routeLaunchpadEventTargets({
        kind: 'burn',
        id: 'm1',
        ledger: 124,
        tokenId: SAMPLE_CONTRACT,
        burnKind: 'milestone',
        tokensBurned: 14_750_000_000_000n,
        xlmSpentOrStage: 1n,
      }),
    ).toEqual({ feed: false, community: false })
    expect(
      routeLaunchpadEventTargets({
        kind: 'burn',
        id: 'm2',
        ledger: 200,
        tokenId: SAMPLE_CONTRACT,
        burnKind: 'milestone',
        tokensBurned: 14_750_000_000_000n,
        xlmSpentOrStage: 2n,
      }),
    ).toEqual({ feed: true, community: false })

    // Synthetic E2E smoke shouts stay out of Feed & Community
    expect(
      routeLaunchpadEventTargets({
        kind: 'shout',
        id: 'e2e',
        ledger: 125,
        tokenId: SAMPLE_CONTRACT,
        sender: SAMPLE_ACCOUNT,
        amount: 500_000_000n,
        message: '[Testnet E2E] Curve check 123',
        isKing: false,
      }),
    ).toEqual({ feed: false, community: false })

    // Sorobits minted & rank evolution events parse cleanly and route to Feed
    const sorobitMint = parseLaunchpadContractEvent({
      id: 'sb-1',
      ledger: 300,
      topic: [
        nativeToScVal('sorobit_minted_event', { type: 'symbol' }),
        nativeToScVal(SAMPLE_ACCOUNT, { type: 'address' }),
        nativeToScVal(9, { type: 'u32' }),
      ],
      value: nativeToScVal({
        edition: 3,
        dna: new Uint8Array(32),
        soulbound: true,
      }),
    })
    expect(sorobitMint?.kind).toBe('sorobit_mint')
    if (sorobitMint) {
      expect(routeLaunchpadEventTargets(sorobitMint)).toEqual({
        feed: true,
        community: false,
      })
      const rendered = renderLaunchpadEventTelegramView(sorobitMint, {
        symbol: 'SBIT',
        name: 'Sorobits',
        decimals: 0,
      })
      expect(rendered.text).toContain('SBIT #9')
      expect(rendered.text).toContain('Genesis Archetype #AGQ03')
    }
  })

  it('detects $TICKER mentions cleanly without matching USD amounts', () => {
    expect(detectTickerMention('check $astro now')).toBe('ASTRO')
    expect(detectTickerMention('$DEMO to the moon!')).toBe('DEMO')
    expect(detectTickerMention('worth $50 or $100 today')).toBeNull()
    expect(detectTickerMention('just chatting')).toBeNull()
  })

  it('computes Stellar Quest-style badge unlocks and renders group-safe /quests view', () => {
    const progress = computeQuestSummary({
      accountId: SAMPLE_ACCOUNT,
      funded: true,
      launchedCount: 1,
      shoutCount: 2,
      graduatedCount: 1,
      swapCount: 2,
      assetCount: 1,
      kingBurnCount: 1,
    })
    expect(progress.unlockedCount).toBe(8)
    expect(progress.unlocked).toEqual({
      pioneer: true,
      launcher: true,
      shouter: true,
      graduate: true,
      og: true,
      whale: true,
      phoenix: true,
      legend: true,
    })

    const perks = computePilotPerks(progress)
    expect(perks.chatTitle).toContain('Genesis Legend')
    expect(perks.sprintMultiplier).toBe('2.0x')
    expect(perks.feedPriority).toBe(true)
    expect(perks.vipAlphaAccess).toBe(true)

    const view = buildQuestsView('en', undefined, true, undefined, progress)
    assertValidCallbacks(view.reply_markup)
    expect(view.text).toContain('8/8')
    expect(view.text).toContain('Sprint Boost')
    expect(view.text).toContain('Floodgate Pioneer')
    expect(view.text).toContain('Genesis Legend')
    expect(view.text).toContain('Built by NunaLabs')
    for (const row of view.reply_markup.inline_keyboard) {
      for (const btn of row) {
        expect(btn.web_app).toBeUndefined()
      }
    }
  })

  it('attaches Sorobits visual hero cards and keeps photo captions <= 1024 chars across bot views', () => {
    const sampleMarkets = Array.from({ length: 5 }, (_, idx) => ({
      id: `C${'A'.repeat(54)}${idx}`,
      symbol: `TOK${idx}`,
      name: `Sample Token ${idx}`,
      graduated: idx % 2 === 1,
      curveXlmNet: BigInt((idx + 1) * 150) * 10_000_000n,
      reserveXlmStroops: 2_500_000_000n,
      pairId: null,
    }))
    const fullProgress = {
      ...computeQuestSummary({
        accountId: SAMPLE_ACCOUNT,
        funded: true,
        launchedCount: 1,
        shoutCount: 1,
        graduatedCount: 1,
        swapCount: 1,
        assetCount: 2,
        kingBurnCount: 1,
      }),
      sorobitsBalance: 3,
      sorobitsIds: [0, 1, 2],
    }

    const photoViews = [
      buildWelcomeView('Tester', 'en', undefined, undefined, true),
      buildSorobitsView(undefined, true),
      buildMarketView(sampleMarkets, 'en', undefined, false, true),
      buildKingOfTheHillView(
        sampleMarkets,
        {
          symbol: 'TOK0',
          amount: 50_000_000_000n,
          decimals: 7,
          message: 'Longest king shout test payload!',
          tokenId: SAMPLE_CONTRACT,
        },
        'en',
        undefined,
        true,
      ),
      buildLaunchView('en', undefined, true, true),
      buildWalletView('en', undefined, true),
      buildV42RulesView('en', undefined, true),
      buildHelpView('en', undefined, true),
      buildRewardsView('en', undefined, true, undefined, {
        accountId: SAMPLE_ACCOUNT,
        funded: true,
        xlmBalance: '1000.00',
        assetCount: 3,
      }),
      buildQuestsView('en', undefined, true),
      buildQuestsView('en', undefined, true, undefined, fullProgress),
    ]

    for (const view of photoViews) {
      expect(view.photoUrl).toMatch(/^https:\/\/astrogate\.pages\.dev\/telegram\/.*\.png$/)
      expect(view.text.length).toBeLessThanOrEqual(1024)
      assertValidCallbacks(view.reply_markup)
      for (const row of view.reply_markup.inline_keyboard) {
        for (const btn of row) {
          expect(btn.web_app).toBeUndefined()
          if (btn.url && btn.url.includes('astrogate.pages.dev')) {
            throw new Error(`External pages URL leaked into Telegram button: ${btn.url}`)
          }
        }
      }
    }
  })

  it('prevents AGQ05 Early OG spoofing when ecosystemTokenCount is 0', () => {
    const spoofed = computeQuestSummary({
      accountId: SAMPLE_ACCOUNT,
      funded: true,
      launchedCount: 0,
      shoutCount: 0,
      graduatedCount: 0,
      swapCount: 0,
      assetCount: 12,
      ecosystemTokenCount: 0,
      kingBurnCount: 0,
    })
    expect(spoofed.unlocked.og).toBe(false)
    expect(spoofed.unlocked.pioneer).toBe(true)
  })

  it('enforces worker webhook auth, strict pulse CORS allowlist, and initData HMAC', async () => {
    const badCors = pulseCorsHeaders('https://evil.workers.dev')
    expect(badCors['Access-Control-Allow-Origin']).toBe('https://astrogate.pages.dev')
    expect(badCors.Vary).toBe('Origin')

    const goodCors = pulseCorsHeaders('https://astrogate.pages.dev')
    expect(goodCors['Access-Control-Allow-Origin']).toBe('https://astrogate.pages.dev')

    const env = {
      ASSETS: { fetch: async () => new Response('ok') },
      TELEGRAM_BOT_TOKEN: '123456:test-bot-token',
      TELEGRAM_WEBHOOK_SECRET: 'super-secret-webhook',
    }

    const healthRes = await handleWorkerRequest(
      new Request('https://astrogate-bot.workers.dev/health'),
      env,
    )
    expect(healthRes.status).toBe(200)
    expect(healthRes.headers.get('X-Content-Type-Options')).toBe('nosniff')

    const unauthWebhook = await handleWorkerRequest(
      new Request('https://astrogate-bot.workers.dev/telegram/webhook', {
        method: 'POST',
        body: '{}',
      }),
      env,
    )
    expect(unauthWebhook.status).toBe(401)

    const pulseUnauthorizedOrigin = await handleWorkerRequest(
      new Request('https://astrogate-bot.workers.dev/api/telegram/pulse', {
        method: 'POST',
        headers: { Origin: 'https://attacker.workers.dev', 'Content-Type': 'application/json' },
        body: JSON.stringify({ txHash: 'a'.repeat(64) }),
      }),
      env,
    )
    expect(pulseUnauthorizedOrigin.status).toBe(403)

    // Verify valid HMAC initData passes and tampered initData fails
    const botToken = '123456:test-bot-token'
    const authDate = Math.floor(Date.now() / 1000)
    const enc = new TextEncoder()
    const webAppKey = await crypto.subtle.importKey(
      'raw',
      enc.encode('WebAppData'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const secretKey = await crypto.subtle.sign('HMAC', webAppKey, enc.encode(botToken))
    const signKey = await crypto.subtle.importKey(
      'raw',
      secretKey,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const dataCheck = `auth_date=${authDate}\nuser=${JSON.stringify({ id: 42 })}`
    const sig = await crypto.subtle.sign('HMAC', signKey, enc.encode(dataCheck))
    const hash = Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('')
    const initData = new URLSearchParams({
      auth_date: String(authDate),
      user: JSON.stringify({ id: 42 }),
      hash,
    }).toString()

    expect(await verifyTelegramInitData(initData, botToken)).toBe(true)
    expect(await verifyTelegramInitData(`${initData}tamper`, botToken)).toBe(false)
  })

  it('serves public read-only REST API, OpenAPI spec, and JSON-RPC 2.0 MCP server', async () => {
    const env = {
      ASSETS: { fetch: async () => new Response('ok') },
    }

    const openApiRes = await handleWorkerRequest(
      new Request('https://astrogate-bot.workers.dev/openapi.json'),
      env,
    )
    expect(openApiRes.status).toBe(200)
    expect(openApiRes.headers.get('Access-Control-Allow-Origin')).toBe('*')
    const spec = (await openApiRes.json()) as { openapi: string; paths: Record<string, unknown> }
    expect(spec.openapi).toBe('3.1.0')
    expect(spec.paths['/api/v1/tokens/{id}/audit']).toBeDefined()

    const healthApiRes = await handleWorkerRequest(
      new Request('https://astrogate-bot.workers.dev/api/v1/health'),
      env,
    )
    expect(healthApiRes.status).toBe(200)
    const healthJson = (await healthApiRes.json()) as {
      ok: boolean
      protocol: string
      tokenomics: { graduationTargetXlm: number }
    }
    expect(healthJson.ok).toBe(true)
    expect(healthJson.protocol).toBe('AstroGate')
    expect(healthJson.tokenomics.graduationTargetXlm).toBe(1000)

    const badQuoteRes = await handleWorkerRequest(
      new Request(
        `https://astrogate-bot.workers.dev/api/v1/tokens/${SAMPLE_CONTRACT}/quote?amountIn=abc&direction=buy`,
      ),
      env,
    )
    expect(badQuoteRes.status).toBe(400)

    const mcpInit = await handleWorkerRequest(
      new Request('https://astrogate-bot.workers.dev/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      }),
      env,
    )
    expect(mcpInit.status).toBe(200)
    const initJson = (await mcpInit.json()) as {
      result: { serverInfo: { name: string } }
    }
    expect(initJson.result.serverInfo.name).toBe('astrogate-mcp')

    const mcpTools = await handleWorkerRequest(
      new Request('https://astrogate-bot.workers.dev/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      }),
      env,
    )
    const toolsJson = (await mcpTools.json()) as {
      result: { tools: Array<{ name: string }> }
    }
    expect(toolsJson.result.tools.map((t) => t.name)).toContain('verify_anti_rug')
    expect(toolsJson.result.tools.map((t) => t.name)).toContain('resolve_wallet')

    const mcpCall = await handleWorkerRequest(
      new Request('https://astrogate-bot.workers.dev/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'get_protocol_info', arguments: {} },
        }),
      }),
      env,
    )
    const callJson = (await mcpCall.json()) as {
      result: { content: Array<{ text: string }> }
    }
    const overview = JSON.parse(callJson.result.content[0]?.text ?? '{}') as {
      version: string
    }
    expect(overview.version).toBe('v4.4-fair-flywheel')
  })

  it('stores and serves immutable SHA-256 content-addressed logos and fails closed on mainnet config', async () => {
    const kvStore = new Map<string, string>()
    const env = {
      ASSETS: { fetch: async () => new Response('ok') },
      ASTRO_KV: {
        get: async (k: string) => kvStore.get(k) ?? null,
        put: async (k: string, v: string) => {
          kvStore.set(k, v)
        },
      },
    }

    // Reject non-image bytes with 415
    const badRes = await handleWorkerRequest(
      new Request('https://astrogate.pages.dev/api/v1/logos', {
        method: 'POST',
        body: new TextEncoder().encode('<svg onload="alert(1)"/>'),
      }),
      env,
    )
    expect(badRes.status).toBe(415)

    // Reject PNG polyglot containing embedded <script> tag with 415
    const polyglotBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ...new TextEncoder().encode('<script>alert(1)</script>'),
    ])
    const polyRes = await handleWorkerRequest(
      new Request('https://astrogate.pages.dev/api/v1/logos', {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: polyglotBytes,
      }),
      env,
    )
    expect(polyRes.status).toBe(415)

    // Reject disallowed Origin on logo upload with 403
    const badOriginRes = await handleWorkerRequest(
      new Request('https://astrogate.pages.dev/api/v1/logos', {
        method: 'POST',
        headers: { Origin: 'https://evil-phishing.example' },
        body: new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      }),
      env,
    )
    expect(badOriginRes.status).toBe(403)

    // Store valid WebP header bytes and retrieve by immutable SHA-256 URL
    const webpBytes = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      0x56, 0x50, 0x38, 0x20,
    ])
    const uploadRes = await handleWorkerRequest(
      new Request('https://astrogate.pages.dev/api/v1/logos', {
        method: 'POST',
        headers: { 'Content-Type': 'image/webp' },
        body: webpBytes,
      }),
      env,
    )
    expect(uploadRes.status).toBe(200)
    const uploaded = (await uploadRes.json()) as { ok: boolean; sha256: string; url: string }
    expect(uploaded.ok).toBe(true)
    expect(uploaded.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(uploaded.url).toBe(`https://astrogate.pages.dev/api/v1/logos/${uploaded.sha256}.webp`)
    expect(kvStore.has(`logo:${uploaded.sha256}`)).toBe(true)

    const getRes = await handleWorkerRequest(new Request(uploaded.url), env)
    expect(getRes.status).toBe(200)
    expect(getRes.headers.get('Content-Type')).toBe('image/webp')
    expect(getRes.headers.get('Cache-Control')).toContain('immutable')
    expect(getRes.headers.get('Content-Security-Policy')).toContain("default-src 'none'")

    // Mainnet fail-closed check: never silently leaks testnet contract IDs
    const mainnetCfg = resolveWorkerNetwork({
      ...env,
      STELLAR_NETWORK: 'mainnet',
    })
    expect(mainnetCfg.xlmSac).toBe(MAINNET_XLM_SAC)
    expect(mainnetCfg.launchpadContractId).toBe('')
    expect(mainnetCfg.soroswapRouter).toBe('')

    // Mainnet dynamic stellar.toml
    const tomlRes = await handleWorkerRequest(
      new Request('https://astrogate.pages.dev/.well-known/stellar.toml'),
      {
        ...env,
        STELLAR_NETWORK: 'mainnet',
        DEVELOPER_TREASURY_ADDRESS: SAMPLE_ACCOUNT,
      },
    )
    expect(tomlRes.status).toBe(200)
    const tomlText = await tomlRes.text()
    expect(tomlText).toContain('Public Global Stellar Network ; September 2015')
    expect(tomlText).toContain(SAMPLE_ACCOUNT)
  })

  it('runs anti-scam moderation, AI copilot fallback/KV budget, and community welcome/digest views strictly in English', async () => {
    expect(detectScamOrPhishing('Click here to claim airdrop and validate your wallet')).toEqual({
      flagged: true,
      reason: 'scam_phrase',
    })
    expect(detectScamOrPhishing('Check this https://bit.ly/free-xlm')).toEqual({
      flagged: true,
      reason: 'phishing_link',
    })
    expect(detectScamOrPhishing('Check $ASTRO on https://t.me/AstroGateFeed!')).toEqual({
      flagged: false,
    })

    // Deterministic fallback when AI binding is absent
    const fallback = await answerProtocolQuestion('how do I launch a token?', 101, {
      ASSETS: { fetch: async () => new Response('ok') },
    })
    expect(fallback.poweredByAi).toBe(false)
    expect(fallback.answer).toContain('7 XLM')

    // AI binding + KV budget check + astrogate.pages.dev sanitization
    const kv = new Map<string, string>()
    const aiRes = await answerProtocolQuestion('explain Sorobits', 202, {
      ASSETS: { fetch: async () => new Response('ok') },
      ASTRO_KV: {
        get: async (k) => kv.get(k) ?? null,
        put: async (k, v) => {
          kv.set(k, v)
        },
      },
      AI: {
        run: async () => ({
          response: '<b>Sorobits</b> are 100% on-chain 32x32 SVG NFTs on Soroban.',
        }),
      },
    })
    expect(aiRes.poweredByAi).toBe(true)
    expect(aiRes.answer).not.toContain('<b>')
    expect(aiRes.answer).toContain('Sorobits')

    // Deep-link switching between ?start= and ?startapp= (Main Mini App)
    expect(miniAppStartUrl('AstroGateSorobanBot', 'market', false)).toBe(
      'https://t.me/AstroGateSorobanBot?start=market',
    )
    expect(miniAppStartUrl('AstroGateSorobanBot', 'market', true)).toBe(
      'https://t.me/AstroGateSorobanBot?startapp=market',
    )

    const extraViews = [
      buildGroupWelcomeView('Alex', 'AstroGateSorobanBot', 'https://t.me/addlist/sample', true),
      buildCommunityDigestView(
        [
          {
            id: SAMPLE_CONTRACT,
            name: 'Astro Test',
            symbol: 'ASTRO',
            graduated: false,
            curveXlmNet: 8_500_000_000n,
            pairId: null,
            reserveXlmStroops: 0n,
          },
        ],
        4,
        'AstroGateSorobanBot',
        'https://t.me/addlist/sample',
        true,
      ),
      buildAiAnswerView(aiRes.answer, true, undefined, true),
      buildModerationWarningView('scam_phrase', true),
    ]

    for (const v of extraViews) {
      assertValidCallbacks(v.reply_markup)
      for (const row of v.reply_markup.inline_keyboard) {
        for (const btn of row) {
          expect(btn.web_app).toBeUndefined()
          if (btn.url) expect(btn.url).not.toContain('astrogate.pages.dev')
        }
      }
    }
  })

  it('deduplicates Market quick-trade symbols, renders DEX-only graduated tokens cleanly, and keeps Home nav on King of the Hill', () => {
    const dedupMarket = buildMarketView(
      [
        {
          id: SAMPLE_CONTRACT,
          name: 'Demo One',
          symbol: 'DEMO',
          graduated: false,
          curveXlmNet: 1_000_000_000n,
          pairId: null,
          reserveXlmStroops: 0n,
        },
        {
          id: 'CD222222222222222222222222222222222222222222222222222222',
          name: 'Demo Two',
          symbol: 'DEMO',
          graduated: false,
          curveXlmNet: 500_000_000n,
          pairId: null,
          reserveXlmStroops: 0n,
        },
        {
          id: 'CD333333333333333333333333333333333333333333333333333333',
          name: 'AstroToken',
          symbol: 'ASTRO',
          graduated: true,
          curveXlmNet: 0n,
          pairId: 'CA32TMZ2AODXI7K7B6T2YPZR52HJKFCY5GT2DNHMOL326DLSNPX55BUP',
          reserveXlmStroops: 4_431_659_944n,
        },
      ],
      'en',
      'https://astrogate.pages.dev',
      false,
      false,
      'AstroGateSorobanBot',
      false,
    )
    const quickTradeLabels = dedupMarket.reply_markup.inline_keyboard[0]!.map((b) => b.text)
    expect(quickTradeLabels).toEqual(['⚡ $DEMO', '🎓 $ASTRO'])

    const astroInspector = buildTokenInspectorView(
      SAMPLE_CONTRACT,
      {
        tokenId: SAMPLE_CONTRACT,
        name: 'Astro',
        symbol: 'ASTRO',
        decimals: 7,
        totalSupply: 10_000_000_000_000_000n,
        curve: null,
        kingShout: null,
        dexReserveXlm: 4_431_659_944n,
      },
      'en',
      'https://astrogate.pages.dev',
      false,
      'AstroGateSorobanBot',
      false,
    )
    expect(astroInspector.text).toContain('🎓 <b>$ASTRO</b>')
    expect(astroInspector.text).toContain('Active on Soroswap DEX')

    const koth = buildKingOfTheHillView(
      [],
      null,
      'en',
      'https://astrogate.pages.dev',
      false,
      'AstroGateSorobanBot',
      false,
    )
    assertValidCallbacks(koth.reply_markup)
    const allCbData = koth.reply_markup.inline_keyboard
      .flat()
      .map((b) => b.callback_data)
      .filter(Boolean)
    expect(allCbData).toContain('nav:mkt:e')
    expect(allCbData).toContain('nav:home:e')
  })

  it('simulates full group moderation, welcome dedup, edited_message scam checks, Q&A, and photo<->text callback navigation', async () => {
    const kv = new Map<string, string>()
    const tgCalls: Array<{ method: string; body: Record<string, unknown> }> = []
    const originalFetch = globalThis.fetch

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (urlStr.startsWith('https://api.telegram.org/')) {
        const method = urlStr.split('/').pop() ?? ''
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
        tgCalls.push({ method, body })
        return Response.json({ ok: true, result: { message_id: 900 + tgCalls.length } })
      }
      return Response.json({ jsonrpc: '2.0', id: 1, result: { entries: [] } })
    }) as typeof fetch

    try {
      const webhookSecret = 'test-webhook-secret'
      const env = {
        ASSETS: { fetch: async () => new Response('ok') },
        ASTRO_KV: {
          get: async (k: string) => kv.get(k) ?? null,
          put: async (k: string, v: string) => {
            kv.set(k, v)
          },
        },
        AI: {
          run: async () => ({
            response: 'Fair-Flywheel v4.4 graduates curves at 1,000 XLM and locks 100% LP for 7 years on-chain.',
          }),
        },
        TELEGRAM_BOT_TOKEN: '123456:TEST_TOKEN',
        TELEGRAM_WEBHOOK_SECRET: webhookSecret,
        TELEGRAM_BOT_USERNAME: 'AstroGateSorobanBot',
        TELEGRAM_COMMUNITY_CHAT_ID: '-1001625368092',
        TELEGRAM_FEED_CHAT_ID: '-1003912502880',
        TELEGRAM_FOLDER_URL: 'https://t.me/addlist/dyMTkV2uU6hmYzE0',
      }

      const sendWebhook = (update: Record<string, unknown>) =>
        handleWorkerRequest(
          new Request('https://astrogate-stellar.workers.dev/telegram/webhook', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Telegram-Bot-Api-Secret-Token': webhookSecret,
            },
            body: JSON.stringify(update),
          }),
          env,
        )

      // 1. Unauthorized secret fails closed (401)
      const unauth = await handleWorkerRequest(
        new Request('https://astrogate-stellar.workers.dev/telegram/webhook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ update_id: 1 }),
        }),
        env,
      )
      expect(unauth.status).toBe(401)

      // 2. New member joins @AstroGateCommunity -> welcome sent once, deduped on repeat
      const joinUpdate = {
        update_id: 10,
        chat_member: {
          chat: { id: -1001625368092, type: 'supergroup' },
          old_chat_member: { user: { id: 555, first_name: 'Alice', is_bot: false }, status: 'left' },
          new_chat_member: { user: { id: 555, first_name: 'Alice', is_bot: false }, status: 'member' },
        },
      }
      expect((await sendWebhook(joinUpdate)).status).toBe(200)
      expect((await sendWebhook({ ...joinUpdate, update_id: 11 })).status).toBe(200)
      expect(tgCalls).toHaveLength(1)
      expect(['sendPhoto', 'sendMessage']).toContain(tgCalls[0]?.method)
      expect(JSON.stringify(tgCalls[0]?.body)).toContain('t.me/addlist/dyMTkV2uU6hmYzE0')

      // 3. User accidentally pastes a Stellar S... secret key in edited_message -> deleted + warned
      tgCalls.length = 0
      const randomSecret = Keypair.random().secret()
      await sendWebhook({
        update_id: 12,
        edited_message: {
          message_id: 401,
          chat: { id: -1001625368092, type: 'supergroup' },
          from: { id: 556, first_name: 'Bob', is_bot: false },
          text: `oops is this my wallet ${randomSecret}`,
        },
      })
      expect(tgCalls.map((c) => c.method)).toContain('deleteMessage')
      const warnCall = tgCalls.find((c) => c.method === 'sendMessage' || c.method === 'sendPhoto')
      expect(warnCall).toBeDefined()
      expect(JSON.stringify(warnCall?.body)).not.toContain(randomSecret)

      // 4. Spammer edits message to drop phishing link -> deleted + moderated
      tgCalls.length = 0
      await sendWebhook({
        update_id: 13,
        edited_message: {
          message_id: 402,
          chat: { id: -1001625368092, type: 'supergroup' },
          from: { id: 557, first_name: 'Spam', is_bot: false },
          text: 'Claim urgent airdrop now at http://bit.ly/drain-wallet',
        },
      })
      expect(tgCalls.map((c) => c.method)).toContain('deleteMessage')
      expect(JSON.stringify(tgCalls)).not.toContain('AI Assistant')

      // 5. Group member mentions @AstroGateSorobanBot with a protocol question -> replies cleanly
      tgCalls.length = 0
      await sendWebhook({
        update_id: 14,
        message: {
          message_id: 403,
          chat: { id: -1001625368092, type: 'supergroup' },
          from: { id: 558, first_name: 'Carol', is_bot: false },
          text: '@AstroGateSorobanBot how does Fair-Flywheel v4.4 work?',
        },
      })
      const qaCall = tgCalls.find((c) => c.method === 'sendMessage')
      expect(qaCall).toBeDefined()
      expect(String(qaCall?.body.text)).toContain('AstroGate Assistant')
      expect(String(qaCall?.body.text)).toContain('1,000 XLM')

      // 6. Callback navigation from text-only message -> photo view sends new card & deletes old text message
      tgCalls.length = 0
      await sendWebhook({
        update_id: 15,
        callback_query: {
          id: 'cb-nav-koth',
          from: { id: 700, first_name: 'Trader', is_bot: false },
          data: 'nav:koth:e',
          message: {
            message_id: 800,
            chat: { id: 700, type: 'private' },
            text: 'Previous text-only token view',
          },
        },
      })
      expect(tgCalls.map((c) => c.method)).toContain('answerCallbackQuery')
      expect(tgCalls.map((c) => c.method)).toContain('sendPhoto')
      expect(tgCalls.map((c) => c.method)).toContain('deleteMessage')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('links, verifies anti-replay, resolves @username, syncs encrypted vault, and serves /wallet @user in bot', async () => {
    const kvStore = new Map<string, string>()
    const botToken = '987654:wallet-link-token'
    const webhookSecret = 'whsec-wallet-test'
    const env = {
      ASSETS: { fetch: async () => new Response('ok') },
      ASTRO_KV: {
        get: async (k: string) => kvStore.get(k) ?? null,
        put: async (k: string, v: string) => {
          kvStore.set(k, v)
        },
      },
      TELEGRAM_BOT_TOKEN: botToken,
      TELEGRAM_WEBHOOK_SECRET: webhookSecret,
      TELEGRAM_BOT_USERNAME: 'AstroGateSorobanBot',
    }

    async function makeInitData(userObj: Record<string, unknown>, authDate: number) {
      const enc = new TextEncoder()
      const webAppKey = await crypto.subtle.importKey(
        'raw',
        enc.encode('WebAppData'),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      const secretKey = await crypto.subtle.sign('HMAC', webAppKey, enc.encode(botToken))
      const signKey = await crypto.subtle.importKey(
        'raw',
        secretKey,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      )
      const userStr = JSON.stringify(userObj)
      const checkStr = `auth_date=${authDate}\nuser=${userStr}`
      const sig = await crypto.subtle.sign('HMAC', signKey, enc.encode(checkStr))
      const hash = Array.from(new Uint8Array(sig), (b) =>
        b.toString(16).padStart(2, '0'),
      ).join('')
      return new URLSearchParams({
        auth_date: String(authDate),
        user: userStr,
        hash,
      }).toString()
    }

    const kp1 = Keypair.random()
    const kp2 = Keypair.random()
    const nowSec = Math.floor(Date.now() / 1000)
    const initData = await makeInitData(
      { id: 9001, username: 'AliceStellar', first_name: 'Alice' },
      nowSec,
    )
    const wallets = [kp1.publicKey(), kp2.publicKey()]
    const msg = buildTelegramLinkMessage({
      network: 'testnet',
      tgUserId: 9001,
      username: 'alicestellar',
      primaryPublicKey: kp2.publicKey(),
      wallets,
      timestamp: nowSec,
    })
    const sigHex = Array.from(kp2.sign(new TextEncoder().encode(msg)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('')
    const sig1Hex = Array.from(kp1.sign(new TextEncoder().encode(msg)), (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('')
    const walletSignatures = {
      [kp1.publicKey()]: sig1Hex,
      [kp2.publicKey()]: sigHex,
    }
    const fakeBundle =
      'AGVAULT1:' +
      Buffer.from(
        JSON.stringify({ v: 1, wallets: [{ meta: { id: 'a1' } }] }),
        'utf8',
      ).toString('base64')

    // 0a. Spoofed tgUserId > 0 without X-Telegram-Init-Data is rejected (401)
    const spoofedTgRes = await handleWorkerRequest(
      new Request('https://astrogate-bot.workers.dev/api/v1/wallet/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'alicestellar',
          tgUserId: 9001,
          primaryPublicKey: kp2.publicKey(),
          wallets,
          timestamp: nowSec,
          signatureHex: sigHex,
          walletSignatures,
        }),
      }),
      env,
    )
    expect(spoofedTgRes.status).toBe(401)

    // 0b. Missing secondary wallet signature in walletSignatures is rejected (401)
    const missingSubSigRes = await handleWorkerRequest(
      new Request('https://astrogate-bot.workers.dev/api/v1/wallet/link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Init-Data': initData,
        },
        body: JSON.stringify({
          username: '@AliceStellar',
          tgUserId: 9001,
          primaryPublicKey: kp2.publicKey(),
          wallets,
          timestamp: nowSec,
          signatureHex: sigHex,
          walletSignatures: { [kp2.publicKey()]: sigHex },
        }),
      }),
      env,
    )
    expect(missingSubSigRes.status).toBe(401)

    // 1. Link with verified Telegram initData + Ed25519 multi-wallet signatures + encrypted bundle
    const linkRes = await handleWorkerRequest(
      new Request('https://astrogate-bot.workers.dev/api/v1/wallet/link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Init-Data': initData,
        },
        body: JSON.stringify({
          username: '@AliceStellar',
          tgUserId: 9001,
          primaryPublicKey: kp2.publicKey(),
          wallets,
          timestamp: nowSec,
          signatureHex: sigHex,
          walletSignatures,
          encryptedVaultBundle: fakeBundle,
        }),
      }),
      env,
    )
    expect(linkRes.status).toBe(200)
    const linkJson = (await linkRes.json()) as {
      ok: boolean
      link: { username: string; primaryPublicKey: string; verifiedTelegram: boolean }
    }
    expect(linkJson.ok).toBe(true)
    expect(linkJson.link.username).toBe('alicestellar')
    expect(linkJson.link.primaryPublicKey).toBe(kp2.publicKey())
    expect(linkJson.link.verifiedTelegram).toBe(true)

    // 2. Replaying the exact same signature is rejected (409)
    const replayRes = await handleWorkerRequest(
      new Request('https://astrogate-bot.workers.dev/api/v1/wallet/link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Telegram-Init-Data': initData,
        },
        body: JSON.stringify({
          username: '@AliceStellar',
          tgUserId: 9001,
          primaryPublicKey: kp2.publicKey(),
          wallets,
          timestamp: nowSec,
          signatureHex: sigHex,
          walletSignatures,
        }),
      }),
      env,
    )
    expect(replayRes.status).toBe(409)

    // 3. Another unverified wallet cannot hijack an already verified @username
    const attackerKp = Keypair.random()
    const attackMsg = buildTelegramLinkMessage({
      network: 'testnet',
      tgUserId: 0,
      username: 'alicestellar',
      primaryPublicKey: attackerKp.publicKey(),
      wallets: [attackerKp.publicKey()],
      timestamp: nowSec,
    })
    const attackSig = Array.from(
      attackerKp.sign(new TextEncoder().encode(attackMsg)),
      (b) => b.toString(16).padStart(2, '0'),
    ).join('')
    const hijackRes = await handleWorkerRequest(
      new Request('https://astrogate-bot.workers.dev/api/v1/wallet/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: 'alicestellar',
          tgUserId: 0,
          primaryPublicKey: attackerKp.publicKey(),
          wallets: [attackerKp.publicKey()],
          timestamp: nowSec,
          signatureHex: attackSig,
        }),
      }),
      env,
    )
    expect(hijackRes.status).toBe(403)

    // 4. Resolve by @username and by sub-wallet G... (never leaks encryptedVaultBundle)
    const resolveByName = await handleWorkerRequest(
      new Request(
        'https://astrogate-bot.workers.dev/api/v1/wallet/resolve?q=%40AliceStellar',
      ),
      env,
    )
    expect(resolveByName.status).toBe(200)
    const resolvedJson = (await resolveByName.json()) as {
      ok: boolean
      found: boolean
      primaryPublicKey: string
      wallets: string[]
      encryptedVaultBundle?: string
    }
    expect(resolvedJson.found).toBe(true)
    expect(resolvedJson.primaryPublicKey).toBe(kp2.publicKey())
    expect(resolvedJson.wallets).toHaveLength(2)
    expect(resolvedJson.encryptedVaultBundle).toBeUndefined()

    const resolveByPk = await handleWorkerRequest(
      new Request(
        `https://astrogate-bot.workers.dev/api/v1/wallet/resolve?q=${kp1.publicKey()}`,
      ),
      env,
    )
    expect(resolveByPk.status).toBe(200)
    const resolvedByPkJson = (await resolveByPk.json()) as {
      primaryPublicKey: string
      username: string
    }
    expect(resolvedByPkJson.username).toBe('alicestellar')
    expect(resolvedByPkJson.primaryPublicKey).toBe(kp2.publicKey())

    // 5. Fetch synced encrypted vault requires valid initData
    const unauthVault = await handleWorkerRequest(
      new Request('https://astrogate-bot.workers.dev/api/v1/wallet/vault'),
      env,
    )
    expect(unauthVault.status).toBe(401)

    const authVault = await handleWorkerRequest(
      new Request('https://astrogate-bot.workers.dev/api/v1/wallet/vault', {
        headers: { 'X-Telegram-Init-Data': initData },
      }),
      env,
    )
    expect(authVault.status).toBe(200)
    const vaultJson = (await authVault.json()) as {
      ok: boolean
      encryptedVaultBundle: string | null
    }
    expect(vaultJson.encryptedVaultBundle).toBe(fakeBundle)

    // 6. Bot /wallet @alicestellar command renders English view with internal TG link
    const tgCalls: Array<{ method: string; body: Record<string, unknown> }> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input)
      const method = u.split('/').pop() ?? ''
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
      tgCalls.push({ method, body })
      return new Response(JSON.stringify({ ok: true, result: { message_id: 99 } }), {
        status: 200,
      })
    }) as typeof fetch

    try {
      await handleWorkerRequest(
        new Request('https://astrogate-bot.workers.dev/telegram/webhook', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Telegram-Bot-Api-Secret-Token': webhookSecret,
          },
          body: JSON.stringify({
            update_id: 99,
            message: {
              message_id: 500,
              chat: { id: -1001625368092, type: 'supergroup' },
              from: { id: 123, first_name: 'Bob', is_bot: false },
              text: '/wallet @alicestellar',
            },
          }),
        }),
        env,
      )
      const sendCall = tgCalls.find((c) => c.method === 'sendMessage')
      expect(sendCall).toBeDefined()
      const payloadStr = JSON.stringify(sendCall?.body)
      expect(payloadStr).toContain('@alicestellar')
      expect(payloadStr).toContain(kp2.publicKey())
      expect(payloadStr).toContain('t.me/AstroGateSorobanBot?start=wallet')
      expect(payloadStr).not.toContain('astrogate.pages.dev')
    } finally {
      globalThis.fetch = originalFetch
    }

    // 7. MCP resolve_wallet tool resolves @alicestellar via JSON-RPC 2.0
    const mcpResolve = await handleWorkerRequest(
      new Request('https://astrogate-bot.workers.dev/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 77,
          method: 'tools/call',
          params: {
            name: 'resolve_wallet',
            arguments: { query: '@alicestellar' },
          },
        }),
      }),
      env,
    )
    expect(mcpResolve.status).toBe(200)
    const mcpResolveJson = (await mcpResolve.json()) as {
      result: { content: Array<{ text: string }> }
    }
    const mcpResolved = JSON.parse(mcpResolveJson.result.content[0]?.text ?? '{}') as {
      primaryPublicKey: string
      verifiedTelegram: boolean
    }
    expect(mcpResolved.primaryPublicKey).toBe(kp2.publicKey())
    expect(mcpResolved.verifiedTelegram).toBe(true)
  })

  it('handles slash commands across DM & groups cleanly, ignores other bots, retries thread 400 errors, and formats 100% graduating buys', async () => {
    const tgCalls: Array<{ method: string; body: Record<string, unknown> }> = []
    const originalFetch = globalThis.fetch
    let failFirstThreadSend = true

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (urlStr.startsWith('https://api.telegram.org/')) {
        const method = urlStr.split('/').pop() ?? ''
        const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
        tgCalls.push({ method, body })
        if ((method === 'sendPhoto' || method === 'sendMessage') && failFirstThreadSend && body.message_thread_id === 999) {
          if (method === 'sendMessage') failFirstThreadSend = false
          return new Response(
            JSON.stringify({ ok: false, error_code: 400, description: 'Bad Request: message thread not found' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          )
        }
        return Response.json({ ok: true, result: { message_id: 700 + tgCalls.length } })
      }
      if (urlStr.includes('/accounts/')) {
        return Response.json({
          id: SAMPLE_ACCOUNT,
          balances: [{ asset_type: 'native', balance: '123.4500000' }],
        })
      }
      return Response.json({ jsonrpc: '2.0', id: 1, result: { entries: [] } })
    }) as typeof fetch

    try {
      const webhookSecret = 'test-webhook-secret-2'
      const env = {
        ASSETS: { fetch: async () => new Response('ok') },
        TELEGRAM_BOT_TOKEN: '123456:TEST_TOKEN_2',
        TELEGRAM_WEBHOOK_SECRET: webhookSecret,
        TELEGRAM_BOT_USERNAME: 'AstroGateSorobanBot',
      }

      const sendWebhook = (update: Record<string, unknown>) =>
        handleWorkerRequest(
          new Request('https://astrogate.pages.dev/telegram/webhook', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Telegram-Bot-Api-Secret-Token': webhookSecret,
            },
            body: JSON.stringify(update),
          }),
          env,
        )

      // 1. Command directed at another bot in group is ignored
      await sendWebhook({
        update_id: 201,
        message: {
          message_id: 1,
          chat: { id: -1001625368092, type: 'supergroup' },
          from: { id: 10, first_name: 'Ana', is_bot: false },
          text: '/help@SomeOtherBot',
        },
      })
      expect(tgCalls).toHaveLength(0)

      // 2. Topic message whose thread_id returns 400 falls back cleanly without message_thread_id
      await sendWebhook({
        update_id: 202,
        message: {
          message_id: 2,
          message_thread_id: 999,
          is_topic_message: true,
          chat: { id: -1001625368092, type: 'supergroup' },
          from: { id: 10, first_name: 'Ana', is_bot: false },
          text: '/unknowncmd@AstroGateSorobanBot',
        },
      })
      const sendMsgCalls = tgCalls.filter((c) => c.method === 'sendMessage')
      expect(sendMsgCalls.length).toBeGreaterThanOrEqual(2)
      expect(sendMsgCalls[0]?.body.message_thread_id).toBe(999)
      expect(sendMsgCalls[1]?.body.message_thread_id).toBeUndefined()
      expect(String(sendMsgCalls[1]?.body.text)).toContain('Commands')

      // 3. /wallet GA... falls back to Horizon Account Inspector when address is not linked
      tgCalls.length = 0
      await sendWebhook({
        update_id: 203,
        message: {
          message_id: 3,
          chat: { id: 777, type: 'private' },
          from: { id: 777, first_name: 'DmUser', is_bot: false },
          text: `/wallet ${SAMPLE_ACCOUNT}`,
        },
      })
      const acctCall = tgCalls.find((c) => c.method === 'sendMessage')
      expect(String(acctCall?.body.text)).toContain('123.45 XLM')

      // 4. 100% graduating curve buy renders cleanly without "Only 0.0 XLM left"
      const gradTradeView = renderLaunchpadEventTelegramView(
        {
          kind: 'trade',
          id: 'ev-grad-buy',
          ledger: 999,
          txHash: 'c'.repeat(64),
          tokenId: SAMPLE_CONTRACT,
          trader: SAMPLE_ACCOUNT,
          isBuy: true,
          xlmAmount: 240_000_000n,
          tokenAmount: 800_000_000_000n,
          curveXlmNet: 10_000_000_000n,
        },
        { symbol: 'HEY', name: 'Hey', decimals: 7 },
      )
      expect(gradTradeView.text).toContain('Graduating Curve Buy (100.0%)')
      expect(gradTradeView.text).not.toContain('Only <code>0.0 XLM</code> left')

      // 5. MCP JSON-RPC batch > 10 is rejected with -32600
      const oversizedBatch = Array.from({ length: 11 }, (_, idx) => ({
        jsonrpc: '2.0',
        id: idx,
        method: 'tools/list',
      }))
      const batchRes = await handleWorkerRequest(
        new Request('https://astrogate.pages.dev/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(oversizedBatch),
        }),
        env,
      )
      expect(batchRes.status).toBe(400)
      const batchJson = (await batchRes.json()) as { error?: { code?: number } }
      expect(batchJson.error?.code).toBe(-32600)

      // 6. /api/telegram/pulse deduplicates repeated txHash via KV
      const pulseKv = new Map<string, string>([
        [`pulse:tx:${'d'.repeat(64)}`, '1'],
      ])
      const pulseEnv = {
        ...env,
        ASTRO_KV: {
          get: async (key: string) => pulseKv.get(key) ?? null,
          put: async (key: string, value: string) => {
            pulseKv.set(key, value)
          },
          delete: async (key: string) => {
            pulseKv.delete(key)
          },
          list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
        },
      }
      const dedupPulseRes = await handleWorkerRequest(
        new Request('https://astrogate.pages.dev/api/telegram/pulse', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: 'https://astrogate.pages.dev',
          },
          body: JSON.stringify({ txHash: 'd'.repeat(64) }),
        }),
        pulseEnv,
      )
      expect(dedupPulseRes.status).toBe(200)
      const dedupJson = (await dedupPulseRes.json()) as {
        ok: boolean
        deduplicated?: boolean
      }
      expect(dedupJson.ok).toBe(true)
      expect(dedupJson.deduplicated).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
