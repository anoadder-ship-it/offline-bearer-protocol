use anchor_lang::prelude::*;

mod errors;
mod instructions;
mod state;

// NODIG ZONDER DEZE REGEL: de `#[program]`-macro genereert
// `pub use crate::__client_accounts_*::*;` op crate-niveau (zie
// anchor-syn-1.1.2/src/codegen/program/accounts.rs:28). Die hidden structs
// ontstaan in het `instructions`-module via `#[derive(Accounts)]`; zonder
// deze glob-import staan ze niet op crate-niveau → "unresolved import crate".
// Zelfde patroon als active-defense (gemeten in de bron, STATUS.md sectie 5).
use instructions::*;

declare_id!("9D2fU2g13Y55uvk6kLiHRknxd6rzu84nsHy6gnjTLqzt");

#[program]
pub mod obp_core {
    use super::*;

    /// M4-benchmark: in-program PQ-verificatie (CU-meting). scheme 1=ML-DSA-44, 2=SLH-DSA-128f.
    pub fn pq_benchmark<'info>(ctx: Context<PqBenchmark>, scheme: u8) -> Result<()> {
        instructions::pq::pq_benchmark(ctx, scheme)
    }

    /// M4-benchmark-setup: vul een data-account met PQ-bytes in chunks (≤1024 B/ix).
    pub fn pq_write_data<'info>(ctx: Context<PqWriteData>, offset: u32, chunk: Vec<u8>) -> Result<()> {
        instructions::pq::pq_write_data(ctx, offset, chunk)
    }

    /// Init: Config + VaultPda + FeePda (SPEC §5.1).
    pub fn init<'info>(ctx: Context<Init<'info>>, args: InitArgs) -> Result<()> {
        instructions::init(ctx, args)
    }

    /// Liveness probe (M0/M1; geen state change).
    pub fn ping<'info>(ctx: Context<Ping<'info>>) -> Result<()> {
        instructions::ping(ctx)
    }

    /// Reserve naar de vault (SPEC §5.2).
    pub fn fund_vault<'info>(ctx: Context<FundVault<'info>>, amount: u64) -> Result<()> {
        instructions::fund_vault(ctx, amount)
    }

    /// Reserve uit de vault, begrensd door I2 (SPEC §5.2).
    pub fn withdraw_vault<'info>(ctx: Context<WithdrawVault<'info>>, amount: u64) -> Result<()> {
        instructions::withdraw_vault(ctx, amount)
    }

    /// Munt een coin (SPEC §5.3). `genesis_state_hash` moet kloppen met
    /// H(serial ‖ value ‖ recipient ‖ 0^32); `mint_tx` = sha256(serial ‖ value
    /// ‖ recipient ‖ recent_blockhash)[:64] (client-computeerbaar vóór
    /// ondertekening; zelf-referentiële tx-signature is dat niet).
    pub fn mint_coin<'info>(
        ctx: Context<MintCoin<'info>>,
        serial: [u8; 32],
        value: u64,
        recipient: Pubkey,
        genesis_state_hash: [u8; 32],
        mint_tx: [u8; 64],
    ) -> Result<()> {
        instructions::mint_coin(ctx, serial, value, recipient, genesis_state_hash, mint_tx)
    }

    /// Start een check-in (SPEC §5.4): submission + verplichte bond-escrow.
    pub fn start_check_in<'info>(
        ctx: Context<StartCheckIn<'info>>,
        serial: [u8; 32],
        attempt: u8,
        state_0: [u8; 104],
    ) -> Result<()> {
        instructions::start_check_in(ctx, serial, attempt, state_0)
    }

    /// Voeg links toe aan een submission (SPEC §5.5).
    /// `head_owner` = eigenaar van de on-chain head-state (anker, wordt
    /// vergeleken); `last_hash` = H(laatste state) (koppelt de laatste
    /// precompile-signatuur aan de state). Signatuurverificatie zelf doet de
    /// ed25519-precompile in de tx.
    pub fn append_links<'info>(
        ctx: Context<AppendLinks<'info>>,
        serial: [u8; 32],
        head_owner: [u8; 32],
        links: Vec<Link>,
        last_hash: [u8; 32],
    ) -> Result<()> {
        instructions::append_links(ctx, serial, head_owner, links, last_hash)
    }

    /// Finaliseer een submission (SPEC §5.6/§5.7): de dispute-game.
    pub fn finalize_check_in<'info>(
        ctx: Context<'info, FinalizeCheckIn<'info>>,
        serial: [u8; 32],
        other_attempt: u8,
        recipient: Pubkey,
    ) -> Result<()> {
        instructions::finalize_check_in(ctx, serial, other_attempt, recipient)
    }

    /// Betaal de ongedisputeerde head uit na de window (SPEC §5.8).
    pub fn settle<'info>(
        ctx: Context<'info, Settle<'info>>,
        serial: [u8; 32],
        other_attempt: u8,
        recipient: Pubkey,
    ) -> Result<()> {
        instructions::settle(ctx, serial, other_attempt, recipient)
    }

    /// Verhoog de eigen offline-toelating (SPEC §5.9, B6).
    pub fn set_allowance<'info>(ctx: Context<SetAllowance<'info>>, new_cap: u64) -> Result<()> {
        instructions::set_allowance(ctx, new_cap)
    }
}
