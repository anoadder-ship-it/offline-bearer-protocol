// M4.1 (D3): PQ-chain (ML-DSA-44) — signer, async append, async verify,
// cross-check tegen de RustCrypto-vectors (fixtures/pq/vectors.txt).
import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { sha256 } from '@noble/hashes/sha256';
import { newCoin, appendLink, ed25519Signer, appendLinkAsync } from '../src/coin';
import { verifyCoinChain, verifyCoinChainAsync } from '../src/chain';
import { MlDsaSigner, MlDsaVerifier, MLDSA44_SIG_LEN } from '../src/pq';
import { stateHash } from '../src/layout';
import { SigScheme } from '../src/constants';
import type { CoinCore } from '../src/coinfile';

const SERIAL = Buffer.from(sha256(Buffer.from('obp-pq-test-coin')));
const VALUE = 100n;
const owner1 = Buffer.alloc(32, 0x11); // off-curve "addressen" (geen ed25519-requirement)
const owner2 = Buffer.alloc(32, 0x22);
const owner3 = Buffer.alloc(32, 0x33);

// --- cross-check: RustCrypto-vectors door mldsa-wasm -----------------------
describe('PQ: cross-verify RustCrypto-vectors (fixtures/pq/vectors.txt)', () => {
  const txt = fs.readFileSync(path.join(import.meta.dir, '..', 'fixtures', 'pq', 'vectors.txt'), 'utf8');
  const V: Record<string, string> = {};
  for (const line of txt.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) V[m[1]] = m[2].trim();
  }
  const pk = Buffer.from(V.MLDSA44_PK, 'hex');
  const sig = Buffer.from(V.MLDSA44_SIG, 'hex');
  const msg = Buffer.from(V.MSG, 'hex');
  test('pk/sig lengtes (FIPS 203 L2)', () => {
    expect(pk.length).toBe(1312);
    expect(sig.length).toBe(2420);
  });
  test('RustCrypto-signatuur verifieert (onafhankelijke implementaties)', async () => {
    expect(await MlDsaVerifier.verifyPk(pk, msg, sig)).toBe(true);
  });
  test('corrupte signatuur faalt', async () => {
    const bad = Buffer.from(sig); bad[10] ^= 0xff;
    expect(await MlDsaVerifier.verifyPk(pk, msg, bad)).toBe(false);
  });
  test('verkeerde msg faalt', async () => {
    expect(await MlDsaVerifier.verifyPk(pk, Buffer.from('ander bericht'), sig)).toBe(false);
  });
});

// --- PQ-chain: build + verify ----------------------------------------------
describe('PQ: ML-DSA-44-coin (newCoin + appendLinkAsync + verifyCoinChainAsync)', () => {
  test('roundtrip: 3 states, 2× 2420B — verify ok (keyProvider)', async () => {
    const s1 = await MlDsaSigner.generate();
    const s2 = await MlDsaSigner.generate();
    let coin: CoinCore = { serial: SERIAL, value: VALUE, states: [], sigs: [], sigScheme: SigScheme.MlDsa44 };
    const { genesisState } = await import('../src/layout');
    coin.states = [genesisState(SERIAL, VALUE, owner1)];
    coin = await appendLinkAsync(coin, s1, owner2);
    coin = await appendLinkAsync(coin, s2, owner3);
    expect(coin.sigs.map((s) => s.length)).toEqual([MLDSA44_SIG_LEN, MLDSA44_SIG_LEN]);
    const keys = new Map([
      [owner1.toString('hex'), await s1.rawPublicKey()],
      [owner2.toString('hex'), await s2.rawPublicKey()],
    ]);
    const res = await verifyCoinChainAsync(coin, { keyProvider: (o) => keys.get(o.toString('hex'))! });
    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.headHash.equals(stateHash(coin.states[2]))).toBe(true);
  });
  test('negatief: corrupte signatuur → ongeldig', async () => {
    const s1 = await MlDsaSigner.generate();
    const s2 = await MlDsaSigner.generate();
    let coin: CoinCore = { serial: SERIAL, value: VALUE, states: [], sigs: [], sigScheme: SigScheme.MlDsa44 };
    const { genesisState } = await import('../src/layout');
    coin.states = [genesisState(SERIAL, VALUE, owner1)];
    coin = await appendLinkAsync(coin, s1, owner2);
    coin = await appendLinkAsync(coin, s2, owner3);
    coin.sigs[0] = Buffer.from(coin.sigs[0]); coin.sigs[0][5] ^= 0xff;
    const keys = new Map([
      [owner1.toString('hex'), await s1.rawPublicKey()],
      [owner2.toString('hex'), await s2.rawPublicKey()],
    ]);
    const res = await verifyCoinChainAsync(coin, { keyProvider: (o) => keys.get(o.toString('hex'))! });
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.includes('sigs[0]'))).toBe(true);
  });
  test('negatief: verkeerde key in keyProvider → ongeldig', async () => {
    const s1 = await MlDsaSigner.generate();
    const s2 = await MlDsaSigner.generate();
    const other = await MlDsaSigner.generate();
    let coin: CoinCore = { serial: SERIAL, value: VALUE, states: [], sigs: [], sigScheme: SigScheme.MlDsa44 };
    const { genesisState } = await import('../src/layout');
    coin.states = [genesisState(SERIAL, VALUE, owner1)];
    coin = await appendLinkAsync(coin, s1, owner2);
    // owner1 → ANDERSE pubkey
    const res = await verifyCoinChainAsync(coin, {
      keyProvider: (o) => (o.equals(owner1) ? other.rawPublicKey() : s2.rawPublicKey()),
    });
    expect(res.ok).toBe(false);
  });
  test('negatief: géén keyProvider bij scheme 1 → throw', async () => {
    const coin: CoinCore = { serial: SERIAL, value: VALUE, states: [], sigs: [], sigScheme: SigScheme.MlDsa44 };
    const { genesisState } = await import('../src/layout');
    coin.states = [genesisState(SERIAL, VALUE, owner1)];
    await expect(verifyCoinChainAsync(coin)).rejects.toThrow('keyProvider');
  });
});

// --- regressie: Ed25519 via de async-delegate -------------------------------
describe('PQ: regressie Ed25519 (verifyCoinChainAsync delegeert)', () => {
  test('ed25519-coin via async-api → ok (zelfde regels als sync)', async () => {
    const seed1 = Buffer.alloc(32, 0xaa); const seed2 = Buffer.alloc(32, 0xbb);
    // Ed25519: on-curve owner = pubkey(seed) (niet de seed zelf).
    const { ed25519 } = await import('@noble/curves/ed25519');
    const pk1 = Buffer.from(ed25519.getPublicKey(seed1));
    const pk2 = Buffer.from(ed25519.getPublicKey(seed2));
    let coin: CoinCore = newCoin(SERIAL, VALUE, pk1);
    coin = appendLink(coin, ed25519Signer(seed1), pk2);
    coin = appendLink(coin, ed25519Signer(seed2), pk1);
    const res = await verifyCoinChainAsync(coin);
    expect(res.ok).toBe(true);
    // sync en async moeten overeenkomen
    const resSync = verifyCoinChain(coin);
    expect(resSync.ok).toBe(true);
    expect(res.headHash.equals(resSync.headHash)).toBe(true);
  });
});
