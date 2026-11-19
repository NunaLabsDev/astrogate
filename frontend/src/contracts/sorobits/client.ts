import type {SorobitRecord, LayerCategory, PendingUpgradeData, ContractEvent} from './types.js';
import {Spec, AssembledTransaction, Client as ContractClient} from '@stellar/stellar-sdk/contract';
import type {ClientOptions as ContractClientOptions, MethodOptions, ExternalExecutableRef} from '@stellar/stellar-sdk/contract';
import {Address, xdr} from '@stellar/stellar-sdk';

export interface Client {
  burn(args: { from: string | Address; token_id: number }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Returns the token collection name.
   *
   * # Arguments
   *
   * * `e` - Access to the Soroban environment.
   */
  name(options?: MethodOptions): Promise<AssembledTransaction<string>>;
  /**
   * Returns the token collection symbol.
   *
   * # Arguments
   *
   * * `e` - Access to the Soroban environment.
   */
  symbol(options?: MethodOptions): Promise<AssembledTransaction<string>>;
  /**
   * Gives permission to `approved` to transfer the token with `token_id` to
   * another account. The approval is cleared when the token is
   * transferred.
   *
   * Only a single account can be approved at a time for a `token_id`.
   * To remove an approval, the approver can approve their own address,
   * effectively removing the previous approved address. Alternatively,
   * setting the `live_until_ledger` to `0` will also revoke the approval.
   *
   * # Arguments
   *
   * * `e` - Access to Soroban environment.
   * * `approver` - The address of the approver (should be `owner` or
   * `operator`).
   * * `approved` - The address receiving the approval.
   * * `token_id` - Token ID as a number.
   * * `live_until_ledger` - The ledger number at which the allowance
   * expires. If `live_until_ledger` is `0`, the approval is revoked.
   *
   * # Errors
   *
   * * [`NonFungibleTokenError::NonExistentToken`] - If the token does not
   * exist.
   * * [`NonFungibleTokenError::InvalidApprover`] - If the owner address is
   * not the actual owner of the token.
   * * [`NonFungibleTokenError::InvalidLiveUntilLedger`] - If the ledge
   */
  approve(args: { approver: string | Address; approved: string | Address; token_id: number; live_until_ledger: number }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Returns the number of tokens owned by `account`.
   *
   * # Arguments
   *
   * * `e` - Access to the Soroban environment.
   * * `account` - The address for which the balance is being queried.
   */
  balance(args: { account: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * Returns `Some(index)` if the account has the specified role,
   * where `index` is the position of the account for that role,
   * and can be used to query [`AccessControl::get_role_member()`].
   * Returns `None` if the account does not have the specified role.
   *
   * # Arguments
   *
   * * `e` - Access to Soroban environment.
   * * `account` - The account to check.
   * * `role` - The role to check for.
   */
  has_role(args: { account: string | Address; role: string }, options?: MethodOptions): Promise<AssembledTransaction<number | null>>;
  /**
   * Returns the owner of the token with `token_id`.
   *
   * # Arguments
   *
   * * `e` - Access to the Soroban environment.
   * * `token_id` - Token ID as a number.
   *
   * # Errors
   *
   * * [`NonFungibleTokenError::NonExistentToken`] - If the token does not
   * exist.
   */
  owner_of(args: { token_id: number }, options?: MethodOptions): Promise<AssembledTransaction<string>>;
  transfer(args: { from: string | Address; to: string | Address; token_id: number }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  burn_from(args: { spender: string | Address; from: string | Address; token_id: number }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Returns the admin account.
   *
   * # Arguments
   *
   * * `e` - Access to Soroban environment.
   */
  get_admin(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  token_uri(args: { token_id: number }, options?: MethodOptions): Promise<AssembledTransaction<string>>;
  /**
   * Devuelve los primeros `MAX_TOKENS_PAGE` IDs minteados para una cuenta (`tokens_of_page` para más).
   */
  tokens_of(args: { owner: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<Array<number>>>;
  /**
   * Extiende el TTL de la instancia del contrato (metadata, contadores y configuración).
   */
  extend_ttl(options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Grants a role to an account.
   *
   * # Arguments
   *
   * * `e` - Access to Soroban environment.
   * * `account` - The account to grant the role to.
   * * `role` - The role to grant.
   * * `caller` - The address of the caller, must be the admin or have the
   * `RoleAdmin` for the `role`.
   *
   * # Errors
   *
   * * [`AccessControlError::Unauthorized`] - If the caller does not have
   * enough privileges.
   * * [`AccessControlError::MaxRolesExceeded`] - If adding a new role would
   * exceed the maximum allowed number of roles.
   *
   * # Events
   *
   * * topics - `["role_granted", role: Symbol, account: Address]`
   * * data - `[caller: Address]`
   */
  grant_role(args: { account: string | Address; role: string; caller: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Devuelve los 1,024 índices semánticos resueltos (`0..=15`) + 45 bytes de paleta RGB (`1,069` bytes).
   */
  raw_bitmap(args: { token_id: number }, options?: MethodOptions): Promise<AssembledTransaction<Uint8Array>>;
  /**
   * Devuelve el SVG estático 100% nativo (`<svg ...>...</svg>`) del Sorobit (lectura pura).
   */
  render_svg(args: { token_id: number }, options?: MethodOptions): Promise<AssembledTransaction<string>>;
  /**
   * Devuelve el registro genómico y telemétrico completo de un Sorobit (lectura pura).
   */
  get_sorobit(args: { token_id: number }, options?: MethodOptions): Promise<AssembledTransaction<SorobitRecord>>;
  get_xlm_sac(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * Indica si una wallet ya reclamó un arquetipo Genesis específico.
   */
  has_claimed(args: { user: string | Address; archetype_id: number }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Revokes a role from an account.
   * To revoke the caller's own role, use
   * [`AccessControl::renounce_role()`] instead.
   *
   * # Arguments
   *
   * * `e` - Access to Soroban environment.
   * * `account` - The account to revoke the role from.
   * * `role` - The role to revoke.
   * * `caller` - The address of the caller, must be the admin or has the
   * `RoleAdmin` for the `role`.
   *
   * # Errors
   *
   * * [`AccessControlError::Unauthorized`] - If the `caller` does not have
   * enough privileges.
   * * [`AccessControlError::RoleNotHeld`] - If the `account` doesn't have
   * the role.
   * * [`AccessControlError::RoleIsEmpty`] - If the role has no members.
   *
   * # Events
   *
   * * topics - `["role_revoked", role: Symbol, account: Address]`
   * * data - `[caller: Address]`
   */
  revoke_role(args: { account: string | Address; role: string; caller: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Sella de forma irreversible el arte y las paletas de una temporada (`seal_season`).
   */
  seal_season(args: { caller: string | Address; season: number }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Configura el SAC nativo de XLM utilizado para minteo de cápsulas de 7 XLM.
   */
  set_xlm_sac(args: { xlm_sac: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Devuelve la versión animada (`5s` pulso de visor acorde al cierre SCP, lectura pura).
   */
  animated_svg(args: { token_id: number }, options?: MethodOptions): Promise<AssembledTransaction<string>>;
  /**
   * Paso 1 (Commit-Reveal de Forja): compromete `sha256(owner_xdr || secret || burn_a || burn_b || "SBIT_FRG_V1")`
   * verificando propiedad y estado no-soulbound de ambos Sorobits antes de revelar en ledger posterior.
   */
  commit_forge(args: { owner: string | Address; burn_id_a: number; burn_id_b: number; commitment: Uint8Array }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Modo legado instantáneo de Forja (bloqueado por defecto con `InstantMintDisabled`;
   * use `commit_forge` + `reveal_forge` en producción).
   */
  forge_ascend(args: { owner: string | Address; burn_id_a: number; burn_id_b: number; user_entropy: Uint8Array }, options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * Returns the account approved for the token with `token_id`.
   *
   * # Arguments
   *
   * * `e` - Access to the Soroban environment.
   * * `token_id` - Token ID as a number.
   *
   * # Errors
   *
   * * [`NonFungibleTokenError::NonExistentToken`] - If the token does not
   * exist.
   */
  get_approved(args: { token_id: number }, options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * Returns the `token_id` at a given `index` in the global token list.
   * Use along with [`NonFungibleEnumerable::total_supply`] to enumerate
   * all the tokens in the contract.
   *
   * A function to get all tokens of a contract is not provided because that
   * would be unbounded. To enumerate all tokens of a contract, use
   * [`NonFungibleEnumerable::total_supply`] to get the total number of
   * tokens and then use [`NonFungibleEnumerable::get_token_id`] to retrieve
   * each token one by one.
   *
   * # Arguments
   *
   * * `e` - Access to the Soroban environment.
   * * `index` - Index of the token in the global list.
   *
   * # Errors
   *
   * * [`crate::non_fungible::NonFungibleTokenError::TokenNotFoundInGlobalList`] - When the token
   * ID is not found in the global enumeration.
   */
  get_token_id(args: { index: number }, options?: MethodOptions): Promise<AssembledTransaction<number>>;
  get_treasury(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * Modo legado instantáneo de Cápsula (bloqueado por defecto con `InstantMintDisabled`;
   * use `commit_capsule` + `reveal_capsule` en producción).
   */
  mint_capsule(args: { user: string | Address; user_entropy: Uint8Array }, options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * Acuña uno de los 8 Arquetipos Genesis Edición 0 (`1 = AGQ01 Pioneer .. 8 = AGQ08 Legend`).
   */
  mint_genesis(args: { caller: string | Address; to: string | Address; archetype_id: number; soulbound: boolean }, options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * Paso 2 (Commit-Reveal de Forja): revela `secret` en un ledger posterior, quema ambos Sorobits
   * transferibles y forja el Sorobit ascendido (`Gen + 1`).
   */
  reveal_forge(args: { owner: string | Address; secret: Uint8Array }, options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * Returns `(Address, i128)` - A tuple containing the receiver address and
   * the royalty amount.
   *
   * # Arguments
   *
   * * `e` - Access to the Soroban environment.
   * * `token_id` - The identifier of the token.
   * * `sale_price` - The sale price for which royalties are being
   * calculated.
   *
   * # Errors
   *
   * * [`crate::non_fungible::NonFungibleTokenError::NonExistentToken`] - If
   * the token does not exist.
   */
  royalty_info(args: { token_id: number; sale_price: bigint }, options?: MethodOptions): Promise<AssembledTransaction<[string, bigint]>>;
  /**
   * Configura la dirección de tesorería receptora de comisiones de Cápsula (solo Admin).
   */
  set_treasury(args: { treasury: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Returns the total amount of tokens stored by the contract.
   *
   * # Arguments
   *
   * * `e` - Access to the Soroban environment.
   */
  total_supply(options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * Permite a cualquier piloto reclamar 1 vez su Sorobit Genesis AGQ01 ("Floodgate Pioneer").
   */
  claim_pioneer(args: { user: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<number>>;
  get_launchpad(options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * Allows an account to renounce a role assigned to itself.
   * Users can only renounce roles for their own account.
   *
   * # Arguments
   *
   * * `e` - Access to Soroban environment.
   * * `role` - The role to renounce.
   * * `caller` - The address of the caller, must be the account that has the
   * role.
   *
   * # Errors
   *
   * * [`AccessControlError::RoleNotHeld`] - If the `caller` doesn't have the
   * role.
   * * [`AccessControlError::RoleIsEmpty`] - If the role has no members.
   *
   * # Events
   *
   * * topics - `["role_revoked", role: Symbol, account: Address]`
   * * data - `[caller: Address]`
   */
  renounce_role(args: { role: string; caller: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Vincula la dirección del contrato Launchpad para validar misiones y epigenética on-chain.
   */
  set_launchpad(args: { launchpad: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  transfer_from(args: { spender: string | Address; from: string | Address; to: string | Address; token_id: number }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Cancela un upgrade WASM programado antes de ejecutarse (solo Admin).
   */
  cancel_upgrade(options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Paso 1 (Commit-Reveal anti-frontrunning): compromete `sha256(minter_xdr || secret || "SBIT_CAP_V1")`
   * antes de revelar en un ledger posterior (`reveal_capsule`).
   */
  commit_capsule(args: { minter: string | Address; commitment: Uint8Array }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  genesis_minted(args: { archetype_id: number }, options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * Returns the admin role for a specific role.
   * If no admin role is explicitly set, returns `None`.
   *
   * # Arguments
   *
   * * `e` - Access to Soroban environment.
   * * `role` - The role to query the admin role for.
   */
  get_role_admin(args: { role: string }, options?: MethodOptions): Promise<AssembledTransaction<string | null>>;
  /**
   * Registra una capa `32x32` comprimida en RLE para futuras temporadas (`season >= 2`) no selladas.
   */
  register_layer(args: { caller: string | Address; season: number; category: LayerCategory; layer_id: number; rle_bytes: Uint8Array }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Allows the current admin to renounce their role, making the contract
   * permanently admin-less. This is useful for decentralization purposes
   * or when the admin role is no longer needed. Once the admin is
   * renounced, it cannot be reinstated.
   *
   * # Arguments
   *
   * * `e` - Access to Soroban environment.
   *
   * # Errors
   *
   * * [`AccessControlError::AdminNotSet`] - If no admin account is set.
   *
   * # Events
   *
   * * topics - `["admin_renounced", admin: Address]`
   * * data - `[]`
   *
   * # Notes
   *
   * * Authorization for the current admin is required.
   */
  renounce_admin(options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Paso 2 (Commit-Reveal): revela `secret` en un ledger posterior al commit, cobra 7 XLM
   * y acuña la Cápsula Generativa con entropía no pre-simulable en el bloque del commit.
   */
  reveal_capsule(args: { minter: string | Address; secret: Uint8Array }, options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * Sets `admin_role` as the admin role of `role`.
   *
   * # Arguments
   *
   * * `e` - Access to Soroban environment.
   * * `role` - The role to set the admin for.
   * * `admin_role` - The new admin role.
   *
   * # Events
   *
   * * topics - `["role_admin_changed", role: Symbol]`
   * * data - `[previous_admin_role: Symbol, new_admin_role: Symbol]`
   *
   * # Errors
   *
   * * [`AccessControlError::AdminNotSet`] - If admin account is not set.
   *
   * # Notes
   *
   * * Authorization for the current admin is required.
   */
  set_role_admin(args: { role: string; admin_role: string }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Paginación acotada de tokens de una cuenta para evitar límites de presupuesto Soroban.
   */
  tokens_of_page(args: { owner: string | Address; offset: number; limit: number }, options?: MethodOptions): Promise<AssembledTransaction<Array<number>>>;
  /**
   * Approve or remove `operator` as an operator for the owner.
   *
   * Operators can call `transfer_from()` for any token held by `owner`,
   * and call `approve()` on behalf of `owner`.
   *
   * # Arguments
   *
   * * `e` - Access to Soroban environment.
   * * `owner` - The address holding the tokens.
   * * `operator` - Account to add to the set of authorized operators.
   * * `live_until_ledger` - The ledger number at which the allowance
   * expires. If `live_until_ledger` is `0`, the approval is revoked.
   *
   * # Errors
   *
   * * [`NonFungibleTokenError::InvalidLiveUntilLedger`] - If the ledger
   * number is less than the current ledger number.
   *
   * # Events
   *
   * * topics - `["approve_for_all", owner: Address]`
   * * data - `[operator: Address, live_until_ledger: u32]`
   */
  approve_for_all(args: { owner: string | Address; operator: string | Address; live_until_ledger: number }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Ejecuta el upgrade WASM programado tras vencer las 48 horas (solo Admin).
   */
  execute_upgrade(options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Extiende TTL de cupos de cápsulas y badges Genesis reclamados por `user`.
   */
  extend_user_ttl(args: { user: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Devuelve el precio actual de una Cápsula Generativa Sorobit en stroops (default 7 XLM).
   */
  get_capsule_fee(options?: MethodOptions): Promise<AssembledTransaction<bigint>>;
  /**
   * Returns the account at the specified index for a given role.
   *
   * A function to get all members of a role is not provided because that
   * would be unbounded. To enumerate all members of a role, use
   * [`AccessControl::get_role_member_count()`] to get the total number of
   * members and then use [`AccessControl::get_role_member()`] to retrieve
   * each member one by one.
   *
   * # Arguments
   *
   * * `e` - Access to Soroban environment.
   * * `role` - The role to query.
   * * `index` - The index of the account to retrieve.
   *
   * # Errors
   *
   * * [`AccessControlError::IndexOutOfBounds`] - If the index is out of
   * bounds for the role's member list.
   */
  get_role_member(args: { role: string; index: number }, options?: MethodOptions): Promise<AssembledTransaction<string>>;
  /**
   * Acuña un Sorobit generativo con Genoma criptográfico de 256 bits (`BytesN<32>`)
   * aplicando automáticamente la matriz de compatibilidad y exclusión de rasgos.
   */
  mint_generative(args: { caller: string | Address; to: string | Address; user_entropy: Uint8Array; soulbound: boolean }, options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * Ajusta dinámicamente el precio en XLM de las Cápsulas Generativas (0..=1,000 XLM, solo Admin).
   */
  set_capsule_fee(args: { fee_stroops: bigint }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Protege contra expiración/archivado el registro genómico, baseline de XP y assets de temporada.
   */
  extend_token_ttl(args: { token_id: number }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  is_season_sealed(args: { season: number }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Registra una paleta semántica de 45 bytes (`slots 1..=15`) para `season >= 2`,
   * validando automáticamente on-chain todas las rampas de luminancia y sel-out.
   */
  register_palette(args: { caller: string | Address; season: number; faction_id: number; palette45: Uint8Array }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Programa un upgrade WASM detrás de un timelock obligatorio de 48 horas (solo Admin).
   */
  schedule_upgrade(args: { new_wasm_hash: Uint8Array }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Sincroniza sin permisos el XP y `rank_tier` epigenético de un Sorobit desde la actividad
   * real on-chain de su dueño, descontando la línea base del receptor al transferir (`TokenXpBaseline`).
   */
  sync_epigenetics(args: { token_id: number }, options?: MethodOptions): Promise<AssembledTransaction<SorobitRecord>>;
  /**
   * Permite reclamar cualquiera de los 8 arquetipos Genesis (`1..=8`) verificando on-chain
   * la telemetría real del piloto en `Launchpad::get_pilot`.
   */
  claim_quest_badge(args: { user: string | Address; archetype_id: number }, options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * Calcula el cupo usado y el máximo permitido de Cápsulas Generativas para `user`
   * (`(minted_active, max_allowed)`): base 2 + 1 por quest reclamada + trades/graduaciones/shouts.
   */
  get_capsule_quota(args: { user: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<[number, number]>>;
  /**
   * Cambia la temporada activa para nuevos mints generativos (`1..=255`, solo temporadas selladas).
   */
  set_active_season(args: { season: number }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  set_token_royalty(args: { token_id: number; receiver: string | Address; basis_points: number; operator: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Returns a vector containing all existing roles.
   * Defaults to empty vector if no roles exist.
   *
   * # Arguments
   *
   * * `e` - Access to Soroban environment.
   *
   * # Notes
   *
   * This function returns all roles that currently have at least one member.
   * The maximum number of roles is limited by [`MAX_ROLES`].
   */
  get_existing_roles(options?: MethodOptions): Promise<AssembledTransaction<Array<string>>>;
  /**
   * Returns the `token_id` owned by `owner` at a given `index` in the
   * owner's local list. Use along with
   * [`crate::non_fungible::NonFungibleToken::balance`] to enumerate all of
   * `owner`'s tokens.
   *
   * # Arguments
   *
   * * `e` - Access to the Soroban environment.
   * * `owner` - Account of the token's owner.
   * * `index` - Index of the token in the owner's local list.
   *
   * # Errors
   *
   * * [`crate::non_fungible::NonFungibleTokenError::TokenNotFoundInOwnerList`] - When the token
   * ID is not found in the owner's enumeration.
   */
  get_owner_token_id(args: { owner: string | Address; index: number }, options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * Actualiza la epigenética viva (`rank_tier` del marco TTL y `xp_score`) sin alterar el genoma base.
   */
  update_epigenetics(args: { caller: string | Address; token_id: number; new_rank_tier: number; add_xp: number }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  get_pending_upgrade(options?: MethodOptions): Promise<AssembledTransaction<PendingUpgradeData | null>>;
  get_storage_version(options?: MethodOptions): Promise<AssembledTransaction<number>>;
  /**
   * Returns whether the `operator` is allowed to manage all the assets of
   * `owner`.
   *
   * # Arguments
   *
   * * `e` - Access to the Soroban environment.
   * * `owner` - Account of the token's owner.
   * * `operator` - Account to be checked.
   */
  is_approved_for_all(args: { owner: string | Address; operator: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  set_default_royalty(args: { receiver: string | Address; basis_points: number; operator: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Initiates the admin role transfer.
   * Admin privileges for the current admin are not revoked until the
   * recipient accepts the transfer.
   * Overrides the previous pending transfer if there is one.
   *
   * # Arguments
   *
   * * `e` - Access to Soroban environment.
   * * `new_admin` - The account to transfer the admin privileges to.
   * * `live_until_ledger` - The ledger number at which the pending transfer
   * expires. If `live_until_ledger` is `0`, the pending transfer is
   * cancelled. `live_until_ledger` argument is implicitly bounded by the
   * maximum allowed TTL extension for a temporary storage entry and
   * specifying a higher value will cause the code to panic.
   *
   * # Errors
   *
   * * [`crate::role_transfer::RoleTransferError::NoPendingTransfer`] - If
   * trying to cancel a transfer that doesn't exist.
   * * [`crate::role_transfer::RoleTransferError::InvalidLiveUntilLedger`] -
   * If the specified ledger is in the past.
   * * [`crate::role_transfer::RoleTransferError::InvalidPendingAccount`] -
   * If the specified pending account is not the same as the provided `new`
   * address.
   *
   */
  transfer_admin_role(args: { new_admin: string | Address; live_until_ledger: number }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  remove_token_royalty(args: { token_id: number; operator: string | Address }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Completes the 2-step admin transfer.
   *
   * # Arguments
   *
   * * `e` - Access to Soroban environment.
   *
   * # Events
   *
   * * topics - `["admin_transfer_completed", new_admin: Address]`
   * * data - `[previous_admin: Address]`
   *
   * # Errors
   *
   * * [`crate::role_transfer::RoleTransferError::NoPendingTransfer`] - If
   * there is no pending transfer to accept.
   * * [`AccessControlError::AdminNotSet`] - If admin account is not set.
   */
  accept_admin_transfer(options?: MethodOptions): Promise<AssembledTransaction<void>>;
  /**
   * Returns the total number of accounts that have the specified role.
   * If the role does not exist, returns 0.
   *
   * # Arguments
   *
   * * `e` - Access to Soroban environment.
   * * `role` - The role to get the count for.
   */
  get_role_member_count(args: { role: string }, options?: MethodOptions): Promise<AssembledTransaction<number>>;
  is_instant_mint_allowed(options?: MethodOptions): Promise<AssembledTransaction<boolean>>;
  /**
   * Habilita o deshabilita el modo legado instantáneo de cápsula/forja (deshabilitado por defecto).
   */
  set_instant_mint_allowed(args: { enabled: boolean }, options?: MethodOptions): Promise<AssembledTransaction<void>>;
}

export class Client extends ContractClient {
  readonly options: ContractClientOptions;
  constructor(options: ContractClientOptions) {
    super(
      new Spec(["AAAAAwAAAENNb2R1bGFyIHRyYWl0IGNhdGVnb3JpZXMgZm9yIFNlYXNvbiAyKyBQZXJzaXN0ZW50IHJlZ2lzdHJ5IHVwbG9hZHMuAAAAAAAAAAANTGF5ZXJDYXRlZ29yeQAAAAAAAAUAAAAAAAAABFN1aXQAAAAAAAAAAAAAAAZIZWxtZXQAAAAAAAEAAAAAAAAABVZpc29yAAAAAAAAAgAAAAAAAAAFUmVsaWMAAAAAAAADAAAAAAAAAARBdXJhAAAABA==", "AAAAAQAAADBPbi1jaGFpbiByZWNvcmQgc3RvcmVkIHBlciBtaW50ZWQgU29yb2JpdCB0b2tlbi4AAAAAAAAADVNvcm9iaXRSZWNvcmQAAAAAAAAHAAAANUxlZGdlciBzZXF1ZW5jZSBhdCBtaW50IHRpbWUgKHZlcmlmaWFibGUgcHJvdmVuYW5jZSkuAAAAAAAAC2Jvcm5fbGVkZ2VyAAAAAAQAAACzMjU2LWJpdCBjcnlwdG9ncmFwaGljIGdlbm9tZToKWzBdPXNlYXNvbiwgWzFdPWZhY3Rpb24sIFsyXT1zdWl0LCBbM109aGVsbWV0LCBbNF09dmlzb3IsIFs1XT1yZWxpYywgWzZdPWF1cmEsCls3Li45XT1yZWNlc3NpdmUgZm9yZ2UgZ2VuZXMgKGxhdGVudCBHZW4gMCksIFs5Li4zMl09ZW50cm9weS9za3kgc2VlZC4AAAAAA2RuYQAAAAPuAAAAIAAAAFRgMGAgPSBHZW5lcmF0aXZlIE1pbnQsIGAxLi49OGAgPSBHZW5lc2lzIEFyY2hldHlwZSAoYEFHUTAxYC4uYEFHUTA4YCksIGA5K2AgPSBGb3JnZS4AAAAHZWRpdGlvbgAAAAAEAAAAOGAwYCA9IEdlbiAwIG9yaWdpbiwgYDErYCA9IEFzY2VuZGVkIC8gRm9yZ2VkIGdlbmVyYXRpb24uAAAACmdlbmVyYXRpb24AAAAAAAQAAABLRXBpZ2VuZXRpYyBUVEwgU2hpZWxkIGZyYW1lIHRpZXIgKGAwLi49NGApLCB1cGRhdGVzIHdpdGggb24tY2hhaW4gYWN0aXZpdHkuAAAAAAlyYW5rX3RpZXIAAAAAAAAEAAAAQE9wdGlvbmFsIHNvdWxib3VuZCBsb2NrIGZvciBtZXJpdC1vbmx5IEdlbmVzaXMvcmFuayBjcmVkZW50aWFscy4AAAAJc291bGJvdW5kAAAAAAAAAQAAADNPbi1jaGFpbiBhY2N1bXVsYXRlZCB0ZWxlbWV0cnkgLyBleHBlcmllbmNlIHBvaW50cy4AAAAACHhwX3Njb3JlAAAABA==", "AAAABAAAAAAAAAAAAAAADVNvcm9iaXRzRXJyb3IAAAAAAAAcAAAAAAAAABBJbnZhbGlkQXJjaGV0eXBlAAABLAAAAAAAAAARR2VuZXNpc0NhcFJlYWNoZWQAAAAAAAEtAAAAAAAAAA9Tb3VsYm91bmRMb2NrZWQAAAABLgAAAAAAAAATU2Vhc29uQWxyZWFkeVNlYWxlZAAAAAEvAAAAAAAAAA1JbnZhbGlkU2Vhc29uAAAAAAABMAAAAAAAAAAPSW52YWxpZExheWVyUmxlAAAAATEAAAAAAAAADkludmFsaWRQYWxldHRlAAAAAAEyAAAAAAAAAA9JbnZhbGlkUmFua1RpZXIAAAABMwAAAAAAAAAOUm95YWx0eVRvb0hpZ2gAAAAAATQAAAAAAAAADVJlY29yZE1pc3NpbmcAAAAAAAE1AAAAAAAAAAxFbnRyb3B5RW1wdHkAAAE2AAAAAAAAAA5BbHJlYWR5Q2xhaW1lZAAAAAABNwAAAAAAAAAQUXVlc3ROb3RVbmxvY2tlZAAAATgAAAAAAAAAEEZvcmdlSW52YWxpZFBhaXIAAAE5AAAAAAAAABNDYXBzdWxlUXVvdGFSZWFjaGVkAAAAAToAAAAAAAAAFFBheW1lbnROb3RDb25maWd1cmVkAAABOwAAAAAAAAARU3ZnQnVkZ2V0RXhjZWVkZWQAAAAAAAE8AAAAAAAAAApJbnZhbGlkRmVlAAAAAAE9AAAAAAAAAA9TZWFzb25Ob3RTZWFsZWQAAAABPgAAAAAAAAATSW5zdGFudE1pbnREaXNhYmxlZAAAAAE/AAAAAAAAABJDb21taXRtZW50Tm90Rm91bmQAAAAAAUAAAAAAAAAAEkNvbW1pdG1lbnROb3RSZWFkeQAAAAABQQAAAAAAAAASQ29tbWl0bWVudE1pc21hdGNoAAAAAAFCAAAAAAAAABVVcGdyYWRlQWxyZWFkeVBlbmRpbmcAAAAAAAFDAAAAAAAAABBOb1BlbmRpbmdVcGdyYWRlAAABRAAAAAAAAAAVVXBncmFkZVRpbWVsb2NrQWN0aXZlAAAAAAABRQAAAAAAAAASSW52YWxpZFVwZ3JhZGVIYXNoAAAAAAFGAAAAAAAAAA5JbnZhbGlkQXNzZXRJZAAAAAABRw==", "AAAABQAAAAAAAAAAAAAAEVNlYXNvblNlYWxlZEV2ZW50AAAAAAAAAQAAABNzZWFzb25fc2VhbGVkX2V2ZW50AAAAAAEAAAAAAAAABnNlYXNvbgAAAAAABAAAAAEAAAAC", "AAAAAQAAAAAAAAAAAAAAElBlbmRpbmdVcGdyYWRlRGF0YQAAAAAAAwAAAAAAAAANZXhlY3V0ZV9hZnRlcgAAAAAAAAYAAAAAAAAADHNjaGVkdWxlZF9hdAAAAAYAAAAAAAAACXdhc21faGFzaAAAAAAAA+4AAAAg", "AAAABQAAAAAAAAAAAAAAElNvcm9iaXRNaW50ZWRFdmVudAAAAAAAAQAAABRzb3JvYml0X21pbnRlZF9ldmVudAAAAAUAAAAAAAAAAnRvAAAAAAATAAAAAQAAAAAAAAAIdG9rZW5faWQAAAAEAAAAAQAAAAAAAAAHZWRpdGlvbgAAAAAEAAAAAAAAAAAAAAADZG5hAAAAA+4AAAAgAAAAAAAAAAAAAAAJc291bGJvdW5kAAAAAAAAAQAAAAAAAAAC", "AAAABQAAAAAAAAAAAAAAElhsbVNhY1VwZGF0ZWRFdmVudAAAAAAAAQAAABV4bG1fc2FjX3VwZGF0ZWRfZXZlbnQAAAAAAAABAAAAAAAAAAd4bG1fc2FjAAAAABMAAAABAAAAAg==", "AAAABQAAAAAAAAAAAAAAE0ZvcmdlQ29tbWl0dGVkRXZlbnQAAAAAAQAAABVmb3JnZV9jb21taXR0ZWRfZXZlbnQAAAAAAAAFAAAAAAAAAAVvd25lcgAAAAAAABMAAAABAAAAAAAAAAZidXJuX2EAAAAAAAQAAAAAAAAAAAAAAAZidXJuX2IAAAAAAAQAAAAAAAAAAAAAAApjb21taXRtZW50AAAAAAPuAAAAIAAAAAAAAAAAAAAADWNvbW1pdF9sZWRnZXIAAAAAAAAEAAAAAAAAAAI=", "AAAABQAAAAAAAAAAAAAAFEluc3RhbnRNaW50TW9kZUV2ZW50AAAAAQAAABdpbnN0YW50X21pbnRfbW9kZV9ldmVudAAAAAABAAAAAAAAAAdlbmFibGVkAAAAAAEAAAAAAAAAAg==", "AAAABQAAAAAAAAAAAAAAFFRyZWFzdXJ5VXBkYXRlZEV2ZW50AAAAAQAAABZ0cmVhc3VyeV91cGRhdGVkX2V2ZW50AAAAAAABAAAAAAAAAAh0cmVhc3VyeQAAABMAAAABAAAAAg==", "AAAABQAAAAAAAAAAAAAAFFVwZ3JhZGVFeGVjdXRlZEV2ZW50AAAAAQAAABZ1cGdyYWRlX2V4ZWN1dGVkX2V2ZW50AAAAAAABAAAAAAAAAAl3YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAAAAAAC", "AAAABQAAAAAAAAAAAAAAFUNhcHN1bGVDb21taXR0ZWRFdmVudAAAAAAAAAEAAAAXY2Fwc3VsZV9jb21taXR0ZWRfZXZlbnQAAAAAAwAAAAAAAAAGbWludGVyAAAAAAATAAAAAQAAAAAAAAAKY29tbWl0bWVudAAAAAAD7gAAACAAAAAAAAAAAAAAAA1jb21taXRfbGVkZ2VyAAAAAAAABAAAAAAAAAAC", "AAAABQAAAAAAAAAAAAAAFUxhdW5jaHBhZFVwZGF0ZWRFdmVudAAAAAAAAAEAAAAXbGF1bmNocGFkX3VwZGF0ZWRfZXZlbnQAAAAAAQAAAAAAAAAJbGF1bmNocGFkAAAAAAAAEwAAAAEAAAAC", "AAAABQAAAAAAAAAAAAAAFVVwZ3JhZGVDYW5jZWxsZWRFdmVudAAAAAAAAAEAAAAXdXBncmFkZV9jYW5jZWxsZWRfZXZlbnQAAAAAAQAAAAAAAAAJd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAAAAAAAg==", "AAAABQAAAAAAAAAAAAAAFVVwZ3JhZGVTY2hlZHVsZWRFdmVudAAAAAAAAAEAAAAXdXBncmFkZV9zY2hlZHVsZWRfZXZlbnQAAAAAAgAAAAAAAAAJd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAAAAAAAAAAAA1leGVjdXRlX2FmdGVyAAAAAAAABgAAAAAAAAAC", "AAAABQAAAAAAAAAAAAAAFkNhcHN1bGVGZWVVcGRhdGVkRXZlbnQAAAAAAAEAAAAZY2Fwc3VsZV9mZWVfdXBkYXRlZF9ldmVudAAAAAAAAAEAAAAAAAAAC2ZlZV9zdHJvb3BzAAAAAAsAAAAAAAAAAg==", "AAAABQAAAAAAAAAAAAAAFkVwaWdlbmV0aWNVcGRhdGVkRXZlbnQAAAAAAAEAAAAYZXBpZ2VuZXRpY191cGRhdGVkX2V2ZW50AAAAAwAAAAAAAAAIdG9rZW5faWQAAAAEAAAAAQAAAAAAAAAJcmFua190aWVyAAAAAAAABAAAAAAAAAAAAAAACHhwX3Njb3JlAAAABAAAAAAAAAAC", "AAAABQAAAAAAAAAAAAAAGEFjdGl2ZVNlYXNvblVwZGF0ZWRFdmVudAAAAAEAAAAbYWN0aXZlX3NlYXNvbl91cGRhdGVkX2V2ZW50AAAAAAEAAAAAAAAABnNlYXNvbgAAAAAABAAAAAAAAAAC", "AAAAAAAAAAAAAAAEYnVybgAAAAIAAAAAAAAABGZyb20AAAATAAAAAAAAAAh0b2tlbl9pZAAAAAQAAAAA", "AAAAAAAAAFtSZXR1cm5zIHRoZSB0b2tlbiBjb2xsZWN0aW9uIG5hbWUuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuAAAAAARuYW1lAAAAAAAAAAEAAAAQ", "AAAAAAAAAF1SZXR1cm5zIHRoZSB0b2tlbiBjb2xsZWN0aW9uIHN5bWJvbC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4AAAAAAAAGc3ltYm9sAAAAAAAAAAAAAQAAABA=", "AAAAAAAABABHaXZlcyBwZXJtaXNzaW9uIHRvIGBhcHByb3ZlZGAgdG8gdHJhbnNmZXIgdGhlIHRva2VuIHdpdGggYHRva2VuX2lkYCB0bwphbm90aGVyIGFjY291bnQuIFRoZSBhcHByb3ZhbCBpcyBjbGVhcmVkIHdoZW4gdGhlIHRva2VuIGlzCnRyYW5zZmVycmVkLgoKT25seSBhIHNpbmdsZSBhY2NvdW50IGNhbiBiZSBhcHByb3ZlZCBhdCBhIHRpbWUgZm9yIGEgYHRva2VuX2lkYC4KVG8gcmVtb3ZlIGFuIGFwcHJvdmFsLCB0aGUgYXBwcm92ZXIgY2FuIGFwcHJvdmUgdGhlaXIgb3duIGFkZHJlc3MsCmVmZmVjdGl2ZWx5IHJlbW92aW5nIHRoZSBwcmV2aW91cyBhcHByb3ZlZCBhZGRyZXNzLiBBbHRlcm5hdGl2ZWx5LApzZXR0aW5nIHRoZSBgbGl2ZV91bnRpbF9sZWRnZXJgIHRvIGAwYCB3aWxsIGFsc28gcmV2b2tlIHRoZSBhcHByb3ZhbC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byBTb3JvYmFuIGVudmlyb25tZW50LgoqIGBhcHByb3ZlcmAgLSBUaGUgYWRkcmVzcyBvZiB0aGUgYXBwcm92ZXIgKHNob3VsZCBiZSBgb3duZXJgIG9yCmBvcGVyYXRvcmApLgoqIGBhcHByb3ZlZGAgLSBUaGUgYWRkcmVzcyByZWNlaXZpbmcgdGhlIGFwcHJvdmFsLgoqIGB0b2tlbl9pZGAgLSBUb2tlbiBJRCBhcyBhIG51bWJlci4KKiBgbGl2ZV91bnRpbF9sZWRnZXJgIC0gVGhlIGxlZGdlciBudW1iZXIgYXQgd2hpY2ggdGhlIGFsbG93YW5jZQpleHBpcmVzLiBJZiBgbGl2ZV91bnRpbF9sZWRnZXJgIGlzIGAwYCwgdGhlIGFwcHJvdmFsIGlzIHJldm9rZWQuCgojIEVycm9ycwoKKiBbYE5vbkZ1bmdpYmxlVG9rZW5FcnJvcjo6Tm9uRXhpc3RlbnRUb2tlbmBdIC0gSWYgdGhlIHRva2VuIGRvZXMgbm90CmV4aXN0LgoqIFtgTm9uRnVuZ2libGVUb2tlbkVycm9yOjpJbnZhbGlkQXBwcm92ZXJgXSAtIElmIHRoZSBvd25lciBhZGRyZXNzIGlzCm5vdCB0aGUgYWN0dWFsIG93bmVyIG9mIHRoZSB0b2tlbi4KKiBbYE5vbkZ1bmdpYmxlVG9rZW5FcnJvcjo6SW52YWxpZExpdmVVbnRpbExlZGdlcmBdIC0gSWYgdGhlIGxlZGdlAAAAB2FwcHJvdmUAAAAABAAAAAAAAAAIYXBwcm92ZXIAAAATAAAAAAAAAAhhcHByb3ZlZAAAABMAAAAAAAAACHRva2VuX2lkAAAABAAAAAAAAAARbGl2ZV91bnRpbF9sZWRnZXIAAAAAAAAEAAAAAA==", "AAAAAAAAAKtSZXR1cm5zIHRoZSBudW1iZXIgb2YgdG9rZW5zIG93bmVkIGJ5IGBhY2NvdW50YC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgYWNjb3VudGAgLSBUaGUgYWRkcmVzcyBmb3Igd2hpY2ggdGhlIGJhbGFuY2UgaXMgYmVpbmcgcXVlcmllZC4AAAAAB2JhbGFuY2UAAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAQ=", "AAAAAAAAAXJSZXR1cm5zIGBTb21lKGluZGV4KWAgaWYgdGhlIGFjY291bnQgaGFzIHRoZSBzcGVjaWZpZWQgcm9sZSwKd2hlcmUgYGluZGV4YCBpcyB0aGUgcG9zaXRpb24gb2YgdGhlIGFjY291bnQgZm9yIHRoYXQgcm9sZSwKYW5kIGNhbiBiZSB1c2VkIHRvIHF1ZXJ5IFtgQWNjZXNzQ29udHJvbDo6Z2V0X3JvbGVfbWVtYmVyKClgXS4KUmV0dXJucyBgTm9uZWAgaWYgdGhlIGFjY291bnQgZG9lcyBub3QgaGF2ZSB0aGUgc3BlY2lmaWVkIHJvbGUuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgYWNjb3VudGAgLSBUaGUgYWNjb3VudCB0byBjaGVjay4KKiBgcm9sZWAgLSBUaGUgcm9sZSB0byBjaGVjayBmb3IuAAAAAAAIaGFzX3JvbGUAAAACAAAAAAAAAAdhY2NvdW50AAAAABMAAAAAAAAABHJvbGUAAAARAAAAAQAAA+gAAAAE", "AAAAAAAAAOVSZXR1cm5zIHRoZSBvd25lciBvZiB0aGUgdG9rZW4gd2l0aCBgdG9rZW5faWRgLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIHRoZSBTb3JvYmFuIGVudmlyb25tZW50LgoqIGB0b2tlbl9pZGAgLSBUb2tlbiBJRCBhcyBhIG51bWJlci4KCiMgRXJyb3JzCgoqIFtgTm9uRnVuZ2libGVUb2tlbkVycm9yOjpOb25FeGlzdGVudFRva2VuYF0gLSBJZiB0aGUgdG9rZW4gZG9lcyBub3QKZXhpc3QuAAAAAAAACG93bmVyX29mAAAAAQAAAAAAAAAIdG9rZW5faWQAAAAEAAAAAQAAABM=", "AAAAAAAAAAAAAAAIdHJhbnNmZXIAAAADAAAAAAAAAARmcm9tAAAAEwAAAAAAAAACdG8AAAAAABMAAAAAAAAACHRva2VuX2lkAAAABAAAAAA=", "AAAAAAAAAAAAAAAJYnVybl9mcm9tAAAAAAAAAwAAAAAAAAAHc3BlbmRlcgAAAAATAAAAAAAAAARmcm9tAAAAEwAAAAAAAAAIdG9rZW5faWQAAAAEAAAAAA==", "AAAAAAAAAE9SZXR1cm5zIHRoZSBhZG1pbiBhY2NvdW50LgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIFNvcm9iYW4gZW52aXJvbm1lbnQuAAAAAAlnZXRfYWRtaW4AAAAAAAAAAAAAAQAAA+gAAAAT", "AAAAAAAAAAAAAAAJdG9rZW5fdXJpAAAAAAAAAQAAAAAAAAAIdG9rZW5faWQAAAAEAAAAAQAAABA=", "AAAAAAAAAGNEZXZ1ZWx2ZSBsb3MgcHJpbWVyb3MgYE1BWF9UT0tFTlNfUEFHRWAgSURzIG1pbnRlYWRvcyBwYXJhIHVuYSBjdWVudGEgKGB0b2tlbnNfb2ZfcGFnZWAgcGFyYSBtw6FzKS4AAAAACXRva2Vuc19vZgAAAAAAAAEAAAAAAAAABW93bmVyAAAAAAAAEwAAAAEAAAPqAAAABA==", "AAAAAAAAAFVFeHRpZW5kZSBlbCBUVEwgZGUgbGEgaW5zdGFuY2lhIGRlbCBjb250cmF0byAobWV0YWRhdGEsIGNvbnRhZG9yZXMgeSBjb25maWd1cmFjacOzbikuAAAAAAAACmV4dGVuZF90dGwAAAAAAAAAAAAA", "AAAAAAAAAj5HcmFudHMgYSByb2xlIHRvIGFuIGFjY291bnQuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgYWNjb3VudGAgLSBUaGUgYWNjb3VudCB0byBncmFudCB0aGUgcm9sZSB0by4KKiBgcm9sZWAgLSBUaGUgcm9sZSB0byBncmFudC4KKiBgY2FsbGVyYCAtIFRoZSBhZGRyZXNzIG9mIHRoZSBjYWxsZXIsIG11c3QgYmUgdGhlIGFkbWluIG9yIGhhdmUgdGhlCmBSb2xlQWRtaW5gIGZvciB0aGUgYHJvbGVgLgoKIyBFcnJvcnMKCiogW2BBY2Nlc3NDb250cm9sRXJyb3I6OlVuYXV0aG9yaXplZGBdIC0gSWYgdGhlIGNhbGxlciBkb2VzIG5vdCBoYXZlCmVub3VnaCBwcml2aWxlZ2VzLgoqIFtgQWNjZXNzQ29udHJvbEVycm9yOjpNYXhSb2xlc0V4Y2VlZGVkYF0gLSBJZiBhZGRpbmcgYSBuZXcgcm9sZSB3b3VsZApleGNlZWQgdGhlIG1heGltdW0gYWxsb3dlZCBudW1iZXIgb2Ygcm9sZXMuCgojIEV2ZW50cwoKKiB0b3BpY3MgLSBgWyJyb2xlX2dyYW50ZWQiLCByb2xlOiBTeW1ib2wsIGFjY291bnQ6IEFkZHJlc3NdYAoqIGRhdGEgLSBgW2NhbGxlcjogQWRkcmVzc11gAAAAAAAKZ3JhbnRfcm9sZQAAAAAAAwAAAAAAAAAHYWNjb3VudAAAAAATAAAAAAAAAARyb2xlAAAAEQAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAA==", "AAAAAAAAAGZEZXZ1ZWx2ZSBsb3MgMSwwMjQgw61uZGljZXMgc2Vtw6FudGljb3MgcmVzdWVsdG9zIChgMC4uPTE1YCkgKyA0NSBieXRlcyBkZSBwYWxldGEgUkdCIChgMSwwNjlgIGJ5dGVzKS4AAAAAAApyYXdfYml0bWFwAAAAAAABAAAAAAAAAAh0b2tlbl9pZAAAAAQAAAABAAAADg==", "AAAAAAAAAFhEZXZ1ZWx2ZSBlbCBTVkcgZXN0w6F0aWNvIDEwMCUgbmF0aXZvIChgPHN2ZyAuLi4+Li4uPC9zdmc+YCkgZGVsIFNvcm9iaXQgKGxlY3R1cmEgcHVyYSkuAAAACnJlbmRlcl9zdmcAAAAAAAEAAAAAAAAACHRva2VuX2lkAAAABAAAAAEAAAAQ", "AAAAAAAAAFREZXZ1ZWx2ZSBlbCByZWdpc3RybyBnZW7Ds21pY28geSB0ZWxlbcOpdHJpY28gY29tcGxldG8gZGUgdW4gU29yb2JpdCAobGVjdHVyYSBwdXJhKS4AAAALZ2V0X3Nvcm9iaXQAAAAAAQAAAAAAAAAIdG9rZW5faWQAAAAEAAAAAQAAB9AAAAANU29yb2JpdFJlY29yZAAAAA==", "AAAAAAAAAAAAAAALZ2V0X3hsbV9zYWMAAAAAAAAAAAEAAAPoAAAAEw==", "AAAAAAAAAEJJbmRpY2Egc2kgdW5hIHdhbGxldCB5YSByZWNsYW3DsyB1biBhcnF1ZXRpcG8gR2VuZXNpcyBlc3BlY8OtZmljby4AAAAAAAtoYXNfY2xhaW1lZAAAAAACAAAAAAAAAAR1c2VyAAAAEwAAAAAAAAAMYXJjaGV0eXBlX2lkAAAABAAAAAEAAAAB", "AAAAAAAAArdSZXZva2VzIGEgcm9sZSBmcm9tIGFuIGFjY291bnQuClRvIHJldm9rZSB0aGUgY2FsbGVyJ3Mgb3duIHJvbGUsIHVzZQpbYEFjY2Vzc0NvbnRyb2w6OnJlbm91bmNlX3JvbGUoKWBdIGluc3RlYWQuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgYWNjb3VudGAgLSBUaGUgYWNjb3VudCB0byByZXZva2UgdGhlIHJvbGUgZnJvbS4KKiBgcm9sZWAgLSBUaGUgcm9sZSB0byByZXZva2UuCiogYGNhbGxlcmAgLSBUaGUgYWRkcmVzcyBvZiB0aGUgY2FsbGVyLCBtdXN0IGJlIHRoZSBhZG1pbiBvciBoYXMgdGhlCmBSb2xlQWRtaW5gIGZvciB0aGUgYHJvbGVgLgoKIyBFcnJvcnMKCiogW2BBY2Nlc3NDb250cm9sRXJyb3I6OlVuYXV0aG9yaXplZGBdIC0gSWYgdGhlIGBjYWxsZXJgIGRvZXMgbm90IGhhdmUKZW5vdWdoIHByaXZpbGVnZXMuCiogW2BBY2Nlc3NDb250cm9sRXJyb3I6OlJvbGVOb3RIZWxkYF0gLSBJZiB0aGUgYGFjY291bnRgIGRvZXNuJ3QgaGF2ZQp0aGUgcm9sZS4KKiBbYEFjY2Vzc0NvbnRyb2xFcnJvcjo6Um9sZUlzRW1wdHlgXSAtIElmIHRoZSByb2xlIGhhcyBubyBtZW1iZXJzLgoKIyBFdmVudHMKCiogdG9waWNzIC0gYFsicm9sZV9yZXZva2VkIiwgcm9sZTogU3ltYm9sLCBhY2NvdW50OiBBZGRyZXNzXWAKKiBkYXRhIC0gYFtjYWxsZXI6IEFkZHJlc3NdYAAAAAALcmV2b2tlX3JvbGUAAAAAAwAAAAAAAAAHYWNjb3VudAAAAAATAAAAAAAAAARyb2xlAAAAEQAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAA==", "AAAAAAAAAFNTZWxsYSBkZSBmb3JtYSBpcnJldmVyc2libGUgZWwgYXJ0ZSB5IGxhcyBwYWxldGFzIGRlIHVuYSB0ZW1wb3JhZGEgKGBzZWFsX3NlYXNvbmApLgAAAAALc2VhbF9zZWFzb24AAAAAAgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAZzZWFzb24AAAAAAAQAAAAA", "AAAAAAAAAEtDb25maWd1cmEgZWwgU0FDIG5hdGl2byBkZSBYTE0gdXRpbGl6YWRvIHBhcmEgbWludGVvIGRlIGPDoXBzdWxhcyBkZSA3IFhMTS4AAAAAC3NldF94bG1fc2FjAAAAAAEAAAAAAAAAB3hsbV9zYWMAAAAAEwAAAAA=", "AAAAAAAAAFZEZXZ1ZWx2ZSBsYSB2ZXJzacOzbiBhbmltYWRhIChgNXNgIHB1bHNvIGRlIHZpc29yIGFjb3JkZSBhbCBjaWVycmUgU0NQLCBsZWN0dXJhIHB1cmEpLgAAAAAADGFuaW1hdGVkX3N2ZwAAAAEAAAAAAAAACHRva2VuX2lkAAAABAAAAAEAAAAQ", "AAAAAAAAANJQYXNvIDEgKENvbW1pdC1SZXZlYWwgZGUgRm9yamEpOiBjb21wcm9tZXRlIGBzaGEyNTYob3duZXJfeGRyIHx8IHNlY3JldCB8fCBidXJuX2EgfHwgYnVybl9iIHx8ICJTQklUX0ZSR19WMSIpYAp2ZXJpZmljYW5kbyBwcm9waWVkYWQgeSBlc3RhZG8gbm8tc291bGJvdW5kIGRlIGFtYm9zIFNvcm9iaXRzIGFudGVzIGRlIHJldmVsYXIgZW4gbGVkZ2VyIHBvc3Rlcmlvci4AAAAAAAxjb21taXRfZm9yZ2UAAAAEAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAACWJ1cm5faWRfYQAAAAAAAAQAAAAAAAAACWJ1cm5faWRfYgAAAAAAAAQAAAAAAAAACmNvbW1pdG1lbnQAAAAAA+4AAAAgAAAAAA==", "AAAAAAAAAIhNb2RvIGxlZ2FkbyBpbnN0YW50w6FuZW8gZGUgRm9yamEgKGJsb3F1ZWFkbyBwb3IgZGVmZWN0byBjb24gYEluc3RhbnRNaW50RGlzYWJsZWRgOwp1c2UgYGNvbW1pdF9mb3JnZWAgKyBgcmV2ZWFsX2ZvcmdlYCBlbiBwcm9kdWNjacOzbikuAAAADGZvcmdlX2FzY2VuZAAAAAQAAAAAAAAABW93bmVyAAAAAAAAEwAAAAAAAAAJYnVybl9pZF9hAAAAAAAABAAAAAAAAAAJYnVybl9pZF9iAAAAAAAABAAAAAAAAAAMdXNlcl9lbnRyb3B5AAAADgAAAAEAAAAE", "AAAAAAAAAPFSZXR1cm5zIHRoZSBhY2NvdW50IGFwcHJvdmVkIGZvciB0aGUgdG9rZW4gd2l0aCBgdG9rZW5faWRgLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIHRoZSBTb3JvYmFuIGVudmlyb25tZW50LgoqIGB0b2tlbl9pZGAgLSBUb2tlbiBJRCBhcyBhIG51bWJlci4KCiMgRXJyb3JzCgoqIFtgTm9uRnVuZ2libGVUb2tlbkVycm9yOjpOb25FeGlzdGVudFRva2VuYF0gLSBJZiB0aGUgdG9rZW4gZG9lcyBub3QKZXhpc3QuAAAAAAAADGdldF9hcHByb3ZlZAAAAAEAAAAAAAAACHRva2VuX2lkAAAABAAAAAEAAAPoAAAAEw==", "AAAAAAAAAtBSZXR1cm5zIHRoZSBgdG9rZW5faWRgIGF0IGEgZ2l2ZW4gYGluZGV4YCBpbiB0aGUgZ2xvYmFsIHRva2VuIGxpc3QuClVzZSBhbG9uZyB3aXRoIFtgTm9uRnVuZ2libGVFbnVtZXJhYmxlOjp0b3RhbF9zdXBwbHlgXSB0byBlbnVtZXJhdGUKYWxsIHRoZSB0b2tlbnMgaW4gdGhlIGNvbnRyYWN0LgoKQSBmdW5jdGlvbiB0byBnZXQgYWxsIHRva2VucyBvZiBhIGNvbnRyYWN0IGlzIG5vdCBwcm92aWRlZCBiZWNhdXNlIHRoYXQKd291bGQgYmUgdW5ib3VuZGVkLiBUbyBlbnVtZXJhdGUgYWxsIHRva2VucyBvZiBhIGNvbnRyYWN0LCB1c2UKW2BOb25GdW5naWJsZUVudW1lcmFibGU6OnRvdGFsX3N1cHBseWBdIHRvIGdldCB0aGUgdG90YWwgbnVtYmVyIG9mCnRva2VucyBhbmQgdGhlbiB1c2UgW2BOb25GdW5naWJsZUVudW1lcmFibGU6OmdldF90b2tlbl9pZGBdIHRvIHJldHJpZXZlCmVhY2ggdG9rZW4gb25lIGJ5IG9uZS4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgaW5kZXhgIC0gSW5kZXggb2YgdGhlIHRva2VuIGluIHRoZSBnbG9iYWwgbGlzdC4KCiMgRXJyb3JzCgoqIFtgY3JhdGU6Om5vbl9mdW5naWJsZTo6Tm9uRnVuZ2libGVUb2tlbkVycm9yOjpUb2tlbk5vdEZvdW5kSW5HbG9iYWxMaXN0YF0gLSBXaGVuIHRoZSB0b2tlbgpJRCBpcyBub3QgZm91bmQgaW4gdGhlIGdsb2JhbCBlbnVtZXJhdGlvbi4AAAAMZ2V0X3Rva2VuX2lkAAAAAQAAAAAAAAAFaW5kZXgAAAAAAAAEAAAAAQAAAAQ=", "AAAAAAAAAAAAAAAMZ2V0X3RyZWFzdXJ5AAAAAAAAAAEAAAPoAAAAEw==", "AAAAAAAAAI9Nb2RvIGxlZ2FkbyBpbnN0YW50w6FuZW8gZGUgQ8OhcHN1bGEgKGJsb3F1ZWFkbyBwb3IgZGVmZWN0byBjb24gYEluc3RhbnRNaW50RGlzYWJsZWRgOwp1c2UgYGNvbW1pdF9jYXBzdWxlYCArIGByZXZlYWxfY2Fwc3VsZWAgZW4gcHJvZHVjY2nDs24pLgAAAAAMbWludF9jYXBzdWxlAAAAAgAAAAAAAAAEdXNlcgAAABMAAAAAAAAADHVzZXJfZW50cm9weQAAAA4AAAABAAAABA==", "AAAAAAAAAFxBY3XDsWEgdW5vIGRlIGxvcyA4IEFycXVldGlwb3MgR2VuZXNpcyBFZGljacOzbiAwIChgMSA9IEFHUTAxIFBpb25lZXIgLi4gOCA9IEFHUTA4IExlZ2VuZGApLgAAAAxtaW50X2dlbmVzaXMAAAAEAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAxhcmNoZXR5cGVfaWQAAAAEAAAAAAAAAAlzb3VsYm91bmQAAAAAAAABAAAAAQAAAAQ=", "AAAAAAAAAJVQYXNvIDIgKENvbW1pdC1SZXZlYWwgZGUgRm9yamEpOiByZXZlbGEgYHNlY3JldGAgZW4gdW4gbGVkZ2VyIHBvc3RlcmlvciwgcXVlbWEgYW1ib3MgU29yb2JpdHMKdHJhbnNmZXJpYmxlcyB5IGZvcmphIGVsIFNvcm9iaXQgYXNjZW5kaWRvIChgR2VuICsgMWApLgAAAAAAAAxyZXZlYWxfZm9yZ2UAAAACAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAABnNlY3JldAAAAAAD7gAAACAAAAABAAAABA==", "AAAAAAAAAXdSZXR1cm5zIGAoQWRkcmVzcywgaTEyOClgIC0gQSB0dXBsZSBjb250YWluaW5nIHRoZSByZWNlaXZlciBhZGRyZXNzIGFuZAp0aGUgcm95YWx0eSBhbW91bnQuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuCiogYHRva2VuX2lkYCAtIFRoZSBpZGVudGlmaWVyIG9mIHRoZSB0b2tlbi4KKiBgc2FsZV9wcmljZWAgLSBUaGUgc2FsZSBwcmljZSBmb3Igd2hpY2ggcm95YWx0aWVzIGFyZSBiZWluZwpjYWxjdWxhdGVkLgoKIyBFcnJvcnMKCiogW2BjcmF0ZTo6bm9uX2Z1bmdpYmxlOjpOb25GdW5naWJsZVRva2VuRXJyb3I6Ok5vbkV4aXN0ZW50VG9rZW5gXSAtIElmCnRoZSB0b2tlbiBkb2VzIG5vdCBleGlzdC4AAAAADHJveWFsdHlfaW5mbwAAAAIAAAAAAAAACHRva2VuX2lkAAAABAAAAAAAAAAKc2FsZV9wcmljZQAAAAAACwAAAAEAAAPtAAAAAgAAABMAAAAL", "AAAAAAAAAFdDb25maWd1cmEgbGEgZGlyZWNjacOzbiBkZSB0ZXNvcmVyw61hIHJlY2VwdG9yYSBkZSBjb21pc2lvbmVzIGRlIEPDoXBzdWxhIChzb2xvIEFkbWluKS4AAAAADHNldF90cmVhc3VyeQAAAAEAAAAAAAAACHRyZWFzdXJ5AAAAEwAAAAA=", "AAAAAAAAAHNSZXR1cm5zIHRoZSB0b3RhbCBhbW91bnQgb2YgdG9rZW5zIHN0b3JlZCBieSB0aGUgY29udHJhY3QuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gdGhlIFNvcm9iYW4gZW52aXJvbm1lbnQuAAAAAAx0b3RhbF9zdXBwbHkAAAAAAAAAAQAAAAQ=", "AAAAAAAAAKxJbmljaWFsaXphIFNvcm9iaXRzIChgU0JJVGApLCByb2xlcyBpbmljaWFsZXMgKGBhZG1pbmApLCByb3lhbHRpZXMgYmFzZSAoYHJveWFsdHlfYnBzYCkKeSBzZWxsYSBkZSBpbm1lZGlhdG8gbGFzIHBsYW50aWxsYXMgYXJ0w61zdGljYXMgZGUgbGEgVGVtcG9yYWRhIDEgKGBBR1EwMeKAk0FHUTA4YCkuAAAADV9fY29uc3RydWN0b3IAAAAAAAAEAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAEHJveWFsdHlfcmVjZWl2ZXIAAAATAAAAAAAAAAtyb3lhbHR5X2JwcwAAAAAEAAAAAAAAABlnZW5lc2lzX2NhcF9wZXJfYXJjaGV0eXBlAAAAAAAABAAAAAA=", "AAAAAAAAAFlQZXJtaXRlIGEgY3VhbHF1aWVyIHBpbG90byByZWNsYW1hciAxIHZleiBzdSBTb3JvYml0IEdlbmVzaXMgQUdRMDEgKCJGbG9vZGdhdGUgUGlvbmVlciIpLgAAAAAAAA1jbGFpbV9waW9uZWVyAAAAAAAAAQAAAAAAAAAEdXNlcgAAABMAAAABAAAABA==", "AAAAAAAAAAAAAAANZ2V0X2xhdW5jaHBhZAAAAAAAAAAAAAABAAAD6AAAABM=", "AAAAAAAAAhZBbGxvd3MgYW4gYWNjb3VudCB0byByZW5vdW5jZSBhIHJvbGUgYXNzaWduZWQgdG8gaXRzZWxmLgpVc2VycyBjYW4gb25seSByZW5vdW5jZSByb2xlcyBmb3IgdGhlaXIgb3duIGFjY291bnQuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgcm9sZWAgLSBUaGUgcm9sZSB0byByZW5vdW5jZS4KKiBgY2FsbGVyYCAtIFRoZSBhZGRyZXNzIG9mIHRoZSBjYWxsZXIsIG11c3QgYmUgdGhlIGFjY291bnQgdGhhdCBoYXMgdGhlCnJvbGUuCgojIEVycm9ycwoKKiBbYEFjY2Vzc0NvbnRyb2xFcnJvcjo6Um9sZU5vdEhlbGRgXSAtIElmIHRoZSBgY2FsbGVyYCBkb2Vzbid0IGhhdmUgdGhlCnJvbGUuCiogW2BBY2Nlc3NDb250cm9sRXJyb3I6OlJvbGVJc0VtcHR5YF0gLSBJZiB0aGUgcm9sZSBoYXMgbm8gbWVtYmVycy4KCiMgRXZlbnRzCgoqIHRvcGljcyAtIGBbInJvbGVfcmV2b2tlZCIsIHJvbGU6IFN5bWJvbCwgYWNjb3VudDogQWRkcmVzc11gCiogZGF0YSAtIGBbY2FsbGVyOiBBZGRyZXNzXWAAAAAAAA1yZW5vdW5jZV9yb2xlAAAAAAAAAgAAAAAAAAAEcm9sZQAAABEAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAA=", "AAAAAAAAAFtWaW5jdWxhIGxhIGRpcmVjY2nDs24gZGVsIGNvbnRyYXRvIExhdW5jaHBhZCBwYXJhIHZhbGlkYXIgbWlzaW9uZXMgeSBlcGlnZW7DqXRpY2Egb24tY2hhaW4uAAAAAA1zZXRfbGF1bmNocGFkAAAAAAAAAQAAAAAAAAAJbGF1bmNocGFkAAAAAAAAEwAAAAA=", "AAAAAAAAAAAAAAANdHJhbnNmZXJfZnJvbQAAAAAAAAQAAAAAAAAAB3NwZW5kZXIAAAAAEwAAAAAAAAAEZnJvbQAAABMAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAh0b2tlbl9pZAAAAAQAAAAA", "AAAAAAAAAERDYW5jZWxhIHVuIHVwZ3JhZGUgV0FTTSBwcm9ncmFtYWRvIGFudGVzIGRlIGVqZWN1dGFyc2UgKHNvbG8gQWRtaW4pLgAAAA5jYW5jZWxfdXBncmFkZQAAAAAAAAAAAAA=", "AAAAAAAAAKBQYXNvIDEgKENvbW1pdC1SZXZlYWwgYW50aS1mcm9udHJ1bm5pbmcpOiBjb21wcm9tZXRlIGBzaGEyNTYobWludGVyX3hkciB8fCBzZWNyZXQgfHwgIlNCSVRfQ0FQX1YxIilgCmFudGVzIGRlIHJldmVsYXIgZW4gdW4gbGVkZ2VyIHBvc3RlcmlvciAoYHJldmVhbF9jYXBzdWxlYCkuAAAADmNvbW1pdF9jYXBzdWxlAAAAAAACAAAAAAAAAAZtaW50ZXIAAAAAABMAAAAAAAAACmNvbW1pdG1lbnQAAAAAA+4AAAAgAAAAAA==", "AAAAAAAAAAAAAAAOZ2VuZXNpc19taW50ZWQAAAAAAAEAAAAAAAAADGFyY2hldHlwZV9pZAAAAAQAAAABAAAABA==", "AAAAAAAAAMVSZXR1cm5zIHRoZSBhZG1pbiByb2xlIGZvciBhIHNwZWNpZmljIHJvbGUuCklmIG5vIGFkbWluIHJvbGUgaXMgZXhwbGljaXRseSBzZXQsIHJldHVybnMgYE5vbmVgLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIFNvcm9iYW4gZW52aXJvbm1lbnQuCiogYHJvbGVgIC0gVGhlIHJvbGUgdG8gcXVlcnkgdGhlIGFkbWluIHJvbGUgZm9yLgAAAAAAAA5nZXRfcm9sZV9hZG1pbgAAAAAAAQAAAAAAAAAEcm9sZQAAABEAAAABAAAD6AAAABE=", "AAAAAAAAAGBSZWdpc3RyYSB1bmEgY2FwYSBgMzJ4MzJgIGNvbXByaW1pZGEgZW4gUkxFIHBhcmEgZnV0dXJhcyB0ZW1wb3JhZGFzIChgc2Vhc29uID49IDJgKSBubyBzZWxsYWRhcy4AAAAOcmVnaXN0ZXJfbGF5ZXIAAAAAAAUAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAGc2Vhc29uAAAAAAAEAAAAAAAAAAhjYXRlZ29yeQAAB9AAAAANTGF5ZXJDYXRlZ29yeQAAAAAAAAAAAAAIbGF5ZXJfaWQAAAAEAAAAAAAAAAlybGVfYnl0ZXMAAAAAAAAOAAAAAA==", "AAAAAAAAAfZBbGxvd3MgdGhlIGN1cnJlbnQgYWRtaW4gdG8gcmVub3VuY2UgdGhlaXIgcm9sZSwgbWFraW5nIHRoZSBjb250cmFjdApwZXJtYW5lbnRseSBhZG1pbi1sZXNzLiBUaGlzIGlzIHVzZWZ1bCBmb3IgZGVjZW50cmFsaXphdGlvbiBwdXJwb3NlcwpvciB3aGVuIHRoZSBhZG1pbiByb2xlIGlzIG5vIGxvbmdlciBuZWVkZWQuIE9uY2UgdGhlIGFkbWluIGlzCnJlbm91bmNlZCwgaXQgY2Fubm90IGJlIHJlaW5zdGF0ZWQuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gU29yb2JhbiBlbnZpcm9ubWVudC4KCiMgRXJyb3JzCgoqIFtgQWNjZXNzQ29udHJvbEVycm9yOjpBZG1pbk5vdFNldGBdIC0gSWYgbm8gYWRtaW4gYWNjb3VudCBpcyBzZXQuCgojIEV2ZW50cwoKKiB0b3BpY3MgLSBgWyJhZG1pbl9yZW5vdW5jZWQiLCBhZG1pbjogQWRkcmVzc11gCiogZGF0YSAtIGBbXWAKCiMgTm90ZXMKCiogQXV0aG9yaXphdGlvbiBmb3IgdGhlIGN1cnJlbnQgYWRtaW4gaXMgcmVxdWlyZWQuAAAAAAAOcmVub3VuY2VfYWRtaW4AAAAAAAAAAAAA", "AAAAAAAAAK1QYXNvIDIgKENvbW1pdC1SZXZlYWwpOiByZXZlbGEgYHNlY3JldGAgZW4gdW4gbGVkZ2VyIHBvc3RlcmlvciBhbCBjb21taXQsIGNvYnJhIDcgWExNCnkgYWN1w7FhIGxhIEPDoXBzdWxhIEdlbmVyYXRpdmEgY29uIGVudHJvcMOtYSBubyBwcmUtc2ltdWxhYmxlIGVuIGVsIGJsb3F1ZSBkZWwgY29tbWl0LgAAAAAAAA5yZXZlYWxfY2Fwc3VsZQAAAAAAAgAAAAAAAAAGbWludGVyAAAAAAATAAAAAAAAAAZzZWNyZXQAAAAAA+4AAAAgAAAAAQAAAAQ=", "AAAAAAAAAb1TZXRzIGBhZG1pbl9yb2xlYCBhcyB0aGUgYWRtaW4gcm9sZSBvZiBgcm9sZWAuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgcm9sZWAgLSBUaGUgcm9sZSB0byBzZXQgdGhlIGFkbWluIGZvci4KKiBgYWRtaW5fcm9sZWAgLSBUaGUgbmV3IGFkbWluIHJvbGUuCgojIEV2ZW50cwoKKiB0b3BpY3MgLSBgWyJyb2xlX2FkbWluX2NoYW5nZWQiLCByb2xlOiBTeW1ib2xdYAoqIGRhdGEgLSBgW3ByZXZpb3VzX2FkbWluX3JvbGU6IFN5bWJvbCwgbmV3X2FkbWluX3JvbGU6IFN5bWJvbF1gCgojIEVycm9ycwoKKiBbYEFjY2Vzc0NvbnRyb2xFcnJvcjo6QWRtaW5Ob3RTZXRgXSAtIElmIGFkbWluIGFjY291bnQgaXMgbm90IHNldC4KCiMgTm90ZXMKCiogQXV0aG9yaXphdGlvbiBmb3IgdGhlIGN1cnJlbnQgYWRtaW4gaXMgcmVxdWlyZWQuAAAAAAAADnNldF9yb2xlX2FkbWluAAAAAAACAAAAAAAAAARyb2xlAAAAEQAAAAAAAAAKYWRtaW5fcm9sZQAAAAAAEQAAAAA=", "AAAAAAAAAFhQYWdpbmFjacOzbiBhY290YWRhIGRlIHRva2VucyBkZSB1bmEgY3VlbnRhIHBhcmEgZXZpdGFyIGzDrW1pdGVzIGRlIHByZXN1cHVlc3RvIFNvcm9iYW4uAAAADnRva2Vuc19vZl9wYWdlAAAAAAADAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAABm9mZnNldAAAAAAABAAAAAAAAAAFbGltaXQAAAAAAAAEAAAAAQAAA+oAAAAE", "AAAAAAAAAsBBcHByb3ZlIG9yIHJlbW92ZSBgb3BlcmF0b3JgIGFzIGFuIG9wZXJhdG9yIGZvciB0aGUgb3duZXIuCgpPcGVyYXRvcnMgY2FuIGNhbGwgYHRyYW5zZmVyX2Zyb20oKWAgZm9yIGFueSB0b2tlbiBoZWxkIGJ5IGBvd25lcmAsCmFuZCBjYWxsIGBhcHByb3ZlKClgIG9uIGJlaGFsZiBvZiBgb3duZXJgLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIFNvcm9iYW4gZW52aXJvbm1lbnQuCiogYG93bmVyYCAtIFRoZSBhZGRyZXNzIGhvbGRpbmcgdGhlIHRva2Vucy4KKiBgb3BlcmF0b3JgIC0gQWNjb3VudCB0byBhZGQgdG8gdGhlIHNldCBvZiBhdXRob3JpemVkIG9wZXJhdG9ycy4KKiBgbGl2ZV91bnRpbF9sZWRnZXJgIC0gVGhlIGxlZGdlciBudW1iZXIgYXQgd2hpY2ggdGhlIGFsbG93YW5jZQpleHBpcmVzLiBJZiBgbGl2ZV91bnRpbF9sZWRnZXJgIGlzIGAwYCwgdGhlIGFwcHJvdmFsIGlzIHJldm9rZWQuCgojIEVycm9ycwoKKiBbYE5vbkZ1bmdpYmxlVG9rZW5FcnJvcjo6SW52YWxpZExpdmVVbnRpbExlZGdlcmBdIC0gSWYgdGhlIGxlZGdlcgpudW1iZXIgaXMgbGVzcyB0aGFuIHRoZSBjdXJyZW50IGxlZGdlciBudW1iZXIuCgojIEV2ZW50cwoKKiB0b3BpY3MgLSBgWyJhcHByb3ZlX2Zvcl9hbGwiLCBvd25lcjogQWRkcmVzc11gCiogZGF0YSAtIGBbb3BlcmF0b3I6IEFkZHJlc3MsIGxpdmVfdW50aWxfbGVkZ2VyOiB1MzJdYAAAAA9hcHByb3ZlX2Zvcl9hbGwAAAAAAwAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAhvcGVyYXRvcgAAABMAAAAAAAAAEWxpdmVfdW50aWxfbGVkZ2VyAAAAAAAABAAAAAA=", "AAAAAAAAAElFamVjdXRhIGVsIHVwZ3JhZGUgV0FTTSBwcm9ncmFtYWRvIHRyYXMgdmVuY2VyIGxhcyA0OCBob3JhcyAoc29sbyBBZG1pbikuAAAAAAAAD2V4ZWN1dGVfdXBncmFkZQAAAAAAAAAAAA==", "AAAAAAAAAEpFeHRpZW5kZSBUVEwgZGUgY3Vwb3MgZGUgY8OhcHN1bGFzIHkgYmFkZ2VzIEdlbmVzaXMgcmVjbGFtYWRvcyBwb3IgYHVzZXJgLgAAAAAAD2V4dGVuZF91c2VyX3R0bAAAAAABAAAAAAAAAAR1c2VyAAAAEwAAAAA=", "AAAAAAAAAFhEZXZ1ZWx2ZSBlbCBwcmVjaW8gYWN0dWFsIGRlIHVuYSBDw6Fwc3VsYSBHZW5lcmF0aXZhIFNvcm9iaXQgZW4gc3Ryb29wcyAoZGVmYXVsdCA3IFhMTSkuAAAAD2dldF9jYXBzdWxlX2ZlZQAAAAAAAAAAAQAAAAs=", "AAAAAAAAAllSZXR1cm5zIHRoZSBhY2NvdW50IGF0IHRoZSBzcGVjaWZpZWQgaW5kZXggZm9yIGEgZ2l2ZW4gcm9sZS4KCkEgZnVuY3Rpb24gdG8gZ2V0IGFsbCBtZW1iZXJzIG9mIGEgcm9sZSBpcyBub3QgcHJvdmlkZWQgYmVjYXVzZSB0aGF0CndvdWxkIGJlIHVuYm91bmRlZC4gVG8gZW51bWVyYXRlIGFsbCBtZW1iZXJzIG9mIGEgcm9sZSwgdXNlCltgQWNjZXNzQ29udHJvbDo6Z2V0X3JvbGVfbWVtYmVyX2NvdW50KClgXSB0byBnZXQgdGhlIHRvdGFsIG51bWJlciBvZgptZW1iZXJzIGFuZCB0aGVuIHVzZSBbYEFjY2Vzc0NvbnRyb2w6OmdldF9yb2xlX21lbWJlcigpYF0gdG8gcmV0cmlldmUKZWFjaCBtZW1iZXIgb25lIGJ5IG9uZS4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byBTb3JvYmFuIGVudmlyb25tZW50LgoqIGByb2xlYCAtIFRoZSByb2xlIHRvIHF1ZXJ5LgoqIGBpbmRleGAgLSBUaGUgaW5kZXggb2YgdGhlIGFjY291bnQgdG8gcmV0cmlldmUuCgojIEVycm9ycwoKKiBbYEFjY2Vzc0NvbnRyb2xFcnJvcjo6SW5kZXhPdXRPZkJvdW5kc2BdIC0gSWYgdGhlIGluZGV4IGlzIG91dCBvZgpib3VuZHMgZm9yIHRoZSByb2xlJ3MgbWVtYmVyIGxpc3QuAAAAAAAAD2dldF9yb2xlX21lbWJlcgAAAAACAAAAAAAAAARyb2xlAAAAEQAAAAAAAAAFaW5kZXgAAAAAAAAEAAAAAQAAABM=", "AAAAAAAAAKBBY3XDsWEgdW4gU29yb2JpdCBnZW5lcmF0aXZvIGNvbiBHZW5vbWEgY3JpcHRvZ3LDoWZpY28gZGUgMjU2IGJpdHMgKGBCeXRlc048MzI+YCkKYXBsaWNhbmRvIGF1dG9tw6F0aWNhbWVudGUgbGEgbWF0cml6IGRlIGNvbXBhdGliaWxpZGFkIHkgZXhjbHVzacOzbiBkZSByYXNnb3MuAAAAD21pbnRfZ2VuZXJhdGl2ZQAAAAAEAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAx1c2VyX2VudHJvcHkAAAAOAAAAAAAAAAlzb3VsYm91bmQAAAAAAAABAAAAAQAAAAQ=", "AAAAAAAAAGBBanVzdGEgZGluw6FtaWNhbWVudGUgZWwgcHJlY2lvIGVuIFhMTSBkZSBsYXMgQ8OhcHN1bGFzIEdlbmVyYXRpdmFzICgwLi49MSwwMDAgWExNLCBzb2xvIEFkbWluKS4AAAAPc2V0X2NhcHN1bGVfZmVlAAAAAAEAAAAAAAAAC2ZlZV9zdHJvb3BzAAAAAAsAAAAA", "AAAAAAAAAGFQcm90ZWdlIGNvbnRyYSBleHBpcmFjacOzbi9hcmNoaXZhZG8gZWwgcmVnaXN0cm8gZ2Vuw7NtaWNvLCBiYXNlbGluZSBkZSBYUCB5IGFzc2V0cyBkZSB0ZW1wb3JhZGEuAAAAAAAAEGV4dGVuZF90b2tlbl90dGwAAAABAAAAAAAAAAh0b2tlbl9pZAAAAAQAAAAA", "AAAAAAAAAAAAAAAQaXNfc2Vhc29uX3NlYWxlZAAAAAEAAAAAAAAABnNlYXNvbgAAAAAABAAAAAEAAAAB", "AAAAAAAAAJ1SZWdpc3RyYSB1bmEgcGFsZXRhIHNlbcOhbnRpY2EgZGUgNDUgYnl0ZXMgKGBzbG90cyAxLi49MTVgKSBwYXJhIGBzZWFzb24gPj0gMmAsCnZhbGlkYW5kbyBhdXRvbcOhdGljYW1lbnRlIG9uLWNoYWluIHRvZGFzIGxhcyByYW1wYXMgZGUgbHVtaW5hbmNpYSB5IHNlbC1vdXQuAAAAAAAAEHJlZ2lzdGVyX3BhbGV0dGUAAAAEAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAABnNlYXNvbgAAAAAABAAAAAAAAAAKZmFjdGlvbl9pZAAAAAAABAAAAAAAAAAJcGFsZXR0ZTQ1AAAAAAAADgAAAAA=", "AAAAAAAAAFVQcm9ncmFtYSB1biB1cGdyYWRlIFdBU00gZGV0csOhcyBkZSB1biB0aW1lbG9jayBvYmxpZ2F0b3JpbyBkZSA0OCBob3JhcyAoc29sbyBBZG1pbikuAAAAAAAAEHNjaGVkdWxlX3VwZ3JhZGUAAAABAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAA", "AAAAAAAAAMBTaW5jcm9uaXphIHNpbiBwZXJtaXNvcyBlbCBYUCB5IGByYW5rX3RpZXJgIGVwaWdlbsOpdGljbyBkZSB1biBTb3JvYml0IGRlc2RlIGxhIGFjdGl2aWRhZApyZWFsIG9uLWNoYWluIGRlIHN1IGR1ZcOxbywgZGVzY29udGFuZG8gbGEgbMOtbmVhIGJhc2UgZGVsIHJlY2VwdG9yIGFsIHRyYW5zZmVyaXIgKGBUb2tlblhwQmFzZWxpbmVgKS4AAAAQc3luY19lcGlnZW5ldGljcwAAAAEAAAAAAAAACHRva2VuX2lkAAAABAAAAAEAAAfQAAAADVNvcm9iaXRSZWNvcmQAAAA=", "AAAAAAAAAJBQZXJtaXRlIHJlY2xhbWFyIGN1YWxxdWllcmEgZGUgbG9zIDggYXJxdWV0aXBvcyBHZW5lc2lzIChgMS4uPThgKSB2ZXJpZmljYW5kbyBvbi1jaGFpbgpsYSB0ZWxlbWV0csOtYSByZWFsIGRlbCBwaWxvdG8gZW4gYExhdW5jaHBhZDo6Z2V0X3BpbG90YC4AAAARY2xhaW1fcXVlc3RfYmFkZ2UAAAAAAAACAAAAAAAAAAR1c2VyAAAAEwAAAAAAAAAMYXJjaGV0eXBlX2lkAAAABAAAAAEAAAAE", "AAAAAAAAALBDYWxjdWxhIGVsIGN1cG8gdXNhZG8geSBlbCBtw6F4aW1vIHBlcm1pdGlkbyBkZSBDw6Fwc3VsYXMgR2VuZXJhdGl2YXMgcGFyYSBgdXNlcmAKKGAobWludGVkX2FjdGl2ZSwgbWF4X2FsbG93ZWQpYCk6IGJhc2UgMiArIDEgcG9yIHF1ZXN0IHJlY2xhbWFkYSArIHRyYWRlcy9ncmFkdWFjaW9uZXMvc2hvdXRzLgAAABFnZXRfY2Fwc3VsZV9xdW90YQAAAAAAAAEAAAAAAAAABHVzZXIAAAATAAAAAQAAA+0AAAACAAAABAAAAAQ=", "AAAAAAAAAF9DYW1iaWEgbGEgdGVtcG9yYWRhIGFjdGl2YSBwYXJhIG51ZXZvcyBtaW50cyBnZW5lcmF0aXZvcyAoYDEuLj0yNTVgLCBzb2xvIHRlbXBvcmFkYXMgc2VsbGFkYXMpLgAAAAARc2V0X2FjdGl2ZV9zZWFzb24AAAAAAAABAAAAAAAAAAZzZWFzb24AAAAAAAQAAAAA", "AAAAAAAAAAAAAAARc2V0X3Rva2VuX3JveWFsdHkAAAAAAAAEAAAAAAAAAAh0b2tlbl9pZAAAAAQAAAAAAAAACHJlY2VpdmVyAAAAEwAAAAAAAAAMYmFzaXNfcG9pbnRzAAAABAAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAA==", "AAAAAAAAARxSZXR1cm5zIGEgdmVjdG9yIGNvbnRhaW5pbmcgYWxsIGV4aXN0aW5nIHJvbGVzLgpEZWZhdWx0cyB0byBlbXB0eSB2ZWN0b3IgaWYgbm8gcm9sZXMgZXhpc3QuCgojIEFyZ3VtZW50cwoKKiBgZWAgLSBBY2Nlc3MgdG8gU29yb2JhbiBlbnZpcm9ubWVudC4KCiMgTm90ZXMKClRoaXMgZnVuY3Rpb24gcmV0dXJucyBhbGwgcm9sZXMgdGhhdCBjdXJyZW50bHkgaGF2ZSBhdCBsZWFzdCBvbmUgbWVtYmVyLgpUaGUgbWF4aW11bSBudW1iZXIgb2Ygcm9sZXMgaXMgbGltaXRlZCBieSBbYE1BWF9ST0xFU2BdLgAAABJnZXRfZXhpc3Rpbmdfcm9sZXMAAAAAAAAAAAABAAAD6gAAABE=", "AAAAAAAAAe1SZXR1cm5zIHRoZSBgdG9rZW5faWRgIG93bmVkIGJ5IGBvd25lcmAgYXQgYSBnaXZlbiBgaW5kZXhgIGluIHRoZQpvd25lcidzIGxvY2FsIGxpc3QuIFVzZSBhbG9uZyB3aXRoCltgY3JhdGU6Om5vbl9mdW5naWJsZTo6Tm9uRnVuZ2libGVUb2tlbjo6YmFsYW5jZWBdIHRvIGVudW1lcmF0ZSBhbGwgb2YKYG93bmVyYCdzIHRva2Vucy4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgb3duZXJgIC0gQWNjb3VudCBvZiB0aGUgdG9rZW4ncyBvd25lci4KKiBgaW5kZXhgIC0gSW5kZXggb2YgdGhlIHRva2VuIGluIHRoZSBvd25lcidzIGxvY2FsIGxpc3QuCgojIEVycm9ycwoKKiBbYGNyYXRlOjpub25fZnVuZ2libGU6Ok5vbkZ1bmdpYmxlVG9rZW5FcnJvcjo6VG9rZW5Ob3RGb3VuZEluT3duZXJMaXN0YF0gLSBXaGVuIHRoZSB0b2tlbgpJRCBpcyBub3QgZm91bmQgaW4gdGhlIG93bmVyJ3MgZW51bWVyYXRpb24uAAAAAAAAEmdldF9vd25lcl90b2tlbl9pZAAAAAAAAgAAAAAAAAAFb3duZXIAAAAAAAATAAAAAAAAAAVpbmRleAAAAAAAAAQAAAABAAAABA==", "AAAAAAAAAGNBY3R1YWxpemEgbGEgZXBpZ2Vuw6l0aWNhIHZpdmEgKGByYW5rX3RpZXJgIGRlbCBtYXJjbyBUVEwgeSBgeHBfc2NvcmVgKSBzaW4gYWx0ZXJhciBlbCBnZW5vbWEgYmFzZS4AAAAAEnVwZGF0ZV9lcGlnZW5ldGljcwAAAAAABAAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAh0b2tlbl9pZAAAAAQAAAAAAAAADW5ld19yYW5rX3RpZXIAAAAAAAAEAAAAAAAAAAZhZGRfeHAAAAAAAAQAAAAA", "AAAAAAAAAAAAAAATZ2V0X3BlbmRpbmdfdXBncmFkZQAAAAAAAAAAAQAAA+gAAAfQAAAAElBlbmRpbmdVcGdyYWRlRGF0YQAA", "AAAAAAAAAAAAAAATZ2V0X3N0b3JhZ2VfdmVyc2lvbgAAAAAAAAAAAQAAAAQ=", "AAAAAAAAANdSZXR1cm5zIHdoZXRoZXIgdGhlIGBvcGVyYXRvcmAgaXMgYWxsb3dlZCB0byBtYW5hZ2UgYWxsIHRoZSBhc3NldHMgb2YKYG93bmVyYC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byB0aGUgU29yb2JhbiBlbnZpcm9ubWVudC4KKiBgb3duZXJgIC0gQWNjb3VudCBvZiB0aGUgdG9rZW4ncyBvd25lci4KKiBgb3BlcmF0b3JgIC0gQWNjb3VudCB0byBiZSBjaGVja2VkLgAAAAATaXNfYXBwcm92ZWRfZm9yX2FsbAAAAAACAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAEAAAAB", "AAAAAAAAAAAAAAATc2V0X2RlZmF1bHRfcm95YWx0eQAAAAADAAAAAAAAAAhyZWNlaXZlcgAAABMAAAAAAAAADGJhc2lzX3BvaW50cwAAAAQAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAA=", "AAAAAAAABABJbml0aWF0ZXMgdGhlIGFkbWluIHJvbGUgdHJhbnNmZXIuCkFkbWluIHByaXZpbGVnZXMgZm9yIHRoZSBjdXJyZW50IGFkbWluIGFyZSBub3QgcmV2b2tlZCB1bnRpbCB0aGUKcmVjaXBpZW50IGFjY2VwdHMgdGhlIHRyYW5zZmVyLgpPdmVycmlkZXMgdGhlIHByZXZpb3VzIHBlbmRpbmcgdHJhbnNmZXIgaWYgdGhlcmUgaXMgb25lLgoKIyBBcmd1bWVudHMKCiogYGVgIC0gQWNjZXNzIHRvIFNvcm9iYW4gZW52aXJvbm1lbnQuCiogYG5ld19hZG1pbmAgLSBUaGUgYWNjb3VudCB0byB0cmFuc2ZlciB0aGUgYWRtaW4gcHJpdmlsZWdlcyB0by4KKiBgbGl2ZV91bnRpbF9sZWRnZXJgIC0gVGhlIGxlZGdlciBudW1iZXIgYXQgd2hpY2ggdGhlIHBlbmRpbmcgdHJhbnNmZXIKZXhwaXJlcy4gSWYgYGxpdmVfdW50aWxfbGVkZ2VyYCBpcyBgMGAsIHRoZSBwZW5kaW5nIHRyYW5zZmVyIGlzCmNhbmNlbGxlZC4gYGxpdmVfdW50aWxfbGVkZ2VyYCBhcmd1bWVudCBpcyBpbXBsaWNpdGx5IGJvdW5kZWQgYnkgdGhlCm1heGltdW0gYWxsb3dlZCBUVEwgZXh0ZW5zaW9uIGZvciBhIHRlbXBvcmFyeSBzdG9yYWdlIGVudHJ5IGFuZApzcGVjaWZ5aW5nIGEgaGlnaGVyIHZhbHVlIHdpbGwgY2F1c2UgdGhlIGNvZGUgdG8gcGFuaWMuCgojIEVycm9ycwoKKiBbYGNyYXRlOjpyb2xlX3RyYW5zZmVyOjpSb2xlVHJhbnNmZXJFcnJvcjo6Tm9QZW5kaW5nVHJhbnNmZXJgXSAtIElmCnRyeWluZyB0byBjYW5jZWwgYSB0cmFuc2ZlciB0aGF0IGRvZXNuJ3QgZXhpc3QuCiogW2BjcmF0ZTo6cm9sZV90cmFuc2Zlcjo6Um9sZVRyYW5zZmVyRXJyb3I6OkludmFsaWRMaXZlVW50aWxMZWRnZXJgXSAtCklmIHRoZSBzcGVjaWZpZWQgbGVkZ2VyIGlzIGluIHRoZSBwYXN0LgoqIFtgY3JhdGU6OnJvbGVfdHJhbnNmZXI6OlJvbGVUcmFuc2ZlckVycm9yOjpJbnZhbGlkUGVuZGluZ0FjY291bnRgXSAtCklmIHRoZSBzcGVjaWZpZWQgcGVuZGluZyBhY2NvdW50IGlzIG5vdCB0aGUgc2FtZSBhcyB0aGUgcHJvdmlkZWQgYG5ld2AKYWRkcmVzcy4KAAAAE3RyYW5zZmVyX2FkbWluX3JvbGUAAAAAAgAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAAAAAARbGl2ZV91bnRpbF9sZWRnZXIAAAAAAAAEAAAAAA==", "AAAAAAAAAAAAAAAUcmVtb3ZlX3Rva2VuX3JveWFsdHkAAAACAAAAAAAAAAh0b2tlbl9pZAAAAAQAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAA=", "AAAAAAAAAYVDb21wbGV0ZXMgdGhlIDItc3RlcCBhZG1pbiB0cmFuc2Zlci4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byBTb3JvYmFuIGVudmlyb25tZW50LgoKIyBFdmVudHMKCiogdG9waWNzIC0gYFsiYWRtaW5fdHJhbnNmZXJfY29tcGxldGVkIiwgbmV3X2FkbWluOiBBZGRyZXNzXWAKKiBkYXRhIC0gYFtwcmV2aW91c19hZG1pbjogQWRkcmVzc11gCgojIEVycm9ycwoKKiBbYGNyYXRlOjpyb2xlX3RyYW5zZmVyOjpSb2xlVHJhbnNmZXJFcnJvcjo6Tm9QZW5kaW5nVHJhbnNmZXJgXSAtIElmCnRoZXJlIGlzIG5vIHBlbmRpbmcgdHJhbnNmZXIgdG8gYWNjZXB0LgoqIFtgQWNjZXNzQ29udHJvbEVycm9yOjpBZG1pbk5vdFNldGBdIC0gSWYgYWRtaW4gYWNjb3VudCBpcyBub3Qgc2V0LgAAAAAAABVhY2NlcHRfYWRtaW5fdHJhbnNmZXIAAAAAAAAAAAAAAA==", "AAAAAAAAAMhSZXR1cm5zIHRoZSB0b3RhbCBudW1iZXIgb2YgYWNjb3VudHMgdGhhdCBoYXZlIHRoZSBzcGVjaWZpZWQgcm9sZS4KSWYgdGhlIHJvbGUgZG9lcyBub3QgZXhpc3QsIHJldHVybnMgMC4KCiMgQXJndW1lbnRzCgoqIGBlYCAtIEFjY2VzcyB0byBTb3JvYmFuIGVudmlyb25tZW50LgoqIGByb2xlYCAtIFRoZSByb2xlIHRvIGdldCB0aGUgY291bnQgZm9yLgAAABVnZXRfcm9sZV9tZW1iZXJfY291bnQAAAAAAAABAAAAAAAAAARyb2xlAAAAEQAAAAEAAAAE", "AAAAAAAAAAAAAAAXaXNfaW5zdGFudF9taW50X2FsbG93ZWQAAAAAAAAAAAEAAAAB", "AAAAAAAAAGFIYWJpbGl0YSBvIGRlc2hhYmlsaXRhIGVsIG1vZG8gbGVnYWRvIGluc3RhbnTDoW5lbyBkZSBjw6Fwc3VsYS9mb3JqYSAoZGVzaGFiaWxpdGFkbyBwb3IgZGVmZWN0bykuAAAAAAAAGHNldF9pbnN0YW50X21pbnRfYWxsb3dlZAAAAAEAAAAAAAAAB2VuYWJsZWQAAAAAAQAAAAA=", "AAAABAAAAAAAAAAAAAAAEVJvbGVUcmFuc2ZlckVycm9yAAAAAAAABAAAAAAAAAARTm9QZW5kaW5nVHJhbnNmZXIAAAAAAAiYAAAAAAAAABZJbnZhbGlkTGl2ZVVudGlsTGVkZ2VyAAAAAAiZAAAAAAAAABVJbnZhbGlkUGVuZGluZ0FjY291bnQAAAAAAAiaAAAAAAAAAA9UcmFuc2ZlckV4cGlyZWQAAAAImw==", "AAAABQAAACVFdmVudCBlbWl0dGVkIHdoZW4gYSByb2xlIGlzIGdyYW50ZWQuAAAAAAAAAAAAAAtSb2xlR3JhbnRlZAAAAAABAAAADHJvbGVfZ3JhbnRlZAAAAAMAAAAAAAAABHJvbGUAAAARAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAI=", "AAAABQAAACVFdmVudCBlbWl0dGVkIHdoZW4gYSByb2xlIGlzIHJldm9rZWQuAAAAAAAAAAAAAAtSb2xlUmV2b2tlZAAAAAABAAAADHJvbGVfcmV2b2tlZAAAAAMAAAAAAAAABHJvbGUAAAARAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAI=", "AAAABQAAAC9FdmVudCBlbWl0dGVkIHdoZW4gdGhlIGFkbWluIHJvbGUgaXMgcmVub3VuY2VkLgAAAAAAAAAADkFkbWluUmVub3VuY2VkAAAAAAABAAAAD2FkbWluX3Jlbm91bmNlZAAAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAABAAAAAg==", "AAAABQAAACtFdmVudCBlbWl0dGVkIHdoZW4gYSByb2xlIGFkbWluIGlzIGNoYW5nZWQuAAAAAAAAAAAQUm9sZUFkbWluQ2hhbmdlZAAAAAEAAAAScm9sZV9hZG1pbl9jaGFuZ2VkAAAAAAADAAAAAAAAAARyb2xlAAAAEQAAAAEAAAAAAAAAE3ByZXZpb3VzX2FkbWluX3JvbGUAAAAAEQAAAAAAAAAAAAAADm5ld19hZG1pbl9yb2xlAAAAAAARAAAAAAAAAAI=", "AAAABAAAAAAAAAAAAAAAEkFjY2Vzc0NvbnRyb2xFcnJvcgAAAAAACwAAAAAAAAAMVW5hdXRob3JpemVkAAAH0AAAAAAAAAALQWRtaW5Ob3RTZXQAAAAH0QAAAAAAAAAQSW5kZXhPdXRPZkJvdW5kcwAAB9IAAAAAAAAAEUFkbWluUm9sZU5vdEZvdW5kAAAAAAAH0wAAAAAAAAASUm9sZUNvdW50SXNOb3RaZXJvAAAAAAfUAAAAAAAAAAxSb2xlTm90Rm91bmQAAAfVAAAAAAAAAA9BZG1pbkFscmVhZHlTZXQAAAAH1gAAAAAAAAALUm9sZU5vdEhlbGQAAAAH1wAAAAAAAAALUm9sZUlzRW1wdHkAAAAH2AAAAAAAAAASVHJhbnNmZXJJblByb2dyZXNzAAAAAAfZAAAAAAAAABBNYXhSb2xlc0V4Y2VlZGVkAAAH2g==", "AAAABQAAADJFdmVudCBlbWl0dGVkIHdoZW4gYW4gYWRtaW4gdHJhbnNmZXIgaXMgY29tcGxldGVkLgAAAAAAAAAAABZBZG1pblRyYW5zZmVyQ29tcGxldGVkAAAAAAABAAAAGGFkbWluX3RyYW5zZmVyX2NvbXBsZXRlZAAAAAIAAAAAAAAACW5ld19hZG1pbgAAAAAAABMAAAABAAAAAAAAAA5wcmV2aW91c19hZG1pbgAAAAAAEwAAAAAAAAAC", "AAAABQAAADJFdmVudCBlbWl0dGVkIHdoZW4gYW4gYWRtaW4gdHJhbnNmZXIgaXMgaW5pdGlhdGVkLgAAAAAAAAAAABZBZG1pblRyYW5zZmVySW5pdGlhdGVkAAAAAAABAAAAGGFkbWluX3RyYW5zZmVyX2luaXRpYXRlZAAAAAMAAAAAAAAADWN1cnJlbnRfYWRtaW4AAAAAAAATAAAAAQAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAAAAAAAAAAAEWxpdmVfdW50aWxfbGVkZ2VyAAAAAAAABAAAAAAAAAAC", "AAAABQAAACVFdmVudCBlbWl0dGVkIHdoZW4gYSB0b2tlbiBpcyBtaW50ZWQuAAAAAAAAAAAAAARNaW50AAAAAQAAAARtaW50AAAAAgAAAAAAAAACdG8AAAAAABMAAAABAAAAAAAAAAh0b2tlbl9pZAAAAAQAAAAAAAAAAg==", "AAAABQAAACpFdmVudCBlbWl0dGVkIHdoZW4gYW4gYXBwcm92YWwgaXMgZ3JhbnRlZC4AAAAAAAAAAAAHQXBwcm92ZQAAAAABAAAAB2FwcHJvdmUAAAAABAAAAAAAAAAIYXBwcm92ZXIAAAATAAAAAQAAAAAAAAAIdG9rZW5faWQAAAAEAAAAAQAAAAAAAAAIYXBwcm92ZWQAAAATAAAAAAAAAAAAAAARbGl2ZV91bnRpbF9sZWRnZXIAAAAAAAAEAAAAAAAAAAI=", "AAAABQAAACpFdmVudCBlbWl0dGVkIHdoZW4gYSB0b2tlbiBpcyB0cmFuc2ZlcnJlZC4AAAAAAAAAAAAIVHJhbnNmZXIAAAABAAAACHRyYW5zZmVyAAAAAwAAAAAAAAAEZnJvbQAAABMAAAABAAAAAAAAAAJ0bwAAAAAAEwAAAAEAAAAAAAAACHRva2VuX2lkAAAABAAAAAAAAAAC", "AAAABQAAADZFdmVudCBlbWl0dGVkIHdoZW4gYXBwcm92YWwgZm9yIGFsbCB0b2tlbnMgaXMgZ3JhbnRlZC4AAAAAAAAAAAANQXBwcm92ZUZvckFsbAAAAAAAAAEAAAAPYXBwcm92ZV9mb3JfYWxsAAAAAAMAAAAAAAAABW93bmVyAAAAAAAAEwAAAAEAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAAAAAAAAAAAEWxpdmVfdW50aWxfbGVkZ2VyAAAAAAAABAAAAAAAAAAC", "AAAABAAAAAAAAAAAAAAAFU5vbkZ1bmdpYmxlVG9rZW5FcnJvcgAAAAAAAA8AAAAkSW5kaWNhdGVzIGEgbm9uLWV4aXN0ZW50IGB0b2tlbl9pZGAuAAAAEE5vbkV4aXN0ZW50VG9rZW4AAADIAAAAV0luZGljYXRlcyBhbiBlcnJvciByZWxhdGVkIHRvIHRoZSBvd25lcnNoaXAgb3ZlciBhIHBhcnRpY3VsYXIgdG9rZW4uClVzZWQgaW4gdHJhbnNmZXJzLgAAAAAOSW5jb3JyZWN0T3duZXIAAAAAAMkAAABFSW5kaWNhdGVzIGEgZmFpbHVyZSB3aXRoIHRoZSBgb3BlcmF0b3JgcyBhcHByb3ZhbC4gVXNlZCBpbiB0cmFuc2ZlcnMuAAAAAAAAFEluc3VmZmljaWVudEFwcHJvdmFsAAAAygAAAFVJbmRpY2F0ZXMgYSBmYWlsdXJlIHdpdGggdGhlIGBhcHByb3ZlcmAgb2YgYSB0b2tlbiB0byBiZSBhcHByb3ZlZC4gVXNlZAppbiBhcHByb3ZhbHMuAAAAAAAAD0ludmFsaWRBcHByb3ZlcgAAAADLAAAASkluZGljYXRlcyBhbiBpbnZhbGlkIHZhbHVlIGZvciBgbGl2ZV91bnRpbF9sZWRnZXJgIHdoZW4gc2V0dGluZwphcHByb3ZhbHMuAAAAAAAWSW52YWxpZExpdmVVbnRpbExlZGdlcgAAAAAAzAAAAClJbmRpY2F0ZXMgb3ZlcmZsb3cgd2hlbiBhZGRpbmcgdHdvIHZhbHVlcwAAAAAAAAxNYXRoT3ZlcmZsb3cAAADNAAAANkluZGljYXRlcyBhbGwgcG9zc2libGUgYHRva2VuX2lkYHMgYXJlIGFscmVhZHkgaW4gdXNlLgAAAAAAE1Rva2VuSURzQXJlRGVwbGV0ZWQAAAAAzgAAAEVJbmRpY2F0ZXMgYW4gaW52YWxpZCBhbW91bnQgdG8gYmF0Y2ggbWludCBpbiBgY29uc2VjdXRpdmVgIGV4dGVuc2lvbi4AAAAAAAANSW52YWxpZEFtb3VudAAAAAAAAM8AAAAzSW5kaWNhdGVzIHRoZSB0b2tlbiBkb2VzIG5vdCBleGlzdCBpbiBvd25lcidzIGxpc3QuAAAAABhUb2tlbk5vdEZvdW5kSW5Pd25lckxpc3QAAADQAAAAMkluZGljYXRlcyB0aGUgdG9rZW4gZG9lcyBub3QgZXhpc3QgaW4gZ2xvYmFsIGxpc3QuAAAAAAAZVG9rZW5Ob3RGb3VuZEluR2xvYmFsTGlzdAAAAAAAANEAAAAjSW5kaWNhdGVzIGFjY2VzcyB0byB1bnNldCBtZXRhZGF0YS4AAAAADVVuc2V0TWV0YWRhdGEAAAAAAADSAAAAQUluZGljYXRlcyB0aGUgbGVuZ3RoIG9mIHRoZSBiYXNlIFVSSSBleGNlZWRzIHRoZSBtYXhpbXVtIGFsbG93ZWQuAAAAAAAAFUJhc2VVcmlNYXhMZW5FeGNlZWRlZAAAAAAAANMAAABHSW5kaWNhdGVzIHRoZSByb3lhbHR5IGFtb3VudCBpcyBoaWdoZXIgdGhhbiAxMF8wMDAgKDEwMCUpIGJhc2lzIHBvaW50cy4AAAAAFEludmFsaWRSb3lhbHR5QW1vdW50AAAA1AAAAD1JbmRpY2F0ZXMgdGhlIGxlbmd0aCBvZiB0aGUgbmFtZSBleGNlZWRzIHRoZSBtYXhpbXVtIGFsbG93ZWQuAAAAAAAAEk5hbWVNYXhMZW5FeGNlZWRlZAAAAAAA1QAAAD9JbmRpY2F0ZXMgdGhlIGxlbmd0aCBvZiB0aGUgc3ltYm9sIGV4Y2VlZHMgdGhlIG1heGltdW0gYWxsb3dlZC4AAAAAFFN5bWJvbE1heExlbkV4Y2VlZGVkAAAA1g==", "AAAABQAAACVFdmVudCBlbWl0dGVkIHdoZW4gYSB0b2tlbiBpcyBidXJuZWQuAAAAAAAAAAAAAARCdXJuAAAAAQAAAARidXJuAAAAAgAAAAAAAAAEZnJvbQAAABMAAAABAAAAAAAAAAh0b2tlbl9pZAAAAAQAAAAAAAAAAg==", "AAAABQAAAChFdmVudCBlbWl0dGVkIHdoZW4gdG9rZW4gcm95YWx0eSBpcyBzZXQuAAAAAAAAAA9TZXRUb2tlblJveWFsdHkAAAAAAQAAABFzZXRfdG9rZW5fcm95YWx0eQAAAAAAAAMAAAAAAAAACHJlY2VpdmVyAAAAEwAAAAEAAAAAAAAACHRva2VuX2lkAAAABAAAAAEAAAAAAAAADGJhc2lzX3BvaW50cwAAAAQAAAAAAAAAAg==", "AAAABQAAACpFdmVudCBlbWl0dGVkIHdoZW4gZGVmYXVsdCByb3lhbHR5IGlzIHNldC4AAAAAAAAAAAARU2V0RGVmYXVsdFJveWFsdHkAAAAAAAABAAAAE3NldF9kZWZhdWx0X3JveWFsdHkAAAAAAgAAAAAAAAAIcmVjZWl2ZXIAAAATAAAAAQAAAAAAAAAMYmFzaXNfcG9pbnRzAAAABAAAAAAAAAAC", "AAAABQAAACxFdmVudCBlbWl0dGVkIHdoZW4gdG9rZW4gcm95YWx0eSBpcyByZW1vdmVkLgAAAAAAAAASUmVtb3ZlVG9rZW5Sb3lhbHR5AAAAAAABAAAAFHJlbW92ZV90b2tlbl9yb3lhbHR5AAAAAQAAAAAAAAAIdG9rZW5faWQAAAAEAAAAAQAAAAI="]),
      options
    );
    this.options = options;
  }

   static deploy<T = Client>(args: { admin: string | Address; royalty_receiver: string | Address; royalty_bps: number; genesis_cap_per_archetype: number }, options: MethodOptions & Omit<ContractClientOptions, 'contractId'> & { salt?: Uint8Array; address?: string; } & ({ wasmHash: Uint8Array | string; format?: "hex" | "base64"; externalRef?: never; } | { externalRef: ExternalExecutableRef; wasmHash?: never; format?: never; })): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(args, options);
  }
  public readonly fromJson = {
    burn : this.txFromJson<void>,  name : this.txFromJson<string>,  symbol : this.txFromJson<string>,  approve : this.txFromJson<void>,  balance : this.txFromJson<number>,  has_role : this.txFromJson<number | null>,  owner_of : this.txFromJson<string>,  transfer : this.txFromJson<void>,  burn_from : this.txFromJson<void>,  get_admin : this.txFromJson<string | null>,  token_uri : this.txFromJson<string>,  tokens_of : this.txFromJson<Array<number>>,  extend_ttl : this.txFromJson<void>,  grant_role : this.txFromJson<void>,  raw_bitmap : this.txFromJson<Uint8Array>,  render_svg : this.txFromJson<string>,  get_sorobit : this.txFromJson<SorobitRecord>,  get_xlm_sac : this.txFromJson<string | null>,  has_claimed : this.txFromJson<boolean>,  revoke_role : this.txFromJson<void>,  seal_season : this.txFromJson<void>,  set_xlm_sac : this.txFromJson<void>,  animated_svg : this.txFromJson<string>,  commit_forge : this.txFromJson<void>,  forge_ascend : this.txFromJson<number>,  get_approved : this.txFromJson<string | null>,  get_token_id : this.txFromJson<number>,  get_treasury : this.txFromJson<string | null>,  mint_capsule : this.txFromJson<number>,  mint_genesis : this.txFromJson<number>,  reveal_forge : this.txFromJson<number>,  royalty_info : this.txFromJson<[string, bigint]>,  set_treasury : this.txFromJson<void>,  total_supply : this.txFromJson<number>,  claim_pioneer : this.txFromJson<number>,  get_launchpad : this.txFromJson<string | null>,  renounce_role : this.txFromJson<void>,  set_launchpad : this.txFromJson<void>,  transfer_from : this.txFromJson<void>,  cancel_upgrade : this.txFromJson<void>,  commit_capsule : this.txFromJson<void>,  genesis_minted : this.txFromJson<number>,  get_role_admin : this.txFromJson<string | null>,  register_layer : this.txFromJson<void>,  renounce_admin : this.txFromJson<void>,  reveal_capsule : this.txFromJson<number>,  set_role_admin : this.txFromJson<void>,  tokens_of_page : this.txFromJson<Array<number>>,  approve_for_all : this.txFromJson<void>,  execute_upgrade : this.txFromJson<void>,  extend_user_ttl : this.txFromJson<void>,  get_capsule_fee : this.txFromJson<bigint>,  get_role_member : this.txFromJson<string>,  mint_generative : this.txFromJson<number>,  set_capsule_fee : this.txFromJson<void>,  extend_token_ttl : this.txFromJson<void>,  is_season_sealed : this.txFromJson<boolean>,  register_palette : this.txFromJson<void>,  schedule_upgrade : this.txFromJson<void>,  sync_epigenetics : this.txFromJson<SorobitRecord>,  claim_quest_badge : this.txFromJson<number>,  get_capsule_quota : this.txFromJson<[number, number]>,  set_active_season : this.txFromJson<void>,  set_token_royalty : this.txFromJson<void>,  get_existing_roles : this.txFromJson<Array<string>>,  get_owner_token_id : this.txFromJson<number>,  update_epigenetics : this.txFromJson<void>,  get_pending_upgrade : this.txFromJson<PendingUpgradeData | null>,  get_storage_version : this.txFromJson<number>,  is_approved_for_all : this.txFromJson<boolean>,  set_default_royalty : this.txFromJson<void>,  transfer_admin_role : this.txFromJson<void>,  remove_token_royalty : this.txFromJson<void>,  accept_admin_transfer : this.txFromJson<void>,  get_role_member_count : this.txFromJson<number>,  is_instant_mint_allowed : this.txFromJson<boolean>,  set_instant_mint_allowed : this.txFromJson<void>
  };

  /** @deprecated Use fromJson instead. */
  public readonly fromJSON = this.fromJson;

  /**
   * Parse a raw contract event (topics + data) into a typed {@link ContractEvent}.
   */
  parseEvent(topics: xdr.ScVal[] | string[], data: xdr.ScVal | string): ContractEvent | undefined {
    return this.spec.parseEvent(topics, data) as ContractEvent | undefined;
  }
  /**
   * Build a topics filter row for the "SeasonSealedEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  seasonSealedEventEventFilter(topicValues?: { season?: number }): string[] {
    return this.spec.eventTopicFilter("SeasonSealedEvent", topicValues);
  }
  /**
   * Build a topics filter row for the "SorobitMintedEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  sorobitMintedEventEventFilter(topicValues?: { to?: string | Address; token_id?: number }): string[] {
    return this.spec.eventTopicFilter("SorobitMintedEvent", topicValues);
  }
  /**
   * Build a topics filter row for the "XlmSacUpdatedEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  xlmSacUpdatedEventEventFilter(topicValues?: { xlm_sac?: string | Address }): string[] {
    return this.spec.eventTopicFilter("XlmSacUpdatedEvent", topicValues);
  }
  /**
   * Build a topics filter row for the "ForgeCommittedEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  forgeCommittedEventEventFilter(topicValues?: { owner?: string | Address }): string[] {
    return this.spec.eventTopicFilter("ForgeCommittedEvent", topicValues);
  }
  /**
   * Build a topics filter row for the "InstantMintModeEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  instantMintModeEventEventFilter(): string[] {
    return this.spec.eventTopicFilter("InstantMintModeEvent");
  }
  /**
   * Build a topics filter row for the "TreasuryUpdatedEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  treasuryUpdatedEventEventFilter(topicValues?: { treasury?: string | Address }): string[] {
    return this.spec.eventTopicFilter("TreasuryUpdatedEvent", topicValues);
  }
  /**
   * Build a topics filter row for the "UpgradeExecutedEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  upgradeExecutedEventEventFilter(): string[] {
    return this.spec.eventTopicFilter("UpgradeExecutedEvent");
  }
  /**
   * Build a topics filter row for the "CapsuleCommittedEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  capsuleCommittedEventEventFilter(topicValues?: { minter?: string | Address }): string[] {
    return this.spec.eventTopicFilter("CapsuleCommittedEvent", topicValues);
  }
  /**
   * Build a topics filter row for the "LaunchpadUpdatedEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  launchpadUpdatedEventEventFilter(topicValues?: { launchpad?: string | Address }): string[] {
    return this.spec.eventTopicFilter("LaunchpadUpdatedEvent", topicValues);
  }
  /**
   * Build a topics filter row for the "UpgradeCancelledEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  upgradeCancelledEventEventFilter(): string[] {
    return this.spec.eventTopicFilter("UpgradeCancelledEvent");
  }
  /**
   * Build a topics filter row for the "UpgradeScheduledEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  upgradeScheduledEventEventFilter(): string[] {
    return this.spec.eventTopicFilter("UpgradeScheduledEvent");
  }
  /**
   * Build a topics filter row for the "CapsuleFeeUpdatedEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  capsuleFeeUpdatedEventEventFilter(): string[] {
    return this.spec.eventTopicFilter("CapsuleFeeUpdatedEvent");
  }
  /**
   * Build a topics filter row for the "EpigeneticUpdatedEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  epigeneticUpdatedEventEventFilter(topicValues?: { token_id?: number }): string[] {
    return this.spec.eventTopicFilter("EpigeneticUpdatedEvent", topicValues);
  }
  /**
   * Build a topics filter row for the "ActiveSeasonUpdatedEvent" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  activeSeasonUpdatedEventEventFilter(): string[] {
    return this.spec.eventTopicFilter("ActiveSeasonUpdatedEvent");
  }
  /**
   * Build a topics filter row for the "RoleGranted" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  roleGrantedEventFilter(topicValues?: { role?: string; account?: string | Address }): string[] {
    return this.spec.eventTopicFilter("RoleGranted", topicValues);
  }
  /**
   * Build a topics filter row for the "RoleRevoked" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  roleRevokedEventFilter(topicValues?: { role?: string; account?: string | Address }): string[] {
    return this.spec.eventTopicFilter("RoleRevoked", topicValues);
  }
  /**
   * Build a topics filter row for the "AdminRenounced" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  adminRenouncedEventFilter(topicValues?: { admin?: string | Address }): string[] {
    return this.spec.eventTopicFilter("AdminRenounced", topicValues);
  }
  /**
   * Build a topics filter row for the "RoleAdminChanged" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  roleAdminChangedEventFilter(topicValues?: { role?: string }): string[] {
    return this.spec.eventTopicFilter("RoleAdminChanged", topicValues);
  }
  /**
   * Build a topics filter row for the "AdminTransferCompleted" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  adminTransferCompletedEventFilter(topicValues?: { new_admin?: string | Address }): string[] {
    return this.spec.eventTopicFilter("AdminTransferCompleted", topicValues);
  }
  /**
   * Build a topics filter row for the "AdminTransferInitiated" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  adminTransferInitiatedEventFilter(topicValues?: { current_admin?: string | Address }): string[] {
    return this.spec.eventTopicFilter("AdminTransferInitiated", topicValues);
  }
  /**
   * Build a topics filter row for the "Mint" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  mintEventFilter(topicValues?: { to?: string | Address }): string[] {
    return this.spec.eventTopicFilter("Mint", topicValues);
  }
  /**
   * Build a topics filter row for the "Approve" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  approveEventFilter(topicValues?: { approver?: string | Address; token_id?: number }): string[] {
    return this.spec.eventTopicFilter("Approve", topicValues);
  }
  /**
   * Build a topics filter row for the "Transfer" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  transferEventFilter(topicValues?: { from?: string | Address; to?: string | Address }): string[] {
    return this.spec.eventTopicFilter("Transfer", topicValues);
  }
  /**
   * Build a topics filter row for the "ApproveForAll" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  approveForAllEventFilter(topicValues?: { owner?: string | Address }): string[] {
    return this.spec.eventTopicFilter("ApproveForAll", topicValues);
  }
  /**
   * Build a topics filter row for the "Burn" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  burnEventFilter(topicValues?: { from?: string | Address }): string[] {
    return this.spec.eventTopicFilter("Burn", topicValues);
  }
  /**
   * Build a topics filter row for the "SetTokenRoyalty" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  setTokenRoyaltyEventFilter(topicValues?: { receiver?: string | Address; token_id?: number }): string[] {
    return this.spec.eventTopicFilter("SetTokenRoyalty", topicValues);
  }
  /**
   * Build a topics filter row for the "SetDefaultRoyalty" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  setDefaultRoyaltyEventFilter(topicValues?: { receiver?: string | Address }): string[] {
    return this.spec.eventTopicFilter("SetDefaultRoyalty", topicValues);
  }
  /**
   * Build a topics filter row for the "RemoveTokenRoyalty" event, for use in `Api.EventFilter.topics` when calling `server.getEvents`. Omitted fields match any value.
   */
  removeTokenRoyaltyEventFilter(topicValues?: { token_id?: number }): string[] {
    return this.spec.eventTopicFilter("RemoveTokenRoyalty", topicValues);
  }
}