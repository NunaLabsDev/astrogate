import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { useTokenList } from '../hooks/useTokenList'
import { useTokenMetadata } from '../hooks/useTokenMetadata'
import { useXlmBalance } from '../hooks/useXlmBalance'
import { useWallet } from '../store/wallet'
import { NETWORK_NAME, SOROBITS_CONTRACT_ID } from '../lib/network'
import { useCreatedTokens } from '../store/creations'
import { fetchTokenBalance } from '../lib/token'
import { errorMessage, formatAmount, shortAddress } from '../lib/format'
import type { PoolState } from '../lib/soroswap'
import { DEFAULT_XLM_USD_PRICE, xlmToStroops } from '../lib/xlm'
import { toast } from '../lib/toast'
import { useXlmUsdPrice } from '../hooks/useXlmUsdPrice'
import { TokenArt } from '../components/TokenArt'
import { ActivityFeed } from '../components/ActivityFeed'
import { useActivity } from '../store/activity'
import { explorerContractUrl } from '../lib/explorer'
import { fetchSorobitsByOwner, fetchSorobitsSummary } from '../lib/sorobits'
import {
  readTelegramUser,
  shareToTelegram,
  telegramMiniAppUrl,
  triggerTelegramHaptic,
} from '../lib/telegram'
import {
  ASTROGATE_QUEST_BADGES,
  computePilotPerks,
  computeQuestSummary,
  type QuestBadgeId,
} from '../../worker/quests'

type PortfolioToken = {
  id: string
  symbol: string
  name: string
  decimals: number
  created: boolean
  pool: PoolState | null
  ledger: number
}

const MAX_PORTFOLIO_TOKENS = 20

export function PortfolioPage() {
  const {
    publicKey,
    mode,
    hotAccounts,
    hotActiveId,
    hotPrimaryId,
    telegramLink,
    hotUnlocked,
    openWalletModal,
    startDemo,
    demoPending,
    pending,
  } = useWallet()
  const activeHotAccount =
    hotAccounts?.find((a) => a.id === hotActiveId) ?? hotAccounts?.[0] ?? null
  const isActivePrimary = Boolean(
    activeHotAccount &&
      (hotPrimaryId ? activeHotAccount.id === hotPrimaryId : true),
  )
  const createdTokens = useCreatedTokens((state) => state.tokens)
  const activityEntries = useActivity((state) => state.entries)
  const tokenList = useTokenList()
  const xlmBalance = useXlmBalance(publicKey)
  const { data: xlmUsd = DEFAULT_XLM_USD_PRICE } = useXlmUsdPrice()
  const [selectedBadgeId, setSelectedBadgeId] = useState<QuestBadgeId>('pioneer')
  const tgUser = readTelegramUser()

  const sorobitsSummary = useQuery({
    queryKey: ['sorobits-summary', SOROBITS_CONTRACT_ID],
    queryFn: fetchSorobitsSummary,
    staleTime: 60_000,
    retry: 1,
  })

  const ownedSorobits = useQuery({
    queryKey: ['sorobits-owner', SOROBITS_CONTRACT_ID, publicKey],
    queryFn: () => fetchSorobitsByOwner(publicKey as string),
    enabled: Boolean(publicKey),
    staleTime: 30_000,
    retry: 1,
  })

  const tokens = useMemo<PortfolioToken[]>(() => {
    const map = new Map<string, PortfolioToken>()

    for (const token of createdTokens) {
      if (token.creator && publicKey && token.creator !== publicKey) {
        continue
      }
      map.set(token.id, {
        id: token.id,
        symbol: token.symbol ?? shortAddress(token.id),
        name: token.name ?? 'Token created by you',
        decimals: token.decimals,
        created: true,
        pool: null,
        ledger: 0,
      })
    }

    for (const token of tokenList.data ?? []) {
      const existing = map.get(token.id)
      const isOnChainCreator = Boolean(publicKey && token.creator === publicKey)
      map.set(token.id, {
        id: token.id,
        symbol: token.symbol,
        name: token.name,
        decimals: token.decimals,
        created: Boolean(existing?.created || isOnChainCreator),
        pool: token.pool,
        ledger: token.ledger,
      })
    }

    return [...map.values()].sort((a, b) => {
      if (a.created !== b.created) return a.created ? -1 : 1
      return b.ledger - a.ledger
    })
  }, [createdTokens, tokenList.data, publicKey])

  const queriedTokens = useMemo(() => tokens.slice(0, MAX_PORTFOLIO_TOKENS), [tokens])

  const balances = useQueries({
    queries: queriedTokens.map((token) => ({
      queryKey: ['token-balance', token.id, publicKey],
      queryFn: () => fetchTokenBalance(token.id, publicKey as string),
      enabled: Boolean(publicKey),
      staleTime: 30_000,
      retry: 1,
    })),
  })

  const rows = queriedTokens.map((token, index) => ({
    token,
    balance: balances[index],
  }))
  const createdRows = rows.filter((row) => row.token.created)
  const holdingRows = rows.filter(
    (row) => !row.token.created && (row.balance.data ?? 0n) > 0n,
  )
  const balancesPending =
    Boolean(publicKey) && rows.some((row) => row.balance.isPending)

  const totalXlm = rows.reduce((sum, { token, balance }) => {
    if (!balance.data || !token.pool || token.pool.reserveToken === 0n) {
      return sum
    }
    return sum + (balance.data * token.pool.reserveXlm) / token.pool.reserveToken
  }, 0n)

  const walletXlmStroops =
    xlmBalance.data !== undefined ? xlmToStroops(xlmBalance.data) : 0n
  const walletXlmUsd = (Number(walletXlmStroops) / 1e7) * xlmUsd
  const totalUsd = (Number(totalXlm) / 1e7) * xlmUsd
  const netWorthStroops = walletXlmStroops + totalXlm
  const netWorthUsd = walletXlmUsd + totalUsd

  const heldTokenCount = rows.filter((row) => (row.balance.data ?? 0n) > 0n).length

  const accountEntries = publicKey
    ? activityEntries.filter(
        (entry) =>
          entry.status === 'success' &&
          (!entry.account || entry.account === publicKey),
      )
    : []
  const shoutEntries = accountEntries.filter(
    (entry) =>
      entry.kind === 'burn' &&
      Boolean(entry.detail?.toLowerCase().includes('burn-to-chat')),
  )
  const shoutCount = shoutEntries.length
  const kingBurnCount = shoutEntries.filter(
    (entry) => Number((entry.amount ?? '0').replace(/,/g, '')) >= 5000,
  ).length
  const swapCount = accountEntries.filter((entry) => entry.kind === 'swap').length
  const graduatedIds = new Set(
    (tokenList.data ?? []).filter((t) => Boolean(t.pool?.exists)).map((t) => t.id),
  )
  const createdTokensList = tokens.filter((t) => t.created)
  const graduatedCount = new Set([
    ...createdTokensList.filter((t) => graduatedIds.has(t.id)).map((t) => t.id),
    ...accountEntries
      .filter((entry) => entry.kind === 'swap' && graduatedIds.has(entry.tokenId))
      .map((entry) => entry.tokenId),
  ]).size

  const questProgress = computeQuestSummary({
    accountId: publicKey ?? '',
    funded: Boolean(publicKey && walletXlmStroops > 0n),
    launchedCount: createdTokensList.length,
    shoutCount,
    graduatedCount,
    swapCount,
    assetCount: heldTokenCount,
    kingBurnCount,
  })
  const pilotPerks = computePilotPerks(questProgress)

  return (
    <>
      <div>
        <h1 className="text-2xl font-bold sm:text-3xl">Your Portfolio</h1>
        <p className="mt-1 max-w-2xl text-slate-400">
          On-chain launches created by your wallet and holdings from discovered pools.
          Everything is queried directly from Stellar Soroban without a backend.
        </p>
      </div>

      {!publicKey ? (
        <section className="rounded-xl border border-amber-900 bg-amber-950/20 p-4 text-sm text-amber-200 sm:p-6">
          {NETWORK_NAME === 'mainnet'
            ? 'Connect your Stellar wallet to inspect your launches and balances.'
            : 'Connect your wallet or start a 1-click Testnet demo wallet to inspect your launches and balances.'}
          <div className="mt-3 flex flex-wrap gap-2">
            {NETWORK_NAME !== 'mainnet' ? (
              <button
                type="button"
                disabled={demoPending || pending}
                onClick={() => void startDemo().catch((err) => toast.error('Failed to start demo', { message: errorMessage(err) }))}
                className="inline-flex min-h-[44px] items-center rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-300 disabled:opacity-60"
              >
                {demoPending ? 'Funding Demo…' : 'Testnet Demo (10k XLM)'}
              </button>
            ) : null}
            <button
              type="button"
              disabled={pending}
              onClick={() => openWalletModal('connect')}
              className="inline-flex min-h-[44px] items-center rounded-lg border border-amber-700 bg-slate-950/40 px-4 py-2 text-sm font-medium text-amber-100 hover:border-amber-500 disabled:opacity-60"
            >
              {pending ? 'Connecting…' : '⚡ Connect / Create Wallet'}
            </button>
            <Link
              to="/"
              className="inline-flex min-h-[44px] items-center rounded-lg border border-amber-800 px-4 py-2 text-sm hover:border-amber-600"
            >
              Explore Market
            </Link>
          </div>
        </section>
      ) : (
        <>
          {mode === 'hot' && activeHotAccount ? (
            <section className="rounded-2xl border border-sky-500/30 bg-sky-950/15 p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-sky-300">
                    ⚡ AstroGate Native Wallet
                  </span>
                  {telegramLink ? (
                    <span className="inline-flex items-center rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-bold text-emerald-300">
                      @{telegramLink.username} · Linked
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openWalletModal(hotUnlocked ? 'manage' : 'unlock')}
                      className="inline-flex items-center rounded-full border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/25"
                    >
                      + Link @username
                    </button>
                  )}
                  {isActivePrimary ? (
                    <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                      ★ Primary
                    </span>
                  ) : null}
                </div>
                <p className="text-xs text-slate-300 font-mono truncate">
                  {activeHotAccount.label} · {shortAddress(publicKey)} ·{' '}
                  {hotAccounts.length} sub-wallet{hotAccounts.length === 1 ? '' : 's'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => openWalletModal(hotUnlocked ? 'manage' : 'unlock')}
                className="min-h-[40px] rounded-xl border border-sky-500/40 bg-slate-950/60 px-3.5 py-2 text-xs font-bold text-sky-200 hover:bg-sky-500/20"
              >
                ⚙️ Manage Wallets / Export Keys
              </button>
            </section>
          ) : null}

          <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Wallet XLM Balance
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold text-white">
              {xlmBalance.isPending
                ? '…'
                : `${formatAmount(walletXlmStroops, 7)} XLM`}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {xlmBalance.isPending
                ? 'Reading Horizon…'
                : `≈ $${walletXlmUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })} USD (native liquid XLM)`}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Token Holdings Value
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold text-emerald-300">
              {balancesPending
                ? '…'
                : `${formatAmount(totalXlm, 7)} XLM`}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {balancesPending
                ? 'Reading Soroswap pools…'
                : `≈ $${totalUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })} USD spot pool value`}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Total Net Worth · Launches
            </p>
            <p className="mt-1 font-mono text-2xl font-semibold text-amber-300">
              {xlmBalance.isPending || balancesPending
                ? '…'
                : `$${netWorthUsd.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {`${formatAmount(netWorthStroops, 7)} XLM total · `}
              <Link
                to="/create"
                className="text-emerald-400 underline underline-offset-2 hover:text-emerald-300"
              >
                {createdRows.length} {createdRows.length === 1 ? 'launch' : 'launches'} →
              </Link>
            </p>
          </div>
        </section>
        </>
      )}

      <section className="liquid-glass rounded-3xl p-5 sm:p-8 space-y-4">
        <h2 className="text-lg font-semibold text-white">Your Launches</h2>
        {createdRows.length === 0 ? (
          <p className="mt-2 text-sm text-slate-300">
            You have not launched any tokens in this browser yet.{' '}
            <Link
              to="/create"
              className="text-sky-400 underline underline-offset-2 hover:text-sky-300"
            >
              Launch your first token
            </Link>
            .
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-white/[0.08]">
            {createdRows.map(({ token, balance }) => (
              <HoldingRow
                key={token.id}
                token={token}
                balance={balance.data}
                pending={balance.isPending}
                isError={balance.isError}
                hasAccount={Boolean(publicKey)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="liquid-glass rounded-3xl p-5 sm:p-8 space-y-4">
        <h2 className="text-lg font-semibold text-white">Market Holdings</h2>
        {!publicKey ? (
          <p className="mt-2 text-sm text-slate-400">
            Connect your wallet to inspect your on-chain token balances.
          </p>
        ) : tokenList.isPending || balancesPending ? (
          <ul aria-hidden="true" className="mt-3 divide-y divide-white/[0.08]">
            {Array.from({ length: 3 }).map((_, i) => (
              <li key={i} className="flex min-h-[64px] items-center gap-3 py-3 animate-pulse">
                <div className="h-10 w-10 shrink-0 rounded-lg bg-slate-800" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-24 rounded bg-slate-800" />
                  <div className="h-3 w-40 rounded bg-slate-800/60" />
                </div>
                <div className="h-4 w-16 rounded bg-slate-800" />
              </li>
            ))}
          </ul>
        ) : tokenList.isError ? (
          <p className="mt-2 text-sm text-rose-300">
            Unable to read market: {tokenList.error.message}
          </p>
        ) : holdingRows.length === 0 ? (
          <p className="mt-2 text-sm text-slate-300">
            You don't hold any tokens from discovered pairs yet. Receive a transfer or trade on market.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-white/[0.08]">
            {holdingRows.map(({ token, balance }) => (
              <HoldingRow
                key={token.id}
                token={token}
                balance={balance.data}
                pending={balance.isPending}
                isError={balance.isError}
                hasAccount={Boolean(publicKey)}
              />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">
              🧬 Sorobits (<code className="font-mono text-sky-300">SBIT</code>) · Pilot &amp; Quest NFTs
            </h2>
            <p className="text-xs text-slate-400">
              {tgUser.username || tgUser.firstName ? (
                <span className="text-sky-300 font-medium">
                  {tgUser.username ? `@${tgUser.username}` : tgUser.firstName}
                </span>
              ) : (
                'Stellar Pilot'
              )}{' '}
              · {pilotPerks.chatTitle} ·{' '}
              <span className="font-mono text-emerald-300">
                {questProgress.unlockedCount}/{ASTROGATE_QUEST_BADGES.length} Season-1 Quests
              </span>{' '}
              · Built by NunaLabs
            </p>
          </div>
          {publicKey ? (
            <button
              type="button"
              onClick={() =>
                shareToTelegram(
                  `🧬 ${tgUser.username ? `@${tgUser.username}` : 'Pilot'} unlocked ${questProgress.unlockedCount}/${ASTROGATE_QUEST_BADGES.length} Sorobits Season-1 Quests (${pilotPerks.chatTitle}) · Built by NunaLabs`,
                  telegramMiniAppUrl('portfolio'),
                )
              }
              className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/20 transition"
            >
              📤 Share Sorobits
            </button>
          ) : null}
        </div>

        <div className="mt-3 rounded-xl border border-indigo-500/30 bg-slate-950/75 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="rounded bg-indigo-500/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-indigo-300">
                SEP-50 · 100% ON-CHAIN SVG
              </span>
              <span className="text-slate-300">
                Minted:{' '}
                <span className="font-mono font-semibold text-white">
                  {sorobitsSummary.data?.totalSupply ?? '…'}
                </span>
                {' · '}Season 1:{' '}
                <span className="text-emerald-300 font-semibold">
                  {sorobitsSummary.data?.season1Sealed ?? true ? 'Sealed' : 'Open'}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Link
                to="/sorobits"
                className="font-semibold text-sky-300 hover:underline"
              >
                Explore Sorobits Hub →
              </Link>
              <a
                href={explorerContractUrl(SOROBITS_CONTRACT_ID)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[11px] text-slate-400 hover:text-sky-300 hover:underline"
              >
                {shortAddress(SOROBITS_CONTRACT_ID)} ↗
              </a>
            </div>
          </div>

          {(() => {
            const onChainList = ownedSorobits.data ?? []
            if (onChainList.length === 0) {
              return (
                <p className="mt-3 text-xs text-slate-400">
                  {publicKey
                    ? 'You do not hold any minted Sorobits in this wallet yet. Claim your free AGQ01 Pilot in the Sorobits Hub.'
                    : 'Connect your wallet to inspect the Sorobits held by your address.'}
                </p>
              )
            }
            return (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {onChainList.map((item) => (
                  <div
                    key={item.tokenId}
                    className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/70 p-2.5"
                  >
                    <img
                      src={item.animatedDataUrl}
                      alt={item.name}
                      className="h-16 w-16 shrink-0 rounded-lg border border-slate-700 bg-slate-950"
                      style={{ imageRendering: 'pixelated' }}
                    />
                    <div className="min-w-0 text-xs">
                      <p className="truncate font-semibold text-white">
                        {item.name}
                      </p>
                      <p className="font-mono text-[10px] text-slate-400">
                        Held by you · {item.soulbound ? 'Soulbound' : 'Tradeable'}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-sky-300">
                        {item.attributes
                          .filter((a) => ['Faction', 'Suit', 'Stellar Era'].includes(a.trait_type))
                          .map((a) => `${a.value}`)
                          .join(' · ')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )
          })()}
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 rounded-xl border border-slate-800/80 bg-slate-950/60 p-2.5 text-center text-xs">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Sprint Boost</p>
            <p className="font-mono font-bold text-amber-300">{pilotPerks.sprintMultiplier}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Feed Priority</p>
            <p className="font-mono font-bold text-sky-300">
              {pilotPerks.feedPriority ? 'Active' : 'AGQ02+'}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">VIP Alpha</p>
            <p className="font-mono font-bold text-emerald-300">
              {pilotPerks.vipAlphaAccess ? 'Eligible' : 'AGQ04+'}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ASTROGATE_QUEST_BADGES.map((badge) => {
            const unlocked = Boolean(publicKey && questProgress.unlocked[badge.id])
            const isSelected = selectedBadgeId === badge.id
            return (
              <button
                key={badge.id}
                type="button"
                onClick={() => {
                  triggerTelegramHaptic('light')
                  setSelectedBadgeId(badge.id)
                }}
                className={`rounded-xl border p-3 text-center transition ${
                  isSelected
                    ? 'border-amber-400/70 bg-slate-900 ring-1 ring-amber-400/30'
                    : unlocked
                      ? 'border-sky-500/50 bg-sky-950/20 hover:border-sky-400'
                      : 'border-slate-800 bg-slate-950/50 opacity-75 hover:opacity-100'
                }`}
              >
                <img
                  src={badge.imagePath}
                  alt={badge.title}
                  className={`mx-auto h-16 w-16 rounded-lg object-cover ${
                    unlocked ? '' : 'grayscale'
                  }`}
                />
                <p className="mt-2 text-xs font-bold text-slate-100">
                  {badge.emoji} {badge.title}
                </p>
                <p className="font-mono text-[10px] text-slate-400">
                  {badge.assetCode} · {badge.tier}
                </p>
                <span
                  className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    unlocked
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {unlocked ? '✅ Unlocked' : '🔒 Locked'}
                </span>
              </button>
            )
          })}
        </div>

        {(() => {
          const active =
            ASTROGATE_QUEST_BADGES.find((b) => b.id === selectedBadgeId) ??
            ASTROGATE_QUEST_BADGES[0]
          if (!active) return null
          const activeUnlocked = Boolean(publicKey && questProgress.unlocked[active.id])
          const actionPath =
            active.id === 'launcher'
              ? '/create'
              : active.id === 'shouter' ||
                  active.id === 'graduate' ||
                  active.id === 'og' ||
                  active.id === 'whale' ||
                  active.id === 'phoenix' ||
                  active.id === 'legend'
                ? '/market'
                : null
          return (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-xs">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={active.imagePath}
                  alt={active.title}
                  className={`h-11 w-11 shrink-0 rounded-lg ${activeUnlocked ? '' : 'grayscale opacity-75'}`}
                />
                <div className="min-w-0">
                  <p className="font-semibold text-slate-100">
                    {active.emoji} {active.title} ({active.assetCode} · {active.tier})
                  </p>
                  <p className="text-slate-400">{active.criteria}</p>
                </div>
              </div>
              {activeUnlocked ? (
                <button
                  type="button"
                  onClick={() =>
                    shareToTelegram(
                      `🏅 Unlocked ${active.emoji} ${active.title} (${active.assetCode}) on AstroGate · Built by NunaLabs`,
                      telegramMiniAppUrl('portfolio'),
                    )
                  }
                  className="shrink-0 rounded-lg bg-emerald-500/15 px-3 py-1.5 font-semibold text-emerald-300 hover:bg-emerald-500/25 transition"
                >
                  📤 Share {active.assetCode}
                </button>
              ) : actionPath ? (
                <Link
                  to={actionPath}
                  className="shrink-0 rounded-lg bg-sky-500 px-3 py-1.5 font-semibold text-slate-950 hover:bg-sky-400 transition"
                >
                  Complete Quest →
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => openWalletModal('connect')}
                  className="shrink-0 rounded-lg bg-amber-400 px-3 py-1.5 font-semibold text-slate-950 hover:bg-amber-300 transition"
                >
                  Fund Wallet →
                </button>
              )}
            </div>
          )
        })()}
      </section>

      <ActivityFeed />
    </>
  )
}

function HoldingRow({
  token,
  balance,
  pending,
  isError,
  hasAccount,
}: {
  token: PortfolioToken
  balance: bigint | undefined
  pending: boolean
  isError?: boolean
  hasAccount: boolean
}) {
  const meta = useTokenMetadata(token.id)
  // Valor de la tenencia en stroops: balance * reserveXlm / reserveToken.
  // No depende del precio unitario, que en un fair launch es < 1 stroop.
  const value =
    balance && token.pool && token.pool.reserveToken > 0n
      ? (balance * token.pool.reserveXlm) / token.pool.reserveToken
      : 0n
  const hasLiquidity = Boolean(
    token.pool?.exists && token.pool.reserveToken > 0n && token.pool.reserveXlm > 0n,
  )

  return (
    <li>
      <Link
        to={`/token/${token.id}`}
        className="flex min-h-[64px] items-center gap-3 py-3 hover:bg-slate-950/30"
      >
        <TokenArt
          id={token.id}
          symbol={token.symbol}
          logoUrl={meta.data?.logoUrl}
          className="h-10 w-10 shrink-0 rounded-lg"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-100">
            {token.symbol}
            {token.created ? (
              <span className="ml-2 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-300">
                created
              </span>
            ) : null}
          </p>
          <p className="truncate text-xs text-slate-500">
            {token.name} · {shortAddress(token.id)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-sm text-slate-200">
            {!hasAccount
              ? '—'
              : pending
                ? '…'
                : isError
                  ? <span className="text-rose-400 text-xs">Error</span>
                  : `${formatAmount(balance ?? 0n, token.decimals)} ${token.symbol}`}
          </p>
          {hasAccount && !pending && !isError && token.pool ? (
            <p className="text-xs text-slate-500">
              {!hasLiquidity
                ? 'no liquidity'
                : value > 0n
                  ? `≈ ${formatAmount(value, 7)} XLM`
                  : (balance ?? 0n) > 0n
                    ? '< 0.0000001 XLM'
                    : null}
            </p>
          ) : null}
        </div>
      </Link>
    </li>
  )
}
