/**
 * Permissionless Soroban Testnet TTL keep-alive script.
 *
 * Refreshes 90-day Soroban state TTLs for:
 *  1. Launchpad instance (`extend_ttl`)
 *  2. Canonical ASTRO token instance (`extend_ttl`)
 *  3. Up to 10 most recent launched tokens + their Launchpad registry/shout entries
 *
 * Usage:
 *   npm run keepalive:ttl              # Ephemeral Friendbot testnet account
 *   STELLAR_SECRET=S... npm run keepalive:ttl
 */
import { createServer } from 'vite'
import { Keypair } from '@stellar/stellar-sdk'
import { KeypairSigner } from '@stellar/stellar-sdk/contract'

const FRIENDBOT_URL = 'https://friendbot.stellar.org'
const MAX_LAUNCHED_TOKENS = 10

async function getFundedKeypair() {
  const envSecret = process.env.STELLAR_SECRET?.trim()
  if (envSecret) {
    return { keypair: Keypair.fromSecret(envSecret), source: 'env' }
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

  const { keypair, source } = await getFundedKeypair()
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

  const launchesTx = await launchpad.get_launches({
    offset: 0,
    limit: MAX_LAUNCHED_TOKENS,
  })
  const launches = launchesTx.result ?? []
  console.log(`launches found on-chain: ${launches.length}`)

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
} finally {
  await vite.close()
}

if (failures > 0) {
  console.error(`\nkeepalive:ttl completed with ${failures} failure(s)`)
  process.exit(1)
}
console.log('\nkeepalive:ttl completed with 0 failures')
