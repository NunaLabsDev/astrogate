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
  limit = 8,
): Promise<SorobitOnChainItem[]> {
  if (!ownerAddress || !SOROBITS_CONTRACT_ID) return []
  try {
    const ids = await executeWithRpcFailover(async (rpcUrl) => {
      const client = makeSorobitsClient(rpcUrl)
      try {
        const pageTx = await client.tokens_of_page({
          owner: ownerAddress,
          offset: 0,
          limit,
        })
        return (pageTx.result ?? []).slice(0, limit)
      } catch {
        const idsTx = await client.tokens_of({ owner: ownerAddress })
        return (idsTx.result ?? []).slice(0, limit)
      }
    })
    if (ids.length === 0) return []
    const items = await Promise.all(ids.map((id) => fetchSorobitById(Number(id))))
    return items.filter((item): item is SorobitOnChainItem => item !== null)
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
