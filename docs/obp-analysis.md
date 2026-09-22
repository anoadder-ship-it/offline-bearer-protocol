# OBP (OfflineBearer Protocol) — analyse van de Grok-chat

**Datum:** 2026-09-02
**Scope:** de chat waarin Grok iteratief het "OfflineBearer Protocol" opbouwt (L1 +
sidechain + state channels + Local Coin-Chains), afgesloten met "bestaat er al
zoiets?". Methode: volledige chat gelezen, externe claims geverifieerd tegen
bronnen, en het check-in / double-spend-mechanisme als attacker gemodelleerd.

## 1. Algemeen oordeel

De lijn van het gesprek is goed:

- De oorspronkelijke diagnose klopt: "losse munten in blokken" lost het consensusprobleem
  niet op. Account-model vs UTXO-model is orthogonaal aan het offline-probleem.
- De 4-laags decompositie (L1 / L2 / state channels / Local Coin-Chains) is de
  standaardvorm van zo'n systeem.
- Het eindantwoord op "bestaat er al zoiets?" is grotendeels accuraat.

Maar het eindontwerp heeft zes plekken die technisch onderbesloten zijn of waar het
security-model niet klopt. Geen van de zes brekt het concept; ze zijn er wel voor nodig
vóórdat je bouwt, anders is het geld of niet echt veilig, of niet echt privat, of niet
echt offline-safe.

## 2. Wat fout / onderbesloten is (rangschikking: eerst het hardste)

### 2.1 "Optionele bonds" — de kern van de double-spend-economie ontbreekt

Een challenge-periode **compenseert** het slachtoffer niet. Een challenge-periode
beslist alleen wie betaald wordt; de compensatie komt uit een bond (escrow). Dus:

- de bond moet **verplicht** zijn, niet optioneel;
- bond = de waarde V van de munt (volledige collateral), gestort bij check-in,
  vrijgegeven na de challenge-window tenzij er gegesteerd wordt, dan naar de
  tegenpartij;
- regel: **eerste geldige check-in wint** (bij zelfde state); de tweede betaalt de bond.

Zonder deze regel is de kosten voor een double-spend nul en is de challenge-periode
puur een vertraging. De ontbrekende economische regel: *wie verliest bij een
double-spend moet vooraf bepaald zijn, en het maximum verlies moet begrensd zijn.*
Dat is de "bond = V"-regel.

### 2.2 Challenge-periode ≠ security; het "head commitment" + "langste keten"-mechanisme ontbreekt

Grok's check-in: "is het serienummer al gebruikt? klopt de keten? → challenge-periode."
Missend: wat als **twee verschillende ketens** met hetzelfde serienummer worden
voorgelegd (het klassieke geval: Alice kopieert, geeft ook aan Bob; Bob geeft aan
Carol; nu checken Alice én Carol in).

Het model op L2 moet zijn:

- `mint[S] = (V, channel, mint_tx, status)`
- `head[S] = hash van de laatste geaccepteerde state`
- check-in legt de **volledige** lokale keten voor; L2 valideert link-voor-link
  (hash-chain + handtekeningen) tot in `mint[S]` en update `head[S]`;
- voorgelegde keten is **extensie** van `head[S]` → accepteren (fast path);
- voorgelegde keten is een **fork** (afwijkt na een gemeenschappelijke prefix) →
  dispute-game: de houder van de andere keten heeft T (de challenge-periode) om de
  zijne te presenteren; de **langste volledig-geldige** keten wint; bij twee
  even-lange, beide geldige ketens (het échte dubbelsignatueergeval: dezelfde
  eigenaar tekende twee verschillende next-states) → first-come-first-served + bond.

Dit is letterlijk het dispute-game van een optimistic rollup, toegepast per serial.
Grok's "challenge-periode" is dit, maar zonder de state machine eromheen.

### 2.3 L2 als federated sidechain is het verkeerde trust-model

Grok: "federated peg of SPV-achtige... multi-sig federatie + fraud proofs." Dit is de
zwakste laag van het hele systeem: een multi-sig-federatie kan colluderen (een mint
reverteren, een double-spend accepteren) en de "fraud proofs" zijn slechts zo sterk als
de federatie die ze post.

Beter: L2 als **optimistic rollup** (state roots ge-commit op L1, challenge-periode =
finality-window van de L2). Dan:

- munten die in de finality-window worden gecheckt-in zijn "pending" —
  twee-staps release: `pending → final` zodra de state root met de nullifier
  definitief is op L1;
- de challenge-periode van munten = de fraud-proof-window van de L2 (bijv. 7 dagen,
  zoals Optimism/Arbitrum), niet een willekeurige 24–72 uur;
- trust-model: "consensus van L1 + de aanname dat in de window minstens één eerlijke
  verifier een fraud proof post."

Wil je alsnog een federatie (snelheid), dan expliciet: "N-of-M federatie; X colluderende
nodes kunnen Y% van de munten stelen" — en dat is het trust-assumptie van het product,
geen voetnoot.

### 2.4 Privacy-lek: check-in publiceert de volledige munt-geschiedenis

Het eigen plan van Grok zegt: "eigenaar publiceert de lokale chain op L2." Gevolg:
**de volledige lineage van de munt (alle eerdere eigenaars, alle tijdstippen) is open
leesbaar** op de L2. De "private" munt is publiek op het moment van check-in. Privacy
is net zo goed als de langste offline-periode.

Fix (en hier past het Zcash-model):

- **Blind minten**: het kanaal munt de munt onder een commitment op een blinding
  factor (Chaum/Cashu-stijl: de uitgever tekent het geblinde note, ziet het serial
  niet);
- **ZK check-in**: de eigenaar bewijst dat de keten geldig is vanaf een geminte
  (S, V) zonder de tussentijden onthullen; de nullifier onthult alleen dat
  "een munt met serial S is besteed";
- wat wél publiek blijft: `head[S]` (commitment van de actuele state) en de
  nullifier-set. Dit is exact het Zcash shielded-spend model, met het twist dat de
  "spend" pas bij check-in gebeurt;
- kanttekening: de lokale chain blijft essentieel als proof-of-ownership; de ZK-laag
  is alleen voor privacy.

### 2.5 Post-kwantum: dit systeem heeft een long-tail-exposure-probleem dat een normale L2 niet heeft

De lokale chain van een munt is een **publieke handtekening op een lang-levend
credentia**l (de munt kan 10 jaar meegaan, pas daarna gecheckt-in). Gevolgen:

- Solana Ed25519 (en secp256k1) valt onder Shor. De handtekeningen op de lokale
  chain zijn zichtbaar vanaf de mint — een adversary kan "harvest now, break later"
  uitvoeren: geldige munt-bestanden verzamelen, wachten op een QC, en daarna een
  check-in forgeren van een munt die niet meer van hem is. De schade is beperkt door
  de bond, maar de aanval is goedkoop en stil.
- Aanbeveling: de lokale chain vanaf dag één tekenen met **PQ-handtekeningen**:
  ML-DSA (Dilithium, FIPS 204) of SLH-DSA (SPHINCS+, FIPS 205). SLH-DSA past
  specifiek bij het muntmodel: vers keypair per munt, beperkt aantal signatures per
  key, verificatie-cost is eenmalig bij check-in.
- ZK (fase 3 van Grok's plan) is waar de PQ-risk het grootst is: Groth16/KZG e.a.
  zijn elliptische-curve/pairing gebaseerd (BGS) en post-kwantum ZK is niet
  productie-rijp. Als ZK een optionele laag is en het basissysteem (bond + nullifier)
  zonder ZK draait, is dat de juiste architectuur — dat zo houden.
- L1 (Solana Ed25519) is een PQ-aanname voor het hele systeem; een latere L1-migratie
  impliceert ook migratie van de `mint[S]`-records (oude mint-certificaten blijven
  verifieerbaar of worden gemigreerd).

### 2.6 Transfer-protocol: wie vertrouwt dat het bestand compleet is, en wie verliest?

- Offline transfer = overdracht van een versleuteld bestand. De ontvanger moet
  kunnen verifiëren: (a) bestandsintegriteit (HMAC/hash over het hele bestand),
  (b) de keten is geldig tot dat punt, (c) de laatste handtekening is van de
  verzender.
- Een kopie (backup) van de verzender blijft geldig zolang er geen nieuw link
  bijkomt. Daarom "langste keten wint" + bond: de oude houder verliest, maar wordt
  gecompenseerd door de bond.
- DoS: een attacker die een munt ontvangt kan een oude copy checken-in en zo de
  bond van het slachtoffer verbranden. Mitigatie: bond per check-in + rate-limit
  per adres + check-in fee.
- Verlies van de lokale chain = verlies van de munt (bearer instrument!). "Social
  recovery" van een bearer munt impliceert een federatie — en federatie impliceert
  trust. Dit is een productbeslissing:
  (a) pure bearer (kwijt = kwijt, zoals cash),
  (b) recovery via Shamir/MPC-splitsing van het bestand (blijft bearer, voegt
  key management toe),
  (c) federated recovery (handig, maar de federatie wordt de facto uitgever).

### 2.7 Het ontbrekende CBDC-trucje: de begrenste offline-toelating

De digitale euro (en de BoE offline-experimenten) gebruiken allemaal dezelfde
praktische truc: **een harde cap op het bedrag dat offline mag worden bewaard per
device** (digitale euro: "offline sublimit", enkele honderden euro's). Gevolgen voor
OBP:

- de maximale schade per device is vooraf bekend → bonds en risicobeheer zijn
  standaardiseerbaar;
- minting wordt afgedwongen per device/wallet-toelating (het kanaal checkt de
  toelating bij minten);
- dit is het verschil tussen "bankbiljet dat toevallig digitaal is" en "bankbiljet
  dat €50.000 waard kan zijn".

Grok's plan heeft zo'n cap niet; zonder cap is de risk-profiel van een double-spend
per munt onbegrensd.

## 3. Wat Grok wél goed doet

- Account-model vs UTXO-model is orthogonaal aan het offline-probleem. ✓
- Een two-way peg zonder double-spend detectie lost het niet op. ✓
- State channels zijn de realistische near-term laag; Local Coin-Chains zijn de laag
  die "bearer" oplevert. ✓
- De A+B combinatie is beter dan beide los. ✓
- "Het complete systeem bestaat nog niet" — grotendeels correct, maar met nuance
  (zie §4).

## 4. Wat er wél bestaat (geverifieerd, met bron)

| Onderdeel | Bestaat? | Bron |
|---|---|---|
| "Local blockchain per munt" (hart van optie B) | Ja, als paper — auteur van het Braziliaans Centraal Bank | Videira, "The offline cash puzzle solved by a local blockchain", IET Blockchain 4(1), maart 2024, doi:10.1049/blc2.12049 |
| Offline bearer tokens + blind signatures + inlevering | **Ja, productie** | Cashu (cashu.space): Chaumian ecash op Bitcoin, mints, offline token transfer, offline minting (batch keys). En Fedimint: zelfde model met multi-sig federatie in plaats van één mint |
| Begrenste offline-wallet | Ja, design/experimentfase | ECB digitale euro: "offline sublimit" (design doc juni 2024; preparation phase closing report okt 2025); BoE "Digital pound experiment report: Offline payments" (2025) met Thales, Secretarium, IDEMIA, Quali-Sign, Consult Hyperion |
| Lokale chain met ZK-verificatie, state lokaal, commitments on-chain | Ja, testnet-fase | Miden (testnet v5: "local transaction executions"; account state is lokaal, alleen commitments on-chain) |
| State channels | Ja, productie | Lightning (pairwise, **niet overdraagbaar** — cruciaal verschil met de munt-laag) |
| Two-way peg / sidechains | Ja, productie | Liquid, Rootstock, e.a. |

**Positie van OBP ten opzichte van Cashu, eerlijk gezegd:** Cashu levert al 80% van de
UX (offline bearer token, offline transfer, inlevering, blind privacy) — maar met een
getrouwd (of federated) mint, en het token is een **enkel geblind note** zonder lokale
geschiedenis. OBP = "Cashu waarbij de mint vervangen is door een publieke L2 en het
note een verifieerbare lokale chain is". Het delta is echt maar het is: trustless
settlement + per-munt verifieerbare historie, in ruil voor: challenge-periode + bonds +
complexere check-in.

**Wat er echt nog niet bestaat:** een permissionless, publiek systeem dat (L1 + L2 met
fraud proofs + state channels + Local Coin-Chains met serienummers + verplichte bonds +
ZK check-in) combineert en waarmee een gewone gebruiker maandenlang offline kan gaan
en veilig kan terugkomen. Grok's eindconclusie staat, maar de "gap" is kleiner dan het
lijkt: Cashu/Fedimint + de Videira paper + de digitale-euro design docs beslaan het
hele design-already; wat ontbreekt is de **engineering**, niet het concept.

## 5. Concrete check-in-design (indien we het bouwen)

Solana/Anchor (past in het active-defense-ecosysteem):

**On-chain state (L2-programma):**
```
MintRegistry[PDA("mint", serial)]   : { value, channel_pda, mint_tx, status: active|pending|final|disputed }
HeadRegistry[PDA("head", serial)]   : { head_state_hash, head_owner_commitment }
Escrow[PDA("escrow", serial)]       : { amount, contender, deadline_slot, winner? }
Nullifiers                          : Merkle bitmap / bitvec per serial (O(log n) proof)
Supply ledger (invariant)           : Σ mints = Σ channel balances + Σ coins (unspent) + Σ escrow
```

**Check-in state machine:**
1. `check_in(serial, full_chain, bond)`:
   - valideer `mint[serial]` bestaat en `active` is;
   - valideer de keten link-voor-link (hash chain + signatures) tot in `mint[serial]`;
   - `head[serial]` leeg → head zetten, bond escrowen, status `pending`, challenge-window
     (in slots) starten;
   - `head[serial]` is prefix van voorgelegde keten → direct accepteren (geen dispute
     mogelijk), status → `final`, bond vrijgeven;
   - fork → status `disputed`: beide partijen kunnen hun keten voorleggen; langste
     geldige keten wint; beide even lang en geldig → first-come-first-served; bond van
     de verliezer → winnaar.
2. `contend(serial, chain)`: alleen binnen de challenge-window.
3. `finalize(serial)`: na de window; `pending → final`, bond vrijgeven; waarde van de
   munt wordt gecrediteerd naar het kanaal / balance.
4. Twee-staps finaliteit: als L2 een rollup is, telt `final` pas als de state root met
   de nullifier definitief is op L1 (anders kan een L2-reorg hem terugtrekken).

**Invariants (auditeerbaar uit de logs):**
- I1: `nullified[serial]` wordt maximaal één keer gezet (bitmap garandeert dit);
- I2: Σ supply is behouden (Merkle root van de accounting-state, per block ge-commit);
- I3: een munt kan niet gecheckt-in worden terwijl `disputed`, behalve via `contend`;
- I4: bond ≥ muntwaarde op het moment van minten;
- I5: device/wallet-toelating: Σ V (munten gemint door dat kanaal, onuitgegeven) ≤
  toelating (afgedwongen bij minten, niet bij check-in — want offline kun je het later
  niet meer afdwingen).

**Solana-specifieke valkuilen:**
- slots gebruiken i.p.v. `unix_timestamp` voor de challenge-window (clock kan skew
  hebben; slots zijn consensus-geordend);
- de check-in tx moet idempotent zijn (replay van dezelfde tx mag niet opnieuw escrowen);
- nullifier bitmap in één account schaalt niet (10M serials = 1.25 MB bitvec; onder de
  10 MB account limit maar wel een write-hotspot) → Merkle tree over chunks of
  per-shard bitmaps;
- CPI naar het kanaalprogramma voor "terug crediteren naar kanaal" — het kanaal moet
  ook een munt kunnen crediteren die ná sluiting van het kanaal wordt gecheckt-in
  (settle naar L2-balance, niet naar het gesloten kanaal).

## 6. Conclusie / aanbeveling

1. Het concept staat, en het design-space is al ingenomen door Cashu/Fedimint (trust),
   de digitale euro (regulatie + begrenste toelating) en Videira (research). De
   value-proposition van OBP is precies één zin: **Cashu waarbij de mint publiek en
   verifieerbaar is, met per-munt historie en een begrenste offline-toelating.**
2. De zes punten uit §2 moeten vóór architectuur opgelost zijn: verplichte bond (I4),
   head + langste keten (2.2), L2 = optimistic rollup óf expliciete federatie-trust
   (2.3), ZK/blind check-in als optionele laag (2.4), PQ-signatures op de muntchain
   vanaf dag één (2.5), begrenste offline-toelating (2.7).
3. De goedkoopste haalbare prototype: **Cashu eerst, niet OBP.** De UX schijven met
   een trusted mint (Cashu zelf, of een eigen Anchor-programma met één mint) en in
   fase 2 de "mint" upgraden naar een L2-dispute-game. Dat levert het product in
   maanden, en de harde cryptografie pas bouwen als de UX bewezen is.
