
    /**
 * Struct: BuyQuote
 */
export interface BuyQuote {
  floor_bonus: bigint;
  net_xlm_to_curve: bigint;
  tokens_out: bigint;
  total_fee_bps: bigint;
  total_xlm_charged: bigint;
  treasury_fee: bigint;
  will_graduate: boolean;
}

/**
 * Struct: SellQuote
 */
export interface SellQuote {
  floor_bonus: bigint;
  gross_xlm_out: bigint;
  net_xlm_out: bigint;
  total_fee_bps: bigint;
  treasury_fee: bigint;
}

/**
 * Struct: CurveState
 */
export interface CurveState {
  /**
   * 0 = pre-grad, 1 = Milestone 1 burned at grad, 2 = Milestone 2 burned at 2,500 XLM DEX depth.
   */
  burn_milestone_stage: number;
  /**
   * Tokens reserved in the Milestone Proof-of-Burn Vault (`2,970,000` -> `1,485,000` -> `0`).
   */
  burn_vault_remaining: bigint;
  creator: string;
  /**
   * Cumulative creator vesting tokens claimed so far.
   */
  creator_claimed: bigint;
  /**
   * Total creator allocation locked until post-graduation 15-day vesting (`30,000` = 0.3%).
   */
  creator_vesting_total: bigint;
  /**
   * Net XLM tracked along the virtual curve invariant (`0..=1,000 XLM`).
   */
  curve_xlm_net: bigint;
  graduated: boolean;
  graduated_at: bigint;
  lp_minted: bigint;
  pair: string | null;
  /**
   * Total real XLM held inside the contract vault for this token (`>= curve_xlm_net`).
   */
  real_xlm_vault: bigint;
  token: string;
  /**
   * Cumulative tokens sold on the bonding curve (`0..=4,000,000`).
   */
  tokens_sold: bigint;
}

/**
 * Event: ShoutEvent
 */
export interface ShoutEventEvent {
  name: "ShoutEvent";
  data: {
    token: string;
    sender?: string;
    amount?: bigint;
    message?: string;
    is_king?: boolean;
    ledger?: number;
  };
}

/**
 * Struct: ShoutRecord
 */
export interface ShoutRecord {
  amount: bigint;
  ledger: number;
  message: string;
  sender: string;
  timestamp: bigint;
}

/**
 * Struct: TradeResult
 */
export interface TradeResult {
  floor_bonus: bigint;
  graduated: boolean;
  pair: string | null;
  tokens: bigint;
  treasury_fee: bigint;
  xlm: bigint;
}

/**
 * Struct: LaunchParams
 */
export interface LaunchParams {
  creator: string;
  decimals: number;
  initial_supply: bigint;
  name: string;
  salt: Uint8Array;
  symbol: string;
  token_lp_amount: bigint;
  xlm_lp_amount: bigint;
}

/**
 * Struct: LaunchRecord
 */
export interface LaunchRecord {
  creator: string;
  decimals: number;
  index: number;
  initial_supply: bigint;
  ledger: number;
  lp_minted: bigint;
  meta: string;
  name: string;
  pair: string | null;
  symbol: string;
  timestamp: bigint;
  token: string;
  token_lp_amount: bigint;
  xlm_lp_amount: bigint;
}

/**
 * Struct: LaunchResult
 */
export interface LaunchResult {
  lp_minted: bigint;
  pair: string | null;
  token: string;
}

/**
 * Error Enum: LaunchpadError
 */
export const LaunchpadError = {
  /**
   * Instance configuration missing from contract storage.
   */
  1 : { message: "NotInitialized" },
  /**
   * Invalid supply, amount, XLM seed, burn amount, or zero-output trade.
   */
  2 : { message: "InvalidAmount" },
  /**
   * The token/XLM pair already existed with non-zero reserves.
   */
  3 : { message: "PairAlreadySeeded" },
  /**
   * Token metadata, shout message, or off-chain JSON metadata violates bounds.
   */
  4 : { message: "InvalidMetadata" },
  /**
   * Trade output is below the user's minimum slippage threshold.
   */
  5 : { message: "SlippageExceeded" },
  /**
   * Operation invalid for the token's current bonding-curve / graduation state.
   */
  6 : { message: "InvalidCurveState" },
  /**
   * Bonding curve or creator vesting state does not exist for this token.
   */
  7 : { message: "CurveNotFound" },
  /**
   * Nothing unlocked or milestone reserve condition not yet met.
   */
  8 : { message: "MilestoneNotReached" }
}

/**
 * Event: CurveTradeEvent
 */
export interface CurveTradeEventEvent {
  name: "CurveTradeEvent";
  data: {
    token: string;
    trader: string;
    is_buy?: boolean;
    xlm_amount?: bigint;
    token_amount?: bigint;
    treasury_fee?: bigint;
    floor_bonus?: bigint;
    curve_xlm_net?: bigint;
    tokens_sold?: bigint;
  };
}

/**
 * Fair-Flywheel Launch parameters: fixed 10M supply (40% curve / 30% DEX /
 * 29.7% Proof-of-Burn Vault / 0.3% 15-day post-grad vesting) with creator's
 * initial curve buy (`>= 2 XLM`).
 */
export interface FairLaunchParams {
  creator: string;
  meta: string;
  name: string;
  salt: Uint8Array;
  symbol: string;
  xlm_lp_amount: bigint;
}

/**
 * Event: MilestoneBurnEvent
 */
export interface MilestoneBurnEventEvent {
  name: "MilestoneBurnEvent";
  data: {
    token: string;
    stage?: number;
    burned_amount?: bigint;
    total_supply_after?: bigint;
  };
}

/**
 * Event: TokenLaunchedEvent
 */
export interface TokenLaunchedEventEvent {
  name: "TokenLaunchedEvent";
  data: {
    creator: string;
    token?: string;
    initial_supply?: bigint;
    xlm_initial?: bigint;
    is_curve?: boolean;
  };
}

/**
 * Event: TokenGraduatedEvent
 */
export interface TokenGraduatedEventEvent {
  name: "TokenGraduatedEvent";
  data: {
    token: string;
    pair?: string;
    xlm_deposited?: bigint;
    tokens_deposited?: bigint;
    lp_minted?: bigint;
    vault_burned?: bigint;
  };
}
    export type ContractEvent = ShoutEventEvent | CurveTradeEventEvent | MilestoneBurnEventEvent | TokenLaunchedEventEvent | TokenGraduatedEventEvent;

// Alias de tipo para los enums de error (usados como tipo en las firmas).
export type LaunchpadError = { message: string }
