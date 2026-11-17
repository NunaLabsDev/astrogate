import {
  renderLaunchpadEventTelegramView,
  routeLaunchpadEventTargets,
  type LaunchpadParsedEvent,
} from './events'
import {
  ASTRO_TOKEN_ID,
  fetchHorizonAccountSummary,
  fetchLaunchpadEventsByTxHash,
  fetchLiveMarketSnapshot,
  fetchLiveTokenInspectorData,
  fetchRecentLaunchpadEvents,
  fetchTokenMetaSummary,
  fetchTokenShoutsData,
  fetchUserQuestStatus,
  findTokenBySymbol,
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
  buildInlineMarketResults,
  buildInvalidTokenUsageView,
  buildKingOfTheHillView,
  buildLaunchView,
  buildMarketView,
  buildQuestsView,
  buildRewardsView,
  buildSecretKeyWarningView,
  buildShoutsView,
  buildSorobitsView,
  buildTokenInspectorView,
  buildV42RulesView,
  buildWalletView,
  buildWelcomeView,
  DEFAULT_APP_BASE_URL,
  DEFAULT_BOT_USERNAME,
  detectStellarAddress,
  detectTickerMention,
  isAccountAddr,
  isContractAddr,
  parseCommandAndArg,
} from './views'

const DEFAULT_COMMUNITY_CHAT_ID = '-1001625368092'
const DEFAULT_FEED_CHAT_ID = '-1001796630202'
const seenEventIds = new Set<string>()
let lastPolledLedger = 0

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
  replyToMessageId?: number,
): Promise<void> {
  const replyParams =
    typeof replyToMessageId === 'number'
      ? {
          message_id: replyToMessageId,
          allow_sending_without_reply: true,
        }
      : undefined

  if (view.photoUrl && view.text.length <= 1024) {
    const photoPayload: Record<string, unknown> = {
      chat_id: chatId,
      photo: view.photoUrl,
      caption: view.text,
      parse_mode: 'HTML',
      reply_markup: view.reply_markup,
    }
    if (replyParams) photoPayload.reply_parameters = replyParams
    const photoRes = await callTelegram(token, 'sendPhoto', photoPayload)
    if (photoRes.ok) return
  }

  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: view.text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: view.reply_markup,
  }
  if (replyParams) payload.reply_parameters = replyParams
  await callTelegram(token, 'sendMessage', payload)
}

async function tryDeleteMessage(
  token: string,
  chatId: number,
  messageId: number,
): Promise<boolean> {
  try {
    const res = await callTelegram(token, 'deleteMessage', {
      chat_id: chatId,
      message_id: messageId,
    })
    return res.ok
  } catch {
    return false
  }
}

async function editRenderedView(
  token: string,
  chatId: number,
  messageId: number,
  view: BotRenderedView,
  isPhoto = false,
): Promise<void> {
  const wantsPhoto = Boolean(view.photoUrl && view.text.length <= 1024)

  if (isPhoto && wantsPhoto) {
    const res = await callTelegram(token, 'editMessageMedia', {
      chat_id: chatId,
      message_id: messageId,
      media: {
        type: 'photo',
        media: view.photoUrl,
        caption: view.text,
        parse_mode: 'HTML',
      },
      reply_markup: view.reply_markup,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (!body.includes('message is not modified')) {
        await sendRenderedView(token, chatId, view)
      }
    }
    return
  }

  // Telegram does not allow converting text <-> photo in-place via editMessage*
  if (isPhoto !== wantsPhoto) {
    await sendRenderedView(token, chatId, view)
    return
  }

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

async function loadKingOfTheHillView(
  env: Env,
  lang: BotLang,
  baseUrl: string,
  inGroup: boolean,
): Promise<BotRenderedView> {
  const snap = await fetchLiveMarketSnapshot(env)
  const lead = snap.items.find((item) => !item.graduated) ?? snap.items[0] ?? null
  let leaderShout: {
    symbol: string
    amount: bigint
    decimals: number
    message: string
    tokenId: string
  } | null = null

  if (lead) {
    const details = await fetchLiveTokenInspectorData(lead.id, env)
    if (details?.kingShout) {
      leaderShout = {
        symbol: details.symbol,
        amount: details.kingShout.amount,
        decimals: details.decimals,
        message: details.kingShout.message,
        tokenId: details.tokenId,
      }
    }
  }

  return buildKingOfTheHillView(
    snap.items,
    leaderShout,
    lang,
    baseUrl,
    inGroup,
  )
}

async function handleInlineQuery(
  inlineQuery: { id: string; query: string },
  token: string,
  env: Env,
): Promise<void> {
  const snap = await fetchLiveMarketSnapshot(env)
  const results = buildInlineMarketResults(
    snap.items,
    inlineQuery.query,
    DEFAULT_BOT_USERNAME,
  )
  await callTelegram(token, 'answerInlineQuery', {
    inline_query_id: inlineQuery.id,
    results,
    cache_time: 15,
    is_personal: false,
  })
}

async function handleTextMessage(
  msg: TelegramMessage,
  token: string,
  env: Env,
): Promise<void> {
  const text = (msg.text || msg.caption || '').trim()
  if (!text) return
  const chatId = msg.chat.id
  const inGroup = msg.chat.type !== 'private'
  // Enforce English across every Telegram chat, group, and bot interaction
  const lang: BotLang = 'en'
  const replyId = inGroup ? msg.message_id : undefined
  const baseUrl = env.APP_BASE_URL || DEFAULT_APP_BASE_URL

  // 1. Proactive security guard: immediately delete in groups and warn on Stellar Secret Seeds (S...)
  const detected = detectStellarAddress(text)
  if (detected?.kind === 'secret') {
    const deletedInGroup = inGroup
      ? await tryDeleteMessage(token, chatId, msg.message_id)
      : false
    await sendRenderedView(
      token,
      chatId,
      buildSecretKeyWarningView(lang, baseUrl, inGroup, deletedInGroup),
      deletedInGroup ? undefined : replyId,
    )
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
        buildTokenInspectorView(cleanArg, data, lang, baseUrl, inGroup),
        replyId,
      )
      return
    }
    if (cleanArg === 'launch' || cleanArg === 'create') {
      await sendRenderedView(
        token,
        chatId,
        buildLaunchView(lang, baseUrl, true, inGroup),
        replyId,
      )
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
        buildMarketView(snap.items, lang, baseUrl, snap.rpcFailed, inGroup),
        replyId,
      )
      return
    }
    if (cleanArg === 'king' || cleanArg === 'hill' || cleanArg === 'sprint') {
      await callTelegram(token, 'sendChatAction', {
        chat_id: chatId,
        action: 'typing',
      })
      const view = await loadKingOfTheHillView(env, lang, baseUrl, inGroup)
      await sendRenderedView(token, chatId, view, replyId)
      return
    }
    if (cleanArg === 'wallet' || cleanArg === 'portfolio') {
      await sendRenderedView(
        token,
        chatId,
        buildWalletView(lang, baseUrl, inGroup),
        replyId,
      )
      return
    }
    if (cleanArg === 'sorobits' || cleanArg === 'nfts') {
      await sendRenderedView(
        token,
        chatId,
        buildSorobitsView(baseUrl, inGroup),
        replyId,
      )
      return
    }
    if (cleanArg === 'quests') {
      await sendRenderedView(
        token,
        chatId,
        buildQuestsView(lang, baseUrl, inGroup),
        replyId,
      )
      return
    }
    if (cleanArg === 'rewards') {
      await sendRenderedView(
        token,
        chatId,
        buildRewardsView(lang, baseUrl, inGroup),
        replyId,
      )
      return
    }

    await sendRenderedView(
      token,
      chatId,
      buildWelcomeView(
        msg.from?.first_name,
        lang,
        baseUrl,
        DEFAULT_BOT_USERNAME,
        inGroup,
      ),
      replyId,
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
      buildMarketView(snap.items, lang, baseUrl, snap.rpcFailed, inGroup),
      replyId,
    )
    return
  }

  if (command === 'king' || command === 'hill' || command === 'sprint') {
    await callTelegram(token, 'sendChatAction', {
      chat_id: chatId,
      action: 'typing',
    })
    const view = await loadKingOfTheHillView(env, lang, baseUrl, inGroup)
    await sendRenderedView(token, chatId, view, replyId)
    return
  }

  if (command === 'launch' || command === 'create') {
    await sendRenderedView(
      token,
      chatId,
      buildLaunchView(lang, baseUrl, false, inGroup),
      replyId,
    )
    return
  }

  if (command === 'wallet' || command === 'portfolio') {
    await sendRenderedView(
      token,
      chatId,
      buildWalletView(lang, baseUrl, inGroup),
      replyId,
    )
    return
  }

  if (command === 'v42' || command === 'rules') {
    await sendRenderedView(
      token,
      chatId,
      buildV42RulesView(lang, baseUrl, inGroup),
      replyId,
    )
    return
  }

  if (command === 'rewards' || command === 'bounties' || command === 'airdrop') {
    await sendRenderedView(
      token,
      chatId,
      buildRewardsView(lang, baseUrl, inGroup),
      replyId,
    )
    return
  }

  if (command === 'claim') {
    const cleanAcct = arg.replace(/[^A-Z2-7]/g, '')
    if (!isAccountAddr(cleanAcct)) {
      await sendRenderedView(
        token,
        chatId,
        buildRewardsView(lang, baseUrl, inGroup),
        replyId,
      )
      return
    }
    await callTelegram(token, 'sendChatAction', {
      chat_id: chatId,
      action: 'typing',
    })
    const account = await fetchHorizonAccountSummary(cleanAcct, env)
    await sendRenderedView(
      token,
      chatId,
      buildRewardsView(lang, baseUrl, inGroup, DEFAULT_BOT_USERNAME, account),
      replyId,
    )
    return
  }

  if (command === 'sorobits' || command === 'nft' || command === 'nfts') {
    await sendRenderedView(
      token,
      chatId,
      buildSorobitsView(baseUrl, inGroup),
      replyId,
    )
    return
  }

  if (
    command === 'quests' ||
    command === 'quest' ||
    command === 'badges' ||
    command === 'pilot'
  ) {
    const cleanAcct = arg.replace(/[^A-Z2-7]/g, '')
    if (!isAccountAddr(cleanAcct)) {
      await sendRenderedView(
        token,
        chatId,
        buildQuestsView(lang, baseUrl, inGroup),
        replyId,
      )
      return
    }
    await callTelegram(token, 'sendChatAction', {
      chat_id: chatId,
      action: 'typing',
    })
    const progress = await fetchUserQuestStatus(cleanAcct, env)
    await sendRenderedView(
      token,
      chatId,
      buildQuestsView(lang, baseUrl, inGroup, DEFAULT_BOT_USERNAME, progress),
      replyId,
    )
    return
  }

  if (command === 'shouts') {
    const clean = arg.replace(/[^A-Z2-7]/g, '')
    const targetToken = isContractAddr(clean) ? clean : ASTRO_TOKEN_ID
    await callTelegram(token, 'sendChatAction', {
      chat_id: chatId,
      action: 'typing',
    })
    const data = await fetchTokenShoutsData(targetToken, env)
    await sendRenderedView(
      token,
      chatId,
      buildShoutsView(targetToken, data, lang, baseUrl, inGroup),
      replyId,
    )
    return
  }

  if (command === 'help') {
    await sendRenderedView(
      token,
      chatId,
      buildHelpView(lang, baseUrl, inGroup),
      replyId,
    )
    return
  }

  if (command === 'token') {
    const clean = arg.replace(/[^A-Z2-7]/g, '')
    if (!isContractAddr(clean)) {
      await sendRenderedView(
        token,
        chatId,
        buildInvalidTokenUsageView(lang, baseUrl, inGroup),
        replyId,
      )
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
      buildTokenInspectorView(clean, data, lang, baseUrl, inGroup),
      replyId,
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
      buildTokenInspectorView(detected.value, data, lang, baseUrl, inGroup),
      replyId,
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
      buildAccountInspectorView(detected.value, account, lang, baseUrl, inGroup),
      replyId,
    )
    return
  }

  // 3b. $TICKER mention (e.g. $ASTRO) -> live token card
  const ticker = !command ? detectTickerMention(text) : null
  if (ticker) {
    const matchedId = await findTokenBySymbol(ticker, env)
    if (matchedId) {
      await callTelegram(token, 'sendChatAction', {
        chat_id: chatId,
        action: 'typing',
      })
      const data = await fetchLiveTokenInspectorData(matchedId, env)
      await sendRenderedView(
        token,
        chatId,
        buildTokenInspectorView(matchedId, data, lang, baseUrl, inGroup),
        replyId,
      )
      return
    }
  }

  // 4. Only reply in private DMs to generic text so group chats stay silent & polite
  if (!inGroup) {
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
  const inGroup = msg.chat.type !== 'private'
  const isPhoto = Boolean(msg.photo?.length)

  const parts = data.split(':')
  const kind = parts[0]

  if (kind === 'nav') {
    const viewName = parts[1]
    const lang: BotLang = 'en'

    if (viewName === 'home') {
      await editRenderedView(
        token,
        chatId,
        messageId,
        buildWelcomeView(
          query.from.first_name,
          lang,
          baseUrl,
          DEFAULT_BOT_USERNAME,
          inGroup,
        ),
        isPhoto,
      )
      return
    }
    if (viewName === 'mkt') {
      const snap = await fetchLiveMarketSnapshot(env)
      await editRenderedView(
        token,
        chatId,
        messageId,
        buildMarketView(snap.items, lang, baseUrl, snap.rpcFailed, inGroup),
        isPhoto,
      )
      return
    }
    if (viewName === 'koth') {
      const view = await loadKingOfTheHillView(env, lang, baseUrl, inGroup)
      await editRenderedView(token, chatId, messageId, view, isPhoto)
      return
    }
    if (viewName === 'lnch') {
      await editRenderedView(
        token,
        chatId,
        messageId,
        buildLaunchView(lang, baseUrl, false, inGroup),
        isPhoto,
      )
      return
    }
    if (viewName === 'wal') {
      await editRenderedView(
        token,
        chatId,
        messageId,
        buildWalletView(lang, baseUrl, inGroup),
        isPhoto,
      )
      return
    }
    if (viewName === 'v42') {
      await editRenderedView(
        token,
        chatId,
        messageId,
        buildV42RulesView(lang, baseUrl, inGroup),
        isPhoto,
      )
      return
    }
    if (viewName === 'qst') {
      await editRenderedView(
        token,
        chatId,
        messageId,
        buildQuestsView(lang, baseUrl, inGroup),
        isPhoto,
      )
      return
    }
    if (viewName === 'rew') {
      await editRenderedView(
        token,
        chatId,
        messageId,
        buildRewardsView(lang, baseUrl, inGroup),
        isPhoto,
      )
      return
    }
    if (viewName === 'help') {
      await editRenderedView(
        token,
        chatId,
        messageId,
        buildHelpView(lang, baseUrl, inGroup),
        isPhoto,
      )
      return
    }
  }

  if (kind === 't' && parts[1] && isContractAddr(parts[1])) {
    const tokenId = parts[1]
    const lang: BotLang = 'en'
    const info = await fetchLiveTokenInspectorData(tokenId, env)
    await editRenderedView(
      token,
      chatId,
      messageId,
      buildTokenInspectorView(tokenId, info, lang, baseUrl, inGroup),
      isPhoto,
    )
    return
  }

  if (kind === 's' && parts[1] && isContractAddr(parts[1])) {
    const tokenId = parts[1]
    const lang: BotLang = 'en'
    const shoutsData = await fetchTokenShoutsData(tokenId, env)
    await editRenderedView(
      token,
      chatId,
      messageId,
      buildShoutsView(tokenId, shoutsData, lang, baseUrl, inGroup),
      isPhoto,
    )
    return
  }

  if (kind === 'a' && parts[1]) {
    const accountId = parts[1]
    const lang: BotLang = 'en'
    const account = await fetchHorizonAccountSummary(accountId, env)
    await editRenderedView(
      token,
      chatId,
      messageId,
      buildAccountInspectorView(accountId, account, lang, baseUrl, inGroup),
      isPhoto,
    )
  }
}

async function claimEventOnce(eventKey: string): Promise<boolean> {
  if (seenEventIds.has(eventKey)) return false
  seenEventIds.add(eventKey)
  if (seenEventIds.size > 500) {
    const first = seenEventIds.values().next().value
    if (first) seenEventIds.delete(first)
  }
  try {
    const cacheStorage = (globalThis as { caches?: { open: (n: string) => Promise<Cache> } }).caches
    if (cacheStorage) {
      const cache = await cacheStorage.open('astrogate-tg-events-v1')
      const req = new Request(`https://events.astrogate.internal/${encodeURIComponent(eventKey)}`)
      const hit = await cache.match(req)
      if (hit) return false
      await cache.put(
        req,
        new Response('1', {
          headers: { 'Cache-Control': 'public, max-age=86400' },
        }),
      )
    }
  } catch {
    // Fallback to isolate memory deduplication when Edge Cache is unavailable
  }
  return true
}

async function broadcastLaunchpadEvents(
  events: LaunchpadParsedEvent[],
  token: string,
  env: Env,
): Promise<number> {
  const feedChatId = Number(env.TELEGRAM_FEED_CHAT_ID || DEFAULT_FEED_CHAT_ID)
  const communityChatId = Number(
    env.TELEGRAM_COMMUNITY_CHAT_ID || DEFAULT_COMMUNITY_CHAT_ID,
  )
  const metaCache = new Map<string, { symbol: string; name: string; decimals: number }>()
  let sentCount = 0

  for (const ev of events) {
    const targets = routeLaunchpadEventTargets(ev)
    if (!targets.feed && !targets.community) continue
    const dedupeKey = ev.txHash ? `${ev.txHash}:${ev.kind}:${ev.id}` : ev.id
    const fresh = await claimEventOnce(dedupeKey)
    if (!fresh) continue

    let meta = metaCache.get(ev.tokenId)
    if (!meta) {
      meta = await fetchTokenMetaSummary(ev.tokenId, env)
      metaCache.set(ev.tokenId, meta)
    }
    const view = renderLaunchpadEventTelegramView(ev, meta, DEFAULT_BOT_USERNAME)

    if (targets.feed && Number.isFinite(feedChatId)) {
      await sendRenderedView(token, feedChatId, view)
      sentCount += 1
    }
    if (targets.community && Number.isFinite(communityChatId)) {
      await sendRenderedView(token, communityChatId, view)
      sentCount += 1
    }
  }

  return sentCount
}

function pulseCorsHeaders(origin: string | null): Record<string, string> {
  const allowed =
    origin &&
    (origin === 'https://astrogate.pages.dev' ||
      origin.endsWith('.astrogate.pages.dev') ||
      origin.endsWith('.workers.dev'))
      ? origin
      : 'https://astrogate.pages.dev'
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
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

    if (url.pathname === '/api/telegram/pulse') {
      const cors = pulseCorsHeaders(request.headers.get('Origin'))
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: cors })
      }
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405, headers: cors })
      }
      if (!env.TELEGRAM_BOT_TOKEN) {
        return Response.json({ ok: false, posted: 0 }, { status: 200, headers: cors })
      }
      let body: { txHash?: string }
      try {
        body = (await request.json()) as { txHash?: string }
      } catch {
        return Response.json({ ok: false }, { status: 400, headers: cors })
      }
      const txHash = (body.txHash || '').trim().toLowerCase()
      if (!/^[0-9a-f]{64}$/.test(txHash)) {
        return Response.json({ ok: false }, { status: 400, headers: cors })
      }
      try {
        const events = await fetchLaunchpadEventsByTxHash(txHash, env)
        const posted = await broadcastLaunchpadEvents(
          events,
          env.TELEGRAM_BOT_TOKEN,
          env,
        )
        return Response.json({ ok: true, posted }, { headers: cors })
      } catch (err) {
        console.error('[AstroGate Bot] Pulse error:', err)
        return Response.json({ ok: false, posted: 0 }, { headers: cors })
      }
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
        } else if (update.inline_query) {
          await handleInlineQuery(
            update.inline_query,
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

  async scheduled(_controller: unknown, env: Env): Promise<void> {
    if (!env.TELEGRAM_BOT_TOKEN) return
    try {
      const { events, latestLedger } = await fetchRecentLaunchpadEvents(
        lastPolledLedger > 0 ? lastPolledLedger : undefined,
        env,
      )
      if (latestLedger > 0) {
        lastPolledLedger = latestLedger
      }
      await broadcastLaunchpadEvents(events, env.TELEGRAM_BOT_TOKEN, env)
    } catch (err) {
      console.error('[AstroGate Bot] Scheduled feed sync error:', err)
    }
  },
}
