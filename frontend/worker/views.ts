import {
  ASTROGATE_QUEST_BADGES,
  computePilotPerks,
  type QuestProgressSummary,
} from './quests'
import type {
  AccountSummaryData,
  BotLang,
  BotRenderedView,
  InlineKeyboardButton,
  MarketTokenSummary,
  TokenInspectorData,
  TokenShoutsData,
} from './types'

export const DEFAULT_APP_BASE_URL = 'https://astrogate.pages.dev'
export const DEFAULT_BOT_USERNAME = 'AstroGateSorobanBot'

const STROOPS_PER_XLM = 10_000_000n
const GRADUATION_GOAL_STROOPS = 10_000_000_000n // 1,000 XLM
const TOTAL_CURVE_ALLOCATION = 66_000_000_000_000n // 6,600,000 * 10^7 (66%)

export interface ViewLinkOptions {
  baseUrl?: string
  botUsername?: string
  inGroup?: boolean
  hasMainApp?: boolean
  folderUrl?: string
}

export function resolveLang(_languageCode?: string): BotLang {
  // Rule 9: Telegram channels, groups, and bot interactions stay strictly in English.
  return 'en'
}

export function langFlag(_lang: BotLang): 'e' | 's' {
  return 'e'
}

export function parseLangFlag(_flag?: string): BotLang {
  return 'en'
}

export function escapeHtml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function shortAddr(addr: string): string {
  if (addr.length <= 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function formatXlm(stroops: bigint, decimals = 2): string {
  const neg = stroops < 0n
  const abs = neg ? -stroops : stroops
  const whole = abs / STROOPS_PER_XLM
  const frac = abs % STROOPS_PER_XLM
  if (decimals <= 0) {
    return `${neg ? '-' : ''}${whole.toLocaleString('en-US')}`
  }
  const fracStr = frac
    .toString()
    .padStart(7, '0')
    .slice(0, decimals)
  return `${neg ? '-' : ''}${whole.toLocaleString('en-US')}.${fracStr}`
}

export function formatTokensCompact(amountStroops: bigint, decimals = 7): string {
  const scale = 10n ** BigInt(Math.max(0, Math.min(18, decimals)))
  const whole = Number(amountStroops / scale)
  if (!Number.isFinite(whole)) return '0'
  if (whole >= 1_000_000) return `${(whole / 1_000_000).toFixed(2)}M`
  if (whole >= 1_000) return `${(whole / 1_000).toFixed(1)}K`
  return whole.toLocaleString('en-US')
}

export function progressBar(percent: number, width = 10): string {
  const clamped = Math.max(0, Math.min(100, percent))
  const filled = Math.round((clamped / 100) * width)
  return `${'▓'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}`
}

export function curvePercent(curveXlmNet: bigint): number {
  if (curveXlmNet <= 0n) return 0
  const pct = Number((curveXlmNet * 1000n) / GRADUATION_GOAL_STROOPS) / 10
  return Math.max(0, Math.min(100, pct))
}

export function appUrl(baseUrl: string, path = '/'): string {
  const cleanBase = baseUrl.replace(/\/+$/, '')
  const cleanPath = path.startsWith('/') ? path : `/${path}`
  return `${cleanBase}${cleanPath}`
}

export function telegramHeroUrl(baseUrl: string, fileName: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/telegram/${fileName}`
}

export function isContractAddr(value: string): boolean {
  return /^C[A-Z2-7]{55}$/.test(value)
}

export function isAccountAddr(value: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(value)
}

export function isSecretSeed(value: string): boolean {
  return /^S[A-Z2-7]{55}$/.test(value)
}

export function explorerNetworkSegment(network?: string): 'public' | 'testnet' {
  return network === 'mainnet' ? 'public' : 'testnet'
}

export function detectStellarAddress(
  text: string,
): { kind: 'contract' | 'account' | 'secret'; value: string } | null {
  const parts = text.trim().split(/[^A-Z2-7]+/)
  // Always prioritize Stellar secret seeds (S...) anywhere in the message
  // so pasting "SECRET=SB..." or "CA... SB..." still triggers immediate auto-deletion & warning.
  for (const part of parts) {
    if (isSecretSeed(part)) return { kind: 'secret', value: part }
  }
  const tokens = text.trim().split(/\s+/)
  for (const raw of tokens) {
    const clean = raw.replace(/[^A-Z2-7]/g, '')
    if (isSecretSeed(clean)) return { kind: 'secret', value: clean }
  }
  for (const part of parts) {
    if (isContractAddr(part)) return { kind: 'contract', value: part }
    if (isAccountAddr(part)) return { kind: 'account', value: part }
  }
  for (const raw of tokens) {
    const clean = raw.replace(/[^A-Z2-7]/g, '')
    if (isContractAddr(clean)) return { kind: 'contract', value: clean }
    if (isAccountAddr(clean)) return { kind: 'account', value: clean }
  }
  return null
}

/** Extracts `$TICKER` mentions like `$ASTRO` (requires >=1 letter so `$50` is ignored). */
export function detectTickerMention(text: string): string | null {
  const match = text.match(/(?:^|\s)\$([A-Za-z0-9]{2,12})\b/)
  if (!match?.[1]) return null
  const sym = match[1].toUpperCase()
  if (!/[A-Z]/.test(sym)) return null
  return sym
}

export function parseCommandAndArg(text: string): {
  command: string | null
  arg: string
} {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) {
    return { command: null, arg: '' }
  }
  const [rawCmd, ...rest] = trimmed.split(/\s+/)
  const withoutBot = (rawCmd ?? '').slice(1).split('@')[0]?.toLowerCase() ?? ''
  return {
    command: withoutBot || null,
    arg: rest.join(' ').trim(),
  }
}

/** Extracts `@botusername` from `/cmd@botusername` when present (lowercased). */
export function extractCommandTargetBot(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null
  const [rawCmd] = trimmed.split(/\s+/)
  const atIdx = (rawCmd ?? '').indexOf('@')
  if (atIdx < 0) return null
  const target = (rawCmd ?? '').slice(atIdx + 1).trim().toLowerCase()
  return target || null
}

export function miniAppStartUrl(
  botUsername = DEFAULT_BOT_USERNAME,
  startParam?: string,
  hasMainApp = false,
  shortName?: string,
): string {
  const cleanShort = shortName?.trim()
  const base = cleanShort
    ? `https://t.me/${botUsername}/${cleanShort}`
    : `https://t.me/${botUsername}`
  const param = startParam || 'home'
  if (hasMainApp || cleanShort) {
    return `${base}?startapp=${encodeURIComponent(param)}`
  }
  return `${base}?start=${encodeURIComponent(param)}`
}

function webAppBtn(text: string, url: string): InlineKeyboardButton {
  return { text, web_app: { url } }
}

function miniAppBtn(
  text: string,
  path: string,
  baseUrl: string,
  inGroup = false,
  startParam?: string,
  botUsername = DEFAULT_BOT_USERNAME,
  hasMainApp = false,
): InlineKeyboardButton {
  if (inGroup) {
    return { text, url: miniAppStartUrl(botUsername, startParam, hasMainApp) }
  }
  return webAppBtn(text, appUrl(baseUrl, path))
}

function cbBtn(text: string, data: string): InlineKeyboardButton {
  return { text, callback_data: data }
}

export function buildWelcomeView(
  firstName: string | undefined,
  _lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  botUsername = DEFAULT_BOT_USERNAME,
  inGroup = false,
  opts?: { hasMainApp?: boolean; folderUrl?: string; network?: 'testnet' | 'mainnet' },
): BotRenderedView {
  const safeName = firstName ? escapeHtml(firstName.trim().slice(0, 32)) : ''
  const hasMainApp = Boolean(opts?.hasMainApp)
  const netLabel = opts?.network === 'mainnet' ? 'Stellar Mainnet' : 'Stellar Testnet'
  const greet = safeName ? `Hey, ${safeName}` : 'Welcome'
  const text = [
    `🚀 <b>AstroGate</b> · <code>${netLabel}</code>`,
    `${greet} — Fair-Flywheel launchpad with 7Y locked LP &amp; AstroID SSO.`,
    `Tap below to explore curves, paste a <code>CA…</code> / <code>$TICKER</code>, or run /help.`,
    `<i>Built by NunaLabs</i>`,
  ].join('\n')

  const keyboard: InlineKeyboardButton[][] = [
    [
      miniAppBtn(
        '🚀 Open AstroGate',
        '/',
        baseUrl,
        inGroup,
        'home',
        botUsername,
        hasMainApp,
      ),
    ],
    [
      cbBtn('🔥 Live Curves', 'nav:mkt:e'),
      { text: '🛡️ AstroWallet', url: 'https://t.me/AstroWalletAppBot/wallet' },
    ],
  ]

  return {
    text,
    photoUrl: telegramHeroUrl(baseUrl, 'astrogate-bot-banner.png'),
    reply_markup: { inline_keyboard: keyboard },
  }
}

export function buildSorobitsView(
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
  hasMainApp = false,
  liveStatus?: { contractId: string; totalSupply: number; genesisMinted: number },
): BotRenderedView {
  const contractId =
    liveStatus?.contractId || 'CBVETCPLVAMNUUQRUJGH54XHVQT5ZOVB4FGGP2IGOGAZLUIYBBV7G3I3'
  const supplyLine = liveStatus
    ? `• <b>Minted On-Chain:</b> <code>${liveStatus.totalSupply} SBIT</code> (${liveStatus.genesisMinted}/8 Genesis archetypes)`
    : `• <b>Season 1 (AGQ01–AGQ08):</b> Art &amp; 7 Faction palettes sealed on-chain`
  return {
    photoUrl: telegramHeroUrl(baseUrl, 'sorobits-hero-card.png'),
    text: [
      `🧬 <b>Sorobits (SBIT) · 100% On-Chain NFTs</b>`,
      ``,
      `<blockquote>Commit-Reveal RNG &amp; 32×32 Genomic Pixel Art rendered natively from Stellar Soroban SVG — zero IPFS &amp; zero Pinata.</blockquote>`,
      ``,
      `• <b>Contract:</b> <code>${escapeHtml(contractId)}</code>`,
      supplyLine,
      `• <b>On-Chain Render:</b> Verifiable live via <code>token_uri(id)</code>`,
      ``,
      `<i>Tap below to open Sorobits inside the Telegram Mini App so your encrypted CloudStorage wallet stays connected.</i>`,
      `<i>Built by NunaLabs</i>`,
    ].join('\n'),
    reply_markup: {
      inline_keyboard: [
        [
          miniAppBtn(
            '🧬 Open Sorobits Mini App',
            '/sorobits',
            baseUrl,
            inGroup,
            'sorobits',
            botUsername,
            hasMainApp,
          ),
        ],
        [
          miniAppBtn(
            '👛 My Wallet & Quests',
            '/portfolio',
            baseUrl,
            inGroup,
            'wallet',
            botUsername,
            hasMainApp,
          ),
          cbBtn('🏆 Season-1 Quests', 'nav:qst:e'),
        ],
        [
          cbBtn('🔥 Live Market', 'nav:mkt:e'),
          cbBtn('⬅️ Home', 'nav:home:e'),
        ],
      ],
    },
  }
}

export function buildMarketView(
  items: MarketTokenSummary[],
  _lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  rpcFailed = false,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
  hasMainApp = false,
  network: 'testnet' | 'mainnet' = 'testnet',
): BotRenderedView {
  const netLabel = network === 'mainnet' ? 'Mainnet' : 'Testnet'
  const rows: string[] = [`🔥 <b>Live Fair-Flywheel Market</b> · <code>${netLabel}</code>`, '']

  if (items.length === 0) {
    rows.push(
      rpcFailed
        ? '⚠️ Soroban RPC timed out right now. Tap Refresh or open the Mini App.'
        : '🚀 No active curves found yet. Launch the first v4.5 token!',
    )
  } else {
    for (const item of items.slice(0, 4)) {
      const safeName = escapeHtml(item.name)
      const safeSym = escapeHtml(item.symbol)
      if (item.graduated) {
        const liqText =
          item.reserveXlmStroops > 0n
            ? `${formatXlm(item.reserveXlmStroops, 1)} XLM TVL`
            : 'Soroswap DEX'
        rows.push(
          `🎓 <b>$${safeSym}</b> · ${safeName}`,
          `└ ${liqText} · <code>${shortAddr(item.id)}</code>`,
          '',
        )
      } else {
        const pct = curvePercent(item.curveXlmNet)
        const bar = progressBar(pct, 10)
        rows.push(
          `⚡ <b>$${safeSym}</b> · ${safeName}`,
          `└ <code>${bar}</code> <b>${pct.toFixed(1)}%</b> (${formatXlm(item.curveXlmNet, 1)}/1,000 XLM)`,
          '',
        )
      }
    }
  }

  rows.push(
    '<i>Tap a token to trade in the Mini App or paste any <code>CA…</code> contract / <code>$TICKER</code>.</i>',
  )

  const seenTradeSymbols = new Set<string>()
  const quickTradeItems = items.filter((item) => {
    const key = item.symbol.trim().toUpperCase()
    if (!key || seenTradeSymbols.has(key)) return false
    seenTradeSymbols.add(key)
    return true
  })
  const tradeRow: InlineKeyboardButton[] = quickTradeItems.slice(0, 3).map((item) =>
    miniAppBtn(
      `${item.graduated ? '🎓' : '⚡'} $${item.symbol.slice(0, 10)}`,
      `/token/${item.id}`,
      baseUrl,
      inGroup,
      item.id,
      botUsername,
      hasMainApp,
    ),
  )

  const keyboard: InlineKeyboardButton[][] = []
  if (tradeRow.length > 0) keyboard.push(tradeRow)
  keyboard.push([
    miniAppBtn(
      '🔥 Full Market App',
      '/market',
      baseUrl,
      inGroup,
      'market',
      botUsername,
      hasMainApp,
    ),
  ])
  keyboard.push([
    cbBtn('🔄 Refresh', 'nav:mkt:e'),
    cbBtn('⛰️ King of Hill', 'nav:koth:e'),
    cbBtn('⬅️ Home', 'nav:home:e'),
  ])

  return {
    text: rows.join('\n'),
    photoUrl: telegramHeroUrl(baseUrl, 'market-hero-card.png'),
    reply_markup: { inline_keyboard: keyboard },
  }
}

export function buildLaunchView(
  _lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  directDeepLink = false,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
  hasMainApp = false,
): BotRenderedView {
  const text = [
    `🚀 <b>Launch Your Fair Token in 1 Tap</b>`,
    ``,
    `<blockquote>Fixed <b>10,000,000</b> supply · Verified SEP-41 · Renounced ownership</blockquote>`,
    ``,
    `💰 <b>Cost:</b> <code>7 XLM</code> protocol fee + <code>2+ XLM</code> initial seed buy`,
    `📊 <b>v4.5 Split:</b> <code>66%</code> Curve · <code>33%</code> DEX · <code>0.3%</code> Vest · <code>0.4%</code> Jackpots · <code>0.3%</code> Dev`,
    `🔒 <b>Anti-Rug:</b> Creator seed locked (7d stall / 30d closeout principal return)`,
    `🎓 <b>Graduation:</b> Auto Soroswap pool with <b>LP locked 7 years on-chain</b>`,
    directDeepLink
      ? `\n👇 <i>Tap below to open the token creator inside Telegram:</i>`
      : '',
  ]
    .filter(Boolean)
    .join('\n')

  return {
    text,
    photoUrl: telegramHeroUrl(baseUrl, 'astrogate-bot-banner.png'),
    reply_markup: {
      inline_keyboard: [
        [
          miniAppBtn(
            '🚀 Launch Token Now',
            '/create',
            baseUrl,
            inGroup,
            'create',
            botUsername,
            hasMainApp,
          ),
        ],
        [
          cbBtn('⚙️ v4.5 Rules', 'nav:v42:e'),
          cbBtn('⬅️ Home', 'nav:home:e'),
        ],
      ],
    },
  }
}

export function buildWalletResolveView(
  query: string,
  resolved: {
    username: string
    primaryPublicKey: string
    wallets: string[]
    verifiedTelegram: boolean
  } | null,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
  hasMainApp = false,
): BotRenderedView {
  const cleanQuery = escapeHtml(query.trim())
  const handleLabel = resolved?.username
    ? `@${escapeHtml(resolved.username)}`
    : cleanQuery
  const text = resolved
    ? [
        `🪪 <b>${handleLabel} · Linked AstroID Wallet</b>`,
        ``,
        `✅ <b>Status:</b> ${resolved.verifiedTelegram ? 'Verified Telegram Identity' : 'Self-Signed Stellar Link'}`,
        `⭐ <b>Primary Address:</b> <code>${escapeHtml(resolved.primaryPublicKey)}</code>`,
        `🔐 <b>Linked Wallets:</b> <code>${resolved.wallets.length}</code>`,
        ``,
        `<i>Synced across AstroWallet, AstroDex &amp; AstroGate.</i>`,
      ].join('\n')
    : [
        `🔎 <b>No AstroID Linked for ${cleanQuery}</b>`,
        ``,
        `This user has not linked an AstroID wallet yet.`,
        `Open AstroWallet to create your self-custodial wallet and link your <code>@username</code>.`,
      ].join('\n')

  const astroDexUrl = `https://t.me/AstroDexBot/dex?startapp=${encodeURIComponent(
    resolved ? `scan_${resolved.primaryPublicKey}` : 'home',
  )}`

  return {
    text,
    reply_markup: {
      inline_keyboard: [
        [
          miniAppBtn(
            '📊 Open Portfolio',
            '/portfolio',
            baseUrl,
            inGroup,
            'wallet',
            botUsername,
            hasMainApp,
          ),
        ],
        [
          { text: '🛡️ AstroWallet', url: 'https://t.me/AstroWalletAppBot/wallet' },
          { text: '⚡ AstroDex', url: astroDexUrl },
        ],
        [
          cbBtn('📊 Live Curves', 'nav:mkt:e'),
          cbBtn('⬅️ Home', 'nav:home:e'),
        ],
      ],
    },
  }
}

export function buildWalletView(
  _lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
  hasMainApp = false,
): BotRenderedView {
  const text = [
    `🛡️ <b>AstroID SSO · Powered by AstroWallet</b>`,
    ``,
    `Custody &amp; Clear-Sign live exclusively in <b>AstroWallet</b> (<code>@AstroWalletAppBot</code>), linked 0-click to your Telegram <code>@username</code>.`,
    ``,
    `💡 <i>Run <code>/wallet @username</code> to look up a linked AstroID, or paste any <code>GA…</code> address for live balance.</i>`,
  ].join('\n')

  return {
    text,
    photoUrl: telegramHeroUrl(baseUrl, 'wallet-quests-card.png'),
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🛡️ Open AstroWallet', url: 'https://t.me/AstroWalletAppBot/wallet' },
        ],
        [
          miniAppBtn(
            '👛 View Portfolio',
            '/portfolio',
            baseUrl,
            inGroup,
            'wallet',
            botUsername,
            hasMainApp,
          ),
          cbBtn('⬅️ Home', 'nav:home:e'),
        ],
      ],
    },
  }
}

export function buildV42RulesView(
  _lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
  hasMainApp = false,
): BotRenderedView {
  const text = [
    `⚙️ <b>Fair-Flywheel v4.5 · On-Chain Rules</b>`,
    ``,
    `<b>1 · 3-Stage Curve &amp; Escrowed 40K Jackpots</b>`,
    `• <code>1,000 vXLM → 1,000 XLM</code> goal (<code>4.00x</code>, <code>0.00%</code> cliff)`,
    `• Buys: <code>0.30%</code> (&lt;250 → +5K) · <code>0.50%</code> (250–500 → +10K) · <code>0.25%</code> (500–1K → +25K)`,
    `• Escrowed jackpots unlock on grad via <code>claim_jackpot()</code>`,
    `• Sells: <code>1.20%</code> / <code>1.80%</code> / <code>1.50%</code> → LP floor &amp; DEX buyback`,
    ``,
    `<b>2 · Supply, 7Y LP Lock &amp; Keeper Buybacks</b>`,
    `• <code>66%</code> Curve · <code>33%</code> DEX (7Y lock) · <code>0.3%</code> 15d Vest · <code>0.4%</code> Jackpots · <code>0.3%</code> Dev`,
    `• Buybacks: max <code>min(0.25% pool, 0.80 XLM)</code> / <code>300s</code> (+<b>2% XLM</b> rebate)`,
    `• 48h upgrade timelock · Commit-Reveal Sorobits RNG`,
    ``,
    `<b>3 · Burn-to-Chat + King Shout</b>`,
    `• Burn <code>50 / 500 / 5,000+</code> tokens; 👑 decays (24h half-life)`,
    ``,
    `<i>Built by NunaLabs</i>`,
  ].join('\n')

  return {
    text,
    photoUrl: telegramHeroUrl(baseUrl, 'astrogate-bot-banner.png'),
    reply_markup: {
      inline_keyboard: [
        [
          miniAppBtn(
            '🚀 Launch on v4.5',
            '/create',
            baseUrl,
            inGroup,
            'create',
            botUsername,
            hasMainApp,
          ),
          miniAppBtn(
            '🔥 Market',
            '/market',
            baseUrl,
            inGroup,
            'market',
            botUsername,
            hasMainApp,
          ),
        ],
        [cbBtn('⬅️ Home', 'nav:home:e')],
      ],
    },
  }
}

export function buildHelpView(
  _lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
  hasMainApp = false,
): BotRenderedView {
  const text = [
    `❓ <b>AstroGate Commands · @${botUsername}</b>`,
    ``,
    `/market — Live bonding curves &amp; DEX pairs`,
    `/launch — Launch a fair token on v4.5`,
    `/token <code>CA…</code> or <code>ASTRO</code> — Live token inspector`,
    `/wallet <code>@user</code> — Look up linked AstroID wallet`,
    `/rules — Fair-Flywheel v4.5 fee &amp; LP rules`,
    `/ask <code>question</code> — Instant protocol Q&amp;A`,
    ``,
    `💡 <i>Inline:</i> <code>@${botUsername} ASTRO</code> · 🛡 Never paste secret seeds <code>S…</code> in chat.`,
    `<i>Built by NunaLabs</i>`,
  ].join('\n')

  return {
    text,
    photoUrl: telegramHeroUrl(baseUrl, 'astrogate-bot-banner.png'),
    reply_markup: {
      inline_keyboard: [
        [
          miniAppBtn(
            '🌊 AstroGate Mini App',
            '/',
            baseUrl,
            inGroup,
            'home',
            botUsername,
            hasMainApp,
          ),
        ],
        [
          cbBtn('🧬 Sorobits', 'nav:sbt:e'),
          cbBtn('🔥 Market', 'nav:mkt:e'),
          cbBtn('⬅️ Home', 'nav:home:e'),
        ],
      ],
    },
  }
}

export function buildTokenInspectorView(
  tokenId: string,
  data: TokenInspectorData | null,
  _lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
  hasMainApp = false,
  stellarNetwork: 'testnet' | 'mainnet' = 'testnet',
): BotRenderedView {
  const explorerUrl = `https://stellar.expert/explorer/${explorerNetworkSegment(stellarNetwork)}/contract/${encodeURIComponent(tokenId)}`

  if (!data) {
    return {
      text: [
        `🔍 <b>Contract</b> <code>${tokenId}</code>`,
        ``,
        `⚠️ Could not read SEP-41 metadata on Stellar Testnet right now.`,
      ].join('\n'),
      reply_markup: {
        inline_keyboard: [
          [
            miniAppBtn(
              '⚡ Open in App',
              `/token/${tokenId}`,
              baseUrl,
              inGroup,
              tokenId,
              botUsername,
              hasMainApp,
            ),
          ],
          [
            { text: '🔗 Stellar Expert', url: explorerUrl },
            cbBtn('🔄 Retry', `t:${tokenId}:e`),
          ],
          [cbBtn('⬅️ Home', 'nav:home:e')],
        ],
      },
    }
  }

  const safeName = escapeHtml(data.name)
  const safeSym = escapeHtml(data.symbol)
  const isDexGraduated = Boolean(
    data.curve?.graduated || (!data.curve && data.dexReserveXlm !== null && data.dexReserveXlm > 0n),
  )
  const lines: string[] = [
    `${isDexGraduated ? '🎓' : '⚡'} <b>$${safeSym}</b> · ${safeName}`,
    `<code>${tokenId}</code>`,
    ``,
  ]

  if (data.curve) {
    if (data.curve.graduated) {
      lines.push(`✅ <b>Graduated on Soroswap DEX</b> · 7Y LP Lock / Protected`)
      if (data.dexReserveXlm !== null && data.dexReserveXlm > 0n) {
        lines.push(`💧 DEX Liquidity: <b>${formatXlm(data.dexReserveXlm, 2)} XLM</b>`)
      }
      if (data.curve.buybackXlmReserve > 0n) {
        lines.push(
          `🔥 Buyback Reserve: <b>${formatXlm(data.curve.buybackXlmReserve, 2)} XLM</b> (+2% keeper rebate)`,
        )
      }
      if (data.curve.burnVaultRemaining > 0n) {
        lines.push(
          `🏛 Legacy Burn Vault: Milestone <b>${data.curve.burnMilestoneStage}/2</b> (${formatTokensCompact(data.curve.burnVaultRemaining, data.decimals)} left)`,
        )
      }
    } else {
      const pct = curvePercent(data.curve.curveXlmNet)
      const soldPct =
        TOTAL_CURVE_ALLOCATION > 0n
          ? Number((data.curve.tokensSold * 1000n) / TOTAL_CURVE_ALLOCATION) / 10
          : 0
      lines.push(
        `📈 <b>Bonding Curve:</b> <code>${progressBar(pct, 10)}</code> <b>${pct.toFixed(1)}%</b>`,
        `💎 Vault: <b>${formatXlm(data.curve.curveXlmNet, 2)} / 1,000 XLM</b>`,
        `🪙 Sold: <b>${formatTokensCompact(data.curve.tokensSold, data.decimals)}</b> (${soldPct.toFixed(1)}% curve)`,
        `⚡ Curve buy fees: <code>0.30% / 0.50% / 0.25%</code> · +40K Jackpots`,
      )
    }
    lines.push(`👤 Creator: <code>${shortAddr(data.curve.creator)}</code>`)
  } else {
    if (data.dexReserveXlm !== null && data.dexReserveXlm > 0n) {
      lines.push(`✅ <b>Active on Soroswap DEX</b>`)
      lines.push(`💧 Soroswap Liquidity: <b>${formatXlm(data.dexReserveXlm, 2)} XLM</b>`)
    }
    lines.push(`🪙 Supply: <b>${formatTokensCompact(data.totalSupply, data.decimals)} $${safeSym}</b>`)
  }

  if (data.kingShout) {
    lines.push(
      ``,
      `<blockquote>👑 <b>King Shout</b> (${formatTokensCompact(data.kingShout.amount, data.decimals)} $${safeSym} burned)\n“${escapeHtml(data.kingShout.message.slice(0, 140))}”</blockquote>`,
    )
  }

  lines.push(``, `<i>Built by NunaLabs</i>`)

  return {
    text: lines.join('\n'),
    reply_markup: {
      inline_keyboard: [
        [
          miniAppBtn(
            `⚡ Trade $${data.symbol.slice(0, 12)}`,
            `/token/${tokenId}`,
            baseUrl,
            inGroup,
            tokenId,
            botUsername,
            hasMainApp,
          ),
        ],
        [
          cbBtn('💬 Shouts', `s:${tokenId}:e`),
          cbBtn('🔄 Refresh', `t:${tokenId}:e`),
          {
            text: '📊 AstroDex X-Ray',
            url: `https://t.me/AstroDexBot/dex?startapp=${encodeURIComponent(`token_${tokenId}`)}`,
          },
          { text: '🔗 Explorer', url: explorerUrl },
        ],
        [
          cbBtn('🔥 Market', 'nav:mkt:e'),
          cbBtn('⛰️ King of Hill', 'nav:koth:e'),
        ],
      ],
    },
  }
}

export function buildAccountInspectorView(
  accountId: string,
  account: AccountSummaryData | null,
  _lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
  hasMainApp = false,
  stellarNetwork: 'testnet' | 'mainnet' = 'testnet',
): BotRenderedView {
  const safeAccountId = escapeHtml(accountId)
  const explorerUrl = `https://stellar.expert/explorer/${explorerNetworkSegment(stellarNetwork)}/account/${encodeURIComponent(accountId)}`

  const text = !account
    ? `👛 <b>Account</b> <code>${safeAccountId}</code>\n\n⚠️ Could not reach Horizon Testnet right now.`
    : !account.funded
      ? [
          `👛 <b>Stellar Account</b>`,
          `<code>${safeAccountId}</code>`,
          ``,
          `💤 <b>Unfunded on Testnet (0 XLM)</b>`,
          `Open your Wallet in the Mini App to fund it for free with <code>10,000 XLM</code> via Friendbot.`,
        ].join('\n')
      : [
          `👛 <b>Stellar Account · Testnet</b>`,
          `<code>${safeAccountId}</code>`,
          ``,
          `💎 <b>XLM Balance:</b> <code>${escapeHtml(account.xlmBalance)} XLM</code>`,
          `🪙 <b>Trustlines / Assets:</b> ${account.assetCount}`,
        ].join('\n')

  return {
    text,
    reply_markup: {
      inline_keyboard: [
        [
          miniAppBtn(
            '👛 Open Portfolio App',
            '/portfolio',
            baseUrl,
            inGroup,
            'portfolio',
            botUsername,
            hasMainApp,
          ),
        ],
        [
          { text: '🛡️ AstroWallet', url: 'https://t.me/AstroWalletAppBot/wallet' },
          { text: '🔗 Stellar Expert', url: explorerUrl },
          cbBtn('🔄 Refresh', `a:${accountId}:e`),
        ],
        [cbBtn('⬅️ Home', 'nav:home:e')],
      ],
    },
  }
}

export function buildSecretKeyWarningView(
  _lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  deletedInGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
  hasMainApp = false,
): BotRenderedView {
  const text = [
    `🚨 <b>Security Warning!</b>`,
    ``,
    deletedInGroup
      ? `A <b>Stellar Secret Seed (<code>S…</code>)</b> was detected and <b>auto-deleted from the chat</b> to protect your account.`
      : `It looks like you pasted a <b>Stellar Secret Seed (<code>S…</code>)</b> in chat.`,
    `For your safety:`,
    deletedInGroup ? '' : `• <b>Delete that message</b> right away.`,
    `• This bot <b>never stores or reads private keys</b>.`,
    `• Rotate the key immediately if it controls real funds.`,
    `• Only import test keys locally inside the encrypted <b>Mini App Vault</b>.`,
  ]
    .filter(Boolean)
    .join('\n')

  return {
    text,
    reply_markup: {
      inline_keyboard: [
        [
          miniAppBtn(
            '🔐 Open Encrypted Vault',
            '/portfolio',
            baseUrl,
            inGroup,
            'portfolio',
            botUsername,
            hasMainApp,
          ),
        ],
        [cbBtn('⬅️ Home', 'nav:home:e')],
      ],
    },
  }
}

export function buildModerationWarningView(
  reason: 'scam_phrase' | 'phishing_link',
  deletedInGroup: boolean,
  botUsername = DEFAULT_BOT_USERNAME,
): BotRenderedView {
  const detail =
    reason === 'phishing_link'
      ? 'Suspicious shortened or unverified phishing link detected.'
      : 'Known wallet-drainer / fake airdrop phishing pattern detected.'
  return {
    text: [
      `🛡️ <b>AstroGate Anti-Scam Guard</b>`,
      ``,
      `${detail} ${deletedInGroup ? 'Message auto-removed.' : 'Please treat this message with caution.'}`,
      `Official Astro surfaces are strictly <b>@${botUsername}</b>, <b>@AstroSoroban</b>, <b>@AstroWalletAppBot</b>, <b>@AstroDexBot</b>, and <b>@AstroGateFeed</b>.`,
    ].join('\n'),
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '🔐 Open Official Mini App',
            url: miniAppStartUrl(botUsername, 'home'),
          },
        ],
      ],
    },
  }
}

export function buildInvalidTokenUsageView(
  _lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
  hasMainApp = false,
  flagshipTokenId = 'CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE',
): BotRenderedView {
  const text = [
    `🔍 <b>Inspect On-Chain Token</b>`,
    ``,
    `Send <code>/token</code> with a ticker (e.g. <code>/token ASTRO</code>) or a 56-char <code>CA…</code> contract address.`,
  ].join('\n')

  return {
    text,
    reply_markup: {
      inline_keyboard: [
        [cbBtn('🔥 Live Curves', 'nav:mkt:e')],
        [
          miniAppBtn(
            '⚡ ASTRO Flagship',
            `/token/${flagshipTokenId}`,
            baseUrl,
            inGroup,
            flagshipTokenId,
            botUsername,
            hasMainApp,
          ),
          cbBtn('⬅️ Home', 'nav:home:e'),
        ],
      ],
    },
  }
}

export function buildKingOfTheHillView(
  items: MarketTokenSummary[],
  leaderShout: {
    symbol: string
    amount: bigint
    decimals: number
    message: string
    tokenId: string
  } | null,
  _lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
  hasMainApp = false,
): BotRenderedView {
  const activeCurves = items.filter((i) => !i.graduated).slice(0, 3)
  const lines: string[] = [`⛰️ <b>King of the Hill · Graduation Race</b>`, ``]

  if (activeCurves.length === 0) {
    lines.push(
      `🚀 No active pre-graduation curves right now. Launch the next token to claim the hill!`,
    )
  } else {
    activeCurves.forEach((item, idx) => {
      const medal = idx === 0 ? '👑' : idx === 1 ? '🥈' : '🥉'
      const pct = curvePercent(item.curveXlmNet)
      const bar = progressBar(pct, 10)
      lines.push(
        `${medal} <b>$${escapeHtml(item.symbol)}</b> · ${escapeHtml(item.name)}`,
        `└ <code>${bar}</code> <b>${pct.toFixed(1)}%</b> (${formatXlm(item.curveXlmNet, 1)}/1,000 XLM)`,
        ``,
      )
    })
  }

  if (leaderShout) {
    lines.push(
      `<blockquote>👑 <b>King Shout ($${escapeHtml(leaderShout.symbol)})</b> · ${formatTokensCompact(leaderShout.amount, leaderShout.decimals)} burned\n“${escapeHtml(leaderShout.message.slice(0, 140))}”</blockquote>`,
      ``,
    )
  }

  lines.push(
    `<i>Burn tokens in the Mini App to steal the King Shout throne or push a curve to 100% on Soroswap.</i>`,
    `<i>Built by NunaLabs</i>`,
  )

  const leadToken = activeCurves[0] ?? items[0]
  const keyboard: InlineKeyboardButton[][] = []
  if (leadToken) {
    keyboard.push([
      miniAppBtn(
        `👑 Claim Hill · $${leadToken.symbol.slice(0, 10)}`,
        `/token/${leadToken.id}`,
        baseUrl,
        inGroup,
        leadToken.id,
        botUsername,
        hasMainApp,
      ),
    ])
  }
  keyboard.push([
    miniAppBtn(
      '🚀 Launch New Token',
      '/create',
      baseUrl,
      inGroup,
      'create',
      botUsername,
      hasMainApp,
    ),
    cbBtn('🔄 Refresh', 'nav:koth:e'),
  ])
  keyboard.push([
    cbBtn('🔥 Market', 'nav:mkt:e'),
    cbBtn('⬅️ Home', 'nav:home:e'),
  ])

  return {
    text: lines.join('\n'),
    photoUrl: telegramHeroUrl(baseUrl, 'market-hero-card.png'),
    reply_markup: { inline_keyboard: keyboard },
  }
}

export interface TelegramInlineArticle {
  type: 'article'
  id: string
  title: string
  description: string
  input_message_content: {
    message_text: string
    parse_mode: 'HTML'
    disable_web_page_preview: boolean
  }
  reply_markup: {
    inline_keyboard: InlineKeyboardButton[][]
  }
}

export function buildInlineMarketResults(
  items: MarketTokenSummary[],
  query: string,
  botUsername = DEFAULT_BOT_USERNAME,
  hasMainApp = false,
): TelegramInlineArticle[] {
  const q = query.trim().toLowerCase()
  const filtered = q
    ? items.filter(
        (item) =>
          item.symbol.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q) ||
          item.id.toLowerCase().includes(q),
      )
    : items

  return filtered.slice(0, 8).map((item) => {
    const safeName = escapeHtml(item.name)
    const safeSym = escapeHtml(item.symbol)
    const pct = curvePercent(item.curveXlmNet)
    const statusLine = item.graduated
      ? `🎓 Graduated on Soroswap DEX · ${item.reserveXlmStroops > 0n ? `${formatXlm(item.reserveXlmStroops, 1)} XLM TVL` : '7Y LP Lock'}`
      : `⚡ Bonding Curve ${pct.toFixed(1)}% (${formatXlm(item.curveXlmNet, 1)}/1,000 XLM)`

    return {
      type: 'article',
      id: item.id.slice(0, 64),
      title: `${item.graduated ? '🎓' : '⚡'} $${item.symbol} · ${item.name}`,
      description: item.graduated
        ? 'Graduated on Soroswap DEX · 7Y LP Lock / Protected'
        : `${pct.toFixed(1)}% curve · ${formatXlm(item.curveXlmNet, 1)}/1,000 XLM`,
      input_message_content: {
        message_text: [
          `🌊🚀 <b>$${safeSym}</b> · ${safeName}`,
          statusLine,
          `<code>${item.id}</code>`,
          `<i>Built by NunaLabs</i>`,
        ].join('\n'),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      },
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: `⚡ Trade $${item.symbol.slice(0, 12)}`,
              url: miniAppStartUrl(botUsername, item.id, hasMainApp),
            },
            {
              text: '🚀 Launch App',
              url: miniAppStartUrl(botUsername, 'create', hasMainApp),
            },
          ],
        ],
      },
    }
  })
}

export function buildShoutsView(
  tokenId: string,
  data: TokenShoutsData | null,
  _lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
  hasMainApp = false,
  stellarNetwork: 'testnet' | 'mainnet' = 'testnet',
): BotRenderedView {
  const safeTokenId = escapeHtml(tokenId)
  const explorerUrl = `https://stellar.expert/explorer/${explorerNetworkSegment(stellarNetwork)}/contract/${encodeURIComponent(tokenId)}`

  if (!data) {
    return {
      text: `🔥 <b>Burn-to-Chat</b> <code>${safeTokenId}</code>\n\n⚠️ Could not read on-chain shouts right now.`,
      reply_markup: {
        inline_keyboard: [
          [
            miniAppBtn(
              '💬 Open On-Chain Chat',
              `/token/${tokenId}`,
              baseUrl,
              inGroup,
              tokenId,
              botUsername,
              hasMainApp,
            ),
          ],
          [cbBtn('⬅️ Home', 'nav:home:e')],
        ],
      },
    }
  }

  const safeSym = escapeHtml(data.symbol)
  const safeName = escapeHtml(data.name)
  const lines: string[] = [
    `🔥 <b>Burn-to-Chat · $${safeSym}</b> (${safeName})`,
    `<code>${tokenId}</code>`,
    ``,
  ]

  if (data.kingShout) {
    lines.push(
      `<blockquote>👑 <b>King Shout</b> · ${formatTokensCompact(data.kingShout.amount, data.decimals)} $${safeSym} burned (${shortAddr(data.kingShout.sender)})\n“${escapeHtml(data.kingShout.message.slice(0, 140))}”</blockquote>`,
      ``,
    )
  }

  const recent = data.shouts.slice(-5).reverse()
  if (recent.length === 0) {
    lines.push(
      `💤 No burned shouts yet on this token. Be the first to burn & shout in the Mini App!`,
    )
  } else {
    lines.push(`<b>Latest on-chain shouts:</b>`)
    for (const s of recent) {
      lines.push(
        `• <code>${shortAddr(s.sender)}</code> 🔥-${formatTokensCompact(s.amount, data.decimals)} $${safeSym}: “${escapeHtml(s.message.slice(0, 100))}”`,
      )
    }
  }

  lines.push(``, `<i>Built by NunaLabs</i>`)

  return {
    text: lines.join('\n'),
    reply_markup: {
      inline_keyboard: [
        [
          miniAppBtn(
            `🔥 Burn & Reply · $${data.symbol.slice(0, 10)}`,
            `/token/${tokenId}`,
            baseUrl,
            inGroup,
            tokenId,
            botUsername,
            hasMainApp,
          ),
        ],
        [
          { text: '🔗 Stellar Expert', url: explorerUrl },
          cbBtn('📊 Token Card', `t:${tokenId}:e`),
        ],
      ],
    },
  }
}

export function buildRewardsView(
  _lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
  checkedAccount?: AccountSummaryData | null,
  hasMainApp = false,
): BotRenderedView {
  const lines: string[] = [
    `🎁 <b>AstroGate Rewards &amp; Bounties</b>`,
    ``,
    `<blockquote>Community &amp; Testnet Arena Program · Built by NunaLabs</blockquote>`,
    ``,
    `<b>How to earn ranks &amp; rewards:</b>`,
    `• 👑 <b>King Shout:</b> Burn tokens in the app to hold the on-chain throne`,
    `• ⛰️ <b>King of the Hill:</b> Join weekly Launch Sprints to graduate curves to Soroswap`,
    `• 🚀 <b>Fair Launchers:</b> Create tokens &amp; share your live card in Community`,
    `• 🛡️ <b>Bug Hunters:</b> Report reproducible issues with Stellar tx hashes`,
    ``,
    `<i>Check your wallet eligibility anytime with <code>/claim GA...</code>. Currently on Stellar Testnet (free XLM via Friendbot); real token rewards launch with Mainnet.</i>`,
  ]

  if (checkedAccount) {
    lines.push(
      ``,
      checkedAccount.funded
        ? `✅ <b>Wallet Verified:</b> <code>${shortAddr(checkedAccount.accountId)}</code> · <code>${escapeHtml(checkedAccount.xlmBalance)} XLM</code> (${checkedAccount.assetCount} assets)`
        : `⚠️ <b>Wallet Unfunded on Testnet:</b> <code>${shortAddr(checkedAccount.accountId)}</code> — Tap Open Wallet below to fund with Friendbot first.`,
    )
  }

  return {
    text: lines.join('\n'),
    photoUrl: telegramHeroUrl(baseUrl, 'wallet-quests-card.png'),
    reply_markup: {
      inline_keyboard: [
        [
          miniAppBtn(
            '👛 Open Wallet & Faucet',
            '/portfolio',
            baseUrl,
            inGroup,
            'wallet',
            botUsername,
            hasMainApp,
          ),
          miniAppBtn(
            '⛰️ Open Market',
            '/market',
            baseUrl,
            inGroup,
            'market',
            botUsername,
            hasMainApp,
          ),
        ],
        [
          cbBtn('🏆 Quests & Badges', 'nav:qst:e'),
          cbBtn('⛰️ King of Hill', 'nav:koth:e'),
          cbBtn('⬅️ Home', 'nav:home:e'),
        ],
      ],
    },
  }
}

export function buildQuestsView(
  _lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
  progress?: QuestProgressSummary | null,
  hasMainApp = false,
): BotRenderedView {
  const header = progress
    ? `🏆 <b>Sorobits Quests (SBIT)</b> · <code>${shortAddr(progress.accountId)}</code> (<b>${progress.unlockedCount}/${ASTROGATE_QUEST_BADGES.length}</b>)`
    : `🏆 <b>Sorobits (SBIT) · 100% On-Chain Season 1 NFTs</b>`

  const lines: string[] = [
    header,
    ``,
    `<blockquote>Complete on-chain quests on Stellar Soroban to earn Sorobits (100% on-chain 32×32 SVG SEP-50 NFTs) &amp; unlock chat ranks, sprint boosts &amp; Feed priority.</blockquote>`,
    ``,
  ]

  if (progress) {
    const perks = computePilotPerks(progress)
    const heldCount = progress.sorobitsBalance ?? 0
    const heldIds =
      progress.sorobitsIds && progress.sorobitsIds.length > 0
        ? ` (${progress.sorobitsIds.slice(0, 6).map((id) => `#${id}`).join(', ')})`
        : ''
    lines.push(
      `🪪 <b>Chat Rank:</b> ${perks.chatTitle} · <b>Sprint Boost:</b> <code>${perks.sprintMultiplier}</code>`,
      `🧬 <b>On-Chain Sorobits Held:</b> <code>${heldCount} SBIT</code>${heldIds}`,
      `📡 <b>Live Feed Priority:</b> ${perks.feedPriority ? '✅ Active' : '🔒 Unlock AGQ02/04'} · 🔐 <b>VIP Alpha:</b> ${perks.vipAlphaAccess ? '✅ Eligible' : '🔒 Unlock AGQ04/07'}`,
      ``,
    )
  }

  for (const badge of ASTROGATE_QUEST_BADGES) {
    const isUnlocked = progress ? progress.unlocked[badge.id] : false
    const statusIcon = progress ? (isUnlocked ? '✅' : '🔒') : badge.emoji
    lines.push(
      `${statusIcon} <code>${badge.assetCode}</code> <b>${badge.title}</b> (${badge.tier})`,
    )
  }

  lines.push(
    ``,
    progress
      ? `<i>Open Portfolio or Sorobits in the Mini App to view and claim your NFTs.</i>`
      : `💡 <i>Run <code>/quests GA...</code> to verify Sorobits badges live on-chain.</i>`,
    `<i>Built by NunaLabs</i>`,
  )

  return {
    text: lines.join('\n'),
    photoUrl: telegramHeroUrl(baseUrl, 'wallet-quests-card.png'),
    reply_markup: {
      inline_keyboard: [
        [
          miniAppBtn(
            '🧬 Open Sorobits Page',
            '/sorobits',
            baseUrl,
            inGroup,
            'sorobits',
            botUsername,
            hasMainApp,
          ),
          miniAppBtn(
            '🏅 View Portfolio',
            '/portfolio',
            baseUrl,
            inGroup,
            'portfolio',
            botUsername,
            hasMainApp,
          ),
        ],
        [
          cbBtn('🎁 Rewards', 'nav:rew:e'),
          cbBtn('⛰️ King of Hill', 'nav:koth:e'),
          cbBtn('⬅️ Home', 'nav:home:e'),
        ],
      ],
    },
  }
}

export function buildGroupWelcomeView(
  firstName: string | undefined,
  botUsername = DEFAULT_BOT_USERNAME,
  folderUrl?: string,
  hasMainApp = false,
): BotRenderedView {
  const safeName = firstName ? escapeHtml(firstName.trim().slice(0, 32)) : 'Pilot'
  const keyboard: InlineKeyboardButton[][] = [
    [
      {
        text: '🛡️ AstroWallet',
        url: 'https://t.me/AstroWalletAppBot/wallet',
      },
      {
        text: '⚡ AstroDex',
        url: 'https://t.me/AstroDexBot/dex',
      },
    ],
    [
      {
        text: '🚀 AstroGate',
        url: miniAppStartUrl(botUsername, 'home', hasMainApp),
      },
      ...(folderUrl && folderUrl.startsWith('https://t.me/')
        ? [{ text: '📁 Astro Folder', url: folderUrl }]
        : [{ text: '📡 Live Feed', url: 'https://t.me/AstroGateFeed' }]),
    ],
  ]

  return {
    photoUrl: telegramHeroUrl(DEFAULT_APP_BASE_URL, 'astro-ecosystem-banner.png'),
    text: [
      `👋 <b>Welcome to Astro Soroban, ${safeName}!</b>`,
      ``,
      `• <b>AstroWallet</b> — Vault, <code>/pay</code>, <code>/split</code>`,
      `• <b>AstroDex</b> — Charts, <code>/scan</code>, <code>/route</code>, <code>/whales</code>`,
      `• <b>AstroGate</b> — Launchpad, <code>/market</code>, <code>/token</code>`,
      `🛡️ <i>Admins never DM first · Never share your <code>S…</code> key.</i>`,
    ].join('\n'),
    reply_markup: { inline_keyboard: keyboard },
  }
}

export function buildCommunityDigestView(
  items: MarketTokenSummary[],
  _sorobitsTotal: number,
  botUsername = DEFAULT_BOT_USERNAME,
  folderUrl?: string,
  hasMainApp = false,
): BotRenderedView {
  const active = items.filter((i) => !i.graduated).slice(0, 3)
  const graduated = items.filter((i) => i.graduated).slice(0, 2)
  const lines: string[] = [
    `📡 <b>AstroGate Live Feed · Stellar Testnet</b>`,
    ``,
  ]

  if (active.length > 0) {
    lines.push(`<b>⛰️ Closest to Graduation (1,000 XLM):</b>`)
    active.forEach((item, idx) => {
      const pct = curvePercent(item.curveXlmNet)
      const medal = idx === 0 ? '👑' : idx === 1 ? '🥈' : '🥉'
      lines.push(
        `${medal} <b>$${escapeHtml(item.symbol)}</b> · <code>${progressBar(pct, 8)}</code> <b>${pct.toFixed(1)}%</b>`,
      )
    })
    lines.push('')
  }

  if (graduated.length > 0) {
    lines.push(
      `<b>🎓 Active DEX Pairs:</b> ${graduated
        .map((g) => `$${escapeHtml(g.symbol)}`)
        .join(' · ')}`,
    )
  }

  lines.push(
    ``,
    `<i>Use <code>/market</code> or <code>/token TICKER</code> in @AstroSoroban.</i>`,
  )

  const keyboard: InlineKeyboardButton[][] = [
    [
      {
        text: '🔥 Trade Curves',
        url: miniAppStartUrl(botUsername, 'market', hasMainApp),
      },
      ...(folderUrl && folderUrl.startsWith('https://t.me/')
        ? [{ text: '💬 Community', url: 'https://t.me/AstroSoroban' }]
        : [
            {
              text: '🚀 Launch Token',
              url: miniAppStartUrl(botUsername, 'create', hasMainApp),
            },
          ]),
    ],
    ...(folderUrl && folderUrl.startsWith('https://t.me/')
      ? [[{ text: '🚀 Launch Token', url: miniAppStartUrl(botUsername, 'create', hasMainApp) }]]
      : [[{ text: '💬 Community', url: 'https://t.me/AstroSoroban' }]]),
  ]

  return {
    text: lines.join('\n'),
    reply_markup: { inline_keyboard: keyboard },
  }
}

export function buildAiAnswerView(
  answer: string,
  poweredByAi: boolean,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
  hasMainApp = false,
): BotRenderedView {
  const badge = poweredByAi
    ? '🤖 <b>AstroGate Assistant</b>'
    : '🧭 <b>AstroGate Quick Guide</b>'

  return {
    text: [
      badge,
      ``,
      escapeHtml(answer),
      ``,
      `<i>Built by NunaLabs · Not financial advice</i>`,
    ].join('\n'),
    reply_markup: {
      inline_keyboard: [
        [
          miniAppBtn(
            '🔥 Live Market',
            '/market',
            baseUrl,
            inGroup,
            'market',
            botUsername,
            hasMainApp,
          ),
          miniAppBtn(
            '🚀 Launch Token',
            '/create',
            baseUrl,
            inGroup,
            'create',
            botUsername,
            hasMainApp,
          ),
        ],
        [
          cbBtn('📊 Curves', 'nav:mkt:e'),
          cbBtn('🧬 Sorobits', 'nav:sbt:e'),
          cbBtn('❓ Help', 'nav:help:e'),
        ],
      ],
    },
  }
}
