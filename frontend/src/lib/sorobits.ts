import type { Signer } from '@stellar/stellar-sdk/contract'
import { Keypair } from '@stellar/stellar-sdk'

import { Client as SorobitsClient } from '../contracts/sorobits'
import { launchpadClient } from './token'
import {
  executeWithRpcFailover,
  NETWORK_PASSPHRASE,
  RPC_URL,
  SOROBITS_CONTRACT_ID,
} from './network'

const READONLY_SOURCE = Keypair.fromPublicKey(
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
).publicKey()

export interface SorobitAttribute {
  trait_type: string
  value: string | number
}

export interface SorobitOnChainItem {
  tokenId: number
  owner: string
  name: string
  edition: number
  generation: number
  rankTier: number
  xpScore: number
  bornLedger: number
  soulbound: boolean
  svgMarkup: string
  imageDataUrl: string
  animatedDataUrl: string
  attributes: SorobitAttribute[]
}

export interface SorobitsContractSummary {
  contractId: string
  totalSupply: number
  season1Sealed: boolean
  liveTokenIds: number[]
  genesis0: SorobitOnChainItem | null
  rpcFailed?: boolean
}

export interface LaunchpadPilotTelemetry {
  launches: number
  graduations: number
  trades: number
  shouts: number
  kingShouts: number
  burnsTriggered: number
}

export interface CosmicRealmSpec {
  id: number
  onChainName: string
  name: string
  tagline: string
  description: string
  accent: string
  badge: string
}

export const COSMIC_REALMS: readonly CosmicRealmSpec[] = [
  {
    id: 0,
    onChainName: 'Horizon Signal',
    name: 'Horizon Starlight',
    tagline: 'Dawn of the First Star',
    description:
      'Fearless deep-space navigators guided by the earliest cosmic beacons.',
    accent: 'from-sky-500/20 to-indigo-900/30 border-sky-500/30',
    badge: 'text-sky-300',
  },
  {
    id: 1,
    onChainName: 'Roscoe Violet',
    name: 'Nebula Violet',
    tagline: 'Mystic Starweavers',
    description:
      'Arcane cosmic explorers attuned to twilight nebulae and astral mysteries.',
    accent: 'from-violet-500/20 to-purple-950/30 border-violet-500/30',
    badge: 'text-violet-300',
  },
  {
    id: 2,
    onChainName: 'Zebulon Crimson',
    name: 'Supernova Crimson',
    tagline: 'Solar Flame Guardians',
    description:
      'Fierce forge masters born in stellar fire and unstoppable cosmic energy.',
    accent: 'from-rose-500/20 to-red-950/30 border-rose-500/30',
    badge: 'text-rose-300',
  },
  {
    id: 3,
    onChainName: 'Soroswap Jade',
    name: 'Emerald Orbit',
    tagline: 'Warp-Gate Voyagers',
    description:
      'Swift interstellar traders charting luminous jade wormholes across Stellar.',
    accent: 'from-emerald-500/20 to-teal-950/30 border-emerald-500/30',
    badge: 'text-emerald-300',
  },
  {
    id: 4,
    onChainName: 'Abyssal Trench',
    name: 'Abyssal Starlight',
    tagline: 'Astral Tide Keepers',
    description:
      'Deep-cosmos guardians harvesting rare pearls of gravity and starlight.',
    accent: 'from-cyan-500/20 to-slate-900/40 border-cyan-500/30',
    badge: 'text-cyan-300',
  },
  {
    id: 5,
    onChainName: 'Golden Soroban',
    name: 'Celestial Gold',
    tagline: 'Sunforged Citadel',
    description:
      'Mythic relic keepers radiating royal solar armor and ancient wisdom.',
    accent: 'from-amber-500/20 to-stone-900/40 border-amber-500/30',
    badge: 'text-amber-300',
  },
  {
    id: 6,
    onChainName: 'Poseidon Prism',
    name: 'Prism Aurora',
    tagline: 'Astral Mirage Shifters',
    description:
      'Rare luminous travelers refracting multidimensional aurora light.',
    accent: 'from-fuchsia-500/20 to-indigo-950/40 border-fuchsia-500/30',
    badge: 'text-fuchsia-300',
  },
] as const

const COLLECTOR_VALUE_MAP: Record<string, string> = {
  // Factions -> Cosmic Realms
  'Horizon Signal': 'Horizon Starlight',
  'Roscoe Violet': 'Nebula Violet',
  'Zebulon Crimson': 'Supernova Crimson',
  'Soroswap Jade': 'Emerald Orbit',
  'Abyssal Trench': 'Abyssal Starlight',
  'Golden Soroban': 'Celestial Gold',
  'Poseidon Prism': 'Prism Aurora',
  // Suits
  LedgerSquare: 'Starlight Vanguard',
  TelemetryRect: 'Nova Pulse Armor',
  DeltaTriangle: 'Solar Wing Suit',
  OrbitalCircle: 'Astro Gravity Suit',
  ZkDiamond: 'Prism Aegis Armor',
  // Helmets
  ExplorerDome: 'Astral Dome',
  Vanguard: 'Vanguard Crest',
  CyborgHull: 'Mecha Titan Helm',
  VoidHood: 'Shadow Void Hood',
  // Visors
  ClassicAstro: 'Starlight Visor',
  Fca00c3D: 'Hypernova Prism',
  FCA00C3D: 'Hypernova Prism',
  ScpLattice: 'Quorum Matrix',
  SCPLattice: 'Quorum Matrix',
  SonarSweep: 'Deep Cosmos Radar',
  TwinLaser: 'Supernova Beams',
  // Relics
  None: 'Pure Pilot',
  LedgerAntenna: 'Star Beacon',
  RocketFin: 'Comet Wing',
  SovereignCrown: 'Royal Halo Crown',
  OrbitalHalo: 'Planetary Ring',
  HydroFin: 'Astral Crest',
  SorobanCrown: 'Celestial Crown',
  StroopOrb: 'Floating Star Orb',
  // Auras
  QuorumSlice: 'Orbit Sparks',
  WarpResonance: 'Hyperdrive Aura',
  // Shields
  OriginHUD: 'Starlight Frame (T0)',
  ArchivalBronze: 'Bronze Guardian (T1)',
  SovereignTTL: 'Solar Gold Shield (T2)',
  YardstickPrism: 'Obsidian Prism Shield (T3)',
  CleanVoid: 'Celestial Void Halo (T4)',
  // Genesis origin legends
  '2014 Ledger-1': 'First Star Pioneer',
  '2014 Rocket': 'Nova Launcher',
  'SCP Consensus': 'Cosmic Herald',
  '2019 Orbital': 'Warp Voyager',
  'FCA00C Quest': 'Prism Seeker',
  'AMM Depth': 'Tide Navigator',
  'Burn State': 'Phoenix Forged',
}

const COLLECTOR_TRAIT_LABELS: Record<string, string> = {
  Faction: 'Cosmic Realm',
  Suit: 'Armor Suit',
  'TTL Shield': 'Guardian Shield',
  'Stellar Era': 'Origin Legend',
}

export function formatTraitLabel(traitType: string): string {
  return COLLECTOR_TRAIT_LABELS[traitType] ?? traitType
}

export function formatCollectorTrait(
  traitType: string,
  rawValue: string | number,
): string {
  const str = String(rawValue)
  if (traitType === 'Aura' && str === 'None') return 'Calm Cosmos'
  if (traitType === 'Relic' && str === 'None') return 'Pure Pilot'
  if (traitType === 'Stellar Era' && str === 'Golden Soroban') {
    return 'Solar Legend'
  }
  return COLLECTOR_VALUE_MAP[str] ?? str
}

export function getRealmForItem(item: SorobitOnChainItem): CosmicRealmSpec {
  const factionAttr = item.attributes.find((a) => a.trait_type === 'Faction')
  const rawFaction = factionAttr ? String(factionAttr.value) : ''
  return (
    COSMIC_REALMS.find(
      (r) => r.onChainName === rawFaction || r.name === rawFaction,
    ) ?? COSMIC_REALMS[0]
  )
}

export function computeLivePilotXp(
  pilot: LaunchpadPilotTelemetry | null | undefined,
  claimedCount: number,
): number {
  const baseClaims = Math.max(0, claimedCount) * 150
  if (!pilot) return baseClaims
  return (
    baseClaims +
    pilot.launches * 250 +
    pilot.graduations * 500 +
    pilot.trades * 50 +
    pilot.shouts * 100 +
    pilot.kingShouts * 400
  )
}

const TIER_DEFINITIONS = [
  { tier: 0, name: 'Starlight Frame', minXp: 0, nextXp: 200 },
  { tier: 1, name: 'Bronze Guardian', minXp: 200, nextXp: 500 },
  { tier: 2, name: 'Solar Gold Shield', minXp: 500, nextXp: 1200 },
  { tier: 3, name: 'Obsidian Prism Shield', minXp: 1200, nextXp: 2500 },
  { tier: 4, name: 'Celestial Void Halo', minXp: 2500, nextXp: null },
] as const

export interface TierProgressInfo {
  currentTierName: string
  nextTierName: string | null
  nextThreshold: number | null
  progressPct: number
  xpToNext: number
}

export function generationLabel(item: SorobitOnChainItem): string {
  if (item.soulbound) return 'Starter Pilot'
  if (item.generation > 0) return `Gen ${item.generation} Ascended`
  return 'Gen 0 Capsule'
}

export function nextTierProgress(
  xpScore: number,
  rankTier: number,
): TierProgressInfo {
  const clamped = Math.max(0, Math.min(4, Math.floor(rankTier)))
  const current = TIER_DEFINITIONS[clamped]
  const next = clamped < 4 ? TIER_DEFINITIONS[clamped + 1] : null
  if (!next || current.nextXp === null) {
    return {
      currentTierName: current.name,
      nextTierName: null,
      nextThreshold: null,
      progressPct: 100,
      xpToNext: 0,
    }
  }
  const span = Math.max(1, current.nextXp - current.minXp)
  const gained = Math.max(0, xpScore - current.minXp)
  const progressPct = Math.min(100, Math.max(0, Math.round((gained / span) * 100)))
  return {
    currentTierName: current.name,
    nextTierName: next.name,
    nextThreshold: current.nextXp,
    progressPct,
    xpToNext: Math.max(0, current.nextXp - xpScore),
  }
}

function unwrapSorobitOk<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'object' && value !== null && 'error' in value) return null
  return value as T
}

function isStellarAccount(value: unknown): value is string {
  return typeof value === 'string' && /^G[A-Z2-7]{55}$/.test(value)
}

function makeSorobitsClient(rpcUrl = RPC_URL): SorobitsClient {
  return new SorobitsClient({
    contractId: SOROBITS_CONTRACT_ID,
    rpcUrl,
    networkPassphrase: NETWORK_PASSPHRASE,
    publicKey: READONLY_SOURCE,
  })
}

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export async function fetchSorobitById(
  tokenId: number,
): Promise<SorobitOnChainItem | null> {
  if (!SOROBITS_CONTRACT_ID) return null
  try {
    return await executeWithRpcFailover(async (rpcUrl) => {
      const client = makeSorobitsClient(rpcUrl)
      const [ownerTx, recordTx, uriTx, animTx] = await Promise.all([
        client.owner_of({ token_id: tokenId }),
        client.get_sorobit({ token_id: tokenId }),
        client.token_uri({ token_id: tokenId }),
        client.animated_svg({ token_id: tokenId }),
      ])

      const owner = unwrapSorobitOk<unknown>(ownerTx.result)
      const rec = unwrapSorobitOk<Record<string, unknown>>(recordTx.result)
      const rawUri = unwrapSorobitOk<unknown>(uriTx.result)
      const rawAnim = unwrapSorobitOk<unknown>(animTx.result)
      const jsonPrefix = 'data:application/json;utf8,'

      if (
        !isStellarAccount(owner) ||
        !rec ||
        typeof rawUri !== 'string' ||
        !rawUri.startsWith(jsonPrefix)
      ) {
        return null
      }
      const animSvg = typeof rawAnim === 'string' ? rawAnim : ''

      let name = `Sorobit #${tokenId}`
      let svgMarkup = ''
      let attributes: SorobitAttribute[] = []

      const parsed = JSON.parse(rawUri.slice(jsonPrefix.length)) as {
        name?: string
        image?: string
        attributes?: SorobitAttribute[]
      }
      if (parsed.name) name = parsed.name
      if (Array.isArray(parsed.attributes)) attributes = parsed.attributes
      const svgPrefix = 'data:image/svg+xml;utf8,'
      if (parsed.image?.startsWith(svgPrefix)) {
        svgMarkup = parsed.image.slice(svgPrefix.length)
      }

      const staticSvg = svgMarkup || animSvg
      if (!staticSvg) return null
      return {
        tokenId,
        owner,
        name,
        edition: Number(rec.edition ?? 0),
        generation: Number(rec.generation ?? 0),
        rankTier: Number(rec.rank_tier ?? 0),
        xpScore: Number(rec.xp_score ?? 0),
        bornLedger: Number(rec.born_ledger ?? 0),
        soulbound: Boolean(rec.soulbound),
        svgMarkup: staticSvg,
        imageDataUrl: svgToDataUrl(staticSvg),
        animatedDataUrl: svgToDataUrl(animSvg || staticSvg),
        attributes,
      }
    })
  } catch {
    return null
  }
}

export async function fetchSorobitsByOwner(
  ownerAddress: string,
  limit = 50,
): Promise<SorobitOnChainItem[]> {
  if (!ownerAddress || !SOROBITS_CONTRACT_ID) return []
  try {
    const ids = await executeWithRpcFailover(async (rpcUrl) => {
      const client = makeSorobitsClient(rpcUrl)
      try {
        const collected: number[] = []
        let offset = 0
        while (collected.length < limit) {
          const pageSize = Math.min(50, limit - collected.length)
          const pageTx = await client.tokens_of_page({
            owner: ownerAddress,
            offset,
            limit: pageSize,
          })
          const page = (pageTx.result ?? []).map((id) => Number(id))
          collected.push(...page)
          if (page.length < pageSize) break
          offset += page.length
        }
        return collected.slice(0, limit)
      } catch {
        const idsTx = await client.tokens_of({ owner: ownerAddress })
        return (idsTx.result ?? []).map((id) => Number(id)).slice(0, limit)
      }
    })
    if (ids.length === 0) return []
    const items = await Promise.all(ids.map((id) => fetchSorobitById(Number(id))))
    return items
      .filter((item): item is SorobitOnChainItem => item !== null)
      .sort((a, b) => b.tokenId - a.tokenId)
  } catch {
    return []
  }
}

export async function hasClaimedPioneer(ownerAddress: string): Promise<boolean> {
  if (!ownerAddress || !SOROBITS_CONTRACT_ID) return false
  try {
    return await executeWithRpcFailover(async (rpcUrl) => {
      const client = makeSorobitsClient(rpcUrl)
      const tx = await client.has_claimed({
        user: ownerAddress,
        archetype_id: 1,
      })
      return Boolean(tx.result)
    })
  } catch {
    return false
  }
}

function makeSignedSorobitsClient(signer: Signer): SorobitsClient {
  if (!SOROBITS_CONTRACT_ID) {
    throw new Error('Sorobits contract ID is not configured for this network.')
  }
  return new SorobitsClient({
    contractId: SOROBITS_CONTRACT_ID,
    rpcUrl: RPC_URL,
    networkPassphrase: NETWORK_PASSPHRASE,
    publicKey: signer.address,
    signTransaction: signer,
    signAuthEntry: signer,
  })
}

export async function fetchClaimedArchetypes(
  ownerAddress: string,
): Promise<number[]> {
  if (!ownerAddress || !SOROBITS_CONTRACT_ID) return []
  try {
    return await executeWithRpcFailover(async (rpcUrl) => {
      const client = makeSorobitsClient(rpcUrl)
      const checks = await Promise.all(
        [1, 2, 3, 4, 5, 6, 7, 8].map(async (archetypeId) => {
          const tx = await client.has_claimed({
            user: ownerAddress,
            archetype_id: archetypeId,
          })
          return tx.result ? archetypeId : null
        }),
      )
      return checks.filter((id): id is number => id !== null)
    })
  } catch {
    return []
  }
}

export async function claimPioneerOnChain(
  signer: Signer,
): Promise<{ tokenId: number; hash?: string }> {
  const client = makeSignedSorobitsClient(signer)
  const tx = await client.claim_pioneer({ user: signer.address })
  const sent = await tx.signAndSend()
  return {
    tokenId: Number(sent.result ?? 0),
    hash: sent.sendTransactionResponse?.hash,
  }
}

export async function claimQuestBadgeOnChain(
  signer: Signer,
  archetypeId: number,
): Promise<{ tokenId: number; hash?: string }> {
  const client = makeSignedSorobitsClient(signer)
  const tx = await client.claim_quest_badge({
    user: signer.address,
    archetype_id: archetypeId,
  })
  const sent = await tx.signAndSend()
  return {
    tokenId: Number(sent.result ?? 0),
    hash: sent.sendTransactionResponse?.hash,
  }
}

export async function syncEpigeneticsOnChain(
  signer: Signer,
  tokenId: number,
): Promise<{ xpScore: number; rankTier: number; hash?: string }> {
  const client = makeSignedSorobitsClient(signer)
  const tx = await client.sync_epigenetics({ token_id: tokenId })
  const sent = await tx.signAndSend()
  return {
    xpScore: Number(sent.result?.xp_score ?? 0),
    rankTier: Number(sent.result?.rank_tier ?? 0),
    hash: sent.sendTransactionResponse?.hash,
  }
}

function randomEntropy32(): Uint8Array {
  const out = new Uint8Array(32)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(out)
    return out
  }
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Math.floor(Math.random() * 256)
  }
  return out
}

export async function forgeAscendOnChain(
  signer: Signer,
  burnIdA: number,
  burnIdB: number,
  userEntropy?: Uint8Array,
): Promise<{ tokenId: number; hash?: string }> {
  const client = makeSignedSorobitsClient(signer)
  const tx = await client.forge_ascend({
    owner: signer.address,
    burn_id_a: burnIdA,
    burn_id_b: burnIdB,
    user_entropy: userEntropy ?? randomEntropy32(),
  })
  const sent = await tx.signAndSend()
  return {
    tokenId: Number(sent.result ?? 0),
    hash: sent.sendTransactionResponse?.hash,
  }
}

export async function fetchCapsuleQuota(
  ownerAddress: string,
): Promise<{ minted: number; maxAllowed: number }> {
  if (!ownerAddress || !SOROBITS_CONTRACT_ID) {
    return { minted: 0, maxAllowed: 2 }
  }
  try {
    return await executeWithRpcFailover(async (rpcUrl) => {
      const client = makeSorobitsClient(rpcUrl)
      const tx = await client.get_capsule_quota({ user: ownerAddress })
      const tuple = tx.result
      return {
        minted: Number(tuple?.[0] ?? 0),
        maxAllowed: Number(tuple?.[1] ?? 2),
      }
    })
  } catch {
    return { minted: 0, maxAllowed: 2 }
  }
}

export async function mintCapsuleOnChain(
  signer: Signer,
  userEntropy?: Uint8Array,
): Promise<{ tokenId: number; hash?: string }> {
  const client = makeSignedSorobitsClient(signer)
  const tx = await client.mint_capsule({
    user: signer.address,
    user_entropy: userEntropy ?? randomEntropy32(),
  })
  const sent = await tx.signAndSend()
  return {
    tokenId: Number(sent.result ?? 0),
    hash: sent.sendTransactionResponse?.hash,
  }
}

export async function fetchLaunchpadPilotTelemetry(
  ownerAddress: string,
): Promise<LaunchpadPilotTelemetry | null> {
  if (!isStellarAccount(ownerAddress)) return null
  try {
    return await executeWithRpcFailover(async (rpcUrl) => {
      const tx = await launchpadClient(undefined, rpcUrl).get_pilot({
        user: ownerAddress,
      })
      const rec = unwrapSorobitOk<{
        launches?: number
        graduations?: number
        trades?: number
        shouts?: number
        king_shouts?: number
        burns_triggered?: number
      }>(tx.result)
      if (!rec) return null
      return {
        launches: Number(rec.launches ?? 0),
        graduations: Number(rec.graduations ?? 0),
        trades: Number(rec.trades ?? 0),
        shouts: Number(rec.shouts ?? 0),
        kingShouts: Number(rec.king_shouts ?? 0),
        burnsTriggered: Number(rec.burns_triggered ?? 0),
      }
    })
  } catch {
    return null
  }
}

export async function fetchSorobitsSummary(): Promise<SorobitsContractSummary> {
  if (!SOROBITS_CONTRACT_ID) {
    return {
      contractId: '',
      totalSupply: 0,
      season1Sealed: false,
      liveTokenIds: [],
      genesis0: null,
    }
  }
  try {
    const { totalSupply, season1Sealed, liveTokenIds } =
      await executeWithRpcFailover(async (rpcUrl) => {
        const client = makeSorobitsClient(rpcUrl)
        const [supplyTx, sealedTx] = await Promise.all([
          client.total_supply(),
          client.is_season_sealed({ season: 1 }),
        ])
        const total = Number(unwrapSorobitOk<number>(supplyTx.result) ?? 0)
        const sealed = Boolean(unwrapSorobitOk<boolean>(sealedTx.result))
        const sampleSize = Math.min(total, 8)
        const idLookups = await Promise.all(
          Array.from({ length: sampleSize }, (_, index) =>
            client
              .get_token_id({ index })
              .then((tx) => unwrapSorobitOk<number>(tx.result))
              .catch(() => null),
          ),
        )
        const liveIds = idLookups.filter(
          (id): id is number => typeof id === 'number' && Number.isFinite(id),
        )
        return {
          totalSupply: total,
          season1Sealed: sealed,
          liveTokenIds: liveIds,
        }
      })
    const firstId = liveTokenIds[0]
    const genesis0 =
      firstId !== undefined ? await fetchSorobitById(firstId) : null
    return {
      contractId: SOROBITS_CONTRACT_ID,
      totalSupply,
      season1Sealed,
      liveTokenIds,
      genesis0,
      rpcFailed: false,
    }
  } catch {
    return {
      contractId: SOROBITS_CONTRACT_ID,
      totalSupply: 0,
      season1Sealed: false,
      liveTokenIds: [],
      genesis0: null,
      rpcFailed: true,
    }
  }
}
