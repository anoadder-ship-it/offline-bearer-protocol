// Haalt de M1-devnet-coin op (submission + registry) en pindt de bytes als
// testvector in fixtures/m1-coin.json. Gebruik: bun scripts/fetch-fixture.ts
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Connection } from '@solana/web3.js';
import { sha256 } from '@noble/hashes/sha256';
import { DEVNET_URL } from '../src/constants';
import { registryPda, submissionPda } from '../src/accounts';

const M1_SERIAL = sha256(Buffer.from('obp-m1-smoke-coin-001'));

async function main() {
  const conn = new Connection(DEVNET_URL, 'confirmed');
  const [regPda] = registryPda(M1_SERIAL);
  const [subPda] = submissionPda(M1_SERIAL, 0);
  const [regAcc, subAcc] = await Promise.all([
    conn.getAccountInfo(regPda),
    conn.getAccountInfo(subPda),
  ]);
  if (!regAcc || !subAcc) throw new Error('M1-accounts ontbreken op devnet (reset?)');
  const fixture = {
    source: 'devnet 9D2fU2g13Y55uvk6kLiHRknxd6rzu84nsHy6gnjTLqzt',
    fetchedAt: new Date().toISOString(),
    serialHex: M1_SERIAL.toString('hex'),
    value: 100,
    registry: { address: regPda.toBase58(), b64: Buffer.from(regAcc.data).toString('base64') },
    submission: { address: subPda.toBase58(), b64: Buffer.from(subAcc.data).toString('base64') },
  };
  const out = path.join(import.meta.dir, '..', 'fixtures', 'm1-coin.json');
  fs.writeFileSync(out, JSON.stringify(fixture, null, 2));
  console.log('fixture geschreven:', out);
  console.log('registry @', regPda.toBase58(), '| submission @', subPda.toBase58());
}
main().catch((e) => { console.error(e); process.exit(1); });
