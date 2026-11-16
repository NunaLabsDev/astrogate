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

    /// Saves LP recipient to verify permanent burn to `burn_address`.
    pub fn deposit(e: &Env, to: Address) -> i128 {
        e.storage().instance().set(&1u32, &to);
        495_000_000
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
        meta: String::from_str(&e, r#"{"d":"Fair v4.2 curve"}"#),
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
    assert!(curve_0.creator_seed_locked > 12_000 * STROOPS);
    assert_eq!(curve_0.burn_vault_remaining, 2_950_000 * STROOPS);
    assert_eq!(curve_0.creator_vesting_total, 50_000 * STROOPS);
    assert_eq!(curve_0.creator_claimed, 0);
    // Treasury received 7 XLM creation fee + 0.50% of 2 XLM initial buy (0.01 XLM)
    assert_eq!(xlm_tok.balance(&s.treasury), 70_100_000);

    // Buyer 1 puts 10 XLM: flat 0.80% fee (50 bps treasury + 30 bps floor)
    let q_small = client.quote_buy(&res.token, &(10 * STROOPS));
    assert_eq!(q_small.total_fee_bps, 80);
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

    // Buyer 2 puts 100 XLM (10x Buyer 1): STILL pays flat 80 bps (no anti-whale penalty!)
    let q_10x = client.quote_buy(&res.token, &(100 * STROOPS));
    assert_eq!(q_10x.total_fee_bps, 80);
    assert_eq!(q_10x.treasury_fee, (100 * STROOPS * 50) / 10_000);
    assert_eq!(q_10x.floor_bonus, (100 * STROOPS * 30) / 10_000);
    let b2 = client.buy_curve(&buyer_10x, &res.token, &(100 * STROOPS), &q_10x.tokens_out);

    // Selling early on curve (<50% progress) pays 2.50% (250 bps), keeping 2.00% inside floor vault!
    let q_sell = client.quote_sell(&res.token, &b2.tokens);
    assert_eq!(q_sell.total_fee_bps, 250);
    assert!(q_sell.floor_bonus > q_sell.treasury_fee);

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
    e.ledger().set_timestamp(e.ledger().timestamp() + 7 * 86_400);
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

    // Whale buys 800 XLM and sells 200k tokens on curve (>=50% progress -> 1.50% sell fee builds buyback reserve!)
    let whale_buy = client.buy_curve(&whale, &launch.token, &(800 * STROOPS), &1);
    let sell_q = client.quote_sell(&launch.token, &(200_000 * STROOPS));
    assert_eq!(sell_q.total_fee_bps, 150);
    client.sell_curve(&whale, &launch.token, &(200_000 * STROOPS), &1);
    assert!(whale_buy.tokens > 200_000 * STROOPS);

    // Closer completes graduation cleanly at flat 0.80% fee!
    let closer_bal_before = xlm_tok.balance(&closer);
    let grad_quote = client.quote_buy(&launch.token, &(400 * STROOPS));
    assert!(grad_quote.will_graduate);
    assert_eq!(grad_quote.total_fee_bps, 80);
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
    assert_eq!(curve_grad.tokens_sold, 4_200_000 * STROOPS);
    assert_eq!(curve_grad.curve_xlm_net, 1_000 * STROOPS);
    assert_eq!(curve_grad.real_xlm_vault, 0);
    assert!(curve_grad.buyback_xlm_reserve > 0);
    assert_eq!(curve_grad.burn_milestone_stage, 1);
    assert_eq!(curve_grad.burn_vault_remaining, 1_475_000 * STROOPS);

    // Graduation unlocked SEP-41 P2P transfers!
    let tok = AstroTokenClient::new(&e, &launch.token);
    assert!(tok.is_transfers_unlocked());
    tok.transfer(&closer, &stranger, &1_000);
    assert_eq!(tok.balance(&stranger), 1_000);

    // Soroswap pair received 2,800,000 tokens + >=1,000 XLM, LP burned!
    assert_eq!(tok.balance(&s.pair), 2_800_000 * STROOPS);
    assert!(xlm_tok.balance(&s.pair) >= 1_000 * STROOPS);
    assert_eq!(
        MockSoroswapPairClient::new(&e, &s.pair).lp_recipient(),
        s.burn_addr
    );

    // Sync mock tokens + reserves to match transferred LP balances before buyback swap test
    let pair_mock = MockSoroswapPairClient::new(&e, &s.pair);
    pair_mock.set_tokens(&s.xlm_sac, &launch.token);
    pair_mock.set_reserves(&(xlm_tok.balance(&s.pair), tok.balance(&s.pair)));

    // Milestone 1 burned 1,475,000 tokens -> supply = 8,525,000!
    assert_eq!(tok.total_supply(), 8_525_000 * STROOPS);

    // Permissionless buyback-and-burn swaps buyback_xlm_reserve on Soroswap DEX & burns real tokens!
    let supply_before_bb = tok.total_supply();
    let bb_burned = client.trigger_buyback_burn(&launch.token);
    assert!(bb_burned > 0);
    assert_eq!(tok.total_supply(), supply_before_bb - bb_burned);
    assert_eq!(client.get_curve(&launch.token).unwrap().buyback_xlm_reserve, 0);

    // Curve trading disabled after graduation
    assert_eq!(
        client.try_buy_curve(&whale, &launch.token, &(10 * STROOPS), &0),
        Err(Ok(LaunchpadError::InvalidCurveState))
    );
    assert_eq!(
        client.try_sell_curve(&whale, &launch.token, &(10 * STROOPS), &0),
        Err(Ok(LaunchpadError::InvalidCurveState))
    );

    // Milestone 2 rejected while Soroswap XLM reserve < 1,800 XLM
    assert_eq!(
        client.try_trigger_milestone_burn(&launch.token),
        Err(Ok(LaunchpadError::MilestoneNotReached))
    );

    // Simulate Soroswap XLM reserve reaching 1,800 XLM -> Milestone 2 burns remaining 1.475M!
    MockSoroswapPairClient::new(&e, &s.pair).set_reserves(&(1_800 * STROOPS, 1_500_000 * STROOPS));
    let burned2 = client.trigger_milestone_burn(&launch.token);
    assert_eq!(burned2, 1_475_000 * STROOPS);
    assert_eq!(tok.total_supply(), 7_050_000 * STROOPS - bb_burned);

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
    // Day 3 -> 1st bonus tranche = 10,000 tokens
    e.ledger().set_timestamp(grad_ts + 3 * 86_400);
    let c1 = client.claim_creator_vesting(&creator, &launch.token);
    assert_eq!(c1, 10_000 * STROOPS);
    assert_eq!(
        client.try_claim_creator_vesting(&creator, &launch.token),
        Err(Ok(LaunchpadError::MilestoneNotReached))
    );

    // Day 15+ -> remaining 40,000 tokens unlocked (total 50,000 = 0.5%)
    e.ledger().set_timestamp(grad_ts + 20 * 86_400);
    let c_rest = client.claim_creator_vesting(&creator, &launch.token);
    assert_eq!(c_rest, 40_000 * STROOPS);
    assert_eq!(
        client.get_curve(&launch.token).unwrap().creator_claimed,
        50_000 * STROOPS
    );
    assert_eq!(tok.balance(&s.launchpad), 0);
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
    assert_eq!(curve.tokens_sold, 4_200_000 * STROOPS);
    assert_eq!(curve.curve_xlm_net, 1_000 * STROOPS);
    assert_eq!(curve.burn_milestone_stage, 1);

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
