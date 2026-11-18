# AstroGate Frontend, Cloudflare Worker & Verification Scripts

React 19 + TypeScript + Vite SPA, Cloudflare Worker (`@AstroGateSorobanBot`, REST API `/api/v1/*`, MCP `/mcp`), read-only TypeScript SDK, and Stellar Testnet verification scripts for **AstroGate** (`https://github.com/NunaLabsDev/astrogate`).

---

## Directory Layout

- `src/`: React 19 UI, wallet kit & client-side AES-GCM Hot Wallet (`src/lib/hot-wallet/`), 1:1 Fair-Flywheel curve math (`src/lib/curve-math.ts`, `src/lib/tokenomics.ts`), Soroswap & Sorobits RPC clients, and `@astrogate/sdk` (`src/sdk/index.ts`).
- `worker/`: Cloudflare Worker runtime (`index.ts`), public read-only REST API (`api.ts`), JSON-RPC MCP endpoint (`mcp.ts`), protocol/audit engine (`protocol.ts`), Soroban RPC & event polling (`rpc.ts`, `events.ts`), Sorobits quest verification (`quests.ts`), and Telegram command views (`views.ts`).
- `scripts/`: Local stdio MCP server (`mcp-server.mjs`), SSR smoke render (`smoke-render.mjs`), PWA & CSP parity checks (`verify-pwa.mjs`, `check-csp.mjs`), npm audit ratchet (`npm-audit-ratchet.mjs`), Soroban contract bindings generator, and live Testnet verification scripts.
- `public/`: Static assets, `_headers` (CSP & cache policy), `sw.js`, `.well-known/stellar.toml`, `llms.txt`, and `llms-full.txt`.

---

## Development & Verification Commands

```bash
npm ci                                        # Install exact lockfile dependencies
npm run dev                                   # Start local Vite dev server (:5173, includes /docs)
npx tsc --noEmit -p tsconfig.worker.json      # Typecheck Cloudflare Worker + shared math
npm run check                                 # Full gate: build + oxlint + vitest + smoke:render + verify:pwa + check:csp
npm run mcp                                   # Launch local read-only stdio MCP server against Soroban RPC
```

### Live Testnet E2E Checks (No Secrets Required)

```bash
npm run verify:discovery      # Factory new_pair event parser & live pair discovery
npm run verify:token-events   # Live SEP-41 transfer/mint/burn event reads
npm run verify:demo           # 3 disposable Friendbot-funded accounts + end-to-end swap flow
```

---

## Key Invariants for Contributors

- Keep `src/lib/curve-math.ts` strictly free of Vite (`import.meta.env`) and DOM globals so both browser code and Cloudflare Worker share identical Fair-Flywheel v4.3 integer math.
- Keep HTTP Security Headers & CSP synchronized across `public/_headers`, `vercel.json`, and `nginx.conf` (enforced by `npm run check:csp`).
- Never store secrets, `VITE_*` private keys, or user tokens in frontend configuration.
