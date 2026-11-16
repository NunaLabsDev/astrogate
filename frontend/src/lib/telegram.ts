/**
 * Lightweight zero-dependency Telegram Mini App integration bridge.
 * Safely no-ops inside normal web browsers and Node smoke renders.
 */

export interface TelegramWebApp {
  initData?: string
  initDataUnsafe?: {
    user?: {
      id: number
      first_name?: string
      last_name?: string
      username?: string
    }
    start_param?: string
  }
  platform?: string
  version?: string
  viewportHeight?: number
  viewportStableHeight?: number
  isExpanded?: boolean
  ready?: () => void
  expand?: () => void
  disableVerticalSwipes?: () => void
  setHeaderColor?: (color: string) => void
  setBackgroundColor?: (color: string) => void
  openTelegramLink?: (url: string) => void
  onEvent?: (event: string, cb: () => void) => void
  offEvent?: (event: string, cb: () => void) => void
  BackButton?: {
    show: () => void
    hide: () => void
    onClick: (cb: () => void) => void
    offClick: (cb: () => void) => void
  }
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void
  }
}

export interface TelegramContextInfo {
  isMiniApp: boolean
  platform: string
  firstName?: string
  username?: string
  startParam?: string
}

export function getTelegramWebApp(): TelegramWebApp | null {
  const win = (globalThis as { window?: { Telegram?: { WebApp?: TelegramWebApp } } })
    .window
  const tg = win?.Telegram?.WebApp
  if (!tg) return null
  // Telegram injects platform even without initData in some preview contexts
  const hasPayload = Boolean(tg.initData || tg.initDataUnsafe?.user || (tg.platform && tg.platform !== 'unknown'))
  return hasPayload ? tg : null
}

/**
 * Initializes Telegram Mini App lifecycle (`ready`, `expand`, dark theme chrome,
 * and dynamic `--tg-viewport-height` CSS tracking for virtual keyboards).
 * Returns cleanup listener and context metadata.
 */
export function initTelegramMiniApp(): {
  info: TelegramContextInfo
  cleanup: () => void
} {
  const tg = getTelegramWebApp()
  if (!tg) {
    return {
      info: { isMiniApp: false, platform: 'web' },
      cleanup: () => {},
    }
  }

  try {
    tg.ready?.()
    tg.expand?.()
    tg.disableVerticalSwipes?.()
    tg.setHeaderColor?.('#030712')
    tg.setBackgroundColor?.('#030712')
  } catch {
    // Older Telegram clients ignore unsupported styling calls
  }

  const syncViewport = () => {
    const height = tg.viewportStableHeight ?? tg.viewportHeight ?? globalThis.innerHeight
    if (typeof height === 'number' && height > 0 && typeof document !== 'undefined') {
      document.documentElement.style.setProperty('--app-vh', `${height * 0.01}px`)
    }
  }

  syncViewport()
  tg.onEvent?.('viewportChanged', syncViewport)

  return {
    info: {
      isMiniApp: true,
      platform: tg.platform ?? 'telegram',
      firstName: tg.initDataUnsafe?.user?.first_name,
      username: tg.initDataUnsafe?.user?.username,
      startParam: tg.initDataUnsafe?.start_param,
    },
    cleanup: () => {
      tg.offEvent?.('viewportChanged', syncViewport)
    },
  }
}

/** Synchronizes Telegram's native top-left BackButton with React Router path depth. */
export function syncTelegramBackButton(
  visible: boolean,
  onBack: () => void,
): () => void {
  const tg = getTelegramWebApp()
  const backButton = tg?.BackButton
  if (!backButton) return () => {}

  if (visible) {
    backButton.show()
    backButton.onClick(onBack)
    return () => {
      backButton.offClick(onBack)
    }
  }
  backButton.hide()
  return () => {}
}

/** Fires tactile mobile feedback inside Telegram when signing, swapping, or copying. */
export function triggerTelegramHaptic(
  kind: 'light' | 'medium' | 'success' | 'error' = 'light',
): void {
  const tg = getTelegramWebApp()
  const hf = tg?.HapticFeedback
  if (!hf) return
  try {
    if (kind === 'success' || kind === 'error') {
      hf.notificationOccurred(kind)
    } else {
      hf.impactOccurred(kind)
    }
  } catch {
    // No-op when haptics unavailable
  }
}

/** Shares text + URL directly via Telegram native share sheet when inside TMA. */
export function shareToTelegram(text: string, url: string): void {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`
  const tg = getTelegramWebApp()
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(shareUrl)
    return
  }
  if (typeof window !== 'undefined') {
    window.open(shareUrl, '_blank', 'noopener,noreferrer')
  }
}
