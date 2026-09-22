# offline-bearer-protocol (OBP)

Bearer coins die je **volledig offline** kunt halen (op een stick of device),
**offline kunt overdragen** (zonder netwerk), en daarna **veilig weer kunt
checken-in** — zonder double-spend: elke double-spend is of onmogelijk
(nullifier) of economisch begrensd en gecompenseerd (verplichte bonds ≥ 100%
van de muntwaarde).

> **Experimenteel — alleen devnet — niet voor echte waarde.** OBP is een
> onderzoeksprototype. Het draait uitsluitend op Solana-devnet (testgeld zonder
> waarde), is niet geaudit en is niet productieklaar. Gebruik het niet met
> echte fondsen.

**Status:** een werkend prototype op devnet, bestaande uit:

- het on-chain programma (Anchor/Rust) dat check-ins, double-spend-resolutie
  en bonds afdwingt, inclusief optionele post-quantum-handtekeningen (ML-DSA);
- een TypeScript-SDK en het offline munt-bestandsformaat (CoinFile v1);
- een end-to-end testreeks op devnet: alle 14 protocolscenario's slagen
  (E-serie), plus 8/8 post-quantum-acceptatietests;
- metingen van de rekenkosten (compute units, CU) van post-quantum-verificatie.

Het project staat bij mijlpaal M4 van M0–M8 (zie *Begrippen* hieronder).
Het volledige werklogboek staat in `STATUS.md`.

**Licentie:** Apache-2.0 — zie `LICENSE`. **Security:** zie `SECURITY.md`.

**Canoniek programma (devnet):** `8M5ruFEhFfenHSkjsUcf2FaZFKKKamJEHWRCSfttNHi6`
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
| `tests/smoke-m1.ts` | M1-full-protocol smoke (`bun tests/smoke-m1.ts` = de root-`npm test`-gate; idempotent) |
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
  public key (FIPS 204/205); fase 1 = signalering + off-chain verificatie
  (SDK), Track 2 (on-chain verificatie) = CU-budget-vraag (STATUS §13/§15).

Volledige trust-tabel en threat model: `SPEC.md` §2 en §9.

## Begrippen

De documentatie gebruikt korte codes; dit is wat ze betekenen.

- **M0–M8 — mijlpalen** (roadmap, `SPEC.md` §12): M0 repo-opzet · M1 on-chain
  programma · M2 TypeScript-SDK · M3 end-to-end-tests op devnet · M4
  post-quantum-handtekeningen · M5 channels · M6 optionele ZK/privacy-laag ·
  M7 L2-scheiding (optimistic rollup) · M8 mainnet-voorbereiding (multisig,
  audits, bug bounty). M0–M4 fase 1 zijn gedaan (M4.2 staat on hold); M5–M8
  niet begonnen.
- **Track 1 / Track 2 — twee routes voor post-quantum-verificatie (M4):**
  Track 1 legt on-chain alleen een commitment (hash) van de handtekening vast en
  verifieert de handtekening zelf off-chain in de SDK (in gebruik). Track 2
  verifieert volledig on-chain; dat is gemeten maar past nog niet binnen
  Solana's rekenbudget, en is daarom een onderzoeksvraag.
- **E1–E14 / F2xx — testscenario's:** de E-serie is de end-to-end-testreeks
  van het protocol (normale check-in, double-spend, dispute, enz.); de F-serie
  zijn de post-quantum-varianten daarvan.
- **A1–A4** — vertrouwensaannames (hierboven). **B-, D-, Q-nummers** —
  genummerde beslissingen en open vragen in `STATUS.md`. **C1–C6** —
  correcties op het oorspronkelijke ontwerp (`docs/obp-analysis.md`).
- **CU** — compute units, Solana's maat voor rekenkosten per transactie.
  **SBPF v3** — versie van Solana's bytecode-formaat voor programma's.
  **PQ** — post-quantum.

## Werkwijze

AI-gesupported ontwikkeling (een LLM; MCP-tools: Solana-RPC, GitHub, file-system, shell, zoekopdrachten). Elke claim in `STATUS.md` is reproduceerbaar via de scripts in deze repo — de AI is een uitvoerder, het bewijs is het criterium.

## Disclaimer

Deze software wordt geleverd "as is", zonder garantie (zie ook de
Apache-2.0-licentie zelf). OBP is experimentele software die alleen op devnet
draait — gebruik op eigen risico. Dit is geen financieel advies, en er is geen
garantie tegen bugs, verlies van munten of toegang, of andere risico's die
inherent zijn aan het beheren van crypto-assets.
