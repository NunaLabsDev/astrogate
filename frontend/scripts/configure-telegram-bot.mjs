#!/usr/bin/env node
/**
 * Idempotent configuration helper for @AstroGateSorobanBot.
 * Enforces strict English copy (Rule 9), wipes stale legacy scopes/languages,
 * sets scoped slash commands, configures Menu Button, and registers Webhook.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnvFile(path.join(os.homedir(), '.secrets/astrogate/telegram-bot.env'))

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET
const WEBHOOK_URL =
  process.env.TELEGRAM_WEBHOOK_URL ||
  'https://astrogate.pages.dev/telegram/webhook'
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://astrogate.pages.dev/'
const DROP_PENDING = process.argv.includes('--drop-pending')

if (!BOT_TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN in env or ~/.secrets/astrogate/telegram-bot.env')
  process.exit(1)
}

async function tgCall(method, payload, attempt = 1) {
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${encodeURIComponent(BOT_TOKEN)}/${method}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    )
    const json = await res.json()
    if (!json.ok) {
      throw new Error(`Telegram ${method} failed: ${JSON.stringify(json)}`)
    }
    console.log(`✓ ${method}`)
    return json.result
  } catch (err) {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, attempt * 400))
      return tgCall(method, payload, attempt + 1)
    }
    throw err
  }
}

const DEFAULT_AND_PRIVATE_COMMANDS = [
  { command: 'start', description: 'Open AstroGate hub & Mini App' },
  { command: 'market', description: 'Live Fair-Flywheel v4.3 curves & DEX' },
  { command: 'sorobits', description: 'Sorobits (SBIT) 100% on-chain NFTs' },
  { command: 'king', description: 'King of the Hill & King Shout throne' },
  { command: 'quests', description: 'Season-1 NFT quests & rank (GA...)' },
  { command: 'rewards', description: 'Bounties, sprints & wallet check' },
  { command: 'launch', description: 'Launch a Fair-Flywheel token (7 XLM)' },
  { command: 'wallet', description: 'Self-custody vault & Friendbot faucet' },
  { command: 'token', description: 'Inspect Soroban token (CA... or SYMBOL)' },
  { command: 'shouts', description: 'Live Burn-to-Chat shouts (CA... or SYMBOL)' },
  { command: 'ask', description: 'Ask anything about AstroGate' },
  { command: 'v42', description: 'Fair-Flywheel v4.3 tokenomics' },
  { command: 'help', description: 'Commands, inline share & safety' },
]

const GROUP_COMMANDS = [
  { command: 'market', description: 'Live Fair-Flywheel v4.3 curves & DEX' },
  { command: 'king', description: 'King of the Hill & King Shout throne' },
  { command: 'sorobits', description: 'Sorobits (SBIT) 100% on-chain NFTs' },
  { command: 'quests', description: 'Check Sorobits NFT quests (GA...)' },
  { command: 'token', description: 'Inspect Soroban token (CA... or SYMBOL)' },
  { command: 'shouts', description: 'Live Burn-to-Chat shouts (CA... or SYMBOL)' },
  { command: 'ask', description: 'Ask anything about AstroGate' },
  { command: 'rewards', description: 'Bounties, sprints & claim info' },
  { command: 'v42', description: 'Fair-Flywheel v4.3 tokenomics' },
  { command: 'help', description: 'Commands & safety rules' },
]

// 1. Wipe stale commands and legacy non-English localizations across scopes
const SCOPES_TO_CLEAR = [
  { type: 'default' },
  { type: 'all_private_chats' },
  { type: 'all_group_chats' },
  { type: 'all_chat_administrators' },
]

for (const scope of SCOPES_TO_CLEAR) {
  for (const lang of [undefined, 'en', 'es']) {
    const payload = { scope }
    if (lang) payload.language_code = lang
    await tgCall('deleteMyCommands', payload)
  }
}

await tgCall('setMyDescription', { language_code: 'es', description: '' })
await tgCall('setMyShortDescription', { language_code: 'es', short_description: '' })

// 2. Apply unified English identity & descriptions (built by NunaLabs)
const DESIRED_NAME = 'AstroGate · NunaLabs'
const currentName = await tgCall('getMyName', {})
if (currentName?.name !== DESIRED_NAME) {
  await tgCall('setMyName', { name: DESIRED_NAME })
} else {
  console.log('✓ setMyName (unchanged)')
}

await tgCall('setMyShortDescription', {
  short_description:
    'AstroGate — Fair Launchpad, Soroswap DEX & On-Chain Sorobits NFTs on Stellar Soroban · Built by NunaLabs.',
})

await tgCall('setMyDescription', {
  description: [
    'AstroGate — Fair Launchpad & Sorobits NFTs on Stellar Soroban (Testnet)',
    '',
    '• 1-Tap Launch (7 XLM) · 10M supply · 7Y LP lock on Soroswap',
    '• Fair-Flywheel v4.3 · 0.80% flat buys · Auto Buyback & Burn',
    '• Sorobits (SBIT) · 100% on-chain 32x32 SVG NFTs (SEP-50)',
    '• Instant Q&A (/ask) + Encrypted CloudStorage Wallet',
    '',
    'Community: @AstroGateCommunity · Radar: @AstroGateFeed',
    'All 3 Chats: https://t.me/addlist/dyMTkV2uU6hmYzE0',
    '',
    'Tap START below to open the Mini App. Built by NunaLabs',
  ].join('\n'),
})

// 3. Apply crisp English slash commands for default, DMs, and groups
await tgCall('setMyCommands', {
  scope: { type: 'default' },
  commands: DEFAULT_AND_PRIVATE_COMMANDS,
})

await tgCall('setMyCommands', {
  scope: { type: 'all_private_chats' },
  commands: DEFAULT_AND_PRIVATE_COMMANDS,
})

await tgCall('setMyCommands', {
  scope: { type: 'all_group_chats' },
  commands: GROUP_COMMANDS,
})

await tgCall('setChatMenuButton', {
  menu_button: {
    type: 'web_app',
    text: 'AstroGate App',
    web_app: { url: MINI_APP_URL },
  },
})

if (WEBHOOK_SECRET) {
  await tgCall('setWebhook', {
    url: WEBHOOK_URL,
    secret_token: WEBHOOK_SECRET,
    allowed_updates: [
      'message',
      'edited_message',
      'callback_query',
      'inline_query',
      'chat_member',
    ],
    drop_pending_updates: DROP_PENDING,
  })
} else {
  console.warn('! TELEGRAM_WEBHOOK_SECRET not set; skipped setWebhook')
}
