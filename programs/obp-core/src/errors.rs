use anchor_lang::prelude::*;

#[error_code]
pub enum ObpError {
    #[msg("Bond multiplier must be >= 10000 bps (100% of coin value); decision B3")]
    BondBelowParity,
    #[msg("Challenge window must be >= 1 slot")]
    WindowTooSmall,
    #[msg("max_links_per_tx must be >= 1")]
    MaxLinksTooSmall,
    #[msg("Coin value must be > 0")]
    ZeroValue,
    #[msg("Bond amount overflows u64")]
    BondOverflow,
    #[msg("Attempt must be 0 or 1")]
    AttemptRange,
    #[msg("Too many submissions for this serial (max 2, R-E)")]
    DuplicateSubmission,
    #[msg("Allowance exceeded for recipient (mint-gate, B6)")]
    AllowanceExceeded,
    #[msg("Allowance cap cannot be set below committed")]
    AllowanceCapBelowCommitted,
    #[msg("Vault cannot drop below total_unspent_supply (I2)")]
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
    #[msg("Empty links vec")]
    EmptyLinks,
    #[msg("Submission state buffer full (chain longer than MAX_SUBMISSION_STATES)")]
    StatesFull,
    #[msg("Challenge window expired")]
    WindowExpired,
    #[msg("Submission does not match this serial")]
    SubmissionMismatch,
    #[msg("Bond escrow transfer failed")]
    BondEscrowFailed,
    #[msg("head_owner does not match the on-chain head-state owner")]
    OwnerAnchorMismatch,
    #[msg("last_hash does not match the hash of the final submitted state")]
    LastHashMismatch,
    #[msg("sig_scheme not supported (0 = Ed25519, 1 = PQ-optimistic; 2 = gereserveerd)")]
    SigSchemeUnsupported,
    #[msg("PQ link-sig: bytes 32..64 moeten nul zijn (sig[0..32] = commitment)")]
    SigCommitFormat,
    #[msg("voorgestelde signature hash-match niet met de opgeslagen commitment")]
    SigCommitMismatch,
    #[msg("alleen de mint-authority mag deze operatie uitvoeren")]
    NotMintAuthority,
}
