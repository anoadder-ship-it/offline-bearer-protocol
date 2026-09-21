use anchor_lang::prelude::*;

use crate::errors::ObpError;
use crate::state::Config;

/// M4.1 (D5): `close_instance` (admin) — draineert de drie init-PDAs
/// (config, vault-marker, fee-marker) naar `drain_to` en assigneert ze naar
/// het system-program, zodat het instance opnieuw ge-init kan worden
/// (devnet) of geretireerd kan worden (mainnet).
///
/// Autorisatie: de mint-authority van het HUIDIGE instance (A3).
///
/// PDA-verificatie: handmatig in de handler via `find_program_address` —
/// de opgeslagen `bump`-velden worden NIET vertrouwd (het oude config heeft
/// bump=0, pre-bump-fix; M1-les: re-afleiden i.p.v. `bump = <acc>.bump` in
/// de constraint, want die faalt dan).
///
/// Kanttekening (M8): per-wallet allowance-PDAs en de vault/fee token
/// accounts (ATAs, owned door de token-program) worden NIET gedraineerd —
/// die vereisen een token-program-close met PDA-signature.
#[derive(Accounts)]
pub struct CloseInstance<'info> {
    /// Alleen de mint-authority van het huidige instance mag sluiten.
    /// PDA-check (`[b"config"]`) zit in de handler (zie commentaar).
    #[account(
        mut,
        constraint = config.mint_authority == mint_authority.key()
            @ ObpError::NotMintAuthority
    )]
    pub config: Account<'info, Config>,
    pub mint_authority: Signer<'info>,
    /// CHECK: Marker PDA [b"vault"] — PDA-seeds handmatig geverifieerd in de
    /// handler via find_program_address; 8-byte marker zonder Anchor-struct.
    /// Drain (lamports) + assign naar system-program in de handler.
    #[account(mut)]
    pub vault_pda: UncheckedAccount<'info>,
    /// CHECK: Marker PDA [b"fee"] — PDA-seeds handmatig geverifieerd in de
    /// handler; 8-byte marker zonder Anchor-struct. Idem vault_pda.
    #[account(mut)]
    pub fee_pda: UncheckedAccount<'info>,
    /// CHECK: Willekeurige wallet (geen PDA/owner-constraint nodig): de
    /// ontvanger van de gedraineerde rent-lamports; autorisatie = mint-authority
    /// (config-constraint hierboven).
    #[account(mut)]
    pub drain_to: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

/// `#[inline(never)]`: dispatch-frame slank houden (M1-les: SBF 4096 B/functie).
#[inline(never)]
pub fn close_instance(ctx: Context<CloseInstance>) -> Result<()> {
    let sys = ctx.accounts.system_program.to_account_info();
    let drain = ctx.accounts.drain_to.to_account_info();
    // (account, seeds) voor de 3 init-PDAs; echte PDA + bump per PDA
    // her-afgeleid (opgeslagen bump niet vertrouwd — zie doc-comment).
    // Eigen AccountInfo-kopieën (niet-referenties): de array leeft langer
    // dan de temporaries van `to_account_info()`.
    let targets: [(AccountInfo, &[&[u8]]); 3] = [
        (ctx.accounts.config.to_account_info(), &[b"config"]),
        (ctx.accounts.vault_pda.to_account_info(), &[b"vault"]),
        (ctx.accounts.fee_pda.to_account_info(), &[b"fee"]),
    ];
    for (acc, seeds) in targets {
        let (expected, bump) = Pubkey::find_program_address(seeds, &crate::ID);
        require_keys_eq!(acc.key(), expected);
        let signer_seeds: &[&[&[u8]]] = &[&[seeds[0], &[bump]]];
        // Anchor 1.1.2 API (gemeten M1): `new_with_signer` neemt een
        // Pubkey; transfer/assign nemen het CpiContext by value.
        let program_id = sys.key();
        // 1) alle lamports naar drain_to (account → 0 lamports).
        let cpi = CpiContext::new_with_signer(
            program_id,
            anchor_lang::system_program::Transfer {
                from: acc.clone(),
                to: drain.clone(),
            },
            signer_seeds,
        );
        anchor_lang::system_program::transfer(cpi, acc.lamports())?;
        // 2) owner → system program (0 lamports + system = her-allocatable).
        let cpi2 = CpiContext::new_with_signer(
            program_id,
            anchor_lang::system_program::Assign {
                account_to_assign: acc,
            },
            signer_seeds,
        );
        anchor_lang::system_program::assign(cpi2, &program_id)?;
    }
    msg!(
        "obp-core close_instance: config/vault/fee gedraineerd naar {}",
        drain.key()
    );
    Ok(())
}
