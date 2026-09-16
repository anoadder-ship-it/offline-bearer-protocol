use anchor_lang::prelude::*;

use crate::errors::ObpError;
use crate::state::Allowance;

/// Wallet verhoogt (M1: alleen verhoogd) zijn offline-toelating (B6, SPEC §5.9).
#[derive(Accounts)]
pub struct SetAllowance<'info> {
    pub wallet: Signer<'info>,
    #[account(
        mut,
        seeds = [b"allowance", wallet.key().as_ref()],
        bump = allowance.bump
    )]
    pub allowance: Account<'info, Allowance>,
}

pub fn set_allowance<'info>(ctx: Context<SetAllowance<'info>>, new_cap: u64) -> Result<()> {
    let allowance = &mut ctx.accounts.allowance;
    require!(
        new_cap >= allowance.committed,
        ObpError::AllowanceCapBelowCommitted
    );
    allowance.cap = new_cap;
    msg!("obp-core set_allowance: cap={}", new_cap);
    Ok(())
}
