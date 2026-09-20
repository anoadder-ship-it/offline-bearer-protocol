import { ed25519 } from '@noble/curves/ed25519';
import { SigScheme } from './constants';
import { asBuf, decodeState, ownerOf, stateHash } from './layout';
import { MlDsaVerifier } from './pq';
import type { CoinCore } from './coinfile';

export interface ChainVerifyResult {
  ok: boolean;
  errors: string[];
  headHash: Buffer; // H(laatste state) — wat bij check-in als lastHash/prev-hash wordt geverifieerd
}

/** Volledige ketenverificatie (mirror van de program-regels: I4 + R1–R7).
 *  1) serial + value constant over alle states
 *  2) state[0].prevHash = 0^32
 *  3) per link: state[i].prevHash == H(state[i-1]) EN sigs[i-1] geldig onder
 *     owner(state[i-1]) over H(state[i])
 *  4) optioneel: H(state[0]) == genesisHash (on-chain anker in de registry)
 *  Client-side vooraf doen = geen betaalde failed-tx's meer (M1-les). */
/** Structure-check (serial/value/prevHash-keten) — scheme-onafhankelijk.
 *  Wordt gedeeld door verifyCoinChain (sync, Ed25519) en verifyCoinChainAsync (PQ). */
function verifyStructure(c: CoinCore, genesisHash?: Buffer): { errors: string[]; n: number } {
  const errors: string[] = [];
  const n = c.states.length;
  if (n < 1) errors.push('geen states');
  for (let i = 0; i < n; i++) {
    const st = decodeState(c.states[i]);
    if (!st.serial.equals(c.serial)) errors.push('state[' + i + '].serial != coin.serial');
    if (st.value !== c.value) errors.push('state[' + i + '].value != coin.value');
  }
  if (n >= 1) {
    const st0 = decodeState(c.states[0]);
    if (st0.prevHash.some((b) => b !== 0)) errors.push('state[0].prevHash is niet nul');
  }
  for (let i = 1; i < n; i++) {
    // prevHash-regel: state[i].prevHash == H(state[i-1]) (de vorige state).
    const prevH = stateHash(c.states[i - 1]);
    if (!decodeState(c.states[i]).prevHash.equals(prevH)) {
      errors.push('state[' + i + '].prevHash != H(state[' + (i - 1) + '])');
    }
  }
  if (genesisHash) {
    if (!stateHash(c.states[0]).equals(asBuf(genesisHash))) {
      errors.push('H(state[0]) != genesisHash (on-chain anker)');
    }
  }
  return { errors, n };
}

export function verifyCoinChain(c: CoinCore, opts?: { genesisHash?: Buffer }): ChainVerifyResult {
  const { errors, n } = verifyStructure(c, opts?.genesisHash);
  for (let i = 1; i < n; i++) {
    // signatuur-regel: sigs[i-1] = owner(state[i-1]) tekent H(state[i]).
    // (Ed25519: on-curve owner = de key zelf. PQ: zie verifyCoinChainAsync.)
    const curH = stateHash(c.states[i]);
    let valid = false;
    try {
      valid = c.sigScheme === SigScheme.Ed25519
        ? ed25519.verify(c.sigs[i - 1], curH, ownerOf(c.states[i - 1]))
        : false;
    } catch {
      valid = false;
    }
    if (!valid) errors.push('sigs[' + (i - 1) + '] ongeldig onder owner(state[' + (i - 1) + '])');
  }
  return { ok: errors.length === 0, errors, headHash: stateHash(c.states[n - 1]) };
}

export interface ChainVerifyOptions {
  genesisHash?: Buffer;
  /** M4.1 (PQ): owner-adres → raw ML-DSA-44 pk (1312 B). De PQ-pubkey staat
   *  niet in de state (off-curve owner); de relatie komt van de wallet /
   *  CoinFile v2 (D6: open tot v2 stabiel). Verplicht bij sigScheme=1. */
  keyProvider?: (owner: Buffer) => Buffer | Promise<Buffer>;
}

/** M4.1 (PQ): async ketenverificatie — Ed25519 delegate naar de sync-versie;
 *  scheme 1 (ML-DSA-44) verifieert via mldsa-wasm + keyProvider. */
export async function verifyCoinChainAsync(c: CoinCore, opts?: ChainVerifyOptions): Promise<ChainVerifyResult> {
  if (c.sigScheme === SigScheme.Ed25519) return verifyCoinChain(c, opts);
  if (c.sigScheme !== SigScheme.MlDsa44) throw new Error('sigScheme ' + c.sigScheme + ' nog niet ondersteund');
  if (!opts?.keyProvider) throw new Error('sigScheme=1 vereist opts.keyProvider (owner → raw ML-DSA-44 pk)');
  const { errors, n } = verifyStructure(c, opts.genesisHash);
  for (let i = 1; i < n; i++) {
    const curH = stateHash(c.states[i]);
    const rawPk = await opts.keyProvider(ownerOf(c.states[i - 1]));
    let valid = false;
    try {
      valid = await MlDsaVerifier.verifyPk(rawPk, curH, c.sigs[i - 1]);
    } catch {
      valid = false;
    }
    if (!valid) errors.push('sigs[' + (i - 1) + '] ongeldig onder owner(state[' + (i - 1) + '])');
  }
  return { ok: errors.length === 0, errors, headHash: stateHash(c.states[n - 1]) };
}
