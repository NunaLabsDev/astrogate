# AstroGate AI Agent & Auditor Integration Guide

> [!NOTE]
> AstroGate is designed **AI-First**: protocol state lives on-chain on Stellar/Soroban, typed interfaces exist in `frontend/src/sdk/index.ts`, read-only REST + OpenAPI endpoints live under `/api/v1/*` and `/openapi.json`, MCP tools are exposed via `POST /mcp` and `npm run mcp`, and LLM-readable specs live at `/llms.txt` and `/llms-full.txt`.

---

## 1. Key Protocol Entrypoints (`llms.txt`, API, MCP & Contracts)

- **Repository**: `https://github.com/NunaLabsDev/astrogate`
- **Live Machine Specs**: `https://astrogate.pages.dev/llms.txt` & `https://astrogate.pages.dev/llms-full.txt` (sources: `frontend/public/llms.txt`, `frontend/public/llms-full.txt`)
- **OpenAPI 3.1 Spec**: `https://astrogate.pages.dev/openapi.json`
- **Model Context Protocol (MCP)**:
  - Remote Streamable HTTP JSON-RPC: `POST https://astrogate.pages.dev/mcp`
  - Zero-Config Local Stdio Server: `cd frontend && npm run mcp` (`frontend/scripts/mcp-server.mjs`)
- **Audit Handbook & Agent Guide**: [`AGENTS.md`](../AGENTS.md), [`AUDIT_GUIDE.md`](../AUDIT_GUIDE.md), & [`ARCHITECTURE.md`](../ARCHITECTURE.md)
- **Testnet Contracts**:
  - **Launchpad (Fair-Flywheel v4.5)**: `CB5VMDAPQUK5LT5LH5L5THI6XYYUBTAXM7BJZLZYFGUJHZB64LZHFAPK`
  - **Flagship Token ($ASTRO)**: `CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE`
  - **Sorobits NFT (SEP-50)**: `CBVETCPLVAMNUUQRUJGH54XHVQT5ZOVB4FGGP2IGOGAZLUIYBBV7G3I3`
  - **Soroswap Factory**: `CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY`
  - **Soroswap Router**: `CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD`
  - **Native XLM SAC**: `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC`

---

## 2. Using `@astrogate/sdk` (`frontend/src/sdk/index.ts`)

```typescript
import {
  getMarketTokens,
  getTokenDetails,
  quoteSwap,
  verifyAntiRug,
  fetchTokenEvents,
  checkRpcHealth,
} from './src/sdk'

// 1. Check Soroban RPC availability & latency
const health = await checkRpcHealth()
console.log(`RPC ok=${health.ok} latency=${health.latencyMs}ms`)

// 2. Discover active Bonding Curves + graduated Soroswap pools
const market = await getMarketTokens({ maxTokens: 50 })
for (const token of market) {
  console.log(`${token.symbol}: ${token.priceXlm} XLM (grad=${token.graduationPercent}%)`)
}

// 3. Deterministic quote (bonding curve pre-graduation or Soroswap post-graduation)
const quote = await quoteSwap({
  tokenId: market[0].id,
  amountIn: 50_000_000n, // 5 XLM in stroops (7 decimals)
  direction: 'buy',
  slippagePercent: 2,
})

// 4. Verify on-chain Anti-Rug invariants (ownership renounced + 7-year LP contract lock / canonical burn)
const audit = await verifyAntiRug(market[0].id)
console.log(`Anti-Rug verified: ${audit.isAntiRugVerified}, LP burned: ${audit.lpBurned}`)

// 5. Recent on-chain token activity
const events = await fetchTokenEvents(market[0].id, { maxEvents: 20 })
```

---

## 3. Function-Calling Tool Schemas (OpenAI / Gemini / Anthropic / MCP)

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "get_market_tokens",
        "description": "Lists active AstroGate bonding curves and graduated Soroswap DEX pairs with live reserves.",
        "parameters": {
          "type": "object",
          "properties": {
            "maxTokens": { "type": "number", "description": "Maximum tokens to inspect" }
          }
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "quote_swap",
        "description": "Computes exact swap output, minimum received after slippage, and price impact.",
        "parameters": {
          "type": "object",
          "required": ["tokenId", "amountIn", "direction"],
          "properties": {
            "tokenId": { "type": "string", "description": "Stellar contract C... address" },
            "amountIn": { "type": "string", "description": "Input amount in 7-decimal base units" },
            "direction": { "type": "string", "enum": ["buy", "sell"] },
            "slippagePercent": { "type": "number", "description": "Max slippage % (default 2)" }
          }
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "verify_anti_rug",
        "description": "Audits on-chain ownership renunciation and permanent LP burn to GAAAA...WHF.",
        "parameters": {
          "type": "object",
          "required": ["tokenId"],
          "properties": {
            "tokenId": { "type": "string", "description": "Stellar contract C... address" }
          }
        }
      }
    }
  ]
}
```

- **Telegram Session & Wallet Directory Endpoints (`frontend/worker/index.ts`, `frontend/worker/wallet.ts`)**:
  - `POST /api/telegram/session`: Verifies Telegram Mini App `initData` HMAC-SHA256 signature (`24h` TTL) before unlocking the trading/wallet UI.
  - `GET /api/v1/wallet/resolve?q=@username`: Resolves a Telegram `@username`, numeric user ID, or `G...` address to its `primaryPublicKey` and connected wallets.
  - `POST /api/v1/wallet/link`: Binds `@username` / `initData` (`24h` TTL) to Stellar wallet(s) using an Ed25519 proof (`±300s` anti-replay nonces).
  - `GET /api/v1/wallet/vault`: Fetches the authenticated Telegram Mini App user's `AGVAULT1:` encrypted bundle (`X-Telegram-Init-Data` required, `24h` TTL).
  - MCP Tool `resolve_wallet(query)` exposes `@username` / `G...` lookup to AI agents.

---

## 4. Critical Soroban / Stellar Rules for Autonomous Agents

1. **7-Decimal Precision**: Native XLM (`1 XLM = 10^7` stroops) and all AstroGate Fair-Flywheel tokens use **7 decimals**.
2. **Fair-Flywheel v4.5 Split & Anti-MEV Guardrails**: `66%` Curve (`1,000 vXLM -> 1,000 XLM`, `4.00x` curve, `0%` graduation cliff; 3-stage buy fees `0.30% / 0.50% / 0.25%`) · `33%` Soroswap DEX (100% LP time-locked 7 years in-contract via `reclaim_expired_lp`) · `0.3%` 15-day creator vesting · `0.4%` Escrowed 3-Checkpoint Jackpots (`+5K` Spark at `250 XLM` and `+10K` Crown at `500 XLM` escrowed until graduation via `claim_jackpot`; `+25K` Graduation at `1,000 XLM`) · `0.3%` Dev Ecosystem (`treasury` at graduation). Anti-MEV DEX buybacks capped at `min(0.25% pool, 0.8000000 XLM)` / `300s` with `+2%` XLM keeper rebate (`trigger_buyback_burn_with_bounty`), plus `48h` upgrade timelock.
3. **Curve Transfer Lock**: Pre-graduation P2P transfers (`transfer`, `transfer_from`) intentionally revert until graduation to prevent pre-seeding Soroswap pools (`PairAlreadySeeded` DoS); `burn` / `burn_from` remain enabled for Burn-to-Chat.
4. **No Soroswap Allowance Needed**: Soroswap Router moves tokens via direct `transfer` inside the atomic transaction.
5. **Pair Reserve Ordering**: Always read `token_0()`, `token_1()`, and `get_reserves()` directly on the Soroswap Pair contract rather than assuming lexical address sorting.
