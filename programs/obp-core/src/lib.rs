use anchor_lang::prelude::*;

mod errors;
mod instructions;
mod state;

// NODIG ZONDER DEZE REGEL: de `#[program]`-macro genereert
// `pub use crate::__client_accounts_*::*;` op crate-niveau (zie
// anchor-syn-1.1.2/src/codegen/program/accounts.rs:28). Die hidden structs
// ontstaan in het `instructions`-module via `#[derive(Accounts)]`; zonder
// deze glob-import staan ze niet op crate-niveau → "unresolved import crate".
// Zelfde patroon als active-defense/src/lib.rs (gemeten in de bron).
use instructions::*;

declare_id!("5oUPUTuSdU3bWLtVTdcisu1BtgwNt29jH4fVTnfH2XiM");

#[program]
pub mod obp_core {
    use super::*;

    /// Initialize the OBP Core config (SPEC.md §5.1).
    ///
    /// `mint_authority` claims the role by signing; it is deliberately a
    /// different key from the program's upgrade authority (SPEC §2, A2/A3).
    pub fn init(ctx: Context<Init>, args: InitArgs) -> Result<()> {
        instructions::init(ctx, args)
    }

    /// Trivial liveness probe (M0 build proof; no state change).
    pub fn ping(ctx: Context<Ping>) -> Result<()> {
        instructions::ping(ctx)
    }
}
