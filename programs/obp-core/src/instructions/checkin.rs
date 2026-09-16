use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Token, TokenAccount, Transfer};

use crate::errors::ObpError;
use crate::state::state_ops;
use crate::state::{
    registry_status, submission_status, Allowance, Config, FeePda, HeadRegistry, MintRegistry,
    Submission, VaultPda, MAX_SUBMISSION_STATES, STATE_SIZE,
};

/// Eén link: de volgende state + de handtekening van de eigenaar van de
/// VORIGE state op H(state) (SPEC §3.2). M1: Ed25519 (B5), 64 bytes.
/// M1.x: verificatie door de ed25519-precompile (Ed25519SigVerify1111…) in de
/// zelfde tx — een top-level instruction die via Ed25519SignatureOffsets naar
/// deze instruction-data verwijst. Niet door het program zelf (CU-budget:
/// dalek in BPF ≈ 90k+ CU/verify > default 200k; precompile 2400 CU/verify).
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Link {
    pub state: [u8; STATE_SIZE],
    pub sig: [u8; 64],
}

/// Bond = value * bps / 10000 met overflow-guard (B3: bps ≥ 10000).
/// `#[inline(never)]`: LTO zou dit anders in de grote handler-frames inlinen
/// (SBF-frame-limit 4096 B/function, gemeten M1).
#[inline(never)]
pub fn bond_amount(value: u64, bps: u32) -> Result<u64> {
    require!(bps >= 10_000, ObpError::BondBelowParity);
    let scaled = value
        .checked_mul(u64::from(bps))
        .ok_or(ObpError::BondOverflow)?;
    Ok(scaled / 10_000)
}

/// Token-transfer waarbij de authority een PDA is.
///
/// Anchor 1.1.2 API (gemeten): `CpiContext::new_with_signer` neemt een
/// `Pubkey` (geen AccountInfo) als eerste argument en `&[&[&[u8]]]` —
/// een slice van één PDA's seeds-array. Seeds-lifetimes ('a,'b,'c) zijn
/// apart van de AccountInfo-lifetime 'info: de seeds zijn function-lokale,
/// de AccountInfos komen van de Context (langere lifetime).
///
/// `#[inline(never)]` is functioneel nodig: de SBF-linker waarschuwt bij
/// inlining dat `settle`/`finalize_check_in` hun eigen stack-frame overschrijven
/// (→ undefined behavior). Met een echte function call krijgt pda_transfer zijn
/// eigen frame (gemeten M1: 4 inlines per settle → frame-overflow warning).
#[inline(never)]
fn pda_transfer<'a, 'b, 'c, 'info>(
    token_program_id: Pubkey,
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    signer_seeds: &'a [&'b [&'c [u8]]],
    amount: u64,
) -> Result<()> {
    let cpi_accounts = Transfer {
        from: from.clone(),
        to: to.clone(),
        authority: authority.clone(),
    };
    let cpi_ctx = CpiContext::new_with_signer(token_program_id, cpi_accounts, signer_seeds);
    transfer(cpi_ctx, amount)?;
    Ok(())
}

/// Reference naar de laatste state (geen kopie op de stack — SBF-frame
/// bezorgen; de SBF-frame-limit is 4096 B/function, gemeten M1).
fn last_state(sub: &Submission) -> &[u8; STATE_SIZE] {
    &sub.states[(sub.states_len as usize) - 1]
}

/// Volledige chain-verificatie (I4): state_0 klopt met de registry-genesis en
/// elke link is hash-consistent. Handtekeningen zijn bij `append_links`
/// geverifieerd (één-wege-deur: states komen alleen via start/append het
/// account binnen) — de hashketen wordt bij finalize opnieuw geverifieerd
/// (defense-in-depth; M1-verfijning, SPEC v0.1.1).
/// `#[inline(never)]`: roept per link state_hash (sha256) aan; inlining in de
/// handler zou het frame blazen (SBF-frame-limit, gemeten M1).
#[inline(never)]
fn verify_full_chain(sub: &Submission, registry: &MintRegistry) -> Result<()> {
    let n = sub.states_len as usize;
    require!(n >= 1, ObpError::StatusInvalid);
    require!(
        state_ops::state_hash(&sub.states[0]) == registry.genesis_state_hash,
        ObpError::GenesisMismatch
    );
    for i in 1..n {
        let prev = &sub.states[i - 1];
        let cur = &sub.states[i];
        require!(
            state_ops::parse_serial(cur) == registry.serial,
            ObpError::SerialMismatch
        );
        require!(
            state_ops::parse_value(cur) == registry.value,
            ObpError::ValueMismatch
        );
        require!(
            state_ops::parse_prev_hash(cur) == state_ops::state_hash(prev),
            ObpError::ChainBroken
        );
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// start_check_in (SPEC §5.4)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(serial: [u8; 32], attempt: u8)]
pub struct StartCheckIn<'info> {
    #[account(constraint = config.sig_scheme == 0 @ ObpError::StatusInvalid)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"mint", serial.as_ref()],
        bump = registry.bump,
        constraint = registry.status == registry_status::ACTIVE
            @ ObpError::StatusInvalid
    )]
    pub registry: Account<'info, MintRegistry>,
    #[account(
        init,
        payer = payer,
        space = Submission::LEN,
        seeds = [b"submission", serial.as_ref(), &attempt.to_be_bytes()],
        bump
    )]
    pub submission: Account<'info, Submission>,
    /// De bearer die indient (betaalt de bond).
    pub checker: Signer<'info>,
    #[account(
        mut,
        constraint = checker_token.mint == config.vault_mint
            && checker_token.owner == checker.key()
            @ ObpError::BondEscrowFailed
    )]
    pub checker_token: Account<'info, TokenAccount>,
    /// Escrow voor de bond; owner = submission-PDA; moet leeg zijn (geen
    /// dubbel-escrow, T6).
    #[account(
        mut,
        constraint = escrow.mint == config.vault_mint
            && escrow.owner == submission.key()
            && escrow.amount == 0
            @ ObpError::BondEscrowFailed
    )]
    pub escrow: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn start_check_in<'info>(
    ctx: Context<StartCheckIn<'info>>,
    serial: [u8; 32],
    attempt: u8,
    state_0: [u8; STATE_SIZE],
) -> Result<()> {
    let config = &ctx.accounts.config;
    let registry = &mut ctx.accounts.registry;
    let submission = &mut ctx.accounts.submission;

    require!(attempt <= 1, ObpError::AttemptRange);
    require!(registry.submissions_count < 2, ObpError::DuplicateSubmission);
    require!(
        state_ops::parse_serial(&state_0) == serial,
        ObpError::SerialMismatch
    );
    require!(
        state_ops::parse_value(&state_0) == registry.value,
        ObpError::ValueMismatch
    );
    require!(
        state_ops::state_hash(&state_0) == registry.genesis_state_hash,
        ObpError::GenesisMismatch
    );

    let slot = Clock::get()?.slot;
    submission.serial = serial;
    submission.attempt = attempt;
    submission.checker = ctx.accounts.checker.key();
    submission.final_owner =
        Pubkey::new_from_array(state_ops::parse_owner(&state_0));
    submission.links_count = 0;
    submission.started_slot = slot;
    submission.finalized_slot = 0;
    submission.status = submission_status::RECEIVING;
    submission.states_len = 1;
    submission.states[0] = state_0;
    // PDA-bump opslaan: append_links/finalize/settle derivaten de submission met
    // `bump = submission.bump` / sub_pda.
    submission.bump = ctx.bumps.submission;
    registry.submissions_count += 1;

    // Verplichte bond (B3): volledige collateral, escrowd bij start.
    let bond = bond_amount(registry.value, config.bond_multiplier_bps)?;
    let cpi = CpiContext::new(
        ctx.accounts.token_program.key(),
        Transfer {
            from: ctx.accounts.checker_token.to_account_info(),
            to: ctx.accounts.escrow.to_account_info(),
            authority: ctx.accounts.checker.to_account_info(),
        },
    );
    transfer(cpi, bond)?;

    msg!(
        "obp-core start_check_in: attempt={} bond={}",
        attempt,
        bond
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// append_links (SPEC §5.5)
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(serial: [u8; 32])]
pub struct AppendLinks<'info> {
    #[account(constraint = config.sig_scheme == 0 @ ObpError::StatusInvalid)]
    pub config: Account<'info, Config>,
    #[account(
        seeds = [b"mint", serial.as_ref()],
        bump = registry.bump
    )]
    pub registry: Account<'info, MintRegistry>,
    #[account(
        mut,
        constraint = submission.status == submission_status::RECEIVING
            @ ObpError::StatusInvalid
    )]
    pub submission: Account<'info, Submission>,
}

pub fn append_links<'info>(
    ctx: Context<AppendLinks<'info>>,
    serial: [u8; 32],
    head_owner: [u8; 32],
    links: Vec<Link>,
    last_hash: [u8; 32],
) -> Result<()> {
    let config = &ctx.accounts.config;
    let registry = &ctx.accounts.registry;
    let submission = &mut ctx.accounts.submission;

    require!(serial == submission.serial, ObpError::SubmissionMismatch);
    require!(!links.is_empty(), ObpError::EmptyLinks);
    require!(
        links.len() <= config.max_links_per_tx as usize,
        ObpError::MaxLinksExceeded
    );
    require!(
        submission.states_len as usize + links.len() <= MAX_SUBMISSION_STATES,
        ObpError::StatesFull
    );
    require!(submission.states_len >= 1, ObpError::StatusInvalid);

    // Anker op de on-chain head. M1.x-bugfix: de oude loop las
    // states[states_len-1] constant → bij batches van 2+ links werd link 2+
    // vergeleken met H(state_0) i.p.v. H(state_{k-1}) (ChainBroken) en vielen
    // tussentijdse states weg (alle writes naar states[idx+1]).
    let mut prev: [u8; STATE_SIZE] =
        submission.states[(submission.states_len - 1) as usize];
    require!(
        state_ops::parse_owner(&prev) == head_owner,
        ObpError::OwnerAnchorMismatch
    );

    let base = submission.states_len as usize;
    for (i, link) in links.iter().enumerate() {
        let st = &link.state;
        require!(
            state_ops::parse_serial(st) == registry.serial,
            ObpError::SerialMismatch
        );
        require!(
            state_ops::parse_value(st) == registry.value,
            ObpError::ValueMismatch
        );
        require!(
            state_ops::parse_prev_hash(st) == state_ops::state_hash(&prev),
            ObpError::ChainBroken
        );
        // Signatuur: zie de ed25519-precompile in deze tx (offsets naar
        // deze instruction-data; `link.sig` wordt hier dus niet gelezen).
        submission.states[base + i] = *st;
        prev = *st;
    }

    // Koppelt de laatste precompile-verificatie (signatuur op last_hash) aan
    // de daadwerkelijke laatste state: zonder deze check zou bij een
    // zelf-overdracht (deur-zelf getekend) last_hash verplaatst kunnen worden.
    require!(
        state_ops::state_hash(&prev) == last_hash,
        ObpError::LastHashMismatch
    );

    submission.states_len = (base + links.len()) as u16;
    submission.links_count += links.len() as u16;
    let last = last_state(submission);
    submission.final_owner = Pubkey::new_from_array(state_ops::parse_owner(last));
    msg!(
        "obp-core append_links: {} links, states_len={}",
        links.len(),
        submission.states_len
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// finalize_check_in (SPEC §5.6/§5.7 — de dispute-game, C2)
// ---------------------------------------------------------------------------
//
// M1 frame-limit notitie (gemeten): SBF staat per functie 4096 B frame
// toe. Het `#[program]`-macro inline AT `try_accounts` van ELKE
// instructie in één dispatch-functie → dispatch-frame = grootste
// try_accounts. Met 7×`Account<TokenAccount>` (165 B borsh elk) +
// 3×`Option`-accounts was FinalizeCheckIn 6.3 KB → "Access violation
// writing 48 bytes at 0x8" op ELKE instructie (zelfs ping). Oplossing:
//   * Option-accounts → `remaining_accounts` (handmatig geparst);
//   * token-accounts  → `UncheckedAccount` (mint/owner/amount rechtstreeks
//     uit het SPL account-data, geen borsh-struct op de stack);
//   * handlers → `#[inline(never)]` helpers (elk eigen frame).
//
// `remaining_accounts`-contract (gedocumenteerd; client-side):
//   finalize_check_in: [0] other_submission, [1] other_escrow,
//                      [2] other_checker_token, [3] recipient_allowance
//   settle:            [0] other_submission, [1] other_escrow,
//                      [2] recipient_allowance
//   (programma-ID als account-key = None/afwezig.)
// ---------------------------------------------------------------------------

/// SPL-token-account-velden (data-layout: mint[0..32] owner[32..64]
/// amount[64..72] u64 LE). Geen borsh-deserialisatie: de 165 B
/// `TokenAccount`-struct op de stack blies de SBF-frame.
struct Tok {
    mint: [u8; 32],
    owner: [u8; 32],
    #[allow(dead_code)]
    amount: u64,
}

#[inline(never)]
fn tok_of(info: &AccountInfo) -> Result<Tok> {
    let d = info.data.borrow();
    require!(d.len() >= 165, ObpError::StatusInvalid);
    let mut mint = [0u8; 32];
    mint.copy_from_slice(&d[0..32]);
    let mut owner = [0u8; 32];
    owner.copy_from_slice(&d[32..64]);
    let mut a = [0u8; 8];
    a.copy_from_slice(&d[64..72]);
    Ok(Tok {
        mint,
        owner,
        amount: u64::from_le_bytes(a),
    })
}

/// owner = token-program + mint komt overeen (+ optionele owner-check).
#[inline(never)]
fn check_tok(
    info: &AccountInfo,
    token_program: &Pubkey,
    mint: &Pubkey,
    owner: Option<&Pubkey>,
) -> Result<()> {
    require!(
        info.owner == token_program,
        ObpError::BondEscrowFailed
    );
    let t = tok_of(info)?;
    require!(
        Pubkey::new_from_array(t.mint) == *mint,
        ObpError::StatusInvalid
    );
    if let Some(o) = owner {
        require!(
            Pubkey::new_from_array(t.owner) == *o,
            ObpError::BondEscrowFailed
        );
    }
    Ok(())
}

/// PDA van een submission-account: [b"submission", serial, attempt].
#[inline(never)]
fn sub_pda(serial: &[u8; 32], attempt: u8) -> Result<Pubkey> {
    // find_program_address (niet create_program_address): Anchor-PDA's bevatten
    // het bump-byte als laatste seed. create_program_address zonder dat byte
    // zou een ander adres opleveren en de eigenaarschapschecks falen.
    let (pk, _bump) = Pubkey::find_program_address(
        &[
            b"submission".as_ref(),
            serial,
            &attempt.to_be_bytes()[..],
        ],
        &crate::ID,
    );
    Ok(pk)
}

#[inline(never)]
fn allowance_pda(recipient: &Pubkey) -> Result<Pubkey> {
    // Zie sub_pda: find_program_address zodat het bump-byte meerekend wordt.
    let (pk, _bump) = Pubkey::find_program_address(
        &[b"allowance".as_ref(), &recipient.to_bytes()[..]],
        &crate::ID,
    );
    Ok(pk)
}

/// Parsed uit `remaining_accounts` (PDA-seed-check + layout-check).
#[inline(never)]
fn parse_submission(info: &AccountInfo, serial: &[u8; 32], attempt: u8) -> Result<Submission> {
    require!(
        *info.key == sub_pda(serial, attempt)?,
        ObpError::SubmissionMismatch
    );
    require!(info.owner == &crate::ID, ObpError::StatusInvalid);
    require!(info.data_len() == Submission::LEN, ObpError::StatusInvalid);
    let mut data = &info.data.borrow()[..];
    let sub = <Submission as AccountDeserialize>::try_deserialize(&mut data)?;
    Ok(sub)
}

#[inline(never)]
fn parse_allowance(info: &AccountInfo, recipient: &Pubkey) -> Result<Allowance> {
    require!(
        *info.key == allowance_pda(recipient)?,
        ObpError::StatusInvalid
    );
    require!(info.owner == &crate::ID, ObpError::StatusInvalid);
    require!(info.data_len() == Allowance::LEN, ObpError::StatusInvalid);
    let mut data = &info.data.borrow()[..];
    let a = <Allowance as AccountDeserialize>::try_deserialize(&mut data)?;
    Ok(a)
}

#[inline(never)]
fn write_submission(info: &AccountInfo, sub: &Submission) -> Result<()> {
    // AccountSerialize = discriminator + fields (Anchor-account-layout).
    // Ruw borsh (AnchorSerialize) zou 8B korter schrijven zonder disc.
    <Submission as AccountSerialize>::try_serialize(sub, &mut *info.data.borrow_mut())?;
    Ok(())
}

#[inline(never)]
fn write_allowance(info: &AccountInfo, a: &Allowance) -> Result<()> {
    // Zie write_submission: AccountSerialize = disc + fields.
    <Allowance as AccountSerialize>::try_serialize(a, &mut *info.data.borrow_mut())?;
    Ok(())
}

#[derive(Accounts)]
#[instruction(serial: [u8; 32], other_attempt: u8, recipient: Pubkey)]
pub struct FinalizeCheckIn<'info> {
    #[account(mut, constraint = config.sig_scheme == 0 @ ObpError::StatusInvalid)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"mint", serial.as_ref()],
        bump = registry.bump
    )]
    pub registry: Account<'info, MintRegistry>,
    #[account(
        init_if_needed,
        payer = rent_payer,
        space = HeadRegistry::LEN,
        seeds = [b"head", serial.as_ref()],
        bump
    )]
    pub head: Account<'info, HeadRegistry>,
    /// PDA-check (eigen attempt-veld) gebeurt in de handler — zie
    /// frame-limit-notitie hierboven.
    #[account(
        mut,
        constraint = submission.status == submission_status::RECEIVING
            @ ObpError::StatusInvalid
    )]
    pub submission: Account<'info, Submission>,
    /// Checks in handler: owner == submission-PDA.
    #[account(mut)]
    pub escrow: UncheckedAccount<'info>,
    /// Checks in handler: owner == submission.checker.
    #[account(mut)]
    pub checker_token: UncheckedAccount<'info>,
    /// Checks in handler (win-tak): owner == submission.final_owner.
    #[account(mut)]
    pub winner_token: UncheckedAccount<'info>,
    /// Checks in handler: owner == vault_pda.
    #[account(mut)]
    pub coin_vault: UncheckedAccount<'info>,
    pub vault_pda: Account<'info, VaultPda>,
    /// Checks in handler: owner == fee_pda.
    #[account(mut)]
    pub fee_sink: UncheckedAccount<'info>,
    pub fee_pda: Account<'info, FeePda>,
    pub token_program: Program<'info, Token>,
    #[account(mut)]
    pub rent_payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn finalize_check_in<'info>(
    mut ctx: Context<'info, FinalizeCheckIn<'info>>,
    serial: [u8; 32],
    other_attempt: u8,
    recipient: Pubkey,
) -> Result<()> {
    let submission = &ctx.accounts.submission;
    let registry = &ctx.accounts.registry;
    require!(serial == submission.serial, ObpError::SubmissionMismatch);
    require!(
        recipient == registry.recipient,
        ObpError::SubmissionMismatch
    );
    require!(
        other_attempt == 1 - submission.attempt,
        ObpError::AttemptRange
    );
    require!(
        submission.key() == sub_pda(&serial, submission.attempt)?,
        ObpError::SubmissionMismatch
    );

    // Token-account-checks (verplaatst uit de struct: frame-limit).
    let token_program = ctx.accounts.token_program.key();
    let vault_mint = ctx.accounts.config.vault_mint;
    check_tok(
        &ctx.accounts.escrow.to_account_info(),
        &token_program,
        &vault_mint,
        Some(&submission.key()),
    )?;
    check_tok(
        &ctx.accounts.checker_token.to_account_info(),
        &token_program,
        &vault_mint,
        Some(&submission.checker),
    )?;
    check_tok(
        &ctx.accounts.winner_token.to_account_info(),
        &token_program,
        &vault_mint,
        None,
    )?;
    check_tok(
        &ctx.accounts.coin_vault.to_account_info(),
        &token_program,
        &vault_mint,
        Some(&ctx.accounts.vault_pda.key()),
    )?;
    check_tok(
        &ctx.accounts.fee_sink.to_account_info(),
        &token_program,
        &vault_mint,
        Some(&ctx.accounts.fee_pda.key()),
    )?;

    // Volledige chain-verificatie (I4).
    verify_full_chain(submission, registry)?;

    let slot = Clock::get()?.slot;

    // head is init_if_needed: het PDA-bump (her)zetten zodat settle de head met
    // `bump = head.bump` kan re-derivaten.
    let (_, head_bump) = Pubkey::find_program_address(
        &[b"head".as_ref(), serial.as_ref()],
        &crate::ID,
    );
    ctx.accounts.head.bump = head_bump;

    // R5: munt al spent → reject (bond → fee-sink).
    if registry.status == registry_status::SPENT {
        return fin_reject_spent(&mut ctx, &serial, slot);
    }
    if !ctx.accounts.head.set {
        // Casus A: ik word de (provisionele) head; window start.
        return fin_set_head(&mut ctx, slot);
    }
    fin_resolve(&mut ctx, &serial, other_attempt, slot)
}

#[inline(never)]
fn fin_reject_spent<'a>(
    ctx: &mut Context<'a, FinalizeCheckIn<'a>>,
    serial: &[u8; 32],
    slot: u64,
) -> Result<()> {
    let value = ctx.accounts.registry.value;
    let bond = bond_amount(value, ctx.accounts.config.bond_multiplier_bps)?;
    let token_id = ctx.accounts.token_program.key();
    let attempt_bytes = ctx.accounts.submission.attempt.to_be_bytes();
    pda_transfer(
        token_id,
        &ctx.accounts.escrow.to_account_info(),
        &ctx.accounts.fee_sink.to_account_info(),
        &ctx.accounts.submission.to_account_info(),
        &[&[
            b"submission".as_ref(),
            serial,
            &attempt_bytes[..],
            &[ctx.accounts.submission.bump],
        ]],
        bond,
    )?;
    ctx.accounts.submission.status = submission_status::REJECTED;
    ctx.accounts.submission.finalized_slot = slot;
    msg!("obp-core finalize: REJECTED (munt al spent), bond -> fee-sink");
    Ok(())
}

#[inline(never)]
fn fin_set_head<'a>(ctx: &mut Context<'a, FinalizeCheckIn<'a>>, slot: u64) -> Result<()> {
    let last = *last_state(&ctx.accounts.submission);
    let attempt = ctx.accounts.submission.attempt;
    let states_len = ctx.accounts.submission.states_len;
    let window = ctx.accounts.config.challenge_window_slots;
    ctx.accounts.head.set = true;
    ctx.accounts.head.head_state = last;
    ctx.accounts.head.head_attempt = attempt;
    ctx.accounts.head.head_states_len = states_len;
    ctx.accounts.head.pending_since_slot = slot;
    ctx.accounts.submission.status = submission_status::PENDING;
    ctx.accounts.submission.finalized_slot = slot;
    msg!(
        "obp-core finalize: attempt {} -> pending (window {} slots)",
        attempt,
        window
    );
    Ok(())
}

/// Casus B: head bestaat (de andere submission). Win-regel (SPEC §6/§7):
///  - strikte extensie van de head (head op index < my_len-1) → ik win;
///  - endpoint == head → first-come: head wint (R2, self-loops);
///  - fork (head niet in mijn chain) → langste wint; tie → head.
#[inline(never)]
fn fin_resolve<'a>(
    ctx: &mut Context<'a, FinalizeCheckIn<'a>>,
    serial: &[u8; 32],
    other_attempt: u8,
    slot: u64,
) -> Result<()> {
    // Tegenpartij (remaining[0]) — verplicht: de head bestaat alleen als
    // de andere attempt eerder gefinaliseerd is.
    let other_submission_info =
        ctx.remaining_accounts
            .get(0)
            .ok_or(ObpError::StatusInvalid)?;
    require!(
        *other_submission_info.key != crate::ID,
        ObpError::StatusInvalid
    );
    let mut other = parse_submission(other_submission_info, serial, other_attempt)?;
    let head = &ctx.accounts.head;
    let submission = &ctx.accounts.submission;
    require!(
        other.attempt == head.head_attempt,
        ObpError::StatusInvalid
    );
    require!(
        other.status == submission_status::PENDING,
        ObpError::StatusInvalid
    );
    let my_len = submission.states_len as usize;
    let head_len = head.head_states_len as usize;

    // Relatie bepalen: zit de head-state in mijn chain, en waar?
    let mut head_idx: Option<usize> = None;
    for i in 0..my_len {
        if submission.states[i] == head.head_state {
            head_idx = Some(i);
            break;
        }
    }
    let i_win = match head_idx {
        Some(d) => d + 1 < my_len,
        None => my_len > head_len,
    };

    if i_win {
        fin_resolve_win(ctx, serial, other_attempt, &mut other, slot, my_len, head_len)
    } else {
        fin_resolve_lose(ctx, serial, other_attempt, slot, my_len, head_len)
    }
}

#[inline(never)]
fn fin_resolve_win<'a>(
    ctx: &mut Context<'a, FinalizeCheckIn<'a>>,
    serial: &[u8; 32],
    other_attempt: u8,
    other: &mut Submission,
    slot: u64,
    my_len: usize,
    head_len: usize,
) -> Result<()> {
    let value = ctx.accounts.registry.value;
    let bond = bond_amount(value, ctx.accounts.config.bond_multiplier_bps)?;
    let token_id = ctx.accounts.token_program.key();
    let my_attempt_bytes = ctx.accounts.submission.attempt.to_be_bytes();
    let other_attempt_bytes = other_attempt.to_be_bytes();

    // 1) mijn bond → mijn checker (refund).
    pda_transfer(
        token_id,
        &ctx.accounts.escrow.to_account_info(),
        &ctx.accounts.checker_token.to_account_info(),
        &ctx.accounts.submission.to_account_info(),
        &[&[
            b"submission".as_ref(),
            serial,
            &my_attempt_bytes[..],
            &[ctx.accounts.submission.bump],
        ]],
        bond,
    )?;
    // 2) de other se bond → mijn checker (compensatie, C1).
    let other_escrow = ctx.remaining_accounts
        .get(1)
        .ok_or(ObpError::StatusInvalid)?;
    require!(
        *other_escrow.key != crate::ID,
        ObpError::StatusInvalid
    );
    require!(
        other_escrow.owner == &token_id,
        ObpError::BondEscrowFailed
    );
    let other_tok = tok_of(other_escrow)?;
    require!(
        Pubkey::new_from_array(other_tok.owner) == sub_pda(serial, other_attempt)?,
        ObpError::BondEscrowFailed
    );
    let other_submission_info = ctx.remaining_accounts
        .get(0)
        .ok_or(ObpError::StatusInvalid)?;
    pda_transfer(
        token_id,
        other_escrow,
        &ctx.accounts.checker_token.to_account_info(),
        other_submission_info,
        &[&[
            b"submission".as_ref(),
            serial,
            &other_attempt_bytes[..],
            &[other.bump],
        ]],
        bond,
    )?;
    // 3) muntwaarde: coin_vault → winner_token (final_owner).
    let winner = tok_of(&ctx.accounts.winner_token.to_account_info())?;
    require!(
        Pubkey::new_from_array(winner.owner) == ctx.accounts.submission.final_owner,
        ObpError::StatusInvalid
    );
    pda_transfer(
        token_id,
        &ctx.accounts.coin_vault.to_account_info(),
        &ctx.accounts.winner_token.to_account_info(),
        &ctx.accounts.vault_pda.to_account_info(),
        &[&[b"vault".as_ref(), &[ctx.accounts.vault_pda.bump]]],
        value,
    )?;
    // 4) boekhouding (I2/I5) + status.
    let last = *last_state(&ctx.accounts.submission);
    let attempt = ctx.accounts.submission.attempt;
    let states_len = ctx.accounts.submission.states_len;
    ctx.accounts.head.head_state = last;
    ctx.accounts.head.head_attempt = attempt;
    ctx.accounts.head.head_states_len = states_len;
    ctx.accounts.head.pending_since_slot = slot;
    ctx.accounts.registry.status = registry_status::SPENT;
    ctx.accounts.config.total_unspent_supply = ctx
        .accounts
        .config
        .total_unspent_supply
        .checked_sub(value)
        .ok_or(ObpError::VaultUnderflow)?;
    // I5: allowance-afboeking (verplicht bij win: de coin had toelating).
    let allowance_info = ctx.remaining_accounts
        .get(3)
        .ok_or(ObpError::StatusInvalid)?;
    require!(
        *allowance_info.key != crate::ID,
        ObpError::StatusInvalid
    );
    let mut allowance = parse_allowance(allowance_info, &ctx.accounts.registry.recipient)?;
    allowance.committed = allowance
        .committed
        .checked_sub(value)
        .ok_or(ObpError::AllowanceExceeded)?;
    write_allowance(allowance_info, &allowance)?;
    ctx.accounts.submission.status = submission_status::WON;
    ctx.accounts.submission.finalized_slot = slot;
    other.status = submission_status::LOST;
    write_submission(other_submission_info, other)?;
    msg!(
        "obp-core finalize: attempt {} WINT (len {} > head {}), value={} uitbetaald",
        attempt,
        my_len,
        head_len,
        value
    );
    Ok(())
}

#[inline(never)]
fn fin_resolve_lose<'a>(
    ctx: &mut Context<'a, FinalizeCheckIn<'a>>,
    serial: &[u8; 32],
    other_attempt: u8,
    slot: u64,
    my_len: usize,
    head_len: usize,
) -> Result<()> {
    // Ik verlies (stale / tie / kortere fork): mijn bond → de
    // head-owner se checker (C1). De head staat; die wint via `settle`.
    let other_info = ctx.remaining_accounts
        .get(0)
        .ok_or(ObpError::StatusInvalid)?;
    let other = parse_submission(other_info, serial, other_attempt)?;
    let other_checker_token = ctx.remaining_accounts
        .get(2)
        .ok_or(ObpError::StatusInvalid)?;
    require!(
        *other_checker_token.key != crate::ID,
        ObpError::StatusInvalid
    );
    let tok = tok_of(other_checker_token)?;
    require!(
        Pubkey::new_from_array(tok.owner) == other.checker,
        ObpError::BondEscrowFailed
    );
    let value = ctx.accounts.registry.value;
    let bond = bond_amount(value, ctx.accounts.config.bond_multiplier_bps)?;
    let token_id = ctx.accounts.token_program.key();
    let my_attempt_bytes = ctx.accounts.submission.attempt.to_be_bytes();
    pda_transfer(
        token_id,
        &ctx.accounts.escrow.to_account_info(),
        other_checker_token,
        &ctx.accounts.submission.to_account_info(),
        &[&[
            b"submission".as_ref(),
            serial,
            &my_attempt_bytes[..],
            &[ctx.accounts.submission.bump],
        ]],
        bond,
    )?;
    ctx.accounts.submission.status = submission_status::LOST;
    ctx.accounts.submission.finalized_slot = slot;
    msg!(
        "obp-core finalize: attempt {} verliest (len {} vs head {}), bond -> head-checker",
        ctx.accounts.submission.attempt,
        my_len,
        head_len
    );
    Ok(())
}

// ---------------------------------------------------------------------------
// settle (SPEC §5.8) — na de window: uitbetaling van de ongedisputeerde head
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(serial: [u8; 32], other_attempt: u8, recipient: Pubkey)]
pub struct Settle<'info> {
    #[account(mut, constraint = config.sig_scheme == 0 @ ObpError::StatusInvalid)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [b"mint", serial.as_ref()],
        bump = registry.bump,
        constraint = registry.status == registry_status::ACTIVE
            @ ObpError::StatusInvalid
    )]
    pub registry: Account<'info, MintRegistry>,
    #[account(seeds = [b"head", serial.as_ref()], bump = head.bump)]
    pub head: Account<'info, HeadRegistry>,
    #[account(
        mut,
        constraint = submission.status == submission_status::PENDING
            @ ObpError::StatusInvalid
    )]
    pub submission: Account<'info, Submission>,
    /// Checks in handler: owner == submission-PDA.
    #[account(mut)]
    pub escrow: UncheckedAccount<'info>,
    /// Checks in handler: owner == submission.checker.
    #[account(mut)]
    pub checker_token: UncheckedAccount<'info>,
    /// Checks in handler: owner == submission.final_owner.
    #[account(mut)]
    pub winner_token: UncheckedAccount<'info>,
    /// Checks in handler: owner == vault_pda.
    #[account(mut)]
    pub coin_vault: UncheckedAccount<'info>,
    pub vault_pda: Account<'info, VaultPda>,
    /// Checks in handler: owner == fee_pda.
    #[account(mut)]
    pub fee_sink: UncheckedAccount<'info>,
    pub fee_pda: Account<'info, FeePda>,
    pub token_program: Program<'info, Token>,
    pub rent_payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn settle<'info>(
    mut ctx: Context<'info, Settle<'info>>,
    serial: [u8; 32],
    other_attempt: u8,
    recipient: Pubkey,
) -> Result<()> {
    let submission = &ctx.accounts.submission;
    let registry = &ctx.accounts.registry;
    let head = &ctx.accounts.head;
    require!(serial == submission.serial, ObpError::SubmissionMismatch);
    require!(
        recipient == registry.recipient,
        ObpError::SubmissionMismatch
    );
    require!(
        other_attempt == 1 - submission.attempt,
        ObpError::AttemptRange
    );
    require!(head.set, ObpError::StatusInvalid);
    require!(
        submission.attempt == head.head_attempt,
        ObpError::StatusInvalid
    );
    require!(
        submission.key() == sub_pda(&serial, submission.attempt)?,
        ObpError::SubmissionMismatch
    );

    // Window verlopen (T7: slots, geen wall-clock).
    let slot = Clock::get()?.slot;
    require!(
        slot >= head
            .pending_since_slot
            .saturating_add(ctx.accounts.config.challenge_window_slots),
        ObpError::WindowExpired
    );

    // Token-account-checks (verplaatst uit de struct: frame-limit).
    let token_program = ctx.accounts.token_program.key();
    let vault_mint = ctx.accounts.config.vault_mint;
    check_tok(
        &ctx.accounts.escrow.to_account_info(),
        &token_program,
        &vault_mint,
        Some(&submission.key()),
    )?;
    check_tok(
        &ctx.accounts.checker_token.to_account_info(),
        &token_program,
        &vault_mint,
        Some(&submission.checker),
    )?;
    check_tok(
        &ctx.accounts.winner_token.to_account_info(),
        &token_program,
        &vault_mint,
        Some(&submission.final_owner),
    )?;
    check_tok(
        &ctx.accounts.coin_vault.to_account_info(),
        &token_program,
        &vault_mint,
        Some(&ctx.accounts.vault_pda.key()),
    )?;
    check_tok(
        &ctx.accounts.fee_sink.to_account_info(),
        &token_program,
        &vault_mint,
        Some(&ctx.accounts.fee_pda.key()),
    )?;

    settle_pay_out(&mut ctx, &serial, other_attempt)
}

#[inline(never)]
fn settle_pay_out<'a>(
    ctx: &mut Context<'a, Settle<'a>>,
    serial: &[u8; 32],
    other_attempt: u8,
) -> Result<()> {
    let value = ctx.accounts.registry.value;
    let bond = bond_amount(value, ctx.accounts.config.bond_multiplier_bps)?;
    let token_id = ctx.accounts.token_program.key();
    let my_attempt_bytes = ctx.accounts.submission.attempt.to_be_bytes();
    let other_attempt_bytes = other_attempt.to_be_bytes();

    // Tegenpartij: RECEIVING → abandon (bond → fee-sink); anders moet de
    // status al terminal zijn (LOST/REJECTED). WON kan hier niet: dan zou
    // de registry al SPENT zijn (settle is op ACTIVE gated).
    let other_submission_info = ctx.remaining_accounts
        .get(0)
        .ok_or(ObpError::StatusInvalid)?;
    if *other_submission_info.key != crate::ID {
        let mut other = parse_submission(other_submission_info, serial, other_attempt)?;
        if other.status == submission_status::RECEIVING {
            let other_escrow = ctx.remaining_accounts
                .get(1)
                .ok_or(ObpError::StatusInvalid)?;
            require!(
                *other_escrow.key != crate::ID,
                ObpError::StatusInvalid
            );
            let tok = tok_of(other_escrow)?;
            require!(
                Pubkey::new_from_array(tok.owner) == sub_pda(serial, other_attempt)?,
                ObpError::BondEscrowFailed
            );
            pda_transfer(
                token_id,
                other_escrow,
                &ctx.accounts.fee_sink.to_account_info(),
                other_submission_info,
                &[&[
                    b"submission".as_ref(),
                    serial,
                    &other_attempt_bytes[..],
                    &[other.bump],
                ]],
                bond,
            )?;
            other.status = submission_status::REJECTED;
            write_submission(other_submission_info, &other)?;
        } else {
            require!(
                other.status == submission_status::LOST
                    || other.status == submission_status::REJECTED,
                ObpError::StatusInvalid
            );
        }
    }

    // Uitbetaling: muntwaarde → final_owner; mijn bond → refund.
    pda_transfer(
        token_id,
        &ctx.accounts.coin_vault.to_account_info(),
        &ctx.accounts.winner_token.to_account_info(),
        &ctx.accounts.vault_pda.to_account_info(),
        &[&[b"vault".as_ref(), &[ctx.accounts.vault_pda.bump]]],
        value,
    )?;
    pda_transfer(
        token_id,
        &ctx.accounts.escrow.to_account_info(),
        &ctx.accounts.checker_token.to_account_info(),
        &ctx.accounts.submission.to_account_info(),
        &[&[
            b"submission".as_ref(),
            serial,
            &my_attempt_bytes[..],
            &[ctx.accounts.submission.bump],
        ]],
        bond,
    )?;

    ctx.accounts.registry.status = registry_status::SPENT;
    ctx.accounts.config.total_unspent_supply = ctx
        .accounts
        .config
        .total_unspent_supply
        .checked_sub(value)
        .ok_or(ObpError::VaultUnderflow)?;
    // I5: allowance-afboeking (optioneel: None als de client die niet
    // meegeeft).
    let allowance_info = ctx.remaining_accounts
        .get(2)
        .ok_or(ObpError::StatusInvalid)?;
    if *allowance_info.key != crate::ID {
        let mut allowance =
            parse_allowance(allowance_info, &ctx.accounts.registry.recipient)?;
        allowance.committed = allowance
            .committed
            .checked_sub(value)
            .ok_or(ObpError::AllowanceExceeded)?;
        write_allowance(allowance_info, &allowance)?;
    }
    ctx.accounts.submission.status = submission_status::WON;
    msg!(
        "obp-core settle: value={} uitbetaald, bond={} terug",
        value,
        bond
    );
    Ok(())
}
