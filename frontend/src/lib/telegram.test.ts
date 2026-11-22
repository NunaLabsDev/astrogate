import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildTelegramDeepLinkForPath,
  getTelegramInitDataRaw,
  getTelegramWebApp,
  initTelegramMiniApp,
  isTelegramCloudAvailable,
  readTelegramStartParam,
  syncTelegramBackButton,
  telegramCloudGetItems,
  telegramCloudSetItem,
  triggerTelegramHaptic,
  verifyTelegramSession,
} from './telegram'

const originalFetch = globalThis.fetch

afterEach(() => {
  delete (globalThis as { window?: { Telegram?: unknown } }).window
  globalThis.fetch = originalFetch
})

describe('telegram mini app bridge', () => {
  it('hace fallback seguro en navegador normal o SSR sin window.Telegram', () => {
    expect(getTelegramWebApp()).toBeNull()
    const init = initTelegramMiniApp()
    expect(init.info.isMiniApp).toBe(false)
    expect(init.info.platform).toBe('web')
    init.cleanup()

    const cleanupBack = syncTelegramBackButton(true, vi.fn())
    cleanupBack()
    expect(() => triggerTelegramHaptic('success')).not.toThrow()
  })

  it('inicializa ready/expand, sincroniza BackButton y dispara hápticos dentro de Telegram', () => {
    const ready = vi.fn()
    const expand = vi.fn()
    const disableVerticalSwipes = vi.fn()
    const setHeaderColor = vi.fn()
    const setBackgroundColor = vi.fn()
    const show = vi.fn()
    const hide = vi.fn()
    const onClick = vi.fn()
    const offClick = vi.fn()
    const impactOccurred = vi.fn()
    const notificationOccurred = vi.fn()
    const onEvent = vi.fn()
    const offEvent = vi.fn()

    ;(globalThis as { window?: unknown }).window = {
      Telegram: {
        WebApp: {
          platform: 'ios',
          viewportStableHeight: 740,
          initDataUnsafe: { user: { id: 42, first_name: 'Omar', username: 'omar' } },
          ready,
          expand,
          disableVerticalSwipes,
          setHeaderColor,
          setBackgroundColor,
          onEvent,
          offEvent,
          BackButton: { show, hide, onClick, offClick },
          HapticFeedback: { impactOccurred, notificationOccurred },
        },
      },
    }

    const { info, cleanup } = initTelegramMiniApp()
    expect(info.isMiniApp).toBe(true)
    expect(info.platform).toBe('ios')
    expect(info.firstName).toBe('Omar')
    expect(ready).toHaveBeenCalledTimes(1)
    expect(expand).toHaveBeenCalledTimes(1)
    expect(disableVerticalSwipes).toHaveBeenCalledTimes(1)
    expect(setHeaderColor).toHaveBeenCalledWith('#030712')
    expect(setBackgroundColor).toHaveBeenCalledWith('#030712')
    expect(onEvent).toHaveBeenCalledWith('viewportChanged', expect.any(Function))

    const onBack = vi.fn()
    const offBack = syncTelegramBackButton(true, onBack)
    expect(show).toHaveBeenCalledTimes(1)
    expect(onClick).toHaveBeenCalledWith(onBack)
    offBack()
    expect(offClick).toHaveBeenCalledWith(onBack)

    syncTelegramBackButton(false, onBack)
    expect(hide).toHaveBeenCalledTimes(1)

    triggerTelegramHaptic('light')
    expect(impactOccurred).toHaveBeenCalledWith('light')
    triggerTelegramHaptic('success')
    expect(notificationOccurred).toHaveBeenCalledWith('success')

    cleanup()
    expect(offEvent).toHaveBeenCalledWith('viewportChanged', expect.any(Function))
  })

  it('expone readTelegramStartParam y wrappers CloudStorage con guardas de versión', async () => {
    const bag = new Map<string, string>()
    ;(globalThis as { window?: unknown }).window = {
      Telegram: {
        WebApp: {
          platform: 'android',
          isVersionAtLeast: (v: string) => v === '6.9',
          initDataUnsafe: { start_param: 'CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE' },
          CloudStorage: {
            setItem: (k: string, val: string, cb?: (err: string | null, ok?: boolean) => void) => {
              bag.set(k, val)
              cb?.(null, true)
            },
            getItem: (k: string, cb: (err: string | null, val?: string) => void) => {
              cb(null, bag.get(k) ?? '')
            },
            getItems: (keys: string[], cb: (err: string | null, vals?: Record<string, string>) => void) => {
              const out: Record<string, string> = {}
              for (const k of keys) if (bag.has(k)) out[k] = bag.get(k)!
              cb(null, out)
            },
            removeItem: (k: string, cb?: (err: string | null, ok?: boolean) => void) => {
              bag.delete(k)
              cb?.(null, true)
            },
            removeItems: (keys: string[], cb?: (err: string | null, ok?: boolean) => void) => {
              for (const k of keys) bag.delete(k)
              cb?.(null, true)
            },
            getKeys: (cb: (err: string | null, keys?: string[]) => void) => {
              cb(null, Array.from(bag.keys()))
            },
          },
        },
      },
    }

    expect(isTelegramCloudAvailable()).toBe(true)
    expect(readTelegramStartParam()).toBe(
      'CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE',
    )
    expect(await telegramCloudSetItem('k1', 'v1')).toBe(true)
    expect(await telegramCloudGetItems(['k1'])).toEqual({ k1: 'v1' })
  })

  it('extrae initData firmado estrictamente, genera deep links seguros y verifica sesión contra Worker', async () => {
    expect(getTelegramInitDataRaw()).toBe('')

    ;(globalThis as { window?: unknown }).window = {
      Telegram: { WebApp: { platform: 'ios', initData: 'user=1' } },
      location: { hash: '' },
    }
    expect(getTelegramInitDataRaw()).toBe('')

    const signed = 'auth_date=1700000000&user=%7B%22id%22%3A42%7D&hash=abc123'
    ;(globalThis as { window?: unknown }).window = {
      Telegram: { WebApp: { platform: 'ios', initData: signed } },
    }
    expect(getTelegramInitDataRaw()).toBe(signed)

    ;(globalThis as { window?: unknown }).window = {
      location: {
        hash: `#tgWebAppData=${encodeURIComponent(signed)}&tgWebAppVersion=7.0`,
      },
    }
    expect(getTelegramInitDataRaw()).toBe(signed)

    expect(buildTelegramDeepLinkForPath('/')).toBe(
      'https://t.me/AstroGateSorobanBot?start=home',
    )
    expect(buildTelegramDeepLinkForPath('/market')).toBe(
      'https://t.me/AstroGateSorobanBot?start=market',
    )
    expect(buildTelegramDeepLinkForPath('/dex')).toBe(
      'https://t.me/AstroGateSorobanBot?start=dex',
    )
    expect(buildTelegramDeepLinkForPath('/create')).toBe(
      'https://t.me/AstroGateSorobanBot?start=create',
    )
    expect(buildTelegramDeepLinkForPath('/sorobits')).toBe(
      'https://t.me/AstroGateSorobanBot?start=sorobits',
    )
    expect(buildTelegramDeepLinkForPath('/portfolio')).toBe(
      'https://t.me/AstroGateSorobanBot?start=portfolio',
    )
    expect(buildTelegramDeepLinkForPath('/docs')).toBe(
      'https://t.me/AstroGateSorobanBot?start=docs',
    )
    expect(
      buildTelegramDeepLinkForPath(
        '/token/CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE',
      ),
    ).toBe(
      'https://t.me/AstroGateSorobanBot?start=CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE',
    )
    expect(buildTelegramDeepLinkForPath('/../../etc/passwd')).toBe(
      'https://t.me/AstroGateSorobanBot?start=home',
    )

    globalThis.fetch = vi.fn(async () =>
      Response.json({
        ok: true,
        user: { id: 42, firstName: 'Omar', username: 'omar' },
      }),
    ) as unknown as typeof fetch
    const okRes = await verifyTelegramSession(signed)
    expect(okRes).toEqual({
      status: 'verified',
      user: { id: 42, firstName: 'Omar', username: 'omar' },
    })

    globalThis.fetch = vi.fn(async () =>
      Response.json({ ok: false }, { status: 401 }),
    ) as unknown as typeof fetch
    const rejRes = await verifyTelegramSession(signed)
    expect(rejRes.status).toBe('rejected')

    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const errRes = await verifyTelegramSession(signed)
    expect(errRes.status).toBe('network_error')
  })
})
