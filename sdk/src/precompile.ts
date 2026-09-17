import { TransactionInstruction } from '@solana/web3.js';
import { ED25519_PRECOMPILE_ID, MAX_LINKS_PER_PRECOMPILE } from './constants';

/** Ed25519SignatureOffsets-record (repr(C), 14 B, alle velden u16 LE).
 *  *Ix = 0-based index van de instructie IN DE TX waarnaar de offset wijst. */
export interface Ed25519OffsetRecord {
  sigOff: number; sigIx: number;
  pubOff: number; pubIx: number;
  msgOff: number; msgSize: number; msgIx: number;
}

export function ed25519VerifyIx(records: Ed25519OffsetRecord[]): TransactionInstruction {
  if (records.length === 0) throw new Error('minimaal 1 record');
  if (records.length > MAX_LINKS_PER_PRECOMPILE) throw new Error('max ' + MAX_LINKS_PER_PRECOMPILE + ' records per precompile-ix');
  const data = Buffer.alloc(2 + records.length * 14);
  data.writeUInt16LE(records.length, 0);
  records.forEach((r, i) => {
    const o = 2 + i * 14;
    data.writeUInt16LE(r.sigOff, o);
    data.writeUInt16LE(r.sigIx, o + 2);
    data.writeUInt16LE(r.pubOff, o + 4);
    data.writeUInt16LE(r.pubIx, o + 6);
    data.writeUInt16LE(r.msgOff, o + 8);
    data.writeUInt16LE(r.msgSize, o + 10);
    data.writeUInt16LE(r.msgIx, o + 12);
  });
  return new TransactionInstruction({ programId: ED25519_PRECOMPILE_ID, keys: [], data });
}
