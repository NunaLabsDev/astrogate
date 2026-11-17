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
const TOTAL_CURVE_ALLOCATION = 42_000_000_000_000n // 4,200,000 * 10^7

export function resolveLang(_languageCode?: string): BotLang {
  // Telegram channels, groups, and bot interactions stay strictly in English.
  return 'en'
}

export function langFlag(lang: BotLang): 'e' | 's' {
  return lang === 'es' ? 's' : 'e'
}

export function parseLangFlag(flag?: string): BotLang {
  return flag === 's' || flag === 'es' ? 'es' : 'en'
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
  for (const raw of tokens) {
    const clean = raw.replace(/[^A-Z2-7]/g, '')
    if (isSecretSeed(clean)) return { kind: 'secret', value: clean }
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

export function miniAppStartUrl(
  botUsername = DEFAULT_BOT_USERNAME,
  startParam?: string,
): string {
  const base = `https://t.me/${botUsername}`
  return startParam
    ? `${base}?start=${encodeURIComponent(startParam)}`
    : base
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
): InlineKeyboardButton {
  if (inGroup) {
    return { text, url: miniAppStartUrl(botUsername, startParam) }
  }
  return webAppBtn(text, appUrl(baseUrl, path))
}

function cbBtn(text: string, data: string): InlineKeyboardButton {
  return { text, callback_data: data }
}

function shareUrl(botUsername: string, lang: BotLang, inGroup = false): string {
  const effectiveLang = inGroup ? 'en' : lang
  const target = `https://t.me/${botUsername}`
  const caption =
    effectiveLang === 'es'
      ? 'Lanza o tradea memecoins fair-launch en Stellar Soroban con LP 100% quemada en AstroGate.'
      : 'Launch or trade fair memecoins on Stellar Soroban with 100% LP burned on AstroGate.'
  return `https://t.me/share/url?url=${encodeURIComponent(target)}&text=${encodeURIComponent(caption)}`
}

export function buildWelcomeView(
  firstName: string | undefined,
  lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  botUsername = DEFAULT_BOT_USERNAME,
  inGroup = false,
): BotRenderedView {
  const safeName = firstName ? escapeHtml(firstName.trim().slice(0, 32)) : ''
  const f = langFlag(lang)

  if (lang === 'es') {
    const greet = safeName ? `👋 <b>Hola, ${safeName}</b>` : '👋 <b>Bienvenido</b>'
    const text = [
      `🌊🚀 <b>AstroGate</b> · <code>Stellar Testnet</code>`,
      `${greet}`,
      ``,
      `<blockquote>Fair-Flywheel v4.2 · 10M supply fijo · 100% LP quemada en Soroswap</blockquote>`,
      ``,
      `⚡ <b>Curva justa:</b> <code>0.80%</code> compra plana (sin penalizar ballenas)`,
      `🔥 <b>Flywheel real:</b> Buyback &amp; Burn automático + Burn-to-Chat`,
      `🔐 <b>Auto-custodia:</b> Wallet cifrada sincronizada con tu Telegram`,
      ``,
      `<i>Elige una acción abajo o pega cualquier <code>CA…</code> / <code>GA…</code> en el chat para inspeccionarlo.</i>`,
      `<i>Built by NunaLabs</i>`,
    ].join('\n')

    return {
      text,
      reply_markup: {
        inline_keyboard: [
          [miniAppBtn('🌊 Abrir AstroGate App', '/', baseUrl, inGroup, undefined, botUsername)],
          [
            miniAppBtn('🚀 Lanzar Token', '/create', baseUrl, inGroup, 'create', botUsername),
            miniAppBtn('🔥 Mercado en Vivo', '/market', baseUrl, inGroup, 'market', botUsername),
          ],
          [
            cbBtn('📊 Curvas en Vivo', `nav:mkt:${f}`),
            cbBtn('👛 Mi Wallet', `nav:wal:${f}`),
          ],
          [
            cbBtn('⚙️ Reglas v4.2', `nav:v42:${f}`),
            { text: '📤 Compartir', url: shareUrl(botUsername, lang) },
          ],
        ],
      },
    }
  }

  const greet = safeName ? `👋 <b>Hey, ${safeName}</b>` : '👋 <b>Welcome</b>'
  const text = [
    `🌊🚀 <b>AstroGate</b> · <code>Stellar Testnet</code>`,
    `${greet}`,
    ``,
    `<blockquote>Fair-Flywheel v4.2 · 10M fixed supply · 100% LP burned on Soroswap</blockquote>`,
    ``,
    `⚡ <b>Fair curve:</b> <code>0.80%</code> flat buy fee (zero whale buy penalty)`,
    `🔥 <b>Real flywheel:</b> Auto DEX Buyback &amp; Burn + Burn-to-Chat`,
    `🔐 <b>Self-custody:</b> Encrypted wallet synced with your Telegram`,
    ``,
    `<i>Pick an action below or paste any <code>CA…</code> / <code>GA…</code> address here to inspect it live.</i>`,
    `<i>Built by NunaLabs</i>`,
  ].join('\n')

  return {
    text,
    photoUrl: `${baseUrl.replace(/\/$/, '')}/telegram/astrogate-bot-banner.png`,
    reply_markup: {
      inline_keyboard: [
        [miniAppBtn('🌊 Open AstroGate Mini App', '/', baseUrl, inGroup, undefined, botUsername)],
        [
          miniAppBtn('🧬 Sorobits NFTs', '/sorobits', baseUrl, inGroup, 'sorobits', botUsername),
          miniAppBtn('🔥 Live Market', '/market', baseUrl, inGroup, 'market', botUsername),
        ],
        [
          miniAppBtn('🚀 Launch Token', '/create', baseUrl, inGroup, 'create', botUsername),
          miniAppBtn('👛 My Wallet', '/portfolio', baseUrl, inGroup, 'wallet', botUsername),
        ],
        [
          cbBtn('📊 Curves', `nav:mkt:${f}`),
          cbBtn('🏆 Quests', `nav:qst:${f}`),
          { text: '📤 Share Bot', url: shareUrl(botUsername, lang, inGroup) },
        ],
      ],
    },
  }
}

export function buildSorobitsView(
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
): BotRenderedView {
  const cleanBase = baseUrl.replace(/\/$/, '')
  return {
    photoUrl: `${cleanBase}/telegram/sorobits-hero-card.png`,
    text: [
      `🧬 <b>Sorobits (SBIT) · 100% On-Chain NFTs</b>`,
      ``,
      `<blockquote>32×32 Genomic Pixel Art rendered natively from Stellar Soroban SVG — zero IPFS &amp; zero Pinata.</blockquote>`,
      ``,
      `• <b>Contract:</b> <code>CABTTF2UFJQKQT5PZECGSE5EDIAXH7ET6TSGLZVAPJCN7WC4N7DHIBAT</code>`,
      `• <b>Season 1 (AGQ01–AGQ08):</b> Art &amp; 7 Faction palettes sealed on-chain`,
      `• <b>Genesis #0:</b> Minted &amp; verifiable live via <code>token_uri(0)</code>`,
      ``,
      `<i>Tap below to open Sorobits inside the Telegram Mini App so your encrypted CloudStorage wallet stays connected.</i>`,
      `<i>Built by NunaLabs</i>`,
    ].join('\n'),
    reply_markup: {
      inline_keyboard: [
        [
          miniAppBtn('🧬 Open Sorobits Mini App', '/sorobits', baseUrl, inGroup, 'sorobits', botUsername),
        ],
        [
          miniAppBtn('👛 My Wallet & Quests', '/portfolio', baseUrl, inGroup, 'wallet', botUsername),
          cbBtn('🏆 Season-1 Quests', 'nav:qst:e'),
        ],
      ],
    },
  }
}

export function buildMarketView(
  items: MarketTokenSummary[],
  lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  rpcFailed = false,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
): BotRenderedView {
  const f = langFlag(lang)
  const isEs = lang === 'es'

  const header = isEs
    ? `🔥 <b>Mercado Fair-Flywheel en Vivo</b> · <code>Testnet</code>`
    : `🔥 <b>Live Fair-Flywheel Market</b> · <code>Testnet</code>`

  const rows: string[] = [header, '']

  if (items.length === 0) {
    rows.push(
      rpcFailed
        ? isEs
          ? '⚠️ No pudimos consultar Soroban RPC en este instante. Intenta refrescar o abre la app.'
          : '⚠️ Soroban RPC timed out right now. Tap Refresh or open the Mini App.'
        : isEs
          ? '🚀 Aún no hay curvas activas en esta ventana. ¡Lanza el primer token v4.2!'
          : '🚀 No active curves found yet. Launch the first v4.2 token!',
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
    isEs
      ? '<i>Toca un botón para tradear directo en la Mini App o pega un <code>CA…</code>.</i>'
      : '<i>Tap a token to trade in the Mini App or paste any <code>CA…</code> contract.</i>',
  )

  const tradeRow: InlineKeyboardButton[] = items.slice(0, 3).map((item) =>
    miniAppBtn(
      `${item.graduated ? '🎓' : '⚡'} $${item.symbol.slice(0, 10)}`,
      `/token/${item.id}`,
      baseUrl,
      inGroup,
      item.id,
      botUsername,
    ),
  )

  const keyboard: InlineKeyboardButton[][] = []
  if (tradeRow.length > 0) keyboard.push(tradeRow)
  keyboard.push([
    miniAppBtn(
      isEs ? '🔥 Ver Todo en App' : '🔥 Full Market App',
      '/market',
      baseUrl,
      inGroup,
      'market',
      botUsername,
    ),
  ])
  keyboard.push([
    cbBtn(isEs ? '🔄 Refrescar' : '🔄 Refresh', `nav:mkt:${f}`),
    cbBtn(isEs ? '⛰️ King of Hill' : '⛰️ King of Hill', `nav:koth:${f}`),
  ])

  return {
    text: rows.join('\n'),
    photoUrl: telegramHeroUrl(baseUrl, 'market-hero-card.png'),
    reply_markup: { inline_keyboard: keyboard },
  }
}

export function buildLaunchView(
  lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  directDeepLink = false,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
): BotRenderedView {
  const f = langFlag(lang)
  const isEs = lang === 'es'

  const text = isEs
    ? [
        `🚀 <b>Lanza tu Token Fair-Launch en 1 Tap</b>`,
        ``,
        `<blockquote>Supply fijo <b>10,000,000</b> · Contrato SEP-41 verificado · Ownership renunciado</blockquote>`,
        ``,
        `💰 <b>Costo:</b> <code>7 XLM</code> protocolo + desde <code>2 XLM</code> compra seed inicial`,
        `📊 <b>Reparto v4.2:</b> <code>42%</code> Curva · <code>28%</code> DEX · <code>29.5%</code> Quema · <code>0.5%</code> Vesting 15d`,
        `🔒 <b>Anti-Rug:</b> Seed del creador bloqueado hasta graduar (<code>1,000 XLM</code>)`,
        `🎓 <b>Graduación:</b> Pool automático en Soroswap con <b>100% LP quemada</b>`,
        directDeepLink
          ? `\n👇 <i>Toca abajo para abrir el formulario de creación en Telegram:</i>`
          : '',
      ]
        .filter(Boolean)
        .join('\n')
    : [
        `🚀 <b>Launch Your Fair Token in 1 Tap</b>`,
        ``,
        `<blockquote>Fixed <b>10,000,000</b> supply · Verified SEP-41 · Renounced ownership</blockquote>`,
        ``,
        `💰 <b>Cost:</b> <code>7 XLM</code> protocol fee + <code>2+ XLM</code> initial seed buy`,
        `📊 <b>v4.2 Split:</b> <code>42%</code> Curve · <code>28%</code> DEX · <code>29.5%</code> Burn Vault · <code>0.5%</code> 15d Vesting`,
        `🔒 <b>Anti-Rug:</b> Creator seed locked until <code>1,000 XLM</code> graduation`,
        `🎓 <b>Graduation:</b> Auto Soroswap pool with <b>100% LP burned</b>`,
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
            isEs ? '🚀 Crear Mi Token Ahora' : '🚀 Launch Token Now',
            '/create',
            baseUrl,
            inGroup,
            'create',
            botUsername,
          ),
        ],
        [
          cbBtn(isEs ? '⚙️ Reglas v4.2' : '⚙️ v4.2 Rules', `nav:v42:${f}`),
          cbBtn(isEs ? '⬅️ Inicio' : '⬅️ Home', `nav:home:${f}`),
        ],
      ],
    },
  }
}

export function buildWalletView(
  lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
): BotRenderedView {
  const f = langFlag(lang)
  const isEs = lang === 'es'

  const text = isEs
    ? [
        `👛 <b>Bóveda Self-Custody en Telegram</b>`,
        ``,
        `<blockquote>Tus llaves privadas nunca tocan servidores externos ni este bot.</blockquote>`,
        ``,
        `🔐 <b>Cifrado local:</b> <code>PBKDF2-SHA256</code> + <code>AES-GCM-256</code> en tu dispositivo`,
        `☁️ <b>Misma cuenta siempre:</b> Sync cifrado vía <code>Telegram CloudStorage</code>`,
        `🚰 <b>XLM gratis (Testnet):</b> Faucet Friendbot de <code>10,000 XLM</code> en 1 clic dentro de la app`,
        ``,
        `💡 <i>Tip: pega aquí cualquier dirección pública <code>GA…</code> para consultar su balance XLM en vivo.</i>`,
      ].join('\n')
    : [
        `👛 <b>Self-Custody Wallet in Telegram</b>`,
        ``,
        `<blockquote>Your private keys never touch external servers or this bot.</blockquote>`,
        ``,
        `🔐 <b>Client-side encryption:</b> <code>PBKDF2-SHA256</code> + <code>AES-GCM-256</code>`,
        `☁️ <b>Cross-device continuity:</b> Encrypted sync via <code>Telegram CloudStorage</code>`,
        `🚰 <b>Free Testnet XLM:</b> 1-tap <code>10,000 XLM</code> Friendbot faucet inside the app`,
        ``,
        `💡 <i>Tip: paste any public <code>GA…</code> address here to check its live XLM balance.</i>`,
      ].join('\n')

  return {
    text,
    photoUrl: telegramHeroUrl(baseUrl, 'wallet-quests-card.png'),
    reply_markup: {
      inline_keyboard: [
        [
          miniAppBtn(
            isEs ? '👛 Abrir Mi Wallet y Faucet' : '👛 Open Wallet & Faucet',
            '/portfolio',
            baseUrl,
            inGroup,
            'portfolio',
            botUsername,
          ),
        ],
        [
          cbBtn(isEs ? '📊 Curvas en Vivo' : '📊 Live Curves', `nav:mkt:${f}`),
          cbBtn(isEs ? '⬅️ Inicio' : '⬅️ Home', `nav:home:${f}`),
        ],
      ],
    },
  }
}

export function buildV42RulesView(
  lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
): BotRenderedView {
  const f = langFlag(lang)
  const isEs = lang === 'es'

  const text = isEs
    ? [
        `⚙️ <b>Fair-Flywheel v4.2 · Reglas On-Chain</b>`,
        ``,
        `<b>1 · Curva de Precio Justa</b>`,
        `• Profundidad virtual <code>2,000 vXLM → 1,000 XLM</code> meta (<code>2.25x</code>, salto <code>0.00%</code> al graduar)`,
        `• Compras: <code>0.80%</code> plano (sin penalización a compras grandes)`,
        `• Ventas anti-sniper: <code>2.50%</code> (&lt;50% meta) / <code>1.50%</code> (&ge;50%) → va al piso de LP &amp; buyback`,
        ``,
        `<b>2 · Flywheel de Quema y Liquidez</b>`,
        `• <code>42%</code> Curva · <code>28%</code> DEX · <code>29.5%</code> Vault Quema (M1 + M2) · <code>0.5%</code> Vesting 15d`,
        `• <code>60%</code> del excedente de comisiones ejecuta <b>Buyback &amp; Burn</b> real en Soroswap`,
        `• Transferencias P2P bloqueadas en curva hasta graduar (cierra ataques <code>PairAlreadySeeded</code>)`,
        ``,
        `<b>3 · Burn-to-Chat + King Shout</b>`,
        `• Quema <code>50 / 500 / 5,000+</code> tokens on-chain; trono 👑 con decaimiento cada 24h`,
        ``,
        `<i>Built by NunaLabs</i>`,
      ].join('\n')
    : [
        `⚙️ <b>Fair-Flywheel v4.2 · On-Chain Mechanics</b>`,
        ``,
        `<b>1 · Fair Bonding Curve</b>`,
        `• Virtual depth <code>2,000 vXLM → 1,000 XLM</code> goal (<code>2.25x</code> curve, <code>0.00%</code> cliff at grad)`,
        `• Buys: <code>0.80%</code> flat fee (zero whale buy penalty)`,
        `• Anti-sniper curve sells: <code>2.50%</code> (&lt;50% goal) / <code>1.50%</code> (&ge;50%) → LP floor &amp; buyback`,
        ``,
        `<b>2 · Supply &amp; Buyback Flywheel</b>`,
        `• <code>42%</code> Curve · <code>28%</code> DEX · <code>29.5%</code> Burn Vault (M1 + M2) · <code>0.5%</code> 15d Vesting`,
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
            isEs ? '🚀 Lanzar con v4.2' : '🚀 Launch on v4.2',
            '/create',
            baseUrl,
            inGroup,
            'create',
            botUsername,
          ),
          miniAppBtn(
            isEs ? '🔥 Mercado' : '🔥 Market',
            '/market',
            baseUrl,
            inGroup,
            'market',
            botUsername,
          ),
        ],
        [
          cbBtn(isEs ? '⬅️ Inicio' : '⬅️ Home', `nav:home:${f}`),
        ],
      ],
    },
  }
}

export function buildHelpView(
  lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
): BotRenderedView {
  const f = langFlag(lang)
  const isEs = lang === 'es'

  const text = isEs
    ? [
        `❓ <b>Ayuda y Comandos · @${botUsername}</b>`,
        ``,
        `/start — Menú principal y accesos directos`,
        `/market — Curvas en vivo y pares graduados`,
        `/king — Carrera King of the Hill y trono King Shout`,
        `/shouts <code>CA…</code> — Chat Burn-to-Chat on-chain del token`,
        `/quests <code>GA…</code> — Insignias NFT estilo Stellar Quest`,
        `/rewards — Programa de recompensas, sprints y check de wallet`,
        `/launch — Crear token Fair-Launch (7 XLM)`,
        `/wallet — Bóveda self-custody y Faucet Testnet`,
        `/token <code>CA…</code> — Inspeccionar contrato en vivo`,
        `/v42 — Tokenomics Fair-Flywheel v4.2`,
        ``,
        `💡 <b>Inline:</b> Escribe <code>@${botUsername} ASTRO</code> en cualquier chat para compartir su ficha.`,
        `🛡 <b>Seguridad:</b> Nunca pegues tu clave secreta <code>S…</code> en ningún chat.`,
        `<i>Built by NunaLabs</i>`,
      ].join('\n')
    : [
        `❓ <b>Commands &amp; Safety · @${botUsername}</b>`,
        ``,
        `/start — Main menu &amp; quick launchpad actions`,
        `/market — Live bonding curves &amp; DEX pairs`,
        `/king — King of the Hill race &amp; King Shout throne`,
        `/shouts <code>CA…</code> — Live on-chain Burn-to-Chat thread`,
        `/quests <code>GA…</code> — Stellar Quest-style collectible NFT badges`,
        `/rewards — Community rewards, sprints &amp; wallet check`,
        `/launch — Launch a Fair Token (7 XLM)`,
        `/wallet — Self-custody vault &amp; Testnet faucet`,
        `/token <code>CA…</code> — Live on-chain token inspector`,
        `/v42 — Fair-Flywheel v4.2 tokenomics`,
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
        [miniAppBtn('🌊 AstroGate Mini App', '/', baseUrl, inGroup, undefined, botUsername)],
        [
          miniAppBtn('🧬 Sorobits NFTs', '/sorobits', baseUrl, inGroup, 'sorobits', botUsername),
          cbBtn('⬅️ Home', `nav:home:${f}`),
        ],
      ],
    },
  }
}

export function buildTokenInspectorView(
  tokenId: string,
  data: TokenInspectorData | null,
  lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
): BotRenderedView {
  const f = langFlag(lang)
  const isEs = lang === 'es'
  const explorerUrl = `https://stellar.expert/explorer/testnet/contract/${tokenId}`

  if (!data) {
    return {
      text: isEs
        ? [
            `🔍 <b>Contrato</b> <code>${tokenId}</code>`,
            ``,
            `⚠️ No pude leer metadata SEP-41 en Stellar Testnet (puede ser un contrato distinto o timeout del RPC).`,
          ].join('\n')
        : [
            `🔍 <b>Contract</b> <code>${tokenId}</code>`,
            ``,
            `⚠️ Could not read SEP-41 metadata on Stellar Testnet right now.`,
          ].join('\n'),
      reply_markup: {
        inline_keyboard: [
          [
            miniAppBtn(
              isEs ? '⚡ Abrir en App' : '⚡ Open in App',
              `/token/${tokenId}`,
              baseUrl,
              inGroup,
              tokenId,
              botUsername,
            ),
          ],
          [
            { text: '🔗 Stellar Expert', url: explorerUrl },
            cbBtn(isEs ? '🔄 Reintentar' : '🔄 Retry', `t:${tokenId}:${f}`),
          ],
          [cbBtn(isEs ? '⬅️ Inicio' : '⬅️ Home', `nav:home:${f}`)],
        ],
      },
    }
  }

  const safeName = escapeHtml(data.name)
  const safeSym = escapeHtml(data.symbol)
  const lines: string[] = [
    `${data.curve?.graduated ? '🎓' : '⚡'} <b>$${safeSym}</b> · ${safeName}`,
    `<code>${tokenId}</code>`,
    ``,
  ]

  if (data.curve) {
    if (data.curve.graduated) {
      lines.push(
        isEs
          ? `✅ <b>Graduado en Soroswap DEX</b> · 100% LP Quemada`
          : `✅ <b>Graduated on Soroswap DEX</b> · 100% LP Burned`,
      )
      if (data.dexReserveXlm !== null && data.dexReserveXlm > 0n) {
        lines.push(
          `💧 ${isEs ? 'Liquidez DEX' : 'DEX Liquidity'}: <b>${formatXlm(data.dexReserveXlm, 2)} XLM</b>`,
        )
      }
      if (data.curve.buybackXlmReserve > 0n) {
        lines.push(
          `🔥 Buyback Reserve: <b>${formatXlm(data.curve.buybackXlmReserve, 2)} XLM</b>`,
        )
      }
      lines.push(
        `🏛 Burn Vault: Milestone <b>${data.curve.burnMilestoneStage}/2</b> (${formatTokensCompact(data.curve.burnVaultRemaining, data.decimals)} ${isEs ? 'restantes' : 'left'})`,
      )
    } else {
      const pct = curvePercent(data.curve.curveXlmNet)
      const soldPct =
        TOTAL_CURVE_ALLOCATION > 0n
          ? Number((data.curve.tokensSold * 1000n) / TOTAL_CURVE_ALLOCATION) / 10
          : 0
      lines.push(
        `📈 <b>${isEs ? 'Curva Bonding' : 'Bonding Curve'}:</b> <code>${progressBar(pct, 10)}</code> <b>${pct.toFixed(1)}%</b>`,
        `💎 Vault: <b>${formatXlm(data.curve.curveXlmNet, 2)} / 1,000 XLM</b>`,
        `🪙 ${isEs ? 'Vendido' : 'Sold'}: <b>${formatTokensCompact(data.curve.tokensSold, data.decimals)}</b> (${soldPct.toFixed(1)}% ${isEs ? 'curva' : 'curve'})`,
        `⚡ ${isEs ? 'Comisión compra' : 'Buy fee'}: <code>0.80%</code> ${isEs ? 'plana' : 'flat'}`,
      )
    }
    lines.push(`👤 ${isEs ? 'Creador' : 'Creator'}: <code>${shortAddr(data.curve.creator)}</code>`)
  } else {
    lines.push(
      `🪙 Supply: <b>${formatTokensCompact(data.totalSupply, data.decimals)} $${safeSym}</b>`,
    )
    if (data.dexReserveXlm !== null && data.dexReserveXlm > 0n) {
      lines.push(
        `💧 ${isEs ? 'Liquidez Soroswap' : 'Soroswap Liquidity'}: <b>${formatXlm(data.dexReserveXlm, 2)} XLM</b>`,
      )
    }
  }

  if (data.kingShout) {
    lines.push(
      ``,
      `<blockquote>👑 <b>King Shout</b> (${formatTokensCompact(data.kingShout.amount, data.decimals)} $${safeSym} burned)\n“${escapeHtml(data.kingShout.message.slice(0, 140))}”</blockquote>`,
    )
  }

  return {
    text: lines.join('\n'),
    reply_markup: {
      inline_keyboard: [
        [
          miniAppBtn(
            `⚡ ${isEs ? 'Tradear' : 'Trade'} $${data.symbol.slice(0, 12)}`,
            `/token/${tokenId}`,
            baseUrl,
            inGroup,
            tokenId,
            botUsername,
          ),
        ],
        [
          cbBtn(isEs ? '💬 Shouts' : '💬 Shouts', `s:${tokenId}:${f}`),
          cbBtn(isEs ? '🔄 Actualizar' : '🔄 Refresh', `t:${tokenId}:${f}`),
          { text: '🔗 Explorer', url: explorerUrl },
        ],
        [
          cbBtn(isEs ? '🔥 Mercado' : '🔥 Market', `nav:mkt:${f}`),
          cbBtn(isEs ? '⛰️ King of Hill' : '⛰️ King of Hill', `nav:koth:${f}`),
        ],
      ],
    },
  }
}

export function buildAccountInspectorView(
  accountId: string,
  account: AccountSummaryData | null,
  lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
): BotRenderedView {
  const f = langFlag(lang)
  const isEs = lang === 'es'
  const explorerUrl = `https://stellar.expert/explorer/testnet/account/${accountId}`

  const text = !account
    ? isEs
      ? `👛 <b>Cuenta</b> <code>${accountId}</code>\n\n⚠️ No se pudo consultar Horizon Testnet ahora mismo.`
      : `👛 <b>Account</b> <code>${accountId}</code>\n\n⚠️ Could not reach Horizon Testnet right now.`
    : !account.funded
      ? isEs
        ? [
            `👛 <b>Cuenta Stellar</b>`,
            `<code>${accountId}</code>`,
            ``,
            `💤 <b>Sin fondear en Testnet (0 XLM)</b>`,
            `Abre tu Wallet en la Mini App para fondearla gratis con <code>10,000 XLM</code> vía Friendbot.`,
          ].join('\n')
        : [
            `👛 <b>Stellar Account</b>`,
            `<code>${accountId}</code>`,
            ``,
            `💤 <b>Unfunded on Testnet (0 XLM)</b>`,
            `Open your Wallet in the Mini App to fund it for free with <code>10,000 XLM</code> via Friendbot.`,
          ].join('\n')
      : isEs
        ? [
            `👛 <b>Cuenta Stellar · Testnet</b>`,
            `<code>${accountId}</code>`,
            ``,
            `💎 <b>Balance XLM:</b> <code>${escapeHtml(account.xlmBalance)} XLM</code>`,
            `🪙 <b>Trustlines / Assets:</b> ${account.assetCount}`,
          ].join('\n')
        : [
            `👛 <b>Stellar Account · Testnet</b>`,
            `<code>${accountId}</code>`,
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
            isEs ? '👛 Abrir Portfolio en App' : '👛 Open Portfolio App',
            '/portfolio',
            baseUrl,
            inGroup,
            'portfolio',
            botUsername,
          ),
        ],
        [
          { text: '🔗 Stellar Expert', url: explorerUrl },
          cbBtn(isEs ? '🔄 Actualizar' : '🔄 Refresh', `a:${accountId}:${f}`),
        ],
        [cbBtn(isEs ? '⬅️ Inicio' : '⬅️ Home', `nav:home:${f}`)],
      ],
    },
  }
}

export function buildSecretKeyWarningView(
  lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  deletedInGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
): BotRenderedView {
  const f = langFlag(lang)
  const isEs = lang === 'es'
  const text = isEs
    ? [
        `🚨 <b>¡Alerta de Seguridad!</b>`,
        ``,
        deletedInGroup
          ? `Detectamos una <b>clave secreta Stellar (<code>S…</code>)</b> y <b>eliminamos el mensaje automáticamente</b> para protegerte.`
          : `Parece que pegaste una <b>clave secreta Stellar (<code>S…</code>)</b> en el chat.`,
        `Por tu seguridad:`,
        deletedInGroup ? '' : `• <b>Borra ese mensaje</b> del chat ahora mismo.`,
        `• Este bot <b>no lee ni guarda claves privadas</b>.`,
        `• Si usas esa llave fuera de testnet, rótala inmediatamente.`,
        `• Para importar tu wallet de pruebas de forma segura y cifrada, hazlo solo dentro de la <b>Mini App</b>.`,
      ]
        .filter(Boolean)
        .join('\n')
    : [
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
            isEs ? '🔐 Abrir Bóveda Segura' : '🔐 Open Encrypted Vault',
            '/portfolio',
            baseUrl,
            inGroup,
            'portfolio',
            botUsername,
          ),
        ],
        [cbBtn(isEs ? '⬅️ Inicio' : '⬅️ Home', `nav:home:${f}`)],
      ],
    },
  }
}

export function buildInvalidTokenUsageView(
  lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
): BotRenderedView {
  const f = langFlag(lang)
  const isEs = lang === 'es'
  const text = isEs
    ? [
        `🔍 <b>Inspeccionar Token On-Chain</b>`,
        ``,
        `Envía el comando con la dirección <code>CA…</code> del contrato (56 caracteres), o simplemente pega la dirección directo en el chat:`,
        `<code>/token CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE</code>`,
      ].join('\n')
    : [
        `🔍 <b>Inspect On-Chain Token</b>`,
        ``,
        `Send <code>/token</code> followed by a 56-char <code>CA…</code> contract address, or paste the address directly in chat:`,
        `<code>/token CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE</code>`,
      ].join('\n')

  return {
    text,
    reply_markup: {
      inline_keyboard: [
        [cbBtn(isEs ? '🔥 Ver Curvas en Vivo' : '🔥 Live Curves', `nav:mkt:${f}`)],
        [
          miniAppBtn(
            '⚡ ASTRO Flagship',
            '/token/CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE',
            baseUrl,
            inGroup,
            'CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE',
            botUsername,
          ),
          cbBtn(isEs ? '⬅️ Inicio' : '⬅️ Home', `nav:home:${f}`),
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
  lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
): BotRenderedView {
  const f = langFlag(lang)
  const isEs = lang === 'es'
  const activeCurves = items.filter((i) => !i.graduated).slice(0, 3)

  const lines: string[] = [
    isEs
      ? `⛰️ <b>King of the Hill · Carrera Soroswap</b>`
      : `⛰️ <b>King of the Hill · Graduation Race</b>`,
    ``,
  ]

  if (activeCurves.length === 0) {
    lines.push(
      isEs
        ? `🚀 No hay curvas pre-graduación activas ahora mismo. ¡Lanza la siguiente y lidera la colina!`
        : `🚀 No active pre-graduation curves right now. Launch the next token to claim the hill!`,
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
    isEs
      ? `<i>Quema tokens en la Mini App para robar el trono King Shout o impulsa una curva al 100% en Soroswap.</i>`
      : `<i>Burn tokens in the Mini App to steal the King Shout throne or push a curve to 100% on Soroswap.</i>`,
    `<i>Built by NunaLabs</i>`,
  )

  const leadToken = activeCurves[0] ?? items[0]
  const keyboard: InlineKeyboardButton[][] = []
  if (leadToken) {
    keyboard.push([
      miniAppBtn(
        isEs
          ? `👑 Competir por $${leadToken.symbol.slice(0, 10)}`
          : `👑 Claim Hill · $${leadToken.symbol.slice(0, 10)}`,
        `/token/${leadToken.id}`,
        baseUrl,
        inGroup,
        leadToken.id,
        botUsername,
      ),
    ])
  }
  keyboard.push([
    miniAppBtn(
      isEs ? '🚀 Lanzar Nuevo Token' : '🚀 Launch New Token',
      '/create',
      baseUrl,
      inGroup,
      'create',
      botUsername,
    ),
    cbBtn(isEs ? '🔄 Refrescar' : '🔄 Refresh', `nav:koth:${f}`),
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
      ? `🎓 Graduated on Soroswap DEX · ${item.reserveXlmStroops > 0n ? `${formatXlm(item.reserveXlmStroops, 1)} XLM TVL` : '100% LP Burned'}`
      : `⚡ Bonding Curve ${pct.toFixed(1)}% (${formatXlm(item.curveXlmNet, 1)}/1,000 XLM)`

    return {
      type: 'article',
      id: item.id.slice(0, 64),
      title: `${item.graduated ? '🎓' : '⚡'} $${item.symbol} · ${item.name}`,
      description: item.graduated
        ? 'Graduated on Soroswap DEX · 100% LP Burned'
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
              url: miniAppStartUrl(botUsername, item.id),
            },
            {
              text: '🚀 Launch App',
              url: miniAppStartUrl(botUsername, 'create'),
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
  lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
): BotRenderedView {
  const f = langFlag(lang)
  const isEs = lang === 'es'
  const explorerUrl = `https://stellar.expert/explorer/testnet/contract/${tokenId}`

  if (!data) {
    return {
      text: isEs
        ? `🔥 <b>Burn-to-Chat</b> <code>${tokenId}</code>\n\n⚠️ No se pudieron leer los shouts on-chain en este momento.`
        : `🔥 <b>Burn-to-Chat</b> <code>${tokenId}</code>\n\n⚠️ Could not read on-chain shouts right now.`,
      reply_markup: {
        inline_keyboard: [
          [
            miniAppBtn(
              isEs ? '💬 Abrir Chat On-Chain' : '💬 Open On-Chain Chat',
              `/token/${tokenId}`,
              baseUrl,
              inGroup,
              tokenId,
              botUsername,
            ),
          ],
          [cbBtn(isEs ? '⬅️ Inicio' : '⬅️ Home', `nav:home:${f}`)],
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
      isEs
        ? `💤 Aún no hay shouts quemados en este token. ¡Sé el primero desde la Mini App!`
        : `💤 No burned shouts yet on this token. Be the first to burn & shout in the Mini App!`,
    )
  } else {
    lines.push(isEs ? `<b>Últimos shouts on-chain:</b>` : `<b>Latest on-chain shouts:</b>`)
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
            isEs ? `🔥 Quemar y Comentar $${data.symbol.slice(0, 10)}` : `🔥 Burn & Reply · $${data.symbol.slice(0, 10)}`,
            `/token/${tokenId}`,
            baseUrl,
            inGroup,
            tokenId,
            botUsername,
          ),
        ],
        [
          { text: '🔗 Stellar Expert', url: explorerUrl },
          cbBtn(isEs ? '📊 Ver Token' : '📊 Token Card', `t:${tokenId}:${f}`),
        ],
      ],
    },
  }
}

export function buildRewardsView(
  lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
  checkedAccount?: AccountSummaryData | null,
): BotRenderedView {
  const f = langFlag(lang)
  const isEs = lang === 'es'

  const lines: string[] = isEs
    ? [
        `🎁 <b>AstroGate Rewards &amp; Bounties</b>`,
        ``,
        `<blockquote>Programa comunitario y de testers en Stellar · Built by NunaLabs</blockquote>`,
        ``,
        `<b>Cómo ganar insignias y recompensas:</b>`,
        `• 👑 <b>King Shout:</b> Quema tokens en la app para conquistar el trono on-chain`,
        `• ⛰️ <b>King of the Hill:</b> Compite en sprints para graduar curvas a Soroswap`,
        `• 🚀 <b>Fair Launchers:</b> Lanza tokens y comparte tu ficha en Community`,
        `• 🛡️ <b>Bug Hunters:</b> Reporta fallos reales con hash de transacción`,
        ``,
        `<i>Testnet otorga títulos en Telegram y XLM de prueba vía Friendbot; las recompensas reales en token/XLM se activarán en Mainnet.</i>`,
      ]
    : [
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
            isEs ? '👛 Abrir Wallet y Faucet' : '👛 Open Wallet & Faucet',
            '/portfolio',
            baseUrl,
            inGroup,
            'portfolio',
            botUsername,
          ),
          miniAppBtn(
            isEs ? '⛰️ Ir al Mercado' : '⛰️ Open Market',
            '/market',
            baseUrl,
            inGroup,
            'market',
            botUsername,
          ),
        ],
        [
          cbBtn(isEs ? '🏆 Quests & Badges' : '🏆 Quests & Badges', `nav:qst:${f}`),
          cbBtn(isEs ? '⛰️ King of Hill' : '⛰️ King of Hill', `nav:koth:${f}`),
          cbBtn(isEs ? '⬅️ Inicio' : '⬅️ Home', `nav:home:${f}`),
        ],
      ],
    },
  }
}

export function buildQuestsView(
  lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  inGroup = false,
  botUsername = DEFAULT_BOT_USERNAME,
  progress?: QuestProgressSummary | null,
): BotRenderedView {
  const f = langFlag(lang)
  const isEs = lang === 'es'

  const header = progress
    ? `🏆 <b>Sorobits Quests (SBIT)</b> · <code>${shortAddr(progress.accountId)}</code> (<b>${progress.unlockedCount}/${ASTROGATE_QUEST_BADGES.length}</b>)`
    : `🏆 <b>Sorobits (SBIT) · 100% On-Chain Season 1 NFTs</b>`

  const lines: string[] = [
    header,
    ``,
    `<blockquote>${
      isEs
        ? 'Completa misiones on-chain en Stellar Soroban para reclamar NFTs Sorobits (SEP-50 100% on-chain) y desbloquear rangos y prioridad en el chat.'
        : 'Complete on-chain quests on Stellar Soroban to earn Sorobits (100% on-chain 32×32 SVG SEP-50 NFTs) &amp; unlock chat ranks, sprint boosts &amp; Feed priority.'
    }</blockquote>`,
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
      ? isEs
        ? `<i>Abre Portfolio o Sorobits en la Mini App para reclamar y compartir tus NFTs.</i>`
        : `<i>Open Portfolio or Sorobits in the Mini App to view and claim your NFTs.</i>`
      : isEs
        ? `💡 <i>Envía <code>/quests GA...</code> para verificar insignias on-chain.</i>`
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
          ),
          miniAppBtn(
            '🏅 View Portfolio',
            '/portfolio',
            baseUrl,
            inGroup,
            'portfolio',
            botUsername,
          ),
        ],
        [
          cbBtn('🎁 Rewards', `nav:rew:${f}`),
          cbBtn('⛰️ King of Hill', `nav:koth:${f}`),
        ],
      ],
    },
  }
}
