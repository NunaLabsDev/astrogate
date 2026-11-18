# Contributing to AstroGate

Thank you for helping audit, harden, and improve AstroGate!

---

## Workflow

1. **Scope Changes Clearly**: Keep smart-contract, Worker, and UI changes small and focused.
2. **No Secret Commits**: Never commit `.env*`, `.secrets/`, `S...` secret seeds, Cloudflare API tokens, or Telegram bot tokens. Use `.env.example` patterns only.
3. **Preserve Network Defaults**: Keep Stellar Testnet as the default in development unless explicitly configuring an opt-in Mainnet build via `VITE_STELLAR_NETWORK=mainnet`.
4. **Telegram Rules**: Bot views, commands, and Live Feed broadcasts are strictly English (`lang = 'en'`), use internal Telegram deep links (`https://t.me/AstroGateSorobanBot?start=...`), and never auto-broadcast alerts to `@AstroGateCommunity` (`community: false`).

---

## Mandatory Checks Before Opening a PR

### Smart Contracts (Rust / Soroban)
```bash
stellar contract build --package astro-token
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
stellar contract build
```

### Frontend & Cloudflare Worker
```bash
cd frontend
npx tsc --noEmit -p tsconfig.worker.json
npm run check
```

If you modify curve math or contract storage layouts, verify 1:1 parity between `contracts/launchpad/src/contract.rs` and `frontend/src/lib/tokenomics.ts` and update snapshots/tests accordingly.

---

## AI-Assisted Contributions

PRs assisted by AI tools are welcome when reviewed thoroughly by the author:
- Mark PR summaries honestly with what checks ran after the final edit.
- Verify dependency additions separately (`package.json`, `Cargo.toml`) and check `npm run check:csp` if adding external asset or RPC origins.

---

## Security Issues

Do **not** open public GitHub issues for exploitable vulnerabilities. Report them privately via GitHub Security Advisories as described in [SECURITY.md](./SECURITY.md).
