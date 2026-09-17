import * as spl from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';
import { PROGRAM_ID } from './constants';

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
