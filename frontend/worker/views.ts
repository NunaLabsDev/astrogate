import type {
  AccountSummaryData,
  BotLang,
  BotRenderedView,
  InlineKeyboardButton,
  MarketTokenSummary,
  TokenInspectorData,
} from './types'

export const DEFAULT_APP_BASE_URL = 'https://astrogate.pages.dev'
export const DEFAULT_BOT_USERNAME = 'AstroGateSorobanBot'

const STROOPS_PER_XLM = 10_000_000n
const GRADUATION_GOAL_STROOPS = 10_000_000_000n // 1,000 XLM
const TOTAL_CURVE_ALLOCATION = 42_000_000_000_000n // 4,200,000 * 10^7

export function resolveLang(languageCode?: string): BotLang {
  return languageCode?.toLowerCase().startsWith('es') ? 'es' : 'en'
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

function webAppBtn(text: string, url: string): InlineKeyboardButton {
  return { text, web_app: { url } }
}

function cbBtn(text: string, data: string): InlineKeyboardButton {
  return { text, callback_data: data }
}

function shareUrl(botUsername: string, lang: BotLang): string {
  const target = `https://t.me/${botUsername}`
  const caption =
    lang === 'es'
      ? 'Lanza o tradea memecoins fair-launch en Stellar Soroban con LP 100% quemada en AstroGate.'
      : 'Launch or trade fair memecoins on Stellar Soroban with 100% LP burned on AstroGate.'
  return `https://t.me/share/url?url=${encodeURIComponent(target)}&text=${encodeURIComponent(caption)}`
}

export function buildWelcomeView(
  firstName: string | undefined,
  lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  botUsername = DEFAULT_BOT_USERNAME,
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
    ].join('\n')

    return {
      text,
      reply_markup: {
        inline_keyboard: [
          [webAppBtn('🌊 Abrir AstroGate App', appUrl(baseUrl, '/'))],
          [
            webAppBtn('🚀 Lanzar Token', appUrl(baseUrl, '/create')),
            webAppBtn('🔥 Mercado en Vivo', appUrl(baseUrl, '/market')),
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
  ].join('\n')

  return {
    text,
    reply_markup: {
      inline_keyboard: [
        [webAppBtn('🌊 Open AstroGate App', appUrl(baseUrl, '/'))],
        [
          webAppBtn('🚀 Launch Token', appUrl(baseUrl, '/create')),
          webAppBtn('🔥 Live Market', appUrl(baseUrl, '/market')),
        ],
        [
          cbBtn('📊 Live Curves', `nav:mkt:${f}`),
          cbBtn('👛 My Wallet', `nav:wal:${f}`),
        ],
        [
          cbBtn('⚙️ v4.2 Rules', `nav:v42:${f}`),
          { text: '📤 Share Bot', url: shareUrl(botUsername, lang) },
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
    for (const item of items.slice(0, 5)) {
      const safeName = escapeHtml(item.name)
      const safeSym = escapeHtml(item.symbol)
      if (item.graduated) {
        const liqText =
          item.reserveXlmStroops > 0n
            ? `${formatXlm(item.reserveXlmStroops, 1)} XLM TVL`
            : 'Soroswap DEX'
        rows.push(
          `🎓 <b>$${safeSym}</b> · ${safeName}`,
          `└ ${liqText} · <code>${item.id}</code>`,
          '',
        )
      } else {
        const pct = curvePercent(item.curveXlmNet)
        const bar = progressBar(pct, 10)
        rows.push(
          `⚡ <b>$${safeSym}</b> · ${safeName}`,
          `└ <code>${bar}</code> <b>${pct.toFixed(1)}%</b> (${formatXlm(item.curveXlmNet, 1)}/1,000 XLM)`,
          `└ <code>${item.id}</code>`,
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
    webAppBtn(
      `${item.graduated ? '🎓' : '⚡'} $${item.symbol.slice(0, 10)}`,
      appUrl(baseUrl, `/token/${item.id}`),
    ),
  )

  const keyboard: InlineKeyboardButton[][] = []
  if (tradeRow.length > 0) keyboard.push(tradeRow)
  keyboard.push([
    webAppBtn(
      isEs ? '🔥 Ver Todo en App' : '🔥 Full Market App',
      appUrl(baseUrl, '/market'),
    ),
  ])
  keyboard.push([
    cbBtn(isEs ? '🔄 Refrescar' : '🔄 Refresh', `nav:mkt:${f}`),
    cbBtn(isEs ? '⬅️ Inicio' : '⬅️ Home', `nav:home:${f}`),
  ])

  return {
    text: rows.join('\n'),
    reply_markup: { inline_keyboard: keyboard },
  }
}

export function buildLaunchView(
  lang: BotLang,
  baseUrl = DEFAULT_APP_BASE_URL,
  directDeepLink = false,
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
    reply_markup: {
      inline_keyboard: [
        [
          webAppBtn(
            isEs ? '🚀 Crear Mi Token Ahora' : '🚀 Launch Token Now',
            appUrl(baseUrl, '/create'),
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
    reply_markup: {
      inline_keyboard: [
        [
          webAppBtn(
            isEs ? '👛 Abrir Mi Wallet y Faucet' : '👛 Open Wallet & Faucet',
            appUrl(baseUrl, '/portfolio'),
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
      ].join('\n')

  return {
    text,
    reply_markup: {
      inline_keyboard: [
        [
          webAppBtn(
            isEs ? '🚀 Lanzar con v4.2' : '🚀 Launch on v4.2',
            appUrl(baseUrl, '/create'),
          ),
          webAppBtn(
            isEs ? '🔥 Mercado' : '🔥 Market',
            appUrl(baseUrl, '/market'),
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
): BotRenderedView {
  const f = langFlag(lang)
  const otherFlag = lang === 'es' ? 'e' : 's'
  const isEs = lang === 'es'

  const text = isEs
    ? [
        `❓ <b>Ayuda y Comandos · @${DEFAULT_BOT_USERNAME}</b>`,
        ``,
        `/start — Menú principal y accesos directos`,
        `/market — Curvas en vivo y pares graduados`,
        `/launch — Crear token Fair-Launch (7 XLM)`,
        `/wallet — Bóveda self-custody y Faucet Testnet`,
        `/token <code>CA…</code> — Inspeccionar contrato en vivo`,
        `/v42 — Tokenomics Fair-Flywheel v4.2`,
        ``,
        `🛡 <b>Seguridad:</b> Nunca pegues tu clave secreta <code>S…</code> en ningún chat. Úsala solo dentro de la Mini App cifrada.`,
      ].join('\n')
    : [
        `❓ <b>Commands &amp; Safety · @${DEFAULT_BOT_USERNAME}</b>`,
        ``,
        `/start — Main menu &amp; quick launchpad actions`,
        `/market — Live bonding curves &amp; DEX pairs`,
        `/launch — Launch a Fair Token (7 XLM)`,
        `/wallet — Self-custody vault &amp; Testnet faucet`,
        `/token <code>CA…</code> — Live on-chain token inspector`,
        `/v42 — Fair-Flywheel v4.2 tokenomics`,
        ``,
        `🛡 <b>Security:</b> Never paste your secret seed <code>S…</code> in any Telegram chat. Only unlock inside the encrypted Mini App.`,
      ].join('\n')

  return {
    text,
    reply_markup: {
      inline_keyboard: [
        [webAppBtn('🌊 AstroGate Mini App', appUrl(baseUrl, '/'))],
        [
          cbBtn(
            isEs ? '🌐 Switch to English' : '🌐 Cambiar a Español',
            `nav:help:${otherFlag}`,
          ),
          cbBtn(isEs ? '⬅️ Inicio' : '⬅️ Home', `nav:home:${f}`),
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
          [webAppBtn(isEs ? '⚡ Abrir en App' : '⚡ Open in App', appUrl(baseUrl, `/token/${tokenId}`))],
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
          webAppBtn(
            `⚡ ${isEs ? 'Tradear' : 'Trade'} $${data.symbol.slice(0, 12)}`,
            appUrl(baseUrl, `/token/${tokenId}`),
          ),
        ],
        [
          { text: '🔗 Stellar Expert', url: explorerUrl },
          cbBtn(isEs ? '🔄 Actualizar' : '🔄 Refresh', `t:${tokenId}:${f}`),
        ],
        [
          cbBtn(isEs ? '🔥 Mercado' : '🔥 Market', `nav:mkt:${f}`),
          cbBtn(isEs ? '⬅️ Inicio' : '⬅️ Home', `nav:home:${f}`),
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
          webAppBtn(
            isEs ? '👛 Abrir Portfolio en App' : '👛 Open Portfolio App',
            appUrl(baseUrl, '/portfolio'),
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
): BotRenderedView {
  const f = langFlag(lang)
  const isEs = lang === 'es'
  const text = isEs
    ? [
        `🚨 <b>¡Alerta de Seguridad!</b>`,
        ``,
        `Parece que pegaste una <b>clave secreta Stellar (<code>S…</code>)</b> en el chat.`,
        `Por tu seguridad:`,
        `• <b>Borra ese mensaje</b> del chat ahora mismo.`,
        `• Este bot <b>no lee ni guarda claves privadas</b>.`,
        `• Si usas esa llave fuera de testnet, rótala inmediatamente.`,
        `• Para importar tu wallet de pruebas de forma segura y cifrada, hazlo solo dentro de la <b>Mini App</b>.`,
      ].join('\n')
    : [
        `🚨 <b>Security Warning!</b>`,
        ``,
        `It looks like you pasted a <b>Stellar Secret Seed (<code>S…</code>)</b> in chat.`,
        `For your safety:`,
        `• <b>Delete that message</b> right away.`,
        `• This bot <b>never stores or reads private keys</b>.`,
        `• Rotate the key immediately if it controls real funds.`,
        `• Only import test keys locally inside the encrypted <b>Mini App Vault</b>.`,
      ].join('\n')

  return {
    text,
    reply_markup: {
      inline_keyboard: [
        [
          webAppBtn(
            isEs ? '🔐 Abrir Bóveda Segura' : '🔐 Open Encrypted Vault',
            appUrl(baseUrl, '/portfolio'),
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
          webAppBtn('⚡ ASTRO Flagship', appUrl(baseUrl, '/token/CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE')),
          cbBtn(isEs ? '⬅️ Inicio' : '⬅️ Home', `nav:home:${f}`),
        ],
      ],
    },
  }
}
