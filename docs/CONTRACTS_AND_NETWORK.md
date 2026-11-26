# AstroGate Contracts, Wallets & Network Reference (Testnet)

> Canonical runtime presets live in [`frontend/src/lib/network.ts`](../frontend/src/lib/network.ts).  
> AstroGate operates on **Stellar Testnet** (`Test SDF Network ; September 2015`). Mainnet IDs in `network.ts` are intentionally blank and require build-time `VITE_*` overrides.

---

## 1. Testnet Endpoints & Contract Addresses

| Component | Identifier / Endpoint | Notes |
| :--- | :--- | :--- |
| **Soroban RPC (primary)** | `https://soroban-testnet.stellar.org` | Transaction submission pinned here |
| **Soroban RPC (fallback)** | `https://rpc-testnet.stellar.org` | Read-only failover pool in `network.ts` |
| **Horizon API** | `https://horizon-testnet.stellar.org` | Account reserves, subentries & balances |
| **Soroswap Factory** | `CDP3HMUH6SMS3S7NPGNDJLULCOXXEPSHY4JKUKMBNQMATHDHWXRRJTBY` | Emits `["SoroswapFactory", "new_pair"]` |
| **Soroswap Router** | `CCJUD55AG6W5HAI5LRVNKAE5WDP5XGZBUDS5WNTIVDU7O264UZZE7BRD` | Use `router_get_amount_out` (see `.agents/rules/soroswap-traps.md`) |
| **Native XLM SAC** | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` | Mainnet canonical SAC: `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA` |
| **Flagship Launchpad Token (`$ASTRO`)** | `CAI637WCEILQF3ZYOV6BRUCX532XQIVOOJ4CRWFPWHQRJHOH5OKHSXRE` | 7 decimals, fixed `10,000,000` supply (`cap`) |
| **Token WASM Hash (v4.2 deployed)** | `bc3ababa6a10d8385101ac29ecdac84e9375d628df190c0f4f88defe4544f0e6` | `astro-token` SEP-41 with `lock_until_graduated` |
| **ASTRO / XLM Soroswap Pair** | `CA32TMZ2AODXI7K7B6T2YPZR52HJKFCY5GT2DNHMOL326DLSNPX55BUP` | Graduated flagship pool |
| **Launchpad Contract (v4.5)** | `CB5VMDAPQUK5LT5LH5L5THI6XYYUBTAXM7BJZLZYFGUJHZB64LZHFAPK` | Upgraded in-place on Testnet; 48h upgrade timelock |
| **Launchpad WASM Hash (v4.5)** | `9db8d446725715069d85c51c4fb1b897bb93d036507a6b95fe085c64f4aaa4e9` | Matches `network.ts` & `README.md` |
| **Sorobits NFT Contract (SEP-50, v4.5)** | `CBVETCPLVAMNUUQRUJGH54XHVQT5ZOVB4FGGP2IGOGAZLUIYBBV7G3I3` | 32×32 on-chain RLE/SVG; 48h upgrade timelock |
| **Sorobits WASM Hash (v4.5)** | `bc5c0d36b9add840685f734709a32945a88e0353d49b57b938d54ae68a7d5adf` | Matches `network.ts` & `README.md` |
| **Anti-Rug Burn Blackhole** | `GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF` | Legacy LP burn sink (v4.3+ locks LP 7Y in-contract) |

---

## 2. Testnet Operational Accounts

- **Developer Treasury (Testnet)**: `GDQT2KMQ5I2EFDK3WG42YBHRIC4B7OXL7K2G3IC2Z6LPTJEEOMXD7NQE` (`astrogate-treasury`)
- **Deployer / Ops Account (Testnet)**: `GB6CISIU2PAG7MVCR4HKA27VY5OBBJ4P2L5IDEOH7UL34TU66OOFCNZA` (`astrogate-deployer`)
- **Secret storage (outside git)**: `~/.secrets/astrogate/developer-accounts.env` (and `~/.secrets/astrogate/telegram-bot.env`, `~/.config/cloudflare/cf-api-token`). Never commit secret seeds (`S...`).
