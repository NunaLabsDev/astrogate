import { useEffect, useState } from 'react'

const SPLASH_STORAGE_KEY = 'astrogate_splash_seen_v1'
const FADE_DELAY_MS = 1050
const UNMOUNT_DELAY_MS = 1350

const SHOWCASE_NFTS = [
  { src: '/badges/pioneer.png', label: 'Pioneer #00' },
  { src: '/badges/graduate.png', label: 'Graduate' },
  { src: '/badges/legend.png', label: 'Legend' },
] as const

type SplashPhase = 'show' | 'fade' | 'done'

function resolveInitialSplashPhase(): SplashPhase {
  if (typeof window === 'undefined') return 'done'
  try {
    if (window.sessionStorage?.getItem(SPLASH_STORAGE_KEY) === '1') {
      return 'done'
    }
    window.sessionStorage?.setItem(SPLASH_STORAGE_KEY, '1')
  } catch {
    // Restricted webview storage: fall back to showing splash cleanly once per mount.
  }
  return 'show'
}

/**
 * Curated Mini App startup splash showing Sorobits NFTs once per browser session.
 */
export function SplashScreen() {
  const [initialPhase] = useState<SplashPhase>(resolveInitialSplashPhase)
  const [phase, setPhase] = useState<SplashPhase>(initialPhase)

  useEffect(() => {
    if (initialPhase === 'done') return
    const fadeTimer = window.setTimeout(() => setPhase('fade'), FADE_DELAY_MS)
    const doneTimer = window.setTimeout(() => setPhase('done'), UNMOUNT_DELAY_MS)
    return () => {
      window.clearTimeout(fadeTimer)
      window.clearTimeout(doneTimer)
    }
  }, [initialPhase])

  if (phase === 'done') return null

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading AstroGate Mini App"
      onClick={() => setPhase('done')}
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-2xl px-6 transition-opacity duration-300 ${
        phase === 'fade' ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      <div className="relative flex w-full max-w-sm flex-col items-center rounded-3xl border border-sky-400/25 bg-slate-900/80 p-6 text-center shadow-2xl shadow-sky-500/20">
        <div className="mb-4 flex items-center justify-center gap-3">
          {SHOWCASE_NFTS.map((nft, index) => (
            <div
              key={nft.label}
              className={`rounded-2xl border bg-slate-950/90 p-1.5 shadow-lg ${
                index === 1
                  ? 'scale-110 border-cyan-400/60 shadow-cyan-500/25'
                  : 'border-white/10 opacity-90'
              }`}
            >
              <img
                src={nft.src}
                alt={nft.label}
                width={56}
                height={56}
                className="h-14 w-14 rounded-xl"
                style={{ imageRendering: 'pixelated' }}
              />
            </div>
          ))}
        </div>

        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-300">
          Sorobits · SEP-50 · Stellar Soroban
        </p>
        <h2 className="mt-1.5 text-2xl font-black tracking-tight text-white">
          AstroGate
        </h2>
        <p className="mt-1 text-xs text-slate-400">
          Fair-Flywheel v4.5 · 7Y LP Lock · Stellar Soroban
        </p>

        <div className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-sky-400 via-cyan-300 to-amber-300" />
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setPhase('done')
          }}
          className="mt-4 text-[11px] font-semibold text-slate-400 hover:text-white transition-colors"
        >
          Tap anywhere to enter →
        </button>
      </div>
    </div>
  )
}
