# Security Policy — AstroGate (Stellar Testnet)

AstroGate is a decentralized token launchpad and AMM studio built **exclusively for the Stellar Testnet**. No real funds or mainnet assets are used, and built-in demo accounts are disposable.

## Scope

- `contracts/token/`: SEP-41 fungible token built on OpenZeppelin Stellar (`Capped`, `TotalSupply`, `FungibleBurnable`, `Ownable`), with 90-day TTL extension (`extend_ttl`) across state-changing operations.
- `contracts/launchpad/` (v4.5 Fair-Flywheel deployed on Testnet: `CB5VMDAPQUK5LT5LH5L5THI6XYYUBTAXM7BJZLZYFGUJHZB64LZHFAPK`): Bonding-curve & atomic graduation launchpad contract with persistent 90-day on-chain registry (`launch_fair`, `launch_token`, `get_launches`, `get_market_page`, `get_launch`, `get_curve`, `get_pilot`, `get_creation_fee`, `set_creation_fee`, `refund_stalled_launch`, `reclaim_expired_lp`, `claim_jackpot`, `get_pending_jackpot`, `is_curve_closed`), 3-Stage Virtual Bonding Curve (`buy_curve` `0.30% / 0.50% / 0.25%`, `sell_curve` `1.20% / 1.80% / 1.50%`, `quote_buy`, `quote_sell`) + 40K 3-Checkpoint Jackpots (escrowed `+5K / +10K` claimed via `claim_jackpot` + `+25K` at graduation), P2P curve transfer lock until graduation (closes pre-grad `PairAlreadySeeded` DoS), creator initial seed lock until graduation (+7d stalled fallback / 30d closed principal return), permissionless Soroswap DEX Buyback-and-Burn (`trigger_buyback_burn` & `trigger_buyback_burn_with_bounty` capped at `min(0.25% pool, 0.8000000 XLM)` with `2%` keeper rebate), 15-day post-graduation creator vesting (`claim_creator_vesting`), 7-year contract LP time-lock (`reclaim_expired_lp`), empty-curve dust sweep (`sweep_empty_curve_fees`), 48-hour upgrade timelock (`propose_upgrade`, `execute_upgrade`, `cancel_upgrade`, `get_pending_upgrade`), and 3-tier Burn-to-Chat with 24h King Shout decay (`burn_shout`, `get_shouts`, `get_king_shout`). Enforces configurable protocol creation fee (default `7 XLM`) to treasury, 10M fixed supply (`66%` Curve `1,000 vXLM -> 1,000 XLM` · `33%` Soroswap DEX · `0.3%` 15d vesting · `0.4%` Jackpots · `0.3%` Dev Ecosystem), deploys token, renounces ownership immediately, locks 100% LP for 7 years in-contract on graduation, and executes real `token.burn()` calls on buyback/shout burns.
- `contracts/sorobits/` (`CBVETCPLVAMNUUQRUJGH54XHVQT5ZOVB4FGGP2IGOGAZLUIYBBV7G3I3`): SEP-50 NFT contract with v4.5 two-ledger commit-reveal RNG (`commit_capsule`/`reveal_capsule`, `commit_forge`/`reveal_forge`), `TokenBaseXp` anti-XP-laundering baseline, 48-hour upgrade timelock, bounded RLE SVG renderer, and dynamic season asset counts.
- `frontend/`: Static SPA (Vite + React 19 + TypeScript) deployed on Cloudflare Pages (`https://astrogate.pages.dev`) with Pages Functions (`frontend/functions/`) bound via internal `ASTROW` Service Binding to the `astrogate-stellar` Worker (`workers_dev: false`); identity is the connected wallet and state is read directly from Soroban RPC and Horizon.
- External AMM integration with **Soroswap** (Factory and Router deployed on Stellar Testnet).

## Trust Model

- **The network is the single source of truth** for balances, supply, reserves, and contract events.
- There is no user backend, JWT auth, server database, or server-side secret in the user flow.
- The user's wallet signs all state-changing operations.
- Demo Mode stores disposable **testnet** secret keys in browser `localStorage`; they are accessible to anyone with access to that browser profile and must never be reused for real funds.
- In-app Native Wallet Vault (`frontend/src/lib/hot-wallet/`) encrypts secret keys client-side with `PBKDF2-SHA256` (`210,000` iterations) + `AES-GCM-256` (binding `publicKey` as AAD) under the user's PIN before saving to device storage, `Telegram.WebApp.CloudStorage`, or portable `AGVAULT1:` encrypted sync bundles, with optional opt-in quick-unlock via `Telegram.WebApp.BiometricManager` or WebAuthn PRF; unlocked `Keypair` instances stay strictly in volatile RAM with brute-force PIN cooldown protection and exportable `S...` keys.
- Telegram `@username ↔ Wallet` Directory (`frontend/worker/wallet.ts`): stores only public `G...` addresses, verified `@username`/`tgUserId` pointers, and optional client-encrypted `AGVAULT1:` blobs; secret seeds (`S...`) and PINs never leave the client device.
- Soroswap contracts and public Soroban RPC / Horizon endpoints are external dependencies outside this repository's control.

## Implemented Security Controls

- **Escrowed Checkpoints, 30d Curve Closeout & 48h Upgrade Timelock (`C-01`, `C-02`, `C-04`)**: Spark (`+5K`) and Crown (`+10K`) bonding-curve bonuses accrue in contract escrow (`pending_jackpot`) until graduation (`claim_jackpot`), defeating flash-buy-then-sell jackpot siphoning; 30-day closed curves (`CurveClosed`) return contributor principal while sweeping only fee dust; both `launchpad` and `sorobits` require a mandatory 48-hour timelock (`propose_upgrade` -> `execute_upgrade`) for Wasm upgrades.
- **Anti-MEV Buybacks & Keeper Rebates (`H-01`)**: DEX buyback-and-burn swaps are capped at `min(0.25% of pool XLM reserve, 0.8000000 XLM)` per call with a 300-second cooldown and optional `2%` XLM keeper gas rebate (`trigger_buyback_burn_with_bounty`, max `0.05 XLM`).
- **Commit-Reveal Sorobits RNG & Anti-XP-Laundering (`M-01`)**: Mystery Capsules and Astral Forge use two-ledger commit-reveal randomness (`commit_capsule`/`reveal_capsule`, `commit_forge`/`reveal_forge`), and `TokenBaseXp` prevents transfer/forge XP farming.
- **Hard-Capped Token Supply (`Capped`)**: `contracts/token` sets an immutable supply cap equal to `initial_supply` during `__constructor`. Even if an owner has not renounced ownership, `mint` cannot exceed `cap()` (tokens must be burned before any re-mint up to the cap).
- **Ownership Renunciation & LP Time-Lock**: Fair-launch tokens renounce `Ownable` ownership (`owner() == None`) and lock 100% of initial Soroswap LP tokens inside the Launchpad contract for 7 years (`reclaim_expired_lp`; legacy tokens sent LP to `GAAAA...WHF`).
- **Pre-Seeded Pool Protection (`PairAlreadySeeded`)**: `contracts/launchpad` verifies that `pair.total_supply() == 0 && (r0 == 0 || r1 == 0)` (`pair.total_supply() > 0 || (r0 > 0 && r1 > 0)` rejects) before adding initial liquidity, tolerating 1-stroop `pair.sync()` dust while blocking pre-seeded LP dilution.
- **Anti-Frontrunning Salt Derivation**: `contracts/launchpad` hashes `(creator, salt)` with `sha256` before calling `deployer().with_current_contract(derived_salt)`, preventing third parties from front-running a creator's salt.
- **Strict CSP & HTTP Security Headers**: Configured identically across `frontend/public/_headers`, `frontend/vercel.json`, and `frontend/nginx.conf` (`X-Content-Type-Options: nosniff`, `script-src 'self' https://telegram.org/js/telegram-web-app.js`, `frame-ancestors 'self' https://web.telegram.org https://*.telegram.org`, `object-src 'none'`, explicit `connect-src` and `font-src` allowlists including Reown fonts), verified in CI via `npm run check:csp`.
- **Bounded On-Chain Metadata & Safe Rendering**: Launch metadata (`LaunchRecord.meta`) is capped on-chain at `512` UTF-8 bytes, encodes only compact HTTPS-validated logo links and sanitized URLs (`encodeOnChainMeta` / `decodeOnChainMeta`), and renders strictly as plain text via React without `dangerouslySetInnerHTML` (`TokenArt` restricts URLs to `https://`, single-slash `/`, or raster base64 data URIs with `referrerPolicy="no-referrer"`). Burn-to-Chat shouts (`burn_shout`) are bounded to `1..=160` bytes with at most `15` shouts persisted per token.
- **Slippage, Price Impact & Balance Guards**: Swaps use live Soroswap router quotes (`router_get_amount_out`), enforce minimum output amounts (`amount_out_min`), require explicit 2-step confirmation for buys or sells with `>= 15%` price impact or `>= 10%` slippage, and validate balances + Stellar's base reserve/fee buffer (`validateXlmReserve`) across all state-changing transactions before prompting wallet signatures.
- **Telegram `@username ↔ Wallet` & API Hardening (`C-03`, `frontend/worker/wallet.ts`, `api.ts`, `mcp.ts`)**: `POST /api/v1/wallet/link` rejects unverified `tgUserId > 0` claims with HTTP `401`, blocks unverified overwrites of existing `@username` records, requires a valid Ed25519 signature (`±300s` timestamp window) + anti-replay KV nonce (`wnonce:`), enforces restricted CORS (`walletCorsHeaders`), applies sliding-window IP rate limits on `POST /api/v1/logos` (`10/min`) and `POST /api/v1/wallet/link` (`15/min`), caps MCP batch requests at `10`, and fails closed if any `S...` secret seed pattern appears in request payloads or decoded `AGVAULT1:` bundles. `GET /api/v1/wallet/vault` strictly requires fresh `X-Telegram-Init-Data`.
- **Hardened PWA Service Worker**: `frontend/public/sw.js` only caches the static application shell and assets, bypasses `/api/*`, `/.well-known/*`, `/llms*.txt`, `/mcp`, `/openapi.json`, and `/telegram/webhook`, and only caches navigation responses served with `Content-Type: text/html`.

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
