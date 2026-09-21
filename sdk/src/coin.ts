import { ed25519 } from '@noble/curves/ed25519';
import { SigScheme } from './constants';
import type { CoinCore } from './coinfile';
import { currentOwnerOf } from './chain-internal';
import { asBuf, genesisState, nextState, ownerOf, stateHash } from './layout';

export interface Signer { sign(msg: Buffer): Buffer }

/** Ed25519-signer over een 32-byte seed (of 64-byte keypair-array seed|pub). */
export function ed25519Signer(seed: Uint8Array): Signer {
  const priv = seed.length === 64 ? seed.subarray(0, 32) : seed;
  if (priv.length !== 32) throw new Error('seed moet 32 (of 64) bytes zijn');
  return { sign: (msg: Buffer) => Buffer.from(ed25519.sign(msg, priv)) };
}

/** Nieuwe coin (na mint_coin on-chain): alleen state_0, geen signatures.
 *  `recipientOwner` = eigenaar van state_0 (= de mint-recipient). */
export function newCoin(serial: Buffer | Uint8Array, value: bigint, recipientOwner: Buffer | Uint8Array): CoinCore {
  return {
    serial: Buffer.from(asBuf(serial)),
    value,
    states: [genesisState(serial, value, recipientOwner)],
    sigs: [],
    sigScheme: SigScheme.Ed25519,
  };
}

/** Offline transfer: nieuwe state voor `newOwner`, getekend door de huidige
 *  eigenaar. De oude coin blijft geldig tot de nieuwe is gecheckt-in
 *  (double-spend-window: challenge-period + bond, SPEC R1–R7). */
export function appendLink(coin: CoinCore, currentOwnerSigner: Signer, newOwner: Buffer | Uint8Array): CoinCore {
  const last = coin.states[coin.states.length - 1];
  const next = nextState(last, asBuf(newOwner));
  const sig = currentOwnerSigner.sign(stateHash(next));
  return { ...coin, states: [...coin.states, next], sigs: [...coin.sigs, sig] };
}

/** Huidige eigenaar = owner van de laatste state. */
export const currentOwner = (coin: CoinCore): Buffer => currentOwnerOf(coin);

/** M4.1 (PQ): async signer (mldsa-wasm is async; Ed25519-bovenliggende code
 *  blijft sync via Signer). Een sync Signer is ook geldig (await op een
 *  niet-Promise levert de waarde). */
export interface AsyncSigner { sign(msg: Buffer): Promise<Buffer> | Buffer }

/** Async variant van appendLink (PQ-chains; M4.1). */
export async function appendLinkAsync(coin: CoinCore, currentOwnerSigner: AsyncSigner, newOwner: Buffer | Uint8Array): Promise<CoinCore> {
  const last = coin.states[coin.states.length - 1];
  const next = nextState(last, asBuf(newOwner));
  const sig = await currentOwnerSigner.sign(stateHash(next));
  return { ...coin, states: [...coin.states, next], sigs: [...coin.sigs, sig] };
}
