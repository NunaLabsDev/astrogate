# AstroGate Documentation Index

> Progressive-disclosure index: read **only** the file(s) needed for your task. Verified Nov 22, 2026.

| Document | Lines | Purpose | Freshness / Notes |
| :--- | :---: | :--- | :--- |
| [`AGENTS.md`](../AGENTS.md) | 35 | Core invariants, verified commands & doc pointers (`GEMINI.md` symlink) | Current |
| [`STATUS.md`](../STATUS.md) | 27 | Session 39 (`v4.4`) + uncommitted `v4.5` & AstroWallet SSO / AstroDex sync | Current (`Nov 22, 2026`) |
| [`CONTRACTS_AND_NETWORK.md`](./CONTRACTS_AND_NETWORK.md) | 44 | Testnet RPC/Horizon, contract IDs, WASM hashes, ops accounts | Current (`v4.5`; flags `v4.4` drift) |
| [`ARCHITECTURE.md`](../ARCHITECTURE.md) | 95 | Contracts, Native Wallet (`PBKDF2`/`AES-GCM`), Cloudflare `ASTROW` binding | Current (`v4.5`) |
| [`AUDIT_GUIDE.md`](../AUDIT_GUIDE.md) | 109 | Risk-tiered file map, protocol invariants, reproducible audit commands | Current (`v4.5`) |
| [`SECURITY.md`](../SECURITY.md) | 58 | Trust model, implemented controls, known limits, advisory disclosure | Current (`v4.5`) |
| [`README.md`](../README.md) | 122 | Protocol overview, architecture diagram, quickstart & gates | Current (`v4.5`) |
| [`AI_AGENT_INTEGRATION.md`](./AI_AGENT_INTEGRATION.md) | 135 | `@astrogate/sdk`, tool schemas, `/mcp` + `npm run mcp`, Soroban rules | Current (`v4.5`) |
| [`RELEASE_CHECKLIST.md`](./RELEASE_CHECKLIST.md) | 117 | Cloudflare Pages/Worker deploy, post-deploy HTTP checks, rollback | Mostly current (L8 says CLI `28.x`) |
| [`SOROBITS_ARCHITECTURE.md`](./SOROBITS_ARCHITECTURE.md) | 122 | SEP-50 `32×32` on-chain RLE/SVG architecture & satellite pattern | Partial (`v4.3` WASM hash on L5) |
| [`SOROBITS_ART_BIBLE.md`](./SOROBITS_ART_BIBLE.md) | 131 | `32×32` pixel-art lore, 16-slot `PaletteSwap`, sel-out & art pipeline | Current art spec (`Floodgate` lore ref) |
| [`OPENSOURCE_ORG_SETUP.md`](./OPENSOURCE_ORG_SETUP.md) | 71 | Clean `NunaLabsDev/astrogate` export checklist & secret exclusion | Current (L50 example path `/dev/floodgate/`) |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md) | 48 | PR workflow, Rust/TS quality gates, Telegram EN-only rules | Current |
| [`TRADEMARK.md`](../TRADEMARK.md) | 47 | Brand marks, permitted audit/API/fork uses, anti-phishing policy | Current |
| [`frontend/README.md`](../frontend/README.md) | 41 | Frontend/Worker/scripts layout & npm verification commands | Current (L39 cites `v4.4` math) |
| [`PLAN.md`](../PLAN.md) | 125 | Early MVP reorientation roadmap (Phases 0–2a) | **Historical / stale** (Vercel, Termux paths) |
| [`MAC_SETUP.md`](./MAC_SETUP.md) | 96 | Early macOS migration guide | **Stale / historical** ("Floodgate", `ai/market-discovery`, `60 tests`) |
| [`LEGACY_REVIEW.md`](./LEGACY_REVIEW.md) | 254 | 2026-11-01 review of `legacy/abandoned-monorepo` (what to adopt/avoid) | **Historical** ("Floodgate" naming) |
| [`archive/STATUS_HISTORY.md`](./archive/STATUS_HISTORY.md) | 867 | Archived handoffs for Sessions 4–38 + obsolete early tail notes | **Archived log** (read-only history) |

- **Legacy / Auxiliary Folders**: [`prompts/ai-agent-best-practices.md`](../prompts/ai-agent-best-practices.md) (50L) and [`prompts/process-management.md`](../prompts/process-management.md) (26L) are archival notes superseded by `AGENTS.md`. `scripts/opencode-env/AGENTS.md` (271L) is a standalone OpenCode snapshot.
- **Scoped Agent Config (`.agents/`)**: [`.agents/rules/soroswap-traps.md`](../.agents/rules/soroswap-traps.md) (`model_decision`), [`.agents/rules/telegram-bot-policy.md`](../.agents/rules/telegram-bot-policy.md) (`glob`), and [`.agents/mcp_config.json`](../.agents/mcp_config.json) (`astrogate-soroban`).
