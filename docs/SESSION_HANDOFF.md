# AstroGate Cross-Device Session Handoff

> Canonical continuity guide for resuming AstroGate development, security auditing, and Testnet/Mainnet deployment workflows from any workstation.
> Last synchronized: **2026-11-19** · **Network Status:** Stellar Testnet (`Test SDF Network ; September 2015`).

---

## 1. Session Snapshot (2026-11-19 · Security Hardening F-01..F-22 & Upstream Sync)

Upstream `origin/main` updates (Pages Functions, PWA service worker API bypasses, Sorobits evolution modal, and Telegram worker/bot views) are merged cleanly with full end-to-end security hardening across contracts, worker, client cryptography, frontend, CSP, and build determinism:

### Smart Contracts (`contracts/`)
- **`contracts/token` (`astro-token`)**:
  - Replaced all raw `panic!`/`expect` paths in production execution with typed `TokenError` (`#500..=#506`) via `panic_with_error!`.
  - Added `TransfersLockedEvent` and `TransfersUnlockedEvent` observability around `lock_until_graduated` and `unlock_transfers`.
- **`contracts/launchpad` (`astro-launchpad-contract`)**:
  - Added constructor input validation and `StorageVersion = 1`.
  - Replaced direct WASM upgrades with mandatory 48-hour timelocked `schedule_upgrade` / `cancel_upgrade` / `execute_upgrade` plus pure read getters `get_pending_upgrade` and `get_storage_version`.
  - Added `cancel_admin_transfer` and governance events (`PausedChangedEvent`, `TreasuryUpdatedEvent`, `TokenWasmHashUpdatedEvent`, `CreationFeeUpdatedEvent`, `AdminTransferProposedEvent`, `AdminTransferAcceptedEvent`, `AdminTransferCancelledEvent`).
  - Unified `with_reentrancy_guard` across all state-mutating external-call entrypoints and enforced strict Checks-Effects-Interactions (CEI) ordering in `burn_shout` before external `burn`.
  - Escrowed pre-graduation Spark/Crown bonuses inside `DataKey::CheckpointReward(token, winner)` claimable post-graduation (`claim_checkpoint_reward`, `get_checkpoint_reward`, `extend_checkpoint_ttl`), preventing pre-graduation bonus extraction via `sell_curve`.
  - Hardened `refund_stalled_launch` and 30d `sweep_empty_curve_fees` when `zero_external_supply` holds: returns `curve_xlm_net` to the creator and sweeps only surplus dust to treasury without minting phantom unlocked tokens.
  - Enforced `creation_fee` collection in `launch_token`, scaled `burn_shout` tier thresholds by `10^decimals`, and gated `update_pilot` on `DataKey::Curve` existence.
  - Removed persistent TTL mutations (`bump_persistent`) from read-only getters; added `extend_pilot_ttl` and LP share balance / `BuybackLastTs` TTL extensions inside `extend_launch_ttl`.
  - Added `BUYBACK_MAX_ABSOLUTE_CHUNK_XLM` (`250 XLM`) cap per swap and `trigger_buyback_burn_min` slippage-protected buyback entrypoint with checked arithmetic.
- **`contracts/sorobits` (`astro-sorobits-contract`)**:
  - Replaced `ByteWriter` buffer overflow panic in `engine.rs` with explicit `overflow: bool` returning `Option<String>` (`SvgBudgetExceeded`).
  - Set `StorageVersion = 1` and 48-hour timelocked upgrades (`schedule_upgrade` / `cancel_upgrade` / `execute_upgrade`).
  - Enforced 2-step commit-reveal randomness (`commit_capsule`/`reveal_capsule`, `commit_forge`/`reveal_forge`, `InstantMintAllowed = false`) preventing same-ledger simulation sniping.
  - Added `TokenXpBaseline` snapshot on `transfer` and `transfer_from` to block XP laundering across accounts.
  - Bounded `set_capsule_fee` (`<= 1,000 XLM`) and `register_layer`/`register_palette` IDs (`<= 15`), required `is_season_sealed` in `set_active_season`, blocked `burn`/`burn_from` on soulbound badges, made SVG/URI/`get_sorobit` getters pure (`peek_record`), capped `tokens_of` at `50`, and added `extend_user_ttl`.

### Cloudflare Worker (`frontend/worker/`)
- Protected both `unameKey` and `uidKey` against unverified overwrites in `wallet.ts`, rejected `tgUserId > 0` without `verifiedTelegram`, and required Ed25519 `walletSignatures` for every secondary wallet.
- Added KV/memory IP rate limits (`POST /api/v1/wallet/link` `20/300s`, `POST /api/v1/logos` `10/600s`), upload `Origin` validation, anti-polyglot signature scan (`<svg`, `<script`, `<!doctype html`, `<html`, `<?php`, `javascript:`), and `Content-Security-Policy: default-src 'none'; sandbox` on served logos.
- Capped `/mcp` JSON-RPC batch arrays at `MAX_MCP_BATCH = 10` (`-32600`).
- Sanitized on-chain token `name`/`symbol` interpolated into `ai.ts` system prompts and restricted response links to internal `@AstroGateSorobanBot` deep links.
- Added KV deduplication (`pulse:tx:<hash>`, TTL `300s`) for `/api/telegram/pulse` and updated LP messaging to `"100% LP Locked 7Y"`.

### Frontend, Hot Wallet & CSP (`frontend/src/`, `frontend/public/`)
- Added per-account transaction queue [tx-queue.ts](../frontend/src/lib/tx-queue.ts) (`enqueueAccountTx`) and explicit `{ fee: DEFAULT_SOROBAN_INCLUSION_FEE }` across token and Soroswap write flows.
- Added `IS_MAINNET` and fail-fast `validateNetworkConfig()` in [network.ts](../frontend/src/lib/network.ts), `'public'` explorer routing on Mainnet in [explorer.ts](../frontend/src/lib/explorer.ts), and `TokenError` `#500..=#506` human-readable mapping in [format.ts](../frontend/src/lib/format.ts).
- Hardened [hot-wallet/](../frontend/src/lib/hot-wallet/vault.ts), `store/wallet.ts`, and `wallet-directory.ts`: `validateVaultPin` (`6`-char Testnet / `12`-char Mainnet minimum), network-scoped storage/cloud keys, disabling legacy no-AAD fallback and automatic Telegram cloud upload on Mainnet, and multi-wallet `walletSignatures`.
- Required `verifiedTelegram === true` for `@username` sends in `TransferCard`, 2-tap confirmation for `slippage >= 10 || impact >= 15` in `SwapCard`, removed unbounded `tokens_of` fallback in `sorobits.ts`, and distinguished `contractLockedLp` vs `deadBurnLp` in `soroswap.ts` & `sdk/index.ts`.
- Removed `https://*.workers.dev` from CSP headers consistently across `_headers`, `vercel.json`, and `nginx.conf`.

### Build Determinism & CI
- Pinned Rust toolchain via `rust-toolchain.toml` (`channel = "1.99.1"`, targets `["wasm32v1-none"]`) and `soroban-sdk = "=28.0.0"` in `Cargo.toml`.
- Added SHA-256 checksum verification (`fa0500f6b7e41d28791ebc680f5dd9899cd42b58629218a5f041efa899151a8e`) for `gitleaks_8.24.2_linux_x64.tar.gz` and pinned `dtolnay/rust-toolchain@1.99.1` in `.github/workflows/ci.yml`.
- Lowered npm audit regression baseline in `frontend/scripts/npm-audit-ratchet.mjs` from `44` to `30`.

---

## 2. Verified Passing Baseline (Current Local Source)

- **Rust & Contracts**:
  - `cargo fmt --all -- --check` -> **passed**
  - `cargo clippy --workspace --all-targets -- -D warnings` -> **0 warnings / 0 errors**
  - `cargo test --workspace` -> **70/70 passed** (`20` `astro-launchpad-contract`, `22` `astro-sorobits-contract`, `28` `astro-token`)
  - `stellar contract build` -> **all 3 WASMs compiled cleanly**
- **Frontend & Cloudflare Worker**:
  - `npx tsc --noEmit -p tsconfig.worker.json` -> **passed**
  - `npm run check` (`tsc -b`, `vite build`, `stamp-sw`, `oxlint`, `vitest`, `smoke:render`, `verify:pwa`, `check:csp`) -> **passed** (`oxlint`: `0` warnings / `0` errors across `169` files; Vitest: `29/29` test files, `233/233` tests passed)
  - `node scripts/npm-audit-ratchet.mjs` -> **`30` vulnerabilities within baseline `30`** (`crit 0 · high 12 · mod 6 · low 12`)

---

## 3. Live Testnet vs Compiled Source Code Delta

> [!IMPORTANT]
> The security-hardened contracts and worker/frontend changes are **verified and committed in source**, **NOT yet upgraded on Stellar Testnet or redeployed to Cloudflare** in this release snapshot.

| Artifact | Live on Stellar Testnet / Cloudflare (`astrogate.pages.dev`) | Locally Compiled Hardened Build (Pending Rollout) |
| :--- | :--- | :--- |
| **`astro-token`** | v4.2 WASM `bc3ababa6a10d8385101ac29ecdac84e9375d628df190c0f4f88defe4544f0e6` | `18,249` bytes · SHA-256 `2a6f4e78ef311fd3bd47f07f62ceb5a98f4a1ea85b0a301c435b17b3a0e6bb98` |
| **`astro-launchpad-contract`** | `CB5VMDAPQUK5LT5LH5L5THI6XYYUBTAXM7BJZLZYFGUJHZB64LZHFAPK` · WASM `fd2f1a6e0d68a94972963ef87e3b4947be1f89a7230c09e53aff70dabf1dcbf1` | `56,603` bytes · SHA-256 `114e83b3b9dbde26e518f2bcac209aa7456a85349f02e0bfd6914046d7918f75` |
| **`astro-sorobits-contract`** | `CBVETCPLVAMNUUQRUJGH54XHVQT5ZOVB4FGGP2IGOGAZLUIYBBV7G3I3` · WASM `c668ebba24880a46202e6746009a95a62d1893207f678db3422d8194154f17fd` | `73,659` bytes · SHA-256 `a0ce7d0615a9d6744dbe87427015ac9ad29c3e0f990863511213ea438bc22f97` |

### Coordinated Testnet Rollout Order (Next Session)
If deploying the hardened code to live Testnet:
1. Upload the new `astro-token` WASM and capture its hash.
2. Execute contract upgrade on Launchpad (`CB5V...FAPK`) and call `set_token_wasm_hash(<new_token_wasm_hash>)`.
3. Execute contract upgrade on Sorobits (`CBVE...G3I3`). **UI prerequisite decision**: `InstantMintAllowed` defaults to `false` in the hardened contract; either implement the 2-step `commit_capsule`/`reveal_capsule` + `commit_forge`/`reveal_forge` UX in `frontend/src/pages/SorobitsPage.tsx` first, or explicitly call `set_instant_mint_allowed(true)` on Testnet until that UI flow lands.
4. Update the deployed WASM hashes across documentation (`README.md`, `AGENTS.md`, `frontend/public/llms*.txt`), deploy the Cloudflare Worker (`cd frontend && npm run deploy:worker`), and deploy Cloudflare Pages (`npm run deploy`).

---

## 4. New-Device Bootstrap Checklist

1. **Clone & Tooling**:
   ```bash
   git clone https://github.com/NunaLabsDev/astrogate.git
   cd astrogate
   # Rust 1.99.1 + wasm32v1-none is auto-selected by rust-toolchain.toml when rustup is installed
   stellar --version   # require >= 28.x
   cd frontend && npm ci
   ```
2. **Out-of-Band Secrets (Never Commit to Git)**:
   Copy or configure outside the repo only if deploying contracts, Worker, or Pages:
   - Stellar deployer secret (`STELLAR_SECRET`) for contract uploads/upgrades and admin calls.
   - Cloudflare authentication (`wrangler login` or `CLOUDFLARE_API_TOKEN` in user config outside git).
   - Cloudflare Worker secrets (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, managed via `wrangler secret put`).
3. **Full Verification Suite on the New Machine**:
   ```bash
   stellar contract build --package astro-token
   cargo fmt --all -- --check
   cargo clippy --workspace --all-targets -- -D warnings
   cargo test --workspace
   stellar contract build

   cd frontend
   npx tsc --noEmit -p tsconfig.worker.json
   npm run check
   node scripts/npm-audit-ratchet.mjs
   ```

---

## 5. Open Decisions & Next-Session Backlog

1. **Dependabot Branches (Requires Explicit Approval Before Merging)**:
   - `dependabot/github_actions/github/codeql-action-4`
   - `dependabot/npm_and_yarn/frontend/types/node-26.6.6`
   - `dependabot/npm_and_yarn/frontend/typescript-7.0.2`
2. **Sorobits Commit-Reveal UX vs Testnet Flag**: Wire 2-step commit-reveal UX in `SorobitsPage.tsx` (recommended before Mainnet) alongside Testnet contract rollout.
3. **Manual `@BotFather` Task**: Run `/setuserpic` -> `@AstroGateSorobanBot` with `frontend/public/telegram/astrogate-community-avatar.png` if still unset.
4. **Pre-Mainnet Blockers**:
   - Independent third-party smart contract + client cryptography audit sign-off.
   - Hardware/Multisig admin keys configured for Mainnet Launchpad and Sorobits contracts (exercising 48h timelocked upgrades).
   - Inject Mainnet contract IDs, RPC endpoints, and `VITE_STELLAR_NETWORK=mainnet` environment configuration (`validateNetworkConfig()`).
