import { describe, expect, it } from 'vitest'
import { nativeToScVal } from '@stellar/stellar-sdk'
import {
  parseLaunchpadContractEvent,
  renderLaunchpadEventTelegramView,
  routeLaunchpadEventTargets,
} from '../../worker/events'
import { computePilotPerks, computeQuestSummary } from '../../worker/quests'
import {
  buildAccountInspectorView,
  buildHelpView,
  buildInlineMarketResults,
  buildKingOfTheHillView,
  buildLaunchView,
  buildMarketView,
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
      community: true,
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
})
