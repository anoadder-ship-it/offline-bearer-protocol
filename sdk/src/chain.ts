import { ed25519 } from '@noble/curves/ed25519';
import { SigScheme } from './constants';
import { asBuf, decodeState, ownerOf, stateHash } from './layout';
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
export function verifyCoinChain(c: CoinCore, opts?: { genesisHash?: Buffer }): ChainVerifyResult {
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
    // signatuur-regel: sigs[i-1] = owner(state[i-1]) tekent H(state[i]).
    const curH = stateHash(c.states[i]);
    let valid = false;
    try {
      valid = c.sigScheme === SigScheme.Ed25519
        ? ed25519.verify(c.sigs[i - 1], curH, ownerOf(c.states[i - 1]))
        : false; // M4: PQ-verificatie hier uitbreiden
    } catch {
      valid = false;
    }
    if (!valid) errors.push('sigs[' + (i - 1) + '] ongeldig onder owner(state[' + (i - 1) + '])');
  }
  if (opts?.genesisHash) {
    if (!stateHash(c.states[0]).equals(asBuf(opts.genesisHash))) {
      errors.push('H(state[0]) != genesisHash (on-chain anker)');
    }
  }
  return { ok: errors.length === 0, errors, headHash: stateHash(c.states[n - 1]) };
}
