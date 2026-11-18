# Publishing AstroGate Open Source under the `NunaLabsDev` GitHub Organization

To publish AstroGate cleanly at `https://github.com/NunaLabsDev/astrogate` so external developers, users, and AI auditors can inspect everything without exposing personal accounts or local secrets, follow this exact checklist.

---

## 1. What to Keep Private vs. What to Publish

| Category | Keep Private (NEVER Push) | Safe & Recommended to Publish |
| :--- | :--- | :--- |
| **Credentials & Keys** | `.secrets/`, `~/.secrets/astrogate/*`, `~/.config/cloudflare/cf-api-token`, `.env`, `.env.*`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `STELLAR_SECRET`, Deployer `S...` keys | `.env.example` (empty template), public contract `C...` IDs, public Burn blackhole address `GAAAA...WHF` |
| **Git & Identity History** | Existing `.git/` history containing earlier personal commit authors or purged early commit objects | Clean single-commit orphan snapshot authored as `NunaLabs` (`users.noreply.github.com`) |
| **Workstation Artifacts** | `scripts/vm-keys/`, `scripts/opencode-env/`, local `logs/*.log`, `STATUS.md` (internal session notes) | `contracts/`, `frontend/src/`, `frontend/worker/`, `frontend/scripts/`, `.github/workflows/` |
| **Open Source Docs & Tooling** | Internal operational playbooks containing private hostnames | `README.md`, `ARCHITECTURE.md`, `AUDIT_GUIDE.md`, `SECURITY.md`, `CONTRIBUTING.md`, `LICENSE`, `docs/AI_AGENT_INTEGRATION.md`, `/docs`, `/llms.txt`, `/openapi.json`, `/mcp` |

---

## 2. Create the `NunaLabsDev` GitHub Organization Cleanly

1. Sign in with a dedicated GitHub account (or clean org maintainer handle with 2FA enabled and `users.noreply.github.com` email privacy turned **ON**).
2. Create a new **GitHub Organization**: `NunaLabsDev` (`github.com/NunaLabsDev`), and create repository `astrogate`.
3. Enable security features before making public:
   - `Settings -> Code security -> Private vulnerability reporting`
   - `Settings -> Code security -> Secret scanning` & **Push protection**
   - `Settings -> Branches -> Add rule for main` (require PR reviews + CI passing)

---

## 3. Clean Snapshot Export Commands (Zero Personal History)

Run from a clean staging folder so you never risk pushing legacy `.git` objects:

```bash
rm -rf /tmp/astrogate-nunalabs && mkdir -p /tmp/astrogate-nunalabs

rsync -a \
  --exclude='.git' \
  --exclude='.secrets' \
  --exclude='target' \
  --exclude='logs' \
  --exclude='frontend/node_modules' \
  --exclude='frontend/dist' \
  --exclude='frontend/.vercel' \
  --exclude='scripts/vm-keys' \
  --exclude='scripts/opencode-env' \
  --exclude='AGENTS.md' \
  --exclude='GEMINI.md' \
  --exclude='PLAN.md' \
  --exclude='STATUS.md' \
  /Users/<USER>/dev/floodgate/ /tmp/astrogate-nunalabs/

cd /tmp/astrogate-nunalabs
git init -b main
git config user.name "KawsayRuraq"
git config user.email "269836211+KawsayRuraq@users.noreply.github.com"

# Verify zero secret seeds, tokens, or personal emails exist before committing
rg -ni "S[A-Z2-7]{55}|ghp_|cloudflare|TELEGRAM_BOT_TOKEN|pepepop|ruwaq|prometeo|gmail\.com" . || true

# Run full verification suite on the clean exported tree
stellar contract build --package astro-token
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cd frontend && npm ci && npx tsc --noEmit -p tsconfig.worker.json && npm run check && cd ..

git add -A
git commit -m "chore: initial open-source release (AstroGate v4.3 Testnet · Built by NunaLabs)"
git remote add origin https://github.com/NunaLabsDev/astrogate.git
git push -u origin main
```
