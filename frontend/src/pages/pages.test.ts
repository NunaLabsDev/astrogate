import { describe, expect, it, vi } from 'vitest'
import { createElement, type ReactElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ErrorBoundary, PageErrorFallback } from '../components/ErrorBoundary'
import { ScrollToTop } from '../components/ScrollToTop'

vi.mock('../store/wallet', () => ({
  useWallet: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = {
      publicKey: null,
      pending: false,
      mode: 'wallet',
      hotAccounts: [],
      hotActiveId: null,
      hotUnlocked: false,
      telegramCloudSynced: false,
      walletModalOpen: false,
      walletModalView: 'connect',
      demoAccounts: [],
      demoActive: 0,
      demoPending: false,
      hydrateFromTelegramCloud: vi.fn(),
      openWalletModal: vi.fn(),
      closeWalletModal: vi.fn(),
      selectDemo: vi.fn(),
      addDemoAccount: vi.fn(),
      startDemo: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      getSigner: () => null,
      requireSignerOrPrompt: () => null,
    }
    return selector ? selector(state) : state
  },
}))

import { CreateTokenForm } from '../components/CreateTokenForm'
import { WalletButton } from '../components/WalletButton'
import { DexPage } from './DexPage'
import { DocsPage } from './DocsPage'
import { HomePage } from './HomePage'
import { PortfolioPage } from './PortfolioPage'
import { SorobitsPage } from './SorobitsPage'
import {
  computeLivePilotXp,
  formatCollectorTrait,
  nextTierProgress,
} from '../lib/sorobits'

function renderWithProviders(element: ReactElement, initialEntry = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  })
  return renderToString(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        MemoryRouter,
        { initialEntries: [initialEntry] },
        element,
      ),
    ),
  )
}

describe('Page Components and Lifecycle', () => {
  describe('Minimalist Market, Launch & Portfolio Flows', () => {
    it('renders Pump.fun-style market view and Launch Coin CTA', () => {
      const html = renderWithProviders(createElement(HomePage))
      expect(html).toContain('Memecoin Market')
      expect(html).toContain('Launch Coin')
      expect(html).toContain('Search by name')
      expect(html).toContain('Fair')
    })

    it('renders dedicated /dex Soroswap Graduated Market page', () => {
      const html = renderWithProviders(createElement(DexPage), '/dex')
      expect(html).toContain('Soroswap DEX Market')
      expect(html).toContain('7-Year LP Lock')
      expect(html).toContain('Graduated Tokens')
    })

    it('renders PortfolioPage with 1-click Testnet Demo & Wallet CTAs when disconnected', () => {
      const html = renderWithProviders(createElement(PortfolioPage), '/portfolio')
      expect(html).toContain('Your Portfolio')
      expect(html).toContain('Testnet Demo (10k XLM)')
      expect(html).toContain('Connect / Create Wallet')
      expect(html).not.toContain('Go to Demo Mode')
    })

    it('renders CreateTokenForm with 7 XLM fee, Demo & Wallet CTAs', () => {
      const html = renderWithProviders(createElement(CreateTokenForm), '/create')
      expect(html).toContain('Create &amp; Launch')
      expect(html).toContain('7<!-- --> XLM network maintenance fee')
      expect(html).toContain('Testnet Demo')
      expect(html).toContain('Connect / Create Wallet')
    })

    it('renders WalletButton with Demo and Wallet buttons', () => {
      const html = renderWithProviders(createElement(WalletButton))
      expect(html).toContain('Demo')
      expect(html).toContain('Wallet')
    })

    it('renders SorobitsPage with top 3-step onboarding, Sync XP explanation, and 7 Cosmic Realms lore', () => {
      const html = renderWithProviders(createElement(SorobitsPage), '/sorobits')
      expect(html).toContain('Claim Free Sorobit')
      expect(html).toContain('Mint Mystery Capsule')
      expect(html).toContain('7 XLM')
      expect(html).toContain('Forge Next Generation')
      expect(html).toContain('What is Sync XP?')
      expect(html).toContain('7 Cosmic Realms')
      expect(html).toContain('Horizon Starlight')
      expect(html).toContain('Prism Aurora')
      expect(html).not.toContain('2019 Orbital AMM')
      expect(html).not.toContain('Season-1 Genesis Archetypes')
      expect(html).not.toContain('/badges/')
    })

    it('maps collector traits, calculates live Launchpad XP, and tracks shield tier progress', () => {
      expect(formatCollectorTrait('Faction', 'Soroswap Jade')).toBe(
        'Emerald Orbit',
      )
      expect(formatCollectorTrait('Suit', 'LedgerSquare')).toBe(
        'Starlight Vanguard',
      )
      expect(formatCollectorTrait('TTL Shield', 'SovereignTTL')).toBe(
        'Solar Gold Shield (T2)',
      )
      expect(
        computeLivePilotXp(
          {
            launches: 1,
            graduations: 0,
            trades: 3,
            shouts: 1,
            kingShouts: 0,
            burnsTriggered: 0,
          },
          2,
        ),
      ).toBe(2 * 150 + 250 + 3 * 50 + 100)
      const prog = nextTierProgress(350, 1)
      expect(prog.currentTierName).toBe('Bronze Guardian')
      expect(prog.nextTierName).toBe('Solar Gold Shield')
      expect(prog.xpToNext).toBe(150)
      expect(prog.progressPct).toBe(50)
    })

    it('renders DocsPage with protocol lifecycle, audits, Stellar best practices, REST API and MCP', () => {
      const html = renderWithProviders(createElement(DocsPage), '/docs')
      expect(html).toContain('AstroGate Developer, Audit')
      expect(html).toContain('Security Hardening')
      expect(html).toContain('/api/v1/tokens')
      expect(html).toContain('NunaLabs')
      expect(html).toContain('mcpServers')
    })
  })

  describe('ErrorBoundary and Fallbacks', () => {
    it('renders PageErrorFallback with retry and error message', () => {
      const html = renderToString(
        createElement(PageErrorFallback, {
          error: new Error('Test RPC failure'),
          onRetry: vi.fn(),
        }),
      )
      expect(html).toContain('Unable to display this view')
      expect(html).toContain('Test RPC failure')
      expect(html).toContain('Retry view')
    })

    it('renders children when no error occurs in ErrorBoundary', () => {
      const html = renderToString(
        createElement(
          ErrorBoundary,
          null,
          createElement('div', null, 'Normal content'),
        ),
      )
      expect(html).toContain('Normal content')
    })
  })

  describe('ScrollToTop', () => {
    it('renders in a router without errors', () => {
      const html = renderToString(
        createElement(
          MemoryRouter,
          { initialEntries: ['/market'] },
          createElement(ScrollToTop),
        ),
      )
      expect(html).toBe('')
    })
  })
})
