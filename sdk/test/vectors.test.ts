// On-chain vectors: de M1-devnet-coin. De fixture (fixtures/m1-coin.json)
// bevat de EXACTE bytes die het programma op devnet accepteerde
// (submission.states + registry.genesis_state_hash). Hieronder wordt de coin
// deterministisch gereconstrueerd uit de SDK en byte-voor-byte vergeleken.
import { describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { Keypair } from '@solana/web3.js';
import { decodeCoinCore, encodeCoinCore } from '../src/coinfile';
import { newCoin, appendLink, ed25519Signer, currentOwner } from '../src/coin';
import { verifyCoinChain } from '../src/chain';
import { stateHash } from '../src/layout';
import { parseRegistry, parseSubmission, RegistryStatus, SubmissionStatus } from '../src/readers';

const M1_SEED = Buffer.from('obp-smoke-deterministic-seed-2025');
const deriveKey = (suffix: string): Uint8Array =>
  sha256(Buffer.concat([M1_SEED, Buffer.from(suffix, 'utf8')]));
const kp = (suffix: string): Keypair => Keypair.fromSeed(deriveKey(suffix));
// ed25519 priv = eerste 32 bytes van de keypair-array (seed|pub); pub = bytes 32..64
const priv = (suffix: string): Buffer => Buffer.from(kp(suffix).secretKey.subarray(0, 32));
const pub = (suffix: string): Buffer => Buffer.from(kp(suffix).publicKey.toBytes());

const M1_SERIAL = sha256(Buffer.from('obp-m1-smoke-coin-001'));
const M1_VALUE = 100n;

function loadFixture() {
  const p = path.join(import.meta.dir, '..', 'fixtures', 'm1-coin.json');
  if (!fs.existsSync(p)) throw new Error('fixture ontbreekt — draai bun scripts/fetch-fixture.ts');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

describe('M1 on-chain vectors', () => {
  test('SDK-reconstructie == on-chain bytes (byte-voor-byte)', () => {
    const fx = loadFixture();
    // 1) deterministische reconstructie via de SDK
    let coin = newCoin(M1_SERIAL, M1_VALUE, pub('recipient'));
    coin = appendLink(coin, ed25519Signer(priv('recipient')), pub('holder2'));
    coin = appendLink(coin, ed25519Signer(priv('holder2')), pub('holder3'));
    // 2) keten moet gelden
    const v = verifyCoinChain(coin);
    expect(v.ok).toBe(true);
    expect(currentOwner(coin).equals(pub('holder3'))).toBe(true);
    // 3) states == on-chain submission.states
    const sub = parseSubmission(Buffer.from(fx.submission.b64, 'base64'));
    expect(sub.status).toBe(SubmissionStatus.WON);
    expect(sub.states.length).toBe(coin.states.length);
    for (let i = 0; i < coin.states.length; i++) {
      expect(coin.states[i].equals(sub.states[i])).toBe(true);
    }
    // 4) H(state_0) == registry.genesis_state_hash
    const reg = parseRegistry(Buffer.from(fx.registry.b64, 'base64'));
    expect(reg.status).toBe(RegistryStatus.SPENT);
    expect(stateHash(coin.states[0]).equals(reg.genesisStateHash)).toBe(true);
    // 5) de coin-file zelf: round-trip en grootte consistent
    const buf = encodeCoinCore(coin);
    const dec = decodeCoinCore(buf);
    expect(dec.states.length).toBe(3);
    expect(dec.serial.equals(M1_SERIAL)).toBe(true);
  });

  test('signatures verifieken onder de juiste keys (onafhankelijke check)', () => {
    let coin = newCoin(M1_SERIAL, M1_VALUE, pub('recipient'));
    coin = appendLink(coin, ed25519Signer(priv('recipient')), pub('holder2'));
    coin = appendLink(coin, ed25519Signer(priv('holder2')), pub('holder3'));
    expect(ed25519.verify(coin.sigs[0], stateHash(coin.states[1]), pub('recipient'))).toBe(true);
    expect(ed25519.verify(coin.sigs[1], stateHash(coin.states[2]), pub('holder2'))).toBe(true);
    // en niet onder de verkeerde key:
    expect(ed25519.verify(coin.sigs[0], stateHash(coin.states[1]), pub('holder2'))).toBe(false);
  });
});
