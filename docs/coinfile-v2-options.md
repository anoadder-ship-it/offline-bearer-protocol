# CoinFile v2 — opties voor bespreking (GEEN keuze gemaakt)

Voorbereiding voor de product-beslissing van Michel (Q6/Q7/D6; STATUS.md
§10, §15.4). Dit document **kies niets** en bouwt er niks op voort — het
ligt klaar om op een rustig moment bewust te nemen.

## De vraag achter de beslissing

M4.1 (PQ-acceptatie 8/8, STATUS §14) heeft per link een PQ-signatuur
(ML-DSA-44) in de CoinFile. Verificatie vereist de **publieke key van de
houder die tekende**. V1 heeft die relatie niet in het bestand: owner =
32-byte ed25519-pubkey, signatuur = ed25519. De openstaande vraag:
**waar komt de owner→pk-relatie in (of rond) het CoinFile**, en welke
key-modelkeuze (Q7) hoort daarbij?

## Opties voor de owner→pk-relatie

### A — pk in het CoinFile zelf (format-extensie, versie v2)

Per state (of per signatuur) een veld met de PQ-pubkey van de tekenaar.

- + Volledig self-contained: een derde verifieert de hele keten offline,
  zonder externe lookup (passend bij de OBP-kernbelofte).
- + Geen on-chain registratie-stap nodig bij append/transfer.
- − Grootte: ML-DSA-44 pk = 1312 bytes per houder. Een coin met 4 holders
  groeit ~5 KB — verwerken door wrapper + stick-formaat (nog geen probleem,
  maar het is het formaat dat offline ronddraait).
- − De state-hash/ketenverificatie verandert → programma-layout v2.
  Devnet is verspilbaar; mainnet bestaat nog niet → **geen
  backward-compatibiliteitslast** (frisse mainnet-deploy met v2-layout).

### B — pk on-chain (registratie per wallet/houder)

Wallet registreert haar PQ-pk on-chain (bijv. in de registry of een
dediceerde PDA); check-in leest de pk op uit de chain.

- + CoinFile blijft klein (v1-formaat groeit nauwelijks).
- + Passend als Track 2 (on-chain PQ-verificatie, M4.2) uitkomt: de pk
  staat al waar de verificatie plaatsvindt.
- − "Offline-verifieerbaar" verzwakt: de keten is dan pas compleet
  verifieerbaar met chain-toegang (de transfer-zelf blijft offline, de
  verificatie niet volledig).
- − Extra registratie-stap + levenscyclus (pk wisselen? oude coins
  blijven op de oude pk gebonden?).

### C — Hybrid (ed25519 in file, PQ on-chain; hybride signatuur)

Kleine ed25519-pk blijft in het file (zoals v1); de PQ-pk wordt on-chain
gerelateerd; signatuur = hybride constructie (ed25519 ‖ PQ), à la het
publieke ed255222-pq-profiel (ML-DSA-44 + Solana-domain-separation,
SIMD/IETF-draft fase 2026-07). Migratie in fasen: (1) hybride, (2)
PQ-only, (3) ed25519-legacy.

- + Langzame, terugdraaibare migratie; ed25519-basis blijft grotendeels
  ongewijzigd (M1–M4-investering behouden).
- + External precedent met test-vectors en formele (Lean 4) spec te
  bestuderen — maar: proposal-fase, één auteur, onafhankelijk review
  vereist (niet blind overnemen).
- − Twee signatuursystemen tegelijk = grotere aanvalsoppervakte per
  transactie + grotere sigs (hybride sig ≈ 2,5 KB) totdat fase 2/3.
- − On-chain pk-relatie (zelfde kanttekening als B).

## Q7 — key-model (losse as, maar wél gekoppeld)

Onafhankelijk van A/B/C moet de encryptie- (en teken-)key gekozen worden:

- **Passkey-afgeleid** (SpankWallet-model: WebAuthn/recovery):
  recovery mogelijk (online-ceremonie); key is niet letterlijk op de
  offline-stick → "écht offline" is dan de handtekening, niet de key.
- **Device-lokale key**: écht offline (key + coin samen op de stick);
  device verloren = coin verloren **tenzij** er een (optionele)
  versleutelde backup is — backup-afleiding wordt dan zelf een product-
  vraag (social recovery? encrypted stick-backup?).

Interactie: device-lokaal sluit aan bij A (alles in/om het file, wallet
host draagt pk+key mee); passkey-model sluit aan bij B/C (wallet
registreert pk, key blijft bij de wallet).

## Nog niet beslist (bewust open laten)

1. A vs B vs C (en eventueel varianten/overgangen ertussen).
2. Q7-key-model (en bij device-lokaal: backup-standaard of optioneel).
3. Of Q6 (SpankWallet als reference wallet, M2.5 fase B) eerst moet, of
   parallel kan — de wallet-keuze beïnvloedt vooral Q7, niet de
   owner→pk-vraag zelf.
4. Naamgeving/versie: "CoinFile v2" = nieuwe versie van dezelfde
   container, of splitsing (CoinCore v1 blijft, nieuwe PQ-uitbreiding)?

— Eind van voorbereiding; keuze = Michel.
