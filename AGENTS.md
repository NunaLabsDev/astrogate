# AGENTS.md — AstroGate

Launchpad + AMM + Sorobits SEP-50 collectibles on **Stellar / Soroban Testnet**.
- **Brand**: **AstroGate** — single source `frontend/src/lib/brand.ts` (example token `$ASTRO` stays unchanged).
- **Stack**: Rust + Soroban SDK `28.0.0` + OpenZeppelin Stellar `0.8.0` · Soroswap AMM · Vite + React 19 + TypeScript · Cloudflare Pages (`https://astrogate.pages.dev`) + Worker `astrogate-stellar` (`ASTROW` Service Binding).
- **Wallet**: Native self-custodial Hot Wallet (`PBKDF2-SHA256` + `AES-GCM-256`, `CloudStorage` / `AGVAULT1:` sync, `@username` Ed25519 link); `@creit.tech/stellar-wallets-kit` remains in dependencies/fallback signer.
- **GitHub Origin**: `https://github.com/NunaLabsDev/astrogate.git` (`NunaLabsDev` org / `KawsayRuraq`). Public exports must run via `./scripts/prepare-opensource-export.sh` (never push to legacy `ruwaq/astro-launchpad`).

## Non-Negotiable Invariants
1. **Use Soroswap AMM**: Never reimplement an AMM; use Soroswap factory/router (see `.agents/rules/soroswap-traps.md`).
2. **Wallet = Identity**: Ed25519 wallet signatures only; no JWTs, sessions, or user auth backend.
3. **Network-First Data**: Read balances, reserves, and events directly from Soroban RPC / Horizon; user flows must never depend on local Postgres/Redis (optional dev-only).
4. **Testnet-Only Safety**: Default to Stellar Testnet. Demo accounts use disposable Friendbot keys in `localStorage`. Never commit `.secrets/`, `.env*`, or `S...` seeds; never treat testnet code as mainnet-audited.
5. **Telegram 100% EN + Internal Links**: `@AstroGateSorobanBot`, `@AstroGateCommunity`, and `@AstroGateFeed` must stay strictly English and use internal `https://t.me/AstroGateSorobanBot?start=...` links (never `https://astrogate.pages.dev/...` in chats/buttons, so `Telegram.WebApp.CloudStorage` stays intact). Automated alerts broadcast ONLY to `@AstroGateFeed` (`community: false`).
6. **Contract / Frontend Parity**: Keep `contracts/launchpad/src/contract.rs` 1:1 with `frontend/src/lib/tokenomics.ts` and `curve-math.ts`.
7. **No Sleep Loops**: Never use `sleep` polling for builds or background jobs; run background + single-shot verification (`pgrep`, `ls`, `curl`).

## Verified Commands
- **Toolchain**: Require `stellar` CLI `>=28.1` (tested `30.0.1`; do not use legacy `soroban` `23.x`). Verify `stellar --version` (on macOS Homebrew/Cargo, ensure `/opt/homebrew/bin` or `~/.cargo/bin` is in `PATH`).
- **Smart Contracts (root)**:
  - `stellar contract build --package astro-token` *(required WASM fixture before launchpad tests)*
  - `cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
  - `stellar contract build` *(target `wasm32v1-none`)*
- **Frontend & Worker (`cd frontend`)**:
  - `npm run dev` *(:5173)* · `npx tsc --noEmit -p tsconfig.worker.json`
  - `npm run check` *(build + `oxlint` + `vitest` + `smoke:render` + `verify:pwa` + `check:csp`)*
  - `npm run bindings` · `npm run mcp` *(local read-only stdio MCP)*
- **Live Testnet Checks (`cd frontend`)**:
  - No secret needed: `npm run verify:discovery` · `npm run verify:token-events` · `npm run verify:demo`
  - Requires `STELLAR_SECRET`: `npm run verify:launchpad` · `npm run verify:soroswap` · `npm run verify:frontend` · `npm run verify:adversarial`

## Documentation & Progressive Rules
- Index of all docs (with freshness & line counts): @docs/INDEX.md
- Testnet contract IDs, WASM hashes, accounts & v4.4/v4.5 notes: @docs/CONTRACTS_AND_NETWORK.md
- Task-specific rules live in `.agents/rules/` (`soroswap-traps.md`, `telegram-bot-policy.md`); local Soroban MCP is configured in `.agents/mcp_config.json`.
