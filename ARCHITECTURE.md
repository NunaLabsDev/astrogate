# AstroGate System Architecture

This document explains how AstroGate's smart contracts, client application, cryptographic Hot Wallet vault, Soroswap AMM integration, Sorobits NFTs, and Telegram Worker fit together.

---

## 1. Design Principles

1. **Zero User Backend**: Authentication is strictly cryptographic (Ed25519 wallet signatures). There are no sessions, JWTs, or custodial user databases.
2. **Chain as Source of Truth**: Reserves, curve state, balances, ownership status, LP burns, and shouts are fetched from Soroban RPC and Stellar Horizon.
3. **Anti-Rug by Construction**: Fair launches fix supply at `10,000,000` (`7` decimals), renounce ownership immediately on deployment, lock P2P transfers until graduation, and time-lock `100%` of initial Soroswap LP tokens inside the Launchpad contract for `7 years` (`reclaim_expired_lp`; legacy tokens locked LP in `GAAAA...WHF`).
4. **Network Isolation**: `frontend/src/lib/network.ts` encapsulates `NETWORK_PRESETS` (`testnet` vs `mainnet`), dynamically switching RPC pools, contract IDs, explorers, and browser storage namespaces via `networkStorageKey(...)`.

---

## 2. Smart Contract Topology (`contracts/`)

```mermaid
stateDiagram-v2
    [*] --> CurveActive: launch_fair (7 XLM fee + >=2 XLM buy)
    CurveActive --> CurveActive: buy_curve (0.30%/0.50%/0.25%) / sell_curve (1.2%/1.8%/1.5%)
    CurveActive --> CurveActive: burn_shout / +5K Spark (250) / +10K Crown (500)
    CurveActive --> Graduated: curve_xlm_net hits 1,000 XLM (+25K Graduation Jackpot to closer)
    Graduated --> Graduated: 7Y LP Contract Lock + unlock_transfers + 0.30% Dev Ecosystem
    Graduated --> LpReclaimed: reclaim_expired_lp after 7 years (220,752,000s)
    Graduated --> BuybackBurn: trigger_buyback_burn (max 0.50% reserve / 300s cooldown)
    Graduated --> VestingClaimed: claim_creator_vesting (5x 6,000 / 3 days)
```

### 2.1 `contracts/launchpad` (`astro-launchpad-contract`)
- **Curve Math (`quote_buy` / `quote_sell`)**:
  - Constant-product virtual curve initialized at `1,000 vXLM` and `6,600,000` curve tokens (`13,200,000` initial virtual tokens) until `curve_xlm_net == 1,000 XLM` (`2,000 vXLM` effective end, `4.00x` spot appreciation, `0.00%` graduation cliff).
  - 3-stage softened gamified fees & 3-Checkpoint Jackpot Ladder (`40,000` total prizes = `0.40%` supply) along `0 -> 1,000 XLM`:
    - Stage 1 (`< 250 XLM`, 0–25%): buy `0.30%` (`20 + 10 bps`), sell `1.20%` (`30 + 90 bps`). Breaking `250 XLM` awards `+5,000` Spark Bonus (`burn_milestone_stage = 1`).
    - Stage 2 (`250–500 XLM`, 25–50%): buy `0.50%` (`30 + 20 bps`), sell `1.80%` (`40 + 140 bps`). Breaking `500 XLM` awards `+10,000` King Crown (`burn_milestone_stage = 2`).
    - Stage 3 (`500–1,000 XLM`, 50–100%): buy `0.25%` (`15 + 10 bps`), sell `1.50%` (`30 + 120 bps`). Breaking `1,000 XLM` awards `+25,000` Graduation Jackpot.
  - Exact final buy exceeding graduation caps input at the remaining `1,000 - curve_xlm_net` delta.
- **Graduation (`seed_soroswap_and_burn_lp`)**:
  - Unlocks P2P transfers on the token (`unlock_transfers`).
  - Verifies Soroswap pair does not already hold liquidity (`pair.total_supply() > 0 || (r0 > 0 && r1 > 0)`), preventing 1-stroop `pair.sync()` griefing while still defeating pre-seeded LP dilution.
  - Transfers `>= 1,000 XLM` + `3,300,000` tokens (`33%`) directly into the Soroswap Pair, calls `deposit(&this)` so LP stays locked in the Launchpad contract for 7 years, awards `25,000` (`0.25%`) Graduation Jackpot to the final buyer, and releases `30,000` (`0.30%`) to `treasury`.
- **Post-Graduation Flywheel & Anti-MEV**:
  - `reclaim_expired_lp`: allows reclaiming expired contract-locked LP to `treasury` only after `graduated_at + 7 * 365 * 86_400` (`220,752,000s`).
  - `trigger_buyback_burn`: permissionless Soroswap XLM -> Token swap + immediate `token.burn()`, chunk-capped at `50 bps` (`0.50%`) of pool XLM reserve with a `300s` per-token cooldown (`BuybackLastTs`) to prevent sandwich MEV extraction.
  - `claim_creator_vesting`: `30,000` tokens (`0.3%`, `5` tranches of `6,000` every `3` days) + creator's initial `launch_fair` paid seed unlocked at graduation (or `7 days` after launch if stalled).
- **Governance & Safety**:
  - Admin address initialized to `treasury`, supports 2-step `transfer_admin`/`accept_admin`, emergency `set_paused` (pauses new launches only; exits/sells/claims remain open), `set_treasury`, `set_token_wasm_hash`, and `upgrade`.

### 2.2 `contracts/token` (`astro-token`)
- Built on OpenZeppelin `stellar-tokens 0.8.0` (`Capped`, `TotalSupply`, `FungibleBurnable`, `Ownable`).
- **Curve Transfer Lock**: During active curve (`lock_until_graduated(gate)`), `transfer` and `transfer_from` reject P2P movements (only the Launchpad gate can move curve tokens). `burn` and `burn_from` stay enabled so `burn_shout` works on the curve. Once `unlock_transfers()` executes at graduation, standard SEP-41 transfers open permanently.
- **TTL Preservation**: `extend_ttl` bumps instance TTL, `TotalSupply`, creator/lock metadata; `approve` also refreshes TTLs.

### 2.3 `contracts/sorobits` (`astro-sorobits-contract`)
- SEP-50 NFT contract rendering deterministic `32×32` pixel SVG (`render_svg`, `animated_svg`) from RLE-compressed trait bitmaps (`validate_rle_render_budget` bounds `<= 720` runs and `<= 12,800` SVG bytes).
- Edition-0 Genesis Archetypes (`AGQ01–AGQ08`) + generative `BytesN<32>` genomes with compatibility sanitization and role-gated epigenetic `rank_tier` / `xp_score` progression.
- `tokens_of_page(owner, offset, limit)` paginated enumeration and `extend_token_ttl` asset TTL refreshing.

---

## 3. Frontend & Native Cryptographic Wallet (`frontend/src/`)

- **100% Native Self-Custodial Wallet (`src/lib/hot-wallet/`, `src/lib/wallet-directory.ts`)**:
  - Zero external wallet extensions required in the main UX: users create or unlock a native Stellar wallet directly inside Telegram Mini App or Web browsers under a single PIN.
  - Keypairs are encrypted client-side with `PBKDF2-SHA256` (`210,000` iterations) + `AES-GCM-256`, binding the account `publicKey` as GCM `additionalData` (AAD).
  - Unlocks only into volatile memory (`sessionKeys`), clears temporary byte arrays after derivation/import, verifies `Keypair.fromSecret(secret).publicKey() === record.meta.publicKey`, enforces brute-force cooldowns, and auto-locks after `15 minutes` of inactivity (`HOT_IDLE_AUTO_LOCK_MS`).
  - **Multi-Wallet + `@username` Primary Routing**: Supports up to `10` connected sub-wallets (`MAX_HOT_WALLETS`) with `setPrimaryHotAccount` to designate which `G...` receives P2P transfers/tips addressed to `@username`. Users remain 100% sovereign and can reveal/export any individual `S...` key to manage it externally or import existing `S...` accounts.
  - **Cross-Device Sync (Telegram ↔ Web)**: Syncs ciphertext to `Telegram.WebApp.CloudStorage` inside Telegram, syncs `AGVAULT1:` encrypted bundles to `/api/v1/wallet/vault` when `initData` is verified, and allows manual `AGVAULT1:<base64>` export/import across browsers.
  - **Ed25519 Username Binding**: `signTelegramWalletLink` signs `astrogate:link:v1:<network>:<tgUserId>:<username>:<primaryPublicKey>:<wallets>:<timestamp>` with the Primary wallet so `TransferCard` (`resolveUsernameOrAddress`) can send directly to `@username` handles.
- **Stellar Reserve Validation (`src/lib/xlm.ts`)**:
  - Reads exact `subentry_count`, `num_sponsoring`, `num_sponsored`, and `selling_liabilities` from Horizon to enforce `(2 + subentries + sponsoring - sponsored) * 0.5 XLM + liabilities + 0.5 XLM` fee headroom before signing.
- **Multi-RPC Failover (`src/lib/network.ts`)**:
  - `executeWithRpcFailover` rotates healthy endpoints on 429/5xx/timeouts with bounded backoff; `Soroswap` and `Sorobits` modules read directly from chain (`Pair.token_0()`, `Pair.token_1()`, `Pair.get_reserves()`).
- **Local Caching & IndexedDB (`src/lib/indexed-db.ts`, `snapshots.ts`, `launch-checkpoint.ts`)**:
  - All storage keys and IndexedDB databases are scoped by active network via `networkStorageKey(...)` so Testnet and Mainnet state never collide.

---

## 4. Cloudflare Worker & Telegram Bot (`frontend/worker/`)

- **Separation of Chat Roles**:
  - **`@AstroGateFeed`** (`TELEGRAM_FEED_CHAT_ID`): Receives ALL automated spam-filtered protocol alerts (`launch`, buys/sells `>= 2 XLM`, `>= 80%` near-graduation pushes, graduations, DEX buybacks, Stage-2 milestones, Burn-to-Chat shouts, Sorobits mints & rank evolutions).
  - **`@AstroGateCommunity`** (`TELEGRAM_COMMUNITY_CHAT_ID`): **Zero automated broadcasts** (`community: false` for all parsed contract events). Responds strictly to interactive commands (`/market`, `/king`, `/token`, `/wallet`, `/wallet @user`, `/quests`, `/sorobits`, etc.), `$TICKER` lookups, and secret-seed auto-deletion guards.
- **Wallet Directory & Encrypted Sync API (`frontend/worker/wallet.ts`, `api.ts`, `mcp.ts`)**:
  - `POST /api/v1/wallet/link`: Verifies `X-Telegram-Init-Data` (300s window), `±300s` signature timestamp, Ed25519 signature over the canonical link message (`decodeStellarPublicKey` + WebCrypto `Ed25519` with `@stellar/stellar-sdk` fallback), anti-replay nonce (`wnonce:` in KV), and fail-closed `S...` secret leak check before storing network-scoped links.
  - `GET /api/v1/wallet/resolve?q=...`: Resolves `@username`, `G...`, or numeric `tgUserId` to its `primaryPublicKey` (never returns `encryptedVaultBundle`; `Cache-Control: no-store`). Also exposed to AI agents via MCP tool `resolve_wallet`.
  - `GET /api/v1/wallet/vault`: Requires verified `X-Telegram-Init-Data` (300s window) and returns the authenticated user's `AGVAULT1` encrypted bundle and link metadata.
- **Security Controls**:
  - Webhook requests require constant-time verification of `X-Telegram-Bot-Api-Secret-Token`.
  - `/api/telegram/pulse` enforces an explicit CORS origin allowlist (no wildcard `*.workers.dev`), optional `Telegram.WebApp.initData` HMAC-SHA256 verification (`verifyTelegramInitData` in `telegram-auth.ts`), 5-second per-IP rate limiting, and a 180-ledger tx recency window.
  - Supports Cloudflare KV (`ASTRO_KV`) for persistent event deduplication, wallet directory indexes, anti-replay nonces, and cursor tracking across Worker isolates.
