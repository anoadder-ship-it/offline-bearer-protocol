import { describe, expect, test } from 'bun:test';
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { decodeCoinCore, encodeCoinCore, coinCoreSize } from '../src/coinfile';
import { newCoin, appendLink, ed25519Signer, currentOwner } from '../src/coin';
import { verifyCoinChain } from '../src/chain';
import { stateHash } from '../src/layout';

const serial = sha256(Buffer.from('coinfile-test-serial'));

// Reële ed25519 keys (deterministisch): owner MUST een geldig ed25519-punt
// zijn, anders verifieert de signature niet (dummy-pubkeys faalden in v0).
function kp(fill: number): { priv: Buffer; pub: Buffer } {
  const priv = Buffer.alloc(32, fill);
  return { priv, pub: Buffer.from(ed25519.getPublicKey(priv)) };
}
const A = kp(1);
const B = kp(2);
const C = kp(3);

describe('CoinCore codec', () => {
  test('round-trip n=1', () => {
    const coin = newCoin(serial, 100n, A.pub);
    const buf = encodeCoinCore(coin);
    expect(buf.length).toBe(coinCoreSize(1));
    const dec = decodeCoinCore(buf);
    expect(dec.serial.equals(serial)).toBe(true);
    expect(dec.value).toBe(100n);
    expect(dec.states.length).toBe(1);
    expect(dec.sigs.length).toBe(0);
    expect(dec.states[0].equals(coin.states[0])).toBe(true);
  });

  test('round-trip n=3 (na twee offline transfers)', () => {
    let coin = newCoin(serial, 42n, A.pub);
    coin = appendLink(coin, ed25519Signer(A.priv), B.pub);
    coin = appendLink(coin, ed25519Signer(B.priv), C.pub);
    const buf = encodeCoinCore(coin);
    expect(buf.length).toBe(coinCoreSize(3));
    const dec = decodeCoinCore(buf);
    expect(dec.states.length).toBe(3);
    expect(dec.sigs.length).toBe(2);
    for (let i = 0; i < 3; i++) expect(dec.states[i].equals(coin.states[i])).toBe(true);
    for (let i = 0; i < 2; i++) expect(dec.sigs[i].equals(coin.sigs[i])).toBe(true);
    expect(currentOwner(dec).equals(C.pub)).toBe(true);
  });

  test('checksum detecteert corruptie', () => {
    const coin = newCoin(serial, 100n, A.pub);
    const buf = encodeCoinCore(coin);
    buf[60] ^= 0xff; // binnen states[0]
    expect(() => decodeCoinCore(buf)).toThrow(/checksum/);
  });

  test('magic + versie + grootte worden afgedwongen', () => {
    const coin = newCoin(serial, 100n, A.pub);
    const buf = encodeCoinCore(coin);
    const badMagic = Buffer.from(buf); badMagic[0] = 0x41;
    expect(() => decodeCoinCore(badMagic)).toThrow(/magic/);
    const badVer = Buffer.from(buf); badVer.writeUInt16LE(2, 4);
    expect(() => decodeCoinCore(badVer)).toThrow(/versie/);
    expect(() => decodeCoinCore(buf.subarray(0, buf.length - 1))).toThrow(/grootte/);
  });
});

describe('ketenverificatie', () => {
  function makeChain() {
    let coin = newCoin(serial, 100n, A.pub);
    coin = appendLink(coin, ed25519Signer(A.priv), B.pub);
    coin = appendLink(coin, ed25519Signer(B.priv), C.pub);
    return coin;
  }

  test('geldige keten slaagt', () => {
    const r = verifyCoinChain(makeChain());
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  test('beschadigde signature faalt', () => {
    const coin = makeChain();
    coin.sigs[0] = Buffer.from(coin.sigs[0]); coin.sigs[0][10] ^= 1;
    const r = verifyCoinChain(coin);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('sigs[0]'))).toBe(true);
  });

  test('verkeerde tekenaar (pubkey niet op eigen state) faalt', () => {
    // A tekent voor B, maar state1.owner = C (niet de pub van de tekenaar)
    const coin = newCoin(serial, 100n, A.pub);
    const tampered = appendLink(coin, ed25519Signer(A.priv), C.pub);
    // sig0 is geldig onder A, maar owner(state0)=A en owner(state1)=C:
    // ketenregel "sig[i-1] onder owner(state[i-1])" slaagt nog, dus forceer
    // de echte mismatch: owner(state0) = C (niet de tekenaar A).
    const s0 = Buffer.from(tampered.states[0]);
    s0.set(Buffer.from(C.pub), 40);
    tampered.states[0] = s0;
    const r = verifyCoinChain(tampered);
    expect(r.ok).toBe(false);
  });

  test('omgewisselde states (fork) faalt op prevHash', () => {
    const coin = makeChain();
    const tmp = coin.states[1]; coin.states[1] = coin.states[2]; coin.states[2] = tmp;
    const r = verifyCoinChain(coin);
    expect(r.ok).toBe(false);
  });

  test('waarde-verschuiving faalt', () => {
    const coin = makeChain();
    const s1 = Buffer.from(coin.states[1]); s1.writeBigUInt64LE(999n, 32); coin.states[1] = s1;
    const r = verifyCoinChain(coin);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('value'))).toBe(true);
  });

  test('genesis-anker (H(state0) == genesisHash)', () => {
    const coin = makeChain();
    const good = verifyCoinChain(coin, { genesisHash: stateHash(coin.states[0]) });
    expect(good.ok).toBe(true);
    const bad = verifyCoinChain(coin, { genesisHash: Buffer.alloc(32, 7) });
    expect(bad.ok).toBe(false);
  });
});
