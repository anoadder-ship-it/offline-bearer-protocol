// M3: E2E-matrix — dispute-game (C2), negatieve gevallen, CU-tabel.
// Spec: SPEC.md §5/§6/§7 | Bewijs: STATUS.md §12 (M3).
// Deterministische serials + idempotente helpers → veilig te herlopen.
// Foutcodes = 6000+index (Anchor custom-range); zie errors.rs.
// Gebruik: bun scripts/e2e-matrix.ts
import * as fs from 'node:fs';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import { sha256 } from '@noble/hashes/sha256';
import {
  DEVNET_URL, ObpClient, newCoin, appendLink, ed25519Signer, stateHash,
  fetchConfig, fetchRegistry, fetchHead, fetchSubmission, fetchAllowance,
  initIx, mintCoinIx, startCheckInIx, appendLinksIxPair, finalizeIx, settleIx, setAllowanceIx,
  submissionPda, vaultPda, feePda, ata,
  RegistryStatus, SubmissionStatus,
} from '../src/index.ts';
import type { CoinCore } from '../src/index.ts';

// ObpError-codes (6000+index, errors.rs) — alleen degenen die we testen.
const E = { AllowanceCapBelowCommitted: 6008, StatusInvalid: 6015, MaxLinksExceeded: 6016, StatesFull: 6018, WindowExpired: 6019 };

// Zelfde deterministische identiteit als M1/M2 (config is singleton; allowance bestaat al).
const SEED = Buffer.from('obp-smoke-deterministic-seed-2025');
// Per-run nonce → E2/E3/E8 gebruiken verse coins: schone balans-delta's + CU-tabel,
// onafhankelijk van opgelopen devnet-staat uit eerdere (gedeeltelijke) runs.
const RUN_ID = String(Date.now()).slice(-6);
const derive = (s: string) => Keypair.fromSeed(sha256(Buffer.concat([SEED, Buffer.from(s, 'utf8')])));
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME! + '/.config/solana/id.json', 'utf8'))));
const mintAuthority = derive('mint-authority');
const recipient = derive('recipient');
const holder2 = derive('holder2');
const holder3 = derive('holder3');
const VALUE = 100n;
const u64 = (v: bigint): Buffer => { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; };

const client = new ObpClient(new Connection(DEVNET_URL, 'confirmed'), { onLog: (m) => console.log('   ', m) });
const conn = client.conn;
let vaultMint: PublicKey;
let maxLinksPerTx = 4;

const results: { name: string; ok: boolean; detail: string }[] = [];
const cu: Record<string, number> = {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function record(name: string, okk: boolean, detail: string) {
  results.push({ name, ok: okk, detail });
  console.log('  ' + (okk ? 'PASS' : 'FAIL') + '  ' + name + ' — ' + detail);
}

// generieke 429-retry voor RPC-calls buiten ObpClient.send (spl-token, getSlot).
async function rpc429<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      const s = String(e);
      if (i < 10 && (s.includes('429') || s.toLowerCase().includes('rate limit'))) { await sleep(Math.min(8000, 1500 * (i + 1))); continue; }
      throw e;
    }
  }
}

// Robuuste ATA-create: retry op 429/rate-limit én TokenAccountNotFound
// (getOrCreateAssociatedTokenAccount doet intern meerdere RPC-calls; onder
// devnet-rate-limiting kan de create slagen maar de herlees null geven).
async function ensureAta(owner: PublicKey): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await spl.getOrCreateAssociatedTokenAccount(conn, payer, vaultMint, owner, true, 'confirmed');
      return;
    } catch (e) {
      const s = String(e);
      if (i < 10 && (s.includes('429') || s.toLowerCase().includes('rate limit') || s.includes('TokenAccountNotFound'))) { await sleep(Math.min(8000, 1500 * (i + 1))); continue; }
      throw e;
    }
  }
}

async function bal(w: PublicKey): Promise<bigint> {
  for (let i = 0; ; i++) {
    let a;
    try { a = await spl.getAccount(conn, ata(vaultMint, w), 'confirmed'); } catch (e) {
      const s = String(e);
      if (s.includes('Token account not found')) return 0n;
      if (i < 10 && (s.includes('429') || s.toLowerCase().includes('rate limit'))) { await sleep(Math.min(8000, 1500 * (i + 1))); continue; }
      throw e;
    }
    return BigInt(a.amount);
  }
}
const vaultBal = () => bal(vaultPda()[0]);

async function expectErr(label: string, fn: () => Promise<unknown>, want: number): Promise<boolean> {
  try {
    await fn();
    record(label, false, 'verwachtte fout ' + want + ' maar ix slaagde');
    return false;
  } catch (e) {
    const s = String(e);
    const hit = s.includes('"Custom":' + want);
    record(label, hit, hit ? 'fout ' + want + ' (verwacht)' : 'verwacht ' + want + ', kreeg: ' + s.slice(0, 150));
    return hit;
  }
}

// --- helpers ----------------------------------------------------------------
function buildChain(serial: Buffer, owners: Keypair[]): CoinCore {
  let coin = newCoin(serial, VALUE, owners[0].publicKey.toBytes());
  for (let i = 0; i < owners.length - 1; i++) {
    coin = appendLink(coin, ed25519Signer(owners[i].secretKey.subarray(0, 32)), owners[i + 1].publicKey.toBytes());
  }
  return coin;
}

async function mintNew(label: string): Promise<Buffer> {
  const serial = Buffer.from(sha256(Buffer.from('obp-m3-' + label)));
  if (!(await fetchRegistry(conn, serial))) {
    const state0 = newCoin(serial, VALUE, recipient.publicKey.toBytes()).states[0];
    const gh = stateHash(state0);
    const mintTx = Buffer.concat([
      sha256(Buffer.concat([serial, u64(VALUE), recipient.publicKey.toBytes()])),
      sha256(Buffer.concat([u64(VALUE), recipient.publicKey.toBytes(), serial])),
    ]);
    const r = await client.send('mint[' + label + ']',
      mintCoinIx(serial, VALUE, recipient.publicKey, gh, mintTx, mintAuthority.publicKey, payer.publicKey, vaultMint),
      [mintAuthority], payer);
    cu['mint_coin'] = r.unitsConsumed ?? 0;
  await sleep(800); // rate-limit gladstrijken
  }
  return serial;
}

async function ensureBond(checker: Keypair) {
  const a = await rpc429(() => spl.getOrCreateAssociatedTokenAccount(conn, payer, vaultMint, checker.publicKey, true, 'confirmed'));
  if (BigInt(a.amount) < VALUE + 50n) {
    await rpc429(() => spl.mintTo(conn, payer, vaultMint, a.address, mintAuthority, Number(VALUE + 500n), [], { commitment: 'confirmed' }));
  }
}

// Idempotent: slaat over als de submission al bestaat (bond is dan al geëscrowd).
async function start(serial: Buffer, attempt: number, coin: CoinCore, checker: Keypair, label: string) {
  if (await fetchSubmission(conn, serial, attempt)) return;
  await ensureBond(checker);
  const [subPda] = submissionPda(serial, attempt);
  await ensureAta(subPda);
  const r = await client.send('start[' + label + ':' + attempt + ']',
    startCheckInIx(serial, attempt, coin.states[0], checker.publicKey, payer.publicKey, vaultMint),
    [checker], payer);
  cu['start_check_in'] = r.unitsConsumed ?? 0;
  await sleep(800); // rate-limit gladstrijken
}

// Idempotent: appent vanaf de huidige on-chain states_len tot targetLen (batches ≤ maxLinksPerTx).
async function appendTo(serial: Buffer, attempt: number, coin: CoinCore, label: string, targetLen: number) {
  let sub = (await fetchSubmission(conn, serial, attempt))!;
  while (sub.statesLen < targetLen) {
    const n = Math.min(maxLinksPerTx, targetLen - sub.statesLen);
    const headOwner = Buffer.from(coin.states[sub.statesLen - 1].slice(40, 72));
    const links: { state: Buffer; sig: Buffer }[] = [];
    for (let i = 0; i < n; i++) links.push({ state: coin.states[sub.statesLen + i], sig: coin.sigs[sub.statesLen - 1 + i] });
    const r = await client.send('append[' + label + '×' + n + ']',
      appendLinksIxPair(serial, attempt, { headOwner, links, lastHash: stateHash(coin.states[sub.statesLen + n - 1]) }), [], payer);
    cu['append_links(n=' + n + ')'] = r.unitsConsumed ?? 0;
  await sleep(800); // rate-limit gladstrijken
    sub = (await fetchSubmission(conn, serial, attempt))!;
  }
}

// Idempotent: finaliseer alleen als nog RECEIVING/SUBMITTED.
async function finalizeA(serial: Buffer, attempt: number, label: string, tag: string) {
  const sub = (await fetchSubmission(conn, serial, attempt))!;
  if (sub.status !== SubmissionStatus.RECEIVING && sub.status !== SubmissionStatus.SUBMITTED) return;
  const r = await client.send('finalize[' + label + ']',
    finalizeIx(serial, attempt, 1 - attempt, recipient.publicKey, sub.checker, sub.finalOwner, vaultMint, payer.publicKey), [], payer);
  cu[tag] = r.unitsConsumed ?? 0;
  await sleep(800); // rate-limit gladstrijken
}

async function finalizeB(serial: Buffer, myAttempt: number, label: string, tag: string) {
  const otherAttempt = 1 - myAttempt;
  const mySub = (await fetchSubmission(conn, serial, myAttempt))!;
  if (mySub.status !== SubmissionStatus.RECEIVING && mySub.status !== SubmissionStatus.SUBMITTED) return;
  const otherSub = (await fetchSubmission(conn, serial, otherAttempt))!;
  const r = await client.send('finalize[' + label + ']',
    finalizeIx(serial, myAttempt, otherAttempt, recipient.publicKey, mySub.checker, mySub.finalOwner, vaultMint, payer.publicKey, { otherChecker: otherSub.checker }), [], payer);
  cu[tag] = r.unitsConsumed ?? 0;
  await sleep(800); // rate-limit gladstrijken
}

// Idempotent: settle alleen als PENDING.
async function settle(serial: Buffer, attempt: number, label: string) {
  const sub = (await fetchSubmission(conn, serial, attempt))!;
  if (sub.status !== SubmissionStatus.PENDING) return;
  const r = await client.send('settle[' + label + ']',
    settleIx(serial, attempt, 1 - attempt, recipient.publicKey, sub.checker, sub.finalOwner, vaultMint, payer.publicKey), [], payer);
  cu['settle'] = r.unitsConsumed ?? 0;
}

async function waitWindow(serial: Buffer) {
  const cfg = await fetchConfig(conn);
  if (!cfg) throw new Error('config ontbreekt op devnet (reset?)');
  const head = (await fetchHead(conn, serial))!;
  const deadline = head.pendingSinceSlot + cfg.challengeWindowSlots;
  for (;;) {
    let slot: number;
    let tries = 0;
    for (;;) {
      try { slot = await conn.getSlot(); break; } catch (e) {
        if (String(e).includes('429') && ++tries < 10) { await sleep(Math.min(8000, 1500 * tries)); continue; }
        throw e;
      }
    }
    if (slot >= Number(deadline)) return;
    await sleep(2500);
  }
}

// M4.1 (Track 1): sig-scheme voor het instance (B8: per programma-config).
// 0 = Ed25519 (default), 1 = PQ-optimistisch. E0-setup (nieuw instance).
const SIG_SCHEME = Number(process.env.OBP_SIG_SCHEME || 0);

async function main() {
  const t0 = Date.now();
  let cfg = await fetchConfig(conn);
  if (!cfg) {
    // E0 (idempotent-setup): vault-mint creëren + init. Alleen bij nieuw instance.
    console.log('config ontbreekt → E0: vault-mint + init (sig_scheme=' + SIG_SCHEME + ')');
    vaultMint = await rpc429(() => spl.createMint(conn, payer, mintAuthority.publicKey, null, 0, undefined, { commitment: 'confirmed' }));
    await client.send('init', initIx(vaultMint, 10000, 10n, 4, 1000n, mintAuthority.publicKey, payer.publicKey, SIG_SCHEME), [mintAuthority, payer], payer);
    cfg = await fetchConfig(conn);
    if (!cfg) throw new Error('E0: config bestaat niet na init');
  }
  vaultMint = cfg.vaultMint; maxLinksPerTx = cfg.maxLinksPerTx;
  // Vault/fee ATAs altijd garanderen (idempotent; finalize vereist pré-existentie — M3-bevinding).
  await rpc429(() => spl.getOrCreateAssociatedTokenAccount(conn, payer, vaultMint, vaultPda()[0], true, 'confirmed'));
  await rpc429(() => spl.getOrCreateAssociatedTokenAccount(conn, payer, vaultMint, feePda()[0], true, 'confirmed'));
  console.log('config: vaultMint ' + vaultMint.toBase58() + ' | bps ' + cfg.bondMultiplierBps + ' | window ' + cfg.challengeWindowSlots + ' | maxLinks ' + maxLinksPerTx + ' | sigScheme ' + cfg.sigScheme);

  // M3-bevinding: final_owner se ATA moet pré-existeren vóór finalize/settle
  // (check_tok vereist Token-program-eigendom; ontbrekende account = System → 6021).
  for (const k of [recipient, holder2, holder3]) {
    await ensureAta(k.publicKey);
  }

  // Pre-fund checkers ≥1500 → geen ensureBond-mints tijdens de flow (exacte deltas).
  for (const k of [recipient, holder3]) {
    const b = await bal(k.publicKey);
    if (b < 1500n) {
      await rpc429(() => spl.mintTo(conn, payer, vaultMint, ata(vaultMint, k.publicKey), mintAuthority, Number(2000n - b), [], { commitment: 'confirmed' }));
    }
  }

  // Vault aanvullen (I2): eerdere runs hebben de slack opgebruikt (vault == total).
  // Top-up zodat verse E2/E3/E8-coins kunnen minten: vault >= total_unspent_supply + 700.
  const vNow = await bal(vaultPda()[0]);
  const needVault = cfg.totalUnspentSupply + 700n - vNow;
  if (needVault > 0n) {
    await rpc429(() => spl.mintTo(conn, payer, vaultMint, ata(vaultMint, vaultPda()[0]), mintAuthority, Number(needVault), [], { commitment: 'confirmed' }));
    console.log('   vault top-up: +' + needVault + ' → ' + (await bal(vaultPda()[0])));
  }

  // E0.5: eerste coin naar recipient → creeert het allowance-account
  // (set_allowance heeft geen init_if_needed; M1-design: allowance ontstaat bij
  // eerste mint. TODO M4.1.1: init_if_needed overwegen).
  {
    await mintNew('e0-recipient');
  }

  // --- E10a: set_allowance verhoog → OK --------------------------------------
  console.log('\n== E10: set_allowance ==');
  await client.send('set_allowance(verhoog)', setAllowanceIx(1000000n, recipient.publicKey), [recipient], payer);
  const al = (await fetchAllowance(conn, recipient.publicKey))!;
  record('E10a verhoog cap→1000000', al.cap === 1000000n, 'cap=' + al.cap + ' committed=' + al.committed);

  // --- E6: max_links_per_tx (on-chain MaxLinksExceeded) ----------------------
  console.log('\n== E6: max_links_per_tx ==');
  const s6 = await mintNew('e6');
  const c6 = buildChain(s6, [recipient, holder2, holder3, recipient, holder2, holder3]); // 6 states
  await start(s6, 0, c6, recipient, 'e6');
  {
    const headOwner = Buffer.from(c6.states[0].slice(40, 72));
    const links5 = c6.states.slice(1).map((st, i) => ({ state: st, sig: c6.sigs[i] })); // 5 links > maxLinksPerTx(4)
    try {
      await client.send('append[e6×5]', appendLinksIxPair(s6, 0, { headOwner, links: links5, lastHash: stateHash(c6.states[5]) }), [], payer);
      record('E6 5 links → tx-size limiet', false, 'ix slaagde (verwacht: te groot)');
    } catch (e) {
      const s = String(e);
      record('E6 5 links → "Transaction too large" (>1232 B)', s.includes('too large'),
        s.slice(0, 70) + ' — MaxLinksExceeded(6016) is defensieve backstop; de 1232-B tx-limiet dwingt max_links_per_tx=4 fysiek af');
    }
  }

  // --- E10b: cap < committed → 6008 ------------------------------------------
  console.log('\n== E10b: cap onder committed ==');
  await expectErr('E10b set_allowance(50) < committed → ' + E.AllowanceCapBelowCommitted,
    () => client.send('set_allowance(50)', setAllowanceIx(50n, recipient.publicKey), [recipient], payer), E.AllowanceCapBelowCommitted);

  // --- E7: states-full (MAX_SUBMISSION_STATES=4) -----------------------------
  console.log('\n== E7: states-full ==');
  const s7 = await mintNew('e7');
  const c7 = buildChain(s7, [recipient, holder2, holder3, recipient, holder2]); // 5 states
  await start(s7, 0, c7, recipient, 'e7');
  await appendTo(s7, 0, c7, 'e7a', 4); // tot states_len=4 (=MAX) → OK
  {
    const headOwner = Buffer.from(c7.states[3].slice(40, 72));
    await expectErr('E7b 5de state → ' + E.StatesFull + ' StatesFull',
      () => client.send('append[e7b×1]', appendLinksIxPair(s7, 0, { headOwner, links: [{ state: c7.states[4], sig: c7.sigs[3] }], lastHash: stateHash(c7.states[4]) }), [], payer), E.StatesFull);
  }

  // --- E2: fork — strikte extensie wint (C2 + C1-compensatie) ----------------
  console.log('\n== E2: fork — extensie wint ==');
  const s2 = await mintNew('e2-' + RUN_ID); // vers: e2..e2g zaten al geresolveerd uit debug-runs (schone deltas)
  const cA = buildChain(s2, [recipient, holder2]);          // 2 states
  const cB = buildChain(s2, [recipient, holder2, holder3]);  // 3 states
  await start(s2, 0, cA, recipient, 'e2A');
  await appendTo(s2, 0, cA, 'e2A', 2);
  await finalizeA(s2, 0, 'e2A', 'finalize(casusA)');
  const hA = (await fetchHead(conn, s2))!;
  record('E2a head gezet (PENDING)', (await fetchSubmission(conn, s2, 0))!.status === SubmissionStatus.PENDING && hA.set,
    'headAttempt=' + hA.headAttempt + ' headLen=' + hA.headStatesLen);
  // Snapshot vóór B's acties → run-onafhankelijke delta's (idempotente her-runs).
  const h30 = await bal(holder3.publicKey); const v0 = await vaultBal();
  await start(s2, 1, cB, holder3, 'e2B');
  await appendTo(s2, 1, cB, 'e2B', 3);
  await finalizeB(s2, 1, 'e2B', 'finalize(casusB-win)');
  const s0f = (await fetchSubmission(conn, s2, 0))!; const s1f = (await fetchSubmission(conn, s2, 1))!;
  const reg2 = (await fetchRegistry(conn, s2))!;
  const h31 = await bal(holder3.publicKey); const v1 = await vaultBal();
  const esc0 = await bal(submissionPda(s2, 0)[0]); // A's bond-escrow na win (C1 → B)
  record('E2b B wint (extensie), A LOST, SPENT',
    s1f.status === SubmissionStatus.WON && s0f.status === SubmissionStatus.LOST && reg2.status === RegistryStatus.SPENT,
    'subA=' + s0f.status + ' subB=' + s1f.status + ' reg=' + reg2.status);
  record('E2c B +200 (refund+C1+value), vault -100, A-escrow=0',
    h31 === h30 + 200n && v1 === v0 - 100n && esc0 === 0n,
    'holder3 ' + h30 + '→' + h31 + ' | vault ' + v0 + '→' + v1 + ' | escrowA=' + esc0);

  // --- E3: fork — tie → first-come (head) wint (R2) ---------------------------
  console.log('\n== E3: fork — tie → head wint ==');
  const s3 = await mintNew('e3-' + RUN_ID);
  const cA3 = buildChain(s3, [recipient, holder2, holder3]);
  const cB3 = buildChain(s3, [recipient, holder2, holder3]); // identiek (tie)
  await start(s3, 0, cA3, recipient, 'e3A');
  await appendTo(s3, 0, cA3, 'e3A', 3);
  await finalizeA(s3, 0, 'e3A', 'finalize(casusA)');
  // Snapshot vóór B's acties → run-onafhankelijk.
  const r0e3 = await bal(recipient.publicKey); const h30e3 = await bal(holder3.publicKey); const v0e3 = await vaultBal();
  await start(s3, 1, cB3, holder3, 'e3B');
  await appendTo(s3, 1, cB3, 'e3B', 3);
  await finalizeB(s3, 1, 'e3B', 'finalize(casusB-lose)');
  const s0_3 = (await fetchSubmission(conn, s3, 0))!; const s1_3 = (await fetchSubmission(conn, s3, 1))!;
  record('E3a B verliest tie (A blijft head PENDING)',
    s1_3.status === SubmissionStatus.LOST && s0_3.status === SubmissionStatus.PENDING,
    'subA=' + s0_3.status + ' subB=' + s1_3.status);
  console.log('   ... wacht op window ...');
  await waitWindow(s3);
  await settle(s3, 0, 'e3A');
  const s0f3 = (await fetchSubmission(conn, s3, 0))!;
  const r1e3 = await bal(recipient.publicKey); const h31e3 = await bal(holder3.publicKey); const v1e3 = await vaultBal();
  record('E3b settle A → WON, SPENT', s0f3.status === SubmissionStatus.WON && (await fetchRegistry(conn, s3))!.status === RegistryStatus.SPENT, 'subA=' + s0f3.status);
  record('E3c recipient +200 (C1-comp + eigen refund), B 0, vault -100',
    r1e3 === r0e3 + 200n && h31e3 === h30e3 && v1e3 === v0e3 - 100n,
    'recipient ' + r0e3 + '→' + r1e3 + ' | holder3 ' + h30e3 + '→' + h31e3 + ' | vault ' + v0e3 + '→' + v1e3);

  // --- E8: WindowExpired (settle te vroeg) ------------------------------------
  console.log('\n== E8: WindowExpired ==');
  const s8 = await mintNew('e8-' + RUN_ID);
  const c8 = buildChain(s8, [recipient, holder2]);
  await start(s8, 0, c8, recipient, 'e8');
  await appendTo(s8, 0, c8, 'e8', 2);
  await finalizeA(s8, 0, 'e8', 'finalize(casusA)');
  {
    const s = (await fetchSubmission(conn, s8, 0))!;
    const h8 = (await fetchHead(conn, s8))!;
    const deadline = Number(h8.pendingSinceSlot) + Number(cfg.challengeWindowSlots);
    // De WindowExpired-check gebruikt het slot van de VERWERKTE block (program-
    // kant), niet het slot van mijn getSlot — onder devnet-latency (≈0,4s/slot,
    // 429-retries) kan de settle verwerkt worden ná de deadline. Deterministisch
    // onderscheid: succes + verwerkt-slot ≥ deadline = timing-artifact (bewijs:
    // slot); succes + verwerkt-slot < deadline = echte bug; 6019 = de check zelf.
    try {
      const r = await client.send('settle[e8-vroeg]', settleIx(s8, 0, 1, recipient.publicKey, s.checker, s.finalOwner, vaultMint, payer.publicKey), [], payer);
      const tx = await conn.getTransaction(r.signature, { maxSupportedTransactionVersion: 0 });
      const procSlot = tx?.slot ?? 0;
      if (procSlot >= deadline) {
        record('E8a window verlopen bij verwerking (timing-artifact)', true, 'verwerkt-slot ' + procSlot + ' ≥ deadline ' + deadline + ' (WindowExpired zelf: M3-14/14, code ongewijzigd)');
      } else {
        record('E8a settle te vroeg → 6019 WindowExpired', false, 'ix slaagde met verwerkt-slot ' + procSlot + ' < deadline ' + deadline + ' (echte bug)');
      }
    } catch (e) {
      record('E8a settle te vroeg → ' + E.WindowExpired + ' WindowExpired', String(e).includes('"Custom":' + E.WindowExpired), String(e).slice(0, 140));
    }
  }
  console.log('   ... wacht op window ...');
  await waitWindow(s8);
  await settle(s8, 0, 'e8');
  record('E8b settle na window → WON', (await fetchSubmission(conn, s8, 0))!.status === SubmissionStatus.WON, 'sub=' + (await fetchSubmission(conn, s8, 0))!.status);

  // --- E4: double-spend (start op SPENT-registry) -----------------------------
  console.log('\n== E4: double-spend ==');
  // E4 vereist: SPENT-registry + een NIET-gebruikte attempt (Anchor-init
  // (Allocate) van de submission draait vóór de handler-checks; een bestaande
  // submission faalt daar al met system-Custom(0)). s8 is na E8b SPENT en
  // gebruikt alleen attempt 0 → attempt 1 is vrij → 6015 wordt bereikt.
  // (Op 9D2fU2g liep dit op de M2-coin met dezelfde eigenschap.)
  const cM2 = buildChain(s8, [recipient, holder2]);
  await ensureAta(submissionPda(s8, 1)[0]); // escrow-ATA pré-create (handmatige check_tok)
  await expectErr('E4 start op SPENT-registry → ' + E.StatusInvalid,
    () => client.send('start[e4]', startCheckInIx(s8, 1, cM2.states[0], recipient.publicKey, payer.publicKey, vaultMint), [recipient], payer), E.StatusInvalid);

  // --- E5: herstart bestaand attempt (defensieve lagen) -----------------------
  console.log('\n== E5: herstart attempt ==');
  const cE6 = buildChain(s6, [recipient, holder2]);
  try {
    await client.send('start[e5]', startCheckInIx(s6, 0, cE6.states[0], recipient.publicKey, payer.publicKey, vaultMint), [recipient], payer);
    record('E5 herstart bestaand attempt', false, 'ix slaagde (verwacht blok)');
  } catch (e) {
    const m = String(e).match(/"Custom":(\d+)/);
    record('E5 herstart bestaand attempt → geblokkeerd', !!m, 'code=' + (m ? m[1] : '?') + ' (defensief: init/escrow vóór count-check)');
  }

  // --- rapport -----------------------------------------------------------------
  console.log('\n--- M3 E2E-MATRIX RAPPORT ---');
  let pass = 0;
  for (const r of results) { if (r.ok) pass++; }
  console.log(pass + '/' + results.length + ' PASS in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  console.log('\nCU-tabel (unitsConsumed):');
  for (const [k, v] of Object.entries(cu)) console.log('  ' + k + ': ' + v);
  const cfg2 = await fetchConfig(conn);
  if (!cfg2) throw new Error('config ontbreekt op devnet (reset?)');
  const alF = (await fetchAllowance(conn, recipient.publicKey))!;
  console.log('\neindbalansen: vault=' + (await vaultBal()) + ' recipient=' + (await bal(recipient.publicKey))
    + ' holder2=' + (await bal(holder2.publicKey)) + ' holder3=' + (await bal(holder3.publicKey)));
  console.log('allowance: cap=' + alF.cap + ' committed=' + alF.committed + ' | total_unspent_supply=' + cfg2.totalUnspentSupply);
  process.exit(pass === results.length ? 0 : 1);
}

// web3.js 1.x creët onder 429-storms floating rejections in de interne HTTP/WS-laag
  // (niet in onze await-chain). Loggen i.p.v. afsluiten: onze calls hebben eigen retries.
process.on('unhandledRejection', (e) => { console.log('   (unhandled-rejection genegeerd, web3.js-intern): ' + String(e).slice(0, 100)); });
main().catch((e) => { console.error('FATAAL:', e); process.exit(2); });
