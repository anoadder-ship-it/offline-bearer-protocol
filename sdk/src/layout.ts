import { sha256 } from '@noble/hashes/sha256';
import { SERIAL_SIZE, SIG_SIZE, STATE_SIZE } from './constants';

/** Een state in de lokale munt-chain (SPEC coinfile v1 §2.2; byte-exact met
 *  het programma: state.rs STATE_SIZE=104, state_ops). */
export interface CoinState {
  serial: Buffer;    // 32 @0
  value: bigint;     // 8  @32 (LE)
  owner: Buffer;     // 32 @40
  prevHash: Buffer;  // 32 @72
}

/** Normaliseer Buffer|Uint8Array naar Buffer (noble-hash's leveren Uint8Array). */
export function asBuf(x: Buffer | Uint8Array | ArrayLike<number>): Buffer {
  return x instanceof Buffer ? x : Buffer.from(x as Uint8Array);
}

export function stateHash(state: Buffer | Uint8Array): Buffer {
  const st: Buffer = asBuf(state);
  if (st.length !== STATE_SIZE) throw new Error('state moet ' + STATE_SIZE + ' bytes zijn');
  return Buffer.from(sha256(st));
}

export function encodeState(serial: Buffer | Uint8Array, value: bigint, owner: Buffer | Uint8Array, prevHash: Buffer | Uint8Array): Buffer {
  const ser: Buffer = asBuf(serial); const own: Buffer = asBuf(owner); const ph: Buffer = asBuf(prevHash);
  if (ser.length !== SERIAL_SIZE) throw new Error('serial moet 32 bytes zijn');
  if (own.length !== 32) throw new Error('owner moet 32 bytes zijn');
  if (ph.length !== 32) throw new Error('prevHash moet 32 bytes zijn');
  const s = Buffer.alloc(STATE_SIZE);
  ser.copy(s, 0);
  s.writeBigUInt64LE(value, 32);
  own.copy(s, 40);
  ph.copy(s, 72);
  return s;
}

export function decodeState(s: Buffer | Uint8Array): CoinState {
  const st: Buffer = asBuf(s);
  if (st.length !== STATE_SIZE) throw new Error('state moet ' + STATE_SIZE + ' bytes zijn');
  return {
    serial: Buffer.from(st.subarray(0, 32)),
    value: st.readBigUInt64LE(32),
    owner: Buffer.from(st.subarray(40, 72)),
    prevHash: Buffer.from(st.subarray(72, 104)),
  };
}

/** state_0: prevHash = 32 nul-bytes (on-chain geankerd door registry.genesis_state_hash). */
export function genesisState(serial: Buffer | Uint8Array, value: bigint, owner: Buffer | Uint8Array): Buffer {
  return encodeState(serial, value, owner, Buffer.alloc(32));
}

/** Offline transfer: serial+value over, nieuwe owner, prevHash = H(prev). */
export function nextState(prev: Buffer | Uint8Array, newOwner: Buffer | Uint8Array): Buffer {
  const p = decodeState(prev);
  return encodeState(p.serial, p.value, newOwner, stateHash(prev));
}

export const ownerOf = (state: Buffer): Buffer => decodeState(state).owner;
export const serialOf = (state: Buffer): Buffer => decodeState(state).serial;
export const valueOf = (state: Buffer): bigint => decodeState(state).value;
