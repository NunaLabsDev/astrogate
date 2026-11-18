#!/usr/bin/env node
/**
 * Verifies & initializes fresh AstroGate Community (Supergroup / Forum) and
 * AstroGate Live Feed (Broadcast Channel or locked Feed) via Telegram Bot API.
 * Strictly English copy (Rule 9) and internal Telegram links only (Rule 10).
 *
 * Usage:
 *   node scripts/setup-telegram-chats.mjs --community <ID_OR_@USER> --feed <ID_OR_@USER> [--folder https://t.me/addlist/...] [--main-app] [--create-topics] [--post-pins]
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
if (!BOT_TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN in env or ~/.secrets/astrogate/telegram-bot.env')
  process.exit(1)
}

function argVal(flag, fallback = '') {
  const idx = process.argv.indexOf(flag)
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback
}

const COMMUNITY_TARGET = argVal('--community', process.env.TELEGRAM_COMMUNITY_CHAT_ID || '@AstroGateCommunity')
const FEED_TARGET = argVal('--feed', process.env.TELEGRAM_FEED_CHAT_ID || '@AstroGateFeed')
const FOLDER_URL = argVal(
  '--folder',
  process.env.TELEGRAM_FOLDER_URL || 'https://t.me/addlist/dyMTkV2uU6hmYzE0',
)
const HAS_MAIN_APP = process.argv.includes('--main-app')
const CREATE_TOPICS = process.argv.includes('--create-topics')
const POST_PINS = process.argv.includes('--post-pins')
const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'AstroGateSorobanBot'
const HERO_BASE = 'https://astrogate.pages.dev/telegram'

function miniLink(param) {
  return HAS_MAIN_APP
    ? `https://t.me/${BOT_USERNAME}?startapp=${encodeURIComponent(param)}`
    : `https://t.me/${BOT_USERNAME}?start=${encodeURIComponent(param)}`
}

async function tg(method, payload = {}) {
  const res = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(BOT_TOKEN)}/${method}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
  return res.json()
}

const me = await tg('getMe')
if (!me.ok) {
  console.error('getMe failed:', me)
  process.exit(1)
}
const botId = me.result.id

const [commChat, feedChat] = await Promise.all([
  tg('getChat', { chat_id: COMMUNITY_TARGET }),
  tg('getChat', { chat_id: FEED_TARGET }),
])

if (!commChat.ok || !feedChat.ok) {
  console.error('Failed to inspect chats:', { commChat, feedChat })
  process.exit(1)
}

const [commMember, feedMember] = await Promise.all([
  tg('getChatMember', { chat_id: commChat.result.id, user_id: botId }),
  tg('getChatMember', { chat_id: feedChat.result.id, user_id: botId }),
])

console.log('Community:', {
  id: commChat.result.id,
  type: commChat.result.type,
  title: commChat.result.title,
  is_forum: Boolean(commChat.result.is_forum),
  linked_chat_id: commChat.result.linked_chat_id ?? null,
  bot_status: commMember.result?.status,
  can_delete_messages: commMember.result?.can_delete_messages,
  can_restrict_members: commMember.result?.can_restrict_members,
  can_pin_messages: commMember.result?.can_pin_messages,
  can_manage_topics: commMember.result?.can_manage_topics,
})

console.log('Feed:', {
  id: feedChat.result.id,
  type: feedChat.result.type,
  title: feedChat.result.title,
  linked_chat_id: feedChat.result.linked_chat_id ?? null,
  bot_status: feedMember.result?.status,
  can_post_messages: feedMember.result?.can_post_messages,
  can_pin_messages: feedMember.result?.can_pin_messages,
})

if (feedChat.result.linked_chat_id && feedChat.result.linked_chat_id === commChat.result.id) {
  console.warn(
    'WARNING: Feed channel has Community set as its Linked Discussion Group! Unlink it in Channel Settings -> Discussion so Telegram does not forward every Feed post into Community.',
  )
}

if (CREATE_TOPICS) {
  if (!commChat.result.is_forum) {
    console.warn('Community does not have Forum Topics enabled yet (enable Topics in Group Settings).')
  } else {
    const topics = [
      { name: 'Alpha & Trading', icon_color: 7322096 },
      { name: 'Token Launches & Shouts', icon_color: 16766590 },
      { name: 'Sorobits & Quests', icon_color: 13338331 },
      { name: 'Support & Feedback', icon_color: 9367192 },
    ]
    for (const t of topics) {
      const r = await tg('createForumTopic', {
        chat_id: commChat.result.id,
        name: t.name,
        icon_color: t.icon_color,
      })
      console.log('createForumTopic', t.name, r.ok ? r.result.message_thread_id : r.description)
    }
  }
}

if (POST_PINS) {
  const folderRow =
    FOLDER_URL && FOLDER_URL.startsWith('https://t.me/')
      ? [[{ text: '📁 Join All 3 AstroGate Chats', url: FOLDER_URL }]]
      : []

  const commPin = await tg('sendPhoto', {
    chat_id: commChat.result.id,
    photo: `${HERO_BASE}/community-hero-card.png`,
    caption: [
      `🌊🚀 <b>AstroGate Community</b> · <code>Stellar Soroban Testnet</code>`,
      ``,
      `<blockquote>Fair-Flywheel v4.4 Launchpad · Soroswap AMM · 100% On-Chain Sorobits (SBIT) NFTs</blockquote>`,
      ``,
      `<b>What you can do right here:</b>`,
      `• 🚀 <b>1-Tap Mini App:</b> Launch tokens (7 XLM), trade curves &amp; keep your encrypted CloudStorage wallet synced`,
      `• 🔍 <b>Instant Live Cards:</b> Paste any <code>$TICKER</code>, <code>CA…</code>, or <code>GA…</code> address`,
      `• 🤖 <b>Instant Answers:</b> Use <code>/ask &lt;question&gt;</code> or tag <code>@${BOT_USERNAME}</code>`,
      `• 📡 <b>Real-Time Radar:</b> Live launches &amp; whale trades stream in @AstroGateFeed`,
      `• 🛡️ <b>Zero Scams:</b> Never share your <code>S…</code> secret seed anywhere`,
      ``,
      `<i>Built by NunaLabs</i>`,
    ].join('\n'),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🌊 Open AstroGate Mini App', url: miniLink('home') }],
        [
          { text: '🔥 Live Market', url: miniLink('market') },
          { text: '🧬 Claim Free NFT', url: miniLink('sorobits') },
        ],
        [
          { text: '🚀 Launch Token', url: miniLink('create') },
          { text: '📡 Live Radar Feed', url: 'https://t.me/AstroGateFeed' },
        ],
        ...folderRow,
      ],
    },
  })

  if (commPin.ok) {
    await tg('pinChatMessage', {
      chat_id: commChat.result.id,
      message_id: commPin.result.message_id,
      disable_notification: true,
    })
    console.log('✓ Pinned Community welcome message:', commPin.result.message_id)
  } else {
    console.error('Failed to send Community welcome:', commPin)
  }

  const feedPin = await tg('sendPhoto', {
    chat_id: feedChat.result.id,
    photo: `${HERO_BASE}/feed-hero-card.png`,
    caption: [
      `📡 <b>AstroGate Live On-Chain Feed</b> · <code>Stellar Soroban Testnet</code>`,
      ``,
      `<blockquote>24/7 anti-dust Soroban telemetry — zero noise, pure on-chain signal.</blockquote>`,
      ``,
      `<b>What streams here live:</b>`,
      `• 🚀 <b>Fair Launches:</b> New v4.4 tokens (10M supply, 7Y LP lock)`,
      `• 🐋 <b>Meaningful Trades:</b> Buys/sells <code>&gt;= 2 XLM</code> &amp; <code>80%+</code> graduation pushes`,
      `• 🎓 <b>Soroswap Graduations:</b> Pool creation + Buyback &amp; Burn milestones`,
      `• 👑 <b>Burn-to-Chat &amp; Sorobits:</b> King Shouts + SEP-50 NFT mints`,
      ``,
      `💬 <i>Join human chat &amp; AI copilot in @AstroGateCommunity</i>`,
      `<i>Built by NunaLabs</i>`,
    ].join('\n'),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: '🔥 Trade Live Market', url: miniLink('market') }],
        [
          { text: '🧬 Sorobits NFTs', url: miniLink('sorobits') },
          { text: '💬 Join Community', url: 'https://t.me/AstroGateCommunity' },
        ],
        ...folderRow,
      ],
    },
  })

  if (feedPin.ok) {
    await tg('pinChatMessage', {
      chat_id: feedChat.result.id,
      message_id: feedPin.result.message_id,
      disable_notification: true,
    })
    console.log('✓ Pinned Feed welcome message:', feedPin.result.message_id)
  } else {
    console.error('Failed to send Feed welcome:', feedPin)
  }
}
