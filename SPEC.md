# OBP Core Protocol — SPEC v0.1 (draft, ter review)

**Status:** draft — afwacht review door Michel (zie STATUS.md sectie 7, openstaande
vragen Q1–Q5). Geen enkele regel in deze spec is "gewoon zo"; elke regel is of een
beslissing (verwijst naar STATUS.md sectie 2) of een technische noodzaak.

**Herkomst:** deze spec is de vertaling naar een bouwbaar protocol van
`docs/obp-analysis.md` (analyse van de Grok-chat over het OfflineBearer Protocol),
met daarin de zes correcties op het Grok-ontwerp:
- (C1) verplichte bonds = muntwaarde, escrow bij check-in;
- (C2) head-commitment + "langste keten wint" als dispute-game per serial;
- (C3) trust-model expliciet (fase 1: programma + Solana consensus; L2-rolout = fase 5);
- (C4) privacy als optionele laag (fase 6), basissysteem draait zonder ZK;
- (C5) pluggable signaalschema, PQ (FIPS 204/205) verplicht voor mainnet (fase 2/7);
- (C6) begrenste offline-toelating (allowance) per wallet.

---

## 1. Doelen en niet-doelen

### Doelen (fase 1)
1. **Bearer coins**: waarde als bestand (op stick/device) dat volledig offline kan
   meegereisd en offline overgedragen worden, zonder netwerk.
2. **Veilige check-in**: terugzetten op de keten zonder double-spend; elke
   double-spend is of onmogelijk (nullifier) of economisch begrensd en
   gecompenseerd (bond).
3. **Auditbaarheid**: volledige munt-geschiedenis verifieerbaar tot de mint
   (fase 1: publiek; fase 6: ZK-laag voor privacy).
4. **Beperkt risico**: offline-toelating per wallet begrenst de schade per device.
5. **PQ-klaar**: signaalschema pluggable; mainnet vereist post-kwantum.

### Niet-doelen (fase 1)
- Geen aparte L2 / rollup (fase 5). Fase 1 draait de hele coin-protocol direct op
  Solana (devnet). Reden: het nieuwe risico zit in de coin-economie (dispute, bonds,
  toelating), niet in keten-plumbing; die eerst op de bestaande finaliteit van Solana
  meten.
- Geen twee-partij state channels (fase 3). Fase 1: coins worden gemint tegen een
  program-vault (zie §2, A3).
- Geen ZK-privacy (fase 6).
- Geen echte waarden: devnet, test-mint.
- Geen peg naar een andere L1.

## 2. Trust-model (expliciet, geen verborgen aannames)

| # | Aanname | Reikwijdte | Mitigatie / opvolging |
|---|---|---|---|
| A1 | Solana consensus: een finalized transactie is definitief | hele systeem | — (basis van alles) |
| A2 | Het OBP-programma werkt correct én de **upgrade authority** (fase 1: één keypair) handhaaft de regels | hele systeem | fase 7: upgrade authority → multisig; bug bounty vóór mainnet |
| A3 | De **mint authority** (separaat van de upgrade authority) munt coins; bounded door het vault-balance | supply | vault is 1:1 backende (I2); mint authority kan niet meer munten dan er in de vault zit |
| A4 | De vault (token-2022 account, program-PDA-owned) is de backende van alle coins | supply | `Config.total_unspent_supply` wordt on-chain bijgehouden; `withdraw_vault` faalt als `vault_balance − amount < total_unspent_supply` (I2, machine-checkbaar) |

**Niet vertrouwd:** de houder van een coin-bestand (bearer), de checker-in (mag een
stale copy indienen), de offline tegenpartij, en (fase 1) de mint authority voor alles
anders dan minten/withdrawn binnen I2.

**Scheiding van bevoegdheden (bewust):** upgrade authority (kan de code veranderen) ≠
mint authority (kan coins munten/terughalen binnen I2) ≠ holder keys (kunnen alleen
off-chain linken tekenen). Eén compromis van een holder-key verliest alleen die coins.

## 3. Kernconcepten

### 3.1 Munt (coin)

```
coin = (serial: 32 bytes, value: u64)
```
- `serial` wordt door de client gegenereerd (CSPRNG, `crypto.getRandomValues`);
  uniciteit wordt on-chain afgedwongen bij `mint_coin` (registry is per-serial
  geklemd; duplicaat = reject). Geboorte-jaarrisico op 32 bytes: verwaarloosbaar.
- `value` is in de minimaal-eenheden van de vault-mint (devnet: test-mint).

### 3.2 Lokale chain (het hart van OBP)

Byte-exacte layout (binair, geen JSON in de payload):

```
State  = serial(32) ‖ value(8, u64 LE) ‖ owner(32) ‖ prev_state_hash(32)   = 104 bytes
H(s)   = sha256(State)

state_0 (genesis):  prev_state_hash = 32 × 0x00, owner = O_0 (eerste houder)
                    genesis is GEEN handtekening maar een on-chain registry-entry:
                    MintRegistry[serial].genesis_state_hash = H(state_0)
link_k (k ≥ 1):     next_state = state_k met
                          state_k.prev_state_hash = H(state_{k-1})
                          state_k.owner          = O_k  (nieuwe houder)
                    sig_{k-1} = Sign(privkey(O_{k-1}), H(state_k))        = 64 bytes (Ed25519, v1)
                    link_k = state_k(104) ‖ sig_{k-1}(64)                 = 168 bytes (v1)

chain(n) = state_0, link_1, …, link_n        → huidige houder = O_n
```

Eigenschappen:
- **Appends-only, hash-gebonden**: elke link bewijst continuïteit (`prev_state_hash`)
  en autorisatie (`sig_{k-1}` door de vorige houder).
- **Stale copy**: een kopie van het bestand vóór transfer `k` bevat `chain(k−1)`;
  die is nog een *geldige* chain tot een langere chain geaccepteerd is. Wie verliest
  bij twee geldige chains, staat in §6/§7 (langste wint; gelijke lengte = first-come;
  bond compenseert).
- **Malleability** (T5, §9): Ed25519-signatures zijn malleabel (S mod L). Twee
  verschillende geldige signatures op dezelfde `state_k` geven twee even-lange
  geldige chains → tie → first-come-first-served. Geen extra economisch effect;
  on-chain wordt de signature byte-voor-byte geaccepteerd zoals aangeboden (geen
  canonical-form-forseer op fase-1-niveau, wél gedocumenteerd).

### 3.3 Coin-bestand (off-chain, op de stick)

```jsonc
// CoinFile v1 — JSON wrapper, hex-encoding van de binaire payload
{
  "version": 1,
  "serial": "…hex32…",
  "value": 123456,
  "genesis": {
    "state_hash": "…hex32…",
    "mint_tx":    "…hex64…",   // signature van de mint_coin-transactie
    "mint_slot":  488530503,
    "program":    "5oUPUTuS…",
    "vault_mint": "…hex32…"
  },
  "links": [
    { "state": "…hex104…", "sig": "…hex64…" }
  ],
  "file_hash": "…hex32…"       // sha256 over het hele bestand excl. dit veld
}
```
- De ontvanger van een offline transfer verifieert **vóórdat hij accepteert**:
  (a) `file_hash` klopt, (b) de chain is geldig tot in het genesis-hash,
  (c) `H(state_0)` = het aangeleverde `genesis.state_hash` (dat hij bij check-in
  on-chain tegen de registry kan controleren).
- Versleuteling van het bestand (AES-256-GCM met key afgeleid van de user-passphrase,
  argon2id) is een **wallet-zorg**, geen protocol-eis — het protocol eist alleen
  integriteit. (Documentatie: een passphrase is een key-management-laag eromheen;
  verlies = coins verloren, bearer-semantiek.)

### 3.4 Offline transfer (protocol)

1. Afzender (O_{k−1}) tekent `state_k` met ontvanger O_k en levert het geüpdateerde
   CoinFile (of alleen de nieuwe link; de ontvanger merge) over (QR, USB, file).
2. Ontvanger verifieert (§3.3) en slaat op; zijn bestand bevat `chain(k)`.
3. Het bestand van de afzender bevat nu `chain(k−1)` → **stale**, nog geldig tot
   `chain(k)` (of langer) on-chain geaccepteerd is.
4. Geen netwerk nodig in 1–3. Geen counterparty-trust: de ontvanger kan alles
   lokaal verifiëren.

## 4. Rollen en on-chain accounts (Solana/Anchor)

Programma-ID (fase 1, devnet): `5oUPUTuSdU3bWLtVTdcisu1BtgwNt29jH4fVTnfH2XiM`
(zie STATUS.md sectie 4).

| Account | Seeds | Eigenaar | Inhoud | LEN |
|---|---|---|---|---|
| `Config` | `["config"]` | program | zie onder | 103 |
| `Vault` | — (token-2022 account) | `vault_pda` | test-mint balance | 165 (token acct) |
| `VaultPda` | `["vault"]` | program | marker (beheert Vault) | 8 |
| `FeePda` | `["fee"]` | program | DoS-fee's (§6) | 8 |
| `MintRegistry` | `["mint", serial]` | program | per coin | 186 |
| `HeadRegistry` | `["head", serial]` | program | laatste geaccepteerde state | 114 |
| `Submission` | `["submission", serial, attempt]` (attempt: 0\|1) | program | per check-in poging | 229 |
| `Escrow` | `["escrow", serial, attempt]` (token-2022) | `submission_pda` | bond (test-mint) | 165 |
| `Allowance` | `["allowance", wallet]` | program | toelating per wallet | 27 |

Velden (byte-exact, inclusief Anchor-discriminator van 8 bytes voor program-accounts):

```
Config:
  mint_authority        Pubkey   (32)
  vault_mint            Pubkey   (32)
  bond_multiplier_bps   u32      (4)    // ≥ 10000 (100%)
  challenge_window_slots u64     (8)    // dispute/challenge window, in SLOTS
  max_links_per_tx      u16      (2)
  default_allowance     u64      (8)
  total_unspent_supply  u64      (8)    // I2, machine-checkbaar
  bump                  u8       (1)

MintRegistry:
  serial                [u8;32]  (32)
  value                 u64      (8)
  genesis_state_hash    [u8;32]  (32)
  mint_slot             u64      (8)
  mint_tx               [u8;64]  (64)
  recipient             Pubkey   (32)   // allowance-attributie (§8, I5)
  status                u8       (1)    // 0=active 1=pending 2=disputed 3=spent 4=rejected
  bump                  u8       (1)

HeadRegistry:
  set                   bool     (1)    // false = nog nooit geaccepteerd
  head_state            [u8;104] (104)  // laatste geaccepteerde state
  bump                  u8       (1)

Submission:
  serial                [u8;32]  (32)
  attempt               u8       (1)    // 0 = eerste, 1 = contender
  checker               Pubkey   (32)   // bearer die indient (betaalt de bond)
  final_owner           Pubkey   (32)   // O_n van de laatst toegevoegde state (fill bij finalize)
  links_count           u16      (2)
  head_state            [u8;104] (104)  // laast toegevoegde state (init: state_0)
  started_slot          u64      (8)
  finalized_slot        u64      (8)    // 0 = nog niet
  status                u8       (1)    // 0=receiving 1=submitted 2=pending 3=disputed 4=rejected 5=won 6=lost
  bump                  u8       (1)

Allowance:
  cap                   u64      (8)    // default: Config.default_allowance
  committed             u64      (8)    // Σ value van openstaande coins gemint naar deze wallet
  initialized           bool     (1)
  bump                  u8       (1)
```

## 5. Instructies (fase 1)

> Alle tijden zijn **slots** (niet wall-clock): `slot` is consensus-geordend,
> `unix_timestamp` kan skew hebben (T7, §9).

### 5.1 `init`
- Accounts: `config` (init, payer), `mint_authority` (signer), `payer` (signer), system.
- Args: `vault_mint, bond_multiplier_bps, challenge_window_slots, max_links_per_tx, default_allowance`.
- Checks: `bond_multiplier_bps ≥ 10000` (BondBelowParity), `challenge_window_slots ≥ 1`,
  `max_links_per_tx ≥ 1`.
- Maakt ook `VaultPda` aan; de daadwerkelijke token-2022 vault-account wordt in een
  aparte client-stap aangemaakt met `owner = VaultPda.key()` (CPI `InitializeAccount`)
  zodat `Config` niet van de token-programma-init afhangt (zelfde reden als
  active-defense STATUS.md §7: volgorde en account-eigenschappen uit elkaar houden).

### 5.2 `fund_vault` / `withdraw_vault` (mint authority)
- `fund_vault(amount)`: token-2022 transfer mint-authority → vault.
- `withdraw_vault(amount)`: alleen als `vault_balance − amount ≥ total_unspent_supply`
  (I2, on-chain), anders VaultUnderflow.

### 5.3 `mint_coin` (mint authority)
- Args: `serial (32), value (u64), recipient (Pubkey)`.
- Accounts: `config` (mut), `vault` (mut, token-2022), `allowance_recipient` (init-if-needed, mut), mint-authority (signer).
- Checks: `MintRegistry[serial]` bestaat nog niet; `value > 0`;
  `allowance.committed + value ≤ allowance.cap` (AllowanceExceeded) —
  **de toelating is een mint-gate** (honeste beperking, I5, §9).
- Effect: `value` uit vault debiteren; `MintRegistry` schrijven
  (`status=active`, `genesis_state_hash = H(state_0)`, `recipient`);
  `config.total_unspent_supply += value`.
- `state_0` (en dus `genesis_state_hash`) is afgeleid van
  `(serial, value, recipient, 0^32)` — de client bouwt `state_0` zelf en de
  on-chain hash moet kloppen met wat de client in het CoinFile zet
  (StateMismatch bij check-in als ze uit elkaar lopen).

### 5.4 `start_check_in`
- Args: `attempt (u8)`.
- Accounts: `submission` (init, seeds `["submission", serial, attempt]`, payer=checker),
  `mint_registry` (mut, moet `status ∈ {active}`), `escrow` (token-2022, init, owner=submission-pda),
  `checker_token` (mut), `config`, `payer`.
- Effect: bond = `value × bond_multiplier_bps / 10000` overzetten van `checker_token`
  → `escrow`; `submission.status = receiving`, `head_state = state_0` (de client
  levert `state_0` mee; het hash moet `genesis_state_hash` zijn — StateMismatch).
- Max 2 submissions per serial (attempt 0 en 1); meer = DuplicateSubmission.

### 5.5 `append_links`
- Args: `links: Vec<(state: [u8;104], sig: [u8;64])>`, lengte ≤ `max_links_per_tx`.
- Accounts: `submission` (mut, `status = receiving`), `mint_registry` (lezen).
- Per link, in volgorde:
  1. `state.serial == registry.serial` én `state.value == registry.value` (SerialMismatch/ValueMismatch);
  2. `state.prev_state_hash == H(submission.head_state)` (ChainBroken);
  3. `ed25519_verify(pk = submission.head_state.owner, msg = H(state), sig)` (BadSignature)
     — via de Solana `ed25519_verify`-syscall (CU-kosten: **meten** bij M1, niet aannemen);
  4. `submission.head_state = state`; `links_count += 1`.

### 5.6 `finalize_check_in`
- Voorwaarde: `submission.status = receiving` (na minstens de genesis) én
  `mint_registry.status = active`.
- Bepaal `head` = `HeadRegistry[serial]`:
  - **Head leeg (`set=false`)**: `HeadRegistry.head_state = submission.head_state`, `set=true`;
    `submission.status = submitted → pending` (window loopt: `finalized_slot` = slot +
    `challenge_window_slots`); `mint_registry.status = pending`.
    **Waarde wordt nog NIET vrijgegeven** — pas na de window (zie 5.8).
  - **Head is een prefix van de ingediende chain** (d.w.z. `submission` begon bij
    genesis en de eerste `head.links…` — operationeel: de client die "extensie"
    claimt, dient de volledige chain aan; de program checkt dat de ingediende chain
    de opgeslagen head-state bevat als prefix; dan: `mint_registry.status = spent`
    direct, `submission.status = won`, bond terug naar checker,
    vault → `final_owner` (de waarde van de munt),
    `total_unspent_supply −= value`, allowance van `recipient` `committed −= value`
    (I5-afboeking).
  - **Fork** (ingediende chain en opgeslagen head divergeren na een gemeenschappelijke
    prefix): `mint_registry.status = disputed`, `submission.status = disputed`;
    de tegenpartij mag `contend` (5.7) binnen de window.
- `final_owner` = `submission.head_state.owner` (O_n).

### 5.7 `contend` (de dispute-game, C2)
- Voorwaarde: `mint_registry.status = pending` of `disputed`; binnen de window van de
  eerste submission (`slot < started_slot + challenge_window_slots`).
- De contender start zijn eigen submission (attempt 1, eigen bond, eigen chain via
  `start_check_in`/`append_links`/`finalize_check_in`).
- Bij `finalize` van de contender met `status = disputed`:
  - **Langste geldige chain wint**: `links_count` vergelijken van de twee
    submissions (beide volledig on-chain opgeslagen).
  - **Tie** (zelfde lengte, beide geldig = het échte dubbelsignatueergeval):
    **first-come** — wie het eerst `finalize`-de wint (`finalized_slot` vergelijken;
    zelfde slot = laagste attempt-index).
  - Verliezer: `submission.status = lost`, bond → winnaar; winnaar: `status = won`.
  - `mint_registry.status = spent` (via 5.8).
- Na de window zonder contender: de eerste submission wint (5.8).

### 5.8 `settle` (na de window)
- Voorwaarde: `mint_registry.status ∈ {pending, disputed}` én window verlopen
  (`slot ≥ started_slot + challenge_window_slots`), óf al opgelost via 5.6/5.7
  met beide bonds geklaard.
- Effect: waarde uit vault → winnaars `final_owner`; winnaars bond terug (of bij
  5.6-fast-path al direct); `mint_registry.status = spent`;
  `total_unspent_supply −= value`; allowance-afboeking bij `recipient` (I5).
- Iedereen kan `settle` aanroepen (permissionless sweep; de uitbetaling gaat naar de
  on-chain vastgelegde winnaar).

### 5.9 `set_allowance` (wallet zelf)
- Wallet (signer) zet `Allowance[wallet].cap` (alleen omhoog in fase 1; omlaag =
  fase 2 beslissing, zodat er geen coins "buiten" de cap blijven hangen).

### 5.10 Afval van ongeldige chains (DoS, T3)
- `append_links`/`finalize` met een **ongeldige** link (ChainBroken/BadSignature/
  SerialMismatch/ValueMismatch): de submission gaat naar `rejected`, de bond gaat
  naar `FeePda` (niet terug naar de checker — anders is een ongeldige check-in
  gratis te spammen).
- `start_check_in` kost de bond direct (escrow) — een starter die nooit finalize,
  laat die bond liggen (sweep via 5.8-naamgenoot `abandon`: na window, bond → FeePda).
  (Impliciet in 5.8: ongefinalized submissions na window → bond → FeePda.)

## 6. Double-spend-resolutietabel (de economische kern)

| # | Scenario | Resultaat | Bond-flow |
|---|---|---|---|
| R1 | Enkele check-in, head leeg, geen contender in window | Waarde → O_n; munt spent | bond → checker terug |
| R2 | Twee **identieke** copies (zelfde state) checken in, eerste wint de race | Eerste: waarde; tweede: `rejected` bij finalize (head is prefix… nee: tweede's chain == eerste's chain → tie/first-come) | Tweede's bond → eerste (winnaar) |
| R3 | Fork: afzender (stale `chain(k−1)`) vs. ontvanger's chain (`chain(k)`) | **Langste wint** → ontvanger | Stale-houder's bond → winnaar |
| R4 | Fork, twee even-lange geldige chains (dubbelsignatuur) | **First-come** | Verliezers bond → winnaar |
| R5 | Check-in ná finaliteit (`spent`) | `rejected` (StatusInvalid) | Bond → `FeePda` (de checker wist/begreep; geen compensatie nodig) — **beslissing B7, ter review** |
| R6 | Ongeldige chain (verkeerde sig / hash / serial) | `rejected` | Bond → `FeePda` (DoS-prijs) |
| R7 | Starter die nooit finalize | Na window: `abandon` | Bond → `FeePda` |

**Belangrijk (C1):** in geen enkele rij is de kosten voor een double-spend nul. Het
slachtoffer wordt gecompenseerd uit de bond; de bond is ≥ 100% van de muntwaarde.
De challenge-window bepaalt niet wie het geld krijgt — de bonds doen dat. De window
bepaalt alleen hoe lang de tegenpartij de tijd heeft om te **contenderen**.

## 7. Check-in state machine (formeel)

```
MintRegistry.status:  active ──finalize(head leeg)──► pending ──settle──► spent
                          │                              ▲
                          │─────────fork────────────────┘  (disputed: pending↔disputed)
                          └──ongeldig──► rejected (uniek eindpunt; bond → FeePda)

Submission.status:    receiving ──finalize──► submitted ──window──► pending*
                          │                    (of direct won: fast path)
                          ├──ongeldig──► rejected
                          └──contend──► disputed ──resolutie──► won | lost
   * pending = mint_registry-pending; de submission zelf eindigt via settle.

Regels:
  R-A: een submission kan exact één keer finalizen (status-gated).
  R-B: `spent`/`rejected` zijn eindpunten (geen transities meer).
  R-C: de window loopt op SLOTS vanaf de eerste submission's `started_slot`.
  R-D: een contender moet de volledige window missen → de eerste wint (5.8).
  R-E: twee submissions bestaan maximaal (attempt 0/1).
  R-F: `total_unspent_supply` verandert alleen bij `mint_coin` (+) en
       `settle`/fast-path (−) — nooit bij start/append/dispute.
  R-G: de bond van een winnaar wordt terugbetaald aan `checker` (niet aan
       `final_owner`) — de bond is een inlevering van de indiener, niet van de munt.
```

## 8. Invariants (auditeerbaar)

| # | Invariant | Afgedwongen door |
|---|---|---|
| I1 | Een serial wordt maximaal één keer `spent`/`rejected` (status eindpunt) | status-gates (R-B) |
| I2 | `vault_balance ≥ total_unspent_supply` always | `mint_coin` debiteert eerst; `withdraw_vault` checkt; `settle` crediteert alleen wat bij `mint_coin` uit de vault kwam |
| I3 | Bond ≥ muntwaarde op het moment van `start_check_in` | `bond_multiplier_bps ≥ 10000` (B3) |
| I4 | Elke geaccepteerde chain is hash-consistent tot `genesis_state_hash` | `append_links`-checks 1–3 + `start_check_in` genesis-check |
| I5 | `Allowance[wallet].committed = Σ value` van `active`/`pending`/`disputed` coins met `recipient = wallet` | `mint_coin` (+), `settle`/fast-path (−); transfers verplaatsen de attributie NIET (gedocumenteerde beperking, T11) |
| I6 | Escrow-sommen zijn exact de bonds; geen escrow na `spent`/`rejected` | `settle`/`abandon` klaren alle escrows; auditorscript (M3) |

## 9. Threat model (fase 1)

| # | Aanval | Mechanisme | Mitigatie | Residueel risico |
|---|---|---|---|---|
| T1 | Stale copy (classiek offline double-spend) | Oude holder checkt in met `chain(k−1)` | Langste-keten-regel (R3); bond compenseert | De *nieuwe* holder had de munt al doorgegeven of uitgegeven → het verlies loopt de transfer-keten af; begrensd door bonds + toelating |
| T2 | Dubbelsignatuur (zelfde owner tekent twee next-states) | Twee even-lange geldige chains | First-come + bond (R4) | Wie het eerst op de keten is, wint — offline is dat een race naar de volgende online-moment |
| T3 | DoS: ongeldige chains / oude finalizes / flood | Check-in kosten | Bond → FeePda bij afval (§5.10); max 2 submissions/serial; rate-limit = bond-kosten zelf | FeePda groeit (opzichten: mint authority mag FeePda niet leegmaken — fase 7 governance) |
| T4 | Sleutelverlies (off-chain) | Bearer: bestand weg = munt weg | Backup = exacte kopie (zelfde stale-copy eigenschap); Shamir-split = fase 2+ UX | Bearer-semantiek: kwijt is kwijt (honest, als cash) |
| T5 | Ed25519-malleability | Twee signatures, zelfde state | Tie → first-come; geen extra schade | Gedocumenteerd (3.2) |
| T6 | Replay (zelfde tx opnieuw) | Idempotentie | Status-gates (R-A); `append_links` is append-only (zelfde link 2× = ChainBroken) | — |
| T7 | Clock-skew bij de window | Wall-clock is niet consensus-geordend | Alleen SLOTS (5.x) | — |
| T8 | Vault-overflow/underflow | Supply vs. backing | I2 on-chain (A4) | — |
| T9 | Upgrade-authority-compromis | Code verandert | Fase 1: één keypair (A2, bewust, documentatie: dit is de trust-basis van fase 1); fase 7: multisig | Fase 1: volledig — de fase-1-trust is expliciet A2 |
| T10 | **Harvest now, break later** (PQ) | Publieke handtekeningen op lang-levende credentials; een QC forgeren later een check-in | Fase 2: PQ-scheme (FIPS 204/205) als reference, meten; mainnet-rule: PQ verplicht (C5) | Fase 1 (Ed25519): volledig — bewust, prototype; mainnet zonder PQ is niet toegestaan |
| T11 | Allowance is een mint-gate, geen holdings-cap | Iemand kan offline coins *ontvangen* tot een onbegrensd bedrag | I5-afboeking bij spend; refresh-flow (check-in + her-minten) = fase 2 UX | Gedocumenteerde beperking; de digitale-euro-equivalent (device-cap) is pas compleet in fase 3+ |

## 10. Signaalschema (pluggable, C5)

- **v1 (fase 1): Ed25519.** Verificatie via de Solana `ed25519_verify`-syscall
  (CU-kosten: meten bij M1 — niet aannemen; verwachting: enkele duizenden CU,
  te verifiëren in de devnet-transactielogs).
- **Fase 2: post-kwantum, gemeten.** Kandidaten: **ML-DSA-44** (FIPS 204; pubkey
  1152 B, sig 2420 B) en **SLH-DSA-SHA2-128f** (FIPS 205; pubkey 32 B, sig 1697 B).
  Benchmark op devnet: (a) CU per verificatie (pure Rust, geen syscall → verwachting
  veel hogere CU per link → `max_links_per_tx` daalt, meer tx's per check-in),
  (b) bytes per link (tx-size 1232 B), (c) client-side teken-snelheid.
  Beslissing op basis van de metingen (STATUS.md sectie 5-stijl: bewijs, geen aannames).
- **Mainnet-rule:** alleen PQ (of hybride Ed25519+PQ) toegestaan (T10).
- **Ontwerp:** in `state_0`/Config zit géén scheme-veld per munt; het scheme wordt
  door `Config.sig_scheme: u8` bepaald (0=Ed25519, 1=MLDSA44, 2=SLHDSA128f) —
  **beslissing B8, ter review** (alternatief: per-munt scheme-veld; per-Config
  is eenvoudiger maar dwingt een migratie van alle open munten bij een scheme-wissel —
  voor fase 1 acceptabel: prototype, korte levenscyclus).
- Off-chain: de TS-client heeft een `CoinSigner`-interface (Ed25519 via
  `@noble/curves`; PQ via `noble`-PQ of `webcrypto`-achtige binding — kiezen bij fase 2).

## 11. Compute- en size-budget

- Solana-tx-limit: **1232 bytes** → gestageerde check-in (`start` / `append×k` /
  `finalize`).
- Link-grootte v1: 168 bytes + account overhead per tx (Anchor: discriminator +
  accounts ~100–200 B) → verwachting `max_links_per_tx ≈ 5–6` (default 6; **meten**
  bij M1, niet aannemen).
- Coin-bestand: onbegrensd (stick); een munt met 1000 transfers ≈ 170 KB (v1) —
  triviaal.
- CU per check-in-tx: meten bij M1 (ed25519-verify CU, compute budget log).

## 12. Roadmap (meestappen)

| M | Scope | Afsluitkriterium (bewijs) |
|---|---|---|
| M0 | Voorbereiding: repo, skeleton, tooling-inventarisatie, keypairs, spec v0.1, STATUS | Skeleton compileert → SBF `.so` met program-ID byte-geverifieerd (deze sessie) |
| M1 | `obp-core` programma compleet (alle instructies §5) | `cargo build` groen; unit-tests (no-entrypoint) groen |
| M2 | TS-clientlibrary: CoinFile model, mint, transfer, gestageerde check-in, contend | Client-tests tegen lokaal cluster groen |
| M3 | E2E-bewijsmatrix op devnet (E1–E10, §13) | Alle E's groen, slots/signatures in STATUS.md vastgelegd |
| M4 | PQ-fase: ML-DSA-44 + SLH-DSA-128f implementatie + benchmark + volledige test-matrix herhalen | Benchmark-rapport (CU/bytes/snelheid) in STATUS.md; scheme-kiezen |
| M5 | Channels (twee-partij mint-consent) | E-matrix extensie (E11–E13: channel-mint, gesloten channel, channel-dispute) |
| M6 | ZK/blind-laag (optioneel) | Privacy-test: lineage niet herleidbaar uit on-chain data |
| M7 | L2-scheiding: optimistic rollup boven/naast Solana + state-root commitments | Twee-staps finaliteit (pending→final) bewezen op L1-reorg-simulatie |
| M8 | Mainnet-prep: multisig upgrade authority, audits, bug bounty, fee-governance | Audit-rapporten; multisig-demo |

## 13. E2E-bewijsmatrix (M3, op devnet)

| E | Test | Verwacht resultaat |
|---|---|---|
| E1 | `init` + `fund_vault` + `mint_coin` → CoinFile geldig (client verifieert) | Registry `active`; `H(state_0)` = `genesis_state_hash`; vault gedebiteerd; allowance +value |
| E2 | Offline transfer: file A → (simulatie: geen netwerk, aparte key) → B; B verifieert | B's chain geldig; A's file stale maar nog geldig |
| E3 | Enkele check-in (R1): `start`/`append`/`finalize`/`settle` | Waarde → O_n; bond terug; `spent`; I2/I5 kloppen |
| E4 | Double-spend identieke copy (R2): A en B hebben zelfde state; A checkt in, B probeert | A: `won`; B: `rejected` (tie/first-come), B's bond → A |
| E5 | Fork (R3): A (stale) checkt in, B (langere chain) contended binnen window | B: `won` (langste); A's bond → B |
| E6 | Stale check-in ná finaliteit (R5) | `rejected` (StatusInvalid); bond → FeePda |
| E7 | Allowance-cap: mint boven cap | AllowanceExceeded; vault niet gedebiteerd |
| E8 | Replay: dezelfde `finalize`-tx tweemaal | Tweede faalt (status-gate); geen dubbele escrow/uitbetaling |
| E9 | Bond < waarde (bps afdingen via `init` op throwaway-programma) | BondBelowParity bij init |
| E10 | Ongeldige chain (verkeerde sig) | `rejected`; bond → FeePda |
| E11–E13 | (M5) channel-scenario's | — |

## 14. Openstaande designvragen (voor Michel — Q1–Q5)

- **Q1 (scope):** fase 1 = OBP-core direct op Solana (devnet), geen aparte L2
  (die = M7). Akkoord? (aanbeveling: ja — de dispute-economie eerst meten op
  bestaande finaliteit).
- **Q2 (signaalschema fase 1):** Ed25519 als reference (syscall, klein), PQ (ML-DSA-44
  óf SLH-DSA-128f) gemeten in M4, PQ-verplicht voor mainnet. Akkoord? (alternatief:
  SLH-DSA al in fase 1 — grotere tx's, hogere CU, maar dan is het scheme "echt"
  vanaf dag één.)
- **Q3 (funding fase 1):** vault + mint authority (één sleutel), I2 begrenst supply.
  Akkoord? (alternatief: twee-partij channel al in fase 1 — zwaarder, verschuift M5.)
- **Q4 (R5):** check-in ná finaliteit: bond → FeePda (huidige spec) of → final owner?
  (huidige keuze: FeePda; de final owner is het slachtoffer van een stale-check maar
  had zelf niets gedaan — argumenten beide kanten; bespreken.)
- **Q5 (repo):** naam `offline-bearer-protocol`, privé, branch `main`. Akkoord?
  (repo is aangemaakt; hernoemen kan kosteloos zolang er niets in zit.)
