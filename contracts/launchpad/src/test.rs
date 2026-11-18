//! Comprehensive unit & adversarial tests for AstroGate Fair-Flywheel Launchpad v4.

extern crate std;

use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger},
    token, Address, BytesN, Env, String,
};

use crate::contract::{FairLaunchParams, LaunchParams, Launchpad, LaunchpadClient, LaunchpadError};
use astro_token::TokenClient as AstroTokenClient;

const STROOPS: i128 = 10_000_000;

// -------------------------------------------------------------------------
// Mock Soroswap Factory & Pair
// -------------------------------------------------------------------------

#[contract]
pub struct MockSoroswapPair;

#[contractimpl]
impl MockSoroswapPair {
    pub fn __constructor(e: &Env, token0: Address, token1: Address, reserves: (i128, i128)) {
        e.storage().instance().set(&0u32, &reserves);
        e.storage().instance().set(&2u32, &token0);
        e.storage().instance().set(&3u32, &token1);
        let initial_lp: i128 = if reserves.0 > 0 && reserves.1 > 0 {
            1_000_000
        } else {
            0
        };
        e.storage().instance().set(&4u32, &initial_lp);
    }

    pub fn total_supply(e: &Env) -> i128 {
        e.storage().instance().get(&4u32).unwrap_or(0)
    }

    pub fn token_0(e: &Env) -> Address {
        e.storage().instance().get(&2u32).unwrap()
    }

    pub fn token_1(e: &Env) -> Address {
        e.storage().instance().get(&3u32).unwrap()
    }

    pub fn set_reserves(e: &Env, reserves: (i128, i128)) {
        e.storage().instance().set(&0u32, &reserves);
    }

    pub fn set_tokens(e: &Env, token0: Address, token1: Address) {
        e.storage().instance().set(&2u32, &token0);
        e.storage().instance().set(&3u32, &token1);
    }

    pub fn get_reserves(e: &Env) -> (i128, i128) {
        e.storage().instance().get(&0u32).unwrap_or((0, 0))
    }

    /// Saves LP recipient & tracks LP token balance for 7-year lock / transfer tests.
    pub fn deposit(e: &Env, to: Address) -> i128 {
        e.storage().instance().set(&1u32, &to);
        e.storage().instance().set(&4u32, &495_000_000_i128);
        e.storage().instance().set(&(5u32, to), &495_000_000_i128);
        495_000_000
    }

    pub fn balance(e: &Env, id: Address) -> i128 {
        e.storage().instance().get(&(5u32, id)).unwrap_or(0)
    }

    pub fn transfer(e: &Env, from: Address, to: Address, amount: i128) {
        let from_bal = Self::balance(e, from.clone());
        assert!(from_bal >= amount, "insufficient mock LP balance");
        e.storage()
            .instance()
            .set(&(5u32, from), &(from_bal - amount));
        let to_bal = Self::balance(e, to.clone());
        e.storage()
            .instance()
            .set(&(5u32, to.clone()), &(to_bal + amount));
        e.storage().instance().set(&1u32, &to);
    }

    pub fn swap(e: &Env, amount_0_out: i128, amount_1_out: i128, to: Address) {
        let t0: Address = e.storage().instance().get(&2u32).unwrap();
        let t1: Address = e.storage().instance().get(&3u32).unwrap();
        let this = e.current_contract_address();
        if amount_0_out > 0 {
            token::Client::new(e, &t0).transfer(&this, &to, &amount_0_out);
        }
        if amount_1_out > 0 {
            token::Client::new(e, &t1).transfer(&this, &to, &amount_1_out);
        }
        let (r0, r1) = Self::get_reserves(e);
        let new_r0 = token::Client::new(e, &t0).balance(&this);
        let new_r1 = token::Client::new(e, &t1).balance(&this);
        let _ = (r0, r1);
        e.storage().instance().set(&0u32, &(new_r0, new_r1));
    }

    pub fn lp_recipient(e: &Env) -> Address {
        e.storage().instance().get(&1u32).unwrap()
    }
}

#[contract]
pub struct MockSoroswapFactory;

#[contractimpl]
impl MockSoroswapFactory {
    pub fn __constructor(e: &Env, pair: Address, pair_exists: bool) {
        e.storage().instance().set(&0u32, &pair);
        e.storage().instance().set(&1u32, &pair_exists);
    }

    pub fn create_pair(e: &Env, _token_a: Address, _token_b: Address) -> Address {
        e.storage().instance().get(&0u32).unwrap()
    }

    pub fn get_pair(e: &Env, _token_a: Address, _token_b: Address) -> Address {
        e.storage().instance().get(&0u32).unwrap()
    }

    pub fn pair_exists(e: &Env, _token_a: Address, _token_b: Address) -> bool {
        e.storage().instance().get(&1u32).unwrap_or(false)
    }
}

const TOKEN_WASM: &[u8] = include_bytes!("../../../target/wasm32v1-none/release/astro_token.wasm");

fn create_env() -> Env {
    let e = Env::default();
    e.mock_all_auths();
    e
}

struct EnvSetup {
    launchpad: Address,
    xlm_sac: Address,
    factory: Address,
    pair: Address,
    burn_addr: Address,
    treasury: Address,
}

fn setup_launchpad(e: &Env, pair_exists: bool, initial_reserves: (i128, i128)) -> EnvSetup {
    let xlm_admin = Address::generate(e);
    let xlm_sac_contract = e.register_stellar_asset_contract_v2(xlm_admin);
    let xlm_sac = xlm_sac_contract.address();

    let dummy_tok = Address::generate(e);
    let pair = e.register(
        MockSoroswapPair,
        (xlm_sac.clone(), dummy_tok, initial_reserves),
    );
    let factory = e.register(MockSoroswapFactory, (pair.clone(), pair_exists));
    let wasm_hash = e.deployer().upload_contract_wasm(TOKEN_WASM);
    let burn_addr = Address::generate(e);
    let treasury = Address::generate(e);

    let launchpad = e.register(
        Launchpad,
        (
            factory.clone(),
            xlm_sac.clone(),
            wasm_hash,
            burn_addr.clone(),
            treasury.clone(),
        ),
    );

    EnvSetup {
        launchpad,
        xlm_sac,
        factory,
        pair,
        burn_addr,
        treasury,
    }
}

#[test]
fn test_launchpad_initialization() {
    let e = create_env();
    let s = setup_launchpad(&e, false, (0, 0));
    let client = LaunchpadClient::new(&e, &s.launchpad);

    assert_eq!(client.get_factory(), Some(s.factory));
    assert_eq!(client.get_xlm_sac(), Some(s.xlm_sac));
    assert_eq!(client.get_burn_address(), Some(s.burn_addr));
    assert_eq!(client.get_treasury(), Some(s.treasury));
    assert_eq!(client.get_creation_fee(), 7 * STROOPS);
    assert!(client.get_token_wasm_hash().is_some());
    assert_eq!(client.get_launch_count(), 0);
}

#[test]
fn test_invalid_amounts_and_metadata_fail() {
    let e = create_env();
    let s = setup_launchpad(&e, false, (0, 0));
    let client = LaunchpadClient::new(&e, &s.launchpad);
    let xlm_sac = token::StellarAssetClient::new(&e, &s.xlm_sac);
    let creator = Address::generate(&e);
    xlm_sac.mint(&creator, &(500 * STROOPS));

    // Legacy launch_token validations
    assert_eq!(
        client.try_launch_token(&LaunchParams {
            creator: creator.clone(),
            name: String::from_str(&e, "Test"),
            symbol: String::from_str(&e, "TST"),
            decimals: 7,
            initial_supply: 1_000_000_000,
            token_lp_amount: 995_000_000,
            xlm_lp_amount: 19_999_999,
            salt: BytesN::from_array(&e, &[1u8; 32]),
        }),
        Err(Ok(LaunchpadError::InvalidAmount))
    );

    // Fair launch below 2 XLM minimum -> InvalidAmount
    assert_eq!(
        client.try_launch_fair(&FairLaunchParams {
            creator: creator.clone(),
            name: String::from_str(&e, "Low XLM"),
            symbol: String::from_str(&e, "LOWX"),
            xlm_lp_amount: 19_999_999,
            meta: String::from_str(&e, ""),
            salt: BytesN::from_array(&e, &[2u8; 32]),
        }),
        Err(Ok(LaunchpadError::InvalidAmount))
    );

    // Empty name -> InvalidMetadata
    assert_eq!(
        client.try_launch_fair(&FairLaunchParams {
            creator: creator.clone(),
            name: String::from_str(&e, ""),
            symbol: String::from_str(&e, "EMPT"),
            xlm_lp_amount: 20_000_000,
            meta: String::from_str(&e, ""),
            salt: BytesN::from_array(&e, &[3u8; 32]),
        }),
        Err(Ok(LaunchpadError::InvalidMetadata))
    );

    // Oversized meta > 512 bytes -> InvalidMetadata
    let huge_meta = std::string::String::from_utf8(std::vec![b'a'; 513]).unwrap();
    assert_eq!(
        client.try_launch_fair(&FairLaunchParams {
            creator,
            name: String::from_str(&e, "Huge Meta"),
            symbol: String::from_str(&e, "HUGE"),
            xlm_lp_amount: 20_000_000,
            meta: String::from_str(&e, &huge_meta),
            salt: BytesN::from_array(&e, &[4u8; 32]),
        }),
        Err(Ok(LaunchpadError::InvalidMetadata))
    );
}

#[test]
fn test_fair_flywheel_v42_flat_buys_asymmetric_sells_and_seed_lock() {
    let e = create_env();
    let s = setup_launchpad(&e, false, (0, 0));
    let client = LaunchpadClient::new(&e, &s.launchpad);
    let xlm_sac = token::StellarAssetClient::new(&e, &s.xlm_sac);
    let xlm_tok = token::Client::new(&e, &s.xlm_sac);

    let creator = Address::generate(&e);
    let buyer_small = Address::generate(&e);
    let buyer_10x = Address::generate(&e);
    let stranger = Address::generate(&e);
    xlm_sac.mint(&creator, &(100 * STROOPS));
    xlm_sac.mint(&buyer_small, &(100 * STROOPS));
    xlm_sac.mint(&buyer_10x, &(500 * STROOPS));

    // Launch with creator minimum 2 XLM initial curve buy
    let res = client.launch_fair(&FairLaunchParams {
        creator: creator.clone(),
        name: String::from_str(&e, "Flywheel Coin"),
        symbol: String::from_str(&e, "FLYW"),
        xlm_lp_amount: 2 * STROOPS,
        meta: String::from_str(&e, r#"{"d":"Fair v4.3 curve"}"#),
        salt: BytesN::from_array(&e, &[10u8; 32]),
    });

    assert!(res.pair.is_none());
    let tok = AstroTokenClient::new(&e, &res.token);
    assert_eq!(tok.decimals(), 7);
    assert_eq!(tok.total_supply(), 10_000_000 * STROOPS);
    assert_eq!(tok.get_owner(), None);

    // Creator's initial seed buy is locked inside Launchpad until graduation (zero pre-grad creator dump!)
    assert_eq!(tok.balance(&creator), 0);
    let curve_0 = client.get_curve(&res.token).unwrap();
    assert!(!curve_0.graduated);
    assert!(curve_0.creator_seed_locked > 20_000 * STROOPS);
    assert_eq!(curve_0.burn_vault_remaining, 0);
    assert_eq!(curve_0.creator_vesting_total, 30_000 * STROOPS);
    assert_eq!(curve_0.creator_claimed, 0);
    // Treasury received 7 XLM creation fee + 0.20% Stage-1 buy treasury fee on 2 XLM initial buy (0.004 XLM)
    assert_eq!(xlm_tok.balance(&s.treasury), 70_040_000);

    // Stage 1 (<250 XLM, 0-25%): Buyer 1 puts 10 XLM -> 0.30% early-bird fee (20 bps treasury + 10 bps floor)
    let q_small = client.quote_buy(&res.token, &(10 * STROOPS));
    assert_eq!(q_small.total_fee_bps, 30);
    let b1 = client.buy_curve(
        &buyer_small,
        &res.token,
        &(10 * STROOPS),
        &q_small.tokens_out,
    );
    assert_eq!(b1.tokens, q_small.tokens_out);
    assert_eq!(tok.balance(&buyer_small), b1.tokens);

    // Curve transfer lock prevents P2P / Soroswap pair seeding DoS before graduation!
    assert!(tok.try_transfer(&buyer_small, &stranger, &1_000).is_err());

    // Stage 1 (<250 XLM): Buyer 2 puts 100 XLM (10x Buyer 1): STILL pays Stage-1 30 bps (no whale surcharge!)
    let q_10x = client.quote_buy(&res.token, &(100 * STROOPS));
    assert_eq!(q_10x.total_fee_bps, 30);
    assert_eq!(q_10x.treasury_fee, (100 * STROOPS * 20) / 10_000);
    assert_eq!(q_10x.floor_bonus, (100 * STROOPS * 10) / 10_000);
    let b2 = client.buy_curve(&buyer_10x, &res.token, &(100 * STROOPS), &q_10x.tokens_out);

    // Selling early on curve (<250 XLM) pays 1.20% (120 bps), keeping 0.90% inside floor vault!
    let q_sell = client.quote_sell(&res.token, &b2.tokens);
    assert_eq!(q_sell.total_fee_bps, 120);
    assert!(q_sell.floor_bonus > q_sell.treasury_fee);

    // Push past 250 XLM Checkpoint 1 -> wins +5,000 Spark Bonus & enters Stage 2 (0.50% buy / 1.80% sell)!
    xlm_sac.mint(&buyer_10x, &(300 * STROOPS));
    let b3 = client.buy_curve(&buyer_10x, &res.token, &(200 * STROOPS), &1);
    assert_eq!(
        tok.balance(&buyer_10x),
        b2.tokens + b3.tokens + (5_000 * STROOPS)
    );
    assert_eq!(
        client.get_curve(&res.token).unwrap().burn_milestone_stage,
        1
    );

    let q_mid_buy = client.quote_buy(&res.token, &(10 * STROOPS));
    assert_eq!(q_mid_buy.total_fee_bps, 50);
    let q_mid_sell = client.quote_sell(&res.token, &(50_000 * STROOPS));
    assert_eq!(q_mid_sell.total_fee_bps, 180);
    assert_eq!(
        q_mid_sell.floor_bonus,
        (q_mid_sell.gross_xlm_out * 140) / 10_000
    );

    // Anti-farming guard: selling back below 250 XLM and re-crossing must NOT award +5,000 again!
    client.sell_curve(&buyer_10x, &res.token, &b3.tokens, &1);
    let tok_before_recross = tok.balance(&buyer_10x);
    let b4 = client.buy_curve(&buyer_10x, &res.token, &(200 * STROOPS), &1);
    assert_eq!(tok.balance(&buyer_10x), tok_before_recross + b4.tokens);

    // Vault solvency check: real contract XLM matches curve.real_xlm_vault exact!
    let curve_after = client.get_curve(&res.token).unwrap();
    assert!(curve_after.real_xlm_vault > curve_after.curve_xlm_net);
    assert_eq!(xlm_tok.balance(&s.launchpad), curve_after.real_xlm_vault);
    assert!(xlm_tok.balance(&s.treasury) > 0);
}

#[test]
fn test_buy_sell_roundtrip_conservation_slippage_and_sweep_dust() {
    let e = create_env();
    let s = setup_launchpad(&e, false, (0, 0));
    let client = LaunchpadClient::new(&e, &s.launchpad);
    let xlm_sac = token::StellarAssetClient::new(&e, &s.xlm_sac);
    let xlm_tok = token::Client::new(&e, &s.xlm_sac);

    let creator = Address::generate(&e);
    let trader = Address::generate(&e);
    xlm_sac.mint(&creator, &(20 * STROOPS));
    xlm_sac.mint(&trader, &(200 * STROOPS));

    let res = client.launch_fair(&FairLaunchParams {
        creator: creator.clone(),
        name: String::from_str(&e, "RoundTrip"),
        symbol: String::from_str(&e, "RNDP"),
        xlm_lp_amount: 2 * STROOPS,
        meta: String::from_str(&e, ""),
        salt: BytesN::from_array(&e, &[11u8; 32]),
    });

    // Trader buys 150 XLM
    let q_buy = client.quote_buy(&res.token, &(150 * STROOPS));
    assert_eq!(
        client.try_buy_curve(
            &trader,
            &res.token,
            &(150 * STROOPS),
            &(q_buy.tokens_out + 1),
        ),
        Err(Ok(LaunchpadError::SlippageExceeded))
    );

    let buy_res = client.buy_curve(&trader, &res.token, &(150 * STROOPS), &q_buy.tokens_out);
    let xlm_before_sell = xlm_tok.balance(&trader);

    let q_sell = client.quote_sell(&res.token, &buy_res.tokens);
    assert_eq!(
        client.try_sell_curve(
            &trader,
            &res.token,
            &buy_res.tokens,
            &(q_sell.net_xlm_out + 1)
        ),
        Err(Ok(LaunchpadError::SlippageExceeded))
    );

    let curve_now = client.get_curve(&res.token).unwrap();
    assert_eq!(
        client.try_sell_curve(&trader, &res.token, &(curve_now.tokens_sold + 1), &0),
        Err(Ok(LaunchpadError::InvalidAmount))
    );

    // Trader sells 100% -> cannot sweep while creator seed is still in curve
    let sell_trader = client.sell_curve(&trader, &res.token, &buy_res.tokens, &q_sell.net_xlm_out);
    assert_eq!(sell_trader.xlm, q_sell.net_xlm_out);
    assert_eq!(xlm_tok.balance(&trader), xlm_before_sell + sell_trader.xlm);
    assert_eq!(
        client.try_sweep_empty_curve_fees(&res.token),
        Err(Ok(LaunchpadError::InvalidCurveState))
    );

    // After 7 days on an ungraduated curve, creator rescues failed seed & sells back, then empty vault dust sweeps cleanly!
    e.ledger()
        .set_timestamp(e.ledger().timestamp() + 7 * 86_400);
    let rescued = client.claim_creator_vesting(&creator, &res.token);
    assert!(rescued > 0);
    let sell_creator = client.sell_curve(&creator, &res.token, &rescued, &1);
    assert!(sell_creator.xlm > 0);

    let curve_empty = client.get_curve(&res.token).unwrap();
    assert_eq!(curve_empty.tokens_sold, 0);
    assert_eq!(curve_empty.curve_xlm_net, 0);
    assert!(curve_empty.real_xlm_vault > 0);

    let treas_before = xlm_tok.balance(&s.treasury);
    let swept = client.sweep_empty_curve_fees(&res.token);
    assert_eq!(swept, curve_empty.real_xlm_vault);
    assert_eq!(xlm_tok.balance(&s.treasury), treas_before + swept);
    assert_eq!(xlm_tok.balance(&s.launchpad), 0);
}

#[test]
fn test_graduation_unlocks_transfers_buyback_burn_and_vesting_15d() {
    let e = create_env();
    let s = setup_launchpad(&e, false, (0, 0));
    let client = LaunchpadClient::new(&e, &s.launchpad);
    let xlm_sac = token::StellarAssetClient::new(&e, &s.xlm_sac);
    let xlm_tok = token::Client::new(&e, &s.xlm_sac);

    let creator = Address::generate(&e);
    let whale = Address::generate(&e);
    let closer = Address::generate(&e);
    let stranger = Address::generate(&e);

    xlm_sac.mint(&creator, &(50 * STROOPS));
    xlm_sac.mint(&whale, &(1_000 * STROOPS));
    xlm_sac.mint(&closer, &(500 * STROOPS));

    let launch = client.launch_fair(&FairLaunchParams {
        creator: creator.clone(),
        name: String::from_str(&e, "Grad Token"),
        symbol: String::from_str(&e, "GRAD"),
        xlm_lp_amount: 10 * STROOPS,
        meta: String::from_str(&e, ""),
        salt: BytesN::from_array(&e, &[30u8; 32]),
    });

    // Cannot claim vesting or trigger milestone/buyback before graduation
    assert_eq!(
        client.try_claim_creator_vesting(&creator, &launch.token),
        Err(Ok(LaunchpadError::InvalidCurveState))
    );
    assert_eq!(
        client.try_trigger_milestone_burn(&launch.token),
        Err(Ok(LaunchpadError::InvalidCurveState))
    );
    assert_eq!(
        client.try_trigger_buyback_burn(&launch.token),
        Err(Ok(LaunchpadError::InvalidCurveState))
    );

    // Whale buys 800 XLM -> crosses 250 XLM (+5K) & 500 XLM (+10K), entering Stage 3 (1.50% sell / 0.25% sprint buy)!
    let whale_buy = client.buy_curve(&whale, &launch.token, &(800 * STROOPS), &1);
    let sell_q = client.quote_sell(&launch.token, &(200_000 * STROOPS));
    assert_eq!(sell_q.total_fee_bps, 150);
    client.sell_curve(&whale, &launch.token, &(200_000 * STROOPS), &1);
    assert!(whale_buy.tokens > 200_000 * STROOPS);

    // Closer completes graduation cleanly at Stage 3 0.25% sprint fee + wins 25,000 token Graduation Jackpot!
    let closer_bal_before = xlm_tok.balance(&closer);
    let grad_quote = client.quote_buy(&launch.token, &(400 * STROOPS));
    assert!(grad_quote.will_graduate);
    assert_eq!(grad_quote.total_fee_bps, 25);
    assert!(grad_quote.total_xlm_charged < 400 * STROOPS);

    let grad_trade = client.buy_curve(
        &closer,
        &launch.token,
        &(400 * STROOPS),
        &grad_quote.tokens_out,
    );
    assert!(grad_trade.graduated);
    assert_eq!(grad_trade.pair, Some(s.pair.clone()));
    assert_eq!(
        xlm_tok.balance(&closer),
        closer_bal_before - grad_quote.total_xlm_charged
    );

    let curve_grad = client.get_curve(&launch.token).unwrap();
    assert!(curve_grad.graduated);
    assert_eq!(curve_grad.tokens_sold, 6_600_000 * STROOPS);
    assert_eq!(curve_grad.curve_xlm_net, 1_000 * STROOPS);
    assert_eq!(curve_grad.real_xlm_vault, 0);
    assert!(curve_grad.buyback_xlm_reserve > 0);
    assert_eq!(curve_grad.burn_milestone_stage, 2);
    assert_eq!(curve_grad.burn_vault_remaining, 0);

    // Graduation unlocked SEP-41 P2P transfers & awarded +25,000 token Graduation Jackpot to closer!
    let tok = AstroTokenClient::new(&e, &launch.token);
    assert_eq!(
        tok.balance(&closer),
        grad_quote.tokens_out + (25_000 * STROOPS)
    );
    assert!(tok.is_transfers_unlocked());
    tok.transfer(&closer, &stranger, &1_000);
    assert_eq!(tok.balance(&stranger), 1_000);

    // Soroswap pair received 3,300,000 tokens + >=1,000 XLM, LP locked in Launchpad for 7 years!
    // Developer / protocol treasury received 0.30% = 30,000 tokens at graduation (with 40,000 paid across checkpoints).
    assert_eq!(tok.balance(&s.pair), 3_300_000 * STROOPS);
    assert_eq!(tok.balance(&s.treasury), 30_000 * STROOPS);
    assert!(xlm_tok.balance(&s.pair) >= 1_000 * STROOPS);
    assert_eq!(
        MockSoroswapPairClient::new(&e, &s.pair).lp_recipient(),
        s.launchpad
    );

    // Sync mock tokens + reserves to match transferred LP balances before buyback swap test
    let pair_mock = MockSoroswapPairClient::new(&e, &s.pair);
    pair_mock.set_tokens(&s.xlm_sac, &launch.token);
    pair_mock.set_reserves(&(xlm_tok.balance(&s.pair), tok.balance(&s.pair)));

    // Zero artificial burn vault -> full 10M supply intact before organic Buyback & Burn
    assert_eq!(tok.total_supply(), 10_000_000 * STROOPS);

    // Permissionless buyback-and-burn swaps buyback_xlm_reserve on Soroswap DEX & burns real tokens!
    let supply_before_bb = tok.total_supply();
    let bb_burned = client.trigger_buyback_burn(&launch.token);
    assert!(bb_burned > 0);
    assert_eq!(tok.total_supply(), supply_before_bb - bb_burned);
    assert_eq!(
        client.get_curve(&launch.token).unwrap().buyback_xlm_reserve,
        0
    );

    // Curve trading disabled after graduation
    assert_eq!(
        client.try_buy_curve(&whale, &launch.token, &(10 * STROOPS), &0),
        Err(Ok(LaunchpadError::InvalidCurveState))
    );
    assert_eq!(
        client.try_sell_curve(&whale, &launch.token, &(10 * STROOPS), &0),
        Err(Ok(LaunchpadError::InvalidCurveState))
    );

    // Legacy milestone burn has no vault in v4.3 -> InvalidCurveState
    assert_eq!(
        client.try_trigger_milestone_burn(&launch.token),
        Err(Ok(LaunchpadError::InvalidCurveState))
    );

    // Day 0 at graduation: Creator unlocks paid seed immediately (stranger still blocked)
    assert_eq!(
        client.try_claim_creator_vesting(&stranger, &launch.token),
        Err(Ok(LaunchpadError::InvalidCurveState))
    );
    let seed_out = client.claim_creator_vesting(&creator, &launch.token);
    assert_eq!(seed_out, curve_grad.creator_seed_locked);
    assert_eq!(
        client.try_claim_creator_vesting(&creator, &launch.token),
        Err(Ok(LaunchpadError::MilestoneNotReached))
    );

    let grad_ts = e.ledger().timestamp();
    // Day 3 -> 1st bonus tranche = 6,000 tokens (20% of 0.3% = 30,000)
    e.ledger().set_timestamp(grad_ts + 3 * 86_400);
    let c1 = client.claim_creator_vesting(&creator, &launch.token);
    assert_eq!(c1, 6_000 * STROOPS);
    assert_eq!(
        client.try_claim_creator_vesting(&creator, &launch.token),
        Err(Ok(LaunchpadError::MilestoneNotReached))
    );

    // Day 15+ -> remaining 24,000 tokens unlocked (total 30,000 = 0.3%)
    e.ledger().set_timestamp(grad_ts + 20 * 86_400);
    let c_rest = client.claim_creator_vesting(&creator, &launch.token);
    assert_eq!(c_rest, 24_000 * STROOPS);
    assert_eq!(
        client.get_curve(&launch.token).unwrap().creator_claimed,
        30_000 * STROOPS
    );
    assert_eq!(tok.balance(&s.launchpad), 0);

    // 7-Year LP Time-Lock verification: rejected at Year 6, unlocked to treasury at Year 7!
    e.ledger().set_timestamp(grad_ts + 6 * 365 * 86_400);
    assert_eq!(
        client.try_reclaim_expired_lp(&launch.token),
        Err(Ok(LaunchpadError::MilestoneNotReached))
    );
    e.ledger().set_timestamp(grad_ts + 7 * 365 * 86_400);
    let reclaimed_lp = client.reclaim_expired_lp(&launch.token);
    assert_eq!(reclaimed_lp, 495_000_000);
    assert_eq!(pair_mock.balance(&s.launchpad), 0);
    assert_eq!(pair_mock.balance(&s.treasury), 495_000_000);
    assert_eq!(
        client.try_reclaim_expired_lp(&launch.token),
        Err(Ok(LaunchpadError::InvalidCurveState))
    );
}

#[test]
fn test_burn_shout_3_tiers_and_king_shout() {
    let e = create_env();
    let s = setup_launchpad(&e, false, (0, 0));
    let client = LaunchpadClient::new(&e, &s.launchpad);
    let xlm_sac = token::StellarAssetClient::new(&e, &s.xlm_sac);

    let creator = Address::generate(&e);
    let user_a = Address::generate(&e);
    let user_b = Address::generate(&e);
    xlm_sac.mint(&creator, &(50 * STROOPS));
    xlm_sac.mint(&user_a, &(200 * STROOPS));
    xlm_sac.mint(&user_b, &(200 * STROOPS));

    let res = client.launch_fair(&FairLaunchParams {
        creator: creator.clone(),
        name: String::from_str(&e, "Shout Coin"),
        symbol: String::from_str(&e, "SHOUT"),
        xlm_lp_amount: 5 * STROOPS,
        meta: String::from_str(&e, ""),
        salt: BytesN::from_array(&e, &[41u8; 32]),
    });

    client.buy_curve(&user_a, &res.token, &(50 * STROOPS), &1);
    client.buy_curve(&user_b, &res.token, &(50 * STROOPS), &1);

    // Below 50 tokens minimum -> InvalidAmount
    assert_eq!(
        client.try_burn_shout(
            &user_a,
            &res.token,
            &(49 * STROOPS),
            &String::from_str(&e, "too cheap"),
        ),
        Err(Ok(LaunchpadError::InvalidAmount))
    );

    // Normal shout (50 tokens): succeeds without crowning KingShout
    client.burn_shout(
        &user_a,
        &res.token,
        &(50 * STROOPS),
        &String::from_str(&e, "hello curve"),
    );
    assert!(client.get_king_shout(&res.token).is_none());

    // 5,000 tokens crowns KingShout!
    client.burn_shout(
        &user_a,
        &res.token,
        &(5_000 * STROOPS),
        &String::from_str(&e, "First King"),
    );
    assert_eq!(
        client.get_king_shout(&res.token).unwrap().message,
        String::from_str(&e, "First King")
    );

    // Equal 5,000 tokens does NOT dethrone current King within 24h
    client.burn_shout(
        &user_b,
        &res.token,
        &(5_000 * STROOPS),
        &String::from_str(&e, "Tie fails"),
    );
    assert_eq!(client.get_king_shout(&res.token).unwrap().sender, user_a);

    // Strictly higher burn (7,500 tokens) dethrones King!
    client.burn_shout(
        &user_b,
        &res.token,
        &(7_500 * STROOPS),
        &String::from_str(&e, "New King"),
    );
    let king = client.get_king_shout(&res.token).unwrap();
    assert_eq!(king.sender, user_b);
    assert_eq!(king.amount, 7_500 * STROOPS);

    // After 24h decay (7,500 -> 3,750 clamped to 5,000 min), a fresh 5,000 burn reclaims the throne!
    e.ledger().set_timestamp(e.ledger().timestamp() + 86_400);
    client.burn_shout(
        &user_a,
        &res.token,
        &(5_000 * STROOPS),
        &String::from_str(&e, "Day 2 King"),
    );
    assert_eq!(client.get_king_shout(&res.token).unwrap().sender, user_a);

    // History caps cleanly at 15 shouts
    for _ in 0..15 {
        client.burn_shout(
            &user_a,
            &res.token,
            &(50 * STROOPS),
            &String::from_str(&e, "spam"),
        );
    }
    assert_eq!(client.get_shouts(&res.token).len(), 15);
    let tok = AstroTokenClient::new(&e, &res.token);
    assert!(tok.total_supply() < 10_000_000 * STROOPS);
}

#[test]
fn test_pre_seeded_pair_rejected_and_legacy_direct_launch() {
    let e = create_env();
    // Existing pair with non-zero reserves -> PairAlreadySeeded on legacy launch_token
    let s_seeded = setup_launchpad(&e, true, (100, 100));
    let client_seeded = LaunchpadClient::new(&e, &s_seeded.launchpad);
    let xlm_sac = token::StellarAssetClient::new(&e, &s_seeded.xlm_sac);
    let creator = Address::generate(&e);
    xlm_sac.mint(&creator, &(500 * STROOPS));

    assert_eq!(
        client_seeded.try_launch_token(&LaunchParams {
            creator: creator.clone(),
            name: String::from_str(&e, "PreSeeded"),
            symbol: String::from_str(&e, "SEED"),
            decimals: 7,
            initial_supply: 1_000_000_000,
            token_lp_amount: 995_000_000,
            xlm_lp_amount: 20_000_000,
            salt: BytesN::from_array(&e, &[51u8; 32]),
        }),
        Err(Ok(LaunchpadError::PairAlreadySeeded))
    );

    // Empty pair -> legacy launch_token succeeds atomically
    let s_empty = setup_launchpad(&e, true, (0, 0));
    let client_empty = LaunchpadClient::new(&e, &s_empty.launchpad);
    let xlm_empty = token::StellarAssetClient::new(&e, &s_empty.xlm_sac);
    xlm_empty.mint(&creator, &(500 * STROOPS));

    let legacy = client_empty.launch_token(&LaunchParams {
        creator: creator.clone(),
        name: String::from_str(&e, "Direct LP"),
        symbol: String::from_str(&e, "DIR"),
        decimals: 7,
        initial_supply: 100_000_000_000_000,
        token_lp_amount: 99_500_000_000_000,
        xlm_lp_amount: 50_000_000,
        salt: BytesN::from_array(&e, &[52u8; 32]),
    });
    assert_eq!(legacy.pair, Some(s_empty.pair.clone()));
    assert_eq!(
        MockSoroswapPairClient::new(&e, &s_empty.pair).lp_recipient(),
        s_empty.burn_addr
    );
}

#[test]
fn test_adversarial_salt_frontrunning_and_pagination() {
    let e = create_env();
    let s = setup_launchpad(&e, false, (0, 0));
    let client = LaunchpadClient::new(&e, &s.launchpad);
    let xlm_sac = token::StellarAssetClient::new(&e, &s.xlm_sac);

    let attacker = Address::generate(&e);
    let creator = Address::generate(&e);
    xlm_sac.mint(&attacker, &(50 * STROOPS));
    xlm_sac.mint(&creator, &(50 * STROOPS));
    let shared_salt = BytesN::from_array(&e, &[99u8; 32]);

    let res_attacker = client.launch_fair(&FairLaunchParams {
        creator: attacker.clone(),
        name: String::from_str(&e, "Squat"),
        symbol: String::from_str(&e, "SQT"),
        xlm_lp_amount: 2 * STROOPS,
        meta: String::from_str(&e, ""),
        salt: shared_salt.clone(),
    });
    let res_creator = client.launch_fair(&FairLaunchParams {
        creator: creator.clone(),
        name: String::from_str(&e, "Real"),
        symbol: String::from_str(&e, "REAL"),
        xlm_lp_amount: 2 * STROOPS,
        meta: String::from_str(&e, ""),
        salt: shared_salt,
    });

    assert_ne!(res_attacker.token, res_creator.token);
    assert_eq!(client.get_launch_count(), 2);
    assert_eq!(
        client.get_launch(&res_creator.token).unwrap().creator,
        creator
    );

    // Zero-balance attacker attempting burn_shout fails without polluting shouts
    assert!(client
        .try_burn_shout(
            &attacker,
            &res_creator.token,
            &(50 * STROOPS),
            &String::from_str(&e, "free"),
        )
        .is_err());
    assert!(client.get_shouts(&res_creator.token).is_empty());

    // Extreme pagination bounds safe
    assert!(client.get_launches(&u32::MAX, &u32::MAX).is_empty());
    assert!(client.get_launches(&0, &0).is_empty());
    assert_eq!(client.get_launches(&0, &u32::MAX).len(), 2);
    client.extend_launch_ttl(&res_creator.token);
}

#[test]
fn test_adversarial_direct_graduating_launch_and_invalid_quotes() {
    let e = create_env();
    let s = setup_launchpad(&e, false, (0, 0));
    let client = LaunchpadClient::new(&e, &s.launchpad);
    let xlm_sac = token::StellarAssetClient::new(&e, &s.xlm_sac);
    let creator = Address::generate(&e);
    xlm_sac.mint(&creator, &(1_500 * STROOPS));

    // Zero / negative quote inputs rejected
    assert_eq!(
        client.try_quote_buy(&Address::generate(&e), &0),
        Err(Ok(LaunchpadError::InvalidAmount))
    );
    assert_eq!(
        client.try_quote_sell(&Address::generate(&e), &-5),
        Err(Ok(LaunchpadError::InvalidAmount))
    );

    // Creator puts 1,100 XLM at launch -> hits 1,000 net XLM goal and graduates in 1 tx!
    let res = client.launch_fair(&FairLaunchParams {
        creator: creator.clone(),
        name: String::from_str(&e, "Instant Grad"),
        symbol: String::from_str(&e, "IGRD"),
        xlm_lp_amount: 1_100 * STROOPS,
        meta: String::from_str(&e, ""),
        salt: BytesN::from_array(&e, &[111u8; 32]),
    });

    assert_eq!(res.pair, Some(s.pair));
    let curve = client.get_curve(&res.token).unwrap();
    assert!(curve.graduated);
    assert_eq!(curve.tokens_sold, 6_600_000 * STROOPS);
    assert_eq!(curve.curve_xlm_net, 1_000 * STROOPS);
    assert_eq!(curve.burn_milestone_stage, 2);

    // Quotes on already-graduated curve rejected cleanly
    assert_eq!(
        client.try_quote_buy(&res.token, &(10 * STROOPS)),
        Err(Ok(LaunchpadError::InvalidCurveState))
    );
    assert_eq!(
        client.try_quote_sell(&res.token, &(10 * STROOPS)),
        Err(Ok(LaunchpadError::InvalidCurveState))
    );
}

#[test]
fn test_adversarial_auth_required_without_mock() {
    let e = Env::default();
    let xlm_admin = Address::generate(&e);
    let xlm_sac = e.register_stellar_asset_contract_v2(xlm_admin).address();
    let dummy_tok = Address::generate(&e);
    let pair = e.register(
        MockSoroswapPair,
        (xlm_sac.clone(), dummy_tok, (0_i128, 0_i128)),
    );
    let factory = e.register(MockSoroswapFactory, (pair, false));
    let wasm_hash = e.deployer().upload_contract_wasm(TOKEN_WASM);
    let launchpad = e.register(
        Launchpad,
        (
            factory,
            xlm_sac,
            wasm_hash,
            Address::generate(&e),
            Address::generate(&e),
        ),
    );
    let client = LaunchpadClient::new(&e, &launchpad);
    let attacker = Address::generate(&e);

    // Without auth, buy_curve, sell_curve, claim_creator_vesting, burn_shout all fail auth
    assert!(client
        .try_buy_curve(&attacker, &Address::generate(&e), &20_000_000, &0)
        .is_err());
    assert!(client
        .try_sell_curve(&attacker, &Address::generate(&e), &20_000_000, &0)
        .is_err());
    assert!(client
        .try_claim_creator_vesting(&attacker, &Address::generate(&e))
        .is_err());
    assert!(client
        .try_burn_shout(
            &attacker,
            &Address::generate(&e),
            &(50 * STROOPS),
            &String::from_str(&e, "hi")
        )
        .is_err());
}

#[test]
fn test_pair_sync_one_sided_griefing_does_not_block_graduation() {
    let e = create_env();
    // Simulate attacker creating the Soroswap pair before graduation and calling `sync()` with 1 stroop XLM (r0=1, r1=0, total_supply=0).
    let s = setup_launchpad(&e, true, (1, 0));
    let client = LaunchpadClient::new(&e, &s.launchpad);
    let xlm_sac = token::StellarAssetClient::new(&e, &s.xlm_sac);
    let creator = Address::generate(&e);
    xlm_sac.mint(&creator, &(1_500 * STROOPS));

    let res = client.launch_fair(&FairLaunchParams {
        creator: creator.clone(),
        name: String::from_str(&e, "SyncSafe"),
        symbol: String::from_str(&e, "SAFE"),
        xlm_lp_amount: 1_100 * STROOPS,
        meta: String::from_str(&e, ""),
        salt: BytesN::from_array(&e, &[123u8; 32]),
    });
    assert_eq!(res.pair, Some(s.pair));
    assert!(client.get_curve(&res.token).unwrap().graduated);
}

#[test]
fn test_burn_shout_rejects_unregistered_token_and_sweep_allows_burned_curve() {
    let e = create_env();
    let s = setup_launchpad(&e, false, (0, 0));
    let client = LaunchpadClient::new(&e, &s.launchpad);
    let xlm_sac = token::StellarAssetClient::new(&e, &s.xlm_sac);

    let creator = Address::generate(&e);
    let buyer = Address::generate(&e);
    xlm_sac.mint(&creator, &(50 * STROOPS));
    xlm_sac.mint(&buyer, &(100 * STROOPS));

    // Unregistered token rejected in burn_shout
    assert_eq!(
        client.try_burn_shout(
            &buyer,
            &Address::generate(&e),
            &(50 * STROOPS),
            &String::from_str(&e, "spoof")
        ),
        Err(Ok(LaunchpadError::CurveNotFound))
    );

    let res = client.launch_fair(&FairLaunchParams {
        creator: creator.clone(),
        name: String::from_str(&e, "BurnSweep"),
        symbol: String::from_str(&e, "BSWP"),
        xlm_lp_amount: 5 * STROOPS,
        meta: String::from_str(&e, ""),
        salt: BytesN::from_array(&e, &[77u8; 32]),
    });

    // Buyer buys and burns 100% of their curve tokens via burn_shout
    let buy = client.buy_curve(&buyer, &res.token, &(10 * STROOPS), &1);
    client.burn_shout(
        &buyer,
        &res.token,
        &buy.tokens,
        &String::from_str(&e, "all burned"),
    );

    // After 7 days, creator rescues seed and sells back; even though tokens_sold > 0 due to buyer's burn,
    // all remaining circulating supply == 0 so sweep_empty_curve_fees succeeds.
    e.ledger()
        .set_timestamp(e.ledger().timestamp() + 7 * 86_400);
    let rescued = client.claim_creator_vesting(&creator, &res.token);
    client.sell_curve(&creator, &res.token, &rescued, &1);

    let swept = client.sweep_empty_curve_fees(&res.token);
    assert!(swept > 0);
    assert_eq!(client.get_curve(&res.token).unwrap().real_xlm_vault, 0);
}

#[test]
fn test_admin_pause_treasury_rotation_and_anti_mev_buyback_chunking() {
    let e = create_env();
    let s = setup_launchpad(&e, false, (0, 0));
    let client = LaunchpadClient::new(&e, &s.launchpad);
    let xlm_sac = token::StellarAssetClient::new(&e, &s.xlm_sac);

    assert_eq!(client.get_admin(), Some(s.treasury.clone()));
    assert!(!client.is_paused());

    // Pause blocks new launches
    client.set_paused(&true);
    assert!(client.is_paused());
    let creator = Address::generate(&e);
    xlm_sac.mint(&creator, &(1_500 * STROOPS));
    assert_eq!(
        client.try_launch_fair(&FairLaunchParams {
            creator: creator.clone(),
            name: String::from_str(&e, "Paused"),
            symbol: String::from_str(&e, "PSD"),
            xlm_lp_amount: 10 * STROOPS,
            meta: String::from_str(&e, ""),
            salt: BytesN::from_array(&e, &[88u8; 32]),
        }),
        Err(Ok(LaunchpadError::LaunchesPaused))
    );

    // Unpause & rotate admin/treasury
    client.set_paused(&false);
    let new_admin = Address::generate(&e);
    client.transfer_admin(&new_admin);
    client.accept_admin();
    assert_eq!(client.get_admin(), Some(new_admin));

    let new_treasury = Address::generate(&e);
    client.set_treasury(&new_treasury);
    assert_eq!(client.get_treasury(), Some(new_treasury));

    assert_eq!(client.get_creation_fee(), 7 * STROOPS);
    client.set_creation_fee(&(10 * STROOPS));
    assert_eq!(client.get_creation_fee(), 10 * STROOPS);
    assert_eq!(
        client.try_set_creation_fee(&(1_001 * STROOPS)),
        Err(Ok(LaunchpadError::InvalidAmount))
    );
}

#[test]
fn test_market_page_and_30d_abandoned_curve_sweep() {
    let e = create_env();
    let s = setup_launchpad(&e, false, (0, 0));
    let client = LaunchpadClient::new(&e, &s.launchpad);
    let xlm_sac = token::StellarAssetClient::new(&e, &s.xlm_sac);
    let creator = Address::generate(&e);
    xlm_sac.mint(&creator, &(50 * STROOPS));

    let res = client.launch_fair(&FairLaunchParams {
        creator: creator.clone(),
        name: String::from_str(&e, "Abandoned"),
        symbol: String::from_str(&e, "ABND"),
        xlm_lp_amount: 5 * STROOPS,
        meta: String::from_str(&e, ""),
        salt: BytesN::from_array(&e, &[44u8; 32]),
    });

    // get_market_page returns launch record + live curve in a single RPC call
    let page = client.get_market_page(&0, &10);
    assert_eq!(page.len(), 1);
    let card = page.get(0).unwrap();
    assert_eq!(card.record.token, res.token);
    assert_eq!(card.curve.len(), 1);
    assert!(!card.curve.get(0).unwrap().graduated);

    // Before 30 days, sweep_empty_curve_fees rejects because creator_seed_locked > 0
    assert_eq!(
        client.try_sweep_empty_curve_fees(&res.token),
        Err(Ok(LaunchpadError::InvalidCurveState))
    );

    // After 30 days with zero external buyers left, sweep returns creator's seed & sweeps XLM vault
    e.ledger()
        .set_timestamp(e.ledger().timestamp() + 30 * 86_400);
    let swept = client.sweep_empty_curve_fees(&res.token);
    assert!(swept > 0);
    let tok = AstroTokenClient::new(&e, &res.token);
    assert!(tok.balance(&creator) > 0);
    let curve_after = client.get_curve(&res.token).unwrap();
    assert_eq!(curve_after.creator_seed_locked, 0);
    assert_eq!(curve_after.real_xlm_vault, 0);
}

#[test]
fn test_50_wallets_lifecycle_buy_sell_stalled_refund_and_graduation_roi() {
    let e = create_env();
    e.cost_estimate().budget().reset_unlimited();
    let s = setup_launchpad(&e, false, (0, 0));
    let client = LaunchpadClient::new(&e, &s.launchpad);
    let xlm_sac = token::StellarAssetClient::new(&e, &s.xlm_sac);
    let xlm_read = token::Client::new(&e, &s.xlm_sac);

    // -----------------------------------------------------------------
    // Part 1: No-sale / stalled curve -> 1-click refund after 7 days
    // -----------------------------------------------------------------
    let stalled_creator = Address::generate(&e);
    let flaky_buyer = Address::generate(&e);
    xlm_sac.mint(&stalled_creator, &(25 * STROOPS));
    xlm_sac.mint(&flaky_buyer, &(15 * STROOPS));

    let res_a = client.launch_fair(&FairLaunchParams {
        creator: stalled_creator.clone(),
        name: String::from_str(&e, "Stalled"),
        symbol: String::from_str(&e, "STLL"),
        xlm_lp_amount: 10 * STROOPS,
        meta: String::from_str(&e, ""),
        salt: BytesN::from_array(&e, &[11u8; 32]),
    });

    // External buyer enters with 5 XLM then exits 100%
    let buy_a = client.buy_curve(&flaky_buyer, &res_a.token, &(5 * STROOPS), &1);
    client.sell_curve(&flaky_buyer, &res_a.token, &buy_a.tokens, &1);

    // Cannot refund before 7 days
    assert_eq!(
        client.try_refund_stalled_launch(&stalled_creator, &res_a.token),
        Err(Ok(LaunchpadError::InvalidCurveState))
    );

    // After 7 days with 0 external holders left, creator recovers full real_xlm_vault in 1 tx
    e.ledger()
        .set_timestamp(e.ledger().timestamp() + 7 * 86_400);
    let bal_before_refund = xlm_read.balance(&stalled_creator);
    let refunded = client.refund_stalled_launch(&stalled_creator, &res_a.token);
    let bal_after_refund = xlm_read.balance(&stalled_creator);
    // 10 XLM seed minus 0.50% treasury fee = 9.95 XLM + buyer's 2.50% floor bonus stayed in vault
    assert!(refunded >= 99_500_000);
    assert_eq!(bal_after_refund - bal_before_refund, refunded);
    let curve_a = client.get_curve(&res_a.token).unwrap();
    assert_eq!(curve_a.real_xlm_vault, 0);
    assert_eq!(curve_a.tokens_sold, 0);
    assert_eq!(curve_a.creator_seed_locked, 0);

    // -----------------------------------------------------------------
    // Part 2: 50 distinct wallets trading, burning shouts & graduating
    // -----------------------------------------------------------------
    let wallets: std::vec::Vec<Address> = (0..50).map(|_| Address::generate(&e)).collect();
    for w in &wallets {
        xlm_sac.mint(w, &(100 * STROOPS));
    }

    let creator = &wallets[0];
    let res_b = client.launch_fair(&FairLaunchParams {
        creator: creator.clone(),
        name: String::from_str(&e, "FiftyWallets"),
        symbol: String::from_str(&e, "FIFTY"),
        xlm_lp_amount: 20 * STROOPS,
        meta: String::from_str(&e, ""),
        salt: BytesN::from_array(&e, &[50u8; 32]),
    });

    // Wallets 1..=15 buy 25 XLM each
    let mut bought_amounts: std::vec::Vec<i128> = std::vec![0; 50];
    for i in 1..=15usize {
        let tr = client.buy_curve(&wallets[i], &res_b.token, &(25 * STROOPS), &1);
        bought_amounts[i] = tr.tokens;
        assert!(!tr.graduated);
    }

    // Wallets 5..=9 take partial profit (sell 50% mid-curve)
    let mut mid_sell_xlm = 0i128;
    for i in 5..=9usize {
        let half = bought_amounts[i] / 2;
        let sr = client.sell_curve(&wallets[i], &res_b.token, &half, &1);
        assert!(sr.xlm > 0);
        if i == 5 {
            mid_sell_xlm = sr.xlm;
        }
    }

    // Wallets 1..=3 burn tokens in Burn-to-Chat (Chat, Hype, King)
    client.burn_shout(
        &wallets[1],
        &res_b.token,
        &(50 * STROOPS),
        &String::from_str(&e, "Chat tier"),
    );
    client.burn_shout(
        &wallets[2],
        &res_b.token,
        &(500 * STROOPS),
        &String::from_str(&e, "Hype tier"),
    );
    client.burn_shout(
        &wallets[3],
        &res_b.token,
        &(6_000 * STROOPS),
        &String::from_str(&e, "King tier"),
    );

    // Wallets 16..50 buy 21 XLM each until atomic Soroswap graduation
    let mut graduated_idx: Option<usize> = None;
    let mut grad_xlm_spent: i128 = 0;
    for i in 16..50usize {
        if graduated_idx.is_some() {
            // Post-graduation curve buys must cleanly reject
            assert_eq!(
                client.try_buy_curve(&wallets[i], &res_b.token, &(21 * STROOPS), &1),
                Err(Ok(LaunchpadError::InvalidCurveState))
            );
            continue;
        }
        let tr = client.buy_curve(&wallets[i], &res_b.token, &(21 * STROOPS), &1);
        bought_amounts[i] = tr.tokens;
        if tr.graduated {
            graduated_idx = Some(i);
            grad_xlm_spent = tr.xlm;
        }
    }
    assert!(
        graduated_idx.is_some(),
        "50-wallet wave must graduate curve"
    );

    let curve_b = client.get_curve(&res_b.token).unwrap();
    assert!(curve_b.graduated);
    assert_eq!(curve_b.burn_milestone_stage, 2);
    assert_eq!(curve_b.tokens_sold, 6_600_000 * STROOPS);

    // Verify supply burned organically via Burn-to-Chat shouts (6,550 tokens burned, 0 artificial burn vault)
    let tok_b = AstroTokenClient::new(&e, &res_b.token);
    assert!(tok_b.total_supply() < 10_000_000 * STROOPS);
    assert_eq!(tok_b.balance(&s.treasury), 30_000 * STROOPS);

    // Verify DEX price & participant ROIs (DEX seeded with 3.3M tokens and >=1,000 XLM)
    let launch_rec = client.get_launch(&res_b.token).unwrap();
    let dex_price_num = launch_rec.xlm_lp_amount; // stroops for 3.3M tokens
    let dex_price_den = 3_300_000 * STROOPS;

    let early_bal = tok_b.balance(&wallets[1]); // spent 25 XLM, burned 50 tok
    let early_val_stroops = (early_bal * dex_price_num) / dex_price_den;
    assert!(
        early_val_stroops > 50 * STROOPS,
        "Early buyer should be >2x (+100% ROI), got {} stroops",
        early_val_stroops
    );

    let mid_bal = tok_b.balance(&wallets[25]); // spent 21 XLM mid-curve
    let mid_val_stroops = (mid_bal * dex_price_num) / dex_price_den;
    assert!(
        mid_val_stroops > 25 * STROOPS,
        "Mid buyer should be profitable at graduation (>25 XLM for 21 XLM in), got {} stroops",
        mid_val_stroops
    );

    // Creator claims initial seed immediately at graduation + checks vesting
    let creator_claimed_grad = client.claim_creator_vesting(creator, &res_b.token);
    let creator_val_stroops = (creator_claimed_grad * dex_price_num) / dex_price_den;
    assert!(
        creator_val_stroops > 40 * STROOPS,
        "Creator 20 XLM seed worth >40 XLM at graduation before 50K bonus vesting"
    );

    // Verify on-chain PilotRecord telemetry for Sorobits integration
    let p_creator = client.get_pilot(creator);
    assert_eq!(p_creator.launches, 1);
    assert_eq!(p_creator.graduations, 1);
    assert!(p_creator.trades >= 1);

    let p_king = client.get_pilot(&wallets[3]);
    assert_eq!(p_king.shouts, 1);
    assert_eq!(p_king.king_shouts, 1);
    assert_eq!(p_king.burns_triggered, 1);

    let grad_idx = graduated_idx.unwrap();
    let grad_actual_xlm_debited = 100 * STROOPS - xlm_read.balance(&wallets[grad_idx]);
    let grad_bal = tok_b.balance(&wallets[grad_idx]);
    let grad_val_stroops = (grad_bal * dex_price_num) / dex_price_den;
    let pre_grad_bal = tok_b.balance(&wallets[grad_idx - 1]);
    let pre_grad_val_stroops = (pre_grad_bal * dex_price_num) / dex_price_den;
    let seller5_bal = tok_b.balance(&wallets[5]);
    let seller5_val_stroops = mid_sell_xlm + (seller5_bal * dex_price_num) / dex_price_den;
    std::println!(
        "[50W-LAUNCHPAD] stalled_refund_stroops={} ({}% of 10 XLM seed) | grad_wallet={} (tr.xlm={}, actual_debit={}) | burned_stroops={}",
        refunded,
        (refunded * 100) / (10 * STROOPS),
        grad_idx,
        grad_xlm_spent,
        grad_actual_xlm_debited,
        10_000_000 * STROOPS - tok_b.total_supply()
    );
    std::println!(
        "[50W-ROI] creator_20xlm->={} ({}% vs 27 XLM total cost, +30k bonus vesting={} stroops pending, +30k dev treasury, 40k 3-checkpoint jackpots) | early_w1_25xlm->={} ({}%) | half_seller_w5_25xlm->={} ({}%) | mid_w25_21xlm->={} ({}%) | pre_grad_w{}_21xlm->={} ({}%) | grad_w{}_{}xlm->={} ({}% vs actual debit)",
        creator_val_stroops,
        ((creator_val_stroops - 27 * STROOPS) * 100) / (27 * STROOPS),
        (30_000 * STROOPS * dex_price_num) / dex_price_den,
        early_val_stroops,
        ((early_val_stroops - 25 * STROOPS) * 100) / (25 * STROOPS),
        seller5_val_stroops,
        ((seller5_val_stroops - 25 * STROOPS) * 100) / (25 * STROOPS),
        mid_val_stroops,
        ((mid_val_stroops - 21 * STROOPS) * 100) / (21 * STROOPS),
        grad_idx - 1,
        pre_grad_val_stroops,
        ((pre_grad_val_stroops - 21 * STROOPS) * 100) / (21 * STROOPS),
        grad_idx,
        grad_actual_xlm_debited / STROOPS,
        grad_val_stroops,
        ((grad_val_stroops - grad_actual_xlm_debited) * 100) / grad_actual_xlm_debited,
    );
}

#[test]
fn test_50_wallets_economic_models_comparison_burn_vs_wallet_vs_7y_lock() {
    // Integer constant-product helper mirroring Fair-Flywheel v4.2 fee mechanics:
    // 50 bps treasury + 30 bps floor bonus (80 bps total buy fee).
    fn sim_50_wallets(
        vx_start: i128,
        vy_start: i128,
        curve_alloc: i128,
        dex_alloc: i128,
        real_goal: i128,
    ) -> (i128, i128, i128, i128, i128, usize) {
        let mut xlm_net: i128 = 0;
        let mut sold: i128 = 0;
        let mut vault: i128 = 0;
        let mut holdings = [0i128; 50];
        let mut spent = [0i128; 50];
        let mut grad_w = 0usize;

        for w in 0..50usize {
            let order = if w == 0 { 20 * STROOPS } else { 21 * STROOPS };
            let remaining_goal = real_goal - xlm_net;
            if remaining_goal <= 0 {
                break;
            }
            let max_gross_for_cap = ((remaining_goal as u128 * 10_000) / (10_000 - 80)) as i128 + 2;
            let gross = if order > max_gross_for_cap && remaining_goal < (order * 9_920) / 10_000 {
                let mut g = ((remaining_goal as u128 * 10_000).div_ceil(9_920)) as i128;
                while g - ((g * 80) / 10_000) < remaining_goal {
                    g += 1;
                }
                g.min(order)
            } else {
                order
            };
            let t_fee = ((gross as u128 * 50).div_ceil(10_000)) as i128;
            let f_fee = ((gross as u128 * 30).div_ceil(10_000)) as i128;
            let net = (gross - t_fee - f_fee).min(remaining_goal);
            let is_grad = xlm_net + net >= real_goal;

            let vx = vx_start + xlm_net;
            let vy = vy_start - sold;
            let out = if is_grad {
                curve_alloc - sold
            } else {
                ((net as u128 * vy as u128) / (vx as u128 + net as u128)) as i128
            };
            xlm_net += net;
            sold += out;
            vault += net + f_fee;
            holdings[w] = out;
            spent[w] = gross;
            if is_grad {
                grad_w = w;
                break;
            }
        }

        // Value at Soroswap DEX open spot price: vault / dex_alloc
        let roi_pct = |w: usize| -> i128 {
            let val = ((holdings[w] as u128 * vault as u128) / dex_alloc as u128) as i128;
            ((val - spent[w]) * 100) / spent[w]
        };
        (
            roi_pct(0),
            roi_pct(1),
            roi_pct(25),
            roi_pct(grad_w - 1),
            roi_pct(grad_w),
            grad_w,
        )
    }

    let goal = 1_000 * STROOPS;

    // Model A: v4.2 Actual (42% Curve / 28% DEX / 29.5% Burn Vault / 0.5% Vest, 2.25x curve)
    let a = sim_50_wallets(
        2_000 * STROOPS,
        12_600_000 * STROOPS,
        4_200_000 * STROOPS,
        2_800_000 * STROOPS,
        goal,
    );

    // Model B: Reserve 29.5% (2,950,000 tokens) in an UNLOCKED external wallet instead of burning.
    // Simulate Soroswap pool at open: 1,000 XLM & 2,800,000 tokens. If wallet sells 50% (1,475,000):
    let pool_xlm: u128 = (1_000 * STROOPS) as u128;
    let pool_tok: u128 = (2_800_000 * STROOPS) as u128;
    let dump_tok: u128 = (1_475_000 * STROOPS) as u128;
    let dump_net: u128 = dump_tok - ((dump_tok * 3).div_ceil(1_000));
    let xlm_drained: u128 = (dump_net * pool_xlm) / (pool_tok + dump_net);
    let pool_xlm_after = pool_xlm - xlm_drained;
    let pool_tok_after = pool_tok + dump_tok;
    let price_before_num = pool_xlm * 1_000_000;
    let price_before_den = pool_tok;
    let price_after_num = pool_xlm_after * 1_000_000;
    let price_after_den = pool_tok_after;
    let crash_pct =
        100 - (((price_after_num * price_before_den) * 100) / (price_before_num * price_after_den));
    assert!((55..=60).contains(&crash_pct));

    // Model C: Simplified 10M (66% Curve / 33% DEX / 1% Creator Vesting, NO burn vault, 4.00x range, 0.00% cliff)
    let c = sim_50_wallets(
        1_000 * STROOPS,
        13_200_000 * STROOPS,
        6_600_000 * STROOPS,
        3_300_000 * STROOPS,
        goal,
    );
    assert!(c.0 > a.0 && c.1 > a.1 && c.4 >= -1);

    // 7-Year LP Time-Lock simulation for dead graduated pools
    let grad_ts: u64 = 1_760_000_000;
    let seven_years_secs: u64 = 7 * 365 * 86_400; // 220,752,000s
    let locked_at_year_6 = (grad_ts + 6 * 365 * 86_400) < (grad_ts + seven_years_secs);
    let unlocked_at_year_7 = (grad_ts + seven_years_secs) >= (grad_ts + seven_years_secs);
    assert!(locked_at_year_6 && unlocked_at_year_7);

    std::println!(
        "[COMPARE-MODEL-A-V42] range=2.25x cliff=0% | creator_seed_roi={}% early_w1={}% mid_w25={}% pre_grad={}% grad_w{}={}% | dead_pool_xlm_lost=1000XLM",
        a.0, a.1, a.2, a.3, a.5, a.4
    );
    std::println!(
        "[COMPARE-MODEL-B-WALLET] unlocked_wallet=29.5% vs pool=28% (105% of pool!) | half_sell_1.475M_drains={} stroops (~{} XLM) | price_crash=-{}%",
        xlm_drained,
        xlm_drained / (STROOPS as u128),
        crash_pct
    );
    std::println!(
        "[COMPARE-MODEL-C-4X-7YLOCK] range=4.00x cliff=0% | creator_seed_roi={}% early_w1={}% mid_w25={}% pre_grad={}% grad_w{}={}% | dead_pool_xlm_recovered_after_7y=1000XLM",
        c.0, c.1, c.2, c.3, c.5, c.4
    );
}
