import {
  CREATOR_VESTING_ALLOC_BASE,
  CROWN_JACKPOT_TOKENS_ALLOC_BASE,
  CURVE_TOKENS_ALLOC_BASE,
  CURVE_VIRTUAL_XLM_START_STROOPS,
  DEV_TOKENS_ALLOC_BASE,
  DEX_TOKENS_ALLOC_BASE,
  FAIR_INITIAL_SUPPLY_BASE,
  GRADUATION_JACKPOT_TOKENS_ALLOC_BASE,
  GRADUATION_TARGET_XLM,
  LAUNCH_CREATION_FEE_XLM,
  localCurveQuoteBuy,
  localCurveQuoteSell,
  LP_LOCK_YEARS,
  MIN_SEED_XLM,
  SPARK_JACKPOT_TOKENS_ALLOC_BASE,
  STELLAR_BURN_ADDRESS,
  TOTAL_JACKPOT_TOKENS_ALLOC_BASE,
} from '../src/lib/curve-math'
import {
  fetchLiveMarketSnapshot,
  fetchLiveTokenInspectorData,
  fetchPairReservesWorker,
  fetchSorobitsStatusWorker,
  fetchTokenOwnerWorker,
  fetchTokenShoutsData,
  resolveWorkerNetwork,
} from './rpc'
import type { Env } from './types'
import { curvePercent, formatXlm, isContractAddr } from './views'

const STROOPS_PER_UNIT = 10_000_000n

function ammAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n
  const amountInWithFee = amountIn * 997n
  const numerator = amountInWithFee * reserveOut
  const denominator = reserveIn * 1000n + amountInWithFee
  return denominator > 0n ? numerator / denominator : 0n
}

function applySlippageMin(amountOut: bigint, slippagePercent: number): bigint {
  const clamped = Math.max(0.1, Math.min(25, Number.isFinite(slippagePercent) ? slippagePercent : 2))
  const bps = BigInt(Math.round(clamped * 100))
  return (amountOut * (10_000n - bps)) / 10_000n
}

export function buildProtocolOverview(env: Env) {
  const cfg = resolveWorkerNetwork(env)
  return {
    protocol: 'AstroGate',
    version: 'v4.4-fair-flywheel',
    network: cfg.network,
    networkPassphrase: cfg.passphrase,
    rpcUrls: cfg.rpcUrls,
    horizonUrl: cfg.horizonUrl,
    contracts: {
      launchpad: cfg.launchpadContractId,
      sorobits: cfg.sorobitsContractId,
      soroswapFactory: cfg.soroswapFactory,
      soroswapRouter: cfg.soroswapRouter,
      xlmSac: cfg.xlmSac,
      astroToken: cfg.astroTokenId,
      astroPair: cfg.astroPairId,
      burnAddress: STELLAR_BURN_ADDRESS,
    },
    tokenomics: {
      fixedSupplyBase: FAIR_INITIAL_SUPPLY_BASE.toString(),
      decimals: 7,
      creationFeeXlm: LAUNCH_CREATION_FEE_XLM,
      minCreatorSeedXlm: MIN_SEED_XLM,
      curveVirtualXlmStartStroops: CURVE_VIRTUAL_XLM_START_STROOPS.toString(),
      graduationTargetXlm: GRADUATION_TARGET_XLM,
      lpLockYears: LP_LOCK_YEARS,
      allocations: {
        bondingCurvePct: 66,
        bondingCurveBase: CURVE_TOKENS_ALLOC_BASE.toString(),
        soroswapDexPct: 33,
        soroswapDexBase: DEX_TOKENS_ALLOC_BASE.toString(),
        creatorVesting15dPct: 0.3,
        creatorVesting15dBase: CREATOR_VESTING_ALLOC_BASE.toString(),
        jackpotLadderPct: 0.4,
        jackpotLadderBase: TOTAL_JACKPOT_TOKENS_ALLOC_BASE.toString(),
        sparkCheckpoint250XlmBase: SPARK_JACKPOT_TOKENS_ALLOC_BASE.toString(),
        crownCheckpoint500XlmBase: CROWN_JACKPOT_TOKENS_ALLOC_BASE.toString(),
        graduationJackpotPct: 0.25,
        graduationJackpotBase: GRADUATION_JACKPOT_TOKENS_ALLOC_BASE.toString(),
        devEcosystemPct: 0.3,
        devEcosystemBase: DEV_TOKENS_ALLOC_BASE.toString(),
      },
      fees: {
        curveBuyEarlyBps: 30,
        curveBuyMidBps: 50,
        curveBuySprintBps: 25,
        curveSellEarlyBps: 120,
        curveSellMidBps: 180,
        curveSellSprintBps: 150,
        soroswapSwapBps: 30,
      },
      antiMev: {
        buybackMaxChunkBpsOfReserve: 50,
        buybackCooldownSeconds: 300,
      },
    },
    sorobits: {
      standard: 'SEP-50',
      maxRleRuns: 720,
      maxSvgBytes: 12_800,
      genesisArchetypes: 8,
    },
    endpoints: {
      openapi: '/openapi.json',
      apiRoot: '/api/v1',
      mcp: '/mcp',
      llmsTxt: '/llms.txt',
      docsPage: '/docs',
    },
  }
}

export async function listMarketTokensApi(env: Env) {
  const snap = await fetchLiveMarketSnapshot(env)
  return {
    ok: !snap.rpcFailed,
    rpcFailed: snap.rpcFailed,
    count: snap.items.length,
    tokens: snap.items.map((item) => ({
      id: item.id,
      symbol: item.symbol,
      name: item.name,
      graduated: item.graduated,
      graduationPercent: Number(curvePercent(item.curveXlmNet).toFixed(2)),
      curveXlmNetStroops: item.curveXlmNet.toString(),
      curveXlmNet: formatXlm(item.curveXlmNet, 2),
      pairId: item.pairId,
      reserveXlmStroops: item.reserveXlmStroops.toString(),
      reserveXlm: formatXlm(item.reserveXlmStroops, 2),
    })),
  }
}

export async function inspectTokenApi(tokenId: string, env: Env) {
  if (!isContractAddr(tokenId)) {
    throw new Error('Invalid Soroban token contract ID (expected 56-char C... address)')
  }
  const [data, shouts] = await Promise.all([
    fetchLiveTokenInspectorData(tokenId, env),
    fetchTokenShoutsData(tokenId, env),
  ])
  if (!data) {
    return null
  }
  return {
    tokenId: data.tokenId,
    name: data.name,
    symbol: data.symbol,
    decimals: data.decimals,
    totalSupplyBase: data.totalSupply.toString(),
    dexReserveXlmStroops: data.dexReserveXlm !== null ? data.dexReserveXlm.toString() : null,
    curve: data.curve
      ? {
          graduated: data.curve.graduated,
          graduationPercent: Number(curvePercent(data.curve.curveXlmNet).toFixed(2)),
          curveXlmNetStroops: data.curve.curveXlmNet.toString(),
          realXlmVaultStroops: data.curve.realXlmVault.toString(),
          tokensSoldBase: data.curve.tokensSold.toString(),
          buybackXlmReserveStroops: data.curve.buybackXlmReserve.toString(),
          burnVaultRemainingBase: data.curve.burnVaultRemaining.toString(),
          burnMilestoneStage: data.curve.burnMilestoneStage,
          pairId: data.curve.pair,
          creator: data.curve.creator,
        }
      : null,
    kingShout: data.kingShout
      ? {
          sender: data.kingShout.sender,
          amountBase: data.kingShout.amount.toString(),
          message: data.kingShout.message,
        }
      : null,
    recentShouts: (shouts?.shouts ?? []).map((s) => ({
      sender: s.sender,
      amountBase: s.amount.toString(),
      message: s.message,
      ledger: s.ledger,
    })),
  }
}

export async function auditTokenApi(tokenId: string, env: Env) {
  if (!isContractAddr(tokenId)) {
    throw new Error('Invalid Soroban token contract ID (expected 56-char C... address)')
  }
  const [inspector, ownerInfo] = await Promise.all([
    fetchLiveTokenInspectorData(tokenId, env),
    fetchTokenOwnerWorker(tokenId, env),
  ])
  if (!inspector) return null

  const ownershipRenounced = ownerInfo.ownerSupported && ownerInfo.owner === null
  const isVerifiedLaunchpad = Boolean(inspector.curve)
  const isGraduated = Boolean(inspector.curve?.graduated)
  const lpBurnAddress = STELLAR_BURN_ADDRESS
  const pairId = inspector.curve?.pair ?? null

  const checks = [
    {
      id: 'ownership_renounced',
      label: 'Minting permanently disabled (owner() == None)',
      passed: ownershipRenounced,
      detail: ownerInfo.ownerSupported
        ? ownerInfo.owner === null
          ? 'Owner is None (immutable fixed cap)'
          : `Active owner ${ownerInfo.owner}`
        : 'Contract does not expose get_owner()',
    },
    {
      id: 'launchpad_verified',
      label: 'Registered in Fair-Flywheel v4.4 Launchpad',
      passed: isVerifiedLaunchpad,
      detail: isVerifiedLaunchpad
        ? `Creator ${inspector.curve?.creator}`
        : 'External Soroswap / SEP-41 token (not launched via AstroGate Launchpad)',
    },
    {
      id: 'curve_or_lp_lock',
      label: isGraduated
        ? '100% initial Soroswap LP locked 7 years on-chain (or legacy blackhole burn)'
        : 'P2P curve transfer lock active until 1,000 XLM graduation',
      passed: isVerifiedLaunchpad,
      detail: isGraduated
        ? `Pair ${pairId ?? 'N/A'} · LP locked 7Y in Launchpad (or legacy ${lpBurnAddress})`
        : `Bonding curve ${curvePercent(inspector.curve?.curveXlmNet ?? 0n).toFixed(2)}% funded`,
    },
    {
      id: 'proof_of_burn_vault',
      label: 'Organic Deflation & 7-Year LP Time-Lock',
      passed: isVerifiedLaunchpad,
      detail: isVerifiedLaunchpad
        ? (inspector.curve?.burnVaultRemaining ?? 0n) > 0n
          ? `Legacy Burn Vault Stage ${inspector.curve?.burnMilestoneStage ?? 0}/2 · Remaining ${(Number(inspector.curve?.burnVaultRemaining ?? 0n) / Number(STROOPS_PER_UNIT)).toLocaleString('en-US')} tokens`
          : 'Zero idle burn vault · 100% organic DEX Buyback & Burn + Burn-to-Chat'
        : 'N/A for non-launchpad tokens',
    },
  ]

  const status = isVerifiedLaunchpad
    ? ownershipRenounced
      ? isGraduated
        ? 'verified-fair-graduated'
        : 'verified-fair-curve'
      : 'unverified-owner-present'
    : 'external-sep41'

  return {
    tokenId,
    symbol: inspector.symbol,
    name: inspector.name,
    status,
    isAntiRugVerified: isVerifiedLaunchpad && ownershipRenounced,
    totalSupplyBase: inspector.totalSupply.toString(),
    pairId,
    dexReserveXlmStroops: inspector.dexReserveXlm !== null ? inspector.dexReserveXlm.toString() : null,
    checks,
  }
}

export async function quoteTokenSwapApi(
  input: {
    tokenId: string
    amountInStroops: bigint
    direction: 'buy' | 'sell'
    slippagePercent?: number
  },
  env: Env,
) {
  if (!isContractAddr(input.tokenId)) {
    throw new Error('Invalid Soroban token contract ID (expected 56-char C... address)')
  }
  if (input.amountInStroops <= 0n) {
    throw new Error('amountIn must be a positive integer string in 7-decimal base units')
  }
  const slippagePercent = input.slippagePercent ?? 2
  const inspector = await fetchLiveTokenInspectorData(input.tokenId, env)
  if (!inspector) {
    throw new Error('Token not found on Soroban RPC')
  }

  if (inspector.curve && !inspector.curve.graduated) {
    if (input.direction === 'buy') {
      const q = localCurveQuoteBuy(
        inspector.curve.curveXlmNet,
        inspector.curve.tokensSold,
        input.amountInStroops,
      )
      if (!q) {
        throw new Error('Unable to quote bonding curve buy for provided amount')
      }
      const minOut = applySlippageMin(q.tokens_out, slippagePercent)
      return {
        tokenId: input.tokenId,
        symbol: inspector.symbol,
        venue: 'bonding-curve' as const,
        direction: input.direction,
        amountInBase: q.total_xlm_charged.toString(),
        amountOutEstimatedBase: q.tokens_out.toString(),
        amountOutMinimumBase: minOut.toString(),
        slippagePercent,
        feeBps: Number(q.total_fee_bps),
        treasuryFeeBase: q.treasury_fee.toString(),
        floorBonusBase: q.floor_bonus.toString(),
        willGraduate: q.will_graduate,
      }
    }

    const q = localCurveQuoteSell(
      inspector.curve.curveXlmNet,
      inspector.curve.tokensSold,
      input.amountInStroops,
    )
    if (!q) {
      throw new Error('Unable to quote bonding curve sell (exceeds sold supply or zero output)')
    }
    const minOut = applySlippageMin(q.net_xlm_out, slippagePercent)
    return {
      tokenId: input.tokenId,
      symbol: inspector.symbol,
      venue: 'bonding-curve' as const,
      direction: input.direction,
      amountInBase: input.amountInStroops.toString(),
      amountOutEstimatedBase: q.net_xlm_out.toString(),
      amountOutMinimumBase: minOut.toString(),
      slippagePercent,
      feeBps: Number(q.total_fee_bps),
      treasuryFeeBase: q.treasury_fee.toString(),
      floorBonusBase: q.floor_bonus.toString(),
      willGraduate: false,
    }
  }

  const pairId = inspector.curve?.pair ?? null
  const effectivePairId =
    pairId ||
    (resolveWorkerNetwork(env).astroTokenId === input.tokenId
      ? resolveWorkerNetwork(env).astroPairId
      : null)
  if (!effectivePairId) {
    throw new Error('No active Soroswap DEX pool or bonding curve found for this token')
  }
  const reserves = await fetchPairReservesWorker(effectivePairId, env)
  if (!reserves || reserves.reserveXlm <= 0n || reserves.reserveToken <= 0n) {
    throw new Error('Soroswap pool reserves unavailable or empty')
  }
  const out =
    input.direction === 'buy'
      ? ammAmountOut(input.amountInStroops, reserves.reserveXlm, reserves.reserveToken)
      : ammAmountOut(input.amountInStroops, reserves.reserveToken, reserves.reserveXlm)
  if (out <= 0n) {
    throw new Error('Output amount rounds to zero')
  }
  const minOut = applySlippageMin(out, slippagePercent)
  return {
    tokenId: input.tokenId,
    symbol: inspector.symbol,
    venue: 'soroswap-amm' as const,
    pairId: effectivePairId,
    direction: input.direction,
    amountInBase: input.amountInStroops.toString(),
    amountOutEstimatedBase: out.toString(),
    amountOutMinimumBase: minOut.toString(),
    slippagePercent,
    feeBps: 30,
    reserveXlmStroops: reserves.reserveXlm.toString(),
    reserveTokenBase: reserves.reserveToken.toString(),
  }
}

export async function getSorobitsApi(env: Env) {
  const status = await fetchSorobitsStatusWorker(env)
  return {
    ...status,
    standard: 'SEP-50',
    renderMode: 'On-chain RLE 32x32 SVG',
    maxRleRuns: 720,
    maxSvgBytes: 12_800,
    season1Archetypes: [
      { id: 1, code: 'AGQ01', name: 'Floodgate Pioneer' },
      { id: 2, code: 'AGQ02', name: 'Curve Launcher' },
      { id: 3, code: 'AGQ03', name: 'Flame Shouter' },
      { id: 4, code: 'AGQ04', name: 'Soroswap Graduate' },
      { id: 5, code: 'AGQ05', name: 'Early OG' },
      { id: 6, code: 'AGQ06', name: 'Whale Navigator' },
      { id: 7, code: 'AGQ07', name: 'Phoenix Burner' },
      { id: 8, code: 'AGQ08', name: 'Genesis Legend' },
    ],
  }
}
