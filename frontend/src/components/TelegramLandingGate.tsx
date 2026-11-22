import { BRAND } from '../lib/brand'
import {
  buildTelegramDeepLinkForPath,
  TELEGRAM_BOT_USERNAME,
  TELEGRAM_COMMUNITY_URL,
  TELEGRAM_FEED_URL,
  TELEGRAM_FOLDER_URL,
} from '../lib/telegram'

export interface TelegramLandingGateProps {
  pathname?: string
  sessionNotice?: 'expired' | 'network_error'
  onRetry?: () => void
}

const FEATURE_CARDS = [
  {
    icon: '🚀',
    title: 'Fair-Flywheel v4.5 Curves',
    description:
      '7 XLM launch, 10M fixed supply, 1,000 XLM graduation goal, 7-Year Soroswap LP lock & Escrowed 40K Jackpots.',
  },
  {
    icon: '🛡️',
    title: 'Anti-MEV & Audited Security',
    description:
      'Permissionless buybacks capped at min(0.25% pool, 0.80 XLM) / 300s (+2% XLM keeper rebate), 48h upgrade timelock & mint permanently renounced.',
  },
  {
    icon: '🧬',
    title: 'Sorobits (SBIT) SEP-50 NFTs',
    description:
      '100% on-chain 32×32 SVG art, Commit-Reveal RNG, 8 Season-1 Quest badges & epigenetic rank evolution.',
  },
  {
    icon: '🔐',
    title: 'Biometric + CloudStorage Wallet',
    description:
      'Non-custodial hot wallet encrypted inside Telegram CloudStorage with Face ID / Fingerprint + PIN unlock.',
  },
] as const

const PREVIEW_CARDS = [
  {
    src: '/telegram/market-hero-card.png',
    alt: 'AstroGate Fair-Flywheel v4.5 Market Preview',
    label: 'Fair-Flywheel Market & Graduation Curves',
  },
  {
    src: '/telegram/sorobits-hero-card.png',
    alt: 'Sorobits Commit-Reveal SEP-50 NFTs Preview',
    label: 'Sorobits (SBIT) On-Chain Genomic NFTs',
  },
  {
    src: '/telegram/wallet-quests-card.png',
    alt: 'AstroGate Biometric Wallet & Season-1 Quests Preview',
    label: 'Biometric Vault & Season-1 Quests',
  },
] as const

export function TelegramLandingGate({
  pathname = '/',
  sessionNotice,
  onRetry,
}: TelegramLandingGateProps) {
  const deepLink = buildTelegramDeepLinkForPath(pathname)

  return (
    <div className="min-h-screen w-full overflow-x-hidden bg-slate-950 text-slate-100 relative">
      {/* Cosmic ambient glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-40 h-[420px] bg-gradient-to-b from-sky-500/15 via-cyan-500/5 to-transparent blur-3xl"
      />

      {/* Top presentation bar */}
      <header className="relative z-10 mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <img
            src="/badges/pioneer.png"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8 shrink-0 rounded-lg border border-sky-400/40 bg-slate-900/90 shadow-sm shadow-sky-500/20"
            style={{ imageRendering: 'pixelated' }}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="truncate text-base font-bold tracking-tight text-white">
                {BRAND.name}
              </span>
              <span className="text-[11px] font-medium text-slate-400">
                · Built by NunaLabs
              </span>
            </div>
          </div>
        </div>

        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1 text-[11px] font-semibold text-sky-300 backdrop-blur-md">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
          Telegram-Native · Stellar Soroban Testnet
        </span>
      </header>

      <main className="relative z-10 mx-auto flex max-w-5xl flex-col gap-10 px-4 pt-4 pb-16">
        {sessionNotice === 'expired' && (
          <div
            role="alert"
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border border-amber-400/35 bg-amber-500/10 px-4 py-3.5 text-sm text-amber-100 backdrop-blur-md"
          >
            <p className="leading-relaxed">
              Your Telegram session expired or could not be authenticated. Reopen
              AstroGate directly from{' '}
              <span className="font-semibold text-white">
                @{TELEGRAM_BOT_USERNAME}
              </span>{' '}
              to launch a verified Mini App session.
            </p>
            <a
              href={deepLink}
              className="inline-flex shrink-0 items-center justify-center rounded-xl bg-amber-400 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-amber-300 transition-colors"
            >
              Reopen in Telegram ↗
            </a>
          </div>
        )}

        {sessionNotice === 'network_error' && (
          <div
            role="alert"
            className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-2xl border border-rose-400/35 bg-rose-500/10 px-4 py-3.5 text-sm text-rose-100 backdrop-blur-md"
          >
            <p className="leading-relaxed">
              Could not reach Telegram session verification right now. Check your
              connection and retry, or reopen via{' '}
              <span className="font-semibold text-white">
                @{TELEGRAM_BOT_USERNAME}
              </span>
              .
            </p>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="inline-flex items-center justify-center rounded-xl border border-white/20 bg-white/10 px-3.5 py-2 text-xs font-semibold text-white hover:bg-white/20 transition-colors cursor-pointer"
                >
                  Retry Verification
                </button>
              )}
              <a
                href={deepLink}
                className="inline-flex items-center justify-center rounded-xl bg-sky-500 px-3.5 py-2 text-xs font-bold text-slate-950 hover:bg-sky-400 transition-colors"
              >
                Open in Telegram ↗
              </a>
            </div>
          </div>
        )}

        {/* Hero presentation block */}
        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:p-10 shadow-2xl shadow-sky-950/30 backdrop-blur-xl">
          <div className="mx-auto flex max-w-3xl flex-col items-center text-center gap-5">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/25 bg-cyan-500/10 px-3.5 py-1 text-xs font-semibold text-cyan-200">
              <span>🌊🚀 Fair-Flywheel v4.5 Protocol</span>
              <span aria-hidden="true">·</span>
              <span>Telegram Mini App Only</span>
            </div>

            <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white leading-[1.12]">
              Fair Memecoin Launchpad &amp; On-Chain Sorobits — Exclusively on
              Telegram
            </h1>

            <p className="max-w-2xl text-sm sm:text-base text-slate-300 leading-relaxed">
              AstroGate&apos;s trading terminal, 7 XLM fair launchpad, and
              biometric CloudStorage wallet run strictly inside Telegram Mini
              App to keep keys isolated and eliminate browser phishing.
            </p>

            <div className="flex w-full flex-col sm:flex-row items-center justify-center gap-3 pt-1">
              <a
                href={deepLink}
                className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-sky-400 via-cyan-400 to-sky-500 px-7 py-3.5 text-sm sm:text-base font-bold text-slate-950 shadow-lg shadow-sky-500/25 hover:brightness-110 transition-all"
              >
                <span>Open AstroGate in Telegram ↗</span>
              </a>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <a
                href={TELEGRAM_COMMUNITY_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-sky-400/40 hover:text-white transition-colors"
              >
                💬 Community (@AstroSoroban)
              </a>
              <a
                href={TELEGRAM_FEED_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-sky-400/40 hover:text-white transition-colors"
              >
                📡 Live Feed (@AstroGateFeed)
              </a>
              <a
                href={TELEGRAM_FOLDER_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-semibold text-slate-200 hover:border-sky-400/40 hover:text-white transition-colors"
              >
                📂 Add All 3 Chats Folder
              </a>
            </div>

            <p className="text-xs text-slate-400">
              On desktop? Open Telegram Desktop and start{' '}
              <a
                href={`https://t.me/${TELEGRAM_BOT_USERNAME}`}
                className="font-semibold text-sky-300 hover:underline"
              >
                @{TELEGRAM_BOT_USERNAME}
              </a>{' '}
              to launch the verified Mini App.
            </p>
          </div>
        </section>

        {/* Visual preview cards */}
        <section aria-label="Mini App Previews" className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {PREVIEW_CARDS.map((card) => (
            <figure
              key={card.src}
              className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70 backdrop-blur-md shadow-lg shadow-slate-950/50"
            >
              <img
                src={card.src}
                alt={card.alt}
                loading="lazy"
                className="aspect-[1200/630] w-full object-cover"
              />
              <figcaption className="px-3.5 py-2.5 text-xs font-medium text-slate-300 border-t border-white/[0.06]">
                {card.label}
              </figcaption>
            </figure>
          ))}
        </section>

        {/* v4.5 Architecture Feature Cards */}
        <section aria-label="Fair-Flywheel v4.5 Highlights" className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {FEATURE_CARDS.map((feat) => (
            <article
              key={feat.title}
              className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 backdrop-blur-md"
            >
              <div className="flex items-center gap-2.5 mb-2">
                <span aria-hidden="true" className="text-xl">
                  {feat.icon}
                </span>
                <h2 className="text-base font-bold text-white">{feat.title}</h2>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">
                {feat.description}
              </p>
            </article>
          ))}
        </section>
      </main>

      {/* Developer & Public Read-Only Endpoints Footer */}
      <footer className="relative z-10 mx-auto max-w-5xl border-t border-slate-800/70 px-4 py-6 text-center text-xs text-slate-400">
        <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
          <span>
            {BRAND.emoji} {BRAND.name} · Built by NunaLabs
          </span>
          <span aria-hidden="true">·</span>
          <a
            href="https://github.com/NunaLabsDev/astrogate"
            target="_blank"
            rel="noreferrer"
            className="text-slate-200 hover:text-white hover:underline"
          >
            GitHub ↗
          </a>
          <span aria-hidden="true">·</span>
          <a href="/api/v1/health" className="text-sky-400 hover:underline">
            Public Read-Only API
          </a>
          <span aria-hidden="true">·</span>
          <a href="/openapi.json" className="text-sky-400 hover:underline">
            OpenAPI
          </a>
          <span aria-hidden="true">·</span>
          <a href="/mcp" className="text-sky-400 hover:underline">
            MCP
          </a>
          <span aria-hidden="true">·</span>
          <a
            href="/.well-known/stellar.toml"
            className="text-sky-400 hover:underline"
          >
            stellar.toml
          </a>
          <span aria-hidden="true">·</span>
          <a href="/llms.txt" className="text-sky-400 hover:underline">
            llms.txt
          </a>
        </p>
      </footer>
    </div>
  )
}
