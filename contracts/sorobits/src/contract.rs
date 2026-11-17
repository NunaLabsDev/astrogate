//! Contrato principal Sorobits (`SBIT`) — SEP-50 NFT 100% On-Chain.
//!
//! Seguridad y arquitectura:
//! - SEP-50 completo: `NonFungibleToken` + `Enumerable` + `Burnable` + `Royalties` + `AccessControl`.
//! - Roles desacoplados: `curator` (capas/paletas y `seal_season`), `minter` (emisión),
//!   `telemetry` (actualización de marco epigenético y XP sin mutar el genoma base).
//! - Protección explícita de TTL (`90 días` instancia / `180 días` persistente).

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    symbol_short, Address, Bytes, BytesN, Env, String, Symbol, Vec,
};
use stellar_access::access_control::{self, AccessControl};
use stellar_macros::{only_admin, only_role};
use stellar_tokens::non_fungible::{
    burnable::{Burnable, NonFungibleBurnable},
    combinations::Compose,
    enumerable::{Enumerable, NonFungibleEnumerable},
    royalties::{NonFungibleRoyalties, Royalties, RoyaltySupport},
    Base, ContractOverrides, NonFungibleToken,
};

use crate::assets::{
    AURA_LAYERS, FACTION_COUNT, GENESIS_TEMPLATES, HELMET_LAYERS, RELIC_LAYERS, SUIT_LAYERS,
    VISOR_LAYERS,
};
use crate::engine::{
    apply_optional_rle, overlay_frame, render_procedural_sky, resolve_palette, sanitize_genes,
    validate_palette45, validate_rle_layer, write_svg, write_token_uri_json, ByteWriter,
    LayerCategory, SorobitRecord, PIXELS,
};

const DAY_IN_LEDGERS: u32 = 17_280;
pub const INSTANCE_BUMP_AMOUNT: u32 = 90 * DAY_IN_LEDGERS;
pub const INSTANCE_TTL_THRESHOLD: u32 = INSTANCE_BUMP_AMOUNT - (7 * DAY_IN_LEDGERS);
pub const PERSISTENT_BUMP_AMOUNT: u32 = 180 * DAY_IN_LEDGERS;
pub const PERSISTENT_TTL_THRESHOLD: u32 = PERSISTENT_BUMP_AMOUNT - (14 * DAY_IN_LEDGERS);

pub const MAX_GENESIS_ARCHETYPES: u32 = 8;
pub const MAX_RANK_TIER: u32 = 4;
pub const MAX_ROYALTY_BPS: u32 = 1_500; // Capped at 15% max creator royalty

const ROLE_MINTER: Symbol = symbol_short!("minter");
const ROLE_CURATOR: Symbol = symbol_short!("curator");
const ROLE_TELEMETRY: Symbol = symbol_short!("telemetry");

#[contracttype]
#[derive(Clone)]
enum DataKey {
    GenesisCapPerArchetype,
    GenesisMinted(u32),
    Sorobit(u32),
    SeasonLayer(u32, u32, u32), // (season, LayerCategory as u32, layer_id)
    SeasonPalette(u32, u32),     // (season, faction_id)
    SeasonSealed(u32),
    SeasonActive,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum SorobitsError {
    InvalidArchetype = 300,
    GenesisCapReached = 301,
    SoulboundLocked = 302,
    SeasonAlreadySealed = 303,
    InvalidSeason = 304,
    InvalidLayerRle = 305,
    InvalidPalette = 306,
    InvalidRankTier = 307,
    RoyaltyTooHigh = 308,
    RecordMissing = 309,
    EntropyEmpty = 310,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SorobitMintedEvent {
    #[topic]
    pub to: Address,
    #[topic]
    pub token_id: u32,
    pub edition: u32,
    pub dna: BytesN<32>,
    pub soulbound: bool,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EpigeneticUpdatedEvent {
    #[topic]
    pub token_id: u32,
    pub rank_tier: u32,
    pub xp_score: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SeasonSealedEvent {
    #[topic]
    pub season: u32,
}

#[contract]
pub struct Sorobits;

#[contractimpl]
impl Sorobits {
    /// Inicializa Sorobits (`SBIT`), roles iniciales (`admin`), royalties base (`royalty_bps`)
    /// y sella de inmediato las plantillas artísticas de la Temporada 1 (`AGQ01–AGQ08`).
    pub fn __constructor(
        e: &Env,
        admin: Address,
        royalty_receiver: Address,
        royalty_bps: u32,
        genesis_cap_per_archetype: u32,
    ) {
        if royalty_bps > MAX_ROYALTY_BPS {
            panic_with_error!(e, SorobitsError::RoyaltyTooHigh);
        }

        Base::set_metadata(
            e,
            String::from_str(e, "data:application/json;utf8,{}"),
            String::from_str(e, "Sorobits"),
            String::from_str(e, "SBIT"),
        );

        access_control::set_admin(e, &admin);
        access_control::grant_role_no_auth(e, &admin, &ROLE_MINTER, &admin);
        access_control::grant_role_no_auth(e, &admin, &ROLE_CURATOR, &admin);
        access_control::grant_role_no_auth(e, &admin, &ROLE_TELEMETRY, &admin);

        Base::set_default_royalty(e, &royalty_receiver, royalty_bps);

        e.storage()
            .instance()
            .set(&DataKey::GenesisCapPerArchetype, &genesis_cap_per_archetype);
        e.storage().instance().set(&DataKey::SeasonActive, &1u32);

        // Season 1 compiled pixel assets are sealed from block zero.
        let s1_key = DataKey::SeasonSealed(1);
        e.storage().persistent().set(&s1_key, &true);
        Self::bump_persistent(e, &s1_key);
        Self::extend_ttl(e);
    }

    /// Acuña uno de los 8 Arquetipos Genesis Edición 0 (`1 = AGQ01 Pioneer .. 8 = AGQ08 Legend`).
    #[only_role(caller, "minter")]
    pub fn mint_genesis(
        e: &Env,
        caller: Address,
        to: Address,
        archetype_id: u32,
        soulbound: bool,
    ) -> u32 {
        if !(1..=MAX_GENESIS_ARCHETYPES).contains(&archetype_id) {
            panic_with_error!(e, SorobitsError::InvalidArchetype);
        }

        let cap: u32 = e
            .storage()
            .instance()
            .get(&DataKey::GenesisCapPerArchetype)
            .unwrap_or(0);
        let minted_key = DataKey::GenesisMinted(archetype_id);
        let minted: u32 = e.storage().instance().get(&minted_key).unwrap_or(0);
        if cap > 0 && minted >= cap {
            panic_with_error!(e, SorobitsError::GenesisCapReached);
        }
        e.storage().instance().set(&minted_key, &(minted + 1));

        let token_id = <Self as NonFungibleToken>::ContractType::mint(e, &to);
        let tmpl = &GENESIS_TEMPLATES[(archetype_id - 1) as usize];
        let mut dna_bytes = Self::derive_entropy(e, token_id, archetype_id as u8);
        dna_bytes[0] = 1; // Season 1
        dna_bytes[1] = tmpl.faction;
        dna_bytes[2] = tmpl.suit;
        dna_bytes[3] = tmpl.helmet;
        dna_bytes[4] = tmpl.visor;
        dna_bytes[5] = tmpl.relic;
        dna_bytes[6] = tmpl.aura;

        let dna = BytesN::from_array(e, &dna_bytes);
        let rec = SorobitRecord {
            dna: dna.clone(),
            edition: archetype_id,
            generation: 0,
            rank_tier: tmpl.frame as u32,
            xp_score: 0,
            born_ledger: e.ledger().sequence(),
            soulbound,
        };

        let key = DataKey::Sorobit(token_id);
        e.storage().persistent().set(&key, &rec);
        Self::bump_persistent(e, &key);
        Self::extend_ttl(e);

        SorobitMintedEvent {
            to,
            token_id,
            edition: rec.edition,
            dna,
            soulbound,
        }
        .publish(e);
        token_id
    }

    /// Acuña un Sorobit generativo con Genoma criptográfico de 256 bits (`BytesN<32>`)
    /// aplicando automáticamente la matriz de compatibilidad y exclusión de rasgos.
    #[only_role(caller, "minter")]
    pub fn mint_generative(
        e: &Env,
        caller: Address,
        to: Address,
        user_entropy: Bytes,
        soulbound: bool,
    ) -> u32 {
        if user_entropy.is_empty() || user_entropy.len() > 64 {
            panic_with_error!(e, SorobitsError::EntropyEmpty);
        }
        let token_id = <Self as NonFungibleToken>::ContractType::mint(e, &to);
        let season: u32 = e.storage().instance().get(&DataKey::SeasonActive).unwrap_or(1);

        let mut preimage = Bytes::new(e);
        preimage.extend_from_slice(&e.ledger().sequence().to_le_bytes());
        preimage.extend_from_slice(&e.ledger().timestamp().to_le_bytes());
        preimage.extend_from_slice(&token_id.to_le_bytes());
        preimage.append(&user_entropy);
        let hash: BytesN<32> = e.crypto().sha256(&preimage).into();
        let mut dna_bytes = hash.to_array();

        let faction = dna_bytes[1] % (FACTION_COUNT as u8);
        let suit = dna_bytes[2] % (SUIT_LAYERS.len() as u8);
        let helmet = dna_bytes[3] % (HELMET_LAYERS.len() as u8);
        let visor = dna_bytes[4] % (VISOR_LAYERS.len() as u8);
        let mut relic = dna_bytes[5] % (RELIC_LAYERS.len() as u8);
        let mut aura = dna_bytes[6] % (AURA_LAYERS.len() as u8);
        sanitize_genes(helmet, visor, &mut relic, &mut aura);

        dna_bytes[0] = (season.min(255)) as u8;
        dna_bytes[1] = faction;
        dna_bytes[2] = suit;
        dna_bytes[3] = helmet;
        dna_bytes[4] = visor;
        dna_bytes[5] = relic;
        dna_bytes[6] = aura;

        let dna = BytesN::from_array(e, &dna_bytes);
        let rec = SorobitRecord {
            dna: dna.clone(),
            edition: 0,
            generation: 0,
            rank_tier: 0,
            xp_score: 0,
            born_ledger: e.ledger().sequence(),
            soulbound,
        };

        let key = DataKey::Sorobit(token_id);
        e.storage().persistent().set(&key, &rec);
        Self::bump_persistent(e, &key);
        Self::extend_ttl(e);

        SorobitMintedEvent {
            to,
            token_id,
            edition: 0,
            dna,
            soulbound,
        }
        .publish(e);
        token_id
    }

    /// Actualiza la epigenética viva (`rank_tier` del marco TTL y `xp_score`) sin alterar el genoma base.
    #[only_role(caller, "telemetry")]
    pub fn update_epigenetics(
        e: &Env,
        caller: Address,
        token_id: u32,
        new_rank_tier: u32,
        add_xp: u32,
    ) {
        if new_rank_tier > MAX_RANK_TIER {
            panic_with_error!(e, SorobitsError::InvalidRankTier);
        }
        let _ = <Self as NonFungibleToken>::ContractType::owner_of(e, token_id);
        let mut rec = Self::load_record(e, token_id);
        rec.rank_tier = new_rank_tier;
        rec.xp_score = rec.xp_score.saturating_add(add_xp);

        let key = DataKey::Sorobit(token_id);
        e.storage().persistent().set(&key, &rec);
        Self::bump_persistent(e, &key);
        Self::extend_ttl(e);

        EpigeneticUpdatedEvent {
            token_id,
            rank_tier: rec.rank_tier,
            xp_score: rec.xp_score,
        }
        .publish(e);
    }

    /// Registra una capa `32x32` comprimida en RLE para futuras temporadas (`season >= 2`) no selladas.
    #[only_role(caller, "curator")]
    pub fn register_layer(
        e: &Env,
        caller: Address,
        season: u32,
        category: LayerCategory,
        layer_id: u32,
        rle_bytes: Bytes,
    ) {
        if !(2..=255).contains(&season) {
            panic_with_error!(e, SorobitsError::InvalidSeason);
        }
        Self::assert_season_unsealed(e, season);
        let len = rle_bytes.len() as usize;
        if len == 0 || len > 2048 {
            panic_with_error!(e, SorobitsError::InvalidLayerRle);
        }
        let mut tmp = [0u8; 2048];
        rle_bytes.copy_into_slice(&mut tmp[..len]);
        if !validate_rle_layer(&tmp[..len]) {
            panic_with_error!(e, SorobitsError::InvalidLayerRle);
        }

        let key = DataKey::SeasonLayer(season, category as u32, layer_id);
        e.storage().persistent().set(&key, &rle_bytes);
        Self::bump_persistent(e, &key);
        Self::extend_ttl(e);
    }

    /// Registra una paleta semántica de 45 bytes (`slots 1..=15`) para `season >= 2`,
    /// validando automáticamente on-chain todas las rampas de luminancia y sel-out.
    #[only_role(caller, "curator")]
    pub fn register_palette(
        e: &Env,
        caller: Address,
        season: u32,
        faction_id: u32,
        palette45: Bytes,
    ) {
        if !(2..=255).contains(&season) {
            panic_with_error!(e, SorobitsError::InvalidSeason);
        }
        Self::assert_season_unsealed(e, season);
        if palette45.len() as usize != 45 {
            panic_with_error!(e, SorobitsError::InvalidPalette);
        }
        let mut buf = [0u8; 45];
        palette45.copy_into_slice(&mut buf);
        if !validate_palette45(&buf) {
            panic_with_error!(e, SorobitsError::InvalidPalette);
        }

        let key = DataKey::SeasonPalette(season, faction_id);
        e.storage().persistent().set(&key, &palette45);
        Self::bump_persistent(e, &key);
        Self::extend_ttl(e);
    }

    /// Cambia la temporada activa para nuevos mints generativos (`1..=255`).
    #[only_admin]
    pub fn set_active_season(e: &Env, season: u32) {
        if !(1..=255).contains(&season) {
            panic_with_error!(e, SorobitsError::InvalidSeason);
        }
        e.storage().instance().set(&DataKey::SeasonActive, &season);
        Self::extend_ttl(e);
    }

    /// Sella de forma irreversible el arte y las paletas de una temporada (`seal_season`).
    #[only_role(caller, "curator")]
    pub fn seal_season(e: &Env, caller: Address, season: u32) {
        if !(1..=255).contains(&season) {
            panic_with_error!(e, SorobitsError::InvalidSeason);
        }
        Self::assert_season_unsealed(e, season);
        let key = DataKey::SeasonSealed(season);
        e.storage().persistent().set(&key, &true);
        Self::bump_persistent(e, &key);
        Self::extend_ttl(e);
        SeasonSealedEvent { season }.publish(e);
    }

    /// Devuelve el SVG estático 100% nativo (`<svg ...>...</svg>`) del Sorobit.
    pub fn render_svg(e: &Env, token_id: u32) -> String {
        let (_rec, grid, pal) = Self::compose_for_token(e, token_id);
        let mut w = ByteWriter::new();
        write_svg(&mut w, &grid, &pal, false);
        w.into_soroban_string(e)
    }

    /// Devuelve la versión animada (`5s` pulso de visor acorde al cierre SCP) para Mini App / galería.
    pub fn animated_svg(e: &Env, token_id: u32) -> String {
        let (_rec, grid, pal) = Self::compose_for_token(e, token_id);
        let mut w = ByteWriter::new();
        write_svg(&mut w, &grid, &pal, true);
        w.into_soroban_string(e)
    }

    /// Devuelve los 1,024 índices semánticos resueltos (`0..=15`) + 45 bytes de paleta RGB (`1,069` bytes)
    /// para renderizado directo a `<canvas>` o mini-juegos futuros.
    pub fn raw_bitmap(e: &Env, token_id: u32) -> Bytes {
        let (_rec, grid, pal) = Self::compose_for_token(e, token_id);
        let mut out = Bytes::from_slice(e, &grid);
        out.extend_from_slice(&pal);
        out
    }

    /// Devuelve el registro genómico y telemétrico completo de un Sorobit.
    pub fn get_sorobit(e: &Env, token_id: u32) -> SorobitRecord {
        let _ = <Self as NonFungibleToken>::ContractType::owner_of(e, token_id);
        Self::load_record(e, token_id)
    }

    /// Devuelve los IDs minteados para una cuenta (usando `Enumerable` on-chain sin base de datos).
    pub fn tokens_of(e: &Env, owner: Address) -> Vec<u32> {
        let count = <Self as NonFungibleToken>::ContractType::balance(e, &owner);
        let mut out = Vec::new(e);
        for idx in 0..count {
            out.push_back(Enumerable::get_owner_token_id(e, &owner, idx));
        }
        out
    }

    pub fn genesis_minted(e: &Env, archetype_id: u32) -> u32 {
        e.storage()
            .instance()
            .get(&DataKey::GenesisMinted(archetype_id))
            .unwrap_or(0)
    }

    pub fn is_season_sealed(e: &Env, season: u32) -> bool {
        e.storage()
            .persistent()
            .get(&DataKey::SeasonSealed(season))
            .unwrap_or(false)
    }

    /// Extiende el TTL de la instancia del contrato (metadata, contadores y configuración).
    pub fn extend_ttl(e: &Env) {
        e.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_BUMP_AMOUNT);
    }

    /// Protege contra expiración/archivado el registro genómico de un token específico.
    pub fn extend_token_ttl(e: &Env, token_id: u32) {
        let _ = <Self as NonFungibleToken>::ContractType::owner_of(e, token_id);
        let key = DataKey::Sorobit(token_id);
        Self::bump_persistent(e, &key);
        Self::extend_ttl(e);
    }

    // ---------------- Helpers privados ----------------

    fn derive_entropy(e: &Env, token_id: u32, salt: u8) -> [u8; 32] {
        let mut pre = Bytes::new(e);
        pre.extend_from_slice(&e.ledger().sequence().to_le_bytes());
        pre.extend_from_slice(&e.ledger().timestamp().to_le_bytes());
        pre.extend_from_slice(&token_id.to_le_bytes());
        pre.push_back(salt);
        let h: BytesN<32> = e.crypto().sha256(&pre).into();
        h.to_array()
    }

    fn load_record(e: &Env, token_id: u32) -> SorobitRecord {
        let key = DataKey::Sorobit(token_id);
        let rec: SorobitRecord = e
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(e, SorobitsError::RecordMissing));
        Self::bump_persistent(e, &key);
        rec
    }

    fn bump_persistent(e: &Env, key: &DataKey) {
        if e.storage().persistent().has(key) {
            e.storage()
                .persistent()
                .extend_ttl(key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_BUMP_AMOUNT);
        }
    }

    fn assert_season_unsealed(e: &Env, season: u32) {
        if Self::is_season_sealed(e, season) {
            panic_with_error!(e, SorobitsError::SeasonAlreadySealed);
        }
    }

    fn compose_for_token(e: &Env, token_id: u32) -> (SorobitRecord, [u8; PIXELS], [u8; 45]) {
        let _ = <Self as NonFungibleToken>::ContractType::owner_of(e, token_id);
        let rec = Self::load_record(e, token_id);
        let dna = rec.dna.to_array();
        let season = dna[0] as u32;
        let mut grid = [0u8; PIXELS];
        render_procedural_sky(&dna, &mut grid);

        let load_layer = |cat: LayerCategory, id: u8| -> Option<Bytes> {
            if season <= 1 {
                None
            } else {
                e.storage()
                    .persistent()
                    .get(&DataKey::SeasonLayer(season, cat as u32, id as u32))
            }
        };

        apply_optional_rle(
            load_layer(LayerCategory::Aura, dna[6]),
            AURA_LAYERS[(dna[6] as usize) % AURA_LAYERS.len()],
            &mut grid,
        );
        apply_optional_rle(
            load_layer(LayerCategory::Suit, dna[2]),
            SUIT_LAYERS[(dna[2] as usize) % SUIT_LAYERS.len()],
            &mut grid,
        );
        apply_optional_rle(
            load_layer(LayerCategory::Helmet, dna[3]),
            HELMET_LAYERS[(dna[3] as usize) % HELMET_LAYERS.len()],
            &mut grid,
        );
        apply_optional_rle(
            load_layer(LayerCategory::Visor, dna[4]),
            VISOR_LAYERS[(dna[4] as usize) % VISOR_LAYERS.len()],
            &mut grid,
        );
        apply_optional_rle(
            load_layer(LayerCategory::Relic, dna[5]),
            RELIC_LAYERS[(dna[5] as usize) % RELIC_LAYERS.len()],
            &mut grid,
        );
        overlay_frame(rec.rank_tier, &mut grid);

        let custom_pal = if season <= 1 {
            None
        } else {
            e.storage()
                .persistent()
                .get(&DataKey::SeasonPalette(season, dna[1] as u32))
        };
        let pal = resolve_palette(custom_pal, dna[1]);
        (rec, grid, pal)
    }
}

#[contractimpl(contracttrait)]
impl NonFungibleToken for Sorobits {
    type ContractType = Compose<(Enumerable, Burnable, Royalties)>;

    fn transfer(e: &Env, from: Address, to: Address, token_id: u32) {
        let rec = Self::load_record(e, token_id);
        if rec.soulbound {
            panic_with_error!(e, SorobitsError::SoulboundLocked);
        }
        Self::ContractType::transfer(e, &from, &to, token_id);
        Self::extend_ttl(e);
    }

    fn transfer_from(e: &Env, spender: Address, from: Address, to: Address, token_id: u32) {
        let rec = Self::load_record(e, token_id);
        if rec.soulbound {
            panic_with_error!(e, SorobitsError::SoulboundLocked);
        }
        Self::ContractType::transfer_from(e, &spender, &from, &to, token_id);
        Self::extend_ttl(e);
    }

    fn token_uri(e: &Env, token_id: u32) -> String {
        let (rec, grid, pal) = Self::compose_for_token(e, token_id);
        let dna = rec.dna.to_array();
        let mut w = ByteWriter::new();
        write_token_uri_json(&mut w, token_id, &rec, &dna, &grid, &pal);
        w.into_soroban_string(e)
    }
}

#[contractimpl(contracttrait)]
impl NonFungibleEnumerable for Sorobits {}

#[contractimpl(contracttrait)]
impl NonFungibleBurnable for Sorobits {
    fn burn(e: &Env, from: Address, token_id: u32) {
        Self::ContractType::burn(e, &from, token_id);
        e.storage().persistent().remove(&DataKey::Sorobit(token_id));
        Self::extend_ttl(e);
    }

    fn burn_from(e: &Env, spender: Address, from: Address, token_id: u32) {
        Self::ContractType::burn_from(e, &spender, &from, token_id);
        e.storage().persistent().remove(&DataKey::Sorobit(token_id));
        Self::extend_ttl(e);
    }
}

#[contractimpl(contracttrait)]
impl NonFungibleRoyalties for Sorobits {
    #[only_admin]
    fn set_default_royalty(e: &Env, receiver: Address, basis_points: u32, _operator: Address) {
        if basis_points > MAX_ROYALTY_BPS {
            panic_with_error!(e, SorobitsError::RoyaltyTooHigh);
        }
        Base::set_default_royalty(e, &receiver, basis_points);
        Self::extend_ttl(e);
    }

    #[only_admin]
    fn set_token_royalty(
        e: &Env,
        token_id: u32,
        receiver: Address,
        basis_points: u32,
        _operator: Address,
    ) {
        if basis_points > MAX_ROYALTY_BPS {
            panic_with_error!(e, SorobitsError::RoyaltyTooHigh);
        }
        Self::ContractType::set_token_royalty(e, token_id, &receiver, basis_points);
        Self::extend_ttl(e);
    }

    #[only_admin]
    fn remove_token_royalty(e: &Env, token_id: u32, _operator: Address) {
        Self::ContractType::remove_token_royalty(e, token_id);
        Self::extend_ttl(e);
    }
}

#[contractimpl(contracttrait)]
impl AccessControl for Sorobits {}
