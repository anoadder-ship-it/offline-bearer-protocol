import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { COIN_ENCRYPTED_MAGIC, COINFILE_VERSION } from './constants';
import { asBuf } from './layout';

/** Gecodeerde CoinFile-wrapper v1 (spec §4):
 *    @0  magic "OBE1" (4)
 *    @4  version u16 (=1)
 *    @6  keyHint u8   (0 = passkey-afgeleid, 1 = device-lokaal — Q7)
 *    @7  nonce (12)
 *    @19 ctLen u32 LE
 *    @23 ciphertext (AES-256-GCM over de CoinCore)
 *        tag (16)
 *  AAD = "OBP-COINFILE-V1" (statisch; de GCM-tag bindt reeds de ciphertext
 *  aan de key — serial in de AAD was redundant en dwong extra metadata).
 *  Bedoeling: privacy + verliesbescherming. Het bestand blijft een bearer-
 *  instrument: wie de key heeft, kan check-in doen (spec §5 threat model). */
export interface EncryptedCoinFile {
  keyHint: number;
  nonce: Buffer;
  ciphertext: Buffer;
  tag: Buffer;
}

export function encryptCoinFile(plainCore: Buffer | Uint8Array, key: Buffer | Uint8Array, keyHint = 1): EncryptedCoinFile {
  plainCore = asBuf(plainCore); key = asBuf(key);
  if (key.length !== 32) throw new Error('key moet 32 bytes zijn (AES-256)');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  cipher.setAAD(Buffer.from('OBP-COINFILE-V1', 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plainCore), cipher.final()]);
  const tag = cipher.getAuthTag();
  const out = Buffer.alloc(4 + 2 + 1 + 12 + 4 + ciphertext.length + 16);
  let o = 0;
  COIN_ENCRYPTED_MAGIC.copy(out, o); o += 4;
  out.writeUInt16LE(COINFILE_VERSION, o); o += 2;
  out.writeUInt8(keyHint, o); o += 1;
  nonce.copy(out, o); o += 12;
  out.writeUInt32LE(ciphertext.length, o); o += 4;
  ciphertext.copy(out, o); o += ciphertext.length;
  tag.copy(out, o);
  return { keyHint, nonce, ciphertext, tag };
}

export function serializeEncrypted(e: EncryptedCoinFile): Buffer {
  const out = Buffer.alloc(4 + 2 + 1 + 12 + 4 + e.ciphertext.length + 16);
  let o = 0;
  COIN_ENCRYPTED_MAGIC.copy(out, o); o += 4;
  out.writeUInt16LE(COINFILE_VERSION, o); o += 2;
  out.writeUInt8(e.keyHint, o); o += 1;
  e.nonce.copy(out, o); o += 12;
  out.writeUInt32LE(e.ciphertext.length, o); o += 4;
  e.ciphertext.copy(out, o); o += e.ciphertext.length;
  e.tag.copy(out, o);
  return out;
}

export function parseEncrypted(input: Buffer | Uint8Array): EncryptedCoinFile {
  const b: Buffer = asBuf(input);
  if (!COIN_ENCRYPTED_MAGIC.equals(b.subarray(0, 4))) throw new Error('encrypted magic mismatch');
  if (b.readUInt16LE(4) !== COINFILE_VERSION) throw new Error('encrypted versie onbekend');
  const keyHint = b.readUInt8(6);
  const nonce = Buffer.from(b.subarray(7, 19));
  const ctLen = b.readUInt32LE(19);
  const ciphertext = Buffer.from(b.subarray(23, 23 + ctLen));
  const tag = Buffer.from(b.subarray(23 + ctLen, 23 + ctLen + 16));
  if (b.length !== 23 + ctLen + 16) throw new Error('encrypted grootte inconsistent');
  return { keyHint, nonce, ciphertext, tag };
}

export function decryptCoinFile(buf: Buffer | Uint8Array, key: Buffer | Uint8Array, keyHint: number): Buffer {
  const e = parseEncrypted(asBuf(buf));
  key = asBuf(key);
  if (e.keyHint !== keyHint) throw new Error('keyHint mismatch (' + e.keyHint + ' != ' + keyHint + ')');
  const d = createDecipheriv('aes-256-gcm', key, e.nonce, { authTagLength: 16 });
  d.setAAD(Buffer.from('OBP-COINFILE-V1', 'utf8'));
  d.setAuthTag(e.tag);
  return Buffer.concat([d.update(e.ciphertext), d.final()]);
}
