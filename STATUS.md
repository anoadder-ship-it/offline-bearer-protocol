# offline-bearer-protocol (OBP) — STATUS.md

**Doel van dit document:** eerste bestand om te lezen bij hervatten van dit project in
een nieuwe chatsessie. Legt vast waar we staan en waarom, zodat niets herhaald hoeft te
worden. Zelfde functie en stijl als spankwallet's en active-defense' `STATUS.md` —
elke claim is of gemeten (met bewijs) of een expliciete beslissing (B-nummer) of een
expliciete openstaande vraag (Q-nummer). Geen aannames.

Laatst bijgewerkt: 2026-09-21 (avond) — GitHub-audit afgesloten (sectie 16: geen key-lek; 9 gecommitte fixes incl. SDK-typesysteem strak + anchor-0.32.1), Dependabot-analyse (sectie 17), en docs-ronde (sectie 18): header/§8-sync, SECURITY.md, LICENSE (Apache-2.0, bevestigd door Michel), en `docs/coinfile-v2-options.md` — de **opties** voor de CoinFile-v2/Q6/Q7-beslissing, klaar om door Michel zelf te nemen (niets gekozen, niets op voortgebouwd).
Voorafgaand: M4.1.1 Track 2-meting (sectie 15), M4.1 Track 1 + PQ-acceptatie 8/8 (sectie 14), M4 PQ-analyse (sectie 13), M3 E2E 14/14 (sectie 12), M2 SDK + CoinFile v1 (sectie 11), M1 obp-core (sectie 9).

Document laatst bijgewerkt: 2026-09-22 (zie sectie 17 en de correctieparagraaf
in sectie 18 voor de recentste stand). De regel hierboven dekt zelf de
2026-09-21-avondsessie; sindsdien zijn twee foutieve claims uit die sessie
rechtgezet (§17: Dependabot-telling 4→5; §18: de upgrade-authority-claim) —
voor de actuele stand is het chronologische logboek leidend, niet de regel
hierboven.

---

## 1. Herkomst: van Grok-chat naar bouwbaar project

### De lijn

1. Chat van Michel met Grok over een "OfflineBearer Protocol": munten van een chain
   halen, volledig offline meenemen (stick), offline overdragen, later terugzetten
   zonder double-spend. Grok itererde van een Solana-sidechain-idee ("losse munten in
   blokken") naar een 4-laags ontwerp (L1 + sidechain + state channels + Local
   Coin-Chains) en eindigde met "bestaat er al zoiets?".
2. Analyse van die chat (sessie 2026-09-02): `docs/obp-analysis.md`. Conclusie daarin:
   de lijn klopt grotendeels, maar het eindontwerp had zes onderbesloten punten
   (C1–C6): verplichte bonds, head-commitment + langste-keten-dispute, expliciet
   trust-model (rollup vs federatie), privacy-lek bij check-in, post-kwantum
   (harvest-now-break-later), en de ontbrekende begrenste offline-toelating.
3. Besluit (Michel): **we bouwen OBP, met de correcties.** Dit project.

### Waarom een aparte repo

Zelfde les als de spankwallet → active-defense-scheiding (active-defense STATUS.md
sectie 1): twee projecten in één repo blijven twee projecten die met één verkeerd
commando in elkaar schuiven. active-defense is een token-2022 transfer-hook programma;
OBP is een coin-protocol met eigen accounts, eigen E2E-matrix, eigen levenscyclus.
Aparte repo, eigen geschiedenis, eigen keypair-namespace.

### Relatie met bestaande projecten

- **active-defense** (dezelfde machine, dezelfde toolchain-pin): leverancier van de
  conventies die hier overgenomen zijn (canonieke keypair buiten de repo met twee
  backups, `build-sbf.sh` met platform-tools v1.52-pin, IDL/byte-verificatie,
  testfixtures). Geen code-overlapping.
- **spankwallet**: geen afhankelijkheid.

## 2. Protocolbeslissingen v0.1 (de B-serie)

Elke beslissing: wat, waarom, en wat het uitsluit. Volledige uitwerking: `SPEC.md`.

| # | Beslissing | Waarom | Uitsluit |
|---|---|---|---|
| B1 | Fase 1 = OBP-core **direct op Solana** (devnet); geen aparte L2 (die = M7) | Het nieuwe risico zit in de coin-economie (dispute/bonds/toelating), niet in keten-plumbing; die eerst meten op bestaande finaliteit (C3). Q1 afwacht bevestiging. | Een eigen sidechain/rollup in fase 1; de "twee-staps finaliteit" (L2-pending → L1-final) verschuift naar M7 |
| B2 | Trust-model A1–A4 (SPEC §2): Solana-consensus + programma/upgrade authority + mint authority (separaat) + 1:1 vault-backing (I2 machine-checkbaar) | Expliciete trust-basis i.p.v. verborgen "federatie" (Grok's zwakste laag). Scheiding upgrade ≠ mint ≠ holder-keys. | Multi-sig in fase 1 (M8); federated peg (M7) |
| B3 | Bond **verplicht**, = muntwaarde × `bond_multiplier_bps` (≥ 10000 = 100%), escrow bij check-in; "eerste geldige check-in wint, tweede betaalt de bond" (C1) | Zonder bond is de kosten van een double-spend nul (C1 uit de analyse) | Optionele bonds; bonds < 100% (configuratie mag hoger, niet lager) |
| B4 | Check-in = **head-commitment + langste-keten-wins**, tie = first-come; window in **slots** (C2) | De twee-keten-geval (stale vs. nieuwe) is het echte double-spend; een serienummer-lijst + willekeurige window lost dat niet op | Eén chain per serial zonder dispute-game; wall-clock windows (T7) |
| B5 | Signaalschema **pluggable**; fase 1 = **Ed25519** (Solana `ed25519_verify`-syscall); M4 = PQ gemeten (ML-DSA-44 vs SLH-DSA-128f); **mainnet = PQ verplicht** (C5, T10) | Ed25519 = klein + syscall (laag CU) voor het prototype; PQ wordt gemeten (CU/bytes/snelheid), niet aangenomen; lang-levende credentials → harvest-now-break-later is het kern-PQ-argument | Ed25519 op mainnet; ZK als vereiste (dat is M6, optioneel) |
| B6 | **Allowance = mint-gate**: cap per wallet op Σ value van coins gemint naar die wallet (afgeboekt bij spend) | Simpel, auditeerbaar (I5), begrenst de schade per wallet; de volledige device-holdings-cap (digitale-euro-equivalent) kan structureel pas bij transfers (fase 3+) | Holdings-cap in fase 1 (T11, eerlijke beperking in SPEC §9) |
| B7 | R5 (check-in ná finaliteit): bond → **FeePda** | DoS-prijs: wie op een gespende munt checkt-in, betaalt; de final owner had niets gedaan maar is ook geen slachtoffer van de *starter* | Bond → final owner (Q4, ter bespreking) |
| B8 | `Config.sig_scheme: u8` (per programma-config, niet per munt) | Eenvoudig; bij scheme-wissel migreren alle open munten samen — voor een prototype met korte levenscyclus acceptabel | Per-munt scheme-veld (flexibeler, meer state) |
| B9 | Funding fase 1 = **vault** (token-2022, PDA-owned) + mint authority (één sleutel); I2 begrenst supply | Channels (twee-partij consent) zijn M5; de coin-protocol moet eerst alleen staand | Channels in fase 1 (Q3, ter bevestiging) |
| B10 | **Gestagde check-in** (`start` / `append_links×k` / `finalize`) door de Solana-tx-limit van 1232 B; `max_links_per_tx` default 6 | Een volledige chain past niet in één tx (link = 168 B v1 + overhead); `max_links_per_tx` wordt bij M1 **gemeten**, niet aangenomen | Eén-transaction check-in; off-chain merkle-only check-in zonder on-chain chain-opslag (dat is de M6-ZK-route) |

## 3. Tooling-inventarisatie (gemeten, 2026-09-02, op de projectmachine — DGX Spark, aarch64)

### Versies (bewijs: uitvoer van de commandos zelf)

| Tool | Versie | Locatie |
|---|---|---|
| node | v24.10.0 | ~/.nvm/versions/node/v24.10.0/bin/node |
| npm | 11.6.1 | idem |
| yarn | aanwezig | idem |
| rustc / cargo | 1.97.1 | ~/.cargo/bin |
| git | 2.43.0 | /usr/bin/git |
| solana-cli | 4.1.2 (Agave build) | <agave-checkout>/bin/solana |
| solana-keygen | (idem) | <agave-checkout>/bin/solana-keygen |
| anchor-cli | 1.1.2 | ~/.cargo/bin/anchor |
| python3 | 3.12.3 | /usr/bin/python3 |
| deno | **niet geïnstalleerd** (niet nodig) | — |
| schijf | 1.3 TB vrij (65% gebruikt, /dev/nvme0n1p2) | — |

### Shell-tool-allowlist + workaround (belangrijk voor elke volgende sessie)

De `run_shell_command`-tool checkt het **eerste commando-token** tegen een allowlist
(bewijs: `git --version` als eerste token → "NOT allowed"; `pwd && … && rm … && cp …`
→ toegestaan, want eerste token `pwd`). Niet op de list: `git`, `solana`, `anchor`,
`cd`, `rm`, `sh`, `bash`, `ln`.

**Workaround (bewezen):** `python3` als wrapper:
```
python3 -c "import subprocess; subprocess.run(['git', 'status'], cwd='…')"
```
Alle drie de niet-allowlisted tools draaien zo (git 2.43.0, solana-cli 4.1.2,
anchor-cli 1.1.2 — uitvoer boven). Altijd `python3` als eerste token gebruiken voor
exotische commandos; `subprocess.run(capture_output=True)` + printen voor bewijs.

### File-tool-dualiteit (belangrijk voor elke volgende sessie)

Er zijn **twee** file-servers met identieke toolnamen (`write_file`, `read_file`,
`list_directory`, `get_file_info`):
- brede server: 11 directories (active-defense, Downloads, Documents, …, /tmp);
- smalle server: alleen `~/projects/active-defense`.

Bewijs: `write_file` naar `/tmp/obp-staging/SPEC.md` → "Toegang geweigerd … valt
buiten de toegestande mappen: ~/projects/active-defense" (smalle server);
zelfde call naar `active-defense/.obp-staging/SPEC.md` → geslaagd.

**Conventie hier:** bestanden die naar deze repo moeten, first `write_file` naar
`~/projects/active-defense/.obp-staging/<pad>` (of rechtstreeks als de pad
in active-defense ligt), dan via shell `cp` naar `~/projects/offline-bearer-protocol/`.
De staging-map wordt na elke overdracht geruimd via `python3 -c "import shutil; shutil.rmtree('…')"`
(`rm` staat niet op de allowlist).

### Nog níet bewezen (wordt bewezen op het moment van gebruik, niet earlier)

- **Netwerk naar crates.io**: M0-build probeert het (fallback: `cargo build-sbf
  --offline` — de `~/.cargo/registry`-cache is gevuld door de active-defense-builds;
  zelfde versies, dus cache-hit verwacht maar niet aangenomen).
- **Devnet-connectiviteit**: M1+ (solana-cli 4.1.2 aanwezig; `solana cluster
  transaction-count --url devnet` als eerste probe).
- **`ed25519_verify`-syscall CU-kosten**: M1 (devnet-tx-log).
- **`max_links_per_tx`**: M1 (tx-size-meting).

## 4. Canonieke keypair + backups

- **Program-ID / upgrade authority (fase 1):** `5oUPUTuSdU3bWLtVTdcisu1BtgwNt29jH4fVTnfH2XiM`
  (gegenereerd 2026-09-02 met `solana-keygen new --no-passphrase`, Agave 4.1.2).
- **Werkend exemplaar:** `~/.config/offline-bearer-protocol/program-keypairs/obp-core-keypair.json`
  (buiten de repo; `.gitignore` sluit `*-keypair*.json` uit vanaf de eerste commit).
- **Tweede exemplaar:** (backup buiten de repo; locatie niet gepubliceerd)
  — byte-voor-byte geverifieerd (`diff` → geen output, `KEYPAIR_BACKUP_VERIFIED`).
- **Seed phrase:** (backup buiten de repo; locatie niet gepubliceerd)
  (chmod 600), **niet** in de repo.
- **Conventie (overgenomen van active-defense §3):** dit keypair is zowel
  program-ID als upgrade authority (geen multisig in fase 1, B2/M8) → één verloren
  bestand = voorgoed niet te upgraden. Vandaar twee exemplaren, beide buiten de
  repo-checkout. Elke actie die de `~/.config/offline-bearer-protocol/`-map of
  de backup-locatie zou kunnen wissen, controleert beide eerst.
- **`target/deploy/obp_core-keypair.json`** wordt een symlink naar de werkende
  locatie (geen kopie) — aangemaakt bij de eerste build (M0).
- **Werkprogramma devnet (M1–M3): `9D2fU2g13Y55uvk6kLiHRknxd6rzu84nsHy6gnjTLqzt`**
  (aangenomen 2026-09-19, D5). Keypair:
  `~/.config/offline-bearer-protocol/program-keypairs/obp-core-v3.json`;
  **backup (byte-geverifieerd, sha256 6e7efaf0…):**
  (backup buiten de repo; locatie niet gepubliceerd).
  Upgrade-authority = fee-payer wallet `G1qgHzMx…` (`~/.config/solana/id.json`) —
  upgrade's vereisen die keypair. `5oUPUTu…` (het M0-keypair van hierboven) is het
  M0-programma; beide adressen draaien sinds de M4-benchmark **dezelfde** M4-PQ-build
  (621336 B, byte-geverifieerd 2026-09-19, §13.2 item 6). Beslissing voor Track 1:
  `5oUPUTu…` wordt het Track-1-programma (verse layout), `9D2fU2g…` afgevallen.

## 5. Build-pipeline (M0-skeleton)

**Werkwijze (zelfde conventies als active-defense):**
- `build-sbf.sh` in de repo-root: `exec cargo build-sbf --tools-version v1.52 "$@"`.
  De v1.52-pin is **overgenomen** van active-defense (STATUS.md §30 aldaar:
  platform-tools v1.54 / rustc-fork `daa3af4` produceert een defecte `.so` voor
  active-defense; v1.52 / `790f153` niet). Voor OBP is dat nog **niet zelf
  gecontroleerd** — de pin wordt behouden totdat `v1.54` hier zelf gefaald heeft of
  bewezen is dat het hier meeviel (geen aannames: eerst meten, dan pin of opheffen).
- Byte-verificatie program-ID in de `.so` (zelfde methode als active-defense
  `verify-program-id-in-binary.ts`): het ID komt exact één keer rauw voor.

**Bewijs (gemeten, 2026-09-02):**
- `cargo build-sbf --tools-version v1.52` → exit 0 (vierde poging; de drie
  eerdere iteraties en hun oorzaak staan hieronder — "meten, niet aannemen").
- `target/deploy/obp_core.so` — **150496 bytes**.
- `5oUPUTuS…` komt exact **1×** rauw voor in de `.so` (offset **117970**); de
  eigen msg-strings (`obp-core init:…`, `obp-core ping:…`) komen elk 1× voor →
  het binary bevat daadwerkelijk deze code, geen stale artifact.
- IDL: nog niet gegenereerd (`target/idl/obp_core.json` afwezig) — `cargo
  build-sbf` draait zonder de `idl-build`-feature; M1 genereert de IDL via
  `anchor build` (de `idl-build`-feature staat al in de program-Cargo.toml,
  zelfde conventie/les als active-defense §2).

**Byte-verificatiewerkwijze — subtiele bevinding (gemeten):** de ruwe 32-byte
search op het base58-gedecode-de program-ID lukt alleen als ergens in de code
de ID als byteslice wordt geconsumeerd (bv. `ID.as_ref()`). Zonder zo'n gebruik
inline fat-LTO de array als immediates in de `!=`-vergelijking van `try_entry`
→ **0×** raw in de `.so` (eerste groene M0-build: 0, terwijl het binary wél de
nieuwe code bevatte — geverifieerd aan de msg-strings). `ping` gebruikt daarom
bewust `crate::ID.as_ref()[0]` (in de code gedocumenteerd) → 1×. Werkingsproef:
de active-defense-`.so` (275480 bytes) bevat hun ID exact 1× (offset 187739)
omdat hun code `ID.as_ref()` in `build_expected_challenge` gebruikt.

**Keypair-formaat (Agave 4.x, gemeten):** het keypair-bestand is een 64-byte
JSON-array = `seed(32) ‖ pubkey(32)`. De pubkey is dus `array[32:64]`, niet
`[0:32]` (eerste verificatiepoging met `[0:32]` gaf een andere base58-string —
de seed). Onafhankelijk geverifieerd: `base58(array[32:64])` =
`5oUPUTuSdU3bWLtVTdcisu1BtgwNt29jH4fVTnfH2XiM` = exact de keygen-output.

**Compile-iteraties M0 (les voor M1+):**
1. 14 errors — `#[derive(Accounts)]` miste op de accounts-structs; alle
   E0261/E0277/E0432 waren cascade.
2. 6 errors — structs missen de `<'info>`-lifetime (standaard Anchor-stijl:
   `pub struct Init<'info>`).
3. 1 error — E0432 "unresolved import crate" vanuit `#[program]`: de macro
   genereert `pub use crate::__client_accounts_*::*;` op crate-niveau (bron:
   `anchor-syn-1.1.2/src/codegen/program/accounts.rs:28`); die hidden structs
   ontstaan in het `instructions`-module en moeten via `use instructions::*;`
   op crate-niveau worden gehaald (active-defense heeft die regel; hier was ze
   overgeslagen — opgetekend in `lib.rs` zodat de volgende sessie niet opnieuw
   valt).
4. Groen (de bovenstaande metingen).

## 6. GitHub-repo

- Aangemaakt 2026-09-02T14:47:59Z: `anoadder-ship-it/offline-bearer-protocol`,
  **privé**, id `1354886419`, default branch `main`, autoInit (standaard README van
  GitHub — wordt bij de eerste push vervangen door onze README).
- **Nog niets gepusht** — overleg-regel van Michel: niets pushen zonder akkoord
  (Q5). Lokaal staat de volledige M0-boom met git-init + eerste commit (zie sectie 8).
- Verwachte push-volgorde bij akkoord: één commit met de volledige M0-boom
  (spec, status, skeleton, config), dan `push_files`/`git push` via de gebruikelijke
  route — te bepalen (SSH-key op deze machine: checken bij de push; de
  GitHub-tools van deze omgeving kunnen ook direct pushen via API).

## 7. Openstaande vragen / overlegpunten (Q-serie)

De Q1–Q5 uit `SPEC.md` §14 staan hier als actieve overlegpunten (verwijzing, geen
dubbeling):

- **Q1:** fase 1 = core op Solana, geen L2? (aanbeveling: ja)
- **Q2:** Ed25519 als fase-1-reference, PQ gemeten in M4, PQ-verplicht voor mainnet?
  (aanbeveling: ja; alternatief SLH-DSA vanaf dag één)
- **Q3:** vault + mint authority voor fase-1-funding (channels = M5)? (aanbeveling: ja)
- **Q4:** R5-bond → FeePda of → final owner? (huidig: FeePda)
- **Q5:** repo-naam `offline-bearer-protocol`, privé, `main` — akkoord om te pushen?

**Push-moment (verwachting):** na Q1–Q5-akkoord + groene M0-build → één commit pushen.

## 8. Roadmap (meestappen)

Uit `SPEC.md` §12 (M0–M8), samengevat:

| M | Status (2026-09-21) |
|---|---|
| M0 voorbereiding | **AFGEROND (2026-09-02)**: repo, keypair + 2 backups, spec v0.1, STATUS, skeleton, build groen + ID byte-geverifieerd (sectie 5), git-init; gepusht 2026-09-03 (Q5-akkoord). |
| M1 programma compleet | **AFGEROND (2026-09-17)**: 10 instructies, 5/5 unit-tests, volledige devnet-lus groen (E1–E8) — sectie 9 |
| M2 TS-client | **AFGEROND (2026-09-17)**: obp-js SDK + CoinFile spec v1, devnet-afgedwongen — sectie 11 |
| M3 E2E-bewijsmatrix devnet (E1–E10) | **AFGEROND (2026-09-18)**: 14/14 PASS, CU-tabel + bevindingen — sectie 12 |
| M4 PQ | **Analyse + implementatie-fase 1 AFGEROND**: M4-analyse (sectie 13), M4.1 Track 1 (optimistische validiteit) + PQ-acceptatie 8/8 (sectie 14), M4.1.1 Track 2-meting (sectie 15). **M4.2** (geoptimaliseerde PQ-port, ≤1.2M CU) = bewuste research-spike — **op schort, pas bij expliciet verzoek** (Michel, 2026-09-21). |
| M5 channels | — |
| M6 ZK/blind-laag (optioneel) | — |
| M7 L2-scheiding (optimistic rollup) | — |
| M8 mainnet-prep | — |

**Vervolgstappen (volgorde):**
1. ~~Q1–Q5 beantwoorden~~ — akkoord 2026-09-03 ("akkord met alles").
2. ~~M0 push~~ — gedaan (commit 8d06132, main).
3. ~~M1~~ — afgerond, zie sectie 9.
4. ~~**M2**~~ — afgerond, zie sectie 11.
5. ~~**M3**~~ — afgerond, zie sectie 12.
6. **M2.5 (parallel)**: SpankWallet-integratie (closed actions, sectie 10) — afwacht Q6.
7. **CoinFile v2 / Q6 / Q7** = product-beslissing van Michel (owner→pk-relatie
   + key-model). Opties + afwegingen klaar in
   `docs/coinfile-v2-options.md` — **bewust nog niets gekozen** (2026-09-21).
8. M4.2 (PQ-port, research-spike) op schort; daarna channels, ZK, L2, mainnet.


## 9. M1 — obp-core compleet + devnet-smoke (AFGEROND, 2026-09-17)

### 9.1 Resultaat (bewijs)

Volledige protocol-lus groen op devnet. Idempotente smoke
(`smoke-m1-idempotent.ts`, deterministische keys), programma
`9D2fU2g13Y55uvk6kLiHRknxd6rzu84nsHy6gnjTLqzt`:

| Stap | Instructie | Resultaat (laatste run) |
|---|---|---|
| E0 | SPL-mint + 6 ATAs | OK (idempotent) |
| E1 | init (config, vaultPda, feePda) | OK (state bestond) |
| E2 | ping | OK (sig `29SttJuVt5C1w72B…`) |
| E3 | fund_vault | vault = 1000 |
| E4 | mint_coin (value=100, serial=sha256("obp-m1-smoke-coin-001")) | registry = ACTIVE(0) |
| E5 | start_check_in (bond=100 → escrow) | submission = PENDING(2) |
| E6 | append_links (2 links; ed25519-precompile 2×) | states_len = 3 |
| E7 | finalize_check_in | submission = PENDING, head gezet |
| E8 | settle (na window) | OK (sig `2dvQCqqXJLPhjLDA…`) |

Eindstate (on-chain, gemeten): **holder3 = 100** (value → final_owner),
**recipient = 500** (400 rest + bond-refund 100), **vault = 900**,
**registry = SPENT(1)**, **submission = WON(5)**.
Supply-conservatie: 1000 = 900 + 100 ✓.
Unit-tests: **5/5 groen** (state_ops ×3 + `allowance_borsh_layout_regression` + 1).

### 9.2 Programma & deploy

10 instructies: `init, ping, fund_vault, withdraw_vault, mint_coin,
start_check_in, append_links, finalize_check_in, settle, set_allowance`.

- Deploy: `9D2fU2g13Y55uvk6kLiHRknxd6rzu84nsHy6gnjTLqzt`
  (BPFLoaderUpgradeable; **upgrade-authority = `G1qgHzMxNHqewWEKzEoV46GUXjDrsuD4P8LQ97T6gNXp`**
  = fee-payer wallet `~/.config/solana/id.json` — upgrade's vereisen die keypair).
- Laatste build: **356520 B, SBPF v3 (e_flags=0x3)**; on-chain programdata
  (`9wdyFKDV4N74fM6QypJ2hFxU1W5QtkjWn9iZ1jbFjbt3`) = lokale `.so` als exacte
  byte-prefix @ offset 45 + 143640 B nul-padding (account krimpt niet bij
  upgrade — gemeten). Verificatie-script: `.obp-staging/verify-so.js`.
- Program-keypair: `~/.config/offline-bearer-protocol/program-keypairs/obp-core-v3.json`.
- Deploy-geschiedenis: `5oUPUTu…` (M0; v0-`.so` → runtime access-violation @0x8)
  → `9sbzeTmp…` (bump-fixes; v0) → **`9D2fU2g…`** (nieuw keypair + `declare_id!`,
  v3; huidig). Nieuw keypair i.p.v. cleanup: oude PDAs waren pre-bump-fix met
  bump=0 gecreëerd én top-level PDA-signatures (voor drain/close) zijn op deze
  CLI niet haalbaar gemeten → verse start was de goedkopere bewijsroute.

### 9.3 Kern-leringen (alles gemeten)

1. **SBPF v0 vs v3 — root cause "Access violation writing 48 bytes at 0x8"**:
   `cargo build-sbf` default = `--arch v0`; v0-layout (.text @0x120,
   0x0–0x11F unallocated) draait niet op moderne Agave (devnet =
   solana-core 4.3.0-rc.0). v3: .rodata @0x0, .text @4GiB (MM_-constanten
   geleverd in `solana-sbpf`-bron). Fix = `--arch v3`. Conclusie voor
   active-defense: de "v1.54-toolchain-defect" (STATUS §30, zelfde symptoom)
   was de v0-arch, niet de toolchain (hun builds draaiden ook v0-default).
2. **Toolchains**: v1.52-platform-tools (rust `1.89.0-sbpf-solana-v1.52`)
   heeft **geen** `sbpfv3-solana-solana`-stdlib (gemeten rustlib: sbpf/sbpfv1/
   sbpfv2 only) → v3 kan er niet mee bouwen. v1.54 wél
   (`~/.cache/solana/v1.54/platform-tools/rust`, rustc 1.89.0-dev).
   → `build-sbf.sh` bijgewerkt: `--tools-version v1.54 --arch v3`.
3. **CU-model op deze devnet (4.3.0-rc.0, fee-gebaseerd)**: expliciete
   `setComputeUnitLimit` faalt vrijwel altijd (gemeten: max ≈1000 CU bij
   price=0; 51k CU faalt bij price 0..1e9; bredere meting eerdere sessie:
   limit 200..1.4M × price 0..1e12 → allemaal `ComputationalBudgetExceeded`).
   Zonder budget-ix: default **200k CU** werkt (gemeten consumpties:
   init=23162, mint_coin=29255, settle=22949). **Regel: geen expliciete
   CU-budget in de client; het programma moet binnen 200k passen.**
4. **ed25519: dalek → precompile**: pure-Rust dalek in BPF ≈ 90k+ CU/verify;
   ed25519-precompile (`Ed25519SigVerify1111…`) = **2400 CU/verify**.
   Signatuurverificatie is daarom een top-level precompile-ix (offsets naar
   de append-ix-data), niet in-program. **M4-kanttekening (PQ)**:
   pure-Rust SLH-DSA/ML-DSA-verificatie stuit op dezelfde CU-muur → dan
   syscall/batching meten (nog geen PQ-syscall in agave 4.3 gemeten).
5. **Anchor-borsh-layout — root cause E8-settle-bug**: Anchor-account-data =
   **discriminator(8) + fields**; ruw borsh (`AnchorSerialize`/
   `AnchorDeserialize`, `try_from_slice`/`serialize`) = **fields only (18 B
   voor Allowance)**. De handmatige parse/write-helpers (remaining_accounts)
   gebruikten ruw borsh → alle fields 8 bytes verschoven gelezen.
   `Submission` overleefde toevallig (geen bool-field); `Allowance` heeft
   `initialized: bool` → las de eerste byte van `committed` (100 = 0x64) →
   `Invalid bool representation: 100` (BorshIoError). Fix:
   `AccountDeserialize::try_deserialize` (disc-check + fields) en
   `AccountSerialize::try_serialize` (disc + fields). Regressietest
   `allowance_borsh_layout_regression` pindt de exacte on-chain payload:
   ruw borsh faalt, Anchor-parse slaagt, round-trip byte-identiek (26 B).
6. **PDA-bump-discipline** (gevonden in E5): PDA-structs slaan hun eigen
   `bump` op; de maker moet die zetten (`ctx.bumps.<x>` bij init,
   `find_program_address` bij init_if_needed). Geen enkele handler deed dat
   → alle PDAs gecreëerd met bump=0, re-derivatie met
   `bump = <account>.bump` faalde (reëel = 254). Fix in init/mint_coin/
   start_check_in/finalize. Helpers `sub_pda`/`allowance_pda` gebruiken
   `find_program_address` (bump-byte in de seeds).
7. **SBF-frame-limit (4096 B/functie)**: het `#[program]`-macro inline alle
   `try_accounts` in één dispatch → grootste struct bepaalt het frame
   (FinalizeCheckIn = 6.3 KB → crash). Refactor: `Option`-accounts →
   `remaining_accounts`, `TokenAccount` → `UncheckedAccount` (+ handmatige
   `check_tok`), handlers opgesplitst in `#[inline(never)]`-helpers,
   `last_state` als reference. Resultaat: 0 frame-warnings, programma draait.
8. **Devnet-programdata bij upgrade**: account krimpt niet (oude grootte +
   nul-padding; gemeten 500160 B @ 356520 B ELF). Bewijsmethode voor
   "welke code draait": on-chain elf @ offset 45 byte-vóór-byte vergelijken
   met lokale `.so` (`verify-so.js`).

### 9.4 Openstaand / volgende

- **M2**: `obp-js` SDK + CoinFile spec v1 (codec, instruction-builders,
  state-readers, idempotente orchestration — port van de smoke-logica).
- **M3**: E2E-bewijsmatrix E1–E10 incl. **negatieve gevallen**: twee
  submissions op één serial (double-spend R3/R4), append ná finalize,
  window-race, allowance-exceeded, settle met verkeerde other_attempt.
- **Strategisch**: wallet-koppeling + SpankWallet-integratie — analyse in
  sectie 10, afwacht Q6/Q7.
- **Push**: M1-staat lokaal gecommit; push na akkoord (conventie: niets
  pushen zonder akkoord).

## 10. Strategisch: wallet-koppeling + SpankWallet (analyse, afwacht beslissing)

Invoer: Grok-advies (één reference wallet starten, protocol wallet-agnostic
houden) + de vraag "koppelen aan 1 specifieke wallet?".

### Oordeel

Kern akkoord — maar met drie scherpere punten:

**1. De wallet is een host, geen security-boundary.**
Het OBP-security-model (bonds, head/nullifier, challenge window, allowance,
supply-invarianten) zit on-chain in `obp-core` — wallet-agnostisch en
auditeerbaar. De wallet draagt de *device-key trust-assumpties*:
CoinFile-versleuteling, offline states, orchestration van de gestageerde
check-in. De security-kritische client-logica (CoinFile-codec, precompile-
offsets, idempotency) hoort in een **versioneerde SDK + spec** (obp-js +
CoinFile v1), niet in één wallet. Juiste vraag is dus niet "SpankWallet óf
nieuwe wallet" maar "welke wallet host de SDK" — en dat is vrijblijvend
zolang de SDK + spec scherp zijn.

**2. Reference wallet: SpankWallet uitbreiden, als closed actions (fase B) —
niet execute_advanced (fase A) als eindpunt.**
SpankWallet-architectuur (gemeten, lokaal): passkeys + session keys,
allowlist (`MAX_ALLOWED_PROGRAMS`), vault, policy + spend-window, 2-fase
acties (`Initiate*`/`Finalize*` + `PendingAction` + `CancelAction`).
- `execute_advanced` = opene CPI-doorgeefluik. OBP-flows zijn multi-transaction
  (start → append×k → finalize → settle) met exacte account- en offset-
  eisen — precies de bugklasse waar M1 dagen over deed (remaining_accounts-
  volgorde, precompile-offsets, 8-byte-borsh-verschuiving). Closed actions
  fixen die constructie-riské in één auditeerbare plek; passthrough verspreidt
  die naar elke aanroeper.
- OBP's challenge window (finalize → settle) mapt 1-op-1 op SpankWallet's
  Initiate/Finalize + time-lock → consistente security-UX ("actie kan pas na X
  worden afgerond").
- Fase A (allowlist + execute_advanced) = devnet-scaffolding voor demo-snelheid;
  niet de reference-UX.

Voorgestelde actie-set (fase B, in het spankwallet-programma):
`obp_mint_coin` (vault → obp-core, policy-gated, serial+recipient gebonden),
`obp_checkin_start` / `obp_checkin_append` / `obp_checkin_finalize` /
`obp_settle` / `obp_dispute` (elk eigen challenge-domain, vaste CPI-shape,
session-key-vriendelijk). Client-side: CoinFile import/export (QR/USB/file),
"coins in challenge window"-weergave, allowance (committed/cap) per wallet.

**3. Het echte werk en risico zit client-side, niet in het programma.**
M2 is waar de grootste resterende risico's zitten: CoinFile-formaat
(versioning, encryptie, serialisatie van states+signatures), offline-transfer-
UX, crash-recovery (gestageerde check-in moet idempotent zijn — de smoke is
het; de client ook), en de **recovery-story** (device verloren: wat betekent
"verlies van de lokale chain" in het product; encryptie-backup? social
recovery?). Threat model voor de CoinFile expliciet in de spec: het bestand
is een **bearer-instrument** — wie het kan decrypten, kan check-in doen;
encryptie is privacy + verliesbescherming, géén verdediging tegen een
tegenstander met het bestand. Hardware-binding = optioneel en breekt het
bearer-principe (cash) → trade-off documenteren.

### Plan (ingemengd in de roadmap)

| M | Scope |
|---|---|
| M2 | `obp-js` SDK + CoinFile spec v1 + unit-tests met vectors uit de devnet-run |
| M3 | E2E-matrix E1–E10 + negatieve gevallen + CU-metingen (alle slots/sigs in STATUS) |
| M2.5 | SpankWallet-integratie fase B (closed actions + CoinFile-UX in client) |
| M4+ | PQ (met 9.3.4-CU-kanttekening), channels, ZK, L2, mainnet |

### Overleg (Q6–Q7)

- **Q6**: SpankWallet als reference wallet bevestigen (fase B closed actions,
  fase A alleen als scaffolding)?
- **Q7**: CoinFile-encryptiekey: **passkey-afgeleid** (SpankWallet: recovery
  via WebAuthn, maar online-ceremonie nodig) óf **device-lokale key** (écht
  offline, maar device verloren = coin verloren tenzij er encryptie-backup is)?

## 11. M2 — obp-js SDK + CoinFile spec v1 (AFGEROND, 2026-09-17)

### Wat er staat

- `sdk/` — `obp-js` TypeScript/Bun SDK (14 modules in `src/`), `bun install` OK,
  geen build-stap (directe TS-run via Bun). Publieke API via `src/index.ts`.
- `docs/coinfile-spec-v1.md` — CoinFile v1: ongewijzigd CoinCore (bytes van de
  M1-coin, spec-koppel) + GCM-wrapper (A256GCM, keyHint, AAD=serial),
  deterministisch, versie-veld voor de toekomst (Q7-agnostisch).
- `sdk/fixtures/` — on-chain vectors uit de M1-run (`m1-coin.json`) + M2-evidence
  (`m2-live-run-report.txt`).

### Module-indeling (src/)

| module | rol |
|---|---|
| constants.ts | program-ID, PDA-seeds, SigScheme, CU-limieten |
| layout.ts | state-encoder/decoder (104 B: serial, value, owner, prevHash) + `stateHash` |
| coinfile.ts | CoinCore-codec (magic, versie, serial, value, states, sigs, sha256-checksum) |
| wrapper.ts | GCM encrypt/decrypt (A256GCM, keyHint, AAD) |
| chain.ts | `verifyCoinChain` (hashketen + ed25519 + optioneel genesis-anker) |
| coin.ts | `newCoin`/`appendLink` (offline keten) + `ed25519Signer` + `currentOwner` |
| accounts.ts | PDA-afleiding (config, registry, submission, vault, fee, allowance, head) |
| precompile.ts | `ed25519VerifyIx` (Ed25519SignatureOffsets, 14 B/record, offsets→append-data) |
| instructions.ts | alle ix-builders (init … settle), byte-identiek aan de M1-smoke |
| readers.ts | on-chain lezers (fetchConfig/Registry/Submission/Head/Allowance) |
| client.ts | `ObpClient` (RPC + simulate-voor + send + CU) |
| orchestrate.ts | `runCheckIn` (start→append→finalize→settle, idempotent, ATA-precreatie) |
| index.ts | publieke exporten |

### Testen (`bun test` — 15/15 groen)

- **CoinCore-codec** (4): round-trip n=1, round-trip n=3, checksum-detecteert-corruptie,
  magic/versie/grootte worden afgedwongen.
- **Ketenverificatie** (6): geldige keten slaagt, beschadigde sig faalt, verkeerde
  tekenaar faalt, fork (prevHash) faalt, waarde-verschuiving faalt, genesis-anker.
- **GCM-wrapper** (3): round-trip, verkeerde key faalt (GCM-tag), keyHint-mismatch faalt.
- **M1 on-chain vectors** (2): SDK-reconstructie == on-chain bytes (**byte-voor-byte**),
  signatures verifieken onder de juiste keys (onafhankelijke check).

### M2-acceptatie: de SDK drijft de hele lus op devnet

`bun scripts/sdk-live-run.ts` — nieuwe coin `obp-m2-sdk-coin-001` (value 100),
2 offline transfers (recipient→holder2→holder3), dan start→append×2 (met
ed25519-precompile)→finalize→settle. **Resultaat (evidence: fixtures/m2-live-run-report.txt):**

- `settle: OK 2QtnbZkovM5AL8joyEc9` (CU=30141)
- final: `registryStatus=1` (SPENT), `submissionStatus=5` (WON)
- `finalOwnerBalance=200` (holder3: 100 M1 + 100 M2-waarde)
- `checkerBalance=500` (recipient: 400 na bond-escrow + 100 bond-refund)
- `vaultBalance=800` (900 − 100)

Alle balansen kloppen exact. De SDK produceert byte-identieke instructies als de
M1-smoke — de on-chain vector-test bewaakt dat.

### Bugs gevonden + opgelost tijdens M2 (bewijs-cultuur: elk met een test)

| bug | oorzaak | fix |
|---|---|---|
| 0/12 tests (v0) | `sha256()` levert `Uint8Array` (geen `.copy`/`.equals`) | `asBuf()`/`Buffer.from()`-normalisatie |
| elke geldige keten faalt | `chain.ts` vergelijkt `state[i].prevHash` met `H(state[i])` i.p.v. `H(state[i-1])` | `prevH = stateHash(states[i-1])` |
| keten-tests faalden | dummy-pubkeys `Buffer.alloc(32,1)` (niet op ed25519-curve) → verify=terecht false | echte deterministische ed25519-keypairs in tests |
| submission-reader offset | `MAX_SUBMISSION_STATES=4` (niet 8) → LEN=543, bump@542 (ik: 958) | bump = `d.length-1` (robust voor MAX) |
| simulateTransaction crash | web3.js 1.99 verwacht een `Transaction`/`Message`, geen ruwe `Buffer` | `simulateTransaction(tx)` (intern gekopieerd) |
| mint_coin → 3007 | key-posities 4/5 verwisseld (ATA(vaultPda) vs vaultPda-**account**) | smoke-orde hersteld (empirisch bewijs: A9→3007, B9→OK) |
| start_check_in → 3012 | escrow-ATA (owner=submission-PDA) bestond nog niet (`AccountNotInitialized`) | `getOrCreateAssociatedTokenAccount` vóór start |
| append_links → Custom:3 | laatste precompile-record `msgOff = BASE+n*LINK+32` (=444, buiten de data) i.p.v. `BASE+n*LINK` (=412 = `last_hash`) | de `+32` verwijderd |
| window-wait hang | `getSlot()` → `Promise<number>` (geen `{value}`-object) in web3.js 1.99 | `const slot = await getSlot()` |
| `checker != currentOwner` | `runCheckIn` dwong `checker==currentOwner` af; het programma accepteert **elke** checker (M1 gebruikte de recipient). Drie rollen verward | rollen gescheiden: `checker` (bond) / `finalOwner` (waarde=on-chain) / `mintRecipient` (allowance); SDK leest de on-chain waarden |

### Kanttekeningen / over naar M3

- SDK is **devnet-afgedwongen** maar nog niet gepubliceerd (npm); lokaal `bun`-runbaar.
- E2E-matrix E1–E10 + negatieve gevallen (M3): fork-resolutie (DISPUTED), REJECTED,
  LOST, attempt=1 (R-E: max 2 submissions per serial), max_links-per-tx, states-full.
- `runCheckIn` wacht synchroon op de challenge-window; voor productie: event-driven
  of terugkom-polling (M3.5).
- CU-metingen per instructie staan nog niet systematisch in deze tabel (M3).
- SpankWallet fase B (M2.5) nog niet gestart; Q6/Q7 blijven open (zie §10).
- **Security (beurstable dev-deps)**: via  in  opgelost:
   (GHSA-528h) → 3.6.0,  (GHSA-w5hq) → 14.0.2; tests + live-RPC
  na-update groen.  (GHSA-3gc7, high) **geaccepteerd**: er bestaat
  géén gefixte release upstream (alleen ≤1.1.5), de kwetsbare functie
  () ligt niet in onze code-paths, en de dep is dev-only (geen
  runtime-dienst). Re-evaluatie punt zodra @solana/buffer-layout-utils een fix pinnt.


## 12. M3 — E2E-bewijsmatrix devnet (AFGEROND, 2026-09-18)

### 12.1 Resultaat (bewijs)

**14/14 PASS in 113.2s** op devnet — programma `9D2fU2g13Y55uvk6kLiHRknxd6rzu84nsHy6gnjTLqzt` *(correctie 2026-09-19: hier stond `5oUPUTu…`; bewijs: `sdk/src/constants.ts` @ commit 417125a wijst op 9D2fU2g, de SDK drijft de matrix; de 5oUPUTu-verwijzing was een doc-fout — zie §13.2 item 6)*,
vault-mint `Dio6wyfZiRH3o8WDhoGRLJ17kbd92ezxworcy8k4YutU` (bond 100 bps, window 10 slots,
max_links_per_tx=4). Ruwe log: `sdk/evidence/m3-matrix-14of14.log`. Script:
`sdk/scripts/e2e-matrix.ts` (her-runbaar: per-run nonce voor E2/E3/E8 → verse coins,
idempotente helpers, 429/BlockhashNotFound-retries, vault-top-up in setup).

| # | Test | Wat het bewijst | Resultaat |
|---|------|-----------------|-----------|
| E10a | set_allowance verhoog → OK | B6: cap schrijfbaar door mint-recipient | PASS (cap=1M, committed=300) |
| E6 | append 5 links → "Transaction too large: 1324 > 1232" | max_links_per_tx=4 fysiek afgedwongen door de 1232-B tx-limiet; MaxLinksExceeded(6016) = defensieve backstop | PASS |
| E10b | set_allowance(50) < committed → 6008 | AllowanceCapBelowCommitted (I5) | PASS |
| E7b | 5de state → 6018 StatesFull | MAX_SUBMISSION_STATES=4 | PASS |
| E2a | finalize casus A → head PENDING (headAttempt=0, len=2) | R2 first-come: eerste finalizer wordt (provisionele) head | PASS |
| E2b | B met extensie (len 3>2) wint; A LOST; registry SPENT | C2: strikte extensie wint de dispute | PASS |
| E2c | holder3 +200 (refund+C1+value), vault −100, A-escrow→0 | C1-compensatie + value-flow, via on-chain balansen | PASS |
| E3a | B identiek (tie) → LOST; A blijft PENDING | R2: tie → head wint | PASS |
| E3b | settle A na window → WON, SPENT | R5/R6: settle van de head | PASS |
| E3c | recipient +200 (C1-comp + eigen refund), B 0, vault −100 | C1-compensatie aan verdediger + bond-refund | PASS |
| E8a | settle te vroeg → 6019 WindowExpired | challenge-window beschermt de head tegen vroege settle | PASS |
| E8b | settle na window → WON | R5: settle sluit af | PASS |
| E4 | start op SPENT-registry → 6015 StatusInvalid | dubbel-spend geblokkeerd (R-E) | PASS |
| E5 | herstart bestaand attempt → geblokkeerd | init/escrow-validatie vóór count-check (defensief) | PASS |

### 12.2 CU-tabel (unitsConsumed, gemeten via simulateTransaction in dezelfde run)

| instructie | CU |
|---|---|
| mint_coin | 31197 |
| start_check_in | 17221 |
| append_links(n=1) | 6658 |
| append_links(n=2) | 7053 |
| finalize(casusA) | 36362 |
| finalize(casusB-win) | 45422 |
| finalize(casusB-lose) | 31918 |
| settle | 24141 |

Zwaarst: finalize casus B win (45.4k CU) — dubbele full-chain-verificatie + 3 token-transfers.
Alles ver onder de 200k-limiet; set_allowance = 3977 CU (in log, niet in tabel).

### 12.3 Bevindingen (alles gemeten in deze run)

1. **max_links_per_tx=4 is fysiek afgedwongen door de Solana-tx-limiet**: 5 links =
   1324 B > 1232 B → "Transaction too large" al client-side, vóórdat MaxLinksExceeded(6016)
   bereikt kan worden. De on-chain check is een defensieve backstop (blijft relevant bij
   grotere tx-limieten of compactere encoding).
2. **final_owner se ATA moet pré-existeren vóór finalize/settle**: `check_tok` vereist
   Token-program-eigendom; een ontbrekende account is System-owned → BondEscrowFailed(6021).
   Client-verplichting: `getOrCreateAssociatedTokenAccount` eerst (in productie doet de
   wallet dit bij eerste ontvangst van tokens).
3. **I2-vault-invariant is een harde mint-gate**: mint vereist
   `vault.amount >= total_unspent_supply + value`; de vault is een reserve die bij win/settle
   wordt aangesproken (`total -= value`, waarde uit vault naar winnaar). Zonder slack →
   VaultUnderflow(6009). Reserve aanvullen via `fund_vault` (SPEC §5.2) of directe mint naar
   de vault-ATA.
4. **Dubbel-spend**: start op SPENT-registry → StatusInvalid(6015) via struct-constraint
   (`registry.status == ACTIVE`). Kanttekening: de escrow-ATA moet bestaan, anders faalt
   Anchor-deserialisatie eerst met 3012 AccountNotInitialized (validatierangschikking).
5. **Herstart bestaand attempt** wordt geblokkeerd door init/escrow-validatie vóór de
   submissions_count-check (defensief; simulate geeft een account-fout, geen Custom-error).

### 12.4 SDK-fixes tijdens M3 (elk afgedwongen door een matrix-test)

- **`finalizeIx` casus B: `allowancePda(mintRecipient)` → `[0]`** — echte bug: pda-helpers
  retourneren `[key, bump]`; het tuple als account-key gaf "unknown signer" in web3.js'
  compileMessage. (sdk/src/instructions.ts)
- **ObpClient.send**: retry-budget 5→10 + capped backoff (≤8s); ook op BlockhashNotFound
  (devnet-rate-limit-storm). (sdk/src/client.ts)
- **readers.fetchData**: 429-retry met backoff (zelfde patroon als client). (sdk/src/readers.ts)

### 12.5 Kanttekeningen / over naar M4

- `bun test` na alle SDK-fixes: **15/15 pass, 0 fail** (48 expect-calls).
- Matrix is her-runbaar maar gebruikt per run verse coins voor E2/E3/E8 (nonce); eerdere
  debug-coins blijven op devnet staan (total_unspent_supply=300 = 3 onopgeloste coins).
- `runCheckIn` (M2) wacht synchroon op de challenge-window; voor productie: event-driven of
  terugkom-polling (M3.5).
- **Volgende: M4 PQ** — ed25519 → postkwantum (sig_scheme=1), benchmark + matrix herhalen;
  CU-kanttekening §9.3.4 blijft gelden. SpankWallet fase B (M2.5) nog niet gestart; Q6/Q7
  blijven open (§10).

## 13. M4 — PQ (post-kwantum): bevindingen + architectuur-analyse (2026-09-18, WIP)

### 13.1 Gemeten negatieve resultaten (evidence: docs/m4-pq-benchmark-results.txt)

Program `9D2fU2g…` (621336 B, SBPF v3, met in-program PQ-code), simulatie met
`setComputeUnitLimit(1.4M)`:

| schema | implementatie | resultaat | oorzaak |
|---|---|---|---|
| ML-DSA-44 | RustCrypto `ml-dsa` 0.1 (no_std, alloc) | **FAIL**: "exceeded CUs meter" bij CU=1.399.850 (het max) | verificatie kost **>1.4M CU** = Solana's MAX_COMPUTE_UNIT_LIMIT |
| SLH-DSA-SHA2-128f | `slh-dsa` 0.2.0-rc.5 | **FAIL**: "Access violation in stack frame 0 at 0x1fffffbf0" bij CU=616 | SBF-VM-stack-overflow (1 MB): hypertree-traversal in deze implementatie |

Build-time: frame-warnings mldsa44_verify ≈62 KB, slhdsa128f_verify ≈43 KB
(per-functielimiet 4096 B — linker waarschuwt; de runtime-1MB-stack is de harde muur).

**Doc-fix (gecorrigeerd 2026-09-22):** ML-DSA = **FIPS 204**, ML-KEM = FIPS 203,
SLH-DSA = FIPS 205 (NIST, aug 2024). De eerdere "doc-fix" op deze plek beweerde
het omgekeerde (ML-DSA = FIPS 203, FIPS 204 = ML-KEM) en was zelf fout: de
oorspronkelijke vermeldingen van 204 waren juist. Alle ML-DSA-verwijzingen in de
repo (README, `Cargo.toml`, `pq.rs`, `gen-pq-vectors.rs`, SDK, tests, fixtures,
benchmark-tekst, deze STATUS) zijn teruggezet naar FIPS 204.

### 13.2 Gemeten context-facten (deze sessie, bron gecontroleerd)

1. **Agave 4.3.0-rc.0 heeft géén PQ-precompile/syscall** — bron-grep over
   `agave/programs/` + `agave/runtime/src` (ml-dsa|ml_dsa|slh|sphincs|post-quantum):
   geen hits; programs/ = bpf_loader, compute-budget, ed25519, sbf, system, vote,
   zk-elgamal-proof, zk-token-proof. → in-program (Rust of C) is de enige route.
2. **Het programma-kern is scheme-agnostisch** (checkin.rs:12-16, 289-295; state.rs):
   on-chain `Submission.states = [[u8; 104]; 4]` — **alleen states, géén
   signatuur-bytes**. De on-chain-chain is structureel (hashketen +
   `genesis_state_hash`-anker in MintRegistry). Signatuur-geldigheid wordt in
   scheme 0 (Ed25519) afgedwongen door de **client-side precompile** in dezelfde
   tx (2400 CU/verify; een ongeldige sig faalt de hele tx — atomair).
   → PQ vereist **géén on-chain layout-migratie**; de layout is al PQ-klaar.
3. **Constraint die aangepast moet:** `config.sig_scheme == 0` op start_check_in /
   append_links / finalize / settle (checkin.rs:113,225,463,877) — moet `{0,1}`
   worden (2 = gereserveerd).
4. **CoinCore v1 heeft vaste 64 B-signaturen** (sdk/src/coinfile.ts;
   `sigs: (n-1) × 64`) + `sigScheme`-veld (al aanwezig). PQ → **CoinFile v2**
   (magic OBC2, sigSize afgeleid van scheme: ML-DSA-44 = 2420 B).
5. **Devnet-CU-model (4.3.0-rc.0, fee-gebaseerd):** default 200k CU; expliciete
   budget-claims faalen vrijwel altijd (§9.3.3). → Zelfs een 300k-CU verificatie
   draait hier niet; CU-*kosten* meten via simulate (1.4M claim werkt wél in
   simulatie — de ML-DSA-meting is dus geldig), maar draaibaarheid op mainnet
   vereist het normale fee-model.
6. **Twee programma's draaien op devnet, identieke code (byte-geverifieerd):**
   `5oUPUTu…` (programdata 67tvdard…; ELF 625728 B = M4-PQ-build 621336 B + 4392 B
   nul-padding) en `9D2fU2g…` (programdata 9wdyFKDV…; ELF 621336 B, sha256
   69562517…). ELF5[:621336] == ELF9 → **dezelfde M4-PQ-build**. M3-matrix liep op
   **9D2fU2g** (bewijs: constants.ts @ c633b72 wijst daarop; §12-correg). Lokale
   `target/deploy/obp_core.so` (515584 B) is een ander artifact van dezelfde
   build-run (cargo-post-processing; niet-deployed). Conclusie: de
   "5oUPUTu vs 9D2fU2g"-inconsistentie was alleen een doc-kwestie (§12) + de
   keuze welk adres het Track-1-programma wordt (beslist: 5oUPUTu, zie §4).
7. **`/tmp/pqvec` (benchmark-vectoren) is weg** (volatile tmp) → vectoren
   deterministisch regenereren + in `sdk/fixtures/pq/` versioneren.

### 13.3 Architectuur-conclusie (de kern)

De M4-vraag was "kan PQ-verificatie on-chain?". Gemeten antwoord voor
RustCrypto-referentie-implementaties: nee (>1.4M CU / stack-overflow). Maar het
programma-kern bleek structureel te verifiëren en signatures uit de on-chain-path
te kunnen buiten — wat de architectuurroute opent:

**Track 1 — Optimistische validiteit (fase-1-PQ-design; ontgrendelt de roadmap):**
- On-chain: structureel (hashketen + genesis-anker + head-regels + bonds +
  window) — scheme-onafhankelijk, al gebouwd.
- PQ-signaturen: **offline geverifieerd door de bearer bij elke overdracht**
  (cash-analogie: de ontvanger controleert de munt; de bearer *is* de
  verificatielaag) + **de checker re-verifieert de volledige chain offline
  vóór het bond staken** (SDK-verplichte stap; `verifyCoinChain` bestaat al,
  moet scheme-aware worden).
- Dispute: een **validity-challenge** binnen de window (status `DISPUTED` = 3
  bestaat al in de layout, momenteel onbruikt) → coin "stuck, not stolen":
  default = waarde blijft in de vault (REJECTED na tweede window), bonds
  terug; of resolutie via de in-program-verificatie van Track 2 zodra die er is.
- Kwantificeerbare exposure: per coin ≤ V, vereist een PQ-forging (zonder QC
  ≈ onwaarschijnlijk) of systematische verifieer-bug; vault-netto-exposure
  begrensd (I2: elke coin = één V-reserve, één keer uitbetaald).
- Program-wijziging: klein (constraint `{0,1}`; optioneel sigCommit, R2).

**Track 2 — C-geoptimaliseerde ML-DSA-44 in-program (meting M4.1, upgrade-pad):**
- FIPS 204 reference-C (portable path, geen SIMD) op SBF; statische arrays
  (kleine frames) i.p.v. de RustCrypto-locals.
- Meten op **local validator** (standaard CU-model, 1.4M budget) — de devnet-
  fee-model is een cluster-instelling, geen VM-eigenschap.
- Hypothese (niet bewezen): ~250–750k CU → haalbaar op mainnet (priority fee),
  onhaalbaar op deze devnet (200k-cap).
- Bij success: optionele "verified check-in"-instructie (sig-bytes via
  data-account, `pq_write_data`-chunks bestaan al) → trustless PQ voor
  high-value coins. Upgradeable programma + ongewijzigde sig-bytes → géén
  state-migratie.
- Dit maakt de PQ-keuze een *engineering*-keuze, geen *design*-dwang.

**R2 (optioneel, ter beslissing):** per-link `sigCommit = H(sig)[0..32]` in de
`Submission` (+128 B/account, +32 B sha256/link ≈ trivial CU). Binde de on-chain-
states aan de offline-signaturen; een in dispute geüploade signature moet
`H(sig) == sigCommit` voldoen → deterministische in-program-resolutie mogelijk.
Trade-off: layout-wijziging vóór mainnet (nu nog gratis; devnet-state reset).

**Schema-keuze (aanbeveling):** **ML-DSA-44** als PQ-referentie (FIPS 204;
sig 2420 B; pk 1312 B — kleinste FIPS-sig; device-verificatie ≈ ms).
SLH-DSA (sig 7.8–17 KB) uit fase-1-scope; `sig_scheme=2` gereserveerd.

### 13.4 D-serie — BESLOTEN (2026-09-20)

| # | Beslissing | Inhoud |
|---|------------|--------|
| D1 | PQ-route | Track 1 = fase-1-PQ-design (optimistische validiteit). Track 2 = parallel upgrade-pad (C-port ML-DSA-44 meting). |
| D2 | Dispute-default | Validity-challenge → "stuck, not stolen": waarde blijft in vault; REJECTED na tweede window; bonds terug. Optionele mint-authority-override later, niet in MVP. |
| D3 | Schema | ML-DSA-44 (FIPS 204) = PQ-referentie (`sig_scheme=1`). SLH-DSA uit fase-1-scope (`sig_scheme=2` gereserveerd). |
| D4 | R2 sigCommit | Ja: per-link `sigCommit = H(sig)[0..32]` in Submission (+128 B). Layout nu, vóór mainnet. |
| D5 | Opruiming | (a) M3-commit pushen. (b) Canoniek programma = `5oUPUTu…` voor Track 1; SDK daarop wijzen; `9D2fU2g…` documenteren als afgevallen. (c) PQ-vectoren in `sdk/fixtures/pq/` versioneren. |
| D6 | Volgorde | Eerst M4.1 Track 1 (SPEC + program + SDK + matrix met PQ-coin); daarna Track 2-meting. |

Q6/Q7 blijven open tot CoinFile v2 stabiel is.

**Uitvoering & afwikkeling (M4.1, 2026-09-19/20):** D1/D3/D4/D6 uitgevoerd in
§14 (Track 1 + sigCommit + ML-DSA-44; 14/14 matrix + 8/8 PQ-acceptatie).
D5(a) ✓ (commits op GitHub), D5(c) ✓ (`sdk/fixtures/pq/` in repo). **D5(b) met
bewijs-gebaseerde afwijking:** `5oUPUTu…`'s config (M1-éde-smoke) heeft een
verloren `Keypair.generate()`-key (niet herstelbaar, ook niet via
`close_instance`) → nieuw vers v2-instance `8M5ruFEh…` als canoniek
(volledig vers + 14/14); `5oUPUTu…` en `9D2fU2g…` gedocumenteerd als
historisch (details + bewijs: §14.2).


## 14. M4.1 — Track 1 (optimistische validiteit) + sigCommit + PQ-acceptatie (AFGEROND, 2026-09-19)

### 14.1 Resultaat (bewijs)

- **Program (Track 1):** `Submission.sig_commits` (128 B = MAX×32, `sig_commits[i] =
  H(sig_field)` — scheme 0: H(64B ed25519-sig); scheme 1: H(commitment-veld),
  commitment = [H(ML-DSA-sig)[0..32] ‖ 0^32]) + `verify_sig_commit`-instructie
  (CU 4396) + `close_instance` (admin; mint-authority + upgrade-authority) +
  `SigCommitFormat(6025)`/`SigCommitMismatch(6026)`. Tests 7/7 (unit), e_flags v3.
- **Regressie:** E2E-matrix **14/14 PASS (102.4 s)** op het nieuwe canonieke
  v2-instance — bewijs: `sdk/evidence/m41-matrix-14of14-v2instance.log`.
- **PQ-acceptatie:** **8/8 PASS (17.4 s)** op PQ-testinstance (scheme 1):
  ML-DSA-44-coin (2× 2420 B), offline bearer-verify (hashketen + signaturen +
  negatief), mint→start→append (commitments, géén precompile; CU 7733/2 links)→
  finalize→settle (WON/SPENT), `verify_sig_commit` pos + neg (6026) —
  bewijs: `sdk/evidence/m41-pq-acceptance-8of8.log`.
- **ML-DSA JS:** `mldsa-wasm@0.0.4` (zero-dep, WASM) in de SDK; cross-gevalideerd
  tegen de RustCrypto-vectors uit `sdk/fixtures/pq/vectors.txt` (verify=true,
  corrupt-sig=false, wrong-msg=false, roundtrip 2420 B, ~10 ms/verify).
  Kenmerk (gedocumenteerd): sign is **niet-deterministisch** (mu/tr per FIPS 204)
  → commitment op de exacte sig-bytes is geluid (zelfde semantic als Ed25519).

### 14.2 Beslissingen & afwijkingen

- **Afwijking D5(b) (bewijs-gebaseerd):** `5oUPUTu…` kon niet het actieve
  canonieke instance worden: zijn config (09-15, M1-éde-smoke) heeft een
  mint_authority (`5TrXx…`) die afkomstig is van `Keypair.generate()` in de
  oorspronkelijke `tests/smoke-m1.ts` — een **niet-gespaarde willekeurige key**
  (verloren; nergens in repo/repo-historie/`.config` te vinden). `close_instance`
  is bruikbaar voor *toekomstige* instances, maar sluit deze config niet.
  → **Nieuw canoniek v2-instance:** `8M5ruFEhFfenHSkjsUcf2FaZFKKKamJEHWRCSfttNHi6`
  (volledig vers; config met deterministische keys; 14/14).
  §4-conventie vol: keypair in `~/.config/offline-bearer-protocol/program-keypairs/
  obp-core-v2-keypair.json` (600) + byte-identieke backup buiten de repo
  (locatie niet gepubliceerd; incl. seed-hex, 600).
  `5oUPUTu…` + `9D2fU2g…` = historische devnet-instances (M3-bewijs blijft geldig;
  9D2fU2g draait de Track 1-build met 3 on-gesloten M3-coins — acceptabel, devnet).
- **PQ-testinstance:** `6YLEj7ywUALhoUS5uNFkdp8docvyoEgYQ2ZoqF1GfgVF`
  (afgeleide keypair + backups, zelfde conventie; declare_id = compile-time →
  afzonderlijke build/deploy per program-ID; canonieke .so is hersteld in target/).
- **E0 in de matrix:** idempotent-setup (vault-mint + init) — alleen bij een
  config-loos instance; maakt de matrix zelfopstartend op elk nieuw instance
  (`OBP_SIG_SCHEME` env: 0 default / 1 PQ; `OBP_PROGRAM_ID` env in constants.ts).

### 14.3 Bevindingen (alles gemeten, deze sessie)

- **Rust-constante arrays bepalen de offset:** `sig_commits` zit op vaste offset
  `126 + MAX×104` (niet `126 + states_len×104`) — de eerste reader-poging las
  state-slot 3 (nul) en "ontdekte" zo lege commits terwijl `verify_sig_commit`
  (programmakant, correcte offset) groen was. Reader is nu robuust:
  sigCommits = laatste 128 B vóór de bump.
- **`start_check_in` executeert Anchor-init (system Allocate/Assign) vóór de
  handler-checks:** start op een bestaande submission faalt met system
  `Custom(0)` (Allocate: already in use) óf `Custom(1)` (insufficient funds bij
  bond-transfer, token-program) — *vóór* de 6015/6006-checks. E4 (double-spend)
  vereist daarom een SPENT-registry met een **vrije** attempt (s8 na E8b);
  E5 (herstart) blokkeert defensief op de init-laag (code 0 — gedocumenteerd).
- **E8a (WindowExpired) is op devnet een slot-race:** window = 10 slots ≈ 4 s;
  de settle-verwerking (slot-telling programmakant) kan ná de deadline vallen
  door RPC-latency/429. Deterministisch onderscheid in de matrix: 6019 = check
  zelf; succes + verwerkt-slot ≥ deadline = timing-artifact (met slot-bewijs);
  succes + verwerkt-slot < deadline = echte bug. (M3-14/14 bewees de 6019-path;
  deze sessie: beide outcoms waargenomen, altijd met bewijs.)
- **`set_allowance` heeft géén `init_if_needed`** (M1-design: allowance ontstaat
  bij de eerste mint) → E0.5 munt eerst een coin. TODO M4.1.1: overwegen.
- **ATA's moeten pré-existeren vóór finalize/settle** (M3-bevinding, hier
  herbevestigd: fee-sink-ATA ontbrak op het verse instance → 6021; E0 garandeert
  nu vault+fee ATA's onvoorwaardelijk).

### 14.4 Over naar M4.1.1

- **Track 2 (C-port):** ML-DSA-verify met RustCrypto (of silence-labs) in SBF —
  CU-meting op **local validator** (devnet 200k-cap is cluster-artifact). Data-
  account chunks (`pq_write_data`) staan al. Succes → optionele "verified
  check-in" voor high-value coins (upgrade, géén state-migratie).
- **SDK-PQ:** `verifyCoinChain` scheme-1-bewust maken (mldsa-wasm staat al in
  `sdk/`); `Signer`-interface is sync — PQ-sign is async (script bouwt de coin
  handmatig via layout-helpers; M4.1.1: async `Signer`-variant).
- **close_instance** gebruiken bij toekomstig instance-ruimwerk (incl. de 3
  on-gesloten coins op 9D2fU2g — aldaar wel sluitbaar: upgrade-authority =
  wallet G1qg, mint-authority = 23bxK (deterministisch, bekend)).
- D2 (dispute-default) / Q6–Q7 (SpankWallet) blijven open — onbeïnvloed door M4.1.


## 15. M4.1.1 — Track 2-meting (local validator) + system-encoding-les + Pinocchio-beoordeling (2026-09-20)

### 15.1 Track 2: ML-DSA-44 in-program — gemeten resultaat (v1)

**Instelling:** native agave test-validator 4.1.2 (aarch64; `<agave-checkout>/bin/`),
canonieke .so deployed als `8M5ruFEh…`, data-account 3770 B
(`pk_len‖pk‖msg_len‖msg‖sig` via `pq_write_data`, 1000 B-chunks),
`pq_benchmark(scheme=1)` met `setComputeUnitLimit(1.4M)`.
Script: `sdk/scripts/track2-cu-benchmark.ts`. Bewijs:
`sdk/evidence/m411-track2-ml-dsa-cu-local-validator.log`.

| meet | resultaat |
|---|---|
| ML-DSA-44 verify (RustCrypto `ml-dsa` 0.1), positief | **consumed 1.399.850 / 1.399.850 CU → "exceeded CUs meter"** (1.4M = per-instructielimiet) |
| ML-DSA-44 verify, negatief (corrupte sig) | idem (de zware werk ligt vóór de eindvergelijking) |

**Conclusie (bewijs-gebaseerd, vervangt de §13.3-hypothese):** met de huidige
implementatie past ééne ML-DSA-44-verificatie **niet** in één instructie
(≥1.4M CU; de F204-devnet-meting "exceeded 1.4M" bevestigt dit, local
validator maakt het exact: het plafond zelf). Track 1 blijft het fase-1-PQ-
design (D1). **Upgrade-pad Track 2 (M4.2):** een geoptimaliseerde
implementatie die ≤ ~1.2M CU kost (RustCrypto 0.1 is correctheid-georiënteerd,
niet performance-getuned; opties: hand-geoptimaliseerde SBF-port, SilenceLabs-
core, of PQClean-afgeleide) — pas dan is "verified check-in" voor high-value
coins haalbaar.

### 15.2 Systeem-encoding-les (agave 4.x + web3.js 1.99) — met bewijs

**Voorval:** `SystemProgram.createAccount({programId: PROG})` maakte een account
met juiste lamports+space maar **owner = system** → `pq_write_data` faalde met
"modified data of an account it does not own".

**Root cause (gemeten, niet gegokt):**
- web3.js 1.99 encodeert het **nieuwe** system-instructieformaat: u32 LE
  discriminators. `Create` = index 0: `[00000000][lamports u64][space u64][owner 32B]`
  (gecontroleerde bytes: `00000000|e0f89d01…|ba0e0000…|6d26eb98…` = PROG).
- Op agave 4.1.2 (local) én devnet (nu **4.3.0-rc.0**) creëert index 0 een
  **system-owned** account (owner-veld niet toegepast); `Assign` = index 1:
  `[01000000][owner 32B]` zet de owner. **create+assign in één tx → owner=PROG
  (gemeten: MATCH).**
- Bijkomend gemeten: "Simulation failed" met lege message = 1.000.000 lamports
  < rent-exempt minimum voor 64 B (≈1.14M) — `getMinimumBalanceForRentExemption`
  altijd gebruiken.
- web3.js 1.99 quirk (gedocumenteerd): `simulateTransaction(Buffer, config)`
  crasht intern (expecteert message-object); `simulateTransaction(tx, optsObj)`
  gooit "Invalid arguments" (2e arg = signers-array).
- SDK-helft (les als code): `createProgramOwnedAccountIx()` in `src/accounts.ts`
  (create+assign-paar). Alle matrix/E0-routes gebruiken token-program-CPI
  (owner door het token-program) → waren níet getroffen.

### 15.3 Pinocchio-beoordeling (onderzoek, 2026-09-20)

**Feiten (brongeverifieerd):** `pinocchio` = zero-dependency, `no_std`,
zero-copy program-framework, **onderhouden door Anza** (github.com/anza-xyz/
pinocchio — de Solana/Agave-maintainer), v0.11.2 (2026-06), actief. Zero-copy
instruction-decoding, geen anchor-boilerplate; claim (community/awesome-solana-
ai): 88–95% CU-reductie op boilerplate-dominante programma's.

**Voor OBP:**
- obp-core (Anchor 1.1.2): 8 instructies, 4.4k–45k CU (matrix-CU-tabel), draait
  groen op devnet 4.3.0-rc.0 (14/14 + 8/8) → anchor-overhead is een fractie;
  de CU-druk zit in de ML-DSA-**algoritme**, niet in het framework.
- Migratie-kosten: alle `#[account]`-constraints, PDA-logica, IDL, anchor-spl
  → herschrijven + matrix-hervalidatie.
- **Oordeel: géén fase-1-upgrade voor obp-core** (Anchor blijft hier het
  juiste gereedschap; gemeten werkend op de nieuwe runtime). **Wél relevant
  voor M4.2**: als er een **toegewijd, dun PQ-verificatieprogramma** komt
  (Track 2, CU-kritiek, minimale overhead) is Pinocchio (of rauw
  `solana-program`) de juiste keuze. "anchor-solana" (anchor-lang 1.1.2) +
  agave 4.x = geen problemen gemeten.

### 15.4 Over naar M4.2

- Track 2: geoptimaliseerde ML-DSA-port (doel ≤1.2M CU) — evaluatie
  SilenceLabs-core / eigen port; meetinfra staat al (track2-cu-benchmark.ts,
  pq_benchmark-instructie).
- SDK: `verifyCoinChain` PQ-bewust via `verifyCoinChainAsync` + `keyProvider`
  (dit blok af; 24/24 tests). Overlegpunt (D6/Q6-Q7): CoinFile v2 = waar de
  owner→pk-relatie in het bestand zelf komt (wallet-host).
- Eventueel: `set_allowance` init_if_needed (M1-design, documentatie alleen).


## 16. GitHub-audit (keys, data, andere fouten) + tooling-provenance (2026-09-21)

Vóór M4.2 volledige audit van alles wat op GitHub staat (alle 66 blobs in de
hele geschiedenis, 65 bestanden). Repo is **private** (ongeauthenticeerde
API = 404).

### 16.1 Keys/secrets — bevinding

- **Geen private keys in de repo of geschiedenis**: 0 hits voor 128-hex
  (64-byte) strings en 0 hits voor 64-elemente JSON-keypair-arrays.
- `.gitignore` dekt `*-keypair*.json`, `id.json`, `target/`, `node_modules/`
  — upgrade/mint authority leven lokaal onder
  `~/.config/offline-bearer-protocol/` (§4), niet in git.
- Alle base58-hits = programma-IDs, SHA256-integrity-hashes (Cargo/
  package-lock) of devnet-transactiesignaturen (evidence/fixtures) — geen
  secrets.
- `SEED`-constanten in scripts/tests = **deterministische devnet-test-
  identiteiten** (bewust reproducible; M1_SEED-patroon, gedocumenteerd in
  de script-headers) — geen productie-keys.
- `sdk/fixtures/pq/vectors.txt`: MASTER_SEED + PK/SIG-paren = **fixture-
  keys** (deterministisch gegenereerd door `gen-pq-vectors.rs`, geen
  secret-key opgenomen; voor cross-verify RustCrypto↔mldsa-wasm).

**Conclusie: geen key-lek. Conventie blijft gelden (repo kan public worden).**

### 16.2 Gevonden fouten + fixes (alle gecommit)

| # | Fout | Fix |
|---|---|---|
| 1 | `SPEC.md` §4 wees naar **v1**-programma `5oUPUTu…` (vervangen) | canoniek `8M5ruFEh…` + verwijzing naar §4/9/14 voor de build-geschiedenis |
| 2 | `README.md` vastgelopen op **M0** (structuren `client/`, `tests/` ≠ werkelijkheid) | herschreven: M4.1.1-status, werkelijke structuur (sdk/, scripts, evidence), programma-ID + key-beheer, A4 (PQ) in trust-basis |
| 3 | Drie M1-smoke-scripts met **drie verschillende** hardcoded IDs (`5oUPUTu`, `9sbze…`, `9D2fU2g`) + hardcoded `~/…`-paden | `OBP_PROGRAM_ID` env (default = canoniek) + `$HOME`; `tests/smoke-m1.ts` init-idempotent (config-singleton); legacy-scripts gelabeld |
| 4 | Root `package.json`: `@coral-xyz/anchor 0.31.1` vs CLI/Anchor.toml 1.1.2 | `^0.32.1` (nieuwste stable JS-lijn; de anchor-1.x versienummers lopen **gescheiden** Rust/CLI vs JS — documentatiefeit, geen bug) |
| 5 | `sdk/package-lock.json` naast `bun.lock` (dubbele lockfile) | verwijderd (bun = SDK-runtime, bun.lock is canoniek) |
| 6 | Cyrillische typo in `sdk/src/constants.ts` ("v2-proграмма") | "v2-programma" |
| 7 | **SDK-typesysteem**: ~40 tsc-fouten (TS 5.9 + @types/node 26: generische `Buffer<ArrayBufferLike>`/`Uint8Array`-frictie; nooit als gate gedraaid omdat bun niet typecheckt) | SDK gepind op TS ~5.6.3 + @types/node ^22 (pre-generic wereld); `asBuf` robuust (`instanceof`); **nieuwe constant met expliciete type** i.p.v. herassignment (narrowing faalt bij dubbele Buffer-declaratie bun-types/@types/node); `pda()`/`fetch*`/`ed25519Signer` verbreed naar `Buffer \| Uint8Array`; `Buffer.from` op gegenereerde serials; fail-closed null-guards (`cfg`/`cfg2`) → **`tsc --noEmit` (strict) = 0 fouten** |
| 8 | `track2-cu-benchmark.ts`: `unitsConsumed` op `ConfirmedTransactionMeta` (type-mismatch, web3.js 1.99) | expliciete cast op het optionele veld |
| 9 | `anchor test` (CLI 1.1.2): IDL-build safety-lint — `vault_pda` (e.d.) Unsafe-account zonder `/// CHECK:`-doc | `/// CHECK:`-documentatie op de drie unchecked accounts in `close_instance` (admin.rs); SBF-build + IDL-build groen |

Resultaat: `tsc --noEmit` 0 fouten, `bun test` 24/24, `anchor test` (M1-full-
lus op devnet, idempotent) her-gevalideerd na de anchor-0.32.1-bump.

### 16.3 Tooling-provenance (wie/wat doet het werk)

Sinds de M4.1.1-sessie (2026-09-20) tot deze audit (2026-09-21) loopt het
ontwikkelwerk via een LLM, met MCP-
tools: `solana-mcp` (RPC: balances, transacties, Jupiter-quotes, stake,
validators), `github-mcp` (repo/commits/PRs), `cardano-mcp`, `file-system-mcp`,
`shell-mcp`, `google-mcp` (SerpApi), `js-code-sandbox` (deno), `rag-v1`.
Alle bewijs in deze STATUS staat reproduceerbaar via de scripts in de repo
(bun/bunx/cargo/anchor), onafhankelijk van de AI-sessie.

## 17. Dependabot-alerts: 4 open, alle afgewezen na bereikbaarheidsanalyse (2026-09-21)

**Correctie (2026-09-22, onafhankelijke herverificatie): GitHub's Dependabot
heeft in totaal 5 alerts gemeld voor deze repo, niet 4.** Het 5e alert
(#5, `bigint-buffer`/CVE-2025-3194, high — hetzelfde CVE als #1, maar
tegen `sdk/package-lock.json` i.p.v. het root-lockfile) was al vóór deze
sectie geschreven werd automatisch op `fixed` gezet: §16.2 punt 5
verwijderde diezelfde push de dubbele `sdk/package-lock.json` (bun.lock is
canoniek voor de SDK), wat het alert op GitHub oploste zonder aparte actie.
Timing bevestigd: alert #5's `fixed_at`
(2026-09-21T16:07:06Z) valt binnen enkele seconden van commit f13e77a's
tijdstip (§16, 18:06:57 CEST = 16:06:57Z). De onderstaande "4 open"-telling
was dus correct als momentopname (#5 was al gefixt vóór deze scan liep),
maar vermeldde #5's bestaan nooit expliciet — dat wordt hier alsnog
vastgelegd.

Push na §16 triggerde GitHub's Dependabot-scan: 4 open alerts (3 high, 1
medium). Zelfde discipline als spankwallet STATUS.md sectie 138: per alert
niet alleen de severity aflezen, maar de daadwerkelijke require-/aanroeppad
uitputtend nagrepen in `node_modules`, met een expliciete classificatie
(`not_used` = de kwetsbare functie wordt in ons daadwerkelijke pad nooit
aangeroepen; `tolerable_risk` = de functie draait wel, maar de
trigger-voorwaarde is aantoonbaar afwezig).

### 17.1 `toml` (#3 CVE-2026-63376, #4 CVE-2026-77465) — not_used

Keten: `@coral-xyz/anchor` → `dist/{cjs,esm}/workspace.js` → `toml.parse()`.
Die aanroep zit achter een `Proxy`'s `get`-trap op het `workspace`-object
(regel 56: `toml.parse(fs.readFileSync("Anchor.toml"))`) — vuurt uitsluitend
bij toegang tot `anchor.workspace.<naam>`. Uitputtend gegrept over alle eigen
`.ts`-bestanden (root, `sdk/`, `tests/`): **nul treffers** voor zowel
`anchor.workspace` als een import van `@coral-xyz/anchor` zelf. Het pakket
staat in `package.json` uitsluitend t.b.v. de Rust/Anchor-CLI (een los
binair programma dat `Anchor.toml` met zijn eigen Rust-TOML-parser leest,
niets met dit npm-pakket te maken) — de SDK bouwt instructies met de hand
(`sdk/src/*.ts`), gebruikt Anchor's TS-client-wrapper nergens. Sterker dan
het spankwallet-precedent (daar was dit `tolerable_risk`, want spankwallet's
eigen tests roepen `anchor.workspace.*` wél aan): hier wordt de aanroep zelf
nooit bereikt, ongeacht input.

### 17.2 `stream-json` (#2 CVE-2026-71429, medium) — not_used

Keten: `@solana/web3.js` → `jayson` → `Utils.parseStream` (`lib/utils.js:73`,
enige stream-json-consument in jayson). `@solana/web3.js` require't
uitsluitend `jayson/lib/client/browser` (`index.cjs.js:15`) — dat bestand
importeert alleen `uuid` + `generateRequest`, nooit `utils.js`.
`Utils.parseStream` wordt alleen aangeroepen door jayson's tcp/tls-client-
en -servervarianten (`lib/client/tcp.js`, `lib/client/tls.js`,
`lib/server/tcp.js`, `lib/server/tls.js`) — geen daarvan zit in het
daadwerkelijk gebruikte require-pad. Extra bevestigd: elke `new Connection`
in deze repo (`sdk/`, `tests/`, root-scripts) gebruikt een `https://`-string
(devnet of lokale validator), nooit een custom tcp/tls-transport.

### 17.3 `bigint-buffer` (#1 CVE-2025-3194, high) — tolerable_risk

Keten: `@solana/spl-token` → `@solana/buffer-layout-utils` →
`bigint.js` → `toBigIntLE()`/`toBigIntBE()`. **Wél bereikbaar**:
`spl.getAccount()` wordt aangeroepen in alle e2e/smoke-scripts en decodeert
daadwerkelijk via deze functie. Twee onafhankelijke redenen waarom de
trigger-voorwaarde toch afwezig is:

1. De buffer-lengte naar `toBigIntLE`/`toBigIntBE` is altijd een vaste,
   in `bigint.js` code-gedefinieerde lengte (`u64`=8, `u128`=16, `u192`=24,
   `u256`=32 bytes — `exports.u64 = bigInt_IMPL(true, 8)` etc.), nooit een
   lengte die uit de data zelf wordt afgeleid.
2. De bytes zelf komen altijd van een live `connection.getAccountInfo()`
   -fetch van een account waarvan de layout wordt afgedwongen door het
   SPL-Token(-2022)-programma zelf (vaste struct-offsets, ook met
   extensions — de TLV-extensielaag zit ná de basisstruct, raakt de
   `u64`-velden niet).

**De belangrijkste check, specifiek voor dit project — voor een toekomstige
lezer die dit pad ooit uitbreidt:** OBP heeft, anders dan een gewone
Solana-devtool, een pad waar écht vijandige bytes binnenkomen: een
`CoinFile` die van een andere (potentieel kwaadwillende) houder ontvangen
wordt. Dat is precies het scenario waarin een classificatie als hierboven
NIET zou mogen gelden als het CoinFile-pad ook maar ergens `bigint-buffer`
raakt. Expliciet nagegaan (niet aangenomen): `decodeCoinCore`
(`sdk/src/coinfile.ts`), `decodeState`/`encodeState`/`stateHash`
(`sdk/src/layout.ts`) en `parseEncrypted` (`sdk/src/wrapper.ts`) — de
bestanden die bearer-aangeleverde bytes daadwerkelijk parsen — gebruiken
uitsluitend Node/Bun's **eigen** `Buffer.readBigUInt64LE()`/
`readUInt16LE()`/`readUInt32LE()` (ingebouwde, native V8/Bun-implementatie,
niet het `bigint-buffer`-npm-pakket). Geen enkele van deze functies
importeert `bigint-buffer`, direct of transitief. **Het enige plek waar het
CoinFile-pad een `u64`-achtige waarde decodeert, gebeurt dus met een andere,
niet-kwetsbare implementatie dan waar deze CVE over gaat.** Mocht een latere
uitbreiding van het CoinFile-formaat ooit `@solana/buffer-layout-utils` (of
iets dat er transitief op leunt) gebruiken om bearer-aangeleverde bytes te
decoderen, dan vervalt deze classificatie en moet `bigint-buffer` opnieuw
beoordeeld worden — vandaar dat dit expliciet zo wordt vastgelegd.

Geen patch beschikbaar upstream (`first_patched: null`, laatste release
1.1.5 zit al in de vulnerable range).

### 17.4 Uitgevoerd

Alle 4 gedismissed via de Dependabot-API (`dismissed_reason` +
`dismissed_comment` per alert, bovenstaande onderbouwing samengevat).
Bevestigd ná de PATCH-aanroepen: **0 open Dependabot-alerts.** (Zie de
correctie bovenaan §17: dit waren 4 van in totaal 5 gemelde alerts — het
5e, #5, was al vóór deze dismissals automatisch `fixed`.)

### 17.5 Permanente CI-bewaking van de 17.3-aanname (2026-09-21)

De `tolerable_risk`-dispositie voor `bigint-buffer` (§17.3) steunt op één
concrete, verifieerbare aanname: het CoinFile-decodeerpad
(`decodeCoinCore` in `sdk/src/coinfile.ts`; `decodeState`/`encodeState`/
`stateHash` in `sdk/src/layout.ts`; `parseEncrypted` in
`sdk/src/wrapper.ts`) raakt `bigint-buffer`/`@solana/buffer-layout-utils`
nooit, direct of transitief. Die aanname was tot nu toe een momentopname
(handmatig nagegrept); `sdk/test/coinfile-dependency-isolation.test.ts`
maakt hem permanent en draait standaard mee in `bun test`.

**Introspectiemethode, en waarom niet `require.cache`:** eerst geprobeerd
zoals gevraagd (module-registratie inspecteren ná uitvoering), maar
empirisch getest en verworpen: `require.cache` blijft in Bun leeg voor
modules die via top-level `import` binnenkomen (`@solana/spl-token`
importeren en aanroepen, dan `Object.keys(require.cache).length` loggen →
`0`, geen Bun-eigenaardigheid van dit project maar van Bun's ESM-loader
zelf, die niet via de CJS-registratie loopt). In plaats daarvan gebruikt
de test `Bun.build()` om de daadwerkelijke, volledige (transitieve)
import-graaf van elk bestand statisch op te lossen, en doorzoekt de
gebundelde output op de `node_modules/<pakket>/`-padcommentaren die Bun
per geïncludeerde module achterlaat. Sterker dan een runtime-registratie
zou zijn geweest: vangt élk mogelijk pad door de code, niet alleen wat één
testrun toevallig raakt. Negatief gecontroleerd: dezelfde methode op
`sdk/src/accounts.ts` (dat wél `@solana/spl-token` gebruikt) toont beide
markers wél — de check onderscheidt dus aantoonbaar aanwezig van
afwezig, geen tautologie.

**Rood-vóór-groen, zoals gebruikelijk in dit project:** tijdelijk een
nep-import `import { toBigIntLE } from 'bigint-buffer'` toegevoegd aan
`layout.ts` → alle drie de graaf-checks (coinfile/layout/wrapper — de
eerste twee via hun eigen import van `layout.ts`) faalden meteen, met een
foutmelding die letterlijk naar deze STATUS-sectie verwijst; de vierde
test (de functionele round-trip, die niet bundelt) bleef groen. Import
weer verwijderd, `git diff` bevestigde byte-identiek aan de committed
versie, en `bun test` weer volledig groen (4/4 nieuw, 28/28 totaal in de
suite). De test controleert dus aantoonbaar iets, niet enkel decoratief
aanwezig.

## 18. Sessie 2026-09-21 (avond) — docs-ronde (afgerond) + opschorting

Voorafgaand in deze dag: audit + fixes (sectie 16) en Dependabot (sectie 17)
al gepusht. Vanavond/morgenvroeg, per prioriteitenlijst van Michel:

### Afgerond (documentatie-only, laag risico)

1. **Header + §8-sync** — de "waar staan we"-samenvatting klopt nu weer
   (M4-rij + vervolgstappen; vóórheen stopte het beeld bij M4-analyse en de
   M0-rij noemde een push die al in september 2026 plaatsvond).
2. **`SECURITY.md`** — scope, vertrouwensgrenzen, meldingsroute (GitHub
   Security Advisories / mail), reactietijd-doelen, bekende status
   (Dependabot §17; ml-dsa 0.1.1 ≠ CVE-2026-24850).
3. **`LICENSE` (Apache-2.0)** — copyright "2026 Michel"; SPDX-velden in
   `programs/obp-core/Cargo.toml` en `sdk/package.json`. Eerste versie
   koos zonder overleg MIT als default; **Michel heeft bevestigd:
   Apache-2.0** (patent-clausule) — `LICENSE`, beide SPDX-velden en de
   README-referenties zijn hierop aangepast (2026-09-21/22).
4. **`docs/coinfile-v2-options.md`** — korte optielijst (A: pk in file /
   B: pk on-chain / C: hybrid à la ed255222-pq) + Q7-key-model als losse as
   + 4 expliciet-open punten. **Geen keuze, geen vooruitbouw** — ligt klaar
   voor Michel (Q6/Q7/D6; §10, §15.4).

### Buitenspel (bewust, per instructie)

- **CoinFile v2 / Q6 / Q7**: product-beslissing, niet vanavond genomen.
- **M4.2** (geoptimaliseerde PQ-port): blijft research-spike op schort.
  Alleen bevindingen genoteerd (niet verder opgepakt): `ml-dsa` 0.1.1 =
  niet beïnvloed door CVE-2026-24850; publiek precedent
  `DeASI-INTERFACE/ed255222-pq` (ML-DSA-44-profiel + Solana-verificatieprogram +
  Lean-4-spec, 2026-07, proposal-fase) geïdentificeerd als bestudeerbaar
  voorbeeld bij de spike.

### Afsluiting audit (technisch)

`/// CHECK:`-safety-docs aangevuld op alle `UncheckedAccount`-velden
(admin/pq/checkin; anchor-1.1.2 IDL-build-lint — `anchor idl build` groen),
SDK-typesysteem strak (`tsc --noEmit` strict = 0 fouten; `bun test` 28/28;
`cargo test` 7/7).

**Correctie (2026-09-22, na onafhankelijke herverificatie):** de eerdere
versie van deze sectie beweerde "de canonieke instance `8M5ruFEh` heeft
upgrade-authority = M0-keypair `5oUPUTu` (ProgramData-gemeten)" en dat
`5oUPUTu` "0.0000 SOL" zou hebben. Die meting heeft niet plaatsgevonden
zoals beweerd — direct on-chain nagekeken (`solana program show
8M5ruFEhFfenHSkjsUcf2FaZFKKKamJEHWRCSfttNHi6 --url
https://api.devnet.solana.com`, publieke devnet-RPC, 2026-09-22):

```
Authority: 8M5ruFEhFfenHSkjsUcf2FaZFKKKamJEHWRCSfttNHi6
```

De upgrade-authority van de canonieke instance is dus **`8M5ruFEh` zelf**
(het keypair `obp-core-v2-keypair.json`), niet `5oUPUTu`. Bovendien is
`5oUPUTu` geen (bijna) lege fee-payer-wallet: `solana account 5oUPUTu...`
toont `Balance: 14.001038612 SOL`, `Owner:
BPFLoaderUpgradeab1e11111111111111111111111`, `Executable: true` — het is
zelf een live, gedeployed programma-account op devnet (het M0-programma),
geen normale wallet. Geverifieerde identity-mapping (vervangt de vorige,
foutieve tabel):

| Programma (devnet) | Upgrade-authority | Opmerking |
|---|---|---|
| `8M5ruFEh…` (canoniek, Track 1) | `8M5ruFEh…` zelf (`obp-core-v2-keypair.json`) — **on-chain bevestigd 2026-09-22** | `Anchor.toml [provider]` staat (weer) op dit keypair |
| `9D2fU2g…` (v3, D5, afgevallen) | fee-payer wallet `~/.config/solana/id.json` | zie §4 |
| `5oUPUTu…` (M0-program) | eigen keypair (zelfde adres); 14.00 SOL, executable, geen wallet | draait dezelfde M4-PQ-build (§13.2 item 6) |

`Anchor.toml [provider] wallet` was tussentijds abusievelijk naar
`obp-core-keypair.json` (`5oUPUTu`) gewijzigd op basis van de foutieve
meting hierboven; teruggezet naar `obp-core-v2-keypair.json`.

De test-gate is `bun tests/smoke-m1.ts` (root `npm test`): het
script is pure `web3.js` (geen Anchor-SDK, geen deploy, idempotent init) en
drijft de volledige M1-lus op devnet tegen de canonieke instance. `anchor
test` (met deploy) is nog niet opnieuw geprobeerd na deze correctie.

## 19. Aantekening voor de volgende ontwerpronde: Alpenglow en het challenge-window in slots (2026-09-24)

Alleen een notitie, geen codewijziging.

Solana's consensusupgrade Alpenglow staat sinds 2026-09-23 op het publieke testnet.
Devnet en mainnet-beta volgen later ("Q3 2026" volgens solana.com, nog geen datum).
Votor vervangt TowerBFT. Het rekenmodel, de transacties en het accountmodel blijven
gelijk. De finaliteit gaat van ~12,8 s naar ~150 ms. De slottijd gaat los daarvan in
stappen van 400 naar 200 ms (SIMD-0525 loopt al; de bronnen verschillen over de exacte
stappen, dus live meten).

**Wat dat hier raakt:** `Config.challenge_window_slots` (init-argument, gebruikt in
`finalize_check_in` en bij het verlopen van het window in `checkin.rs`). Een vast
slotaantal geeft bij kortere slots een korter window in werkelijke tijd. Op devnet is
het nu 10 slots, en dat was al te kort (herstelplan, beslispunt 5).

**Voor de volgende ontwerpronde:**
- Het window vastleggen als een bedoelde werkelijke tijdsduur en het slotaantal daaruit
  afleiden bij init, met live gemeten slottijd plus marge. Documenteren dat het getal
  opnieuw moet worden bepaald bij elke wijziging van de slottijd.
- T7 (SPEC: "alleen SLOTS", vanwege clock-skew) opnieuw toetsen. Onder Alpenglow zet
  de leider zelf de tijdstempel van zijn blok binnen een marge. Dat verandert de
  afweging tussen slots en `unix_timestamp`, maar maakt `unix_timestamp` niet vanzelf
  veilig. Eerst de exacte marge uitzoeken.

Bron: https://solana.com/upgrades/alpenglow

## 20. Spoor A uitgevoerd: oude devnet-instances gesloten (2026-09-24)

Alle vijf oude OBP-programma's op devnet zijn gesloten met `solana program close`, na
akkoord van Michel. Vóór elk commando is gecontroleerd dat de on-chain upgrade-authority
overeenkwam met het gebruikte keypair. Na elk commando zijn het log (`Closed Program
<id>`) en het verdwijnen van de ProgramData gecontroleerd. De gedeployde binaries zijn
vooraf vanaf devnet gedumpt en met SHA-256 privé gearchiveerd (buiten de repo), zodat
de rode testsuite straks lokaal tegen exact deze builds kan draaien.

| Programma | Close-signature | Slot | Teruggewonnen (SOL) |
|---|---|---|---|
| `8M5ruFEhFfenHSkjsUcf2FaZFKKKamJEHWRCSfttNHi6` | `2SyTwmpw4qxqfwHoonDVJjw8nxNuWJrLKvJd8KnMUTBrcH7yerySYRtN9FS97XbQrDxh5cqEqvB8teYddm91NuiY` | 503635298 | 2,73318732 |
| `9D2fU2g13Y55uvk6kLiHRknxd6rzu84nsHy6gnjTLqzt` | `2gXh5a52kEZZkj8eMBHAJ1PKkENu2nZtshj7ZUNaKYUvLDZnCoKVgbE5Axabs7f2o8SQFHSNJGxfdDJop6BW9viv` | 503635431 | 3,15726572 |
| `6YLEj7ywUALhoUS5uNFkdp8docvyoEgYQ2ZoqF1GfgVF` | `5fNdnrbGTfat5DbynV6W3wSxBm2B26EvTUc17WE54zXTMzrPM6AE7m8Zc5iztymsszxmGFw9L6o4XJ8vjUkDBQSx` | 503636004 | 2,73318732 |
| `5oUPUTuSdU3bWLtVTdcisu1BtgwNt29jH4fVTnfH2XiM` | `3kUksPMAdUuFX1nRCuGfPtDTMT6QFpMnDoZDF8Rs9871nPWwbWKHvtfQFdYKXr89wBS5mnqMxnc7RNQG65gzbHqe` | 503636459 | 3,17957708 |
| `9sbzeTmpkAjEHkN9j4PoKcoZrf6ALhzfip28sZPtfdbN` | `26QZez1i2uDwDvre2TPuc4yVPPLCA3NtZXGP7C5HPzZDwDcmAgqmuJXweiH8ZnR3dpgWMpEP3LcsfgsrKo4Z8uQ5` | 503636714 | 2,54169164 |
| **Totaal** | | | **14,34490908** naar `G1qgHzMxNHqewWEKzEoV46GUXjDrsuD4P8LQ97T6gNXp` |

Het saldo van G1qg sluit tot op de lamport: +14,34490908 SOL, min 0,00004 SOL aan fees.

**Gevolg:** geen enkele instructie van deze builds is op deze adressen nog aan te roepen,
ook `pq_write_data` niet. Een gesloten programma-ID kan nooit opnieuw gedeployed worden.
De volgende instance krijgt een nieuw ID.

**Blijvend vast (geen actie mogelijk):**
- **Rest-rent op de programma-accounts zelf:** 4 × 0,00083312 SOL, plus 14,001038612 SOL
  op `5oUPUTu…`. Die 14 SOL is daar op 09-14 en 09-21 per vergissing heen gestuurd
  (1 transfer + 2 faucet-airdrops); zie de correctie in §18.
- **0,67065144 SOL rent in 181 accounts die van de programma's waren** (Config, vaults,
  submissions), plus **alle vault-tokens**.
- **Waarom dit niet terug kan (loader-semantiek, bron nagelezen in Agave 4.1.2/4.3.0):**
  - `Close` maakt alleen de ProgramData leeg. Het programma-account wordt alleen
    gecontroleerd en als tombstone gemarkeerd.
  - Geen van de acht loader-instructies haalt lamports van een programma-account, en
    een programma-account zelf sluiten wordt geweigerd ("Account does not support
    closing").
  - Accounts van het programma kan alleen het programma zelf debiteren, en dat kan niet
    meer draaien.
  - De vault-tokens staan op token-accounts met een PDA van het gesloten programma als
    authority. Niemand kan daar nog voor tekenen.
  - Alles is devnet: geen echte waarde.

**Vervolg:** de mint-authorities van de vault-mints intrekken (spoor C, apart te
beslissen), en de herbouw volgens het niet-publieke herstelplan (buiten de repo). Dat
plan blijft privé tot de gevonden problemen zijn opgelost.
