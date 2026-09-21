// M4.1 PQ-acceptatie — scheme 1 (ML-DSA-44, Track 1: optimistische validiteit).
// Drijft de volledige lus op het PQ-testinstance (OBP_PROGRAM_ID env), met:
//  - ML-DSA-44-signaturen (mldsa-wasm; cross-geverifieerd tegen RustCrypto-vectors)
//  - sig-field = [H(sig)[0..32] ‖ 0^32] (SigCommitFormat) — géén precompile
//  - verify_sig_commit pos/neg (binding commitment ↔ sig-bytes)
//  - bearer-verify (offline: hashketen + alle PQ-signaturen) vóór check-in
// Gebruik: OBP_PROGRAM_ID=6YLEj... bun scripts/e2e-matrix-pq.ts
import * as fs from 'node:fs';
import web3 from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import { sha256 } from '@noble/hashes/sha256';
import mldsa from 'mldsa-wasm';
import {
  PROGRAM_ID, DEVNET_URL, ObpClient,
  genesisState, nextState, stateHash, asBuf,
  fetchConfig, fetchRegistry, fetchSubmission,
  initIx, mintCoinIx, startCheckInIx, finalizeIx, settleIx, verifySigCommitIx,
  submissionPda, vaultPda, feePda, ata,
  RegistryStatus, SubmissionStatus,
} from '../src/index.ts';
import type { CoinCore } from '../src/index.ts';

const VALUE = 100n;
const E = { StatusInvalid: 6015, SigCommitMismatch: 6026 };
const conn = new web3.Connection(DEVNET_URL, 'confirmed');
const client = new ObpClient(conn, { onLog: (m) => console.log('   ', m) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rpc429 = async <T>(fn: () => Promise<T>): Promise<T> => {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      const s = String(e);
      if (i < 15 && (s.includes('429') || s.toLowerCase().includes('rate limit'))) { await sleep(Math.min(10000, 1500 * (i + 1))); continue; }
      throw e;
    }
  }
};
const SEED = Buffer.from('obp-smoke-deterministic-seed-2025');
const derive = (s: string) => web3.Keypair.fromSeed(sha256(Buffer.concat([SEED, Buffer.from(s, 'utf8')])))
const payer = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME! + '/.config/solana/id.json', 'utf8'))));
const mintAuthority = derive('mint-authority');
const recipient = derive('recipient');
const holder2 = derive('holder2');
const holder3 = derive('holder3');

const results: { name: string; ok: boolean; detail: string }[] = [];
const record = (name: string, okk: boolean, detail: string) => {
  results.push({ name, ok: okk, detail });
  console.log('  ' + (okk ? 'PASS' : 'FAIL') + '  ' + name + ' — ' + detail);
};

// ML-DSA-44 keypairs (eigenaar per houder) + sync-async bridge.
const genMl = async () => mldsa.generateKey('ML-DSA-44', false, ['sign', 'verify']);
const mlRecipient = await genMl();
const mlHolder2 = await genMl();
const signMl = async (kp: Awaited<ReturnType<typeof genMl>>, msg: Buffer) => Buffer.from(await mldsa.sign('ML-DSA-44', kp.privateKey, msg));
const verifyMl = async (kp: Awaited<ReturnType<typeof genMl>>, msg: Buffer, sig: Buffer) => mldsa.verify('ML-DSA-44', kp.publicKey, sig, msg);
const pkRaw = async (kp: Awaited<ReturnType<typeof genMl>>) => Buffer.from(await mldsa.exportKey('raw-public', kp.publicKey));
// sig-field (64B) voor on-chain: [H(sig)[0..32] ‖ 0^32] (SigCommitFormat)
const commitField = (sig: Buffer) => Buffer.concat([sha256(sig).subarray(0, 32), Buffer.alloc(32)]);

async function main() {
  const t0 = Date.now();
  let cfg = await fetchConfig(conn);
  let vaultMint: web3.PublicKey;
  if (!cfg) {
    console.log('config ontbreekt → E0: vault-mint + init (sig_scheme=1)');
    vaultMint = await rpc429(() => spl.createMint(conn, payer, mintAuthority.publicKey, null, 0, undefined, { commitment: 'confirmed' }));
    await client.send('init', initIx(vaultMint, 10000, 10n, 4, 1000n, mintAuthority.publicKey, payer.publicKey, 1), [mintAuthority, payer], payer);
    cfg = await fetchConfig(conn);
    if (!cfg) throw new Error('E0: config na init');
  } else {
    vaultMint = cfg.vaultMint;
  }
  if (cfg.sigScheme !== 1) throw new Error('config.sigScheme != 1 (dit is geen PQ-instance)');
  await rpc429(() => spl.getOrCreateAssociatedTokenAccount(conn, payer, vaultMint, vaultPda()[0], true, 'confirmed'));
  await rpc429(() => spl.getOrCreateAssociatedTokenAccount(conn, payer, vaultMint, feePda()[0], true, 'confirmed'));
  for (const k of [recipient, holder2, holder3]) {
    await rpc429(() => spl.getOrCreateAssociatedTokenAccount(conn, payer, vaultMint, k.publicKey, true, 'confirmed'));
  }
  // Pre-fund recipient (bond = 100 per check-in; matrix-conventie ≥1500).
  const recAta = ata(vaultMint, recipient.publicKey);
  const rNow = BigInt((await conn.getTokenAccountBalance(recAta)).value.amount);
  if (rNow < 1500n) {
    await rpc429(() => spl.mintTo(conn, payer, vaultMint, recAta, mintAuthority, Number(2000n - rNow), [], { commitment: 'confirmed' }));
  }
  // Vault aanvullen (I2): mint vereist vault ≥ total_unspent_supply + value.
  const vaultAta = ata(vaultMint, vaultPda()[0]);
  const vNow = BigInt((await conn.getTokenAccountBalance(vaultAta)).value.amount);
  const need = cfg.totalUnspentSupply + 700n - vNow;
  if (need > 0n) {
    await rpc429(() => spl.mintTo(conn, payer, vaultMint, vaultAta, mintAuthority, Number(need), [], { commitment: 'confirmed' }));
    console.log('   vault top-up: +' + need);
  }
  console.log('config: vaultMint ' + vaultMint.toBase58() + ' | sigScheme ' + cfg.sigScheme + ' | program ' + PROGRAM_ID.toBase58());

  // P1: PQ-coin bouwen (genesis → holder2 → holder3), ML-DSA-44 per link.
  console.log('\n== P1: PQ-coin (ML-DSA-44) ==');
  const RUN_ID = String(Date.now()).slice(-6);
  const serial = Buffer.from(sha256(Buffer.from('obp-m41-pq-acceptance-001-' + RUN_ID))); // vers per run (idempotente her-runs)
  let coin: CoinCore = { serial, value: VALUE, states: [genesisState(serial, VALUE, recipient.publicKey.toBytes())], sigs: [], sigScheme: 1 };
  // link 1: recipient (state_0) → holder2
  const st1 = nextState(coin.states[0], holder2.publicKey.toBytes());
  const sig1 = await signMl(mlRecipient, stateHash(st1));
  coin = { ...coin, states: [...coin.states, st1], sigs: [...coin.sigs, sig1] };
  // link 2: holder2 → holder3
  const st2 = nextState(st1, holder3.publicKey.toBytes());
  const sig2 = await signMl(mlHolder2, stateHash(st2));
  coin = { ...coin, states: [...coin.states, st2], sigs: [...coin.sigs, sig2] };
  record('P1 coin gebouwd (3 states, 2× 2420B ML-DSA-44)', coin.sigs.length === 2 && coin.sigs.every((s) => s.length === 2420), 'sigs=' + coin.sigs.map((s) => s.length).join(','));

  // P2: bearer-verify (offline; de "controle bij ontvangst" — Track 1-verplichting)
  console.log('\n== P2: bearer-verify (offline) ==');
  {
    let ok = true; let why = '';
    // hashketen
    for (let i = 1; i < coin.states.length; i++) {
      if (!asBuf(coin.states[i].subarray(72, 104)).equals(stateHash(asBuf(coin.states[i - 1])))) { ok = false; why = 'hashketen i=' + i; break; }
    }
    // signaturen
    if (ok) {
      const kps = [mlRecipient, mlHolder2];
      for (let i = 0; i < coin.sigs.length; i++) {
        const v = await verifyMl(kps[i], stateHash(asBuf(coin.states[i + 1])), asBuf(coin.sigs[i]));
        if (!v) { ok = false; why = 'sig i=' + i; break; }
      }
    }
    // negatief: corrupte sig faalt
    const bad = Buffer.from(coin.sigs[0]); bad[5] ^= 0xff;
    const neg = await verifyMl(mlRecipient, stateHash(asBuf(coin.states[1])), bad);
    record('P2 bearer-verify (hashketen + 2× ML-DSA-44)', ok && !neg, why || 'ok; corrupt-sig=false ✓');
  }

  // P3: mint + volledige check-in (zonder precompile; commitment in sig-field)
  console.log('\n== P3: mint + check-in (scheme 1) ==');
  {
    const reg = await fetchRegistry(conn, serial);
    if (!reg) {
      const v8 = Buffer.alloc(8); v8.writeBigUInt64LE(VALUE);
      const mintTx = Buffer.concat([
        sha256(Buffer.concat([serial, v8, recipient.publicKey.toBytes()])),
        sha256(Buffer.concat([v8, recipient.publicKey.toBytes(), serial])),
      ]);
      await client.send('mint[pq]', mintCoinIx(serial, VALUE, recipient.publicKey, stateHash(coin.states[0]), mintTx, mintAuthority.publicKey, payer.publicKey, vaultMint), [mintAuthority], payer);
      sleep(800);
    }
    const [subPda] = submissionPda(serial, 0);
    await rpc429(() => spl.getOrCreateAssociatedTokenAccount(conn, payer, vaultMint, subPda, true, 'confirmed')); // escrow-ATA vóór start (M3-bevinding)
    await client.send('start[pq]', startCheckInIx(serial, 0, coin.states[0], recipient.publicKey, payer.publicKey, vaultMint), [recipient], payer);
    // append: 2 links, sig-field = commitment ( géén precompile)
    const headOwner = asBuf(coin.states[0].subarray(40, 72));
    const linksBuf = Buffer.concat([
      Buffer.from([2, 0, 0, 0]),
      asBuf(coin.states[1]), commitField(asBuf(coin.sigs[0])),
      asBuf(coin.states[2]), commitField(asBuf(coin.sigs[1])),
    ]);
    const u16le = (v: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
    const args = Buffer.concat([asBuf(serial), headOwner, linksBuf, stateHash(asBuf(coin.states[2]))]);
    const [cfgPda] = (await import('../src/accounts.ts')).configPda();
    const [regPda] = (await import('../src/accounts.ts')).registryPda(serial);
    const appendIx = new web3.TransactionInstruction({ programId: PROGRAM_ID, keys: [ { pubkey: cfgPda, isWritable: false, isSigner: false }, { pubkey: regPda, isWritable: false, isSigner: false }, { pubkey: subPda, isWritable: true, isSigner: false } ], data: Buffer.concat([sha256(Buffer.from('global:append_links')).subarray(0, 8), args]) });
    await client.send('append[pq×2]', appendIx, [], payer);
    const sub = (await fetchSubmission(conn, serial, 0))!;
    record('P3a start+append (commitments on-chain, geen precompile)', sub.statesLen === 3 && sub.status === SubmissionStatus.RECEIVING, 'statesLen=' + sub.statesLen + ' status=' + sub.status);
    // commitments kloppen met de coin-file-signaturen?
    // On-chain commits = H(sig-field) — de program-eigen check (verify_sig_commit)
    // op beide links + offline-herberekening van de commitField-structuur.
    const okCommits = sub.sigCommits[1].equals(sha256(commitField(asBuf(coin.sigs[0])))) && sub.sigCommits[2].equals(sha256(commitField(asBuf(coin.sigs[1]))));
    record('P3b on-chain sigCommits = H(commitField(sig))', okCommits, 'stored[1]=' + Buffer.from(sub.sigCommits[1]).toString('hex').slice(0,16) + '… expect=' + Buffer.from(sha256(commitField(asBuf(coin.sigs[0])))).toString('hex').slice(0,16) + '…');
    await client.send('finalize[pq]', finalizeIx(serial, 0, 1, recipient.publicKey, recipient.publicKey, holder3.publicKey, vaultMint, payer.publicKey), [], payer);
    const subP = (await fetchSubmission(conn, serial, 0))!;
    record('P3c finalize → PENDING (head)', subP.status === SubmissionStatus.PENDING, 'status=' + subP.status);
  }
  // P4: settle na window
  console.log('\n== P4: settle na window ==');
  {
    const sub0 = (await fetchSubmission(conn, serial, 0))!;
    const h = (await (await import('../src/readers.ts')).fetchHead(conn, serial))!;
    for (;;) {
      const slot = await conn.getSlot();
      if (slot >= Number(h.pendingSinceSlot) + Number(cfg.challengeWindowSlots)) break;
      await sleep(2500);
    }
    await client.send('settle[pq]', settleIx(serial, 0, 1, recipient.publicKey, sub0.checker, sub0.finalOwner, vaultMint, payer.publicKey), [], payer);
    const subW = (await fetchSubmission(conn, serial, 0))!;
    const regW = (await fetchRegistry(conn, serial))!;
    record('P4 settle → WON, registry SPENT', subW.status === SubmissionStatus.WON && regW.status === RegistryStatus.SPENT, 'sub=' + subW.status + ' reg=' + regW.status);
  }
  // P5: verify_sig_commit (binding commitment ↔ sig-bytes)
  console.log('\n== P5: verify_sig_commit ==');
  {
    const [subPda] = submissionPda(serial, 0);
    const [cfgPda] = (await import('../src/accounts.ts')).configPda();
    // positief: het commitment-veld zelf (H(veld) == sig_commits[1])
    await client.send('verify_sig_commit[pos]', verifySigCommitIx(serial, 0, 1, commitField(asBuf(coin.sigs[0])), subPda, cfgPda), [], payer);
    record('P5a verify_sig_commit positief (commitment-veld)', true, 'H(veld)==opgeslagen commitment');
    // negatief: ander veld → 6026
    try {
      await client.send('verify_sig_commit[neg]', verifySigCommitIx(serial, 0, 1, commitField(Buffer.from(coin.sigs[0]).fill(0xab)), subPda, cfgPda), [], payer);
      record('P5b verify_sig_commit negatief → 6026', false, 'ix slaagde (verwacht 6026)');
    } catch (e) {
      record('P5b verify_sig_commit negatief → 6026', String(e).includes('"Custom":' + E.SigCommitMismatch), String(e).slice(0, 120));
    }
  }
  // rapport
  console.log('\n--- M4.1 PQ-ACCEPTATIE RAPPORT ---');
  const pass = results.filter((r) => r.ok).length;
  console.log(pass + '/' + results.length + ' PASS in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  console.log('program:', PROGRAM_ID.toBase58(), '| serial:', Buffer.from(serial).toString('hex').slice(0, 16) + '…');
  process.exit(pass === results.length ? 0 : 1);
}
main().catch((e) => { console.error('FATAAL:', e); process.exit(2); });
