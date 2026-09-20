import * as spl from '@solana/spl-token';
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { PROGRAM_ID } from './constants';

/** M4.1.1-les (gemeten, agave 4.1.2/4.3.0-rc + web3.js 1.99): het NIEUWE
 *  system-instructieformaat (u32-discriminators) van web3.js 1.99 maakt met
 *  `createAccount` (index 0) een SYSTEM-owned account — de owner-veld wordt
 *  níet toegepast; Assign (index 1) zet de owner. (Oud 1-byte-formaat:
 *  CreateAccount = disc 2, zet de owner direct.) Beide in één tx →
 *  program-owned data-account die een program mag schrijven.
 *  Bewijs: sdk/evidence/m411-track2-*.log + diag-sessie 2026-09-20. */
export function createProgramOwnedAccountIx(
  payer: PublicKey, newAccount: PublicKey, lamports: number, space: number,
  owner: PublicKey = PROGRAM_ID,
): TransactionInstruction[] {
  return [
    SystemProgram.createAccount({ fromPubkey: payer, newAccountPubkey: newAccount, lamports, space, programId: owner }),
    SystemProgram.assign({ accountPubkey: newAccount, programId: owner }),
  ];
}

/** PDA-derivatie (mirror van het programma: seeds + bump via find_program_address). */
export function pda(prefix: string, ...extra: Buffer[]): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from(prefix, 'utf8'), ...extra], PROGRAM_ID);
}
export const configPda = (): [PublicKey, number] => pda('config');
export const vaultPda = (): [PublicKey, number] => pda('vault');
export const feePda = (): [PublicKey, number] => pda('fee');
export const registryPda = (serial: Buffer): [PublicKey, number] => pda('mint', serial);
export const headPda = (serial: Buffer): [PublicKey, number] => pda('head', serial);
export const submissionPda = (serial: Buffer, attempt: number): [PublicKey, number] =>
  pda('submission', serial, Buffer.from([attempt]));
export const allowancePda = (recipient: PublicKey): [PublicKey, number] =>
  pda('allowance', Buffer.from(recipient.toBytes()));

/** ATA — ook voor off-curve owners (PDAs) via allowOwnerOffCurve (M1-les). */
export function ata(mint: PublicKey, owner: PublicKey): PublicKey {
  return spl.getAssociatedTokenAddressSync(mint, owner, true);
}
