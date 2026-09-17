import { Connection, Keypair, Transaction, TransactionInstruction } from '@solana/web3.js';

export interface SendResult {
  signature: string;
  /** CU-consumptie via simulateTransaction vóór verzenden (evidence-cultuur). */
  unitsConsumed?: number;
}

export interface ObpClientOpts {
  url?: string;
  max429Retries?: number;
  onLog?: (msg: string) => void;
}

/** Connection-wrapper met: simulate-eerst (CU + vroege fout), 429-retry
 *  (devnet-rate-limit, gemeten M1), confirm. */
export class ObpClient {
  readonly conn: Connection;
  private readonly maxRetries: number;
  private readonly log: (m: string) => void;

  constructor(connOrUrl: Connection | string, opts: ObpClientOpts = {}) {
    this.conn = typeof connOrUrl === 'string' ? new Connection(connOrUrl, 'confirmed') : connOrUrl;
    this.maxRetries = opts.max429Retries ?? 5;
    this.log = opts.onLog ?? (() => {});
  }

  async send(
    label: string,
    ix: TransactionInstruction | TransactionInstruction[],
    signers: Keypair[],
    payer: Keypair,
  ): Promise<SendResult> {
    let attempts = 0;
    for (;;) {
      try {
        const tx = new Transaction();
        const bh = await this.conn.getLatestBlockhash();
        tx.recentBlockhash = bh.blockhash;
        tx.feePayer = payer.publicKey;
        const list = Array.isArray(ix) ? ix : [ix];
        for (const i of list) tx.add(i);
        tx.sign(payer, ...signers);
        const raw = tx.serialize();
        // web3.js 1.99: simulateTransaction verwelkomt een Transaction/Message-object,
        // geen ruwe Buffer (andere route: Transaction.populate → message.header undefined).
        // Intern wordt het object gekopieerd → onze getekende `raw` blijft onaangetast.
        const sim = await this.conn.simulateTransaction(tx);
        if (sim.value.err) {
          throw new Error(label + ': simulate-fout: ' + JSON.stringify(sim.value.err));
        }
        const signature = await this.conn.sendRawTransaction(raw, { skipPreflight: false });
        await this.conn.confirmTransaction({ signature, ...bh }, 'confirmed');
        this.log(label + ': OK ' + signature.slice(0, 16) + (sim.value.unitsConsumed ? ' (CU=' + sim.value.unitsConsumed + ')' : ''));
        return { signature, unitsConsumed: sim.value.unitsConsumed ?? undefined };
      } catch (e) {
        const msg = String(e);
        attempts++;
        if (attempts >= this.maxRetries || !msg.includes('429')) throw e;
        this.log(label + ': 429, retry ' + attempts + '...');
        await new Promise((r) => setTimeout(r, 2000 * attempts));
      }
    }
  }
}
