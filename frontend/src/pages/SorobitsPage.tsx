import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ASTROGATE_QUEST_BADGES,
  computePilotPerks,
  computeQuestSummary,
} from '../../worker/quests'
import { explorerContractUrl, explorerAccountUrl } from '../lib/explorer'
import { shortAddress } from '../lib/format'
import { SOROBITS_CONTRACT_ID, SOROBITS_WASM_HASH } from '../lib/network'
import {
  fetchSorobitById,
  fetchSorobitsByOwner,
  fetchSorobitsSummary,
} from '../lib/sorobits'
import { shareToTelegram, telegramMiniAppUrl } from '../lib/telegram'
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
  const { publicKey, openWalletModal } = useWallet()
  const createdTokens = useCreatedTokens((s) => s.tokens)
  const activityEntries = useActivity((s) => s.entries)

  const [selectedTokenId, setSelectedTokenId] = useState(0)
  const [animatedMode, setAnimatedMode] = useState(true)
  const [showRawJson, setShowRawJson] = useState(false)
  const [lookupInput, setLookupInput] = useState('')

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

  const questProgress = useMemo(() => {
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
              Native <span className="font-semibold text-white">32×32</span> genomic pixel-art NFTs stored and rendered directly inside Stellar Soroban smart contracts — zero Pinata, zero IPFS, sealed Season-1 artwork by <span className="text-sky-300 font-medium">NunaLabs</span>.
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

      {/* Live On-Chain Inspector */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/55 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">
              🔬 Live Ledger Token Inspector
            </h2>
            <p className="text-xs text-slate-400">
              Reads <code>token_uri(id)</code>, <code>animated_svg(id)</code> &amp; <code>get_sorobit(id)</code> live from Soroban Testnet RPC.
            </p>
          </div>
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
      </section>

      {/* Wallet / Address Lookup */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">
              🪪 Pilot Wallet &amp; Held Sorobits
            </h2>
            <p className="text-xs text-slate-400">
              Connect a wallet or paste any public <code>G…</code> Stellar Testnet address to check Sorobits &amp; Quest perks.
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
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {ownedTokens.data.map((item) => (
                  <button
                    key={item.tokenId}
                    type="button"
                    onClick={() => setSelectedTokenId(item.tokenId)}
                    className="flex items-center gap-3 rounded-xl border border-sky-500/30 bg-slate-950 p-3 text-left hover:border-sky-400 transition"
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
                        {item.soulbound ? 'Soulbound' : 'Tradeable'} · XP {item.xpScore}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                No minted Sorobits (`SBIT`) held by {shortAddress(inspectedAddress)} yet — complete Season-1 Quests below or inspect Genesis #0 above.
              </p>
            )}
          </div>
        ) : null}
      </section>

      {/* Season-1 Genesis Collection Gallery */}
      <section className="rounded-2xl border border-slate-800 bg-slate-900/50 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-white">
              🏆 Season-1 Genesis Archetypes (`AGQ01`–`AGQ08`)
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
          {ASTROGATE_QUEST_BADGES.map((badge) => {
            const lore = GENESIS_LORE[badge.assetCode]
            const unlocked = Boolean(inspectedAddress && questProgress.unlocked[badge.id])
            return (
              <div
                key={badge.id}
                className={`flex flex-col justify-between rounded-xl border p-3.5 transition ${
                  unlocked
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
                <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                  <span className={unlocked ? 'text-emerald-300 font-semibold' : 'text-slate-500'}>
                    {unlocked ? '✅ Quest Unlocked' : '🔒 Season-1 Quest'}
                  </span>
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
          Every Sorobit stores an immutable 32-byte genome (`BytesN&lt;32&gt;`) driving dominant traits, latent recessive Forge genes, and a procedural cosmos sky.
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
