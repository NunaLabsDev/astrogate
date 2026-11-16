//! AstroGate Fair-Flywheel Launchpad Contract (v4.2).
//!
//! Guarantees fair distribution (`2,000 vXLM -> 1,000 real XLM` goal, `2.25x` curve,
//! `42%` curve / `28%` DEX / `29.5%` Proof-of-Burn Vault / `0.5%` 15-day vesting),
//! flat `0.80%` curve buys (no whale buy penalty), asymmetric anti-sniper curve sells
//! (`2.50%` <50% curve / `1.50%` >=50% feeding LP & post-grad Soroswap Buyback-and-Burn),
//! transfer-locked curve tokens until atomic `0.00%` cliff Soroswap graduation,
//! creator initial-seed lock until graduation, and decaying Burn-to-Chat King Shout.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, xdr::ToXdr, Address,
    Bytes, BytesN, ContractExecutable, Env, String, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum LaunchpadError {
    /// Instance configuration missing from contract storage.
    NotInitialized = 1,
    /// Invalid supply, amount, XLM seed, burn amount, or zero-output trade.
    InvalidAmount = 2,
    /// The token/XLM pair already existed with non-zero reserves.
    PairAlreadySeeded = 3,
    /// Token metadata, shout message, or off-chain JSON metadata violates bounds.
    InvalidMetadata = 4,
    /// Trade output is below the user's minimum slippage threshold.
    SlippageExceeded = 5,
    /// Operation invalid for the token's current bonding-curve / graduation state.
    InvalidCurveState = 6,
    /// Bonding curve or creator vesting state does not exist for this token.
    CurveNotFound = 7,
    /// Nothing unlocked or milestone reserve condition not yet met.
    MilestoneNotReached = 8,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LaunchResult {
    pub token: Address,
    pub pair: Option<Address>,
    pub lp_minted: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LaunchParams {
    pub creator: Address,
    pub name: String,
    pub symbol: String,
    pub decimals: u32,
    pub initial_supply: i128,
    pub token_lp_amount: i128,
    pub xlm_lp_amount: i128,
    pub salt: BytesN<32>,
}

/// Fair-Flywheel v4.2 Launch parameters: fixed 10M supply (`42%` curve / `28%` DEX /
/// `29.5%` Proof-of-Burn Vault / `0.5%` 15-day post-grad vesting) with creator's
/// initial curve buy (`>= 2 XLM`) locked until graduation.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FairLaunchParams {
    pub creator: Address,
    pub name: String,
    pub symbol: String,
    pub xlm_lp_amount: i128,
    pub meta: String,
    pub salt: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LaunchRecord {
    pub index: u32,
    pub creator: Address,
    pub token: Address,
    pub pair: Option<Address>,
    pub name: String,
    pub symbol: String,
    pub decimals: u32,
    pub initial_supply: i128,
    pub token_lp_amount: i128,
    pub xlm_lp_amount: i128,
    pub lp_minted: i128,
    pub meta: String,
    pub ledger: u32,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurveState {
    pub token: Address,
    pub creator: Address,
    pub graduated: bool,
    pub graduated_at: u64,
    pub pair: Option<Address>,
    pub lp_minted: i128,
    /// Net XLM tracked along the virtual curve invariant (`0..=1,000 XLM`).
    pub curve_xlm_net: i128,
    /// Total real XLM held inside the contract vault for this token (`>= curve_xlm_net`).
    pub real_xlm_vault: i128,
    /// Cumulative tokens sold on the bonding curve (`0..=4,200,000`).
    pub tokens_sold: i128,
    /// Real XLM reserved from curve fees for permissionless Soroswap buyback-and-burn.
    pub buyback_xlm_reserve: i128,
    /// Tokens reserved in the Milestone Proof-of-Burn Vault (`2,950,000` -> `1,475,000` -> `0`).
    pub burn_vault_remaining: i128,
    /// 0 = pre-grad, 1 = Milestone 1 burned at grad, 2 = Milestone 2 burned at 1,800 XLM DEX depth.
    pub burn_milestone_stage: u32,
    /// Total creator bonus allocation locked until post-grad 15-day vesting (`50,000` = 0.5%).
    pub creator_vesting_total: i128,
    /// Cumulative creator vesting tokens claimed so far.
    pub creator_claimed: i128,
    /// Creator's initial `launch_fair` paid seed tokens, locked until graduation.
    pub creator_seed_locked: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BuyQuote {
    pub total_xlm_charged: i128,
    pub net_xlm_to_curve: i128,
    pub treasury_fee: i128,
    pub floor_bonus: i128,
    pub tokens_out: i128,
    pub will_graduate: bool,
    pub total_fee_bps: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SellQuote {
    pub gross_xlm_out: i128,
    pub net_xlm_out: i128,
    pub treasury_fee: i128,
    pub floor_bonus: i128,
    pub total_fee_bps: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TradeResult {
    pub tokens: i128,
    pub xlm: i128,
    pub treasury_fee: i128,
    pub floor_bonus: i128,
    pub graduated: bool,
    pub pair: Option<Address>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShoutRecord {
    pub sender: Address,
    pub amount: i128,
    pub message: String,
    pub ledger: u32,
    pub timestamp: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenLaunchedEvent {
    #[topic]
    pub creator: Address,
    pub token: Address,
    pub initial_supply: i128,
    pub xlm_initial: i128,
    pub is_curve: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurveTradeEvent {
    #[topic]
    pub token: Address,
    #[topic]
    pub trader: Address,
    pub is_buy: bool,
    pub xlm_amount: i128,
    pub token_amount: i128,
    pub treasury_fee: i128,
    pub floor_bonus: i128,
    pub curve_xlm_net: i128,
    pub tokens_sold: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenGraduatedEvent {
    #[topic]
    pub token: Address,
    pub pair: Address,
    pub xlm_deposited: i128,
    pub tokens_deposited: i128,
    pub lp_minted: i128,
    pub vault_burned: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneBurnEvent {
    #[topic]
    pub token: Address,
    pub stage: u32,
    pub burned_amount: i128,
    pub total_supply_after: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BuybackBurnEvent {
    #[topic]
    pub token: Address,
    pub xlm_spent: i128,
    pub tokens_burned: i128,
    pub total_supply_after: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShoutEvent {
    #[topic]
    pub token: Address,
    pub sender: Address,
    pub amount: i128,
    pub message: String,
    pub is_king: bool,
    pub ledger: u32,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Factory,
    XlmSac,
    TokenWasmHash,
    BurnAddress,
    Treasury,
    LaunchCount,
    LaunchByIndex(u32),
    TokenIndex(Address),
    Curve(Address),
    TokenShouts(Address),
    KingShout(Address),
}

#[allow(dead_code)]
#[soroban_sdk::contractclient(name = "SoroswapFactoryClient")]
pub trait SoroswapFactoryInterface {
    fn create_pair(e: &Env, token_a: Address, token_b: Address) -> Address;
    fn get_pair(e: &Env, token_a: Address, token_b: Address) -> Address;
    fn pair_exists(e: &Env, token_a: Address, token_b: Address) -> bool;
}

#[allow(dead_code)]
#[soroban_sdk::contractclient(name = "SoroswapPairClient")]
pub trait SoroswapPairInterface {
    fn token_0(e: &Env) -> Address;
    fn token_1(e: &Env) -> Address;
    fn get_reserves(e: &Env) -> (i128, i128);
    fn deposit(e: &Env, to: Address) -> i128;
    fn swap(e: &Env, amount_0_out: i128, amount_1_out: i128, to: Address);
}

#[allow(dead_code)]
#[soroban_sdk::contractclient(name = "OwnableClient")]
pub trait OwnableInterface {
    fn renounce_ownership(e: &Env);
}

#[allow(dead_code)]
#[soroban_sdk::contractclient(name = "CurveLockTokenClient")]
pub trait CurveLockTokenInterface {
    fn lock_until_graduated(e: &Env, launchpad: Address);
    fn unlock_transfers(e: &Env);
}

#[allow(dead_code)]
#[soroban_sdk::contractclient(name = "SupplyTokenClient")]
pub trait SupplyTokenInterface {
    fn total_supply(e: &Env) -> i128;
}

/// 1 day ≈ 17,280 ledgers (~5s per ledger on Stellar).
const DAY_IN_LEDGERS: u32 = 17_280;
/// Unified 90-day TTL across instance and persistent registry entries.
const TTL_BUMP_AMOUNT: u32 = 90 * DAY_IN_LEDGERS;
const TTL_THRESHOLD: u32 = TTL_BUMP_AMOUNT - (7 * DAY_IN_LEDGERS);

const BPS_DENOMINATOR: i128 = 10_000;
const STROOPS_PER_UNIT: i128 = 10_000_000;

/// Legacy direct-launch bounds (`launch_token`).
const MIN_INITIAL_SUPPLY: i128 = 1_000;
const MAX_INITIAL_SUPPLY: i128 = 10_000_000_000_000_000_000;
const MIN_LP_ALLOCATION_BPS: i128 = 9_950;
/// Minimum 2 XLM (`20_000_000` stroops) initial buy / seed.
const MIN_XLM_LP_STROOPS: i128 = 20_000_000;
/// Fixed protocol creation fee (`7 XLM`) transferred directly to treasury on `launch_fair`.
const CREATION_FEE_STROOPS: i128 = 7 * STROOPS_PER_UNIT;

/// Fair-Flywheel v4.2 constants (10M supply, 7 decimals, 42 / 28 / 29.5 / 0.5).
const FAIR_DECIMALS: u32 = 7;
const FAIR_INITIAL_SUPPLY: i128 = 10_000_000 * STROOPS_PER_UNIT; // 100_000_000_000_000
const CURVE_TOKENS_ALLOC: i128 = 4_200_000 * STROOPS_PER_UNIT; // 42.0%
const DEX_TOKENS_ALLOC: i128 = 2_800_000 * STROOPS_PER_UNIT; // 28.0%
const BURN_VAULT_TOKENS_ALLOC: i128 = 2_950_000 * STROOPS_PER_UNIT; // 29.5%
const CREATOR_VESTING_ALLOC: i128 = 50_000 * STROOPS_PER_UNIT; // 0.5%

/// Virtual LP parameters (`2,000 vXLM -> 1,000 real XLM goal`, `2.25x` curve, `0.00%` graduation cliff).
const CURVE_VIRTUAL_XLM_START: i128 = 2_000 * STROOPS_PER_UNIT; // 20_000_000_000
const CURVE_REAL_XLM_GOAL: i128 = 1_000 * STROOPS_PER_UNIT; // 10_000_000_000
const CURVE_VIRTUAL_TOKEN_START: i128 = 12_600_000 * STROOPS_PER_UNIT; // 126_000_000_000_000

/// Curve fees:
/// - Buys (flat 0.80%): 0.50% treasury + 0.30% pool/buyback floor (zero whale penalty).
/// - Sells (anti-sniper asymmetric): 2.50% (<50% curve) or 1.50% (>=50% curve) -> 0.50% treasury + 2.00%/1.00% floor/buyback.
const TREASURY_FEE_BPS: i128 = 50;
const BUY_FLOOR_FEE_BPS: i128 = 30;
const SELL_FLOOR_EARLY_BPS: i128 = 200;
const SELL_FLOOR_LATE_BPS: i128 = 100;
/// 60% of surplus `floor_bonus` at graduation funds post-grad Soroswap Buyback & Burn; 40% deepens DEX LP.
const BUYBACK_RESERVE_SHARE_BPS: i128 = 6_000;

/// Milestone 2 burn trigger: Soroswap pair real XLM reserve >= 1,800 XLM.
const MILESTONE_2_PAIR_XLM: i128 = 1_800 * STROOPS_PER_UNIT;

/// Post-graduation creator vesting: 5 tranches of 20% (10,000 tokens) every 3 days (15 days total).
const VESTING_INTERVAL_SECONDS: u64 = 3 * 86_400;
const VESTING_PHASES: u64 = 5;

/// 3-tier Burn-to-Chat: minimum 50 tokens, King Shout >= 5,000 tokens with 24h half-life decay.
const MIN_SHOUT_BURN: i128 = 50 * STROOPS_PER_UNIT;
const KING_SHOUT_MIN_BURN: i128 = 5_000 * STROOPS_PER_UNIT;
const KING_SHOUT_DECAY_SECONDS: u64 = 86_400;

const MAX_OFFCHAIN_META_BYTES: u32 = 512;
const MAX_SHOUT_BYTES: u32 = 160;
const MAX_SHOUTS_PER_TOKEN: u32 = 15;
const MAX_LAUNCH_PAGE_SIZE: u32 = 20;

#[contract]
pub struct Launchpad;

#[contractimpl]
impl Launchpad {
    /// Initializes the launchpad with network addresses, token WASM hash, burn address, and developer treasury.
    pub fn __constructor(
        e: &Env,
        factory: Address,
        xlm_sac: Address,
        token_wasm_hash: BytesN<32>,
        burn_address: Address,
        treasury: Address,
    ) {
        e.storage().instance().set(&DataKey::Factory, &factory);
        e.storage().instance().set(&DataKey::XlmSac, &xlm_sac);
        e.storage()
            .instance()
            .set(&DataKey::TokenWasmHash, &token_wasm_hash);
        e.storage()
            .instance()
            .set(&DataKey::BurnAddress, &burn_address);
        e.storage().instance().set(&DataKey::Treasury, &treasury);
        e.storage().instance().set(&DataKey::LaunchCount, &0u32);
        Self::extend_ttl(e);
    }

    /// Fair-Flywheel v4.2 launch: deploys fixed 10M token with P2P transfers locked until
    /// graduation, renounces mint authority, initializes the `2,000 vXLM -> 1,000 XLM` curve
    /// (`42/28/29.5/0.5`), and executes the creator's initial atomic buy (`>= 2 XLM`, locked
    /// inside contract until graduation).
    pub fn launch_fair(e: &Env, params: FairLaunchParams) -> Result<LaunchResult, LaunchpadError> {
        params.creator.require_auth();

        if params.name.is_empty()
            || params.name.len() > 32
            || params.symbol.is_empty()
            || params.symbol.len() > 32
            || params.meta.len() > MAX_OFFCHAIN_META_BYTES
        {
            return Err(LaunchpadError::InvalidMetadata);
        }

        if params.xlm_lp_amount < MIN_XLM_LP_STROOPS {
            return Err(LaunchpadError::InvalidAmount);
        }

        Self::extend_ttl(e);
        let this = e.current_contract_address();
        let xlm_sac = Self::require_xlm_sac(e)?;
        let treasury = Self::require_treasury(e)?;
        // Charge fixed 7 XLM network maintenance fee atomically straight to treasury.
        token::Client::new(e, &xlm_sac).transfer(&params.creator, &treasury, &CREATION_FEE_STROOPS);

        let wasm_hash = Self::require_token_wasm_hash(e)?;
        let token_addr = Self::deploy_capped_token(
            e,
            &params.creator,
            &this,
            wasm_hash,
            params.name.clone(),
            params.symbol.clone(),
            FAIR_DECIMALS,
            FAIR_INITIAL_SUPPLY,
            params.salt,
            true,
        );

        let curve = CurveState {
            token: token_addr.clone(),
            creator: params.creator.clone(),
            graduated: false,
            graduated_at: 0,
            pair: None,
            lp_minted: 0,
            curve_xlm_net: 0,
            real_xlm_vault: 0,
            tokens_sold: 0,
            buyback_xlm_reserve: 0,
            burn_vault_remaining: BURN_VAULT_TOKENS_ALLOC,
            burn_milestone_stage: 0,
            creator_vesting_total: CREATOR_VESTING_ALLOC,
            creator_claimed: 0,
            creator_seed_locked: 0,
        };
        let curve_key = DataKey::Curve(token_addr.clone());
        e.storage().persistent().set(&curve_key, &curve);
        Self::bump_persistent(e, &curve_key);

        let index = Self::get_launch_count(e);
        let record = LaunchRecord {
            index,
            creator: params.creator.clone(),
            token: token_addr.clone(),
            pair: None,
            name: params.name,
            symbol: params.symbol,
            decimals: FAIR_DECIMALS,
            initial_supply: FAIR_INITIAL_SUPPLY,
            token_lp_amount: DEX_TOKENS_ALLOC,
            xlm_lp_amount: params.xlm_lp_amount,
            lp_minted: 0,
            meta: params.meta,
            ledger: e.ledger().sequence(),
            timestamp: e.ledger().timestamp(),
        };
        Self::save_launch_record(e, index, &token_addr, &record);

        TokenLaunchedEvent {
            creator: params.creator.clone(),
            token: token_addr.clone(),
            initial_supply: FAIR_INITIAL_SUPPLY,
            xlm_initial: params.xlm_lp_amount,
            is_curve: true,
        }
        .publish(e);

        // Execute creator's initial fair buy on the virtual curve atomically (tokens held until grad)
        let trade = Self::execute_curve_buy(
            e,
            &params.creator,
            &token_addr,
            params.xlm_lp_amount,
            1,
            true,
        )?;

        Ok(LaunchResult {
            token: token_addr,
            pair: trade.pair,
            lp_minted: if trade.graduated {
                Self::get_curve(e, record.token)
                    .map(|c| c.lp_minted)
                    .unwrap_or(0)
            } else {
                0
            },
        })
    }

    /// Quotes buying tokens on an active bonding curve before graduation.
    pub fn quote_buy(
        e: &Env,
        token: Address,
        xlm_amount: i128,
    ) -> Result<BuyQuote, LaunchpadError> {
        if xlm_amount <= 0 {
            return Err(LaunchpadError::InvalidAmount);
        }
        let curve = Self::get_curve(e, token).ok_or(LaunchpadError::CurveNotFound)?;
        if curve.graduated {
            return Err(LaunchpadError::InvalidCurveState);
        }
        Self::compute_buy_quote(&curve, xlm_amount)
    }

    /// Quotes selling tokens back into an active bonding curve before graduation.
    pub fn quote_sell(
        e: &Env,
        token: Address,
        token_amount: i128,
    ) -> Result<SellQuote, LaunchpadError> {
        if token_amount <= 0 {
            return Err(LaunchpadError::InvalidAmount);
        }
        let curve = Self::get_curve(e, token).ok_or(LaunchpadError::CurveNotFound)?;
        if curve.graduated {
            return Err(LaunchpadError::InvalidCurveState);
        }
        if token_amount > curve.tokens_sold {
            return Err(LaunchpadError::InvalidAmount);
        }
        Self::compute_sell_quote(&curve, token_amount)
    }

    /// Buys tokens from the bonding curve up to `max_xlm_in` (flat `0.80%` fee).
    /// Automatically unlocks transfers, seeds Soroswap LP, and burns Milestone 1 vault tokens at 1,000 net XLM.
    pub fn buy_curve(
        e: &Env,
        buyer: Address,
        token: Address,
        max_xlm_in: i128,
        min_tokens_out: i128,
    ) -> Result<TradeResult, LaunchpadError> {
        buyer.require_auth();
        if max_xlm_in <= 0 || min_tokens_out < 0 {
            return Err(LaunchpadError::InvalidAmount);
        }
        Self::extend_ttl(e);
        Self::execute_curve_buy(e, &buyer, &token, max_xlm_in, min_tokens_out, false)
    }

    /// Sells tokens back to the bonding curve before graduation with slippage protection.
    pub fn sell_curve(
        e: &Env,
        seller: Address,
        token: Address,
        token_amount: i128,
        min_xlm_out: i128,
    ) -> Result<TradeResult, LaunchpadError> {
        seller.require_auth();
        if token_amount <= 0 || min_xlm_out < 0 {
            return Err(LaunchpadError::InvalidAmount);
        }
        Self::extend_ttl(e);

        let curve_key = DataKey::Curve(token.clone());
        let mut curve: CurveState = e
            .storage()
            .persistent()
            .get(&curve_key)
            .ok_or(LaunchpadError::CurveNotFound)?;
        if curve.graduated {
            return Err(LaunchpadError::InvalidCurveState);
        }
        if token_amount > curve.tokens_sold {
            return Err(LaunchpadError::InvalidAmount);
        }

        let quote = Self::compute_sell_quote(&curve, token_amount)?;
        if quote.net_xlm_out <= 0 || quote.gross_xlm_out > curve.curve_xlm_net {
            return Err(LaunchpadError::InvalidAmount);
        }
        if quote.net_xlm_out < min_xlm_out {
            return Err(LaunchpadError::SlippageExceeded);
        }

        // Effects: update state before external token transfers
        curve.curve_xlm_net -= quote.gross_xlm_out;
        curve.tokens_sold -= token_amount;
        if curve.tokens_sold == 0 {
            // Retain any sub-unit rounding dust inside real_xlm_vault as pool floor backing
            curve.curve_xlm_net = 0;
        }
        let vault_outflow = quote.net_xlm_out + quote.treasury_fee;
        if vault_outflow > curve.real_xlm_vault {
            return Err(LaunchpadError::InvalidAmount);
        }
        curve.real_xlm_vault -= vault_outflow;
        e.storage().persistent().set(&curve_key, &curve);
        Self::bump_persistent(e, &curve_key);

        // Interactions
        let this = e.current_contract_address();
        let xlm_sac = Self::require_xlm_sac(e)?;
        let treasury = Self::require_treasury(e)?;
        let xlm_client = token::Client::new(e, &xlm_sac);

        token::Client::new(e, &token).transfer(&seller, &this, &token_amount);
        if quote.treasury_fee > 0 {
            xlm_client.transfer(&this, &treasury, &quote.treasury_fee);
        }
        xlm_client.transfer(&this, &seller, &quote.net_xlm_out);

        Self::bump_launch_record_ttl(e, &token);

        CurveTradeEvent {
            token,
            trader: seller,
            is_buy: false,
            xlm_amount: quote.net_xlm_out,
            token_amount,
            treasury_fee: quote.treasury_fee,
            floor_bonus: quote.floor_bonus,
            curve_xlm_net: curve.curve_xlm_net,
            tokens_sold: curve.tokens_sold,
        }
        .publish(e);

        Ok(TradeResult {
            tokens: token_amount,
            xlm: quote.net_xlm_out,
            treasury_fee: quote.treasury_fee,
            floor_bonus: quote.floor_bonus,
            graduated: false,
            pair: None,
        })
    }

    /// Permissionlessly burns Milestone 2 (`1,475,000` tokens) once a graduated token's
    /// Soroswap pool reaches `>= 1,800 XLM` in real XLM reserves, and executes any pending
    /// post-grad buyback-and-burn reserve in the same transaction.
    pub fn trigger_milestone_burn(e: &Env, token: Address) -> Result<i128, LaunchpadError> {
        Self::extend_ttl(e);
        let curve_key = DataKey::Curve(token.clone());
        let mut curve: CurveState = e
            .storage()
            .persistent()
            .get(&curve_key)
            .ok_or(LaunchpadError::CurveNotFound)?;

        if !curve.graduated || curve.burn_milestone_stage != 1 || curve.burn_vault_remaining <= 0 {
            return Err(LaunchpadError::InvalidCurveState);
        }
        let pair_addr = curve
            .pair
            .clone()
            .ok_or(LaunchpadError::InvalidCurveState)?;
        let xlm_sac = Self::require_xlm_sac(e)?;

        let pair_client = SoroswapPairClient::new(e, &pair_addr);
        let token0 = pair_client.token_0();
        let (r0, r1) = pair_client.get_reserves();
        let reserve_xlm = if token0 == xlm_sac { r0 } else { r1 };
        if reserve_xlm < MILESTONE_2_PAIR_XLM {
            return Err(LaunchpadError::MilestoneNotReached);
        }

        let burned_amount = curve.burn_vault_remaining;
        curve.burn_vault_remaining = 0;
        curve.burn_milestone_stage = 2;
        e.storage().persistent().set(&curve_key, &curve);
        Self::bump_persistent(e, &curve_key);

        let this = e.current_contract_address();
        token::Client::new(e, &token).burn(&this, &burned_amount);
        let total_supply_after = SupplyTokenClient::new(e, &token).total_supply();
        Self::bump_launch_record_ttl(e, &token);

        MilestoneBurnEvent {
            token: token.clone(),
            stage: 2,
            burned_amount,
            total_supply_after,
        }
        .publish(e);

        if curve.buyback_xlm_reserve > 0 {
            let _ = Self::execute_buyback_burn_internal(e, &curve_key, &mut curve, &token);
        }

        Ok(burned_amount)
    }

    /// Permissionlessly swaps the graduated `buyback_xlm_reserve` on Soroswap DEX
    /// for real circulating tokens and permanently burns them via `token.burn()`.
    pub fn trigger_buyback_burn(e: &Env, token: Address) -> Result<i128, LaunchpadError> {
        Self::extend_ttl(e);
        let curve_key = DataKey::Curve(token.clone());
        let mut curve: CurveState = e
            .storage()
            .persistent()
            .get(&curve_key)
            .ok_or(LaunchpadError::CurveNotFound)?;
        if !curve.graduated {
            return Err(LaunchpadError::InvalidCurveState);
        }
        if curve.buyback_xlm_reserve <= 0 {
            return Err(LaunchpadError::MilestoneNotReached);
        }
        Self::execute_buyback_burn_internal(e, &curve_key, &mut curve, &token)
    }

    /// Sweeps stranded floor fee dust to treasury only when an ungraduated curve
    /// has zero active circulating curve liability (`tokens_sold == 0`).
    pub fn sweep_empty_curve_fees(e: &Env, token: Address) -> Result<i128, LaunchpadError> {
        Self::extend_ttl(e);
        let curve_key = DataKey::Curve(token.clone());
        let mut curve: CurveState = e
            .storage()
            .persistent()
            .get(&curve_key)
            .ok_or(LaunchpadError::CurveNotFound)?;
        if curve.graduated
            || curve.tokens_sold != 0
            || curve.curve_xlm_net != 0
            || curve.creator_seed_locked != 0
            || curve.real_xlm_vault <= 0
        {
            return Err(LaunchpadError::InvalidCurveState);
        }
        let swept = curve.real_xlm_vault;
        curve.real_xlm_vault = 0;
        e.storage().persistent().set(&curve_key, &curve);
        Self::bump_persistent(e, &curve_key);

        let this = e.current_contract_address();
        let xlm_sac = Self::require_xlm_sac(e)?;
        let treasury = Self::require_treasury(e)?;
        token::Client::new(e, &xlm_sac).transfer(&this, &treasury, &swept);
        Self::bump_launch_record_ttl(e, &token);
        Ok(swept)
    }

    /// Lets the creator claim unlocked paid seed tokens (100% upon graduation, or after
    /// 7 days if an ungraduated curve never reached graduation) plus `0.5%` bonus vesting
    /// tranches (`20% = 10,000 tokens` every 3 days over 15 days post-graduation).
    pub fn claim_creator_vesting(
        e: &Env,
        creator: Address,
        token: Address,
    ) -> Result<i128, LaunchpadError> {
        creator.require_auth();
        Self::extend_ttl(e);

        let curve_key = DataKey::Curve(token.clone());
        let mut curve: CurveState = e
            .storage()
            .persistent()
            .get(&curve_key)
            .ok_or(LaunchpadError::CurveNotFound)?;
        if curve.creator != creator {
            return Err(LaunchpadError::InvalidCurveState);
        }

        let now = e.ledger().timestamp();
        if !curve.graduated {
            let launched_at = Self::get_launch(e, token.clone())
                .map(|r| r.timestamp)
                .unwrap_or(0);
            if curve.creator_seed_locked <= 0 || now < launched_at + (7 * 86_400) {
                return Err(LaunchpadError::InvalidCurveState);
            }
            let claimable = curve.creator_seed_locked;
            curve.creator_seed_locked = 0;
            e.storage().persistent().set(&curve_key, &curve);
            Self::bump_persistent(e, &curve_key);

            let this = e.current_contract_address();
            token::Client::new(e, &token).transfer(&this, &creator, &claimable);
            Self::bump_launch_record_ttl(e, &token);
            return Ok(claimable);
        }

        let seed_claimable = curve.creator_seed_locked;
        let elapsed = now.saturating_sub(curve.graduated_at);
        let completed_phases = (elapsed / VESTING_INTERVAL_SECONDS).min(VESTING_PHASES);
        let total_unlocked =
            (curve.creator_vesting_total * (completed_phases as i128)) / (VESTING_PHASES as i128);
        let vest_claimable = total_unlocked - curve.creator_claimed;
        let claimable = seed_claimable + vest_claimable;
        if claimable <= 0 {
            return Err(LaunchpadError::MilestoneNotReached);
        }

        curve.creator_seed_locked = 0;
        curve.creator_claimed += vest_claimable;
        e.storage().persistent().set(&curve_key, &curve);
        Self::bump_persistent(e, &curve_key);

        let this = e.current_contract_address();
        token::Client::new(e, &token).transfer(&this, &creator, &claimable);
        Self::bump_launch_record_ttl(e, &token);

        Ok(claimable)
    }

    /// Legacy-compatible direct Soroswap launch with explicit supply/decimals (`>= 99.5%` LP burned).
    pub fn launch_token(e: &Env, params: LaunchParams) -> Result<LaunchResult, LaunchpadError> {
        params.creator.require_auth();

        if params.decimals > 18
            || params.name.is_empty()
            || params.name.len() > 32
            || params.symbol.is_empty()
            || params.symbol.len() > 32
        {
            return Err(LaunchpadError::InvalidMetadata);
        }

        if params.initial_supply <= MIN_INITIAL_SUPPLY
            || params.initial_supply > MAX_INITIAL_SUPPLY
            || params.token_lp_amount <= 0
            || params.xlm_lp_amount < MIN_XLM_LP_STROOPS
            || params.token_lp_amount > params.initial_supply
        {
            return Err(LaunchpadError::InvalidAmount);
        }

        if params
            .token_lp_amount
            .checked_mul(BPS_DENOMINATOR)
            .unwrap_or(0)
            < params
                .initial_supply
                .checked_mul(MIN_LP_ALLOCATION_BPS)
                .unwrap_or(i128::MAX)
        {
            return Err(LaunchpadError::InvalidAmount);
        }

        Self::extend_ttl(e);
        let this = e.current_contract_address();
        let xlm_sac = Self::require_xlm_sac(e)?;
        let wasm_hash = Self::require_token_wasm_hash(e)?;
        let burn_address = Self::require_burn_address(e)?;

        token::Client::new(e, &xlm_sac).transfer(&params.creator, &this, &params.xlm_lp_amount);

        let token_addr = Self::deploy_capped_token(
            e,
            &params.creator,
            &this,
            wasm_hash,
            params.name.clone(),
            params.symbol.clone(),
            params.decimals,
            params.initial_supply,
            params.salt,
            false,
        );

        let token_client = token::Client::new(e, &token_addr);
        let creator_tokens = params.initial_supply - params.token_lp_amount;
        if creator_tokens > 0 {
            token_client.transfer(&this, &params.creator, &creator_tokens);
        }

        let (pair_addr, lp_minted) = Self::seed_soroswap_and_burn_lp(
            e,
            &this,
            &token_addr,
            &xlm_sac,
            &burn_address,
            params.token_lp_amount,
            params.xlm_lp_amount,
        )?;

        let index = Self::get_launch_count(e);
        let record = LaunchRecord {
            index,
            creator: params.creator.clone(),
            token: token_addr.clone(),
            pair: Some(pair_addr.clone()),
            name: params.name,
            symbol: params.symbol,
            decimals: params.decimals,
            initial_supply: params.initial_supply,
            token_lp_amount: params.token_lp_amount,
            xlm_lp_amount: params.xlm_lp_amount,
            lp_minted,
            meta: String::from_str(e, ""),
            ledger: e.ledger().sequence(),
            timestamp: e.ledger().timestamp(),
        };
        Self::save_launch_record(e, index, &token_addr, &record);

        TokenLaunchedEvent {
            creator: params.creator,
            token: token_addr.clone(),
            initial_supply: params.initial_supply,
            xlm_initial: params.xlm_lp_amount,
            is_curve: false,
        }
        .publish(e);

        Ok(LaunchResult {
            token: token_addr,
            pair: Some(pair_addr),
            lp_minted,
        })
    }

    /// 3-tier Burn-to-Chat: permanently burns holder tokens (`>= 50` tokens) via `token.burn()`,
    /// records up to 15 recent messages, and crowns a new `KingShout` when `>= 5,000` tokens
    /// surpass the previous King burn amount.
    pub fn burn_shout(
        e: &Env,
        sender: Address,
        token: Address,
        amount: i128,
        message: String,
    ) -> Result<(), LaunchpadError> {
        sender.require_auth();

        if amount < MIN_SHOUT_BURN {
            return Err(LaunchpadError::InvalidAmount);
        }
        if message.is_empty() || message.len() > MAX_SHOUT_BYTES {
            return Err(LaunchpadError::InvalidMetadata);
        }

        token::Client::new(e, &token).burn(&sender, &amount);

        let ledger = e.ledger().sequence();
        let entry = ShoutRecord {
            sender: sender.clone(),
            amount,
            message: message.clone(),
            ledger,
            timestamp: e.ledger().timestamp(),
        };

        let key = DataKey::TokenShouts(token.clone());
        let existing: Vec<ShoutRecord> = e.storage().persistent().get(&key).unwrap_or(Vec::new(e));
        let mut updated = Vec::new(e);
        let len = existing.len();
        let start = if len >= MAX_SHOUTS_PER_TOKEN {
            len + 1 - MAX_SHOUTS_PER_TOKEN
        } else {
            0
        };
        for i in start..len {
            if let Some(item) = existing.get(i) {
                updated.push_back(item);
            }
        }
        updated.push_back(entry.clone());
        e.storage().persistent().set(&key, &updated);
        Self::bump_persistent(e, &key);

        let mut is_king = false;
        if amount >= KING_SHOUT_MIN_BURN {
            let king_key = DataKey::KingShout(token.clone());
            let now = e.ledger().timestamp();
            let effective_prev = e
                .storage()
                .persistent()
                .get::<DataKey, ShoutRecord>(&king_key)
                .map(|r| {
                    let elapsed_days = now.saturating_sub(r.timestamp) / KING_SHOUT_DECAY_SECONDS;
                    let shift = elapsed_days.min(20) as u32;
                    let decayed = r.amount >> shift;
                    if decayed < KING_SHOUT_MIN_BURN {
                        KING_SHOUT_MIN_BURN
                    } else {
                        decayed
                    }
                })
                .unwrap_or(0);
            if effective_prev == 0 || amount > effective_prev || (amount >= KING_SHOUT_MIN_BURN && effective_prev == KING_SHOUT_MIN_BURN && now.saturating_sub(e.storage().persistent().get::<DataKey, ShoutRecord>(&king_key).map(|r| r.timestamp).unwrap_or(now)) >= KING_SHOUT_DECAY_SECONDS) {
                e.storage().persistent().set(&king_key, &entry);
                Self::bump_persistent(e, &king_key);
                is_king = true;
            }
        }

        Self::extend_launch_ttl(e, token.clone());

        ShoutEvent {
            token,
            sender,
            amount,
            message,
            is_king,
            ledger,
        }
        .publish(e);

        Ok(())
    }

    /// Returns newest-first launches from the persistent on-chain registry.
    pub fn get_launches(e: &Env, offset: u32, limit: u32) -> Vec<LaunchRecord> {
        let total = Self::get_launch_count(e);
        if offset >= total || limit == 0 {
            return Vec::new(e);
        }

        let count = limit.min(MAX_LAUNCH_PAGE_SIZE).min(total - offset);
        let mut out = Vec::new(e);
        for i in 0..count {
            let idx = total - 1 - offset - i;
            let key = DataKey::LaunchByIndex(idx);
            if let Some(record) = e.storage().persistent().get::<DataKey, LaunchRecord>(&key) {
                Self::bump_persistent(e, &key);
                out.push_back(record);
            }
        }
        out
    }

    /// Looks up a launch record by token contract address.
    pub fn get_launch(e: &Env, token: Address) -> Option<LaunchRecord> {
        let idx_key = DataKey::TokenIndex(token);
        let idx: u32 = e.storage().persistent().get(&idx_key)?;
        Self::bump_persistent(e, &idx_key);

        let rec_key = DataKey::LaunchByIndex(idx);
        let record: LaunchRecord = e.storage().persistent().get(&rec_key)?;
        Self::bump_persistent(e, &rec_key);
        Some(record)
    }

    /// Looks up the live bonding curve / graduation / burn-vault state for a token.
    pub fn get_curve(e: &Env, token: Address) -> Option<CurveState> {
        let key = DataKey::Curve(token);
        let curve = e.storage().persistent().get::<DataKey, CurveState>(&key)?;
        Self::bump_persistent(e, &key);
        Some(curve)
    }

    /// Returns total number of tokens launched and indexed through this launchpad.
    pub fn get_launch_count(e: &Env) -> u32 {
        e.storage()
            .instance()
            .get(&DataKey::LaunchCount)
            .unwrap_or(0)
    }

    /// Returns recent on-chain Burn-to-Chat shouts for a token (oldest to newest, max 15).
    pub fn get_shouts(e: &Env, token: Address) -> Vec<ShoutRecord> {
        let key = DataKey::TokenShouts(token);
        if let Some(shouts) = e.storage().persistent().get(&key) {
            Self::bump_persistent(e, &key);
            shouts
        } else {
            Vec::new(e)
        }
    }

    /// Returns the pinned King Shout (highest `burn_shout >= 5,000` tokens), if any.
    pub fn get_king_shout(e: &Env, token: Address) -> Option<ShoutRecord> {
        let key = DataKey::KingShout(token);
        let king = e.storage().persistent().get::<DataKey, ShoutRecord>(&key)?;
        Self::bump_persistent(e, &key);
        Some(king)
    }

    /// Permissionlessly refreshes the launchpad instance TTL for 90 days.
    pub fn extend_ttl(e: &Env) {
        e.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_BUMP_AMOUNT);
    }

    /// Permissionlessly refreshes TTL for a token's registry, curve, shouts, and King Shout.
    pub fn extend_launch_ttl(e: &Env, token: Address) {
        Self::extend_ttl(e);
        Self::bump_launch_record_ttl(e, &token);

        let curve_key = DataKey::Curve(token.clone());
        if e.storage().persistent().has(&curve_key) {
            Self::bump_persistent(e, &curve_key);
        }
        let shout_key = DataKey::TokenShouts(token.clone());
        if e.storage().persistent().has(&shout_key) {
            Self::bump_persistent(e, &shout_key);
        }
        let king_key = DataKey::KingShout(token);
        if e.storage().persistent().has(&king_key) {
            Self::bump_persistent(e, &king_key);
        }
    }

    /// Read configuration methods.
    pub fn get_factory(e: &Env) -> Option<Address> {
        e.storage().instance().get(&DataKey::Factory)
    }

    pub fn get_xlm_sac(e: &Env) -> Option<Address> {
        e.storage().instance().get(&DataKey::XlmSac)
    }

    pub fn get_burn_address(e: &Env) -> Option<Address> {
        e.storage().instance().get(&DataKey::BurnAddress)
    }

    pub fn get_token_wasm_hash(e: &Env) -> Option<BytesN<32>> {
        e.storage().instance().get(&DataKey::TokenWasmHash)
    }

    pub fn get_treasury(e: &Env) -> Option<Address> {
        e.storage().instance().get(&DataKey::Treasury)
    }

    pub fn get_creation_fee(_e: &Env) -> i128 {
        CREATION_FEE_STROOPS
    }
}

impl Launchpad {
    #[allow(clippy::too_many_arguments)]
    fn deploy_capped_token(
        e: &Env,
        creator: &Address,
        this: &Address,
        wasm_hash: BytesN<32>,
        name: String,
        symbol: String,
        decimals: u32,
        initial_supply: i128,
        salt: BytesN<32>,
        lock_to_curve: bool,
    ) -> Address {
        let mut salt_payload = Bytes::new(e);
        salt_payload.append(&creator.clone().to_xdr(e));
        salt_payload.append(&salt.into());
        let derived_salt = e.crypto().sha256(&salt_payload);

        let ctor_args = (name, symbol, decimals, this.clone(), initial_supply);
        let token_addr = e
            .deployer()
            .with_current_contract(derived_salt)
            .deploy_contract(ContractExecutable::Wasm(wasm_hash), ctor_args);

        if lock_to_curve {
            CurveLockTokenClient::new(e, &token_addr).lock_until_graduated(this);
        }

        // Lock cap permanently by renouncing token mint ownership immediately.
        OwnableClient::new(e, &token_addr).renounce_ownership();
        token_addr
    }

    fn seed_soroswap_and_burn_lp(
        e: &Env,
        this: &Address,
        token_addr: &Address,
        xlm_sac: &Address,
        burn_address: &Address,
        token_lp_amount: i128,
        xlm_lp_amount: i128,
    ) -> Result<(Address, i128), LaunchpadError> {
        let factory = Self::require_factory(e)?;
        let factory_client = SoroswapFactoryClient::new(e, &factory);
        let pair_addr = if factory_client.pair_exists(token_addr, xlm_sac) {
            let existing = factory_client.get_pair(token_addr, xlm_sac);
            let (r0, r1) = SoroswapPairClient::new(e, &existing).get_reserves();
            if r0 > 0 || r1 > 0 {
                return Err(LaunchpadError::PairAlreadySeeded);
            }
            existing
        } else {
            factory_client.create_pair(token_addr, xlm_sac)
        };

        token::Client::new(e, token_addr).transfer(this, &pair_addr, &token_lp_amount);
        token::Client::new(e, xlm_sac).transfer(this, &pair_addr, &xlm_lp_amount);

        let lp_minted = SoroswapPairClient::new(e, &pair_addr).deposit(burn_address);
        Ok((pair_addr, lp_minted))
    }

    fn execute_buyback_burn_internal(
        e: &Env,
        curve_key: &DataKey,
        curve: &mut CurveState,
        token_addr: &Address,
    ) -> Result<i128, LaunchpadError> {
        let xlm_in = curve.buyback_xlm_reserve;
        if xlm_in <= 0 {
            return Err(LaunchpadError::MilestoneNotReached);
        }
        let pair_addr = curve
            .pair
            .clone()
            .ok_or(LaunchpadError::InvalidCurveState)?;
        let xlm_sac = Self::require_xlm_sac(e)?;
        let pair_client = SoroswapPairClient::new(e, &pair_addr);
        let token0 = pair_client.token_0();
        let (r0, r1) = pair_client.get_reserves();
        let (reserve_xlm, reserve_tok) = if token0 == xlm_sac {
            (r0, r1)
        } else {
            (r1, r0)
        };
        if reserve_xlm <= 0 || reserve_tok <= 0 {
            return Err(LaunchpadError::InvalidCurveState);
        }

        // Exact SoroswapPair fee ceiling invariant: fee = ceil(xlm_in * 3 / 1000).
        let fee = (xlm_in as u128)
            .checked_mul(3)
            .ok_or(LaunchpadError::InvalidAmount)?
            .div_ceil(1_000);
        let net_in = (xlm_in as u128)
            .checked_sub(fee)
            .ok_or(LaunchpadError::InvalidAmount)?;
        let numerator = net_in
            .checked_mul(reserve_tok as u128)
            .ok_or(LaunchpadError::InvalidAmount)?;
        let denominator = (reserve_xlm as u128)
            .checked_add(net_in)
            .ok_or(LaunchpadError::InvalidAmount)?;
        let tokens_out = (numerator / denominator) as i128;
        if tokens_out <= 0 {
            return Err(LaunchpadError::InvalidAmount);
        }

        curve.buyback_xlm_reserve = 0;
        e.storage().persistent().set(curve_key, curve);
        Self::bump_persistent(e, curve_key);

        let this = e.current_contract_address();
        token::Client::new(e, &xlm_sac).transfer(&this, &pair_addr, &xlm_in);
        let (a0, a1) = if token0 == xlm_sac {
            (0, tokens_out)
        } else {
            (tokens_out, 0)
        };
        pair_client.swap(&a0, &a1, &this);
        token::Client::new(e, token_addr).burn(&this, &tokens_out);

        let total_supply_after = SupplyTokenClient::new(e, token_addr).total_supply();
        Self::bump_launch_record_ttl(e, token_addr);

        BuybackBurnEvent {
            token: token_addr.clone(),
            xlm_spent: xlm_in,
            tokens_burned: tokens_out,
            total_supply_after,
        }
        .publish(e);

        Ok(tokens_out)
    }

    fn execute_curve_buy(
        e: &Env,
        buyer: &Address,
        token_addr: &Address,
        max_xlm_in: i128,
        min_tokens_out: i128,
        lock_creator_seed: bool,
    ) -> Result<TradeResult, LaunchpadError> {
        let curve_key = DataKey::Curve(token_addr.clone());
        let mut curve: CurveState = e
            .storage()
            .persistent()
            .get(&curve_key)
            .ok_or(LaunchpadError::CurveNotFound)?;
        if curve.graduated {
            return Err(LaunchpadError::InvalidCurveState);
        }

        let quote = Self::compute_buy_quote(&curve, max_xlm_in)?;
        if quote.tokens_out <= 0 || quote.total_xlm_charged > max_xlm_in {
            return Err(LaunchpadError::InvalidAmount);
        }
        if quote.tokens_out < min_tokens_out {
            return Err(LaunchpadError::SlippageExceeded);
        }

        // Update curve reserves before external interactions
        curve.curve_xlm_net += quote.net_xlm_to_curve;
        curve.real_xlm_vault += quote.net_xlm_to_curve + quote.floor_bonus;
        curve.tokens_sold += quote.tokens_out;
        if lock_creator_seed {
            curve.creator_seed_locked += quote.tokens_out;
        }

        let this = e.current_contract_address();
        let xlm_sac = Self::require_xlm_sac(e)?;
        let treasury = Self::require_treasury(e)?;
        let xlm_client = token::Client::new(e, &xlm_sac);
        let tok_client = token::Client::new(e, token_addr);

        xlm_client.transfer(buyer, &this, &quote.total_xlm_charged);
        if quote.treasury_fee > 0 {
            xlm_client.transfer(&this, &treasury, &quote.treasury_fee);
        }
        if !lock_creator_seed {
            tok_client.transfer(&this, buyer, &quote.tokens_out);
        }

        CurveTradeEvent {
            token: token_addr.clone(),
            trader: buyer.clone(),
            is_buy: true,
            xlm_amount: quote.total_xlm_charged,
            token_amount: quote.tokens_out,
            treasury_fee: quote.treasury_fee,
            floor_bonus: quote.floor_bonus,
            curve_xlm_net: curve.curve_xlm_net,
            tokens_sold: curve.tokens_sold,
        }
        .publish(e);

        if quote.will_graduate {
            // Unlock SEP-41 P2P/DEX transfers atomically before seeding Soroswap LP.
            CurveLockTokenClient::new(e, token_addr).unlock_transfers();

            let burn_address = Self::require_burn_address(e)?;
            let surplus_bonus = curve.real_xlm_vault.saturating_sub(CURVE_REAL_XLM_GOAL);
            let buyback_reserve =
                (surplus_bonus * BUYBACK_RESERVE_SHARE_BPS) / BPS_DENOMINATOR;
            let xlm_to_dex = curve.real_xlm_vault - buyback_reserve;

            let (pair_addr, lp_minted) = Self::seed_soroswap_and_burn_lp(
                e,
                &this,
                token_addr,
                &xlm_sac,
                &burn_address,
                DEX_TOKENS_ALLOC,
                xlm_to_dex,
            )?;

            // Burn Milestone 1 (50% of Burn Vault = 1,475,000 tokens) directly via token.burn()
            let vault_burn = curve.burn_vault_remaining / 2;
            if vault_burn > 0 {
                tok_client.burn(&this, &vault_burn);
            }

            curve.graduated = true;
            curve.graduated_at = e.ledger().timestamp();
            curve.pair = Some(pair_addr.clone());
            curve.lp_minted = lp_minted;
            curve.real_xlm_vault = 0;
            curve.buyback_xlm_reserve = buyback_reserve;
            curve.burn_vault_remaining -= vault_burn;
            curve.burn_milestone_stage = 1;

            e.storage().persistent().set(&curve_key, &curve);
            Self::bump_persistent(e, &curve_key);

            // Sync registry record with Soroswap pair & deployed LP metrics
            Self::update_graduated_record(e, token_addr, &pair_addr, xlm_to_dex, lp_minted);

            TokenGraduatedEvent {
                token: token_addr.clone(),
                pair: pair_addr.clone(),
                xlm_deposited: xlm_to_dex,
                tokens_deposited: DEX_TOKENS_ALLOC,
                lp_minted,
                vault_burned: vault_burn,
            }
            .publish(e);

            let total_supply_after = SupplyTokenClient::new(e, token_addr).total_supply();
            MilestoneBurnEvent {
                token: token_addr.clone(),
                stage: 1,
                burned_amount: vault_burn,
                total_supply_after,
            }
            .publish(e);

            return Ok(TradeResult {
                tokens: quote.tokens_out,
                xlm: quote.total_xlm_charged,
                treasury_fee: quote.treasury_fee,
                floor_bonus: quote.floor_bonus,
                graduated: true,
                pair: Some(pair_addr),
            });
        }

        e.storage().persistent().set(&curve_key, &curve);
        Self::bump_persistent(e, &curve_key);
        Self::bump_launch_record_ttl(e, token_addr);

        Ok(TradeResult {
            tokens: quote.tokens_out,
            xlm: quote.total_xlm_charged,
            treasury_fee: quote.treasury_fee,
            floor_bonus: quote.floor_bonus,
            graduated: false,
            pair: None,
        })
    }

    /// Flat 0.80% buy fee (0.50% treasury + 0.30% LP/buyback floor) — zero penalty on larger buys.
    fn fee_bps_buy() -> (i128, i128, i128) {
        (
            TREASURY_FEE_BPS,
            BUY_FLOOR_FEE_BPS,
            TREASURY_FEE_BPS + BUY_FLOOR_FEE_BPS,
        )
    }

    /// Asymmetric anti-sniper curve sell fee: 2.50% (<50% progress) or 1.50% (>=50% progress).
    fn fee_bps_sell(curve_xlm_net: i128) -> (i128, i128, i128) {
        let floor_bps = if curve_xlm_net < CURVE_REAL_XLM_GOAL / 2 {
            SELL_FLOOR_EARLY_BPS
        } else {
            SELL_FLOOR_LATE_BPS
        };
        (TREASURY_FEE_BPS, floor_bps, TREASURY_FEE_BPS + floor_bps)
    }

    fn split_fee(
        gross: i128,
        treasury_bps: i128,
        floor_bps: i128,
    ) -> Result<(i128, i128), LaunchpadError> {
        let g = u128::try_from(gross).map_err(|_| LaunchpadError::InvalidAmount)?;
        let denom = BPS_DENOMINATOR as u128;
        let treasury_fee = g
            .checked_mul(treasury_bps as u128)
            .ok_or(LaunchpadError::InvalidAmount)?
            / denom;
        let floor_bonus = g
            .checked_mul(floor_bps as u128)
            .ok_or(LaunchpadError::InvalidAmount)?
            / denom;
        Ok((treasury_fee as i128, floor_bonus as i128))
    }

    fn compute_buy_quote(curve: &CurveState, max_xlm_in: i128) -> Result<BuyQuote, LaunchpadError> {
        let v_xlm = CURVE_VIRTUAL_XLM_START + curve.curve_xlm_net;
        let v_tok = CURVE_VIRTUAL_TOKEN_START - curve.tokens_sold;
        let remaining_to_goal = CURVE_REAL_XLM_GOAL - curve.curve_xlm_net;
        let remaining_tokens = CURVE_TOKENS_ALLOC - curve.tokens_sold;

        let (t_bps, f_bps, total_bps) = Self::fee_bps_buy();
        let (treasury_fee_full, floor_bonus_full) = Self::split_fee(max_xlm_in, t_bps, f_bps)?;
        let net_full = max_xlm_in - treasury_fee_full - floor_bonus_full;

        if net_full >= remaining_to_goal {
            // Graduation reached: cap XLM charged strictly to remaining goal + proportional 0.80% fee
            let net_xlm_to_curve = remaining_to_goal;
            let (ct_bps, cf_bps, ctotal_bps) = Self::fee_bps_buy();
            let max_fee_room = max_xlm_in - net_xlm_to_curve;
            let denom = (BPS_DENOMINATOR - ctotal_bps) as u128;
            let ideal_gross = ((net_xlm_to_curve as u128)
                .checked_mul(BPS_DENOMINATOR as u128)
                .ok_or(LaunchpadError::InvalidAmount)?
                .checked_add(denom - 1)
                .ok_or(LaunchpadError::InvalidAmount)?
                / denom) as i128;
            let ideal_fee = (ideal_gross - net_xlm_to_curve).min(max_fee_room);
            let total_xlm_charged = net_xlm_to_curve + ideal_fee;
            let treasury_fee =
                ((ideal_fee as u128 * ct_bps as u128) / (ct_bps + cf_bps) as u128) as i128;
            let floor_bonus = ideal_fee - treasury_fee;

            return Ok(BuyQuote {
                total_xlm_charged,
                net_xlm_to_curve,
                treasury_fee,
                floor_bonus,
                tokens_out: remaining_tokens,
                will_graduate: true,
                total_fee_bps: ctotal_bps,
            });
        }

        if net_full <= 0 {
            return Err(LaunchpadError::InvalidAmount);
        }

        let k_cur = (v_xlm as u128)
            .checked_mul(v_tok as u128)
            .ok_or(LaunchpadError::InvalidAmount)?;
        let new_v_xlm = (v_xlm as u128) + (net_full as u128);
        // Round new_v_tok UP so curve invariant strictly holds (>= k_cur)
        let new_v_tok = k_cur.div_ceil(new_v_xlm);
        let tokens_out = (v_tok as u128)
            .checked_sub(new_v_tok)
            .ok_or(LaunchpadError::InvalidAmount)? as i128;
        if tokens_out <= 0 || tokens_out > remaining_tokens {
            return Err(LaunchpadError::InvalidAmount);
        }

        Ok(BuyQuote {
            total_xlm_charged: max_xlm_in,
            net_xlm_to_curve: net_full,
            treasury_fee: treasury_fee_full,
            floor_bonus: floor_bonus_full,
            tokens_out,
            will_graduate: false,
            total_fee_bps: total_bps,
        })
    }

    fn compute_sell_quote(
        curve: &CurveState,
        token_amount: i128,
    ) -> Result<SellQuote, LaunchpadError> {
        let v_xlm = CURVE_VIRTUAL_XLM_START + curve.curve_xlm_net;
        let v_tok = CURVE_VIRTUAL_TOKEN_START - curve.tokens_sold;

        let k_cur = (v_xlm as u128)
            .checked_mul(v_tok as u128)
            .ok_or(LaunchpadError::InvalidAmount)?;
        let new_v_tok = (v_tok as u128) + (token_amount as u128);
        // Round new_v_xlm UP so gross_xlm_out rounds DOWN (never overpays curve)
        let mut new_v_xlm = k_cur.div_ceil(new_v_tok) as i128;
        if new_v_xlm < CURVE_VIRTUAL_XLM_START {
            new_v_xlm = CURVE_VIRTUAL_XLM_START;
        }

        let gross_xlm_out = v_xlm - new_v_xlm;
        if gross_xlm_out <= 0 || gross_xlm_out > curve.curve_xlm_net {
            return Err(LaunchpadError::InvalidAmount);
        }

        let (t_bps, f_bps, total_bps) = Self::fee_bps_sell(curve.curve_xlm_net);
        let (treasury_fee, floor_bonus) = Self::split_fee(gross_xlm_out, t_bps, f_bps)?;
        let net_xlm_out = gross_xlm_out - treasury_fee - floor_bonus;
        if net_xlm_out <= 0 {
            return Err(LaunchpadError::InvalidAmount);
        }

        Ok(SellQuote {
            gross_xlm_out,
            net_xlm_out,
            treasury_fee,
            floor_bonus,
            total_fee_bps: total_bps,
        })
    }

    fn save_launch_record(e: &Env, index: u32, token_addr: &Address, record: &LaunchRecord) {
        e.storage()
            .instance()
            .set(&DataKey::LaunchCount, &(index + 1));
        let idx_rec_key = DataKey::LaunchByIndex(index);
        let tok_idx_key = DataKey::TokenIndex(token_addr.clone());
        e.storage().persistent().set(&idx_rec_key, record);
        Self::bump_persistent(e, &idx_rec_key);
        e.storage().persistent().set(&tok_idx_key, &index);
        Self::bump_persistent(e, &tok_idx_key);
    }

    fn update_graduated_record(
        e: &Env,
        token_addr: &Address,
        pair_addr: &Address,
        xlm_lp_amount: i128,
        lp_minted: i128,
    ) {
        let idx_key = DataKey::TokenIndex(token_addr.clone());
        if let Some(idx) = e.storage().persistent().get::<DataKey, u32>(&idx_key) {
            Self::bump_persistent(e, &idx_key);
            let rec_key = DataKey::LaunchByIndex(idx);
            if let Some(mut record) = e
                .storage()
                .persistent()
                .get::<DataKey, LaunchRecord>(&rec_key)
            {
                record.pair = Some(pair_addr.clone());
                record.xlm_lp_amount = xlm_lp_amount;
                record.lp_minted = lp_minted;
                e.storage().persistent().set(&rec_key, &record);
                Self::bump_persistent(e, &rec_key);
            }
        }
    }

    fn bump_launch_record_ttl(e: &Env, token: &Address) {
        let idx_key = DataKey::TokenIndex(token.clone());
        if let Some(idx) = e.storage().persistent().get::<DataKey, u32>(&idx_key) {
            Self::bump_persistent(e, &idx_key);
            let rec_key = DataKey::LaunchByIndex(idx);
            if e.storage().persistent().has(&rec_key) {
                Self::bump_persistent(e, &rec_key);
            }
        }
    }

    fn require_factory(e: &Env) -> Result<Address, LaunchpadError> {
        e.storage()
            .instance()
            .get(&DataKey::Factory)
            .ok_or(LaunchpadError::NotInitialized)
    }

    fn require_xlm_sac(e: &Env) -> Result<Address, LaunchpadError> {
        e.storage()
            .instance()
            .get(&DataKey::XlmSac)
            .ok_or(LaunchpadError::NotInitialized)
    }

    fn require_token_wasm_hash(e: &Env) -> Result<BytesN<32>, LaunchpadError> {
        e.storage()
            .instance()
            .get(&DataKey::TokenWasmHash)
            .ok_or(LaunchpadError::NotInitialized)
    }

    fn require_burn_address(e: &Env) -> Result<Address, LaunchpadError> {
        e.storage()
            .instance()
            .get(&DataKey::BurnAddress)
            .ok_or(LaunchpadError::NotInitialized)
    }

    fn require_treasury(e: &Env) -> Result<Address, LaunchpadError> {
        e.storage()
            .instance()
            .get(&DataKey::Treasury)
            .ok_or(LaunchpadError::NotInitialized)
    }

    fn bump_persistent(e: &Env, key: &DataKey) {
        e.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_BUMP_AMOUNT);
    }
}
