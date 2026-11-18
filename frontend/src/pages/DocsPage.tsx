import { useEffect } from 'react'
import { Link } from 'react-router'
import { useCopy } from '../hooks/useCopy'
import { explorerContractUrl } from '../lib/explorer'
import {
  ASTRO_TOKEN_ID,
  DEVELOPER_TREASURY_ADDRESS,
  HORIZON_URL,
  LAUNCHPAD_CONTRACT_ID,
  NETWORK_NAME,
  RPC_URL,
  SOROBITS_CONTRACT_ID,
  SOROSWAP_FACTORY,
  SOROSWAP_ROUTER,
  XLM_SAC,
} from '../lib/network'
import { STELLAR_BURN_ADDRESS } from '../lib/tokenomics'

const GITHUB_ORG_URL = 'https://github.com/NunaLabsDev/astrogate'

const API_ENDPOINTS = [
  {
    method: 'GET',
    path: '/api/v1/health',
    desc: 'Network, live contract IDs, fee bps, anti-MEV limits, and Fair-Flywheel v4.3 constants.',
  },
  {
    method: 'GET',
    path: '/api/v1/tokens',
    desc: 'Live bonding curves and graduated Soroswap DEX pairs with XLM reserves.',
  },
  {
    method: 'GET',
    path: '/api/v1/tokens/:id',
    desc: 'Token metadata, curve vault progress, burn vault stage, King Shout, and recent shouts.',
  },
  {
    method: 'GET',
    path: '/api/v1/tokens/:id/audit',
    desc: 'Automated on-chain check: renounced ownership, Fair-Flywheel registry, LP blackhole lock.',
  },
  {
    method: 'GET',
    path: '/api/v1/tokens/:id/quote?amountIn=50000000&direction=buy&slippage=2',
    desc: 'Deterministic buy/sell quote on Bonding Curve or Soroswap AMM.',
  },
  {
    method: 'GET',
    path: '/api/v1/sorobits',
    desc: 'Sorobits SEP-50 NFT supply, Genesis minted count, RLE render limits, and archetypes.',
  },
  {
    method: 'GET',
    path: '/api/v1/wallet/resolve?q=@username',
    desc: 'Resolves a Telegram @username, numeric user ID, or Stellar G... address to its linked primary wallet.',
  },
  {
    method: 'POST',
    path: '/api/v1/wallet/link',
    desc: 'Binds a Telegram @username / initData to self-custodial Stellar wallet(s) via Ed25519 signature.',
  },
  {
    method: 'GET',
    path: '/api/v1/wallet/vault',
    desc: 'Returns the authenticated Telegram user AES-GCM encrypted AGVAULT1 bundle and link metadata.',
  },
  {
    method: 'GET',
    path: '/openapi.json',
    desc: 'OpenAPI 3.1 machine specification for clients, SDK generators, and AI agents.',
  },
] as const

const AUDITED_CONTROLS = [
  {
    badge: 'CRITICAL · CONTRACTS',
    title: 'Pre-Graduation Pool Griefing Fix (C-01)',
    detail:
      'seed_soroswap_and_burn_lp inspects pair.total_supply() > 0 || (r0 > 0 && r1 > 0) alongside pre-graduation P2P transfer lock, preventing 1-stroop pair.sync() DoS while blocking LP dilution.',
  },
  {
    badge: 'HIGH · CONTRACTS',
    title: 'Anti-MEV Buyback Chunking & Cooldown (H-01)',
    detail:
      'Permissionless DEX buyback-and-burn swaps are capped at 0.50% (50 bps) of pool XLM reserve per call with a 300-second cooldown per token, preventing sandwich extraction.',
  },
  {
    badge: 'HIGH · CONTRACTS',
    title: 'Reentrancy Lock & CEI Curve Accounting',
    detail:
      'execute_curve_buy persists CurveState before external token/XLM transfers and holds a temporary ReentrancyLock; set_paused pauses only new launches while keeping user sells and claims open.',
  },
  {
    badge: 'HIGH · CRYPTO VAULT',
    title: 'Native Wallet AEAD + @username Ed25519 Link',
    detail:
      'Client-side PBKDF2-SHA256 (210k) + AES-GCM-256 vault binds publicKey as AAD, supports up to 10 sub-wallets with Primary @username routing via anti-replay Ed25519 proofs, portable AGVAULT1: sync, and exportable S... keys.',
  },
  {
    badge: 'MEDIUM · SEP-50 NFTS',
    title: 'Bounded On-Chain SVG Renderer',
    detail:
      'Sorobits register_layer rejects dense RLE bitmaps above 720 runs or 12,800 SVG bytes and extends Season asset TTLs automatically on extend_token_ttl and compose_for_token.',
  },
  {
    badge: 'MEDIUM · TELEGRAM WORKER',
    title: 'HMAC InitData, KV Dedupe & Feed-Only Routing',
    detail:
      'Automated on-chain broadcasts route exclusively to @AstroGateFeed with anti-dust filtering (>= 2 XLM or >= 80% push). Webhook uses SHA-256 constant-time secret verification and AGQ05 validates Soroban balances.',
  },
] as const

const STELLAR_PRACTICES = [
  {
    title: '1. State Archival & TTL Extension',
    body: 'Soroban ledger entries expire when TTL reaches zero. AstroGate extends instance, persistent curve, token TotalSupply, and Sorobits season asset TTLs via extend_ttl(), extend_launch_ttl(), and keepalive cron scripts.',
  },
  {
    title: '2. Fresh Simulation Before Submission',
    body: 'Every contract invocation runs simulateTransaction first to derive exact resource footprints, auth entries, and refundable resource fees — never hardcoded.',
  },
  {
    title: '3. Event Retention & Multi-RPC Failover',
    body: 'Stellar RPC retains ~7 days of getEvents history. Discovery queries use ordered failover across primary/fallback RPC nodes, and DEX quotes verify token_0()/get_reserves() directly on each pair contract.',
  },
  {
    title: '4. SEP-41 & SEP-50 Standards + Account Reserves',
    body: 'Tokens extend OpenZeppelin Stellar Capped Burnable SEP-41; NFTs follow SEP-50; client forms read Horizon subentry_count, sponsorships, and selling_liabilities so users never break minimum XLM base reserves.',
  },
] as const

const MCP_CONFIG_SNIPPET = `{
  "mcpServers": {
    "astrogate": {
      "command": "node",
      "args": ["frontend/scripts/mcp-server.mjs"],
      "env": {
        "STELLAR_NETWORK": "${NETWORK_NAME}"
      }
    }
  }
}`

const SDK_SNIPPET = `import {
  getMarketTokens,
  quoteSwap,
  verifyAntiRug,
  checkRpcHealth,
} from './src/sdk'

const health = await checkRpcHealth()
const market = await getMarketTokens({ maxTokens: 20 })
const audit = await verifyAntiRug(market[0].id)
const quote = await quoteSwap({
  tokenId: market[0].id,
  amountIn: 50_000_000n, // 5 XLM (7 decimals)
  direction: 'buy',
  slippagePercent: 2,
})`

function CopySnippet({ title, code }: { title: string; code: string }) {
  const { copied, copy } = useCopy()
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/90 overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-800/80 px-3.5 py-2 text-xs">
        <span className="font-mono font-semibold text-slate-300">{title}</span>
        <button
          type="button"
          onClick={() => void copy(code)}
          className="min-h-[30px] rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-sky-300 hover:border-sky-500/60"
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 text-xs font-mono text-slate-200 leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  )
}

export function DocsPage() {
  useEffect(() => {
    document.title = 'Docs, Audits & Developer API — AstroGate'
  }, [])

  return (
    <div className="space-y-6">
      {/* Hero Header */}
      <section className="liquid-glass rounded-3xl p-5 sm:p-7 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-950/40 px-3 py-1 text-xs font-semibold text-emerald-300">
              <span>📘 Open Source · NunaLabs</span>
              <span aria-hidden="true">·</span>
              <span className="uppercase">{NETWORK_NAME} Live</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              AstroGate Developer, Audit &amp; Protocol Hub
            </h1>
            <p className="max-w-3xl text-sm text-slate-300 leading-relaxed">
              Understand every mechanism on-chain, inspect hardened security invariants, connect autonomous AI agents via{' '}
              <strong className="text-sky-300">MCP</strong> or <strong className="text-sky-300">REST API</strong>, and verify contracts directly on Stellar Soroban.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={GITHUB_ORG_URL}
              target="_blank"
              rel="noreferrer"
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2 text-xs font-bold text-slate-950 hover:bg-slate-200 transition"
            >
              Open Source (NunaLabs) ↗
            </a>
            <a
              href="/llms.txt"
              target="_blank"
              rel="noreferrer"
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-xs font-bold text-sky-300 hover:bg-sky-500/20 transition"
            >
              /llms.txt ↗
            </a>
            <a
              href="/llms-full.txt"
              target="_blank"
              rel="noreferrer"
              className="min-h-[40px] inline-flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/10 px-4 py-2 text-xs font-bold text-purple-300 hover:bg-purple-500/20 transition"
            >
              /llms-full.txt ↗
            </a>
          </div>
        </div>

        <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 px-4 py-3 text-xs text-amber-200">
          <strong>Audit Transparency:</strong> All contracts, client crypto modules, and Worker endpoints have undergone internal security hardening and automated test suites (59 Rust contract tests + 217 Vitest specs). External third-party audit is pending prior to Mainnet deployment — currently active on <strong>Stellar Testnet</strong>.
        </div>
      </section>

      {/* How the System Works (For Everyday Users & Traders) */}
      <section className="rounded-3xl border border-slate-800 bg-slate-900/50 p-5 sm:p-6 space-y-4">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-white">
            1. How AstroGate Fair-Flywheel v4.3 Works
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            End-to-end lifecycle from atomic token creation to 7-year time-locked Soroswap liquidity.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-1.5">
            <span className="text-xs font-mono font-bold text-sky-400">STEP 1 · LAUNCH</span>
            <h3 className="text-sm font-bold text-white">Atomic Fair Mint</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              10,000,000 fixed supply minted with immediate <code className="text-sky-300">renounce_ownership()</code>. Creation costs 7 XLM + minimum 2 XLM initial curve seed (locked until graduation or 7d fallback).
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-1.5">
            <span className="text-xs font-mono font-bold text-emerald-400">STEP 2 · BONDING CURVE</span>
            <h3 className="text-sm font-bold text-white">66% Virtual Curve</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              6.6M tokens trade along a deterministic 1,000 vXLM → 1,000 XLM curve (4.00× range). Flat 0.80% buy fee; 2.50%→1.50% sell fee; P2P transfers remain locked until graduation.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-1.5">
            <span className="text-xs font-mono font-bold text-amber-400">STEP 3 · GRADUATION</span>
            <h3 className="text-sm font-bold text-white">33% DEX + 7Y LP Lock</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              At 1,000 real XLM, 3.3M tokens + 1,000 XLM seed Soroswap (0% price cliff) with LP locked in-contract for 7 years, 0.7% ecosystem allocation sent to treasury, and P2P transfers unlock.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-1.5">
            <span className="text-xs font-mono font-bold text-purple-400">STEP 4 · FLYWHEEL</span>
            <h3 className="text-sm font-bold text-white">Organic Burns &amp; Vesting</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Zero idle burn waste: real supply burns via chunked DEX buybacks (0.50% cap / 300s cooldown) and Burn-to-Chat shouts. Creators vest 0.3% (30K tokens) over 15 days.
            </p>
          </div>
        </div>
      </section>

      {/* Audited Security Controls */}
      <section className="rounded-3xl border border-slate-800 bg-slate-900/50 p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-white">
              2. Security Hardening &amp; Audited Invariants
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              Every issue identified during internal full-stack security reviews and verified by automated tests.
            </p>
          </div>
          <Link
            to="/market"
            className="text-xs font-semibold text-sky-400 hover:underline"
          >
            Inspect live tokens →
          </Link>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {AUDITED_CONTROLS.map((item) => (
            <div
              key={item.title}
              className="rounded-2xl border border-slate-800/90 bg-slate-950/75 p-4 space-y-1.5"
            >
              <span className="inline-block rounded-md bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-300">
                {item.badge}
              </span>
              <h3 className="text-sm font-bold text-white">{item.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{item.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Stellar & Soroban Best Practices */}
      <section className="rounded-3xl border border-slate-800 bg-slate-900/50 p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-white">
              3. Stellar &amp; Soroban Engineering Best Practices
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              Aligned with official{' '}
              <a
                href="https://developers.stellar.org/"
                target="_blank"
                rel="noreferrer"
                className="text-sky-400 underline underline-offset-2"
              >
                developers.stellar.org
              </a>{' '}
              guidelines for resilient dApps.
            </p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {STELLAR_PRACTICES.map((p) => (
            <div
              key={p.title}
              className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 space-y-1"
            >
              <h3 className="text-sm font-semibold text-sky-300">{p.title}</h3>
              <p className="text-xs text-slate-400 leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Public REST API, MCP Server & TypeScript SDK */}
      <section className="rounded-3xl border border-slate-800 bg-slate-900/50 p-5 sm:p-6 space-y-4">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-white">
            4. Public Read-Only REST API, MCP Server &amp; SDK
          </h2>
          <p className="text-xs sm:text-sm text-slate-400">
            Zero-auth endpoints for explorers, trading bots, AI auditors, and MCP-compatible IDEs.
          </p>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/80">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-800 text-slate-400">
              <tr>
                <th className="px-3.5 py-2.5 font-mono">Method</th>
                <th className="px-3.5 py-2.5 font-mono">Endpoint</th>
                <th className="px-3.5 py-2.5">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {API_ENDPOINTS.map((ep) => (
                <tr key={ep.path}>
                  <td className="px-3.5 py-2.5 font-mono font-bold text-emerald-300">
                    {ep.method}
                  </td>
                  <td className="px-3.5 py-2.5 font-mono text-sky-300 break-all">
                    {ep.path}
                  </td>
                  <td className="px-3.5 py-2.5 text-slate-300">{ep.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <CopySnippet
            title="MCP Server Config (Claude Desktop / Cursor / Antigravity)"
            code={MCP_CONFIG_SNIPPET}
          />
          <CopySnippet title="@astrogate/sdk (frontend/src/sdk/index.ts)" code={SDK_SNIPPET} />
        </div>
      </section>

      {/* Verified On-Chain Addresses */}
      <section className="rounded-3xl border border-slate-800 bg-slate-900/50 p-5 sm:p-6 space-y-3">
        <h2 className="text-lg font-bold text-white">
          5. Verified Contract &amp; Network Registry ({NETWORK_NAME})
        </h2>
        <div className="grid gap-2 text-xs font-mono">
          {[
            ['Launchpad v4.3', LAUNCHPAD_CONTRACT_ID, explorerContractUrl(LAUNCHPAD_CONTRACT_ID)],
            ['Sorobits SEP-50 NFTs', SOROBITS_CONTRACT_ID, explorerContractUrl(SOROBITS_CONTRACT_ID)],
            ['Genesis $ASTRO Token', ASTRO_TOKEN_ID, explorerContractUrl(ASTRO_TOKEN_ID)],
            ['Soroswap Factory', SOROSWAP_FACTORY, explorerContractUrl(SOROSWAP_FACTORY)],
            ['Soroswap Router', SOROSWAP_ROUTER, explorerContractUrl(SOROSWAP_ROUTER)],
            ['XLM SAC', XLM_SAC, explorerContractUrl(XLM_SAC)],
            ['LP Blackhole Address', STELLAR_BURN_ADDRESS, null],
            ['Treasury', DEVELOPER_TREASURY_ADDRESS, null],
            ['Soroban RPC', RPC_URL, null],
            ['Horizon API', HORIZON_URL, null],
          ].map(([label, value, href]) => (
            <div
              key={label}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800/80 bg-slate-950/70 px-3 py-2"
            >
              <span className="text-slate-400">{label}</span>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-300 hover:underline break-all"
                >
                  {value} ↗
                </a>
              ) : (
                <span className="text-slate-200 break-all">{value}</span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
