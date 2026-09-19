use anchor_lang::prelude::*;

use crate::errors::ObpError;

/// M4 (PQ, B8): in-program verificatie van FIPS 203 ML-DSA-44 + FIPS 205 SLH-DSA-128f.
///
/// De ed25519-route blijft via de native precompile (2400 CU/verify). PQ heeft géén
/// native Solana-precompile → verificatie in het programma (Rust). De CU-kosten worden
/// gemeten door de `pq_benchmark`-instructie; de architectuurbeslissing volgt uit het
/// M4-benchmarkrapport.
///
/// Data-layout van de `data`-account: `pk_len(4 LE) ‖ pk(pk_len) ‖ msg_len(4 LE) ‖
/// msg(msg_len) ‖ sig(rest)`.

/// ML-DSA-44 (FIPS 203, Level 2): verify over `msg` met publieke key `pk`.
#[inline(never)]
pub fn mldsa44_verify(pk: &[u8], msg: &[u8], sig: &[u8]) -> bool {
    use ml_dsa::{EncodedVerifyingKey, MlDsa44, Signature, VerifyingKey};
    use ml_dsa::Verifier;
    let enc = match <EncodedVerifyingKey<MlDsa44>>::try_from(pk) {
        Ok(e) => e,
        Err(_) => return false,
    };
    let vk = VerifyingKey::<MlDsa44>::decode(&enc);
    let s = match <Signature<MlDsa44>>::try_from(sig) {
        Ok(s) => s,
        Err(_) => return false,
    };
    vk.verify(msg, &s).is_ok()
}

/// SLH-DSA-SHA2-128f (FIPS 205): verify over `msg` met publieke key `pk`.
#[inline(never)]
pub fn slhdsa128f_verify(pk: &[u8], msg: &[u8], sig: &[u8]) -> bool {
    use slh_dsa::signature::Verifier;
    use slh_dsa::{Sha2_128f, Signature, VerifyingKey};
    let vk = match <VerifyingKey<Sha2_128f>>::try_from(pk) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let s = match <Signature<Sha2_128f>>::try_from(sig) {
        Ok(s) => s,
        Err(_) => return false,
    };
    vk.verify(msg, &s).is_ok()
}

/// Benchmark-instructie: leest pk/msg/sig uit een data-account en verifieert in-program.
/// `scheme`: 1 = ML-DSA-44, 2 = SLH-DSA-128f. Geeft BadSignature als verificatie faalt.
#[derive(Accounts)]
pub struct PqBenchmark<'info> {
    /// Data-account: pk_len(4) ‖ pk ‖ msg_len(4) ‖ msg ‖ sig (geen owner-check; benchmark).
    pub data: UncheckedAccount<'info>,
}

/// `#[inline(never)]`: de PQ-verify-functies zijn groot; inlining in het dispatch-frame
/// zou de SBF-frame-limit (4096 B/function) blazen (zelfde les als M1, zie checkin.rs).
#[inline(never)]
pub fn pq_benchmark(ctx: Context<PqBenchmark>, scheme: u8) -> Result<()> {
    let d = ctx.accounts.data.data.borrow();
    require!(d.len() >= 8, ObpError::StatusInvalid);
    let pk_len = u32::from_le_bytes([d[0], d[1], d[2], d[3]]) as usize;
    require!(d.len() >= 4 + pk_len + 4, ObpError::StatusInvalid);
    let pk = &d[4..4 + pk_len];
    let off = 4 + pk_len;
    let msg_len = u32::from_le_bytes([d[off], d[off+1], d[off+2], d[off+3]]) as usize;
    require!(d.len() >= off + 4 + msg_len, ObpError::StatusInvalid);
    let msg = &d[off+4..off+4+msg_len];
    let sig = &d[off+4+msg_len..];

    match scheme {
        1 => require!(mldsa44_verify(pk, msg, sig), ObpError::BadSignature),
        2 => require!(slhdsa128f_verify(pk, msg, sig), ObpError::BadSignature),
        _ => return err!(ObpError::StatusInvalid),
    }
    Ok(())
}

/// Benchmark-setup: schrijf een chunk (≤1024 B) uit de instruction-data op `offset` in een
/// data-account. PQ-sigs zijn te groot voor één ix-data én de 1232-B tx-limiet → meerdere
/// chunks over meerdere tx's (setup, niet gemeten).
#[derive(Accounts)]
pub struct PqWriteData<'info> {
    #[account(mut)]
    pub data: UncheckedAccount<'info>,
}

#[inline(never)]
pub fn pq_write_data(ctx: Context<PqWriteData>, offset: u32, chunk: Vec<u8>) -> Result<()> {
    require!(chunk.len() <= 1024, ObpError::StatusInvalid);
    let mut d = ctx.accounts.data.data.borrow_mut();
    let start = offset as usize;
    require!(d.len() >= start + chunk.len(), ObpError::StatusInvalid);
    d[start..start + chunk.len()].copy_from_slice(&chunk);
    Ok(())
}
