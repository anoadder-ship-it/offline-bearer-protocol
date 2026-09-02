use anchor_lang::prelude::*;

#[error_code]
pub enum ObpError {
    #[msg("Bond multiplier must be >= 10000 bps (100% of coin value); decision B3")]
    BondBelowParity,
    #[msg("Challenge window must be >= 1 slot")]
    WindowTooSmall,
    #[msg("max_links_per_tx must be >= 1")]
    MaxLinksTooSmall,
    // M1 (SPEC §5):
    #[msg("Mint registry entry already exists for this serial")]
    SerialExists,
    #[msg("Coin value must be > 0")]
    ZeroValue,
    #[msg("Allowance exceeded for recipient (mint-gate, B6)")]
    AllowanceExceeded,
    #[msg("Vault balance cannot drop below total_unspent_supply (I2)")]
    VaultUnderflow,
    #[msg("Serial in chain does not match mint registry")]
    SerialMismatch,
    #[msg("Value in chain does not match mint registry")]
    ValueMismatch,
    #[msg("Genesis hash mismatch (state_0 vs registry)")]
    GenesisMismatch,
    #[msg("Chain broken: prev_state_hash does not match previous state")]
    ChainBroken,
    #[msg("Invalid signature on chain link")]
    BadSignature,
    #[msg("Invalid account state for this operation")]
    StatusInvalid,
    #[msg("Too many links in one tx (max_links_per_tx)")]
    MaxLinksExceeded,
    #[msg("Challenge window expired")]
    WindowExpired,
    #[msg("More than two submissions per serial")]
    DuplicateSubmission,
}
