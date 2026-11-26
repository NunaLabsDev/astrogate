# AstroGate Documentation Index

> Progressive-disclosure index: read **only** the file(s) needed for your task. Verified Nov 26, 2026.

| Document | Lines | Purpose | Freshness / Notes |
| :--- | :---: | :--- | :--- |
| [`AGENTS.md`](../AGENTS.md) | 35 | Core invariants, verified commands & doc pointers (`GEMINI.md` symlink) | Current |
| [`STATUS.md`](../STATUS.md) | 15 | Verified Session 40 (`81d4acc`, `v4.5` + `AstroID` SSO) & Testnet deploys | Current (`Nov 26, 2026`) |
| [`CONTRACTS_AND_NETWORK.md`](./CONTRACTS_AND_NETWORK.md) | 34 | Testnet RPC/Horizon, contract IDs, WASM hashes, ops accounts | Current (`v4.5`) |
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | 95 | Contracts, `AstroID` SSO, Cloudflare `ASTROW` binding | Current (`v4.5`) |
| [`AUDIT_GUIDE.md`](../AUDIT_GUIDE.md) | 109 | Risk-tiered file map, protocol invariants, reproducible audit commands | Current (`v4.5`) |
| [`SECURITY.md`](../SECURITY.md) | 58 | Trust model, implemented controls, known limits, advisory disclosure | Current (`v4.5`) |
| [`README.md`](../README.md) | 122 | Protocol overview, architecture diagram, quickstart & gates | Current (`v4.5`) |
| [`AI_AGENT_INTEGRATION.md`](./AI_AGENT_INTEGRATION.md) | 135 | `@astrogate/sdk`, tool schemas, `/mcp` + `npm run mcp`, Soroban rules | Current (`v4.5`) |
| [`RELEASE_CHECKLIST.md`](./RELEASE_CHECKLIST.md) | 117 | Cloudflare Pages/Worker deploy, post-deploy HTTP checks, rollback | Current |
| [`SOROBITS_ARCHITECTURE.md`](./SOROBITS_ARCHITECTURE.md) | 122 | SEP-50 `32×32` on-chain RLE/SVG architecture & satellite pattern | Reference (`v4.3` WASM hash note on L5) |
| [`SOROBITS_ART_BIBLE.md`](./SOROBITS_ART_BIBLE.md) | 131 | `32×32` pixel-art lore, 16-slot `PaletteSwap`, sel-out & art pipeline | Current art spec |
| [`OPENSOURCE_ORG_SETUP.md`](./OPENSOURCE_ORG_SETUP.md) | 71 | Clean `NunaLabsDev/astrogate` export checklist & secret exclusion | Current |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | 48 | PR workflow, Rust/TS quality gates, Telegram EN-only rules | Current |
| [`TRADEMARK.md`](../TRADEMARK.md) | 47 | Brand marks, permitted audit/API/fork uses, anti-phishing policy | Current |
| [`frontend/README.md`](../frontend/README.md) | 41 | Frontend/Worker/scripts layout & npm verification commands | Current |
| [`scripts/opencode-env/README.md`](../scripts/opencode-env/README.md) | 18 | OpenCode env credential sync policy | Auxiliary script note |

- **Scoped Agent Config (`.agents/`)**: [`.agents/rules/soroswap-traps.md`](../.agents/rules/soroswap-traps.md) (`model_decision`), [`.agents/rules/telegram-bot-policy.md`](../.agents/rules/telegram-bot-policy.md) (`glob`), and [`.agents/mcp_config.json`](../.agents/mcp_config.json) (`astrogate-soroban`).
