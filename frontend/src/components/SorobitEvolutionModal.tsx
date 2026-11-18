import { useEffect, useState } from 'react'
import type { PilotTelegramPerks } from '../../worker/quests'
import { explorerTxUrl } from '../lib/explorer'
import {
  formatCollectorTrait,
  generationLabel,
  getRealmForItem,
  nextTierProgress,
  type SorobitOnChainItem,
} from '../lib/sorobits'
import { shareToTelegram, telegramMiniAppUrl } from '../lib/telegram'

export type SorobitEvolutionReveal =
  | {
      kind: 'sync'
      before: SorobitOnChainItem
      after: SorobitOnChainItem
      perks: PilotTelegramPerks
      txHash?: string
    }
  | {
      kind: 'forge'
      parents: [SorobitOnChainItem, SorobitOnChainItem]
      after: SorobitOnChainItem
      perks: PilotTelegramPerks
      txHash?: string
    }

type EvoPhase = 'anticipate' | 'morph' | 'revealed'

function findFrameTrait(item: SorobitOnChainItem): string | null {
  const found = item.attributes.find(
    (a) => a.trait_type.toLowerCase() === 'frame',
  )
  return found ? String(found.value) : null
}

/**
 * Minimalist retro Pokémon-style on-chain evolution & forge reveal modal.
 * Transitions between real pre-tx and post-tx Soroban SVGs and highlights
 * exact frame, tier, XP, and generation upgrades.
 */
export function SorobitEvolutionModal({
  reveal,
  initialPhase = 'anticipate',
  onClose,
}: {
  reveal: SorobitEvolutionReveal
  initialPhase?: EvoPhase
  onClose: () => void
}) {
  const [phase, setPhase] = useState<EvoPhase>(initialPhase)
  const [morphShowAfter, setMorphShowAfter] = useState(false)
  const [replayNonce, setReplayNonce] = useState(0)

  useEffect(() => {
    if (initialPhase === 'revealed') return

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reducedMotion) {
      const immediate = window.setTimeout(() => setPhase('revealed'), 0)
      return () => window.clearTimeout(immediate)
    }

    const t1 = window.setTimeout(() => setPhase('morph'), 850)
    const blink = window.setInterval(
      () => setMorphShowAfter((prev) => !prev),
      150,
    )
    const t2 = window.setTimeout(() => {
      window.clearInterval(blink)
      setMorphShowAfter(true)
      setPhase('revealed')
    }, 2050)

    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      window.clearInterval(blink)
    }
  }, [reveal, initialPhase, replayNonce])

  const { after, perks, txHash } = reveal
  const afterRealm = getRealmForItem(after)
  const afterTier = nextTierProgress(after.xpScore, after.rankTier)
  const afterFrame = findFrameTrait(after) ?? afterTier.currentTierName

  const isForge = reveal.kind === 'forge'
  const syncBefore = reveal.kind === 'sync' ? reveal.before : null
  const forgeParents = reveal.kind === 'forge' ? reveal.parents : null
  const beforeTier = syncBefore
    ? nextTierProgress(syncBefore.xpScore, syncBefore.rankTier)
    : null
  const beforeFrame = syncBefore
    ? (findFrameTrait(syncBefore) ?? beforeTier?.currentTierName ?? 'OriginHUD')
    : null

  const tierUp = syncBefore
    ? after.rankTier > syncBefore.rankTier
    : forgeParents
      ? after.rankTier >
        Math.max(forgeParents[0].rankTier, forgeParents[1].rankTier)
      : false
  const xpDelta = syncBefore
    ? Math.max(0, after.xpScore - syncBefore.xpScore)
    : forgeParents
      ? Math.max(
          0,
          after.xpScore -
            (forgeParents[0].xpScore + forgeParents[1].xpScore),
        )
      : 0

  const headline = forgeParents
    ? phase === 'revealed'
      ? `⚒️ Astral Forge Complete · #${after.tokenId}`
      : `Fusing #${forgeParents[0].tokenId} + #${forgeParents[1].tokenId}…`
    : phase === 'revealed'
      ? tierUp
        ? `✨ Sorobit #${after.tokenId} Evolved!`
        : `⚡ Sorobit #${after.tokenId} Synced!`
      : tierUp || after.rankTier > (syncBefore?.rankTier ?? 0)
        ? `What? Sorobit #${after.tokenId} is evolving!`
        : `Syncing Sorobit #${after.tokenId} on-chain…`

  const subline = isForge
    ? phase === 'revealed'
      ? `Born ${generationLabel(after)} in ${afterRealm.name} with +${xpDelta} Forge Bonus XP and 1 Capsule slot freed.`
      : 'Burning 2 parent Sorobits to forge a higher-generation DNA on Stellar Soroban…'
    : phase === 'revealed'
      ? tierUp
        ? `Upgraded to ${afterTier.currentTierName} (Tier ${after.rankTier}) — new pixel shield burned into token_uri(${after.tokenId})!`
        : `+${xpDelta} XP recorded on-chain from your Stellar Launchpad activity.`
      : 'Reading verified Launchpad telemetry and updating your on-chain SVG frame…'

  const stageImgSrc =
    phase === 'anticipate'
      ? syncBefore
        ? syncBefore.animatedDataUrl
        : forgeParents
          ? forgeParents[0].animatedDataUrl
          : after.animatedDataUrl
      : phase === 'morph'
        ? morphShowAfter
          ? after.animatedDataUrl
          : syncBefore
            ? syncBefore.imageDataUrl
            : forgeParents
              ? forgeParents[1].imageDataUrl
              : after.imageDataUrl
        : after.animatedDataUrl

  const displayTraits = after.attributes
    .filter((a) =>
      ['faction', 'suit', 'visor', 'relic', 'aura'].includes(
        a.trait_type.toLowerCase(),
      ),
    )
    .slice(0, 4)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sorobit-evolution-title"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-md overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative my-auto w-full max-w-md overflow-hidden rounded-3xl border border-amber-400/60 bg-gradient-to-br from-slate-900 via-slate-950 to-indigo-950/90 p-5 sm:p-6 shadow-2xl shadow-amber-500/20 text-center space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close evolution popup"
          className="absolute right-3.5 top-3.5 flex h-8 w-8 items-center justify-center rounded-full border border-slate-700 bg-slate-900/80 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
        >
          ×
        </button>

        {/* Retro Pixel Evolution Stage */}
        <div className="relative mx-auto flex h-36 w-64 items-center justify-center">
          <div
            className={`absolute h-32 w-32 rounded-full blur-xl transition-all duration-500 ${
              phase === 'morph'
                ? 'bg-sky-300/45 scale-125'
                : phase === 'revealed'
                  ? 'bg-amber-400/25 scale-100'
                  : 'bg-indigo-500/25 animate-pulse'
            }`}
          />
          {phase !== 'revealed' ? (
            <div className="absolute h-28 w-28 rounded-full border border-sky-400/45 animate-ping" />
          ) : null}

          <span
            aria-hidden="true"
            className="animate-confetti-float absolute left-4 top-2 text-lg"
          >
            {isForge ? '⚒️' : '✨'}
          </span>
          <span
            aria-hidden="true"
            className="animate-confetti-float absolute right-5 top-1 text-lg"
          >
            ⚡
          </span>
          <span
            aria-hidden="true"
            className="animate-confetti-float absolute left-6 bottom-2 text-base"
          >
            🧬
          </span>

          {forgeParents && phase === 'anticipate' ? (
            <div className="relative z-10 flex items-center gap-3">
              {forgeParents.map((p) => (
                <div
                  key={p.tokenId}
                  className="animate-evo-shake rounded-2xl border-2 border-indigo-400/70 bg-slate-950 p-1.5 shadow-lg"
                >
                  <img
                    src={p.imageDataUrl}
                    alt={p.name}
                    width={64}
                    height={64}
                    className="h-16 w-16 rounded-xl"
                    style={{ imageRendering: 'pixelated' }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div
              className={`relative z-10 rounded-2xl border-2 bg-slate-950 p-2 shadow-xl transition-colors ${
                phase === 'revealed'
                  ? 'animate-evo-pop border-amber-400/85 shadow-amber-500/30'
                  : phase === 'morph'
                    ? 'animate-evo-flash border-sky-300 shadow-sky-400/40'
                    : 'animate-evo-shake border-indigo-400/80 shadow-indigo-500/30'
              }`}
            >
              <img
                src={stageImgSrc}
                alt={after.name}
                width={96}
                height={96}
                className="h-24 w-24 rounded-xl"
                style={{ imageRendering: 'pixelated' }}
              />
            </div>
          )}
        </div>

        {/* Retro Dialog Caption */}
        <div className="space-y-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/50 bg-amber-500/20 px-3 py-0.5 text-[10px] font-black uppercase tracking-wider text-amber-300">
            {isForge
              ? `Gen ${after.generation} Ascended`
              : tierUp
                ? `Shield Tier ${after.rankTier} Unlocked`
                : 'On-Chain Epigenetics'}
          </span>
          <h2
            id="sorobit-evolution-title"
            className="text-lg sm:text-xl font-extrabold text-white"
          >
            {headline}
          </h2>
          <p className="text-xs text-slate-300 leading-relaxed">{subline}</p>
        </div>

        {/* Real Before -> After Visual & Stats Diff */}
        {phase === 'revealed' ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-3.5 text-left text-xs space-y-3">
            {/* Mini Visual Comparison */}
            <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-800/90 bg-slate-900/60 px-3 py-2">
              {syncBefore ? (
                <div className="flex items-center gap-2">
                  <img
                    src={syncBefore.imageDataUrl}
                    alt={`Before #${syncBefore.tokenId}`}
                    width={40}
                    height={40}
                    className="h-10 w-10 rounded-lg border border-slate-700 opacity-80"
                    style={{ imageRendering: 'pixelated' }}
                  />
                  <div>
                    <p className="text-[10px] uppercase text-slate-500">
                      Before
                    </p>
                    <p className="font-mono text-[11px] text-slate-300">
                      Tier {syncBefore.rankTier} · {syncBefore.xpScore} XP
                    </p>
                  </div>
                </div>
              ) : forgeParents ? (
                <div className="flex items-center gap-1.5">
                  {forgeParents.map((p) => (
                    <img
                      key={p.tokenId}
                      src={p.imageDataUrl}
                      alt={`Parent #${p.tokenId}`}
                      width={34}
                      height={34}
                      className="h-8 w-8 rounded-lg border border-slate-700 opacity-75"
                      style={{ imageRendering: 'pixelated' }}
                    />
                  ))}
                  <span className="font-mono text-[10px] text-slate-400">
                    Burned
                  </span>
                </div>
              ) : null}

              <span className="font-mono text-sm font-black text-amber-300">
                →
              </span>

              <div className="flex items-center gap-2 text-right">
                <div>
                  <p className="text-[10px] uppercase text-emerald-400 font-bold">
                    After
                  </p>
                  <p className="font-mono text-[11px] font-bold text-white">
                    Tier {after.rankTier} · {after.xpScore} XP
                  </p>
                </div>
                <img
                  src={after.imageDataUrl}
                  alt={`After #${after.tokenId}`}
                  width={40}
                  height={40}
                  className="h-10 w-10 rounded-lg border border-amber-400/70"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
            </div>

            {/* What Changed Pills */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                What Changed On-Chain
              </p>
              <div className="flex flex-wrap gap-1.5">
                {syncBefore ? (
                  <>
                    <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-300">
                      {`+${xpDelta} XP`}
                    </span>
                    <span className="rounded-lg border border-indigo-400/40 bg-indigo-500/15 px-2 py-0.5 font-mono text-[11px] text-indigo-200">
                      {`${beforeFrame} → ${afterFrame}`}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="rounded-lg border border-amber-400/50 bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-200">
                      {generationLabel(after)}
                    </span>
                    <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-300">
                      {`+${xpDelta} Forge Bonus XP`}
                    </span>
                    <span className="rounded-lg border border-sky-400/40 bg-sky-500/15 px-2 py-0.5 font-mono text-[11px] text-sky-200">
                      +1 Capsule Slot Freed
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* New Value & Perks */}
            <div className="space-y-1 border-t border-slate-800/80 pt-2 text-[11px] text-slate-300">
              <p>
                <strong className="text-sky-300">On-Chain SVG &amp; Rarity:</strong>{' '}
                {afterTier.currentTierName} (Tier {after.rankTier}/4 ·{' '}
                {afterFrame} frame)
              </p>
              <p>
                <strong className="text-amber-300">Pilot Value:</strong>{' '}
                {perks.chatTitle} · {perks.sprintMultiplier} Sprint Boost
                {perks.vipAlphaAccess ? ' · VIP Alpha' : ''}
              </p>
              {displayTraits.length > 0 ? (
                <p className="text-slate-400">
                  <strong className="text-slate-200">Traits:</strong>{' '}
                  {displayTraits
                    .map((t) => formatCollectorTrait(t.trait_type, t.value))
                    .join(' · ')}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2 font-mono text-[11px] text-sky-300">
            {phase === 'anticipate'
              ? '▸ Locking pre-evolution snapshot…'
              : '▸ Re-rendering 32×32 on-chain SVG shield…'}
          </div>
        )}

        {/* CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          {phase !== 'revealed' ? (
            <button
              type="button"
              onClick={() => setPhase('revealed')}
              className="min-h-[40px] flex-1 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-slate-800 transition"
            >
              Skip Animation →
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="min-h-[40px] flex-1 rounded-xl bg-gradient-to-r from-amber-400 to-emerald-400 px-4 py-2 text-xs font-black text-slate-950 shadow-lg hover:brightness-105 transition"
              >
                🎉 Awesome!
              </button>
              <button
                type="button"
                onClick={() => {
                  setPhase('anticipate')
                  setMorphShowAfter(false)
                  setReplayNonce((n) => n + 1)
                }}
                className="min-h-[40px] rounded-xl border border-indigo-400/50 bg-indigo-500/20 px-3 py-2 text-xs font-bold text-indigo-200 hover:bg-indigo-500/30 transition"
              >
                ▶ Replay
              </button>
              <button
                type="button"
                onClick={() =>
                  shareToTelegram(
                    isForge
                      ? `⚒️ Just forged ${generationLabel(after)} Sorobit #${after.tokenId} (${afterTier.currentTierName} · ${after.xpScore} XP) on AstroGate!`
                      : `✨ My Sorobit #${after.tokenId} evolved to ${afterTier.currentTierName} (Tier ${after.rankTier} · ${after.xpScore} XP) on AstroGate!`,
                    telegramMiniAppUrl('sorobits'),
                  )
                }
                className="min-h-[40px] rounded-xl border border-sky-400/50 bg-sky-500/15 px-3 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-500/25 transition"
              >
                📤 Share
              </button>
            </>
          )}
        </div>

        {txHash ? (
          <a
            href={explorerTxUrl(txHash)}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-[11px] font-mono text-sky-400 hover:underline"
          >
            Verify evolution on Stellar Explorer ↗
          </a>
        ) : null}
      </div>
    </div>
  )
}
