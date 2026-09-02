# offline-bearer-protocol (OBP)

Bearer coins die je **volledig offline** kunt halen (op een stick of device),
**offline kunt overdragen** (zonder netwerk), en daarna **veilig weer kunt
checken-in** — zonder double-spend: elke double-spend is of onmogelijk
(nullifier) of economisch begrensd en gecompenseerd (verplichte bonds ≥ 100%
van de muntwaarde).

**Status:** M0 — voorbereiding. Spec v0.1 (draft) + compilabel programma-skeleton
+ tooling-inventarisatie met bewijs. Zie leesvolgorde.

## Leesvolgorde

1. [`STATUS.md`](STATUS.md) — projecttoestand, beslissingen (B-serie), bewijs,
   openstaande vragen (Q-serie). Eerste bestand bij hervatten van het werk.
2. [`SPEC.md`](SPEC.md) — het protocol: munt-formaat, lokale chain, check-in
   state machine, double-spend-resolutietabel, invariants, threat model.
3. [`docs/obp-analysis.md`](docs/obp-analysis.md) — de herkomst: analyse van de
   oorspronkelijke Grok-chat, inclusief de zes correcties (C1–C6) die in de spec
   verwerkt zijn.

## Structuur

| Pad | Inhoud |
|---|---|
| `programs/obp-core/` | Het Anchor-programma (fase 1: M0-skeleton — `init` + `ping`; de volledige instructieset van SPEC §5 komt in M1) |
| `client/` | TS-clientlibrary (M2: CoinFile-model, transfer, gestageerde check-in) |
| `tests/` | E2E-bewijsmatrix (M3: E1–E10 op devnet) |
| `build-sbf.sh` | SBF-build met platform-tools v1.52-pin (zie STATUS.md §5) |

## Trust-basis fase 1 (expliciet, geen aannames)

- **A1:** Solana-consensus (finalized = definitief).
- **A2:** het programma + upgrade authority (fase 1: één keypair, twee backups
  buiten de repo; multisig = M8).
- **A3:** de mint authority (separaat van de upgrade authority) munt coins,
  begrensd door de vault — 1:1 backende, invariant I2 machine-checkbaar.

Volledige trust-tabel en threat model: `SPEC.md` §2 en §9.
