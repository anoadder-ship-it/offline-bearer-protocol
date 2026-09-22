# Security

## Scope

Deze policy dekt de code in deze repository:

- `programs/obp-core/` — het Anchor-programma (de on-chain state machine:
  check-in, double-spend-resolutie, bonds, allowance).
- `sdk/` — de TypeScript-SDK (CoinFile-codec, ketenverificatie,
  instruction-builders, check-in-orchestratie).
- `docs/coinfile-spec-v1.md` / `SPEC.md` — de specificaties (een fout in de
  spec telt als een fout in de implementatie die erop bouwt).

**Niet** in scope: de devnet-referentieinstance (upgradeable; zie STATUS.md
§4/§14), derden-infrastructuur (RPC-nodes, Jupiter, Helius), en de
`smoke-m1-*.ts`/`tests/`-scripts (bewijs-harnassen, geen product-code).

## Belangrijkste vertrouwensgrenzen (kort)

- **Geen private keys in de repo** — upgrade- en mint-authority leven
  lokaal onder `~/.config/offline-bearer-protocol/` (STATUS.md §4).
  Audit-herhaling: STATUS.md §16.1.
- **Fase 1 = optimistische validiteit voor PQ** (Track 1): de on-chain
  `sigCommit` is een commitment (H(sig)); de volledige PQ-signatuur wordt
  off-chain geverifieerd door de SDK. Track 2 (on-chain verificatie) is
  een bewuste research-spike (M4.2), nog geen product-promise.
- Volledig threat model en invariants: `SPEC.md` §2 en §9.

## Kwetsbaarheid melden

1. **Privé eerst — niet via een publiek issue.** Gebruik GitHub's private
   vulnerability reporting: tab **Security → Report a vulnerability** in deze
   repository. Werkt die knop niet, open dan een publiek issue met alleen de
   vraag om een privé-contactkanaal (zonder details van de kwetsbaarheid);
   de maintainer reageert daarop met een privé-route. Vermeld: welk onderdeel
   (programma / SDK / spec), reproduceerbaar voorbeeld of invariant dat
   schiet, en — indien bekend — het impact-scenario (value-migratie,
   double-spend, bond-lek).
2. **Reactietijden (doel, geen SLA)**:
   - **Critical** (waarde-uitgang of double-spend bij correct gebruik):
     erkenning ≤ 72 uur, fix/advies ≤ 14 dagen.
   - **High** (invariant-schending die compensatie/bond vereist): ≤ 7 dagen
     erkenning, ≤ 30 dagen fix/advies.
   - **Medium/Low**: volgende geplande release.
3. Fase 1 draait op **devnet** zonder productwaarde; een critical-kwestie
   is dan primair een spec/programma-kwestie vóór de mainnet-prep (M8),
   niet een incident.
4. Na een fix: changelog-vermelding in `STATUS.md` (nieuw sectienummer) en,
   indien relevant, een Dependabot/Renovate-achtige notitie bij
   `SECURITY.md` of in de issue.

## Bekende status (peildatum 2026-09-22)

- **Dependabot**: 5 alerts in totaal, 0 open — 1× `fixed` (#5, bigint-buffer),
  4× `dismissed` na analyse (3× not_used, 1× tolerable_risk met bewijs) —
  STATUS.md §17.
- **ml-dsa 0.1.1** (ML-DSA, FIPS 204): CVE-2026-24850 (duplicate hint indices;
  getroffen versies `0.0.4` t/m `< 0.1.0-rc.4`) — wij pinnen 0.1.1, niet
  getroffen.
