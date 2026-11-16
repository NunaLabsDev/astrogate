import { FAIR_LAUNCH_TOTAL_BASIS } from './tokenomics'

export interface LaunchAlertPayload {
  tokenId: string
  name: string
  symbol: string
  seedXlm: string
  creator: string
  explorerUrl?: string
}

export interface SwapAlertPayload {
  tokenId: string
  symbol: string
  direction: 'buy' | 'sell'
  xlmAmount: string
  tokenAmount: string
  isWhale?: boolean
  graduationPercent?: number
  explorerUrl?: string
}

export interface AlertTransportConfig {
  telegramBotToken?: string
  telegramChatId?: string
  webhookUrl?: string
}

export type AlertEventKind = 'launch' | 'whale' | 'graduation'

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Reads optional notification endpoints from Vite env variables.
 * Never throws and requires zero configuration for standalone testnet deployments.
 */
export function readAlertConfig(
  env: Record<string, unknown> = import.meta.env as Record<string, unknown>,
): AlertTransportConfig {
  const telegramBotToken = cleanString(env.VITE_TELEGRAM_BOT_TOKEN)
  const telegramChatId = cleanString(env.VITE_TELEGRAM_CHAT_ID)
  const rawWebhook = cleanString(env.VITE_ALERT_WEBHOOK_URL)
  const webhookUrl =
    rawWebhook && rawWebhook.startsWith('https://') ? rawWebhook : undefined

  return {
    telegramBotToken,
    telegramChatId,
    webhookUrl,
  }
}

export function isAlertsConfigured(config: AlertTransportConfig = readAlertConfig()): boolean {
  const hasTelegram = Boolean(config.telegramBotToken && config.telegramChatId)
  const hasWebhook = Boolean(config.webhookUrl)
  return hasTelegram || hasWebhook
}

export function formatLaunchAlertMessage(payload: LaunchAlertPayload): string {
  const formattedCap = Number(FAIR_LAUNCH_TOTAL_BASIS).toLocaleString('en-US')
  const lines = [
    `🚀 New AstroGate Fair Launch: $${payload.symbol} (${payload.name})`,
    `Supply: ${formattedCap} fixed · 40% Curve / 30% DEX / 29.7% Burn Vault / 0.3% 15d Vesting`,
    `Seed Pool: ${payload.seedXlm} XLM`,
    `Token: ${payload.tokenId}`,
    `Creator: ${payload.creator}`,
  ]
  if (payload.explorerUrl) {
    lines.push(`Explorer: ${payload.explorerUrl}`)
  }
  return lines.join('\n')
}

export function formatSwapAlertMessage(payload: SwapAlertPayload): string {
  const gradPct = payload.graduationPercent ?? 0
  const isGraduating = gradPct >= 80
  const header = isGraduating
    ? `🎓 Graduation Watch (${gradPct.toFixed(1)}%): $${payload.symbol}`
    : `🐋 Whale ${payload.direction === 'buy' ? 'Buy' : 'Sell'} on $${payload.symbol}`

  const verb = payload.direction === 'buy' ? 'Bought' : 'Sold'
  const lines = [
    header,
    `${verb} ${payload.tokenAmount} $${payload.symbol} for ${payload.xlmAmount} XLM`,
    `Token: ${payload.tokenId}`,
  ]
  if (isGraduating) {
    lines.push(`Curve progress: ${gradPct.toFixed(1)}% of 1,000 XLM target`)
  }
  if (payload.explorerUrl) {
    lines.push(`Tx: ${payload.explorerUrl}`)
  }
  return lines.join('\n')
}

/**
 * Best-effort non-blocking alert dispatch to optional Telegram / Webhook channels.
 * Never throws so trading and launch flows are never interrupted.
 */
export async function dispatchAlertMessage(
  text: string,
  event: AlertEventKind,
  options?: { config?: AlertTransportConfig; fetchFn?: typeof fetch },
): Promise<{ sent: boolean; channels: string[] }> {
  const config = options?.config ?? readAlertConfig()
  if (!isAlertsConfigured(config)) {
    return { sent: false, channels: [] }
  }

  const fetchImpl = options?.fetchFn ?? globalThis.fetch
  const tasks: Promise<string | null>[] = []
  const signal =
    typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
      ? AbortSignal.timeout(8_000)
      : undefined

  if (config.telegramBotToken && config.telegramChatId) {
    const endpoint = `https://api.telegram.org/bot${encodeURIComponent(config.telegramBotToken)}/sendMessage`
    tasks.push(
      fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: config.telegramChatId,
          text,
          disable_web_page_preview: true,
        }),
        signal,
      })
        .then((res) => (res.ok ? 'telegram' : null))
        .catch(() => null),
    )
  }

  if (config.webhookUrl) {
    tasks.push(
      fetchImpl(config.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event,
          content: text,
          text,
        }),
        signal,
      })
        .then((res) => (res.ok ? 'webhook' : null))
        .catch(() => null),
    )
  }

  const results = await Promise.all(tasks)
  const channels = results.filter((ch): ch is string => ch !== null)
  return { sent: channels.length > 0, channels }
}

export async function notifyTokenLaunch(
  payload: LaunchAlertPayload,
  options?: { config?: AlertTransportConfig; fetchFn?: typeof fetch },
): Promise<{ sent: boolean; channels: string[] }> {
  const config = options?.config ?? readAlertConfig()
  if (!isAlertsConfigured(config)) {
    return { sent: false, channels: [] }
  }
  return dispatchAlertMessage(formatLaunchAlertMessage(payload), 'launch', {
    config,
    fetchFn: options?.fetchFn,
  })
}

export async function notifySwapAlert(
  payload: SwapAlertPayload,
  options?: { config?: AlertTransportConfig; fetchFn?: typeof fetch },
): Promise<{ sent: boolean; channels: string[] }> {
  const isGraduating = (payload.graduationPercent ?? 0) >= 80
  if (!payload.isWhale && !isGraduating) {
    return { sent: false, channels: [] }
  }
  const config = options?.config ?? readAlertConfig()
  if (!isAlertsConfigured(config)) {
    return { sent: false, channels: [] }
  }
  const event: AlertEventKind = isGraduating ? 'graduation' : 'whale'
  return dispatchAlertMessage(formatSwapAlertMessage(payload), event, {
    config,
    fetchFn: options?.fetchFn,
  })
}
