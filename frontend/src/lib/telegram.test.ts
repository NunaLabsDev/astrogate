import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getTelegramWebApp,
  initTelegramMiniApp,
  syncTelegramBackButton,
  triggerTelegramHaptic,
} from './telegram'

afterEach(() => {
  delete (globalThis as { window?: { Telegram?: unknown } }).window
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
})
