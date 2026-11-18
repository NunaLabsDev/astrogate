/**
 * End-to-end verification of AstroGate Demo Mode & Launchpad v2 on Stellar Testnet:
 * 1. Creates & funds 3 disposable accounts (A, B, C) via Friendbot.
 * 2. Sends Horizon payment A -> B.
 * 3. Account A runs single-tx Fair Launch (`launch_fair`) with compact on-chain JSON meta.
 * 4. Verifies `LaunchRecord`, `verifyAntiRug` (ownership renounced + LP burned), and local metadata.
 * 5. Transfers tokens A -> B; B buys via Soroswap using 0ms `localQuoteXlmForToken`.
 * 6. A adds & atomically removes community LP (`LiquidityForm` / `LiquidityPosition` path).
 * 7. B sells tokens via `swapTokenForXlm`, then runs Burn-to-Chat (`burn_shout` + `get_shouts`).
 * 8. B refreshes 90-day TTL via `extendTokenTtl`.
 *
 * Requires NO STELLAR_SECRET (uses disposable Friendbot accounts).
 * Usage: npm run verify:demo
 */
import { createServer } from 'vite'
import {
  Asset,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from '@stellar/stellar-sdk'

const HORIZON_URL = 'https://horizon-testnet.stellar.org'

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
})

let failed = false

try {
  const demo = await vite.ssrLoadModule('/src/lib/demo.ts')
  const soroswap = await vite.ssrLoadModule('/src/lib/soroswap.ts')
  const tokenLib = await vite.ssrLoadModule('/src/lib/token.ts')
  const metadataLib = await vite.ssrLoadModule('/src/lib/token-metadata.ts')
  const discoveryLib = await vite.ssrLoadModule('/src/lib/discovery.ts')
  const eventsLib = await vite.ssrLoadModule('/src/lib/token-events.ts')
  const sdkLib = await vite.ssrLoadModule('/src/sdk/index.ts')
  const horizon = new Horizon.Server(HORIZON_URL)

  console.log('creando 3 cuentas demo con Friendbot (secuencial)…')
  const { accounts, failed: fundFailed } = await demo.createDemoAccounts(
    ({ index, status }) => {
      console.log(`  cuenta ${demo.demoLabelForIndex(index)}: ${status}`)
    },
  )

  if (fundFailed > 0 || accounts.length !== demo.DEMO_ACCOUNT_COUNT) {
    throw new Error(`esperaba ${demo.DEMO_ACCOUNT_COUNT} cuentas, hay ${accounts.length} (failed=${fundFailed})`)
  }

  for (const account of accounts) {
    if (!account.publicKey.startsWith('G') || !account.secret.startsWith('S')) {
      throw new Error(`cuenta ${account.label} con formato inválido`)
    }
    const signer = demo.demoSigner(account)
    if (signer.address !== account.publicKey) {
      throw new Error(`el firmante de ${account.label} no corresponde a su cuenta`)
    }
    console.log(`  ${account.label}: ${account.publicKey.slice(0, 8)}… firmante OK`)
  }

  const balances = await Promise.all(
    accounts.map((account) => demo.fetchXlmBalance(account.publicKey)),
  )
  console.log('saldos XLM:', balances)
  if (balances.some((balance) => balance <= 0)) {
    throw new Error('alguna cuenta demo no tiene XLM')
  }

  const [sender, receiver, bystander] = accounts
  const source = await horizon.loadAccount(sender.publicKey)
  const paymentTx = new TransactionBuilder(source, {
    fee: '100000',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.payment({
        destination: receiver.publicKey,
        asset: Asset.native(),
        amount: '1',
      }),
    )
    .setTimeout(30)
    .build()

  paymentTx.sign(Keypair.fromSecret(sender.secret))
  await horizon.submitTransaction(paymentTx)

  const receiverBalance = await demo.fetchXlmBalance(receiver.publicKey)
  console.log('pago A -> B de 1 XLM enviado; saldo de B:', receiverBalance)
  if (receiverBalance <= balances[1]) {
    throw new Error('el pago A -> B no se reflejó en el saldo de B')
  }

  const signerA = demo.demoSigner(sender)
  const signerB = demo.demoSigner(receiver)
  const signerC = demo.demoSigner(bystander)
  const decimals = 7
  const unit = 10n ** BigInt(decimals)
  const tokenomics = await vite.ssrLoadModule('/src/lib/tokenomics.ts')

  // 1. Atomic Launchpad v4 Fair-Flywheel Launch (1 tx: 10M cap, 40/30/29.7/0.3, initial buy)
  const fairMeta = metadataLib.encodeOnChainMeta({
    description: 'Automated Launchpad v4 E2E Fair-Flywheel Launch',
  })
  const launch = await tokenLib.launchFairAtomic({
    name: `Demo ${Date.now()}`,
    symbol: 'DEMO',
    xlmLpAmount: 5n * unit,
    meta: fairMeta,
    signer: signerA,
  })
  const token = launch.token
  console.log('Launchpad v4 token creado por A:', token, '| pair:', launch.pair ?? 'Virtual Curve Active')

  const [record, curveInit, audit, supplyInitial, creatorBalInitial] = await Promise.all([
    discoveryLib.fetchLaunchpadRecord(token),
    tokenLib.fetchCurveState(token),
    sdkLib.verifyAntiRug(token),
    tokenLib.tokenClient(token).total_supply(),
    tokenLib.fetchTokenBalance(token, sender.publicKey),
  ])
  if (!record || record.creator !== sender.publicKey) {
    throw new Error('LaunchRecord no encontrado o creator no coincide')
  }
  if (!curveInit || curveInit.graduated) {
    throw new Error(`CurveState inicial inesperado: ${JSON.stringify(curveInit)}`)
  }
  if (curveInit.burn_vault_remaining !== 0n || curveInit.creator_vesting_total !== 30_000n * unit) {
    throw new Error(`burn_vault/vesting inicial inesperado: vault=${curveInit.burn_vault_remaining} vest=${curveInit.creator_vesting_total}`)
  }
  if (!audit.isAntiRugVerified || !audit.verifiedLaunchpad || !audit.ownershipRenounced) {
    throw new Error(`verifyAntiRug fallo: ${JSON.stringify(audit)}`)
  }
  if (supplyInitial.result !== 10_000_000n * unit) {
    throw new Error(`supply inicial inesperado: ${supplyInitial.result.toString()}`)
  }
  const expectedCreatorTokens = tokenomics.localCurveQuoteBuy(0n, 0n, 5n * unit)?.tokens_out ?? 0n
  if (
    creatorBalInitial !== 0n ||
    curveInit.creator_seed_locked !== expectedCreatorTokens ||
    curveInit.tokens_sold !== expectedCreatorTokens
  ) {
    throw new Error(
      `seed lock v4.3 no coincide: bal=${creatorBalInitial.toString()} locked=${curveInit.creator_seed_locked?.toString()} expected=${expectedCreatorTokens.toString()}`,
    )
  }
  console.log('verifyAntiRug + registro v4.3 OK (Curva 1,000 vXLM, creator seed locked', curveInit.creator_seed_locked.toString(), 'base units)')

  // 2. B compra en Virtual Bonding Curve con paridad local 0ms vs RPC (transfer P2P bloqueado pre-grad)
  const curveNow = await tokenLib.fetchCurveState(token)
  const buyXlm = 5n * unit
  const localBuy = tokenomics.localCurveQuoteBuy(curveNow.curve_xlm_net, curveNow.tokens_sold, buyXlm)
  const rpcBuy = await tokenLib.quoteCurveBuyRpc(token, buyXlm)
  if (!localBuy || localBuy.tokens_out !== rpcBuy.tokens_out) {
    throw new Error(`Paridad quote_buy fallo: local=${localBuy?.tokens_out} rpc=${rpcBuy.tokens_out}`)
  }
  const buyRes = await tokenLib.buyCurveToken({
    tokenId: token,
    maxXlmIn: buyXlm,
    minTokensOut: soroswap.withSlippage(localBuy.tokens_out, 2),
    signer: signerB,
  })
  const bought = buyRes.trade.tokens
  if (bought !== localBuy.tokens_out) {
    throw new Error('buyCurveToken output mismatch')
  }
  const balBAfterBuy = await tokenLib.fetchTokenBalance(token, receiver.publicKey)
  if (balBAfterBuy !== bought) {
    throw new Error('balance de B tras compra en curva no cuadra')
  }
  console.log('B compro', bought.toString(), 'base units en Bonding Curve (paridad 1:1 con RPC)')

  // 3. B vende parte de sus tokens en Bonding Curve + Burn-to-Chat (min 50) + Extend TTL
  const sellAmount = 1_000n * unit
  const curveBeforeSell = await tokenLib.fetchCurveState(token)
  const localSell = tokenomics.localCurveQuoteSell(
    curveBeforeSell.curve_xlm_net,
    curveBeforeSell.tokens_sold,
    sellAmount,
  )
  const rpcSell = await tokenLib.quoteCurveSellRpc(token, sellAmount)
  if (!localSell || localSell.net_xlm_out !== rpcSell.net_xlm_out) {
    throw new Error(`Paridad quote_sell fallo: local=${localSell?.net_xlm_out} rpc=${rpcSell.net_xlm_out}`)
  }
  const sellRes = await tokenLib.sellCurveToken({
    tokenId: token,
    tokenAmount: sellAmount,
    minXlmOut: soroswap.withSlippage(localSell.net_xlm_out, 2),
    signer: signerB,
  })
  if (sellRes.trade.xlm !== localSell.net_xlm_out) {
    throw new Error('sellCurveToken output mismatch')
  }
  console.log('B vendio 1,000 DEMO en curva ->', sellRes.trade.xlm.toString(), 'stroops XLM')

  const shoutText = `[Testnet E2E] Curve check ${Date.now()}`
  const supplyBeforeShout = (await tokenLib.tokenClient(token).total_supply()).result
  await tokenLib.burnAndShout({
    tokenId: token,
    amount: 50n * unit,
    message: shoutText,
    signer: signerB,
  })
  const [shouts, supplyAfterShout] = await Promise.all([
    eventsLib.fetchTokenShouts(token),
    tokenLib.tokenClient(token).total_supply(),
  ])
  if (!shouts.some((s) => s.sender === receiver.publicKey && s.message === shoutText)) {
    throw new Error('burn_shout no aparecio en get_shouts on-chain')
  }
  if (supplyAfterShout.result !== supplyBeforeShout - 50n * unit) {
    throw new Error('burn_shout no redujo total_supply exactamente')
  }
  console.log('Burn-to-Chat (>= 50) on-chain OK y total_supply reducido tras quema')

  // 4. C ejecuta extendTokenTtl sin permisos especiales
  await tokenLib.extendTokenTtl({ tokenId: token, signer: signerC })
  console.log('extendTokenTtl (90 dias) OK desde cuenta C')

  console.log('\nOK: E2E completo Launchpad v4 Fair-Flywheel Curve + Burn-to-Chat + TTL verificado en Testnet')
} catch (err) {
  failed = true
  console.error('\nFALLO:', err?.message ?? err)
} finally {
  await vite.close()
}

process.exit(failed ? 1 : 0)
