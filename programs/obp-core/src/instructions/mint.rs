use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};

use crate::errors::ObpError;
use crate::state::state_ops;
use crate::state::{registry_status, Allowance, Config, MintRegistry, VaultPda};

/// Munt een coin: registreert (serial, value) met genesis-hash, begrensd door
/// de toelating (B6) en de vault-backing (I2/A4). De waarde blijft in de vault
/// (de vault IS de backing); bij spend (finalize-win/settle) gaat ze naar de
/// winnaar. SPEC §5.3.
#[derive(Accounts)]
#[instruction(serial: [u8; 32], value: u64, recipient: Pubkey)]
pub struct MintCoin<'info> {
    #[account(
        mut,
        constraint = mint_authority.key() == config.mint_authority
            @ ObpError::StatusInvalid
    )]
    pub mint_authority: Signer<'info>,
    #[account(mut)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = payer,
        space = MintRegistry::LEN,
        seeds = [b"mint", serial.as_ref()],
        bump
    )]
    pub registry: Account<'info, MintRegistry>,
    #[account(
        constraint = vault.mint == config.vault_mint
            && vault.owner == vault_pda.key()
            @ ObpError::StatusInvalid
    )]
    pub vault: Account<'info, TokenAccount>,
    pub vault_pda: Account<'info, VaultPda>,
    #[account(
        init_if_needed,
        payer = payer,
        space = Allowance::LEN,
        seeds = [b"allowance", recipient.as_ref()],
        bump
    )]
    pub recipient_allowance: Account<'info, Allowance>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
}

pub fn mint_coin<'info>(
    ctx: Context<MintCoin<'info>>,
    serial: [u8; 32],
    value: u64,
    recipient: Pubkey,
    genesis_state_hash: [u8; 32],
    mint_tx: [u8; 64],
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let registry = &mut ctx.accounts.registry;
    let allowance = &mut ctx.accounts.recipient_allowance;

    require!(value > 0, ObpError::ZeroValue);

    // De on-chain genesis staat op (serial, value, recipient, 0^32); de client
    // heeft zelf state_0 gebouwd — de hashes moeten overeenkomen (I4-anker).
    let genesis = state_ops::genesis_state(&serial, value, &recipient.to_bytes());
    require!(
        state_ops::state_hash(&genesis) == genesis_state_hash,
        ObpError::GenesisMismatch
    );

    // I2: de vault moet de supply ook ná deze mint dragen (waarde blijft in de
    // vault — de mint verplaatst geen tokens).
    require!(
        ctx.accounts.vault.amount >= config.total_unspent_supply + value,
        ObpError::VaultUnderflow
    );
    config.total_unspent_supply += value;

    // Toelating (B6: mint-gate). Bij eerste gebruik: default cap.
    if !allowance.initialized {
        allowance.cap = config.default_allowance;
        allowance.committed = 0;
        allowance.initialized = true;
    }
    require!(
        allowance.committed + value <= allowance.cap,
        ObpError::AllowanceExceeded
    );
    allowance.committed += value;
    // init_if_needed: PDA-bump opslaan zodat set_allowance (en de
    // remaining_accounts-validatie) de allowance-PDA met
    // `bump = allowance.bump` kunnen re-derivaten.
    let (_, allowance_bump) = Pubkey::find_program_address(
        &[b"allowance".as_ref(), recipient.as_ref()],
        &crate::ID,
    );
    allowance.bump = allowance_bump;

    registry.serial = serial;
    registry.value = value;
    registry.genesis_state_hash = genesis_state_hash;
    registry.mint_slot = Clock::get()?.slot;
    registry.mint_tx = mint_tx;
    registry.recipient = recipient;
    registry.status = registry_status::ACTIVE;
    registry.submissions_count = 0;
    // PDA-bump opslaan: start_check_in/append_links/finalize/settle derivaten de
    // registry met `bump = registry.bump`. Zonder dit is registry.bump = 0 en
    // klopt de PDA niet (het echte bump is meestal 255).
    registry.bump = ctx.bumps.registry;

    msg!(
        "obp-core mint_coin: serial={:?} value={} recipient={} supply={}",
        serial,
        value,
        recipient,
        config.total_unspent_supply
    );
    Ok(())
}
