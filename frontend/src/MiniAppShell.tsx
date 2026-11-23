import { useEffect } from 'react'
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router'
import { WalletButton } from './components/WalletButton'
import { ScrollToTop } from './components/ScrollToTop'
import { OfflineBanner } from './components/OfflineBanner'
import { SplashScreen } from './components/SplashScreen'
import { ErrorBoundary, PageErrorFallback } from './components/ErrorBoundary'
import { HomePage } from './pages/HomePage'
import { MarketPage } from './pages/MarketPage'
import { DexPage } from './pages/DexPage'
import { TokenPage } from './pages/TokenPage'
import { PortfolioPage } from './pages/PortfolioPage'
import { SorobitsPage } from './pages/SorobitsPage'
import { CreatePage } from './pages/CreatePage'
import { DocsPage } from './pages/DocsPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { BRAND } from './lib/brand'
import {
  initTelegramMiniApp,
  readTelegramStartParam,
  syncTelegramBackButton,
  triggerTelegramHaptic,
} from './lib/telegram'
import { useWallet } from './store/wallet'

const MOBILE_NAV_ITEMS = [
  { to: '/', label: 'Market', icon: '🔥' },
  { to: '/dex', label: 'DEX', icon: '🎓' },
  { to: '/create', label: 'Launch', icon: '🚀' },
  { to: '/portfolio', label: 'Portfolio', icon: '👛' },
] as const

const DESKTOP_NAV_ITEMS = [
  ...MOBILE_NAV_ITEMS,
  { to: '/docs', label: 'Docs', icon: '📘' },
] as const

function navLinkClass(active: boolean) {
  return `inline-flex min-h-[36px] items-center whitespace-nowrap rounded-xl px-3 text-xs sm:text-sm font-semibold transition-all ${
    active
      ? 'bg-sky-500/20 text-sky-300 shadow-sm shadow-sky-500/10 border border-sky-400/30'
      : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.04]'
  }`
}

function mobileTabClass(active: boolean) {
  return `flex flex-1 min-h-[46px] flex-col items-center justify-center gap-0.5 rounded-2xl px-1 py-1 text-[11px] font-semibold transition-colors ${
    active
      ? 'bg-sky-500/15 text-sky-300 border border-sky-400/30'
      : 'text-slate-400 hover:text-slate-200 border border-transparent'
  }`
}

function NavItems({ mobile = false }: { mobile?: boolean }) {
  const { pathname } = useLocation()
  const items = mobile ? MOBILE_NAV_ITEMS : DESKTOP_NAV_ITEMS
  return (
    <>
      {items.map((item) => {
        const isMarketRoot = item.to === '/' && pathname === '/market'
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            onClick={() => triggerTelegramHaptic('light')}
            className={({ isActive }) =>
              mobile
                ? mobileTabClass(isActive || isMarketRoot)
                : navLinkClass(isActive || isMarketRoot)
            }
          >
            {mobile ? (
              <>
                <span aria-hidden="true" className="text-sm leading-none">
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </>
            ) : (
              item.label
            )}
          </NavLink>
        )
      })}
    </>
  )
}

export default function MiniAppShell({
  ssrPublicKey,
}: {
  ssrPublicKey?: string
} = {}) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const storePublicKey = useWallet((state) => state.publicKey)
  const publicKey = storePublicKey ?? ssrPublicKey ?? null
  const pending = useWallet((state) => state.pending)
  const demoPending = useWallet((state) => state.demoPending)
  const connect = useWallet((state) => state.connect)
  const startDemo = useWallet((state) => state.startDemo)
  const hydrateFromTelegramCloud = useWallet(
    (state) => state.hydrateFromTelegramCloud,
  )

  useEffect(() => {
    const { info, cleanup } = initTelegramMiniApp()
    if (info.isMiniApp) {
      void hydrateFromTelegramCloud()
      const startParam = readTelegramStartParam()
      if (startParam && pathname === '/') {
        if (/^C[A-Z2-7]{55}$/.test(startParam)) {
          void navigate(`/token/${startParam}`, { replace: true })
        } else if (startParam === 'market') {
          void navigate('/market', { replace: true })
        } else if (startParam === 'dex' || startParam === 'graduated') {
          void navigate('/dex', { replace: true })
        } else if (startParam === 'create' || startParam === 'launch') {
          void navigate('/create', { replace: true })
        } else if (startParam === 'portfolio' || startParam === 'wallet') {
          void navigate('/portfolio', { replace: true })
        } else if (startParam === 'sorobits' || startParam === 'nfts') {
          void navigate('/sorobits', { replace: true })
        } else if (startParam === 'docs' || startParam === 'audit') {
          void navigate('/docs', { replace: true })
        }
      }
    }
    return cleanup
    // Run once on Mini App mount to avoid overriding manual navigation
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    return syncTelegramBackButton(pathname !== '/', () => {
      if ((window.history.state as { idx?: number } | null)?.idx) {
        void navigate(-1)
      } else {
        void navigate('/')
      }
    })
  }, [pathname, navigate])

  return (
    <div className="min-h-[calc(var(--app-vh,1vh)*100)] text-slate-100 w-full max-w-full overflow-x-hidden">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[110] focus:rounded-lg focus:bg-sky-500 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-slate-950"
      >
        Skip to content
      </a>

      <OfflineBanner />

      <header className="sticky top-0 z-40 mx-auto max-w-5xl px-3 sm:px-4 tg-safe-top">
        <div className="liquid-glass-pill rounded-2xl px-3 py-2 sm:px-5 sm:py-2.5">
          <div className="flex items-center justify-between gap-2">
            <Link
              to="/"
              aria-label={`${BRAND.name} — Market`}
              className="flex min-w-0 shrink items-center gap-2 text-sm sm:text-lg font-bold tracking-tight text-white hover:text-sky-300 transition-colors"
            >
              <img
                src="/badges/pioneer.png"
                alt=""
                width={28}
                height={28}
                className="h-7 w-7 shrink-0 rounded-lg border border-sky-400/40 bg-slate-900/80 shadow-sm shadow-sky-500/20"
                style={{ imageRendering: 'pixelated' }}
              />
              <span className="truncate">{BRAND.name}</span>
            </Link>

            <nav
              aria-label="Main navigation"
              className="hidden sm:flex items-center gap-1 rounded-2xl bg-white/[0.04] p-1 border border-white/[0.06]"
            >
              <NavItems />
            </nav>

            <div className="flex shrink-0 items-center gap-1.5">
              <WalletButton />
            </div>
          </div>
        </div>
      </header>

      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-5xl min-w-0 flex-col gap-3.5 sm:gap-5 px-3 sm:px-4 pt-3 pb-24 sm:py-6"
      >
        <ScrollToTop />
        {!publicKey ? (
          <section
            aria-label="AstroWallet Login Gate"
            className="mx-auto mt-4 w-full max-w-md rounded-3xl border border-sky-400/25 bg-slate-950/75 p-5 sm:p-6 shadow-xl backdrop-blur-xl"
          >
            <div className="flex items-center gap-2.5 mb-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-400/30">
                🛡️
              </span>
              <h1 className="text-base sm:text-lg font-extrabold text-white">
                Sign In with AstroWallet (@AstroID)
              </h1>
            </div>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed mb-4">
              {BRAND.name} requires an active <strong>AstroWallet</strong> connection before
              launching, trading, or managing tokens. All public keys derived from your seed phrase
              or imported in AstroWallet sync automatically.
            </p>
            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                disabled={pending}
                onClick={() => void connect()}
                className="min-h-[44px] w-full rounded-2xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 hover:bg-emerald-400 disabled:opacity-60"
              >
                {pending ? 'Connecting AstroWallet…' : '🛡️ Sign In with AstroWallet'}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => void hydrateFromTelegramCloud()}
                className="min-h-[40px] w-full rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-2 text-xs sm:text-sm font-semibold text-slate-200 hover:bg-slate-800"
              >
                🔄 Verify Connection
              </button>
              <button
                type="button"
                disabled={demoPending || pending}
                onClick={() => void startDemo()}
                className="min-h-[40px] w-full rounded-2xl border border-sky-500/35 bg-sky-500/10 px-4 py-2 text-xs font-semibold text-sky-200 hover:bg-sky-500/20 disabled:opacity-60"
              >
                {demoPending ? 'Creating Testnet Demo…' : '⚡ Use Disposable Testnet Demo'}
              </button>
            </div>
          </section>
        ) : (
          <ErrorBoundary fallback={(err, retry) => <PageErrorFallback error={err} onRetry={retry} />}>
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/market" element={<MarketPage />} />
              <Route path="/dex" element={<DexPage />} />
              <Route path="/token/:id" element={<TokenPage />} />
              <Route path="/sorobits" element={<SorobitsPage />} />
              <Route path="/portfolio" element={<PortfolioPage />} />
              <Route path="/create" element={<CreatePage />} />
              <Route path="/docs" element={<DocsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </ErrorBoundary>
        )}
      </main>

      <footer className="hidden sm:block mx-auto w-full max-w-5xl border-t border-slate-800/60 px-4 py-5 text-center text-xs text-slate-500">
        <p className="flex flex-wrap items-center justify-center gap-3">
          <span>
            {BRAND.emoji} {BRAND.name} · Fair Memecoin Launchpad on Stellar Soroban
          </span>
          <span aria-hidden="true">·</span>
          <Link to="/docs" className="text-sky-400 hover:underline">
            Docs, Audits &amp; API
          </Link>
          <span aria-hidden="true">·</span>
          <a
            href="https://github.com/NunaLabsDev/astrogate"
            target="_blank"
            rel="noreferrer"
            className="text-slate-300 hover:text-white hover:underline"
          >
            GitHub ↗
          </a>
        </p>
      </footer>

      {/* Native-style fixed mobile / Telegram Mini App bottom navigation */}
      {publicKey && (
        <nav
          aria-label="Mobile navigation"
          className="sm:hidden fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-slate-950/90 backdrop-blur-xl px-3 pt-1.5 tg-safe-bottom"
        >
          <div className="mx-auto flex max-w-md items-center gap-1.5">
            <NavItems mobile />
          </div>
        </nav>
      )}

      <SplashScreen />
    </div>
  )
}
