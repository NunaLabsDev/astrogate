import { handlePublicApiRequest } from './api'
import { answerProtocolQuestion, detectScamOrPhishing } from './ai'
import { handleMcpHttpRequest } from './mcp'
import { safeSecretEquals, verifyTelegramInitData } from './telegram-auth'
import { resolveWalletIdentity } from './wallet'
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
  fetchSorobitsStatusWorker,
  fetchTokenMetaSummary,
  fetchTokenShoutsData,
  fetchUserQuestStatus,
  findTokenBySymbol,
  resolveWorkerNetwork,
} from './rpc'
import type {
  BotLang,
  BotRenderedView,
  Env,
  TelegramCallbackQuery,
  TelegramChatMemberUpdated,
  TelegramMessage,
  TelegramUser,
  TelegramUpdate,
} from './types'
import {
  buildAccountInspectorView,
  buildAiAnswerView,
  buildCommunityDigestView,
  buildGroupWelcomeView,
  buildHelpView,
  buildInlineMarketResults,
  buildInvalidTokenUsageView,
  buildKingOfTheHillView,
  buildLaunchView,
  buildMarketView,
  buildModerationWarningView,
  buildQuestsView,
  buildRewardsView,
  buildSecretKeyWarningView,
  buildShoutsView,
  buildSorobitsView,
  buildTokenInspectorView,
  buildV42RulesView,
  buildWalletResolveView,
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
const DEFAULT_FEED_CHAT_ID = '-1003912502880'
const seenEventIds = new Set<string>()
let lastPolledLedger = 0

const TELEGRAM_API = 'https://api.telegram.org'

export { verifyTelegramInitData }

async function callTelegram(
  token: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<Response> {
  const signal =
    typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
      ? AbortSignal.timeout(8_000)
      : undefined
  return fetch(`${TELEGRAM_API}/bot${encodeURIComponent(token)}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal,
  })
}

function sendTypingNonBlocking(
  token: string,
  chatId: number,
  threadId?: number,
): void {
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    action: 'typing',
  }
  if (typeof threadId === 'number') payload.message_thread_id = threadId
  void callTelegram(token, 'sendChatAction', payload).catch(() => undefined)
}

async function sendRenderedView(
  token: string,
  chatId: number,
  view: BotRenderedView,
  replyToMessageId?: number,
  threadId?: number,
): Promise<boolean> {
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
    if (typeof threadId === 'number') photoPayload.message_thread_id = threadId
    if (replyParams) photoPayload.reply_parameters = replyParams
    const photoRes = await callTelegram(token, 'sendPhoto', photoPayload)
    if (photoRes.ok) return true
  }

  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: view.text,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: view.reply_markup,
  }
  if (typeof threadId === 'number') payload.message_thread_id = threadId
  if (replyParams) payload.reply_parameters = replyParams
  let res = await callTelegram(token, 'sendMessage', payload)
  if (res.status === 429) {
    const retryJson = (await res.json().catch(() => null)) as {
      parameters?: { retry_after?: number }
    } | null
    const waitSec = Math.min(3, Math.max(1, Number(retryJson?.parameters?.retry_after ?? 1)))
    await new Promise((r) => setTimeout(r, waitSec * 1000))
    res = await callTelegram(token, 'sendMessage', payload)
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    console.error('[AstroGate Bot] sendMessage failed:', chatId, res.status, errText)
    return false
  }
  return true
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
  threadId?: number,
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
        await sendRenderedView(token, chatId, view, undefined, threadId)
      }
    }
    return
  }

  // Telegram does not allow converting text <-> photo in-place via editMessage*
  if (isPhoto !== wantsPhoto) {
    const sent = await sendRenderedView(token, chatId, view, undefined, threadId)
    if (sent) {
      await tryDeleteMessage(token, chatId, messageId)
    }
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
      await sendRenderedView(token, chatId, view, undefined, threadId)
    }
  }
}

function botFlags(env: Env): {
  botUsername: string
  hasMainApp: boolean
  folderUrl?: string
} {
  return {
    botUsername: env.TELEGRAM_BOT_USERNAME || DEFAULT_BOT_USERNAME,
    hasMainApp: env.TELEGRAM_MAIN_APP_ENABLED === 'true',
    folderUrl: env.TELEGRAM_FOLDER_URL?.trim() || undefined,
  }
}

async function resolveContractOrSymbolArg(
  rawArg: string,
  env: Env,
): Promise<string | null> {
  const cleanAddr = rawArg.replace(/[^A-Z2-7]/g, '')
  if (isContractAddr(cleanAddr)) return cleanAddr
  const cleanSym = rawArg.trim().replace(/^\$/, '').toUpperCase()
  if (/^[A-Z0-9]{2,12}$/.test(cleanSym)) {
    return findTokenBySymbol(cleanSym, env)
  }
  return null
}

async function loadKingOfTheHillView(
  env: Env,
  lang: BotLang,
  baseUrl: string,
  inGroup: boolean,
): Promise<BotRenderedView> {
  const { botUsername, hasMainApp } = botFlags(env)
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
    botUsername,
    hasMainApp,
  )
}

async function handleInlineQuery(
  inlineQuery: { id: string; query: string },
  token: string,
  env: Env,
): Promise<void> {
  const { botUsername, hasMainApp } = botFlags(env)
  const snap = await fetchLiveMarketSnapshot(env, 15)
  const results = buildInlineMarketResults(
    snap.items,
    inlineQuery.query,
    botUsername,
    hasMainApp,
  )
  await callTelegram(token, 'answerInlineQuery', {
    inline_query_id: inlineQuery.id,
    results,
    cache_time: 15,
    is_personal: false,
  })
}

async function sendGroupWelcomes(
  chatId: number,
  users: TelegramUser[],
  token: string,
  env: Env,
  threadId?: number,
): Promise<void> {
  const { botUsername, folderUrl, hasMainApp } = botFlags(env)
  for (const user of users) {
    if (user.is_bot) continue
    if (env.ASTRO_KV) {
      const k = `welcome:${chatId}:${user.id}`
      const seen = await env.ASTRO_KV.get(k).catch(() => null)
      if (seen) continue
      await env.ASTRO_KV.put(k, '1', { expirationTtl: 86_400 }).catch(() => undefined)
    }
    await sendRenderedView(
      token,
      chatId,
      buildGroupWelcomeView(user.first_name, botUsername, folderUrl, hasMainApp),
      undefined,
      threadId,
    )
    break
  }
}

async function handleChatMemberUpdate(
  update: TelegramChatMemberUpdated,
  token: string,
  env: Env,
): Promise<void> {
  const oldStatus = update.old_chat_member?.status
  const newStatus = update.new_chat_member?.status
  const joined =
    newStatus === 'member' &&
    (oldStatus === 'left' || oldStatus === 'kicked' || !oldStatus)
  if (!joined || !update.new_chat_member?.user) return
  if (update.chat.type === 'channel') return
  const feedChatId = Number(env.TELEGRAM_FEED_CHAT_ID || DEFAULT_FEED_CHAT_ID)
  if (update.chat.id === feedChatId) return
  await sendGroupWelcomes(
    update.chat.id,
    [update.new_chat_member.user],
    token,
    env,
  )
}

async function handleTextMessage(
  msg: TelegramMessage,
  token: string,
  env: Env,
): Promise<void> {
  const chatId = msg.chat.id
  const threadId = msg.message_thread_id
  const inGroup = msg.chat.type !== 'private'
  const feedChatId = Number(env.TELEGRAM_FEED_CHAT_ID || DEFAULT_FEED_CHAT_ID)

  if (msg.new_chat_members?.length && inGroup && chatId !== feedChatId) {
    await sendGroupWelcomes(chatId, msg.new_chat_members, token, env, threadId)
  }

  const text = (msg.text || msg.caption || '').trim()
  if (!text) return
  if (msg.from?.is_bot) return
  // Enforce English across every Telegram chat, group, and bot interaction
  const lang: BotLang = 'en'
  const replyId = inGroup ? msg.message_id : undefined
  const baseUrl = env.APP_BASE_URL || DEFAULT_APP_BASE_URL
  const { botUsername, hasMainApp, folderUrl } = botFlags(env)

  // 1. Proactive security guard: immediately delete in groups and warn on Stellar Secret Seeds (S...)
  const detected = detectStellarAddress(text)
  if (detected?.kind === 'secret') {
    const deletedInGroup = inGroup
      ? await tryDeleteMessage(token, chatId, msg.message_id)
      : false
    await sendRenderedView(
      token,
      chatId,
      buildSecretKeyWarningView(lang, baseUrl, inGroup, deletedInGroup, botUsername, hasMainApp),
      deletedInGroup ? undefined : replyId,
      threadId,
    )
    return
  }

  // 1b. Group anti-scam / phishing guard
  if (inGroup && chatId !== feedChatId) {
    const mod = detectScamOrPhishing(text)
    if (mod.flagged && mod.reason) {
      const deletedInGroup = await tryDeleteMessage(token, chatId, msg.message_id)
      await sendRenderedView(
        token,
        chatId,
        buildModerationWarningView(mod.reason, deletedInGroup, botUsername),
        deletedInGroup ? undefined : replyId,
        threadId,
      )
      return
    }
  }

  // 2. Slash command router
  const { command, arg } = parseCommandAndArg(text)
  if (command === 'start') {
    const cleanArg = arg.trim()
    if (isContractAddr(cleanArg)) {
      sendTypingNonBlocking(token, chatId, threadId)
      const data = await fetchLiveTokenInspectorData(cleanArg, env)
      await sendRenderedView(
        token,
        chatId,
        buildTokenInspectorView(cleanArg, data, lang, baseUrl, inGroup, botUsername, hasMainApp),
        replyId,
        threadId,
      )
      return
    }
    if (cleanArg === 'launch' || cleanArg === 'create') {
      await sendRenderedView(
        token,
        chatId,
        buildLaunchView(lang, baseUrl, true, inGroup, botUsername, hasMainApp),
        replyId,
        threadId,
      )
      return
    }
    if (cleanArg === 'market') {
      sendTypingNonBlocking(token, chatId, threadId)
      const snap = await fetchLiveMarketSnapshot(env)
      await sendRenderedView(
        token,
        chatId,
        buildMarketView(snap.items, lang, baseUrl, snap.rpcFailed, inGroup, botUsername, hasMainApp),
        replyId,
        threadId,
      )
      return
    }
    if (cleanArg === 'king' || cleanArg === 'hill' || cleanArg === 'sprint') {
      sendTypingNonBlocking(token, chatId, threadId)
      const view = await loadKingOfTheHillView(env, lang, baseUrl, inGroup)
      await sendRenderedView(token, chatId, view, replyId, threadId)
      return
    }
    if (cleanArg === 'wallet' || cleanArg === 'portfolio') {
      await sendRenderedView(
        token,
        chatId,
        buildWalletView(lang, baseUrl, inGroup, botUsername, hasMainApp),
        replyId,
        threadId,
      )
      return
    }
    if (cleanArg === 'sorobits' || cleanArg === 'nfts') {
      await sendRenderedView(
        token,
        chatId,
        buildSorobitsView(baseUrl, inGroup, botUsername, hasMainApp),
        replyId,
        threadId,
      )
      return
    }
    if (cleanArg === 'quests') {
      await sendRenderedView(
        token,
        chatId,
        buildQuestsView(lang, baseUrl, inGroup, botUsername, undefined, hasMainApp),
        replyId,
        threadId,
      )
      return
    }
    if (cleanArg === 'rewards') {
      await sendRenderedView(
        token,
        chatId,
        buildRewardsView(lang, baseUrl, inGroup, botUsername, undefined, hasMainApp),
        replyId,
        threadId,
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
        botUsername,
        inGroup,
        { hasMainApp, folderUrl },
      ),
      replyId,
      threadId,
    )
    return
  }

  if (command === 'market') {
    sendTypingNonBlocking(token, chatId, threadId)
    const snap = await fetchLiveMarketSnapshot(env)
    await sendRenderedView(
      token,
      chatId,
      buildMarketView(snap.items, lang, baseUrl, snap.rpcFailed, inGroup, botUsername, hasMainApp),
      replyId,
      threadId,
    )
    return
  }

  if (command === 'king' || command === 'hill' || command === 'sprint') {
    sendTypingNonBlocking(token, chatId, threadId)
    const view = await loadKingOfTheHillView(env, lang, baseUrl, inGroup)
    await sendRenderedView(token, chatId, view, replyId, threadId)
    return
  }

  if (command === 'launch' || command === 'create') {
    await sendRenderedView(
      token,
      chatId,
      buildLaunchView(lang, baseUrl, false, inGroup, botUsername, hasMainApp),
      replyId,
      threadId,
    )
    return
  }

  if (command === 'wallet' || command === 'portfolio') {
    const cleanArg = arg.trim()
    if (command === 'wallet' && cleanArg) {
      sendTypingNonBlocking(token, chatId, threadId)
      const resolved = await resolveWalletIdentity(cleanArg, env)
      await sendRenderedView(
        token,
        chatId,
        buildWalletResolveView(
          cleanArg,
          resolved,
          baseUrl,
          inGroup,
          botUsername,
          hasMainApp,
        ),
        replyId,
        threadId,
      )
      return
    }
    await sendRenderedView(
      token,
      chatId,
      buildWalletView(lang, baseUrl, inGroup, botUsername, hasMainApp),
      replyId,
      threadId,
    )
    return
  }

  if (command === 'v42' || command === 'rules') {
    await sendRenderedView(
      token,
      chatId,
      buildV42RulesView(lang, baseUrl, inGroup, botUsername, hasMainApp),
      replyId,
      threadId,
    )
    return
  }

  if (command === 'rewards' || command === 'bounties' || command === 'airdrop') {
    await sendRenderedView(
      token,
      chatId,
      buildRewardsView(lang, baseUrl, inGroup, botUsername, undefined, hasMainApp),
      replyId,
      threadId,
    )
    return
  }

  if (command === 'claim') {
    const cleanAcct = arg.replace(/[^A-Z2-7]/g, '')
    if (!isAccountAddr(cleanAcct)) {
      await sendRenderedView(
        token,
        chatId,
        buildRewardsView(lang, baseUrl, inGroup, botUsername, undefined, hasMainApp),
        replyId,
        threadId,
      )
      return
    }
    sendTypingNonBlocking(token, chatId, threadId)
    const account = await fetchHorizonAccountSummary(cleanAcct, env)
    await sendRenderedView(
      token,
      chatId,
      buildRewardsView(lang, baseUrl, inGroup, botUsername, account, hasMainApp),
      replyId,
      threadId,
    )
    return
  }

  if (command === 'sorobits' || command === 'nft' || command === 'nfts') {
    await sendRenderedView(
      token,
      chatId,
      buildSorobitsView(baseUrl, inGroup, botUsername, hasMainApp),
      replyId,
      threadId,
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
        buildQuestsView(lang, baseUrl, inGroup, botUsername, undefined, hasMainApp),
        replyId,
        threadId,
      )
      return
    }
    sendTypingNonBlocking(token, chatId, threadId)
    const progress = await fetchUserQuestStatus(cleanAcct, env)
    await sendRenderedView(
      token,
      chatId,
      buildQuestsView(lang, baseUrl, inGroup, botUsername, progress, hasMainApp),
      replyId,
      threadId,
    )
    return
  }

  if (command === 'shouts') {
    sendTypingNonBlocking(token, chatId, threadId)
    const resolved = arg ? await resolveContractOrSymbolArg(arg, env) : null
    const targetToken = resolved ?? ASTRO_TOKEN_ID
    const data = await fetchTokenShoutsData(targetToken, env)
    await sendRenderedView(
      token,
      chatId,
      buildShoutsView(targetToken, data, lang, baseUrl, inGroup, botUsername, hasMainApp),
      replyId,
      threadId,
    )
    return
  }

  if (command === 'help') {
    await sendRenderedView(
      token,
      chatId,
      buildHelpView(lang, baseUrl, inGroup, botUsername, hasMainApp),
      replyId,
      threadId,
    )
    return
  }

  if (command === 'token') {
    sendTypingNonBlocking(token, chatId, threadId)
    const resolved = await resolveContractOrSymbolArg(arg, env)
    if (!resolved) {
      await sendRenderedView(
        token,
        chatId,
        buildInvalidTokenUsageView(lang, baseUrl, inGroup, botUsername, hasMainApp),
        replyId,
        threadId,
      )
      return
    }
    const data = await fetchLiveTokenInspectorData(resolved, env)
    await sendRenderedView(
      token,
      chatId,
      buildTokenInspectorView(resolved, data, lang, baseUrl, inGroup, botUsername, hasMainApp),
      replyId,
      threadId,
    )
    return
  }

  if (command === 'ask' || command === 'ai') {
    const question = arg.trim()
    if (!question) {
      await sendRenderedView(
        token,
        chatId,
        buildAiAnswerView(
          'Ask me anything about AstroGate, Fair-Flywheel v4.4, Soroswap graduations, or Sorobits NFTs — e.g. /ask how do I launch a token?',
          false,
          baseUrl,
          inGroup,
          botUsername,
          hasMainApp,
        ),
        replyId,
        threadId,
      )
      return
    }
    sendTypingNonBlocking(token, chatId, threadId)
    const ai = await answerProtocolQuestion(question, msg.from?.id, env)
    await sendRenderedView(
      token,
      chatId,
      buildAiAnswerView(ai.answer, ai.poweredByAi, baseUrl, inGroup, botUsername, hasMainApp),
      replyId,
      threadId,
    )
    return
  }

  // 3. Bare address pasted in chat -> smart live inspector
  if (detected?.kind === 'contract') {
    sendTypingNonBlocking(token, chatId, threadId)
    const data = await fetchLiveTokenInspectorData(detected.value, env)
    await sendRenderedView(
      token,
      chatId,
      buildTokenInspectorView(detected.value, data, lang, baseUrl, inGroup, botUsername, hasMainApp),
      replyId,
      threadId,
    )
    return
  }

  if (detected?.kind === 'account') {
    sendTypingNonBlocking(token, chatId, threadId)
    const account = await fetchHorizonAccountSummary(detected.value, env)
    await sendRenderedView(
      token,
      chatId,
      buildAccountInspectorView(detected.value, account, lang, baseUrl, inGroup, botUsername, hasMainApp),
      replyId,
      threadId,
    )
    return
  }

  // 3b. $TICKER mention (e.g. $ASTRO) -> live token card
  const ticker = !command ? detectTickerMention(text) : null
  if (ticker) {
    const matchedId = await findTokenBySymbol(ticker, env)
    if (matchedId) {
      sendTypingNonBlocking(token, chatId, threadId)
      const data = await fetchLiveTokenInspectorData(matchedId, env)
      await sendRenderedView(
        token,
        chatId,
        buildTokenInspectorView(matchedId, data, lang, baseUrl, inGroup, botUsername, hasMainApp),
        replyId,
        threadId,
      )
      return
    }
  }

  // 4. Conversational AI Copilot: respond in DMs, or in groups when explicitly mentioned or replied to
  const botTag = `@${botUsername.toLowerCase()}`
  const isBotMentioned = text.toLowerCase().includes(botTag)
  const isReplyToBot =
    msg.reply_to_message?.from?.username?.toLowerCase() === botUsername.toLowerCase()

  if (!inGroup || isBotMentioned || isReplyToBot) {
    const cleanedQuestion = text.replace(new RegExp(`@${botUsername}`, 'ig'), '').trim()
    if (cleanedQuestion.length >= 2) {
      sendTypingNonBlocking(token, chatId, threadId)
      const ai = await answerProtocolQuestion(cleanedQuestion, msg.from?.id, env)
      await sendRenderedView(
        token,
        chatId,
        buildAiAnswerView(ai.answer, ai.poweredByAi, baseUrl, inGroup, botUsername, hasMainApp),
        replyId,
        threadId,
      )
      return
    }
    if (!inGroup) {
      await sendRenderedView(
        token,
        chatId,
        buildWelcomeView(msg.from?.first_name, lang, baseUrl, botUsername, false, {
          hasMainApp,
          folderUrl,
        }),
      )
    }
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
  const { botUsername, hasMainApp, folderUrl } = botFlags(env)

  // Always dismiss spinner promptly
  await callTelegram(token, 'answerCallbackQuery', {
    callback_query_id: query.id,
  }).catch(() => undefined)

  if (!msg) return
  const chatId = msg.chat.id
  const messageId = msg.message_id
  const threadId = msg.message_thread_id
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
          botUsername,
          inGroup,
          { hasMainApp, folderUrl },
        ),
        isPhoto,
        threadId,
      )
      return
    }
    if (viewName === 'mkt') {
      const snap = await fetchLiveMarketSnapshot(env)
      await editRenderedView(
        token,
        chatId,
        messageId,
        buildMarketView(snap.items, lang, baseUrl, snap.rpcFailed, inGroup, botUsername, hasMainApp),
        isPhoto,
        threadId,
      )
      return
    }
    if (viewName === 'koth') {
      const view = await loadKingOfTheHillView(env, lang, baseUrl, inGroup)
      await editRenderedView(token, chatId, messageId, view, isPhoto, threadId)
      return
    }
    if (viewName === 'sbt') {
      await editRenderedView(
        token,
        chatId,
        messageId,
        buildSorobitsView(baseUrl, inGroup, botUsername, hasMainApp),
        isPhoto,
        threadId,
      )
      return
    }
    if (viewName === 'lnch') {
      await editRenderedView(
        token,
        chatId,
        messageId,
        buildLaunchView(lang, baseUrl, false, inGroup, botUsername, hasMainApp),
        isPhoto,
        threadId,
      )
      return
    }
    if (viewName === 'wal') {
      await editRenderedView(
        token,
        chatId,
        messageId,
        buildWalletView(lang, baseUrl, inGroup, botUsername, hasMainApp),
        isPhoto,
        threadId,
      )
      return
    }
    if (viewName === 'v42') {
      await editRenderedView(
        token,
        chatId,
        messageId,
        buildV42RulesView(lang, baseUrl, inGroup, botUsername, hasMainApp),
        isPhoto,
        threadId,
      )
      return
    }
    if (viewName === 'qst') {
      await editRenderedView(
        token,
        chatId,
        messageId,
        buildQuestsView(lang, baseUrl, inGroup, botUsername, undefined, hasMainApp),
        isPhoto,
        threadId,
      )
      return
    }
    if (viewName === 'rew') {
      await editRenderedView(
        token,
        chatId,
        messageId,
        buildRewardsView(lang, baseUrl, inGroup, botUsername, undefined, hasMainApp),
        isPhoto,
        threadId,
      )
      return
    }
    if (viewName === 'help') {
      await editRenderedView(
        token,
        chatId,
        messageId,
        buildHelpView(lang, baseUrl, inGroup, botUsername, hasMainApp),
        isPhoto,
        threadId,
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
      buildTokenInspectorView(tokenId, info, lang, baseUrl, inGroup, botUsername, hasMainApp),
      isPhoto,
      threadId,
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
      buildShoutsView(tokenId, shoutsData, lang, baseUrl, inGroup, botUsername, hasMainApp),
      isPhoto,
      threadId,
    )
    return
  }

  if (kind === 'a' && parts[1] && isAccountAddr(parts[1])) {
    const accountId = parts[1]
    const lang: BotLang = 'en'
    const account = await fetchHorizonAccountSummary(accountId, env)
    await editRenderedView(
      token,
      chatId,
      messageId,
      buildAccountInspectorView(accountId, account, lang, baseUrl, inGroup, botUsername, hasMainApp),
      isPhoto,
      threadId,
    )
  }
}

async function claimEventOnce(eventKey: string, env?: Env): Promise<boolean> {
  if (seenEventIds.has(eventKey)) return false
  seenEventIds.add(eventKey)
  if (seenEventIds.size > 500) {
    const first = seenEventIds.values().next().value
    if (first) seenEventIds.delete(first)
  }
  try {
    if (env?.ASTRO_KV) {
      const kvKey = `ev:${eventKey}`
      const existing = await env.ASTRO_KV.get(kvKey)
      if (existing) return false
      await env.ASTRO_KV.put(kvKey, '1', { expirationTtl: 604_800 })
    }
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
    // Fallback to isolate memory deduplication when KV / Edge Cache is unavailable
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
    const fresh = await claimEventOnce(dedupeKey, env)
    if (!fresh) continue

    let meta = metaCache.get(ev.tokenId)
    if (!meta) {
      meta =
        ev.kind === 'sorobit_mint' || ev.kind === 'sorobit_evolve'
          ? { symbol: 'SBIT', name: 'Sorobits', decimals: 0 }
          : await fetchTokenMetaSummary(ev.tokenId, env)
      metaCache.set(ev.tokenId, meta)
    }
    const botUsername = env.TELEGRAM_BOT_USERNAME || DEFAULT_BOT_USERNAME
    const view = renderLaunchpadEventTelegramView(ev, meta, botUsername)

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

const API_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
}

export function pulseCorsHeaders(
  origin: string | null,
  appBaseUrl?: string,
  requestOrigin?: string,
): Record<string, string> {
  const allowedOrigins = new Set<string>(['https://astrogate.pages.dev'])
  if (appBaseUrl && appBaseUrl.startsWith('https://')) {
    allowedOrigins.add(appBaseUrl.replace(/\/+$/, ''))
  }
  if (requestOrigin && requestOrigin.startsWith('https://')) {
    allowedOrigins.add(requestOrigin.replace(/\/+$/, ''))
  }
  let allowed = 'https://astrogate.pages.dev'
  if (origin && (allowedOrigins.has(origin) || /^https:\/\/[a-z0-9-]+\.astrogate\.pages\.dev$/.test(origin))) {
    allowed = origin
  }
  return {
    ...API_SECURITY_HEADERS,
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Telegram-Init-Data',
    Vary: 'Origin',
  }
}

async function isPulseRateLimited(ip: string): Promise<boolean> {
  try {
    const cacheStorage = (globalThis as { caches?: { open: (n: string) => Promise<Cache> } }).caches
    if (!cacheStorage) return false
    const cache = await cacheStorage.open('astrogate-pulse-rl-v1')
    const req = new Request(`https://rl.astrogate.internal/${encodeURIComponent(ip)}`)
    const hit = await cache.match(req)
    if (hit) return true
    await cache.put(
      req,
      new Response('1', { headers: { 'Cache-Control': 'public, max-age=5' } }),
    )
  } catch {
    return false
  }
  return false
}

export async function handleWorkerRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === '/health') {
    const cfg = resolveWorkerNetwork(env)
    return Response.json(
      {
        ok: true,
        service: 'astrogate-telegram-bot',
        network: cfg.network,
        launchpad: cfg.launchpadContractId,
      },
      { headers: API_SECURITY_HEADERS },
    )
  }

  if (
    url.pathname === '/.well-known/stellar.toml' &&
    env.STELLAR_NETWORK === 'mainnet'
  ) {
    const treasury = env.DEVELOPER_TREASURY_ADDRESS?.trim() || ''
    const baseUrl = (env.APP_BASE_URL || url.origin).replace(/\/+$/, '')
    const accountsLine = treasury ? `ACCOUNTS=[\n  "${treasury}"\n]\n\n` : ''
    const toml =
      `VERSION="2.1.0"\n\n` +
      `NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"\n\n` +
      accountsLine +
      `[DOCUMENTATION]\n` +
      `ORG_NAME="AstroGate · Built by NunaLabs"\n` +
      `ORG_URL="${baseUrl}"\n` +
      `ORG_LOGO="${baseUrl}/icon-512.png"\n` +
      `ORG_DESCRIPTION="Fair-Flywheel v4.4 Launchpad + Soroswap AMM & Sorobits (SBIT) On-Chain Genomic NFTs on Stellar Soroban Mainnet · Built by NunaLabs."\n`
    return new Response(toml, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }

  const publicApiResponse = await handlePublicApiRequest(request, env)
  if (publicApiResponse) return publicApiResponse

  const mcpResponse = await handleMcpHttpRequest(request, env)
  if (mcpResponse) return mcpResponse

  if (url.pathname === '/api/telegram/pulse') {
    const cors = pulseCorsHeaders(
      request.headers.get('Origin'),
      env.APP_BASE_URL,
      url.origin,
    )
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: cors })
    }
    if (!env.TELEGRAM_BOT_TOKEN) {
      return Response.json({ ok: false, posted: 0 }, { status: 200, headers: cors })
    }

    const initData = request.headers.get('X-Telegram-Init-Data')
    if (initData) {
      const validInit = await verifyTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN)
      if (!validInit) {
        return Response.json({ ok: false, error: 'Invalid initData' }, { status: 401, headers: cors })
      }
    } else {
      const origin = request.headers.get('Origin')
      const allowedOrigin =
        origin === 'https://astrogate.pages.dev' ||
        origin === url.origin ||
        (origin && /^https:\/\/[a-z0-9-]+\.astrogate\.pages\.dev$/.test(origin)) ||
        (env.APP_BASE_URL && origin === env.APP_BASE_URL.replace(/\/+$/, ''))
      if (!allowedOrigin) {
        return Response.json({ ok: false, error: 'Unauthorized origin' }, { status: 403, headers: cors })
      }
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
    if (await isPulseRateLimited(ip)) {
      return Response.json({ ok: false, error: 'Rate limited' }, { status: 429, headers: cors })
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
      const events = await fetchLaunchpadEventsByTxHash(txHash, env, 180)
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
      return new Response('Method Not Allowed', {
        status: 405,
        headers: API_SECURITY_HEADERS,
      })
    }
    const secretHeader = request.headers.get('X-Telegram-Bot-Api-Secret-Token')
    const authorized = await safeSecretEquals(
      secretHeader,
      env.TELEGRAM_WEBHOOK_SECRET,
    )
    if (!authorized) {
      return new Response('Unauthorized', {
        status: 401,
        headers: API_SECURITY_HEADERS,
      })
    }
    if (!env.TELEGRAM_BOT_TOKEN) {
      return new Response('Bot token not configured', {
        status: 500,
        headers: API_SECURITY_HEADERS,
      })
    }

    let update: TelegramUpdate
    try {
      update = (await request.json()) as TelegramUpdate
    } catch {
      return new Response('Bad Request', {
        status: 400,
        headers: API_SECURITY_HEADERS,
      })
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
      } else if (update.chat_member) {
        await handleChatMemberUpdate(
          update.chat_member,
          env.TELEGRAM_BOT_TOKEN,
          env,
        )
      } else if (update.message) {
        await handleTextMessage(update.message, env.TELEGRAM_BOT_TOKEN, env)
      } else if (update.edited_message) {
        const editedText = (
          update.edited_message.text ||
          update.edited_message.caption ||
          ''
        ).trim()
        const isSecret = Boolean(
          editedText && detectStellarAddress(editedText)?.kind === 'secret',
        )
        const isScam = Boolean(
          editedText &&
            update.edited_message.chat.type !== 'private' &&
            detectScamOrPhishing(editedText).flagged,
        )
        if (isSecret || isScam) {
          await handleTextMessage(
            update.edited_message,
            env.TELEGRAM_BOT_TOKEN,
            env,
          )
        }
      }
    } catch (err) {
      console.error('[AstroGate Bot] Update handling error:', err)
    }

    // Always return 200 OK to Telegram after auth so retries don't stall updates
    return Response.json({ ok: true }, { headers: API_SECURITY_HEADERS })
  }

  return env.ASSETS.fetch(request)
}

const DIGEST_INTERVAL_MS = 12 * 60 * 60 * 1000

async function maybeSendCommunityDigest(token: string, env: Env): Promise<void> {
  if (!env.ASTRO_KV) return
  const communityChatId = Number(
    env.TELEGRAM_COMMUNITY_CHAT_ID || DEFAULT_COMMUNITY_CHAT_ID,
  )
  if (!Number.isFinite(communityChatId)) return

  const lastRaw = await env.ASTRO_KV.get('last_community_digest_ts')
  const lastTs = Number(lastRaw ?? '0')
  const now = Date.now()
  if (Number.isFinite(lastTs) && lastTs > 0 && now - lastTs < DIGEST_INTERVAL_MS) {
    return
  }

  const [snap, sorobits] = await Promise.all([
    fetchLiveMarketSnapshot(env, 5),
    fetchSorobitsStatusWorker(env),
  ])
  if (snap.items.length === 0) return

  const { botUsername, folderUrl, hasMainApp } = botFlags(env)
  const sent = await sendRenderedView(
    token,
    communityChatId,
    buildCommunityDigestView(
      snap.items,
      sorobits.totalSupply,
      botUsername,
      folderUrl,
      hasMainApp,
    ),
  )
  if (sent) {
    await env.ASTRO_KV.put('last_community_digest_ts', String(now), {
      expirationTtl: 172_800,
    })
  }
}

export default {
  fetch: handleWorkerRequest,

  async scheduled(_controller: unknown, env: Env): Promise<void> {
    if (!env.TELEGRAM_BOT_TOKEN) return
    try {
      let startLedger = lastPolledLedger > 0 ? lastPolledLedger : undefined
      if (!startLedger && env.ASTRO_KV) {
        const stored = await env.ASTRO_KV.get('last_polled_ledger')
        const parsed = Number(stored ?? '0')
        if (Number.isFinite(parsed) && parsed > 0) startLedger = parsed
      }
      const { events, latestLedger } = await fetchRecentLaunchpadEvents(
        startLedger,
        env,
      )
      if (latestLedger > 0) {
        const nextCursor = latestLedger + 1
        lastPolledLedger = nextCursor
        if (env.ASTRO_KV) {
          await env.ASTRO_KV.put('last_polled_ledger', String(nextCursor))
        }
      }
      await broadcastLaunchpadEvents(events, env.TELEGRAM_BOT_TOKEN, env)
      await maybeSendCommunityDigest(env.TELEGRAM_BOT_TOKEN, env)
    } catch (err) {
      console.error('[AstroGate Bot] Scheduled feed sync error:', err)
    }
  },
}
