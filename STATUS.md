# AstroGate Status Snapshot

> **Live Testnet IDs (`v4.5`):** [`docs/CONTRACTS_AND_NETWORK.md`](./docs/CONTRACTS_AND_NETWORK.md) · **Docs Index:** [`docs/INDEX.md`](./docs/INDEX.md)

## Verified State (`81d4acc` on `feat/telegram-ecosystem-unification`, 2026-11-26)
- **Exclusive `AstroWallet` Custody (`@AstroID` SSO):** Removed legacy local `<HotWalletModal />` and Reown connectors; `MiniAppShell` uses 0-click `AstroID` auto-resolution, `@astrowallet/connect` v0.2.0 (`astroWalletConnectSigner`), 1-tap multi-key switching, and `ASTROWALLET` Service Binding (`env.ASTROWALLET` before `ASTRO_KV`), keeping disposable Testnet `Demo` accounts only.
- **Fair-Flywheel v4.5 + Sorobits Pillar 4 Decoupling:** Live Testnet Launchpad (`CB5VMD...FAPK`, 48h timelock, 7Y LP lock, escrowed Spark/Crown jackpots, `trigger_buyback_burn_with_bounty`), `$ASTRO` SEP-41 token (`CAI637...SXRE`), and decoupled Sorobits SEP-50 (`CBVETC...7G3I3`, `set_launchpad_optional(Option<Address>)`).
- **Verification Passed:**
  - Rust (`cargo test --workspace`): **69/69** (`19` launchpad + `23` sorobits + `27` token).
  - Worker & Frontend (`tsc -p tsconfig.worker.json && npm run check`): `oxlint` `0` errors/warnings, **31 Vitest files / 244 tests**, `smoke:render`, `verify:pwa`, `check:csp`.
- **Live Cloudflare Testnet:** Worker `astrogate-stellar` (`e6e480ab-039f-44a8-ac9c-4024d394cfa2`, cron `*/5 * * * *`) · Pages `https://astrogate.pages.dev` (`@AstroGateSorobanBot`, `@AstroSoroban`, `@AstroGateFeed`).
- **Next Gate:** Merge `feat/telegram-ecosystem-unification` to `main` when ready; prepare Gate 3 Mainnet contracts & standalone Pillar 4 `Sorobits NFT Marketplace` after Gate 1 (`AstroWallet`) and Gate 2 (`AstroDex`) pass Mainnet gates.
