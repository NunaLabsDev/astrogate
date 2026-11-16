import {LaunchpadError} from './types.js';
import type {TradeResult, CurveState, BuyQuote, LaunchRecord, ShoutRecord, SellQuote, FairLaunchParams, LaunchResult, LaunchParams, ContractEvent} from './types.js';
import {Spec, AssembledTransaction, Client as ContractClient} from '@stellar/stellar-sdk/contract';
import type {Result, ClientOptions as ContractClientOptions, MethodOptions, ExternalExecutableRef} from '@stellar/stellar-sdk/contract';
import {Address, xdr} from '@stellar/stellar-sdk';

export interface Client {
  /**
   * Buys tokens from the bonding curve up to `max_xlm_in` (flat `0.80%` fee).
   * Automatically unlocks transfers, seeds Soroswap LP, and burns Milestone 1 vault tokens at 1,000 net XLM.
   */
  buy_curve(args: { buyer: string | Address; token: string | Address; max_xlm_in: bigint; min_tokens_out: bigint }, options?: MethodOptions): Promise<AssembledTransaction<Result<TradeResult, LaunchpadError>>>;
  /**
   * Looks up the live bonding curve / graduation / burn-vault state for a token.
   */
  get_curve(args: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<CurveState | null>>;
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
   * Read configuration methods.
   */
  get_factory(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  get_xlm_sac(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * Fair-Flywheel v4.2 launch: deploys fixed 10M token with P2P transfers locked until
   * graduation, renounces mint authority, initializes the `2,000 vXLM -> 1,000 XLM` curve
   * (`42/28/29.5/0.5`), and executes the creator's initial atomic buy (`>= 2 XLM`, locked
   * inside contract until graduation).
   */
  launch_fair(args: { params: FairLaunchParams }, options?: MethodOptions): Promise<AssembledTransaction<Result<LaunchResult, LaunchpadError>>>;
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
   * Returns the pinned King Shout (highest `burn_shout >= 5,000` tokens), if any.
   */
  get_king_shout(args: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<ShoutRecord | null>>;
  get_burn_address(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  get_creation_fee(options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Returns total number of tokens launched and indexed through this launchpad.
   */
  get_launch_count(options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * Permissionlessly refreshes TTL for a token's registry, curve, shouts, and King Shout.
   */
  extend_launch_ttl(args: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  get_token_wasm_hash(options?: MethodOptions): Promise<AssembledTransaction<Uint8Array | null>>;
  /**
   * Permissionlessly swaps the graduated `buyback_xlm_reserve` on Soroswap DEX
   * for real circulating tokens and permanently burns them via `token.burn()`.
   */
  trigger_buyback_burn(args: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, LaunchpadError>>>;
  /**
   * Lets the creator claim unlocked paid seed tokens (100% upon graduation, or after
   * 7 days if an ungraduated curve never reached graduation) plus `0.5%` bonus vesting
   * tranches (`20% = 10,000 tokens` every 3 days over 15 days post-graduation).
   */
  claim_creator_vesting(args: { creator: string | Address; token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, LaunchpadError>>>;
  /**
   * Sweeps stranded floor fee dust to treasury only when an ungraduated curve
   * has zero active circulating curve liability (`tokens_sold == 0`).
   */
  sweep_empty_curve_fees(args: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, LaunchpadError>>>;
  /**
   * Permissionlessly burns Milestone 2 (`1,475,000` tokens) once a graduated token's
   * Soroswap pool reaches `>= 1,800 XLM` in real XLM reserves, and executes any pending
   * post-grad buyback-and-burn reserve in the same transaction.
   */
  trigger_milestone_burn(args: { token: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Result<bigint, LaunchpadError>>>;
}

export class Client extends ContractClient {
  readonly options: ContractClientOptions;
  constructor(options: ContractClientOptions) {
    super(
      new Spec(["AAAAAQAAAAAAAAAAAAAACEJ1eVF1b3RlAAAABwAAAAAAAAALZmxvb3JfYm9udXMAAAAACwAAAAAAAAAQbmV0X3hsbV90b19jdXJ2ZQAAAAsAAAAAAAAACnRva2Vuc19vdXQAAAAAAAsAAAAAAAAADXRvdGFsX2ZlZV9icHMAAAAAAAALAAAAAAAAABF0b3RhbF94bG1fY2hhcmdlZAAAAAAAAAsAAAAAAAAADHRyZWFzdXJ5X2ZlZQAAAAsAAAAAAAAADXdpbGxfZ3JhZHVhdGUAAAAAAAAB", "AAAAAQAAAAAAAAAAAAAACVNlbGxRdW90ZQAAAAAAAAUAAAAAAAAAC2Zsb29yX2JvbnVzAAAAAAsAAAAAAAAADWdyb3NzX3hsbV9vdXQAAAAAAAALAAAAAAAAAAtuZXRfeGxtX291dAAAAAALAAAAAAAAAA10b3RhbF9mZWVfYnBzAAAAAAAACwAAAAAAAAAMdHJlYXN1cnlfZmVlAAAACw==", "AAAAAQAAAAAAAAAAAAAACkN1cnZlU3RhdGUAAAAAAA8AAABcMCA9IHByZS1ncmFkLCAxID0gTWlsZXN0b25lIDEgYnVybmVkIGF0IGdyYWQsIDIgPSBNaWxlc3RvbmUgMiBidXJuZWQgYXQgMSw4MDAgWExNIERFWCBkZXB0aC4AAAAUYnVybl9taWxlc3RvbmVfc3RhZ2UAAAAEAAAAWVRva2VucyByZXNlcnZlZCBpbiB0aGUgTWlsZXN0b25lIFByb29mLW9mLUJ1cm4gVmF1bHQgKGAyLDk1MCwwMDBgIC0+IGAxLDQ3NSwwMDBgIC0+IGAwYCkuAAAAAAAAFGJ1cm5fdmF1bHRfcmVtYWluaW5nAAAACwAAAE9SZWFsIFhMTSByZXNlcnZlZCBmcm9tIGN1cnZlIGZlZXMgZm9yIHBlcm1pc3Npb25sZXNzIFNvcm9zd2FwIGJ1eWJhY2stYW5kLWJ1cm4uAAAAABNidXliYWNrX3hsbV9yZXNlcnZlAAAAAAsAAAAAAAAAB2NyZWF0b3IAAAAAEwAAADFDdW11bGF0aXZlIGNyZWF0b3IgdmVzdGluZyB0b2tlbnMgY2xhaW1lZCBzbyBmYXIuAAAAAAAAD2NyZWF0b3JfY2xhaW1lZAAAAAALAAAASkNyZWF0b3IncyBpbml0aWFsIGBsYXVuY2hfZmFpcmAgcGFpZCBzZWVkIHRva2VucywgbG9ja2VkIHVudGlsIGdyYWR1YXRpb24uAAAAAAATY3JlYXRvcl9zZWVkX2xvY2tlZAAAAAALAAAAV1RvdGFsIGNyZWF0b3IgYm9udXMgYWxsb2NhdGlvbiBsb2NrZWQgdW50aWwgcG9zdC1ncmFkIDE1LWRheSB2ZXN0aW5nIChgNTAsMDAwYCA9IDAuNSUpLgAAAAAVY3JlYXRvcl92ZXN0aW5nX3RvdGFsAAAAAAAACwAAAEROZXQgWExNIHRyYWNrZWQgYWxvbmcgdGhlIHZpcnR1YWwgY3VydmUgaW52YXJpYW50IChgMC4uPTEsMDAwIFhMTWApLgAAAA1jdXJ2ZV94bG1fbmV0AAAAAAAACwAAAAAAAAAJZ3JhZHVhdGVkAAAAAAAAAQAAAAAAAAAMZ3JhZHVhdGVkX2F0AAAABgAAAAAAAAAJbHBfbWludGVkAAAAAAAACwAAAAAAAAAEcGFpcgAAA+gAAAATAAAAUlRvdGFsIHJlYWwgWExNIGhlbGQgaW5zaWRlIHRoZSBjb250cmFjdCB2YXVsdCBmb3IgdGhpcyB0b2tlbiAoYD49IGN1cnZlX3hsbV9uZXRgKS4AAAAAAA5yZWFsX3hsbV92YXVsdAAAAAAACwAAAAAAAAAFdG9rZW4AAAAAAAATAAAAPkN1bXVsYXRpdmUgdG9rZW5zIHNvbGQgb24gdGhlIGJvbmRpbmcgY3VydmUgKGAwLi49NCwyMDAsMDAwYCkuAAAAAAALdG9rZW5zX3NvbGQAAAAACw==", "AAAABQAAAAAAAAAAAAAAClNob3V0RXZlbnQAAAAAAAEAAAALc2hvdXRfZXZlbnQAAAAABgAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAAAAAAAAGc2VuZGVyAAAAAAATAAAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAAAAAAHbWVzc2FnZQAAAAAQAAAAAAAAAAAAAAAHaXNfa2luZwAAAAABAAAAAAAAAAAAAAAGbGVkZ2VyAAAAAAAEAAAAAAAAAAI=", "AAAAAQAAAAAAAAAAAAAAC1Nob3V0UmVjb3JkAAAAAAUAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAGbGVkZ2VyAAAAAAAEAAAAAAAAAAdtZXNzYWdlAAAAABAAAAAAAAAABnNlbmRlcgAAAAAAEwAAAAAAAAAJdGltZXN0YW1wAAAAAAAABg==", "AAAAAQAAAAAAAAAAAAAAC1RyYWRlUmVzdWx0AAAAAAYAAAAAAAAAC2Zsb29yX2JvbnVzAAAAAAsAAAAAAAAACWdyYWR1YXRlZAAAAAAAAAEAAAAAAAAABHBhaXIAAAPoAAAAEwAAAAAAAAAGdG9rZW5zAAAAAAALAAAAAAAAAAx0cmVhc3VyeV9mZWUAAAALAAAAAAAAAAN4bG0AAAAACw==", "AAAAAAAAALJCdXlzIHRva2VucyBmcm9tIHRoZSBib25kaW5nIGN1cnZlIHVwIHRvIGBtYXhfeGxtX2luYCAoZmxhdCBgMC44MCVgIGZlZSkuCkF1dG9tYXRpY2FsbHkgdW5sb2NrcyB0cmFuc2ZlcnMsIHNlZWRzIFNvcm9zd2FwIExQLCBhbmQgYnVybnMgTWlsZXN0b25lIDEgdmF1bHQgdG9rZW5zIGF0IDEsMDAwIG5ldCBYTE0uAAAAAAAJYnV5X2N1cnZlAAAAAAAABAAAAAAAAAAFYnV5ZXIAAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAACm1heF94bG1faW4AAAAAAAsAAAAAAAAADm1pbl90b2tlbnNfb3V0AAAAAAALAAAAAQAAA+kAAAfQAAAAC1RyYWRlUmVzdWx0AAAAB9AAAAAOTGF1bmNocGFkRXJyb3IAAA==", "AAAAAAAAAExMb29rcyB1cCB0aGUgbGl2ZSBib25kaW5nIGN1cnZlIC8gZ3JhZHVhdGlvbiAvIGJ1cm4tdmF1bHQgc3RhdGUgZm9yIGEgdG9rZW4uAAAACWdldF9jdXJ2ZQAAAAAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAPoAAAH0AAAAApDdXJ2ZVN0YXRlAAA=", "AAAAAAAAAEJRdW90ZXMgYnV5aW5nIHRva2VucyBvbiBhbiBhY3RpdmUgYm9uZGluZyBjdXJ2ZSBiZWZvcmUgZ3JhZHVhdGlvbi4AAAAAAAlxdW90ZV9idXkAAAAAAAACAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAACnhsbV9hbW91bnQAAAAAAAsAAAABAAAD6QAAB9AAAAAIQnV5UXVvdGUAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA=", "AAAAAQAAAAAAAAAAAAAADExhdW5jaFBhcmFtcwAAAAgAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAIZGVjaW1hbHMAAAAEAAAAAAAAAA5pbml0aWFsX3N1cHBseQAAAAAACwAAAAAAAAAEbmFtZQAAABAAAAAAAAAABHNhbHQAAAPuAAAAIAAAAAAAAAAGc3ltYm9sAAAAAAAQAAAAAAAAAA90b2tlbl9scF9hbW91bnQAAAAACwAAAAAAAAANeGxtX2xwX2Ftb3VudAAAAAAAAAs=", "AAAAAQAAAAAAAAAAAAAADExhdW5jaFJlY29yZAAAAA4AAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAAAAAAIZGVjaW1hbHMAAAAEAAAAAAAAAAVpbmRleAAAAAAAAAQAAAAAAAAADmluaXRpYWxfc3VwcGx5AAAAAAALAAAAAAAAAAZsZWRnZXIAAAAAAAQAAAAAAAAACWxwX21pbnRlZAAAAAAAAAsAAAAAAAAABG1ldGEAAAAQAAAAAAAAAARuYW1lAAAAEAAAAAAAAAAEcGFpcgAAA+gAAAATAAAAAAAAAAZzeW1ib2wAAAAAABAAAAAAAAAACXRpbWVzdGFtcAAAAAAAAAYAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAPdG9rZW5fbHBfYW1vdW50AAAAAAsAAAAAAAAADXhsbV9scF9hbW91bnQAAAAAAAAL", "AAAAAQAAAAAAAAAAAAAADExhdW5jaFJlc3VsdAAAAAMAAAAAAAAACWxwX21pbnRlZAAAAAAAAAsAAAAAAAAABHBhaXIAAAPoAAAAEwAAAAAAAAAFdG9rZW4AAAAAAAAT", "AAAAAAAAANYzLXRpZXIgQnVybi10by1DaGF0OiBwZXJtYW5lbnRseSBidXJucyBob2xkZXIgdG9rZW5zIChgPj0gNTBgIHRva2VucykgdmlhIGB0b2tlbi5idXJuKClgLApyZWNvcmRzIHVwIHRvIDE1IHJlY2VudCBtZXNzYWdlcywgYW5kIGNyb3ducyBhIG5ldyBgS2luZ1Nob3V0YCB3aGVuIGA+PSA1LDAwMGAgdG9rZW5zCnN1cnBhc3MgdGhlIHByZXZpb3VzIEtpbmcgYnVybiBhbW91bnQuAAAAAAAKYnVybl9zaG91dAAAAAAABAAAAAAAAAAGc2VuZGVyAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAHbWVzc2FnZQAAAAAQAAAAAQAAA+kAAAACAAAH0AAAAA5MYXVuY2hwYWRFcnJvcgAA", "AAAAAAAAAEJQZXJtaXNzaW9ubGVzc2x5IHJlZnJlc2hlcyB0aGUgbGF1bmNocGFkIGluc3RhbmNlIFRUTCBmb3IgOTAgZGF5cy4AAAAAAApleHRlbmRfdHRsAAAAAAAAAAAAAA==", "AAAAAAAAADNMb29rcyB1cCBhIGxhdW5jaCByZWNvcmQgYnkgdG9rZW4gY29udHJhY3QgYWRkcmVzcy4AAAAACmdldF9sYXVuY2gAAAAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAPoAAAH0AAAAAxMYXVuY2hSZWNvcmQ=", "AAAAAAAAAFNSZXR1cm5zIHJlY2VudCBvbi1jaGFpbiBCdXJuLXRvLUNoYXQgc2hvdXRzIGZvciBhIHRva2VuIChvbGRlc3QgdG8gbmV3ZXN0LCBtYXggMTUpLgAAAAAKZ2V0X3Nob3V0cwAAAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAA+oAAAfQAAAAC1Nob3V0UmVjb3JkAA==", "AAAAAAAAAEpRdW90ZXMgc2VsbGluZyB0b2tlbnMgYmFjayBpbnRvIGFuIGFjdGl2ZSBib25kaW5nIGN1cnZlIGJlZm9yZSBncmFkdWF0aW9uLgAAAAAACnF1b3RlX3NlbGwAAAAAAAIAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAMdG9rZW5fYW1vdW50AAAACwAAAAEAAAPpAAAH0AAAAAlTZWxsUXVvdGUAAAAAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA=", "AAAAAAAAAFJTZWxscyB0b2tlbnMgYmFjayB0byB0aGUgYm9uZGluZyBjdXJ2ZSBiZWZvcmUgZ3JhZHVhdGlvbiB3aXRoIHNsaXBwYWdlIHByb3RlY3Rpb24uAAAAAAAKc2VsbF9jdXJ2ZQAAAAAABAAAAAAAAAAGc2VsbGVyAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAADHRva2VuX2Ftb3VudAAAAAsAAAAAAAAAC21pbl94bG1fb3V0AAAAAAsAAAABAAAD6QAAB9AAAAALVHJhZGVSZXN1bHQAAAAH0AAAAA5MYXVuY2hwYWRFcnJvcgAA", "AAAAAAAAABtSZWFkIGNvbmZpZ3VyYXRpb24gbWV0aG9kcy4AAAAAC2dldF9mYWN0b3J5AAAAAAAAAAABAAAD6AAAABM=", "AAAAAAAAAAAAAAALZ2V0X3hsbV9zYWMAAAAAAAAAAAEAAAPoAAAAEw==", "AAAAAAAAASFGYWlyLUZseXdoZWVsIHY0LjIgbGF1bmNoOiBkZXBsb3lzIGZpeGVkIDEwTSB0b2tlbiB3aXRoIFAyUCB0cmFuc2ZlcnMgbG9ja2VkIHVudGlsCmdyYWR1YXRpb24sIHJlbm91bmNlcyBtaW50IGF1dGhvcml0eSwgaW5pdGlhbGl6ZXMgdGhlIGAyLDAwMCB2WExNIC0+IDEsMDAwIFhMTWAgY3VydmUKKGA0Mi8yOC8yOS41LzAuNWApLCBhbmQgZXhlY3V0ZXMgdGhlIGNyZWF0b3IncyBpbml0aWFsIGF0b21pYyBidXkgKGA+PSAyIFhMTWAsIGxvY2tlZAppbnNpZGUgY29udHJhY3QgdW50aWwgZ3JhZHVhdGlvbikuAAAAAAAAC2xhdW5jaF9mYWlyAAAAAAEAAAAAAAAABnBhcmFtcwAAAAAH0AAAABBGYWlyTGF1bmNoUGFyYW1zAAAAAQAAA+kAAAfQAAAADExhdW5jaFJlc3VsdAAAB9AAAAAOTGF1bmNocGFkRXJyb3IAAA==", "AAAABAAAAAAAAAAAAAAADkxhdW5jaHBhZEVycm9yAAAAAAAIAAAANUluc3RhbmNlIGNvbmZpZ3VyYXRpb24gbWlzc2luZyBmcm9tIGNvbnRyYWN0IHN0b3JhZ2UuAAAAAAAADk5vdEluaXRpYWxpemVkAAAAAAABAAAAREludmFsaWQgc3VwcGx5LCBhbW91bnQsIFhMTSBzZWVkLCBidXJuIGFtb3VudCwgb3IgemVyby1vdXRwdXQgdHJhZGUuAAAADUludmFsaWRBbW91bnQAAAAAAAACAAAAOlRoZSB0b2tlbi9YTE0gcGFpciBhbHJlYWR5IGV4aXN0ZWQgd2l0aCBub24temVybyByZXNlcnZlcy4AAAAAABFQYWlyQWxyZWFkeVNlZWRlZAAAAAAAAAMAAABKVG9rZW4gbWV0YWRhdGEsIHNob3V0IG1lc3NhZ2UsIG9yIG9mZi1jaGFpbiBKU09OIG1ldGFkYXRhIHZpb2xhdGVzIGJvdW5kcy4AAAAAAA9JbnZhbGlkTWV0YWRhdGEAAAAABAAAADxUcmFkZSBvdXRwdXQgaXMgYmVsb3cgdGhlIHVzZXIncyBtaW5pbXVtIHNsaXBwYWdlIHRocmVzaG9sZC4AAAAQU2xpcHBhZ2VFeGNlZWRlZAAAAAUAAABLT3BlcmF0aW9uIGludmFsaWQgZm9yIHRoZSB0b2tlbidzIGN1cnJlbnQgYm9uZGluZy1jdXJ2ZSAvIGdyYWR1YXRpb24gc3RhdGUuAAAAABFJbnZhbGlkQ3VydmVTdGF0ZQAAAAAAAAYAAABFQm9uZGluZyBjdXJ2ZSBvciBjcmVhdG9yIHZlc3Rpbmcgc3RhdGUgZG9lcyBub3QgZXhpc3QgZm9yIHRoaXMgdG9rZW4uAAAAAAAADUN1cnZlTm90Rm91bmQAAAAAAAAHAAAAPE5vdGhpbmcgdW5sb2NrZWQgb3IgbWlsZXN0b25lIHJlc2VydmUgY29uZGl0aW9uIG5vdCB5ZXQgbWV0LgAAABNNaWxlc3RvbmVOb3RSZWFjaGVkAAAAAAg=", "AAAAAAAAAERSZXR1cm5zIG5ld2VzdC1maXJzdCBsYXVuY2hlcyBmcm9tIHRoZSBwZXJzaXN0ZW50IG9uLWNoYWluIHJlZ2lzdHJ5LgAAAAxnZXRfbGF1bmNoZXMAAAACAAAAAAAAAAZvZmZzZXQAAAAAAAQAAAAAAAAABWxpbWl0AAAAAAAABAAAAAEAAAPqAAAH0AAAAAxMYXVuY2hSZWNvcmQ=", "AAAAAAAAAAAAAAAMZ2V0X3RyZWFzdXJ5AAAAAAAAAAEAAAPoAAAAEw==", "AAAAAAAAAF5MZWdhY3ktY29tcGF0aWJsZSBkaXJlY3QgU29yb3N3YXAgbGF1bmNoIHdpdGggZXhwbGljaXQgc3VwcGx5L2RlY2ltYWxzIChgPj0gOTkuNSVgIExQIGJ1cm5lZCkuAAAAAAAMbGF1bmNoX3Rva2VuAAAAAQAAAAAAAAAGcGFyYW1zAAAAAAfQAAAADExhdW5jaFBhcmFtcwAAAAEAAAPpAAAH0AAAAAxMYXVuY2hSZXN1bHQAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA=", "AAAAAAAAAGhJbml0aWFsaXplcyB0aGUgbGF1bmNocGFkIHdpdGggbmV0d29yayBhZGRyZXNzZXMsIHRva2VuIFdBU00gaGFzaCwgYnVybiBhZGRyZXNzLCBhbmQgZGV2ZWxvcGVyIHRyZWFzdXJ5LgAAAA1fX2NvbnN0cnVjdG9yAAAAAAAABQAAAAAAAAAHZmFjdG9yeQAAAAATAAAAAAAAAAd4bG1fc2FjAAAAABMAAAAAAAAAD3Rva2VuX3dhc21faGFzaAAAAAPuAAAAIAAAAAAAAAAMYnVybl9hZGRyZXNzAAAAEwAAAAAAAAAIdHJlYXN1cnkAAAATAAAAAA==", "AAAABQAAAAAAAAAAAAAAD0N1cnZlVHJhZGVFdmVudAAAAAABAAAAEWN1cnZlX3RyYWRlX2V2ZW50AAAAAAAACQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAAAAAAAAGdHJhZGVyAAAAAAATAAAAAQAAAAAAAAAGaXNfYnV5AAAAAAABAAAAAAAAAAAAAAAKeGxtX2Ftb3VudAAAAAAACwAAAAAAAAAAAAAADHRva2VuX2Ftb3VudAAAAAsAAAAAAAAAAAAAAAx0cmVhc3VyeV9mZWUAAAALAAAAAAAAAAAAAAALZmxvb3JfYm9udXMAAAAACwAAAAAAAAAAAAAADWN1cnZlX3hsbV9uZXQAAAAAAAALAAAAAAAAAAAAAAALdG9rZW5zX3NvbGQAAAAACwAAAAAAAAAC", "AAAAAQAAANdGYWlyLUZseXdoZWVsIHY0LjIgTGF1bmNoIHBhcmFtZXRlcnM6IGZpeGVkIDEwTSBzdXBwbHkgKGA0MiVgIGN1cnZlIC8gYDI4JWAgREVYIC8KYDI5LjUlYCBQcm9vZi1vZi1CdXJuIFZhdWx0IC8gYDAuNSVgIDE1LWRheSBwb3N0LWdyYWQgdmVzdGluZykgd2l0aCBjcmVhdG9yJ3MKaW5pdGlhbCBjdXJ2ZSBidXkgKGA+PSAyIFhMTWApIGxvY2tlZCB1bnRpbCBncmFkdWF0aW9uLgAAAAAAAAAAEEZhaXJMYXVuY2hQYXJhbXMAAAAGAAAAAAAAAAdjcmVhdG9yAAAAABMAAAAAAAAABG1ldGEAAAAQAAAAAAAAAARuYW1lAAAAEAAAAAAAAAAEc2FsdAAAA+4AAAAgAAAAAAAAAAZzeW1ib2wAAAAAABAAAAAAAAAADXhsbV9scF9hbW91bnQAAAAAAAAL", "AAAAAAAAAE1SZXR1cm5zIHRoZSBwaW5uZWQgS2luZyBTaG91dCAoaGlnaGVzdCBgYnVybl9zaG91dCA+PSA1LDAwMGAgdG9rZW5zKSwgaWYgYW55LgAAAAAAAA5nZXRfa2luZ19zaG91dAAAAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAA+gAAAfQAAAAC1Nob3V0UmVjb3JkAA==", "AAAABQAAAAAAAAAAAAAAEEJ1eWJhY2tCdXJuRXZlbnQAAAABAAAAEmJ1eWJhY2tfYnVybl9ldmVudAAAAAAABAAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAAAAAAAAJeGxtX3NwZW50AAAAAAAACwAAAAAAAAAAAAAADXRva2Vuc19idXJuZWQAAAAAAAALAAAAAAAAAAAAAAASdG90YWxfc3VwcGx5X2FmdGVyAAAAAAALAAAAAAAAAAI=", "AAAAAAAAAAAAAAAQZ2V0X2J1cm5fYWRkcmVzcwAAAAAAAAABAAAD6AAAABM=", "AAAAAAAAAAAAAAAQZ2V0X2NyZWF0aW9uX2ZlZQAAAAAAAAABAAAACw==", "AAAAAAAAAEtSZXR1cm5zIHRvdGFsIG51bWJlciBvZiB0b2tlbnMgbGF1bmNoZWQgYW5kIGluZGV4ZWQgdGhyb3VnaCB0aGlzIGxhdW5jaHBhZC4AAAAAEGdldF9sYXVuY2hfY291bnQAAAAAAAAAAQAAAAQ=", "AAAABQAAAAAAAAAAAAAAEk1pbGVzdG9uZUJ1cm5FdmVudAAAAAAAAQAAABRtaWxlc3RvbmVfYnVybl9ldmVudAAAAAQAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAAAAAAABXN0YWdlAAAAAAAABAAAAAAAAAAAAAAADWJ1cm5lZF9hbW91bnQAAAAAAAALAAAAAAAAAAAAAAASdG90YWxfc3VwcGx5X2FmdGVyAAAAAAALAAAAAAAAAAI=", "AAAABQAAAAAAAAAAAAAAElRva2VuTGF1bmNoZWRFdmVudAAAAAAAAQAAABR0b2tlbl9sYXVuY2hlZF9ldmVudAAAAAUAAAAAAAAAB2NyZWF0b3IAAAAAEwAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAAAAAADmluaXRpYWxfc3VwcGx5AAAAAAALAAAAAAAAAAAAAAALeGxtX2luaXRpYWwAAAAACwAAAAAAAAAAAAAACGlzX2N1cnZlAAAAAQAAAAAAAAAC", "AAAAAAAAAFVQZXJtaXNzaW9ubGVzc2x5IHJlZnJlc2hlcyBUVEwgZm9yIGEgdG9rZW4ncyByZWdpc3RyeSwgY3VydmUsIHNob3V0cywgYW5kIEtpbmcgU2hvdXQuAAAAAAAAEWV4dGVuZF9sYXVuY2hfdHRsAAAAAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAA==", "AAAABQAAAAAAAAAAAAAAE1Rva2VuR3JhZHVhdGVkRXZlbnQAAAAAAQAAABV0b2tlbl9ncmFkdWF0ZWRfZXZlbnQAAAAAAAAGAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAAAAAAAARwYWlyAAAAEwAAAAAAAAAAAAAADXhsbV9kZXBvc2l0ZWQAAAAAAAALAAAAAAAAAAAAAAAQdG9rZW5zX2RlcG9zaXRlZAAAAAsAAAAAAAAAAAAAAAlscF9taW50ZWQAAAAAAAALAAAAAAAAAAAAAAAMdmF1bHRfYnVybmVkAAAACwAAAAAAAAAC", "AAAAAAAAAAAAAAATZ2V0X3Rva2VuX3dhc21faGFzaAAAAAAAAAAAAQAAA+gAAAPuAAAAIA==", "AAAAAAAAAJVQZXJtaXNzaW9ubGVzc2x5IHN3YXBzIHRoZSBncmFkdWF0ZWQgYGJ1eWJhY2tfeGxtX3Jlc2VydmVgIG9uIFNvcm9zd2FwIERFWApmb3IgcmVhbCBjaXJjdWxhdGluZyB0b2tlbnMgYW5kIHBlcm1hbmVudGx5IGJ1cm5zIHRoZW0gdmlhIGB0b2tlbi5idXJuKClgLgAAAAAAABR0cmlnZ2VyX2J1eWJhY2tfYnVybgAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAPpAAAACwAAB9AAAAAOTGF1bmNocGFkRXJyb3IAAA==", "AAAAAAAAAO9MZXRzIHRoZSBjcmVhdG9yIGNsYWltIHVubG9ja2VkIHBhaWQgc2VlZCB0b2tlbnMgKDEwMCUgdXBvbiBncmFkdWF0aW9uLCBvciBhZnRlcgo3IGRheXMgaWYgYW4gdW5ncmFkdWF0ZWQgY3VydmUgbmV2ZXIgcmVhY2hlZCBncmFkdWF0aW9uKSBwbHVzIGAwLjUlYCBib251cyB2ZXN0aW5nCnRyYW5jaGVzIChgMjAlID0gMTAsMDAwIHRva2Vuc2AgZXZlcnkgMyBkYXlzIG92ZXIgMTUgZGF5cyBwb3N0LWdyYWR1YXRpb24pLgAAAAAVY2xhaW1fY3JlYXRvcl92ZXN0aW5nAAAAAAAAAgAAAAAAAAAHY3JlYXRvcgAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAD6QAAAAsAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA=", "AAAAAAAAAItTd2VlcHMgc3RyYW5kZWQgZmxvb3IgZmVlIGR1c3QgdG8gdHJlYXN1cnkgb25seSB3aGVuIGFuIHVuZ3JhZHVhdGVkIGN1cnZlCmhhcyB6ZXJvIGFjdGl2ZSBjaXJjdWxhdGluZyBjdXJ2ZSBsaWFiaWxpdHkgKGB0b2tlbnNfc29sZCA9PSAwYCkuAAAAABZzd2VlcF9lbXB0eV9jdXJ2ZV9mZWVzAAAAAAABAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAD6QAAAAsAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA=", "AAAAAAAAAOBQZXJtaXNzaW9ubGVzc2x5IGJ1cm5zIE1pbGVzdG9uZSAyIChgMSw0NzUsMDAwYCB0b2tlbnMpIG9uY2UgYSBncmFkdWF0ZWQgdG9rZW4ncwpTb3Jvc3dhcCBwb29sIHJlYWNoZXMgYD49IDEsODAwIFhMTWAgaW4gcmVhbCBYTE0gcmVzZXJ2ZXMsIGFuZCBleGVjdXRlcyBhbnkgcGVuZGluZwpwb3N0LWdyYWQgYnV5YmFjay1hbmQtYnVybiByZXNlcnZlIGluIHRoZSBzYW1lIHRyYW5zYWN0aW9uLgAAABZ0cmlnZ2VyX21pbGVzdG9uZV9idXJuAAAAAAABAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAD6QAAAAsAAAfQAAAADkxhdW5jaHBhZEVycm9yAAA="]),
      options
    );
    this.options = options;
  }

   static deploy<T = Client>(args: { factory: string | Address; xlm_sac: string | Address; token_wasm_hash: Uint8Array; burn_address: string | Address; treasury: string | Address }, options: MethodOptions & Omit<ContractClientOptions, 'contractId'> & { salt?: Uint8Array; address?: string; } & ({ wasmHash: Uint8Array | string; format?: "hex" | "base64"; externalRef?: never; } | { externalRef: ExternalExecutableRef; wasmHash?: never; format?: never; })): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(args, options);
  }
  public readonly fromJson = {
    buy_curve : this.txFromJson<Result<TradeResult, LaunchpadError>>,  get_curve : this.txFromJson<CurveState | null>,  quote_buy : this.txFromJson<Result<BuyQuote, LaunchpadError>>,  burn_shout : this.txFromJson<Result<null, LaunchpadError>>,  extend_ttl : this.txFromJson<void>,  get_launch : this.txFromJson<LaunchRecord | null>,  get_shouts : this.txFromJson<Array<ShoutRecord>>,  quote_sell : this.txFromJson<Result<SellQuote, LaunchpadError>>,  sell_curve : this.txFromJson<Result<TradeResult, LaunchpadError>>,  get_factory : this.txFromJson<string | null>,  get_xlm_sac : this.txFromJson<string | null>,  launch_fair : this.txFromJson<Result<LaunchResult, LaunchpadError>>,  get_launches : this.txFromJson<Array<LaunchRecord>>,  get_treasury : this.txFromJson<string | null>,  launch_token : this.txFromJson<Result<LaunchResult, LaunchpadError>>,  get_king_shout : this.txFromJson<ShoutRecord | null>,  get_burn_address : this.txFromJson<string | null>,  get_creation_fee : this.txFromJson<bigint>,  get_launch_count : this.txFromJson<number>,  extend_launch_ttl : this.txFromJson<void>,  get_token_wasm_hash : this.txFromJson<Uint8Array | null>,  trigger_buyback_burn : this.txFromJson<Result<bigint, LaunchpadError>>,  claim_creator_vesting : this.txFromJson<Result<bigint, LaunchpadError>>,  sweep_empty_curve_fees : this.txFromJson<Result<bigint, LaunchpadError>>,  trigger_milestone_burn : this.txFromJson<Result<bigint, LaunchpadError>>
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