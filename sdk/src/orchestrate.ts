import * as spl from '@solana/spl-token';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { verifyCoinChain } from './chain';
import type { CoinCore } from './coinfile';
import { currentOwner } from './coin';
import { ObpClient } from './client';
import { SigScheme } from './constants';
import {
  appendLinksIxPair, finalizeIx, mintCoinIx, settleIx, startCheckInIx,
} from './instructions';
import { stateHash } from './layout';
import { ata, registryPda, submissionPda, vaultPda } from './accounts';
import {
  fetchConfig, fetchHead, fetchRegistry, fetchSubmission,
  OnChainConfig, RegistryStatus, SubmissionStatus,
} from './readers';

export interface CheckInEnv {
  client: ObpClient;
  payer: Keypair;
  mintAuthority: Keypair;   // voor mintTo als de bond niet dekt (devnet-conventie)
  vaultMint: PublicKey;
}

export interface CheckInOpts {
  env: CheckInEnv;
  /** De munt die gecheckt-in wordt (volledige lokale chain). */
  coin: CoinCore;
  /** Bearer die de check-in start: tekenaar van state_0-flow én bond-betalende
   *  wallet (ATA). Moet == currentOwner(coin) zijn. */
  checker: Keypair;
  /** Originele mint-recipient (bond-tracing + allowance). */
  recipient: PublicKey;
  /** Max. wachttijd (ms) voor de challenge window; default 60s. */
  maxWaitMs?: number;
}

export interface CheckInStep {
  step: string;
  signature: string;
  unitsConsumed?: number;
}

export interface CheckInReport {
  serial: string;
  steps: CheckInStep[];
  final: {
    registryStatus: number;
    submissionStatus: number;
    finalOwnerBalance: bigint;
    checkerBalance: bigint;
    vaultBalance: bigint;
  };
}

function bondOf(value: bigint, bps: number): bigint {
  return (value * BigInt(bps)) / 10000n;
}

async function tokenBal(conn: Connection, mint: PublicKey, owner: PublicKey): Promise<bigint> {
  const acc = await spl.getAccount(conn, ata(mint, owner)).catch(() => null);
  return acc ? BigInt(acc.amount) : 0n;
}

/** Idempotente, volledige check-in: start → append×k → finalize → settle.
 *  Elke stap wordt alleen uitgevoerd als de on-chain state het vereist; na
 *  elke stap re-lezen (crash-safe, M1-conventie). */
export async function runCheckIn(opts: CheckInOpts): Promise<CheckInReport> {
  const { client, payer, mintAuthority, vaultMint } = opts.env;
  const { coin, checker, recipient } = opts;
  const maxWaitMs = opts.maxWaitMs ?? 60_000;
  const serial = coin.serial;
  const report: CheckInReport = {
    serial: serial.toString('hex'),
    steps: [],
    final: { registryStatus: -1, submissionStatus: -1, finalOwnerBalance: 0n, checkerBalance: 0n, vaultBalance: 0n },
  };
  const note = (s: string) => { report.steps.push({ step: s, signature: '' }); };

  if (coin.sigScheme !== SigScheme.Ed25519) throw new Error('M2: alleen sigScheme Ed25519 (0)');
  const chain = verifyCoinChain(coin);
  if (!chain.ok) throw new Error('keten ongeldig: ' + chain.errors.join('; '));
  // `checker` is een VRIJE rol (programma dwingt geen owner-gelijkheid): de
  // bearer die de check-in start en de bond betaalt. De WAARDE gaat naar
  // final_owner = owner(laatste state) — dat wordt on-chain gecontroleerd
  // (submission.final_owner vs currentOwner(coin)).
  const coinFinalOwner = new PublicKey(currentOwner(coin));

  const cfg: OnChainConfig | null = await fetchConfig(client.conn);
  if (!cfg) throw new Error('config ontbreekt');
  const reg = await fetchRegistry(client.conn, serial);
  if (!reg) throw new Error('registry ontbreekt — mint_coin eerst');
  if (reg.status === RegistryStatus.SPENT) throw new Error('coin al SPENT (settle klaar)');
  if (reg.status !== RegistryStatus.ACTIVE) throw new Error('registry status ' + reg.status + ' (verwacht ACTIVE=0)');
  if (!reg.recipient.equals(recipient)) throw new Error('registry.recipient != opts.recipient');
  // On-chain anker (I4): H(state_0) moet met de registry meekomen.
  if (!stateHash(coin.states[0]).equals(reg.genesisStateHash)) {
    throw new Error('H(state_0) != registry.genesis_state_hash — mint mismatch');
  }
  const bond = bondOf(reg.value, cfg.bondMultiplierBps);

  // 1) Bond-dekking van de checker: ATA (getOrCreate, bestaat anders niet) +
  //    mintTo indien nodig (devnet-conventie; mintAuthATA moet bestaan — fund_vault).
  const checkerATA = await spl.getOrCreateAssociatedTokenAccount(client.conn, payer, vaultMint, checker.publicKey, true, 'confirmed');
  let checkerBal = BigInt(checkerATA.amount);
  if (checkerBal < bond + 50n) {
    const need = bond + 500n - checkerBal;
    note('mintTo ' + need.toString() + ' naar checker (bond-dekking)');
    await spl.mintTo(client.conn, payer, vaultMint, checkerATA.address, mintAuthority, Number(need), [], { commitment: 'confirmed' });
  }

  // 2) start_check_in (als submission ontbreekt)
  let sub = await fetchSubmission(client.conn, serial, 0) ?? await fetchSubmission(client.conn, serial, 1);
  if (!sub) {
    // escrow ATA (owner = submission-PDA, off-curve) moet vóór start_check_in
    // bestaan: het programma verwacht een geïnitieerde TokenAccount (T6: amount==0).
    const [subPda0] = submissionPda(serial, 0);
    await spl.getOrCreateAssociatedTokenAccount(client.conn, payer, vaultMint, subPda0, true, 'confirmed');
    const r = await client.send('start_check_in', startCheckInIx(serial, 0, coin.states[0], recipient, payer.publicKey, vaultMint), [checker], payer);
    report.steps.push({ step: 'start_check_in', signature: r.signature, unitsConsumed: r.unitsConsumed });
    sub = (await fetchSubmission(client.conn, serial, 0))!;
  } else {
    note('start_check_in (overgeslagen, submission bestaat; status=' + sub.status + ')');
  }
  if (sub.status === SubmissionStatus.WON) {
    note('submission al WON — nothing te doen');
  }

  // 3) append_links tot states_len == coin.states.length (batches ≤ maxLinksPerTx)
  for (;;) {
    sub = (await fetchSubmission(client.conn, serial, sub.attempt))!;
    if (sub.statesLen >= coin.states.length) break;
    if (sub.status === SubmissionStatus.PENDING) throw new Error('submission PENDING maar chain onvolledig — inconsistent');
    const headOwner = sub.states[sub.statesLen - 1].subarray(40, 72);
    const headOwnerBuf = Buffer.from(headOwner);
    const maxBatch = Math.min(cfg.maxLinksPerTx, coin.states.length - sub.statesLen);
    const links: { state: Buffer; sig: Buffer }[] = [];
    for (let i = 0; i < maxBatch; i++) {
      links.push({ state: coin.states[sub.statesLen + i], sig: coin.sigs[sub.statesLen - 1 + i] });
    }
    const [edIx, appIx] = appendLinksIxPair(serial, sub.attempt, {
      headOwner: headOwnerBuf,
      links,
      lastHash: stateHash(coin.states[coin.states.length - 1]),
    });
    const r = await client.send('append_links×' + maxBatch, [edIx, appIx], [], payer);
    report.steps.push({ step: 'append_links×' + maxBatch, signature: r.signature, unitsConsumed: r.unitsConsumed });
  }

  // 4) finalize (als nog niet PENDING) — token-accounts uit ON-CHAIN state
  sub = (await fetchSubmission(client.conn, serial, sub.attempt))!;
  if (!sub.finalOwner.equals(coinFinalOwner)) {
    throw new Error('on-chain submission.final_owner != currentOwner(coin) — chain mismatch');
  }
  if (sub.status !== SubmissionStatus.PENDING) {
    if (sub.status === SubmissionStatus.WON) {
      note('submission WON — finalize overgeslagen');
    } else {
      // winner ATA (final_owner) moet bestaan vóór de value-transfer.
      await spl.getOrCreateAssociatedTokenAccount(client.conn, payer, vaultMint, sub.finalOwner, true, 'confirmed');
      const r = await client.send(
        'finalize_check_in',
        finalizeIx(serial, sub.attempt, 1 - sub.attempt, recipient, sub.checker, sub.finalOwner, vaultMint, payer.publicKey),
        [], payer,
      );
      report.steps.push({ step: 'finalize_check_in', signature: r.signature, unitsConsumed: r.unitsConsumed });
      sub = (await fetchSubmission(client.conn, serial, sub.attempt))!;
    }
  } else {
    note('finalize (overgeslagen, al PENDING)');
  }

  // 5) settle na de challenge window (slots, geen wall-clock — T7)
  if (sub.status === SubmissionStatus.PENDING) {
    const head = (await fetchHead(client.conn, serial))!;
    const deadlineSlot = head.pendingSinceSlot + cfg.challengeWindowSlots;
    const t0 = Date.now();
    for (;;) {
      // web3.js 1.99: getSlot() -> Promise<number> (geen {value}-object).
      const slot = await client.conn.getSlot();
      if (slot >= deadlineSlot) break;
      if (Date.now() - t0 > maxWaitMs) throw new Error('window verlopen niet binnen maxWaitMs (slot ' + slot + ' < ' + deadlineSlot + ')');
      await new Promise((r) => setTimeout(r, 3000));
    }
    const r = await client.send(
      'settle',
      settleIx(serial, sub.attempt, 1 - sub.attempt, recipient, sub.checker, sub.finalOwner, vaultMint, payer.publicKey),
      [], payer,
    );
    report.steps.push({ step: 'settle', signature: r.signature, unitsConsumed: r.unitsConsumed });
  }

  // 6) Eindstate (bewijs)
  const reg2 = (await fetchRegistry(client.conn, serial))!;
  const sub2 = (await fetchSubmission(client.conn, serial, sub.attempt))!;
  report.final = {
    registryStatus: reg2.status,
    submissionStatus: sub2.status,
    finalOwnerBalance: await tokenBal(client.conn, vaultMint, sub2.finalOwner),
    checkerBalance: await tokenBal(client.conn, vaultMint, checker.publicKey),
    vaultBalance: await tokenBal(client.conn, vaultMint, vaultPda()[0]),
  };
  return report;
}
