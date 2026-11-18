import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
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
  CREATOR_ALLOCATION_BPS,
  CURVE_ALLOCATION_BPS,
  curveCostForTotalSupplyShareXlm,
  CURVE_VIRTUAL_TOKEN_START_BASE,
  CURVE_VIRTUAL_XLM_START_STROOPS,
  DEFAULT_OPTIMIZED_SEED_XLM,
  DEV_ALLOCATION_BPS,
  DEX_ALLOCATION_BPS,
  FAIR_LAUNCH_DECIMALS,
  FAIR_LAUNCH_TOTAL_BASIS,
  LAUNCH_CREATION_FEE_STROOPS,
  LAUNCH_CREATION_FEE_XLM,
  localCurveQuoteBuy,
  LP_LOCK_YEARS,
  MIN_SEED_XLM,
  MIN_SEED_XLM_STROOPS,
  SEED_LIQUIDITY_PRESETS,
} from '../lib/tokenomics'
import { NETWORK_NAME } from '../lib/network'
import { DEFAULT_XLM_USD_PRICE, validateXlmReserve, XLM_DECIMALS, XLM_FEE_BUFFER } from '../lib/xlm'
import { useXlmUsdPrice } from '../hooks/useXlmUsdPrice'
import { useXlmBalance } from '../hooks/useXlmBalance'
import { explorerTxUrl } from '../lib/explorer'
import { notifyTokenLaunch } from '../lib/alerts'
import {
  compressImageFileToWebp,
  uploadTokenLogo,
} from '../lib/image-upload'
import { useWallet } from '../store/wallet'
import { errorMessage, formatAmount, parseAmount, shortAddress } from '../lib/format'
import { toast } from '../lib/toast'
import { notifyTelegramPulse, triggerTelegramHaptic } from '../lib/telegram'
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
  const ref =
    cp.tokenId ||
    (cp.txHash ? `tx ${shortAddress(cp.txHash)}` : 'pending broadcast')
  return `Previous launch attempt recorded for ${cp.symbol} (${ref}). Check transaction status on Stellar Explorer.`
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
  const {
    publicKey,
    requireSignerOrPrompt,
    openWalletModal,
    startDemo,
    demoPending,
    pending,
  } = useWallet()
  const navigate = useNavigate()
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
  const totalRequiredStroops =
    seedXlmStroops + LAUNCH_CREATION_FEE_STROOPS + XLM_FEE_BUFFER

  const curveTokensWhole = allocationOfBps(
    FAIR_LAUNCH_TOTAL_BASIS,
    CURVE_ALLOCATION_BPS,
  )
  const dexTokensWhole = allocationOfBps(
    FAIR_LAUNCH_TOTAL_BASIS,
    DEX_ALLOCATION_BPS,
  )
  const devTokensWhole = allocationOfBps(
    FAIR_LAUNCH_TOTAL_BASIS,
    DEV_ALLOCATION_BPS,
  )
  const creatorVestingTokensWhole = allocationOfBps(
    FAIR_LAUNCH_TOTAL_BASIS,
    CREATOR_ALLOCATION_BPS,
  )
  const initialBuyQuote =
    seedXlmStroops >= MIN_SEED_XLM_STROOPS
      ? localCurveQuoteBuy(0n, 0n, seedXlmStroops)
      : null
  const creatorBoughtTokensWhole = initialBuyQuote
    ? Number(initialBuyQuote.tokens_out) / 1e7
    : 0
  const postBuyVirtualXlm =
    Number(
      CURVE_VIRTUAL_XLM_START_STROOPS +
        (initialBuyQuote?.net_xlm_to_curve ?? 0n),
    ) / 1e7
  const postBuyVirtualTok =
    Number(
      CURVE_VIRTUAL_TOKEN_START_BASE - (initialBuyQuote?.tokens_out ?? 0n),
    ) / 1e7
  const spotPriceXlm =
    postBuyVirtualTok > 0 ? postBuyVirtualXlm / postBuyVirtualTok : 0
  const spotPriceUsd = spotPriceXlm * xlmUsd
  const initialMarketCapXlm =
    spotPriceXlm * Number(FAIR_LAUNCH_TOTAL_BASIS)
  const initialMarketCapUsd = initialMarketCapXlm * xlmUsd
  const sniperCost10PctXlm = curveCostForTotalSupplyShareXlm(0n, 0n, 10)
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
      const immutableUrl = await uploadTokenLogo(compressed.blob, {
        sha256: compressed.sha256,
      })
      setLogoUrl(immutableUrl)
      setLogoUploadHint(
        `Content-addressed 128×128 WebP ready (SHA-256 ${compressed.sha256.slice(0, 10)}… · stored on-chain).`,
      )
    } catch (err) {
      setLogoUploadHint(errorMessage(err))
    } finally {
      setLogoUploading(false)
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setCheckpointNote(null)
    if (!publicKey) {
      setError('Please connect your wallet first.')
      return
    }
    const signer = requireSignerOrPrompt()
    if (!signer) {
      if (useWallet.getState().mode !== 'hot') {
        setError(UNSUPPORTED_SIGNER_MESSAGE)
      }
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
    ) // 10 Million (fixed on-chain by launch_fair)
    const seedXlm = seedXlmStroops
    if (seedXlm < MIN_SEED_XLM_STROOPS) {
      setError(`Minimum initial liquidity is ${MIN_SEED_XLM} XLM.`)
      return
    }

    const xlmReserveError = validateXlmReserve(
      xlmBalance.data,
      seedXlm + LAUNCH_CREATION_FEE_STROOPS,
      publicKey,
    )
    if (xlmReserveError) {
      setError(xlmReserveError)
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

      // 2. Warm pair (if graduated), SEP-41 metadata, IndexedDB listing, and on-chain social meta caches immediately
      if (pairId) {
        cachePairId(newId, pairId)
      }
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

      const initCurveQuote = localCurveQuoteBuy(0n, 0n, seedXlm)
      const vXlmStart = CURVE_VIRTUAL_XLM_START_STROOPS + (initCurveQuote?.net_xlm_to_curve ?? seedXlm)
      const vTokStart = CURVE_VIRTUAL_TOKEN_START_BASE - (initCurveQuote?.tokens_out ?? 0n)

      await putStoredTokens([
        {
          id: newId,
          name: cleanName,
          symbol: ticker,
          decimals: targetDecimals,
          pairId: pairId ?? '',
          reserveToken: vTokStart.toString(),
          reserveXlm: vXlmStart.toString(),
          ledger: Number.MAX_SAFE_INTEGER,
          creator: publicKey,
          meta: encodedMeta || undefined,
          isAntiRugVerified: true,
          curveGraduated: Boolean(pairId),
          curveXlmNet: (initCurveQuote?.net_xlm_to_curve ?? seedXlm).toString(),
          curveTokensSold: (initCurveQuote?.tokens_out ?? 0n).toString(),
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

      triggerTelegramHaptic('success')
      toast.success(`🚀 $${ticker} is live!`, {
        message: 'Opening your new token room…',
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
      if (finalHash) void notifyTelegramPulse(finalHash)

      setName('')
      setSymbol('')
      setDescription('')
      setLogoUrl('')
      setLocalLogoDataUrl(null)
      setLogoUploadHint(null)
      setWebsite('')
      setTelegram('')
      setTwitter('')

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['token-list'] }),
        queryClient.invalidateQueries({ queryKey: ['token-info', newId] }),
        queryClient.invalidateQueries({ queryKey: ['token-balance', newId] }),
        queryClient.invalidateQueries({ queryKey: ['soroswap-pool', newId] }),
        queryClient.invalidateQueries({ queryKey: ['lp-burn'] }),
        queryClient.invalidateQueries({ queryKey: ['xlm-balance'] }),
      ])

      void navigate(`/token/${newId}`)
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
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-white/[0.06] pb-3.5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-slate-900">
            <TokenArt
              id={symbol || name || 'ASTRO'}
              symbol={symbol || 'COIN'}
              logoUrl={previewLogoUrl}
              className="h-full w-full"
            />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-white whitespace-nowrap">Create &amp; Launch</h2>
            <p className="text-xs text-slate-400 truncate">
              10M fixed supply · Fair-Flywheel v4.3 ({LP_LOCK_YEARS}Y LP Lock)
            </p>
          </div>
        </div>
        <span className="rounded-full border border-emerald-500/30 bg-emerald-950/40 px-2.5 py-1 text-xs font-semibold text-emerald-300 shrink-0 tabular-nums">
          ⚡ {LAUNCH_CREATION_FEE_XLM} XLM Fee (≈ ${formatUsdPrice(LAUNCH_CREATION_FEE_XLM * xlmUsd)} USDC)
        </span>
      </div>

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
                    {logoUploading ? 'Uploading WebP…' : 'Upload WebP'}
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
                  detail: `Atomic deployment: SEP-41 token minted (10M cap), 66% curve / 33% Soroswap (7Y LP lock) / 0.3% 15d vesting / 0.7% ecosystem, P2P locked until graduation, initial ${formatAmount(seedXlmStroops, XLM_DECIMALS)} XLM buy locked until graduation (or 7 days if ungraduated), and ownership renounced in 1 signature.`,
                },
              ]}
            />
          </div>
        ) : null}

        {/* Seed Liquidity Selection (Presets + Custom XLM Input) */}
        <div className="sm:col-span-2 space-y-2.5 pt-2 border-t border-white/[0.06]">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="font-medium text-slate-300">
              Initial Liquidity (XLM Seed, min {MIN_SEED_XLM} XLM)
            </span>
            <span className="font-mono text-emerald-400 font-bold">
              {seedXlmStroops > 0n
                ? `${formatAmount(seedXlmStroops, XLM_DECIMALS)} XLM (≈ $${(seedXlmNumber * xlmUsd).toFixed(2)} USD)`
                : `Enter ≥ ${MIN_SEED_XLM} XLM`}
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
                  title={`${preset.xlm} XLM (≈ $${(preset.xlm * xlmUsd).toFixed(2)} USD)`}
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
                className="w-full bg-transparent text-base sm:text-xs font-mono tabular-nums text-white outline-none"
              />
              <span className="ml-1 text-xs font-mono text-slate-400">XLM</span>
            </label>
          </div>

          {/* Collapsible Tokenomics Breakdown (clean by default on mobile) */}
          <details className="rounded-2xl border border-slate-800/80 bg-slate-950/60 p-3.5 text-xs sm:text-sm">
            <summary className="cursor-pointer select-none font-medium text-slate-300 flex items-center justify-between gap-2">
              <span>📊 View Fair-Flywheel Split &amp; Launch Price</span>
              <span className="font-mono text-xs text-emerald-400">66 / 33 / 0.3 / 0.7</span>
            </summary>

            <div className="mt-3 space-y-3 pt-3 border-t border-slate-800/80">
              <div className="grid gap-2.5 sm:grid-cols-2 font-mono text-xs">
                <div className="rounded-xl border border-slate-800/70 bg-slate-900/50 p-3">
                  <p className="text-slate-400 font-sans">66% Curve + 33% Soroswap DEX</p>
                  <p className="mt-1 font-bold text-white">
                    {Number(curveTokensWhole).toLocaleString('en-US')} + {Number(dexTokensWhole).toLocaleString('en-US')} ${symbol || 'TOKEN'}
                  </p>
                  <p className="mt-1 text-emerald-300">
                    Your buy {seedXlmStroops > 0n ? formatAmount(seedXlmStroops, XLM_DECIMALS) : '0'} XLM → ~{Math.round(creatorBoughtTokensWhole).toLocaleString('en-US')} ${symbol || 'TOKEN'} (locked until graduation or 7d fallback)
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800/70 bg-slate-900/50 p-3">
                  <p className="text-slate-400 font-sans">0.3% 15d Vesting + 0.7% Ecosystem</p>
                  <p className="mt-1 font-bold text-amber-300">
                    {Number(creatorVestingTokensWhole).toLocaleString('en-US')} ⏳ + {Number(devTokensWhole).toLocaleString('en-US')} 🛸
                  </p>
                  <p className="mt-1 text-slate-400 truncate">
                    100% LP time-locked {LP_LOCK_YEARS} years in contract
                  </p>
                </div>

                <div className="rounded-xl border border-slate-800/70 bg-slate-900/50 p-3 sm:col-span-2 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-slate-400 font-sans">Launch Price &amp; MCap</p>
                    <p className="mt-0.5 font-bold text-sky-300">
                      {spotPriceXlm > 0
                        ? `${formatTokenPrice(spotPriceXlm)} XLM (~$${formatUsdPrice(spotPriceUsd)})`
                        : '—'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-slate-400 font-sans">Initial MCap</p>
                    <p className="mt-0.5 font-bold text-slate-200">
                      {initialMarketCapXlm > 0
                        ? `${initialMarketCapXlm.toFixed(1)} XLM (~$${formatUsdPrice(initialMarketCapUsd)})`
                        : '—'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                <span>
                  {LAUNCH_CREATION_FEE_XLM} XLM network maintenance fee → Treasury · 1 XLM reserve stays yours.
                </span>
                {sniperCost10PctXlm > 0 ? (
                  <span className="font-mono text-sky-300">
                    🛡️ 10% Supply Cost: <strong>{sniperCost10PctXlm.toFixed(1)} XLM</strong> (≈ ${sniperCost10PctUsd.toFixed(2)})
                  </span>
                ) : null}
              </div>
            </div>
          </details>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 sm:col-span-2 pt-4 border-t border-white/[0.06]">
          <div
            className="text-sm text-slate-300 font-mono"
            title={`${formatAmount(seedXlmStroops, XLM_DECIMALS)} XLM buy + ${LAUNCH_CREATION_FEE_XLM} XLM fee + ${feeBufferXlm} XLM reserve`}
          >
            Total:{' '}
            <strong className="text-emerald-300">
              {formatAmount(totalRequiredStroops, XLM_DECIMALS)} XLM
            </strong>{' '}
            <span className="text-xs text-slate-400 font-sans">
              ({seedXlmStroops > 0n ? formatAmount(seedXlmStroops, XLM_DECIMALS) : '0'} buy + {LAUNCH_CREATION_FEE_XLM} fee + {feeBufferXlm} reserve)
            </span>
          </div>

          {!publicKey ? (
            <div className="flex flex-wrap items-center gap-2">
              {NETWORK_NAME !== 'mainnet' ? (
                <button
                  type="button"
                  disabled={demoPending || pending}
                  onClick={() => void startDemo().catch((err) => toast.error('Failed to start demo', { message: errorMessage(err) }))}
                  className="min-h-[44px] rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2.5 text-sm font-semibold text-sky-200 hover:bg-sky-500/20 disabled:opacity-60"
                >
                  {demoPending ? 'Funding Demo…' : 'Testnet Demo'}
                </button>
              ) : null}
              <button
                type="button"
                disabled={pending}
                onClick={() => openWalletModal('connect')}
                className="min-h-[44px] rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 px-6 py-2.5 text-sm font-bold text-slate-950 transition-all shadow-md shadow-amber-500/20 active:scale-[0.99] cursor-pointer disabled:opacity-60"
              >
                {pending ? 'Connecting…' : '⚡ Connect / Create Wallet'}
              </button>
            </div>
          ) : (
            <button
              type="submit"
              disabled={busy || seedXlmStroops < MIN_SEED_XLM_STROOPS}
              className="min-h-[44px] rounded-xl bg-emerald-500 px-6 py-2.5 text-sm font-black text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50 shadow-md shadow-emerald-500/20 cursor-pointer active:scale-[0.99]"
            >
              {busy
                ? 'Launching Token…'
                : `🚀 Launch Token (${seedXlmStroops > 0n ? formatAmount(seedXlmStroops, XLM_DECIMALS) : '0'} + ${LAUNCH_CREATION_FEE_XLM} XLM fee)`}
            </button>
          )}
        </div>
      </form>
    </section>
  )
}
