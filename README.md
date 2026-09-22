# offline-bearer-protocol (OBP)

Bearer coins die je **volledig offline** kunt halen (op een stick of device),
**offline kunt overdragen** (zonder netwerk), en daarna **veilig weer kunt
checken-in** — zonder double-spend: elke double-spend is of onmogelijk
(nullifier) of economisch begrensd en gecompenseerd (verplichte bonds ≥ 100%
van de muntwaarde).

**Status:** M4.1.1 — program (Anchor, SBPF v3 + post-quantum), TS-SDK,
CoinFile v1, E2E-bewijsmatrix op devnet (14/14 + PQ-acceptatie 8/8) en
CU-metingen (Track 1 on-chain; Track 2 v1-gemeten). Zie `STATUS.md`
(eerste bestand bij hervatten van het werk).

**Licentie:** Apache-2.0 — zie `LICENSE`. **Security:** zie `SECURITY.md`.

**Canonek programma (devnet):** `8M5ruFEhFfenHSkjsUcf2FaZFKKKamJEHWRCSfttNHi6`
(SBPF v3, met PQ-instructies; `OBP_PROGRAM_ID` env-override in alle
scripts). Upgrade authority en mint authority leven **buiten de repo**
onder `~/.config/offline-bearer-protocol/` (STATUS.md §4) — geen private
keys in deze git-repo.

## Leesvolgorde

1. [`STATUS.md`](STATUS.md) — projecttoestand, beslissingen (B/D-serie),
   bewijs, openstaande vragen (Q-serie). Eerste bestand bij hervatten.
2. [`SPEC.md`](SPEC.md) — het protocol: munt-formaat, lokale chain,
   check-in state machine, double-spend-resolutietabel, invariants,
   threat model.
3. [`docs/coinfile-spec-v1.md`](docs/coinfile-spec-v1.md) — het offline
   munt-bestand (format v1).
4. [`docs/obp-analysis.md`](docs/obp-analysis.md) — de herkomst: analyse
   van de oorspronkelijke Grok-chat, inclusief de zes correcties (C1–C6).

## Structuur

| Pad | Inhoud |
|---|---|
| `programs/obp-core/` | Het Anchor-programma (M1-instructieset + M4 PQ: `set_pq_key`, `pq_write_data`, `pq_benchmark`) |
| `sdk/` | TS-SDK (bun): CoinFile-codec, ketenverificatie (incl. PQ), instruction-builders, idempotente check-in-orchestratie, `mldsa-wasm` |
| `sdk/scripts/` | Live-bewijs: `e2e-matrix.ts` (E1–E14), `e2e-matrix-pq.ts` (F2xx), `track2-cu-benchmark.ts` (M4.1.1) |
| `sdk/evidence/` + `sdk/fixtures/` | Bewijs-logbestanden en deterministische testvectors (M4) |
| `tests/smoke-m1.ts` | M1-full-protocol smoke (via `anchor test`; idempotent) |
| `smoke-m1-*.ts` | LEGACY M1-artefacten (parameteriseerbaar via `OBP_PROGRAM_ID`) |
| `build-sbf.sh` | SBF-build met platform-tools v1.52-pin (STATUS.md §5) |
| `.github/workflows/` | CI: `cargo build` + `cargo test` (Rust) |
| `SECURITY.md` | Kwetsbaarheid melden, scope, vertrouwensgrenzen |
| `LICENSE` | Apache-2.0 (2026 Michel) |

## Trust-basis fase 1 (expliciet, geen aannames)

- **A1:** Solana-consensus (finalized = definitief).
- **A2:** het programma + upgrade authority (fase 1: één keypair, twee
  backups buiten de repo; multisig = M8).
- **A3:** de mint authority (separaat van de upgrade authority) munt
  coins, begrensd door de vault — 1:1 backende, invariant I2
  machine-checkbaar.
- **A4 (M4):** PQ-signalering via `config.sig_scheme` + per-coin raw
  public key (FIPS 203/205); fase 1 = signalering + off-chain verificatie
  (SDK), Track 2 (on-chain verificatie) = CU-budget-vraag (STATUS §13/§15).

Volledige trust-tabel en threat model: `SPEC.md` §2 en §9.

## Werkwijze

AI-gesupported ontwikkeling (Qwen 3.8 27B uncensored via orcarouter; MCP-tools: Solana-RPC, GitHub, file-system, shell, zoekopdrachten). Elke claim in `STATUS.md` is reproduceerbaar via de scripts in deze repo — de AI is een uitvoerder, het bewijs is het criterium.
