extern crate std;

use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Ledger},
    token, Address, Bytes, Env, Map, String,
};

use crate::{
    assets::{FACTION_PALETTES, RELIC_4_ORBITALHALO},
    contract::{LaunchpadPilotRecord, Sorobits, SorobitsClient},
    engine::LayerCategory,
};

#[contract]
pub struct MockPilotLaunchpad;

#[contractimpl]
impl MockPilotLaunchpad {
    pub fn set_pilot(e: &Env, user: Address, rec: LaunchpadPilotRecord) {
        let mut map: Map<Address, LaunchpadPilotRecord> = e
            .storage()
            .instance()
            .get(&0u32)
            .unwrap_or_else(|| Map::new(e));
        map.set(user, rec);
        e.storage().instance().set(&0u32, &map);
    }

    pub fn get_pilot(e: &Env, user: Address) -> LaunchpadPilotRecord {
        let map: Map<Address, LaunchpadPilotRecord> = e
            .storage()
            .instance()
            .get(&0u32)
            .unwrap_or_else(|| Map::new(e));
        map.get(user).unwrap_or(LaunchpadPilotRecord {
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

fn setup<'a>(cap_per_archetype: u32) -> (Env, Address, Address, Address, SorobitsClient<'a>) {
    let e = Env::default();
    e.mock_all_auths();
    e.ledger().set_sequence_number(1_234_567);
    e.ledger().set_timestamp(1_760_000_000);

    let admin = Address::generate(&e);
    let treasury = Address::generate(&e);
    let user = Address::generate(&e);

    let contract_id = e.register(Sorobits, (&admin, &treasury, 500u32, cap_per_archetype));
    let client = SorobitsClient::new(&e, &contract_id);
    (e, admin, treasury, user, client)
}

#[test]
fn metadata_royalties_and_season1_sealed_on_deploy() {
    let (_e, _admin, treasury, _user, client) = setup(100);
    assert_eq!(client.name(), String::from_str(&_e, "Sorobits"));
    assert_eq!(client.symbol(), String::from_str(&_e, "SBIT"));
    assert!(client.is_season_sealed(&1));
    assert!(!client.is_season_sealed(&2));

    let user = Address::generate(&_e);
    let token_id = client.mint_genesis(&_admin, &user, &1, &false);
    let (recv, fee) = client.royalty_info(&token_id, &10_000);
    assert_eq!(recv, treasury);
    assert_eq!(fee, 500);
}

#[test]
fn mint_all_8_genesis_and_measure_soroban_budget() {
    let (e, admin, _treasury, user, client) = setup(50);

    for arch in 1..=8u32 {
        e.cost_estimate().budget().reset_default();
        let token_id = client.mint_genesis(&admin, &user, &arch, &false);
        let mint_cpu = e.cost_estimate().budget().cpu_instruction_cost();
        let mint_mem = e.cost_estimate().budget().memory_bytes_cost();

        e.cost_estimate().budget().reset_default();
        let svg = client.render_svg(&token_id);
        let svg_cpu = e.cost_estimate().budget().cpu_instruction_cost();

        e.cost_estimate().budget().reset_default();
        let uri = client.token_uri(&token_id);
        let uri_cpu = e.cost_estimate().budget().cpu_instruction_cost();
        let uri_mem = e.cost_estimate().budget().memory_bytes_cost();

        let anim = client.animated_svg(&token_id);
        let bitmap = client.raw_bitmap(&token_id);

        assert_eq!(bitmap.len(), 1069); // 1024 pixels + 45 RGB palette bytes

        let mut svg_buf = [0u8; 6000];
        let slen = svg.len() as usize;
        assert!(slen > 500 && slen < 6000, "unexpected svg len {}", slen);
        svg.copy_into_slice(&mut svg_buf[..slen]);
        let svg_str = core::str::from_utf8(&svg_buf[..slen]).unwrap();
        assert!(svg_str.starts_with("<svg xmlns='http://www.w3.org/2000/svg'"));
        assert!(svg_str.ends_with("</svg>"));
        assert!(
            !svg_str.contains('"'),
            "SVG must use single quotes only for safe JSON embedding"
        );

        let mut anim_buf = [0u8; 6500];
        let alen = anim.len() as usize;
        anim.copy_into_slice(&mut anim_buf[..alen]);
        let anim_str = core::str::from_utf8(&anim_buf[..alen]).unwrap();
        assert!(anim_str.contains("@keyframes p"));

        let mut uri_buf = [0u8; 8192];
        let ulen = uri.len() as usize;
        uri.copy_into_slice(&mut uri_buf[..ulen]);
        let uri_str = core::str::from_utf8(&uri_buf[..ulen]).unwrap();
        assert!(uri_str.starts_with("data:application/json;utf8,{\"name\":\"Sorobit #"));
        assert!(uri_str.contains("\"Stellar Era\""));
        assert!(uri_str.contains("\"image\":\"data:image/svg+xml;utf8,<svg "));

        std::println!(
            "AGQ0{} token_id={} | mint_cpu={} mem={} | svg_len={} svg_cpu={} | uri_len={} uri_cpu={} mem={}",
            arch, token_id, mint_cpu, mint_mem, slen, svg_cpu, ulen, uri_cpu, uri_mem
        );
    }

    assert_eq!(client.total_supply(), 8);
    assert_eq!(client.tokens_of(&user).len(), 8);
}

#[test]
fn generative_genome_collision_safety_and_epigenetics() {
    let (e, admin, _treasury, user, client) = setup(10);

    for i in 0..12u8 {
        e.ledger().set_sequence_number(2_000_000 + i as u32);
        let entropy = Bytes::from_slice(&e, &[i, i.wrapping_mul(17), 0xAB, 0xCD]);
        let id = client.mint_generative(&admin, &user, &entropy, &false);
        let rec = client.get_sorobit(&id);
        let dna = rec.dna.to_array();
        // VoidHood (helmet == 3) never collides with Antenna (1), SovereignCrown (3), or SorobanCrown (6)
        if dna[3] == 3 {
            assert!(!matches!(dna[5], 1 | 3 | 6));
        }
        assert_eq!(rec.edition, 0);
        assert_eq!(rec.rank_tier, 0);
    }

    // Update live epigenetics without touching immutable DNA
    let before = client.get_sorobit(&0);
    let svg_before = client.render_svg(&0);
    client.update_epigenetics(&admin, &0, &3, &1_250);
    let after = client.get_sorobit(&0);
    let svg_after = client.render_svg(&0);

    assert_eq!(before.dna, after.dna);
    assert_eq!(after.rank_tier, 3);
    assert_eq!(after.xp_score, 1_250);
    assert_ne!(svg_before, svg_after);
}

#[test]
fn soulbound_blocks_transfer_while_tradeable_allows_transfer_and_burn() {
    let (_e, admin, _treasury, alice, client) = setup(10);
    let bob = Address::generate(&_e);

    let tradeable_id = client.mint_genesis(&admin, &alice, &1, &false);
    client.transfer(&alice, &bob, &tradeable_id);
    assert_eq!(client.owner_of(&tradeable_id), bob);

    // Burn tradeable token and confirm cleanup
    client.burn(&bob, &tradeable_id);
    assert_eq!(client.balance(&bob), 0);
    assert_eq!(client.total_supply(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #302)")]
fn soulbound_transfer_panics() {
    let (_e, admin, _treasury, alice, client) = setup(10);
    let bob = Address::generate(&_e);
    let soul_id = client.mint_genesis(&admin, &alice, &8, &true);
    client.transfer(&alice, &bob, &soul_id);
}

#[test]
#[should_panic(expected = "Error(Contract, #301)")]
fn genesis_cap_enforced() {
    let (_e, admin, _treasury, alice, client) = setup(1);
    client.mint_genesis(&admin, &alice, &1, &false);
    client.mint_genesis(&admin, &alice, &1, &false);
}

#[test]
fn season2_curator_upload_validation_and_seal() {
    let (e, admin, _treasury, alice, client) = setup(10);

    let valid_pal = Bytes::from_slice(&e, &FACTION_PALETTES[6]);
    client.register_palette(&admin, &2, &0, &valid_pal);

    let valid_layer = Bytes::from_slice(&e, RELIC_4_ORBITALHALO);
    client.register_layer(&admin, &2, &LayerCategory::Relic, &0, &valid_layer);

    client.set_active_season(&2);
    let entropy = Bytes::from_slice(&e, b"season2-probe");
    let id = client.mint_generative(&admin, &alice, &entropy, &false);
    let rec = client.get_sorobit(&id);
    assert_eq!(rec.dna.to_array()[0], 2);
    assert!(client.render_svg(&id).len() > 500);

    client.seal_season(&admin, &2);
    assert!(client.is_season_sealed(&2));
}

#[test]
#[should_panic(expected = "Error(Contract, #303)")]
fn cannot_reseal_or_mutate_sealed_season() {
    let (e, admin, _treasury, _alice, client) = setup(10);
    client.seal_season(&admin, &2);
    let valid_pal = Bytes::from_slice(&e, &FACTION_PALETTES[0]);
    client.register_palette(&admin, &2, &0, &valid_pal);
}

#[test]
#[should_panic(expected = "Error(Contract, #306)")]
fn rejects_season2_palette_with_pure_black_outline() {
    let (e, admin, _treasury, _alice, client) = setup(10);
    let mut bad = FACTION_PALETTES[0];
    // Corrupt slot 7 (outline dark) to pure #000000
    bad[18] = 0;
    bad[19] = 0;
    bad[20] = 0;
    client.register_palette(&admin, &2, &1, &Bytes::from_slice(&e, &bad));
}

#[test]
#[should_panic(expected = "Error(Contract, #305)")]
fn rejects_season2_layer_wrong_pixel_count() {
    let (e, admin, _treasury, _alice, client) = setup(10);
    let bad_rle = Bytes::from_slice(&e, &[10, 1, 20, 0]);
    client.register_layer(&admin, &2, &LayerCategory::Suit, &0, &bad_rle);
}

#[test]
#[should_panic(expected = "Error(Contract, #2000)")]
fn unauthorized_minter_and_curator_rejected() {
    let (_e, _admin, _treasury, attacker, client) = setup(10);
    client.mint_genesis(&attacker, &attacker, &1, &false);
}

#[test]
#[should_panic(expected = "Error(Contract, #305)")]
fn rejects_dense_checkerboard_rle_exceeding_svg_budget() {
    let (e, admin, _treasury, _alice, client) = setup(10);
    // 1,024 single-pixel checkerboard runs (2,048 bytes): valid RLE pixel count,
    // but would exceed SVG path budget if not rejected at registration time.
    let mut dense = [0u8; 2048];
    for i in 0..1024usize {
        dense[i * 2] = 1;
        dense[i * 2 + 1] = ((i % 13) + 1) as u8;
    }
    client.register_layer(
        &admin,
        &2,
        &LayerCategory::Suit,
        &0,
        &Bytes::from_slice(&e, &dense),
    );
}

#[test]
fn tokens_of_page_and_extend_token_ttl_work() {
    let (e, admin, _treasury, user, client) = setup(10);
    for arch in 1..=3u32 {
        client.mint_genesis(&admin, &user, &arch, &false);
    }
    let page1 = client.tokens_of_page(&user, &0, &2);
    let page2 = client.tokens_of_page(&user, &2, &2);
    assert_eq!(page1.len(), 2);
    assert_eq!(page2.len(), 1);
    assert!(client.tokens_of_page(&user, &5, &2).is_empty());

    e.ledger().set_sequence_number(e.ledger().sequence() + 100);
    client.extend_token_ttl(&0);
}

#[test]
#[should_panic(expected = "Error(Contract, #307)")]
fn update_epigenetics_rejects_invalid_rank_tier() {
    let (_e, admin, _treasury, user, client) = setup(10);
    let id = client.mint_genesis(&admin, &user, &1, &false);
    client.update_epigenetics(&admin, &id, &5, &100);
}

#[test]
fn regular_user_can_claim_pioneer_once() {
    let (_e, _admin, _treasury, user, client) = setup(10);
    assert!(!client.has_claimed(&user, &1));
    let id = client.claim_pioneer(&user);
    assert!(client.has_claimed(&user, &1));
    assert_eq!(client.owner_of(&id), user);
    let rec = client.get_sorobit(&id);
    assert_eq!(rec.edition, 1);
    assert!(rec.soulbound);
}

#[test]
#[should_panic(expected = "Error(Contract, #311)")]
fn claim_pioneer_rejects_duplicate_claim() {
    let (_e, _admin, _treasury, user, client) = setup(10);
    client.claim_pioneer(&user);
    client.claim_pioneer(&user);
}

#[test]
fn test_50_wallets_claim_quests_sync_epigenetics_and_forge_ascend() {
    let (e, admin, treasury, _u, client) = setup(100);
    e.cost_estimate().budget().reset_unlimited();

    let xlm_sac = e.register_stellar_asset_contract_v2(admin.clone());
    let xlm_addr = xlm_sac.address();
    let xlm_admin = token::StellarAssetClient::new(&e, &xlm_addr);
    let xlm_client = token::Client::new(&e, &xlm_addr);
    client.set_xlm_sac(&xlm_addr);
    assert_eq!(client.get_xlm_sac(), Some(xlm_addr.clone()));
    assert_eq!(client.get_treasury(), Some(treasury.clone()));
    assert_eq!(client.get_capsule_fee(), 70_000_000);
    client.set_capsule_fee(&70_000_000);
    client.set_treasury(&treasury);

    let mock_lp = e.register(MockPilotLaunchpad, ());
    let lp_client = MockPilotLaunchpadClient::new(&e, &mock_lp);
    client.set_launchpad(&mock_lp);
    assert_eq!(client.get_launchpad(), Some(mock_lp.clone()));

    // 50 distinct wallets claim AGQ01 Pioneer on-chain (free 0 XLM, Soulbound anti-Sybil)
    let wallets: std::vec::Vec<Address> = (0..50).map(|_| Address::generate(&e)).collect();
    for (idx, w) in wallets.iter().enumerate() {
        let token_id = client.claim_pioneer(w);
        assert_eq!(token_id, idx as u32);
        assert!(client.has_claimed(w, &1));
        assert!(client.get_sorobit(&token_id).soulbound);
    }
    assert_eq!(client.total_supply(), 50);

    // Wallet[0] cannot claim AGQ02..8 before completing Launchpad actions
    assert!(client.try_claim_quest_badge(&wallets[0], &2).is_err());

    // Simulate real Launchpad activity for wallets[0] (launched, traded, king-shouted, graduated)
    lp_client.set_pilot(
        &wallets[0],
        &LaunchpadPilotRecord {
            launches: 1,
            graduations: 1,
            trades: 4,
            volume_xlm_stroops: 2_500_000_000,
            shouts: 2,
            king_shouts: 1,
            burns_triggered: 2,
        },
    );

    // Wallet[0] claims all remaining 7 Season-1 Quest badges (AGQ02..AGQ08, tradeable)
    let id_launcher = client.claim_quest_badge(&wallets[0], &2);
    let id_shouter = client.claim_quest_badge(&wallets[0], &3);
    let _id_grad = client.claim_quest_badge(&wallets[0], &4);
    let _id_og = client.claim_quest_badge(&wallets[0], &5);
    let _id_trader = client.claim_quest_badge(&wallets[0], &6);
    let _id_phoenix = client.claim_quest_badge(&wallets[0], &7);
    let _id_legend = client.claim_quest_badge(&wallets[0], &8);
    assert_eq!(client.total_supply(), 57);

    // Permissionless epigenetic sync evolves Pioneer #0 and Launcher XP & rank_tier
    let synced = client.sync_epigenetics(&0);
    assert!(synced.xp_score >= 2_500);
    assert_eq!(synced.rank_tier, 4);
    client.sync_epigenetics(&id_launcher);

    // Anti-Sybil guard: free Soulbound AGQ01 Pioneer (#0) cannot enter Forge
    let entropy = Bytes::from_slice(&e, b"forge-ascend-50-wallet-test");
    assert!(client
        .try_forge_ascend(&wallets[0], &0, &id_launcher, &entropy)
        .is_err());

    // Generative 7 XLM Mystery Capsule mint + anti-whale quota check
    xlm_admin.mint(&wallets[0], &200_000_000);
    let capsule_id = client.mint_capsule(&wallets[0], &entropy);
    assert_eq!(client.total_supply(), 58);
    assert_eq!(xlm_client.balance(&treasury), 70_000_000);
    assert!(!client.get_sorobit(&capsule_id).soulbound);
    let (minted_q, max_q) = client.get_capsule_quota(&wallets[0]);
    assert_eq!(minted_q, 1);
    assert!(max_q >= 10);

    // Fresh inactive wallet has base quota 2 -> capped at 2 capsules until trading
    let fresh_buyer = Address::generate(&e);
    xlm_admin.mint(&fresh_buyer, &210_000_000);
    assert_eq!(client.get_capsule_quota(&fresh_buyer), (0, 2));
    client.mint_capsule(&fresh_buyer, &entropy);
    client.mint_capsule(&fresh_buyer, &entropy);
    assert!(client.try_mint_capsule(&fresh_buyer, &entropy).is_err());

    // Deflationary Forge: wallets[0] burns 2 tradeable Sorobits (#id_launcher + #id_shouter) -> Gen-1 Ascended
    let forged_id = client.forge_ascend(&wallets[0], &id_launcher, &id_shouter, &entropy);
    assert_eq!(client.total_supply(), 59); // 58 + 2 (fresh) - 2 burned + 1 forged
    assert_eq!(client.owner_of(&forged_id), wallets[0]);
    assert_eq!(client.get_capsule_quota(&wallets[0]).0, 0); // forging freed 1 capsule slot

    let forged_rec = client.get_sorobit(&forged_id);
    assert_eq!(forged_rec.generation, 1);
    assert_eq!(forged_rec.rank_tier, 4);
    assert!(forged_rec.xp_score >= 3_000);

    // Owner cannot forge with same token twice or forge unowned token
    assert!(client
        .try_forge_ascend(&wallets[0], &forged_id, &forged_id, &entropy)
        .is_err());
    assert!(client
        .try_forge_ascend(&wallets[1], &forged_id, &1, &entropy)
        .is_err());

    let owned_after = client.tokens_of_page(&wallets[0], &0, &20);
    assert_eq!(owned_after.len(), 8); // 8 claimed (1..=8) + 1 capsule - 2 burned + 1 forged
    let svg = client.render_svg(&forged_id);
    assert!(svg.len() > 100);
    std::println!(
        "[50W-SOROBITS] wallets=50 | supply_after_forge={} | w0_owned={} | capsule_id={} | forged_id={} | gen={} | tier={} | xp={} | treasury_xlm_stroops={} | svg_bytes={}",
        client.total_supply(),
        owned_after.len(),
        capsule_id,
        forged_id,
        forged_rec.generation,
        forged_rec.rank_tier,
        forged_rec.xp_score,
        xlm_client.balance(&treasury),
        svg.len()
    );
}
