
    /**
 * Modular trait categories for Season 2+ Persistent registry uploads.
 */
export const LayerCategory = {
  Suit: 0,
  Helmet: 1,
  Visor: 2,
  Relic: 3,
  Aura: 4,
} as const;
export type LayerCategory = (typeof LayerCategory)[keyof typeof LayerCategory];

/**
 * On-chain record stored per minted Sorobit token.
 */
export interface SorobitRecord {
  /**
   * Ledger sequence at mint time (verifiable provenance).
   */
  born_ledger: number;
  /**
   * 256-bit cryptographic genome:
   * [0]=season, [1]=faction, [2]=suit, [3]=helmet, [4]=visor, [5]=relic, [6]=aura,
   * [7..9]=recessive forge genes (latent Gen 0), [9..32]=entropy/sky seed.
   */
  dna: Uint8Array;
  /**
   * `0` = Generative Mint, `1..=8` = Genesis Archetype (`AGQ01`..`AGQ08`), `9+` = Forge.
   */
  edition: number;
  /**
   * `0` = Gen 0 origin, `1+` = Ascended / Forged generation.
   */
  generation: number;
  /**
   * Epigenetic TTL Shield frame tier (`0..=4`), updates with on-chain activity.
   */
  rank_tier: number;
  /**
   * Optional soulbound lock for merit-only Genesis/rank credentials.
   */
  soulbound: boolean;
  /**
   * On-chain accumulated telemetry / experience points.
   */
  xp_score: number;
}

/**
 * Error Enum: SorobitsError
 */
export const SorobitsError = {
  300 : { message: "InvalidArchetype" },
  301 : { message: "GenesisCapReached" },
  302 : { message: "SoulboundLocked" },
  303 : { message: "SeasonAlreadySealed" },
  304 : { message: "InvalidSeason" },
  305 : { message: "InvalidLayerRle" },
  306 : { message: "InvalidPalette" },
  307 : { message: "InvalidRankTier" },
  308 : { message: "RoyaltyTooHigh" },
  309 : { message: "RecordMissing" },
  310 : { message: "EntropyEmpty" },
  311 : { message: "AlreadyClaimed" },
  312 : { message: "QuestNotUnlocked" },
  313 : { message: "ForgeInvalidPair" },
  314 : { message: "CapsuleQuotaReached" },
  315 : { message: "PaymentNotConfigured" },
  316 : { message: "SvgBudgetExceeded" },
  317 : { message: "InvalidFee" },
  318 : { message: "SeasonNotSealed" },
  319 : { message: "InstantMintDisabled" },
  320 : { message: "CommitmentNotFound" },
  321 : { message: "CommitmentNotReady" },
  322 : { message: "CommitmentMismatch" },
  323 : { message: "UpgradeAlreadyPending" },
  324 : { message: "NoPendingUpgrade" },
  325 : { message: "UpgradeTimelockActive" },
  326 : { message: "InvalidUpgradeHash" },
  327 : { message: "InvalidAssetId" }
}

/**
 * Event: SeasonSealedEvent
 */
export interface SeasonSealedEventEvent {
  name: "SeasonSealedEvent";
  data: {
    season: number;
  };
}

/**
 * Struct: PendingUpgradeData
 */
export interface PendingUpgradeData {
  execute_after: bigint;
  scheduled_at: bigint;
  wasm_hash: Uint8Array;
}

/**
 * Event: SorobitMintedEvent
 */
export interface SorobitMintedEventEvent {
  name: "SorobitMintedEvent";
  data: {
    to: string;
    token_id: number;
    edition?: number;
    dna?: Uint8Array;
    soulbound?: boolean;
  };
}

/**
 * Event: XlmSacUpdatedEvent
 */
export interface XlmSacUpdatedEventEvent {
  name: "XlmSacUpdatedEvent";
  data: {
    xlm_sac: string;
  };
}

/**
 * Event: ForgeCommittedEvent
 */
export interface ForgeCommittedEventEvent {
  name: "ForgeCommittedEvent";
  data: {
    owner: string;
    burn_a?: number;
    burn_b?: number;
    commitment?: Uint8Array;
    commit_ledger?: number;
  };
}

/**
 * Event: InstantMintModeEvent
 */
export interface InstantMintModeEventEvent {
  name: "InstantMintModeEvent";
  data: {
    enabled?: boolean;
  };
}

/**
 * Event: TreasuryUpdatedEvent
 */
export interface TreasuryUpdatedEventEvent {
  name: "TreasuryUpdatedEvent";
  data: {
    treasury: string;
  };
}

/**
 * Event: UpgradeExecutedEvent
 */
export interface UpgradeExecutedEventEvent {
  name: "UpgradeExecutedEvent";
  data: {
    wasm_hash?: Uint8Array;
  };
}

/**
 * Event: CapsuleCommittedEvent
 */
export interface CapsuleCommittedEventEvent {
  name: "CapsuleCommittedEvent";
  data: {
    minter: string;
    commitment?: Uint8Array;
    commit_ledger?: number;
  };
}

/**
 * Event: LaunchpadUpdatedEvent
 */
export interface LaunchpadUpdatedEventEvent {
  name: "LaunchpadUpdatedEvent";
  data: {
    launchpad: string;
  };
}

/**
 * Event: UpgradeCancelledEvent
 */
export interface UpgradeCancelledEventEvent {
  name: "UpgradeCancelledEvent";
  data: {
    wasm_hash?: Uint8Array;
  };
}

/**
 * Event: UpgradeScheduledEvent
 */
export interface UpgradeScheduledEventEvent {
  name: "UpgradeScheduledEvent";
  data: {
    wasm_hash?: Uint8Array;
    execute_after?: bigint;
  };
}

/**
 * Event: CapsuleFeeUpdatedEvent
 */
export interface CapsuleFeeUpdatedEventEvent {
  name: "CapsuleFeeUpdatedEvent";
  data: {
    fee_stroops?: bigint;
  };
}

/**
 * Event: EpigeneticUpdatedEvent
 */
export interface EpigeneticUpdatedEventEvent {
  name: "EpigeneticUpdatedEvent";
  data: {
    token_id: number;
    rank_tier?: number;
    xp_score?: number;
  };
}

/**
 * Event: ActiveSeasonUpdatedEvent
 */
export interface ActiveSeasonUpdatedEventEvent {
  name: "ActiveSeasonUpdatedEvent";
  data: {
    season?: number;
  };
}

/**
 * Error Enum: RoleTransferError
 */
export const RoleTransferError = {
  2200 : { message: "NoPendingTransfer" },
  2201 : { message: "InvalidLiveUntilLedger" },
  2202 : { message: "InvalidPendingAccount" },
  2203 : { message: "TransferExpired" }
}

/**
 * Event emitted when a role is granted.
 */
export interface RoleGrantedEvent {
  name: "RoleGranted";
  data: {
    role: string;
    account: string;
    caller?: string;
  };
}

/**
 * Event emitted when a role is revoked.
 */
export interface RoleRevokedEvent {
  name: "RoleRevoked";
  data: {
    role: string;
    account: string;
    caller?: string;
  };
}

/**
 * Event emitted when the admin role is renounced.
 */
export interface AdminRenouncedEvent {
  name: "AdminRenounced";
  data: {
    admin: string;
  };
}

/**
 * Event emitted when a role admin is changed.
 */
export interface RoleAdminChangedEvent {
  name: "RoleAdminChanged";
  data: {
    role: string;
    previous_admin_role?: string;
    new_admin_role?: string;
  };
}

/**
 * Error Enum: AccessControlError
 */
export const AccessControlError = {
  2000 : { message: "Unauthorized" },
  2001 : { message: "AdminNotSet" },
  2002 : { message: "IndexOutOfBounds" },
  2003 : { message: "AdminRoleNotFound" },
  2004 : { message: "RoleCountIsNotZero" },
  2005 : { message: "RoleNotFound" },
  2006 : { message: "AdminAlreadySet" },
  2007 : { message: "RoleNotHeld" },
  2008 : { message: "RoleIsEmpty" },
  2009 : { message: "TransferInProgress" },
  2010 : { message: "MaxRolesExceeded" }
}

/**
 * Event emitted when an admin transfer is completed.
 */
export interface AdminTransferCompletedEvent {
  name: "AdminTransferCompleted";
  data: {
    new_admin: string;
    previous_admin?: string;
  };
}

/**
 * Event emitted when an admin transfer is initiated.
 */
export interface AdminTransferInitiatedEvent {
  name: "AdminTransferInitiated";
  data: {
    current_admin: string;
    new_admin?: string;
    live_until_ledger?: number;
  };
}

/**
 * Event emitted when a token is minted.
 */
export interface MintEvent {
  name: "Mint";
  data: {
    to: string;
    token_id?: number;
  };
}

/**
 * Event emitted when an approval is granted.
 */
export interface ApproveEvent {
  name: "Approve";
  data: {
    approver: string;
    token_id: number;
    approved?: string;
    live_until_ledger?: number;
  };
}

/**
 * Event emitted when a token is transferred.
 */
export interface TransferEvent {
  name: "Transfer";
  data: {
    from: string;
    to: string;
    token_id?: number;
  };
}

/**
 * Event emitted when approval for all tokens is granted.
 */
export interface ApproveForAllEvent {
  name: "ApproveForAll";
  data: {
    owner: string;
    operator?: string;
    live_until_ledger?: number;
  };
}

/**
 * Error Enum: NonFungibleTokenError
 */
export const NonFungibleTokenError = {
  /**
   * Indicates a non-existent `token_id`.
   */
  200 : { message: "NonExistentToken" },
  /**
   * Indicates an error related to the ownership over a particular token.
   * Used in transfers.
   */
  201 : { message: "IncorrectOwner" },
  /**
   * Indicates a failure with the `operator`s approval. Used in transfers.
   */
  202 : { message: "InsufficientApproval" },
  /**
   * Indicates a failure with the `approver` of a token to be approved. Used
   * in approvals.
   */
  203 : { message: "InvalidApprover" },
  /**
   * Indicates an invalid value for `live_until_ledger` when setting
   * approvals.
   */
  204 : { message: "InvalidLiveUntilLedger" },
  /**
   * Indicates overflow when adding two values
   */
  205 : { message: "MathOverflow" },
  /**
   * Indicates all possible `token_id`s are already in use.
   */
  206 : { message: "TokenIDsAreDepleted" },
  /**
   * Indicates an invalid amount to batch mint in `consecutive` extension.
   */
  207 : { message: "InvalidAmount" },
  /**
   * Indicates the token does not exist in owner's list.
   */
  208 : { message: "TokenNotFoundInOwnerList" },
  /**
   * Indicates the token does not exist in global list.
   */
  209 : { message: "TokenNotFoundInGlobalList" },
  /**
   * Indicates access to unset metadata.
   */
  210 : { message: "UnsetMetadata" },
  /**
   * Indicates the length of the base URI exceeds the maximum allowed.
   */
  211 : { message: "BaseUriMaxLenExceeded" },
  /**
   * Indicates the royalty amount is higher than 10_000 (100%) basis points.
   */
  212 : { message: "InvalidRoyaltyAmount" },
  /**
   * Indicates the length of the name exceeds the maximum allowed.
   */
  213 : { message: "NameMaxLenExceeded" },
  /**
   * Indicates the length of the symbol exceeds the maximum allowed.
   */
  214 : { message: "SymbolMaxLenExceeded" }
}

/**
 * Event emitted when a token is burned.
 */
export interface BurnEvent {
  name: "Burn";
  data: {
    from: string;
    token_id?: number;
  };
}

/**
 * Event emitted when token royalty is set.
 */
export interface SetTokenRoyaltyEvent {
  name: "SetTokenRoyalty";
  data: {
    receiver: string;
    token_id: number;
    basis_points?: number;
  };
}

/**
 * Event emitted when default royalty is set.
 */
export interface SetDefaultRoyaltyEvent {
  name: "SetDefaultRoyalty";
  data: {
    receiver: string;
    basis_points?: number;
  };
}

/**
 * Event emitted when token royalty is removed.
 */
export interface RemoveTokenRoyaltyEvent {
  name: "RemoveTokenRoyalty";
  data: {
    token_id: number;
  };
}
    export type ContractEvent = SeasonSealedEventEvent | SorobitMintedEventEvent | XlmSacUpdatedEventEvent | ForgeCommittedEventEvent | InstantMintModeEventEvent | TreasuryUpdatedEventEvent | UpgradeExecutedEventEvent | CapsuleCommittedEventEvent | LaunchpadUpdatedEventEvent | UpgradeCancelledEventEvent | UpgradeScheduledEventEvent | CapsuleFeeUpdatedEventEvent | EpigeneticUpdatedEventEvent | ActiveSeasonUpdatedEventEvent | RoleGrantedEvent | RoleRevokedEvent | AdminRenouncedEvent | RoleAdminChangedEvent | AdminTransferCompletedEvent | AdminTransferInitiatedEvent | MintEvent | ApproveEvent | TransferEvent | ApproveForAllEvent | BurnEvent | SetTokenRoyaltyEvent | SetDefaultRoyaltyEvent | RemoveTokenRoyaltyEvent;

// Alias de tipo para los enums de error (usados como tipo en las firmas).
export type SorobitsError = { message: string }
export type RoleTransferError = { message: string }
export type AccessControlError = { message: string }
export type NonFungibleTokenError = { message: string }
