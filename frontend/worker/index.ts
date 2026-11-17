import {
  fetchHorizonAccountSummary,
  fetchLiveMarketSnapshot,
  fetchLiveTokenInspectorData,
  LAUNCHPAD_CONTRACT_ID,
} from './rpc'
import type {
  BotLang,
  BotRenderedView,
  Env,
  TelegramCallbackQuery,
  TelegramMessage,
  TelegramUpdate,
} from './types'
import {
  buildAccountInspectorView,
  buildHelpView,
  buildInvalidTokenUsageView,
  buildLaunchView,
  buildMarketView,
  buildSecretKeyWarningView,
  buildTokenInspectorView,
  buildV42RulesView,
  buildWalletView,
  buildWelcomeView,
  DEFAULT_APP_BASE_URL,
  detectStellarAddress,
  isContractAddr,
  parseCommandAndArg,
  parseLangFlag,
  resolveLang,
} from './views'

const TELEGRAM_API = 'https://api.telegram.org'

async function safeSecretEquals(
  provided: string | null,
  expected: string | undefined,
): Promise<boolean> {
  if (!provided || !expected) return false
  const enc = new TextEncoder()
  const [hashA, hashB] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(provided)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ])
  const bytesA = new Uint8Array(hashA)
  const bytesB = new Uint8Array(hashB)
  let diff = 0
  for (let i = 0; i < bytesA.length; i += 1) {
    diff |= (bytesA[i] ?? 0) ^ (bytesB[i] ?? 0)
  }
  return diff === 0
}

async function callTelegram(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${TELEGRAM_API}/bot${encodeURIComponent(token)}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

async function sendRenderedView(
  token: string,
  chatId: number,
  view: BotRenderedView,
): Promise<void> {
  await callTelegram(token, 'sendMessage', {
    chat_id: chatId,
    text: view.text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: view.reply_markup,
  })
}

async function editRenderedView(
  token: string,
  chatId: number,
  messageId: number,
  view: BotRenderedView,
): Promise<void> {
  const res = await callTelegram(token, 'editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: view.text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: view.reply_markup,
  })
  // Ignore harmless "message is not modified" responses from rapid double taps
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (!body.includes('message is not modified')) {
      // Fallback to sending fresh message if original was deleted or uneditable
      await sendRenderedView(token, chatId, view)
    }
  }
}

async function handleTextMessage(
  msg: TelegramMessage,
  token: string,
  env: Env,
): Promise<void> {
  const text = (msg.text || msg.caption || '').trim()
  if (!text) return
  const chatId = msg.chat.id
  const lang = resolveLang(msg.from?.language_code)
  const baseUrl = env.APP_BASE_URL || DEFAULT_APP_BASE_URL

  // 1. Proactive security guard: immediately warn if someone pastes a Stellar Secret Seed (S...)
  const detected = detectStellarAddress(text)
  if (detected?.kind === 'secret') {
    await sendRenderedView(token, chatId, buildSecretKeyWarningView(lang, baseUrl))
    return
  }

  // 2. Slash command router
  const { command, arg } = parseCommandAndArg(text)
  if (command === 'start') {
    const cleanArg = arg.trim()
    if (isContractAddr(cleanArg)) {
      await callTelegram(token, 'sendChatAction', {
        chat_id: chatId,
        action: 'typing',
      })
      const data = await fetchLiveTokenInspectorData(cleanArg, env)
      await sendRenderedView(
        token,
        chatId,
        buildTokenInspectorView(cleanArg, data, lang, baseUrl),
      )
      return
    }
    if (cleanArg === 'launch' || cleanArg === 'create') {
      await sendRenderedView(token, chatId, buildLaunchView(lang, baseUrl, true))
      return
    }
    if (cleanArg === 'market') {
      await callTelegram(token, 'sendChatAction', {
        chat_id: chatId,
        action: 'typing',
      })
      const snap = await fetchLiveMarketSnapshot(env)
      await sendRenderedView(
        token,
        chatId,
        buildMarketView(snap.items, lang, baseUrl, snap.rpcFailed),
      )
      return
    }
    if (cleanArg === 'wallet' || cleanArg === 'portfolio') {
      await sendRenderedView(token, chatId, buildWalletView(lang, baseUrl))
      return
    }

    await sendRenderedView(
      token,
      chatId,
      buildWelcomeView(msg.from?.first_name, lang, baseUrl),
    )
    return
  }

  if (command === 'market') {
    await callTelegram(token, 'sendChatAction', {
      chat_id: chatId,
      action: 'typing',
    })
    const snap = await fetchLiveMarketSnapshot(env)
    await sendRenderedView(
      token,
      chatId,
      buildMarketView(snap.items, lang, baseUrl, snap.rpcFailed),
    )
    return
  }

  if (command === 'launch' || command === 'create') {
    await sendRenderedView(token, chatId, buildLaunchView(lang, baseUrl))
    return
  }

  if (command === 'wallet' || command === 'portfolio') {
    await sendRenderedView(token, chatId, buildWalletView(lang, baseUrl))
    return
  }

  if (command === 'v42' || command === 'rules') {
    await sendRenderedView(token, chatId, buildV42RulesView(lang, baseUrl))
    return
  }

  if (command === 'help') {
    await sendRenderedView(token, chatId, buildHelpView(lang, baseUrl))
    return
  }

  if (command === 'token') {
    const clean = arg.replace(/[^A-Z2-7]/g, '')
    if (!isContractAddr(clean)) {
      await sendRenderedView(token, chatId, buildInvalidTokenUsageView(lang, baseUrl))
      return
    }
    await callTelegram(token, 'sendChatAction', {
      chat_id: chatId,
      action: 'typing',
    })
    const data = await fetchLiveTokenInspectorData(clean, env)
    await sendRenderedView(
      token,
      chatId,
      buildTokenInspectorView(clean, data, lang, baseUrl),
    )
    return
  }

  // 3. Bare address pasted in chat -> smart live inspector
  if (detected?.kind === 'contract') {
    await callTelegram(token, 'sendChatAction', {
      chat_id: chatId,
      action: 'typing',
    })
    const data = await fetchLiveTokenInspectorData(detected.value, env)
    await sendRenderedView(
      token,
      chatId,
      buildTokenInspectorView(detected.value, data, lang, baseUrl),
    )
    return
  }

  if (detected?.kind === 'account') {
    await callTelegram(token, 'sendChatAction', {
      chat_id: chatId,
      action: 'typing',
    })
    const account = await fetchHorizonAccountSummary(detected.value, env)
    await sendRenderedView(
      token,
      chatId,
      buildAccountInspectorView(detected.value, account, lang, baseUrl),
    )
    return
  }

  // 4. Only reply in private DMs to generic text so group chats stay silent & polite
  if (msg.chat.type === 'private') {
    await sendRenderedView(
      token,
      chatId,
      buildWelcomeView(msg.from?.first_name, lang, baseUrl),
    )
  }
}

async function handleCallbackQuery(
  query: TelegramCallbackQuery,
  token: string,
  env: Env,
): Promise<void> {
  const data = query.data || ''
  const msg = query.message
  const baseUrl = env.APP_BASE_URL || DEFAULT_APP_BASE_URL

  // Always dismiss spinner promptly
  await callTelegram(token, 'answerCallbackQuery', {
    callback_query_id: query.id,
  }).catch(() => undefined)

  if (!msg) return
  const chatId = msg.chat.id
  const messageId = msg.message_id

  const parts = data.split(':')
  const kind = parts[0]

  if (kind === 'nav') {
    const viewName = parts[1]
    const lang: BotLang = parseLangFlag(parts[2])

    if (viewName === 'home') {
      await editRenderedView(
        token,
        chatId,
        messageId,
        buildWelcomeView(query.from.first_name, lang, baseUrl),
      )
      return
    }
    if (viewName === 'mkt') {
      const snap = await fetchLiveMarketSnapshot(env)
      await editRenderedView(
        token,
        chatId,
        messageId,
        buildMarketView(snap.items, lang, baseUrl, snap.rpcFailed),
      )
      return
    }
    if (viewName === 'lnch') {
      await editRenderedView(
        token,
        chatId,
        messageId,
        buildLaunchView(lang, baseUrl),
      )
      return
    }
    if (viewName === 'wal') {
      await editRenderedView(
        token,
        chatId,
        messageId,
        buildWalletView(lang, baseUrl),
      )
      return
    }
    if (viewName === 'v42') {
      await editRenderedView(
        token,
        chatId,
        messageId,
        buildV42RulesView(lang, baseUrl),
      )
      return
    }
    if (viewName === 'help') {
      await editRenderedView(
        token,
        chatId,
        messageId,
        buildHelpView(lang, baseUrl),
      )
      return
    }
  }

  if (kind === 't' && parts[1] && isContractAddr(parts[1])) {
    const tokenId = parts[1]
    const lang = parseLangFlag(parts[2])
    const info = await fetchLiveTokenInspectorData(tokenId, env)
    await editRenderedView(
      token,
      chatId,
      messageId,
      buildTokenInspectorView(tokenId, info, lang, baseUrl),
    )
    return
  }

  if (kind === 'a' && parts[1]) {
    const accountId = parts[1]
    const lang = parseLangFlag(parts[2])
    const account = await fetchHorizonAccountSummary(accountId, env)
    await editRenderedView(
      token,
      chatId,
      messageId,
      buildAccountInspectorView(accountId, account, lang, baseUrl),
    )
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        service: 'astrogate-telegram-bot',
        launchpad: LAUNCHPAD_CONTRACT_ID,
      })
    }

    if (url.pathname === '/telegram/webhook') {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 })
      }
      const secretHeader = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
      const authorized = await safeSecretEquals(
        secretHeader,
        env.TELEGRAM_WEBHOOK_SECRET,
      )
      if (!authorized) {
        return new Response('Unauthorized', { status: 401 })
      }
      if (!env.TELEGRAM_BOT_TOKEN) {
        return new Response('Bot token not configured', { status: 500 })
      }

      let update: TelegramUpdate
      try {
        update = (await request.json()) as TelegramUpdate
      } catch {
        return new Response('Bad Request', { status: 400 })
      }

      try {
        if (update.callback_query) {
          await handleCallbackQuery(
            update.callback_query,
            env.TELEGRAM_BOT_TOKEN,
            env,
          )
        } else if (update.message) {
          await handleTextMessage(update.message, env.TELEGRAM_BOT_TOKEN, env)
        }
      } catch (err) {
        console.error('[AstroGate Bot] Update handling error:', err)
      }

      // Always return 200 OK to Telegram after auth so retries don't stall updates
      return Response.json({ ok: true })
    }

    return env.ASSETS.fetch(request)
  },
}
