# CoinFile Spec v1 — OBP offline bearer instrument

Status: **v1 (M2, 2026-09-17)**. Normatief voor alle wallets/clients die OBP-munten
aan- of afnemen. Implementatie: `sdk/src/coinfile.ts`, `wrapper.ts`, `chain.ts`
(reference-implementation, unit-getest incl. on-chain vectors — `sdk/test/vectors.test.ts`).

## 1. Doel en positie in het protocol

Een OBP-munt bestaat uit een **lokale chain van states** (de "Local Coin-Chain"
uit SPEC v0.1, Optie B). De CoinFile is het **seriale dragervormaat** van die
chain: het bestand dat je offline bewaart, offline doorgeeft (QR/USB/AirDrop),
en later weer in kunt checken op L1.

De on-chain wereld kent van de munt alleen:
- `MintRegistry[serial]` — serial, value, `genesis_state_hash` = H(state_0), recipient, status.
- `Submission[serial, attempt]` — de ingediende chain (states), status, window.
- `HeadRegistry[serial]` — de geaccepteerde head (finaliteit per serial).

De CoinFile is de **bron** van wat bij check-in wordt ingediend; het programma
verifieert alles opnieuw on-chain (client-verificatie is conveniënt, niet autoritair).

## 2. CoinCore (onversleutelde munt)

### 2.1 Binary layout (alle fields little-endian)

| offset | veld | grootte | opmerking |
|---|---|---|---|
| 0   | magic | 4 | `"OBC1"` |
| 4   | version | 2 | `1` |
| 6   | sigScheme | 1 | `0`=Ed25519 (v1); `1`=ML-DSA-44, `2`=SLH-DSA-128f (M4, reservatie) |
| 7   | statesLen | 2 | `n`, 1 ≤ n ≤ 255 |
| 9   | serial | 32 | uniek munt-id (globaal, sha256-afgeleid of mint-gedefinieerd) |
| 41  | value | 8 | muntwaarde in vault-mint-eenheden (0 decimalen in M1) |
| 49  | states | n × 104 | §2.2 |
| 49+104n | sigs | (n−1) × 64 | §2.3 |
| 49+104n+64(n−1) | checksum | 32 | sha256 over alles daarvoor |

Totaal: `49 + 104n + 64(n−1) + 32` bytes. Voor n=1: 183 B; n=3: 521 B.

### 2.2 State (104 B) — byte-exact met het programma (`state.rs`, `STATE_SIZE`)

| offset | veld | grootte |
|---|---|---|
| 0  | serial  | 32 |
| 32 | value   | 8  |
| 40 | owner   | 32 (ed25519-pubkey van de eigenaar van deze state) |
| 72 | prevHash| 32 (H(vorige state); voor state_0: 32 × 0x00) |

`H(x) = sha256(x)`.

### 2.3 Signatures

`states[0]` heeft geen signature (on-chain geankerd door `genesis_state_hash`).
Voor `i ≥ 1`:

```
sigs[i-1] = ed25519_sign(owner(states[i-1]), H(states[i]))
```

De checker (ontvanger van een offline transfer) verifieert:
1. `states[i].serial == serial` en `states[i].value == value` (alle i)
2. `states[0].prevHash == 0^32`
3. `states[i].prevHash == H(states[i-1])` (i ≥ 1)
4. `sigs[i-1]` geldig onder `owner(states[i-1])` over `H(states[i])` (i ≥ 1)
5. (indien bekend) `H(states[0]) == registry.genesis_state_hash`

Regels 1–4 = `verifyCoinChain` in de SDK; regel 5 = on-chain hercontrole bij
check-in (I4).

### 2.4 Checksum

sha256 over de bytes vóór het checksum-veld. **Alleen voor beschadigingsdetectie**
(accidentele corruptie, truncatie), geen security-functie (de content is niet
gehash-met-key; de signatures dekken integriteit).

## 3. Versiebeheer

- `version` is breaking: een decoder weigert onbekende versies (geen silent upgrade).
- Layout van bestaande versies verandert **nooit**; uitbreidingen komen als nieuwe
  versie (v2 = bv. PQ-sigsets, metadata-blob, batch-structure).
- `sigScheme` is per-coin: de decoder kiest de verificatie per value. v1 draait
  alleen scheme 0 (Ed25519); scheme 1/2 zijn gereserveerd voor M4 en moeten bij
  versie-introductie tegelijk een `sigSize`-mechanisme meekrijgen (64 B is
  Ed25519-specifiek).

## 4. Verpakkingsvorm (encryptie)

Het bestand dat op schijf/USB staat, is standaard **geencrypted** (wrapper v1):

| offset | veld | grootte |
|---|---|---|
| 0  | magic | 4 (`"OBE1"`) |
| 4  | version | 2 (`1`) |
| 6  | keyHint | 1 (`0`=passkey-afgeleid, `1`=device-lokaal — zie §5/Q7) |
| 7  | nonce | 12 (AES-256-GCM, vers per bestand) |
| 19 | ctLen | 4 |
| 23 | ciphertext | ctLen (AES-256-GCM over de hele CoinCore) |
| 23+ctLen | tag | 16 |

- Key = 32 bytes, wallet-gedefinieerd (Q7): v1 specificeert de **container**,
  niet de key-uitdrijving. Beide keyHints worden ondersteund door de SDK
  (`wrapper.ts`); de wallet kiest.
- AAD = `"OBP-COINFILE-V1"` (statisch). De GCM-tag bindt de ciphertext al aan
  de key; extra AAD-metadata (bv. serial) is redundant.
- Onversleutelde vorm (magic `OBC1`) is geldig binnen een session (bv. tijdens
  een offline transfer tussen twee devices, of in testvectors).

## 5. Threat model (belangrijk)

**De CoinFile is een bearer-instrument.** Wie het (geopende) bestand heeft, kan
de munt check-in doen — exact zoals cash. Consequenties:

1. **Encryptie is privacy + verliesbescherming**, géén verdediging tegen een
   tegenstander die het bestand én de key heeft (of het bestand ontcijferd
   krijgt via een gebroken key-management).
2. **Verlies van bestand of key = verlies van de munt** — totdat de munt is
   gecheckt-in (dan is hij on-chain). Er is geen on-chain "vind mijn munt";
   recovery is een product-afleiding (Q7: encrypted backup / social recovery /
   custodial optie) en hoort buiten de core-spec.
3. **Double-spend-window**: na een offline transfer bestaan kortstondig twee
   geldige coin-bestanden (oude eigenaar + nieuwe). Wie eerst checkt-in (en
   winst de challenge window), is de eigenaar; de ander verliest de bond
   (SPEC R1–R7; op het programma afgedwongen, niet in de CoinFile).
4. **Hardware-binding** (optioneel, later fase): breekt het bearer-principe —
   een aan device gebonden munt is geen cash meer. Als feature uitdrukkelijk
   apart, niet in de v1-core.

## 6. Relatie tot de on-chain flows

| flow | CoinFile-rol |
|---|---|
| mint | Ontvanger krijgt (na mint_coin) een CoinCore met n=1 (state_0). `genesisHash` = H(state_0) gaat on-chain; `mintTx` (64 B) is een mint-bewijs, opgeslagen in de registry (niet in de CoinFile). |
| offline transfer | `appendLink`: nieuwe state + signature van huidige eigenaar. Het oude bestand blijft geldig tot check-in. |
| check-in (start→append→finalize→settle) | Client dient states+sigs per batch (≤ `max_links_per_tx`) via `append_links` + ed25519-precompile; het programma verifieert hashketen on-chain (signatures via precompile in dezelfde tx). |
| dispute | Twee verschillende chains op één serial → `HeadRegistry` + longest-wins + bond (SPEC R3–R5). |

## 7. Referentie-implementation en bewijs

- Codec + verificatie: `sdk/src/coinfile.ts`, `chain.ts`, `layout.ts`, `wrapper.ts`.
- Tests: `sdk/test/` — round-trips, tamper-cases, en **on-chain vectors**:
  de M1-devnet-coin (`fixtures/m1-coin.json`) wordt deterministisch
  gereconstrueerd en byte-voor-byte vergeleken met de on-chain submission
  (het programma accepteerde precies die bytes).
- M2-acceptatie: de volledige protocol-lus (mint→start→append→finalize→settle)
  aangedreven door de SDK op devnet (nieuwe coin, evidence in STATUS §11).
