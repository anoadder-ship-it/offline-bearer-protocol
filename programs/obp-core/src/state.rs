use anchor_lang::prelude::*;

/// Global OBP Core configuration (SPEC.md §4).
///
/// LEN = 8 (discriminator) + 32 + 32 + 4 + 8 + 2 + 8 + 8 + 1 = 103
#[account]
pub struct Config {
    /// Key that may mint coins and fund/withdraw the vault (SPEC §2, A3).
    pub mint_authority: Pubkey,
    /// Token-2022 mint backing all coins (the vault mint, SPEC §4).
    pub vault_mint: Pubkey,
    /// Bond = value * bond_multiplier_bps / 10000; must stay >= 10000 (100%),
    /// decision B3 (mandatory full collateral).
    pub bond_multiplier_bps: u32,
    /// Dispute/challenge window in SLOTS (never wall-clock; SPEC §5, T7).
    pub challenge_window_slots: u64,
    /// Max coin-chain links accepted per `append_links` tx (B10; measured at M1).
    pub max_links_per_tx: u16,
    /// Default offline allowance per wallet (B6: mint-gate).
    pub default_allowance: u64,
    /// Invariant I2: sum of value of unspent coins; vault_balance >= this always.
    pub total_unspent_supply: u64,
    pub bump: u8,
}

impl Config {
    pub const LEN: usize = 8 + 32 + 32 + 4 + 8 + 2 + 8 + 8 + 1;
}

/// Marker account; the actual vault is a token-2022 account whose `owner` is
/// this PDA (SPEC §4, §5.1). Created together with Config in M1.
#[account]
pub struct VaultPda {
    pub bump: u8,
}

impl VaultPda {
    pub const LEN: usize = 8 + 1;
}

/// Sinks DoS fees from invalid/stale check-ins (SPEC §5.10, rows R5–R7).
#[account]
pub struct FeePda {
    pub bump: u8,
}

impl FeePda {
    pub const LEN: usize = 8 + 1;
}
