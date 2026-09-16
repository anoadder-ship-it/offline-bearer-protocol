use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Transfer, Token, TokenAccount};

use crate::errors::ObpError;
use crate::state::{Config, VaultPda};

/// Voegt reserve toe aan de vault (SPEC §5.2).
#[derive(Accounts)]
pub struct FundVault<'info> {
    #[account(
        mut,
        constraint = mint_authority.key() == config.mint_authority
            @ ObpError::StatusInvalid
    )]
    pub mint_authority: Signer<'info>,
    pub config: Account<'info, Config>,
    #[account(
        mut,
        constraint = source.mint == config.vault_mint
            && source.owner == mint_authority.key()
            @ ObpError::StatusInvalid
    )]
    pub source: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = vault.mint == config.vault_mint
            && vault.owner == vault_pda.key()
            @ ObpError::StatusInvalid
    )]
    pub vault: Account<'info, TokenAccount>,
    pub vault_pda: Account<'info, VaultPda>,
    pub token_program: Program<'info, Token>,
}

pub fn fund_vault<'info>(ctx: Context<FundVault<'info>>, amount: u64) -> Result<()> {
    let cpi = CpiContext::new(
        ctx.accounts.token_program.key(),
        Transfer {
            from: ctx.accounts.source.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.mint_authority.to_account_info(),
        },
    );
    transfer(cpi, amount)?;
    msg!("obp-core fund_vault: {} -> vault", amount);
    Ok(())
}

/// Haalt reserve uit de vault, begrensd door I2: de vault moet achteraf nog
/// ≥ total_unspent_supply dragen (SPEC §5.2, A4).
#[derive(Accounts)]
pub struct WithdrawVault<'info> {
    #[account(
        mut,
        constraint = mint_authority.key() == config.mint_authority
            @ ObpError::StatusInvalid
    )]
    pub mint_authority: Signer<'info>,
    #[account(mut)]
    pub config: Account<'info, Config>,
    #[account(
        constraint = source.mint == config.vault_mint
            && source.owner == vault_pda.key()
            @ ObpError::StatusInvalid
    )]
    pub source: Account<'info, TokenAccount>,
    #[account(
        mut,
        constraint = vault.mint == config.vault_mint
            && vault.owner == mint_authority.key()
            @ ObpError::StatusInvalid
    )]
    pub vault: Account<'info, TokenAccount>,
    pub vault_pda: Account<'info, VaultPda>,
    pub token_program: Program<'info, Token>,
}

pub fn withdraw_vault<'info>(ctx: Context<WithdrawVault<'info>>, amount: u64) -> Result<()> {
    let config = &ctx.accounts.config;
    let source_balance = ctx.accounts.source.amount;
    require!(
        source_balance >= config.total_unspent_supply + amount,
        ObpError::VaultUnderflow
    );
    let cpi = CpiContext::new(
        ctx.accounts.token_program.key(),
        Transfer {
            from: ctx.accounts.source.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
            authority: ctx.accounts.mint_authority.to_account_info(),
        },
    );
    transfer(cpi, amount)?;
    msg!("obp-core withdraw_vault: {} -> mint_authority", amount);
    Ok(())
}
