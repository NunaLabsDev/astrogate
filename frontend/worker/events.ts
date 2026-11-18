import { scValToNative, type xdr } from '@stellar/stellar-sdk'
import type { BotRenderedView } from './types'
import {
  curvePercent,
  DEFAULT_BOT_USERNAME,
  escapeHtml,
  formatTokensCompact,
  formatXlm,
  isAccountAddr,
  isContractAddr,
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
  | {
      kind: 'sorobit_mint'
      id: string
      ledger: number
      txHash?: string
      tokenId: string
      to: string
      sorobitId: number
      edition: number
      soulbound: boolean
    }
  | {
      kind: 'sorobit_evolve'
      id: string
      ledger: number
      txHash?: string
      tokenId: string
      sorobitId: number
      rankTier: number
      xpScore: number
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

function isStellarAddress(val: string): boolean {
  return isContractAddr(val) || isAccountAddr(val)
}

export function parseLaunchpadContractEvent(
  ev: RawContractEvent,
  sorobitsContractId = 'CBVETCPLVAMNUUQRUJGH54XHVQT5ZOVB4FGGP2IGOGAZLUIYBBV7G3I3',
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
    if (!isContractAddr(tokenId) || !isStellarAddress(sender) || !message) return null
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
    if (!isStellarAddress(creator) || !isContractAddr(tokenId)) return null
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
    if (!isContractAddr(tokenId) || !isContractAddr(pairId)) return null
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
    if (!isContractAddr(tokenId) || !isStellarAddress(trader)) return null
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
    if (!isContractAddr(tokenId)) return null
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
    if (!isContractAddr(tokenId)) return null
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

  if (name === 'sorobit_minted_event') {
    const to = asString(topics[1])
    const sorobitId = Number(asBigInt(topics[2]))
    if (!isStellarAddress(to) || !Number.isFinite(sorobitId) || sorobitId < 0) {
      return null
    }
    const edition = Number(asBigInt(record.edition))
    return {
      kind: 'sorobit_mint',
      id: ev.id,
      ledger: ev.ledger,
      txHash: ev.txHash,
      tokenId: sorobitsContractId,
      to,
      sorobitId,
      edition: Number.isFinite(edition) ? edition : 0,
      soulbound: Boolean(record.soulbound),
    }
  }

  if (name === 'epigenetic_updated_event') {
    const sorobitId = Number(asBigInt(topics[1]))
    if (!Number.isFinite(sorobitId) || sorobitId < 0) return null
    return {
      kind: 'sorobit_evolve',
      id: ev.id,
      ledger: ev.ledger,
      txHash: ev.txHash,
      tokenId: sorobitsContractId,
      sorobitId,
      rankTier: Number(asBigInt(record.rank_tier)),
      xpScore: Number(asBigInt(record.xp_score)),
    }
  }

  return null
}

const MIN_FEED_TRADE_STROOPS = 20_000_000n // 2 XLM anti-dust filter for normal buys/sells
const MIN_NEAR_GRAD_PUSH_STROOPS = 5_000_000n // 0.5 XLM when curve >= 80% near graduation
const WHALE_TRADE_THRESHOLD_STROOPS = 500_000_000n // 50 XLM
const PUSH_CURVE_THRESHOLD_STROOPS = 8_000_000_000n // 80% of 1,000 XLM
const E2E_SMOKE_SHOUT_PREFIXES = ['[Testnet E2E]', 'Live v4.1 E2E shout']

/**
 * Routes automated protocol broadcasts strictly to `@AstroGateFeed` (`feed`)
 * and NEVER to `@AstroGateCommunity` (`community: false`), keeping the community
 * chat spam-free for human conversations and explicit bot commands.
 */
export function routeLaunchpadEventTargets(ev: LaunchpadParsedEvent): {
  feed: boolean
  community: boolean
} {
  if (ev.kind === 'shout') {
    const clean = ev.message.trim()
    const isE2eNoise = E2E_SMOKE_SHOUT_PREFIXES.some((prefix) =>
      clean.startsWith(prefix),
    )
    return { feed: !isE2eNoise, community: false }
  }
  if (ev.kind === 'graduated' || ev.kind === 'launch' || ev.kind === 'sorobit_mint') {
    return { feed: true, community: false }
  }
  if (ev.kind === 'sorobit_evolve') {
    // Only highlight actual rank-tier evolutions (tier >= 1) in Live Feed
    return { feed: ev.rankTier >= 1, community: false }
  }
  if (ev.kind === 'burn') {
    // Stage 1 milestone burn is emitted inside the same tx as `graduated`, so skip duplicate feed post
    if (ev.burnKind === 'milestone' && ev.xlmSpentOrStage <= 1n) {
      return { feed: false, community: false }
    }
    return { feed: true, community: false }
  }
  if (ev.kind === 'trade') {
    const isNearGradPush =
      ev.isBuy &&
      ev.curveXlmNet >= PUSH_CURVE_THRESHOLD_STROOPS &&
      ev.xlmAmount >= MIN_NEAR_GRAD_PUSH_STROOPS
    const isMeaningfulTrade = ev.xlmAmount >= MIN_FEED_TRADE_STROOPS
    return { feed: isNearGradPush || isMeaningfulTrade, community: false }
  }
  return { feed: false, community: false }
}

export function renderLaunchpadEventTelegramView(
  ev: LaunchpadParsedEvent,
  meta: { symbol: string; name: string; decimals: number },
  botUsername = DEFAULT_BOT_USERNAME,
  hasMainApp = false,
): BotRenderedView {
  const safeSym = escapeHtml(meta.symbol || 'TOK')
  const safeName = escapeHtml(meta.name || 'Token')
  const tokenDeepLink = miniAppStartUrl(botUsername, ev.tokenId, hasMainApp)
  const communityLink = 'https://t.me/AstroGateCommunity'
  const marketDeepLink = miniAppStartUrl(botUsername, 'market', hasMainApp)

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

  if (ev.kind === 'sorobit_mint') {
    const sorobitsDeepLink = miniAppStartUrl(botUsername, 'sorobits', hasMainApp)
    const editionLabel =
      ev.edition >= 1 && ev.edition <= 8
        ? `Genesis Archetype #AGQ0${ev.edition}`
        : 'Generative 256-Bit Genome'
    return {
      text: [
        `🧬 <b>Sorobit NFT Minted · SBIT #${ev.sorobitId}</b>`,
        ``,
        `🎨 <b>Class:</b> ${editionLabel} · ${ev.soulbound ? 'Soulbound Pilot Badge' : 'Tradeable Collectible'}`,
        `👤 <b>Pilot:</b> <code>${shortAddr(ev.to)}</code> · Ledger <code>#${ev.ledger}</code>`,
        `<i>Built by NunaLabs</i>`,
      ].join('\n'),
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🧬 View Sorobits NFTs', url: sorobitsDeepLink },
            { text: '💬 Community', url: communityLink },
          ],
        ],
      },
    }
  }

  if (ev.kind === 'sorobit_evolve') {
    const sorobitsDeepLink = miniAppStartUrl(botUsername, 'sorobits', hasMainApp)
    return {
      text: [
        `⚡ <b>Sorobit Rank Evolved · SBIT #${ev.sorobitId}</b>`,
        ``,
        `🏅 <b>Rank Tier:</b> <code>Tier ${ev.rankTier}</code> · <b>XP:</b> <code>${ev.xpScore.toLocaleString('en-US')}</code>`,
        `<i>Built by NunaLabs</i>`,
      ].join('\n'),
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🧬 Inspect Sorobit', url: sorobitsDeepLink },
            { text: '💬 Community', url: communityLink },
          ],
        ],
      },
    }
  }

  const pct = curvePercent(ev.curveXlmNet)
  const isGraduatingBuy = ev.isBuy && pct >= 100
  const isNearGrad = ev.isBuy && pct >= 80 && pct < 100
  const isWhale = ev.xlmAmount >= WHALE_TRADE_THRESHOLD_STROOPS
  const remainingXlm = Math.max(0, 1000 - Number(ev.curveXlmNet) / 1e7)

  const header = ev.isBuy
    ? isGraduatingBuy
      ? `🎓 <b>Graduating Curve Buy (100.0%) · $${safeSym}</b>`
      : isNearGrad
        ? `⛰️ <b>Almost Graduated (${pct.toFixed(1)}%) · $${safeSym}</b>`
        : isWhale
          ? `🐳 <b>Whale Curve Buy · $${safeSym}</b>`
          : `🟢 <b>Curve Buy · $${safeSym}</b>`
    : isWhale
      ? `🚨 <b>Whale Curve Sell · $${safeSym}</b>`
      : `🔴 <b>Curve Sell · $${safeSym}</b>`

  const actionLine = ev.isBuy
    ? `💎 <b>Buy:</b> <code>${formatXlm(ev.xlmAmount, 2)} XLM</code> → <code>${formatTokensCompact(ev.tokenAmount, meta.decimals)} $${safeSym}</code>`
    : `💸 <b>Sell:</b> <code>${formatTokensCompact(ev.tokenAmount, meta.decimals)} $${safeSym}</code> → <code>${formatXlm(ev.xlmAmount, 2)} XLM</code>`

  const goalLine = isNearGrad
    ? `🔥 <b>Only <code>${remainingXlm.toFixed(1)} XLM</code> left until Soroswap graduation!</b>`
    : ''

  return {
    text: [
      header,
      ``,
      actionLine,
      `📈 <b>Curve:</b> <code>${progressBar(pct, 10)}</code> <b>${pct.toFixed(1)}%</b> (${formatXlm(ev.curveXlmNet, 1)}/1,000 XLM)`,
      goalLine,
      `<i>Built by NunaLabs</i>`,
    ]
      .filter(Boolean)
      .join('\n'),
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: ev.isBuy
              ? `⚡ Trade $${meta.symbol.slice(0, 12)}`
              : `📊 Check $${meta.symbol.slice(0, 12)}`,
            url: tokenDeepLink,
          },
          { text: '💬 Community', url: communityLink },
        ],
      ],
    },
  }
}
