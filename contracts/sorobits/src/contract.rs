//! Contrato principal Sorobits (`SBIT`) — SEP-50 NFT 100% On-Chain.
//!
//! Seguridad y arquitectura:
//! - SEP-50 completo: `NonFungibleToken` + `Enumerable` + `Burnable` + `Royalties` + `AccessControl`.
//! - Roles desacoplados: `curator` (capas/paletas y `seal_season`), `minter` (emisión),
//!   `telemetry` (actualización de marco epigenético y XP sin mutar el genoma base).
//! - Protección explícita de TTL (`90 días` instancia / `180 días` persistente).

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error,
    symbol_short, token, xdr::ToXdr, Address, Bytes, BytesN, ContractExecutable, Env, String,
    Symbol, Vec,
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
/// Techo máximo configurable para cápsulas generativas (`1,000 XLM`).
pub const CAPSULE_MAX_FEE_STROOPS: i128 = 10_000_000_000;
/// Cupo base de cápsulas generativas para wallets nuevas antes de desbloquear más por actividad/Forja.
pub const BASE_CAPSULE_QUOTA: u32 = 2;
/// Timelock obligatorio de 48 horas para upgrades del contrato WASM.
pub const UPGRADE_TIMELOCK_SECONDS: u64 = 48 * 3_600;
pub const STORAGE_VERSION_V1: u32 = 1;
/// TTL temporal de ~1 hora (`720` ledgers) para commits anti-frontrunning antes de revelar.
const COMMIT_TTL_LEDGERS: u32 = 720;
const MAX_CUSTOM_ASSET_ID: u32 = 15;
const MAX_TOKENS_PAGE: u32 = 50;

const ROLE_MINTER: Symbol = symbol_short!("minter");
const ROLE_CURATOR: Symbol = symbol_short!("curator");
const ROLE_TELEMETRY: Symbol = symbol_short!("telemetry");

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
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingUpgradeData {
    pub wasm_hash: BytesN<32>,
    pub scheduled_at: u64,
    pub execute_after: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MintCommitData {
    pub commitment: BytesN<32>,
    pub commit_ledger: u32,
    pub commit_ts: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ForgeCommitData {
    pub commitment: BytesN<32>,
    pub burn_a: u32,
    pub burn_b: u32,
    pub commit_ledger: u32,
    pub commit_ts: u64,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    GenesisCapPerArchetype,
    GenesisMinted(u32),
    Sorobit(u32),
    TokenXpBaseline(u32),
    ClaimedArchetype(Address, u32),
    CapsulesMinted(Address),
    CapsuleCommit(Address),
    ForgeCommit(Address),
    InstantMintAllowed,
    StorageVersion,
    PendingUpgrade,
    LaunchpadAddress,
    XlmSac,
    Treasury,
    CapsuleFee,
    SeasonLayer(u32, u32, u32), // (season, LayerCategory as u32, layer_id)
    SeasonPalette(u32, u32),    // (season, faction_id)
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
    AlreadyClaimed = 311,
    QuestNotUnlocked = 312,
    ForgeInvalidPair = 313,
    CapsuleQuotaReached = 314,
    PaymentNotConfigured = 315,
    SvgBudgetExceeded = 316,
    InvalidFee = 317,
    SeasonNotSealed = 318,
    InstantMintDisabled = 319,
    CommitmentNotFound = 320,
    CommitmentNotReady = 321,
    CommitmentMismatch = 322,
    UpgradeAlreadyPending = 323,
    NoPendingUpgrade = 324,
    UpgradeTimelockActive = 325,
    InvalidUpgradeHash = 326,
    InvalidAssetId = 327,
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
pub struct CapsuleFeeUpdatedEvent {
    pub fee_stroops: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TreasuryUpdatedEvent {
    #[topic]
    pub treasury: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LaunchpadUpdatedEvent {
    #[topic]
    pub launchpad: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct XlmSacUpdatedEvent {
    #[topic]
    pub xlm_sac: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ActiveSeasonUpdatedEvent {
    pub season: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstantMintModeEvent {
    pub enabled: bool,
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
pub struct CapsuleCommittedEvent {
    #[topic]
    pub minter: Address,
    pub commitment: BytesN<32>,
    pub commit_ledger: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ForgeCommittedEvent {
    #[topic]
    pub owner: Address,
    pub burn_a: u32,
    pub burn_b: u32,
    pub commitment: BytesN<32>,
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
        e.storage()
            .instance()
            .set(&DataKey::InstantMintAllowed, &false);
        e.storage()
            .instance()
            .set(&DataKey::StorageVersion, &STORAGE_VERSION_V1);

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
        LaunchpadUpdatedEvent { launchpad }.publish(e);
    }

    pub fn get_launchpad(e: &Env) -> Option<Address> {
        e.storage().instance().get(&DataKey::LaunchpadAddress)
    }

    /// Configura el SAC nativo de XLM utilizado para minteo de cápsulas de 7 XLM.
    #[only_admin]
    pub fn set_xlm_sac(e: &Env, xlm_sac: Address) {
        e.storage().instance().set(&DataKey::XlmSac, &xlm_sac);
        Self::extend_ttl(e);
        XlmSacUpdatedEvent { xlm_sac }.publish(e);
    }

    pub fn get_xlm_sac(e: &Env) -> Option<Address> {
        e.storage().instance().get(&DataKey::XlmSac)
    }

    /// Configura la dirección de tesorería receptora de comisiones de Cápsula (solo Admin).
    #[only_admin]
    pub fn set_treasury(e: &Env, treasury: Address) {
        e.storage().instance().set(&DataKey::Treasury, &treasury);
        Self::extend_ttl(e);
        TreasuryUpdatedEvent { treasury }.publish(e);
    }

    pub fn get_treasury(e: &Env) -> Option<Address> {
        e.storage().instance().get(&DataKey::Treasury)
    }

    /// Ajusta dinámicamente el precio en XLM de las Cápsulas Generativas (0..=1,000 XLM, solo Admin).
    #[only_admin]
    pub fn set_capsule_fee(e: &Env, fee_stroops: i128) {
        if !(0..=CAPSULE_MAX_FEE_STROOPS).contains(&fee_stroops) {
            panic_with_error!(e, SorobitsError::InvalidFee);
        }
        e.storage()
            .instance()
            .set(&DataKey::CapsuleFee, &fee_stroops);
        Self::extend_ttl(e);
        CapsuleFeeUpdatedEvent { fee_stroops }.publish(e);
    }

    /// Habilita o deshabilita el modo legado instantáneo de cápsula/forja (deshabilitado por defecto).
    #[only_admin]
    pub fn set_instant_mint_allowed(e: &Env, enabled: bool) {
        e.storage()
            .instance()
            .set(&DataKey::InstantMintAllowed, &enabled);
        Self::extend_ttl(e);
        InstantMintModeEvent { enabled }.publish(e);
    }

    pub fn is_instant_mint_allowed(e: &Env) -> bool {
        e.storage()
            .instance()
            .get(&DataKey::InstantMintAllowed)
            .unwrap_or(false)
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

    /// Paso 1 (Commit-Reveal anti-frontrunning): compromete `sha256(minter_xdr || secret || "SBIT_CAP_V1")`
    /// antes de revelar en un ledger posterior (`reveal_capsule`).
    pub fn commit_capsule(e: &Env, minter: Address, commitment: BytesN<32>) {
        minter.require_auth();
        if commitment == BytesN::from_array(e, &[0u8; 32]) {
            panic_with_error!(e, SorobitsError::EntropyEmpty);
        }
        let (minted_active, max_allowed) = Self::get_capsule_quota(e, minter.clone());
        if minted_active >= max_allowed {
            panic_with_error!(e, SorobitsError::CapsuleQuotaReached);
        }
        let key = DataKey::CapsuleCommit(minter.clone());
        let commit_ledger = e.ledger().sequence();
        let commit = MintCommitData {
            commitment: commitment.clone(),
            commit_ledger,
            commit_ts: e.ledger().timestamp(),
        };
        e.storage().temporary().set(&key, &commit);
        e.storage()
            .temporary()
            .extend_ttl(&key, COMMIT_TTL_LEDGERS, COMMIT_TTL_LEDGERS);
        Self::extend_ttl(e);
        CapsuleCommittedEvent {
            minter,
            commitment,
            commit_ledger,
        }
        .publish(e);
    }

    /// Paso 2 (Commit-Reveal): revela `secret` en un ledger posterior al commit, cobra 7 XLM
    /// y acuña la Cápsula Generativa con entropía no pre-simulable en el bloque del commit.
    pub fn reveal_capsule(e: &Env, minter: Address, secret: BytesN<32>) -> u32 {
        minter.require_auth();
        let key = DataKey::CapsuleCommit(minter.clone());
        let commit: MintCommitData = e
            .storage()
            .temporary()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(e, SorobitsError::CommitmentNotFound));
        if e.ledger().sequence() <= commit.commit_ledger {
            panic_with_error!(e, SorobitsError::CommitmentNotReady);
        }
        let mut preimage = minter.clone().to_xdr(e);
        preimage.extend_from_slice(&secret.to_array());
        preimage.extend_from_slice(b"SBIT_CAP_V1");
        let expected: BytesN<32> = e.crypto().sha256(&preimage).into();
        if expected != commit.commitment {
            panic_with_error!(e, SorobitsError::CommitmentMismatch);
        }
        e.storage().temporary().remove(&key);

        let entropy = Bytes::from_slice(e, &secret.to_array());
        Self::execute_capsule_internal(e, &minter, &entropy)
    }

    /// Modo legado instantáneo de Cápsula (bloqueado por defecto con `InstantMintDisabled`;
    /// use `commit_capsule` + `reveal_capsule` en producción).
    pub fn mint_capsule(e: &Env, user: Address, user_entropy: Bytes) -> u32 {
        user.require_auth();
        if !Self::is_instant_mint_allowed(e) {
            panic_with_error!(e, SorobitsError::InstantMintDisabled);
        }
        if user_entropy.is_empty() || user_entropy.len() > 64 {
            panic_with_error!(e, SorobitsError::EntropyEmpty);
        }
        Self::execute_capsule_internal(e, &user, &user_entropy)
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
                6 => pilot.trades > 0,
                7 => pilot.king_shouts > 0 || pilot.burns_triggered > 0,
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

    /// Sincroniza sin permisos el XP y `rank_tier` epigenético de un Sorobit desde la actividad
    /// real on-chain de su dueño, descontando la línea base del receptor al transferir (`TokenXpBaseline`).
    pub fn sync_epigenetics(e: &Env, token_id: u32) -> SorobitRecord {
        let owner = <Self as NonFungibleToken>::ContractType::owner_of(e, token_id);
        let mut rec = Self::load_record_and_bump(e, token_id);

        let computed_xp = Self::compute_address_xp(e, &owner);
        let baseline: u32 = e
            .storage()
            .persistent()
            .get(&DataKey::TokenXpBaseline(token_id))
            .unwrap_or(0);
        let net_xp = computed_xp.saturating_sub(baseline);

        rec.xp_score = rec.xp_score.max(net_xp);
        let tier = if rec.xp_score >= 2_500 {
            4
        } else if rec.xp_score >= 1_200 {
            3
        } else if rec.xp_score >= 500 {
            2
        } else if rec.xp_score >= 200 {
            1
        } else {
            0
        };
        rec.rank_tier = rec.rank_tier.max(tier).min(MAX_RANK_TIER);

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

    /// Paso 1 (Commit-Reveal de Forja): compromete `sha256(owner_xdr || secret || burn_a || burn_b || "SBIT_FRG_V1")`
    /// verificando propiedad y estado no-soulbound de ambos Sorobits antes de revelar en ledger posterior.
    pub fn commit_forge(
        e: &Env,
        owner: Address,
        burn_id_a: u32,
        burn_id_b: u32,
        commitment: BytesN<32>,
    ) {
        owner.require_auth();
        if commitment == BytesN::from_array(e, &[0u8; 32]) {
            panic_with_error!(e, SorobitsError::EntropyEmpty);
        }
        Self::validate_forge_parents(e, &owner, burn_id_a, burn_id_b);

        let key = DataKey::ForgeCommit(owner.clone());
        let commit_ledger = e.ledger().sequence();
        let commit = ForgeCommitData {
            commitment: commitment.clone(),
            burn_a: burn_id_a,
            burn_b: burn_id_b,
            commit_ledger,
            commit_ts: e.ledger().timestamp(),
        };
        e.storage().temporary().set(&key, &commit);
        e.storage()
            .temporary()
            .extend_ttl(&key, COMMIT_TTL_LEDGERS, COMMIT_TTL_LEDGERS);
        Self::extend_ttl(e);
        ForgeCommittedEvent {
            owner,
            burn_a: burn_id_a,
            burn_b: burn_id_b,
            commitment,
            commit_ledger,
        }
        .publish(e);
    }

    /// Paso 2 (Commit-Reveal de Forja): revela `secret` en un ledger posterior, quema ambos Sorobits
    /// transferibles y forja el Sorobit ascendido (`Gen + 1`).
    pub fn reveal_forge(e: &Env, owner: Address, secret: BytesN<32>) -> u32 {
        owner.require_auth();
        let key = DataKey::ForgeCommit(owner.clone());
        let commit: ForgeCommitData = e
            .storage()
            .temporary()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(e, SorobitsError::CommitmentNotFound));
        if e.ledger().sequence() <= commit.commit_ledger {
            panic_with_error!(e, SorobitsError::CommitmentNotReady);
        }
        let mut preimage = owner.clone().to_xdr(e);
        preimage.extend_from_slice(&secret.to_array());
        preimage.extend_from_slice(&commit.burn_a.to_le_bytes());
        preimage.extend_from_slice(&commit.burn_b.to_le_bytes());
        preimage.extend_from_slice(b"SBIT_FRG_V1");
        let expected: BytesN<32> = e.crypto().sha256(&preimage).into();
        if expected != commit.commitment {
            panic_with_error!(e, SorobitsError::CommitmentMismatch);
        }
        e.storage().temporary().remove(&key);

        let entropy = Bytes::from_slice(e, &secret.to_array());
        Self::execute_forge_internal(e, &owner, commit.burn_a, commit.burn_b, &entropy)
    }

    /// Modo legado instantáneo de Forja (bloqueado por defecto con `InstantMintDisabled`;
    /// use `commit_forge` + `reveal_forge` en producción).
    pub fn forge_ascend(
        e: &Env,
        owner: Address,
        burn_id_a: u32,
        burn_id_b: u32,
        user_entropy: Bytes,
    ) -> u32 {
        owner.require_auth();
        if !Self::is_instant_mint_allowed(e) {
            panic_with_error!(e, SorobitsError::InstantMintDisabled);
        }
        if user_entropy.is_empty() || user_entropy.len() > 64 {
            panic_with_error!(e, SorobitsError::EntropyEmpty);
        }
        Self::execute_forge_internal(e, &owner, burn_id_a, burn_id_b, &user_entropy)
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
        Self::mint_generative_internal(e, &to, &user_entropy, 0, 0, 0, soulbound)
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
        let mut rec = Self::load_record_and_bump(e, token_id);
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
        if layer_id > MAX_CUSTOM_ASSET_ID {
            panic_with_error!(e, SorobitsError::InvalidAssetId);
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
        if faction_id > MAX_CUSTOM_ASSET_ID {
            panic_with_error!(e, SorobitsError::InvalidAssetId);
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

    /// Programa un upgrade WASM detrás de un timelock obligatorio de 48 horas (solo Admin).
    #[only_admin]
    pub fn schedule_upgrade(e: &Env, new_wasm_hash: BytesN<32>) {
        if new_wasm_hash == BytesN::from_array(e, &[0u8; 32]) {
            panic_with_error!(e, SorobitsError::InvalidUpgradeHash);
        }
        let key = DataKey::PendingUpgrade;
        if e.storage().persistent().has(&key) {
            panic_with_error!(e, SorobitsError::UpgradeAlreadyPending);
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
    }

    /// Cancela un upgrade WASM programado antes de ejecutarse (solo Admin).
    #[only_admin]
    pub fn cancel_upgrade(e: &Env) {
        let key = DataKey::PendingUpgrade;
        let pending: PendingUpgradeData = e
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(e, SorobitsError::NoPendingUpgrade));
        e.storage().persistent().remove(&key);
        Self::extend_ttl(e);
        UpgradeCancelledEvent {
            wasm_hash: pending.wasm_hash,
        }
        .publish(e);
    }

    /// Ejecuta el upgrade WASM programado tras vencer las 48 horas (solo Admin).
    #[only_admin]
    pub fn execute_upgrade(e: &Env) {
        let key = DataKey::PendingUpgrade;
        let pending: PendingUpgradeData = e
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(e, SorobitsError::NoPendingUpgrade));
        if e.ledger().timestamp() < pending.execute_after {
            panic_with_error!(e, SorobitsError::UpgradeTimelockActive);
        }
        e.storage().persistent().remove(&key);
        Self::extend_ttl(e);
        UpgradeExecutedEvent {
            wasm_hash: pending.wasm_hash.clone(),
        }
        .publish(e);
        e.deployer()
            .update_current_contract(ContractExecutable::Wasm(pending.wasm_hash));
    }

    pub fn get_pending_upgrade(e: &Env) -> Option<PendingUpgradeData> {
        e.storage().persistent().get(&DataKey::PendingUpgrade)
    }

    pub fn get_storage_version(e: &Env) -> u32 {
        e.storage()
            .instance()
            .get(&DataKey::StorageVersion)
            .unwrap_or(STORAGE_VERSION_V1)
    }

    /// Cambia la temporada activa para nuevos mints generativos (`1..=255`, solo temporadas selladas).
    #[only_admin]
    pub fn set_active_season(e: &Env, season: u32) {
        if !(1..=255).contains(&season) {
            panic_with_error!(e, SorobitsError::InvalidSeason);
        }
        if !Self::is_season_sealed(e, season) {
            panic_with_error!(e, SorobitsError::SeasonNotSealed);
        }
        e.storage().instance().set(&DataKey::SeasonActive, &season);
        Self::extend_ttl(e);
        ActiveSeasonUpdatedEvent { season }.publish(e);
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

    /// Devuelve el SVG estático 100% nativo (`<svg ...>...</svg>`) del Sorobit (lectura pura).
    pub fn render_svg(e: &Env, token_id: u32) -> String {
        let (_rec, grid, pal) = Self::compose_for_token(e, token_id);
        let mut w = ByteWriter::new();
        write_svg(&mut w, &grid, &pal, false);
        w.to_soroban_string(e)
            .unwrap_or_else(|| panic_with_error!(e, SorobitsError::SvgBudgetExceeded))
    }

    /// Devuelve la versión animada (`5s` pulso de visor acorde al cierre SCP, lectura pura).
    pub fn animated_svg(e: &Env, token_id: u32) -> String {
        let (_rec, grid, pal) = Self::compose_for_token(e, token_id);
        let mut w = ByteWriter::new();
        write_svg(&mut w, &grid, &pal, true);
        w.to_soroban_string(e)
            .unwrap_or_else(|| panic_with_error!(e, SorobitsError::SvgBudgetExceeded))
    }

    /// Devuelve los 1,024 índices semánticos resueltos (`0..=15`) + 45 bytes de paleta RGB (`1,069` bytes).
    pub fn raw_bitmap(e: &Env, token_id: u32) -> Bytes {
        let (_rec, grid, pal) = Self::compose_for_token(e, token_id);
        let mut out = Bytes::from_slice(e, &grid);
        out.extend_from_slice(&pal);
        out
    }

    /// Devuelve el registro genómico y telemétrico completo de un Sorobit (lectura pura).
    pub fn get_sorobit(e: &Env, token_id: u32) -> SorobitRecord {
        let _ = <Self as NonFungibleToken>::ContractType::owner_of(e, token_id);
        Self::peek_record(e, token_id)
    }

    /// Devuelve los primeros `MAX_TOKENS_PAGE` IDs minteados para una cuenta (`tokens_of_page` para más).
    pub fn tokens_of(e: &Env, owner: Address) -> Vec<u32> {
        let count =
            <Self as NonFungibleToken>::ContractType::balance(e, &owner).min(MAX_TOKENS_PAGE);
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
        let end = offset.saturating_add(limit.min(MAX_TOKENS_PAGE)).min(count);
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

    /// Protege contra expiración/archivado el registro genómico, baseline de XP y assets de temporada.
    pub fn extend_token_ttl(e: &Env, token_id: u32) {
        let _ = <Self as NonFungibleToken>::ContractType::owner_of(e, token_id);
        let rec = Self::load_record_and_bump(e, token_id);
        Self::bump_persistent(e, &DataKey::TokenXpBaseline(token_id));
        Self::bump_season_assets_ttl(e, &rec.dna.to_array());
        Self::extend_ttl(e);
    }

    /// Extiende TTL de cupos de cápsulas y badges Genesis reclamados por `user`.
    pub fn extend_user_ttl(e: &Env, user: Address) {
        Self::bump_persistent(e, &DataKey::CapsulesMinted(user.clone()));
        for id in 1..=MAX_GENESIS_ARCHETYPES {
            Self::bump_persistent(e, &DataKey::ClaimedArchetype(user.clone(), id));
        }
        Self::extend_ttl(e);
    }

    // ---------------- Helpers privados ----------------

    fn execute_capsule_internal(e: &Env, user: &Address, entropy: &Bytes) -> u32 {
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
            token::Client::new(e, &xlm_sac).transfer(user, &treasury, &fee);
        }

        let cap_key = DataKey::CapsulesMinted(user.clone());
        e.storage()
            .persistent()
            .set(&cap_key, &minted_active.saturating_add(1));
        Self::bump_persistent(e, &cap_key);

        Self::mint_generative_internal(e, user, entropy, 0, 0, 100, false)
    }

    fn validate_forge_parents(
        e: &Env,
        owner: &Address,
        burn_id_a: u32,
        burn_id_b: u32,
    ) -> (SorobitRecord, SorobitRecord) {
        if burn_id_a == burn_id_b {
            panic_with_error!(e, SorobitsError::ForgeInvalidPair);
        }
        if <Self as NonFungibleToken>::ContractType::owner_of(e, burn_id_a) != *owner
            || <Self as NonFungibleToken>::ContractType::owner_of(e, burn_id_b) != *owner
        {
            panic_with_error!(e, SorobitsError::ForgeInvalidPair);
        }
        let rec_a = Self::peek_record(e, burn_id_a);
        let rec_b = Self::peek_record(e, burn_id_b);
        if rec_a.soulbound || rec_b.soulbound {
            panic_with_error!(e, SorobitsError::SoulboundLocked);
        }
        (rec_a, rec_b)
    }

    fn execute_forge_internal(
        e: &Env,
        owner: &Address,
        burn_id_a: u32,
        burn_id_b: u32,
        entropy: &Bytes,
    ) -> u32 {
        let (rec_a, rec_b) = Self::validate_forge_parents(e, owner, burn_id_a, burn_id_b);
        Self::burn_without_reauth(e, owner, burn_id_a);
        Self::burn_without_reauth(e, owner, burn_id_b);

        // Forjar 2 Sorobits en 1 libera un slot activo de cápsula para mantener el loop deflacionario.
        let cap_key = DataKey::CapsulesMinted(owner.clone());
        let minted_active: u32 = e.storage().persistent().get(&cap_key).unwrap_or(0u32);
        if minted_active > 0 {
            e.storage().persistent().set(&cap_key, &(minted_active - 1));
            Self::bump_persistent(e, &cap_key);
        }

        let next_gen = rec_a.generation.max(rec_b.generation).saturating_add(1);
        let next_tier = (rec_a.rank_tier.max(rec_b.rank_tier) + 1).min(MAX_RANK_TIER);
        let next_xp = rec_a
            .xp_score
            .saturating_add(rec_b.xp_score)
            .saturating_add(500);

        Self::mint_generative_internal(e, owner, entropy, next_gen, next_tier, next_xp, false)
    }

    fn compute_address_xp(e: &Env, owner: &Address) -> u32 {
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

    fn snapshot_transfer_baseline(e: &Env, to: &Address, token_id: u32) {
        let baseline = Self::compute_address_xp(e, to);
        let key = DataKey::TokenXpBaseline(token_id);
        e.storage().persistent().set(&key, &baseline);
        Self::bump_persistent(e, &key);
    }

    // ---------------- Helpers privados ----------------

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

    fn mint_generative_internal(
        e: &Env,
        to: &Address,
        user_entropy: &Bytes,
        generation: u32,
        rank_tier: u32,
        xp_score: u32,
        soulbound: bool,
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
        preimage.extend_from_slice(&token_id.to_le_bytes());
        preimage.extend_from_slice(&prng_bytes);
        preimage.append(user_entropy);
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
            generation,
            rank_tier,
            xp_score,
            born_ledger: e.ledger().sequence(),
            soulbound,
        };

        let key = DataKey::Sorobit(token_id);
        e.storage().persistent().set(&key, &rec);
        Self::bump_persistent(e, &key);
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
            .remove(&DataKey::TokenXpBaseline(token_id));
    }

    fn peek_record(e: &Env, token_id: u32) -> SorobitRecord {
        let key = DataKey::Sorobit(token_id);
        e.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(e, SorobitsError::RecordMissing))
    }

    fn load_record_and_bump(e: &Env, token_id: u32) -> SorobitRecord {
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
        let rec = Self::peek_record(e, token_id);
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
        let rec = Self::load_record_and_bump(e, token_id);
        if rec.soulbound {
            panic_with_error!(e, SorobitsError::SoulboundLocked);
        }
        Self::ContractType::transfer(e, &from, &to, token_id);
        Self::snapshot_transfer_baseline(e, &to, token_id);
        Self::extend_ttl(e);
    }

    fn transfer_from(e: &Env, spender: Address, from: Address, to: Address, token_id: u32) {
        let rec = Self::load_record_and_bump(e, token_id);
        if rec.soulbound {
            panic_with_error!(e, SorobitsError::SoulboundLocked);
        }
        Self::ContractType::transfer_from(e, &spender, &from, &to, token_id);
        Self::snapshot_transfer_baseline(e, &to, token_id);
        Self::extend_ttl(e);
    }

    fn token_uri(e: &Env, token_id: u32) -> String {
        let (rec, grid, pal) = Self::compose_for_token(e, token_id);
        let dna = rec.dna.to_array();
        let mut w = ByteWriter::new();
        write_token_uri_json(&mut w, token_id, &rec, &dna, &grid, &pal);
        w.to_soroban_string(e)
            .unwrap_or_else(|| panic_with_error!(e, SorobitsError::SvgBudgetExceeded))
    }
}

#[contractimpl(contracttrait)]
impl NonFungibleEnumerable for Sorobits {}

#[contractimpl(contracttrait)]
impl NonFungibleBurnable for Sorobits {
    fn burn(e: &Env, from: Address, token_id: u32) {
        let rec = Self::peek_record(e, token_id);
        if rec.soulbound {
            panic_with_error!(e, SorobitsError::SoulboundLocked);
        }
        Self::ContractType::burn(e, &from, token_id);
        e.storage().persistent().remove(&DataKey::Sorobit(token_id));
        e.storage()
            .persistent()
            .remove(&DataKey::TokenXpBaseline(token_id));
        Self::extend_ttl(e);
    }

    fn burn_from(e: &Env, spender: Address, from: Address, token_id: u32) {
        let rec = Self::peek_record(e, token_id);
        if rec.soulbound {
            panic_with_error!(e, SorobitsError::SoulboundLocked);
        }
        Self::ContractType::burn_from(e, &spender, &from, token_id);
        e.storage().persistent().remove(&DataKey::Sorobit(token_id));
        e.storage()
            .persistent()
            .remove(&DataKey::TokenXpBaseline(token_id));
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
