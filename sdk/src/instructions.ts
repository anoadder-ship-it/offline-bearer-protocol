import { sha256 } from '@noble/hashes/sha256';
import * as spl from '@solana/spl-token';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { PROGRAM_ID } from './constants';
import {
  allowancePda, ata, configPda, feePda, headPda, registryPda, submissionPda, vaultPda,
} from './accounts';
import { ed25519VerifyIx, Ed25519OffsetRecord } from './precompile';
import { asBuf } from './layout';

const TOKEN_PROGRAM_ID = spl.TOKEN_PROGRAM_ID;
const SYS = new PublicKey('11111111111111111111111111111111');

export const w = (p: PublicKey, m = false) => ({ pubkey: p, isWritable: m, isSigner: false });
export const s = (p: PublicKey, m = false) => ({ pubkey: p, isWritable: m, isSigner: true });
const u8b = (v: number) => Buffer.from([v]);
const u16le = (v: number) => { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; };
const u32le = (v: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const u64le = (v: bigint | number) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const pk = (p: PublicKey) => Buffer.from(p.toBytes());

/** Anchor-instruction-data: sha256("global:<naam>")[..8] + borsh-args. */
export function ixData(name: string, args?: Buffer): Buffer {
  const disc = sha256(Buffer.from('global:' + name, 'utf8')).subarray(0, 8);
  return args ? Buffer.concat([Buffer.from(disc), args]) : Buffer.from(disc);
}

export function initIx(
  vaultMint: PublicKey, bondMultiplierBps: number, challengeWindowSlots: bigint,
  maxLinksPerTx: number, defaultAllowance: bigint, mintAuthority: PublicKey, payer: PublicKey,
): TransactionInstruction {
  const [cfg] = configPda(); const [vp] = vaultPda(); const [fp] = feePda();
  const args = Buffer.concat([pk(vaultMint), u32le(bondMultiplierBps), u64le(challengeWindowSlots), u16le(maxLinksPerTx), u64le(defaultAllowance)]);
  return new TransactionInstruction({ programId: PROGRAM_ID, keys: [w(cfg, true), w(vp, true), w(fp, true), s(mintAuthority), s(payer, true), w(SYS)], data: ixData('init', args) });
}

export function pingIx(): TransactionInstruction {
  const [cfg] = configPda();
  return new TransactionInstruction({ programId: PROGRAM_ID, keys: [w(cfg)], data: ixData('ping') });
}

export function fundVaultIx(amount: bigint | number, mintAuthority: PublicKey, vaultMint: PublicKey): TransactionInstruction {
  const [cfg] = configPda(); const [vp] = vaultPda();
  return new TransactionInstruction({ programId: PROGRAM_ID, keys: [s(mintAuthority, true), w(cfg), w(ata(vaultMint, mintAuthority), true), w(ata(vaultMint, vp), true), w(vp), w(TOKEN_PROGRAM_ID)], data: ixData('fund_vault', u64le(amount)) });
}

export function withdrawVaultIx(amount: bigint | number, mintAuthority: PublicKey, vaultMint: PublicKey): TransactionInstruction {
  const [cfg] = configPda(); const [vp] = vaultPda();
  return new TransactionInstruction({ programId: PROGRAM_ID, keys: [s(mintAuthority, true), w(cfg, true), w(ata(vaultMint, vp), true), w(ata(vaultMint, mintAuthority), true), w(vp), w(TOKEN_PROGRAM_ID)], data: ixData('withdraw_vault', u64le(amount)) });
}

/** mint_coin (SPEC §5.3): mintTx = H(serial,value,recipient) ‖ H(value,recipient,serial) (64 B). */
export function mintCoinIx(
  serial: Buffer | Uint8Array, value: bigint, recipient: PublicKey, genesisHash: Buffer | Uint8Array, mintTx: Buffer | Uint8Array,
  mintAuthority: PublicKey, payer: PublicKey, vaultMint: PublicKey,
): TransactionInstruction {
  const [cfg] = configPda(); const [reg] = registryPda(serial); const [vp] = vaultPda(); const [al] = allowancePda(recipient);
  const args = Buffer.concat([asBuf(serial), u64le(value), pk(recipient), asBuf(genesisHash), asBuf(mintTx)]);
  // pos4 = vault = ATA(eigenaar vaultPda, ro); pos5 = vaultPda-account (geen ATA!).
  // (M2-les: ATA's verward → Custom 3007; bewijs: debug-mint A9/B9.)
  return new TransactionInstruction({ programId: PROGRAM_ID, keys: [s(mintAuthority, true), w(cfg, true), w(reg, true), w(ata(vaultMint, vp)), w(vp), w(al, true), s(payer, true), w(SYS), w(TOKEN_PROGRAM_ID)], data: ixData('mint_coin', args) });
}

export function startCheckInIx(
  serial: Buffer | Uint8Array, attempt: number, state0: Buffer | Uint8Array, recipient: PublicKey,
  payer: PublicKey, vaultMint: PublicKey,
): TransactionInstruction {
  const [cfg] = configPda(); const [reg] = registryPda(serial); const [sub] = submissionPda(serial, attempt);
  const args = Buffer.concat([asBuf(serial), u8b(attempt), asBuf(state0)]);
  return new TransactionInstruction({ programId: PROGRAM_ID, keys: [w(cfg), w(reg, true), w(sub, true), s(recipient), w(ata(vaultMint, recipient), true), w(ata(vaultMint, sub), true), w(TOKEN_PROGRAM_ID), s(payer, true), w(SYS)], data: ixData('start_check_in', args) });
}

export interface AppendPlan {
  /** Eigenaar van de huidige laaste state in de submission (= headOwner). */
  headOwner: Buffer;
  /** Links in volgorde; link i = { state_{headLen+i+1}, sig van eigenaar state_{headLen+i} }. */
  links: { state: Buffer; sig: Buffer }[];
  /** H(laatste state van de coin) — msg van de laatste link. */
  lastHash: Buffer;
}

/** Bouwt [precompileIx, appendIx] — de precompile HOORT VÓÓR de append-ix in
 *  de tx (indices 0 en 1). append-ix-data layout (gemeten M1):
 *    @0 disc(8) @8 serial(32) @40 headOwner(32) @72 u32len(4)
 *    @76 links (168 B elk: state104 + sig64) @76+168k lastHash(32)
 *  Precompile per link i (0-based):
 *    sig  @ 76 + i*168 + 104
 *    pub  = i==0 ? headOwner@40 : owner(link[i-1].state) @ 76 + (i-1)*168 + 40
 *    msg  = i<n-1 ? prevHash van link[i+1].state @ 76 + (i+1)*168 + 72
 *           : lastHash @ 76 + n*168 + 32
 */
export function appendLinksIxPair(
  serial: Buffer | Uint8Array, attempt: number, plan: AppendPlan,
): [TransactionInstruction, TransactionInstruction] {
  const n = plan.links.length;
  if (n === 0) throw new Error('geen links');
  const headOwner = asBuf(plan.headOwner);
  const links = plan.links.map((l) => ({ state: asBuf(l.state), sig: asBuf(l.sig) }));
  const lastHash = asBuf(plan.lastHash);
  const linksBuf = Buffer.concat([u32le(n), ...links.flatMap((l) => [l.state, l.sig])]);
  const args = Buffer.concat([asBuf(serial), headOwner, linksBuf, lastHash]);
  const [cfg] = configPda(); const [reg] = registryPda(serial); const [sub] = submissionPda(serial, attempt);
  const appendIx = new TransactionInstruction({ programId: PROGRAM_ID, keys: [w(cfg), w(reg), w(sub, true)], data: ixData('append_links', args) });
  const BASE = 76; const LINK = 168;
  const recs: Ed25519OffsetRecord[] = plan.links.map((_, i) => ({
    sigOff: BASE + i * LINK + 104,
    sigIx: 1,
    pubOff: i === 0 ? 40 : BASE + (i - 1) * LINK + 40,
    pubIx: 1,
    // Niet-laatste: msg = H(link[i].state) = link[i+1].prev_hash (state+72).
    // Laatste: msg = last_hash, die begint op BASE + n*LINK (geen +32!).
    msgOff: i < n - 1 ? BASE + (i + 1) * LINK + 72 : BASE + n * LINK,
    msgSize: 32,
    msgIx: 1,
  }));
  return [ed25519VerifyIx(recs), appendIx];
}

/** finalize_check_in (SPEC §5.7). `recipient` = submission.checker (bond-
 *  tracer); `finalOwner` = eigenaar van de laatste state (uitbetaling).
 *  De 4 PROGRAM_ID-placeholders = remaining_accounts (other_submission,
 *  other_escrow, other_checker_token = None; zie M1-refactor). */
export function finalizeIx(
  serial: Buffer | Uint8Array, attempt: number, otherAttempt: number,
  /** Mint-recipient (arg "recipient" moet == registry.recipient; allowance-zij). */
  mintRecipient: PublicKey,
  /** submission.checker — betaalde de bond (checker_token). */
  checker: PublicKey,
  /** submission.final_owner — krijgt de waarde (winner_token). */
  finalOwner: PublicKey,
  vaultMint: PublicKey, payer: PublicKey,
  /** Casus B (head bestaat = fin_resolve): echte remaining_accounts.
   *  [0]=other submission, [1]=other escrow, [2]=other checker-token,
   *  [3]=allowance (win-tak I5). Zonder caseB: 4 PROGRAM_ID-placeholders
   *  (casus A — de andere attempt bestaat niet nog). */
  caseB?: { otherChecker: PublicKey },
): TransactionInstruction {
  const [cfg] = configPda(); const [reg] = registryPda(serial); const [hd] = headPda(serial);
  const [sub] = submissionPda(serial, attempt); const [vp] = vaultPda(); const [fp] = feePda();
  const [otherSub] = submissionPda(serial, otherAttempt);
  const args = Buffer.concat([asBuf(serial), u8b(otherAttempt), pk(mintRecipient)]);
  const remaining = caseB
    ? [w(otherSub, true), w(ata(vaultMint, otherSub), true), w(ata(vaultMint, caseB.otherChecker), true), w(allowancePda(mintRecipient)[0], true)]
    : [w(PROGRAM_ID), w(PROGRAM_ID), w(PROGRAM_ID), w(PROGRAM_ID)];
  const keys = [
    w(cfg, true), w(reg, true), w(hd, true), w(sub, true),
    w(ata(vaultMint, sub), true), w(ata(vaultMint, checker), true),
    w(ata(vaultMint, finalOwner), true), w(ata(vaultMint, vp), true), w(vp),
    w(ata(vaultMint, fp), true), w(fp), w(TOKEN_PROGRAM_ID), s(payer, true), w(SYS),
    ...remaining,
  ];
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data: ixData('finalize_check_in', args) });
}

/** settle (SPEC §5.8) — na de challenge window. Laatste remaining_account =
 *  allowancePda (I5: committed -= value). */
export function settleIx(
  serial: Buffer | Uint8Array, attempt: number, otherAttempt: number,
  /** Mint-recipient (allowance-PDA + arg "recipient"). */
  mintRecipient: PublicKey,
  /** submission.checker (bond-refund). */
  checker: PublicKey,
  /** submission.final_owner (waarde). */
  finalOwner: PublicKey,
  vaultMint: PublicKey, payer: PublicKey,
): TransactionInstruction {
  const [cfg] = configPda(); const [reg] = registryPda(serial); const [hd] = headPda(serial);
  const [sub] = submissionPda(serial, attempt); const [vp] = vaultPda(); const [fp] = feePda();
  const [al] = allowancePda(mintRecipient);
  const args = Buffer.concat([asBuf(serial), u8b(otherAttempt), pk(mintRecipient)]);
  const keys = [
    w(cfg, true), w(reg, true), w(hd), w(sub, true),
    w(ata(vaultMint, sub), true), w(ata(vaultMint, checker), true),
    w(ata(vaultMint, finalOwner), true), w(ata(vaultMint, vp), true), w(vp),
    w(ata(vaultMint, fp), true), w(fp), w(TOKEN_PROGRAM_ID), s(payer), w(SYS),
    w(PROGRAM_ID), w(PROGRAM_ID), w(al, true),
  ];
  return new TransactionInstruction({ programId: PROGRAM_ID, keys, data: ixData('settle', args) });
}

/** set_allowance (SPEC §5.9, M1: alleen verhoging). */
export function setAllowanceIx(newCap: bigint | number, wallet: PublicKey): TransactionInstruction {
  const [al] = allowancePda(wallet);
  return new TransactionInstruction({ programId: PROGRAM_ID, keys: [s(wallet), w(al, true)], data: ixData('set_allowance', u64le(newCap)) });
}
