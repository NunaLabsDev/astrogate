import {LaunchpadError} from './types.js';
import type {TradeResult, CurveState, PilotRecord, BuyQuote, LaunchRecord, ShoutRecord, SellQuote, FairLaunchParams, LaunchResult, LaunchParams, MarketCardRecord, ContractEvent} from './types.js';
import {Spec, AssembledTransaction, Client as ContractClient} from '@stellar/stellar-sdk/contract';
import type {Result, ClientOptions as ContractClientOptions, MethodOptions, ExternalExecutableRef} from '@stellar/stellar-sdk/contract';
import {Address, xdr} from '@stellar/stellar-sdk';

export interface Client {
  /**
   * Upgrades Launchpad WASM bytecode in place (admin only).
   */
  upgrade(args: { new_wasm_hash: Uint8Array }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, LaunchpadError>>>;
  /**
   * Buys tokens from the bonding curve up to `max_xlm_in` (flat `0.80%` fee).
   * Automatically unlocks transfers, seeds Soroswap LP, and burns Milestone 1 vault tokens at 1,000 net XLM.
   */
  buy_curve(args: { buyer: string | Address; token: string | Address; max_xlm_in: bigint; min_tokens_out: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<TradeResult, LaunchpadError>>>;
  get_admin(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * Looks up the live bonding curve / graduation / burn-vault state for a token.
   */
  get_curve(args: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<CurveState | null>>;
  /**
   * Returns cumulative on-chain telemetry for a pilot wallet (used by Sorobits quests/epigenetics).
   */
  get_pilot(args: { user: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<PilotRecord>>;
  is_paused(options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Quotes buying tokens on an active bonding curve before graduation.
   */
  quote_buy(args: { token: string | Address; xlm_amount: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<BuyQuote, LaunchpadError>>>;
  /**
   * 3-tier Burn-to-Chat: permanently burns holder tokens (`>= 50` tokens) via `token.burn()`,
   * records up to 15 recent messages, and crowns a new `KingShout` when `>= 5,000` tokens
   * surpass the previous King burn amount.
   */
  burn_shout(args: { sender: string | Address; token: string | Address; amount: bigint; message: string }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, LaunchpadError>>>;
  /**
   * Permissionlessly refreshes the launchpad instance TTL for 90 days.
   */
  extend_ttl(options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Looks up a launch record by token contract address.
   */
  get_launch(args: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<LaunchRecord | null>>;
  /**
   * Returns recent on-chain Burn-to-Chat shouts for a token (oldest to newest, max 15).
   */
  get_shouts(args: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Array<ShoutRecord>>>;
  /**
   * Quotes selling tokens back into an active bonding curve before graduation.
   */
  quote_sell(args: { token: string | Address; token_amount: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<SellQuote, LaunchpadError>>>;
  /**
   * Sells tokens back to the bonding curve before graduation with slippage protection.
   */
  sell_curve(args: { seller: string | Address; token: string | Address; token_amount: bigint; min_xlm_out: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<TradeResult, LaunchpadError>>>;
  /**
   * Pauses or unpauses new token launches (`launch_fair` / `launch_token`); never blocks sells or claims.
   */
  set_paused(args: { paused: boolean }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, LaunchpadError>>>;
  /**
   * Read configuration methods.
   */
  get_factory(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  get_xlm_sac(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * Fair-Flywheel v4.3 launch: deploys fixed 10M token with P2P transfers locked until
   * graduation, renounces mint authority, initializes the `1,000 vXLM -> 1,000 XLM` curve
   * (`66/33/0.3/0.7`), and executes the creator's initial atomic buy (`>= 2 XLM`, locked
   * inside contract until graduation).
   */
  launch_fair(args: { params: FairLaunchParams }, options?: MethodOptions): Promise<AssembledTransaction<Result<LaunchResult, LaunchpadError>>>;
  /**
   * Completes a pending 2-step admin transfer.
   */
  accept_admin(options?: MethodOptions): Promise<AssembledTransaction<Result<null, LaunchpadError>>>;
  /**
   * Returns newest-first launches from the persistent on-chain registry.
   */
  get_launches(args: { offset: number; limit: number }, options?: MethodOptions): Promise<AssembledTransaction<Array<LaunchRecord>>>;
  get_treasury(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * Legacy-compatible direct Soroswap launch with explicit supply/decimals (`>= 99.5%` LP burned).
   */
  launch_token(args: { params: LaunchParams }, options?: MethodOptions): Promise<AssembledTransaction<Result<LaunchResult, LaunchpadError>>>;
  /**
   * Rotates the developer treasury address (admin only).
   */
  set_treasury(args: { new_treasury: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, LaunchpadError>>>;
  /**
   * Returns the pinned King Shout (highest `burn_shout >= 5,000` tokens), if any.
   */
  get_king_shout(args: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<ShoutRecord | null>>;
  /**
   * Starts a 2-step admin transfer to `new_admin` (7-day acceptance window for multisigs).
   */
  transfer_admin(args: { new_admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, LaunchpadError>>>;
  /**
   * Returns newest-first launches paired with their CurveState in one RPC call.
   */
  get_market_page(args: { offset: number; limit: number }, options?: MethodOptions): Promise<AssembledTransaction<Array<MarketCardRecord>>>;
  get_burn_address(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  get_creation_fee(options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Returns total number of tokens launched and indexed through this launchpad.
   */
  get_launch_count(options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * Updates the flat token creation fee in stroops (0..=1,000 XLM, admin only)
   * so protocol pricing can track XLM/USDC without redeploying the contract.
   */
  set_creation_fee(args: { new_fee_stroops: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, LaunchpadError>>>;
  /**
   * Permissionlessly refreshes TTL for a token's registry, curve, shouts, King Shout,
   * and persistent token balances held by the Launchpad and Soroswap pair.
   */
  extend_launch_ttl(args: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Reclaims time-locked Soroswap LP tokens to protocol treasury once the mandatory
   * 7-year lock (`LP_LOCK_DURATION_SECONDS`) after graduation has fully elapsed.
   */
  reclaim_expired_lp(args: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, LaunchpadError>>>;
  get_token_wasm_hash(options?: MethodOptions): Promise<AssembledTransaction<Uint8Array | null>>;
  /**
   * Updates the token WASM hash used for future token deployments (admin only).
   */
  set_token_wasm_hash(args: { new_wasm_hash: Uint8Array }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, LaunchpadError>>>;
  /**
   * Permissionlessly swaps the graduated `buyback_xlm_reserve` on Soroswap DEX
   * for real circulating tokens and permanently burns them via `token.burn()`.
   */
  trigger_buyback_burn(args: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, LaunchpadError>>>;
  /**
   * Lets the creator claim unlocked paid seed tokens (100% upon graduation, or after
   * 7 days if an ungraduated curve never reached graduation) plus `0.3%` bonus vesting
   * tranches (`20% = 6,000 tokens` every 3 days over 15 days post-graduation).
   */
  claim_creator_vesting(args: { creator: string | Address; token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, LaunchpadError>>>;
  /**
   * 1-click stalled launch refund (after 7 days if all external traders exited so
   * `tokens_sold == creator_seed_locked`): returns 100% of `real_xlm_vault` to creator
   * with zero 2.50% sell-fee penalty and zeroes the stalled curve cleanly.
   */
  refund_stalled_launch(args: { creator: string | Address; token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, LaunchpadError>>>;
  /**
   * Sweeps stranded floor fee dust to treasury when an ungraduated curve
   * has zero active circulating curve liability (`tokens_sold == 0`, all
   * circulating curve tokens were burned, or an abandoned curve `>= 30 days` old
   * where all external traders exited so `tokens_sold == creator_seed_locked`).
   */
  sweep_empty_curve_fees(args: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, LaunchpadError>>>;
  /**
   * Legacy milestone burn entrypoint (active only on v4.2 tokens with `burn_vault_remaining > 0`).
   */
  trigger_milestone_burn(args: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, LaunchpadError>>>;
}

export class Client extends ContractClient {
  readonly options: ContractClientOptions;
  constructor(options: ContractClientOptions) {
    super(
      new Spec(["AAAAAQAAAAAAAAAAAAAACEJ1eVF1b3RlAAAABwAAAAAAAAALZmxvb3JfYm9udXMAAAAACwAAAAAAAAAQbmV0X3hsbV90b19jdXJ2ZQAAAAsAAAAAAAAACnRva2Vuc19vdXQAAAAAAAsAAAAAAAAADXRvdGFsX2ZlZV9icHMAAAAAAAALAAAAAAAAABF0b3RhbF94bG1fY2hhcmdlZAAAAAAAAAsAAAAAAAAADHRyZWFzdXJ5X2ZlZQAAAAsAAAAAAAAADXdpbGxfZ3JhZHVhdGUAAAAAAAAB", "AAAAAQAAAAAAAAAAAAAACVNlbGxRdW90ZQAAAAAAAAUAAAAAAAAAC2Zsb29yX2JvbnVzAAAAAAsAAAAAAAAADWdyb3NzX3hsbV9vdXQAAAAAAAALAAAAAAAAAAtuZXRfeGxtX291dAAAAAALAAAAAAAAAA10b3RhbF9mZWVfYnBzAAAAAAAACwAAAAAAAAAMdHJlYXN1cnlfZmVlAAAACw==", "AAAAAAAAADdVcGdyYWRlcyBMYXVuY2hwYWQgV0FTTSBieXRlY29kZSBpbiBwbGFjZSAoYWRtaW4gb25seSkuAAAAAAd1cGdyYWRlAAAAAAEAAAAAAAAADW5ld193YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAB9AAAAAOTGF1bmNocGFkRXJyb3IAAA==", "AAAAAQAAAAAAAAAAAAAACkN1cnZlU3RhdGUAAAAAAA8AAABLQnVybiBzdGFnZSAoYDBgIHByZS1ncmFkOyBgMmAgZ3JhZHVhdGVkIGluIHY0LjMgd2l0aCB6ZXJvIGlkbGUgYnVybiB2YXVsdCkuAAAAABRidXJuX21pbGVzdG9uZV9zdGFnZQAAAAQAAAA/TGVnYWN5IFByb29mLW9mLUJ1cm4gdmF1bHQgYmFsYW5jZSAoYDBgIGluIEZhaXItRmx5d2hlZWwgdjQuMykuAAAAABRidXJuX3ZhdWx0X3JlbWFpbmluZwAAAAsAAABPUmVhbCBYTE0gcmVzZXJ2ZWQgZnJvbSBjdXJ2ZSBmZWVzIGZvciBwZXJtaXNzaW9ubGVzcyBTb3Jvc3dhcCBidXliYWNrLWFuZC1idXJuLgAAAAATYnV5YmFja194bG1fcmVzZXJ2ZQAAAAALAAAAAAAAAAdjcmVhdG9yAAAAABMAAAAxQ3VtdWxhdGl2ZSBjcmVhdG9yIHZlc3RpbmcgdG9rZW5zIGNsYWltZWQgc28gZmFyLgAAAAAAAA9jcmVhdG9yX2NsYWltZWQAAAAACwAAAEpDcmVhdG9yJ3MgaW5pdGlhbCBgbGF1bmNoX2ZhaXJgIHBhaWQgc2VlZCB0b2tlbnMsIGxvY2tlZCB1bnRpbCBncmFkdWF0aW9uLgAAAAAAE2NyZWF0b3Jfc2VlZF9sb2NrZWQAAAAACwAAAFdUb3RhbCBjcmVhdG9yIGJvbnVzIGFsbG9jYXRpb24gbG9ja2VkIHVudGlsIHBvc3QtZ3JhZCAxNS1kYXkgdmVzdGluZyAoYDMwLDAwMGAgPSAwLjMlKS4AAAAAFWNyZWF0b3JfdmVzdGluZ190b3RhbAAAAAAAAAsAAABETmV0IFhMTSB0cmFja2VkIGFsb25nIHRoZSB2aXJ0dWFsIGN1cnZlIGludmFyaWFudCAoYDAuLj0xLDAwMCBYTE1gKS4AAAANY3VydmVfeGxtX25ldAAAAAAAAAsAAAAAAAAACWdyYWR1YXRlZAAAAAAAAAEAAAAAAAAADGdyYWR1YXRlZF9hdAAAAAYAAAAAAAAACWxwX21pbnRlZAAAAAAAAAsAAAAAAAAABHBhaXIAAAPoAAAAEwAAAFJUb3RhbCByZWFsIFhMTSBoZWxkIGluc2lkZSB0aGUgY29udHJhY3QgdmF1bHQgZm9yIHRoaXMgdG9rZW4gKGA+PSBjdXJ2ZV94bG1fbmV0YCkuAAAAAAAOcmVhbF94bG1fdmF1bHQAAAAAAAsAAAAAAAAABXRva2VuAAAAAAAAEwAAAD5DdW11bGF0aXZlIHRva2VucyBzb2xkIG9uIHRoZSBib25kaW5nIGN1cnZlIChgMC4uPTYsNjAwLDAwMGApLgAAAAAAC3Rva2Vuc19zb2xkAAAAAAs=", "AAAABQAAAAAAAAAAAAAAClNob3V0RXZlbnQAAAAAAAEAAAALc2hvdXRfZXZlbnQAAAAABgAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAAAAAAAAGc2VuZGVyAAAAAAATAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAAAAAAHbWVzc2FnZQAAAAAQAAAAAAAAAAAAAAAHaXNfa2luZwAAAAABAAAAAAAAAAAAAAAGbGVkZ2VyAAAAAAAEAAAAAAAAAAI=", "AAAAAQAAAAAAAAAAAAAAC1BpbG90UmVjb3JkAAAAAAcAAAAAAAAAD2J1cm5zX3RyaWdnZXJlZAAAAAAEAAAAAAAAAAtncmFkdWF0aW9ucwAAAAAEAAAAAAAAAAtraW5nX3Nob3V0cwAAAAAEAAAAAAAAAAhsYXVuY2hlcwAAAAQAAAAAAAAABnNob3V0cwAAAAAABAAAAAAAAAAGdHJhZGVzAAAAAAAEAAAAAAAAABJ2b2x1bWVfeGxtX3N0cm9vcHMAAAAAAAs=", "AAAAAQAAAAAAAAAAAAAAC1Nob3V0UmVjb3JkAAAAAAUAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAGbGVkZ2VyAAAAAAAEAAAAAAAAAAdtZXNzYWdlAAAAABAAAAAAAAAABnNlbmRlcgAAAAAAEwAAAAAAAAAJdGltZXN0YW1wAAAAAAAABg==", "AAAAAQAAAAAAAAAAAAAAC1RyYWRlUmVzdWx0AAAAAAYAAAAAAAAAC2Zsb29yX2JvbnVzAAAAAAsAAAAAAAAACWdyYWR1YXRlZAAAAAAAAAEAAAAAAAAABHBhaXIAAAPoAAAAEwAAAAAAAAAGdG9rZW5zAAAAAAALAAAAAAAAAAx0cmVhc3VyeV9mZWUAAAALAAAAAAAAAAN4bG0AAAAACw==", "AAAAAAAAALJCdXlzIHRva2VucyBmcm9tIHRoZSBib25kaW5nIGN1cnZlIHVwIHRvIGBtYXhfeGxtX2luYCAoZmxhdCBgMC44MCVgIGZlZSkuCkF1dG9tYXRpY2FsbHkgdW5sb2NrcyB0cmFuc2ZlcnMsIHNlZWRzIFNvcm9zd2FwIExQLCBhbmQgYnVybnMgTWlsZXN0b25lIDEgdmF1bHQgdG9rZW5zIGF0IDEsMDAwIG5ldCBYTE0uAAAAAAAJYnV5X2N1cnZlAAAAAAAABAAAAAAAAAAFYnV5ZXIAAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAACm1heF94bG1faW4AAAAAAAsAAAAAAAAADm1pbl90b2tlbnNfb3V0AAAAAAALAAAAAQAAA+kAAAfQAAAAC1RyYWRlUmVzdWx0AAAAB9AAAAAOTGF1bmNocGFkRXJyb3IAAA==", "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAPoAAAAEw==", "AAAAAAAAAExMb29rcyB1cCB0aGUgbGl2ZSBib25kaW5nIGN1cnZlIC8gZ3JhZHVhdGlvbiAvIGJ1cm4tdmF1bHQgc3RhdGUgZm9yIGEgdG9rZW4uAAAACWdldF9jdXJ2ZQAAAAAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAPoAAAH0AAAAApDdXJ2ZVN0YXRlAAA=", "AAAAAAAAAF9SZXR1cm5zIGN1bXVsYXRpdmUgb24tY2hhaW4gdGVsZW1ldHJ5IGZvciBhIHBpbG90IHdhbGxldCAodXNlZCBieSBTb3JvYml0cyBxdWVzdHMvZXBpZ2VuZXRpY3MpLgAAAAAJZ2V0X3BpbG90AAAAAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAH0AAAAAtQaWxvdFJlY29yZAA=", "AAAAAAAAAAAAAAAJaXNfcGF1c2VkAAAAAAAAAAAAAAEAAAAB", "AAAAAAAAAEJRdW90ZXMgYnV5aW5nIHRva2VucyBvbiBhbiBhY3RpdmUgYm9uZGluZyBjdXJ2ZSBiZWZvcmUgZ3JhZHVhdGlvbi4AAAAAAAlxdW90ZV9idXkAAAAAAAACAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAACnhsbV9hbW91bnQAAAAAAAsAAAABAAAD6QAAB9AAAAAIQnV5UXVvdGUAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA=", "AAAAAQAAAAAAAAAAAAAADExhdW5jaFBhcmFtcwAAAAgAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAIZGVjaW1hbHMAAAAEAAAAAAAAAA5pbml0aWFsX3N1cHBseQAAAAAACwAAAAAAAAAEbmFtZQAAABAAAAAAAAAABHNhbHQAAAPuAAAAIAAAAAAAAAAGc3ltYm9sAAAAAAAQAAAAAAAAAA90b2tlbl9scF9hbW91bnQAAAAACwAAAAAAAAANeGxtX2xwX2Ftb3VudAAAAAAAAAs=", "AAAAAQAAAAAAAAAAAAAADExhdW5jaFJlY29yZAAAAA4AAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAIZGVjaW1hbHMAAAAEAAAAAAAAAAVpbmRleAAAAAAAAAQAAAAAAAAADmluaXRpYWxfc3VwcGx5AAAAAAALAAAAAAAAAAZsZWRnZXIAAAAAAAQAAAAAAAAACWxwX21pbnRlZAAAAAAAAAsAAAAAAAAABG1ldGEAAAAQAAAAAAAAAARuYW1lAAAAEAAAAAAAAAAEcGFpcgAAA+gAAAATAAAAAAAAAAZzeW1ib2wAAAAAABAAAAAAAAAACXRpbWVzdGFtcAAAAAAAAAYAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAPdG9rZW5fbHBfYW1vdW50AAAAAAsAAAAAAAAADXhsbV9scF9hbW91bnQAAAAAAAAL", "AAAAAQAAAAAAAAAAAAAADExhdW5jaFJlc3VsdAAAAAMAAAAAAAAACWxwX21pbnRlZAAAAAAAAAsAAAAAAAAABHBhaXIAAAPoAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAAT", "AAAAAAAAANYzLXRpZXIgQnVybi10by1DaGF0OiBwZXJtYW5lbnRseSBidXJucyBob2xkZXIgdG9rZW5zIChgPj0gNTBgIHRva2VucykgdmlhIGB0b2tlbi5idXJuKClgLApyZWNvcmRzIHVwIHRvIDE1IHJlY2VudCBtZXNzYWdlcywgYW5kIGNyb3ducyBhIG5ldyBgS2luZ1Nob3V0YCB3aGVuIGA+PSA1LDAwMGAgdG9rZW5zCnN1cnBhc3MgdGhlIHByZXZpb3VzIEtpbmcgYnVybiBhbW91bnQuAAAAAAAKYnVybl9zaG91dAAAAAAABAAAAAAAAAAGc2VuZGVyAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAHbWVzc2FnZQAAAAAQAAAAAQAAA+kAAAACAAAH0AAAAA5MYXVuY2hwYWRFcnJvcgAA", "AAAAAAAAAEJQZXJtaXNzaW9ubGVzc2x5IHJlZnJlc2hlcyB0aGUgbGF1bmNocGFkIGluc3RhbmNlIFRUTCBmb3IgOTAgZGF5cy4AAAAAAApleHRlbmRfdHRsAAAAAAAAAAAAAA==", "AAAAAAAAADNMb29rcyB1cCBhIGxhdW5jaCByZWNvcmQgYnkgdG9rZW4gY29udHJhY3QgYWRkcmVzcy4AAAAACmdldF9sYXVuY2gAAAAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAPoAAAH0AAAAAxMYXVuY2hSZWNvcmQ=", "AAAAAAAAAFNSZXR1cm5zIHJlY2VudCBvbi1jaGFpbiBCdXJuLXRvLUNoYXQgc2hvdXRzIGZvciBhIHRva2VuIChvbGRlc3QgdG8gbmV3ZXN0LCBtYXggMTUpLgAAAAAKZ2V0X3Nob3V0cwAAAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAA+oAAAfQAAAAC1Nob3V0UmVjb3JkAA==", "AAAAAAAAAEpRdW90ZXMgc2VsbGluZyB0b2tlbnMgYmFjayBpbnRvIGFuIGFjdGl2ZSBib25kaW5nIGN1cnZlIGJlZm9yZSBncmFkdWF0aW9uLgAAAAAACnF1b3RlX3NlbGwAAAAAAAIAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAMdG9rZW5fYW1vdW50AAAACwAAAAEAAAPpAAAH0AAAAAlTZWxsUXVvdGUAAAAAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA=", "AAAAAAAAAFJTZWxscyB0b2tlbnMgYmFjayB0byB0aGUgYm9uZGluZyBjdXJ2ZSBiZWZvcmUgZ3JhZHVhdGlvbiB3aXRoIHNsaXBwYWdlIHByb3RlY3Rpb24uAAAAAAAKc2VsbF9jdXJ2ZQAAAAAABAAAAAAAAAAGc2VsbGVyAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAADHRva2VuX2Ftb3VudAAAAAsAAAAAAAAAC21pbl94bG1fb3V0AAAAAAsAAAABAAAD6QAAB9AAAAALVHJhZGVSZXN1bHQAAAAH0AAAAA5MYXVuY2hwYWRFcnJvcgAA", "AAAAAAAAAGVQYXVzZXMgb3IgdW5wYXVzZXMgbmV3IHRva2VuIGxhdW5jaGVzIChgbGF1bmNoX2ZhaXJgIC8gYGxhdW5jaF90b2tlbmApOyBuZXZlciBibG9ja3Mgc2VsbHMgb3IgY2xhaW1zLgAAAAAAAApzZXRfcGF1c2VkAAAAAAABAAAAAAAAAAZwYXVzZWQAAAAAAAEAAAABAAAD6QAAAAIAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA=", "AAAAAAAAABtSZWFkIGNvbmZpZ3VyYXRpb24gbWV0aG9kcy4AAAAAC2dldF9mYWN0b3J5AAAAAAAAAAABAAAD6AAAABM=", "AAAAAAAAAAAAAAALZ2V0X3hsbV9zYWMAAAAAAAAAAAEAAAPoAAAAEw==", "AAAAAAAAASBGYWlyLUZseXdoZWVsIHY0LjMgbGF1bmNoOiBkZXBsb3lzIGZpeGVkIDEwTSB0b2tlbiB3aXRoIFAyUCB0cmFuc2ZlcnMgbG9ja2VkIHVudGlsCmdyYWR1YXRpb24sIHJlbm91bmNlcyBtaW50IGF1dGhvcml0eSwgaW5pdGlhbGl6ZXMgdGhlIGAxLDAwMCB2WExNIC0+IDEsMDAwIFhMTWAgY3VydmUKKGA2Ni8zMy8wLjMvMC43YCksIGFuZCBleGVjdXRlcyB0aGUgY3JlYXRvcidzIGluaXRpYWwgYXRvbWljIGJ1eSAoYD49IDIgWExNYCwgbG9ja2VkCmluc2lkZSBjb250cmFjdCB1bnRpbCBncmFkdWF0aW9uKS4AAAALbGF1bmNoX2ZhaXIAAAAAAQAAAAAAAAAGcGFyYW1zAAAAAAfQAAAAEEZhaXJMYXVuY2hQYXJhbXMAAAABAAAD6QAAB9AAAAAMTGF1bmNoUmVzdWx0AAAH0AAAAA5MYXVuY2hwYWRFcnJvcgAA", "AAAABAAAAAAAAAAAAAAADkxhdW5jaHBhZEVycm9yAAAAAAAKAAAANUluc3RhbmNlIGNvbmZpZ3VyYXRpb24gbWlzc2luZyBmcm9tIGNvbnRyYWN0IHN0b3JhZ2UuAAAAAAAADk5vdEluaXRpYWxpemVkAAAAAAABAAAAREludmFsaWQgc3VwcGx5LCBhbW91bnQsIFhMTSBzZWVkLCBidXJuIGFtb3VudCwgb3IgemVyby1vdXRwdXQgdHJhZGUuAAAADUludmFsaWRBbW91bnQAAAAAAAACAAAAOlRoZSB0b2tlbi9YTE0gcGFpciBhbHJlYWR5IGV4aXN0ZWQgd2l0aCBub24temVybyByZXNlcnZlcy4AAAAAABFQYWlyQWxyZWFkeVNlZWRlZAAAAAAAAAMAAABKVG9rZW4gbWV0YWRhdGEsIHNob3V0IG1lc3NhZ2UsIG9yIG9mZi1jaGFpbiBKU09OIG1ldGFkYXRhIHZpb2xhdGVzIGJvdW5kcy4AAAAAAA9JbnZhbGlkTWV0YWRhdGEAAAAABAAAADxUcmFkZSBvdXRwdXQgaXMgYmVsb3cgdGhlIHVzZXIncyBtaW5pbXVtIHNsaXBwYWdlIHRocmVzaG9sZC4AAAAQU2xpcHBhZ2VFeGNlZWRlZAAAAAUAAABLT3BlcmF0aW9uIGludmFsaWQgZm9yIHRoZSB0b2tlbidzIGN1cnJlbnQgYm9uZGluZy1jdXJ2ZSAvIGdyYWR1YXRpb24gc3RhdGUuAAAAABFJbnZhbGlkQ3VydmVTdGF0ZQAAAAAAAAYAAABFQm9uZGluZyBjdXJ2ZSBvciBjcmVhdG9yIHZlc3Rpbmcgc3RhdGUgZG9lcyBub3QgZXhpc3QgZm9yIHRoaXMgdG9rZW4uAAAAAAAADUN1cnZlTm90Rm91bmQAAAAAAAAHAAAAPE5vdGhpbmcgdW5sb2NrZWQgb3IgbWlsZXN0b25lIHJlc2VydmUgY29uZGl0aW9uIG5vdCB5ZXQgbWV0LgAAABNNaWxlc3RvbmVOb3RSZWFjaGVkAAAAAAgAAAA2TmV3IGxhdW5jaGVzIGFyZSB0ZW1wb3JhcmlseSBwYXVzZWQgYnkgcHJvdG9jb2wgYWRtaW4uAAAAAAAOTGF1bmNoZXNQYXVzZWQAAAAAAAkAAAA2VW5hdXRob3JpemVkIGNhbGxlciBvciBtaXNzaW5nIHBlbmRpbmcgYWRtaW4gdHJhbnNmZXIuAAAAAAAMVW5hdXRob3JpemVkAAAACg==", "AAAAAAAAACpDb21wbGV0ZXMgYSBwZW5kaW5nIDItc3RlcCBhZG1pbiB0cmFuc2Zlci4AAAAAAAxhY2NlcHRfYWRtaW4AAAAAAAAAAQAAA+kAAAACAAAH0AAAAA5MYXVuY2hwYWRFcnJvcgAA", "AAAAAAAAAERSZXR1cm5zIG5ld2VzdC1maXJzdCBsYXVuY2hlcyBmcm9tIHRoZSBwZXJzaXN0ZW50IG9uLWNoYWluIHJlZ2lzdHJ5LgAAAAxnZXRfbGF1bmNoZXMAAAACAAAAAAAAAAZvZmZzZXQAAAAAAAQAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPqAAAH0AAAAAxMYXVuY2hSZWNvcmQ=", "AAAAAAAAAAAAAAAMZ2V0X3RyZWFzdXJ5AAAAAAAAAAEAAAPoAAAAEw==", "AAAAAAAAAF5MZWdhY3ktY29tcGF0aWJsZSBkaXJlY3QgU29yb3N3YXAgbGF1bmNoIHdpdGggZXhwbGljaXQgc3VwcGx5L2RlY2ltYWxzIChgPj0gOTkuNSVgIExQIGJ1cm5lZCkuAAAAAAAMbGF1bmNoX3Rva2VuAAAAAQAAAAAAAAAGcGFyYW1zAAAAAAfQAAAADExhdW5jaFBhcmFtcwAAAAEAAAPpAAAH0AAAAAxMYXVuY2hSZXN1bHQAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA=", "AAAAAAAAADRSb3RhdGVzIHRoZSBkZXZlbG9wZXIgdHJlYXN1cnkgYWRkcmVzcyAoYWRtaW4gb25seSkuAAAADHNldF90cmVhc3VyeQAAAAEAAAAAAAAADG5ld190cmVhc3VyeQAAABMAAAABAAAD6QAAAAIAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA=", "AAAABQAAAAAAAAAAAAAADlJlY2xhaW1McEV2ZW50AAAAAAABAAAAEHJlY2xhaW1fbHBfZXZlbnQAAAAEAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAAAAAAAARwYWlyAAAAEwAAAAAAAAAAAAAACXJlY2lwaWVudAAAAAAAABMAAAAAAAAAAAAAAAlscF9hbW91bnQAAAAAAAALAAAAAAAAAAI=", "AAAAAAAAAGhJbml0aWFsaXplcyB0aGUgbGF1bmNocGFkIHdpdGggbmV0d29yayBhZGRyZXNzZXMsIHRva2VuIFdBU00gaGFzaCwgYnVybiBhZGRyZXNzLCBhbmQgZGV2ZWxvcGVyIHRyZWFzdXJ5LgAAAA1fX2NvbnN0cnVjdG9yAAAAAAAABQAAAAAAAAAHZmFjdG9yeQAAAAATAAAAAAAAAAd4bG1fc2FjAAAAABMAAAAAAAAAD3Rva2VuX3dhc21faGFzaAAAAAPuAAAAIAAAAAAAAAAMYnVybl9hZGRyZXNzAAAAEwAAAAAAAAAIdHJlYXN1cnkAAAATAAAAAA==", "AAAABQAAAAAAAAAAAAAAD0N1cnZlVHJhZGVFdmVudAAAAAABAAAAEWN1cnZlX3RyYWRlX2V2ZW50AAAAAAAACQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAAAAAAAAGdHJhZGVyAAAAAAATAAAAAQAAAAAAAAAGaXNfYnV5AAAAAAABAAAAAAAAAAAAAAAKeGxtX2Ftb3VudAAAAAAACwAAAAAAAAAAAAAADHRva2VuX2Ftb3VudAAAAAsAAAAAAAAAAAAAAAx0cmVhc3VyeV9mZWUAAAALAAAAAAAAAAAAAAALZmxvb3JfYm9udXMAAAAACwAAAAAAAAAAAAAADWN1cnZlX3hsbV9uZXQAAAAAAAALAAAAAAAAAAAAAAALdG9rZW5zX3NvbGQAAAAACwAAAAAAAAAC", "AAAAAQAAAN5GYWlyLUZseXdoZWVsIHY0LjMgTGF1bmNoIHBhcmFtZXRlcnM6IGZpeGVkIDEwTSBzdXBwbHkgKGA2NiVgIGN1cnZlIC8gYDMzJWAgREVYIHdpdGgKNy15ZWFyIExQIGxvY2sgLyBgMC4zJWAgMTUtZGF5IGNyZWF0b3IgdmVzdGluZyAvIGAwLjclYCBlY29zeXN0ZW0pIHdpdGggY3JlYXRvcidzCmluaXRpYWwgY3VydmUgYnV5IChgPj0gMiBYTE1gKSBsb2NrZWQgdW50aWwgZ3JhZHVhdGlvbi4AAAAAAAAAAAAQRmFpckxhdW5jaFBhcmFtcwAAAAYAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAEbWV0YQAAABAAAAAAAAAABG5hbWUAAAAQAAAAAAAAAARzYWx0AAAD7gAAACAAAAAAAAAABnN5bWJvbAAAAAAAEAAAAAAAAAANeGxtX2xwX2Ftb3VudAAAAAAAAAs=", "AAAAAQAAAAAAAAAAAAAAEE1hcmtldENhcmRSZWNvcmQAAAACAAAAAAAAAAVjdXJ2ZQAAAAAAA+oAAAfQAAAACkN1cnZlU3RhdGUAAAAAAAAAAAAGcmVjb3JkAAAAAAfQAAAADExhdW5jaFJlY29yZA==", "AAAAAAAAAE1SZXR1cm5zIHRoZSBwaW5uZWQgS2luZyBTaG91dCAoaGlnaGVzdCBgYnVybl9zaG91dCA+PSA1LDAwMGAgdG9rZW5zKSwgaWYgYW55LgAAAAAAAA5nZXRfa2luZ19zaG91dAAAAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAA+gAAAfQAAAAC1Nob3V0UmVjb3JkAA==", "AAAAAAAAAFZTdGFydHMgYSAyLXN0ZXAgYWRtaW4gdHJhbnNmZXIgdG8gYG5ld19hZG1pbmAgKDctZGF5IGFjY2VwdGFuY2Ugd2luZG93IGZvciBtdWx0aXNpZ3MpLgAAAAAADnRyYW5zZmVyX2FkbWluAAAAAAABAAAAAAAAAAluZXdfYWRtaW4AAAAAAAATAAAAAQAAA+kAAAACAAAH0AAAAA5MYXVuY2hwYWRFcnJvcgAA", "AAAABQAAAAAAAAAAAAAAEEJ1eWJhY2tCdXJuRXZlbnQAAAABAAAAEmJ1eWJhY2tfYnVybl9ldmVudAAAAAAABAAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAAAAAAAAJeGxtX3NwZW50AAAAAAAACwAAAAAAAAAAAAAADXRva2Vuc19idXJuZWQAAAAAAAALAAAAAAAAAAAAAAASdG90YWxfc3VwcGx5X2FmdGVyAAAAAAALAAAAAAAAAAI=", "AAAAAAAAAEtSZXR1cm5zIG5ld2VzdC1maXJzdCBsYXVuY2hlcyBwYWlyZWQgd2l0aCB0aGVpciBDdXJ2ZVN0YXRlIGluIG9uZSBSUEMgY2FsbC4AAAAAD2dldF9tYXJrZXRfcGFnZQAAAAACAAAAAAAAAAZvZmZzZXQAAAAAAAQAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPqAAAH0AAAABBNYXJrZXRDYXJkUmVjb3Jk", "AAAAAAAAAAAAAAAQZ2V0X2J1cm5fYWRkcmVzcwAAAAAAAAABAAAD6AAAABM=", "AAAAAAAAAAAAAAAQZ2V0X2NyZWF0aW9uX2ZlZQAAAAAAAAABAAAACw==", "AAAAAAAAAEtSZXR1cm5zIHRvdGFsIG51bWJlciBvZiB0b2tlbnMgbGF1bmNoZWQgYW5kIGluZGV4ZWQgdGhyb3VnaCB0aGlzIGxhdW5jaHBhZC4AAAAAEGdldF9sYXVuY2hfY291bnQAAAAAAAAAAQAAAAQ=", "AAAAAAAAAJNVcGRhdGVzIHRoZSBmbGF0IHRva2VuIGNyZWF0aW9uIGZlZSBpbiBzdHJvb3BzICgwLi49MSwwMDAgWExNLCBhZG1pbiBvbmx5KQpzbyBwcm90b2NvbCBwcmljaW5nIGNhbiB0cmFjayBYTE0vVVNEQyB3aXRob3V0IHJlZGVwbG95aW5nIHRoZSBjb250cmFjdC4AAAAAEHNldF9jcmVhdGlvbl9mZWUAAAABAAAAAAAAAA9uZXdfZmVlX3N0cm9vcHMAAAAACwAAAAEAAAPpAAAAAgAAB9AAAAAOTGF1bmNocGFkRXJyb3IAAA==", "AAAABQAAAAAAAAAAAAAAEk1pbGVzdG9uZUJ1cm5FdmVudAAAAAAAAQAAABRtaWxlc3RvbmVfYnVybl9ldmVudAAAAAQAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAAAAAAABXN0YWdlAAAAAAAABAAAAAAAAAAAAAAADWJ1cm5lZF9hbW91bnQAAAAAAAALAAAAAAAAAAAAAAASdG90YWxfc3VwcGx5X2FmdGVyAAAAAAALAAAAAAAAAAI=", "AAAABQAAAAAAAAAAAAAAElRva2VuTGF1bmNoZWRFdmVudAAAAAAAAQAAABR0b2tlbl9sYXVuY2hlZF9ldmVudAAAAAUAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAAAAAADmluaXRpYWxfc3VwcGx5AAAAAAALAAAAAAAAAAAAAAALeGxtX2luaXRpYWwAAAAACwAAAAAAAAAAAAAACGlzX2N1cnZlAAAAAQAAAAAAAAAC", "AAAAAAAAAJhQZXJtaXNzaW9ubGVzc2x5IHJlZnJlc2hlcyBUVEwgZm9yIGEgdG9rZW4ncyByZWdpc3RyeSwgY3VydmUsIHNob3V0cywgS2luZyBTaG91dCwKYW5kIHBlcnNpc3RlbnQgdG9rZW4gYmFsYW5jZXMgaGVsZCBieSB0aGUgTGF1bmNocGFkIGFuZCBTb3Jvc3dhcCBwYWlyLgAAABFleHRlbmRfbGF1bmNoX3R0bAAAAAAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAA=", "AAAABQAAAAAAAAAAAAAAE1Rva2VuR3JhZHVhdGVkRXZlbnQAAAAAAQAAABV0b2tlbl9ncmFkdWF0ZWRfZXZlbnQAAAAAAAAGAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAAAAAAAARwYWlyAAAAEwAAAAAAAAAAAAAADXhsbV9kZXBvc2l0ZWQAAAAAAAALAAAAAAAAAAAAAAAQdG9rZW5zX2RlcG9zaXRlZAAAAAsAAAAAAAAAAAAAAAlscF9taW50ZWQAAAAAAAALAAAAAAAAAAAAAAAMdmF1bHRfYnVybmVkAAAACwAAAAAAAAAC", "AAAAAAAAAJxSZWNsYWltcyB0aW1lLWxvY2tlZCBTb3Jvc3dhcCBMUCB0b2tlbnMgdG8gcHJvdG9jb2wgdHJlYXN1cnkgb25jZSB0aGUgbWFuZGF0b3J5CjcteWVhciBsb2NrIChgTFBfTE9DS19EVVJBVElPTl9TRUNPTkRTYCkgYWZ0ZXIgZ3JhZHVhdGlvbiBoYXMgZnVsbHkgZWxhcHNlZC4AAAAScmVjbGFpbV9leHBpcmVkX2xwAAAAAAABAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAD6QAAAAsAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA=", "AAAAAAAAAAAAAAATZ2V0X3Rva2VuX3dhc21faGFzaAAAAAAAAAAAAQAAA+gAAAPuAAAAIA==", "AAAAAAAAAEtVcGRhdGVzIHRoZSB0b2tlbiBXQVNNIGhhc2ggdXNlZCBmb3IgZnV0dXJlIHRva2VuIGRlcGxveW1lbnRzIChhZG1pbiBvbmx5KS4AAAAAE3NldF90b2tlbl93YXNtX2hhc2gAAAAAAQAAAAAAAAANbmV3X3dhc21faGFzaAAAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAH0AAAAA5MYXVuY2hwYWRFcnJvcgAA", "AAAAAAAAAJVQZXJtaXNzaW9ubGVzc2x5IHN3YXBzIHRoZSBncmFkdWF0ZWQgYGJ1eWJhY2tfeGxtX3Jlc2VydmVgIG9uIFNvcm9zd2FwIERFWApmb3IgcmVhbCBjaXJjdWxhdGluZyB0b2tlbnMgYW5kIHBlcm1hbmVudGx5IGJ1cm5zIHRoZW0gdmlhIGB0b2tlbi5idXJuKClgLgAAAAAAABR0cmlnZ2VyX2J1eWJhY2tfYnVybgAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAPpAAAACwAAB9AAAAAOTGF1bmNocGFkRXJyb3IAAA==", "AAAAAAAAAO5MZXRzIHRoZSBjcmVhdG9yIGNsYWltIHVubG9ja2VkIHBhaWQgc2VlZCB0b2tlbnMgKDEwMCUgdXBvbiBncmFkdWF0aW9uLCBvciBhZnRlcgo3IGRheXMgaWYgYW4gdW5ncmFkdWF0ZWQgY3VydmUgbmV2ZXIgcmVhY2hlZCBncmFkdWF0aW9uKSBwbHVzIGAwLjMlYCBib251cyB2ZXN0aW5nCnRyYW5jaGVzIChgMjAlID0gNiwwMDAgdG9rZW5zYCBldmVyeSAzIGRheXMgb3ZlciAxNSBkYXlzIHBvc3QtZ3JhZHVhdGlvbikuAAAAAAAVY2xhaW1fY3JlYXRvcl92ZXN0aW5nAAAAAAAAAgAAAAAAAAAHY3JlYXRvcgAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAD6QAAAAsAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA=", "AAAAAAAAAOcxLWNsaWNrIHN0YWxsZWQgbGF1bmNoIHJlZnVuZCAoYWZ0ZXIgNyBkYXlzIGlmIGFsbCBleHRlcm5hbCB0cmFkZXJzIGV4aXRlZCBzbwpgdG9rZW5zX3NvbGQgPT0gY3JlYXRvcl9zZWVkX2xvY2tlZGApOiByZXR1cm5zIDEwMCUgb2YgYHJlYWxfeGxtX3ZhdWx0YCB0byBjcmVhdG9yCndpdGggemVybyAyLjUwJSBzZWxsLWZlZSBwZW5hbHR5IGFuZCB6ZXJvZXMgdGhlIHN0YWxsZWQgY3VydmUgY2xlYW5seS4AAAAAFXJlZnVuZF9zdGFsbGVkX2xhdW5jaAAAAAAAAAIAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAA+kAAAALAAAH0AAAAA5MYXVuY2hwYWRFcnJvcgAA", "AAAAAAAAASJTd2VlcHMgc3RyYW5kZWQgZmxvb3IgZmVlIGR1c3QgdG8gdHJlYXN1cnkgd2hlbiBhbiB1bmdyYWR1YXRlZCBjdXJ2ZQpoYXMgemVybyBhY3RpdmUgY2lyY3VsYXRpbmcgY3VydmUgbGlhYmlsaXR5IChgdG9rZW5zX3NvbGQgPT0gMGAsIGFsbApjaXJjdWxhdGluZyBjdXJ2ZSB0b2tlbnMgd2VyZSBidXJuZWQsIG9yIGFuIGFiYW5kb25lZCBjdXJ2ZSBgPj0gMzAgZGF5c2Agb2xkCndoZXJlIGFsbCBleHRlcm5hbCB0cmFkZXJzIGV4aXRlZCBzbyBgdG9rZW5zX3NvbGQgPT0gY3JlYXRvcl9zZWVkX2xvY2tlZGApLgAAAAAAFnN3ZWVwX2VtcHR5X2N1cnZlX2ZlZXMAAAAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAPpAAAACwAAB9AAAAAOTGF1bmNocGFkRXJyb3IAAA==", "AAAAAAAAAF5MZWdhY3kgbWlsZXN0b25lIGJ1cm4gZW50cnlwb2ludCAoYWN0aXZlIG9ubHkgb24gdjQuMiB0b2tlbnMgd2l0aCBgYnVybl92YXVsdF9yZW1haW5pbmcgPiAwYCkuAAAAAAAWdHJpZ2dlcl9taWxlc3RvbmVfYnVybgAAAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAA+kAAAALAAAH0AAAAA5MYXVuY2hwYWRFcnJvcgAA"]),
      options
    );
    this.options = options;
  }

   static deploy<T = Client>(args: { factory: string | Address; xlm_sac: string | Address; token_wasm_hash: Uint8Array; burn_address: string | Address; treasury: string | Address }, options: MethodOptions & Omit<ContractClientOptions, 'contractId'> & { salt?: Uint8Array; address?: string; } & ({ wasmHash: Uint8Array | string; format?: "hex" | "base64"; externalRef?: never; } | { externalRef: ExternalExecutableRef; wasmHash?: never; format?: never; })): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(args, options);
  }
  public readonly fromJson = {
    upgrade : this.txFromJson<Result<null, LaunchpadError>>,  buy_curve : this.txFromJson<Result<TradeResult, LaunchpadError>>,  get_admin : this.txFromJson<string | null>,  get_curve : this.txFromJson<CurveState | null>,  get_pilot : this.txFromJson<PilotRecord>,  is_paused : this.txFromJson<boolean>,  quote_buy : this.txFromJson<Result<BuyQuote, LaunchpadError>>,  burn_shout : this.txFromJson<Result<null, LaunchpadError>>,  extend_ttl : this.txFromJson<void>,  get_launch : this.txFromJson<LaunchRecord | null>,  get_shouts : this.txFromJson<Array<ShoutRecord>>,  quote_sell : this.txFromJson<Result<SellQuote, LaunchpadError>>,  sell_curve : this.txFromJson<Result<TradeResult, LaunchpadError>>,  set_paused : this.txFromJson<Result<null, LaunchpadError>>,  get_factory : this.txFromJson<string | null>,  get_xlm_sac : this.txFromJson<string | null>,  launch_fair : this.txFromJson<Result<LaunchResult, LaunchpadError>>,  accept_admin : this.txFromJson<Result<null, LaunchpadError>>,  get_launches : this.txFromJson<Array<LaunchRecord>>,  get_treasury : this.txFromJson<string | null>,  launch_token : this.txFromJson<Result<LaunchResult, LaunchpadError>>,  set_treasury : this.txFromJson<Result<null, LaunchpadError>>,  get_king_shout : this.txFromJson<ShoutRecord | null>,  transfer_admin : this.txFromJson<Result<null, LaunchpadError>>,  get_market_page : this.txFromJson<Array<MarketCardRecord>>,  get_burn_address : this.txFromJson<string | null>,  get_creation_fee : this.txFromJson<bigint>,  get_launch_count : this.txFromJson<number>,  set_creation_fee : this.txFromJson<Result<null, LaunchpadError>>,  extend_launch_ttl : this.txFromJson<void>,  reclaim_expired_lp : this.txFromJson<Result<bigint, LaunchpadError>>,  get_token_wasm_hash : this.txFromJson<Uint8Array | null>,  set_token_wasm_hash : this.txFromJson<Result<null, LaunchpadError>>,  trigger_buyback_burn : this.txFromJson<Result<bigint, LaunchpadError>>,  claim_creator_vesting : this.txFromJson<Result<bigint, LaunchpadError>>,  refund_stalled_launch : this.txFromJson<Result<bigint, LaunchpadError>>,  sweep_empty_curve_fees : this.txFromJson<Result<bigint, LaunchpadError>>,  trigger_milestone_burn : this.txFromJson<Result<bigint, LaunchpadError>>
  };

  /** @deprecated Use fromJson instead. */
  public readonly fromJSON = this.fromJson;

  /**
   * Parse a raw contract event (topics + data) into a typed {@link ContractEvent}.
   */
  parseEvent(topics: xdr.ScVal[] | string[], data: xdr.ScVal | string): ContractEvent | undefined {
    return this.spec.parseEvent(topics, data) as ContractEvent | undefined;
  }
  /**
   * Build a topics filter row for the "ShoutEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  shoutEventEventFilter(topicValues?: { token?: string | Address }): string[] {
    return this.spec.eventTopicFilter("ShoutEvent", topicValues);
  }
  /**
   * Build a topics filter row for the "ReclaimLpEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  reclaimLpEventEventFilter(topicValues?: { token?: string | Address }): string[] {
    return this.spec.eventTopicFilter("ReclaimLpEvent", topicValues);
  }
  /**
   * Build a topics filter row for the "CurveTradeEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  curveTradeEventEventFilter(topicValues?: { token?: string | Address; trader?: string | Address }): string[] {
    return this.spec.eventTopicFilter("CurveTradeEvent", topicValues);
  }
  /**
   * Build a topics filter row for the "BuybackBurnEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  buybackBurnEventEventFilter(topicValues?: { token?: string | Address }): string[] {
    return this.spec.eventTopicFilter("BuybackBurnEvent", topicValues);
  }
  /**
   * Build a topics filter row for the "MilestoneBurnEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  milestoneBurnEventEventFilter(topicValues?: { token?: string | Address }): string[] {
    return this.spec.eventTopicFilter("MilestoneBurnEvent", topicValues);
  }
  /**
   * Build a topics filter row for the "TokenLaunchedEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  tokenLaunchedEventEventFilter(topicValues?: { creator?: string | Address }): string[] {
    return this.spec.eventTopicFilter("TokenLaunchedEvent", topicValues);
  }
  /**
   * Build a topics filter row for the "TokenGraduatedEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  tokenGraduatedEventEventFilter(topicValues?: { token?: string | Address }): string[] {
    return this.spec.eventTopicFilter("TokenGraduatedEvent", topicValues);
  }
}