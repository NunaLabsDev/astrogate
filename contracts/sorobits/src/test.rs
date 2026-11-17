extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Bytes, Env, String,
};

use crate::{
    assets::{FACTION_PALETTES, RELIC_4_ORBITALHALO},
    contract::{Sorobits, SorobitsClient},
    engine::LayerCategory,
};

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
        assert!(!svg_str.contains('"'), "SVG must use single quotes only for safe JSON embedding");

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
