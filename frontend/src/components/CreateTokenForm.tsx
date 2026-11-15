import { useState } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { launchFairAtomic } from '../lib/token'
import { setCachedTokenMetadata } from '../lib/discovery'
import { putStoredTokens } from '../lib/indexed-db'
import {
  cachePairId,
  formatTokenPrice,
  formatUsdPrice,
} from '../lib/soroswap'
import {
  allocationOfBps,
  costToBuyPoolShareXlm,
  CREATOR_ALLOCATION_BPS,
  DEFAULT_OPTIMIZED_SEED_XLM,
  FAIR_LAUNCH_DECIMALS,
  FAIR_LAUNCH_TOTAL_BASIS,
  POOL_ALLOCATION_BPS,
  SEED_LIQUIDITY_PRESETS,
  STELLAR_BURN_ADDRESS,
} from '../lib/tokenomics'
import { DEFAULT_XLM_USD_PRICE, XLM_DECIMALS, XLM_FEE_BUFFER, xlmToStroops } from '../lib/xlm'
import { useXlmUsdPrice } from '../hooks/useXlmUsdPrice'
import { useXlmBalance } from '../hooks/useXlmBalance'
import { explorerContractUrl, explorerTxUrl } from '../lib/explorer'
import { ShareButton } from './ShareButton'
import { notifyTokenLaunch } from '../lib/alerts'
import {
  compressImageFileToWebp,
  isPinataConfigured,
  uploadImageToIpfsIfConfigured,
} from '../lib/image-upload'
import { useWallet } from '../store/wallet'
import { errorMessage, formatAmount, parseAmount, shortAddress } from '../lib/format'
import { toast } from '../lib/toast'
import { recordActivity } from '../store/activity'
import { TxProgress } from './TxProgress'
import { TokenArt } from './TokenArt'
import {
  decodeOnChainMeta,
  encodeOnChainMeta,
  ONCHAIN_META_MAX_BYTES,
  saveLocalTokenMetadata,
} from '../lib/token-metadata'
import {
  clearCheckpoint,
  getCheckpoint,
  saveCheckpoint,
  type LaunchCheckpoint,
} from '../lib/launch-checkpoint'
import {
  FORM_INPUT_CLASS,
  UNSUPPORTED_SIGNER_MESSAGE,
} from '../lib/constants'

const inputClass = FORM_INPUT_CLASS

type LaunchStep = 'launching' | null

type CreatedLaunchSnapshot = {
  id: string
  pair: string
  name: string
  symbol: string
  seedXlm: bigint
  lpMinted: bigint
  logoUrl?: string
  hash?: string
}

function createLaunchSession(): { sessionId: string; now: number } {
  const now = Date.now()
  const suffix = Math.random().toString(36).slice(2, 7)
  return { sessionId: `launch-${now}-${suffix}`, now }
}

function nowTimestampMs(): number {
  return Date.now()
}

/** Honest recovery message if a token launch was interrupted halfway. */
function incompleteMessageFor(cp: LaunchCheckpoint): string {
  return `Previous launch attempt recorded for ${cp.symbol} (${cp.tokenId || 'pending broadcast'}). Check transaction status on Stellar Explorer.`
}

export function CreateTokenForm({
  onCreated,
}: {
  onCreated?: (token: {
    id: string
    decimals: number
    symbol?: string
    name?: string
    creator?: string
  }) => void
}) {
  const { publicKey, getSigner, connect, startDemo, demoPending, pending } = useWallet()
  const queryClient = useQueryClient()
  const { data: xlmUsd = DEFAULT_XLM_USD_PRICE } = useXlmUsdPrice()
  const xlmBalance = useXlmBalance(publicKey)
  const [seedXlmInput, setSeedXlmInput] = useState<string>(
    String(DEFAULT_OPTIMIZED_SEED_XLM),
  )
  // Compute exact integer stroops & readable XLM from user input or presets
  const seedXlmStroops = parseAmount(seedXlmInput, XLM_DECIMALS)
  const seedXlmNumber = Number(seedXlmStroops) / 10 ** XLM_DECIMALS
  const feeBufferXlm = Number(XLM_FEE_BUFFER) / 10 ** XLM_DECIMALS
  const totalRequiredStroops = seedXlmStroops + XLM_FEE_BUFFER

  const poolTokensWhole = allocationOfBps(
    FAIR_LAUNCH_TOTAL_BASIS,
    POOL_ALLOCATION_BPS,
  )
  const creatorTokensWhole = allocationOfBps(
    FAIR_LAUNCH_TOTAL_BASIS,
    CREATOR_ALLOCATION_BPS,
  )
  const spotPriceXlm =
    seedXlmNumber > 0 ? seedXlmNumber / Number(poolTokensWhole) : 0
  const spotPriceUsd = spotPriceXlm * xlmUsd
  const initialMarketCapXlm =
    spotPriceXlm * Number(FAIR_LAUNCH_TOTAL_BASIS)
  const initialMarketCapUsd = initialMarketCapXlm * xlmUsd
  const sniperCost10PctXlm = costToBuyPoolShareXlm(seedXlmStroops, 10)
  const sniperCost10PctUsd = sniperCost10PctXlm * xlmUsd

  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [description, setDescription] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [logoUploading, setLogoUploading] = useState(false)
  const [localLogoDataUrl, setLocalLogoDataUrl] = useState<string | null>(null)
  const [logoUploadHint, setLogoUploadHint] = useState<string | null>(null)
  const [website, setWebsite] = useState('')
  const [telegram, setTelegram] = useState('')
  const [twitter, setTwitter] = useState('')
  const [showDetails, setShowDetails] = useState(false)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<LaunchStep>(null)
  const [error, setError] = useState<string | null>(null)
  const [createdLaunch, setCreatedLaunch] =
    useState<CreatedLaunchSnapshot | null>(null)
  /**
   * Checkpoint de un intento anterior cuya tx se llegó a enviar (hay hash)
   * pero la página se cerró antes de confirmar. Se re-lee al cambiar de wallet
   * (patrón "ajustar estado al cambiar props", sin efectos).
   */
  const [checkpointOwner, setCheckpointOwner] = useState(publicKey)
  const [checkpointNote, setCheckpointNote] = useState<LaunchCheckpoint | null>(
    () => getCheckpoint(publicKey),
  )
  if (checkpointOwner !== publicKey) {
    setCheckpointOwner(publicKey)
    setCheckpointNote(getCheckpoint(publicKey))
  }

  const encodedMeta = encodeOnChainMeta({
    description,
    logoUrl,
    website,
    telegram,
    twitter,
  })
  const encodedMetaBytes = new TextEncoder().encode(encodedMeta).length

  const previewLogoUrl = logoUrl.trim().startsWith('https://')
    ? logoUrl.trim()
    : (localLogoDataUrl ?? undefined)

  async function handleLogoFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setLogoUploading(true)
    setLogoUploadHint(null)
    try {
      const compressed = await compressImageFileToWebp(file)
      setLocalLogoDataUrl(compressed.dataUrl)
      try {
        const ipfsUrl = await uploadImageToIpfsIfConfigured(
          compressed.blob,
          `${symbol.trim().toLowerCase() || 'token'}-logo.webp`,
        )
        if (ipfsUrl) {
          setLogoUrl(ipfsUrl)
          setLogoUploadHint('Compressed 128×128 WebP pinned to IPFS (on-chain ready).')
        } else {
          setLogoUploadHint('Compressed 128×128 WebP preview saved locally.')
        }
      } catch {
        setLogoUploadHint('Compressed 128×128 WebP preview saved locally (IPFS upload skipped).')
      }
    } catch (err) {
      setLogoUploadHint(errorMessage(err))
    } finally {
      setLogoUploading(false)
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setCreatedLaunch(null)
    setCheckpointNote(null)
    if (!publicKey) {
      setError('Please connect your wallet first.')
      return
    }
    const signer = getSigner()
    if (!signer) {
      setError(UNSUPPORTED_SIGNER_MESSAGE)
      return
    }

    const cleanName = name.trim()
    const cleanSymbol = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!cleanName || !cleanSymbol) {
      setError('Token Name and alphanumeric Symbol (A-Z, 0-9) are required.')
      return
    }

    const encoder = new TextEncoder()
    if (encoder.encode(cleanName).length > 32) {
      setError('Token Name exceeds 32 bytes in UTF-8. Please shorten or remove complex symbols.')
      return
    }
    if (encoder.encode(cleanSymbol).length > 12) {
      setError('Token Symbol exceeds 12 bytes in UTF-8.')
      return
    }

    const targetDecimals = FAIR_LAUNCH_DECIMALS
    const initialSupply = parseAmount(
      String(FAIR_LAUNCH_TOTAL_BASIS),
      targetDecimals,
    ) // 100 Million (fixed on-chain by launch_fair)
    const seedXlm = seedXlmStroops
    if (seedXlm < 10_000_000n) {
      setError('Minimum initial liquidity is 1 XLM.')
      return
    }

    const currentXlmBase =
      xlmBalance.data !== undefined ? xlmToStroops(xlmBalance.data) : undefined
    const requiredStroops = seedXlm + XLM_FEE_BUFFER
    if (currentXlmBase !== undefined && currentXlmBase < requiredStroops) {
      setError(
        `Insufficient XLM balance. You have ${formatAmount(currentXlmBase, XLM_DECIMALS)} XLM, but need at least ${formatAmount(requiredStroops, XLM_DECIMALS)} XLM (${formatAmount(seedXlm, XLM_DECIMALS)} XLM seed + ${feeBufferXlm} XLM fee buffer).`,
      )
      return
    }

    setBusy(true)
    setStep('launching')
    const { sessionId, now } = createLaunchSession()
    saveCheckpoint({
      sessionId,
      tokenId: '',
      name: cleanName,
      symbol: cleanSymbol,
      decimals: targetDecimals,
      initialSupply: initialSupply.toString(),
      seedXlm: seedXlm.toString(),
      publicKey,
      step: 'deploy',
      updatedAt: now,
    })

    let deployHash: string | undefined
    try {
      // 1. Minimalist single-transaction fair launch (`launch_fair` on Soroban)
      const atomicResult = await launchFairAtomic({
        name: cleanName,
        symbol: cleanSymbol,
        xlmLpAmount: seedXlm,
        meta: encodedMeta,
        signer,
        onHash: (value) => {
          deployHash = value
          saveCheckpoint({
            sessionId,
            tokenId: '',
            name: cleanName,
            symbol: cleanSymbol,
            decimals: targetDecimals,
            initialSupply: initialSupply.toString(),
            seedXlm: seedXlm.toString(),
            publicKey,
            step: 'deploy',
            txHash: value,
            updatedAt: nowTimestampMs(),
          })
        },
      })
      const newId = atomicResult.token
      const pairId = atomicResult.pair
      const ticker = cleanSymbol
      const finalHash = atomicResult.hash ?? deployHash

      // 2. Warm pair, SEP-41 metadata, IndexedDB listing, and on-chain social meta caches immediately
      cachePairId(newId, pairId)
      setCachedTokenMetadata(newId, {
        name: cleanName,
        symbol: ticker,
        decimals: targetDecimals,
      })
      const decodedMeta = decodeOnChainMeta(newId, encodedMeta)
      const resolvedLogoUrl = decodedMeta?.logoUrl ?? localLogoDataUrl ?? undefined
      if (decodedMeta || resolvedLogoUrl) {
        saveLocalTokenMetadata({
          tokenId: newId,
          ...(decodedMeta ?? {}),
          logoUrl: resolvedLogoUrl,
        })
      }

      await putStoredTokens([
        {
          id: newId,
          name: cleanName,
          symbol: ticker,
          decimals: targetDecimals,
          pairId,
          reserveToken: (poolTokensWhole * 10n ** BigInt(targetDecimals)).toString(),
          reserveXlm: seedXlm.toString(),
          ledger: Number.MAX_SAFE_INTEGER,
          creator: publicKey,
          meta: encodedMeta || undefined,
          isAntiRugVerified: true,
          updatedAt: nowTimestampMs(),
        },
      ])

      clearCheckpoint(publicKey)
      setCheckpointNote(null)

      onCreated?.({
        id: newId,
        decimals: targetDecimals,
        symbol: ticker,
        name: cleanName,
        creator: publicKey,
      })
      recordActivity({
        kind: 'create',
        tokenId: newId,
        tokenSymbol: ticker,
        amount: formatAmount(initialSupply, targetDecimals),
        secondaryAmount: formatAmount(seedXlm, XLM_DECIMALS),
        secondarySymbol: 'XLM',
        detail: `${formatAmount(atomicResult.lpMinted, 7)} LP burned`,
        account: publicKey,
        hash: finalHash,
      })

      setCreatedLaunch({
        id: newId,
        pair: pairId,
        name: cleanName,
        symbol: ticker,
        seedXlm,
        lpMinted: atomicResult.lpMinted,
        logoUrl: resolvedLogoUrl,
        hash: finalHash,
      })
      toast.success('Token & Pool Created Successfully!', {
        message: `$${ticker} is live with Soroswap AMM pool, LP burned, and ownership renounced in 1 atomic transaction.`,
        hash: finalHash,
      })
      void notifyTokenLaunch({
        tokenId: newId,
        name: cleanName,
        symbol: ticker,
        seedXlm: formatAmount(seedXlm, XLM_DECIMALS),
        creator: publicKey,
        explorerUrl: finalHash ? explorerTxUrl(finalHash) : undefined,
      })

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['token-list'] }),
        queryClient.invalidateQueries({ queryKey: ['token-info', newId] }),
        queryClient.invalidateQueries({ queryKey: ['token-balance', newId] }),
        queryClient.invalidateQueries({ queryKey: ['soroswap-pool', newId] }),
        queryClient.invalidateQueries({ queryKey: ['lp-burn'] }),
        queryClient.invalidateQueries({ queryKey: ['xlm-balance'] }),
      ])
    } catch (err) {
      const message = errorMessage(err)
      setError(message)
      toast.error('Failed to create token', { message })
      // La launch es UNA tx atómica: si falló antes de enviarse (firma
      // rechazada, simulación, saldo) no hay nada que recuperar. Solo se
      // conserva el checkpoint si la tx llegó a la red (hay hash) y no
      // sabemos si confirmó.
      if (deployHash) {
        setCheckpointNote(getCheckpoint(publicKey))
      } else {
        clearCheckpoint(publicKey)
      }
    } finally {
      setBusy(false)
      setStep(null)
    }
  }

  return (
    <section className="liquid-glass rounded-3xl p-5 sm:p-8 w-full max-w-full overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-slate-900">
            <TokenArt
              id={symbol || name || 'ASTRO'}
              symbol={symbol || 'COIN'}
              logoUrl={previewLogoUrl}
              className="h-full w-full"
            />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-white truncate">Create & Launch</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              100M fixed supply · 99.5% LP burned · mint renounced
            </p>
          </div>
        </div>
        <span className="rounded-full border border-emerald-500/30 bg-emerald-950/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 shrink-0">
          ⚡ 0 XLM Protocol Fee
        </span>
      </div>

      {/* Immutable Snapshot Launch Receipt */}
      {createdLaunch ? (
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-emerald-500/60 bg-emerald-950/20 p-5 text-emerald-200">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3 min-w-0">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-emerald-500/50 bg-slate-900">
                <TokenArt
                  id={createdLaunch.id}
                  symbol={createdLaunch.symbol}
                  logoUrl={createdLaunch.logoUrl}
                  className="h-full w-full"
                />
              </div>
              <div className="min-w-0 space-y-1">
                <p className="font-bold text-lg text-emerald-300">
                  🎉 {createdLaunch.name} (${createdLaunch.symbol}) Launched!
                </p>
                <p className="font-mono text-xs text-slate-300 break-all">
                  Token: {createdLaunch.id}
                </p>
                <p className="font-mono text-xs text-slate-400 break-all">
                  Pair: {createdLaunch.pair}
                </p>
                <p className="text-xs text-emerald-200/90">
                  ✓ 99,500,000 ${createdLaunch.symbol} +{' '}
                  {formatAmount(createdLaunch.seedXlm, XLM_DECIMALS)} XLM → Pool ·
                  500,000 ${createdLaunch.symbol} (0.5%) → Your Wallet ·{' '}
                  {formatAmount(createdLaunch.lpMinted, 7)} LP burned to{' '}
                  {shortAddress(STELLAR_BURN_ADDRESS)}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Link
                to={`/token/${createdLaunch.id}`}
                className="rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400 shadow-md shadow-emerald-500/20"
              >
                Open Trading Room →
              </Link>
              <a
                href={explorerContractUrl(createdLaunch.id)}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 hover:border-slate-500"
              >
                Token ↗
              </a>
              <a
                href={explorerContractUrl(createdLaunch.pair)}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 hover:border-slate-500"
              >
                Pair ↗
              </a>
              {createdLaunch.hash ? (
                <a
                  href={explorerTxUrl(createdLaunch.hash)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 hover:border-slate-500"
                >
                  Tx ↗
                </a>
              ) : null}
              <ShareButton
                text={`🚀 I just launched $${createdLaunch.symbol} on AstroGate! Trade it on Stellar:`}
                url={
                  typeof window !== 'undefined'
                    ? `${window.location.origin}/token/${createdLaunch.id}`
                    : `/token/${createdLaunch.id}`
                }
              />
            </div>
          </div>
        </div>
      ) : null}

      {/* Lanzamiento anterior enviado sin confirmación: sin reintentar a ciegas */}
      {checkpointNote && (checkpointNote.tokenId || checkpointNote.txHash) ? (
        <div
          role="status"
          className="mt-4 flex flex-col gap-2 rounded-xl border border-amber-500/60 bg-amber-950/20 p-4 text-amber-200"
        >
          <p className="text-sm font-semibold">⚠️ {incompleteMessageFor(checkpointNote)}</p>
          <p className="text-xs text-slate-300">
            The launch is a single atomic transaction: it either fully succeeded or reverted
            with no funds moved. Check its status before launching again.
          </p>
          {checkpointNote.txHash ? (
            <p className="font-mono text-xs break-all text-slate-300">
              tx {checkpointNote.txHash}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {checkpointNote.txHash ? (
              <a
                href={explorerTxUrl(checkpointNote.txHash)}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400"
              >
                Check transaction ↗
              </a>
            ) : null}
            {checkpointNote.tokenId ? (
              <Link
                to={`/token/${checkpointNote.tokenId}`}
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
              >
                Go to token page →
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => {
                clearCheckpoint(publicKey)
                setCheckpointNote(null)
              }}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
            >
              Dismiss notice
            </button>
          </div>
        </div>
      ) : null}

      <form onSubmit={onSubmit} aria-busy={busy} className="mt-4 grid gap-3 sm:grid-cols-2">
        {/* 1. Token Name */}
        <label className="block text-sm">
          <span className="text-slate-300 font-medium">Token Name *</span>
          <input
            className={`${inputClass} mt-1`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Astro Doge"
            maxLength={32}
            required
            disabled={busy}
          />
        </label>

        {/* 2. Token Ticker */}
        <label className="block text-sm">
          <span className="text-slate-300 font-medium">Ticker Symbol (A-Z, 0-9) *</span>
          <input
            className={`${inputClass} mt-1 font-mono uppercase`}
            value={symbol}
            onChange={(e) =>
              setSymbol(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))
            }
            placeholder="e.g. ADOGE"
            maxLength={12}
            required
            disabled={busy}
          />
        </label>

        {/* Collapsible Optional Details (stored on-chain in LaunchRecord.meta) */}
        <div className="sm:col-span-2">
          <button
            type="button"
            onClick={() => setShowDetails(!showDetails)}
            aria-expanded={showDetails}
            className="text-xs font-semibold text-sky-400 hover:text-sky-300 flex items-center gap-1"
          >
            <span>
              {showDetails ? '▼ Hide' : '▶ Add'} description, HTTPS logo & socials (stored on-chain)
            </span>
          </button>

          {showDetails ? (
            <div className="mt-2 grid gap-3 sm:grid-cols-2 rounded-2xl border border-slate-800 bg-slate-950/60 p-3.5">
              <label className="block text-sm sm:col-span-2">
                <span className="text-slate-300 font-medium">Description (max 240 chars)</span>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, 240))}
                  placeholder="Short pitch stored on-chain for every trader…"
                  className={`${inputClass} mt-1 resize-none text-sm`}
                  disabled={busy}
                />
              </label>

              <div className="block text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-400">HTTPS Logo URL</span>
                  <label
                    className={`cursor-pointer rounded-md border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-cyan-300 transition hover:border-cyan-500/60 ${
                      busy || logoUploading ? 'pointer-events-none opacity-50' : ''
                    }`}
                  >
                    {logoUploading
                      ? 'Compressing…'
                      : isPinataConfigured()
                        ? 'Upload → IPFS'
                        : 'Upload WebP'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      onChange={handleLogoFileChange}
                      className="sr-only"
                      disabled={busy || logoUploading}
                    />
                  </label>
                </div>
                <input
                  value={logoUrl}
                  onChange={(e) => {
                    setLogoUrl(e.target.value)
                    if (localLogoDataUrl) setLocalLogoDataUrl(null)
                    if (logoUploadHint) setLogoUploadHint(null)
                  }}
                  placeholder="https://example.com/logo.png"
                  className={`${inputClass} mt-1 text-sm`}
                  disabled={busy}
                />
                {logoUploadHint ? (
                  <p className="mt-1 text-[11px] text-slate-400">{logoUploadHint}</p>
                ) : null}
              </div>

              <label className="block text-sm">
                <span className="text-slate-400">Telegram</span>
                <input
                  value={telegram}
                  onChange={(e) => setTelegram(e.target.value)}
                  placeholder="https://t.me/yourgroup or @handle"
                  className={`${inputClass} mt-1 text-sm`}
                  disabled={busy}
                />
              </label>

              <label className="block text-sm">
                <span className="text-slate-400">Website URL</span>
                <input
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://yourtoken.xyz"
                  className={`${inputClass} mt-1 text-sm`}
                  disabled={busy}
                />
              </label>

              <label className="block text-sm">
                <span className="text-slate-400">Twitter / X</span>
                <input
                  value={twitter}
                  onChange={(e) => setTwitter(e.target.value)}
                  placeholder="https://x.com/yourhandle"
                  className={`${inputClass} mt-1 text-sm`}
                  disabled={busy}
                />
              </label>

              <p className="text-[11px] font-mono text-slate-500 sm:col-span-2 text-right">
                On-chain payload: {encodedMetaBytes}/{ONCHAIN_META_MAX_BYTES} bytes
              </p>
            </div>
          ) : null}
        </div>

        {error ? (
          <div
            role="alert"
            className="rounded-lg border border-rose-900 bg-rose-950/40 px-3 py-2 text-xs text-rose-300 sm:col-span-2"
          >
            {error}
          </div>
        ) : null}

        {step ? (
          <div className="sm:col-span-2">
            <TxProgress
              title="Automated Atomic Launch"
              steps={[
                {
                  label: 'Single-Transaction Fair Launch',
                  status: 'active',
                  detail: `Atomic deployment: SEP-41 token created, ${formatAmount(seedXlmStroops, XLM_DECIMALS)} XLM + 99.5% tokens deposited to Soroswap, 100% LP burned to dead address, and ownership renounced in 1 signature.`,
                },
              ]}
            />
          </div>
        ) : null}

        {/* Seed Liquidity Selection (Presets + Custom XLM Input) */}
        <div className="sm:col-span-2 space-y-2.5 pt-2 border-t border-white/[0.06]">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-medium text-slate-300">
              Initial Liquidity (XLM Seed, min 1 XLM)
            </span>
            <span className="font-mono text-emerald-400 font-bold">
              {seedXlmStroops > 0n
                ? `${formatAmount(seedXlmStroops, XLM_DECIMALS)} XLM (≈ $${(seedXlmNumber * xlmUsd).toFixed(2)} USD)`
                : 'Enter ≥ 1 XLM'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {SEED_LIQUIDITY_PRESETS.map((preset) => {
              const presetStroops = BigInt(preset.xlm) * 10n ** BigInt(XLM_DECIMALS)
              const active = seedXlmStroops === presetStroops
              return (
                <button
                  key={preset.xlm}
                  type="button"
                  disabled={busy}
                  title={preset.desc}
                  onClick={() => setSeedXlmInput(String(preset.xlm))}
                  className={`py-2 px-2 rounded-xl border text-xs font-mono font-bold transition-all ${
                    active
                      ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300 shadow-md shadow-emerald-500/10'
                      : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-white hover:border-slate-700'
                  }`}
                >
                  {preset.label}
                </button>
              )
            })}
            <label className="col-span-2 sm:col-span-1 flex items-center rounded-xl border border-slate-800 bg-slate-950 px-2.5 py-1.5 focus-within:border-emerald-500">
              <span className="sr-only">Custom XLM Seed</span>
              <input
                type="text"
                inputMode="decimal"
                value={seedXlmInput}
                onChange={(e) => setSeedXlmInput(e.target.value)}
                disabled={busy}
                placeholder="Custom"
                aria-label="Custom initial liquidity in XLM"
                className="w-full bg-transparent text-xs font-mono text-white outline-none"
              />
              <span className="ml-1 text-[10px] font-mono text-slate-400">XLM</span>
            </label>
          </div>

          {/* Transparent Where Your XLM & Tokens Go Breakdown */}
          <div className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-3.5 text-xs space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-200">
                🔍 Where Your XLM & Tokens Go (Atomic On-Chain Split)
              </span>
              <span className="font-mono text-[11px] text-emerald-400">
                {symbol || 'TOKEN'} Total Cap: 100,000,000
              </span>
            </div>

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 font-mono">
              <div className="rounded-xl border border-slate-800/70 bg-slate-900/50 p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">
                  Soroswap AMM Pool (99.5%)
                </p>
                <p className="mt-1 font-bold text-white">
                  {Number(poolTokensWhole).toLocaleString('en-US')} ${symbol || 'TOKEN'}
                </p>
                <p className="text-[11px] text-emerald-300">
                  + {seedXlmStroops > 0n ? formatAmount(seedXlmStroops, XLM_DECIMALS) : '0'} XLM
                </p>
              </div>

              <div className="rounded-xl border border-slate-800/70 bg-slate-900/50 p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">
                  Creator Wallet (0.5%)
                </p>
                <p className="mt-1 font-bold text-amber-300">
                  {Number(creatorTokensWhole).toLocaleString('en-US')} ${symbol || 'TOKEN'}
                </p>
                <p className="text-[11px] text-slate-400 truncate">
                  → {publicKey ? shortAddress(publicKey) : 'Your wallet'}
                </p>
              </div>

              <div className="rounded-xl border border-slate-800/70 bg-slate-900/50 p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">
                  LP Custody & Mint
                </p>
                <p className="mt-1 font-bold text-emerald-300">
                  100% LP Burned 🔥
                </p>
                <p className="text-[11px] text-slate-400">
                  Mint renounced ({shortAddress(STELLAR_BURN_ADDRESS)})
                </p>
              </div>

              <div className="rounded-xl border border-slate-800/70 bg-slate-900/50 p-2.5">
                <p className="text-[10px] uppercase tracking-wide text-slate-400">
                  Launch Price & MCap
                </p>
                <p className="mt-1 font-bold text-sky-300">
                  {spotPriceXlm > 0
                    ? `${formatTokenPrice(spotPriceXlm)} XLM (~$${formatUsdPrice(spotPriceUsd)})`
                    : '—'}
                </p>
                <p className="text-[11px] text-slate-400">
                  MCap:{' '}
                  {initialMarketCapXlm > 0
                    ? `${initialMarketCapXlm.toFixed(2)} XLM (~$${formatUsdPrice(initialMarketCapUsd)})`
                    : '—'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
              <span>
                0 XLM protocol fee · Only ~0.05 XLM Soroban gas · 1 XLM wallet reserve stays yours.
              </span>
              {sniperCost10PctXlm > 0 ? (
                <span className="font-mono text-sky-300">
                  🛡️ Anti-Sniper Depth: Buying 10% costs{' '}
                  <strong>{sniperCost10PctXlm.toFixed(2)} XLM</strong> (≈ $
                  {sniperCost10PctUsd.toFixed(2)} USD)
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 sm:col-span-2 pt-3 border-t border-white/[0.06]">
          <div
            className="text-xs text-slate-400 font-mono"
            title={`${formatAmount(seedXlmStroops, XLM_DECIMALS)} XLM seed + ${feeBufferXlm} XLM buffer for network fees & reserves (unused fees stay in your wallet)`}
          >
            Required balance:{' '}
            <strong className="text-emerald-300">
              {formatAmount(totalRequiredStroops, XLM_DECIMALS)} XLM
            </strong>{' '}
            <span className="text-slate-500">
              ({seedXlmStroops > 0n ? formatAmount(seedXlmStroops, XLM_DECIMALS) : '0'} seed + {feeBufferXlm} XLM wallet buffer)
            </span>
          </div>

          {!publicKey ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={demoPending || pending}
                onClick={() => void startDemo().catch((err) => toast.error('Failed to start demo', { message: errorMessage(err) }))}
                className="min-h-[44px] rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2.5 text-sm font-semibold text-sky-200 hover:bg-sky-500/20 disabled:opacity-60"
              >
                {demoPending ? 'Funding Demo…' : 'Testnet Demo'}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => void connect().catch((err) => toast.error('Failed to connect wallet', { message: errorMessage(err) }))}
                className="min-h-[44px] rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 px-6 py-2.5 text-sm font-bold text-slate-950 transition-all shadow-md shadow-amber-500/20 active:scale-[0.99] cursor-pointer disabled:opacity-60"
              >
                {pending ? 'Connecting…' : '🔌 Connect Wallet'}
              </button>
            </div>
          ) : (
            <button
              type="submit"
              disabled={busy || seedXlmStroops < 10_000_000n}
              className="min-h-[44px] rounded-xl bg-emerald-500 px-6 py-2.5 text-sm font-black text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50 shadow-md shadow-emerald-500/20 cursor-pointer active:scale-[0.99]"
            >
              {busy
                ? 'Launching Token…'
                : `🚀 Launch Token (${seedXlmStroops > 0n ? formatAmount(seedXlmStroops, XLM_DECIMALS) : '0'} XLM seed)`}
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
