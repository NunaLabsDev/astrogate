//! AstroGate Fair-Flywheel Launchpad Contract (v4.4).
//!
//! Guarantees fair distribution (`1,000 vXLM -> 1,000 real XLM` goal, `4.00x` curve,
//! `66%` curve / `33%` DEX / `0.30%` 15-day vesting / `0.40%` 3-checkpoint jackpots / `0.30%` ecosystem),
//! softened 3-stage curve fees (`0.30% / 0.50% / 0.25%` buys, `1.20% / 1.80% / 1.50%` sells feeding
//! LP & post-grad Soroswap Buyback-and-Burn), 3-Checkpoint Jackpot Ladder (`+5,000` Spark at `250 XLM`,
//! `+10,000` King Crown at `500 XLM`, `+25,000` Graduation Jackpot at `1,000 XLM`), transfer-locked curve
//! tokens until atomic `0.00%` cliff Soroswap graduation with 7-year contract LP lock (`reclaim_expired_lp`),
//! creator initial-seed lock until graduation, and decaying Burn-to-Chat King Shout.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    xdr::ToXdr, Address, Bytes, BytesN, ContractExecutable, Env, String, Vec,
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
    /// New launches are temporarily paused by protocol admin.
    LaunchesPaused = 9,
    /// Unauthorized caller or missing pending admin transfer.
    Unauthorized = 10,
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

/// Fair-Flywheel v4.3 Launch parameters: fixed 10M supply (`66%` curve / `33%` DEX with
/// 7-year LP lock / `0.3%` 15-day creator vesting / `0.7%` ecosystem) with creator's
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
pub struct MarketCardRecord {
    pub record: LaunchRecord,
    pub curve: Vec<CurveState>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PilotRecord {
    pub launches: u32,
    pub graduations: u32,
    pub trades: u32,
    pub volume_xlm_stroops: i128,
    pub shouts: u32,
    pub king_shouts: u32,
    pub burns_triggered: u32,
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
    /// Cumulative tokens sold on the bonding curve (`0..=6,600,000`).
    pub tokens_sold: i128,
    /// Real XLM reserved from curve fees for permissionless Soroswap buyback-and-burn.
    pub buyback_xlm_reserve: i128,
    /// Legacy Proof-of-Burn vault balance (`0` in Fair-Flywheel v4.3).
    pub burn_vault_remaining: i128,
    /// Burn stage (`0` pre-grad; `2` graduated in v4.3 with zero idle burn vault).
    pub burn_milestone_stage: u32,
    /// Total creator bonus allocation locked until post-grad 15-day vesting (`30,000` = 0.3%).
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

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingUpgradeData {
    pub wasm_hash: BytesN<32>,
    pub scheduled_at: u64,
    pub execute_after: u64,
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
pub struct ReclaimLpEvent {
    #[topic]
    pub token: Address,
    pub pair: Address,
    pub recipient: Address,
    pub lp_amount: i128,
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

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PausedChangedEvent {
    pub paused: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TreasuryUpdatedEvent {
    #[topic]
    pub new_treasury: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TokenWasmHashUpdatedEvent {
    pub new_wasm_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CreationFeeUpdatedEvent {
    pub new_fee_stroops: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminTransferProposedEvent {
    #[topic]
    pub pending_admin: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminTransferAcceptedEvent {
    #[topic]
    pub new_admin: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminTransferCancelledEvent {
    #[topic]
    pub cancelled_admin: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeScheduledEvent {
    pub wasm_hash: BytesN<32>,
    pub execute_after: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeCancelledEvent {
    pub wasm_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeExecutedEvent {
    pub wasm_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CheckpointRewardEscrowedEvent {
    #[topic]
    pub token: Address,
    #[topic]
    pub winner: Address,
    pub reward: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CheckpointRewardClaimedEvent {
    #[topic]
    pub token: Address,
    #[topic]
    pub winner: Address,
    pub reward: i128,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Factory,
    XlmSac,
    TokenWasmHash,
    BurnAddress,
    Treasury,
    Admin,
    PendingAdmin,
    StorageVersion,
    PendingUpgrade,
    LaunchesPaused,
    CreationFee,
    LaunchCount,
    LaunchByIndex(u32),
    TokenIndex(Address),
    Curve(Address),
    CheckpointReward(Address, Address),
    TokenShouts(Address),
    KingShout(Address),
    BuybackLastTs(Address),
    Pilot(Address),
    ReentrancyLock,
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
    fn total_supply(e: &Env) -> i128;
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

/// Fair-Flywheel v4.4 constants (10M supply, 7 decimals, 66 / 33 / 0.30 / 0.40 jackpots / 0.30 dev + 7Y LP Lock).
const FAIR_DECIMALS: u32 = 7;
const FAIR_INITIAL_SUPPLY: i128 = 10_000_000 * STROOPS_PER_UNIT; // 100_000_000_000_000
const CURVE_TOKENS_ALLOC: i128 = 6_600_000 * STROOPS_PER_UNIT; // 66.00%
const DEX_TOKENS_ALLOC: i128 = 3_300_000 * STROOPS_PER_UNIT; // 33.00%
const BURN_VAULT_TOKENS_ALLOC: i128 = 0; // 0.0% (no artificial burn vault; organic Buyback & Shout burns only)
const CREATOR_VESTING_ALLOC: i128 = 30_000 * STROOPS_PER_UNIT; // 0.30% (5 x 6,000 over 15d post-grad)
const SPARK_JACKPOT_ALLOC: i128 = 5_000 * STROOPS_PER_UNIT; // 0.05% (250 XLM checkpoint bonus)
const CROWN_JACKPOT_ALLOC: i128 = 10_000 * STROOPS_PER_UNIT; // 0.10% (500 XLM King Crown checkpoint bonus)
const GRADUATION_JACKPOT_ALLOC: i128 = 25_000 * STROOPS_PER_UNIT; // 0.25% (1,000 XLM Graduation Jackpot)
const DEV_ECOSYSTEM_ALLOC: i128 = 30_000 * STROOPS_PER_UNIT; // 0.30% (transferred to treasury at graduation)

/// Virtual LP parameters (`1,000 vXLM -> 1,000 real XLM goal`, `4.00x` curve, `0.00%` graduation cliff).
const CURVE_VIRTUAL_XLM_START: i128 = 1_000 * STROOPS_PER_UNIT; // 10_000_000_000
const CURVE_REAL_XLM_GOAL: i128 = 1_000 * STROOPS_PER_UNIT; // 10_000_000_000
const CURVE_VIRTUAL_TOKEN_START: i128 = 13_200_000 * STROOPS_PER_UNIT; // 132_000_000_000_000

/// 7-Year LP Time-Lock (`220,752,000s`): Soroswap LP minted at graduation stays locked in the
/// Launchpad contract for 7 years before dormant pools can be reclaimed by protocol treasury.
const LP_LOCK_DURATION_SECONDS: u64 = 7 * 365 * 86_400;

/// 3-Stage Softened Dynamic Fees & Jackpot Checkpoints:
/// - Stage 1 (<250 XLM, 0-25%): Buy 0.30% (20+10 bps), Sell 1.20% (30+90 bps) | Goal: +5K at 250 XLM
/// - Stage 2 (250..500 XLM, 25-50%): Buy 0.50% (30+20 bps), Sell 1.80% (40+140 bps) | Goal: +10K at 500 XLM
/// - Stage 3 (500..1,000 XLM, 50-100%): Buy 0.25% (15+10 bps), Sell 1.50% (30+120 bps) | Goal: +25K at 1,000 XLM
const STAGE_1_XLM: i128 = 250 * STROOPS_PER_UNIT;
const STAGE_2_XLM: i128 = 500 * STROOPS_PER_UNIT;
const BUY_TREASURY_EARLY_BPS: i128 = 20;
const BUY_FLOOR_EARLY_BPS: i128 = 10;
const BUY_TREASURY_MID_BPS: i128 = 30;
const BUY_FLOOR_MID_BPS: i128 = 20;
const BUY_TREASURY_SPRINT_BPS: i128 = 15;
const BUY_FLOOR_SPRINT_BPS: i128 = 10;
const SELL_TREASURY_EARLY_BPS: i128 = 30;
const SELL_FLOOR_EARLY_BPS: i128 = 90;
const SELL_TREASURY_MID_BPS: i128 = 40;
const SELL_FLOOR_MID_BPS: i128 = 140;
const SELL_TREASURY_SPRINT_BPS: i128 = 30;
const SELL_FLOOR_SPRINT_BPS: i128 = 120;
/// 60% of surplus `floor_bonus` at graduation funds post-grad Soroswap Buyback & Burn; 40% deepens DEX LP.
const BUYBACK_RESERVE_SHARE_BPS: i128 = 6_000;
/// Cap each permissionless buyback chunk to <= 0.50% of pool XLM reserve per cooldown window
/// (with an absolute 250 XLM ceiling per swap) so round-trip Soroswap fees (0.60%) make sandwich MEV unprofitable.
const BUYBACK_MAX_CHUNK_BPS: i128 = 50;
const BUYBACK_MAX_ABSOLUTE_CHUNK_XLM: i128 = 250 * STROOPS_PER_UNIT;
const BUYBACK_COOLDOWN_SECONDS: u64 = 300;
const UPGRADE_TIMELOCK_SECONDS: u64 = 48 * 3_600;
const STORAGE_VERSION_V1: u32 = 1;

/// Milestone 2 burn trigger: Soroswap pair real XLM reserve >= 1,800 XLM.
const MILESTONE_2_PAIR_XLM: i128 = 1_800 * STROOPS_PER_UNIT;

/// Post-graduation creator vesting: 5 tranches of 20% (10,000 tokens) every 3 days (15 days total).
const VESTING_INTERVAL_SECONDS: u64 = 3 * 86_400;
const VESTING_PHASES: u64 = 5;

/// 3-tier Burn-to-Chat: minimum 50 whole tokens, King Shout >= 5,000 whole tokens with 24h half-life decay.
const SHOUT_MIN_WHOLE: i128 = 50;
const KING_SHOUT_MIN_WHOLE: i128 = 5_000;
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
        if token_wasm_hash == BytesN::from_array(e, &[0u8; 32]) || factory == xlm_sac {
            panic_with_error!(e, LaunchpadError::InvalidMetadata);
        }
        e.storage().instance().set(&DataKey::Factory, &factory);
        e.storage().instance().set(&DataKey::XlmSac, &xlm_sac);
        e.storage()
            .instance()
            .set(&DataKey::TokenWasmHash, &token_wasm_hash);
        e.storage()
            .instance()
            .set(&DataKey::BurnAddress, &burn_address);
        e.storage().instance().set(&DataKey::Treasury, &treasury);
        e.storage().instance().set(&DataKey::Admin, &treasury);
        e.storage().instance().set(&DataKey::LaunchesPaused, &false);
        e.storage().instance().set(&DataKey::LaunchCount, &0u32);
        e.storage()
            .instance()
            .set(&DataKey::StorageVersion, &STORAGE_VERSION_V1);
        Self::extend_ttl(e);
    }

    /// Pauses or unpauses new token launches (`launch_fair` / `launch_token`); never blocks sells or claims.
    pub fn set_paused(e: &Env, paused: bool) -> Result<(), LaunchpadError> {
        Self::require_admin_auth(e)?;
        e.storage()
            .instance()
            .set(&DataKey::LaunchesPaused, &paused);
        Self::extend_ttl(e);
        PausedChangedEvent { paused }.publish(e);
        Ok(())
    }

    /// Rotates the developer treasury address (admin only).
    pub fn set_treasury(e: &Env, new_treasury: Address) -> Result<(), LaunchpadError> {
        Self::require_admin_auth(e)?;
        e.storage()
            .instance()
            .set(&DataKey::Treasury, &new_treasury);
        Self::extend_ttl(e);
        TreasuryUpdatedEvent { new_treasury }.publish(e);
        Ok(())
    }

    /// Updates the token WASM hash used for future token deployments (admin only).
    pub fn set_token_wasm_hash(e: &Env, new_wasm_hash: BytesN<32>) -> Result<(), LaunchpadError> {
        Self::require_admin_auth(e)?;
        if new_wasm_hash == BytesN::from_array(e, &[0u8; 32]) {
            return Err(LaunchpadError::InvalidMetadata);
        }
        e.storage()
            .instance()
            .set(&DataKey::TokenWasmHash, &new_wasm_hash);
        Self::extend_ttl(e);
        TokenWasmHashUpdatedEvent { new_wasm_hash }.publish(e);
        Ok(())
    }

    /// Updates the flat token creation fee in stroops (0..=1,000 XLM, admin only)
    /// so protocol pricing can track XLM/USDC without redeploying the contract.
    pub fn set_creation_fee(e: &Env, new_fee_stroops: i128) -> Result<(), LaunchpadError> {
        Self::require_admin_auth(e)?;
        if !(0..=1_000 * STROOPS_PER_UNIT).contains(&new_fee_stroops) {
            return Err(LaunchpadError::InvalidAmount);
        }
        e.storage()
            .instance()
            .set(&DataKey::CreationFee, &new_fee_stroops);
        Self::extend_ttl(e);
        CreationFeeUpdatedEvent { new_fee_stroops }.publish(e);
        Ok(())
    }

    /// Starts a 2-step admin transfer to `new_admin` (7-day acceptance window for multisigs).
    pub fn transfer_admin(e: &Env, new_admin: Address) -> Result<(), LaunchpadError> {
        let current_admin = Self::require_admin_auth(e)?;
        if new_admin == current_admin {
            return Err(LaunchpadError::InvalidMetadata);
        }
        let key = DataKey::PendingAdmin;
        e.storage().temporary().set(&key, &new_admin);
        e.storage()
            .temporary()
            .extend_ttl(&key, 7 * DAY_IN_LEDGERS, 7 * DAY_IN_LEDGERS);
        Self::extend_ttl(e);
        AdminTransferProposedEvent {
            pending_admin: new_admin,
        }
        .publish(e);
        Ok(())
    }

    /// Cancels a pending 2-step admin transfer before acceptance (admin only).
    pub fn cancel_admin_transfer(e: &Env) -> Result<(), LaunchpadError> {
        Self::require_admin_auth(e)?;
        let pending: Address = e
            .storage()
            .temporary()
            .get(&DataKey::PendingAdmin)
            .ok_or(LaunchpadError::Unauthorized)?;
        e.storage().temporary().remove(&DataKey::PendingAdmin);
        Self::extend_ttl(e);
        AdminTransferCancelledEvent {
            cancelled_admin: pending,
        }
        .publish(e);
        Ok(())
    }

    /// Completes a pending 2-step admin transfer.
    pub fn accept_admin(e: &Env) -> Result<(), LaunchpadError> {
        let pending: Address = e
            .storage()
            .temporary()
            .get(&DataKey::PendingAdmin)
            .ok_or(LaunchpadError::Unauthorized)?;
        pending.require_auth();
        e.storage().instance().set(&DataKey::Admin, &pending);
        e.storage().temporary().remove(&DataKey::PendingAdmin);
        Self::extend_ttl(e);
        AdminTransferAcceptedEvent { new_admin: pending }.publish(e);
        Ok(())
    }

    /// Schedules a Launchpad WASM bytecode upgrade behind a mandatory 48-hour timelock (admin only).
    pub fn schedule_upgrade(e: &Env, new_wasm_hash: BytesN<32>) -> Result<(), LaunchpadError> {
        Self::require_admin_auth(e)?;
        if new_wasm_hash == BytesN::from_array(e, &[0u8; 32]) {
            return Err(LaunchpadError::InvalidMetadata);
        }
        let key = DataKey::PendingUpgrade;
        if e.storage().persistent().has(&key) {
            return Err(LaunchpadError::InvalidCurveState);
        }
        let now = e.ledger().timestamp();
        let execute_after = now.saturating_add(UPGRADE_TIMELOCK_SECONDS);
        let pending = PendingUpgradeData {
            wasm_hash: new_wasm_hash.clone(),
            scheduled_at: now,
            execute_after,
        };
        e.storage().persistent().set(&key, &pending);
        Self::bump_persistent(e, &key);
        Self::extend_ttl(e);
        UpgradeScheduledEvent {
            wasm_hash: new_wasm_hash,
            execute_after,
        }
        .publish(e);
        Ok(())
    }

    /// Cancels a previously scheduled Launchpad WASM upgrade (admin only).
    pub fn cancel_upgrade(e: &Env) -> Result<(), LaunchpadError> {
        Self::require_admin_auth(e)?;
        let key = DataKey::PendingUpgrade;
        let pending: PendingUpgradeData = e
            .storage()
            .persistent()
            .get(&key)
            .ok_or(LaunchpadError::MilestoneNotReached)?;
        e.storage().persistent().remove(&key);
        Self::extend_ttl(e);
        UpgradeCancelledEvent {
            wasm_hash: pending.wasm_hash,
        }
        .publish(e);
        Ok(())
    }

    /// Executes a scheduled Launchpad WASM upgrade once the 48-hour timelock has elapsed (admin only).
    pub fn execute_upgrade(e: &Env) -> Result<(), LaunchpadError> {
        Self::require_admin_auth(e)?;
        let key = DataKey::PendingUpgrade;
        let pending: PendingUpgradeData = e
            .storage()
            .persistent()
            .get(&key)
            .ok_or(LaunchpadError::MilestoneNotReached)?;
        if e.ledger().timestamp() < pending.execute_after {
            return Err(LaunchpadError::MilestoneNotReached);
        }
        e.storage().persistent().remove(&key);
        Self::extend_ttl(e);
        UpgradeExecutedEvent {
            wasm_hash: pending.wasm_hash.clone(),
        }
        .publish(e);
        e.deployer()
            .update_current_contract(ContractExecutable::Wasm(pending.wasm_hash));
        Ok(())
    }

    /// Returns the currently scheduled WASM upgrade awaiting timelock expiry, if any.
    pub fn get_pending_upgrade(e: &Env) -> Option<PendingUpgradeData> {
        e.storage().persistent().get(&DataKey::PendingUpgrade)
    }

    /// Returns the initialized schema storage version for upgrade migrations.
    pub fn get_storage_version(e: &Env) -> u32 {
        e.storage()
            .instance()
            .get(&DataKey::StorageVersion)
            .unwrap_or(STORAGE_VERSION_V1)
    }

    /// Fair-Flywheel v4.4 launch: deploys fixed 10M token with P2P transfers locked until
    /// graduation, renounces mint authority, initializes the `1,000 vXLM -> 1,000 XLM` curve
    /// (`66/33/0.30/0.40 jackpots/0.30`), and executes the creator's initial atomic buy
    /// (`>= 2 XLM`, locked inside contract until graduation).
    pub fn launch_fair(e: &Env, params: FairLaunchParams) -> Result<LaunchResult, LaunchpadError> {
        params.creator.require_auth();
        Self::require_not_paused(e)?;

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

        Self::with_reentrancy_guard(e, || {
            Self::extend_ttl(e);
            let this = e.current_contract_address();
            let xlm_sac = Self::require_xlm_sac(e)?;
            let treasury = Self::require_treasury(e)?;
            // Charge configurable creation fee atomically straight to treasury.
            let creation_fee = Self::get_creation_fee(e);
            if creation_fee > 0 {
                token::Client::new(e, &xlm_sac).transfer(&params.creator, &treasury, &creation_fee);
            }

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
            Self::update_pilot(e, &params.creator, |p| {
                p.launches = p.launches.saturating_add(1);
            });

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

    /// Buys tokens from the bonding curve up to `max_xlm_in` (3-stage soft dynamic buy fee).
    /// Automatically unlocks transfers and seeds Soroswap LP at 1,000 net XLM.
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
        Self::with_reentrancy_guard(e, || {
            Self::extend_ttl(e);
            Self::execute_curve_buy(e, &buyer, &token, max_xlm_in, min_tokens_out, false)
        })
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
        Self::with_reentrancy_guard(e, || {
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
            curve.curve_xlm_net = curve
                .curve_xlm_net
                .checked_sub(quote.gross_xlm_out)
                .ok_or(LaunchpadError::InvalidAmount)?;
            curve.tokens_sold = curve
                .tokens_sold
                .checked_sub(token_amount)
                .ok_or(LaunchpadError::InvalidAmount)?;
            if curve.tokens_sold == 0 {
                // Retain any sub-unit rounding dust inside real_xlm_vault as pool floor backing
                curve.curve_xlm_net = 0;
            }
            let vault_outflow = quote
                .net_xlm_out
                .checked_add(quote.treasury_fee)
                .ok_or(LaunchpadError::InvalidAmount)?;
            curve.real_xlm_vault = curve
                .real_xlm_vault
                .checked_sub(vault_outflow)
                .ok_or(LaunchpadError::InvalidAmount)?;
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
            Self::update_pilot(e, &seller, |p| {
                p.trades = p.trades.saturating_add(1);
                p.volume_xlm_stroops = p.volume_xlm_stroops.saturating_add(quote.net_xlm_out);
            });

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
        })
    }

    /// Legacy milestone burn entrypoint (active only on v4.2 tokens with `burn_vault_remaining > 0`).
    pub fn trigger_milestone_burn(e: &Env, token: Address) -> Result<i128, LaunchpadError> {
        Self::with_reentrancy_guard(e, || {
            Self::extend_ttl(e);
            let curve_key = DataKey::Curve(token.clone());
            let mut curve: CurveState = e
                .storage()
                .persistent()
                .get(&curve_key)
                .ok_or(LaunchpadError::CurveNotFound)?;

            if !curve.graduated
                || curve.burn_milestone_stage != 1
                || curve.burn_vault_remaining <= 0
            {
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
                let _ = Self::execute_buyback_burn_internal(e, &curve_key, &mut curve, &token, 1);
            }

            Ok(burned_amount)
        })
    }

    /// Permissionlessly swaps the graduated `buyback_xlm_reserve` on Soroswap DEX
    /// for real circulating tokens and permanently burns them via `token.burn()`.
    pub fn trigger_buyback_burn(e: &Env, token: Address) -> Result<i128, LaunchpadError> {
        Self::trigger_buyback_burn_min(e, token, 1)
    }

    /// Slippage-protected Soroswap DEX buyback-and-burn requiring at least `min_tokens_burned`.
    pub fn trigger_buyback_burn_min(
        e: &Env,
        token: Address,
        min_tokens_burned: i128,
    ) -> Result<i128, LaunchpadError> {
        if min_tokens_burned <= 0 {
            return Err(LaunchpadError::InvalidAmount);
        }
        Self::with_reentrancy_guard(e, || {
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
            Self::execute_buyback_burn_internal(
                e,
                &curve_key,
                &mut curve,
                &token,
                min_tokens_burned,
            )
        })
    }

    /// Sweeps stranded floor fee dust to treasury when an ungraduated curve
    /// has zero external circulating curve liability. For `>= 30 days` abandoned curves
    /// where `creator_seed_locked > 0`, cleanly refunds `curve_xlm_net` back to the
    /// creator and sweeps only surplus fee dust to treasury (never returning phantom tokens).
    pub fn sweep_empty_curve_fees(e: &Env, token: Address) -> Result<i128, LaunchpadError> {
        Self::with_reentrancy_guard(e, || {
            Self::extend_ttl(e);
            let curve_key = DataKey::Curve(token.clone());
            let mut curve: CurveState = e
                .storage()
                .persistent()
                .get(&curve_key)
                .ok_or(LaunchpadError::CurveNotFound)?;
            if curve.graduated || curve.real_xlm_vault <= 0 {
                return Err(LaunchpadError::InvalidCurveState);
            }

            let this = e.current_contract_address();
            let zero_external_supply = Self::zero_external_supply(e, &this, &token);
            let xlm_sac = Self::require_xlm_sac(e)?;
            let treasury = Self::require_treasury(e)?;
            let xlm_client = token::Client::new(e, &xlm_sac);

            if curve.creator_seed_locked > 0 {
                if curve.tokens_sold != curve.creator_seed_locked && !zero_external_supply {
                    return Err(LaunchpadError::InvalidCurveState);
                }
                let launched_at = Self::get_launch(e, token.clone())
                    .map(|r| r.timestamp)
                    .unwrap_or(u64::MAX);
                if e.ledger().timestamp() < launched_at.saturating_add(30 * 86_400) {
                    return Err(LaunchpadError::InvalidCurveState);
                }

                let creator = curve.creator.clone();
                let creator_refund = curve.curve_xlm_net.min(curve.real_xlm_vault).max(0);
                let treasury_dust = curve.real_xlm_vault.saturating_sub(creator_refund);
                if creator_refund <= 0 && treasury_dust <= 0 {
                    return Err(LaunchpadError::InvalidCurveState);
                }

                curve.creator_seed_locked = 0;
                curve.tokens_sold = 0;
                curve.curve_xlm_net = 0;
                curve.real_xlm_vault = 0;
                e.storage().persistent().set(&curve_key, &curve);
                Self::bump_persistent(e, &curve_key);

                if creator_refund > 0 {
                    xlm_client.transfer(&this, &creator, &creator_refund);
                }
                if treasury_dust > 0 {
                    xlm_client.transfer(&this, &treasury, &treasury_dust);
                }
                Self::bump_launch_record_ttl(e, &token);
                return Ok(treasury_dust);
            }

            let zero_curve_state = curve.tokens_sold == 0 && curve.curve_xlm_net == 0;
            if !zero_curve_state && !zero_external_supply {
                return Err(LaunchpadError::InvalidCurveState);
            }

            let swept = curve.real_xlm_vault;
            curve.real_xlm_vault = 0;
            curve.curve_xlm_net = 0;
            curve.tokens_sold = 0;
            e.storage().persistent().set(&curve_key, &curve);
            Self::bump_persistent(e, &curve_key);

            xlm_client.transfer(&this, &treasury, &swept);
            Self::bump_launch_record_ttl(e, &token);
            Ok(swept)
        })
    }

    /// Lets the creator claim unlocked paid seed tokens (100% upon graduation, or after
    /// 7 days if an ungraduated curve never reached graduation) plus `0.3%` bonus vesting
    /// tranches (`20% = 6,000 tokens` every 3 days over 15 days post-graduation).
    pub fn claim_creator_vesting(
        e: &Env,
        creator: Address,
        token: Address,
    ) -> Result<i128, LaunchpadError> {
        creator.require_auth();
        Self::with_reentrancy_guard(e, || {
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
                    .ok_or(LaunchpadError::CurveNotFound)?
                    .timestamp;
                if curve.creator_seed_locked <= 0 || now < launched_at.saturating_add(7 * 86_400) {
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
            let total_unlocked = curve
                .creator_vesting_total
                .checked_mul(completed_phases as i128)
                .ok_or(LaunchpadError::InvalidAmount)?
                / (VESTING_PHASES as i128);
            let vest_claimable = total_unlocked.saturating_sub(curve.creator_claimed);
            let claimable = seed_claimable
                .checked_add(vest_claimable)
                .ok_or(LaunchpadError::InvalidAmount)?;
            if claimable <= 0 {
                return Err(LaunchpadError::MilestoneNotReached);
            }

            curve.creator_seed_locked = 0;
            curve.creator_claimed = curve
                .creator_claimed
                .checked_add(vest_claimable)
                .ok_or(LaunchpadError::InvalidAmount)?;
            e.storage().persistent().set(&curve_key, &curve);
            Self::bump_persistent(e, &curve_key);

            let this = e.current_contract_address();
            token::Client::new(e, &token).transfer(&this, &creator, &claimable);
            Self::bump_launch_record_ttl(e, &token);

            Ok(claimable)
        })
    }

    /// Claims pre-graduation Spark/Crown checkpoint jackpot tokens escrowed for `winner`
    /// once the token has graduated to Soroswap (`curve.graduated == true`).
    pub fn claim_checkpoint_reward(
        e: &Env,
        winner: Address,
        token: Address,
    ) -> Result<i128, LaunchpadError> {
        winner.require_auth();
        Self::with_reentrancy_guard(e, || {
            Self::extend_ttl(e);

            let curve_key = DataKey::Curve(token.clone());
            let curve: CurveState = e
                .storage()
                .persistent()
                .get(&curve_key)
                .ok_or(LaunchpadError::CurveNotFound)?;
            if !curve.graduated {
                return Err(LaunchpadError::InvalidCurveState);
            }

            let ck_key = DataKey::CheckpointReward(token.clone(), winner.clone());
            let reward: i128 = e.storage().persistent().get(&ck_key).unwrap_or(0);
            if reward <= 0 {
                return Err(LaunchpadError::MilestoneNotReached);
            }

            e.storage().persistent().remove(&ck_key);
            Self::bump_persistent(e, &curve_key);

            let this = e.current_contract_address();
            token::Client::new(e, &token).transfer(&this, &winner, &reward);
            Self::bump_launch_record_ttl(e, &token);

            CheckpointRewardClaimedEvent {
                token,
                winner,
                reward,
            }
            .publish(e);

            Ok(reward)
        })
    }

    /// 1-click stalled launch refund (after 7 days if all external traders exited or burned):
    /// refunds creator's `curve_xlm_net` XLM reserve while leaving accumulated fee dust for treasury sweep.
    pub fn refund_stalled_launch(
        e: &Env,
        creator: Address,
        token: Address,
    ) -> Result<i128, LaunchpadError> {
        creator.require_auth();
        Self::with_reentrancy_guard(e, || {
            Self::extend_ttl(e);

            let curve_key = DataKey::Curve(token.clone());
            let mut curve: CurveState = e
                .storage()
                .persistent()
                .get(&curve_key)
                .ok_or(LaunchpadError::CurveNotFound)?;
            let this = e.current_contract_address();
            let zero_external_supply = Self::zero_external_supply(e, &this, &token);

            if curve.graduated
                || curve.creator != creator
                || curve.creator_seed_locked <= 0
                || curve.curve_xlm_net <= 0
                || (curve.tokens_sold != curve.creator_seed_locked && !zero_external_supply)
                || curve.real_xlm_vault <= 0
            {
                return Err(LaunchpadError::InvalidCurveState);
            }

            let launched_at = Self::get_launch(e, token.clone())
                .ok_or(LaunchpadError::CurveNotFound)?
                .timestamp;
            if e.ledger().timestamp() < launched_at.saturating_add(7 * 86_400) {
                return Err(LaunchpadError::InvalidCurveState);
            }

            let refund_xlm = curve.curve_xlm_net.min(curve.real_xlm_vault);
            if refund_xlm <= 0 {
                return Err(LaunchpadError::InvalidCurveState);
            }
            curve.creator_seed_locked = 0;
            curve.tokens_sold = 0;
            curve.curve_xlm_net = 0;
            curve.real_xlm_vault = curve.real_xlm_vault.saturating_sub(refund_xlm);
            e.storage().persistent().set(&curve_key, &curve);
            Self::bump_persistent(e, &curve_key);

            let xlm_sac = Self::require_xlm_sac(e)?;
            token::Client::new(e, &xlm_sac).transfer(&this, &creator, &refund_xlm);
            Self::bump_launch_record_ttl(e, &token);
            Ok(refund_xlm)
        })
    }

    /// Reclaims time-locked Soroswap LP tokens to protocol treasury once the mandatory
    /// 7-year lock (`LP_LOCK_DURATION_SECONDS`) after graduation has fully elapsed.
    pub fn reclaim_expired_lp(e: &Env, token: Address) -> Result<i128, LaunchpadError> {
        Self::with_reentrancy_guard(e, || {
            Self::extend_ttl(e);

            let curve_key = DataKey::Curve(token.clone());
            let mut curve: CurveState = e
                .storage()
                .persistent()
                .get(&curve_key)
                .ok_or(LaunchpadError::CurveNotFound)?;
            if !curve.graduated || curve.lp_minted <= 0 {
                return Err(LaunchpadError::InvalidCurveState);
            }
            let pair_addr = curve
                .pair
                .clone()
                .ok_or(LaunchpadError::InvalidCurveState)?;

            if e.ledger().timestamp() < curve.graduated_at.saturating_add(LP_LOCK_DURATION_SECONDS)
            {
                return Err(LaunchpadError::MilestoneNotReached);
            }

            let reclaimed = curve.lp_minted;
            curve.lp_minted = 0;
            e.storage().persistent().set(&curve_key, &curve);
            Self::bump_persistent(e, &curve_key);

            let this = e.current_contract_address();
            let treasury = Self::require_treasury(e)?;
            token::Client::new(e, &pair_addr).transfer(&this, &treasury, &reclaimed);
            Self::bump_launch_record_ttl(e, &token);

            ReclaimLpEvent {
                token,
                pair: pair_addr,
                recipient: treasury,
                lp_amount: reclaimed,
            }
            .publish(e);

            Ok(reclaimed)
        })
    }

    /// Legacy-compatible direct Soroswap launch with explicit supply/decimals (`>= 99.5%` LP burned).
    pub fn launch_token(e: &Env, params: LaunchParams) -> Result<LaunchResult, LaunchpadError> {
        params.creator.require_auth();
        Self::require_not_paused(e)?;

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

        Self::with_reentrancy_guard(e, || {
            Self::extend_ttl(e);
            let this = e.current_contract_address();
            let xlm_sac = Self::require_xlm_sac(e)?;
            let treasury = Self::require_treasury(e)?;
            let wasm_hash = Self::require_token_wasm_hash(e)?;
            let burn_address = Self::require_burn_address(e)?;

            let xlm_client = token::Client::new(e, &xlm_sac);
            let creation_fee = Self::get_creation_fee(e);
            if creation_fee > 0 {
                xlm_client.transfer(&params.creator, &treasury, &creation_fee);
            }
            xlm_client.transfer(&params.creator, &this, &params.xlm_lp_amount);

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
            let creator_tokens = params
                .initial_supply
                .checked_sub(params.token_lp_amount)
                .ok_or(LaunchpadError::InvalidAmount)?;
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
            Self::update_pilot(e, &params.creator, |p| {
                p.launches = p.launches.saturating_add(1);
            });

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
        })
    }

    /// 3-tier Burn-to-Chat: permanently burns holder tokens (`>= 50` whole tokens scaled
    /// by `token.decimals`) via `token.burn()`, records up to 15 recent messages, and
    /// crowns a new `KingShout` when `>= 5,000` whole tokens surpass the decayed King burn.
    pub fn burn_shout(
        e: &Env,
        sender: Address,
        token: Address,
        amount: i128,
        message: String,
    ) -> Result<(), LaunchpadError> {
        sender.require_auth();
        if message.is_empty() || message.len() > MAX_SHOUT_BYTES {
            return Err(LaunchpadError::InvalidMetadata);
        }

        Self::with_reentrancy_guard(e, || {
            Self::extend_ttl(e);
            let record = Self::get_launch(e, token.clone()).ok_or(LaunchpadError::CurveNotFound)?;
            let unit = 10_i128
                .checked_pow(record.decimals)
                .ok_or(LaunchpadError::InvalidAmount)?;
            let min_shout_burn = SHOUT_MIN_WHOLE
                .checked_mul(unit)
                .ok_or(LaunchpadError::InvalidAmount)?;
            let king_shout_min_burn = KING_SHOUT_MIN_WHOLE
                .checked_mul(unit)
                .ok_or(LaunchpadError::InvalidAmount)?;
            if amount < min_shout_burn {
                return Err(LaunchpadError::InvalidAmount);
            }

            let ledger = e.ledger().sequence();
            let now = e.ledger().timestamp();
            let entry = ShoutRecord {
                sender: sender.clone(),
                amount,
                message: message.clone(),
                ledger,
                timestamp: now,
            };

            // Effects before external burn call (Soroban rolls back all state if burn fails)
            let key = DataKey::TokenShouts(token.clone());
            let existing: Vec<ShoutRecord> =
                e.storage().persistent().get(&key).unwrap_or(Vec::new(e));
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
            if amount >= king_shout_min_burn {
                let king_key = DataKey::KingShout(token.clone());
                let prev_record = e
                    .storage()
                    .persistent()
                    .get::<DataKey, ShoutRecord>(&king_key);
                let effective_prev = prev_record
                    .as_ref()
                    .map(|r| {
                        let elapsed_days =
                            now.saturating_sub(r.timestamp) / KING_SHOUT_DECAY_SECONDS;
                        let shift = elapsed_days.min(20) as u32;
                        let decayed = r.amount >> shift;
                        if decayed < king_shout_min_burn {
                            king_shout_min_burn
                        } else {
                            decayed
                        }
                    })
                    .unwrap_or(0);
                let prev_elapsed = prev_record
                    .as_ref()
                    .map(|r| now.saturating_sub(r.timestamp))
                    .unwrap_or(0);
                if effective_prev == 0
                    || amount > effective_prev
                    || (amount >= king_shout_min_burn
                        && effective_prev == king_shout_min_burn
                        && prev_elapsed >= KING_SHOUT_DECAY_SECONDS)
                {
                    e.storage().persistent().set(&king_key, &entry);
                    Self::bump_persistent(e, &king_key);
                    is_king = true;
                }
            }

            if e.storage().persistent().has(&DataKey::Curve(token.clone())) {
                Self::update_pilot(e, &sender, |p| {
                    p.shouts = p.shouts.saturating_add(1);
                    p.burns_triggered = p.burns_triggered.saturating_add(1);
                    if is_king {
                        p.king_shouts = p.king_shouts.saturating_add(1);
                    }
                });
            }
            Self::bump_launch_record_ttl(e, &token);

            // Interaction
            token::Client::new(e, &token).burn(&sender, &amount);

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
        })
    }

    /// Returns newest-first launches paired with their CurveState in one RPC call.
    pub fn get_market_page(e: &Env, offset: u32, limit: u32) -> Vec<MarketCardRecord> {
        let launches = Self::get_launches(e, offset, limit);
        let mut out = Vec::new(e);
        for record in launches.iter() {
            let mut curve = Vec::new(e);
            if let Some(state) = Self::get_curve(e, record.token.clone()) {
                curve.push_back(state);
            }
            out.push_back(MarketCardRecord { record, curve });
        }
        out
    }

    /// Returns newest-first launches from the persistent on-chain registry (pure read).
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
                out.push_back(record);
            }
        }
        out
    }

    /// Looks up a launch record by token contract address (pure read).
    pub fn get_launch(e: &Env, token: Address) -> Option<LaunchRecord> {
        let idx_key = DataKey::TokenIndex(token);
        let idx: u32 = e.storage().persistent().get(&idx_key)?;
        let rec_key = DataKey::LaunchByIndex(idx);
        e.storage().persistent().get(&rec_key)
    }

    /// Looks up the live bonding curve / graduation / burn-vault state for a token (pure read).
    pub fn get_curve(e: &Env, token: Address) -> Option<CurveState> {
        let key = DataKey::Curve(token);
        e.storage().persistent().get::<DataKey, CurveState>(&key)
    }

    /// Returns total number of tokens launched and indexed through this launchpad.
    pub fn get_launch_count(e: &Env) -> u32 {
        e.storage()
            .instance()
            .get(&DataKey::LaunchCount)
            .unwrap_or(0)
    }

    /// Returns recent on-chain Burn-to-Chat shouts for a token (oldest to newest, max 15; pure read).
    pub fn get_shouts(e: &Env, token: Address) -> Vec<ShoutRecord> {
        let key = DataKey::TokenShouts(token);
        e.storage().persistent().get(&key).unwrap_or(Vec::new(e))
    }

    /// Returns the pinned King Shout (highest decayed `burn_shout >= 5,000` whole tokens), if any (pure read).
    pub fn get_king_shout(e: &Env, token: Address) -> Option<ShoutRecord> {
        let key = DataKey::KingShout(token);
        e.storage().persistent().get::<DataKey, ShoutRecord>(&key)
    }

    /// Returns pre-graduation Spark/Crown checkpoint tokens escrowed for `recipient` (pure read).
    pub fn get_checkpoint_reward(e: &Env, token: Address, recipient: Address) -> i128 {
        let key = DataKey::CheckpointReward(token, recipient);
        e.storage().persistent().get(&key).unwrap_or(0)
    }

    /// Permissionlessly refreshes the launchpad instance TTL for 90 days.
    pub fn extend_ttl(e: &Env) {
        e.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_BUMP_AMOUNT);
    }

    /// Permissionlessly refreshes TTL for a token's registry, curve, shouts, King Shout,
    /// buyback cooldown entry, and persistent balances (token + Soroswap pair LP shares).
    pub fn extend_launch_ttl(e: &Env, token: Address) {
        Self::extend_ttl(e);
        Self::bump_launch_record_ttl(e, &token);

        let this = e.current_contract_address();
        let tok_client = token::Client::new(e, &token);
        let _ = tok_client.balance(&this);

        let curve_key = DataKey::Curve(token.clone());
        if let Some(curve) = e
            .storage()
            .persistent()
            .get::<DataKey, CurveState>(&curve_key)
        {
            Self::bump_persistent(e, &curve_key);
            if let Some(pair_addr) = curve.pair {
                let _ = tok_client.balance(&pair_addr);
                let _ = token::Client::new(e, &pair_addr).balance(&this);
            }
        }
        let shout_key = DataKey::TokenShouts(token.clone());
        if e.storage().persistent().has(&shout_key) {
            Self::bump_persistent(e, &shout_key);
        }
        let king_key = DataKey::KingShout(token.clone());
        if e.storage().persistent().has(&king_key) {
            Self::bump_persistent(e, &king_key);
        }
        let buyback_key = DataKey::BuybackLastTs(token);
        if e.storage().persistent().has(&buyback_key) {
            Self::bump_persistent(e, &buyback_key);
        }
    }

    /// Permissionlessly refreshes TTL for an escrowed checkpoint reward entry.
    pub fn extend_checkpoint_ttl(e: &Env, token: Address, recipient: Address) {
        Self::extend_ttl(e);
        let key = DataKey::CheckpointReward(token, recipient);
        if e.storage().persistent().has(&key) {
            Self::bump_persistent(e, &key);
        }
    }

    /// Permissionlessly refreshes TTL for a pilot telemetry record.
    pub fn extend_pilot_ttl(e: &Env, user: Address) {
        Self::extend_ttl(e);
        let key = DataKey::Pilot(user);
        if e.storage().persistent().has(&key) {
            Self::bump_persistent(e, &key);
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

    pub fn get_admin(e: &Env) -> Option<Address> {
        e.storage().instance().get(&DataKey::Admin)
    }

    pub fn is_paused(e: &Env) -> bool {
        e.storage()
            .instance()
            .get(&DataKey::LaunchesPaused)
            .unwrap_or(false)
    }

    pub fn get_creation_fee(e: &Env) -> i128 {
        e.storage()
            .instance()
            .get(&DataKey::CreationFee)
            .unwrap_or(CREATION_FEE_STROOPS)
    }

    /// Returns cumulative on-chain telemetry for a pilot wallet (pure read).
    pub fn get_pilot(e: &Env, user: Address) -> PilotRecord {
        let key = DataKey::Pilot(user);
        e.storage()
            .persistent()
            .get::<DataKey, PilotRecord>(&key)
            .unwrap_or(PilotRecord {
                launches: 0,
                graduations: 0,
                trades: 0,
                volume_xlm_stroops: 0,
                shouts: 0,
                king_shouts: 0,
                burns_triggered: 0,
            })
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
            let pair_client = SoroswapPairClient::new(e, &existing);
            let (r0, r1) = pair_client.get_reserves();
            // Reject only if LP shares already exist or both sides have non-zero reserves;
            // prevents 1-stroop XLM + `pair.sync()` griefing while token transfers are locked.
            if pair_client.total_supply() > 0 || (r0 > 0 && r1 > 0) {
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
        min_tokens_burned: i128,
    ) -> Result<i128, LaunchpadError> {
        let total_reserve = curve.buyback_xlm_reserve;
        if total_reserve <= 0 {
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

        let now = e.ledger().timestamp();
        let cooldown_key = DataKey::BuybackLastTs(token_addr.clone());
        if let Some(last_ts) = e.storage().persistent().get::<DataKey, u64>(&cooldown_key) {
            if now < last_ts.saturating_add(BUYBACK_COOLDOWN_SECONDS) {
                return Err(LaunchpadError::MilestoneNotReached);
            }
        }

        // Anti-MEV chunking: cap each swap to <= 0.50% of pool XLM reserve (when pool >= 200 XLM)
        // and <= 250 XLM absolute ceiling so round-trip Soroswap fees make sandwiching unprofitable.
        let max_chunk = reserve_xlm
            .checked_mul(BUYBACK_MAX_CHUNK_BPS)
            .ok_or(LaunchpadError::InvalidAmount)?
            / BPS_DENOMINATOR;
        let xlm_in = if max_chunk >= STROOPS_PER_UNIT && total_reserve > max_chunk {
            max_chunk
        } else {
            total_reserve
        }
        .min(BUYBACK_MAX_ABSOLUTE_CHUNK_XLM);

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
        if tokens_out < min_tokens_burned {
            return Err(LaunchpadError::SlippageExceeded);
        }

        curve.buyback_xlm_reserve = total_reserve
            .checked_sub(xlm_in)
            .ok_or(LaunchpadError::InvalidAmount)?;
        e.storage().persistent().set(curve_key, curve);
        Self::bump_persistent(e, curve_key);
        if curve.buyback_xlm_reserve > 0 {
            e.storage().persistent().set(&cooldown_key, &now);
            Self::bump_persistent(e, &cooldown_key);
        } else if e.storage().persistent().has(&cooldown_key) {
            e.storage().persistent().remove(&cooldown_key);
        }

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

        // Effects: persist updated curve reserves (and mark graduated before graduation calls)
        curve.curve_xlm_net = curve
            .curve_xlm_net
            .checked_add(quote.net_xlm_to_curve)
            .ok_or(LaunchpadError::InvalidAmount)?;
        let vault_inflow = quote
            .net_xlm_to_curve
            .checked_add(quote.floor_bonus)
            .ok_or(LaunchpadError::InvalidAmount)?;
        curve.real_xlm_vault = curve
            .real_xlm_vault
            .checked_add(vault_inflow)
            .ok_or(LaunchpadError::InvalidAmount)?;
        curve.tokens_sold = curve
            .tokens_sold
            .checked_add(quote.tokens_out)
            .ok_or(LaunchpadError::InvalidAmount)?;

        // One-time 3-Checkpoint Jackpot Ladder (+5K Spark at 250 XLM, +10K Crown at 500 XLM,
        // +25K Graduation Jackpot at 1,000 XLM), guarded by `burn_milestone_stage`.
        // Pre-graduation checkpoints escrow in storage until graduation so they cannot be
        // dumped into `sell_curve` to drain bonding curve XLM reserves.
        let mut checkpoint_bonus: i128 = 0;
        if curve.burn_vault_remaining == 0 {
            if curve.curve_xlm_net >= STAGE_1_XLM && curve.burn_milestone_stage < 1 {
                curve.burn_milestone_stage = 1;
                checkpoint_bonus = checkpoint_bonus
                    .checked_add(SPARK_JACKPOT_ALLOC)
                    .ok_or(LaunchpadError::InvalidAmount)?;
            }
            if curve.curve_xlm_net >= STAGE_2_XLM && curve.burn_milestone_stage < 2 {
                curve.burn_milestone_stage = 2;
                checkpoint_bonus = checkpoint_bonus
                    .checked_add(CROWN_JACKPOT_ALLOC)
                    .ok_or(LaunchpadError::InvalidAmount)?;
            }
            if quote.will_graduate {
                curve.burn_milestone_stage = 2;
                checkpoint_bonus = checkpoint_bonus
                    .checked_add(GRADUATION_JACKPOT_ALLOC)
                    .ok_or(LaunchpadError::InvalidAmount)?;
            }
        }

        if lock_creator_seed {
            curve.creator_seed_locked = curve
                .creator_seed_locked
                .checked_add(quote.tokens_out)
                .ok_or(LaunchpadError::InvalidAmount)?;
        }
        let pre_grad_vault = curve.real_xlm_vault;
        if quote.will_graduate {
            curve.graduated = true;
            curve.graduated_at = e.ledger().timestamp();
            curve.real_xlm_vault = 0;
        }
        e.storage().persistent().set(&curve_key, &curve);
        Self::bump_persistent(e, &curve_key);

        if !quote.will_graduate && checkpoint_bonus > 0 {
            let ck_key = DataKey::CheckpointReward(token_addr.clone(), buyer.clone());
            let prev_ck: i128 = e.storage().persistent().get(&ck_key).unwrap_or(0);
            let next_ck = prev_ck
                .checked_add(checkpoint_bonus)
                .ok_or(LaunchpadError::InvalidAmount)?;
            e.storage().persistent().set(&ck_key, &next_ck);
            Self::bump_persistent(e, &ck_key);
            CheckpointRewardEscrowedEvent {
                token: token_addr.clone(),
                winner: buyer.clone(),
                reward: checkpoint_bonus,
            }
            .publish(e);
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

            let surplus_bonus = pre_grad_vault.saturating_sub(CURVE_REAL_XLM_GOAL);
            let buyback_reserve = (surplus_bonus * BUYBACK_RESERVE_SHARE_BPS) / BPS_DENOMINATOR;
            let xlm_to_dex = pre_grad_vault - buyback_reserve;

            // Deposit DEX liquidity with LP shares locked inside the Launchpad contract for 7 years.
            let (pair_addr, lp_minted) = Self::seed_soroswap_and_burn_lp(
                e,
                &this,
                token_addr,
                &xlm_sac,
                &this,
                DEX_TOKENS_ALLOC,
                xlm_to_dex,
            )?;

            // Reward the final graduating buyer with Graduation Jackpot (+ any unclaimed checkpoints).
            if checkpoint_bonus > 0 {
                tok_client.transfer(&this, buyer, &checkpoint_bonus);
            }

            // Release the 0.30% Developer / Protocol Ecosystem allocation directly to treasury on graduation.
            if DEV_ECOSYSTEM_ALLOC > 0 {
                tok_client.transfer(&this, &treasury, &DEV_ECOSYSTEM_ALLOC);
            }

            let vault_burn = if BURN_VAULT_TOKENS_ALLOC > 0 {
                curve.burn_vault_remaining / 2
            } else {
                0
            };
            if vault_burn > 0 {
                tok_client.burn(&this, &vault_burn);
            }

            curve.pair = Some(pair_addr.clone());
            curve.lp_minted = lp_minted;
            curve.buyback_xlm_reserve = buyback_reserve;
            curve.burn_vault_remaining -= vault_burn;
            curve.burn_milestone_stage = if curve.burn_vault_remaining > 0 { 1 } else { 2 };

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

            if vault_burn > 0 {
                let total_supply_after = SupplyTokenClient::new(e, token_addr).total_supply();
                MilestoneBurnEvent {
                    token: token_addr.clone(),
                    stage: 1,
                    burned_amount: vault_burn,
                    total_supply_after,
                }
                .publish(e);
            }

            Self::update_pilot(e, buyer, |p| {
                p.trades = p.trades.saturating_add(1);
                p.volume_xlm_stroops = p.volume_xlm_stroops.saturating_add(quote.total_xlm_charged);
                p.graduations = p.graduations.saturating_add(1);
            });
            if curve.creator != *buyer {
                Self::update_pilot(e, &curve.creator, |p| {
                    p.graduations = p.graduations.saturating_add(1);
                });
            }

            return Ok(TradeResult {
                tokens: quote.tokens_out,
                xlm: quote.total_xlm_charged,
                treasury_fee: quote.treasury_fee,
                floor_bonus: quote.floor_bonus,
                graduated: true,
                pair: Some(pair_addr),
            });
        }

        Self::update_pilot(e, buyer, |p| {
            p.trades = p.trades.saturating_add(1);
            p.volume_xlm_stroops = p.volume_xlm_stroops.saturating_add(quote.total_xlm_charged);
        });
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

    /// 3-Stage Softened Buy Fee: 0.30% (<250 XLM), 0.50% (250..500 XLM), 0.25% (500..1,000 XLM sprint).
    fn fee_bps_buy(curve_xlm_net: i128) -> (i128, i128, i128) {
        if curve_xlm_net < STAGE_1_XLM {
            (
                BUY_TREASURY_EARLY_BPS,
                BUY_FLOOR_EARLY_BPS,
                BUY_TREASURY_EARLY_BPS + BUY_FLOOR_EARLY_BPS,
            )
        } else if curve_xlm_net < STAGE_2_XLM {
            (
                BUY_TREASURY_MID_BPS,
                BUY_FLOOR_MID_BPS,
                BUY_TREASURY_MID_BPS + BUY_FLOOR_MID_BPS,
            )
        } else {
            (
                BUY_TREASURY_SPRINT_BPS,
                BUY_FLOOR_SPRINT_BPS,
                BUY_TREASURY_SPRINT_BPS + BUY_FLOOR_SPRINT_BPS,
            )
        }
    }

    /// 3-Stage Softened Sell Fee: 1.20% (<250 XLM), 1.80% (250..500 XLM), 1.50% (>=500 XLM).
    fn fee_bps_sell(curve_xlm_net: i128) -> (i128, i128, i128) {
        if curve_xlm_net < STAGE_1_XLM {
            (
                SELL_TREASURY_EARLY_BPS,
                SELL_FLOOR_EARLY_BPS,
                SELL_TREASURY_EARLY_BPS + SELL_FLOOR_EARLY_BPS,
            )
        } else if curve_xlm_net < STAGE_2_XLM {
            (
                SELL_TREASURY_MID_BPS,
                SELL_FLOOR_MID_BPS,
                SELL_TREASURY_MID_BPS + SELL_FLOOR_MID_BPS,
            )
        } else {
            (
                SELL_TREASURY_SPRINT_BPS,
                SELL_FLOOR_SPRINT_BPS,
                SELL_TREASURY_SPRINT_BPS + SELL_FLOOR_SPRINT_BPS,
            )
        }
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
        let v_xlm = CURVE_VIRTUAL_XLM_START
            .checked_add(curve.curve_xlm_net)
            .ok_or(LaunchpadError::InvalidAmount)?;
        let v_tok = CURVE_VIRTUAL_TOKEN_START
            .checked_sub(curve.tokens_sold)
            .ok_or(LaunchpadError::InvalidAmount)?;
        let remaining_to_goal = CURVE_REAL_XLM_GOAL
            .checked_sub(curve.curve_xlm_net)
            .ok_or(LaunchpadError::InvalidAmount)?;
        let remaining_tokens = CURVE_TOKENS_ALLOC
            .checked_sub(curve.tokens_sold)
            .ok_or(LaunchpadError::InvalidAmount)?;
        if v_xlm <= 0 || v_tok <= 0 || remaining_to_goal <= 0 || remaining_tokens <= 0 {
            return Err(LaunchpadError::InvalidCurveState);
        }

        let (t_bps, f_bps, total_bps) = Self::fee_bps_buy(curve.curve_xlm_net);
        let (treasury_fee_full, floor_bonus_full) = Self::split_fee(max_xlm_in, t_bps, f_bps)?;
        let net_full = max_xlm_in
            .checked_sub(treasury_fee_full)
            .and_then(|v| v.checked_sub(floor_bonus_full))
            .ok_or(LaunchpadError::InvalidAmount)?;

        if net_full >= remaining_to_goal {
            // Graduation reached: cap XLM charged strictly to remaining goal + proportional stage fee
            let net_xlm_to_curve = remaining_to_goal;
            let (ct_bps, cf_bps, ctotal_bps) = Self::fee_bps_buy(curve.curve_xlm_net);
            let max_fee_room = max_xlm_in
                .checked_sub(net_xlm_to_curve)
                .ok_or(LaunchpadError::InvalidAmount)?;
            let denom = BPS_DENOMINATOR
                .checked_sub(ctotal_bps)
                .ok_or(LaunchpadError::InvalidAmount)? as u128;
            let ideal_gross = ((net_xlm_to_curve as u128)
                .checked_mul(BPS_DENOMINATOR as u128)
                .ok_or(LaunchpadError::InvalidAmount)?
                .checked_add(denom - 1)
                .ok_or(LaunchpadError::InvalidAmount)?
                / denom) as i128;
            let ideal_fee = ideal_gross
                .checked_sub(net_xlm_to_curve)
                .ok_or(LaunchpadError::InvalidAmount)?
                .min(max_fee_room);
            let total_xlm_charged = net_xlm_to_curve
                .checked_add(ideal_fee)
                .ok_or(LaunchpadError::InvalidAmount)?;
            let treasury_fee = ((ideal_fee as u128)
                .checked_mul(ct_bps as u128)
                .ok_or(LaunchpadError::InvalidAmount)?
                / ((ct_bps + cf_bps) as u128)) as i128;
            let floor_bonus = ideal_fee
                .checked_sub(treasury_fee)
                .ok_or(LaunchpadError::InvalidAmount)?;

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
        let new_v_xlm = (v_xlm as u128)
            .checked_add(net_full as u128)
            .ok_or(LaunchpadError::InvalidAmount)?;
        // Round new_v_tok UP so curve invariant strictly holds (>= k_cur)
        let new_v_tok = k_cur.div_ceil(new_v_xlm);
        let tokens_out = i128::try_from(
            (v_tok as u128)
                .checked_sub(new_v_tok)
                .ok_or(LaunchpadError::InvalidAmount)?,
        )
        .map_err(|_| LaunchpadError::InvalidAmount)?;
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
        let v_xlm = CURVE_VIRTUAL_XLM_START
            .checked_add(curve.curve_xlm_net)
            .ok_or(LaunchpadError::InvalidAmount)?;
        let v_tok = CURVE_VIRTUAL_TOKEN_START
            .checked_sub(curve.tokens_sold)
            .ok_or(LaunchpadError::InvalidAmount)?;
        if v_xlm <= 0 || v_tok <= 0 {
            return Err(LaunchpadError::InvalidCurveState);
        }

        let k_cur = (v_xlm as u128)
            .checked_mul(v_tok as u128)
            .ok_or(LaunchpadError::InvalidAmount)?;
        let new_v_tok = (v_tok as u128)
            .checked_add(token_amount as u128)
            .ok_or(LaunchpadError::InvalidAmount)?;
        // Round new_v_xlm UP so gross_xlm_out rounds DOWN (never overpays curve)
        let mut new_v_xlm =
            i128::try_from(k_cur.div_ceil(new_v_tok)).map_err(|_| LaunchpadError::InvalidAmount)?;
        if new_v_xlm < CURVE_VIRTUAL_XLM_START {
            new_v_xlm = CURVE_VIRTUAL_XLM_START;
        }

        let gross_xlm_out = v_xlm
            .checked_sub(new_v_xlm)
            .ok_or(LaunchpadError::InvalidAmount)?;
        if gross_xlm_out <= 0 || gross_xlm_out > curve.curve_xlm_net {
            return Err(LaunchpadError::InvalidAmount);
        }

        let (t_bps, f_bps, total_bps) = Self::fee_bps_sell(curve.curve_xlm_net);
        let (treasury_fee, floor_bonus) = Self::split_fee(gross_xlm_out, t_bps, f_bps)?;
        let net_xlm_out = gross_xlm_out
            .checked_sub(treasury_fee)
            .and_then(|v| v.checked_sub(floor_bonus))
            .ok_or(LaunchpadError::InvalidAmount)?;
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

    fn require_admin_auth(e: &Env) -> Result<Address, LaunchpadError> {
        let admin: Address = e
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(LaunchpadError::NotInitialized)?;
        admin.require_auth();
        Ok(admin)
    }

    fn require_not_paused(e: &Env) -> Result<(), LaunchpadError> {
        let paused: bool = e
            .storage()
            .instance()
            .get(&DataKey::LaunchesPaused)
            .unwrap_or(false);
        if paused {
            return Err(LaunchpadError::LaunchesPaused);
        }
        Ok(())
    }

    fn with_reentrancy_guard<T, F: FnOnce() -> Result<T, LaunchpadError>>(
        e: &Env,
        f: F,
    ) -> Result<T, LaunchpadError> {
        Self::acquire_reentrancy_lock(e)?;
        let res = f();
        Self::release_reentrancy_lock(e);
        res
    }

    fn zero_external_supply(e: &Env, this: &Address, token: &Address) -> bool {
        SupplyTokenClient::new(e, token).total_supply()
            == token::Client::new(e, token).balance(this)
    }

    fn acquire_reentrancy_lock(e: &Env) -> Result<(), LaunchpadError> {
        if e.storage().temporary().has(&DataKey::ReentrancyLock) {
            return Err(LaunchpadError::InvalidCurveState);
        }
        e.storage().temporary().set(&DataKey::ReentrancyLock, &true);
        Ok(())
    }

    fn release_reentrancy_lock(e: &Env) {
        e.storage().temporary().remove(&DataKey::ReentrancyLock);
    }

    fn bump_persistent(e: &Env, key: &DataKey) {
        e.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_BUMP_AMOUNT);
    }

    fn update_pilot<F: FnOnce(&mut PilotRecord)>(e: &Env, user: &Address, f: F) {
        let key = DataKey::Pilot(user.clone());
        let mut rec = e
            .storage()
            .persistent()
            .get::<DataKey, PilotRecord>(&key)
            .unwrap_or(PilotRecord {
                launches: 0,
                graduations: 0,
                trades: 0,
                volume_xlm_stroops: 0,
                shouts: 0,
                king_shouts: 0,
                burns_triggered: 0,
            });
        f(&mut rec);
        e.storage().persistent().set(&key, &rec);
        Self::bump_persistent(e, &key);
    }
}
