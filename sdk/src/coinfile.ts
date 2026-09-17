import { sha256 } from '@noble/hashes/sha256';
import { COIN_MAGIC, COINFILE_VERSION, SIG_SIZE, STATE_SIZE } from './constants';
import { asBuf } from './layout';

/** CoinCore — de onversleutelde munt (docs/coinfile-spec-v1.md §2).
 *  states[0] = genesis; sigs[i] = signatuur van owner(states[i]) over H(states[i+1]). */
export interface CoinCore {
  serial: Buffer;    // 32
  value: bigint;     // u64
  states: Buffer[];  // len = n >= 1, elk 104 B
  sigs: Buffer[];    // len = n - 1, elk 64 B
  sigScheme: number; // 0 = Ed25519 (M1/M2)
}

// Binary layout (LE), spec v1 §2.1:
//   @0  magic "OBC1" (4)
//   @4  version u16 (=1)
//   @6  sigScheme u8
//   @7  statesLen u16
//   @9  serial (32)
//   @41 value u64
//   @49 states (n x 104)
//       sigs   ((n-1) x 64)
//       checksum sha256(van alles daarvoor) (32)
const HDR = 49;

export function coinCoreSize(statesLen: number): number {
  return HDR + statesLen * STATE_SIZE + (statesLen - 1) * SIG_SIZE + 32;
}

export function encodeCoinCore(c: CoinCore): Buffer {
  const n = c.states.length;
  if (n < 1) throw new Error('minimaal 1 state');
  if (c.sigs.length !== n - 1) throw new Error('sigs.length moet states.length - 1 zijn');
  const serial = asBuf(c.serial);
  const states = c.states.map(asBuf);
  const sigs = c.sigs.map(asBuf);
  if (serial.length !== 32) throw new Error('serial moet 32 bytes zijn');
  const buf = Buffer.alloc(coinCoreSize(n));
  let o = 0;
  COIN_MAGIC.copy(buf, o); o += 4;
  buf.writeUInt16LE(COINFILE_VERSION, o); o += 2;
  buf.writeUInt8(c.sigScheme, o); o += 1;
  buf.writeUInt16LE(n, o); o += 2;
  serial.copy(buf, o); o += 32;
  buf.writeBigUInt64LE(c.value, o); o += 8;
  for (const s of states) { s.copy(buf, o); o += STATE_SIZE; }
  for (const s of sigs) { s.copy(buf, o); o += SIG_SIZE; }
  Buffer.from(sha256(buf.subarray(0, o))).copy(buf, o);
  return buf;
}

export function decodeCoinCore(buf: Buffer | Uint8Array): CoinCore {
  buf = asBuf(buf);
  if (buf.length < HDR) throw new Error('buffer te klein');
  if (!COIN_MAGIC.equals(buf.subarray(0, 4))) throw new Error('magic mismatch (geen CoinCore)');
  const version = buf.readUInt16LE(4);
  if (version !== COINFILE_VERSION) throw new Error('onbekende versie ' + version);
  const n = buf.readUInt16LE(7);
  const expected = coinCoreSize(n);
  if (buf.length !== expected) throw new Error('grootte ' + buf.length + ' != verwacht ' + expected);
  const sigScheme = buf.readUInt8(6);
  const serial = Buffer.from(buf.subarray(9, 41));
  const value = buf.readBigUInt64LE(41);
  const states: Buffer[] = [];
  let o = HDR;
  for (let i = 0; i < n; i++) { states.push(Buffer.from(buf.subarray(o, o + STATE_SIZE))); o += STATE_SIZE; }
  const sigs: Buffer[] = [];
  for (let i = 0; i < n - 1; i++) { sigs.push(Buffer.from(buf.subarray(o, o + SIG_SIZE))); o += SIG_SIZE; }
  const checksum = Buffer.from(sha256(buf.subarray(0, o)));
  if (!checksum.equals(buf.subarray(o, o + 32))) throw new Error('checksum mismatch (beschadigd bestand)');
  return { serial, value, states, sigs, sigScheme };
}
