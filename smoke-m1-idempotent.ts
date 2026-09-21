// OBP M1 idempotente smoke test — controleert state per stap, sluit alleen
// over wat nog ontbreekt. Werkt door na een crash of rate-limit break.
// LEGACY M1-artefact: voor de actuele E2E zie sdk/scripts/e2e-matrix.ts.
import * as fs from 'fs';
import * as web3 from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';

const PROGRAM_ID = new web3.PublicKey(process.env.OBP_PROGRAM_ID || '8M5ruFEhFfenHSkjsUcf2FaZFKKKamJEHWRCSfttNHi6');
const connection = new web3.Connection('https://api.devnet.solana.com', 'confirmed');
const SYS = web3.SystemProgram.programId;
const TOKEN_PROGRAM_ID = spl.TOKEN_PROGRAM_ID;

const SERIAL = Buffer.from(sha256(Buffer.from('obp-m1-smoke-coin-001')));
const VALUE = 100;
const BPS = 10_000;
const WINDOW_SLOTS = 10;
const MAX_LINKS = 4;
const DEFAULT_ALLOWANCE = 1000;
const BOND = (VALUE * BPS) / 10_000;

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
  return web3.PublicKey.findProgramAddressSync([Buffer.from(prefix, 'utf8'), ...extra], PROGRAM_ID);
}

const w = (k: web3.PublicKey, isW: boolean) => ({ pubkey: k, isWritable: isW, isSigner: false });
const s = (k: web3.PublicKey, isW = false) => ({ pubkey: k, isWritable: isW, isSigner: true });

// Vaste recipient/holder keypairs (deterministisch)
const SEED = Buffer.from('obp-smoke-deterministic-seed-2025');
function deriveKey(suff: string): web3.Keypair {
  return web3.Keypair.fromSeed(sha256(Buffer.concat([SEED, Buffer.from(suff, 'utf8')])));
}
const recipient = deriveKey('recipient');
const holder2 = deriveKey('holder2');
const holder3 = deriveKey('holder3');
const mintAuthority = deriveKey('mint-authority');

const payer = web3.Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME + '/.config/solana/id.json', 'utf8'))),
);

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
async function send(label: string, ix: web3.TransactionInstruction | web3.TransactionInstruction[], signers: web3.Keypair[] = []) {
  stepNo++;
  let attempts = 0;
  while (true) {
    try {
      const tx = new web3.Transaction();
      const bh = await connection.getLatestBlockhash();
      tx.recentBlockhash = bh.blockhash;
      tx.feePayer = payer.publicKey;
      // GEEN expliciete CU-budget: op deze solana-core 4.3.0-rc.0 devnet faalt
      // ELK setComputeUnitLimit (gemeten: limit=200..1.4M, price=0..1e12 →
      // InstructionError[0, ComputationalBudgetExceeded]). Default 200k volstaat
      // na de precompile-fix (ed25519 = 2400 CU/verify i.p.v. ~90k+ dalek).
      const list = Array.isArray(ix) ? ix : [ix];
      for (const i of list) tx.add(i);
      tx.sign(payer, ...signers);
      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
      await connection.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
      console.log(`  [${stepNo}] ${label}: OK ${sig.slice(0, 16)}`);
      return sig;
    } catch (e) {
      attempts++;
      if (attempts >= 5 || !String(e).includes('429')) throw e;
      console.log(`    (${label}: 429, retry ${attempts}...)`);
      await new Promise(r => setTimeout(r, 2000 * attempts));
    }
  }
}

async function bal(mint: web3.PublicKey, owner: web3.PublicKey): Promise<number> {
  const ata = spl.getAssociatedTokenAddressSync(mint, owner, true);
  const acc = await spl.getAccount(connection, ata).catch(() => null);
  return acc ? Number(acc.amount) : 0;
}
async function readAcc(p: web3.PublicKey): Promise<Buffer | null> {
  const a = await connection.getAccountInfo(p);
  return a ? a.data : null;
}

async function main() {
  console.log('OBP M1 idempotente smoke — devnet');
  console.log('program:', PROGRAM_ID.toBase58());
  console.log('recipient:', recipient.publicKey.toBase58());

  const [cfgPda] = pda('config');
  const [vaultPda] = pda('vault');
  const [feePda] = pda('fee');
  const [registryPda] = pda('mint', SERIAL);
  const [subAPda] = pda('submission', SERIAL, u8b(0));
  const [headPda] = pda('head', SERIAL);
  const [allowancePda] = pda('allowance', pk(recipient.publicKey));

  // E0: mint + ATAs (altijd nodig)
  // vaste keypair => deterministisch mint-adres; idempotent (bestaanscheck)
  const mintPk = deriveKey('mint').publicKey;
  let mint: web3.PublicKey;
  if (!(await connection.getAccountInfo(mintPk))) {
    mint = await spl.createMint(connection, payer, mintAuthority.publicKey, null, 0, deriveKey('mint'));
    console.log('mint created');
  } else {
    mint = mintPk;
  }
  console.log('  mint:', mint.toBase58());

  const vaultATA = spl.getAssociatedTokenAddressSync(mint, vaultPda, true);
  const feeSinkATA = spl.getAssociatedTokenAddressSync(mint, feePda, true);
  const recipientATA = spl.getAssociatedTokenAddressSync(mint, recipient.publicKey, true);
  const holder3ATA = spl.getAssociatedTokenAddressSync(mint, holder3.publicKey, true);
  const escrowATA = spl.getAssociatedTokenAddressSync(mint, subAPda, true);
  const mintAuthATA = spl.getAssociatedTokenAddressSync(mint, mintAuthority.publicKey, true);

  // Alle ATAs (idempotent): bestaanscheck, anders creatie — zonder deze faalt
  // elke token-CPI in het program (InvalidAccountData).
  async function ensureATA(owner: web3.PublicKey) {
    const ata = spl.getAssociatedTokenAddressSync(mint, owner, true);
    const info = await connection.getAccountInfo(ata);
    const ok = info && info.owner.equals(spl.TOKEN_PROGRAM_ID);
    if (!ok) {
      await spl.createAssociatedTokenAccount(connection, payer, mint, owner, undefined, undefined, undefined, true);
      console.log('  ATA aangemaakt:', owner.toBase58().slice(0, 8));
    }
  }
  for (const owner of [mintAuthority.publicKey, vaultPda, feePda, recipient.publicKey, holder3.publicKey, subAPda]) {
    await ensureATA(owner);
  }
  console.log('  ATAs in orde (6)');

  // E1: init (als config ontbreekt)
  let cfgData = await readAcc(cfgPda);
  if (!cfgData) {
    console.log('\n== E1: init ==');
    const initArgs = Buffer.concat([pk(mint), u32le(BPS), u64le(WINDOW_SLOTS), u16le(MAX_LINKS), u64le(DEFAULT_ALLOWANCE)]);
    await send('init', new web3.TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [w(cfgPda, true), w(vaultPda, true), w(feePda, true), s(mintAuthority.publicKey), s(payer.publicKey, true), w(SYS, false)],
      data: ixData('init', initArgs),
    }), [mintAuthority]);
    cfgData = await readAcc(cfgPda);
    console.log('  config created');
  } else {
    console.log('\n== E1: init (overgeslagen, bestaat) ==');
  }

  // E2: ping
  console.log('\n== E2: ping ==');
  try {
    await send('ping', new web3.TransactionInstruction({
      programId: PROGRAM_ID, keys: [w(cfgPda, false)], data: ixData('ping', Buffer.alloc(0)),
    }));
  } catch (e) {
    console.log('  ping failed (ok):', String(e).slice(0, 60));
  }

  // E3: fund_vault (als vault niet gefinancierd)
  console.log('\n== E3: fund_vault ==');
  const vaultBal = await bal(mint, vaultPda);
  if (vaultBal < 1000) {
    console.log(`  vault has ${vaultBal}, funding to 1000`);
    await spl.mintTo(connection, payer, mint, mintAuthATA, mintAuthority, 1000 - vaultBal);
    await send('fund_vault', new web3.TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [s(mintAuthority.publicKey, true), w(cfgPda, false), w(mintAuthATA, true), w(vaultATA, true), w(vaultPda, false), w(TOKEN_PROGRAM_ID, false)],
      data: ixData('fund_vault', u64le(1000 - vaultBal)),
    }), [mintAuthority]);
    console.log(`  vault now: ${await bal(mint, vaultPda)}`);
  } else {
    console.log(`  vault already funded: ${vaultBal}`);
  }

  // E4: mint_coin (als registry ontbreekt)
  console.log('\n== E4: mint_coin ==');
  let regData = await readAcc(registryPda);
  if (!regData) {
    const state0 = makeState(recipient.publicKey, Buffer.alloc(32));
    const genesisHash = H(state0);
    const mintTx = Buffer.concat([H(Buffer.concat([SERIAL, u64le(VALUE), pk(recipient.publicKey)])), H(Buffer.concat([u64le(VALUE), pk(recipient.publicKey), SERIAL]))]);
    await send('mint_coin', new web3.TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [s(mintAuthority.publicKey, true), w(cfgPda, true), w(registryPda, true), w(vaultATA, false), w(vaultPda, false), w(allowancePda, true), s(payer.publicKey, true), w(SYS, false), w(TOKEN_PROGRAM_ID, false)],
      data: ixData('mint_coin', Buffer.concat([SERIAL, u64le(VALUE), pk(recipient.publicKey), genesisHash, mintTx])),
    }), [mintAuthority]);
    regData = await readAcc(registryPda);
    console.log('  registry created, status:', regData?.readUInt8(184));
  } else {
    console.log('  registry exists, status:', regData.readUInt8(184));
  }

  // E5: start_check_in (als submission ontbreekt)
  console.log('\n== E5: start_check_in ==');
  let subData = await readAcc(subAPda);
  if (!subData) {
    const recipBal = await bal(mint, recipient.publicKey);
    if (recipBal < BOND + 50) {
      console.log(`  minting to recipient (has ${recipBal}, need ${BOND + 50})`);
      await spl.mintTo(connection, payer, mint, recipientATA, mintAuthority, 500);
    }
    const state0 = makeState(recipient.publicKey, Buffer.alloc(32));
    await send('start_check_in', new web3.TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [w(cfgPda, false), w(registryPda, true), w(subAPda, true), s(recipient.publicKey), w(recipientATA, true), w(escrowATA, true), w(TOKEN_PROGRAM_ID, false), s(payer.publicKey, true), w(SYS, false)],
      data: ixData('start_check_in', Buffer.concat([SERIAL, u8b(0), state0])),
    }), [recipient]);
    subData = await readAcc(subAPda);
    console.log('  submission created, escrow:', await bal(mint, subAPda));
  } else {
    console.log('  submission exists, status:', subData.readUInt8(123));
  }

  // E6: append_links + ed25519-precompile (als states_len < 3)
  // M1.x: signatuurverificatie verplaatst van dalek-in-program naar de
  // ed25519-precompile (top-level ix, offsets naar de append-ix-data).
  console.log('\n== E6: append_links (+ precompile) ==');
  const statesLen = subData!.readUInt16LE(124);
  if (statesLen < 3) {
    console.log(`  states_len=${statesLen}, appending`);
    const state0 = makeState(recipient.publicKey, Buffer.alloc(32));
    const state1 = makeState(holder2.publicKey, H(state0));
    const state2 = makeState(holder3.publicKey, H(state1));
    const sig1 = edSign(recipient, H(state1)); // owner(state0) tekent H(state1)
    const sig2 = edSign(holder2, H(state2));   // owner(state1) tekent H(state2)
    const linksBuf = Buffer.concat([u32le(2), state1, sig1, state2, sig2]);
    // head_owner = eigenaar van states[statesLen-1] (hier statesLen==1: state0)
    const headOwner = statesLen === 1 ? pk(recipient.publicKey) : pk(holder2.publicKey);
    const appendIx = new web3.TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [w(cfgPda, false), w(registryPda, false), w(subAPda, true)],
      // layout: @0 disc(8) @8 serial(32) @40 head_owner(32) @72 u32len(4)
      //         @76 links(168B elk) @76+336 last_hash(32)
      data: ixData('append_links', Buffer.concat([SERIAL, headOwner, linksBuf, H(state2)])),
    });
    const OFF = { headOwner: 40, link0: 76, link1: 76 + 168, lastHash: 76 + 336 };
    // Ed25519SignatureOffsets (repr(C), 14B, alle u16 LE):
    // sig_off, sig_ix, pub_off, pub_ix, msg_off, msg_size, msg_ix
    const off = (sigOff: number, pubOff: number, msgOff: number) =>
      Buffer.concat([u16le(sigOff), u16le(1), u16le(pubOff), u16le(1), u16le(msgOff), u16le(32), u16le(1)]);
    const preData = Buffer.concat([
      u16le(2),
      off(OFF.link0 + 104, OFF.headOwner, OFF.link1 + 72), // sig1: owner(state0) op H(state1)=link1.prev_hash
      off(OFF.link1 + 104, OFF.link0 + 40, OFF.lastHash),  // sig2: owner(state1) op H(state2)=last_hash
    ]);
    const edIx = new web3.TransactionInstruction({
      programId: new web3.PublicKey('Ed25519SigVerify111111111111111111111111111'),
      keys: [],
      data: preData,
    });
    await send('append_links', [edIx, appendIx]);
    console.log('  links appended');
  } else {
    console.log(`  states_len=${statesLen}, already done`);
  }

  // E7: finalize
  console.log('\n== E7: finalize_check_in ==');
  subData = await readAcc(subAPda);
  if (subData!.readUInt8(123) !== 2) { // not PENDING
    console.log('  finalizing');
    await send('finalize', new web3.TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [w(cfgPda, true), w(registryPda, true), w(headPda, true), w(subAPda, true), w(escrowATA, true), w(recipientATA, true), w(holder3ATA, true), w(vaultATA, true), w(vaultPda, false), w(feeSinkATA, true), w(feePda, false), w(TOKEN_PROGRAM_ID, false), s(payer.publicKey, true), w(SYS, false), w(PROGRAM_ID, false), w(PROGRAM_ID, false), w(PROGRAM_ID, false), w(PROGRAM_ID, false)],
      data: ixData('finalize_check_in', Buffer.concat([SERIAL, u8b(1), pk(recipient.publicKey)])),
    }));
    console.log('  finalized');
  } else {
    console.log('  already finalized (PENDING)');
  }

  // E8: settle (wacht op window)
  console.log('\n== E8: settle ==');
  subData = await readAcc(subAPda);
  if (subData!.readUInt8(123) === 2) { // PENDING -> can settle
    console.log('  waiting 25s for window...');
    await new Promise(r => setTimeout(r, 25000));
    await send('settle', new web3.TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [w(cfgPda, true), w(registryPda, true), w(headPda, false), w(subAPda, true), w(escrowATA, true), w(recipientATA, true), w(holder3ATA, true), w(vaultATA, true), w(vaultPda, false), w(feeSinkATA, true), w(feePda, false), w(TOKEN_PROGRAM_ID, false), s(payer.publicKey, false), w(SYS, false), w(PROGRAM_ID, false), w(PROGRAM_ID, false), w(allowancePda, true)],
      data: ixData('settle', Buffer.concat([SERIAL, u8b(1), pk(recipient.publicKey)])),
    }));
    console.log('  settled');
  } else {
    console.log('  already settled or not final');
  }

  // Finale state
  console.log('\n=== FINAL STATE ===');
  regData = await readAcc(registryPda);
  subData = await readAcc(subAPda);
  console.log('  holder3ATA (value):', await bal(mint, holder3.publicKey), '(expect ~100)');
  console.log('  recipientATA (bond):', await bal(mint, recipient.publicKey), '(expect ~500)');
  console.log('  vault:', await bal(mint, vaultPda), '(expect ~900)');
  console.log('  registry status:', regData?.readUInt8(184), '(expect 1=SPENT)');
  console.log('  sub status:', subData?.readUInt8(123), '(expect 5=WON)');
  console.log('=== M1 SMOKE COMPLETED ===');
}

main().then(() => process.exit(0)).catch(e => { console.error('FAIL:', e.message ?? e); process.exit(1); });