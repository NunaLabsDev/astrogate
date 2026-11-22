//! Contrato principal Sorobits (`SBIT`) — SEP-50 NFT 100% On-Chain.
//!
//! Seguridad y arquitectura:
//! - SEP-50 completo: `NonFungibleToken` + `Enumerable` + `Burnable` + `Royalties` + `AccessControl`.
//! - Roles desacoplados: `curator` (capas/paletas y `seal_season`), `minter` (emisión),
//!   `telemetry` (actualización de marco epigenético y XP sin mutar el genoma base).
//! - Protección explícita de TTL (`90 días` instancia / `180 días` persistente).

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    symbol_short, token, Address, Bytes, BytesN, ContractExecutable, Env, String, Symbol, Vec,
};
use stellar_access::access_control::{self, AccessControl};
use stellar_macros::{only_admin, only_role};
use stellar_tokens::non_fungible::{
    burnable::{emit_burn, Burnable, NonFungibleBurnable},
    combinations::Compose,
    enumerable::{Enumerable, NonFungibleEnumerable},
    royalties::{NonFungibleRoyalties, Royalties, RoyaltySupport},
    Base, ContractOverrides, NonFungibleToken,
};

use crate::assets::{
    AURA_LAYERS, FACTION_COUNT, FACTION_PALETTES, GENESIS_TEMPLATES, HELMET_LAYERS, RELIC_LAYERS,
    SUIT_LAYERS, VISOR_LAYERS,
};
use crate::engine::{
    apply_optional_rle, overlay_frame, render_procedural_sky, resolve_palette, sanitize_genes,
    validate_palette45, validate_rle_layer, validate_rle_render_budget, write_svg,
    write_token_uri_json, ByteWriter, LayerCategory, SorobitRecord, PIXELS,
};

const DAY_IN_LEDGERS: u32 = 17_280;
pub const INSTANCE_BUMP_AMOUNT: u32 = 90 * DAY_IN_LEDGERS;
pub const INSTANCE_TTL_THRESHOLD: u32 = INSTANCE_BUMP_AMOUNT - (7 * DAY_IN_LEDGERS);
pub const PERSISTENT_BUMP_AMOUNT: u32 = 180 * DAY_IN_LEDGERS;
pub const PERSISTENT_TTL_THRESHOLD: u32 = PERSISTENT_BUMP_AMOUNT - (14 * DAY_IN_LEDGERS);

pub const MAX_GENESIS_ARCHETYPES: u32 = 8;
pub const MAX_RANK_TIER: u32 = 4;
pub const MAX_ROYALTY_BPS: u32 = 1_500; // Capped at 15% max creator royalty
/// Fee fijo de cápsula generativa (`7 XLM` en stroops) alineado con el fee del Launchpad.
pub const CAPSULE_MINT_FEE_STROOPS: i128 = 70_000_000;
/// Cupo base de cápsulas generativas para wallets nuevas antes de desbloquear más por actividad/Forja.
pub const BASE_CAPSULE_QUOTA: u32 = 2;
/// Mínimo de volumen acumulado (100 XLM) exigido por AGQ06 Whale Tracker.
pub const WHALE_MIN_VOLUME_STROOPS: i128 = 100 * 10_000_000;
/// Timelock mínimo de gobernanza (48h) y máximo (30d) para `propose_upgrade` -> `execute_upgrade`.
pub const MIN_UPGRADE_TIMELOCK_SECONDS: u64 = 48 * 3_600;
pub const MAX_UPGRADE_TIMELOCK_SECONDS: u64 = 30 * 86_400;

const ROLE_MINTER: Symbol = symbol_short!("minter");
const ROLE_CURATOR: Symbol = symbol_short!("curator");
const ROLE_TELEMETRY: Symbol = symbol_short!("telemetry");

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingUpgrade {
    pub wasm_hash: BytesN<32>,
    pub execute_after: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CapsuleCommit {
    pub commit_hash: BytesN<32>,
    pub commit_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ForgeCommit {
    pub commit_hash: BytesN<32>,
    pub commit_ledger: u32,
    pub next_gen: u32,
    pub next_tier: u32,
    pub next_base_xp: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LaunchpadPilotRecord {
    pub launches: u32,
    pub graduations: u32,
    pub trades: u32,
    pub volume_xlm_stroops: i128,
    pub shouts: u32,
    pub king_shouts: u32,
    pub burns_triggered: u32,
}

#[allow(dead_code)]
#[soroban_sdk::contractclient(name = "LaunchpadPilotClient")]
pub trait LaunchpadPilotInterface {
    fn get_pilot(e: &Env, user: Address) -> LaunchpadPilotRecord;
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    GenesisCapPerArchetype,
    GenesisMinted(u32),
    Sorobit(u32),
    ClaimedArchetype(Address, u32),
    CapsulesMinted(Address),
    LaunchpadAddress,
    XlmSac,
    Treasury,
    CapsuleFee,
    SeasonLayer(u32, u32, u32), // (season, LayerCategory as u32, layer_id)
    SeasonPalette(u32, u32),    // (season, faction_id)
    SeasonSealed(u32),
    SeasonActive,
    TokenBaseXp(u32),
    SeasonLayerCount(u32, u32), // (season, LayerCategory as u32)
    SeasonPaletteCount(u32),    // season
    PendingUpgrade,
    UpgradeDelay,
    PendingCapsuleCommit(Address),
    PendingForgeCommit(Address),
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
    AlreadyClaimed = 311,
    QuestNotUnlocked = 312,
    ForgeInvalidPair = 313,
    CapsuleQuotaReached = 314,
    PaymentNotConfigured = 315,
    InvalidFee = 316,
    UpgradeNotReady = 317,
    NoPendingUpgrade = 318,
    CommitPending = 319,
    CommitMissing = 320,
    CommitNotReady = 321,
    CommitMismatch = 322,
    DirectMintDisabled = 323,
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

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeProposedEvent {
    pub wasm_hash: BytesN<32>,
    pub execute_after: u64,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeExecutedEvent {
    pub wasm_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UpgradeCancelledEvent {
    pub wasm_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CapsuleCommittedEvent {
    #[topic]
    pub user: Address,
    pub commit_ledger: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ForgeCommittedEvent {
    #[topic]
    pub owner: Address,
    pub burn_id_a: u32,
    pub burn_id_b: u32,
    pub commit_ledger: u32,
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
        e.storage()
            .instance()
            .set(&DataKey::Treasury, &royalty_receiver);
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
        Self::mint_genesis_internal(e, &to, archetype_id, soulbound)
    }

    /// Vincula la dirección del contrato Launchpad para validar misiones y epigenética on-chain.
    #[only_admin]
    pub fn set_launchpad(e: &Env, launchpad: Address) {
        e.storage()
            .instance()
            .set(&DataKey::LaunchpadAddress, &launchpad);
        Self::extend_ttl(e);
    }

    pub fn get_launchpad(e: &Env) -> Option<Address> {
        e.storage().instance().get(&DataKey::LaunchpadAddress)
    }

    /// Configura el SAC nativo de XLM utilizado para minteo de cápsulas de 7 XLM.
    #[only_admin]
    pub fn set_xlm_sac(e: &Env, xlm_sac: Address) {
        e.storage().instance().set(&DataKey::XlmSac, &xlm_sac);
        Self::extend_ttl(e);
    }

    pub fn get_xlm_sac(e: &Env) -> Option<Address> {
        e.storage().instance().get(&DataKey::XlmSac)
    }

    /// Configura la dirección de tesorería receptora de comisiones de Cápsula (solo Admin).
    #[only_admin]
    pub fn set_treasury(e: &Env, treasury: Address) {
        e.storage().instance().set(&DataKey::Treasury, &treasury);
        Self::extend_ttl(e);
    }

    pub fn get_treasury(e: &Env) -> Option<Address> {
        e.storage().instance().get(&DataKey::Treasury)
    }

    /// Ajusta dinámicamente el precio en XLM de las Cápsulas Generativas (0..=100,000 XLM, solo Admin).
    #[only_admin]
    pub fn set_capsule_fee(e: &Env, fee_stroops: i128) {
        if !(0..=1_000_000_000_000).contains(&fee_stroops) {
            panic_with_error!(e, SorobitsError::InvalidFee);
        }
        e.storage()
            .instance()
            .set(&DataKey::CapsuleFee, &fee_stroops);
        Self::extend_ttl(e);
    }

    /// Devuelve el precio actual de una Cápsula Generativa Sorobit en stroops (default 7 XLM).
    pub fn get_capsule_fee(e: &Env) -> i128 {
        e.storage()
            .instance()
            .get(&DataKey::CapsuleFee)
            .unwrap_or(CAPSULE_MINT_FEE_STROOPS)
    }

    /// Calcula el cupo usado y el máximo permitido de Cápsulas Generativas para `user`
    /// (`(minted_active, max_allowed)`): base 2 + 1 por quest reclamada + trades/graduaciones/shouts.
    pub fn get_capsule_quota(e: &Env, user: Address) -> (u32, u32) {
        let cap_key = DataKey::CapsulesMinted(user.clone());
        let minted_active: u32 = e.storage().persistent().get(&cap_key).unwrap_or(0u32);
        let mut max_allowed = BASE_CAPSULE_QUOTA;

        for id in 1..=MAX_GENESIS_ARCHETYPES {
            if Self::has_claimed(e, user.clone(), id) {
                max_allowed = max_allowed.saturating_add(1);
            }
        }

        if let Some(lp) = Self::get_launchpad(e) {
            let pilot = LaunchpadPilotClient::new(e, &lp).get_pilot(&user);
            max_allowed = max_allowed
                .saturating_add(pilot.trades.min(10))
                .saturating_add(pilot.graduations.saturating_mul(3))
                .saturating_add(pilot.shouts.min(5));
        }

        (minted_active, max_allowed)
    }

    /// Paso 1 (Commit): Reserva una Cápsula Generativa pagando 7 XLM en XLM SAC y fijando
    /// `commit_hash = sha256(user_entropy)` en el ledger actual para impedir re-rolls atómicos de RNG.
    pub fn commit_capsule(e: &Env, user: Address, commit_hash: BytesN<32>) {
        user.require_auth();
        let commit_key = DataKey::PendingCapsuleCommit(user.clone());
        if e.storage().persistent().has(&commit_key) {
            panic_with_error!(e, SorobitsError::CommitPending);
        }

        let (minted_active, max_allowed) = Self::get_capsule_quota(e, user.clone());
        if minted_active >= max_allowed {
            panic_with_error!(e, SorobitsError::CapsuleQuotaReached);
        }

        let xlm_sac: Address = e
            .storage()
            .instance()
            .get(&DataKey::XlmSac)
            .unwrap_or_else(|| panic_with_error!(e, SorobitsError::PaymentNotConfigured));
        let treasury: Address = e
            .storage()
            .instance()
            .get(&DataKey::Treasury)
            .unwrap_or_else(|| panic_with_error!(e, SorobitsError::PaymentNotConfigured));

        let fee = Self::get_capsule_fee(e);
        if fee > 0 {
            token::Client::new(e, &xlm_sac).transfer(&user, &treasury, &fee);
        }

        let cap_key = DataKey::CapsulesMinted(user.clone());
        e.storage()
            .persistent()
            .set(&cap_key, &minted_active.saturating_add(1));
        Self::bump_persistent(e, &cap_key);

        let commit_ledger = e.ledger().sequence();
        e.storage().persistent().set(
            &commit_key,
            &CapsuleCommit {
                commit_hash,
                commit_ledger,
            },
        );
        Self::bump_persistent(e, &commit_key);
        Self::extend_ttl(e);

        CapsuleCommittedEvent {
            user,
            commit_ledger,
        }
        .publish(e);
    }

    /// Paso 2 (Reveal): En un ledger posterior al commit (`ledger > commit_ledger`), verifica la
    /// preimagen `user_entropy` y acuña la Cápsula Generativa con entropía imposible de predecir o re-rollear.
    pub fn reveal_capsule(e: &Env, user: Address, user_entropy: Bytes) -> u32 {
        user.require_auth();
        if user_entropy.is_empty() || user_entropy.len() > 64 {
            panic_with_error!(e, SorobitsError::EntropyEmpty);
        }
        let commit_key = DataKey::PendingCapsuleCommit(user.clone());
        let commit: CapsuleCommit = e
            .storage()
            .persistent()
            .get(&commit_key)
            .unwrap_or_else(|| panic_with_error!(e, SorobitsError::CommitMissing));
        if e.ledger().sequence() <= commit.commit_ledger {
            panic_with_error!(e, SorobitsError::CommitNotReady);
        }
        let actual_hash: BytesN<32> = e.crypto().sha256(&user_entropy).into();
        if actual_hash != commit.commit_hash {
            panic_with_error!(e, SorobitsError::CommitMismatch);
        }
        e.storage().persistent().remove(&commit_key);

        Self::mint_generative_with_seed(
            e,
            &user,
            &user_entropy,
            0,
            0,
            100,
            false,
            commit.commit_ledger,
        )
    }

    /// Devuelve el commit de Cápsula pendiente de revelar para `user`, si existe.
    pub fn get_pending_capsule_commit(e: &Env, user: Address) -> Option<CapsuleCommit> {
        let key = DataKey::PendingCapsuleCommit(user);
        if let Some(c) = e.storage().persistent().get::<DataKey, CapsuleCommit>(&key) {
            Self::bump_persistent(e, &key);
            Some(c)
        } else {
            None
        }
    }

    /// Deshabilitado en v4.5 por seguridad anti-reroll RNG; usar `commit_capsule` + `reveal_capsule`.
    pub fn mint_capsule(e: &Env, user: Address, _user_entropy: Bytes) -> u32 {
        user.require_auth();
        panic_with_error!(e, SorobitsError::DirectMintDisabled);
    }

    /// Permite a cualquier piloto reclamar 1 vez su Sorobit Genesis AGQ01 ("Floodgate Pioneer").
    pub fn claim_pioneer(e: &Env, user: Address) -> u32 {
        Self::claim_quest_badge(e, user, 1)
    }

    /// Permite reclamar cualquiera de los 8 arquetipos Genesis (`1..=8`) verificando on-chain
    /// la telemetría real del piloto en `Launchpad::get_pilot`.
    pub fn claim_quest_badge(e: &Env, user: Address, archetype_id: u32) -> u32 {
        user.require_auth();
        if !(1..=MAX_GENESIS_ARCHETYPES).contains(&archetype_id) {
            panic_with_error!(e, SorobitsError::InvalidArchetype);
        }
        if Self::has_claimed(e, user.clone(), archetype_id) {
            panic_with_error!(e, SorobitsError::AlreadyClaimed);
        }

        if archetype_id > 1 {
            let lp: Address = e
                .storage()
                .instance()
                .get(&DataKey::LaunchpadAddress)
                .unwrap_or_else(|| panic_with_error!(e, SorobitsError::QuestNotUnlocked));
            let pilot = LaunchpadPilotClient::new(e, &lp).get_pilot(&user);
            let unlocked = match archetype_id {
                2 => pilot.launches > 0,
                3 => pilot.shouts > 0,
                4 => pilot.graduations > 0,
                5 => pilot.trades > 0 || pilot.launches > 0 || pilot.shouts > 0,
                6 => pilot.volume_xlm_stroops >= WHALE_MIN_VOLUME_STROOPS,
                7 => pilot.king_shouts > 0 || pilot.burns_triggered >= 3,
                8 => {
                    let mut claimed_count = 0u32;
                    for id in 1..=7u32 {
                        if Self::has_claimed(e, user.clone(), id) {
                            claimed_count += 1;
                        }
                    }
                    claimed_count >= 4
                        && (pilot.graduations > 0 || Self::has_claimed(e, user.clone(), 4))
                }
                _ => false,
            };
            if !unlocked {
                panic_with_error!(e, SorobitsError::QuestNotUnlocked);
            }
        }

        let claim_key = DataKey::ClaimedArchetype(user.clone(), archetype_id);
        e.storage().persistent().set(&claim_key, &true);
        Self::bump_persistent(e, &claim_key);
        // AGQ01 Pioneer gratis (0 XLM) es Soulbound para frenar granjas Sybil de Forja.
        Self::mint_genesis_internal(e, &user, archetype_id, archetype_id == 1)
    }

    /// Sincroniza sin permisos el XP y `rank_tier` epigenético de un Sorobit desde el XP base
    /// propio del token (`TokenBaseXp`) más la actividad real del dueño actual (evita lavado Tier-4).
    pub fn sync_epigenetics(e: &Env, token_id: u32) -> SorobitRecord {
        let owner = <Self as NonFungibleToken>::ContractType::owner_of(e, token_id);
        let mut rec = Self::load_record(e, token_id);
        let base_xp = Self::load_base_xp(e, token_id, &rec);
        let owner_pilot_xp = Self::compute_pilot_xp(e, &owner);

        rec.xp_score = base_xp.saturating_add(owner_pilot_xp);
        let floor_tier = Self::min_intrinsic_tier(&rec);
        rec.rank_tier = Self::tier_from_xp(rec.xp_score, floor_tier);

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
        rec
    }

    /// Paso 1 (Commit): Quema 2 Sorobits transferibles del dueño y bloquea un commit criptográfico
    /// heredando únicamente el `TokenBaseXp` legítimo (sin aura lavada de otros pilotos).
    pub fn commit_forge(
        e: &Env,
        owner: Address,
        burn_id_a: u32,
        burn_id_b: u32,
        commit_hash: BytesN<32>,
    ) {
        owner.require_auth();
        let commit_key = DataKey::PendingForgeCommit(owner.clone());
        if e.storage().persistent().has(&commit_key) {
            panic_with_error!(e, SorobitsError::CommitPending);
        }
        if burn_id_a == burn_id_b {
            panic_with_error!(e, SorobitsError::ForgeInvalidPair);
        }
        if <Self as NonFungibleToken>::ContractType::owner_of(e, burn_id_a) != owner
            || <Self as NonFungibleToken>::ContractType::owner_of(e, burn_id_b) != owner
        {
            panic_with_error!(e, SorobitsError::ForgeInvalidPair);
        }

        let rec_a = Self::load_record(e, burn_id_a);
        let rec_b = Self::load_record(e, burn_id_b);
        if rec_a.soulbound || rec_b.soulbound {
            panic_with_error!(e, SorobitsError::SoulboundLocked);
        }
        let base_a = Self::load_base_xp(e, burn_id_a, &rec_a);
        let base_b = Self::load_base_xp(e, burn_id_b, &rec_b);

        Self::burn_without_reauth(e, &owner, burn_id_a);
        Self::burn_without_reauth(e, &owner, burn_id_b);

        // Forjar 2 Sorobits en 1 libera un slot activo de cápsula para mantener el loop deflacionario.
        let cap_key = DataKey::CapsulesMinted(owner.clone());
        let minted_active: u32 = e.storage().persistent().get(&cap_key).unwrap_or(0u32);
        if minted_active > 0 {
            e.storage().persistent().set(&cap_key, &(minted_active - 1));
            Self::bump_persistent(e, &cap_key);
        }

        let next_gen = rec_a.generation.max(rec_b.generation).saturating_add(1);
        let next_base_xp = base_a.saturating_add(base_b).saturating_add(500);
        let next_tier = Self::tier_from_xp(next_base_xp, next_gen);
        let commit_ledger = e.ledger().sequence();

        e.storage().persistent().set(
            &commit_key,
            &ForgeCommit {
                commit_hash,
                commit_ledger,
                next_gen,
                next_tier,
                next_base_xp,
            },
        );
        Self::bump_persistent(e, &commit_key);
        Self::extend_ttl(e);

        ForgeCommittedEvent {
            owner,
            burn_id_a,
            burn_id_b,
            commit_ledger,
        }
        .publish(e);
    }

    /// Paso 2 (Reveal): En un ledger posterior al `commit_forge`, verifica `user_entropy`
    /// y acuña el Sorobit ascendido `Gen + 1`.
    pub fn reveal_forge(e: &Env, owner: Address, user_entropy: Bytes) -> u32 {
        owner.require_auth();
        if user_entropy.is_empty() || user_entropy.len() > 64 {
            panic_with_error!(e, SorobitsError::EntropyEmpty);
        }
        let commit_key = DataKey::PendingForgeCommit(owner.clone());
        let commit: ForgeCommit = e
            .storage()
            .persistent()
            .get(&commit_key)
            .unwrap_or_else(|| panic_with_error!(e, SorobitsError::CommitMissing));
        if e.ledger().sequence() <= commit.commit_ledger {
            panic_with_error!(e, SorobitsError::CommitNotReady);
        }
        let actual_hash: BytesN<32> = e.crypto().sha256(&user_entropy).into();
        if actual_hash != commit.commit_hash {
            panic_with_error!(e, SorobitsError::CommitMismatch);
        }
        e.storage().persistent().remove(&commit_key);

        Self::mint_generative_with_seed(
            e,
            &owner,
            &user_entropy,
            commit.next_gen,
            commit.next_tier,
            commit.next_base_xp,
            false,
            commit.commit_ledger,
        )
    }

    /// Devuelve el commit de Forja pendiente de revelar para `owner`, si existe.
    pub fn get_pending_forge_commit(e: &Env, owner: Address) -> Option<ForgeCommit> {
        let key = DataKey::PendingForgeCommit(owner);
        if let Some(c) = e.storage().persistent().get::<DataKey, ForgeCommit>(&key) {
            Self::bump_persistent(e, &key);
            Some(c)
        } else {
            None
        }
    }

    /// Deshabilitado en v4.5 por seguridad anti-reroll RNG; usar `commit_forge` + `reveal_forge`.
    pub fn forge_ascend(
        e: &Env,
        owner: Address,
        _burn_id_a: u32,
        _burn_id_b: u32,
        _user_entropy: Bytes,
    ) -> u32 {
        owner.require_auth();
        panic_with_error!(e, SorobitsError::DirectMintDisabled);
    }

    /// Indica si una wallet ya reclamó un arquetipo Genesis específico.
    pub fn has_claimed(e: &Env, user: Address, archetype_id: u32) -> bool {
        e.storage()
            .persistent()
            .get(&DataKey::ClaimedArchetype(user, archetype_id))
            .unwrap_or(false)
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
        Self::mint_generative_with_seed(e, &to, &user_entropy, 0, 0, 0, soulbound, 0)
    }

    /// Actualiza la epigenética viva (`rank_tier` del marco TTL y `xp_score` base) sin alterar el genoma base.
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
        let next_base = Self::load_base_xp(e, token_id, &rec).saturating_add(add_xp);
        let base_key = DataKey::TokenBaseXp(token_id);
        e.storage().persistent().set(&base_key, &next_base);
        Self::bump_persistent(e, &base_key);

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
        if !(2..=255).contains(&season) || layer_id >= 255 {
            panic_with_error!(e, SorobitsError::InvalidSeason);
        }
        Self::assert_season_unsealed(e, season);
        let len = rle_bytes.len() as usize;
        if len == 0 || len > 2048 {
            panic_with_error!(e, SorobitsError::InvalidLayerRle);
        }
        let mut tmp = [0u8; 2048];
        rle_bytes.copy_into_slice(&mut tmp[..len]);
        if !validate_rle_layer(&tmp[..len])
            || !validate_rle_render_budget(&tmp[..len], &FACTION_PALETTES[0])
        {
            panic_with_error!(e, SorobitsError::InvalidLayerRle);
        }

        let cat_u32 = category as u32;
        let key = DataKey::SeasonLayer(season, cat_u32, layer_id);
        e.storage().persistent().set(&key, &rle_bytes);
        Self::bump_persistent(e, &key);

        let count_key = DataKey::SeasonLayerCount(season, cat_u32);
        let prev_count: u32 = e.storage().persistent().get(&count_key).unwrap_or(0);
        let next_count = prev_count.max(layer_id + 1);
        e.storage().persistent().set(&count_key, &next_count);
        Self::bump_persistent(e, &count_key);
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
        if !(2..=255).contains(&season) || faction_id >= 255 {
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

        let count_key = DataKey::SeasonPaletteCount(season);
        let prev_count: u32 = e.storage().persistent().get(&count_key).unwrap_or(0);
        let next_count = prev_count.max(faction_id + 1);
        e.storage().persistent().set(&count_key, &next_count);
        Self::bump_persistent(e, &count_key);
        Self::extend_ttl(e);
    }

    /// Configura el delay del timelock de actualización (`48h..=30d`, solo Admin).
    #[only_admin]
    pub fn set_upgrade_delay(e: &Env, delay_seconds: u64) {
        if !(MIN_UPGRADE_TIMELOCK_SECONDS..=MAX_UPGRADE_TIMELOCK_SECONDS).contains(&delay_seconds) {
            panic_with_error!(e, SorobitsError::InvalidFee);
        }
        e.storage()
            .instance()
            .set(&DataKey::UpgradeDelay, &delay_seconds);
        Self::extend_ttl(e);
    }

    /// Propone una actualización WASM sujeta a un timelock obligatorio `>= 48h` (solo Admin).
    #[only_admin]
    pub fn propose_upgrade(e: &Env, new_wasm_hash: BytesN<32>) -> PendingUpgrade {
        let delay: u64 = e
            .storage()
            .instance()
            .get(&DataKey::UpgradeDelay)
            .unwrap_or(MIN_UPGRADE_TIMELOCK_SECONDS)
            .max(MIN_UPGRADE_TIMELOCK_SECONDS);
        let execute_after = e.ledger().timestamp().saturating_add(delay);
        let pending = PendingUpgrade {
            wasm_hash: new_wasm_hash.clone(),
            execute_after,
        };
        e.storage()
            .instance()
            .set(&DataKey::PendingUpgrade, &pending);
        UpgradeProposedEvent {
            wasm_hash: new_wasm_hash,
            execute_after,
        }
        .publish(e);
        Self::extend_ttl(e);
        pending
    }

    /// Ejecuta una actualización WASM pendiente tras cumplirse su ventana mínima de timelock (solo Admin).
    #[only_admin]
    pub fn execute_upgrade(e: &Env) {
        let pending: PendingUpgrade = e
            .storage()
            .instance()
            .get(&DataKey::PendingUpgrade)
            .unwrap_or_else(|| panic_with_error!(e, SorobitsError::NoPendingUpgrade));
        if e.ledger().timestamp() < pending.execute_after {
            panic_with_error!(e, SorobitsError::UpgradeNotReady);
        }
        e.storage().instance().remove(&DataKey::PendingUpgrade);
        UpgradeExecutedEvent {
            wasm_hash: pending.wasm_hash.clone(),
        }
        .publish(e);
        e.deployer()
            .update_current_contract(ContractExecutable::Wasm(pending.wasm_hash));
    }

    /// Cancela una actualización WASM propuesta aún no ejecutada (solo Admin).
    #[only_admin]
    pub fn cancel_upgrade(e: &Env) {
        let pending: PendingUpgrade = e
            .storage()
            .instance()
            .get(&DataKey::PendingUpgrade)
            .unwrap_or_else(|| panic_with_error!(e, SorobitsError::NoPendingUpgrade));
        e.storage().instance().remove(&DataKey::PendingUpgrade);
        UpgradeCancelledEvent {
            wasm_hash: pending.wasm_hash,
        }
        .publish(e);
        Self::extend_ttl(e);
    }

    /// Devuelve la actualización WASM pendiente de ejecución, si existe.
    pub fn get_pending_upgrade(e: &Env) -> Option<PendingUpgrade> {
        e.storage().instance().get(&DataKey::PendingUpgrade)
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
        w.to_soroban_string(e)
    }

    /// Devuelve la versión animada (`5s` pulso de visor acorde al cierre SCP) para Mini App / galería.
    pub fn animated_svg(e: &Env, token_id: u32) -> String {
        let (_rec, grid, pal) = Self::compose_for_token(e, token_id);
        let mut w = ByteWriter::new();
        write_svg(&mut w, &grid, &pal, true);
        w.to_soroban_string(e)
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

    /// Paginación acotada de tokens de una cuenta para evitar límites de presupuesto Soroban.
    pub fn tokens_of_page(e: &Env, owner: Address, offset: u32, limit: u32) -> Vec<u32> {
        let count = <Self as NonFungibleToken>::ContractType::balance(e, &owner);
        let mut out = Vec::new(e);
        if offset >= count || limit == 0 {
            return out;
        }
        let end = offset.saturating_add(limit.min(50)).min(count);
        for idx in offset..end {
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

    /// Protege contra expiración/archivado el registro genómico y los assets de temporada de un token.
    pub fn extend_token_ttl(e: &Env, token_id: u32) {
        let _ = <Self as NonFungibleToken>::ContractType::owner_of(e, token_id);
        let key = DataKey::Sorobit(token_id);
        Self::bump_persistent(e, &key);
        Self::bump_persistent(e, &DataKey::TokenBaseXp(token_id));
        let rec = Self::load_record(e, token_id);
        Self::bump_season_assets_ttl(e, &rec.dna.to_array());
        Self::extend_ttl(e);
    }

    // ---------------- Helpers privados ----------------

    fn tier_from_xp(xp: u32, floor_tier: u32) -> u32 {
        let xp_tier = if xp >= 2_500 {
            4
        } else if xp >= 1_200 {
            3
        } else if xp >= 500 {
            2
        } else if xp >= 200 {
            1
        } else {
            0
        };
        xp_tier.max(floor_tier).min(MAX_RANK_TIER)
    }

    fn min_intrinsic_tier(rec: &SorobitRecord) -> u32 {
        if rec.edition >= 1 && rec.edition <= MAX_GENESIS_ARCHETYPES {
            GENESIS_TEMPLATES[(rec.edition - 1) as usize].frame as u32
        } else {
            rec.generation.min(MAX_RANK_TIER)
        }
    }

    fn load_base_xp(e: &Env, token_id: u32, rec: &SorobitRecord) -> u32 {
        let key = DataKey::TokenBaseXp(token_id);
        if let Some(base) = e.storage().persistent().get::<DataKey, u32>(&key) {
            Self::bump_persistent(e, &key);
            base
        } else if rec.generation > 0 {
            rec.xp_score
        } else if rec.edition == 0 {
            100
        } else {
            0
        }
    }

    fn compute_pilot_xp(e: &Env, owner: &Address) -> u32 {
        let mut claimed_count = 0u32;
        for id in 1..=MAX_GENESIS_ARCHETYPES {
            if Self::has_claimed(e, owner.clone(), id) {
                claimed_count += 1;
            }
        }
        let pilot = if let Some(lp) = Self::get_launchpad(e) {
            LaunchpadPilotClient::new(e, &lp).get_pilot(owner)
        } else {
            LaunchpadPilotRecord {
                launches: 0,
                graduations: 0,
                trades: 0,
                volume_xlm_stroops: 0,
                shouts: 0,
                king_shouts: 0,
                burns_triggered: 0,
            }
        };
        claimed_count
            .saturating_mul(150)
            .saturating_add(pilot.launches.saturating_mul(250))
            .saturating_add(pilot.graduations.saturating_mul(500))
            .saturating_add(pilot.trades.saturating_mul(50))
            .saturating_add(pilot.shouts.saturating_mul(100))
            .saturating_add(pilot.king_shouts.saturating_mul(400))
    }

    fn reset_epigenetics_on_transfer(e: &Env, token_id: u32, rec: &SorobitRecord) {
        let base_xp = Self::load_base_xp(e, token_id, rec);
        let floor_tier = Self::min_intrinsic_tier(rec);
        let reset_tier = Self::tier_from_xp(base_xp, floor_tier);
        if rec.xp_score == base_xp && rec.rank_tier == reset_tier {
            return;
        }
        let mut updated = rec.clone();
        updated.xp_score = base_xp;
        updated.rank_tier = reset_tier;
        let key = DataKey::Sorobit(token_id);
        e.storage().persistent().set(&key, &updated);
        Self::bump_persistent(e, &key);
        EpigeneticUpdatedEvent {
            token_id,
            rank_tier: updated.rank_tier,
            xp_score: updated.xp_score,
        }
        .publish(e);
    }

    fn season_palette_count(e: &Env, season: u32) -> u8 {
        if season <= 1 {
            return FACTION_COUNT as u8;
        }
        let key = DataKey::SeasonPaletteCount(season);
        let count: u32 = e.storage().persistent().get(&key).unwrap_or(0);
        if count > 0 {
            Self::bump_persistent(e, &key);
            count.min(255) as u8
        } else {
            FACTION_COUNT as u8
        }
    }

    fn season_layer_count(e: &Env, season: u32, category: LayerCategory, default_len: usize) -> u8 {
        if season <= 1 {
            return default_len as u8;
        }
        let key = DataKey::SeasonLayerCount(season, category as u32);
        let count: u32 = e.storage().persistent().get(&key).unwrap_or(0);
        if count > 0 {
            Self::bump_persistent(e, &key);
            count.min(255) as u8
        } else {
            default_len as u8
        }
    }

    fn mint_genesis_internal(e: &Env, to: &Address, archetype_id: u32, soulbound: bool) -> u32 {
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

        let token_id = <Self as NonFungibleToken>::ContractType::mint(e, to);
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
        let base_key = DataKey::TokenBaseXp(token_id);
        e.storage().persistent().set(&base_key, &0u32);
        Self::bump_persistent(e, &base_key);
        Self::extend_ttl(e);

        SorobitMintedEvent {
            to: to.clone(),
            token_id,
            edition: rec.edition,
            dna,
            soulbound,
        }
        .publish(e);
        token_id
    }

    #[allow(clippy::too_many_arguments)]
    fn mint_generative_with_seed(
        e: &Env,
        to: &Address,
        user_entropy: &Bytes,
        generation: u32,
        rank_tier: u32,
        base_xp: u32,
        soulbound: bool,
        commit_ledger: u32,
    ) -> u32 {
        if user_entropy.is_empty() || user_entropy.len() > 64 {
            panic_with_error!(e, SorobitsError::EntropyEmpty);
        }
        let token_id = <Self as NonFungibleToken>::ContractType::mint(e, to);
        let season: u32 = e
            .storage()
            .instance()
            .get(&DataKey::SeasonActive)
            .unwrap_or(1);

        let prng_bytes: [u8; 32] = e.prng().gen();
        let mut preimage = Bytes::new(e);
        preimage.extend_from_slice(&e.ledger().sequence().to_le_bytes());
        preimage.extend_from_slice(&e.ledger().timestamp().to_le_bytes());
        preimage.extend_from_slice(&commit_ledger.to_le_bytes());
        preimage.extend_from_slice(&token_id.to_le_bytes());
        preimage.extend_from_slice(&prng_bytes);
        preimage.append(user_entropy);
        let hash: BytesN<32> = e.crypto().sha256(&preimage).into();
        let mut dna_bytes = hash.to_array();

        let faction = dna_bytes[1] % Self::season_palette_count(e, season);
        let suit = dna_bytes[2]
            % Self::season_layer_count(e, season, LayerCategory::Suit, SUIT_LAYERS.len());
        let helmet = dna_bytes[3]
            % Self::season_layer_count(e, season, LayerCategory::Helmet, HELMET_LAYERS.len());
        let visor = dna_bytes[4]
            % Self::season_layer_count(e, season, LayerCategory::Visor, VISOR_LAYERS.len());
        let mut relic = dna_bytes[5]
            % Self::season_layer_count(e, season, LayerCategory::Relic, RELIC_LAYERS.len());
        let mut aura = dna_bytes[6]
            % Self::season_layer_count(e, season, LayerCategory::Aura, AURA_LAYERS.len());
        if season <= 1 {
            sanitize_genes(helmet, visor, &mut relic, &mut aura);
        }

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
            generation,
            rank_tier,
            xp_score: base_xp,
            born_ledger: e.ledger().sequence(),
            soulbound,
        };

        let key = DataKey::Sorobit(token_id);
        e.storage().persistent().set(&key, &rec);
        Self::bump_persistent(e, &key);
        let base_key = DataKey::TokenBaseXp(token_id);
        e.storage().persistent().set(&base_key, &base_xp);
        Self::bump_persistent(e, &base_key);
        Self::extend_ttl(e);

        SorobitMintedEvent {
            to: to.clone(),
            token_id,
            edition: 0,
            dna,
            soulbound,
        }
        .publish(e);
        token_id
    }

    fn derive_entropy(e: &Env, token_id: u32, salt: u8) -> [u8; 32] {
        let prng_bytes: [u8; 32] = e.prng().gen();
        let mut pre = Bytes::new(e);
        pre.extend_from_slice(&e.ledger().sequence().to_le_bytes());
        pre.extend_from_slice(&e.ledger().timestamp().to_le_bytes());
        pre.extend_from_slice(&token_id.to_le_bytes());
        pre.extend_from_slice(&prng_bytes);
        pre.push_back(salt);
        let h: BytesN<32> = e.crypto().sha256(&pre).into();
        h.to_array()
    }

    /// Quema interna tras haber autenticado a `owner` una sola vez en la invocación padre,
    /// evitando `Error(Auth, ExistingValue)` en Soroban SDK 28.
    fn burn_without_reauth(e: &Env, owner: &Address, token_id: u32) {
        Base::update(e, Some(owner), None, token_id);
        Enumerable::remove_from_enumerations(e, owner, token_id);
        emit_burn(e, owner, token_id);
        e.storage().persistent().remove(&DataKey::Sorobit(token_id));
        e.storage()
            .persistent()
            .remove(&DataKey::TokenBaseXp(token_id));
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
            e.storage().persistent().extend_ttl(
                key,
                PERSISTENT_TTL_THRESHOLD,
                PERSISTENT_BUMP_AMOUNT,
            );
        }
    }

    fn assert_season_unsealed(e: &Env, season: u32) {
        if Self::is_season_sealed(e, season) {
            panic_with_error!(e, SorobitsError::SeasonAlreadySealed);
        }
    }

    fn bump_season_assets_ttl(e: &Env, dna: &[u8; 32]) {
        let season = dna[0] as u32;
        Self::bump_persistent(e, &DataKey::SeasonSealed(season));
        if season <= 1 {
            return;
        }
        let layers = [
            (LayerCategory::Aura, dna[6]),
            (LayerCategory::Suit, dna[2]),
            (LayerCategory::Helmet, dna[3]),
            (LayerCategory::Visor, dna[4]),
            (LayerCategory::Relic, dna[5]),
        ];
        for (cat, id) in layers {
            Self::bump_persistent(e, &DataKey::SeasonLayer(season, cat as u32, id as u32));
        }
        Self::bump_persistent(e, &DataKey::SeasonPalette(season, dna[1] as u32));
    }

    fn compose_for_token(e: &Env, token_id: u32) -> (SorobitRecord, [u8; PIXELS], [u8; 45]) {
        let _ = <Self as NonFungibleToken>::ContractType::owner_of(e, token_id);
        let rec = Self::load_record(e, token_id);
        let dna = rec.dna.to_array();
        Self::bump_season_assets_ttl(e, &dna);
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
        Self::reset_epigenetics_on_transfer(e, token_id, &rec);
        Self::extend_ttl(e);
    }

    fn transfer_from(e: &Env, spender: Address, from: Address, to: Address, token_id: u32) {
        let rec = Self::load_record(e, token_id);
        if rec.soulbound {
            panic_with_error!(e, SorobitsError::SoulboundLocked);
        }
        Self::ContractType::transfer_from(e, &spender, &from, &to, token_id);
        Self::reset_epigenetics_on_transfer(e, token_id, &rec);
        Self::extend_ttl(e);
    }

    fn token_uri(e: &Env, token_id: u32) -> String {
        let (rec, grid, pal) = Self::compose_for_token(e, token_id);
        let dna = rec.dna.to_array();
        let mut w = ByteWriter::new();
        write_token_uri_json(&mut w, token_id, &rec, &dna, &grid, &pal);
        w.to_soroban_string(e)
    }
}

#[contractimpl(contracttrait)]
impl NonFungibleEnumerable for Sorobits {}

#[contractimpl(contracttrait)]
impl NonFungibleBurnable for Sorobits {
    fn burn(e: &Env, from: Address, token_id: u32) {
        Self::ContractType::burn(e, &from, token_id);
        e.storage().persistent().remove(&DataKey::Sorobit(token_id));
        e.storage()
            .persistent()
            .remove(&DataKey::TokenBaseXp(token_id));
        Self::extend_ttl(e);
    }

    fn burn_from(e: &Env, spender: Address, from: Address, token_id: u32) {
        Self::ContractType::burn_from(e, &spender, &from, token_id);
        e.storage().persistent().remove(&DataKey::Sorobit(token_id));
        e.storage()
            .persistent()
            .remove(&DataKey::TokenBaseXp(token_id));
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
