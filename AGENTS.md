# AGENTS.md — AstroGate (NunaLabsDev)

> Machine- and developer-facing repository onboarding guide for coding, auditing, and integration agents.
> Protocol status: **Stellar Testnet** (`Test SDF Network ; September 2015`). Read [docs/SESSION_HANDOFF.md](./docs/SESSION_HANDOFF.md), [AUDIT_GUIDE.md](./AUDIT_GUIDE.md), and [SECURITY.md](./SECURITY.md) before modifying contracts, crypto modules, or deployment configs.

---

## 1. Project Overview

**AstroGate** (`https://github.com/NunaLabsDev/astrogate`) is a zero-user-backend Fair-Flywheel v4.4 Launchpad, Soroswap AMM interface, Sorobits (SEP-50) on-chain `32x32` genomic pixel-art NFT platform, and Telegram Mini App / Bot (`@AstroGateSorobanBot`) built on **Stellar / Soroban**.

- **Smart Contracts (`contracts/`)**: Rust `1.99.1` (`rust-toolchain.toml`) + pinned Soroban SDK (`=28.0.0`) + OpenZeppelin Stellar (`stellar-tokens = "=0.8.0"`, SEP-41 & SEP-50).
- **Frontend & SDK (`frontend/src/`)**: Vite + React 19 + TypeScript + Tailwind + `@creit.tech/stellar-wallets-kit` + client-side AES-GCM Hot Vault + `@astrogate/sdk` (`src/sdk/index.ts`).
- **Cloudflare Worker, Public API & MCP (`frontend/worker/`, `frontend/scripts/mcp-server.mjs`)**: Telegram webhook/cron event streamer, read-only REST API (`/api/v1/*`, `/openapi.json`), and Model Context Protocol server (`POST /mcp` and local stdio `npm run mcp`).

---

## 2. Directory Map

| Path | Ownership & Purpose |
| :--- | :--- |
| `docs/SESSION_HANDOFF.md` | Cross-device next-session handoff, compiled vs live Testnet delta & bootstrap checklist |
| `rust-toolchain.toml` | Pinned Rust toolchain (`1.99.1`, `wasm32v1-none` target, `rustfmt`, `clippy`) |
| `contracts/launchpad/` | Fair-Flywheel v4.4 bonding curve (66/33/0.3/0.4 jackpots/0.3 dev), atomic Soroswap graduation, 7-year contract LP lock (`reclaim_expired_lp`), 48h upgrade timelocks, anti-MEV buyback-and-burn, 15d vesting, Burn-to-Chat shouts |
| `contracts/token/` | SEP-41 `Capped` + `FungibleBurnable` + `Ownable` token with typed `TokenError` (`#500..=#506`) and `lock_until_graduated` transfer lock |
| `contracts/sorobits/` | SEP-50 NFT contract with on-chain RLE `32x32` SVG renderer, 2-step commit-reveal RNG, 48h upgrade timelocks, `TokenXpBaseline` anti-XP-laundering, and epigenetic progression |
| `frontend/src/lib/curve-math.ts` | Runtime-agnostic bonding curve integer math (1:1 parity with `contracts/launchpad/src/contract.rs`) |
| `frontend/src/lib/tx-queue.ts` | Per-account serial transaction queue (`enqueueAccountTx`) to prevent Stellar sequence collisions |
| `frontend/src/lib/hot-wallet/` | Client-side `PBKDF2-SHA256` (210k) + `AES-GCM-256` vault (`publicKey` AAD, 6/12-char PINs, RAM zeroing, 15m idle lock) |
| `frontend/src/lib/network.ts` | Testnet/Mainnet presets, `IS_MAINNET` / `validateNetworkConfig()`, contract IDs, multi-RPC failover, network-scoped storage keys |
| `frontend/worker/` | Telegram bot (`@AstroGateSorobanBot`), KV event/pulse dedupe, IP rate limits, `/api/v1/*` REST API, and `/mcp` JSON-RPC server |
| `frontend/public/` | `llms.txt`, `llms-full.txt`, `_headers` (CSP & cache policy), `sw.js`, `.well-known/stellar.toml` |

---

## 3. Deterministic Build, Lint & Test Gates

Run **all** relevant gates after your final edit and report exact observed outputs:

```bash
# Smart contracts (astro-token WASM fixture must be built before Launchpad tests)
stellar contract build --package astro-token
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
stellar contract build

# Frontend & Cloudflare Worker
cd frontend
npm ci
npx tsc --noEmit -p tsconfig.worker.json
npm run check   # vite build + oxlint + vitest + smoke:render + verify:pwa + check:csp
node scripts/npm-audit-ratchet.mjs
```

Optional read-only / disposable Friendbot E2E verification against Stellar Testnet (no secrets needed):

```bash
cd frontend
npm run verify:discovery
npm run verify:token-events
npm run verify:demo
```

---

## 4. Critical Protocol & Security Invariants (Do Not Break)

1. **7-Decimal Precision**: Native XLM (`1 XLM = 10_000_000` stroops) and all AstroGate tokens use `7` decimals. Use `bigint` integer math—never floating-point arithmetic—for amounts, quotes, fees, and slippage.
2. **1:1 Bonding Curve Math Parity**: Any change to curve formulas or fees must keep exact integer parity across `contracts/launchpad/src/contract.rs` and `frontend/src/lib/curve-math.ts` (shared by `frontend/src/lib/tokenomics.ts` and `frontend/worker/protocol.ts`).
3. **Soroswap Integration Rules**:
   - Quote with `router_get_amount_out(amount_in, reserve_in, reserve_out)` (`router_get_amounts_out` does not quote).
   - Do not add unnecessary `approve`/allowance calls for Soroswap Router swaps (`transfer`-based).
   - Read `token_0()`, `token_1()`, and `get_reserves()` directly from each Soroswap Pair contract instead of assuming lexical token order.
   - Graduation checks `pair.total_supply() > 0 || (r0 > 0 && r1 > 0)` to resist 1-stroop unilateral `pair.sync()` griefing while still blocking pre-seeded LP dilution.
4. **Curve Lock, Commit-Reveal RNG & 48h Upgrade Timelocks**:
   - While `!graduated`, `contracts/token` blocks P2P `transfer` and `transfer_from` for non-gate callers while keeping `burn` and `burn_from` enabled for `burn_shout`.
   - Keep Launchpad & Sorobits 48-hour upgrade timelocks (`schedule_upgrade`/`cancel_upgrade`/`execute_upgrade`), pre-grad `CheckpointReward` escrow, and Sorobits commit-reveal RNG + `TokenXpBaseline` intact.
5. **Client Cryptography & Signing Safety**:
   - Never expose private keys outside `keypairStore` volatile memory; always serialize writes per account via `enqueueAccountTx` (`tx-queue.ts`) and validate Horizon reserves (`validateXlmReserve`) before prompting signatures; keep `selectDemo` disabled on Mainnet.
   - Keep `frontend/public/_headers`, `frontend/vercel.json`, and `frontend/nginx.conf` CSP directives synchronized (`npm run check:csp`, zero wildcard `*.workers.dev`).
6. **Telegram Bot & Channel Policy**:
   - Keep all `@AstroGateSorobanBot`, `@AstroGateCommunity`, and `@AstroGateFeed` text strictly in English.
   - Use internal Telegram Mini App deep links (`https://t.me/AstroGateSorobanBot?start=...`) inside Telegram buttons/messages.
   - Route automated event broadcasts strictly to `@AstroGateFeed` (`community: false` across all event kinds).

---

## 5. Contribution, Security & Trademark Rules

- **No Secrets**: Never commit `.env*`, `.secrets/`, Stellar secret seeds (`S...`), bot tokens, or Cloudflare tokens.
- **Keep `curve-math.ts` Pure**: Never import `import.meta.env`, `window`, or DOM APIs inside `frontend/src/lib/curve-math.ts`.
- **Vulnerability Disclosure**: Never open public GitHub issues for exploitable bugs. Report them privately via `https://github.com/NunaLabsDev/astrogate/security/advisories/new` (see [SECURITY.md](./SECURITY.md)).
- **Brand Protection**: Code is MIT-licensed ([LICENSE](./LICENSE)); AstroGate, NunaLabs, and Sorobits names, logos, and badge artwork are governed by [TRADEMARK.md](./TRADEMARK.md).
