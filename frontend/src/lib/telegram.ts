/**
 * Lightweight zero-dependency Telegram Mini App integration bridge.
 * Safely no-ops inside normal web browsers and Node smoke renders.
 */

export const TELEGRAM_BOT_USERNAME = 'AstroGateSorobanBot'
export const TELEGRAM_COMMUNITY_URL = 'https://t.me/AstroGateCommunity'

export interface TelegramCloudStorage {
  setItem: (
    key: string,
    value: string,
    callback?: (error: string | null, stored?: boolean) => void,
  ) => void
  getItem: (
    key: string,
    callback: (error: string | null, value?: string) => void,
  ) => void
  getItems: (
    keys: string[],
    callback: (error: string | null, values?: Record<string, string>) => void,
  ) => void
  removeItem: (
    key: string,
    callback?: (error: string | null, removed?: boolean) => void,
  ) => void
  removeItems: (
    keys: string[],
    callback?: (error: string | null, removed?: boolean) => void,
  ) => void
  getKeys: (callback: (error: string | null, keys?: string[]) => void) => void
}

export interface TelegramInsets {
  top?: number
  bottom?: number
  left?: number
  right?: number
}

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
  safeAreaInset?: TelegramInsets
  contentSafeAreaInset?: TelegramInsets
  isExpanded?: boolean
  isVersionAtLeast?: (version: string) => boolean
  ready?: () => void
  expand?: () => void
  disableVerticalSwipes?: () => void
  requestSafeArea?: () => void
  requestContentSafeArea?: () => void
  setHeaderColor?: (color: string) => void
  setBackgroundColor?: (color: string) => void
  openTelegramLink?: (url: string) => void
  onEvent?: (event: string, cb: () => void) => void
  offEvent?: (event: string, cb: () => void) => void
  CloudStorage?: TelegramCloudStorage
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
  cloudStorageAvailable: boolean
}

const CLOUD_TIMEOUT_MS = 3_000

export function getTelegramWebApp(): TelegramWebApp | null {
  const win = (globalThis as { window?: { Telegram?: { WebApp?: TelegramWebApp } } })
    .window
  const tg = win?.Telegram?.WebApp
  if (!tg) return null
  const hasPayload = Boolean(
    tg.initData ||
      tg.initDataUnsafe?.user ||
      (tg.platform && tg.platform !== 'unknown'),
  )
  return hasPayload ? tg : null
}

export function isTelegramCloudAvailable(): boolean {
  const tg = getTelegramWebApp()
  if (!tg?.CloudStorage) return false
  if (typeof tg.isVersionAtLeast === 'function' && !tg.isVersionAtLeast('6.9')) {
    return false
  }
  return true
}

export function readTelegramUser(): {
  id?: number
  firstName?: string
  username?: string
} {
  const user = getTelegramWebApp()?.initDataUnsafe?.user
  if (!user) return {}
  return {
    id: user.id,
    firstName: user.first_name,
    username: user.username,
  }
}

export function readTelegramStartParam(): string | null {
  const fromInit = getTelegramWebApp()?.initDataUnsafe?.start_param?.trim()
  if (fromInit) return fromInit
  const search = (globalThis as { location?: { search?: string } }).location?.search
  if (search) {
    const param = new URLSearchParams(search).get('tgWebAppStartParam')?.trim()
    if (param) return param
  }
  return null
}

/** Builds a Telegram Bot deep link that opens the Mini App / bot screen safely in all clients. */
export function telegramMiniAppUrl(startParam?: string): string {
  const base = `https://t.me/${TELEGRAM_BOT_USERNAME}`
  return startParam
    ? `${base}?start=${encodeURIComponent(startParam)}`
    : base
}

/** Promisified CloudStorage wrappers with timeout guard so broken WebViews never hang. */
function runCloudOp<T>(
  fallback: T,
  exec: (resolve: (value: T) => void) => void,
): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        resolve(fallback)
      }
    }, CLOUD_TIMEOUT_MS)

    const done = (val: T) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(val)
    }

    try {
      exec(done)
    } catch {
      done(fallback)
    }
  })
}

export async function telegramCloudGetItems(
  keys: string[],
): Promise<Record<string, string>> {
  const cs = getTelegramWebApp()?.CloudStorage
  if (!cs || !isTelegramCloudAvailable() || keys.length === 0) return {}
  return runCloudOp<Record<string, string>>({}, (done) => {
    cs.getItems(keys, (err, values) => {
      done(!err && values ? values : {})
    })
  })
}

export async function telegramCloudSetItem(
  key: string,
  value: string,
): Promise<boolean> {
  const cs = getTelegramWebApp()?.CloudStorage
  if (!cs || !isTelegramCloudAvailable()) return false
  return runCloudOp<boolean>(false, (done) => {
    cs.setItem(key, value, (err, stored) => {
      done(!err && Boolean(stored))
    })
  })
}

export async function telegramCloudRemoveItems(keys: string[]): Promise<boolean> {
  const cs = getTelegramWebApp()?.CloudStorage
  if (!cs || !isTelegramCloudAvailable() || keys.length === 0) return false
  return runCloudOp<boolean>(false, (done) => {
    cs.removeItems(keys, (err, removed) => {
      done(!err && Boolean(removed))
    })
  })
}

export async function telegramCloudGetKeys(): Promise<string[]> {
  const cs = getTelegramWebApp()?.CloudStorage
  if (!cs || !isTelegramCloudAvailable()) return []
  return runCloudOp<string[]>([], (done) => {
    cs.getKeys((err, keys) => {
      done(!err && Array.isArray(keys) ? keys : [])
    })
  })
}

/**
 * Initializes Telegram Mini App lifecycle (`ready`, `expand`, dark theme chrome,
 * and dynamic `--app-vh` CSS tracking for virtual keyboards).
 * Returns cleanup listener and context metadata.
 */
export function initTelegramMiniApp(): {
  info: TelegramContextInfo
  cleanup: () => void
} {
  const tg = getTelegramWebApp()
  if (!tg) {
    return {
      info: {
        isMiniApp: false,
        platform: 'web',
        cloudStorageAvailable: false,
      },
      cleanup: () => {},
    }
  }

  try {
    tg.ready?.()
    tg.expand?.()
    tg.disableVerticalSwipes?.()
    tg.requestSafeArea?.()
    tg.requestContentSafeArea?.()
    tg.setHeaderColor?.('#030712')
    tg.setBackgroundColor?.('#030712')
  } catch {
    // Older Telegram clients ignore unsupported styling calls
  }

  const syncSafeAreas = () => {
    if (typeof document === 'undefined') return
    const rootStyle = document.documentElement.style
    const sat = tg.safeAreaInset?.top
    const sab = tg.safeAreaInset?.bottom
    const csat = tg.contentSafeAreaInset?.top
    const csab = tg.contentSafeAreaInset?.bottom
    if (typeof sat === 'number') rootStyle.setProperty('--app-sat', `${sat}px`)
    if (typeof sab === 'number') rootStyle.setProperty('--app-sab', `${sab}px`)
    if (typeof csat === 'number') rootStyle.setProperty('--app-csat', `${csat}px`)
    if (typeof csab === 'number') rootStyle.setProperty('--app-csab', `${csab}px`)
  }

  const syncViewport = () => {
    const height =
      tg.viewportStableHeight ?? tg.viewportHeight ?? globalThis.innerHeight
    if (
      typeof height === 'number' &&
      height > 0 &&
      typeof document !== 'undefined'
    ) {
      document.documentElement.style.setProperty('--app-vh', `${height * 0.01}px`)
    }
    syncSafeAreas()
  }

  syncViewport()
  tg.onEvent?.('viewportChanged', syncViewport)
  tg.onEvent?.('safeAreaChanged', syncSafeAreas)
  tg.onEvent?.('contentSafeAreaChanged', syncSafeAreas)

  return {
    info: {
      isMiniApp: true,
      platform: tg.platform ?? 'telegram',
      firstName: tg.initDataUnsafe?.user?.first_name,
      username: tg.initDataUnsafe?.user?.username,
      startParam: readTelegramStartParam() ?? undefined,
      cloudStorageAvailable: isTelegramCloudAvailable(),
    },
    cleanup: () => {
      tg.offEvent?.('viewportChanged', syncViewport)
      tg.offEvent?.('safeAreaChanged', syncSafeAreas)
      tg.offEvent?.('contentSafeAreaChanged', syncSafeAreas)
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

/**
 * Non-blocking ping to the Cloudflare Worker event bridge so verified on-chain
 * Burn-to-Chat shouts mirror immediately to AstroGate Community & Live Feed.
 */
export async function notifyTelegramPulse(txHash: string): Promise<void> {
  const clean = txHash.trim().toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(clean) || typeof fetch !== 'function') return
  try {
    await fetch('/api/telegram/pulse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash: clean }),
      signal:
        typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
          ? AbortSignal.timeout(2500)
          : undefined,
    })
  } catch {
    // Silent no-op when running on static Pages or offline; Cron sync covers fallback
  }
}
