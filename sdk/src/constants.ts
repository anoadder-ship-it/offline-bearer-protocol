import { PublicKey } from '@solana/web3.js';

/** OBP-core programma (devnet, SBPF v3 — STATUS sectie 9.2). */
// M4.1: env-override (PQ-testinstance etc.); default = canoniek v2-proграмма.
export const PROGRAM_ID = new PublicKey(process.env.OBP_PROGRAM_ID || '8M5ruFEhFfenHSkjsUcf2FaZFKKKamJEHWRCSfttNHi6');
export const DEVNET_URL = 'https://api.devnet.solana.com';
export const ED25519_PRECOMPILE_ID = new PublicKey('Ed25519SigVerify111111111111111111111111111');

export const STATE_SIZE = 104;
export const SIG_SIZE = 64;
export const SERIAL_SIZE = 32;
export const MAX_LINKS_PER_PRECOMPILE = 12;

// CoinFile v1 (docs/coinfile-spec-v1.md)
export const COIN_MAGIC = Buffer.from('OBC1', 'utf8');
export const COIN_ENCRYPTED_MAGIC = Buffer.from('OBE1', 'utf8');
export const COINFILE_VERSION = 1;

// Mirror van config.sig_scheme (SPEC B8): 0=Ed25519 (M1/M2), 1=MLDSA44, 2=SLHDSA128f (M4).
export const SigScheme = { Ed25519: 0, MlDsa44: 1, SlhDsa128f: 2 } as const;
export type SigScheme = (typeof SigScheme)[keyof typeof SigScheme];
