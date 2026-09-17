import { Connection, PublicKey } from '@solana/web3.js';
import { allowancePda, configPda, feePda, headPda, registryPda, submissionPda, vaultPda } from './accounts';

export const RegistryStatus = { ACTIVE: 0, SPENT: 1 } as const;
export const SubmissionStatus = {
  RECEIVING: 0, SUBMITTED: 1, PENDING: 2, DISPUTED: 3, REJECTED: 4, WON: 5, LOST: 6,
} as const;

// Borsh-LE layout = disc(8) + fields. Offsets gemeten (STATUS §9; cross-check
// met de smoke-reads: config.supply@94, registry.status@184, sub.status@123,
// sub.states_len@124).
export interface OnChainConfig {
  mintAuthority: PublicKey;        // @8   (32)
  vaultMint: PublicKey;            // @40  (32)
  bondMultiplierBps: number;       // @72  (u32)
  challengeWindowSlots: bigint;    // @76  (u64)
  maxLinksPerTx: number;           // @84  (u16)
  defaultAllowance: bigint;        // @86  (u64)
  totalUnspentSupply: bigint;      // @94  (u64)
  sigScheme: number;               // @102 (u8)
  bump: number;                    // @103
}
export function parseConfig(d: Buffer): OnChainConfig {
  return {
    mintAuthority: new PublicKey(d.subarray(8, 40)),
    vaultMint: new PublicKey(d.subarray(40, 72)),
    bondMultiplierBps: d.readUInt32LE(72),
    challengeWindowSlots: d.readBigUInt64LE(76),
    maxLinksPerTx: d.readUInt16LE(84),
    defaultAllowance: d.readBigUInt64LE(86),
    totalUnspentSupply: d.readBigUInt64LE(94),
    sigScheme: d.readUInt8(102),
    bump: d.readUInt8(103),
  };
}

export interface OnChainRegistry {
  serial: Buffer;              // @8   (32)
  value: bigint;               // @40  (u64)
  genesisStateHash: Buffer;    // @48  (32) — H(state_0), on-chain anker
  mintSlot: bigint;            // @80  (u64)
  mintTx: Buffer;              // @88  (64)
  recipient: PublicKey;        // @152 (32)
  status: number;              // @184 (u8)
  submissionsCount: number;    // @185 (u8)
  bump: number;                // @186
}
export function parseRegistry(d: Buffer): OnChainRegistry {
  return {
    serial: Buffer.from(d.subarray(8, 40)),
    value: d.readBigUInt64LE(40),
    genesisStateHash: Buffer.from(d.subarray(48, 80)),
    mintSlot: d.readBigUInt64LE(80),
    mintTx: Buffer.from(d.subarray(88, 152)),
    recipient: new PublicKey(d.subarray(152, 184)),
    status: d.readUInt8(184),
    submissionsCount: d.readUInt8(185),
    bump: d.readUInt8(186),
  };
}

export interface OnChainHead {
  set: boolean;                // @8   (u8)
  headState: Buffer;           // @9   (104)
  headAttempt: number;         // @113 (u8)
  headStatesLen: number;       // @114 (u16)
  pendingSinceSlot: bigint;    // @116 (u64)
  bump: number;                // @124
}
export function parseHead(d: Buffer): OnChainHead {
  return {
    set: d.readUInt8(8) === 1,
    headState: Buffer.from(d.subarray(9, 113)),
    headAttempt: d.readUInt8(113),
    headStatesLen: d.readUInt16LE(114),
    pendingSinceSlot: d.readBigUInt64LE(116),
    bump: d.readUInt8(124),
  };
}

export interface OnChainSubmission {
  serial: Buffer;              // @8   (32)
  attempt: number;             // @40  (u8)
  checker: PublicKey;          // @41  (32)
  finalOwner: PublicKey;       // @73  (32)
  linksCount: number;          // @105 (u16)
  startedSlot: bigint;         // @107 (u64)
  finalizedSlot: bigint;       // @115 (u64)
  status: number;              // @123 (u8)
  statesLen: number;           // @124 (u16)
  states: Buffer[];            // @126 (MAX 8 × 104)
  bump: number;                // @958
}
export function parseSubmission(d: Buffer): OnChainSubmission {
  const n = d.readUInt16LE(124);
  const states: Buffer[] = [];
  for (let i = 0; i < n; i++) states.push(Buffer.from(d.subarray(126 + i * 104, 126 + (i + 1) * 104)));
  return {
    serial: Buffer.from(d.subarray(8, 40)),
    attempt: d.readUInt8(40),
    checker: new PublicKey(d.subarray(41, 73)),
    finalOwner: new PublicKey(d.subarray(73, 105)),
    linksCount: d.readUInt16LE(105),
    startedSlot: d.readBigUInt64LE(107),
    finalizedSlot: d.readBigUInt64LE(115),
    status: d.readUInt8(123),
    statesLen: n,
    states,
    // bump = laatste byte (robust voor MAX_SUBMISSION_STATES; M1: MAX=4 → LEN=543)
    bump: d.readUInt8(d.length - 1),
  };
}

export interface OnChainAllowance {
  cap: bigint;         // @8  (u64)
  committed: bigint;   // @16 (u64)
  initialized: boolean;// @24 (u8)
  bump: number;        // @25
}
export function parseAllowance(d: Buffer): OnChainAllowance {
  return {
    cap: d.readBigUInt64LE(8),
    committed: d.readBigUInt64LE(16),
    initialized: d.readUInt8(24) === 1,
    bump: d.readUInt8(25),
  };
}

async function fetchData(conn: Connection, pda: PublicKey): Promise<Buffer | null> {
  const acc = await conn.getAccountInfo(pda);
  return acc ? Buffer.from(acc.data) : null;
}

export const fetchConfig = async (conn: Connection) => (async () => {
  const d = await fetchData(conn, configPda()[0]);
  return d ? parseConfig(d) : null;
})();
export const fetchRegistry = async (conn: Connection, serial: Buffer) => (async () => {
  const d = await fetchData(conn, registryPda(serial)[0]);
  return d ? parseRegistry(d) : null;
})();
export const fetchHead = async (conn: Connection, serial: Buffer) => (async () => {
  const d = await fetchData(conn, headPda(serial)[0]);
  return d ? parseHead(d) : null;
})();
export const fetchSubmission = async (conn: Connection, serial: Buffer, attempt: number) => (async () => {
  const d = await fetchData(conn, submissionPda(serial, attempt)[0]);
  return d ? parseSubmission(d) : null;
})();
export const fetchAllowance = async (conn: Connection, recipient: PublicKey) => (async () => {
  const d = await fetchData(conn, allowancePda(recipient)[0]);
  return d ? parseAllowance(d) : null;
})();
