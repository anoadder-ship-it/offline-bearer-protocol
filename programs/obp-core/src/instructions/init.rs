use anchor_lang::prelude::*;

use crate::errors::ObpError;
use crate::state::{Config, FeePda, VaultPda};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct InitArgs {
    pub vault_mint: Pubkey,
    pub bond_multiplier_bps: u32,
    pub challenge_window_slots: u64,
    pub max_links_per_tx: u16,
    pub default_allowance: u64,
}

#[derive(Accounts)]
pub struct Init<'info> {
    #[account(
        init,
        payer = payer,
        space = Config::LEN,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    /// Marker: de eigenaar van het vault-token-account (SPEC §4, A3/A4).
    #[account(
        init,
        payer = payer,
        space = VaultPda::LEN,
        seeds = [b"vault"],
        bump
    )]
    pub vault_pda: Account<'info, VaultPda>,
    /// Marker: eigenaar van het fee-sink token-account (DoS-fee's, SPEC §5.10).
    #[account(
        init,
        payer = payer,
        space = FeePda::LEN,
        seeds = [b"fee"],
        bump
    )]
    pub fee_pda: Account<'info, FeePda>,
    /// Claimt de mint-authority-role door te tekenen (SPEC §2, A3).
    pub mint_authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn init<'info>(ctx: Context<Init<'info>>, args: InitArgs) -> Result<()> {
    require!(
        args.bond_multiplier_bps >= 10_000,
        ObpError::BondBelowParity
    );
    require!(
        args.challenge_window_slots >= 1,
        ObpError::WindowTooSmall
    );
    require!(args.max_links_per_tx >= 1, ObpError::MaxLinksTooSmall);

    let config = &mut ctx.accounts.config;
    config.mint_authority = ctx.accounts.mint_authority.key();
    config.vault_mint = args.vault_mint;
    config.bond_multiplier_bps = args.bond_multiplier_bps;
    config.challenge_window_slots = args.challenge_window_slots;
    config.max_links_per_tx = args.max_links_per_tx;
    config.default_allowance = args.default_allowance;
    config.total_unspent_supply = 0;
    config.sig_scheme = 0; // M1: Ed25519 (B5/B8)
    // PDA-bumps opslaan: latere instructies derivaten deze PDA's met
    // `bump = <account>.bump` (o.a. vault_pda.bump voor token-account-ownership).
    config.bump = ctx.bumps.config;
    ctx.accounts.vault_pda.bump = ctx.bumps.vault_pda;
    ctx.accounts.fee_pda.bump = ctx.bumps.fee_pda;

    msg!(
        "obp-core init: mint_authority={}, vault_mint={}, bond_bps={}, window_slots={}, max_links_per_tx={}",
        config.mint_authority,
        config.vault_mint,
        config.bond_multiplier_bps,
        config.challenge_window_slots,
        config.max_links_per_tx
    );
    Ok(())
}

#[derive(Accounts)]
pub struct Ping<'info> {
    pub config: Account<'info, Config>,
}

pub fn ping<'info>(ctx: Context<Ping<'info>>) -> Result<()> {
    // `crate::ID.as_ref()` materialiseert de 32 id-bytes in .rodata, zodat de
    // byte-verificatie (active-defense-conventie, STATUS.md sectie 5) op een
    // contiguous sequence kan zoeken. Zonder zo'n as_ref()-gebruik inline
    // fat-LTO de array als immediates (meetresultaat M0: 0x raw in de .so).
    msg!(
        "obp-core ping: mint_authority={}, total_unspent_supply={}, id_first_byte={}",
        ctx.accounts.config.mint_authority,
        ctx.accounts.config.total_unspent_supply,
        crate::ID.as_ref()[0]
    );
    Ok(())
}
