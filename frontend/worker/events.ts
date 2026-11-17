import { scValToNative, type xdr } from '@stellar/stellar-sdk'
import type { BotRenderedView } from './types'
import {
  curvePercent,
  DEFAULT_BOT_USERNAME,
  escapeHtml,
  formatTokensCompact,
  formatXlm,
  miniAppStartUrl,
  progressBar,
  shortAddr,
} from './views'

export type LaunchpadParsedEvent =
  | {
      kind: 'shout'
      id: string
      ledger: number
      txHash?: string
      tokenId: string
      sender: string
      amount: bigint
      message: string
      isKing: boolean
    }
  | {
      kind: 'launch'
      id: string
      ledger: number
      txHash?: string
      tokenId: string
      creator: string
      xlmInitial: bigint
      isCurve: boolean
    }
  | {
      kind: 'trade'
      id: string
      ledger: number
      txHash?: string
      tokenId: string
      trader: string
      isBuy: boolean
      xlmAmount: bigint
      tokenAmount: bigint
      curveXlmNet: bigint
    }
  | {
      kind: 'graduated'
      id: string
      ledger: number
      txHash?: string
      tokenId: string
      pairId: string
      xlmDeposited: bigint
      vaultBurned: bigint
    }
  | {
      kind: 'burn'
      id: string
      ledger: number
      txHash?: string
      tokenId: string
      burnKind: 'buyback' | 'milestone'
      tokensBurned: bigint
      xlmSpentOrStage: bigint
    }

export interface RawContractEvent {
  id: string
  ledger: number
  txHash?: string
  topic: xdr.ScVal[]
  value: xdr.ScVal
}

function safeNative(val: xdr.ScVal): unknown {
  try {
    return scValToNative(val)
  } catch {
    return null
  }
}

function asBigInt(val: unknown): bigint {
  if (typeof val === 'bigint') return val
  if (typeof val === 'number' && Number.isSafeInteger(val)) return BigInt(val)
  if (typeof val === 'string' && /^-?\d+$/.test(val)) return BigInt(val)
  return 0n
}

function asString(val: unknown): string {
  return typeof val === 'string' ? val : ''
}

export function parseLaunchpadContractEvent(
  ev: RawContractEvent,
): LaunchpadParsedEvent | null {
  const topics = ev.topic.map(safeNative)
  const name = asString(topics[0])
  const data = safeNative(ev.value)
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>

  if (name === 'shout_event') {
    const tokenId = asString(topics[1])
    const sender = asString(record.sender)
    const message = asString(record.message)
    if (!tokenId || !sender || !message) return null
    return {
      kind: 'shout',
      id: ev.id,
      ledger: ev.ledger,
      txHash: ev.txHash,
      tokenId,
      sender,
      amount: asBigInt(record.amount),
      message,
      isKing: Boolean(record.is_king),
    }
  }

  if (name === 'token_launched_event') {
    const creator = asString(topics[1])
    const tokenId = asString(record.token)
    if (!creator || !tokenId) return null
    return {
      kind: 'launch',
      id: ev.id,
      ledger: ev.ledger,
      txHash: ev.txHash,
      tokenId,
      creator,
      xlmInitial: asBigInt(record.xlm_initial),
      isCurve: Boolean(record.is_curve),
    }
  }

  if (name === 'token_graduated_event') {
    const tokenId = asString(topics[1])
    const pairId = asString(record.pair)
    if (!tokenId || !pairId) return null
    return {
      kind: 'graduated',
      id: ev.id,
      ledger: ev.ledger,
      txHash: ev.txHash,
      tokenId,
      pairId,
      xlmDeposited: asBigInt(record.xlm_deposited),
      vaultBurned: asBigInt(record.vault_burned),
    }
  }

  if (name === 'curve_trade_event') {
    const tokenId = asString(topics[1])
    const trader = asString(topics[2])
    if (!tokenId || !trader) return null
    return {
      kind: 'trade',
      id: ev.id,
      ledger: ev.ledger,
      txHash: ev.txHash,
      tokenId,
      trader,
      isBuy: Boolean(record.is_buy),
      xlmAmount: asBigInt(record.xlm_amount),
      tokenAmount: asBigInt(record.token_amount),
      curveXlmNet: asBigInt(record.curve_xlm_net),
    }
  }

  if (name === 'buyback_burn_event') {
    const tokenId = asString(topics[1])
    if (!tokenId) return null
    return {
      kind: 'burn',
      id: ev.id,
      ledger: ev.ledger,
      txHash: ev.txHash,
      tokenId,
      burnKind: 'buyback',
      tokensBurned: asBigInt(record.tokens_burned),
      xlmSpentOrStage: asBigInt(record.xlm_spent),
    }
  }

  if (name === 'milestone_burn_event') {
    const tokenId = asString(topics[1])
    if (!tokenId) return null
    return {
      kind: 'burn',
      id: ev.id,
      ledger: ev.ledger,
      txHash: ev.txHash,
      tokenId,
      burnKind: 'milestone',
      tokensBurned: asBigInt(record.burned_amount),
      xlmSpentOrStage: asBigInt(record.stage),
    }
  }

  return null
}

const WHALE_BUY_THRESHOLD_STROOPS = 500_000_000n // 50 XLM
const PUSH_CURVE_THRESHOLD_STROOPS = 8_000_000_000n // 80% of 1,000 XLM

export function routeLaunchpadEventTargets(ev: LaunchpadParsedEvent): {
  feed: boolean
  community: boolean
} {
  if (ev.kind === 'shout') {
    // Web Burn-to-Chat shouts bridge live to both Feed & Community
    return { feed: true, community: true }
  }
  if (ev.kind === 'graduated') {
    return { feed: true, community: true }
  }
  if (ev.kind === 'launch') {
    return { feed: true, community: false }
  }
  if (ev.kind === 'burn') {
    return { feed: true, community: false }
  }
  if (ev.kind === 'trade') {
    const isBigBuy =
      ev.isBuy &&
      (ev.xlmAmount >= WHALE_BUY_THRESHOLD_STROOPS ||
        ev.curveXlmNet >= PUSH_CURVE_THRESHOLD_STROOPS)
    return { feed: isBigBuy, community: false }
  }
  return { feed: false, community: false }
}

export function renderLaunchpadEventTelegramView(
  ev: LaunchpadParsedEvent,
  meta: { symbol: string; name: string; decimals: number },
  botUsername = DEFAULT_BOT_USERNAME,
): BotRenderedView {
  const safeSym = escapeHtml(meta.symbol || 'TOK')
  const safeName = escapeHtml(meta.name || 'Token')
  const tokenDeepLink = miniAppStartUrl(botUsername, ev.tokenId)
  const communityLink = 'https://t.me/AstroGateCommunity'
  const marketDeepLink = miniAppStartUrl(botUsername, 'market')

  if (ev.kind === 'shout') {
    const burnedText = formatTokensCompact(ev.amount, meta.decimals)
    const header = ev.isKing
      ? `👑 <b>NEW KING SHOUT · $${safeSym}</b>`
      : `🔥 <b>On-Chain Burn-to-Chat · $${safeSym}</b>`
    return {
      text: [
        header,
        ``,
        `<blockquote>“${escapeHtml(ev.message.slice(0, 160))}”</blockquote>`,
        ``,
        `🔥 <b>Burned:</b> <code>${burnedText} $${safeSym}</code>`,
        `👤 <b>Wallet:</b> <code>${shortAddr(ev.sender)}</code> · Ledger <code>#${ev.ledger}</code>`,
        `<i>Built by NunaLabs</i>`,
      ].join('\n'),
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: ev.isKing
                ? `👑 Steal Crown · $${meta.symbol.slice(0, 10)}`
                : `💬 Burn & Reply · $${meta.symbol.slice(0, 10)}`,
              url: tokenDeepLink,
            },
            { text: '💬 Community', url: communityLink },
          ],
        ],
      },
    }
  }

  if (ev.kind === 'launch') {
    return {
      text: [
        `🚀 <b>New AstroGate Fair-Launch · $${safeSym}</b> (${safeName})`,
        ``,
        `💎 <b>Seed Pool:</b> <code>${formatXlm(ev.xlmInitial, 2)} XLM</code> · <code>10M</code> Fixed Supply`,
        `👤 <b>Creator:</b> <code>${shortAddr(ev.creator)}</code>`,
        `<code>${ev.tokenId}</code>`,
        `<i>Built by NunaLabs</i>`,
      ].join('\n'),
      reply_markup: {
        inline_keyboard: [
          [
            { text: `⚡ Trade $${meta.symbol.slice(0, 12)}`, url: tokenDeepLink },
            { text: '💬 Community', url: communityLink },
          ],
        ],
      },
    }
  }

  if (ev.kind === 'graduated') {
    return {
      text: [
        `🎓 <b>GRADUATED TO SOROSWAP DEX · $${safeSym}</b>`,
        ``,
        `💧 <b>DEX Liquidity:</b> <code>${formatXlm(ev.xlmDeposited, 2)} XLM</code> · <b>100% LP Burned</b>`,
        `🔥 <b>Vault Burned:</b> <code>${formatTokensCompact(ev.vaultBurned, meta.decimals)} $${safeSym}</code>`,
        `<code>${ev.tokenId}</code>`,
        `<i>Built by NunaLabs</i>`,
      ].join('\n'),
      reply_markup: {
        inline_keyboard: [
          [
            { text: `🎓 Trade $${meta.symbol.slice(0, 10)} on DEX`, url: tokenDeepLink },
            { text: '💬 Community', url: communityLink },
          ],
        ],
      },
    }
  }

  if (ev.kind === 'burn') {
    const title =
      ev.burnKind === 'buyback'
        ? `🔥 <b>DEX Buyback &amp; Burn · $${safeSym}</b>`
        : `🏛 <b>Milestone Burn #${ev.xlmSpentOrStage.toString()} · $${safeSym}</b>`
    return {
      text: [
        title,
        ``,
        `🔥 <b>Supply Permanently Burned:</b> <code>${formatTokensCompact(ev.tokensBurned, meta.decimals)} $${safeSym}</code>`,
        ev.burnKind === 'buyback'
          ? `💎 <b>XLM Spent:</b> <code>${formatXlm(ev.xlmSpentOrStage, 2)} XLM</code>`
          : '',
        `<i>Built by NunaLabs</i>`,
      ]
        .filter(Boolean)
        .join('\n'),
      reply_markup: {
        inline_keyboard: [
          [
            { text: `⚡ Open $${meta.symbol.slice(0, 12)}`, url: tokenDeepLink },
            { text: '🔥 Market App', url: marketDeepLink },
          ],
        ],
      },
    }
  }

  const pct = curvePercent(ev.curveXlmNet)
  const isNearGrad = pct >= 80
  return {
    text: [
      isNearGrad
        ? `⛰️ <b>King of the Hill Push (${pct.toFixed(1)}%) · $${safeSym}</b>`
        : `🐳 <b>Whale Curve Buy · $${safeSym}</b>`,
      ``,
      `💎 <b>Buy:</b> <code>${formatXlm(ev.xlmAmount, 2)} XLM</code> → <code>${formatTokensCompact(ev.tokenAmount, meta.decimals)} $${safeSym}</code>`,
      `📈 <b>Curve:</b> <code>${progressBar(pct, 10)}</code> <b>${pct.toFixed(1)}%</b> (${formatXlm(ev.curveXlmNet, 1)}/1,000 XLM)`,
      `<i>Built by NunaLabs</i>`,
    ].join('\n'),
    reply_markup: {
      inline_keyboard: [
        [
          { text: `⚡ Join $${meta.symbol.slice(0, 12)}`, url: tokenDeepLink },
          { text: '💬 Community', url: communityLink },
        ],
      ],
    },
  }
}
