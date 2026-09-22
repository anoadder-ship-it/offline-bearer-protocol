// M4 (PQ, B8): CU/bytes-benchmark voor in-program PQ-verificatie.
// Meet de echte on-chain CU-kosten van ML-DSA-44 (FIPS 204) + SLH-DSA-SHA2-128f (FIPS 205).
// Data (pk/msg/sig) wordt per scheme in een eigen account gevuld via pq_write_data-chunks.
// Meting: ruwe simulateTransaction met setComputeUnitLimit(1.4M) → CU + error + logs,
// zodat we ook "exceeded CUs" (>1.4M = niet haalbaar in één tx) kunnen vastleggen.
// Robuust tegen devnet-429: lichte sends (skipPreflight) + sleep tussen fills + ruime retries.
// Gebruik: bun scripts/pq-benchmark.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js';
import { DEVNET_URL, ObpClient, pqBenchmarkIx, pqWriteDataIx, PROGRAM_ID, pingIx } from '../src/index.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function rpc429<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      const s = String(e);
      if (i < 30 && (s.includes('429') || s.toLowerCase().includes('rate limit'))) { await sleep(Math.min(10000, 1000 * (i + 1))); continue; }
      throw e;
    }
  }
}

const vecPath = path.join(import.meta.dirname, '../fixtures/pq/vectors.txt');
const vecText = fs.readFileSync(vecPath, 'utf8');
const V: Record<string, string> = {};
for (const line of vecText.split('\n')) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) V[m[1]] = m[2].trim(); }
if (!V['MLDSA44_PK'] || !V['SLH_SIG']) throw new Error('vectoren ontbreken');
const hex2buf = (h: string) => Buffer.from(h, 'hex');
const MSG = Buffer.from('obp m4 pq benchmark message v1', 'utf8');

function buildData(pkHex: string, sigHex: string): Buffer {
  const pk = hex2buf(pkHex), sig = hex2buf(sigHex);
  const out = Buffer.alloc(4 + pk.length + 4 + MSG.length + sig.length);
  let o = 0;
  out.writeUInt32LE(pk.length, o); o += 4; pk.copy(out, o); o += pk.length;
  out.writeUInt32LE(MSG.length, o); o += 4; MSG.copy(out, o); o += MSG.length;
  sig.copy(out, o);
  return out;
}

const conn = new Connection(DEVNET_URL, 'confirmed');
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME! + '/.config/solana/id.json', 'utf8'))));

// Lichte send: getLatestBlockhash + sign + sendRawTransaction(skipPreflight) + confirm. Minder RPC-calls → minder 429.
async function sendLight(label: string, ixs: any[], signers: Keypair[]): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const tx = new Transaction();
      const bh = await rpc429(() => conn.getLatestBlockhash('confirmed'));
      tx.recentBlockhash = bh.blockhash; tx.feePayer = payer.publicKey;
      for (const i of ixs) tx.add(i);
      tx.sign(payer, ...signers);
      const sig = await rpc429(() => conn.sendRawTransaction(tx.serialize(), { skipPreflight: true }));
      await rpc429(() => conn.confirmTransaction({ signature: sig, ...bh }, 'confirmed'));
      console.log('   ', label + ': OK');
      return sig;
    } catch (e) {
      const s = String(e);
      if (attempt < 30 && (s.includes('429') || s.toLowerCase().includes('rate limit'))) { await sleep(Math.min(10000, 1000 * (attempt + 1))); continue; }
      throw new Error(label + ': ' + s.slice(0, 200));
    }
  }
}

async function measurePq(acct: PublicKey, scheme: number): Promise<{ cu: number; err: any; logTail: string[] }> {
  const tx = new Transaction();
  const bh = await rpc429(() => conn.getLatestBlockhash('confirmed'));
  tx.recentBlockhash = bh.blockhash; tx.feePayer = payer.publicKey;
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }));
  tx.add(pqBenchmarkIx(acct, scheme));
  tx.sign(payer);
  const r = await rpc429(() => conn.simulateTransaction(tx));
  return { cu: r.value.unitsConsumed ?? 0, err: r.value.err, logTail: (r.value.logs || []).slice(-6) };
}

async function main() {
  // baseline via simulatie (geen send → minder 429-druk)
  const btx = new Transaction(); const bbh = await rpc429(() => conn.getLatestBlockhash('confirmed'));
  btx.recentBlockhash = bbh.blockhash; btx.feePayer = payer.publicKey;
  btx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })); btx.add(pingIx()); btx.sign(payer);
  const br = await rpc429(() => conn.simulateTransaction(btx));
  const baseCu = br.value.unitsConsumed ?? 0;
  console.log(`\nBASELINE (ping + cu-limit, simulatie): CU=${baseCu}`);

  const schemes = [
    { name: 'ML-DSA-44 (FIPS 204)', scheme: 1, data: buildData(V['MLDSA44_PK'], V['MLDSA44_SIG']) },
    { name: 'SLH-DSA-SHA2-128f (FIPS 205)', scheme: 2, data: buildData(V['SLH_PK'], V['SLH_SIG']) },
  ];

  const results: any[] = [];
  for (const sc of schemes) {
    console.log(`\n=== ${sc.name} ===`);
    console.log(`data-size: ${sc.data.length} bytes`);
    const acct = Keypair.generate();
    const lamports = await rpc429(() => conn.getMinimumBalanceForRentExemption(sc.data.length));
    await sendLight('create-data-acct', [SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: acct.publicKey, lamports, space: sc.data.length, programId: PROGRAM_ID })], [acct]);
    const CHUNK = 1000; let off = 0, nchunks = 0;
    while (off < sc.data.length) {
      const chunk = Buffer.from(sc.data.subarray(off, Math.min(off + CHUNK, sc.data.length)));
      await sendLight('fill-chunk', [pqWriteDataIx(acct.publicKey, off, chunk)], []);
      off += chunk.length; nchunks++;
      await sleep(400); // 429-druk verminderen tussen fills
    }
    console.log(`gevuld met ${nchunks} chunks → account ${acct.publicKey.toBase58()}`);

    const m = await measurePq(acct.publicKey, sc.scheme);
    if (m.err) {
      const exceeded = JSON.stringify(m.err).includes('ProgramFailedToComplete');
      console.log(`RESULT: FOUT ${JSON.stringify(m.err)} — ${exceeded ? 'CU > 1.4M (niet haalbaar in één tx)' : 'zie logs'}`);
      for (const l of m.logTail) console.log('   |', l.slice(0, 150));
      results.push({ name: sc.name, cu: exceeded ? '>1400000' : m.cu, ok: false, dataLen: sc.data.length });
    } else {
      console.log(`RESULT: OK CU=${m.cu} (via simulatie)`);
      results.push({ name: sc.name, cu: m.cu, ok: true, dataLen: sc.data.length });
    }
  }

  console.log('\n=== SAMENVATTING M4-PQ-BENCHMARK ===');
  for (const r of results) {
    const verifyCu = typeof r.cu === 'number' ? r.cu - baseCu : r.cu;
    console.log(`${r.name}: ${r.ok ? 'OK' : 'FAIL'} — tx-CU=${r.cu} (~verify=${verifyCu}), data=${r.dataLen}B`);
  }
}

main().catch((e) => { console.error('FOUTAL:', e?.message ?? e); process.exit(1); });
