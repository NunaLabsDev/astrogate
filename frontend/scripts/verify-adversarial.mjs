/**
 * Multi-Account Stress & Adversarial Attack Verification on Live Stellar Testnet.
 *
 * Provisions 5 distinct active accounts (`Creator`, `Trader1`, `Trader2`, `Attacker`
 * via Friendbot + `Ops` via `astrogate-deployer`) and tests:
 *  - Authentic v3 10M Fair Launch invariants (9.95M LP / 50K creator, >= 2 XLM floor)
 *  - Malicious & malformed Launchpad calls (auth spoof, sub-min XLM, <99.5% LP rug,
 *    oversized/empty metadata, cross-account salt squatting, extreme pagination)
 *  - Malicious SEP-41 calls (post-renounce mint, unauthorized transfer, transfer_from /
 *    burn_from without allowance, zero-balance overdraft, negative amount)
 *  - Malicious Burn-to-Chat calls (0 balance, 0/negative amount, empty/oversized text, spoof)
 *  - Multi-account AMM swap wave verifying strict monotonic invariant k = R_token * R_xlm
 *  - Slippage / sandwich protection rejection without balance loss
 *  - On-chain self-transfer & circular wash churn + `analyzeTokenHolders` supply audit
 *
 * Usage: npm run verify:adversarial
 */
import { createServer } from 'vite'
import { Keypair } from '@stellar/stellar-sdk'
import { KeypairSigner } from '@stellar/stellar-sdk/contract'
import { loadStellarSecret } from './lib/load-secret.mjs'

const UNIT = 10_000_000n // 7 decimals
const EXPECTED_INITIAL_SUPPLY = 10_000_000n * UNIT
const EXPECTED_CREATOR_ALLOC = 50_000n * UNIT
const EXPECTED_POOL_ALLOC = 9_950_000n * UNIT

const { secret } = loadStellarSecret()
if (!secret) {
  console.error('Falta STELLAR_SECRET (env o ~/.secrets/astrogate/developer-accounts.env)')
  process.exit(1)
}

function unwrapOrThrow(sent) {
  const res = sent?.result
  if (res && typeof res === 'object' && 'isErr' in res && typeof res.isErr === 'function') {
    if (res.isErr()) {
      throw new Error(`Contract Err: ${JSON.stringify(res.unwrapErr())}`)
    }
    return res.unwrap()
  }
  return res
}

async function expectRejected(label, fn) {
  let errMsg = null
  try {
    await fn()
  } catch (err) {
    errMsg = err instanceof Error ? err.message : String(err)
  }
  if (!errMsg) {
    throw new Error(`SECURITY FAILURE: "${label}" unexpectedly succeeded instead of reverting`)
  }
  console.log(`  ok rejected [${label}]: ${errMsg.replace(/\s+/g, ' ').slice(0, 120)}`)
  return errMsg
}

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

let failed = false

try {
  const networkLib = await vite.ssrLoadModule('/src/lib/network.ts')
  const demo = await vite.ssrLoadModule('/src/lib/demo.ts')
  const soroswap = await vite.ssrLoadModule('/src/lib/soroswap.ts')
  const tokenLib = await vite.ssrLoadModule('/src/lib/token.ts')
  const metadataLib = await vite.ssrLoadModule('/src/lib/token-metadata.ts')
  const eventsLib = await vite.ssrLoadModule('/src/lib/token-events.ts')
  const holdersLib = await vite.ssrLoadModule('/src/lib/holders.ts')
  const sdkLib = await vite.ssrLoadModule('/src/sdk/index.ts')

  const opsKeypair = Keypair.fromSecret(secret)
  const opsSigner = new KeypairSigner(opsKeypair, networkLib.NETWORK_PASSPHRASE)

  console.log('1) Provisioning 5 accounts (4 Friendbot + astrogate-deployer Ops)...')
  const { accounts, failed: fundFailed } = await demo.createDemoAccounts(
    ({ index, status }) => {
      console.log(`  account ${demo.demoLabelForIndex(index)}: ${status}`)
    },
    4,
  )
  if (fundFailed > 0 || accounts.length !== 4) {
    throw new Error(`Expected 4 funded accounts, got ${accounts.length} (failed=${fundFailed})`)
  }

  const [creator, trader1, trader2, attacker] = accounts
  const creatorSigner = demo.demoSigner(creator)
  const trader1Signer = demo.demoSigner(trader1)
  const trader2Signer = demo.demoSigner(trader2)
  const attackerSigner = demo.demoSigner(attacker)

  console.log(`  Creator : ${creator.publicKey}`)
  console.log(`  Trader1 : ${trader1.publicKey}`)
  console.log(`  Trader2 : ${trader2.publicKey}`)
  console.log(`  Attacker: ${attacker.publicKey}`)
  console.log(`  Ops     : ${opsKeypair.publicKey()}`)

  console.log('\n2) Authentic 10M Fair Launch by Creator...')
  const launch = await tokenLib.launchFairAtomic({
    name: `AdvAudit ${Date.now()}`,
    symbol: 'ADVT',
    xlmLpAmount: 10n * UNIT,
    meta: metadataLib.encodeOnChainMeta({ description: 'Multi-account adversarial audit' }),
    signer: creatorSigner,
  })
  const token = launch.token
  console.log(`  launched: token=${token} pair=${launch.pair} lpBurned=${launch.lpMinted.toString()}`)

  const tokenRead = tokenLib.tokenClient(token)
  const [supplyInit, creatorBalInit, poolInit, auditInit, ownerInit] = await Promise.all([
    tokenRead.total_supply(),
    tokenLib.fetchTokenBalance(token, creator.publicKey),
    soroswap.fetchPoolState(token),
    sdkLib.verifyAntiRug(token),
    tokenRead.get_owner(),
  ])

  if (supplyInit.result !== EXPECTED_INITIAL_SUPPLY) {
    throw new Error(`Unexpected total_supply: ${supplyInit.result}`)
  }
  if (creatorBalInit !== EXPECTED_CREATOR_ALLOC) {
    throw new Error(`Unexpected creator share: ${creatorBalInit}`)
  }
  if (poolInit.reserveToken !== EXPECTED_POOL_ALLOC || poolInit.reserveXlm !== 10n * UNIT) {
    throw new Error(`Unexpected pool reserves: ${poolInit.reserveToken}/${poolInit.reserveXlm}`)
  }
  if (!auditInit.isAntiRugVerified || !auditInit.lpBurned || !auditInit.ownershipRenounced) {
    throw new Error(`Anti-rug verification failed: ${JSON.stringify(auditInit)}`)
  }
  if (ownerInit.result !== null) {
    throw new Error(`Ownership was not renounced: ${ownerInit.result}`)
  }
  console.log('  invariants verified: 10M cap, 9.95M/10 XLM pool, 50K creator, owner=None, 100% LP burned')

  // Verify 1 whole token sells for clean positive stroops on a 10M / >=2 XLM pool (~10 stroops here)
  const oneTokenSellQuote = await soroswap.quoteTokenForXlm(UNIT, poolInit)
  if (oneTokenSellQuote < 9n) {
    throw new Error(`Expected >= 9 stroops per 1 token at 10 XLM/9.95M pool, got ${oneTokenSellQuote}`)
  }
  console.log(`  ok stroop floor: 1 whole ADVT sells for ${oneTokenSellQuote} stroops (> 0 sub-stroop loss)`)

  console.log('\n3) Malicious & malformed Launchpad attack attempts...')
  const lpAttacker = tokenLib.launchpadClient(attackerSigner)
  const dummySalt = new Uint8Array(32).fill(42)

  await expectRejected('launch_fair auth spoofing Creator by Attacker', async () => {
    const tx = await lpAttacker.launch_fair({
      params: {
        creator: creator.publicKey,
        name: 'Spoofed',
        symbol: 'SPF',
        xlm_lp_amount: 10n * UNIT,
        meta: '',
        salt: dummySalt,
      },
    })
    return unwrapOrThrow(await tx.signAndSend())
  })

  await expectRejected('launch_fair zero XLM LP', async () => {
    const tx = await lpAttacker.launch_fair({
      params: {
        creator: attacker.publicKey,
        name: 'ZeroXlm',
        symbol: 'ZXLM',
        xlm_lp_amount: 0n,
        meta: '',
        salt: dummySalt,
      },
    })
    return unwrapOrThrow(await tx.signAndSend())
  })

  await expectRejected('launch_fair below 2 XLM minimum (1.9999999 XLM)', async () => {
    const tx = await lpAttacker.launch_fair({
      params: {
        creator: attacker.publicKey,
        name: 'SubMinXlm',
        symbol: 'SMIN',
        xlm_lp_amount: 19_999_999n,
        meta: '',
        salt: dummySalt,
      },
    })
    return unwrapOrThrow(await tx.signAndSend())
  })

  await expectRejected('launch_token < 99.5% LP rug-pull attempt (50% to creator)', async () => {
    const tx = await lpAttacker.launch_token({
      params: {
        creator: attacker.publicKey,
        name: 'RugCoin',
        symbol: 'RUG',
        decimals: 7,
        initial_supply: EXPECTED_INITIAL_SUPPLY,
        token_lp_amount: 50_000_000n * UNIT,
        xlm_lp_amount: 10n * UNIT,
        salt: dummySalt,
      },
    })
    return unwrapOrThrow(await tx.signAndSend())
  })

  await expectRejected('launch_fair empty name', async () => {
    const tx = await lpAttacker.launch_fair({
      params: {
        creator: attacker.publicKey,
        name: '',
        symbol: 'EMPTY',
        xlm_lp_amount: 10n * UNIT,
        meta: '',
        salt: dummySalt,
      },
    })
    return unwrapOrThrow(await tx.signAndSend())
  })

  await expectRejected('launch_fair symbol > 32 bytes', async () => {
    const tx = await lpAttacker.launch_fair({
      params: {
        creator: attacker.publicKey,
        name: 'LongSym',
        symbol: 'S'.repeat(33),
        xlm_lp_amount: 10n * UNIT,
        meta: '',
        salt: dummySalt,
      },
    })
    return unwrapOrThrow(await tx.signAndSend())
  })

  await expectRejected('launch_fair meta > 512 bytes', async () => {
    const tx = await lpAttacker.launch_fair({
      params: {
        creator: attacker.publicKey,
        name: 'HugeMeta',
        symbol: 'META',
        xlm_lp_amount: 10n * UNIT,
        meta: 'a'.repeat(513),
        salt: dummySalt,
      },
    })
    return unwrapOrThrow(await tx.signAndSend())
  })

  // Cross-account salt griefing check on-chain
  const sharedSalt = crypto.getRandomValues(new Uint8Array(32))
  const squatTx = await lpAttacker.launch_fair({
    params: {
      creator: attacker.publicKey,
      name: 'SquatSalt',
      symbol: 'SQT',
      xlm_lp_amount: 2n * UNIT,
      meta: '',
      salt: sharedSalt,
    },
  })
  const squatRes = unwrapOrThrow(await squatTx.signAndSend())

  const creatorSharedTx = await tokenLib.launchpadClient(creatorSigner).launch_fair({
    params: {
      creator: creator.publicKey,
      name: 'CreatorSameSalt',
      symbol: 'SAME',
      xlm_lp_amount: 2n * UNIT,
      meta: '',
      salt: sharedSalt,
    },
  })
  const creatorSameRes = unwrapOrThrow(await creatorSharedTx.signAndSend())
  if (creatorSameRes.token === squatRes.token) {
    throw new Error('Salt front-running collision detected between distinct creators!')
  }
  console.log(`  ok cross-account salt isolation: Attacker=${squatRes.token} Creator=${creatorSameRes.token}`)

  // Extreme pagination safety
  const lpRead = tokenLib.launchpadClient()
  const [emptyPageZero, emptyPageHuge] = await Promise.all([
    lpRead.get_launches({ offset: 0, limit: 0 }),
    lpRead.get_launches({ offset: 0xffffffff, limit: 10 }),
  ])
  if ((emptyPageZero.result?.length ?? -1) !== 0 || (emptyPageHuge.result?.length ?? -1) !== 0) {
    throw new Error('Pagination bounds did not return empty vector')
  }
  console.log('  ok get_launches boundary pagination safe')

  console.log('\n4) Malicious SEP-41 token attacks on ADVT...')
  const tokAsCreator = tokenLib.tokenClient(token, creatorSigner)
  const tokAsAttacker = tokenLib.tokenClient(token, attackerSigner)

  await expectRejected('mint by original Creator after renounce_ownership', async () => {
    const tx = await tokAsCreator.mint({ to: creator.publicKey, amount: 1_000n * UNIT })
    await tx.signAndSend()
  })

  await expectRejected('mint by Attacker after renounce_ownership', async () => {
    const tx = await tokAsAttacker.mint({ to: attacker.publicKey, amount: 1_000n * UNIT })
    await tx.signAndSend()
  })

  await expectRejected('unauthorized direct transfer from Creator signed by Attacker', async () => {
    const tx = await tokAsAttacker.transfer({
      from: creator.publicKey,
      to: attacker.publicKey,
      amount: 1_000n * UNIT,
    })
    await tx.signAndSend()
  })

  await expectRejected('transfer_from Creator without allowance', async () => {
    const tx = await tokAsAttacker.transfer_from({
      spender: attacker.publicKey,
      from: creator.publicKey,
      to: attacker.publicKey,
      amount: 1_000n * UNIT,
    })
    await tx.signAndSend()
  })

  await expectRejected('burn_from Creator without allowance', async () => {
    const tx = await tokAsAttacker.burn_from({
      spender: attacker.publicKey,
      from: creator.publicKey,
      amount: 1_000n * UNIT,
    })
    await tx.signAndSend()
  })

  await expectRejected('Attacker overdraft transfer (0 balance)', async () => {
    const tx = await tokAsAttacker.transfer({
      from: attacker.publicKey,
      to: creator.publicKey,
      amount: 1n * UNIT,
    })
    await tx.signAndSend()
  })

  await expectRejected('negative transfer amount (-1)', async () => {
    const tx = await tokAsAttacker.transfer({
      from: attacker.publicKey,
      to: creator.publicKey,
      amount: -1n,
    })
    await tx.signAndSend()
  })

  console.log('\n5) Malicious Burn-to-Chat (burn_shout) attacks...')
  await expectRejected('burn_shout by zero-balance Attacker', async () => {
    await tokenLib.burnAndShout({
      tokenId: token,
      amount: 100n * UNIT,
      message: 'free spam',
      signer: attackerSigner,
    })
  })

  await expectRejected('burn_shout amount 0', async () => {
    await tokenLib.burnAndShout({
      tokenId: token,
      amount: 0n,
      message: 'zero burn',
      signer: creatorSigner,
    })
  })

  await expectRejected('burn_shout negative amount (-5)', async () => {
    const tx = await tokenLib.launchpadClient(creatorSigner).burn_shout({
      sender: creator.publicKey,
      token,
      amount: -5n,
      message: 'negative burn',
    })
    return unwrapOrThrow(await tx.signAndSend())
  })

  await expectRejected('burn_shout empty message', async () => {
    await tokenLib.burnAndShout({
      tokenId: token,
      amount: 10n * UNIT,
      message: '',
      signer: creatorSigner,
    })
  })

  await expectRejected('burn_shout message > 160 bytes', async () => {
    await tokenLib.burnAndShout({
      tokenId: token,
      amount: 10n * UNIT,
      message: 'x'.repeat(161),
      signer: creatorSigner,
    })
  })

  await expectRejected('burn_shout auth spoofing Creator by Attacker', async () => {
    const tx = await lpAttacker.burn_shout({
      sender: creator.publicKey,
      token,
      amount: 10n * UNIT,
      message: 'spoofed shout',
    })
    return unwrapOrThrow(await tx.signAndSend())
  })

  const shoutsBeforeWave = await eventsLib.fetchTokenShouts(token)
  if (shoutsBeforeWave.length !== 0) {
    throw new Error(`Expected 0 shouts after rejected attacks, found ${shoutsBeforeWave.length}`)
  }
  console.log('  ok 0 malicious shouts written on-chain')

  console.log('\n6) Multi-account swap wave, sandwich/slippage guard & self-transfer churn...')
  const k = (p) => p.reserveToken * p.reserveXlm
  const k0 = k(poolInit)

  // Buyer 1 (Trader1): 2 XLM -> ADVT
  const q1 = await soroswap.quoteXlmForToken(2n * UNIT, poolInit)
  const swap1 = await soroswap.swapXlmForToken({
    tokenId: token,
    amountIn: 2n * UNIT,
    amountOutMin: soroswap.withSlippage(q1, 2),
    signer: trader1Signer,
  })
  const p1 = await soroswap.fetchPoolState(token)
  if (k(p1) <= k0) throw new Error('AMM invariant k did not strictly increase on swap 1')
  console.log(`  ok Trader1 bought ${swap1[1]} base units for 2 XLM | k increased`)

  // Buyer 2 (Trader2): 4 XLM -> ADVT
  const q2 = await soroswap.quoteXlmForToken(4n * UNIT, p1)
  const swap2 = await soroswap.swapXlmForToken({
    tokenId: token,
    amountIn: 4n * UNIT,
    amountOutMin: soroswap.withSlippage(q2, 2),
    signer: trader2Signer,
  })
  const p2 = await soroswap.fetchPoolState(token)
  if (k(p2) <= k(p1)) throw new Error('AMM invariant k did not strictly increase on swap 2')
  console.log(`  ok Trader2 bought ${swap2[1]} base units for 4 XLM | k increased`)

  // Buyer 3 (Ops astrogate-deployer): 3 XLM -> ADVT
  const q3 = await soroswap.quoteXlmForToken(3n * UNIT, p2)
  const swap3 = await soroswap.swapXlmForToken({
    tokenId: token,
    amountIn: 3n * UNIT,
    amountOutMin: soroswap.withSlippage(q3, 2),
    signer: opsSigner,
  })
  const p3 = await soroswap.fetchPoolState(token)
  if (k(p3) <= k(p2)) throw new Error('AMM invariant k did not strictly increase on swap 3')
  console.log(`  ok Ops bought ${swap3[1]} base units for 3 XLM | k increased`)

  // Sandwich / slippage protection test: Trader1 asks for 2x quoted output -> router rejects cleanly
  const t1BalBeforeSandwich = await tokenLib.fetchTokenBalance(token, trader1.publicKey)
  const qImpossible = (await soroswap.quoteXlmForToken(2n * UNIT, p3)) * 2n
  await expectRejected('Soroswap slippage/sandwich guard (amountOutMin = 2x quote)', async () => {
    await soroswap.swapXlmForToken({
      tokenId: token,
      amountIn: 2n * UNIT,
      amountOutMin: qImpossible,
      signer: trader1Signer,
    })
  })
  const t1BalAfterSandwich = await tokenLib.fetchTokenBalance(token, trader1.publicKey)
  if (t1BalAfterSandwich !== t1BalBeforeSandwich) {
    throw new Error('Trader1 token balance changed after reverted sandwich swap!')
  }

  // Self-transfer + multi-wallet churn + sell + legitimate shouts + permissionless TTL
  const tokAsTrader1 = tokenLib.tokenClient(token, trader1Signer)
  await (
    await tokAsTrader1.transfer({
      from: trader1.publicKey,
      to: trader1.publicKey,
      amount: 100_000n * UNIT,
    })
  ).signAndSend()
  const t1AfterSelf = await tokenLib.fetchTokenBalance(token, trader1.publicKey)
  if (t1AfterSelf !== t1BalAfterSandwich) {
    throw new Error('Self-transfer mutated token balance!')
  }

  await (
    await tokAsTrader1.transfer({
      from: trader1.publicKey,
      to: trader2.publicKey,
      amount: 5_000n * UNIT,
    })
  ).signAndSend()
  await (
    await tokAsTrader1.transfer({
      from: trader1.publicKey,
      to: attacker.publicKey,
      amount: 2_000n * UNIT,
    })
  ).signAndSend()

  const sellAmt = 3_000n * UNIT
  const sellQuote = await soroswap.quoteTokenForXlm(sellAmt, p3)
  const sellRes = await soroswap.swapTokenForXlm({
    tokenId: token,
    amountIn: sellAmt,
    amountOutMin: soroswap.withSlippage(sellQuote, 2),
    signer: trader2Signer,
  })
  const pFinal = await soroswap.fetchPoolState(token)
  if (k(pFinal) <= k(p3) || !sellRes[1] || sellRes[1] <= 0n) {
    throw new Error('Trader2 sell failed or violated k invariant')
  }
  console.log(`  ok Trader2 sold 3,000 ADVT -> ${sellRes[1]} stroops XLM | k increased`)

  const shout1Amt = 500n * UNIT
  const shout2Amt = 250n * UNIT
  await tokenLib.burnAndShout({
    tokenId: token,
    amount: shout1Amt,
    message: 'Trader1 diamond hands',
    signer: trader1Signer,
  })
  await tokenLib.burnAndShout({
    tokenId: token,
    amount: shout2Amt,
    message: 'Trader2 audit verified',
    signer: trader2Signer,
  })

  // Permissionless TTL refresh by Attacker works cleanly
  await tokenLib.extendTokenTtl({ tokenId: token, signer: attackerSigner })

  // Final supply, shouts & live holder analyzer conservation audit
  const totalBurnedShouts = shout1Amt + shout2Amt
  const [supplyFinal, creatorBalFinal, t1BalFinal, shoutsFinal, liveEvents] = await Promise.all([
    tokenRead.total_supply(),
    tokenLib.fetchTokenBalance(token, creator.publicKey),
    tokenLib.fetchTokenBalance(token, trader1.publicKey),
    eventsLib.fetchTokenShouts(token),
    eventsLib.fetchTokenEvents(token, 50),
  ])

  const expectedFinalSupply = EXPECTED_INITIAL_SUPPLY - totalBurnedShouts
  if (supplyFinal.result !== expectedFinalSupply) {
    throw new Error(`Supply mismatch: got ${supplyFinal.result}, expected ${expectedFinalSupply}`)
  }
  if (shoutsFinal.length !== 2) {
    throw new Error(`Expected 2 shouts recorded on-chain, got ${shoutsFinal.length}`)
  }

  const analysis = holdersLib.analyzeTokenHolders({
    totalSupply: supplyFinal.result,
    reserveToken: pFinal.reserveToken,
    pairId: pFinal.pairId,
    creator: creator.publicKey,
    creatorBalance: creatorBalFinal,
    userAddress: trader1.publicKey,
    userBalance: t1BalFinal,
    events: liveEvents,
  })

  if (analysis.holders.some((h) => h.address === networkLib.LAUNCHPAD_CONTRACT_ID)) {
    throw new Error('Holder analysis leaked Launchpad contract address!')
  }
  const observedSum = analysis.holders.reduce((acc, h) => acc + h.balance, 0n)
  if (observedSum > supplyFinal.result) {
    throw new Error(`Holder analysis exceeded total supply: ${observedSum} > ${supplyFinal.result}`)
  }
  const analyzedTrader1 = analysis.holders.find((h) => h.address === trader1.publicKey)
  if (!analyzedTrader1 || analyzedTrader1.balance !== t1BalFinal) {
    throw new Error(`Trader1 analyzed balance mismatch (${analyzedTrader1?.balance} vs ${t1BalFinal})`)
  }

  console.log('\n=== ADVERSARIAL & MULTI-ACCOUNT AUDIT PASSED ===')
  console.log(`Token           : ${token}`)
  console.log(`Pair            : ${pFinal.pairId}`)
  console.log(`Supply final    : ${supplyFinal.result.toString()} (burned ${totalBurnedShouts.toString()})`)
  console.log(`Pool reserve    : ${pFinal.reserveToken.toString()} token / ${pFinal.reserveXlm.toString()} XLM`)
  console.log(`Events analyzed : ${liveEvents.length} | Holders tracked: ${analysis.holders.length} | Risk: ${analysis.riskLabel}`)
} catch (err) {
  failed = true
  console.error('\nADVERSARIAL TEST FAILURE:', err instanceof Error ? err.message : err)
} finally {
  await vite.close()
}

process.exit(failed ? 1 : 0)
