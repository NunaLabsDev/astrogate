import { describe, expect, it, vi } from 'vitest'
import {
  formatLaunchAlertMessage,
  formatSwapAlertMessage,
  isAlertsConfigured,
  notifySwapAlert,
  notifyTokenLaunch,
  readAlertConfig,
} from './alerts'

describe('alerts helpers', () => {
  it('reads optional config safely and ignores non-https webhooks', () => {
    expect(isAlertsConfigured(readAlertConfig({}))).toBe(false)
    expect(
      readAlertConfig({ VITE_ALERT_WEBHOOK_URL: 'http://insecure.local/hook' }),
    ).toEqual({
      telegramBotToken: undefined,
      telegramChatId: undefined,
      webhookUrl: undefined,
    })

    const cfg = readAlertConfig({
      VITE_TELEGRAM_BOT_TOKEN: 'bot123',
      VITE_TELEGRAM_CHAT_ID: '-100999',
      VITE_ALERT_WEBHOOK_URL: 'https://discord.com/api/webhooks/1/abc',
    })
    expect(isAlertsConfigured(cfg)).toBe(true)
  })

  it('no-ops cleanly without network calls when unconfigured', async () => {
    const fetchMock = vi.fn()
    const res = await notifyTokenLaunch(
      {
        tokenId: 'CTEST123',
        name: 'Astro Doge',
        symbol: 'ADOGE',
        seedXlm: '10',
        creator: 'GTEST123',
      },
      { config: {}, fetchFn: fetchMock as unknown as typeof fetch },
    )
    expect(res).toEqual({ sent: false, channels: [] })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('dispatches formatted launch alert to both Telegram and HTTPS webhook', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const res = await notifyTokenLaunch(
      {
        tokenId: 'CTEST123',
        name: 'Astro Doge',
        symbol: 'ADOGE',
        seedXlm: '25',
        creator: 'GTEST123',
        explorerUrl: 'https://stellar.expert/explorer/testnet/tx/abc',
      },
      {
        config: {
          telegramBotToken: '123:abc',
          telegramChatId: '-1001',
          webhookUrl: 'https://hooks.example.com/astro',
        },
        fetchFn: fetchMock as unknown as typeof fetch,
      },
    )

    expect(res).toEqual({ sent: true, channels: ['telegram', 'webhook'] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.telegram.org/bot123%3Aabc/sendMessage')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://hooks.example.com/astro')

    const msg = formatLaunchAlertMessage({
      tokenId: 'CTEST123',
      name: 'Astro Doge',
      symbol: 'ADOGE',
      seedXlm: '25',
      creator: 'GTEST123',
    })
    expect(msg).toContain('10,000,000 fixed')
    expect(msg).toContain('$ADOGE')
  })

  it('filters routine swaps and swallows alert transport errors silently', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))

    // Routine small swap (<80% graduation, non-whale) triggers nothing
    const routine = await notifySwapAlert(
      {
        tokenId: 'CTEST123',
        symbol: 'ADOGE',
        direction: 'buy',
        xlmAmount: '2',
        tokenAmount: '50000',
        isWhale: false,
        graduationPercent: 12,
      },
      {
        config: { webhookUrl: 'https://hooks.example.com/astro' },
        fetchFn: fetchMock as unknown as typeof fetch,
      },
    )
    expect(routine).toEqual({ sent: false, channels: [] })
    expect(fetchMock).not.toHaveBeenCalled()

    // Whale or graduation swap handles network rejection gracefully
    const gradMsg = formatSwapAlertMessage({
      tokenId: 'CTEST123',
      symbol: 'ADOGE',
      direction: 'buy',
      xlmAmount: '150',
      tokenAmount: '3000000',
      isWhale: true,
      graduationPercent: 85.5,
    })
    expect(gradMsg).toContain('Graduation Watch (85.5%)')

    const failedGracefully = await notifySwapAlert(
      {
        tokenId: 'CTEST123',
        symbol: 'ADOGE',
        direction: 'buy',
        xlmAmount: '150',
        tokenAmount: '3000000',
        isWhale: true,
        graduationPercent: 85.5,
      },
      {
        config: { webhookUrl: 'https://hooks.example.com/astro' },
        fetchFn: fetchMock as unknown as typeof fetch,
      },
    )
    expect(failedGracefully).toEqual({ sent: false, channels: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
