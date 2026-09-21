/**
 * OBP M1 smoke test — devnet, volledige protocol-lus (SPEC.md §5).
 *
 * Handmatige transacties (geen Anchor SDK): volledige controle over account
 * lists (exacte struct-volgorde), borsh-data en PDAs. Meet: balances na elke
 * stap + account-state + CU-gebruik.
 *
 * Scenarium (happy path):
 *   create mint+ATAs -> init -> fund_vault(1000) -> mint_coin(value=100)
 *   -> start_check_in (recipient=checker, bond=100) -> append_links (2 links;
 *   houder2, houder3) -> finalize (casus A: PENDING, window start)
 *   -> settle (na window): value 100 -> houder3, bond 100 -> recipient.
 */
import * as fs from 'fs';
import * as web3 from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';

// Audit-fix (2026-09-21): programma-ID parameteriseerbaar; default = canoniek (SBPF v3, M4+PQ).
const PROGRAM_ID = new web3.PublicKey(process.env.OBP_PROGRAM_ID || '8M5ruFEhFfenHSkjsUcf2FaZFKKKamJEHWRCSfttNHi6');
const TOKEN_PROGRAM_ID = spl.TOKEN_PROGRAM_ID;
const SYS = web3.SystemProgram.programId;
const connection = new web3.Connection('https://api.devnet.solana.com', 'confirmed');

const SERIAL = Buffer.from(sha256(Buffer.from('obp-m1-smoke-coin-001')));
const VALUE = 100;
const BPS = 10_000; // bond = 100%
const WINDOW_SLOTS = 10;
const MAX_LINKS = 4;
const DEFAULT_ALLOWANCE = 1000;
const BOND = (VALUE * BPS) / 10_000; // 100

// ---------- borsh / helpers ----------
function ixData(name: string, args: Buffer): Buffer {
  const disc = sha256(Buffer.from('global:' + name, 'utf8')).subarray(0, 8);
  return Buffer.concat([Buffer.from(disc), args]);
}
const u8b = (v: number) => Buffer.from([v]);
const u16le = (v: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u32le = (v: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const u64le = (v: number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const pk = (p: web3.PublicKey) => Buffer.from(p.toBytes());

function pda(prefix: string, ...extra: Buffer[]): [web3.PublicKey, number] {
  const seeds: Buffer[] = [Buffer.from(prefix, 'utf8'), ...extra];
  return web3.PublicKey.findProgramAddressSync(seeds, PROGRAM_ID);
}

const w = (k: web3.PublicKey, isW: boolean) => ({ pubkey: k, isWritable: isW, isSigner: false });
const s = (k: web3.PublicKey, isW = false) => ({ pubkey: k, isWritable: isW, isSigner: true });

// ---------- identity ----------
const payer = web3.Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME + '/.config/solana/id.json', 'utf8'))),
);
const mintAuthority = web3.Keypair.generate();
const recipient = web3.Keypair.generate(); // bearer: owner state_0 + eerste checker
const holder2 = web3.Keypair.generate();   // offline overdracht 1
const holder3 = web3.Keypair.generate();   // offline overdracht 2 = final_owner

// State (SPEC §3.2): serial(32) ‖ value(8 LE) ‖ owner(32) ‖ prevH(32) = 104B
function makeState(owner: web3.PublicKey, prevH: Buffer): Buffer {
  const st = Buffer.alloc(104);
  st.set(SERIAL, 0);
  st.writeBigUInt64LE(BigInt(VALUE), 32);
  st.set(pk(owner), 40);
  st.set(prevH, 72);
  return st;
}
const H = (b: Buffer | Uint8Array) => Buffer.from(sha256(b as Uint8Array));
function edSign(key: web3.Keypair, msg: Buffer): Buffer {
  return Buffer.from(ed25519.sign(msg, key.secretKey.subarray(0, 32)));
}

let stepNo = 0;
async function send(
  label: string,
  ix: web3.TransactionInstruction,
  signers: web3.Keypair[] = [],
): Promise<string> {
  stepNo++;
  const tx = new web3.Transaction();
  const bh = await connection.getLatestBlockhash();
  tx.recentBlockhash = bh.blockhash;
  tx.feePayer = payer.publicKey;
  tx.add(ix);
  tx.sign(payer, ...signers);
  let cu: number | undefined;
  try {
    const sim = await connection.simulateTransaction(tx as unknown as web3.VersionedTransaction);
    cu = sim.value.unitsConsumed;
  } catch { /* optioneel */ }
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await connection.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
  console.log(`  [${stepNo}] ${label}: OK (CU=${cu ?? '?'}) ${sig}`);
  return sig;
}

async function bal(mint: web3.PublicKey, owner: web3.PublicKey): Promise<number> {
  const ata = spl.getAssociatedTokenAddressSync(mint, owner, true);
  const acc = await spl.getAccount(connection, ata).catch(() => null);
  return acc ? Number(acc.amount) : 0;
}
async function readAcc(pubkey: web3.PublicKey): Promise<Buffer | null> {
  const a = await connection.getAccountInfo(pubkey);
  return a ? a.data : null;
}
async function ensureATA(mint: web3.PublicKey, owner: web3.PublicKey) {
  try {
    await spl.createAssociatedTokenAccount(connection, payer, mint, owner, undefined, undefined, undefined, true);
  } catch (e) {
    if (!String(e).includes('already in use')) throw e;
  }
}

async function main() {
  console.log('OBP M1 smoke — devnet');
  console.log('program:', PROGRAM_ID.toBase58());
  console.log('payer:  ', payer.publicKey.toBase58());

  const bal0 = await connection.getBalance(payer.publicKey);
  console.log('payer SOL:', bal0 / 1e9);
  if (bal0 < 0.5e9) {
    const a = await connection.requestAirdrop(payer.publicKey, 1e9);
    await connection.confirmTransaction(a, 'confirmed');
    console.log('airdrop 1 SOL:', a);
  }

  // PDAs
  const [cfgPda] = pda('config');
  const [vaultPda, vaultBump] = pda('vault');
  const [feePda] = pda('fee');
  const [registryPda] = pda('mint', SERIAL);
  const [subAPda] = pda('submission', SERIAL, u8b(0)); // attempt 0
  const [headPda] = pda('head', SERIAL);
  const [allowancePda] = pda('allowance', pk(recipient.publicKey));

  // SPL mint + alle benodigde ATAs
  const mint = await spl.createMint(connection, payer, mintAuthority.publicKey, null, 0);
  console.log('mint:', mint.toBase58());
  const mintAuthATA = spl.getAssociatedTokenAddressSync(mint, mintAuthority.publicKey, true);
  const vaultATA = spl.getAssociatedTokenAddressSync(mint, vaultPda, true);
  const feeSinkATA = spl.getAssociatedTokenAddressSync(mint, feePda, true);
  const recipientATA = spl.getAssociatedTokenAddressSync(mint, recipient.publicKey, true);
  const holder3ATA = spl.getAssociatedTokenAddressSync(mint, holder3.publicKey, true);
  const escrowATA = spl.getAssociatedTokenAddressSync(mint, subAPda, true);
  for (const owner of [mintAuthority.publicKey, vaultPda, feePda, recipient.publicKey, holder3.publicKey, subAPda]) {
    await ensureATA(mint, owner);
  }
  console.log('ATAs gecompleteerd (mintAuth, vault, feeSink, recipient, holder3, escrow)');

  // --- E1: init (idempotent: config is singleton op devnet; sla over als al geinit)
  console.log('\n== E2: init ==');
  const initArgs = Buffer.concat([
    pk(mint),                  // vault_mint
    u32le(BPS),                // bond_multiplier_bps
    u64le(WINDOW_SLOTS),       // challenge_window_slots
    u16le(MAX_LINKS),          // max_links_per_tx (u16)
    u64le(DEFAULT_ALLOWANCE),  // default_allowance
  ]);
  const cfgBefore = await connection.getAccountInfo(cfgPda);
  if (cfgBefore && cfgBefore.data.length > 0) {
    console.log('  config bestaat al — init overgeslagen (idempotent)');
  } else {
    await send('init', new web3.TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        w(cfgPda, true), w(vaultPda, true), w(feePda, true),
        s(mintAuthority.publicKey), s(payer.publicKey, true), w(SYS, false),
      ],
      data: ixData('init', initArgs),
    }), [mintAuthority]);
  }
  const cfg0 = await readAcc(cfgPda);
  console.log('  config: mint_authority=', new web3.PublicKey(cfg0!.subarray(8, 40)).toBase58().slice(0, 8),
    ' supply=', cfg0?.readBigUInt64LE(94), ' cap=', cfg0?.readBigUInt64LE(86));


  // --- E2: ping (na init: config bestaat)
  console.log('\n== E1: ping ==');
  await send('ping', new web3.TransactionInstruction({
    programId: PROGRAM_ID, keys: [w(cfgPda, false)], data: ixData('ping', Buffer.alloc(0)),
  }));


  // --- E3: reserve munt + fund_vault
  console.log('\n== E3: fund_vault ==');
  await spl.mintTo(connection, payer, mint, mintAuthATA, mintAuthority, 1000);
  await send('fund_vault(1000)', new web3.TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      s(mintAuthority.publicKey, true),  // mint_authority (Signer mut)
      w(cfgPda, false),                 // config
      w(mintAuthATA, true),              // source (mut)
      w(vaultATA, true),                 // vault (mut)
      w(vaultPda, false),               // vault_pda
      w(TOKEN_PROGRAM_ID, false),        // token_program
    ],
    data: ixData('fund_vault', u64le(1000)),
  }), [mintAuthority]);
  console.log('  vault:', await bal(mint, vaultPda), '(verwacht 1000)');

  // --- E4: mint_coin
  console.log('\n== E4: mint_coin ==');
  const state0 = makeState(recipient.publicKey, Buffer.alloc(32));
  const genesisHash = H(state0);
  const mintTx = Buffer.concat([H(Buffer.concat([SERIAL, u64le(VALUE), pk(recipient.publicKey)])),
                                H(Buffer.concat([u64le(VALUE), pk(recipient.publicKey), SERIAL]))]);
  await send('mint_coin(value=100)', new web3.TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      s(mintAuthority.publicKey, true),  // mint_authority
      w(cfgPda, true),                  // config
      w(registryPda, true),             // registry (init)
      w(vaultATA, false),                // vault (read)
      w(vaultPda, false),               // vault_pda
      w(allowancePda, true),            // recipient_allowance (init_if_needed)
      s(payer.publicKey, true),          // payer
      w(SYS, false), w(TOKEN_PROGRAM_ID, false),
    ],
    data: ixData('mint_coin', Buffer.concat([
      SERIAL, u64le(VALUE), pk(recipient.publicKey), genesisHash, mintTx,
    ])),
  }), [mintAuthority]);
  let rd = await readAcc(registryPda);
  console.log('  registry status:', rd?.readUInt8(184), '(0=ACTIVE) supply:',
    (await readAcc(cfgPda))?.readBigUInt64LE(94), '(100) committed:',
    (await readAcc(allowancePda))?.readBigUInt64LE(16), '(100)');

  // --- E5: start_check_in (attempt 0; bond=100 van recipient)
  console.log('\n== E5: start_check_in ==');
  await spl.mintTo(connection, payer, mint, recipientATA, mintAuthority, 500);
  await send('start_check_in(attempt=0, bond=100)', new web3.TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      w(cfgPda, false), w(registryPda, true), w(subAPda, true),
      s(recipient.publicKey), w(recipientATA, true), w(escrowATA, true),
      w(TOKEN_PROGRAM_ID, false), s(payer.publicKey, true), w(SYS, false),
    ],
    data: ixData('start_check_in', Buffer.concat([SERIAL, u8b(0), state0])),
  }), [recipient]);
  let sd = await readAcc(subAPda);
  console.log('  escrow:', await bal(mint, subAPda), '(100) recipientATA:',
    await bal(mint, recipient.publicKey), '(400) sub.status:', sd?.readUInt8(123),
    '(0=RECEIVING) states_len:', sd?.readUInt16LE(124), '(1)');

  // --- E6: append_links (2 links; final_owner = holder3)
  console.log('\n== E6: append_links ==');
  const state1 = makeState(holder2.publicKey, H(state0));
  const state2 = makeState(holder3.publicKey, H(state1));
  const linksBuf = Buffer.concat([
    u32le(2), state1, edSign(recipient, H(state1)), state2, edSign(holder2, H(state2)),
  ]);
  await send('append_links(2)', new web3.TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [w(cfgPda, false), w(registryPda, false), w(subAPda, true)],
    data: ixData('append_links', Buffer.concat([SERIAL, linksBuf])),
  }));
  sd = await readAcc(subAPda);
  console.log('  states_len:', sd?.readUInt16LE(124), '(3) final_owner=',
    new web3.PublicKey(sd!.subarray(73, 105)).toBase58().slice(0, 8),
    '(= holder3) status:', sd?.readUInt8(123), '(0=RECEIVING)');

  // --- E7: finalize (casus A: eerst de head -> PENDING, window start)
  console.log('\n== E7: finalize_check_in (casus A) ==');
  await send('finalize_check_in', new web3.TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      w(cfgPda, true), w(registryPda, true), w(headPda, true), w(subAPda, true),
      w(escrowATA, true), w(recipientATA, true), w(holder3ATA, true), w(vaultATA, true),
      w(vaultPda, false), w(feeSinkATA, true), w(feePda, false),
      w(TOKEN_PROGRAM_ID, false), s(payer.publicKey, true), w(SYS, false),
      // remaining_accounts: [other_submission, other_escrow, other_checker_token, recipient_allowance] (alle None)
      w(PROGRAM_ID, false), w(PROGRAM_ID, false), w(PROGRAM_ID, false), w(PROGRAM_ID, false),
    ],
    data: ixData('finalize_check_in', Buffer.concat([SERIAL, u8b(1), pk(recipient.publicKey)])),
  }));
  sd = await readAcc(subAPda);
  const hd = await readAcc(headPda);
  console.log('  sub.status:', sd?.readUInt8(123), '(2=PENDING) head.set:', hd?.readUInt8(8),
    '(1) head_states_len:', hd?.readUInt16LE(114), '(3)');

  // --- E8: settle (na de window)
  console.log('\n== E8: settle (na window) ==');
  console.log('  wacht 25s voor de window (10 slots)...');
  await new Promise((r) => setTimeout(r, 25_000));
  await send('settle', new web3.TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      w(cfgPda, true), w(registryPda, true), w(headPda, false), w(subAPda, true),
      w(escrowATA, true), w(recipientATA, true), w(holder3ATA, true), w(vaultATA, true),
      w(vaultPda, false), w(feeSinkATA, true), w(feePda, false),
      w(TOKEN_PROGRAM_ID, false), s(payer.publicKey, false), w(SYS, false),
      // remaining_accounts: [other_submission, other_escrow, recipient_allowance]
      w(PROGRAM_ID, false), w(PROGRAM_ID, false), w(allowancePda, true),
    ],
    data: ixData('settle', Buffer.concat([SERIAL, u8b(1), pk(recipient.publicKey)])),
  }));
  rd = await readAcc(registryPda);
  sd = await readAcc(subAPda);
  console.log('  holder3ATA (value):', await bal(mint, holder3.publicKey), '(verwacht 100)');
  console.log('  recipientATA (bond-refund):', await bal(mint, recipient.publicKey), '(verwacht 500)');
  console.log('  vault:', await bal(mint, vaultPda), '(verwacht 900)');
  console.log('  registry status:', rd?.readUInt8(184), '(1=SPENT) supply:',
    (await readAcc(cfgPda))?.readBigUInt64LE(94), '(verwacht 0)');
  console.log('  allowance.committed:', (await readAcc(allowancePda))?.readBigUInt64LE(16), '(verwacht 0)');
  console.log('  sub.status:', sd?.readUInt8(123), '(5=WON)');

  console.log('\n=== M1 SMOKE: HAPPY PATH AFGEROND ===');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('SMOKE FAIL:', e.message ?? e);
  console.error(e);
  process.exit(1);
});
