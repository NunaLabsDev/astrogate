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

export function detectStellarAddress(
  text: string,
): { kind: 'contract' | 'account' | 'secret'; value: string } | null {
  const tokens = text.trim().split(/\s+/)
  // Always prioritize Stellar secret seeds (S...) anywhere in the message
  // so pasting "CA... SB..." still triggers immediate auto-deletion & warning.
  for (const raw of tokens) {
    const clean = raw.replace(/[^A-Z2-7]/g, '')
    if (isSecretSeed(clean)) return { kind: 'secret', value: clean }
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
): string {
  const base = `https://t.me/${botUsername}`
  const param = startParam || 'home'
  if (hasMainApp) {
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

function shareUrl(botUsername: string): string {
  const target = `https://t.me/${botUsername}?start=home`
  const caption =
    'Launch or trade fair memecoins on Stellar Soroban with 7-year locked DEX liquidity on AstroGate.'
  return `https://t.me/share/url?url=${encodeURIComponent(target)}&text=${encodeURIComponent(caption)}`
}

export function buildWelcomeView(
  firstName: string | undefined,
  _lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  botUsername = DEFAULT_BOT_USERNAME,
  inGroup = false,
  opts?: { hasMainApp?: boolean; folderUrl?: string },
): BotRenderedView {
  const safeName = firstName ? escapeHtml(firstName.trim().slice(0, 32)) : ''
  const hasMainApp = Boolean(opts?.hasMainApp)
  const greet = safeName ? `👋 <b>Hey, ${safeName}</b>` : '👋 <b>Welcome</b>'
  const text = [
    `🌊🚀 <b>AstroGate</b> · <code>Stellar Testnet</code>`,
    `${greet}`,
    ``,
    `<blockquote>Fair-Flywheel v4.4 · 10M fixed supply · 40K Checkpoint Jackpots · 7Y LP lock</blockquote>`,
    ``,
    `⚡ <b>3-Stage Curve:</b> <code>0.30% → 0.50% → 0.25%</code> buy · +5K / +10K / +25K prizes`,
    `🔥 <b>Real flywheel:</b> Auto DEX Buyback &amp; Burn + Burn-to-Chat`,
    `🧬 <b>Sorobits NFTs:</b> 100% on-chain 32×32 genomic SVG art (SEP-50)`,
    `🔐 <b>Self-custody:</b> Encrypted wallet synced with Telegram CloudStorage`,
    ``,
    `<i>Tap any button below, paste a <code>CA…</code> / <code>GA…</code> address, or ask me anything in plain English.</i>`,
    `<i>Built by NunaLabs</i>`,
  ].join('\n')

  const keyboard: InlineKeyboardButton[][] = [
    [
      miniAppBtn(
        '🌊 Open AstroGate Mini App',
        '/',
        baseUrl,
        inGroup,
        'home',
        botUsername,
        hasMainApp,
      ),
    ],
    [
      miniAppBtn(
        '🧬 Sorobits NFTs',
        '/sorobits',
        baseUrl,
        inGroup,
        'sorobits',
        botUsername,
        hasMainApp,
      ),
      miniAppBtn(
        '🔥 Live Market',
        '/market',
        baseUrl,
        inGroup,
        'market',
        botUsername,
        hasMainApp,
      ),
    ],
    [
      miniAppBtn(
        '🚀 Launch Token',
        '/create',
        baseUrl,
        inGroup,
        'create',
        botUsername,
        hasMainApp,
      ),
      miniAppBtn(
        '👛 My Wallet',
        '/portfolio',
        baseUrl,
        inGroup,
        'wallet',
        botUsername,
        hasMainApp,
      ),
    ],
    [
      cbBtn('📊 Curves', 'nav:mkt:e'),
      cbBtn('🏆 Quests', 'nav:qst:e'),
      cbBtn('🧬 SBIT', 'nav:sbt:e'),
      { text: '📤 Share', url: shareUrl(botUsername) },
    ],
  ]

  if (opts?.folderUrl && opts.folderUrl.startsWith('https://t.me/')) {
    keyboard.push([{ text: '📁 Join All 3 AstroGate Chats', url: opts.folderUrl }])
  }

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
      `<blockquote>32×32 Genomic Pixel Art rendered natively from Stellar Soroban SVG — zero IPFS &amp; zero Pinata.</blockquote>`,
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
): BotRenderedView {
  const rows: string[] = [`🔥 <b>Live Fair-Flywheel Market</b> · <code>Testnet</code>`, '']

  if (items.length === 0) {
    rows.push(
      rpcFailed
        ? '⚠️ Soroban RPC timed out right now. Tap Refresh or open the Mini App.'
        : '🚀 No active curves found yet. Launch the first v4.4 token!',
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
    `📊 <b>v4.4 Split:</b> <code>66%</code> Curve · <code>33%</code> DEX · <code>0.3%</code> Vest · <code>0.4%</code> Jackpots · <code>0.3%</code> Dev`,
    `🔒 <b>Anti-Rug:</b> Creator seed locked until <code>1,000 XLM</code> graduation`,
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
          cbBtn('⚙️ v4.4 Rules', 'nav:v42:e'),
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
  const text = resolved
    ? [
        `🪪 <b>@${escapeHtml(resolved.username)} · Linked Native Wallet</b>`,
        ``,
        `✅ <b>Status:</b> ${resolved.verifiedTelegram ? 'Verified Telegram Identity' : 'Self-Signed Stellar Link'}`,
        `⭐ <b>Primary Address:</b> <code>${escapeHtml(resolved.primaryPublicKey)}</code>`,
        `🔐 <b>Linked Wallets:</b> <code>${resolved.wallets.length}</code>`,
        ``,
        `<i>Send XLM or tokens directly to @${escapeHtml(resolved.username)} inside AstroGate.</i>`,
      ].join('\n')
    : [
        `🔎 <b>No Native Wallet Linked for ${cleanQuery}</b>`,
        ``,
        `This user has not linked an AstroGate native wallet yet.`,
        `Open the Mini App to create your 1-tap self-custodial wallet and link your <code>@username</code>.`,
      ].join('\n')

  return {
    text,
    reply_markup: {
      inline_keyboard: [
        [
          miniAppBtn(
            '👛 Open Native Wallet',
            '/portfolio',
            baseUrl,
            inGroup,
            'wallet',
            botUsername,
            hasMainApp,
          ),
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
    `👛 <b>AstroGate Native Wallet · @username Linked</b>`,
    ``,
    `<blockquote>100% self-custody: private keys never leave your device unencrypted.</blockquote>`,
    ``,
    `🪪 <b>@username Identity:</b> Cryptographic Ed25519 link to your <code>Primary</code> wallet (up to 10 sub-wallets)`,
    `🔐 <b>Client Encryption:</b> <code>PBKDF2-SHA256</code> + <code>AES-GCM-256</code> under your PIN`,
    `☁️ <b>Telegram ↔ Web Sync:</b> <code>Telegram CloudStorage</code> + portable <code>AGVAULT1:</code> bundles &amp; exportable <code>S…</code> keys`,
    `🚰 <b>Free Testnet XLM:</b> 1-tap <code>10,000 XLM</code> Friendbot faucet inside the app`,
    ``,
    `💡 <i>Tip: run <code>/wallet @username</code> to look up a linked wallet, or paste any <code>GA…</code> address for live balance.</i>`,
  ].join('\n')

  return {
    text,
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
        ],
        [
          cbBtn('📊 Live Curves', 'nav:mkt:e'),
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
    `⚙️ <b>Fair-Flywheel v4.4 · On-Chain Mechanics</b>`,
    ``,
    `<b>1 · 3-Stage Bonding Curve &amp; 40K Checkpoints</b>`,
    `• Virtual depth <code>1,000 vXLM → 1,000 XLM</code> goal (<code>4.00x</code> curve, <code>0.00%</code> cliff at grad)`,
    `• Buys: <code>0.30%</code> (&lt;250 XLM → <code>+5K</code>) · <code>0.50%</code> (250–500 → <code>+10K</code>) · <code>0.25%</code> (500–1K → <code>+25K</code>)`,
    `• Sells: <code>1.20%</code> / <code>1.80%</code> / <code>1.50%</code> → LP floor &amp; DEX buyback`,
    ``,
    `<b>2 · Supply &amp; 7Y LP Lock</b>`,
    `• <code>66%</code> Curve · <code>33%</code> DEX (7Y LP Lock) · <code>0.3%</code> 15d Vest · <code>0.4%</code> Jackpots · <code>0.3%</code> Dev`,
    `• <code>60%</code> of floor fee surplus powers permissionless Soroswap <b>Buyback &amp; Burn</b>`,
    `• Pre-grad P2P transfer lock closes <code>PairAlreadySeeded</code> DEX frontrunning`,
    ``,
    `<b>3 · Burn-to-Chat + King Shout</b>`,
    `• Burn <code>50 / 500 / 5,000+</code> tokens on-chain; 👑 throne decays with 24h half-life`,
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
            '🚀 Launch on v4.4',
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
    `❓ <b>Commands &amp; Safety · @${botUsername}</b>`,
    ``,
    `/start — Main hub &amp; Mini App launchpad`,
    `/market — Live bonding curves &amp; DEX pairs`,
    `/king — King of the Hill race &amp; King Shout throne`,
    `/token <code>CA…</code> or <code>ASTRO</code> — Live on-chain token inspector`,
    `/shouts <code>CA…</code> or <code>ASTRO</code> — Live Burn-to-Chat thread`,
    `/sorobits — 100% on-chain 32×32 SVG NFTs (SEP-50)`,
    `/quests <code>GA…</code> — Season-1 NFT quest progress`,
    `/rewards — Bounties, sprints &amp; <code>/claim GA…</code> check`,
    `/ask <code>question</code> — Instant protocol &amp; market Q&amp;A`,
    `/wallet · /wallet <code>@user</code> — Native multi-wallet &amp; handle lookup`,
    `/launch · /v42 — Launch token &amp; Fair-Flywheel mechanics`,
    ``,
    `💡 <b>Inline:</b> Type <code>@${botUsername} ASTRO</code> in any chat to share a live token card.`,
    `🛡 <b>Security:</b> Never paste your secret seed <code>S…</code> in any Telegram chat.`,
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
): BotRenderedView {
  const explorerUrl = `https://stellar.expert/explorer/testnet/contract/${tokenId}`

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
      lines.push(`✅ <b>Graduated on Soroswap DEX</b> · 100% LP Locked 7Y`)
      if (data.dexReserveXlm !== null && data.dexReserveXlm > 0n) {
        lines.push(`💧 DEX Liquidity: <b>${formatXlm(data.dexReserveXlm, 2)} XLM</b>`)
      }
      if (data.curve.buybackXlmReserve > 0n) {
        lines.push(
          `🔥 Buyback Reserve: <b>${formatXlm(data.curve.buybackXlmReserve, 2)} XLM</b>`,
        )
      }
      lines.push(
        `🏛 Burn Vault: Milestone <b>${data.curve.burnMilestoneStage}/2</b> (${formatTokensCompact(data.curve.burnVaultRemaining, data.decimals)} left)`,
      )
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
): BotRenderedView {
  const safeAccountId = escapeHtml(accountId)
  const explorerUrl = `https://stellar.expert/explorer/testnet/account/${encodeURIComponent(accountId)}`

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
      `Official AstroGate surfaces are strictly <b>@${botUsername}</b>, <b>@AstroGateCommunity</b>, and <b>@AstroGateFeed</b>.`,
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
): BotRenderedView {
  const text = [
    `🔍 <b>Inspect On-Chain Token</b>`,
    ``,
    `Send <code>/token</code> with a ticker (e.g. <code>/token ASTRO</code>) or a 56-char <code>CA…</code> contract address, or paste <code>$TICKER</code> / <code>CA…</code> directly in chat:`,
    `<code>/token CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE</code>`,
  ].join('\n')

  return {
    text,
    reply_markup: {
      inline_keyboard: [
        [cbBtn('🔥 Live Curves', 'nav:mkt:e')],
        [
          miniAppBtn(
            '⚡ ASTRO Flagship',
            '/token/CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE',
            baseUrl,
            inGroup,
            'CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE',
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
      ? `🎓 Graduated on Soroswap DEX · ${item.reserveXlmStroops > 0n ? `${formatXlm(item.reserveXlmStroops, 1)} XLM TVL` : '100% LP Locked 7Y'}`
      : `⚡ Bonding Curve ${pct.toFixed(1)}% (${formatXlm(item.curveXlmNet, 1)}/1,000 XLM)`

    return {
      type: 'article',
      id: item.id.slice(0, 64),
      title: `${item.graduated ? '🎓' : '⚡'} $${item.symbol} · ${item.name}`,
      description: item.graduated
        ? 'Graduated on Soroswap DEX · 100% LP Locked 7Y'
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
): BotRenderedView {
  const safeTokenId = escapeHtml(tokenId)
  const explorerUrl = `https://stellar.expert/explorer/testnet/contract/${encodeURIComponent(tokenId)}`

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
        text: '🌊 Open Mini App',
        url: miniAppStartUrl(botUsername, 'home', hasMainApp),
      },
      {
        text: '🧬 Claim Free AGQ01 NFT',
        url: miniAppStartUrl(botUsername, 'sorobits', hasMainApp),
      },
    ],
    [
      { text: '📡 Live Alerts Feed', url: 'https://t.me/AstroGateFeed' },
      ...(folderUrl && folderUrl.startsWith('https://t.me/')
        ? [{ text: '📁 Add All 3 Chats', url: folderUrl }]
        : [
            {
              text: '🔥 Market',
              url: miniAppStartUrl(botUsername, 'market', hasMainApp),
            },
          ]),
    ],
  ]

  return {
    text: [
      `👋 <b>Welcome to AstroGate Community, ${safeName}!</b>`,
      ``,
      `• 🚀 Launch &amp; trade Fair-Flywheel v4.4 tokens on Stellar Soroban`,
      `• 💬 Paste any <code>$TICKER</code>, <code>CA…</code>, or <code>GA…</code> — or tag <code>@${botUsername}</code> for help`,
      `• 📡 Automated live alerts stream cleanly in @AstroGateFeed`,
      `• 🛡️ Never share your <code>S…</code> secret seed in any chat`,
    ].join('\n'),
    reply_markup: { inline_keyboard: keyboard },
  }
}

export function buildCommunityDigestView(
  items: MarketTokenSummary[],
  sorobitsTotal: number,
  botUsername = DEFAULT_BOT_USERNAME,
  folderUrl?: string,
  hasMainApp = false,
): BotRenderedView {
  const active = items.filter((i) => !i.graduated).slice(0, 3)
  const graduated = items.filter((i) => i.graduated).slice(0, 2)
  const lines: string[] = [
    `🌊📡 <b>AstroGate Community Pulse · Stellar Testnet</b>`,
    ``,
  ]

  if (active.length > 0) {
    lines.push(`<b>⛰️ Closest to Soroswap Graduation (1,000 XLM):</b>`)
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
      `<b>🎓 Active Soroswap DEX Pairs:</b> ${graduated
        .map((g) => `$${escapeHtml(g.symbol)}`)
        .join(' · ')}`,
    )
  }

  lines.push(
    `🧬 <b>Sorobits (SBIT) Minted On-Chain:</b> <code>${sorobitsTotal}</code>`,
    ``,
    `<i>Use <code>/market</code>, <code>/king</code>, <code>/quests GA...</code>, or ask <code>@${botUsername}</code> anything!</i>`,
    `<i>Built by NunaLabs</i>`,
  )

  const keyboard: InlineKeyboardButton[][] = [
    [
      {
        text: '🔥 Trade Live Curves',
        url: miniAppStartUrl(botUsername, 'market', hasMainApp),
      },
      {
        text: '🧬 Sorobits NFTs',
        url: miniAppStartUrl(botUsername, 'sorobits', hasMainApp),
      },
    ],
    [
      { text: '📡 Live Feed', url: 'https://t.me/AstroGateFeed' },
      ...(folderUrl && folderUrl.startsWith('https://t.me/')
        ? [{ text: '📁 All 3 Chats', url: folderUrl }]
        : [
            {
              text: '🚀 Launch Token',
              url: miniAppStartUrl(botUsername, 'create', hasMainApp),
            },
          ]),
    ],
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
