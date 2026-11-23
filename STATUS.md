# AstroGate Status Snapshot

> **Archived Sessions (4–38) & legacy tail notes**: [`docs/archive/STATUS_HISTORY.md`](./docs/archive/STATUS_HISTORY.md)  
> **Live Testnet IDs & v4.4/v4.5 notes**: [`docs/CONTRACTS_AND_NETWORK.md`](./docs/CONTRACTS_AND_NETWORK.md) · **Docs Index**: [`docs/INDEX.md`](./docs/INDEX.md)

## Latest Verified Session Snapshot — Session 40 (Nov 23, 2026, `03eb819` on `feat/telegram-ecosystem-unification`)
Completed full ecosystem audit remediation unifying wallet custody exclusively under **Pillar 1 `AstroWallet` (`AstroID` SSO)** and decoupling **Sorobits SEP-50** for the standalone **Pillar 4 NFT Marketplace**:
- **Exclusive `AstroWallet` Custody (`src/store/wallet.ts`, `src/lib/signer.ts`, `worker/api.ts`, `worker/wallet.ts`):**
  - Removed `<HotWalletModal />` from `MiniAppShell.tsx` and Reown `WalletConnectModule` from `wallet.ts`, making `AstroID` SSO visible on mobile in `WalletButton.tsx` while keeping disposable Testnet `Demo` accounts.
  - Added 0-click `AstroID` auto-resolution inside Telegram (`hydrateFromTelegramCloud`), AstroConnect v1 Worker proxy (`POST/GET /api/v1/wallet/connect/requests*`), `astroWalletConnectSigner`, and strict `env.ASTROWALLET` precedence over stale `ASTRO_KV` in `resolveWalletIdentity`.
- **Sorobits SEP-50 Pillar 4 Decoupling (`contracts/sorobits/src/contract.rs`, `frontend/src/lib/sorobits.ts`, `ecosystem.ts`, `SorobitsPage.tsx`):**
  - Added `set_launchpad_optional(Option<Address>)` + Launchpad-independent quest progression in `claim_quest_badge` (`CapsulesMinted` & collection count); removed `./token` (`launchpadClient`) coupling from `sorobits.ts`; added `buildSorobitsMarketplaceUrl` CTA.
- **Verification & Live Testnet Deployments (`03eb819`):**
  - **Rust (`cargo test --workspace`):** **69 passed** (`19` launchpad + `23` sorobits + `27` token).
  - **Worker & Frontend (`tsc -p tsconfig.worker.json && npm run check`):** `oxlint` `0` errors/warnings (`174` files), **31 Vitest files / 243 tests passed** (including `worker/wallet.test.ts`), `smoke:render`, `verify:pwa`, `check:csp` passed.
  - **Cloudflare Testnet:** Worker `astrogate-stellar` version `f68c3220-5d29-4a43-81bc-de3918dd9025` (cron `*/5 * * * *`), Pages `astrogate` deployed at `https://87c3ea8c.astrogate.pages.dev` (`https://astrogate.pages.dev`).
- **Next Session:** Migrate Worker/frontend AstroConnect glue to universal `@astrowallet/connect-sdk` and prepare Gate 3 Mainnet contracts + standalone Pillar 4 `Sorobits NFT Marketplace` repo after Gate 1 (`AstroWallet`) and Gate 2 (`AstroDex`) pass Mainnet gates.

## Previous Session Snapshot — Session 39 (Nov 18, 2026, `ee4a712` / `2424d7e`)
Recorded **Fair-Flywheel v4.4** in-place Testnet upgrade, **3-Checkpoint Jackpot Ladder (`40,000` tokens)**, softened 3-stage fees, dedicated `/dex` route, multi-contract cache isolation, and Sorobits SEP-50 ID fixes (*AI-generated; pending human review*):
- **Launchpad v4.4 (`CB5VMDAPQUK5LT5LH5L5THI6XYYUBTAXM7BJZLZYFGUJHZB64LZHFAPK`)**: upgraded in-place on Testnet (WASM hash `fd2f1a6e0d68a94972963ef87e3b4947be1f89a7230c09e53aff70dabf1dcbf1`, `48,263 B`); `66%` Curve / `33%` Soroswap DEX / `0.30%` Creator 15d Vesting / `0.40%` (`+5K` Spark @ `250 XLM`, `+10K` Crown @ `500 XLM`, `+25K` Graduation @ `1,000 XLM`) / `0.30%` Ecosystem Treasury; buy fees `0.30% / 0.50% / 0.25%`, sell fees `1.20% / 1.80% / 1.50%`.
- **Contract Isolation & Sorobits Fix**: added `SUPPORTED_LAUNCHPAD_CONTRACTS` / `CONTRACT_GENERATION_TAG` / `contractStorageKey(...)` while keeping Native Wallet (`networkStorageKey`) intact; filtered legacy pre-v4.3 / smoke launches; fixed `fetchSorobitById` burned-ID rendering and removed unrelated `genesis0` fallback.
- **UX & Routing**: dedicated `/dex` (`DexPage.tsx`) for graduated Soroswap pools; `CurveStoryChart.tsx`, `RewardCelebrationModal.tsx`, 1-tap checkpoint buys, and restricted `Developer · 7Y LP Lock & Buyback` console.
- **Live Deployments (recorded in Session 39)**: Pages `https://astrogate.pages.dev`, Worker `astrogate-stellar` (via Pages Functions `ASTROW` binding; Version `527daa18-fd93-47b6-af08-e15c7173dc9e`), Telegram `@AstroGateSorobanBot`, `@AstroGateFeed`, `@AstroGateCommunity`.

## Uncommitted Working-Tree State (`v4.5` + Ecosystem Sync, post-`ee4a712`)
- **Active working tree (`150+` dirty paths, Nov 19–22, 2026)** upgraded `contracts/`, `frontend/src/lib/network.ts`, `frontend/scripts/mcp-server.mjs`, `README.md`, `ARCHITECTURE.md`, `AUDIT_GUIDE.md`, `SECURITY.md`, `docs/AI_AGENT_INTEGRATION.md`, and `docs/RELEASE_CHECKLIST.md` to **Fair-Flywheel v4.5** + **Sorobits v4.5**, and added **ASTRO Ecosystem Integration**:
  - **Contracts (`v4.5`):** `48h` upgrade timelock (`propose_upgrade` / `execute_upgrade` / `cancel_upgrade`), escrowed Spark/Crown jackpots (`claim_jackpot`), 30d `CurveClosed` principal return, `trigger_buyback_burn_with_bounty` (`2%` keeper rebate), and Sorobits two-ledger commit-reveal RNG + `TokenBaseXp`.
  - **Ecosystem Integration (`AstroWallet SSO` & `AstroDex`):** `frontend/src/lib/ecosystem.ts` (+ `ecosystem.test.ts`), `wallet-directory.ts` (`AstroWallet` `/v1/identity/resolve` primary lookup with `/api/v1/wallet/resolve` fallback), `DexPage.tsx` (`"Pro Terminal on AstroDex"` CTA), `WalletButton.tsx` (`"AstroWallet SSO"` link), and `frontend/.env.example` ecosystem variables.
- **Native Wallet**: Session 38+ replaced external wallet UI tabs with the 100% self-custodial Native Wallet (`PBKDF2-SHA256` + `AES-GCM-256`, `CloudStorage` / `AGVAULT1:` sync, `@username` Ed25519 link); `@creit.tech/stellar-wallets-kit` remains in `package.json` / fallback signer.

## Operational Notes & Next Checks
- **External Secrets (out of git)**: `~/.secrets/astrogate/{developer-accounts.env,telegram-bot.env}` and `~/.config/cloudflare/cf-api-token` are required only for on-chain deploys/scripts with `STELLAR_SECRET` or Cloudflare deploys.
- **Pending manual `@BotFather` step** (from Session 36): `/setuserpic` -> `@AstroGateSorobanBot` -> `frontend/public/telegram/astrogate-community-avatar.png`.
- **Verification status**:
  - Frontend/Worker verified on Nov 22, 2026: `cd frontend && npx tsc --noEmit -p tsconfig.worker.json && npm run check` passed (`oxlint` 0 warnings/errors across 173 files, `30` Vitest files / `238` tests, `smoke:render`, `verify:pwa`, `check:csp`).
  - Re-verify Rust contracts before Mainnet/tagging if contract files changed: `stellar contract build --package astro-token && cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace && stellar contract build`
