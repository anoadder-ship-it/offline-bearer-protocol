use anchor_lang::prelude::*;

use crate::errors::ObpError;
use crate::state::Config;

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
    /// Claims the mint-authority role by signing (SPEC §2, A3).
    pub mint_authority: Signer<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn init(ctx: Context<Init>, args: InitArgs) -> Result<()> {
    require!(
        args.bond_multiplier_bps >= 10_000,
        ObpError::BondBelowParity
    );
    require!(
        args.challenge_window_slots >= 1,
        ObpError::WindowTooSmall
    );
    require!(
        args.max_links_per_tx >= 1,
        ObpError::MaxLinksTooSmall
    );

    let config = &mut ctx.accounts.config;
    config.mint_authority = ctx.accounts.mint_authority.key();
    config.vault_mint = args.vault_mint;
    config.bond_multiplier_bps = args.bond_multiplier_bps;
    config.challenge_window_slots = args.challenge_window_slots;
    config.max_links_per_tx = args.max_links_per_tx;
    config.default_allowance = args.default_allowance;
    config.total_unspent_supply = 0;

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

pub fn ping(ctx: Context<Ping>) -> Result<()> {
    // `crate::ID.as_ref()` materializeert de 32 id-bytes in .rodata, zodat de
    // byte-verificatie (active-defense-conventie, STATUS.md sectie 5) op een
    // contiguous sequence kan zoeken. Meetresultaat M0 zonder deze regel: de id
    // kwam 0× raw in de .so voor (fat-LTO inline de array als immediates in de
    // `!=`-vergelijking van try_entry). Met as_ref()-gebruik: 1× (zie STATUS §5).
    msg!(
        "obp-core ping: mint_authority={}, total_unspent_supply={}, id_first_byte={}",
        ctx.accounts.config.mint_authority,
        ctx.accounts.config.total_unspent_supply,
        crate::ID.as_ref()[0]
    );
    Ok(())
}
