## Summary
<!-- Briefly describe what this PR changes and why. -->

## Scope & Security Impact
- [ ] Smart contracts (`contracts/`)
- [ ] Frontend / Crypto Vault (`frontend/src/`)
- [ ] Cloudflare Worker / Telegram Bot (`frontend/worker/`)
- [ ] Documentation / CI / Tooling

## Verification Checklist
Run and attach results after the final edit:
- [ ] `cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
- [ ] `cd frontend && npx tsc --noEmit -p tsconfig.worker.json && npm run check`
- [ ] If touching curve/AMM logic: verified 1:1 parity between `contracts/launchpad/src/contract.rs` and `frontend/src/lib/tokenomics.ts`

## AI Provenance
- AI-assisted: <!-- Yes / No; model/tool if applicable -->
