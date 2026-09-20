// M4.1.1 (D1, Track 2): CU-meting ML-DSA-44 verify IN-PROGRAM (RustCrypto) op
// een LOCAL VALIDATOR (standaard CU-model; devnet-200k-cap is cluster-artifact).
// Gebruik: solana-test-validator draaien (gossip 8100) + program deployed, dan:
//   bun scripts/track2-cu-benchmark.ts
import * as fs from 'node:fs';
import web3 from '@solana/web3.js';
import { sha256 } from '@noble/hashes/sha256';
import { PROGRAM_ID, pqBenchmarkIx, pqWriteDataIx } from '../src/index.ts';

const LOCAL_URL = 'http://127.0.0.1:8899';
const conn = new web3.Connection(LOCAL_URL, 'confirmed');
const payer = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME! + '/.config/solana/id.json', 'utf8'))));

// ---- vectors (RustCrypto, deterministisch) --------------------------------
const txt = fs.readFileSync('fixtures/pq/vectors.txt', 'utf8');
const V: Record<string, string> = {};
for (const line of txt.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) V[m[1]] = m[2].trim();
}
const pk = Buffer.from(V.MLDSA44_PK, 'hex');
const msg = Buffer.from(V.MSG, 'hex');
const sig = Buffer.from(V.MLDSA44_SIG, 'hex');

// data-layout (pq.rs): pk_len(4 LE) ‖ pk ‖ msg_len(4) ‖ msg ‖ sig
const u32le = (v: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const fullData = Buffer.concat([u32le(pk.length), pk, u32le(msg.length), msg, sig]);
console.log('data-account grootte:', fullData.length, 'B');

const send = async (label: string, build: (tx: web3.Transaction) => void): Promise<{ sig: string; cu: number; err: unknown }> => {
  const tx = new web3.Transaction();
  build(tx);
  const bh = await conn.getLatestBlockhash('confirmed');
  tx.recentBlockhash = bh.blockhash;
  tx.sign(payer);
  const r = await conn.sendRawTransaction(await tx.serialize());
  await conn.confirmTransaction(r, 'confirmed');
  const c = await conn.getTransaction(r, { maxSupportedTransactionVersion: 0 });
  return { sig: r, cu: c?.meta?.preBalances ? (c.meta!.unitsConsumed ?? 0) : 0, err: c?.meta?.err ?? null };
};

async function main() {
  // 1. data-account alloceren (walleteigenaar; pq_* = UncheckedAccount+mut)
  const dataKp = web3.Keypair.generate();
  const rent = await conn.getMinimumBalanceForRentExemption(fullData.length);
  {
    // Agave 4.x / web3.js 1.99 (nieuw system-encoding, u32-discriminators):
    // Create (index 0) maakt een SYSTEM-owned account; Assign (index 1) zet de
    // owner. Beiden in één tx. (Gemeten: create alleen → owner=system →
    // "modified data of an account it does not own" bij pq_write_data.)
    const tx = new web3.Transaction();
    tx.add(web3.SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: dataKp.publicKey, lamports: rent, space: fullData.length, programId: PROGRAM_ID }));
    tx.add(web3.SystemProgram.assign({ accountPubkey: dataKp.publicKey, programId: PROGRAM_ID }));
    await conn.confirmTransaction(await (async () => { const bh = await conn.getLatestBlockhash('confirmed'); tx.recentBlockhash = bh.blockhash; tx.sign(payer, dataKp); return conn.sendRawTransaction(await tx.serialize()); })(), 'confirmed');
  }
  console.log('data-account:', dataKp.publicKey.toBase58(), 'rent', rent);
  // 2. data schrijven (4× ≤1024 B chunks via pq_write_data)
  for (let off = 0; off < fullData.length; off += 1000) {
    const chunk = fullData.subarray(off, Math.min(off + 1000, fullData.length));
    await send('write[' + off + ']', (tx) => tx.add(pqWriteDataIx(dataKp.publicKey, off, chunk)));
  }
  // 3. POSITIEF: pq_benchmark(scheme=1) met 1.4M-budget (het per-instructielimiet).
  //    Verwacht: CU-cap (RustCrypto > 1.4M) — dat IS het meetresultaat.
  {
    try {
      const r = await send('benchmark-ml-dsa-44', (tx) => {
        tx.add(web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
        tx.add(pqBenchmarkIx(dataKp.publicKey, 1));
      });
      console.log('RESULTaat ML-DSA-44 (RustCrypto, in-program): SUCCES, CU =', r.cu, '| sig:', r.sig);
    } catch (e: any) {
      const m = String(e.message).match(/consumed (\d+) of (\d+) compute/);
      console.log('RESULTaat ML-DSA-44 (RustCrypto, in-program): OVER BUDGET — consumed', m?.[1], 'of', m?.[2], 'CU (limiet 1.4M = per-instructie-max)');
    }
  }
  // 4. NEGATIEF: corrupte sig (laatste 4 bytes omdraaien) → 60xx + CU
  {
    const lastOff = fullData.length - 4;
    const patch = Buffer.from(sig.subarray(sig.length - 4));
    [patch[0], patch[3]] = [patch[3], patch[0]];
    await send('patch-sig', (tx) => tx.add(pqWriteDataIx(dataKp.publicKey, lastOff, patch)));
    try {
      const r = await send('benchmark-ml-dsa-44-neg', (tx) => {
        tx.add(web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
        tx.add(pqBenchmarkIx(dataKp.publicKey, 1));
      });
      console.log('RESULTaat negatief (corrupte sig):', r.err ? 'faal ' + JSON.stringify(r.err) : 'ONVERWACHT SUCCES', '| CU =', r.cu);
    } catch (e: any) {
      const m = String(e.message).match(/consumed (\d+) of (\d+) compute/);
      console.log('RESULTaat negatief (corrupte sig): OVER BUDGET — consumed', m?.[1], 'of', m?.[2], 'CU (verificatie loopt tot aan de sig-check)');
    }
  }
}
main().catch((e) => { console.error('FATAAL:', e); process.exit(2); });
