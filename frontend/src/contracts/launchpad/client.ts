import {LaunchpadError} from './types.js';
import type {TradeResult, CurveState, PilotRecord, BuyQuote, LaunchRecord, ShoutRecord, SellQuote, FairLaunchParams, LaunchResult, LaunchParams, MarketCardRecord, PendingUpgradeData, ContractEvent} from './types.js';
import {Spec, AssembledTransaction, Client as ContractClient} from '@stellar/stellar-sdk/contract';
import type {Result, ClientOptions as ContractClientOptions, MethodOptions, ExternalExecutableRef} from '@stellar/stellar-sdk/contract';
import {Address, xdr} from '@stellar/stellar-sdk';

export interface Client {
  /**
   * Buys tokens from the bonding curve up to `max_xlm_in` (3-stage soft dynamic buy fee).
   * Automatically unlocks transfers and seeds Soroswap LP at 1,000 net XLM.
   */
  buy_curve(args: { buyer: string | Address; token: string | Address; max_xlm_in: bigint; min_tokens_out: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<TradeResult, LaunchpadError>>>;
  get_admin(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * Looks up the live bonding curve / graduation / burn-vault state for a token (pure read).
   */
  get_curve(args: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<CurveState | null>>;
  /**
   * Returns cumulative on-chain telemetry for a pilot wallet (pure read).
   */
  get_pilot(args: { user: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<PilotRecord>>;
  is_paused(options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Quotes buying tokens on an active bonding curve before graduation.
   */
  quote_buy(args: { token: string | Address; xlm_amount: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<BuyQuote, LaunchpadError>>>;
  /**
   * 3-tier Burn-to-Chat: permanently burns holder tokens (`>= 50` whole tokens scaled
   * by `token.decimals`) via `token.burn()`, records up to 15 recent messages, and
   * crowns a new `KingShout` when `>= 5,000` whole tokens surpass the decayed King burn.
   */
  burn_shout(args: { sender: string | Address; token: string | Address; amount: bigint; message: string }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, LaunchpadError>>>;
  /**
   * Permissionlessly refreshes the launchpad instance TTL for 90 days.
   */
  extend_ttl(options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Looks up a launch record by token contract address (pure read).
   */
  get_launch(args: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<LaunchRecord | null>>;
  /**
   * Returns recent on-chain Burn-to-Chat shouts for a token (oldest to newest, max 15; pure read).
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
   * Fair-Flywheel v4.4 launch: deploys fixed 10M token with P2P transfers locked until
   * graduation, renounces mint authority, initializes the `1,000 vXLM -> 1,000 XLM` curve
   * (`66/33/0.30/0.40 jackpots/0.30`), and executes the creator's initial atomic buy
   * (`>= 2 XLM`, locked inside contract until graduation).
   */
  launch_fair(args: { params: FairLaunchParams }, options?: MethodOptions): Promise<AssembledTransaction<Result<LaunchResult, LaunchpadError>>>;
  /**
   * Completes a pending 2-step admin transfer.
   */
  accept_admin(options?: MethodOptions): Promise<AssembledTransaction<Result<null, LaunchpadError>>>;
  /**
   * Returns newest-first launches from the persistent on-chain registry (pure read).
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
   * Cancels a previously scheduled Launchpad WASM upgrade (admin only).
   */
  cancel_upgrade(options?: MethodOptions): Promise<AssembledTransaction<Result<null, LaunchpadError>>>;
  /**
   * Returns the pinned King Shout (highest decayed `burn_shout >= 5,000` whole tokens), if any (pure read).
   */
  get_king_shout(args: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<ShoutRecord | null>>;
  /**
   * Starts a 2-step admin transfer to `new_admin` (7-day acceptance window for multisigs).
   */
  transfer_admin(args: { new_admin: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, LaunchpadError>>>;
  /**
   * Executes a scheduled Launchpad WASM upgrade once the 48-hour timelock has elapsed (admin only).
   */
  execute_upgrade(options?: MethodOptions): Promise<AssembledTransaction<Result<null, LaunchpadError>>>;
  /**
   * Returns newest-first launches paired with their CurveState in one RPC call.
   */
  get_market_page(args: { offset: number; limit: number }, options?: MethodOptions): Promise<AssembledTransaction<Array<MarketCardRecord>>>;
  /**
   * Permissionlessly refreshes TTL for a pilot telemetry record.
   */
  extend_pilot_ttl(args: { user: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  get_burn_address(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  get_creation_fee(options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Returns total number of tokens launched and indexed through this launchpad.
   */
  get_launch_count(options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * Schedules a Launchpad WASM bytecode upgrade behind a mandatory 48-hour timelock (admin only).
   */
  schedule_upgrade(args: { new_wasm_hash: Uint8Array }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, LaunchpadError>>>;
  /**
   * Updates the flat token creation fee in stroops (0..=1,000 XLM, admin only)
   * so protocol pricing can track XLM/USDC without redeploying the contract.
   */
  set_creation_fee(args: { new_fee_stroops: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<null, LaunchpadError>>>;
  /**
   * Permissionlessly refreshes TTL for a token's registry, curve, shouts, King Shout,
   * buyback cooldown entry, and persistent balances (token + Soroswap pair LP shares).
   */
  extend_launch_ttl(args: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Reclaims time-locked Soroswap LP tokens to protocol treasury once the mandatory
   * 7-year lock (`LP_LOCK_DURATION_SECONDS`) after graduation has fully elapsed.
   */
  reclaim_expired_lp(args: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, LaunchpadError>>>;
  /**
   * Returns the currently scheduled WASM upgrade awaiting timelock expiry, if any.
   */
  get_pending_upgrade(options?: MethodOptions): Promise<AssembledTransaction<PendingUpgradeData | null>>;
  /**
   * Returns the initialized schema storage version for upgrade migrations.
   */
  get_storage_version(options?: MethodOptions): Promise<AssembledTransaction<number>>;
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
   * Cancels a pending 2-step admin transfer before acceptance (admin only).
   */
  cancel_admin_transfer(options?: MethodOptions): Promise<AssembledTransaction<Result<null, LaunchpadError>>>;
  /**
   * Lets the creator claim unlocked paid seed tokens (100% upon graduation, or after
   * 7 days if an ungraduated curve never reached graduation) plus `0.3%` bonus vesting
   * tranches (`20% = 6,000 tokens` every 3 days over 15 days post-graduation).
   */
  claim_creator_vesting(args: { creator: string | Address; token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, LaunchpadError>>>;
  /**
   * Permissionlessly refreshes TTL for an escrowed checkpoint reward entry.
   */
  extend_checkpoint_ttl(args: { token: string | Address; recipient: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Returns pre-graduation Spark/Crown checkpoint tokens escrowed for `recipient` (pure read).
   */
  get_checkpoint_reward(args: { token: string | Address; recipient: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * 1-click stalled launch refund (after 7 days if all external traders exited or burned):
   * refunds creator's `curve_xlm_net` XLM reserve while leaving accumulated fee dust for treasury sweep.
   */
  refund_stalled_launch(args: { creator: string | Address; token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, LaunchpadError>>>;
  /**
   * Sweeps stranded floor fee dust to treasury when an ungraduated curve
   * has zero external circulating curve liability. For `>= 30 days` abandoned curves
   * where `creator_seed_locked > 0`, cleanly refunds `curve_xlm_net` back to the
   * creator and sweeps only surplus fee dust to treasury (never returning phantom tokens).
   */
  sweep_empty_curve_fees(args: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, LaunchpadError>>>;
  /**
   * Legacy milestone burn entrypoint (active only on v4.2 tokens with `burn_vault_remaining > 0`).
   */
  trigger_milestone_burn(args: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, LaunchpadError>>>;
  /**
   * Claims pre-graduation Spark/Crown checkpoint jackpot tokens escrowed for `winner`
   * once the token has graduated to Soroswap (`curve.graduated == true`).
   */
  claim_checkpoint_reward(args: { winner: string | Address; token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, LaunchpadError>>>;
  /**
   * Slippage-protected Soroswap DEX buyback-and-burn requiring at least `min_tokens_burned`.
   */
  trigger_buyback_burn_min(args: { token: string | Address; min_tokens_burned: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, LaunchpadError>>>;
}

export class Client extends ContractClient {
  readonly options: ContractClientOptions;
  constructor(options: ContractClientOptions) {
    super(
      new Spec(["AAAAAQAAAAAAAAAAAAAACEJ1eVF1b3RlAAAABwAAAAAAAAALZmxvb3JfYm9udXMAAAAACwAAAAAAAAAQbmV0X3hsbV90b19jdXJ2ZQAAAAsAAAAAAAAACnRva2Vuc19vdXQAAAAAAAsAAAAAAAAADXRvdGFsX2ZlZV9icHMAAAAAAAALAAAAAAAAABF0b3RhbF94bG1fY2hhcmdlZAAAAAAAAAsAAAAAAAAADHRyZWFzdXJ5X2ZlZQAAAAsAAAAAAAAADXdpbGxfZ3JhZHVhdGUAAAAAAAAB", "AAAAAQAAAAAAAAAAAAAACVNlbGxRdW90ZQAAAAAAAAUAAAAAAAAAC2Zsb29yX2JvbnVzAAAAAAsAAAAAAAAADWdyb3NzX3hsbV9vdXQAAAAAAAALAAAAAAAAAAtuZXRfeGxtX291dAAAAAALAAAAAAAAAA10b3RhbF9mZWVfYnBzAAAAAAAACwAAAAAAAAAMdHJlYXN1cnlfZmVlAAAACw==", "AAAAAQAAAAAAAAAAAAAACkN1cnZlU3RhdGUAAAAAAA8AAABLQnVybiBzdGFnZSAoYDBgIHByZS1ncmFkOyBgMmAgZ3JhZHVhdGVkIGluIHY0LjMgd2l0aCB6ZXJvIGlkbGUgYnVybiB2YXVsdCkuAAAAABRidXJuX21pbGVzdG9uZV9zdGFnZQAAAAQAAAA/TGVnYWN5IFByb29mLW9mLUJ1cm4gdmF1bHQgYmFsYW5jZSAoYDBgIGluIEZhaXItRmx5d2hlZWwgdjQuMykuAAAAABRidXJuX3ZhdWx0X3JlbWFpbmluZwAAAAsAAABPUmVhbCBYTE0gcmVzZXJ2ZWQgZnJvbSBjdXJ2ZSBmZWVzIGZvciBwZXJtaXNzaW9ubGVzcyBTb3Jvc3dhcCBidXliYWNrLWFuZC1idXJuLgAAAAATYnV5YmFja194bG1fcmVzZXJ2ZQAAAAALAAAAAAAAAAdjcmVhdG9yAAAAABMAAAAxQ3VtdWxhdGl2ZSBjcmVhdG9yIHZlc3RpbmcgdG9rZW5zIGNsYWltZWQgc28gZmFyLgAAAAAAAA9jcmVhdG9yX2NsYWltZWQAAAAACwAAAEpDcmVhdG9yJ3MgaW5pdGlhbCBgbGF1bmNoX2ZhaXJgIHBhaWQgc2VlZCB0b2tlbnMsIGxvY2tlZCB1bnRpbCBncmFkdWF0aW9uLgAAAAAAE2NyZWF0b3Jfc2VlZF9sb2NrZWQAAAAACwAAAFdUb3RhbCBjcmVhdG9yIGJvbnVzIGFsbG9jYXRpb24gbG9ja2VkIHVudGlsIHBvc3QtZ3JhZCAxNS1kYXkgdmVzdGluZyAoYDMwLDAwMGAgPSAwLjMlKS4AAAAAFWNyZWF0b3JfdmVzdGluZ190b3RhbAAAAAAAAAsAAABETmV0IFhMTSB0cmFja2VkIGFsb25nIHRoZSB2aXJ0dWFsIGN1cnZlIGludmFyaWFudCAoYDAuLj0xLDAwMCBYTE1gKS4AAAANY3VydmVfeGxtX25ldAAAAAAAAAsAAAAAAAAACWdyYWR1YXRlZAAAAAAAAAEAAAAAAAAADGdyYWR1YXRlZF9hdAAAAAYAAAAAAAAACWxwX21pbnRlZAAAAAAAAAsAAAAAAAAABHBhaXIAAAPoAAAAEwAAAFJUb3RhbCByZWFsIFhMTSBoZWxkIGluc2lkZSB0aGUgY29udHJhY3QgdmF1bHQgZm9yIHRoaXMgdG9rZW4gKGA+PSBjdXJ2ZV94bG1fbmV0YCkuAAAAAAAOcmVhbF94bG1fdmF1bHQAAAAAAAsAAAAAAAAABXRva2VuAAAAAAAAEwAAAD5DdW11bGF0aXZlIHRva2VucyBzb2xkIG9uIHRoZSBib25kaW5nIGN1cnZlIChgMC4uPTYsNjAwLDAwMGApLgAAAAAAC3Rva2Vuc19zb2xkAAAAAAs=", "AAAABQAAAAAAAAAAAAAAClNob3V0RXZlbnQAAAAAAAEAAAALc2hvdXRfZXZlbnQAAAAABgAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAAAAAAAAGc2VuZGVyAAAAAAATAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAAAAAAHbWVzc2FnZQAAAAAQAAAAAAAAAAAAAAAHaXNfa2luZwAAAAABAAAAAAAAAAAAAAAGbGVkZ2VyAAAAAAAEAAAAAAAAAAI=", "AAAAAQAAAAAAAAAAAAAAC1BpbG90UmVjb3JkAAAAAAcAAAAAAAAAD2J1cm5zX3RyaWdnZXJlZAAAAAAEAAAAAAAAAAtncmFkdWF0aW9ucwAAAAAEAAAAAAAAAAtraW5nX3Nob3V0cwAAAAAEAAAAAAAAAAhsYXVuY2hlcwAAAAQAAAAAAAAABnNob3V0cwAAAAAABAAAAAAAAAAGdHJhZGVzAAAAAAAEAAAAAAAAABJ2b2x1bWVfeGxtX3N0cm9vcHMAAAAAAAs=", "AAAAAQAAAAAAAAAAAAAAC1Nob3V0UmVjb3JkAAAAAAUAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAGbGVkZ2VyAAAAAAAEAAAAAAAAAAdtZXNzYWdlAAAAABAAAAAAAAAABnNlbmRlcgAAAAAAEwAAAAAAAAAJdGltZXN0YW1wAAAAAAAABg==", "AAAAAQAAAAAAAAAAAAAAC1RyYWRlUmVzdWx0AAAAAAYAAAAAAAAAC2Zsb29yX2JvbnVzAAAAAAsAAAAAAAAACWdyYWR1YXRlZAAAAAAAAAEAAAAAAAAABHBhaXIAAAPoAAAAEwAAAAAAAAAGdG9rZW5zAAAAAAALAAAAAAAAAAx0cmVhc3VyeV9mZWUAAAALAAAAAAAAAAN4bG0AAAAACw==", "AAAAAQAAAAAAAAAAAAAADExhdW5jaFBhcmFtcwAAAAgAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAIZGVjaW1hbHMAAAAEAAAAAAAAAA5pbml0aWFsX3N1cHBseQAAAAAACwAAAAAAAAAEbmFtZQAAABAAAAAAAAAABHNhbHQAAAPuAAAAIAAAAAAAAAAGc3ltYm9sAAAAAAAQAAAAAAAAAA90b2tlbl9scF9hbW91bnQAAAAACwAAAAAAAAANeGxtX2xwX2Ftb3VudAAAAAAAAAs=", "AAAAAQAAAAAAAAAAAAAADExhdW5jaFJlY29yZAAAAA4AAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAIZGVjaW1hbHMAAAAEAAAAAAAAAAVpbmRleAAAAAAAAAQAAAAAAAAADmluaXRpYWxfc3VwcGx5AAAAAAALAAAAAAAAAAZsZWRnZXIAAAAAAAQAAAAAAAAACWxwX21pbnRlZAAAAAAAAAsAAAAAAAAABG1ldGEAAAAQAAAAAAAAAARuYW1lAAAAEAAAAAAAAAAEcGFpcgAAA+gAAAATAAAAAAAAAAZzeW1ib2wAAAAAABAAAAAAAAAACXRpbWVzdGFtcAAAAAAAAAYAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAPdG9rZW5fbHBfYW1vdW50AAAAAAsAAAAAAAAADXhsbV9scF9hbW91bnQAAAAAAAAL", "AAAAAQAAAAAAAAAAAAAADExhdW5jaFJlc3VsdAAAAAMAAAAAAAAACWxwX21pbnRlZAAAAAAAAAsAAAAAAAAABHBhaXIAAAPoAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAAT", "AAAABAAAAAAAAAAAAAAADkxhdW5jaHBhZEVycm9yAAAAAAAKAAAANUluc3RhbmNlIGNvbmZpZ3VyYXRpb24gbWlzc2luZyBmcm9tIGNvbnRyYWN0IHN0b3JhZ2UuAAAAAAAADk5vdEluaXRpYWxpemVkAAAAAAABAAAAREludmFsaWQgc3VwcGx5LCBhbW91bnQsIFhMTSBzZWVkLCBidXJuIGFtb3VudCwgb3IgemVyby1vdXRwdXQgdHJhZGUuAAAADUludmFsaWRBbW91bnQAAAAAAAACAAAAOlRoZSB0b2tlbi9YTE0gcGFpciBhbHJlYWR5IGV4aXN0ZWQgd2l0aCBub24temVybyByZXNlcnZlcy4AAAAAABFQYWlyQWxyZWFkeVNlZWRlZAAAAAAAAAMAAABKVG9rZW4gbWV0YWRhdGEsIHNob3V0IG1lc3NhZ2UsIG9yIG9mZi1jaGFpbiBKU09OIG1ldGFkYXRhIHZpb2xhdGVzIGJvdW5kcy4AAAAAAA9JbnZhbGlkTWV0YWRhdGEAAAAABAAAADxUcmFkZSBvdXRwdXQgaXMgYmVsb3cgdGhlIHVzZXIncyBtaW5pbXVtIHNsaXBwYWdlIHRocmVzaG9sZC4AAAAQU2xpcHBhZ2VFeGNlZWRlZAAAAAUAAABLT3BlcmF0aW9uIGludmFsaWQgZm9yIHRoZSB0b2tlbidzIGN1cnJlbnQgYm9uZGluZy1jdXJ2ZSAvIGdyYWR1YXRpb24gc3RhdGUuAAAAABFJbnZhbGlkQ3VydmVTdGF0ZQAAAAAAAAYAAABFQm9uZGluZyBjdXJ2ZSBvciBjcmVhdG9yIHZlc3Rpbmcgc3RhdGUgZG9lcyBub3QgZXhpc3QgZm9yIHRoaXMgdG9rZW4uAAAAAAAADUN1cnZlTm90Rm91bmQAAAAAAAAHAAAAPE5vdGhpbmcgdW5sb2NrZWQgb3IgbWlsZXN0b25lIHJlc2VydmUgY29uZGl0aW9uIG5vdCB5ZXQgbWV0LgAAABNNaWxlc3RvbmVOb3RSZWFjaGVkAAAAAAgAAAA2TmV3IGxhdW5jaGVzIGFyZSB0ZW1wb3JhcmlseSBwYXVzZWQgYnkgcHJvdG9jb2wgYWRtaW4uAAAAAAAOTGF1bmNoZXNQYXVzZWQAAAAAAAkAAAA2VW5hdXRob3JpemVk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", "AAAABQAAAAAAAAAAAAAAE1Rva2VuR3JhZHVhdGVkRXZlbnQAAAAAAQAAABV0b2tlbl9ncmFkdWF0ZWRfZXZlbnQAAAAAAAAGAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAAAAAAAARwYWlyAAAAEwAAAAAAAAAAAAAADXhsbV9kZXBvc2l0ZWQAAAAAAAALAAAAAAAAAAAAAAAQdG9rZW5zX2RlcG9zaXRlZAAAAAsAAAAAAAAAAAAAAAlscF9taW50ZWQAAAAAAAALAAAAAAAAAAAAAAAMdmF1bHRfYnVybmVkAAAACwAAAAAAAAAC", "AAAABQAAAAAAAAAAAAAAFFRyZWFzdXJ5VXBkYXRlZEV2ZW50AAAAAQAAABZ0cmVhc3VyeV91cGRhdGVkX2V2ZW50AAAAAAABAAAAAAAAAAxuZXdfdHJlYXN1cnkAAAATAAAAAQAAAAI=", "AAAABQAAAAAAAAAAAAAAFFVwZ3JhZGVFeGVjdXRlZEV2ZW50AAAAAQAAABZ1cGdyYWRlX2V4ZWN1dGVkX2V2ZW50AAAAAAABAAAAAAAAAAl3YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAAAAAAC", "AAAABQAAAAAAAAAAAAAAFVVwZ3JhZGVDYW5jZWxsZWRFdmVudAAAAAAAAAEAAAAXdXBncmFkZV9jYW5jZWxsZWRfZXZlbnQAAAAAAQAAAAAAAAAJd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAAAAAAAg==", "AAAABQAAAAAAAAAAAAAAFVVwZ3JhZGVTY2hlZHVsZWRFdmVudAAAAAAAAAEAAAAXdXBncmFkZV9zY2hlZHVsZWRfZXZlbnQAAAAAAgAAAAAAAAAJd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAAAAAAAAAAAA1leGVjdXRlX2FmdGVyAAAAAAAABgAAAAAAAAAC", "AAAABQAAAAAAAAAAAAAAF0NyZWF0aW9uRmVlVXBkYXRlZEV2ZW50AAAAAAEAAAAaY3JlYXRpb25fZmVlX3VwZGF0ZWRfZXZlbnQAAAAAAAEAAAAAAAAAD25ld19mZWVfc3Ryb29wcwAAAAALAAAAAAAAAAI=", "AAAABQAAAAAAAAAAAAAAGVRva2VuV2FzbUhhc2hVcGRhdGVkRXZlbnQAAAAAAAABAAAAHXRva2VuX3dhc21faGFzaF91cGRhdGVkX2V2ZW50AAAAAAAAAQAAAAAAAAANbmV3X3dhc21faGFzaAAAAAAAA+4AAAAgAAAAAAAAAAI=", "AAAABQAAAAAAAAAAAAAAGkFkbWluVHJhbnNmZXJBY2NlcHRlZEV2ZW50AAAAAAABAAAAHWFkbWluX3RyYW5zZmVyX2FjY2VwdGVkX2V2ZW50AAAAAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAEAAAAC", "AAAABQAAAAAAAAAAAAAAGkFkbWluVHJhbnNmZXJQcm9wb3NlZEV2ZW50AAAAAAABAAAAHWFkbWluX3RyYW5zZmVyX3Byb3Bvc2VkX2V2ZW50AAAAAAAAAQAAAAAAAAANcGVuZGluZ19hZG1pbgAAAAAAABMAAAABAAAAAg==", "AAAABQAAAAAAAAAAAAAAG0FkbWluVHJhbnNmZXJDYW5jZWxsZWRFdmVudAAAAAABAAAAHmFkbWluX3RyYW5zZmVyX2NhbmNlbGxlZF9ldmVudAAAAAAAAQAAAAAAAAAPY2FuY2VsbGVkX2FkbWluAAAAABMAAAABAAAAAg==", "AAAABQAAAAAAAAAAAAAAHENoZWNrcG9pbnRSZXdhcmRDbGFpbWVkRXZlbnQAAAABAAAAH2NoZWNrcG9pbnRfcmV3YXJkX2NsYWltZWRfZXZlbnQAAAAAAwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAAAAAAAAGd2lubmVyAAAAAAATAAAAAQAAAAAAAAAGcmV3YXJkAAAAAAALAAAAAAAAAAI=", "AAAABQAAAAAAAAAAAAAAHUNoZWNrcG9pbnRSZXdhcmRFc2Nyb3dlZEV2ZW50AAAAAAAAAQAAACBjaGVja3BvaW50X3Jld2FyZF9lc2Nyb3dlZF9ldmVudAAAAAMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAAAAAAABndpbm5lcgAAAAAAEwAAAAEAAAAAAAAABnJld2FyZAAAAAAACwAAAAAAAAAC", "AAAAAAAAAJ1CdXlzIHRva2VucyBmcm9tIHRoZSBib25kaW5nIGN1cnZlIHVwIHRvIGBtYXhfeGxtX2luYCAoMy1zdGFnZSBzb2Z0IGR5bmFtaWMgYnV5IGZlZSkuCkF1dG9tYXRpY2FsbHkgdW5sb2NrcyB0cmFuc2ZlcnMgYW5kIHNlZWRzIFNvcm9zd2FwIExQIGF0IDEsMDAwIG5ldCBYTE0uAAAAAAAACWJ1eV9jdXJ2ZQAAAAAAAAQAAAAAAAAABWJ1eWVyAAAAAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAptYXhfeGxtX2luAAAAAAALAAAAAAAAAA5taW5fdG9rZW5zX291dAAAAAAACwAAAAEAAAPpAAAH0AAAAAtUcmFkZVJlc3VsdAAAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA=", "AAAAAAAAAAAAAAAJZ2V0X2FkbWluAAAAAAAAAAAAAAEAAAPoAAAAEw==", "AAAAAAAAAFhMb29rcyB1cCB0aGUgbGl2ZSBib25kaW5nIGN1cnZlIC8gZ3JhZHVhdGlvbiAvIGJ1cm4tdmF1bHQgc3RhdGUgZm9yIGEgdG9rZW4gKHB1cmUgcmVhZCkuAAAACWdldF9jdXJ2ZQAAAAAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAPoAAAH0AAAAApDdXJ2ZVN0YXRlAAA=", "AAAAAAAAAEVSZXR1cm5zIGN1bXVsYXRpdmUgb24tY2hhaW4gdGVsZW1ldHJ5IGZvciBhIHBpbG90IHdhbGxldCAocHVyZSByZWFkKS4AAAAAAAAJZ2V0X3BpbG90AAAAAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAH0AAAAAtQaWxvdFJlY29yZAA=", "AAAAAAAAAAAAAAAJaXNfcGF1c2VkAAAAAAAAAAAAAAEAAAAB", "AAAAAAAAAEJRdW90ZXMgYnV5aW5nIHRva2VucyBvbiBhbiBhY3RpdmUgYm9uZGluZyBjdXJ2ZSBiZWZvcmUgZ3JhZHVhdGlvbi4AAAAAAAlxdW90ZV9idXkAAAAAAAACAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAACnhsbV9hbW91bnQAAAAAAAsAAAABAAAD6QAAB9AAAAAIQnV5UXVvdGUAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA=", "AAAAAAAAAPUzLXRpZXIgQnVybi10by1DaGF0OiBwZXJtYW5lbnRseSBidXJucyBob2xkZXIgdG9rZW5zIChgPj0gNTBgIHdob2xlIHRva2VucyBzY2FsZWQKYnkgYHRva2VuLmRlY2ltYWxzYCkgdmlhIGB0b2tlbi5idXJuKClgLCByZWNvcmRzIHVwIHRvIDE1IHJlY2VudCBtZXNzYWdlcywgYW5kCmNyb3ducyBhIG5ldyBgS2luZ1Nob3V0YCB3aGVuIGA+PSA1LDAwMGAgd2hvbGUgdG9rZW5zIHN1cnBhc3MgdGhlIGRlY2F5ZWQgS2luZyBidXJuLgAAAAAAAApidXJuX3Nob3V0AAAAAAAEAAAAAAAAAAZzZW5kZXIAAAAAABMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAdtZXNzYWdlAAAAABAAAAABAAAD6QAAAAIAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA=", "AAAAAAAAAEJQZXJtaXNzaW9ubGVzc2x5IHJlZnJlc2hlcyB0aGUgbGF1bmNocGFkIGluc3RhbmNlIFRUTCBmb3IgOTAgZGF5cy4AAAAAAApleHRlbmRfdHRsAAAAAAAAAAAAAA==", "AAAAAAAAAD9Mb29rcyB1cCBhIGxhdW5jaCByZWNvcmQgYnkgdG9rZW4gY29udHJhY3QgYWRkcmVzcyAocHVyZSByZWFkKS4AAAAACmdldF9sYXVuY2gAAAAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAPoAAAH0AAAAAxMYXVuY2hSZWNvcmQ=", "AAAAAAAAAF5SZXR1cm5zIHJlY2VudCBvbi1jaGFpbiBCdXJuLXRvLUNoYXQgc2hvdXRzIGZvciBhIHRva2VuIChvbGRlc3QgdG8gbmV3ZXN0LCBtYXggMTU7IHB1cmUgcmVhZCkuAAAAAAAKZ2V0X3Nob3V0cwAAAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAA+oAAAfQAAAAC1Nob3V0UmVjb3JkAA==", "AAAAAAAAAEpRdW90ZXMgc2VsbGluZyB0b2tlbnMgYmFjayBpbnRvIGFuIGFjdGl2ZSBib25kaW5nIGN1cnZlIGJlZm9yZSBncmFkdWF0aW9uLgAAAAAACnF1b3RlX3NlbGwAAAAAAAIAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAMdG9rZW5fYW1vdW50AAAACwAAAAEAAAPpAAAH0AAAAAlTZWxsUXVvdGUAAAAAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA=", "AAAAAAAAAFJTZWxscyB0b2tlbnMgYmFjayB0byB0aGUgYm9uZGluZyBjdXJ2ZSBiZWZvcmUgZ3JhZHVhdGlvbiB3aXRoIHNsaXBwYWdlIHByb3RlY3Rpb24uAAAAAAAKc2VsbF9jdXJ2ZQAAAAAABAAAAAAAAAAGc2VsbGVyAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAADHRva2VuX2Ftb3VudAAAAAsAAAAAAAAAC21pbl94bG1fb3V0AAAAAAsAAAABAAAD6QAAB9AAAAALVHJhZGVSZXN1bHQAAAAH0AAAAA5MYXVuY2hwYWRFcnJvcgAA", "AAAAAAAAAGVQYXVzZXMgb3IgdW5wYXVzZXMgbmV3IHRva2VuIGxhdW5jaGVzIChgbGF1bmNoX2ZhaXJgIC8gYGxhdW5jaF90b2tlbmApOyBuZXZlciBibG9ja3Mgc2VsbHMgb3IgY2xhaW1zLgAAAAAAAApzZXRfcGF1c2VkAAAAAAABAAAAAAAAAAZwYXVzZWQAAAAAAAEAAAABAAAD6QAAAAIAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA=", "AAAAAAAAABtSZWFkIGNvbmZpZ3VyYXRpb24gbWV0aG9kcy4AAAAAC2dldF9mYWN0b3J5AAAAAAAAAAABAAAD6AAAABM=", "AAAAAAAAAAAAAAALZ2V0X3hsbV9zYWMAAAAAAAAAAAEAAAPoAAAAEw==", "AAAAAAAAATBGYWlyLUZseXdoZWVsIHY0LjQgbGF1bmNoOiBkZXBsb3lzIGZpeGVkIDEwTSB0b2tlbiB3aXRoIFAyUCB0cmFuc2ZlcnMgbG9ja2VkIHVudGlsCmdyYWR1YXRpb24sIHJlbm91bmNlcyBtaW50IGF1dGhvcml0eSwgaW5pdGlhbGl6ZXMgdGhlIGAxLDAwMCB2WExNIC0+IDEsMDAwIFhMTWAgY3VydmUKKGA2Ni8zMy8wLjMwLzAuNDAgamFja3BvdHMvMC4zMGApLCBhbmQgZXhlY3V0ZXMgdGhlIGNyZWF0b3IncyBpbml0aWFsIGF0b21pYyBidXkKKGA+PSAyIFhMTWAsIGxvY2tlZCBpbnNpZGUgY29udHJhY3QgdW50aWwgZ3JhZHVhdGlvbikuAAAAC2xhdW5jaF9mYWlyAAAAAAEAAAAAAAAABnBhcmFtcwAAAAAH0AAAABBGYWlyTGF1bmNoUGFyYW1zAAAAAQAAA+kAAAfQAAAADExhdW5jaFJlc3VsdAAAB9AAAAAOTGF1bmNocGFkRXJyb3IAAA==", "AAAAAAAAACpDb21wbGV0ZXMgYSBwZW5kaW5nIDItc3RlcCBhZG1pbiB0cmFuc2Zlci4AAAAAAAxhY2NlcHRfYWRtaW4AAAAAAAAAAQAAA+kAAAACAAAH0AAAAA5MYXVuY2hwYWRFcnJvcgAA", "AAAAAAAAAFBSZXR1cm5zIG5ld2VzdC1maXJzdCBsYXVuY2hlcyBmcm9tIHRoZSBwZXJzaXN0ZW50IG9uLWNoYWluIHJlZ2lzdHJ5IChwdXJlIHJlYWQpLgAAAAxnZXRfbGF1bmNoZXMAAAACAAAAAAAAAAZvZmZzZXQAAAAAAAQAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPqAAAH0AAAAAxMYXVuY2hSZWNvcmQ=", "AAAAAAAAAAAAAAAMZ2V0X3RyZWFzdXJ5AAAAAAAAAAEAAAPoAAAAEw==", "AAAAAAAAAF5MZWdhY3ktY29tcGF0aWJsZSBkaXJlY3QgU29yb3N3YXAgbGF1bmNoIHdpdGggZXhwbGljaXQgc3VwcGx5L2RlY2ltYWxzIChgPj0gOTkuNSVgIExQIGJ1cm5lZCkuAAAAAAAMbGF1bmNoX3Rva2VuAAAAAQAAAAAAAAAGcGFyYW1zAAAAAAfQAAAADExhdW5jaFBhcmFtcwAAAAEAAAPpAAAH0AAAAAxMYXVuY2hSZXN1bHQAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA=", "AAAAAAAAADRSb3RhdGVzIHRoZSBkZXZlbG9wZXIgdHJlYXN1cnkgYWRkcmVzcyAoYWRtaW4gb25seSkuAAAADHNldF90cmVhc3VyeQAAAAEAAAAAAAAADG5ld190cmVhc3VyeQAAABMAAAABAAAD6QAAAAIAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA=", "AAAAAAAAAGhJbml0aWFsaXplcyB0aGUgbGF1bmNocGFkIHdpdGggbmV0d29yayBhZGRyZXNzZXMsIHRva2VuIFdBU00gaGFzaCwgYnVybiBhZGRyZXNzLCBhbmQgZGV2ZWxvcGVyIHRyZWFzdXJ5LgAAAA1fX2NvbnN0cnVjdG9yAAAAAAAABQAAAAAAAAAHZmFjdG9yeQAAAAATAAAAAAAAAAd4bG1fc2FjAAAAABMAAAAAAAAAD3Rva2VuX3dhc21faGFzaAAAAAPuAAAAIAAAAAAAAAAMYnVybl9hZGRyZXNzAAAAEwAAAAAAAAAIdHJlYXN1cnkAAAATAAAAAA==", "AAAAAAAAAENDYW5jZWxzIGEgcHJldmlvdXNseSBzY2hlZHVsZWQgTGF1bmNocGFkIFdBU00gdXBncmFkZSAoYWRtaW4gb25seSkuAAAAAA5jYW5jZWxfdXBncmFkZQAAAAAAAAAAAAEAAAPpAAAAAgAAB9AAAAAOTGF1bmNocGFkRXJyb3IAAA==", "AAAAAAAAAGdSZXR1cm5zIHRoZSBwaW5uZWQgS2luZyBTaG91dCAoaGlnaGVzdCBkZWNheWVkIGBidXJuX3Nob3V0ID49IDUsMDAwYCB3aG9sZSB0b2tlbnMpLCBpZiBhbnkgKHB1cmUgcmVhZCkuAAAAAA5nZXRfa2luZ19zaG91dAAAAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAA+gAAAfQAAAAC1Nob3V0UmVjb3JkAA==", "AAAAAAAAAFZTdGFydHMgYSAyLXN0ZXAgYWRtaW4gdHJhbnNmZXIgdG8gYG5ld19hZG1pbmAgKDctZGF5IGFjY2VwdGFuY2Ugd2luZG93IGZvciBtdWx0aXNpZ3MpLgAAAAAADnRyYW5zZmVyX2FkbWluAAAAAAABAAAAAAAAAAluZXdfYWRtaW4AAAAAAAATAAAAAQAAA+kAAAACAAAH0AAAAA5MYXVuY2hwYWRFcnJvcgAA", "AAAAAAAAAF9FeGVjdXRlcyBhIHNjaGVkdWxlZCBMYXVuY2hwYWQgV0FTTSB1cGdyYWRlIG9uY2UgdGhlIDQ4LWhvdXIgdGltZWxvY2sgaGFzIGVsYXBzZWQgKGFkbWluIG9ubHkpLgAAAAAPZXhlY3V0ZV91cGdyYWRlAAAAAAAAAAABAAAD6QAAAAIAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA=", "AAAAAAAAAEtSZXR1cm5zIG5ld2VzdC1maXJzdCBsYXVuY2hlcyBwYWlyZWQgd2l0aCB0aGVpciBDdXJ2ZVN0YXRlIGluIG9uZSBSUEMgY2FsbC4AAAAAD2dldF9tYXJrZXRfcGFnZQAAAAACAAAAAAAAAAZvZmZzZXQAAAAAAAQAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPqAAAH0AAAABBNYXJrZXRDYXJkUmVjb3Jk", "AAAAAAAAADxQZXJtaXNzaW9ubGVzc2x5IHJlZnJlc2hlcyBUVEwgZm9yIGEgcGlsb3QgdGVsZW1ldHJ5IHJlY29yZC4AAAAQZXh0ZW5kX3BpbG90X3R0bAAAAAEAAAAAAAAABHVzZXIAAAATAAAAAA==", "AAAAAAAAAAAAAAAQZ2V0X2J1cm5fYWRkcmVzcwAAAAAAAAABAAAD6AAAABM=", "AAAAAAAAAAAAAAAQZ2V0X2NyZWF0aW9uX2ZlZQAAAAAAAAABAAAACw==", "AAAAAAAAAEtSZXR1cm5zIHRvdGFsIG51bWJlciBvZiB0b2tlbnMgbGF1bmNoZWQgYW5kIGluZGV4ZWQgdGhyb3VnaCB0aGlzIGxhdW5jaHBhZC4AAAAAEGdldF9sYXVuY2hfY291bnQAAAAAAAAAAQAAAAQ=", "AAAAAAAAAF1TY2hlZHVsZXMgYSBMYXVuY2hwYWQgV0FTTSBieXRlY29kZSB1cGdyYWRlIGJlaGluZCBhIG1hbmRhdG9yeSA0OC1ob3VyIHRpbWVsb2NrIChhZG1pbiBvbmx5KS4AAAAAAAAQc2NoZWR1bGVfdXBncmFkZQAAAAEAAAAAAAAADW5ld193YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAEAAAPpAAAAAgAAB9AAAAAOTGF1bmNocGFkRXJyb3IAAA==", "AAAAAAAAAJNVcGRhdGVzIHRoZSBmbGF0IHRva2VuIGNyZWF0aW9uIGZlZSBpbiBzdHJvb3BzICgwLi49MSwwMDAgWExNLCBhZG1pbiBvbmx5KQpzbyBwcm90b2NvbCBwcmljaW5nIGNhbiB0cmFjayBYTE0vVVNEQyB3aXRob3V0IHJlZGVwbG95aW5nIHRoZSBjb250cmFjdC4AAAAAEHNldF9jcmVhdGlvbl9mZWUAAAABAAAAAAAAAA9uZXdfZmVlX3N0cm9vcHMAAAAACwAAAAEAAAPpAAAAAgAAB9AAAAAOTGF1bmNocGFkRXJyb3IAAA==", "AAAAAAAAAKRQZXJtaXNzaW9ubGVzc2x5IHJlZnJlc2hlcyBUVEwgZm9yIGEgdG9rZW4ncyByZWdpc3RyeSwgY3VydmUsIHNob3V0cywgS2luZyBTaG91dCwKYnV5YmFjayBjb29sZG93biBlbnRyeSwgYW5kIHBlcnNpc3RlbnQgYmFsYW5jZXMgKHRva2VuICsgU29yb3N3YXAgcGFpciBMUCBzaGFyZXMpLgAAABFleHRlbmRfbGF1bmNoX3R0bAAAAAAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAA=", "AAAAAAAAAJxSZWNsYWltcyB0aW1lLWxvY2tlZCBTb3Jvc3dhcCBMUCB0b2tlbnMgdG8gcHJvdG9jb2wgdHJlYXN1cnkgb25jZSB0aGUgbWFuZGF0b3J5CjcteWVhciBsb2NrIChgTFBfTE9DS19EVVJBVElPTl9TRUNPTkRTYCkgYWZ0ZXIgZ3JhZHVhdGlvbiBoYXMgZnVsbHkgZWxhcHNlZC4AAAAScmVjbGFpbV9leHBpcmVkX2xwAAAAAAABAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAD6QAAAAsAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA=", "AAAAAAAAAE5SZXR1cm5zIHRoZSBjdXJyZW50bHkgc2NoZWR1bGVkIFdBU00gdXBncmFkZSBhd2FpdGluZyB0aW1lbG9jayBleHBpcnksIGlmIGFueS4AAAAAABNnZXRfcGVuZGluZ191cGdyYWRlAAAAAAAAAAABAAAD6AAAB9AAAAASUGVuZGluZ1VwZ3JhZGVEYXRhAAA=", "AAAAAAAAAEZSZXR1cm5zIHRoZSBpbml0aWFsaXplZCBzY2hlbWEgc3RvcmFnZSB2ZXJzaW9uIGZvciB1cGdyYWRlIG1pZ3JhdGlvbnMuAAAAAAATZ2V0X3N0b3JhZ2VfdmVyc2lvbgAAAAAAAAAAAQAAAAQ=", "AAAAAAAAAAAAAAATZ2V0X3Rva2VuX3dhc21faGFzaAAAAAAAAAAAAQAAA+gAAAPuAAAAIA==", "AAAAAAAAAEtVcGRhdGVzIHRoZSB0b2tlbiBXQVNNIGhhc2ggdXNlZCBmb3IgZnV0dXJlIHRva2VuIGRlcGxveW1lbnRzIChhZG1pbiBvbmx5KS4AAAAAE3NldF90b2tlbl93YXNtX2hhc2gAAAAAAQAAAAAAAAANbmV3X3dhc21faGFzaAAAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAH0AAAAA5MYXVuY2hwYWRFcnJvcgAA", "AAAAAAAAAJVQZXJtaXNzaW9ubGVzc2x5IHN3YXBzIHRoZSBncmFkdWF0ZWQgYGJ1eWJhY2tfeGxtX3Jlc2VydmVgIG9uIFNvcm9zd2FwIERFWApmb3IgcmVhbCBjaXJjdWxhdGluZyB0b2tlbnMgYW5kIHBlcm1hbmVudGx5IGJ1cm5zIHRoZW0gdmlhIGB0b2tlbi5idXJuKClgLgAAAAAAABR0cmlnZ2VyX2J1eWJhY2tfYnVybgAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAPpAAAACwAAB9AAAAAOTGF1bmNocGFkRXJyb3IAAA==", "AAAAAAAAAEdDYW5jZWxzIGEgcGVuZGluZyAyLXN0ZXAgYWRtaW4gdHJhbnNmZXIgYmVmb3JlIGFjY2VwdGFuY2UgKGFkbWluIG9ubHkpLgAAAAAVY2FuY2VsX2FkbWluX3RyYW5zZmVyAAAAAAAAAAAAAAEAAAPpAAAAAgAAB9AAAAAOTGF1bmNocGFkRXJyb3IAAA==", "AAAAAAAAAO5MZXRzIHRoZSBjcmVhdG9yIGNsYWltIHVubG9ja2VkIHBhaWQgc2VlZCB0b2tlbnMgKDEwMCUgdXBvbiBncmFkdWF0aW9uLCBvciBhZnRlcgo3IGRheXMgaWYgYW4gdW5ncmFkdWF0ZWQgY3VydmUgbmV2ZXIgcmVhY2hlZCBncmFkdWF0aW9uKSBwbHVzIGAwLjMlYCBib251cyB2ZXN0aW5nCnRyYW5jaGVzIChgMjAlID0gNiwwMDAgdG9rZW5zYCBldmVyeSAzIGRheXMgb3ZlciAxNSBkYXlzIHBvc3QtZ3JhZHVhdGlvbikuAAAAAAAVY2xhaW1fY3JlYXRvcl92ZXN0aW5nAAAAAAAAAgAAAAAAAAAHY3JlYXRvcgAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAD6QAAAAsAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA=", "AAAAAAAAAEdQZXJtaXNzaW9ubGVzc2x5IHJlZnJlc2hlcyBUVEwgZm9yIGFuIGVzY3Jvd2VkIGNoZWNrcG9pbnQgcmV3YXJkIGVudHJ5LgAAAAAVZXh0ZW5kX2NoZWNrcG9pbnRfdHRsAAAAAAAAAgAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAlyZWNpcGllbnQAAAAAAAATAAAAAA==", "AAAAAAAAAFpSZXR1cm5zIHByZS1ncmFkdWF0aW9uIFNwYXJrL0Nyb3duIGNoZWNrcG9pbnQgdG9rZW5zIGVzY3Jvd2VkIGZvciBgcmVjaXBpZW50YCAocHVyZSByZWFkKS4AAAAAABVnZXRfY2hlY2twb2ludF9yZXdhcmQAAAAAAAACAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAACXJlY2lwaWVudAAAAAAAABMAAAABAAAACw==", "AAAAAAAAALsxLWNsaWNrIHN0YWxsZWQgbGF1bmNoIHJlZnVuZCAoYWZ0ZXIgNyBkYXlzIGlmIGFsbCBleHRlcm5hbCB0cmFkZXJzIGV4aXRlZCBvciBidXJuZWQpOgpyZWZ1bmRzIGNyZWF0b3IncyBgY3VydmVfeGxtX25ldGAgWExNIHJlc2VydmUgd2hpbGUgbGVhdmluZyBhY2N1bXVsYXRlZCBmZWUgZHVzdCBmb3IgdHJlYXN1cnkgc3dlZXAuAAAAABVyZWZ1bmRfc3RhbGxlZF9sYXVuY2gAAAAAAAACAAAAAAAAAAdjcmVhdG9yAAAAABMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAPpAAAACwAAB9AAAAAOTGF1bmNocGFkRXJyb3IAAA==", "AAAAAAAAATlTd2VlcHMgc3RyYW5kZWQgZmxvb3IgZmVlIGR1c3QgdG8gdHJlYXN1cnkgd2hlbiBhbiB1bmdyYWR1YXRlZCBjdXJ2ZQpoYXMgemVybyBleHRlcm5hbCBjaXJjdWxhdGluZyBjdXJ2ZSBsaWFiaWxpdHkuIEZvciBgPj0gMzAgZGF5c2AgYWJhbmRvbmVkIGN1cnZlcwp3aGVyZSBgY3JlYXRvcl9zZWVkX2xvY2tlZCA+IDBgLCBjbGVhbmx5IHJlZnVuZHMgYGN1cnZlX3hsbV9uZXRgIGJhY2sgdG8gdGhlCmNyZWF0b3IgYW5kIHN3ZWVwcyBvbmx5IHN1cnBsdXMgZmVlIGR1c3QgdG8gdHJlYXN1cnkgKG5ldmVyIHJldHVybmluZyBwaGFudG9tIHRva2VucykuAAAAAAAAFnN3ZWVwX2VtcHR5X2N1cnZlX2ZlZXMAAAAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAPpAAAACwAAB9AAAAAOTGF1bmNocGFkRXJyb3IAAA==", "AAAAAAAAAF5MZWdhY3kgbWlsZXN0b25lIGJ1cm4gZW50cnlwb2ludCAoYWN0aXZlIG9ubHkgb24gdjQuMiB0b2tlbnMgd2l0aCBgYnVybl92YXVsdF9yZW1haW5pbmcgPiAwYCkuAAAAAAAWdHJpZ2dlcl9taWxlc3RvbmVfYnVybgAAAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAA+kAAAALAAAH0AAAAA5MYXVuY2hwYWRFcnJvcgAA", "AAAAAAAAAJdDbGFpbXMgcHJlLWdyYWR1YXRpb24gU3BhcmsvQ3Jvd24gY2hlY2twb2ludCBqYWNrcG90IHRva2VucyBlc2Nyb3dlZCBmb3IgYHdpbm5lcmAKb25jZSB0aGUgdG9rZW4gaGFzIGdyYWR1YXRlZCB0byBTb3Jvc3dhcCAoYGN1cnZlLmdyYWR1YXRlZCA9PSB0cnVlYCkuAAAAABdjbGFpbV9jaGVja3BvaW50X3Jld2FyZAAAAAACAAAAAAAAAAZ3aW5uZXIAAAAAABMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAPpAAAACwAAB9AAAAAOTGF1bmNocGFkRXJyb3IAAA==", "AAAAAAAAAFhTbGlwcGFnZS1wcm90ZWN0ZWQgU29yb3N3YXAgREVYIGJ1eWJhY2stYW5kLWJ1cm4gcmVxdWlyaW5nIGF0IGxlYXN0IGBtaW5fdG9rZW5zX2J1cm5lZGAuAAAAGHRyaWdnZXJfYnV5YmFja19idXJuX21pbgAAAAIAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAARbWluX3Rva2Vuc19idXJuZWQAAAAAAAALAAAAAQAAA+kAAAALAAAH0AAAAA5MYXVuY2hwYWRFcnJvcgAA"]),
      options
    );
    this.options = options;
  }

   static deploy<T = Client>(args: { factory: string | Address; xlm_sac: string | Address; token_wasm_hash: Uint8Array; burn_address: string | Address; treasury: string | Address }, options: MethodOptions & Omit<ContractClientOptions, 'contractId'> & { salt?: Uint8Array; address?: string; } & ({ wasmHash: Uint8Array | string; format?: "hex" | "base64"; externalRef?: never; } | { externalRef: ExternalExecutableRef; wasmHash?: never; format?: never; })): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(args, options);
  }
  public readonly fromJson = {
    buy_curve : this.txFromJson<Result<TradeResult, LaunchpadError>>,  get_admin : this.txFromJson<string | null>,  get_curve : this.txFromJson<CurveState | null>,  get_pilot : this.txFromJson<PilotRecord>,  is_paused : this.txFromJson<boolean>,  quote_buy : this.txFromJson<Result<BuyQuote, LaunchpadError>>,  burn_shout : this.txFromJson<Result<null, LaunchpadError>>,  extend_ttl : this.txFromJson<void>,  get_launch : this.txFromJson<LaunchRecord | null>,  get_shouts : this.txFromJson<Array<ShoutRecord>>,  quote_sell : this.txFromJson<Result<SellQuote, LaunchpadError>>,  sell_curve : this.txFromJson<Result<TradeResult, LaunchpadError>>,  set_paused : this.txFromJson<Result<null, LaunchpadError>>,  get_factory : this.txFromJson<string | null>,  get_xlm_sac : this.txFromJson<string | null>,  launch_fair : this.txFromJson<Result<LaunchResult, LaunchpadError>>,  accept_admin : this.txFromJson<Result<null, LaunchpadError>>,  get_launches : this.txFromJson<Array<LaunchRecord>>,  get_treasury : this.txFromJson<string | null>,  launch_token : this.txFromJson<Result<LaunchResult, LaunchpadError>>,  set_treasury : this.txFromJson<Result<null, LaunchpadError>>,  cancel_upgrade : this.txFromJson<Result<null, LaunchpadError>>,  get_king_shout : this.txFromJson<ShoutRecord | null>,  transfer_admin : this.txFromJson<Result<null, LaunchpadError>>,  execute_upgrade : this.txFromJson<Result<null, LaunchpadError>>,  get_market_page : this.txFromJson<Array<MarketCardRecord>>,  extend_pilot_ttl : this.txFromJson<void>,  get_burn_address : this.txFromJson<string | null>,  get_creation_fee : this.txFromJson<bigint>,  get_launch_count : this.txFromJson<number>,  schedule_upgrade : this.txFromJson<Result<null, LaunchpadError>>,  set_creation_fee : this.txFromJson<Result<null, LaunchpadError>>,  extend_launch_ttl : this.txFromJson<void>,  reclaim_expired_lp : this.txFromJson<Result<bigint, LaunchpadError>>,  get_pending_upgrade : this.txFromJson<PendingUpgradeData | null>,  get_storage_version : this.txFromJson<number>,  get_token_wasm_hash : this.txFromJson<Uint8Array | null>,  set_token_wasm_hash : this.txFromJson<Result<null, LaunchpadError>>,  trigger_buyback_burn : this.txFromJson<Result<bigint, LaunchpadError>>,  cancel_admin_transfer : this.txFromJson<Result<null, LaunchpadError>>,  claim_creator_vesting : this.txFromJson<Result<bigint, LaunchpadError>>,  extend_checkpoint_ttl : this.txFromJson<void>,  get_checkpoint_reward : this.txFromJson<bigint>,  refund_stalled_launch : this.txFromJson<Result<bigint, LaunchpadError>>,  sweep_empty_curve_fees : this.txFromJson<Result<bigint, LaunchpadError>>,  trigger_milestone_burn : this.txFromJson<Result<bigint, LaunchpadError>>,  claim_checkpoint_reward : this.txFromJson<Result<bigint, LaunchpadError>>,  trigger_buyback_burn_min : this.txFromJson<Result<bigint, LaunchpadError>>
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
   * Build a topics filter row for the "PausedChangedEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  pausedChangedEventEventFilter(): string[] {
    return this.spec.eventTopicFilter("PausedChangedEvent");
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
  /**
   * Build a topics filter row for the "TreasuryUpdatedEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  treasuryUpdatedEventEventFilter(topicValues?: { new_treasury?: string | Address }): string[] {
    return this.spec.eventTopicFilter("TreasuryUpdatedEvent", topicValues);
  }
  /**
   * Build a topics filter row for the "UpgradeExecutedEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  upgradeExecutedEventEventFilter(): string[] {
    return this.spec.eventTopicFilter("UpgradeExecutedEvent");
  }
  /**
   * Build a topics filter row for the "UpgradeCancelledEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  upgradeCancelledEventEventFilter(): string[] {
    return this.spec.eventTopicFilter("UpgradeCancelledEvent");
  }
  /**
   * Build a topics filter row for the "UpgradeScheduledEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  upgradeScheduledEventEventFilter(): string[] {
    return this.spec.eventTopicFilter("UpgradeScheduledEvent");
  }
  /**
   * Build a topics filter row for the "CreationFeeUpdatedEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  creationFeeUpdatedEventEventFilter(): string[] {
    return this.spec.eventTopicFilter("CreationFeeUpdatedEvent");
  }
  /**
   * Build a topics filter row for the "TokenWasmHashUpdatedEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  tokenWasmHashUpdatedEventEventFilter(): string[] {
    return this.spec.eventTopicFilter("TokenWasmHashUpdatedEvent");
  }
  /**
   * Build a topics filter row for the "AdminTransferAcceptedEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  adminTransferAcceptedEventEventFilter(topicValues?: { new_admin?: string | Address }): string[] {
    return this.spec.eventTopicFilter("AdminTransferAcceptedEvent", topicValues);
  }
  /**
   * Build a topics filter row for the "AdminTransferProposedEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  adminTransferProposedEventEventFilter(topicValues?: { pending_admin?: string | Address }): string[] {
    return this.spec.eventTopicFilter("AdminTransferProposedEvent", topicValues);
  }
  /**
   * Build a topics filter row for the "AdminTransferCancelledEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  adminTransferCancelledEventEventFilter(topicValues?: { cancelled_admin?: string | Address }): string[] {
    return this.spec.eventTopicFilter("AdminTransferCancelledEvent", topicValues);
  }
  /**
   * Build a topics filter row for the "CheckpointRewardClaimedEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  checkpointRewardClaimedEventEventFilter(topicValues?: { token?: string | Address; winner?: string | Address }): string[] {
    return this.spec.eventTopicFilter("CheckpointRewardClaimedEvent", topicValues);
  }
  /**
   * Build a topics filter row for the "CheckpointRewardEscrowedEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  checkpointRewardEscrowedEventEventFilter(topicValues?: { token?: string | Address; winner?: string | Address }): string[] {
    return this.spec.eventTopicFilter("CheckpointRewardEscrowedEvent", topicValues);
  }
}