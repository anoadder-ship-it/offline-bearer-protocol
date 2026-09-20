// M4.1 (D3): ML-DSA-44 (FIPS 203, L2) voor de SDK — via mldsa-wasm (WASM, zero-dep).
// Cross-gevalideerd tegen de RustCrypto-vectors in fixtures/pq/vectors.txt
// (bun test → tests/pq-chain.test.ts).
//
// Design: de owner-adressen in een OBP-chain zijn OFF-curve (PQ) — de ML-DSA
// publieke key (1312 B) staat NIET in de state. De key-relatie (owner → pk)
// komt van buiten (wallet / CoinFile v2; D6: open tot v2 stabiel is). Daarom
// draagt `verifyCoinChainAsync` een `keyProvider` mee.

import mldsa from 'mldsa-wasm';

type KeyPair = Awaited<ReturnType<typeof mldsa.generateKey>>;
type PubKey = CryptoKey;

const ALG = 'ML-DSA-44' as const;
export const MLDSA44_PK_LEN = 1312;
export const MLDSA44_SIG_LEN = 2420;

/** Verifieert met een raw publieke key (1312 B). */
export class MlDsaVerifier {
  private pk: PubKey;
  constructor(private rawPk: Buffer) {
    if (rawPk.length !== MLDSA44_PK_LEN) {
      throw new Error('ML-DSA-44 pk moet ' + MLDSA44_PK_LEN + ' B zijn (krijg ' + rawPk.length + ')');
    }
    this.pk = null as unknown as PubKey; // lazy (importKey is async)
  }
  private async key(): Promise<PubKey> {
    if (!this.pk) this.pk = await mldsa.importKey('raw-public', this.rawPk, ALG, false, ['verify']);
    return this.pk;
  }
  static async verifyPk(rawPk: Buffer, msg: Buffer, sig: Buffer): Promise<boolean> {
    if (sig.length !== MLDSA44_SIG_LEN) return false;
    const k = await mldsa.importKey('raw-public', rawPk, ALG, false, ['verify']);
    return mldsa.verify(ALG, k, sig, msg);
  }
  async verify(msg: Buffer, sig: Buffer): Promise<boolean> {
    if (sig.length !== MLDSA44_SIG_LEN) return false;
    return mldsa.verify(ALG, await this.key(), sig, msg);
  }
}

/** Genereert (of wrappt) een ML-DSA-44 keypair; implementeert de async Signer. */
export class MlDsaSigner {
  private constructor(private kp: KeyPair) {}
  static async generate(): Promise<MlDsaSigner> {
    return new MlDsaSigner(await mldsa.generateKey(ALG, false, ['sign', 'verify']));
  }
  /** Wrap een bestaande raw keypair? mldsa-wasm heeft geen fromRawSk — gebruik generate(). */
  async sign(msg: Buffer): Promise<Buffer> {
    return Buffer.from(await mldsa.sign(ALG, this.kp.privateKey, msg));
  }
  async verify(msg: Buffer, sig: Buffer): Promise<boolean> {
    if (sig.length !== MLDSA44_SIG_LEN) return false;
    return mldsa.verify(ALG, this.kp.publicKey, sig, msg);
  }
  /** Raw publieke key (1312 B) — voor opslag / keyProvider. */
  async rawPublicKey(): Promise<Buffer> {
    return Buffer.from(await mldsa.exportKey('raw-public', this.kp.publicKey));
  }
}
