# CLAUDE.md — AstroGate

Follow [AGENTS.md](./AGENTS.md) as the canonical repository guide for build/test commands, directory layout, Soroban/Soroswap invariants, security boundaries, and PR verification rules.

Quick reference:
- **Next-Session / Cross-Device Continuity**: `docs/SESSION_HANDOFF.md`
- **Protocol & Audit Context**: `README.md`, `ARCHITECTURE.md`, `AUDIT_GUIDE.md`, `SECURITY.md`, `TRADEMARK.md`, `frontend/public/llms-full.txt`
- **Rust Contracts Check**: `stellar contract build --package astro-token && cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
- **Frontend & Worker Check**: `cd frontend && npx tsc --noEmit -p tsconfig.worker.json && npm run check && node scripts/npm-audit-ratchet.mjs`
- **MCP Inspection Server**: `cd frontend && npm run mcp`
