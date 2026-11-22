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
import { SorobitEvolutionModal } from '../components/SorobitEvolutionModal'
import { TelegramLandingGate } from '../components/TelegramLandingGate'
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

    it('renders SorobitEvolutionModal for sync evolution and Astral Forge with real before/after diffs', () => {
      const sampleImg = 'data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E'
      const baseItem = {
        tokenId: 4,
        owner: 'GDQT2KMQ5I2EFDK3WG42YBHRIC4B7OXL7K2G3IC2Z6LPTJEEOMXD7NQE',
        name: 'Sorobit #4',
        edition: 0,
        generation: 0,
        rankTier: 0,
        xpScore: 100,
        bornLedger: 5000,
        soulbound: false,
        svgMarkup: '<svg></svg>',
        imageDataUrl: sampleImg,
        animatedDataUrl: sampleImg,
        attributes: [
          { trait_type: 'Faction', value: 'Soroswap Jade' },
          { trait_type: 'Frame', value: 'OriginHUD' },
          { trait_type: 'Suit', value: 'LedgerSquare' },
        ],
      }
      const evolvedItem = {
        ...baseItem,
        rankTier: 2,
        xpScore: 650,
        attributes: [
          { trait_type: 'Faction', value: 'Soroswap Jade' },
          { trait_type: 'Frame', value: 'SovereignTTL' },
          { trait_type: 'Suit', value: 'LedgerSquare' },
        ],
      }
      const perks = {
        chatTitle: '🎓 Soroswap Graduate',
        sprintMultiplier: '1.25x',
        feedPriority: true,
        vipAlphaAccess: true,
      }

      const anticipateHtml = renderToString(
        createElement(SorobitEvolutionModal, {
          reveal: { kind: 'sync', before: baseItem, after: evolvedItem, perks },
          initialPhase: 'anticipate',
          onClose: vi.fn(),
        }),
      )
      expect(anticipateHtml).toContain('What? Sorobit #4 is evolving!')
      expect(anticipateHtml).toContain('Skip Animation')

      const syncHtml = renderToString(
        createElement(SorobitEvolutionModal, {
          reveal: {
            kind: 'sync',
            before: baseItem,
            after: evolvedItem,
            perks,
            txHash: 'a'.repeat(64),
          },
          initialPhase: 'revealed',
          onClose: vi.fn(),
        }),
      )
      expect(syncHtml).toContain('Sorobit #4 Evolved!')
      expect(syncHtml).toContain('OriginHUD')
      expect(syncHtml).toContain('SovereignTTL')
      expect(syncHtml).toContain('+550 XP')
      expect(syncHtml).toContain('Solar Gold Shield')
      expect(syncHtml).toContain('Replay')

      const forgeChild = {
        ...evolvedItem,
        tokenId: 9,
        generation: 1,
        rankTier: 3,
        xpScore: 700,
      }
      const forgeHtml = renderToString(
        createElement(SorobitEvolutionModal, {
          reveal: {
            kind: 'forge',
            parents: [baseItem, { ...baseItem, tokenId: 5 }],
            after: forgeChild,
            perks,
          },
          initialPhase: 'revealed',
          onClose: vi.fn(),
        }),
      )
      expect(forgeHtml).toContain('Astral Forge Complete')
      expect(forgeHtml).toContain('Gen 1 Ascended')
      expect(forgeHtml).toContain('+500 Forge Bonus XP')
      expect(forgeHtml).toContain('+1 Capsule Slot Freed')
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

  describe('TelegramLandingGate', () => {
    it('renders presentation landing gate with Telegram deep links and session notices', () => {
      const defaultHtml = renderToString(
        createElement(TelegramLandingGate, { pathname: '/sorobits' }),
      )
      expect(defaultHtml).toContain('Open AstroGate in Telegram')
      expect(defaultHtml).toContain('https://t.me/AstroGateSorobanBot?start=sorobits')
      expect(defaultHtml).toContain('Fair-Flywheel v4.5 Curves')
      expect(defaultHtml).toContain('/.well-known/stellar.toml')

      const expiredHtml = renderToString(
        createElement(TelegramLandingGate, {
          pathname: '/',
          sessionNotice: 'expired',
        }),
      )
      expect(expiredHtml).toContain('Your Telegram session expired')
      expect(expiredHtml).toContain('Reopen in Telegram')

      const networkErrHtml = renderToString(
        createElement(TelegramLandingGate, {
          pathname: '/market',
          sessionNotice: 'network_error',
          onRetry: vi.fn(),
        }),
      )
      expect(networkErrHtml).toContain('Retry Verification')
      expect(networkErrHtml).toContain('https://t.me/AstroGateSorobanBot?start=market')
    })
  })
})
