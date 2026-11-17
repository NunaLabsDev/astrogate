import { Keypair } from '@stellar/stellar-sdk'

import { Client as SorobitsClient } from '../contracts/sorobits'
import { NETWORK_PASSPHRASE, RPC_URL, SOROBITS_CONTRACT_ID } from './network'

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
  genesis0: SorobitOnChainItem | null
}

function makeSorobitsClient(): SorobitsClient {
  return new SorobitsClient({
    contractId: SOROBITS_CONTRACT_ID,
    rpcUrl: RPC_URL,
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
  try {
    const client = makeSorobitsClient()
    const [ownerTx, recordTx, uriTx, animTx] = await Promise.all([
      client.owner_of({ token_id: tokenId }),
      client.get_sorobit({ token_id: tokenId }),
      client.token_uri({ token_id: tokenId }),
      client.animated_svg({ token_id: tokenId }),
    ])

    const owner = String(ownerTx.result)
    const rec = recordTx.result
    const rawUri = String(uriTx.result)
    const animSvg = String(animTx.result)

    let name = `Sorobit #${tokenId}`
    let svgMarkup = ''
    let attributes: SorobitAttribute[] = []

    const jsonPrefix = 'data:application/json;utf8,'
    if (rawUri.startsWith(jsonPrefix)) {
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
    }

    const staticSvg = svgMarkup || animSvg
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
  } catch {
    return null
  }
}

export async function fetchSorobitsByOwner(
  ownerAddress: string,
  limit = 8,
): Promise<SorobitOnChainItem[]> {
  if (!ownerAddress) return []
  try {
    const client = makeSorobitsClient()
    const idsTx = await client.tokens_of({ owner: ownerAddress })
    const ids = (idsTx.result ?? []).slice(0, limit)
    if (ids.length === 0) return []
    const items = await Promise.all(ids.map((id) => fetchSorobitById(Number(id))))
    return items.filter((item): item is SorobitOnChainItem => item !== null)
  } catch {
    return []
  }
}

export async function fetchSorobitsSummary(): Promise<SorobitsContractSummary> {
  try {
    const client = makeSorobitsClient()
    const [supplyTx, sealedTx] = await Promise.all([
      client.total_supply(),
      client.is_season_sealed({ season: 1 }),
    ])
    const totalSupply = Number(supplyTx.result ?? 0)
    const season1Sealed = Boolean(sealedTx.result)
    const genesis0 = totalSupply > 0 ? await fetchSorobitById(0) : null
    return {
      contractId: SOROBITS_CONTRACT_ID,
      totalSupply,
      season1Sealed,
      genesis0,
    }
  } catch {
    return {
      contractId: SOROBITS_CONTRACT_ID,
      totalSupply: 0,
      season1Sealed: true,
      genesis0: null,
    }
  }
}
