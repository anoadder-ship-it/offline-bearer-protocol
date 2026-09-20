pub mod allowance;
pub mod checkin;
pub mod init;
pub mod mint;
pub mod admin;
pub mod pq;
pub mod vault;

// Re-export de inhoud (incl. de `#[derive(Accounts)]`-hidden structs
// `__client_accounts_*`) naar het `instructions`-niveau, zodat de
// `use instructions::*;` in lib.rs ze op crate-niveau haalt — vereist door de
// `#[program]`-macro (zie het commentaar daar; anchor-syn accounts.rs:28).
pub use admin::*;
pub use allowance::*;
pub use checkin::*;
pub use init::*;
pub use mint::*;
pub use pq::*;
pub use vault::*;
