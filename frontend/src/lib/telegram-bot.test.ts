import { describe, expect, it } from 'vitest'
import {
  buildAccountInspectorView,
  buildHelpView,
  buildLaunchView,
  buildMarketView,
  buildSecretKeyWarningView,
  buildTokenInspectorView,
  buildV42RulesView,
  buildWalletView,
  buildWelcomeView,
  detectStellarAddress,
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
    ]

    for (const view of views) {
      assertValidCallbacks(view.reply_markup)
      expect(view.text).not.toContain('<script>')
    }
  })
})
