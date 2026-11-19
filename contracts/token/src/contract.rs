//! Contrato del token fungible del launchpad (SEP-41, OpenZeppelin Stellar).
//!
//! Garantías de fair launch:
//! - Supply fijo y deflacionario: el cap se fija en el constructor al `initial_supply`
//!   y se acuña por completo. La renuncia irrevocable de ownership (`renounce_ownership`)
//!   es la barrera definitiva que sella la acuñación: aunque `Capped` limita el supply
//!   circulante al cap, quemar tokens liberaría margen bajo el cap que un owner activo
//!   podría volver a acuñar. Al renunciar al owner, `mint` queda inhabilitado para siempre.
//! - Metadata saneada: decimals 0..18, name/symbol no vacíos y ≤ 32 bytes.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, Address,
    Env, MuxedAddress, String,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TokenError {
    InvalidDecimals = 500,
    InvalidName = 501,
    InvalidSymbol = 502,
    InvalidInitialSupply = 503,
    GateAlreadyConfigured = 504,
    GateNotConfigured = 505,
    TransfersLocked = 506,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransfersLockedEvent {
    #[topic]
    pub launchpad: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TransfersUnlockedEvent {
    #[topic]
    pub launchpad: Address,
}
use stellar_access::ownable::{self as ownable, Ownable};
use stellar_macros::only_owner;
use stellar_tokens::fungible::{
    burnable::FungibleBurnable,
    capped::{Capped, FungibleCapped},
    total_supply::{FungibleTotalSupply, TotalSupply},
    Base, Compose, ContractOverrides, FungibleToken,
};

#[contracttype]
#[derive(Clone)]
enum TokenDataKey {
    LaunchpadGate,
    TransfersUnlocked,
}

// MuxedAddress se importa aunque no se use directamente: la expansión de
// `#[contractimpl(contracttrait)]` lo requiere en scope (los defaults de los
// traits de OZ lo referencian). Sin él el macro no compila.

/// Límite razonable de decimales (native Stellar usa 7; SEP-41 no impone tope).
const MAX_DECIMALS: u32 = 18;

/// Límite de tamaño de name/symbol: evita inflar metadata en storage.
const MAX_STRING_BYTES: u32 = 32;

/// Constantes de extensión de TTL de instancia (Soroban testnet/mainnet).
/// 1 día ≈ 17.280 ledgers a ~5s por ledger.
const DAY_IN_LEDGERS: u32 = 17_280;
pub const INSTANCE_BUMP_AMOUNT: u32 = 90 * DAY_IN_LEDGERS; // ~90 días (1.555.200 ledgers)
pub const INSTANCE_TTL_THRESHOLD: u32 = INSTANCE_BUMP_AMOUNT - (7 * DAY_IN_LEDGERS); // ~83 días (1.434.240 ledgers)

#[contract]
pub struct Token;

#[contractimpl]
impl Token {
    /// Crea el token: fija metadata, acuña `initial_supply` al owner y fija el
    /// cap del supply a `initial_supply` (supply finito desde el deploy).
    pub fn __constructor(
        e: &Env,
        name: String,
        symbol: String,
        decimals: u32,
        owner: Address,
        initial_supply: i128,
    ) {
        if decimals > MAX_DECIMALS {
            panic_with_error!(e, TokenError::InvalidDecimals);
        }
        if name.is_empty() || name.len() > MAX_STRING_BYTES {
            panic_with_error!(e, TokenError::InvalidName);
        }
        if symbol.is_empty() || symbol.len() > MAX_STRING_BYTES {
            panic_with_error!(e, TokenError::InvalidSymbol);
        }
        if initial_supply <= 0 {
            panic_with_error!(e, TokenError::InvalidInitialSupply);
        }

        Base::set_metadata(e, decimals, name, symbol);
        // El cap fija el techo inicial del supply igual al initial_supply.
        // Nota: quemar tokens reduce el supply total circulante; por tanto,
        // la renuncia de ownership (post-deploy) es lo que garantiza que no
        // se puedan re-acuñar tokens quemados.
        Capped::set_cap(e, initial_supply);
        // Ruta por el ContractType para que el supply quede trackeado y el
        // cap se aplique (Compose<(Capped, TotalSupply)> → mint con cap).
        <Self as FungibleToken>::ContractType::mint(e, &owner, initial_supply);
        ownable::set_owner(e, &owner);
        Self::extend_ttl(e);
    }

    /// Mint solo para el owner (inyección inicial / pruebas antes de renunciar).
    ///
    /// Importante: El cap restringe el supply total circulante instantáneo.
    /// Si un usuario quema tokens, el supply baja y el owner podría re-mintear
    /// hasta el cap. Por ello, la renuncia de ownership (`renounce_ownership`)
    /// en el launchpad es el mecanismo indispensable que sella la acuñación para siempre.
    #[only_owner]
    pub fn mint(e: &Env, to: Address, amount: i128) {
        <Self as FungibleToken>::ContractType::mint(e, &to, amount);
        Self::extend_ttl(e);
    }

    /// Extiende el TTL de la instancia del contrato (metadata, cap y owner),
    /// refresca la entrada persistente de `total_supply` en OpenZeppelin, y
    /// refresca el balance persistente del Launchpad gate (Burn Vault / Vesting) si existe.
    /// Cualquier usuario o keeper puede invocarlo para mantener vivo el contrato.
    pub fn extend_ttl(e: &Env) {
        e.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_BUMP_AMOUNT);
        let _ = <Self as FungibleTotalSupply>::total_supply(e);
        if let Some(gate) = e
            .storage()
            .instance()
            .get::<TokenDataKey, Address>(&TokenDataKey::LaunchpadGate)
        {
            let _ = Base::balance(e, &gate);
        }
    }

    /// Locks P2P transfers during the Fair-Flywheel bonding curve phase (only transfers
    /// involving `launchpad` and `burn` are allowed). Must be called by owner before
    /// `renounce_ownership()`.
    #[only_owner]
    pub fn lock_until_graduated(e: &Env, launchpad: Address) {
        if e.storage().instance().has(&TokenDataKey::LaunchpadGate) {
            panic_with_error!(e, TokenError::GateAlreadyConfigured);
        }
        e.storage()
            .instance()
            .set(&TokenDataKey::LaunchpadGate, &launchpad);
        e.storage()
            .instance()
            .set(&TokenDataKey::TransfersUnlocked, &false);
        Self::extend_ttl(e);
        TransfersLockedEvent { launchpad }.publish(e);
    }

    /// Permanently unlocks unrestricted SEP-41 transfers upon curve graduation.
    /// Callable solely by the configured `launchpad` gate contract.
    pub fn unlock_transfers(e: &Env) {
        let gate: Address = e
            .storage()
            .instance()
            .get(&TokenDataKey::LaunchpadGate)
            .unwrap_or_else(|| panic_with_error!(e, TokenError::GateNotConfigured));
        gate.require_auth();
        e.storage()
            .instance()
            .set(&TokenDataKey::TransfersUnlocked, &true);
        Self::extend_ttl(e);
        TransfersUnlockedEvent { launchpad: gate }.publish(e);
    }

    /// Returns true when unrestricted P2P transfers are enabled.
    pub fn is_transfers_unlocked(e: &Env) -> bool {
        if !e.storage().instance().has(&TokenDataKey::LaunchpadGate) {
            return true;
        }
        e.storage()
            .instance()
            .get(&TokenDataKey::TransfersUnlocked)
            .unwrap_or(false)
    }

    fn assert_transfer_allowed(e: &Env, from: &Address, to: &Address) {
        if Self::is_transfers_unlocked(e) {
            return;
        }
        let gate: Address = e
            .storage()
            .instance()
            .get(&TokenDataKey::LaunchpadGate)
            .unwrap_or_else(|| panic_with_error!(e, TokenError::GateNotConfigured));
        if from != &gate && to != &gate {
            panic_with_error!(e, TokenError::TransfersLocked);
        }
    }
}

/// SEP-41 completo, generado por el macro (`ContractType = Compose<(Capped, TotalSupply)>`).
/// Extiende automáticamente el TTL de la instancia en cada mutación activa.
#[contractimpl(contracttrait)]
impl FungibleToken for Token {
    type ContractType = Compose<(Capped, TotalSupply)>;

    fn transfer(e: &Env, from: Address, to: MuxedAddress, amount: i128) {
        Self::assert_transfer_allowed(e, &from, &to.address());
        Self::ContractType::transfer(e, &from, &to, amount);
        Self::extend_ttl(e);
    }

    fn transfer_from(e: &Env, spender: Address, from: Address, to: Address, amount: i128) {
        Self::assert_transfer_allowed(e, &from, &to);
        Self::ContractType::transfer_from(e, &spender, &from, &to, amount);
        Self::extend_ttl(e);
    }

    fn approve(e: &Env, owner: Address, spender: Address, amount: i128, live_until_ledger: u32) {
        Self::ContractType::approve(e, &owner, &spender, amount, live_until_ledger);
        Self::extend_ttl(e);
    }
}

/// Burn/transfer-from estándar para el holder (con extensión automática de TTL).
#[contractimpl(contracttrait)]
impl FungibleBurnable for Token {
    fn burn(e: &Env, from: Address, amount: i128) {
        Capped::burn(e, &from, amount);
        Self::extend_ttl(e);
    }

    fn burn_from(e: &Env, spender: Address, from: Address, amount: i128) {
        Capped::burn_from(e, &spender, &from, amount);
        Self::extend_ttl(e);
    }
}

/// Supply total legible on-chain (para prerender UI y Soroswap).
#[contractimpl(contracttrait)]
impl FungibleTotalSupply for Token {}

/// Cap del supply legible on-chain (prueba de supply fijo).
#[contractimpl(contracttrait)]
impl FungibleCapped for Token {}

/// Proxy de ownable (transfer de ownership incluido).
#[contractimpl(contracttrait)]
impl Ownable for Token {}
