import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ASTROGATE_QUEST_BADGES,
  computePilotPerks,
  computeQuestSummary,
  type QuestProgressSummary,
} from '../../worker/quests'
import { explorerContractUrl, explorerAccountUrl } from '../lib/explorer'
import { errorMessage, shortAddress } from '../lib/format'
import { formatUsdPrice } from '../lib/soroswap'
import { DEFAULT_XLM_USD_PRICE } from '../lib/xlm'
import { useXlmUsdPrice } from '../hooks/useXlmUsdPrice'
import { SOROBITS_CONTRACT_ID, SOROBITS_WASM_HASH } from '../lib/network'
import {
  claimPioneerOnChain,
  claimQuestBadgeOnChain,
  fetchCapsuleQuota,
  fetchClaimedArchetypes,
  fetchSorobitById,
  fetchSorobitsByOwner,
  fetchSorobitsSummary,
  forgeAscendOnChain,
  hasClaimedPioneer,
  mintCapsuleOnChain,
  syncEpigeneticsOnChain,
} from '../lib/sorobits'
import { notifyTelegramPulse, shareToTelegram, telegramMiniAppUrl } from '../lib/telegram'
import { toast } from '../lib/toast'
import { useActivity } from '../store/activity'
import { useCreatedTokens } from '../store/creations'
import { useWallet } from '../store/wallet'

const LORE_FACTIONS = [
  { name: 'Horizon Signal', era: '2014 Ledger-1', accent: 'from-sky-500/20 to-indigo-900/30 border-sky-500/30', badge: 'text-sky-300' },
  { name: 'Roscoe Violet', era: 'Stellar Quest · FCA00C', accent: 'from-violet-500/20 to-purple-950/30 border-violet-500/30', badge: 'text-violet-300' },
  { name: 'Zebulon Crimson', era: 'SCP & Burn Sovereign', accent: 'from-rose-500/20 to-red-950/30 border-rose-500/30', badge: 'text-rose-300' },
  { name: 'Soroswap Jade', era: '2019 Orbital AMM', accent: 'from-emerald-500/20 to-teal-950/30 border-emerald-500/30', badge: 'text-emerald-300' },
  { name: 'Abyssal Trench', era: 'Curve Liquidity Depth', accent: 'from-cyan-500/20 to-slate-900/40 border-cyan-500/30', badge: 'text-cyan-300' },
  { name: 'Golden Soroban', era: 'Squaktahune Temple', accent: 'from-amber-500/20 to-stone-900/40 border-amber-500/30', badge: 'text-amber-300' },
  { name: 'Poseidon Prism', era: 'Protocol 25+ ZK Holo', accent: 'from-fuchsia-500/20 to-indigo-950/40 border-fuchsia-500/30', badge: 'text-fuchsia-300' },
] as const

const GENESIS_LORE: Record<string, { era: string; core: string }> = {
  AGQ01: { era: '2014 Ledger-1', core: 'LedgerSquare' },
  AGQ02: { era: '2014 Rocket', core: 'DeltaTriangle' },
  AGQ03: { era: 'SCP Consensus', core: 'TelemetryRect' },
  AGQ04: { era: '2019 Orbital', core: 'OrbitalCircle' },
  AGQ05: { era: 'FCA00C Quest', core: 'TelemetryRect' },
  AGQ06: { era: 'AMM Depth', core: 'OrbitalCircle' },
  AGQ07: { era: 'Burn State', core: 'DeltaTriangle' },
  AGQ08: { era: 'Golden Soroban', core: 'ZkDiamond' },
}

export function SorobitsPage() {
  const { publicKey, openWalletModal, requireSignerOrPrompt } = useWallet()
  const queryClient = useQueryClient()
  const createdTokens = useCreatedTokens((s) => s.tokens)
  const activityEntries = useActivity((s) => s.entries)
  const { data: xlmUsd = DEFAULT_XLM_USD_PRICE } = useXlmUsdPrice()

  const [selectedTokenId, setSelectedTokenId] = useState(0)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [animatedMode, setAnimatedMode] = useState(true)
  const [showRawJson, setShowRawJson] = useState(false)
  const [lookupInput, setLookupInput] = useState('')
  const [claimingPioneer, setClaimingPioneer] = useState(false)
  const [mintingCapsule, setMintingCapsule] = useState(false)
  const [claimingArchetype, setClaimingArchetype] = useState<number | null>(null)
  const [syncingTokenId, setSyncingTokenId] = useState<number | null>(null)
  const [forging, setForging] = useState(false)
  const [forgeSelection, setForgeSelection] = useState<[string, string]>(['', ''])

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

  const inspectedToken = useQuery({
    queryKey: ['sorobits-token', SOROBITS_CONTRACT_ID, selectedTokenId],
    queryFn: () => fetchSorobitById(selectedTokenId),
    staleTime: 60_000,
    retry: 1,
  })

  const ownedTokens = useQuery({
    queryKey: ['sorobits-owner', SOROBITS_CONTRACT_ID, inspectedAddress],
    queryFn: () => fetchSorobitsByOwner(inspectedAddress as string),
    enabled: Boolean(inspectedAddress),
    staleTime: 30_000,
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
    queryKey: ['sorobits-claimed-archetypes', SOROBITS_CONTRACT_ID, inspectedAddress],
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
      accountId: inspectedAddress ?? 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
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
    if (!remote) return localQuestProgress
    return computeQuestSummary({
      accountId: remote.accountId,
      funded: remote.funded || localQuestProgress.funded,
      launchedCount: Math.max(remote.launchedCount, localQuestProgress.launchedCount),
      shoutCount: Math.max(remote.shoutCount, localQuestProgress.shoutCount),
      graduatedCount: Math.max(remote.graduatedCount, localQuestProgress.graduatedCount),
      swapCount: Math.max(remote.swapCount, localQuestProgress.swapCount),
      assetCount: Math.max(remote.assetCount, localQuestProgress.assetCount),
      ecosystemTokenCount: remote.unlocked.og ? 1 : undefined,
      kingBurnCount: Math.max(remote.kingBurnCount, localQuestProgress.kingBurnCount),
    })
  }, [remoteQuests.data, localQuestProgress])

  async function invalidateSorobitsQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['sorobits-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['sorobits-owner'] }),
      queryClient.invalidateQueries({ queryKey: ['sorobits-pioneer-claimed'] }),
      queryClient.invalidateQueries({ queryKey: ['sorobits-claimed-archetypes'] }),
      queryClient.invalidateQueries({ queryKey: ['sorobits-capsule-quota'] }),
      queryClient.invalidateQueries({ queryKey: ['sorobits-token'] }),
    ])
  }

  async function onClaimPioneer() {
    const signer = requireSignerOrPrompt()
    if (!signer) return
    setClaimingPioneer(true)
    try {
      const { tokenId, hash } = await claimPioneerOnChain(signer)
      if (hash) void notifyTelegramPulse(hash)
      toast.success(`Claimed AGQ01 Soulbound Pioneer #${tokenId}!`)
      await invalidateSorobitsQueries()
      setSelectedTokenId(tokenId)
      setInspectorOpen(true)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setClaimingPioneer(false)
    }
  }

  async function onMintCapsule() {
    const signer = requireSignerOrPrompt()
    if (!signer) return
    setMintingCapsule(true)
    try {
      const { tokenId, hash } = await mintCapsuleOnChain(signer)
      if (hash) void notifyTelegramPulse(hash)
      toast.success(`🎲 Opened Mystery Sorobit Capsule #${tokenId} (7 XLM)!`)
      await invalidateSorobitsQueries()
      setSelectedTokenId(tokenId)
      setInspectorOpen(true)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setMintingCapsule(false)
    }
  }

  async function onClaimQuestBadge(archetypeId: number, assetCode: string) {
    const signer = requireSignerOrPrompt()
    if (!signer) return
    setClaimingArchetype(archetypeId)
    try {
      const { tokenId, hash } = await claimQuestBadgeOnChain(signer, archetypeId)
      if (hash) void notifyTelegramPulse(hash)
      toast.success(`Claimed ${assetCode} Sorobit #${tokenId} on-chain!`)
      await invalidateSorobitsQueries()
      setSelectedTokenId(tokenId)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setClaimingArchetype(null)
    }
  }

  async function onSyncEpigenetics(tokenId: number) {
    const signer = requireSignerOrPrompt()
    if (!signer) return
    setSyncingTokenId(tokenId)
    try {
      const { xpScore, rankTier, hash } = await syncEpigeneticsOnChain(
        signer,
        tokenId,
      )
      if (hash) void notifyTelegramPulse(hash)
      toast.success(`Synced Sorobit #${tokenId}: Tier ${rankTier} · ${xpScore} XP`)
      await invalidateSorobitsQueries()
      setSelectedTokenId(tokenId)
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
    const idA = forgeSelection[0]
      ? Number(forgeSelection[0])
      : tradeableOwned[0].tokenId
    const fallbackB =
      tradeableOwned.find((t) => t.tokenId !== idA)?.tokenId ?? null
    const idB = forgeSelection[1] ? Number(forgeSelection[1]) : fallbackB
    return [idA, idB]
  }, [forgeSelection, tradeableOwned])

  async function onForgeAscend() {
    const [burnIdA, burnIdB] = resolvedForgeIds
    if (burnIdA === null || burnIdB === null || burnIdA === burnIdB) {
      toast.error('Select two distinct tradeable Sorobits to forge.')
      return
    }
    const signer = requireSignerOrPrompt()
    if (!signer) return
    setForging(true)
    try {
      const { tokenId, hash } = await forgeAscendOnChain(signer, burnIdA, burnIdB)
      if (hash) void notifyTelegramPulse(hash)
      toast.success(`⚒️ Forged Ascended Sorobit #${tokenId} (burned #${burnIdA} & #${burnIdB})!`)
      setForgeSelection(['', ''])
      await invalidateSorobitsQueries()
      setSelectedTokenId(tokenId)
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setForging(false)
    }
  }

  const claimedSet = useMemo(
    () => new Set(claimedArchetypes.data ?? []),
    [claimedArchetypes.data],
  )
  const perks = useMemo(() => computePilotPerks(questProgress), [questProgress])
  const totalSupply = summary.data?.totalSupply ?? 0
  const activeItem = inspectedToken.data ?? summary.data?.genesis0 ?? null

  return (
    <div className="space-y-5">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl border border-indigo-500/30 bg-gradient-to-br from-slate-900 via-indigo-950/50 to-slate-950 p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-indigo-200">
              <span>🧬 SEP-50 · 100% On-Chain SVG</span>
              <span className="text-emerald-300">· Stellar Testnet</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Sorobits (<span className="font-mono text-sky-300">SBIT</span>)
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              Collect pixel pilots 100% stored on Stellar Soroban: claim <span className="font-semibold text-white">1 free Pilot Avatar</span>, open <span className="font-semibold text-amber-300">7 XLM Mystery Capsules</span> unlocked as you trade, and forge <span className="font-semibold text-sky-300">2 → 1 Gen+1</span> rarities.
            </p>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <a
                href={explorerContractUrl(SOROBITS_CONTRACT_ID)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl border border-sky-400/30 bg-sky-500/15 px-3.5 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-500/25 transition"
              >
                🔍 Contract {shortAddress(SOROBITS_CONTRACT_ID)} ↗
              </a>
              <button
                type="button"
                onClick={() =>
                  shareToTelegram(
                    '🧬 Explore Sorobits (SBIT) — 100% On-Chain 32×32 Genomic Pixel Art on Stellar Soroban (Testnet) · Built by NunaLabs',
                    telegramMiniAppUrl('sorobits'),
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-white/10 transition"
              >
                📤 Share in Telegram
              </button>
              <Link
                to="/portfolio"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900/70 px-3.5 py-2 text-xs font-semibold text-slate-300 hover:text-white transition"
              >
                👛 Portfolio
              </Link>
            </div>
          </div>

          {/* Contract live telemetry metrics */}
          <div className="grid grid-cols-2 gap-2.5 sm:w-72">
            <div className="rounded-xl border border-white/10 bg-slate-950/75 p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-400">On-Chain Supply</p>
              <p className="mt-0.5 font-mono text-lg font-bold text-white">
                {summary.isLoading ? '…' : totalSupply} <span className="text-xs text-sky-300">SBIT</span>
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-950/75 p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Season 1 Art</p>
              <p className="mt-0.5 font-mono text-lg font-bold text-emerald-300">
                {summary.data?.season1Sealed ?? true ? 'Sealed 🔒' : 'Open'}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-950/75 p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-400">RLE Matrix</p>
              <p className="mt-0.5 font-mono text-sm font-bold text-slate-100">2,222 B (25 layers)</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-950/75 p-3">
              <p className="text-[10px] uppercase tracking-wider text-slate-400">Royalty</p>
              <p className="mt-0.5 font-mono text-sm font-bold text-amber-300">5.0% Treasury</p>
            </div>
          </div>
        </div>
      </section>

      {/* Technical Live Ledger Inspector (collapsed by default for progressive disclosure) */}
      <details
        open={inspectorOpen}
        onToggle={(e) => setInspectorOpen(e.currentTarget.open)}
        className="group rounded-2xl border border-slate-800 bg-slate-900/55 p-4 sm:p-6"
      >
        <summary className="flex cursor-pointer select-none flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm sm:text-base font-semibold text-white">
              🔬 Live Ledger Inspector &amp; On-Chain SVG Lab (Advanced)
            </h2>
            <p className="text-xs text-slate-400">
              Reads <code>token_uri(id)</code>, <code>animated_svg(id)</code> &amp; raw 256-bit DNA directly from Soroban RPC.
            </p>
          </div>
          <span className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] font-mono text-slate-300">
            #{selectedTokenId} · {inspectorOpen ? 'Hide ▲' : 'Inspect ▼'}
          </span>
        </summary>

        <div className="mt-4 pt-4 border-t border-slate-800/80">
          <div className="flex flex-wrap items-center gap-2">
            {Array.from({ length: Math.min(Math.max(totalSupply, 1), 8) }, (_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setSelectedTokenId(idx)}
                className={`rounded-lg px-2.5 py-1 font-mono text-xs font-semibold transition ${
                  selectedTokenId === idx
                    ? 'bg-sky-500 text-slate-950'
                    : 'border border-slate-700 bg-slate-950 text-slate-300 hover:border-sky-500/50'
                }`}
              >
                #{idx}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setAnimatedMode((v) => !v)}
              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${
                animatedMode
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : 'border-slate-700 bg-slate-950 text-slate-400'
              }`}
            >
              {animatedMode ? '⚡ SCP 5s Pulse ON' : '🖼 Static SVG'}
            </button>
          </div>

          {activeItem ? (
            <div className="mt-4 grid gap-4 md:grid-cols-[220px_1fr]">
              <div className="flex flex-col items-center rounded-xl border border-slate-800 bg-slate-950 p-4">
                <img
                  src={animatedMode ? activeItem.animatedDataUrl : activeItem.imageDataUrl}
                  alt={activeItem.name}
                  className="h-44 w-44 rounded-xl border border-slate-700 bg-slate-950"
                  style={{ imageRendering: 'pixelated' }}
                />
                <span className="mt-2.5 rounded-full bg-indigo-500/15 px-2.5 py-0.5 font-mono text-[11px] text-indigo-300">
                  {activeItem.svgMarkup.length.toLocaleString()} bytes on-chain SVG
                </span>
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-bold text-white">{activeItem.name}</h3>
                    <p className="font-mono text-xs text-slate-400">
                      Owner:{' '}
                      <a
                        href={explorerAccountUrl(activeItem.owner)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-300 hover:underline"
                      >
                        {shortAddress(activeItem.owner)} ↗
                      </a>
                      {' · '}Born Ledger #{activeItem.bornLedger.toLocaleString()} ·{' '}
                      {activeItem.soulbound ? '🔒 Soulbound' : '♻️ Tradeable'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowRawJson((v) => !v)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-sky-400/50"
                  >
                    {showRawJson ? 'Hide Raw SVG' : 'Inspect On-Chain SVG'}
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {activeItem.attributes.map((attr) => (
                    <div
                      key={attr.trait_type}
                      className="rounded-lg border border-slate-800 bg-slate-950/75 px-2.5 py-2"
                    >
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">
                        {attr.trait_type}
                      </p>
                      <p className="truncate font-mono text-xs font-semibold text-slate-100">
                        {String(attr.value)}
                      </p>
                    </div>
                  ))}
                </div>

                {showRawJson ? (
                  <pre className="max-h-40 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] text-emerald-300">
                    {activeItem.svgMarkup}
                  </pre>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-xs text-slate-400">
              Loading live Sorobits token data from Stellar Soroban Testnet RPC…
            </p>
          )}
        </div>
      </details>

      {/* Wallet / Address Lookup + Progressive 3-Step Journey */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">
              🪪 Your Sorobits Journey
            </h2>
            <p className="text-xs text-slate-400">
              Start with your free Pilot, unlock 7 XLM Mystery Capsules as you trade, and evolve rarer Sorobits over time.
            </p>
          </div>
          {!publicKey ? (
            <button
              type="button"
              onClick={() => openWalletModal('connect')}
              className="rounded-xl bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 transition"
            >
              Connect Wallet
            </button>
          ) : null}
        </div>

        {/* Beginner-friendly 3-Step Onboarding Cards */}
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-emerald-500/30 bg-slate-950/70 p-3.5 flex flex-col justify-between gap-2.5">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="font-bold text-emerald-300">STEP 1 · FREE</span>
                <span className="text-slate-400">0 XLM · Soulbound</span>
              </div>
              <p className="text-sm font-bold text-white">🌊 Claim Pilot Avatar</p>
              <p className="text-xs text-slate-400 leading-snug">
                Your permanent pilot passport (<code className="text-sky-300">AGQ01</code>). Grows XP as you explore AstroGate.
              </p>
            </div>
            {publicKey ? (
              pioneerClaimed.data ? (
                <span className="inline-flex items-center justify-center rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-300">
                  ✓ Pilot Active
                </span>
              ) : (
                <button
                  type="button"
                  disabled={claimingPioneer}
                  onClick={() => void onClaimPioneer()}
                  className="w-full rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 transition"
                >
                  {claimingPioneer ? 'Claiming…' : '🎁 Claim Free Pilot (0 XLM)'}
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={() => openWalletModal('connect')}
                className="w-full rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 transition"
              >
                Connect Wallet to Claim
              </button>
            )}
          </div>

          <div className="rounded-xl border border-amber-500/30 bg-slate-950/70 p-3.5 flex flex-col justify-between gap-2.5">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="font-bold text-amber-300">STEP 2 · CAPSULE</span>
                <span className="text-slate-400">
                  7 XLM (≈ ${formatUsdPrice(7 * xlmUsd)} USDC) · {capsuleQuota.data ? `${capsuleQuota.data.minted}/${capsuleQuota.data.maxAllowed}` : '2 Base'} Slots
                </span>
              </div>
              <p className="text-sm font-bold text-white">🎲 Open Mystery Sorobit</p>
              <p className="text-xs text-slate-400 leading-snug">
                Mints a tradeable 256-bit random Sorobit. Earn extra capsule slots by trading or forging!
              </p>
            </div>
            {publicKey ? (
              <button
                type="button"
                disabled={
                  mintingCapsule ||
                  Boolean(
                    capsuleQuota.data &&
                      capsuleQuota.data.minted >= capsuleQuota.data.maxAllowed,
                  )
                }
                onClick={() => void onMintCapsule()}
                className="w-full rounded-xl bg-amber-500 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition"
              >
                {mintingCapsule
                  ? 'Opening Capsule…'
                  : capsuleQuota.data &&
                      capsuleQuota.data.minted >= capsuleQuota.data.maxAllowed
                    ? 'Slot Cap Reached (Trade or Forge)'
                    : '🎲 Mint Capsule · 7 XLM'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => openWalletModal('connect')}
                className="w-full rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-200 hover:bg-amber-500/25 transition"
              >
                Connect Wallet to Mint
              </button>
            )}
          </div>

          <div className="rounded-xl border border-sky-500/30 bg-slate-950/70 p-3.5 flex flex-col justify-between gap-2.5">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[11px] font-mono">
                <span className="font-bold text-sky-300">STEP 3 · EVOLVE</span>
                <span className="text-slate-400">2 → 1 Gen+1</span>
              </div>
              <p className="text-sm font-bold text-white">⚒️ Sync XP &amp; Forge</p>
              <p className="text-xs text-slate-400 leading-snug">
                Sync Launchpad XP onto your Sorobits anytime, or fuse 2 tradeable Sorobits into a rarer Gen+1 hero.
              </p>
            </div>
            <span className="inline-flex items-center justify-center rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs font-semibold text-sky-200">
              {tradeableOwned.length >= 2
                ? `🔥 Ready (${tradeableOwned.length} Forgeable)`
                : `${ownedTokens.data?.length ?? 0} Held · Earn More Below`}
            </span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="text"
            value={lookupInput}
            onChange={(e) => setLookupInput(e.target.value)}
            placeholder={
              publicKey
                ? `Connected: ${shortAddress(publicKey)} (or paste another G... address)`
                : 'Paste any Stellar public address (G...)'
            }
            className="min-w-[260px] flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-sky-400 focus:outline-none"
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
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs">
              <div>
                <p className="text-[10px] uppercase text-slate-500">On-Chain SBIT</p>
                <p className="font-mono font-bold text-sky-300">
                  {ownedTokens.isLoading ? '…' : (ownedTokens.data?.length ?? 0)}
                </p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-slate-500">Chat Rank</p>
                <p className="font-mono font-bold text-white">{perks.chatTitle}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-slate-500">Sprint Boost</p>
                <p className="font-mono font-bold text-amber-300">{perks.sprintMultiplier}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase text-slate-500">VIP Alpha</p>
                <p className="font-mono font-bold text-emerald-300">
                  {perks.vipAlphaAccess ? 'Eligible' : 'Unlock AGQ04+'}
                </p>
              </div>
            </div>

            {ownedTokens.data && ownedTokens.data.length > 0 ? (
              <div className="space-y-3">
                <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                  {ownedTokens.data.map((item) => (
                    <div
                      key={item.tokenId}
                      className="flex items-center justify-between gap-2 rounded-xl border border-sky-500/30 bg-slate-950 p-3 hover:border-sky-400 transition"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedTokenId(item.tokenId)
                          setInspectorOpen(true)
                        }}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <img
                          src={item.animatedDataUrl}
                          alt={item.name}
                          className="h-14 w-14 shrink-0 rounded-lg border border-slate-700"
                          style={{ imageRendering: 'pixelated' }}
                        />
                        <div className="min-w-0 text-xs">
                          <p className="truncate font-semibold text-white">{item.name}</p>
                          <p className="font-mono text-[11px] text-slate-400">
                            {item.soulbound ? 'Soulbound' : `Gen ${item.generation}`} · T{item.rankTier} · XP {item.xpScore}
                          </p>
                        </div>
                      </button>
                      {publicKey && inspectedAddress === publicKey ? (
                        <button
                          type="button"
                          disabled={syncingTokenId === item.tokenId}
                          onClick={() => void onSyncEpigenetics(item.tokenId)}
                          className="shrink-0 rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-indigo-200 hover:bg-indigo-500/25 disabled:opacity-50 transition"
                          title="Sync on-chain XP & TTL rank tier from Launchpad activity"
                        >
                          {syncingTokenId === item.tokenId ? 'Syncing…' : '⚡ Sync XP'}
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>

                {publicKey &&
                inspectedAddress === publicKey &&
                tradeableOwned.length >= 2 ? (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-950/15 p-3.5 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-bold text-amber-200">
                          ⚒️ Deflationary Forge (2 → 1 Ascended Gen+1)
                        </p>
                        <p className="text-[11px] text-slate-400">
                          Permanently burns 2 tradeable Sorobits on-chain to mint 1 Gen+1 Ascended Sorobit (+500 XP &amp; +1 Tier boost).
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label="First Sorobit to burn"
                        value={String(resolvedForgeIds[0] ?? '')}
                        onChange={(e) =>
                          setForgeSelection([e.target.value, forgeSelection[1]])
                        }
                        className="min-w-[140px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 font-mono text-xs text-slate-100"
                      >
                        {tradeableOwned.map((t) => (
                          <option key={t.tokenId} value={String(t.tokenId)}>
                            #{t.tokenId} · {t.name} (G{t.generation})
                          </option>
                        ))}
                      </select>
                      <span className="font-mono text-xs text-amber-300">+</span>
                      <select
                        aria-label="Second Sorobit to burn"
                        value={String(resolvedForgeIds[1] ?? '')}
                        onChange={(e) =>
                          setForgeSelection([forgeSelection[0], e.target.value])
                        }
                        className="min-w-[140px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 font-mono text-xs text-slate-100"
                      >
                        {tradeableOwned.map((t) => (
                          <option key={t.tokenId} value={String(t.tokenId)}>
                            #{t.tokenId} · {t.name} (G{t.generation})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        disabled={
                          forging ||
                          resolvedForgeIds[0] === null ||
                          resolvedForgeIds[1] === null ||
                          resolvedForgeIds[0] === resolvedForgeIds[1]
                        }
                        onClick={() => void onForgeAscend()}
                        className="rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-50 transition"
                      >
                        {forging ? 'Forging…' : '🔥 Burn 2 & Forge Gen+1'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-slate-400">
                  No minted Sorobits (<code className="font-mono text-sky-300">SBIT</code>) held by {shortAddress(inspectedAddress)} yet — claim your free AGQ01 Pioneer below or inspect Genesis #0 above.
                </p>
                {publicKey && inspectedAddress === publicKey && !pioneerClaimed.data ? (
                  <button
                    type="button"
                    disabled={claimingPioneer}
                    onClick={() => void onClaimPioneer()}
                    className="rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 transition"
                  >
                    {claimingPioneer ? 'Claiming…' : '🌊 Claim AGQ01 Pioneer On-Chain'}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </section>

      {/* Season-1 Genesis Collection Gallery */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-white">
              🏆 Season-1 Genesis Archetypes (<code className="font-mono text-sky-300">AGQ01</code>–<code className="font-mono text-sky-300">AGQ08</code>)
            </h2>
            <p className="text-xs text-slate-400">
              8 Edition-0 icons honoring Stellar history from 2014 Ledger-1 to Golden Soroban &amp; ZK Prisms.
            </p>
          </div>
          <Link
            to="/market"
            className="text-xs font-semibold text-sky-400 hover:underline"
          >
            Earn Badges in Market →
          </Link>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ASTROGATE_QUEST_BADGES.map((badge, idx) => {
            const archetypeId = idx + 1
            const lore = GENESIS_LORE[badge.assetCode]
            const unlocked = Boolean(inspectedAddress && questProgress.unlocked[badge.id])
            const claimedOnChain = claimedSet.has(archetypeId)
            const canClaimOnChain =
              unlocked &&
              !claimedOnChain &&
              Boolean(publicKey && inspectedAddress === publicKey)
            return (
              <div
                key={badge.id}
                className={`flex flex-col justify-between rounded-xl border p-3.5 transition ${
                  claimedOnChain || unlocked
                    ? 'border-emerald-500/40 bg-emerald-950/15'
                    : 'border-slate-800 bg-slate-950/70'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span className="text-sky-300 font-semibold">{badge.assetCode}</span>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">
                      {badge.tier}
                    </span>
                  </div>
                  <img
                    src={badge.imagePath}
                    alt={badge.title}
                    className="mx-auto my-3 h-28 w-28 rounded-xl border border-slate-800"
                    style={{ imageRendering: 'pixelated' }}
                  />
                  <p className="text-sm font-bold text-white">
                    {badge.emoji} {badge.title}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-indigo-300">
                    {lore?.era} · {lore?.core}
                  </p>
                  <p className="mt-1.5 text-xs text-slate-400 leading-snug">
                    {badge.criteria}
                  </p>
                </div>
                <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2 text-[11px]">
                  {claimedOnChain ? (
                    <span className="text-emerald-300 font-semibold">🏆 Minted On-Chain</span>
                  ) : canClaimOnChain ? (
                    <button
                      type="button"
                      disabled={claimingArchetype === archetypeId}
                      onClick={() => void onClaimQuestBadge(archetypeId, badge.assetCode)}
                      className="rounded-lg bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 transition"
                    >
                      {claimingArchetype === archetypeId ? 'Claiming…' : `Claim ${badge.assetCode}`}
                    </button>
                  ) : (
                    <span className={unlocked ? 'text-emerald-300 font-semibold' : 'text-slate-500'}>
                      {unlocked ? '✅ Quest Unlocked' : '🔒 Season-1 Quest'}
                    </span>
                  )}
                  <span className="font-mono text-slate-500">32×32 RLE</span>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Architecture & 7 Lore Factions */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 sm:p-6">
        <h2 className="text-lg font-semibold text-white">
          🎨 7 Semantic Factions &amp; 256-Bit Genome Architecture
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          Every Sorobit stores an immutable 32-byte genome (<code className="font-mono text-indigo-300">BytesN&lt;32&gt;</code>) driving dominant traits, latent recessive Forge genes, and a procedural cosmos sky.
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-7">
          {LORE_FACTIONS.map((f) => (
            <div
              key={f.name}
              className={`rounded-xl border bg-gradient-to-br p-3 ${f.accent}`}
            >
              <p className={`text-xs font-bold ${f.badge}`}>{f.name}</p>
              <p className="mt-1 text-[11px] text-slate-300">{f.era}</p>
            </div>
          ))}
        </div>

        <p className="mt-4 font-mono text-[11px] text-slate-500 break-all">
          Testnet Contract: {SOROBITS_CONTRACT_ID} · WASM: {SOROBITS_WASM_HASH}
        </p>
      </section>
    </div>
  )
}
