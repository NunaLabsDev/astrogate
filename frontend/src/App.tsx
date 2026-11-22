import { lazy, Suspense, useEffect, useState } from 'react'
import { useLocation } from 'react-router'
import { TelegramLandingGate } from './components/TelegramLandingGate'
import {
  getTelegramInitDataRaw,
  initTelegramMiniApp,
  verifyTelegramSession,
} from './lib/telegram'

const MiniAppShell = lazy(() => import('./MiniAppShell'))

type GateState =
  | 'landing'
  | 'verifying'
  | 'verified'
  | 'expired'
  | 'network_error'

function isLocalDevMiniAppBypass(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false
  const host = window.location.hostname
  if (host !== 'localhost' && host !== '127.0.0.1') return false
  return new URLSearchParams(window.location.search).get('devMiniApp') === '1'
}

function resolveInitialGateState(): { gate: GateState; rawInitData: string } {
  if (isLocalDevMiniAppBypass()) {
    return { gate: 'verified', rawInitData: '' }
  }
  const rawInitData = getTelegramInitDataRaw()
  return {
    gate: rawInitData ? 'verifying' : 'landing',
    rawInitData,
  }
}

function TelegramBootLoader() {
  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center gap-3 bg-slate-950 text-slate-200 px-4">
      <div
        aria-hidden="true"
        className="h-9 w-9 animate-spin rounded-full border-2 border-sky-400/25 border-t-sky-400"
      />
      <p className="text-sm font-medium text-slate-300">
        Verifying Telegram session…
      </p>
    </div>
  )
}

export default function App() {
  const { pathname } = useLocation()
  const [initial] = useState(resolveInitialGateState)
  const [gate, setGate] = useState<GateState>(initial.gate)
  const [retryTick, setRetryTick] = useState(0)

  useEffect(() => {
    if (gate !== 'verifying' || !initial.rawInitData) return
    let cancelled = false
    const { cleanup } = initTelegramMiniApp()

    void verifyTelegramSession(initial.rawInitData).then((result) => {
      if (cancelled) return
      if (result.status === 'verified') {
        setGate('verified')
      } else if (result.status === 'rejected') {
        setGate('expired')
      } else {
        setGate('network_error')
      }
    })

    return () => {
      cancelled = true
      cleanup()
    }
  }, [gate, initial.rawInitData, retryTick])

  if (gate === 'verified') {
    return (
      <Suspense fallback={<TelegramBootLoader />}>
        <MiniAppShell />
      </Suspense>
    )
  }

  if (gate === 'verifying') {
    return <TelegramBootLoader />
  }

  if (gate === 'expired') {
    return (
      <TelegramLandingGate pathname={pathname} sessionNotice="expired" />
    )
  }

  if (gate === 'network_error') {
    return (
      <TelegramLandingGate
        pathname={pathname}
        sessionNotice="network_error"
        onRetry={() => {
          setGate('verifying')
          setRetryTick((n) => n + 1)
        }}
      />
    )
  }

  return <TelegramLandingGate pathname={pathname} />
}
