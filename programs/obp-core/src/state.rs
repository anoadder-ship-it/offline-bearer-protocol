use anchor_lang::prelude::*;

/// Layout van één state in een lokale munt-chain (SPEC.md §3.2):
/// `serial(32) ‖ value(8,u64 LE) ‖ owner(32) ‖ prev_state_hash(32)` = 104 bytes.
pub const STATE_SIZE: usize = 104;
/// Maximaal aantal states (incl. state_0) dat in één submission-account past.
/// Deterministische account-grootte (geen dynamic resize).
/// M1-keuze (gemeten): 4 — de SBF-frame-limit (4096 B/function) maakt een
/// ~1.7KB Submission (16 states) onhaalbaar in try_accounts/handlers
/// (frame-overflow warnings). 4 states = state_0 + 3 links, genoeg voor
/// M1-testketens; verhoogbaar na frame-heroptimalisatie (M3).
pub const MAX_SUBMISSION_STATES: usize = 4;

/// Registry-status van een coin (MintRegistry).
/// M1-verfijning (SPEC v0.1.1): de coin heeft alleen ACTIVE/SPENT.
/// De "pending/disputed"-toestand leeft per submission + in HeadRegistry,
/// zodat een rejected submission de coin niet "vergrendelt" (iemand anders mag
/// diezelfde coin daarna alsnog geldig checken-in).
pub mod registry_status {
    pub const ACTIVE: u8 = 0;
    pub const SPENT: u8 = 1;
}

/// Status van een submission (één check-in-poging).
/// M1 gebruikt de subset RECEIVING → PENDING → WON/LOST/REJECTED;
/// SUBMITTED/DISPUTED blijven gedefinieerd voor de layout-stabiliteit
/// (en de latere fasen).
#[allow(dead_code)]
pub mod submission_status {
    pub const RECEIVING: u8 = 0;  // accepteert nog links
    pub const SUBMITTED: u8 = 1;  // alle links binnen, klaar om te finalizen
    pub const PENDING: u8 = 2;    // head gezet, challenge window loopt
    pub const DISPUTED: u8 = 3;   // er is een fork; wacht op resolutie
    pub const REJECTED: u8 = 4;   // ongeldige chain (bond → FeeSink)
    pub const WON: u8 = 5;
    pub const LOST: u8 = 6;
}

/// Globale OBP Core-config (SPEC.md §4).
///
/// M1-verfijning (v0.1.1): `sig_scheme` toegevoegd (B8) zodat de account-layout
/// voor M4 (PQ) stabiel blijft. M1: altijd 0 (Ed25519).
///
/// LEN = 8 (disc) + 32 + 32 + 4 + 8 + 2 + 8 + 8 + 1 + 1 = 104
#[account]
pub struct Config {
    /// Kan coins munten en de vault funden/withdrawen (SPEC §2, A3).
    pub mint_authority: Pubkey,
    /// SPL-Token-mint die alle coins + bonds backt (de vault-mint).
    pub vault_mint: Pubkey,
    /// Bond = value * bond_multiplier_bps / 10000; ≥ 10000 (100%), B3.
    pub bond_multiplier_bps: u32,
    /// Challenge window in SLOTS (nooit wall-clock; T7).
    pub challenge_window_slots: u64,
    /// Max links per `append_links`-tx (B10; gemeten bij M1).
    pub max_links_per_tx: u16,
    /// Standaard offline-toelating per wallet (B6: mint-gate).
    pub default_allowance: u64,
    /// Invariant I2: Σ value van unspent coins; vault_balance ≥ dit, altijd.
    pub total_unspent_supply: u64,
    /// 0 = Ed25519 (M1), 1 = MLDSA44, 2 = SLHDSA128f (M4). B8.
    pub sig_scheme: u8,
    pub bump: u8,
}

impl Config {
    pub const LEN: usize = 8 + 32 + 32 + 4 + 8 + 2 + 8 + 8 + 1 + 1;
}

/// Marker; de echte vault is een SPL-Token-account waarvan `owner` deze PDA is.
#[account]
pub struct VaultPda {
    pub bump: u8,
}
impl VaultPda {
    pub const LEN: usize = 8 + 1;
}

/// Marker; ontvangt verbreekte bonds (DoS-fee's, SPEC §5.10).
#[account]
pub struct FeePda {
    pub bump: u8,
}
impl FeePda {
    pub const LEN: usize = 8 + 1;
}

/// Per-coin registry (SPEC.md §4).
/// M1-verfijning: `submissions_count` (R-E: max 2 submissions, trustless on-chain).
/// LEN = 8 + 32 + 8 + 32 + 8 + 64 + 32 + 1 + 1 + 1 = 187
#[account]
pub struct MintRegistry {
    pub serial: [u8; 32],
    pub value: u64,
    /// H(state_0) — de on-chain anker van de lokale chain.
    pub genesis_state_hash: [u8; 32],
    pub mint_slot: u64,
    pub mint_tx: [u8; 64],
    /// Toelating-attributie (I5): de wallet aan wie de coin gemint is.
    pub recipient: Pubkey,
    /// ACTIVE | SPENT (zie registry_status).
    pub status: u8,
    /// Aantal gestarte submissions voor deze serial (R-E: max 2).
    pub submissions_count: u8,
    pub bump: u8,
}

impl MintRegistry {
    pub const LEN: usize = 8 + 32 + 8 + 32 + 8 + 64 + 32 + 1 + 1 + 1;
}

/// Houdt de laatst geaccepteerde head-state + wanneer die werd gezet (window).
/// M1-verfijning: `head_states_len` (voor de "langste keten wint"-vergelijking).
/// LEN = 8 + 1 + 104 + 1 + 2 + 8 + 1 = 125
#[account]
pub struct HeadRegistry {
    /// false = nog nooit een head geaccepteerd.
    pub set: bool,
    /// Laatste geaccepteerde state.
    pub head_state: [u8; 104],
    /// Welke attempt (0/1) de huidige head bezit (voor bond-tracing).
    pub head_attempt: u8,
    /// Lengte (aantal states) van de head-chain (voor longest-wins).
    pub head_states_len: u16,
    /// Slot waarop de huidige head werd gezet (start van de challenge window).
    pub pending_since_slot: u64,
    pub bump: u8,
}

impl HeadRegistry {
    pub const LEN: usize = 8 + 1 + 104 + 1 + 2 + 8 + 1;
}

/// Eén check-in-poging, met de VOLLEDIGE chain on-chain opgeslagen zodat de
/// dispute-logica (prefix/fork/langste-wint) trustless en on-chain kan lopen.
///
/// Vaste deel = 8 + 32 + 1 + 32 + 32 + 2 + 8 + 8 + 1 + 2 + 1 + (104*4) = 527
#[account]
pub struct Submission {
    pub serial: [u8; 32],
    pub attempt: u8,
    /// Bearer die indient (betaalt de bond).
    pub checker: Pubkey,
    /// O_n — eigenaar van de laatste state (gevuld bij finalize).
    pub final_owner: Pubkey,
    /// Aantal toegevoegde links (states_len - 1).
    pub links_count: u16,
    pub started_slot: u64,
    pub finalized_slot: u64,
    /// zie submission_status.
    pub status: u8,
    /// Aantal states opgeslagen in `states` (incl. state_0).
    pub states_len: u16,
    /// De volledige chain: states[0]=state_0, states[1..]=link-states.
    pub states: [[u8; 104]; MAX_SUBMISSION_STATES],
    /// Track 1 (R2, 2026-09-19): per-link signature-commitments —
    /// `sig_commits[i] = H(sig_i)[0..32]` voor de signatuur op states[i]
    /// (i ≥ 1; index 0 = genesis, onbruikbaar → nul). Scheme 0: H(64B sig);
    /// scheme 1 (PQ): H(2420B sig), de commitment is de eerste 32 B van de
    /// link-sig (volledige sig via data-account, §13.3 R2). Binde de on-chain
    /// states aan de offline-signaturen → deterministische dispute-check.
    pub sig_commits: [[u8; 32]; MAX_SUBMISSION_STATES],
    pub bump: u8,
}

impl Submission {
    pub const LEN: usize = 8 + 32 + 1 + 32 + 32 + 2 + 8 + 8 + 1 + 2 + 1
        + (STATE_SIZE * MAX_SUBMISSION_STATES)
        + (32 * MAX_SUBMISSION_STATES);
}

/// Per-wallet offline-toelating (B6: mint-gate, I5).
/// LEN = 8 + 8 + 8 + 1 + 1 = 27
#[account]
pub struct Allowance {
    pub cap: u64,
    /// Σ value van openstaande coins gemint naar deze wallet.
    pub committed: u64,
    pub initialized: bool,
    pub bump: u8,
}

impl Allowance {
    pub const LEN: usize = 8 + 8 + 8 + 1 + 1;
}

/// Hash + parse-helpers voor states (SPEC §3.2). Pure functies, dus host-testbaar.
pub mod state_ops {
    use super::STATE_SIZE;

    /// H(state) = sha256 over de 104 bytes.
    /// `#[inline(never)]`: sha256-inlining in handler-frames blaast de
    /// SBF-frame-limit (4096 B/function, gemeten M1).
    #[inline(never)]
    pub fn state_hash(state: &[u8; STATE_SIZE]) -> [u8; 32] {
        use solana_sha256_hasher::hashv;
        let h = hashv(&[state.as_slice()]);
        let mut out = [0u8; 32];
        out.copy_from_slice(&h.to_bytes());
        out
    }

    /// Bouwt state_0 (genesis): prev_state_hash = 0^32, owner = eerste houder.
    pub fn genesis_state(serial: &[u8; 32], value: u64, owner: &[u8; 32]) -> [u8; STATE_SIZE] {
        let mut s = [0u8; STATE_SIZE];
        s[0..32].copy_from_slice(serial);
        s[32..40].copy_from_slice(&value.to_le_bytes());
        s[40..72].copy_from_slice(owner);
        // s[72..104] = prev_state_hash = 0^32 (genesis)
        s
    }

    pub fn parse_owner(state: &[u8; STATE_SIZE]) -> [u8; 32] {
        let mut o = [0u8; 32];
        o.copy_from_slice(&state[40..72]);
        o
    }

    pub fn parse_value(state: &[u8; STATE_SIZE]) -> u64 {
        let mut b = [0u8; 8];
        b.copy_from_slice(&state[32..40]);
        u64::from_le_bytes(b)
    }

    pub fn parse_serial(state: &[u8; STATE_SIZE]) -> [u8; 32] {
        let mut s = [0u8; 32];
        s.copy_from_slice(&state[0..32]);
        s
    }

    pub fn parse_prev_hash(state: &[u8; STATE_SIZE]) -> [u8; 32] {
        let mut p = [0u8; 32];
        p.copy_from_slice(&state[72..104]);
        p
    }

    /// Bouwt een link-state: prev = H(prev_state), owner = nieuwe houder.
    /// M1: gebruikt door de client-side keten-bouwers + unit-tests (niet door
    /// de S zelf) → hence allow(dead_code) voor de SBF-build.
    #[allow(dead_code)]
    pub fn next_state(prev: &[u8; STATE_SIZE], new_owner: &[u8; 32]) -> [u8; STATE_SIZE] {
        let mut s = *prev;
        s[40..72].copy_from_slice(new_owner);
        let h = state_hash(prev);
        s[72..104].copy_from_slice(&h);
        s
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn genesis_prev_hash_is_zero() {
            let serial = [7u8; 32];
            let owner = [9u8; 32];
            let s = genesis_state(&serial, 123, &owner);
            assert_eq!(parse_prev_hash(&s), [0u8; 32]);
            assert_eq!(parse_serial(&s), serial);
            assert_eq!(parse_value(&s), 123);
            assert_eq!(parse_owner(&s), owner);
        }

        #[test]
        fn next_state_links_hash_and_owner() {
            let serial = [1u8; 32];
            let o0 = [2u8; 32];
            let o1 = [3u8; 32];
            let s0 = genesis_state(&serial, 500, &o0);
            let s1 = next_state(&s0, &o1);
            assert_eq!(parse_prev_hash(&s1), state_hash(&s0));
            assert_eq!(parse_owner(&s1), o1);
            assert_eq!(parse_serial(&s1), serial);
            assert_eq!(parse_value(&s1), 500);
            // state_0 zelf blijft ongewijzigd
            assert_eq!(parse_prev_hash(&s0), [0u8; 32]);
        }

        #[test]
        fn hash_differs_per_state() {
            let serial = [4u8; 32];
            let a = genesis_state(&serial, 1, &[5u8; 32]);
            let b = genesis_state(&serial, 2, &[5u8; 32]);
            assert_ne!(state_hash(&a), state_hash(&b));
        }
        /// Regressietest voor de M1-settle-bug: Anchor-account-data is
        /// discriminator(8) + fields, maar ruw borsh (AnchorSerialize/
        /// AnchorDeserialize) kent alleen fields. Parse met ruw borsh op
        /// account-data legt alle fields 8 bytes verschoven uit; bij
        ///  (enige struct met een bool) leest  de
        /// eerste byte van  (100 = 0x64) → "Invalid bool
        /// representation: 100" (de exacte devnet-fout bij E8 settle).
        /// Payload = exacte on-chain allowance-data (37n4rYVK…, gemeten).
        #[test]
        fn allowance_borsh_layout_regression() {
            use anchor_lang::{AccountDeserialize, AccountSerialize, AnchorDeserialize, Discriminator};
            use crate::state::Allowance;
            let payload: Vec<u8> = vec![
                0x90, 0x08, 0xb8, 0xd5, 0x31, 0xf8, 0x49, 0x83, // disc
                0xe8, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // cap = 1000
                0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // committed = 100
                0x01,                                            // initialized
                0xfe,                                            // bump
            ];
            assert_eq!(payload.len(), Allowance::LEN);
            // Ruw borsh (fields-only) op disc+fields-data: FAALT (bool @0x64).
            let r1: std::io::Result<Allowance> = AnchorDeserialize::try_from_slice(&payload);
            assert!(r1.is_err(), "raw borsh moet niet op Anchor-account-data gebruikt worden");
            // Anchor Account-deserialisatie (disc + fields) werkt:
            let mut pr: &[u8] = &payload;
            let a = <Allowance as AccountDeserialize>::try_deserialize(&mut pr).unwrap();
            assert_eq!((a.cap, a.committed, a.initialized, a.bump), (1000, 100, true, 254));
            // Discriminator komt exact overeen met on-chain (sha256("account:Allowance")[..8]):
            assert_eq!(
                <Allowance as Discriminator>::DISCRIMINATOR,
                [0x90, 0x08, 0xb8, 0xd5, 0x31, 0xf8, 0x49, 0x83]
            );
            // try_serialize = disc + fields (LEN bytes) en round-trip = identiek.
            let mut buf = [0xAAu8; Allowance::LEN + 8];
            <Allowance as AccountSerialize>::try_serialize(&a, &mut buf.as_mut_slice()).unwrap();
            // Round-trip byte-identiek; en niks na de LEN bytes (exacte grootte).
            assert_eq!(&buf[..Allowance::LEN], &payload[..], "round-trip moet byte-identiek zijn");
            assert!(
                buf[Allowance::LEN..].iter().all(|&b| b == 0xAA),
                "try_serialize mag niet meer schrijven dan LEN"
            );
        }
    }
}
