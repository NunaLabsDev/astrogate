# Security Policy — AstroGate (Stellar Testnet)

AstroGate is a decentralized token launchpad and AMM studio built **exclusively for the Stellar Testnet**. No real funds or mainnet assets are used, and built-in demo accounts are disposable.

## Scope

- `contracts/token/`: SEP-41 fungible token built on OpenZeppelin Stellar (`Capped`, `TotalSupply`, `FungibleBurnable`, `Ownable`), with 90-day TTL extension (`extend_ttl`) across state-changing operations.
- `contracts/launchpad/` (v4.4 Fair-Flywheel): Bonding-curve & atomic graduation launchpad contract (`CB5VMDAPQUK5LT5LH5L5THI6XYYUBTAXM7BJZLZYFGUJHZB64LZHFAPK`) with persistent 90-day on-chain registry (`launch_fair`, `launch_token`, `get_launches`, `get_market_page`, `get_launch`, `get_curve`, `get_pilot`, `get_creation_fee`, `set_creation_fee`, `refund_stalled_launch`, `reclaim_expired_lp`), 3-Stage Virtual Bonding Curve (`buy_curve` `0.30% / 0.50% / 0.25%`, `sell_curve` `1.20% / 1.80% / 1.50%`, `quote_buy`, `quote_sell`) + 40K 3-Checkpoint Jackpots (`+5K / +10K / +25K`), P2P curve transfer lock until graduation (closes pre-grad `PairAlreadySeeded` DoS), creator initial seed lock until graduation (+7d stalled fallback & refund), permissionless Soroswap DEX Buyback-and-Burn (`trigger_buyback_burn`), 15-day post-graduation creator vesting (`claim_creator_vesting`), 7-year contract LP time-lock (`reclaim_expired_lp`), empty-curve dust sweep (`sweep_empty_curve_fees`), and 3-tier Burn-to-Chat with 24h King Shout decay (`burn_shout`, `get_shouts`, `get_king_shout`). Enforces configurable protocol creation fee (default `7 XLM`) to treasury, 10M fixed supply (`66%` Curve `1,000 vXLM -> 1,000 XLM` · `33%` Soroswap DEX · `0.3%` 15d vesting · `0.4%` Jackpots · `0.3%` Dev Ecosystem), deploys token, renounces ownership immediately, locks 100% LP for 7 years in-contract on graduation, and executes real `token.burn()` calls on buyback/shout burns.
- `frontend/`: Static SPA (Vite + React 19 + TypeScript) deployed on Cloudflare Pages (`https://astrogate.pages.dev`) with Pages Functions (`frontend/functions/`) bound via internal `ASTROW` Service Binding to the `astrogate-stellar` Worker (`workers_dev: false`); identity is the connected wallet and state is read directly from Soroban RPC and Horizon.
- External AMM integration with **Soroswap** (Factory and Router deployed on Stellar Testnet).

## Trust Model

- **The network is the single source of truth** for balances, supply, reserves, and contract events.
- There is no user backend, JWT auth, server database, or server-side secret in the user flow.
- The user's wallet signs all state-changing operations.
- Demo Mode stores disposable **testnet** secret keys in browser `localStorage`; they are accessible to anyone with access to that browser profile and must never be reused for real funds.
- In-app Native Wallet Vault (`frontend/src/lib/hot-wallet/`) encrypts secret keys client-side with `PBKDF2-SHA256` (`210,000` iterations) + `AES-GCM-256` (binding `publicKey` as AAD) under the user's PIN before saving to device storage, `Telegram.WebApp.CloudStorage`, or portable `AGVAULT1:` encrypted sync bundles; unlocked `Keypair` instances stay strictly in volatile RAM with brute-force PIN cooldown protection and exportable `S...` keys.
- Telegram `@username ↔ Wallet` Directory (`frontend/worker/wallet.ts`): stores only public `G...` addresses, verified `@username`/`tgUserId` pointers, and optional client-encrypted `AGVAULT1:` blobs; secret seeds (`S...`) and PINs never leave the client device.
- Soroswap contracts and public Soroban RPC / Horizon endpoints are external dependencies outside this repository's control.

## Implemented Security Controls

- **Hard-Capped Token Supply & Typed Errors (`Capped`, `TokenError`)**: `contracts/token` sets an immutable supply cap equal to `initial_supply` during `__constructor`, emits `TransfersLockedEvent`/`TransfersUnlockedEvent`, and uses typed `TokenError` (`#500..=#506`) via `panic_with_error!`.
- **Ownership Renunciation & 7Y In-Contract LP Time-Lock**: Fair-launch tokens renounce `Ownable` ownership (`owner() == None`), escrow pre-graduation checkpoint bonuses (`CheckpointReward`) until graduation (`claim_checkpoint_reward`), lock 100% LP inside Launchpad for 7 years (`reclaim_expired_lp`), and protect upgrades on both Launchpad and Sorobits behind mandatory 48-hour timelocks (`schedule_upgrade` / `cancel_upgrade` / `execute_upgrade`).
- **Pre-Seeded Pool Protection (`PairAlreadySeeded`)**: `contracts/launchpad` verifies that any pre-existing Soroswap pair has `total_supply() == 0` and `(0, 0)` (or zero token side) reserves before adding initial liquidity, preventing pool price hijacking or LP dilution attacks.
- **Anti-Frontrunning Commit-Reveal & Salt Derivation**: `contracts/launchpad` hashes `(creator, salt)` with `sha256` before calling `deployer().with_current_contract(derived_salt)`, while `contracts/sorobits` enforces 2-step `commit_capsule`/`reveal_capsule` & `commit_forge`/`reveal_forge` RNG and `TokenXpBaseline` anti-XP-laundering across transfers.
- **Strict CSP & HTTP Security Headers**: Configured identically across `frontend/public/_headers`, `frontend/vercel.json`, and `frontend/nginx.conf` (`X-Content-Type-Options: nosniff`, `frame-ancestors 'self' https://web.telegram.org https://*.telegram.org`, `object-src 'none'`, explicit `connect-src` without wildcard `*.workers.dev`), verified in CI via `npm run check:csp`.
- **Bounded On-Chain Metadata & Safe Rendering**: Launch metadata (`LaunchRecord.meta`) is capped on-chain at `512` UTF-8 bytes, encodes only compact HTTPS-validated logo links and sanitized URLs (`encodeOnChainMeta` / `decodeOnChainMeta`), and renders strictly as plain text via React without `dangerouslySetInnerHTML`. Burn-to-Chat shouts (`burn_shout`) are scaled by `token.decimals` and bounded to `1..=160` bytes with at most `15` shouts persisted per token.
- **Slippage, Price Impact, PIN Policy & Sequence Queue**: Swaps use live Soroswap router quotes (`router_get_amount_out`), enforce minimum output amounts (`amount_out_min`), require explicit 2-tap confirmation for `>= 10%` slippage or `>= 15%` price impact, serialize per-account transactions via `enqueueAccountTx`, validate balances + Stellar's 1 XLM base reserve, and enforce `6`-char Testnet / `12`-char Mainnet PINs (`validateVaultPin`).
- **Telegram `@username ↔ Wallet` & Logo Upload Hardening (`frontend/worker/api.ts`, `wallet.ts`, `mcp.ts`, `ai.ts`)**: `POST /api/v1/wallet/link` rate-limits per IP, requires `X-Telegram-Init-Data` HMAC-SHA256 verification whenever `tgUserId > 0`, protects both `uname` and `uid` entries from unverified overwrites, requires per-wallet Ed25519 `walletSignatures` across primary and secondary addresses, blocks replay via KV nonces (`wnonce:`), and rejects `S...` seeds. `TransferCard` blocks `@username` transfers unless `verifiedTelegram === true`. `POST /api/v1/logos` validates allowed `Origin`, rate-limits per IP, blocks `<svg`/`<script` polyglots, and serves logos with sandboxed CSP. `/mcp` caps batches at 10 requests and `/api/telegram/pulse` deduplicates `txHash` in KV.
- **Non-Caching Service Worker**: `frontend/public/sw.js` only caches the static application shell and assets; it never caches Soroban RPC, Horizon, or wallet relay requests.

## Known Limitations

- **Unaudited by External Third Party**: Smart contracts, Hot Vault cryptography, and Worker endpoints have undergone internal security reviews and automated test suites (`cargo test`, Vitest), **but no formal third-party audit has been completed yet**. Do not deploy to mainnet without an independent audit.
- **No Off-Chain Indexer**: Visible on-chain activity depends on the Soroban RPC event retention window (~7 days); historical Soroswap swap charts rely on local browser snapshots (`IndexedDB` / `localStorage`) unless an external indexer is attached.
- **On-Chain Metadata Limits**: `LaunchRecord.meta` is capped at `512` bytes UTF-8 (`https://` external image URLs only; raw binary images or `data:` URLs are rejected).
- **Demo Mode Keys**: Testnet demo keys live in `localStorage` by design for one-click onboarding (`selectDemo` blocked on mainnet builds).

## Reporting a Vulnerability (Private Disclosure)

Do **not** open a public GitHub issue with exploitable details. Submit a private report via **GitHub Security Advisories** at:

- `https://github.com/NunaLabsDev/astrogate/security/advisories/new`

Structured template fields live in [`.github/VULNERABILITY_REPORT.yml`](./.github/VULNERABILITY_REPORT.yml). Please include:

1. Affected commit, contract, or file path,
2. Impact and broken invariant (see [`AUDIT_GUIDE.md`](./AUDIT_GUIDE.md)),
3. Reproducible steps or failing unit test on Stellar Testnet,
4. Sanitized evidence (tx hash, logs without secret seeds or PII).

Never include secret seeds (`S...`), API tokens, or personal data.
