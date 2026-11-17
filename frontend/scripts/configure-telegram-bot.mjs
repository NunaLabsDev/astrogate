#!/usr/bin/env node
/**
 * Idempotent configuration helper for @AstroGateSorobanBot.
 * Updates Bot Name, Description, Short Description, Localized Commands,
 * Chat Menu Button, and Webhook registration without printing secrets.
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
  'https://astrogate-stellar.pepepop2000.workers.dev/telegram/webhook'
const MINI_APP_URL = process.env.MINI_APP_URL || 'https://astrogate.pages.dev/'

if (!BOT_TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN in env or ~/.secrets/astrogate/telegram-bot.env')
  process.exit(1)
}

async function tgCall(method, payload) {
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
}

await tgCall('setMyName', {
  name: 'AstroGate 🌊🚀',
})

await tgCall('setMyShortDescription', {
  short_description:
    'AstroGate — Fair-launch memecoins & Soroswap AMM on Stellar Soroban. Self-custody TMA wallet · 100% LP burned.',
})

await tgCall('setMyDescription', {
  description: [
    '🌊🚀 AstroGate — Fair Launchpad on Stellar Soroban',
    '',
    '• 1-Tap Launch (7 XLM) · 10M fixed supply · 100% LP burned',
    '• Fair-Flywheel v4.2 · 0.80% flat buys · Auto Buyback & Burn',
    '• 42% Curve / 28% DEX / 29.5% Burn Vault / 0.5% 15d Vesting',
    '• Self-Custody Wallet synced with Telegram CloudStorage',
    '',
    '👇 Tap START to trade live curves or open the Mini App.',
  ].join('\n'),
})

await tgCall('setMyDescription', {
  language_code: 'es',
  description: [
    '🌊🚀 AstroGate — Launchpad Justo en Stellar Soroban',
    '',
    '• Lanzamiento 1-Tap (7 XLM) · 10M fijos · 100% LP quemada',
    '• Fair-Flywheel v4.2 · 0.80% compra plana · Buyback & Burn',
    '• 42% Curva / 28% DEX / 29.5% Quema / 0.5% Vesting 15d',
    '• Bóveda Self-Custody sincronizada en Telegram CloudStorage',
    '',
    '👇 Toca INICIAR para tradear curvas o abrir la Mini App.',
  ].join('\n'),
})

await tgCall('setMyCommands', {
  commands: [
    { command: 'start', description: '🏠 Home & Launchpad Menu' },
    { command: 'market', description: '🔥 Live Curves & Graduated Pairs' },
    { command: 'launch', description: '🚀 Launch Fair Token (7 XLM)' },
    { command: 'wallet', description: '👛 Self-Custody Wallet & Faucet' },
    { command: 'token', description: '🔍 Inspect Token (CA... Contract ID)' },
    { command: 'v42', description: '⚙️ Fair-Flywheel v4.2 Tokenomics' },
    { command: 'help', description: '❓ Commands, Security & Links' },
  ],
})

await tgCall('setMyCommands', {
  language_code: 'es',
  commands: [
    { command: 'start', description: '🏠 Menú Principal y Accesos' },
    { command: 'market', description: '🔥 Curvas en Vivo y Pares DEX' },
    { command: 'launch', description: '🚀 Lanzar Token Justo (7 XLM)' },
    { command: 'wallet', description: '👛 Bóveda Self-Custody y Faucet' },
    { command: 'token', description: '🔍 Inspeccionar Token (CA...)' },
    { command: 'v42', description: '⚙️ Reglas Fair-Flywheel v4.2' },
    { command: 'help', description: '❓ Comandos, Seguridad y Ayuda' },
  ],
})

await tgCall('setChatMenuButton', {
  menu_button: {
    type: 'web_app',
    text: '🌊 AstroGate',
    web_app: { url: MINI_APP_URL },
  },
})

if (WEBHOOK_SECRET) {
  await tgCall('setWebhook', {
    url: WEBHOOK_URL,
    secret_token: WEBHOOK_SECRET,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  })
} else {
  console.warn('! TELEGRAM_WEBHOOK_SECRET not set; skipped setWebhook')
}
