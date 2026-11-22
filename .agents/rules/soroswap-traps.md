---
trigger: model_decision
description: "Verified on-chain Soroswap AMM traps, router/pair contract quirks, quote paths, and liquidity removal rules for AstroGate."
---

# Soroswap AMM Traps (Verified On-Chain)

Apply these rules whenever inspecting, modifying, or testing Soroswap AMM swaps, quotes, event discovery, or liquidity removal in `AstroGate`:

1. **Quoting (`router_get_amount_out`)**:
   - Quote with `router_get_amount_out(amount_in, reserve_in, reserve_out)` (30 bps swap fee).
   - **Trap**: `router_get_amounts_out` on this Soroswap deployment returns the raw input without quoting — do not use it.
2. **No Allowance Needed**:
   - Soroswap Router moves tokens via `transfer` (caller auth), not `transfer_from`. No `approve`/allowance step is needed.
3. **XLM -> Token Buy Path**:
   - Use path `[XLM_SAC, token]` and call `router_get_amount_out` with `reserve_in = reserveXlm`. Verified on testnet via `npm run verify:demo`.
4. **Deadline Parameter**:
   - Pass `deadline` as `unix_timestamp + 300`, which works safely regardless of whether the router compares against ledger timestamp or sequence assumptions.
5. **Pair Contract Is Source of Truth for Order & Reserves**:
   - Always call `token_0()`, `token_1()`, and `get_reserves()` directly on the Soroswap **Pair** contract (`CA...`).
   - **Trap**: Do not assume the token order returned by the router's `sort_tokens` matches the pair's internal storage order; `add_liquidity` and `remove_liquidity` expect amounts ordered per the pair contract.
6. **Unwrapping Soroban `Result<T, E>`**:
   - Every Soroswap contract call returns `Result<T, E>`: unwrap cleanly with `isErr()` / `unwrap()`, and never read `.result` twice.
7. **Token / Pair Discovery Without a Backend**:
   - Soroswap Factory (`CDP3...`) emits `["SoroswapFactory", "new_pair"]` containing `{ pair, token_0, token_1 }`. Use `getEvents` to discover pairs, bounded by the Soroban RPC event retention window.
8. **Liquidity Removal (`router.remove_liquidity`)**:
   - Always remove liquidity with `router.remove_liquidity` (atomic: transfers and burns LP tokens and returns both underlying assets in a single tx, ordered per the pair's internal token order).
   - Manual `transfer` to the pair + `withdraw(to)` also works, but can strand LP tokens if the second step fails.
9. **Missing `swap` Events on This Pair Version**:
   - This Soroswap pair deployment **does not emit `swap` events** (0 across 10k ledgers). Historical DEX swap price charts cannot be reconstructed from `getEvents` alone (requires an off-chain indexer or client snapshots).
