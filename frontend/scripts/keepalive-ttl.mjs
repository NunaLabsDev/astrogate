/**
 * Permissionless Soroban Testnet TTL keep-alive script.
 *
 * Refreshes 90-day / 180-day Soroban state TTLs for:
 *  1. Launchpad instance (`extend_ttl`)
 *  2. Canonical ASTRO token instance (`extend_ttl`)
 *  3. All launched tokens + their Launchpad registry/curve/shout entries (paginated)
 *  4. Sorobits (SBIT) SEP-50 contract instance + all minted NFTs (`extend_token_ttl`)
 *
 * Usage:
 *   npm run keepalive:ttl              # Ephemeral Friendbot testnet account
 *   STELLAR_SECRET=S... npm run keepalive:ttl
 */
import { createServer } from 'vite'
import { Keypair } from '@stellar/stellar-sdk'
import { KeypairSigner } from '@stellar/stellar-sdk/contract'
import { loadStellarSecret } from './lib/load-secret.mjs'

const FRIENDBOT_URL = 'https://friendbot.stellar.org'
const PAGE_SIZE = 20

async function getFundedKeypair(networkName) {
  const { secret, source } = loadStellarSecret()
  if (secret) {
    return { keypair: Keypair.fromSecret(secret), source: source ?? 'env' }
  }
  if (networkName === 'mainnet') {
    throw new Error('STELLAR_SECRET is required when running keepalive:ttl on mainnet (Friendbot unavailable).')
  }
  const keypair = Keypair.random()
  const res = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(keypair.publicKey())}`)
  if (!res.ok) {
    throw new Error(`Friendbot funding failed (${res.status}) for ${keypair.publicKey()}`)
  }
  return { keypair, source: 'friendbot' }
}

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

let failures = 0

try {
  const networkLib = await vite.ssrLoadModule('/src/lib/network.ts')
  const tokenLib = await vite.ssrLoadModule('/src/lib/token.ts')

  const { keypair, source } = await getFundedKeypair(networkLib.NETWORK_NAME)
  const signer = new KeypairSigner(keypair, networkLib.NETWORK_PASSPHRASE)
  console.log(`keeper: ${keypair.publicKey()} (${source})`)

  const launchpad = tokenLib.launchpadClient(signer)

  try {
    const lpTx = await launchpad.extend_ttl()
    const lpSent = await lpTx.signAndSend({ force: true })
    console.log(
      `ok   launchpad.extend_ttl · ${networkLib.LAUNCHPAD_CONTRACT_ID} · tx=${lpSent.sendTransactionResponse?.hash ?? 'ok'}`,
    )
  } catch (err) {
    failures++
    console.error('FAIL launchpad.extend_ttl:', err instanceof Error ? err.message : String(err))
  }

  try {
    const astroRes = await tokenLib.extendTokenTtl({
      tokenId: networkLib.ASTRO_TOKEN_ID,
      signer,
    })
    console.log(
      `ok   astro-token.extend_ttl · ${networkLib.ASTRO_TOKEN_ID} · tx=${astroRes.hash ?? 'ok'}`,
    )
  } catch (err) {
    failures++
    console.error('FAIL astro-token.extend_ttl:', err instanceof Error ? err.message : String(err))
  }

  const countTx = await launchpad.get_launch_count()
  const totalLaunches = Number(countTx.result ?? 0)
  const launches = []
  for (let offset = 0; offset < totalLaunches; offset += PAGE_SIZE) {
    const launchesTx = await launchpad.get_launches({
      offset,
      limit: Math.min(PAGE_SIZE, totalLaunches - offset),
    })
    const page = launchesTx.result ?? []
    if (page.length === 0) break
    launches.push(...page)
  }
  console.log(`launches found on-chain: ${launches.length} / ${totalLaunches}`)

  const seen = new Set([networkLib.ASTRO_TOKEN_ID])
  for (const record of launches) {
    const tokenId = record.token
    if (!tokenId) continue
    const alreadyRefreshedToken = seen.has(tokenId)
    seen.add(tokenId)
    try {
      if (alreadyRefreshedToken) {
        const recTx = await launchpad.extend_launch_ttl({ token: tokenId })
        const recSent = await recTx.signAndSend({ force: true })
        console.log(
          `ok   extend_launch_ttl · ${record.symbol} (${tokenId}) · tx=${recSent.sendTransactionResponse?.hash ?? 'ok'}`,
        )
      } else {
        const res = await tokenLib.extendTokenTtl({ tokenId, signer })
        console.log(
          `ok   extendTokenTtl · ${record.symbol} (${tokenId}) · tx=${res.hash ?? 'ok'}`,
        )
      }
    } catch (err) {
      failures++
      console.error(
        `FAIL keep-alive for ${record.symbol} (${tokenId}):`,
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  // Refresh Sorobits (SBIT) contract & minted NFTs
  try {
    const { Client: SorobitsClient } = await vite.ssrLoadModule('/src/contracts/sorobits/index.ts')
    const sorobits = new SorobitsClient({
      contractId: networkLib.SOROBITS_CONTRACT_ID,
      rpcUrl: networkLib.RPC_URL,
      networkPassphrase: networkLib.NETWORK_PASSPHRASE,
      publicKey: signer.address,
      signTransaction: signer,
      signAuthEntry: signer,
    })
    const sbTx = await sorobits.extend_ttl()
    const sbSent = await sbTx.signAndSend({ force: true })
    console.log(
      `ok   sorobits.extend_ttl · ${networkLib.SOROBITS_CONTRACT_ID} · tx=${sbSent.sendTransactionResponse?.hash ?? 'ok'}`,
    )
    const supplyTx = await sorobits.total_supply()
    const totalNfts = Number(supplyTx.result ?? 0)
    console.log(`sorobits minted on-chain: ${totalNfts}`)
    for (let index = 0; index < totalNfts; index++) {
      let tokenId = index
      try {
        const idTx = await sorobits.get_token_id({ index })
        if (typeof idTx.result === 'number') tokenId = idTx.result
      } catch {
        // Fallback to index if contract does not expose enumerable get_token_id
      }
      try {
        const nftTx = await sorobits.extend_token_ttl({ token_id: tokenId })
        const nftSent = await nftTx.signAndSend({ force: true })
        console.log(
          `ok   sorobits.extend_token_ttl · #${tokenId} · tx=${nftSent.sendTransactionResponse?.hash ?? 'ok'}`,
        )
      } catch (err) {
        failures++
        console.error(
          `FAIL sorobits.extend_token_ttl #${tokenId}:`,
          err instanceof Error ? err.message : String(err),
        )
      }
    }
  } catch (err) {
    failures++
    console.error('FAIL sorobits keep-alive:', err instanceof Error ? err.message : String(err))
  }
} finally {
  await vite.close()
}

if (failures > 0) {
  console.error(`\nkeepalive:ttl completed with ${failures} failure(s)`)
  process.exit(1)
}
console.log('\nkeepalive:ttl completed with 0 failures')
