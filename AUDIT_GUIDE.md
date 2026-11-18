# AstroGate Security & AI Audit Guide

Welcome human security researchers and autonomous AI auditing agents (Claude, Gemini, Codex, custom static/fuzz harnesses).  
This guide provides the exact file map, core security invariants, threat model, and deterministic verification commands required to audit AstroGate thoroughly.

> [!IMPORTANT]
> AstroGate is currently operating on **Stellar Testnet**. Automated CI and contract suites pass, **but no formal third-party audit has been completed yet**. Do not treat any contract or client component as mainnet-certified until an independent review signs off.

---

## 1. Priority Scope & File Map

| Risk Tier | Area | Key Files to Inspect |
| :--- | :--- | :--- |
| **Critical** | Launchpad Curve, Graduation, MEV & Locks | `contracts/launchpad/src/contract.rs`, `contracts/launchpad/src/test.rs` |
| **Critical** | SEP-41 Token Cap, Burn & Transfer Lock | `contracts/token/src/contract.rs`, `contracts/token/src/test.rs` |
| **High** | Client Hot Wallet Crypto & Auto-Lock | `frontend/src/lib/hot-wallet/{crypto.ts,vault.ts,storage.ts,telegram-sync.ts}`, `frontend/src/store/wallet.ts`, `frontend/src/lib/signer.ts` |
| **High** | Bonding Curve Parity & Soroswap AMM Math | `frontend/src/lib/tokenomics.ts`, `frontend/src/lib/soroswap.ts`, `frontend/src/lib/token.ts`, `frontend/src/lib/xlm.ts` |
| **Medium** | Telegram Worker Auth, CORS, Anti-Spoof Quests | `frontend/worker/{index.ts,events.ts,rpc.ts,quests.ts,views.ts}` |
| **Medium** | Sorobits SEP-50 RLE Budget & Genomes | `contracts/sorobits/src/{contract.rs,engine.rs,assets.rs,test.rs}` |
| **Medium** | CSP Parity, PWA Service Worker & Scripts | `frontend/public/{_headers,sw.js}`, `frontend/vercel.json`, `frontend/nginx.conf`, `frontend/scripts/check-csp.mjs` |

---

## 2. Core Protocol Invariants (Verify Against Code)

### A. Smart Contracts (`contracts/`)
1. **Supply Conservation & Immutable Cap**:
   - `launch_fair` always mints `10,000,000 * 10^7` (`100_000_000_000_000`) units partitioned cleanly: `66%` Curve (`6.6M`), `33%` DEX (`3.3M`), `0.3%` Creator Vesting (`30K`), `0.7%` Dev Ecosystem (`70K`), zero idle Burn Vault (`0`), and immediately renounces ownership (`renounce_ownership`).
2. **Pre-Graduation Curve Isolation (`C-01` / Anti-Dilution)**:
   - While `!curve.graduated`, `token.transfer` and `token.transfer_from` must fail for non-gate callers, while `token.burn` / `token.burn_from` remain callable by `burn_shout`.
   - At graduation, `seed_soroswap_and_burn_lp` must tolerate unilateral XLM dust sent to the Soroswap pair (`pair.total_supply() == 0`), yet reject pre-seeded LP pools (`pair.total_supply() > 0 || (r0 > 0 && r1 > 0)`).
   - LP tokens minted at graduation (`lp_minted`) must be deposited directly to the Launchpad contract (`&this`) and locked for `7 years` (`reclaim_expired_lp` reverts with `MilestoneNotReached` before `graduated_at + 220_752_000`).
3. **Accounting Separation (`curve_xlm_net` vs `real_xlm_vault` vs `buyback_xlm_reserve`)**:
   - Buy/sell quotes depend strictly on `curve_xlm_net` and `tokens_sold`.
   - Treasury fees transfer immediately; retained floor fees accrue into `real_xlm_vault` / `buyback_xlm_reserve` without bricking `sell_curve` solvency.
   - Temporary `ReentrancyLock` + CEI state ordering protect `execute_curve_buy`.
4. **Post-Graduation Buyback Anti-MEV (`H-01`)**:
   - `trigger_buyback_burn` enforces a minimum `300s` cooldown (`BuybackLastTs`) per token and swaps at most `50 bps` (`0.50%`) of pool XLM reserve per call.
5. **Admin Governance Safety**:
   - `set_paused` only blocks `launch_fair` and `launch_token` — traders can **never** be frozen from exiting bonding curves (`sell_curve`) or claiming vesting (`claim_creator_vesting`).
6. **Sorobits Render Budget**:
   - `register_layer` enforces `validate_rle_render_budget` (`<= 720` runs and `<= 12,800` SVG bytes) so composed NFTs cannot trigger Soroban memory/CPU exhaustion on `render_svg`.

### B. Client Cryptography & Transaction Safety (`frontend/src/`)
1. **AES-GCM Integrity**:
   - `hot-wallet/crypto.ts` derives 256-bit AES-GCM keys via `PBKDF2-SHA256` (`210,000` iterations), binds `meta.publicKey` in `additionalData` (AAD), zeroes transient key material buffers, and checks `Keypair.fromSecret(secret).publicKey() === meta.publicKey` after decryption.
2. **Session & Mainnet Isolation**:
   - `wallet.ts` clears volatile in-memory keypairs after `HOT_IDLE_AUTO_LOCK_MS` (`15m`), blocks `selectDemo` on Mainnet, checks `NETWORK_PASSPHRASE` before signing (`signer.ts`), and namespaces all `localStorage` / `IndexedDB` keys by active network.
3. **Stellar Minimum Reserve & Signing Confirmation**:
   - Every transaction form (`SwapCard`, `CreateTokenForm`, `LiquidityForm`, `LiquidityPosition`, `BurnCard`, `MintCard`, `TransferCard`, `TokenHypeBar`, `TokenPage`) calls `requireSignerOrPrompt()` and `validateXlmReserve(..., publicKey)`.
   - Irreversible destructive operations (`BurnCard`, high-tier `TokenHypeBar`, `MintCard` renounce, `HotWalletModal` vault reset/delete) enforce inline 2-step UI confirmation.

### C. Cloudflare Worker & Telegram Bot (`frontend/worker/`)
1. **Auth & Replay Protection**:
   - `/telegram/webhook` checks `X-Telegram-Bot-Api-Secret-Token` with constant-time SHA-256 comparison.
   - `/api/telegram/pulse` validates Origin allowlist + `X-Telegram-Init-Data` HMAC-SHA256 (`verifyTelegramInitData`), rate-limits per IP (`5s`), and ignores transactions older than `180` ledgers.
2. **Feed-Only Broadcasting & Anti-Spoof**:
   - `routeLaunchpadEventTargets` keeps `community: false` across all event kinds; automated alerts reach only `@AstroGateFeed`.
   - `quests.ts` prevents `AGQ05` ("Early OG") spoofing by verifying Soroban ecosystem token balances (`ecosystemTokenCount`), not just empty Horizon trustlines.
   - `views.ts` checks every whitespace token in a message for Stellar secret seeds (`S...`) even after `C...`/`G...` prefixes and deletes group leaks immediately.

---

## 3. Threat Model & Out-of-Scope Dependencies

- **In Scope**: Contract accounting/locks/auth, frontend swap/curve/slippage math parity, Hot Wallet encryption & lock lifecycle, XSS/CSP, Worker authentication, Telegram secret handling.
- **External / Upstream Dependencies**:
  - Soroswap Testnet Factory (`CDP3...`) and Router (`CCJU...`) contracts.
  - Stellar public Soroban RPC & Horizon rate limits / retention windows (`getEvents` window).
  - Wallet extensions (`@creit.tech/stellar-wallets-kit` & transitive browser SDKs). Note: run `cd frontend && node scripts/npm-audit-ratchet.mjs` to review current npm advisory counts (all transitive; monitor upstream releases).

---

## 4. Reproducible Verification Commands

```bash
# 1. Rust WASM fixture (required by Launchpad tests), formatting, strict Clippy, and unit tests (59 tests)
stellar contract build --package astro-token
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
stellar contract build

# 2. Frontend & Worker typecheck, lint (oxlint), 217 Vitest specs, SSR smoke, PWA & CSP parity
cd frontend
npx tsc --noEmit -p tsconfig.worker.json
npm run check

# 3. Live Testnet read-only & 3-account Friendbot E2E verification
npm run verify:discovery
npm run verify:token-events
npm run verify:demo
```

---

## 5. Prompt Starter for AI Auditing Agents

If you are auditing this repository with an LLM / coding agent, feed it:
1. `AUDIT_GUIDE.md` + `ARCHITECTURE.md` + `SECURITY.md`
2. Target contract file (`contracts/launchpad/src/contract.rs`) or client module (`frontend/src/lib/hot-wallet/` or `frontend/worker/`)
3. Ask the agent to verify each invariant in Section 2 line-by-line, search for integer truncation/overflow, missing auth/signer checks, cross-contract reentrancy, replay vectors, and mismatch between TypeScript local quotes (`tokenomics.ts`) and Rust (`contract.rs`).
