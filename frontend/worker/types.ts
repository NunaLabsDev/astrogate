export interface AssetsBinding {
  fetch: (request: Request | string, init?: RequestInit) => Promise<Response>
}

export interface Env {
  ASSETS: AssetsBinding
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_WEBHOOK_SECRET?: string
  APP_BASE_URL?: string
  STELLAR_RPC_URL?: string
  HORIZON_URL?: string
}

export type BotLang = 'es' | 'en'

export interface TelegramUser {
  id: number
  is_bot?: boolean
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
}

export interface TelegramChat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel'
}

export interface TelegramMessage {
  message_id: number
  from?: TelegramUser
  chat: TelegramChat
  text?: string
  caption?: string
}

export interface TelegramCallbackQuery {
  id: string
  from: TelegramUser
  message?: TelegramMessage
  data?: string
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  callback_query?: TelegramCallbackQuery
}

export interface InlineKeyboardButton {
  text: string
  url?: string
  callback_data?: string
  web_app?: { url: string }
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][]
}

export interface BotRenderedView {
  text: string
  reply_markup: InlineKeyboardMarkup
}

export interface MarketTokenSummary {
  id: string
  name: string
  symbol: string
  graduated: boolean
  curveXlmNet: bigint
  pairId: string | null
  reserveXlmStroops: bigint
}

export interface TokenInspectorData {
  tokenId: string
  name: string
  symbol: string
  decimals: number
  totalSupply: bigint
  curve: {
    graduated: boolean
    curveXlmNet: bigint
    realXlmVault: bigint
    tokensSold: bigint
    buybackXlmReserve: bigint
    burnVaultRemaining: bigint
    burnMilestoneStage: number
    pair: string | null
    creator: string
  } | null
  kingShout: {
    sender: string
    amount: bigint
    message: string
  } | null
  dexReserveXlm: bigint | null
}

export interface AccountSummaryData {
  accountId: string
  funded: boolean
  xlmBalance: string
  assetCount: number
}
