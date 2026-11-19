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
| **Medium** | Telegram Worker, Pages Functions & Anti-Spoof Quests | `frontend/functions/*.ts`, `frontend/worker/{index.ts,api.ts,events.ts,rpc.ts,quests.ts,views.ts,wallet.ts,telegram-auth.ts,ai.ts}` |
| **Medium** | Sorobits SEP-50 RLE Budget & Genomes | `contracts/sorobits/src/{contract.rs,engine.rs,assets.rs,test.rs}` |
| **Medium** | CSP Parity, PWA Service Worker & Scripts | `frontend/public/{_headers,sw.js}`, `frontend/vercel.json`, `frontend/nginx.conf`, `frontend/scripts/check-csp.mjs` |

---

## 2. Core Protocol Invariants (Verify Against Code)

### A. Smart Contracts (`contracts/`)
1. **Supply Conservation & Immutable Cap + Typed Token Errors**:
   - `launch_fair` always mints `10,000,000 * 10^7` (`100_000_000_000_000`) units partitioned cleanly: `66%` Curve (`6.6M`), `33%` DEX (`3.3M`), `0.3%` Creator Vesting (`30K`), `0.4%` 3-Checkpoint Jackpots (`40K`: `+5K` Spark, `+10K` Crown, `+25K` Grad), `0.3%` Dev Ecosystem (`30K`), zero idle Burn Vault (`0`), and immediately renounces ownership (`renounce_ownership`).
   - `contracts/token` uses typed `TokenError` (`#500..=#506`) via `panic_with_error!` (zero raw `panic!`/`expect` in production paths) and emits `TransfersLockedEvent`/`TransfersUnlockedEvent`.
2. **Pre-Graduation Curve Isolation & Checkpoint Escrow (`C-01` / `F-01`)**:
   - While `!curve.graduated`, `token.transfer` and `token.transfer_from` revert with `#506` for non-gate callers, while `token.burn` / `token.burn_from` remain callable by `burn_shout` (scaled by `token.decimals`).
   - Pre-graduation Spark (`+5K`) and Crown (`+10K`) checkpoint bonuses escrow inside `DataKey::CheckpointReward(token, winner)` and can only be claimed post-graduation via `claim_checkpoint_reward`, eliminating pre-grad bonus dumping into `sell_curve`.
   - At graduation, `seed_soroswap_and_burn_lp` tolerates unilateral XLM dust sent to the Soroswap pair (`pair.total_supply() == 0`), yet rejects pre-seeded LP pools (`pair.total_supply() > 0 || (r0 > 0 && r1 > 0)`).
   - LP tokens minted at graduation (`lp_minted`) deposit directly to Launchpad (`&this`) and remain locked for `7 years` (`reclaim_expired_lp` reverts with `MilestoneNotReached` before `graduated_at + 220_752_000`).
3. **Accounting Separation, Stalled Refunds & Dust Sweep (`F-02` / `F-06`)**:
   - Buy/sell quotes depend strictly on `curve_xlm_net` and `tokens_sold` using overflow-checked arithmetic; stalled 7d refunds (`refund_stalled_launch`) and 30d abandoned sweeps (`sweep_empty_curve_fees`) verify `zero_external_supply`, return creator `curve_xlm_net`, sweep only surplus fee dust to treasury, and never issue phantom unlocked tokens.
   - `with_reentrancy_guard` (`ReentrancyLock`) + strict CEI state ordering protect all state-mutating external-call entrypoints.
4. **Post-Graduation Buyback Anti-MEV (`H-01` / `F-14`)**:
   - `trigger_buyback_burn` / `trigger_buyback_burn_min` enforce a `300s` cooldown (`BuybackLastTs`), swap `<= 50 bps` (`0.50%`) of pool XLM reserve capped at `250 XLM` absolute per swap, and verify slippage (`min_tokens_burned`).
5. **Admin Governance & 48h Upgrade Timelocks (`F-04`)**:
   - `set_paused` only blocks `launch_fair` and `launch_token` — traders can never be frozen from exiting (`sell_curve`) or claiming vesting.
   - Both `Launchpad` and `Sorobits` replace immediate WASM upgrades with 48-hour timelocked `schedule_upgrade` / `cancel_upgrade` / `execute_upgrade` plus `StorageVersion = 1`.
6. **Sorobits Commit-Reveal RNG, Anti-XP-Laundering & Render Budget (`F-05` / `F-15`)**:
   - Generative mints and Astral Forge default to 2-step commit-reveal (`commit_capsule`/`reveal_capsule`, `commit_forge`/`reveal_forge`, `InstantMintAllowed = false`) preventing same-ledger simulation sniping.
   - `transfer` / `transfer_from` snapshot recipient XP in `TokenXpBaseline(token_id)` so `sync_epigenetics` only credits newly earned XP, `burn`/`burn_from` reject soulbound badges, and `ByteWriter` sets an overflow flag (`SvgBudgetExceeded`) instead of panicking.

### B. Client Cryptography & Transaction Safety (`frontend/src/`)
1. **AES-GCM Integrity, PIN Policy & Network Isolation (`F-07` / `F-08` / `F-13`)**:
   - `hot-wallet/crypto.ts` derives 256-bit AES-GCM keys via `PBKDF2-SHA256` (`210,000` iterations), binds `meta.publicKey` as AAD (legacy no-AAD fallback disabled on Mainnet), enforces `6`-char Testnet / `12`-char Mainnet minimum PINs (`validateVaultPin`), and scopes storage/cloud keys per network (`IS_MAINNET` disables automatic Telegram CloudStorage sync).
   - `network.ts` exports `validateNetworkConfig()` (fail-fast Mainnet guard) and `explorer.ts` routes Mainnet links to `stellar.expert/explorer/public/...`.
2. **Sequence Serialization & Swap Confirmation (`F-16` / `F-19`)**:
   - `tx-queue.ts` (`enqueueAccountTx`) serializes concurrent write transactions per Stellar public key alongside explicit `DEFAULT_SOROBAN_INCLUSION_FEE`.
   - `SwapCard` enforces 2-tap confirmation when `slippage >= 10%` or `priceImpact >= 15%`, and `TransferCard` requires `verifiedTelegram === true` before sending to `@username`.

### C. Cloudflare Worker & Telegram Bot (`frontend/worker/`)
1. **Auth, Multi-Wallet Proofs, Anti-Polyglot & Rate Limiting (`F-03` / `F-09` / `F-17`)**:
   - `/telegram/webhook` checks `X-Telegram-Bot-Api-Secret-Token` via constant-time SHA-256 comparison.
   - `/api/telegram/pulse` validates Origin allowlist + `X-Telegram-Init-Data`, rate-limits per IP, deduplicates `txHash` in KV (`pulse:tx:<hash>`), and ignores transactions older than `180` ledgers.
   - `POST /api/v1/wallet/link` rate-limits per IP, requires `X-Telegram-Init-Data` for any `tgUserId > 0`, protects both `uname` and `uid` keys from unverified overwrite, and verifies Ed25519 signatures for both primary and secondary wallets (`walletSignatures`).
   - `POST /api/v1/logos` validates allowed `Origin`, rate-limits per IP, scans uploads against `<svg`/`<script`/HTML polyglots, and serves images with `Content-Security-Policy: default-src 'none'; sandbox`.
   - `/mcp` caps JSON-RPC batches at `10` items; `ai.ts` sanitizes on-chain names/symbols and strips external non-bot URLs.

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
# 1. Rust WASM fixture (required by Launchpad tests), formatting, strict Clippy, and unit tests (70 tests)
stellar contract build --package astro-token
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
stellar contract build

# 2. Frontend & Worker typecheck, lint (oxlint), 233 Vitest specs, SSR smoke, PWA, CSP parity & npm audit ratchet
cd frontend
npx tsc --noEmit -p tsconfig.worker.json
npm run check
node scripts/npm-audit-ratchet.mjs

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
