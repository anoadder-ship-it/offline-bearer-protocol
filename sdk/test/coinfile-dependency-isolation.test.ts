import { describe, expect, test } from 'bun:test';
import * as path from 'node:path';

// Bewaakt de aanname achter de Dependabot-dispositie in STATUS.md sectie
// 17.3 (bigint-buffer, CVE-2025-3194, tolerable_risk): het CoinFile-
// decodeerpad — het enige plek in dit project waar écht vijandige,
// bearer-aangeleverde bytes binnenkomen — gebruikt native
// Buffer.readBigUInt64LE(), niet bigint-buffer/@solana/buffer-layout-
// utils. Als een latere wijziging dat pad ooit (direct of transitief) aan
// bigint-buffer koppelt, moet die classificatie opnieuw beoordeeld
// worden — deze test faalt dan bewust, in plaats van dat het stilzwijgend
// gebeurt.
//
// Introspectiemethode: `require.cache` bleek in Bun leeg te blijven voor
// modules die via top-level `import` binnenkomen (empirisch getest, niet
// aangenomen) — Bun's ESM-loader loopt niet via de CJS-registratie. In
// plaats daarvan gebruikt deze test Bun's eigen bundler (`Bun.build`) om
// de daadwerkelijke, volledige (transitieve) import-graaf van elk
// bestand statisch op te lossen, en doorzoekt de gebundelde output op de
// karakteristieke `node_modules/<pakket>/`-padcommentaren die Bun in elke
// geïnclude module achterlaat. Dat is minstens zo sterk als een runtime-
// registratie (vangt élk mogelijk pad, niet alleen wat één testrun
// toevallig raakt) en is negatief-gecontroleerd: dezelfde methode
// gebundeld op `sdk/src/accounts.ts` (dat wél `@solana/spl-token`
// gebruikt) toont beide markers wél — de check onderscheidt dus
// daadwerkelijk aanwezig van afwezig, in plaats van altijd "afwezig" te
// melden.

const SRC = path.join(import.meta.dir, '..', 'src');

const FORBIDDEN = ['node_modules/bigint-buffer/', 'node_modules/@solana/buffer-layout-utils/'];

async function bundledGraphText(entryFile: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [path.join(SRC, entryFile)],
    target: 'bun',
  });
  if (!result.success) {
    throw new Error(`Bun.build faalde voor ${entryFile}: ${JSON.stringify(result.logs)}`);
  }
  return result.outputs[0].text();
}

describe('CoinFile-decodeerpad blijft bigint-buffer-vrij (STATUS.md sectie 17.3)', () => {
  const targets = ['coinfile.ts', 'layout.ts', 'wrapper.ts'];

  for (const file of targets) {
    test(`${file}: bigint-buffer / @solana/buffer-layout-utils zitten niet in de import-graaf`, async () => {
      const bundle = await bundledGraphText(file);
      for (const marker of FORBIDDEN) {
        expect(
          bundle.includes(marker),
          `${file} bundelt onverwacht "${marker}" — de CoinFile-dispositie in STATUS.md sectie 17.3 moet herzien worden`
        ).toBe(false);
      }
    });
  }

  test('decodeCoinCore/decodeState/encodeState/stateHash/parseEncrypted werken daadwerkelijk (niet alleen de graaf-analyse)', async () => {
    const { decodeCoinCore, encodeCoinCore } = await import('../src/coinfile');
    const { decodeState, encodeState, stateHash } = await import('../src/layout');
    const { parseEncrypted, serializeEncrypted, encryptCoinFile } = await import('../src/wrapper');
    const { newCoin } = await import('../src/coin');

    const serial = Buffer.alloc(32, 0x01);
    const coin = newCoin(serial, 100n, Buffer.alloc(32, 0x02));
    const encoded = encodeCoinCore(coin);
    const decoded = decodeCoinCore(encoded);
    expect(decoded.value).toBe(100n);
    expect(decoded.states.length).toBe(1);

    const h = stateHash(coin.states[0]);
    const s1 = encodeState(serial, 100n, Buffer.alloc(32, 0x03), h);
    const decodedState = decodeState(s1);
    expect(decodedState.value).toBe(100n);
    expect(decodedState.prevHash.equals(h)).toBe(true);

    const key = Buffer.alloc(32, 0x09);
    const encrypted = encryptCoinFile(encoded, key);
    const raw = serializeEncrypted(encrypted);
    const reparsed = parseEncrypted(raw);
    expect(reparsed.keyHint).toBe(1);
    expect(reparsed.ciphertext.equals(encrypted.ciphertext)).toBe(true);
  });
});
