#!/usr/bin/env bash
set -euo pipefail

# Builds an isolated, single-commit orphan Git snapshot ready to push to
# https://github.com/NunaLabsDev/astrogate without any prior commit history,
# local secrets, personal identifiers, or machine-specific developer artifacts.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGE_DIR="${1:-${ROOT_DIR}/.opensource-stage}"
COMMIT_MSG="${2:-$(git -C "${ROOT_DIR}" log -1 --pretty=%s 2>/dev/null || echo 'chore: open-source release (AstroGate Testnet · Built by NunaLabs)')}"
REMOTE_URL="https://github.com/NunaLabsDev/astrogate.git"

echo "==> Preparing clean NunaLabsDev open-source export in: ${STAGE_DIR}"
rm -rf "${STAGE_DIR}"
mkdir -p "${STAGE_DIR}"

rsync -a \
  --exclude='.git' \
  --exclude='.opensource-stage' \
  --exclude='.secrets' \
  --exclude='target' \
  --exclude='logs' \
  --exclude='.env' \
  --exclude='.env.*' \
  --exclude='*.session' \
  --exclude='*.session-journal' \
  --exclude='frontend/node_modules' \
  --exclude='frontend/dist' \
  --exclude='frontend/.vercel' \
  --exclude='frontend/.wrangler' \
  --exclude='frontend/sorobits_output' \
  --exclude='sorobits_output' \
  --exclude='scripts/vm-keys' \
  --exclude='scripts/vm-setup.sh' \
  --exclude='scripts/opencode-env' \
  --exclude='scripts/prepare-opensource-export.sh' \
  --exclude='prompts' \
  --exclude='docs/LEGACY_REVIEW.md' \
  --exclude='docs/MAC_SETUP.md' \
  --exclude='docs/RELEASE_CHECKLIST.md' \
  --exclude='docs/OPENSOURCE_ORG_SETUP.md' \
  --exclude='AGENTS.md' \
  --exclude='GEMINI.md' \
  --exclude='CLAUDE.md' \
  --exclude='PLAN.md' \
  --exclude='STATUS.md' \
  "${ROOT_DIR}/" "${STAGE_DIR}/"

cat <<'EOF' > "${STAGE_DIR}/AGENTS.md"
# AGENTS.md — AstroGate (NunaLabsDev)

> Machine- and developer-facing repository onboarding guide for coding, auditing, and integration agents.
> Protocol status: **Stellar Testnet** (`Test SDF Network ; September 2015`). See [AUDIT_GUIDE.md](./AUDIT_GUIDE.md) and [SECURITY.md](./SECURITY.md) before modifying contracts or crypto modules.

---

## 1. Project Overview

**AstroGate** (`https://github.com/NunaLabsDev/astrogate`) is a zero-user-backend Fair-Flywheel v4.4 Launchpad, Soroswap AMM interface, Sorobits (SEP-50) on-chain `32x32` genomic pixel-art NFT platform, and Telegram Mini App / Bot (`@AstroGateSorobanBot`) built on **Stellar / Soroban**.

- **Smart Contracts (`contracts/`)**: Rust + Soroban SDK (`soroban-sdk`) + OpenZeppelin Stellar (`stellar-tokens = "=0.8.0"`, SEP-41 & SEP-50).
- **Frontend & SDK (`frontend/src/`)**: Vite + React 19 + TypeScript + Tailwind + `@creit.tech/stellar-wallets-kit` + client-side AES-GCM Hot Vault + `@astrogate/sdk` (`src/sdk/index.ts`).
- **Cloudflare Worker, Public API & MCP (`frontend/worker/`, `frontend/scripts/mcp-server.mjs`)**: Telegram webhook/cron event streamer, read-only REST API (`/api/v1/*`, `/openapi.json`), and Model Context Protocol server (`POST /mcp` and local stdio `npm run mcp`).

---

## 2. Directory Map

| Path | Ownership & Purpose |
| :--- | :--- |
| `contracts/launchpad/` | Fair-Flywheel v4.4 bonding curve (66/33/0.3/0.4 jackpots/0.3 dev), atomic Soroswap graduation, 7-year contract LP lock (`reclaim_expired_lp`), anti-MEV buyback-and-burn, 15d vesting, Burn-to-Chat shouts |
| `contracts/token/` | SEP-41 `Capped` + `FungibleBurnable` + `Ownable` token with `lock_until_graduated` transfer lock |
| `contracts/sorobits/` | SEP-50 NFT contract with on-chain RLE `32x32` SVG renderer, 256-bit genomes, and epigenetic progression |
| `frontend/src/lib/curve-math.ts` | Runtime-agnostic bonding curve integer math (1:1 parity with `contracts/launchpad/src/contract.rs`) |
| `frontend/src/lib/hot-wallet/` | Client-side `PBKDF2-SHA256` (210k) + `AES-GCM-256` vault (`publicKey` AAD, RAM zeroing, 15m idle lock) |
| `frontend/src/lib/network.ts` | Testnet/Mainnet presets, contract IDs, multi-RPC failover (`executeWithRpcFailover`), network-scoped storage keys |
| `frontend/worker/` | Telegram bot (`@AstroGateSorobanBot`), KV event dedupe, `/api/v1/*` REST API, and `/mcp` JSON-RPC server |
| `frontend/public/` | `llms.txt`, `llms-full.txt`, `_headers` (CSP & cache policy), `sw.js`, `.well-known/stellar.toml` |

---

## 3. Deterministic Build, Lint & Test Gates

Run **all** relevant gates after your final edit and report exact observed outputs:

```bash
# Smart contracts (astro-token WASM fixture must be built before Launchpad tests)
stellar contract build --package astro-token
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
stellar contract build

# Frontend & Cloudflare Worker
cd frontend
npm ci
npx tsc --noEmit -p tsconfig.worker.json
npm run check   # vite build + oxlint + vitest + smoke:render + verify:pwa + check:csp
```

Optional read-only / disposable Friendbot E2E verification against Stellar Testnet (no secrets needed):

```bash
cd frontend
npm run verify:discovery
npm run verify:token-events
npm run verify:demo
```

---

## 4. Critical Protocol & Security Invariants (Do Not Break)

1. **7-Decimal Precision**: Native XLM (`1 XLM = 10_000_000` stroops) and all AstroGate tokens use `7` decimals. Use `bigint` integer math—never floating-point arithmetic—for amounts, quotes, fees, and slippage.
2. **1:1 Bonding Curve Math Parity**: Any change to curve formulas or fees must keep exact integer parity across `contracts/launchpad/src/contract.rs` and `frontend/src/lib/curve-math.ts` (shared by `frontend/src/lib/tokenomics.ts` and `frontend/worker/protocol.ts`).
3. **Soroswap Integration Rules**:
   - Quote with `router_get_amount_out(amount_in, reserve_in, reserve_out)` (`router_get_amounts_out` does not quote).
   - Do not add unnecessary `approve`/allowance calls for Soroswap Router swaps (`transfer`-based).
   - Read `token_0()`, `token_1()`, and `get_reserves()` directly from each Soroswap Pair contract instead of assuming lexical token order.
   - Graduation checks `pair.total_supply() > 0 || (r0 > 0 && r1 > 0)` to resist 1-stroop unilateral `pair.sync()` griefing while still blocking pre-seeded LP dilution.
4. **Curve Transfer Lock**: While `!graduated`, `contracts/token` blocks P2P `transfer` and `transfer_from` for non-gate callers while keeping `burn` and `burn_from` enabled for `burn_shout`.
5. **Client Cryptography & Signing Safety**:
   - Never expose private keys outside `keypairStore` volatile memory; always validate Horizon reserves (`validateXlmReserve`) before prompting signatures; keep `selectDemo` disabled on Mainnet.
   - Keep `frontend/public/_headers`, `frontend/vercel.json`, and `frontend/nginx.conf` CSP directives synchronized (`npm run check:csp`).
6. **Telegram Bot & Channel Policy**:
   - Keep all `@AstroGateSorobanBot`, `@AstroGateCommunity`, and `@AstroGateFeed` text strictly in English.
   - Use internal Telegram Mini App deep links (`https://t.me/AstroGateSorobanBot?start=...`) inside Telegram buttons/messages.
   - Route automated event broadcasts strictly to `@AstroGateFeed` (`community: false` across all event kinds).

---

## 5. Contribution, Security & Trademark Rules

- **No Secrets**: Never commit `.env*`, `.secrets/`, Stellar secret seeds (`S...`), bot tokens, or Cloudflare tokens.
- **Keep `curve-math.ts` Pure**: Never import `import.meta.env`, `window`, or DOM APIs inside `frontend/src/lib/curve-math.ts`.
- **Vulnerability Disclosure**: Never open public GitHub issues for exploitable bugs. Report them privately via `https://github.com/NunaLabsDev/astrogate/security/advisories/new` (see [SECURITY.md](./SECURITY.md)).
- **Brand Protection**: Code is MIT-licensed ([LICENSE](./LICENSE)); AstroGate, NunaLabs, and Sorobits names, logos, and badge artwork are governed by [TRADEMARK.md](./TRADEMARK.md).
EOF

cat <<'EOF' > "${STAGE_DIR}/CLAUDE.md"
# CLAUDE.md — AstroGate

Follow [AGENTS.md](./AGENTS.md) as the canonical repository guide for build/test commands, directory layout, Soroban/Soroswap invariants, security boundaries, and PR verification rules.

Quick reference:
- **Protocol & Audit Context**: `README.md`, `ARCHITECTURE.md`, `AUDIT_GUIDE.md`, `SECURITY.md`, `TRADEMARK.md`, `frontend/public/llms-full.txt`
- **Rust Contracts Check**: `stellar contract build --package astro-token && cargo fmt --all -- --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace`
- **Frontend & Worker Check**: `cd frontend && npx tsc --noEmit -p tsconfig.worker.json && npm run check`
- **MCP Inspection Server**: `cd frontend && npm run mcp`
EOF

# Verify no forbidden secret files or env files leaked into staging.
if find "${STAGE_DIR}" \( -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.key' \) ! -name '.env.example' | grep -q .; then
  echo "ERROR: Forbidden env/key file detected in export!"
  exit 1
fi

cd "${STAGE_DIR}"

# Scan staged files for real Stellar secret seeds (excluding synthetic test fixtures in *.test.ts)
# or GitHub/Cloudflare/Bot tokens or personal identifiers.
if rg -n "ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|TELEGRAM_BOT_TOKEN=[0-9]{6,}:[A-Za-z0-9_-]{20,}|CLOUDFLARE_API_TOKEN=[A-Za-z0-9_-]{20,}" .; then
  echo "ERROR: Live credential token detected in export!"
  exit 1
fi

if rg -ni "pepepop|ruwaq|prometeo|andelabs|gmail\.com|student\.upr\.si" .; then
  echo "ERROR: Personal identifier detected in export!"
  exit 1
fi

if rg -n "S[A-Z2-7]{55}" --glob '!frontend/src/lib/*.test.ts' .; then
  echo "ERROR: Unexpected Stellar Secret Seed S... found outside unit test fixtures!"
  exit 1
fi

git init -b main >/dev/null
git config user.name "KawsayRuraq"
git config user.email "269836211+KawsayRuraq@users.noreply.github.com"
git remote add origin "${REMOTE_URL}"

if git fetch --depth=1 origin main >/dev/null 2>&1; then
  git update-ref refs/heads/main FETCH_HEAD
  git add -A
  if git diff --cached --quiet; then
    echo "==> Sanitized tree matches origin/main; nothing new to commit."
  else
    git commit -m "${COMMIT_MSG}" >/dev/null
    echo "==> Fast-forward commit created on top of origin/main."
  fi
else
  git add -A
  git commit -m "${COMMIT_MSG}" >/dev/null
  echo "==> Orphan repository created successfully (remote main unreachable)."
fi

git log -n 2 --stat=100,80 | tail -n 20
echo "==> Next: git -C ${STAGE_DIR} push -u origin main"
