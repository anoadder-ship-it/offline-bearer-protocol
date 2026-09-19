//! M4 (PQ, B8): deterministische PQ-testvectoren voor de CU-benchmark.
//!
//! Reproduceerbaar: geen RNG — alles afgeleid van MASTER_SEED (32 B).
//!   - ML-DSA-44 (FIPS 203): z0 (32 B) = sha256-expansie(MASTER_SEED, "mldsa44-z0").
//!   - SLH-DSA-SHA2-128f (FIPS 205): (sk_seed, sk_prf, pk_seed) = elk 16 B
//!     via sha256-expansie(MASTER_SEED, <domain>).
//! Uitvoer: `sdk/fixtures/pq/vectors.txt` (KEY=hex-lijst; gelezen door
//! `sdk/scripts/pq-benchmark.ts`). Zelfcheck: beide signatures verifiëren
//! met dezelfde API als programs/obp-core/src/instructions/pq.rs.
//!
//! Gebruik: cargo run --example gen-pq-vectors -- [uitvoerpad]
//! (host-build; geen SBF. De crates komen uit het program-Cargo.toml.)

use solana_sha256_hasher::hashv;

/// Deterministische expansie: sha256(seed ‖ doeldomein ‖ u32 LE counter) tot `len` bytes.
fn expand(seed: &[u8; 32], domain: &str, len: usize) -> Vec<u8> {
    let mut out = Vec::new();
    let mut counter = 0u32;
    while out.len() < len {
        let mut block = Vec::with_capacity(32 + domain.len() + 4);
        block.extend_from_slice(seed);
        block.extend_from_slice(domain.as_bytes());
        block.extend_from_slice(&counter.to_le_bytes());
        let h = hashv(&[&block]);
        out.extend_from_slice(&h.to_bytes());
        counter += 1;
    }
    out.truncate(len);
    out
}

fn hex(b: &[u8]) -> String {
    let mut s = String::with_capacity(b.len() * 2);
    for x in b {
        s.push_str(&format!("{:02x}", x));
    }
    s
}

fn main() {
    let out_path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "sdk/fixtures/pq/vectors.txt".to_string());

    // MASTER_SEED: vast, gedocumenteerd (geen toevallige waarde).
    let master: [u8; 32] = hashv(&[b"obp pq vector gen v1"]).to_bytes();
    let msg = b"obp m4 pq benchmark message v1";

    // ---- ML-DSA-44 (FIPS 203) ----
    use ml_dsa::{Keypair as MlKeypair, MlDsa44, Seed, Signature, Signer as _, VerifyingKey, Verifier, SigningKey};
    let z0 = expand(&master, "mldsa44-z0", 32);
    let seed = Seed::try_from(z0.as_slice()).expect("Seed = 32B");
    let sk = SigningKey::<MlDsa44>::from_seed(&seed);
    let sig: Signature<MlDsa44> = sk.sign(msg); // Signer::sign = deterministische ML-DSA-sign (FIPS 203); onfeilbaar -> geen Result
    let mldsa_pk = sk.verifying_key().encode().to_vec();
    let mldsa_sig = sig.encode().to_vec();
    assert_eq!(mldsa_pk.len(), 1312, "ML-DSA-44 pk-len");
    assert_eq!(mldsa_sig.len(), 2420, "ML-DSA-44 sig-len");
    // zelfcheck: zelfde decode/verify-API als pq.rs
    let enc_vk = ml_dsa::EncodedVerifyingKey::<MlDsa44>::try_from(mldsa_pk.as_slice()).unwrap();
    let vk = VerifyingKey::<MlDsa44>::decode(&enc_vk);
    let s2 = Signature::<MlDsa44>::try_from(mldsa_sig.as_slice()).expect("ML-DSA sig decode");
    assert!(vk.verify(msg, &s2).is_ok(), "ML-DSA self-verify");

    // ---- SLH-DSA-SHA2-128f (FIPS 205) ----
    use slh_dsa::signature::Signer as _;
    use slh_dsa::{Sha2_128f, Signature as SlhSignature, SigningKey as SlhSigningKey, VerifyingKey as SlhVerifyingKey};
    let n = 16usize; // N=16 voor Sha2_128f (gemeten uit crate-def; pk=2N=32B)
    let sk_seed = expand(&master, "slh128f-skseed", n);
    let sk_prf = expand(&master, "slh128f-skprf", n);
    let pk_seed = expand(&master, "slh128f-pkseed", n);
    let sk = SlhSigningKey::<Sha2_128f>::slh_keygen_internal(&sk_seed, &sk_prf, &pk_seed);
    let sig = sk.try_sign(msg).expect("SLH sign (Signer-trait, zelfde framing als vk.verify)");
    let slh_pk = sk.verifying_key().to_vec();
    let slh_sig = sig.to_vec();
    assert_eq!(slh_pk.len(), 2 * n, "SLH-DSA pk = 2N");
    assert_eq!(slh_sig.len(), 17088, "SLH-DSA-128f sig-len");
    // zelfcheck: zelfde try_from/verify-API als pq.rs
    let vk = SlhVerifyingKey::<Sha2_128f>::try_from(slh_pk.as_slice()).expect("SLH vk");
    let s2 = SlhSignature::<Sha2_128f>::try_from(slh_sig.as_slice()).expect("SLH sig");
    assert!(vk.verify(msg, &s2).is_ok(), "SLH self-verify");

    // ---- schrijf vectors.txt ----
    let mut t = String::new();
    t.push_str(r#"# OBP M4 PQ vectors v1 — deterministisch (geen RNG).
# Generator: programs/obp-core/examples/gen-pq-vectors.rs (cargo run --example gen-pq-vectors).
# MASTER_SEED = sha256("obp pq vector gen v1"); expansie = sha256(seed ‖ domain ‖ u32 LE counter).
# ML-DSA-44 (FIPS 203): deterministic sign, ctx="".
# SLH-DSA-SHA2-128f (FIPS 205): slh_keygen_internal + slh_sign_internal(opt_rand=None, deterministisch).
# MSG = "obp m4 pq benchmark message v1" (ascii).
"#);
    t.push_str(&format!("MASTER_SEED={}\n", hex(&master)));
    t.push_str(&format!("MSG={}\n", hex(msg)));
    t.push_str(&format!("MLDSA44_PK={}\n", hex(&mldsa_pk)));
    t.push_str(&format!("MLDSA44_SIG={}\n", hex(&mldsa_sig)));
    t.push_str(&format!("SLH_PK={}\n", hex(&slh_pk)));
    t.push_str(&format!("SLH_SIG={}\n", hex(&slh_sig)));

    if let Some(dir) = std::path::Path::new(&out_path).parent() {
        std::fs::create_dir_all(dir).ok();
    }
    std::fs::write(&out_path, &t).expect("write vectors.txt");
    println!("vectors: {} (ML-DSA-44 pk={} sig={}; SLH-128f pk={} sig={})",
        out_path, mldsa_pk.len(), mldsa_sig.len(), slh_pk.len(), slh_sig.len());
    println!("MASTER_SEED={}", hex(&master));
}
