// M2-acceptatie: de volledige OBP-lus op devnet aangedreven door de SDK
// (nieuwe coin "obp-m2-sdk-coin-001", value 100, 2 offline transfers,
// volledige check-in: start → append×2 → finalize → settle).
// Gebruik: bun scripts/sdk-live-run.ts
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import { sha256 } from '@noble/hashes/sha256';
import { DEVNET_URL, PROGRAM_ID } from '../src/constants';
import { newCoin, appendLink, ed25519Signer, currentOwner } from '../src/coin';
import { stateHash } from '../src/layout';
import { configPda, registryPda, vaultPda, feePda, ata } from '../src/accounts';
import { initIx, pingIx, fundVaultIx, mintCoinIx } from '../src/instructions';
import { fetchConfig, fetchRegistry, RegistryStatus } from '../src/readers';
import { ObpClient } from '../src/client';
import { runCheckIn } from '../src/orchestrate';

const M2_SEED = Buffer.from('obp-smoke-deterministic-seed-2025'); // zelfde mint-authority als M1 (config is singleton)
const derive = (suffix: string) =>
  Keypair.fromSeed(sha256(Buffer.concat([M2_SEED, Buffer.from(suffix, 'utf8')])));

const M2_SERIAL = sha256(Buffer.from('obp-m2-sdk-coin-001'));
const M2_VALUE = 100n;
void PROGRAM_ID; void configPda; void registryPda; void feePda; void initIx; void fundVaultIx;

async function main() {
  const fs = await import('node:fs');
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(process.env.HOME + '/.config/solana/id.json', 'utf8'))),
  );
  const mintAuthority = derive('mint-authority');
  const recipient = derive('recipient');
  const holder2 = derive('holder2');
  const holder3 = derive('holder3');
  const client = new ObpClient(new Connection(DEVNET_URL, 'confirmed'), { onLog: (m) => console.log('  ', m) });

  // 0) config check (bestaat uit M1)
  const cfg = await fetchConfig(client.conn);
  if (!cfg) throw new Error('config ontbreekt');
  console.log('config: vaultMint', cfg.vaultMint.toBase58(), '| bps', cfg.bondMultiplierBps, '| window', cfg.challengeWindowSlots.toString(), '| maxLinks', cfg.maxLinksPerTx);
  const vaultMint = cfg.vaultMint;

  // 1) ping (programma levend)
  await client.send('ping', pingIx(), [], payer);

  // 2) vault-funding check (M1 liet 900; coin kost 100)
  const vaultBal = await (async () => {
    const acc = await spl.getAccount(client.conn, ata(vaultMint, vaultPda()[0])).catch(() => null);
    return acc ? BigInt(acc.amount) : 0n;
  })();
  console.log('vault balance:', vaultBal.toString());
  if (vaultBal < 100n) throw new Error('vault onder de 100 — handmatig fund_vault');

  // 3) mint_coin (als registry ontbreekt) — mintTx per M1-conventie
  let reg = await fetchRegistry(client.conn, M2_SERIAL);
  if (!reg) {
    const state0 = newCoin(M2_SERIAL, M2_VALUE, recipient.publicKey.toBytes()).states[0];
    const genesisHash = stateHash(state0);
    const mintTx = Buffer.concat([
      sha256(Buffer.concat([M2_SERIAL, u64(M2_VALUE), recipient.publicKey.toBytes()])),
      sha256(Buffer.concat([u64(M2_VALUE), recipient.publicKey.toBytes(), M2_SERIAL])),
    ]);
    await client.send('mint_coin', mintCoinIx(M2_SERIAL, M2_VALUE, recipient.publicKey, genesisHash, mintTx, mintAuthority.publicKey, payer.publicKey, vaultMint), [mintAuthority], payer);
    reg = (await fetchRegistry(client.conn, M2_SERIAL))!;
    console.log('registry gecreëerd, status', reg.status);
  } else if (reg.status === RegistryStatus.SPENT) {
    throw new Error('M2-coin al SPENT — kies een nieuwe serial of reset devnet-state');
  }

  // 4) coin bouwen: 2 offline transfers (recipient → holder2 → holder3)
  let coin = newCoin(M2_SERIAL, M2_VALUE, recipient.publicKey.toBytes());
  coin = appendLink(coin, ed25519Signer(recipient.secretKey.subarray(0, 32)), holder2.publicKey.toBytes());
  coin = appendLink(coin, ed25519Signer(holder2.secretKey.subarray(0, 32)), holder3.publicKey.toBytes());
  console.log('coin: n=' + coin.states.length + ' states, owner=' + new PublicKey(currentOwner(coin)).toBase58());

  // 5) volledige check-in via de SDK (idempotent; window ~10 slots ≈ 25s)
  const t0 = Date.now();
  const report = await runCheckIn({
    env: { client, payer, mintAuthority, vaultMint },
    coin,
    // M1-conventie: de mint-recipient (eigenaar state0) start de check-in en
    // betaalt de bond; de WAARDE gaat naar final_owner = holder3 (laatst getekend).
    checker: recipient,
    recipient: recipient.publicKey,
    maxWaitMs: 90_000,
  });
  console.log('--- M2 LIVE RUN REPORT ---');
  console.log('serial:', report.serial);
  for (const s of report.steps) console.log(' step:', s.step, s.signature ? s.signature.slice(0, 20) + (s.unitsConsumed ? ' CU=' + s.unitsConsumed : '') : '');
  console.log('final:', JSON.stringify(report.final, (k, v) => (typeof v === 'bigint' ? v.toString() : v)));
  console.log('totaal: ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
}

function u64(v: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; }
main().catch((e) => { console.error('FAIL:', e); process.exit(1); });
