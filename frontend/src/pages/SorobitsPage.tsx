import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ASTROGATE_QUEST_BADGES,
  computePilotPerks,
  computeQuestSummary,
  type PilotTelegramPerks,
  type QuestProgressSummary,
} from '../../worker/quests'
import { explorerAccountUrl, explorerContractUrl } from '../lib/explorer'
import { errorMessage, shortAddress } from '../lib/format'
import { formatUsdPrice } from '../lib/soroswap'
import { DEFAULT_XLM_USD_PRICE, validateXlmReserve } from '../lib/xlm'
import { useXlmBalance } from '../hooks/useXlmBalance'
import { useXlmUsdPrice } from '../hooks/useXlmUsdPrice'
import {
  NETWORK_NAME,
  SOROBITS_CONTRACT_ID,
  SOROBITS_WASM_HASH,
} from '../lib/network'
import {
  COSMIC_REALMS,
  claimPioneerOnChain,
  claimQuestBadgeOnChain,
  computeLivePilotXp,
  fetchCapsuleQuota,
  fetchClaimedArchetypes,
  fetchLaunchpadPilotTelemetry,
  fetchSorobitById,
  fetchSorobitsByOwner,
  fetchSorobitsSummary,
  forgeAscendOnChain,
  formatCollectorTrait,
  formatTraitLabel,
  generationLabel,
  getRealmForItem,
  hasClaimedPioneer,
  mintCapsuleOnChain,
  nextTierProgress,
  syncEpigeneticsOnChain,
  type SorobitOnChainItem,
} from '../lib/sorobits'
import {
  notifyTelegramPulse,
  shareToTelegram,
  telegramMiniAppUrl,
  triggerTelegramHaptic,
} from '../lib/telegram'
import {
  SorobitEvolutionModal,
  type SorobitEvolutionReveal,
} from '../components/SorobitEvolutionModal'
import { toast } from '../lib/toast'
import { useActivity } from '../store/activity'
import { useCreatedTokens } from '../store/creations'
import { useWallet } from '../store/wallet'

function parseTokenParam(raw: string | null): number | null {
  if (!raw) return null
  const num = Number(raw)
  return Number.isInteger(num) && num >= 0 ? num : null
}

export function SorobitsPage() {
  const { publicKey, openWalletModal, requireSignerOrPrompt } = useWallet()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const createdTokens = useCreatedTokens((s) => s.tokens)
  const activityEntries = useActivity((s) => s.entries)
  const { data: xlmUsd = DEFAULT_XLM_USD_PRICE } = useXlmUsdPrice()
  const xlmBalance = useXlmBalance(publicKey)

  const modalTokenId = parseTokenParam(searchParams.get('token'))
  const [tokenLookupInput, setTokenLookupInput] = useState('')
  const [lookupInput, setLookupInput] = useState('')
  const [claimingPioneer, setClaimingPioneer] = useState(false)
  const [mintingCapsule, setMintingCapsule] = useState(false)
  const [claimingArchetype, setClaimingArchetype] = useState<number | null>(null)
  const [syncingTokenId, setSyncingTokenId] = useState<number | null>(null)
  const [forging, setForging] = useState(false)
  const [forgeSelection, setForgeSelection] = useState<[string, string]>(['', ''])
  const [confirmForgePair, setConfirmForgePair] = useState<string | null>(null)
  const [evolutionReveal, setEvolutionReveal] =
    useState<SorobitEvolutionReveal | null>(null)
  const anyBusy =
    claimingPioneer ||
    mintingCapsule ||
    claimingArchetype !== null ||
    syncingTokenId !== null ||
    forging

  const openTokenModal = useCallback(
    (tokenId: number) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set('token', String(tokenId))
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const closeTokenModal = useCallback(() => {
    setSearchParams(
      (prev) => {
        if (!prev.has('token')) return prev
        const next = new URLSearchParams(prev)
        next.delete('token')
        return next
      },
      { replace: true },
    )
  }, [setSearchParams])

  useEffect(() => {
    if (modalTokenId === null) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeTokenModal()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [modalTokenId, closeTokenModal])

  const inspectedAddress = useMemo(() => {
    const clean = lookupInput.trim().toUpperCase()
    if (/^G[A-Z2-7]{55}$/.test(clean)) return clean
    return publicKey ?? null
  }, [lookupInput, publicKey])

  const summary = useQuery({
    queryKey: ['sorobits-summary', SOROBITS_CONTRACT_ID],
    queryFn: fetchSorobitsSummary,
    staleTime: 60_000,
    retry: 1,
  })

  const onChainPilot = useQuery({
    queryKey: ['launchpad-pilot', inspectedAddress],
    queryFn: () => fetchLaunchpadPilotTelemetry(inspectedAddress as string),
    enabled: Boolean(inspectedAddress),
    staleTime: 30_000,
    retry: 1,
  })

  const ownedTokens = useQuery({
    queryKey: ['sorobits-owner', SOROBITS_CONTRACT_ID, inspectedAddress],
    queryFn: () => fetchSorobitsByOwner(inspectedAddress as string, 50),
    enabled: Boolean(inspectedAddress),
    staleTime: 30_000,
    retry: 1,
  })

  const ownedModalMatch = useMemo(
    () =>
      modalTokenId === null
        ? null
        : ((ownedTokens.data ?? []).find((t) => t.tokenId === modalTokenId) ??
          null),
    [modalTokenId, ownedTokens.data],
  )

  const inspectedToken = useQuery({
    queryKey: ['sorobits-token', SOROBITS_CONTRACT_ID, modalTokenId],
    queryFn: () => fetchSorobitById(modalTokenId as number),
    enabled: modalTokenId !== null && !ownedModalMatch,
    staleTime: 60_000,
    retry: 1,
  })

  const pioneerClaimed = useQuery({
    queryKey: ['sorobits-pioneer-claimed', SOROBITS_CONTRACT_ID, inspectedAddress],
    queryFn: () => hasClaimedPioneer(inspectedAddress as string),
    enabled: Boolean(inspectedAddress),
    staleTime: 30_000,
    retry: 1,
  })

  const claimedArchetypes = useQuery({
    queryKey: [
      'sorobits-claimed-archetypes',
      SOROBITS_CONTRACT_ID,
      inspectedAddress,
    ],
    queryFn: () => fetchClaimedArchetypes(inspectedAddress as string),
    enabled: Boolean(inspectedAddress),
    staleTime: 30_000,
    retry: 1,
  })

  const capsuleQuota = useQuery({
    queryKey: ['sorobits-capsule-quota', SOROBITS_CONTRACT_ID, inspectedAddress],
    queryFn: () => fetchCapsuleQuota(inspectedAddress as string),
    enabled: Boolean(inspectedAddress),
    staleTime: 30_000,
    retry: 1,
  })

  const remoteQuests = useQuery({
    queryKey: ['sorobits-remote-quests', inspectedAddress],
    queryFn: async (): Promise<QuestProgressSummary | null> => {
      try {
        const res = await fetch(`/api/v1/quests/${inspectedAddress}`)
        if (!res.ok) return null
        const ctype = res.headers.get('content-type') || ''
        if (!ctype.includes('application/json')) return null
        const data = (await res.json()) as { ok?: boolean } & QuestProgressSummary
        return data.ok && data.unlocked ? data : null
      } catch {
        return null
      }
    },
    enabled: Boolean(inspectedAddress) && typeof window !== 'undefined',
    staleTime: 30_000,
    retry: false,
  })

  const localQuestProgress = useMemo(() => {
    const accountEntries = inspectedAddress
      ? activityEntries.filter(
          (entry) =>
            entry.status === 'success' &&
            (!entry.account || entry.account === inspectedAddress),
        )
      : []
    const shoutEntries = accountEntries.filter(
      (entry) =>
        entry.kind === 'burn' &&
        Boolean(entry.detail?.toLowerCase().includes('burn-to-chat')),
    )
    const swapEntries = accountEntries.filter((entry) => entry.kind === 'swap')
    const createdByUser = createdTokens.filter(
      (t) => !inspectedAddress || !t.creator || t.creator === inspectedAddress,
    )

    return computeQuestSummary({
      accountId:
        inspectedAddress ??
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      funded: Boolean(inspectedAddress),
      launchedCount: createdByUser.length,
      shoutCount: shoutEntries.length,
      graduatedCount: accountEntries.some((e) =>
        Boolean(e.detail?.toLowerCase().includes('grad')),
      )
        ? 1
        : 0,
      swapCount: swapEntries.length,
      assetCount: createdByUser.length,
      kingBurnCount: shoutEntries.filter(
        (e) => Number((e.amount ?? '0').replace(/,/g, '')) >= 5000,
      ).length,
    })
  }, [inspectedAddress, activityEntries, createdTokens])

  const questProgress = useMemo(() => {
    const remote = remoteQuests.data
    const pilot = onChainPilot.data
    const launchedCount = Math.max(
      remote?.launchedCount ?? 0,
      pilot?.launches ?? 0,
      localQuestProgress.launchedCount,
    )
    const shoutCount = Math.max(
      remote?.shoutCount ?? 0,
      pilot?.shouts ?? 0,
      localQuestProgress.shoutCount,
    )
    const graduatedCount = Math.max(
      remote?.graduatedCount ?? 0,
      pilot?.graduations ?? 0,
      localQuestProgress.graduatedCount,
    )
    const swapCount = Math.max(
      remote?.swapCount ?? 0,
      pilot?.trades ?? 0,
      localQuestProgress.swapCount,
    )
    const kingBurnCount = Math.max(
      remote?.kingBurnCount ?? 0,
      pilot?.kingShouts ?? 0,
      localQuestProgress.kingBurnCount,
    )
    const burnsTriggered = Math.max(
      remote?.burnsTriggered ?? 0,
      pilot?.burnsTriggered ?? 0,
    )
    const remoteVol = remote?.volumeXlmStroops
      ? BigInt(remote.volumeXlmStroops)
      : undefined
    const pilotVol = pilot?.volumeXlmStroops
    const volumeXlmStroops =
      pilotVol !== undefined || remoteVol !== undefined
        ? (pilotVol ?? 0n) >= (remoteVol ?? 0n)
          ? (pilotVol ?? remoteVol)
          : remoteVol
        : undefined
    return computeQuestSummary({
      accountId: remote?.accountId ?? localQuestProgress.accountId,
      funded: Boolean(remote?.funded || localQuestProgress.funded),
      launchedCount,
      shoutCount,
      graduatedCount,
      swapCount,
      assetCount: Math.max(
        remote?.assetCount ?? 0,
        localQuestProgress.assetCount,
      ),
      ecosystemTokenCount: remote?.unlocked.og ? 1 : undefined,
      kingBurnCount,
      volumeXlmStroops,
      burnsTriggered,
    })
  }, [remoteQuests.data, onChainPilot.data, localQuestProgress])

  async function invalidateSorobitsQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['sorobits-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['sorobits-owner'] }),
      queryClient.invalidateQueries({ queryKey: ['sorobits-pioneer-claimed'] }),
      queryClient.invalidateQueries({
        queryKey: ['sorobits-claimed-archetypes'],
      }),
      queryClient.invalidateQueries({ queryKey: ['sorobits-capsule-quota'] }),
      queryClient.invalidateQueries({ queryKey: ['sorobits-token'] }),
      queryClient.invalidateQueries({ queryKey: ['xlm-balance'] }),
    ])
  }

  async function onClaimPioneer() {
    if (anyBusy) return
    const xlmErr = validateXlmReserve(xlmBalance.data, 0n, publicKey)
    if (xlmErr) {
      toast.error(xlmErr)
      return
    }
    const signer = requireSignerOrPrompt()
    if (!signer) return
    setClaimingPioneer(true)
    try {
      const { tokenId, hash } = await claimPioneerOnChain(signer)
      if (hash) void notifyTelegramPulse(hash)
      toast.success(`Claimed your free Starter Sorobit #${tokenId}!`)
      await invalidateSorobitsQueries()
      openTokenModal(tokenId)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setClaimingPioneer(false)
    }
  }

  async function onMintCapsule() {
    if (anyBusy) return
    const xlmErr = validateXlmReserve(xlmBalance.data, 70_000_000n, publicKey)
    if (xlmErr) {
      toast.error(xlmErr)
      return
    }
    const signer = requireSignerOrPrompt()
    if (!signer) return
    setMintingCapsule(true)
    try {
      const { tokenId, hash } = await mintCapsuleOnChain(signer)
      if (hash) void notifyTelegramPulse(hash)
      toast.success(`🎲 Summoned Mystery Sorobit #${tokenId} (7 XLM)!`)
      await invalidateSorobitsQueries()
      openTokenModal(tokenId)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setMintingCapsule(false)
    }
  }

  async function onClaimQuestBadge(archetypeId: number, title: string) {
    if (anyBusy) return
    const xlmErr = validateXlmReserve(xlmBalance.data, 0n, publicKey)
    if (xlmErr) {
      toast.error(xlmErr)
      return
    }
    const signer = requireSignerOrPrompt()
    if (!signer) return
    setClaimingArchetype(archetypeId)
    try {
      const { tokenId, hash } = await claimQuestBadgeOnChain(
        signer,
        archetypeId,
      )
      if (hash) void notifyTelegramPulse(hash)
      toast.success(`Claimed ${title} Sorobit #${tokenId}!`)
      await invalidateSorobitsQueries()
      openTokenModal(tokenId)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setClaimingArchetype(null)
    }
  }

  async function onSyncEpigenetics(tokenId: number) {
    if (anyBusy) return
    const xlmErr = validateXlmReserve(xlmBalance.data, 0n, publicKey)
    if (xlmErr) {
      toast.error(xlmErr)
      return
    }
    const signer = requireSignerOrPrompt()
    if (!signer) return
    setSyncingTokenId(tokenId)
    try {
      const beforeItem =
        (ownedTokens.data ?? []).find((t) => t.tokenId === tokenId) ??
        (activeModalItem?.tokenId === tokenId ? activeModalItem : null) ??
        (await fetchSorobitById(tokenId))
      const { xpScore, rankTier, hash } = await syncEpigeneticsOnChain(
        signer,
        tokenId,
      )
      if (hash) void notifyTelegramPulse(hash)
      triggerTelegramHaptic('success')
      toast.success(
        `Synced Sorobit #${tokenId}: Shield Tier ${rankTier} · ${xpScore} XP`,
      )
      const afterItem = await fetchSorobitById(tokenId)
      if (beforeItem && afterItem) {
        setEvolutionReveal({
          kind: 'sync',
          before: beforeItem,
          after: afterItem,
          perks: computePilotPerks(questProgress),
          txHash: hash,
        })
      }
      await invalidateSorobitsQueries()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSyncingTokenId(null)
    }
  }

  const tradeableOwned = useMemo(
    () => (ownedTokens.data ?? []).filter((item) => !item.soulbound),
    [ownedTokens.data],
  )

  const resolvedForgeIds = useMemo((): [number | null, number | null] => {
    if (tradeableOwned.length < 2) return [null, null]
    const validIds = new Set(tradeableOwned.map((t) => t.tokenId))
    const parsedA = forgeSelection[0] ? Number(forgeSelection[0]) : NaN
    const idA = validIds.has(parsedA) ? parsedA : tradeableOwned[0].tokenId
    const parsedB = forgeSelection[1] ? Number(forgeSelection[1]) : NaN
    const fallbackB =
      tradeableOwned.find((t) => t.tokenId !== idA)?.tokenId ?? null
    const idB =
      validIds.has(parsedB) && parsedB !== idA ? parsedB : fallbackB
    return [idA, idB]
  }, [forgeSelection, tradeableOwned])

  async function onForgeAscend() {
    if (anyBusy) return
    const [burnIdA, burnIdB] = resolvedForgeIds
    if (burnIdA === null || burnIdB === null || burnIdA === burnIdB) {
      toast.error('Select two distinct tradeable Sorobits to forge.')
      return
    }
    const xlmErr = validateXlmReserve(xlmBalance.data, 0n, publicKey)
    if (xlmErr) {
      toast.error(xlmErr)
      return
    }
    const pairKey = `${burnIdA}:${burnIdB}`
    if (confirmForgePair !== pairKey) {
      setConfirmForgePair(pairKey)
      triggerTelegramHaptic('medium')
      return
    }
    setConfirmForgePair(null)
    const signer = requireSignerOrPrompt()
    if (!signer) return
    setForging(true)
    try {
      const parentA =
        tradeableOwned.find((t) => t.tokenId === burnIdA) ??
        (await fetchSorobitById(burnIdA))
      const parentB =
        tradeableOwned.find((t) => t.tokenId === burnIdB) ??
        (await fetchSorobitById(burnIdB))
      const { tokenId, hash } = await forgeAscendOnChain(
        signer,
        burnIdA,
        burnIdB,
      )
      if (hash) void notifyTelegramPulse(hash)
      triggerTelegramHaptic('success')
      toast.success(
        `⚒️ Forged Ascended Sorobit #${tokenId} (fused #${burnIdA} & #${burnIdB})!`,
      )
      setForgeSelection(['', ''])
      const forgedChild = await fetchSorobitById(tokenId)
      await invalidateSorobitsQueries()
      openTokenModal(tokenId)
      if (parentA && parentB && forgedChild) {
        setEvolutionReveal({
          kind: 'forge',
          parents: [parentA, parentB],
          after: forgedChild,
          perks: computePilotPerks(questProgress),
          txHash: hash,
        })
      }
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setForging(false)
    }
  }

  function onSelectForForge(tokenId: number) {
    const other =
      tradeableOwned.find((t) => t.tokenId !== tokenId)?.tokenId ?? ''
    setForgeSelection([String(tokenId), other ? String(other) : ''])
    setConfirmForgePair(null)
    closeTokenModal()
    const el = document.getElementById('astral-forge')
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function onInspectTokenById(e: React.FormEvent) {
    e.preventDefault()
    const parsed = parseTokenParam(tokenLookupInput.trim().replace(/^#/, ''))
    if (parsed === null) {
      toast.error('Enter a valid numeric Sorobit ID (e.g. 0, 5, 12).')
      return
    }
    openTokenModal(parsed)
    setTokenLookupInput('')
  }

  const claimedSet = useMemo(
    () => new Set(claimedArchetypes.data ?? []),
    [claimedArchetypes.data],
  )
  const perks = useMemo(() => computePilotPerks(questProgress), [questProgress])
  const livePilotXp = useMemo(
    () => computeLivePilotXp(onChainPilot.data, claimedSet.size),
    [onChainPilot.data, claimedSet.size],
  )
  const starterToken = useMemo(
    () => (ownedTokens.data ?? []).find((t) => t.edition === 1 || t.soulbound),
    [ownedTokens.data],
  )
  const bonusBadges = useMemo(
    () => ASTROGATE_QUEST_BADGES.slice(1),
    [],
  )
  const totalSupply = summary.data?.totalSupply ?? 0
  const activeModalItem = ownedModalMatch ?? inspectedToken.data ?? null
  const isOwnerSession = Boolean(publicKey && inspectedAddress === publicKey)

  return (
    <div className="space-y-5">
      {/* Hero + Immediate 3-Step Mint & Evolve Journey */}
      <section className="relative overflow-hidden rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-slate-900 via-indigo-950/50 to-slate-950 p-5 sm:p-7 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-indigo-200">
              <span>🧬 100% On-Chain Cosmic Pilots</span>
              <span className="text-emerald-300">
                · {NETWORK_NAME === 'mainnet' ? 'Stellar Mainnet' : 'Stellar Testnet'}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Sorobits (<span className="font-mono text-sky-300">SBIT</span>)
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              Claim a free starter pilot, open 7 XLM Mystery Capsules, and fuse 2
              Sorobits into rarer generations — every trait and pixel lives
              permanently on Stellar.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-xl border border-white/10 bg-slate-950/75 px-3.5 py-2 text-center">
              <p className="text-[10px] uppercase tracking-wider text-slate-400">
                Minted
              </p>
              <p className="font-mono text-sm font-bold text-white">
                {summary.isLoading ? '…' : totalSupply}{' '}
                <span className="text-sky-300">SBIT</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                shareToTelegram(
                  '🧬 Explore Sorobits (SBIT) — Claim your free cosmic pilot & mint 7 XLM Mystery Capsules on AstroGate!',
                  telegramMiniAppUrl('sorobits'),
                )
              }
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2.5 text-xs font-semibold text-slate-200 hover:bg-white/10 transition"
            >
              📤 Share
            </button>
            <a
              href={explorerContractUrl(SOROBITS_CONTRACT_ID)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-sky-400/30 bg-sky-500/15 px-3.5 py-2.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/25 transition"
            >
              🔍 Contract ↗
            </a>
            <Link
              to="/portfolio"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/70 px-3.5 py-2.5 text-xs font-semibold text-slate-300 hover:text-white transition"
            >
              👛 Portfolio
            </Link>
          </div>
        </div>

        {/* Step 1 / 2 / 3 Right At The Top */}
        <div className="grid gap-3 sm:grid-cols-3">
          {/* Step 1: Free Starter */}
          <div className="rounded-xl border border-emerald-500/30 bg-slate-950/80 p-4 flex flex-col justify-between gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="font-bold text-emerald-300">STEP 1 · FREE</span>
                <span className="text-slate-400">0 XLM · Starter</span>
              </div>
              <p className="text-base font-bold text-white">
                🎁 Claim Free Sorobit
              </p>
              <p className="text-xs text-slate-400 leading-snug">
                Your permanent pilot passport. Grows XP and upgrades its Shield
                as you explore AstroGate.
              </p>
            </div>
            {publicKey ? (
              pioneerClaimed.data ? (
                <button
                  type="button"
                  onClick={() => {
                    if (starterToken) {
                      openTokenModal(starterToken.tokenId)
                    } else {
                      document
                        .getElementById('my-sorobits')
                        ?.scrollIntoView({ behavior: 'smooth' })
                    }
                  }}
                  className="w-full rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition"
                >
                  ✓ Starter Active{' '}
                  {starterToken ? `(#${starterToken.tokenId} · View)` : ''}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={anyBusy}
                  onClick={() => void onClaimPioneer()}
                  className="w-full rounded-xl bg-emerald-500 px-3 py-2.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 transition"
                >
                  {claimingPioneer ? 'Claiming…' : '🎁 Claim Free (0 XLM)'}
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={() => openWalletModal('connect')}
                className="w-full rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 transition"
              >
                Connect Wallet to Claim
              </button>
            )}
          </div>

          {/* Step 2: Mystery Capsule */}
          <div className="rounded-xl border border-amber-500/30 bg-slate-950/80 p-4 flex flex-col justify-between gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="font-bold text-amber-300">STEP 2 · MYSTERY</span>
                <span className="text-slate-400">
                  7 XLM (≈ ${formatUsdPrice(7 * xlmUsd)}) ·{' '}
                  {capsuleQuota.data
                    ? `${capsuleQuota.data.minted}/${capsuleQuota.data.maxAllowed}`
                    : '2 Base'}{' '}
                  Slots
                </span>
              </div>
              <p className="text-base font-bold text-white">
                🎲 Mint Mystery Capsule
              </p>
              <p className="text-xs text-slate-400 leading-snug">
                Summon a tradeable random Sorobit. Unlock more capsule slots by
                trading or forging.
              </p>
            </div>
            {publicKey ? (
              <button
                type="button"
                disabled={
                  anyBusy ||
                  Boolean(
                    capsuleQuota.data &&
                      capsuleQuota.data.minted >= capsuleQuota.data.maxAllowed,
                  )
                }
                onClick={() => void onMintCapsule()}
                className="w-full rounded-xl bg-amber-500 px-3 py-2.5 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition"
              >
                {mintingCapsule
                  ? 'Summoning…'
                  : capsuleQuota.data &&
                      capsuleQuota.data.minted >= capsuleQuota.data.maxAllowed
                    ? 'Slot Cap Reached (Trade or Forge)'
                    : '🎲 Mint Capsule · 7 XLM'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openWalletModal('connect')}
                className="w-full rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-2.5 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 transition"
              >
                Connect Wallet to Mint
              </button>
            )}
          </div>

          {/* Step 3: Evolve & Forge */}
          <div className="rounded-xl border border-sky-500/30 bg-slate-950/80 p-4 flex flex-col justify-between gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="font-bold text-sky-300">STEP 3 · EVOLVE</span>
                <span className="text-slate-400">2 → 1 Gen+1</span>
              </div>
              <p className="text-base font-bold text-white">
                ⚒️ Forge Next Generation
              </p>
              <p className="text-xs text-slate-400 leading-snug">
                Fuse 2 tradeable Sorobits into a rarer Gen+1 pilot (+500 XP, +1
                Shield Tier &amp; frees 1 slot).
              </p>
            </div>
            {tradeableOwned.length >= 2 ? (
              <button
                type="button"
                onClick={() =>
                  document
                    .getElementById('astral-forge')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
                className="w-full rounded-xl bg-sky-500 px-3 py-2.5 text-xs font-bold text-slate-950 hover:bg-sky-400 transition"
              >
                🔥 Ready ({tradeableOwned.length} Forgeable) · Go to Forge ↓
              </button>
            ) : (
              <span className="inline-flex items-center justify-center rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2.5 text-xs font-semibold text-sky-200">
                {tradeableOwned.length}/2 Tradeable · Mint Capsules to Forge
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Collection, Sync XP, Forge & Bonus Milestone Rewards */}
      <section
        id="my-sorobits"
        className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 sm:p-6 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">
              👾 {isOwnerSession ? 'Your Sorobits Collection' : 'Sorobits Collection'}
            </h2>
            <p className="text-xs text-slate-400">
              Click any Sorobit to inspect its cosmic traits, perks, generation &amp;
              evolution tier.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <form
              onSubmit={onInspectTokenById}
              className="flex items-center gap-1.5"
            >
              <input
                type="text"
                inputMode="numeric"
                value={tokenLookupInput}
                onChange={(e) => setTokenLookupInput(e.target.value)}
                placeholder="ID #…"
                aria-label="Inspect Sorobit by token ID"
                className="w-20 rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
              />
              <button
                type="submit"
                className="rounded-xl border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-slate-200 hover:border-sky-400 transition"
              >
                View #
              </button>
            </form>
            {!publicKey ? (
              <button
                type="button"
                onClick={() => openWalletModal('connect')}
                className="rounded-xl bg-sky-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400 transition"
              >
                Connect Wallet
              </button>
            ) : null}
          </div>
        </div>

        {/* Sync XP Clarity Strip */}
        <div className="rounded-xl border border-indigo-500/25 bg-indigo-950/20 px-3.5 py-2.5 text-xs text-indigo-100 flex flex-wrap items-center justify-between gap-2">
          <span>
            <strong className="text-indigo-300">⚡ What is Sync XP?</strong>{' '}
            It connects on-chain to the AstroGate Launchpad and converts your
            token launches, swaps &amp; shouts into Sorobit XP and Shield frame
            upgrades.
          </span>
          {inspectedAddress ? (
            <span className="font-mono text-[11px] text-indigo-300">
              Wallet Activity XP: {livePilotXp} XP
            </span>
          ) : null}
        </div>

        {/* Wallet / Address Lookup */}
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={lookupInput}
            onChange={(e) => setLookupInput(e.target.value)}
            placeholder={
              publicKey
                ? `Connected: ${shortAddress(publicKey)} (or paste any G... wallet)`
                : 'Paste any Stellar address (G...) to view their Sorobits'
            }
            className="min-w-[240px] flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
          />
          {lookupInput ? (
            <button
              type="button"
              onClick={() => setLookupInput('')}
              className="rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-300 hover:bg-slate-800"
            >
              Clear
            </button>
          ) : null}
        </div>

        {inspectedAddress ? (
          <div className="space-y-4">
            {/* Compact Pilot Perks Summary */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs">
              <div>
                <p className="text-[10px] uppercase text-slate-500">
                  Owned Sorobits
                </p>
                <p className="font-mono font-bold text-sky-300">
                  {ownedTokens.isLoading ? '…' : (ownedTokens.data?.length ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-slate-500">
                  AstroGate Rank
                </p>
                <p className="font-mono font-bold text-white">
                  {perks.chatTitle}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-slate-500">
                  Sprint Boost
                </p>
                <p className="font-mono font-bold text-amber-300">
                  {perks.sprintMultiplier}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-slate-500">
                  VIP Alpha
                </p>
                <p className="font-mono font-bold text-emerald-300">
                  {perks.vipAlphaAccess ? 'Unlocked ✓' : 'Trade to Unlock'}
                </p>
              </div>
            </div>

            {/* Owned NFTs Grid (Newest & New Generations First) */}
            {ownedTokens.isLoading ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((idx) => (
                  <div
                    key={idx}
                    className="h-24 rounded-xl border border-slate-800 bg-slate-950/60 animate-pulse"
                  />
                ))}
              </div>
            ) : ownedTokens.data && ownedTokens.data.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {ownedTokens.data.map((item) => {
                  const realm = getRealmForItem(item)
                  const xpDelta = Math.max(0, livePilotXp - item.xpScore)
                  const isAscended = item.generation > 0
                  return (
                    <div
                      key={item.tokenId}
                      className={`group flex flex-col justify-between gap-2.5 rounded-xl border bg-slate-950/90 p-3.5 transition ${
                        isAscended
                          ? 'border-amber-400/50 hover:border-amber-300'
                          : 'border-slate-800 hover:border-sky-400'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => openTokenModal(item.tokenId)}
                        className="flex min-w-0 items-center gap-3 text-left"
                      >
                        <img
                          src={item.animatedDataUrl}
                          alt={item.name}
                          className="h-16 w-16 shrink-0 rounded-xl border border-slate-700 bg-slate-950 group-hover:scale-105 transition"
                          style={{ imageRendering: 'pixelated' }}
                        />
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-xs font-bold text-white">
                              #{item.tokenId}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                isAscended
                                  ? 'bg-amber-500/20 text-amber-300'
                                  : item.soulbound
                                    ? 'bg-emerald-500/15 text-emerald-300'
                                    : 'bg-sky-500/15 text-sky-300'
                              }`}
                            >
                              {generationLabel(item)}
                            </span>
                          </div>
                          <p className={`truncate text-xs font-semibold ${realm.badge}`}>
                            {realm.name}
                          </p>
                          <p className="font-mono text-[11px] text-slate-400">
                            Tier {item.rankTier} · {item.xpScore} XP
                          </p>
                        </div>
                      </button>

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/80">
                        <button
                          type="button"
                          onClick={() => openTokenModal(item.tokenId)}
                          className="text-[11px] font-semibold text-sky-300 hover:text-sky-200 transition"
                        >
                          🔍 Traits &amp; Perks →
                        </button>
                        {isOwnerSession ? (
                          <button
                            type="button"
                            disabled={anyBusy}
                            onClick={() => void onSyncEpigenetics(item.tokenId)}
                            className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50 transition ${
                              xpDelta > 0
                                ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'
                                : 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200 hover:bg-indigo-500/25'
                            }`}
                            title="Reads your AstroGate Launchpad activity on-chain to update XP, Shield tier & TTL"
                          >
                            {syncingTokenId === item.tokenId
                              ? 'Syncing…'
                              : xpDelta > 0
                                ? `⚡ Sync +${xpDelta} XP`
                                : '⚡ Sync XP'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-400">
                  No Sorobits held by {shortAddress(inspectedAddress)} yet.
                  Start by claiming your free Starter Pilot above!
                </p>
                {isOwnerSession && !pioneerClaimed.data ? (
                  <button
                    type="button"
                    disabled={anyBusy}
                    onClick={() => void onClaimPioneer()}
                    className="rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 transition"
                  >
                    {claimingPioneer
                      ? 'Claiming…'
                      : '🎁 Claim Free Pilot (0 XLM)'}
                  </button>
                ) : null}
              </div>
            )}

            {/* Astral Forge (2 -> 1 Gen+1) */}
            {isOwnerSession && tradeableOwned.length >= 2 ? (
              <div
                id="astral-forge"
                className="rounded-xl border border-amber-500/35 bg-amber-950/15 p-4 space-y-3"
              >
                <div>
                  <p className="text-sm font-bold text-amber-200">
                    ⚒️ Astral Forge (2 → 1 Ascended Gen+1)
                  </p>
                  <p className="text-xs text-slate-400">
                    Combine any 2 tradeable Sorobits to forge 1 higher-generation
                    pilot (+500 bonus XP, +1 Shield Tier, and 1 freed Capsule
                    slot).
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    aria-label="First Sorobit to burn"
                    disabled={anyBusy}
                    value={String(resolvedForgeIds[0] ?? '')}
                    onChange={(e) => {
                      setForgeSelection([e.target.value, forgeSelection[1]])
                      setConfirmForgePair(null)
                    }}
                    className="min-w-[160px] flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 disabled:opacity-50"
                  >
                    {tradeableOwned.map((t) => (
                      <option
                        key={t.tokenId}
                        value={String(t.tokenId)}
                        disabled={t.tokenId === resolvedForgeIds[1]}
                      >
                        #{t.tokenId} · {getRealmForItem(t).name} (Gen{' '}
                        {t.generation} · {t.xpScore} XP)
                      </option>
                    ))}
                  </select>
                  <span className="font-mono text-xs font-bold text-amber-300">
                    +
                  </span>
                  <select
                    aria-label="Second Sorobit to burn"
                    disabled={anyBusy}
                    value={String(resolvedForgeIds[1] ?? '')}
                    onChange={(e) => {
                      setForgeSelection([forgeSelection[0], e.target.value])
                      setConfirmForgePair(null)
                    }}
                    className="min-w-[160px] flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 disabled:opacity-50"
                  >
                    {tradeableOwned.map((t) => (
                      <option
                        key={t.tokenId}
                        value={String(t.tokenId)}
                        disabled={t.tokenId === resolvedForgeIds[0]}
                      >
                        #{t.tokenId} · {getRealmForItem(t).name} (Gen{' '}
                        {t.generation} · {t.xpScore} XP)
                      </option>
                    ))}
                  </select>
                  {confirmForgePair ===
                    `${resolvedForgeIds[0]}:${resolvedForgeIds[1]}` &&
                  resolvedForgeIds[0] !== null &&
                  resolvedForgeIds[1] !== null ? (
                    <>
                      <button
                        type="button"
                        disabled={anyBusy}
                        onClick={() => void onForgeAscend()}
                        className="rounded-xl bg-rose-500 px-4 py-2 text-xs font-bold text-white hover:bg-rose-400 disabled:opacity-50 transition"
                      >
                        {forging
                          ? 'Forging…'
                          : `⚠️ Confirm Burn #${resolvedForgeIds[0]} & #${resolvedForgeIds[1]}`}
                      </button>
                      <button
                        type="button"
                        disabled={anyBusy}
                        onClick={() => setConfirmForgePair(null)}
                        className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50 transition"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={
                        anyBusy ||
                        resolvedForgeIds[0] === null ||
                        resolvedForgeIds[1] === null ||
                        resolvedForgeIds[0] === resolvedForgeIds[1]
                      }
                      onClick={() => void onForgeAscend()}
                      className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition"
                    >
                      {forging ? 'Forging…' : '🔥 Burn 2 & Forge Gen+1'}
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* Compact Bonus Milestone Unlocks (without duplicate old badge cards) */}
        <div className="pt-2 border-t border-slate-800/80 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-white">
                ✨ Bonus Milestone Sorobits
              </h3>
              <p className="text-xs text-slate-400">
                Earn extra free on-chain Sorobits automatically as you launch
                and trade on AstroGate.
              </p>
            </div>
            <Link
              to="/market"
              className="text-xs font-semibold text-sky-400 hover:underline"
            >
              Explore Market →
            </Link>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {bonusBadges.map((badge, idx) => {
              const archetypeId = idx + 2
              const unlocked = Boolean(
                inspectedAddress && questProgress.unlocked[badge.id],
              )
              const claimedOnChain = claimedSet.has(archetypeId)
              const canClaim = unlocked && !claimedOnChain && isOwnerSession
              return (
                <div
                  key={badge.id}
                  className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-xs ${
                    claimedOnChain || unlocked
                      ? 'border-emerald-500/35 bg-emerald-950/15'
                      : 'border-slate-800 bg-slate-950/60'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-white">
                      {badge.emoji} {badge.title}
                    </p>
                    <p className="truncate text-[11px] text-slate-400">
                      {badge.criteria}
                    </p>
                  </div>
                  {claimedOnChain ? (
                    <span className="shrink-0 font-mono text-[10px] font-bold text-emerald-300">
                      ✓ Claimed
                    </span>
                  ) : canClaim ? (
                    <button
                      type="button"
                      disabled={anyBusy}
                      onClick={() =>
                        void onClaimQuestBadge(archetypeId, badge.title)
                      }
                      className="shrink-0 rounded-lg bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 transition"
                    >
                      {claimingArchetype === archetypeId ? '…' : 'Claim'}
                    </button>
                  ) : (
                    <span className="shrink-0 text-[10px] text-slate-500">
                      {unlocked ? 'Ready' : 'Locked'}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* 7 Cosmic Realms (Collector Lore) */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-white">
          ✨ 7 Cosmic Realms (Collector Lore)
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          Every Sorobit belongs to one of seven timeless Stellar realms —
          shaping its starlight palette, rare gear, and destiny in the cosmos.
        </p>

        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {COSMIC_REALMS.map((realm) => (
            <div
              key={realm.name}
              className={`rounded-xl border bg-gradient-to-br p-3 ${realm.accent}`}
            >
              <p className={`text-xs font-bold ${realm.badge}`}>{realm.name}</p>
              <p className="mt-0.5 text-[11px] font-medium text-white/90">
                {realm.tagline}
              </p>
              <p className="mt-1.5 text-[11px] text-slate-300/80 leading-snug">
                {realm.description}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-4 font-mono text-[11px] text-slate-500 break-all">
          Sorobits Contract: {SOROBITS_CONTRACT_ID} · WASM: {SOROBITS_WASM_HASH}
        </p>
      </section>

      {/* Interactive NFT Detail Modal */}
      {modalTokenId !== null ? (
        <SorobitDetailModal
          tokenId={modalTokenId}
          item={activeModalItem}
          isLoading={!activeModalItem && inspectedToken.isLoading}
          perks={perks}
          livePilotXp={livePilotXp}
          isOwner={Boolean(
            publicKey &&
              activeModalItem &&
              activeModalItem.owner === publicKey,
          )}
          canForgeThis={Boolean(
            publicKey &&
              activeModalItem &&
              activeModalItem.owner === publicKey &&
              !activeModalItem.soulbound &&
              tradeableOwned.length >= 2,
          )}
          syncing={anyBusy}
          onSync={() => void onSyncEpigenetics(modalTokenId)}
          onSelectForForge={() => onSelectForForge(modalTokenId)}
          onClose={closeTokenModal}
        />
      ) : null}

      {/* Minimalist Pokémon-style Evolution / Astral Forge Celebration */}
      {evolutionReveal ? (
        <SorobitEvolutionModal
          reveal={evolutionReveal}
          onClose={() => setEvolutionReveal(null)}
        />
      ) : null}
    </div>
  )
}

function SorobitDetailModal({
  tokenId,
  item,
  isLoading,
  perks,
  livePilotXp,
  isOwner,
  canForgeThis,
  syncing,
  onSync,
  onSelectForForge,
  onClose,
}: {
  tokenId: number
  item: SorobitOnChainItem | null
  isLoading: boolean
  perks: PilotTelegramPerks
  livePilotXp: number
  isOwner: boolean
  canForgeThis: boolean
  syncing: boolean
  onSync: () => void
  onSelectForForge: () => void
  onClose: () => void
}) {
  const [animatedMode, setAnimatedMode] = useState(true)
  const [showRawSvg, setShowRawSvg] = useState(false)

  const realm = item ? getRealmForItem(item) : COSMIC_REALMS[0]
  const tierInfo = item
    ? nextTierProgress(item.xpScore, item.rankTier)
    : nextTierProgress(0, 0)
  const xpDelta = item ? Math.max(0, livePilotXp - item.xpScore) : 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={`Sorobit #${tokenId} Details`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="my-auto w-full max-w-2xl rounded-2xl border border-slate-700/80 bg-slate-900 p-5 sm:p-6 shadow-2xl space-y-5">
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-lg bg-sky-500/20 px-2.5 py-0.5 font-mono text-xs font-bold text-sky-300">
                #{tokenId}
              </span>
              {item ? (
                <>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                      item.generation > 0
                        ? 'bg-amber-500/20 text-amber-300'
                        : item.soulbound
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-indigo-500/20 text-indigo-200'
                    }`}
                  >
                    {generationLabel(item)}
                  </span>
                  <span className="rounded-full border border-slate-700 bg-slate-950 px-2.5 py-0.5 text-[11px] text-slate-300">
                    {item.soulbound ? '🔒 Soulbound Passport' : '♻️ Tradeable'}
                  </span>
                </>
              ) : null}
            </div>
            <h2 className="mt-1.5 text-xl font-bold text-white">
              {item ? item.name : `Sorobit #${tokenId}`}
            </h2>
            {item ? (
              <p className="text-xs text-slate-400">
                <span className={`font-semibold ${realm.badge}`}>
                  {realm.name}
                </span>{' '}
                · {realm.tagline} · Owner{' '}
                <a
                  href={explorerAccountUrl(item.owner)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-sky-300 hover:underline"
                >
                  {shortAddress(item.owner)} ↗
                </a>
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Sorobit details"
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-white transition"
          >
            ✕ Close
          </button>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-sm text-slate-400">
            Loading Sorobit #{tokenId} from Stellar Soroban…
          </div>
        ) : !item ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-6 text-center space-y-2">
            <p className="text-sm font-semibold text-white">
              Sorobit #{tokenId} was not found on-chain.
            </p>
            <p className="text-xs text-slate-400">
              It may not have been minted yet, or it was burned in the Astral
              Forge to create a higher generation.
            </p>
          </div>
        ) : (
          <>
            {/* Art + Evolution & Perks */}
            <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
              <div className="flex flex-col items-center rounded-xl border border-slate-800 bg-slate-950 p-3.5 space-y-2.5">
                <img
                  src={animatedMode ? item.animatedDataUrl : item.imageDataUrl}
                  alt={item.name}
                  className="h-44 w-44 rounded-xl border border-slate-700 bg-slate-950"
                  style={{ imageRendering: 'pixelated' }}
                />
                <button
                  type="button"
                  onClick={() => setAnimatedMode((v) => !v)}
                  className={`w-full rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition ${
                    animatedMode
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                      : 'border-slate-700 bg-slate-900 text-slate-300'
                  }`}
                >
                  {animatedMode ? '⚡ Animated Pulse ON' : '🖼 Static Frame'}
                </button>
              </div>

              <div className="space-y-3">
                {/* Shield & XP Evolution Card */}
                <div className="rounded-xl border border-indigo-500/30 bg-slate-950/80 p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-indigo-200">
                      🛡 {tierInfo.currentTierName} (Tier {item.rankTier})
                    </span>
                    <span className="font-mono font-bold text-white">
                      {item.xpScore} XP
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-sky-400 to-emerald-400 transition-all"
                      style={{ width: `${tierInfo.progressPct}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-400">
                    {tierInfo.nextTierName
                      ? `${tierInfo.xpToNext} XP to unlock ${tierInfo.nextTierName} (${tierInfo.nextThreshold} XP) and upgrade this NFT's on-chain pixel frame.`
                      : 'Maximum Celestial Void Halo unlocked — borderless grail edition!'}
                  </p>
                </div>

                {/* Benefits & Advantages */}
                <div className="rounded-xl border border-slate-800 bg-slate-950/80 p-3.5 space-y-2">
                  <p className="text-xs font-bold text-white">
                    🌟 Benefits &amp; What Makes It Unique
                  </p>
                  <ul className="space-y-1.5 text-xs text-slate-300">
                    <li>
                      • <strong className="text-sky-300">AstroGate Perks:</strong>{' '}
                      {perks.chatTitle} ·{' '}
                      <span className="text-amber-300 font-semibold">
                        {perks.sprintMultiplier} Sprint Boost
                      </span>
                      {perks.vipAlphaAccess ? ' · VIP Alpha Eligible' : ''}
                    </li>
                    <li>
                      •{' '}
                      <strong className="text-emerald-300">
                        {item.soulbound ? 'Pilot Passport:' : 'Forge & Trade Power:'}
                      </strong>{' '}
                      {item.soulbound
                        ? 'Permanent identity NFT tied to your wallet that evolves XP across seasons.'
                        : `Tradeable anytime or burn 2→1 in Astral Forge to birth a Gen ${item.generation + 1} (+500 XP & +1 Shield Tier) and free 1 Capsule slot.`}
                    </li>
                    <li>
                      •{' '}
                      <strong className="text-indigo-300">
                        100% On-Chain Permanence:
                      </strong>{' '}
                      Artwork, cosmic sky &amp; traits are rendered directly by
                      Soroban smart contracts — zero IPFS links that can break.
                    </li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Unique Cosmic Traits */}
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                🧬 Unique Cosmic Traits
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {item.attributes.map((attr) => (
                  <div
                    key={attr.trait_type}
                    className="rounded-xl border border-slate-800 bg-slate-950/75 px-3 py-2"
                  >
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">
                      {formatTraitLabel(attr.trait_type)}
                    </p>
                    <p className="truncate font-medium text-xs text-slate-100">
                      {formatCollectorTrait(attr.trait_type, attr.value)}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
              <div className="flex flex-wrap items-center gap-2">
                {isOwner ? (
                  <button
                    type="button"
                    disabled={syncing}
                    onClick={onSync}
                    className={`rounded-xl px-3.5 py-2 text-xs font-bold transition disabled:opacity-50 ${
                      xpDelta > 0
                        ? 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
                        : 'border border-indigo-500/40 bg-indigo-500/20 text-indigo-100 hover:bg-indigo-500/30'
                    }`}
                  >
                    {syncing
                      ? 'Syncing XP…'
                      : xpDelta > 0
                        ? `⚡ Sync +${xpDelta} Launchpad XP`
                        : '⚡ Sync Launchpad XP'}
                  </button>
                ) : null}
                {canForgeThis ? (
                  <button
                    type="button"
                    onClick={onSelectForForge}
                    className="rounded-xl border border-amber-500/40 bg-amber-500/15 px-3.5 py-2 text-xs font-bold text-amber-200 hover:bg-amber-500/25 transition"
                  >
                    ⚒️ Select for Forge
                  </button>
                ) : null}
              </div>

              <button
                type="button"
                onClick={() =>
                  shareToTelegram(
                    `🧬 Check out my Sorobit #${item.tokenId} (${realm.name} · ${generationLabel(item)} · ${item.xpScore} XP) on AstroGate!`,
                    telegramMiniAppUrl('sorobits'),
                  )
                }
                className="rounded-xl border border-sky-500/40 bg-sky-500/15 px-3.5 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-500/25 transition"
              >
                📤 Share in Telegram
              </button>
            </div>

            {/* Collapsible Technical SVG & On-Chain Inspection */}
            <details
              open={showRawSvg}
              onToggle={(e) => setShowRawSvg(e.currentTarget.open)}
              className="rounded-xl border border-slate-800 bg-slate-950/60 p-3 text-xs"
            >
              <summary className="cursor-pointer select-none font-mono text-[11px] text-slate-400 hover:text-slate-200">
                🔬 Technical On-Chain SVG &amp; Ledger Info (
                {item.svgMarkup.length.toLocaleString()} bytes · Ledger #
                {item.bornLedger.toLocaleString()})
              </summary>
              <div className="mt-2.5 space-y-2">
                <p className="font-mono text-[11px] text-slate-500 break-all">
                  Contract: {SOROBITS_CONTRACT_ID}
                </p>
                <pre className="max-h-36 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-2.5 font-mono text-[10px] text-emerald-300">
                  {item.svgMarkup}
                </pre>
              </div>
            </details>
          </>
        )}
      </div>
    </div>
  )
}
