/**
 * Smoke test de render: monta el árbol de componentes y lo serializa con
 * `react-dom/server`. No hace falta navegador (no hay ninguno disponible en
 * el entorno) y sirve para detectar errores de render en la UI.
 *
 * La wallet se sustituye por un stub: `@creit.tech/stellar-wallets-kit` solo
 * funciona en navegador y aquí solo queremos pintar el árbol.
 *
 * Uso: npm run smoke:render
 */
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fileURLToPath } from 'node:url'

/**
 * La wallet se sustituye por un stub: `@creit.tech/stellar-wallets-kit` solo
 * funciona en navegador y aquí solo queremos pintar el árbol.
 */
const walletsKitStub = fileURLToPath(
  new URL('./fixtures/wallets-kit-stub.ts', import.meta.url),
)

const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  resolve: {
    alias: [
      {
        find: /^@creit\.tech\/stellar-wallets-kit(\/.*)?$/,
        replacement: walletsKitStub,
      },
    ],
  },
})

let failed = false
try {
  const { default: App } = await vite.ssrLoadModule('/src/App.tsx')

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false } },
  })

  function renderApp(path) {
    return renderToString(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(
          MemoryRouter,
          { initialEntries: [path] },
          createElement(App),
        ),
      ),
    )
  }

  const html = renderApp('/')
  const checks = [
    'AstroGate',
    'Memecoin Market',
    'Launch Coin',
    'Demo',
    'Wallet',
  ]
  for (const text of checks) {
    if (!html.includes(text)) {
      throw new Error(`el render no contiene "${text}"`)
    }
  }

  const createHtml = renderApp('/create')
  if (
    !createHtml.includes('Launch Your Token') ||
    !createHtml.includes('10M fixed supply')
  ) {
    throw new Error('la ruta /create no muestra el formulario simplificado')
  }

  const marketHtml = renderApp('/market')
  if (
    !marketHtml.includes('Search by name') ||
    !marketHtml.includes('Sort by')
  ) {
    throw new Error('la ruta /market no muestra búsqueda y orden')
  }

  const dexHtml = renderApp('/dex')
  if (
    !dexHtml.includes('Soroswap DEX Market') ||
    !dexHtml.includes('7-Year LP Lock')
  ) {
    throw new Error('la ruta /dex no renderiza el mercado graduado Soroswap DEX')
  }

  const portfolioHtml = renderApp('/portfolio')
  if (
    !portfolioHtml.includes('Your Portfolio') ||
    !portfolioHtml.includes('Recent Activity') ||
    !portfolioHtml.includes('No activity recorded yet')
  ) {
    throw new Error('la ruta /portfolio no renderiza su actividad vacía')
  }

  const sorobitsHtml = renderApp('/sorobits')
  if (
    !sorobitsHtml.includes('Sorobits') ||
    !sorobitsHtml.includes('7 Cosmic Realms') ||
    !sorobitsHtml.includes('Claim Free Sorobit')
  ) {
    throw new Error('la ruta /sorobits no renderiza la colección Sorobits')
  }

  const docsHtml = renderApp('/docs')
  if (
    !docsHtml.includes('AstroGate Developer, Audit') ||
    !docsHtml.includes('/api/v1/health') ||
    !docsHtml.includes('developers.stellar.org')
  ) {
    throw new Error('la ruta /docs no renderiza la documentación de protocolo, auditoría y API/MCP')
  }

  const tokenHtml = renderApp('/token/CTOKEN')
  if (!tokenHtml.includes('Reading token')) {
    throw new Error('la ruta /token/:id no renderiza su estado de carga')
  }

  // El panel de liquidez solo aparece tras crear un token: se monta aparte.
  const { LiquidityForm } = await vite.ssrLoadModule(
    '/src/components/LiquidityForm.tsx',
  )
  const liquidityHtml = renderToString(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(LiquidityForm, {
        token: { id: 'CTOKEN', decimals: 7 },
      }),
    ),
  )
  if (!liquidityHtml.includes('Add Liquidity')) {
    throw new Error('el render de LiquidityForm no contiene "Add Liquidity"')
  }

  // Swap terminal render
  const { SwapCard } = await vite.ssrLoadModule('/src/components/SwapCard.tsx')
  const swapHtml = renderToString(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(SwapCard, {
        token: { id: 'CTOKEN', decimals: 7, symbol: 'TEST' },
      }),
    ),
  )
  if (!swapHtml.includes('Swap with XLM') || !swapHtml.includes('Buy with XLM')) {
    throw new Error('el render de SwapCard no contiene los controles de swap')
  }

  // On-Chain Burn-to-Chat render check
  const { TokenHypeBar } = await vite.ssrLoadModule(
    '/src/components/TokenHypeBar.tsx',
  )
  const hypeHtml = renderToString(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(TokenHypeBar, {
        tokenId: 'CTOKEN',
        symbol: 'TEST',
        decimals: 7,
      }),
    ),
  )
  if (
    !hypeHtml.includes('Burn-to-Chat') ||
    !hypeHtml.includes('King Shout') ||
    (!hypeHtml.includes('Burn &amp; Shout') && !hypeHtml.includes('Connect to Shout'))
  ) {
    throw new Error('el componente TokenHypeBar no renderiza Burn-to-Chat')
  }

  // Arte generativo: spec variado por contrato + SVG renderizado.
  const { tokenArtSpec } = await vite.ssrLoadModule('/src/lib/art.ts')
  const specA = tokenArtSpec('CBASE1000')
  const specB = tokenArtSpec('COTRO2000')
  if (
    specA.seed === specB.seed ||
    specA.from === specA.to ||
    specA.shapes.length !== 3 ||
    specB.shapes.length !== 3
  ) {
    throw new Error('el spec del arte no es válido o determinista por hash')
  }
  if (tokenArtSpec('CBASE1000').seed !== specA.seed) {
    throw new Error('el arte no es determinista para el mismo contrato')
  }
  const { TokenArt } = await vite.ssrLoadModule('/src/components/TokenArt.tsx')
  const artHtml = renderToString(
    createElement(TokenArt, { id: 'CBASE1000', symbol: 'MOON' }),
  )
  if (!artHtml.includes('MOON') || !artHtml.includes('linearGradient')) {
    throw new Error('el SVG del arte no renderiza el monograma')
  }

  // Retiro de liquidez: reparto proporcional de reservas + guarda sin wallet.
  const soroswap = await vite.ssrLoadModule('/src/lib/soroswap.ts')
  const preview = soroswap.withdrawPreview(
    { totalSupply: 1000n, reserveToken: 5000n, reserveXlm: 2500n },
    250n,
  )
  if (preview.tokenAmount !== 1250n || preview.xlmAmount !== 625n) {
    throw new Error('withdrawPreview no reparte las reservas en proporción')
  }
  if (soroswap.lpSharePercent(250n, 1000n) !== 25) {
    throw new Error('lpSharePercent no calcula la parte del pool')
  }
  const { LiquidityPosition } = await vite.ssrLoadModule(
    '/src/components/LiquidityPosition.tsx',
  )
  const positionHtml = renderToString(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(LiquidityPosition, { token: { id: 'CTOKEN', decimals: 7 } }),
    ),
  )
  if (positionHtml !== '') {
    throw new Error('LiquidityPosition sin wallet debería no pintar nada')
  }

  // Gráfico local: renderiza sin navegador y no promete un histórico global.
  const { ReserveChart } = await vite.ssrLoadModule(
    '/src/components/ReserveChart.tsx',
  )
  const chartHtml = renderToString(
    createElement(ReserveChart, {
      snapshots: [
        {
          t: Date.parse('2026-11-01T10:00:00Z'),
          xlm: '10000000',
          token: '100000000',
        },
        {
          t: Date.parse('2026-11-01T10:05:00Z'),
          xlm: '12000000',
          token: '100000000',
        },
      ],
      decimals: 7,
      symbol: 'MOON',
    }),
  )
  if (
    !chartHtml.includes('Pair History') ||
    !chartHtml.includes('<svg') ||
    !chartHtml.includes('MOON')
  ) {
    throw new Error('el gráfico de reservas no renderiza')
  }

  // Launchpad CurveStoryChart SSR render check
  const { CurveStoryChart } = await vite.ssrLoadModule(
    '/src/components/CurveStoryChart.tsx',
  )
  const curveStoryHtml = renderToString(
    createElement(CurveStoryChart, {
      curve: {
        token: 'CTOKEN',
        creator: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        graduated: false,
        graduated_at: 0n,
        pair: null,
        lp_minted: 0n,
        curve_xlm_net: 3_000_000_000n,
        real_xlm_vault: 3_050_000_000n,
        tokens_sold: 2_000_000_000_000n,
        buyback_xlm_reserve: 0n,
        burn_vault_remaining: 0n,
        burn_milestone_stage: 0,
        creator_vesting_total: 300_000_000_000n,
        creator_claimed: 0n,
        creator_seed_locked: 100_000_000_000n,
      },
      decimals: 7,
      symbol: 'MOON',
    }),
  )
  if (
    !curveStoryHtml.includes('Closed Launchpad Arena') ||
    !curveStoryHtml.includes('40K ladder') ||
    !curveStoryHtml.includes('MOON')
  ) {
    throw new Error('CurveStoryChart no renderiza')
  }

  // Animated RewardCelebrationModal SSR render check
  const { RewardCelebrationModal } = await vite.ssrLoadModule(
    '/src/components/RewardCelebrationModal.tsx',
  )
  const celebrationHtml = renderToString(
    createElement(
      MemoryRouter,
      { initialEntries: ['/token/CTOKEN'] },
      createElement(RewardCelebrationModal, {
        symbol: 'MOON',
        onClose: () => {},
        celebration: {
          graduated: true,
          rewardTokens: 25_000,
          boughtTokensFormatted: '150,000',
          spentXlmFormatted: '50',
          wonSpark: false,
          wonCrown: false,
          wonGrad: true,
          reasonTitle: '🎓 Graduated $MOON to Soroswap DEX!',
          reasonDetail: 'Your 50 XLM buy completed 1,000 XLM and unlocked Soroswap AMM.',
        },
      }),
    ),
  )
  if (
    !celebrationHtml.includes('+25,000 $MOON') ||
    !celebrationHtml.includes('/badges/pioneer.png') ||
    !celebrationHtml.includes('Graduated $MOON to Soroswap DEX')
  ) {
    throw new Error('RewardCelebrationModal no renderiza correctamente')
  }

  console.log(
    `render OK (${html.length} + ${createHtml.length} + ${marketHtml.length} + ${dexHtml.length} + ${portfolioHtml.length} + ${tokenHtml.length} + ${liquidityHtml.length} + ${hypeHtml.length} + ${artHtml.length} + ${chartHtml.length} + ${curveStoryHtml.length} + ${celebrationHtml.length} chars) · rutas y componentes`,
  )
} catch (err) {
  failed = true
  console.error('FALLO:', err?.stack?.slice(0, 1200) ?? err)
} finally {
  await vite.close()
}

process.exit(failed ? 1 : 0)
