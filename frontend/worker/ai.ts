import { buildProtocolOverview } from './protocol'
import { fetchLiveMarketSnapshot, fetchSorobitsStatusWorker } from './rpc'
import type { Env } from './types'
import { curvePercent, formatXlm } from './views'

const AI_MODELS = [
  '@cf/meta/llama-3.1-8b-instruct',
  '@cf/meta/llama-3.2-3b-instruct',
] as const
const AI_DAILY_CALL_CAP = 180
const AI_USER_COOLDOWN_SEC = 15

const SCAM_PHRASES = [
  'claim airdrop',
  'validate your wallet',
  'rectify wallet',
  'synchronize wallet',
  'seed phrase',
  'recovery phrase',
  '12 words',
  '24 words',
  'connect wallet to claim',
  'free usdt giveaway',
  'guaranteed 10x',
  'dm me for recovery',
]

const SUSPICIOUS_SHORTENERS = [
  'bit.ly/',
  'tinyurl.com/',
  'rb.gy/',
  'cutt.ly/',
  't.co/',
]

export interface ModerationVerdict {
  flagged: boolean
  reason?: 'scam_phrase' | 'phishing_link'
}

/**
 * Fast deterministic anti-phishing guard for `@AstroGateCommunity`.
 * Blocks classic wallet-drainer / fake airdrop lures without touching legitimate Stellar or AstroGate links.
 */
export function detectScamOrPhishing(text: string): ModerationVerdict {
  const lower = text.toLowerCase()
  for (const phrase of SCAM_PHRASES) {
    if (lower.includes(phrase)) {
      return { flagged: true, reason: 'scam_phrase' }
    }
  }

  const urls = lower.match(/https?:\/\/[^\s]+/g) ?? []
  for (const url of urls) {
    if (SUSPICIOUS_SHORTENERS.some((short) => url.includes(short))) {
      return { flagged: true, reason: 'phishing_link' }
    }
  }
  return { flagged: false }
}

function deterministicFallbackAnswer(question: string): string {
  const q = question.toLowerCase()
  if (q.includes('flywheel') || q.includes('v4.3') || q.includes('v4.2') || q.includes('tokenomics') || q.includes('tax')) {
    return (
      'Fair-Flywheel v4.3 uses a 1,000 vXLM -> 1,000 XLM bonding curve (4.00x range, 0.00% cliff at graduation) with a 0.80% flat buy fee and anti-sniper sell fees (2.50% <50%, 1.50% >=50%). ' +
      'Supply is fixed at 10M (66% Curve, 33% Soroswap DEX with 7-year LP lock, 0.3% 15d Vesting, 0.7% Ecosystem), with 60% of floor fee surplus funding permissionless Buyback & Burn.'
    )
  }
  if (q.includes('launch') || q.includes('create') || q.includes('fee')) {
    return (
      'Launching a Fair-Flywheel v4.3 token costs 7 XLM protocol fee plus at least 2 XLM initial seed buy. ' +
      'Every token has a fixed 10,000,000 supply (66% Bonding Curve, 33% Soroswap DEX, 0.3% 15d Creator Vesting, 0.7% Ecosystem) ' +
      'and graduates automatically to Soroswap at 1,000 XLM with LP locked 7 years on-chain.'
    )
  }
  if (q.includes('sorobit') || q.includes('nft') || q.includes('quest') || q.includes('badge')) {
    return (
      'Sorobits (SBIT) are 100% on-chain 32x32 genomic SVG NFTs (SEP-50) rendered directly by Soroban smart contracts with zero IPFS. ' +
      'Claim your free Soulbound AGQ01 Pioneer or mint evolving Mystery Capsules (7 XLM) and forge duplicate cards into higher tiers!'
    )
  }
  if (q.includes('wallet') || q.includes('faucet') || q.includes('xlm') || q.includes('fund') || q.includes('username')) {
    return (
      'AstroGate features a native self-custodial Wallet (Telegram + Web) encrypted client-side with PBKDF2-SHA256 + AES-GCM-256. ' +
      'Bind your @username via Ed25519 signature to a Primary wallet, manage up to 10 sub-wallets, sync via Telegram CloudStorage or AGVAULT1: bundles, export S... keys anytime, or run /wallet @user.'
    )
  }
  if (q.includes('burn') || q.includes('shout') || q.includes('king')) {
    return (
      'Burn-to-Chat permanently burns tokens on-chain to post messages on a token room: Chat (50+), Hype (500+), and King Shout (5,000+ with 24h half-life decay). ' +
      'Use /king to see the current crown and top graduation race.'
    )
  }
  return (
    'AstroGate is a decentralized Fair-Flywheel v4.3 launchpad, Soroswap AMM gateway, and Sorobits (SBIT) on-chain NFT hub on Stellar Soroban Testnet. ' +
    'Use /market for live curves, /launch to deploy a token (7 XLM), /sorobits for NFTs, or paste any CA.../GA... address or $TICKER to inspect live.'
  )
}

async function consumeAiBudget(userId: number | undefined, env: Env): Promise<{ allowed: boolean; reason?: 'cooldown' | 'daily_cap' }> {
  if (!env.ASTRO_KV) return { allowed: true }
  const today = new Date().toISOString().slice(0, 10)
  const dailyKey = `ai:daily:${today}`
  try {
    if (userId) {
      const userKey = `ai:user:${userId}`
      const recent = await env.ASTRO_KV.get(userKey)
      if (recent) return { allowed: false, reason: 'cooldown' }
      await env.ASTRO_KV.put(userKey, '1', { expirationTtl: AI_USER_COOLDOWN_SEC })
    }
    const countRaw = await env.ASTRO_KV.get(dailyKey)
    const count = Number(countRaw ?? '0')
    if (Number.isFinite(count) && count >= AI_DAILY_CALL_CAP) {
      return { allowed: false, reason: 'daily_cap' }
    }
    await env.ASTRO_KV.put(dailyKey, String((Number.isFinite(count) ? count : 0) + 1), {
      expirationTtl: 90_000,
    })
  } catch {
    // Allow graceful execution if KV transiently errors
  }
  return { allowed: true }
}

function extractAiText(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const record = raw as {
    response?: unknown
    result?: { response?: unknown }
    choices?: Array<{ message?: { content?: unknown } }>
  }
  const choiceContent = record.choices?.[0]?.message?.content
  const candidate =
    typeof record.response === 'string'
      ? record.response
      : typeof record.result?.response === 'string'
        ? record.result.response
        : typeof choiceContent === 'string'
          ? choiceContent
          : ''
  return candidate.replace(/<[^>]*>/g, '').trim()
}

export async function answerProtocolQuestion(
  question: string,
  userId: number | undefined,
  env: Env,
): Promise<{ answer: string; poweredByAi: boolean }> {
  const cleanQ = question.trim().slice(0, 400)
  if (!cleanQ) {
    return { answer: deterministicFallbackAnswer(''), poweredByAi: false }
  }

  if (!env.AI || env.TELEGRAM_AI_ENABLED === 'false') {
    return { answer: deterministicFallbackAnswer(cleanQ), poweredByAi: false }
  }

  const budget = await consumeAiBudget(userId, env)
  if (!budget.allowed) {
    if (budget.reason === 'cooldown') {
      return {
        answer: `${deterministicFallbackAnswer(cleanQ)}\n\n(AI quick-cooldown active — ask again in a few seconds for a custom answer.)`,
        poweredByAi: false,
      }
    }
    return { answer: deterministicFallbackAnswer(cleanQ), poweredByAi: false }
  }

  try {
    const [overview, snap, sorobits] = await Promise.all([
      Promise.resolve(buildProtocolOverview(env)),
      fetchLiveMarketSnapshot(env, 4),
      fetchSorobitsStatusWorker(env),
    ])

    const marketContext =
      snap.items.length > 0
        ? snap.items
            .map((item) =>
              item.graduated
                ? `$${item.symbol} (${item.name}): Graduated on Soroswap (${formatXlm(item.reserveXlmStroops, 1)} XLM TVL)`
                : `$${item.symbol} (${item.name}): Bonding Curve ${curvePercent(item.curveXlmNet).toFixed(1)}% (${formatXlm(item.curveXlmNet, 1)}/1000 XLM)`,
            )
            .join('; ')
        : 'No active curves fetched right now'

    const systemPrompt = [
      'You are AstroGate Copilot, the official AI assistant for AstroGate by NunaLabs on Stellar Soroban (Testnet).',
      'Rules:',
      '1. Always respond strictly in concise, friendly English (max 4 short sentences, under 480 characters).',
      '2. Never output external web URLs like astrogate.pages.dev. Only refer users to @AstroGateSorobanBot, @AstroGateCommunity, @AstroGateFeed, or bot slash commands (/market, /king, /launch, /sorobits, /quests, /wallet).',
      '3. Never give financial advice or price predictions. Explain mechanics accurately using the live context below.',
      '4. Never ask for secret seeds (S...) or private keys.',
      `Protocol facts: Launchpad v4.3 (${overview.contracts.launchpad}), 7 XLM fee + >=2 XLM seed, 10M fixed supply (66% curve / 33% Soroswap DEX / 0.3% 15d vesting / 0.7% ecosystem), 0.80% flat buy fee, 1,000 XLM graduation target with LP locked 7 years on-chain. Sorobits SEP-50 NFTs minted: ${sorobits.totalSupply}.`,
      `Live market: ${marketContext}.`,
    ].join('\n')

    for (const model of AI_MODELS) {
      try {
        const result = await Promise.race([
          env.AI.run(model, {
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: cleanQ },
            ],
            max_tokens: 180,
            temperature: 0.3,
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 5500)),
        ])

        const text = extractAiText(result)
        if (text && !text.toLowerCase().includes('astrogate.pages.dev')) {
          return { answer: text.slice(0, 650), poweredByAi: true }
        }
      } catch (err) {
        console.warn('[AstroGate Assistant] model error:', model, err)
      }
    }
  } catch (err) {
    console.warn('[AstroGate Assistant] context error:', err)
  }

  return { answer: deterministicFallbackAnswer(cleanQ), poweredByAi: false }
}
