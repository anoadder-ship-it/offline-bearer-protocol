import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { decodeCoinCore, encodeCoinCore } from '../src/coinfile';
import { newCoin } from '../src/coin';
import { decryptCoinFile, encryptCoinFile, serializeEncrypted } from '../src/wrapper';
import { sha256 } from '@noble/hashes/sha256';

const serial = sha256(Buffer.from('wrapper-test-serial'));

describe('GCM-wrapper', () => {
  test('encrypt → decrypt round-trip', () => {
    const coin = newCoin(serial, 77n, Buffer.alloc(32, 9));
    const plain = encodeCoinCore(coin);
    const key = randomBytes(32);
    const enc = serializeEncrypted(encryptCoinFile(plain, key, 1));
    // ciphertext onthult geen plain-fragmenten
    expect(enc.includes(plain.subarray(9, 41))).toBe(false);
    const dec = decodeCoinCore(decryptCoinFile(enc, key, 1));
    expect(dec.value).toBe(77n);
    expect(dec.serial.equals(serial)).toBe(true);
  });

  test('verkeerde key faalt (GCM tag)', () => {
    const coin = newCoin(serial, 77n, Buffer.alloc(32, 9));
    const enc = serializeEncrypted(encryptCoinFile(encodeCoinCore(coin), randomBytes(32), 1));
    expect(() => decryptCoinFile(enc, randomBytes(32), 1)).toThrow();
  });

  test('keyHint-mismatch faalt', () => {
    const coin = newCoin(serial, 77n, Buffer.alloc(32, 9));
    const key = randomBytes(32);
    const enc = serializeEncrypted(encryptCoinFile(encodeCoinCore(coin), key, 1));
    expect(() => decryptCoinFile(enc, key, 0)).toThrow(/keyHint/);
  });
});
