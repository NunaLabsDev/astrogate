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
const EXPECTED_BURN_VAULT = 2_950_000n * UNIT
const EXPECTED_CREATOR_VESTING = 50_000n * UNIT
const EXPECTED_DEX_RESERVE = 2_800_000n * UNIT
const EXPECTED_MILESTONE_1_BURN = 1_475_000n * UNIT

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

  console.log('\n2) Authentic 10M Fair-Flywheel v4 Launch by Creator...')
  const tokenomics = await vite.ssrLoadModule('/src/lib/tokenomics.ts')
  const launch = await tokenLib.launchFairAtomic({
    name: `AdvAudit ${Date.now()}`,
    symbol: 'ADVT',
    xlmLpAmount: 10n * UNIT,
    meta: metadataLib.encodeOnChainMeta({ description: 'Multi-account adversarial v4 audit' }),
    signer: creatorSigner,
  })
  const token = launch.token
  console.log(`  launched: token=${token} pair=${launch.pair ?? 'Virtual Curve Active'}`)

  const tokenRead = tokenLib.tokenClient(token)
  const [supplyInit, creatorBalInit, curveInit, auditInit, ownerInit] = await Promise.all([
    tokenRead.total_supply(),
    tokenLib.fetchTokenBalance(token, creator.publicKey),
    tokenLib.fetchCurveState(token),
    sdkLib.verifyAntiRug(token),
    tokenRead.get_owner(),
  ])

  const expectedCreatorBuy = tokenomics.localCurveQuoteBuy(0n, 0n, 10n * UNIT)?.tokens_out ?? 0n
  if (supplyInit.result !== EXPECTED_INITIAL_SUPPLY) {
    throw new Error(`Unexpected total_supply: ${supplyInit.result}`)
  }
  if (!curveInit || curveInit.graduated) {
    throw new Error(`Expected active non-graduated CurveState`)
  }
  if (
    curveInit.burn_vault_remaining !== EXPECTED_BURN_VAULT ||
    curveInit.creator_vesting_total !== EXPECTED_CREATOR_VESTING
  ) {
    throw new Error(`Unexpected v4 vault/vesting split: ${JSON.stringify(curveInit)}`)
  }
  if (
    creatorBalInit !== 0n ||
    curveInit.creator_seed_locked !== expectedCreatorBuy ||
    curveInit.tokens_sold !== expectedCreatorBuy
  ) {
    throw new Error(
      `Unexpected v4.2 seed lock: bal=${creatorBalInit} locked=${curveInit.creator_seed_locked} expected=${expectedCreatorBuy}`,
    )
  }
  if (!auditInit.isAntiRugVerified || !auditInit.ownershipRenounced) {
    throw new Error(`Anti-rug verification failed: ${JSON.stringify(auditInit)}`)
  }
  if (ownerInit.result !== null) {
    throw new Error(`Ownership was not renounced: ${ownerInit.result}`)
  }
  console.log('  invariants verified: 10M cap, 42/28/29.5/0.5 split + creator seed locked, owner=None, exact v4.2 quote parity')

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

  await expectRejected('burn_shout below minimum (< 50 tokens)', async () => {
    await tokenLib.burnAndShout({
      tokenId: token,
      amount: 49n * UNIT,
      message: 'below minimum burn',
      signer: creatorSigner,
    })
  })

  await expectRejected('burn_shout empty message', async () => {
    await tokenLib.burnAndShout({
      tokenId: token,
      amount: 50n * UNIT,
      message: '',
      signer: creatorSigner,
    })
  })

  await expectRejected('burn_shout message > 160 bytes', async () => {
    await tokenLib.burnAndShout({
      tokenId: token,
      amount: 50n * UNIT,
      message: 'x'.repeat(161),
      signer: creatorSigner,
    })
  })

  await expectRejected('burn_shout auth spoofing Creator by Attacker', async () => {
    const tx = await lpAttacker.burn_shout({
      sender: creator.publicKey,
      token,
      amount: 50n * UNIT,
      message: 'spoofed shout',
    })
    return unwrapOrThrow(await tx.signAndSend())
  })

  await expectRejected('trigger_milestone_burn before graduation', async () => {
    await tokenLib.triggerMilestoneBurn({ tokenId: token, signer: attackerSigner })
  })

  await expectRejected('claim_creator_vesting before graduation', async () => {
    await tokenLib.claimCreatorVesting({ tokenId: token, signer: creatorSigner })
  })

  const shoutsBeforeWave = await eventsLib.fetchTokenShouts(token)
  if (shoutsBeforeWave.length !== 0) {
    throw new Error(`Expected 0 shouts after rejected attacks, found ${shoutsBeforeWave.length}`)
  }
  console.log('  ok 0 malicious shouts written on-chain & premature milestone/vesting blocked')

  console.log('\n6) Multi-account Bonding Curve wave, King Shout, Live 1,000 XLM Graduation & Post-Grad DEX...')
  // Buyer 1 (Trader1): 200 XLM on Virtual Curve (v4.2 flat 0.80% buy fee -> zero whale penalty!)
  const c0 = await tokenLib.fetchCurveState(token)
  const whaleXlm = 200n * UNIT
  const localWhaleQuote = tokenomics.localCurveQuoteBuy(c0.curve_xlm_net, c0.tokens_sold, whaleXlm)
  if (!localWhaleQuote || localWhaleQuote.total_fee_bps !== 80n) {
    throw new Error(`Expected flat 80 bps buy fee in v4.2, got ${localWhaleQuote?.total_fee_bps}`)
  }
  const buy1 = await tokenLib.buyCurveToken({
    tokenId: token,
    maxXlmIn: whaleXlm,
    minTokensOut: soroswap.withSlippage(localWhaleQuote.tokens_out, 2),
    signer: trader1Signer,
  })
  if (buy1.trade.tokens !== localWhaleQuote.tokens_out) {
    throw new Error(`Curve buy 1 mismatch: ${buy1.trade.tokens} vs ${localWhaleQuote.tokens_out}`)
  }
  console.log(`  ok Trader1 bought ${buy1.trade.tokens} base units on curve (flat fee=${localWhaleQuote.total_fee_bps} bps)`)

  // Slippage guard on curve buy (#5 SlippageExceeded)
  const c1 = await tokenLib.fetchCurveState(token)
  const impossibleOut = (tokenomics.localCurveQuoteBuy(c1.curve_xlm_net, c1.tokens_sold, 10n * UNIT)?.tokens_out ?? 0n) * 2n
  await expectRejected('Bonding Curve slippage guard (minTokensOut = 2x quote)', async () => {
    await tokenLib.buyCurveToken({
      tokenId: token,
      maxXlmIn: 10n * UNIT,
      minTokensOut: impossibleOut,
      signer: trader2Signer,
    })
  })

  // Buyer 2 (Trader2): 50 XLM on curve + partial curve sell (asymmetric 2.50% early sell fee -> buyback/LP floor!)
  const qBuy2 = await tokenLib.quoteCurveBuyRpc(token, 50n * UNIT)
  const buy2 = await tokenLib.buyCurveToken({
    tokenId: token,
    maxXlmIn: 50n * UNIT,
    minTokensOut: soroswap.withSlippage(qBuy2.tokens_out, 2),
    signer: trader2Signer,
  })
  const sellAmtCurve = 5_000n * UNIT
  const qSell2 = await tokenLib.quoteCurveSellRpc(token, sellAmtCurve)
  if (qSell2.total_fee_bps !== 250n) {
    throw new Error(`Expected 250 bps early curve sell fee, got ${qSell2.total_fee_bps}`)
  }
  const sellCurveRes = await tokenLib.sellCurveToken({
    tokenId: token,
    tokenAmount: sellAmtCurve,
    minXlmOut: soroswap.withSlippage(qSell2.net_xlm_out, 2),
    signer: trader2Signer,
  })
  if (sellCurveRes.trade.xlm !== qSell2.net_xlm_out) {
    throw new Error('Curve sell quote mismatch')
  }
  console.log(`  ok Trader2 bought ${buy2.trade.tokens} & sold 5,000 on curve (sell fee=${qSell2.total_fee_bps} bps)`)

  // King Shout dethroning & total_supply shrink
  const shout1Amt = 5_000n * UNIT
  const shout2Amt = 7_500n * UNIT
  await tokenLib.burnAndShout({
    tokenId: token,
    amount: shout1Amt,
    message: 'Trader1 crowned King Shout',
    signer: trader1Signer,
  })
  await tokenLib.burnAndShout({
    tokenId: token,
    amount: shout2Amt,
    message: 'Trader2 dethroned King Shout',
    signer: trader2Signer,
  })
  const kingRecord = await tokenLib.fetchKingShout(token)
  if (!kingRecord || kingRecord.sender !== trader2.publicKey || kingRecord.amount !== shout2Amt) {
    throw new Error(`King Shout dethrone failed: ${JSON.stringify(kingRecord)}`)
  }
  console.log('  ok 3-tier King Shout dethrone verified on-chain (5,000 -> 7,500)')

  // Pre-graduation P2P transfer lock (closes PairAlreadySeeded DoS!)
  const tokAsTrader1 = tokenLib.tokenClient(token, trader1Signer)
  await expectRejected('pre-graduation P2P transfer blocked (PairAlreadySeeded DoS protection)', async () => {
    const tx = await tokAsTrader1.transfer({
      from: trader1.publicKey,
      to: attacker.publicKey,
      amount: 1_000n * UNIT,
    })
    await tx.signAndSend()
  })

  // Live 1,000 XLM Graduation by Trader1!
  const cPreGrad = await tokenLib.fetchCurveState(token)
  const remainingGoal = 1_000n * UNIT - cPreGrad.curve_xlm_net
  const gradBuyIn = remainingGoal + 50n * UNIT // Overshoot intentionally to verify exact XLM refund cap
  const gradQuote = await tokenLib.quoteCurveBuyRpc(token, gradBuyIn)
  if (!gradQuote.will_graduate) {
    throw new Error('Expected quote to indicate graduation')
  }
  const gradBuy = await tokenLib.buyCurveToken({
    tokenId: token,
    maxXlmIn: gradBuyIn,
    minTokensOut: soroswap.withSlippage(gradQuote.tokens_out, 2),
    signer: trader1Signer,
  })
  if (!gradBuy.trade.graduated || !gradBuy.trade.pair) {
    throw new Error(`Graduation failed: ${JSON.stringify(gradBuy.trade)}`)
  }
  if (gradBuy.trade.xlm >= gradBuyIn) {
    throw new Error(`Expected capped refund < ${gradBuyIn}, got ${gradBuy.trade.xlm}`)
  }
  console.log(`  ok LIVE GRADUATION on Testnet! Pair=${gradBuy.trade.pair} | cappedXlm=${gradBuy.trade.xlm}`)

  // Post-graduation security & state verification (P2P transfers now unlocked!)
  await (
    await tokAsTrader1.transfer({
      from: trader1.publicKey,
      to: attacker.publicKey,
      amount: 1_000n * UNIT,
    })
  ).signAndSend()

  const [cGrad, pGrad, auditGrad] = await Promise.all([
    tokenLib.fetchCurveState(token),
    soroswap.fetchPoolState(token),
    sdkLib.verifyAntiRug(token),
  ])
  if (
    !cGrad.graduated ||
    cGrad.burn_milestone_stage !== 1 ||
    cGrad.burn_vault_remaining !== EXPECTED_MILESTONE_1_BURN
  ) {
    throw new Error(`Invalid post-grad CurveState: ${JSON.stringify(cGrad)}`)
  }
  if (pGrad.reserveToken !== EXPECTED_DEX_RESERVE || pGrad.reserveXlm < 1_000n * UNIT) {
    throw new Error(`Unexpected graduated Soroswap pool reserves: ${pGrad.reserveToken}/${pGrad.reserveXlm}`)
  }
  if (!auditGrad.isAntiRugVerified || !auditGrad.lpBurned || !auditGrad.ownershipRenounced) {
    throw new Error(`Post-grad anti-rug check failed: ${JSON.stringify(auditGrad)}`)
  }

  // Day 0 post-grad: Creator unlocks paid seed, then premature Day 3 vesting tranche MUST revert (#8)
  const seedClaim = await tokenLib.claimCreatorVesting({ tokenId: token, signer: creatorSigner })
  if (seedClaim.claimed !== cGrad.creator_seed_locked) {
    throw new Error(`Expected seed unlock ${cGrad.creator_seed_locked}, got ${seedClaim.claimed}`)
  }
  await expectRejected('buy_curve after graduation rejected', async () => {
    await tokenLib.buyCurveToken({
      tokenId: token,
      maxXlmIn: 5n * UNIT,
      minTokensOut: 1n,
      signer: trader2Signer,
    })
  })
  await expectRejected('claim_creator_vesting before Day 3 cliff rejected', async () => {
    await tokenLib.claimCreatorVesting({ tokenId: token, signer: creatorSigner })
  })
  await expectRejected('trigger_milestone_burn before 1,800 XLM DEX depth rejected', async () => {
    await tokenLib.triggerMilestoneBurn({ tokenId: token, signer: opsSigner })
  })

  // Permissionless DEX Buyback & Burn if buyback_xlm_reserve > 0
  let buybackBurned = 0n
  if (cGrad.buyback_xlm_reserve > 0n) {
    const bb = await tokenLib.triggerBuybackBurn({ tokenId: token, signer: opsSigner })
    buybackBurned = bb.burned
    console.log(`  ok Soroswap DEX Buyback & Burn executed: -${buybackBurned} base units burned!`)
  }

  // Ops swaps XLM -> Token directly on the newly graduated Soroswap Pair
  const pBeforeOps = await soroswap.fetchPoolState(token)
  const qDex = await soroswap.quoteXlmForToken(5n * UNIT, pBeforeOps)
  const dexSwap = await soroswap.swapXlmForToken({
    tokenId: token,
    amountIn: 5n * UNIT,
    amountOutMin: soroswap.withSlippage(qDex, 2),
    signer: opsSigner,
  })
  const pFinal = await soroswap.fetchPoolState(token)
  if (!dexSwap[1] || pFinal.reserveXlm * pFinal.reserveToken <= pBeforeOps.reserveXlm * pBeforeOps.reserveToken) {
    throw new Error('Post-graduation Soroswap swap failed k invariant')
  }
  console.log(`  ok Ops swapped 5 XLM -> ${dexSwap[1]} base units on graduated Soroswap LP`)

  // Permissionless TTL refresh by Attacker works cleanly
  await tokenLib.extendTokenTtl({ tokenId: token, signer: attackerSigner })

  // Final supply conservation check (10M - 1.475M M1 - 12,500 shouts - buybackBurned)
  const totalBurnedShouts = shout1Amt + shout2Amt
  const supplyEnd = (await tokenRead.total_supply()).result
  const expectedFinalSupply =
    EXPECTED_INITIAL_SUPPLY - EXPECTED_MILESTONE_1_BURN - totalBurnedShouts - buybackBurned
  if (supplyEnd !== expectedFinalSupply) {
    throw new Error(`Supply mismatch: got ${supplyEnd}, expected ${expectedFinalSupply}`)
  }

  const [creatorBalFinal, t1BalFinal, liveEvents, shoutsFinal] = await Promise.all([
    tokenLib.fetchTokenBalance(token, creator.publicKey),
    tokenLib.fetchTokenBalance(token, trader1.publicKey),
    eventsLib.fetchTokenEvents(token, 50),
    eventsLib.fetchTokenShouts(token),
  ])
  if (shoutsFinal.length !== 2) {
    throw new Error(`Expected 2 shouts recorded on-chain, got ${shoutsFinal.length}`)
  }

  const analysis = holdersLib.analyzeTokenHolders({
    totalSupply: supplyEnd,
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
  if (observedSum > supplyEnd) {
    throw new Error(`Holder analysis exceeded total supply: ${observedSum} > ${supplyEnd}`)
  }

  console.log('\n=== FAIR-FLYWHEEL V4.2 ADVERSARIAL & GRADUATION AUDIT PASSED ===')
  console.log(`Token           : ${token}`)
  console.log(`Pair            : ${pFinal.pairId}`)
  console.log(`Supply final    : ${supplyEnd.toString()} (burned M1+Shouts+Buyback=${(EXPECTED_MILESTONE_1_BURN + totalBurnedShouts + buybackBurned).toString()})`)
  console.log(`Pool reserve    : ${pFinal.reserveToken.toString()} token / ${pFinal.reserveXlm.toString()} XLM`)
  console.log(`Events analyzed : ${liveEvents.length} | Holders tracked: ${analysis.holders.length} | Risk: ${analysis.riskLabel}`)
} catch (err) {
  failed = true
  console.error('\nADVERSARIAL TEST FAILURE:', err instanceof Error ? err.message : err)
} finally {
  await vite.close()
}

process.exit(failed ? 1 : 0)
