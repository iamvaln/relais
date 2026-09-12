# Contrat Arbitrum v2 — design (12 septembre 2026)

Suite de la revue de la proposition `RelaisDeadManSwitch.sol`
(`docs/smart-contract.md`, verdict : ne pas brancher en l'état). Ce document
fixe le modèle d'une v2 sur les quatre décisions recommandées le 12/09 et
validées par le fondateur (« Go, pas de pièces jointes, écris le design Arbitrum v2 »). Il ne contient pas de
Solidity final : il dit ce que le contrat garantit, ce qu'il publie, comment
l'API et les clients s'y branchent, et ce qui reste à trancher avant
d'écrire la première ligne — test-first, comme le reste.

## 0. Ce que le contrat est, et n'est pas

Le contrat est trois choses, et rien de plus :

1. **un minuteur public** : quand une personne a cessé de donner signe de
   vie, n'importe qui peut le constater et le déclarer ;
2. **un registre d'intégrité** : la clé publique de l'owner et les hachés
   des blobs chiffrés, pour que personne (Relais compris) ne puisse
   substituer un blob ;
3. **un annuaire de pointeurs** : où trouver ces blobs sans Relais.

Il ne détient aucun secret, ne déchiffre rien, ne connaît ni email ni nom.
La base PostgreSQL reste maître pour l'expérience quotidienne (relances,
emails, escrow, back office) ; le contrat est le **chemin de secours** qui
tient la promesse « fonctionne même si Relais disparaît » — et un miroir
vérifiable tant que Relais est là.

## 1. Les quatre décisions

### D1 — Qui signe : l'opérateur écrit, l'owner signe, tout le monde vérifie

L'app n'a ni clé secp256k1, ni wallet, ni ETH, et ne doit pas en avoir
(DEC-05 : une seule racine, le seed BIP39 ; pas de friction de gaz pour un
utilisateur au Cameroun). Les transactions sont donc envoyées par une **clé
opérateur** de Relais. Mais un opérateur seul pourrait simuler des check-ins
et retenir une transmission à jamais. D'où la règle : **chaque écriture qui
engage l'owner porte sa signature Ed25519**, produite sur le device par
`crypto-core` (`signPayload`, la même primitive que le vault et le carnet),
transmise en calldata et publiée dans l'événement. Le contrat ne la vérifie
pas (pas de précompilé Ed25519 sur Arbitrum ; une vérification en Solidity
coûte plusieurs centaines de milliers de gaz) : elle est **vérifiable par
tous** hors chaîne, avec la `ed25519_pk` enregistrée. Un check-in sans
signature valide de l'owner est une fraude visible dans les logs.

Message signé : `SHA256("relais:dms:v2|" ‖ action ‖ subject ‖ nextCheckinDue
‖ pausedUntil)`, avec `nextCheckinDue` strictement croissant (imposé par le
contrat) : pas de rejeu possible.

Identité on-chain : `subject = keccak256(ed25519_pk)`. Pseudonyme stable,
indépendant de la chaîne (DEC-11), relié à rien d'autre que la clé publique
(DEC-05 la dit publique). Pas de `user_id`, pas de `vaultPathHash`.

### D2 — Silence aligné sur DEC-35

Le contrat stocke **`nextCheckinDue`** (posé par l'API à chaque check-in,
c'est sa valeur `next_checkin_due`) et `silenceSecs`. La condition de
déclenchement est :

```
triggerable(subject) = status ∈ {Active, Paused expirée}
                       ∧ now ≥ nextCheckinDue + silenceSecs
```

C'est la règle de l'API (`jobs/deadman.ts` : échéance dépassée de
`silence_duration_months × 30` jours). Les trois relances sont l'affaire de
Relais, pas de la chaîne : elles tombent à J+7/14/21, toujours avant le
silence, et si Relais a disparu il n'y a plus personne pour relancer — le
minuteur on-chain est justement le secours. Un check-in par l'API déplace
`nextCheckinDue` ; un check-in réussi dans l'app le fait avancer, jamais
reculer.

### D3 — Pause expirant on-chain

`pause(subject, until)` pose `pausedUntil` sans toucher au reste. La reprise
est **calculée**, pas transactionnelle : passé `pausedUntil`, la vue
`triggerable` considère l'échéance `pausedUntil + checkinFreqSecs`. Un owner
qui met en pause puis décède ne bloque plus le minuteur à jamais.
`resume(subject, nextCheckinDue)` existe pour la reprise anticipée depuis
l'app. Le plafond de pause n'est pas figé dans le contrat : l'API l'applique
(`dms.pause_max_months`), le contrat refuse seulement `until` dans le passé
ou au-delà d'un an.

### D4 — Déclenchement sans permission, annulation par l'owner

`trigger(subject)` est appelable par **n'importe qui** dès que
`triggerable` est vrai : un contact, un tiers, Relais elle-même (le job
`deadman` l'appelle en temps normal). Il pose `triggeredAt` et émet
`Triggered`. Rien de ce qui suit ne dépend de Relais.

`cancelTrigger(subject, nextCheckinDue, ownerSig)` — l'owner est vivant
(décision du 12/09/2026, `POST /transmission/cancel`) : l'opérateur relaie
la signature de l'owner, l'état redevient `Active`. Sans signature owner
valide dans l'événement, une annulation est une fraude visible.
`complete(subject)` clôt (opérateur, après la purge) ; `deactivate` repart
d'une signature owner. Aucun état n'est terminal pour toujours : un
`register` après `Completed` est permis, avec un `nextCheckinDue` plus grand.

### D5 — Autonomie réelle : des blobs adressés par contenu

C'est le point qui manquait à la proposition. Les parts `Si_enc` sont
chiffrées par `K_i`, dérivée des réponses secrètes du contact (Argon2id
MODERATE). Elles peuvent donc **être publiques** : seul qui connaît les
réponses les ouvre. À l'activation, Relais publie pour chaque contact un
**pack de relais** sur un stockage adressé par contenu (IPFS, épinglé chez
deux fournisseurs — Storj propose l'épinglage), et écrit les CID on-chain :

```
pack_i = {
  version: 2,
  questions: [{ id, text_fr, text_en }],   // texte public (DEC-20)
  roles: { k1, k2, k3 },
  shares: { k1?: Si_enc, k2?: Si_enc, k3?: Si_enc },   // + signatures Ed25519 (DEC-29)
  secret_enc,                               // sous K2 : nom, rôle, message — lisible une fois K2 reconstituée
  verify_token                              // XChaCha20(K_i, 'RELAIS_VERIFY_OK_V1') : le contact sait qu'il a bien répondu
}
vault = { accounts: P2, messages: P2, finances: P2, journal: [entrées sous K2] }   // les mêmes blobs que Storj
```

`setPointers(subject, packCids[], vaultCid)` publie les CID (un événement
par mise à jour ; DEC-11 : les événements sont la source de vérité). Un
contact sans Relais : lit `Triggered` et `Pointers` depuis n'importe quel
RPC public, télécharge les packs depuis n'importe quelle passerelle IPFS,
répond à ses questions dans l'app ou la page web (`crypto-core` `relay`
fonctionne déjà hors ligne sur des blobs), et reconstitue avec N parts.

**Ce que ça coûte, dit clairement.** Un blob public est attaquable hors
ligne, pour toujours. Pour `P2` (clés de 128 bits d'entropie) c'est sans
objet. Pour `Si_enc`, la clé vient des réponses : un attaquant qui télécharge
le pack peut essayer des réponses à 1,5 s par essai (Argon2id MODERATE,
256 Mo), sans limite de tentatives ni blocage 24 h. Trois questions à score
≥ 6 et l'obligation de N contacts distincts rendent l'attaque coûteuse, pas
impossible. Mitigations retenues :

- **score minimum relevé pour l'autonomie** : un contact n'a de pack public
  que si ses trois questions ont un score ≥ 8 (`vault.question_min_score`
  reste à 6 pour le parcours Relais) ; l'app le dit à l'owner au choix des
  questions ;
- **publication au choix de l'owner** : l'activation propose « mode
  autonome » (packs publics) ou « mode Relais » (packs chez Relais
  seulement, contrat = minuteur et intégrité) ; le défaut est « Relais »,
  l'autonomie est expliquée avec le risque ;
- **carte d'autonomie** : à l'activation en mode autonome, l'owner remet à
  chaque contact (PDF, QR, message) le `subject`, l'adresse du contrat et la
  marche à suivre — sans Relais, personne d'autre ne les préviendra.

Ce qui n'est **pas** retenu : le verrouillage temporel (tlock/drand) des
packs — les parts ne changent pas entre deux publications, la première
échue suffirait à l'attaquant ; et le re-partage des clés à chaque check-in,
qui obligerait à rechiffrer le coffre.

### Métadonnées publiques (décision acceptée)

Sous pseudonyme `keccak256(ed25519_pk)` : dates de check-in (au jour près :
`nextCheckinDue` est arrondi au jour), pauses et leur fin, déclenchement,
N/M, hachés et CID des blobs. Pas d'identifiant Relais, pas d'email, pas
de nom. Un observateur voit qu'« une personne » vit, part en voyage, ou est
présumée décédée — sans savoir qui. Qui relie une clé à une personne (un
contact, Relais) sait tout ; c'est le prix du minuteur public, accepté.

## 2. Interface du contrat

```solidity
enum Status { Inactive, Active, Paused, Triggered, Completed }

struct Dms {
  Status  status;
  uint8   n;               // parts nécessaires
  uint8   m;               // contacts
  uint32  silenceSecs;
  uint32  checkinFreqSecs;
  uint64  nextCheckinDue;  // arrondi au jour, strictement croissant
  uint64  pausedUntil;     // 0 hors pause
  uint64  triggeredAt;
  bytes32 ed25519Pk;
}

mapping(bytes32 subject => Dms) public dms;
address public operator;            // rotation en deux temps (propose / accept)

// écritures de l'opérateur, signées par l'owner (sig en calldata, publiée dans l'événement)
function register(bytes32 subject, bytes32 ed25519Pk, uint8 n, uint8 m,
                  uint32 silenceSecs, uint32 checkinFreqSecs, uint64 nextDue, bytes calldata ownerSig)
function checkin(bytes32 subject, uint64 nextDue, bytes calldata ownerSig)
function pause(bytes32 subject, uint64 until, bytes calldata ownerSig)
function resume(bytes32 subject, uint64 nextDue, bytes calldata ownerSig)
function cancelTrigger(bytes32 subject, uint64 nextDue, bytes calldata ownerSig)
function deactivate(bytes32 subject, bytes calldata ownerSig)
// écritures de l'opérateur seul
function setPointers(bytes32 subject, bytes32[] calldata packCids, bytes32 vaultCid)
function setShareHashes(bytes32 subject, bytes32[] calldata siEncHashes)   // DEC-10, intégrité
function complete(bytes32 subject)
// sans permission
function trigger(bytes32 subject)
// vues
function triggerable(bytes32 subject) view returns (bool)
function secondsUntilTriggerable(bytes32 subject) view returns (uint256)
function get(bytes32 subject) view returns (Dms memory)
```

Invariants (à fuzzer) : `nextCheckinDue` ne décroît jamais ; `trigger`
réussit si et seulement si `triggerable` ; une pause expirée ne bloque pas
`triggerable` ; `n ≥ 2`, `m ≥ n`, `checkinFreqSecs > 0`, `silenceSecs ≥ 30
jours` ; `Completed` n'est pas terminal ; aucun appel externe, aucun ETH
reçu (pas de réentrance) ; `operator` change en deux temps.

Événements : `Registered`, `CheckedIn(subject, nextDue, ownerSig)`,
`Paused(subject, until, ownerSig)`, `Resumed`, `Triggered(subject, at, by)`,
`TriggerCancelled(subject, nextDue, ownerSig)`, `Pointers(subject, packCids,
vaultCid)`, `ShareHashes`, `Completed`, `Deactivated`, `OperatorProposed`,
`OperatorAccepted`. Tout l'état se reconstitue depuis les événements
(DEC-11).

Sécurité Solidity : 0.8.x, struct packée, `uint64` pour les dates, pas
d'`Ownable` d'OpenZeppelin (une seule adresse, rotation maison en deux
temps), pas de proxy — une v3 sera un nouveau contrat et une migration par
événements. Ce qui est immuable ici est petit et lisible.

## 3. Intégration côté API

- **Signataire** : clé secp256k1 dédiée, hors HCV mais chiffrée au repos
  (`CHAIN_OPERATOR_KEY_ENC` déchiffrée par une clé dédiée
  `CHAIN_KEY_ENC_KEY`, même règle de garde que `TOTP_ENC_KEY`), ETH pour le
  gaz surveillé (alerte `chain_gas_low` sur le tableau de bord sous 0,01
  ETH), nonce géré par un seul processus.
- **File `chain:sync` (BullMQ)** : aucune requête HTTP n'attend Arbitrum.
  `POST /checkin/complete`, activation, pause, reprise, annulation, purge
  poussent un job idempotent `{ subject, action, payload, ownerSig }` ; le
  worker envoie, attend la finalité douce (1-2 s), écrit
  `arbitrum_tx_hash` (`checkin_log` l'a déjà) ; retry exponentiel, échec
  après 24 h → alerte `chain_divergence`.
- **Signature owner** : l'app signe au moment de l'action (elle a la clé en
  session après le PIN) et l'envoie dans le corps (`chain_sig`) ; l'API la
  relaie telle quelle. Les endpoints existants gagnent un champ optionnel
  tant que `CHAIN_ENABLED=false`, obligatoire ensuite pour les comptes
  enregistrés.
- **Réconciliation** : job quotidien qui compare `dms[subject]` à la base
  (statut, `nextCheckinDue`, `pausedUntil`) et lève `chain_divergence` ;
  la base reste maître, la chaîne est corrigée, jamais l'inverse — sauf
  `Triggered` posé par un tiers alors que la base dit `active` : l'API
  ouvre alors la transmission (`startTransmission`) après avoir vérifié que
  `triggerable` était vrai au bloc du déclenchement.
- **Publication des packs** (mode autonome) : à l'activation, après les
  parts, l'API construit les packs, les épingle (IPFS via Storj ou
  web3.storage — à choisir), garde les CID en base
  (`trusted_contacts.pack_cid`, `transmission_configs.vault_cid`) et pousse
  `setPointers`. Le vault est republié à chaque `POST /vault/sync` en mode
  autonome (débounce 1 h).
- **Colonnes** : `users.arbitrum_address` devient `chain_subject` (bytes32
  hex), `contract_registered` reste ; `transmission_configs.autonomy_mode`
  (`relais` | `autonomous`), `chain_registered_at`.
- **Variables** : `CHAIN_ENABLED`, `ARBITRUM_RPC_URL`,
  `RELAIS_CONTRACT_ADDRESS`, `CHAIN_OPERATOR_KEY_ENC`, `CHAIN_KEY_ENC_KEY`,
  `IPFS_PIN_ENDPOINT`, `IPFS_PIN_TOKEN`, `IPFS_GATEWAY_URL`.

## 4. Côté clients

- **app-core** : `chainSignature(action, subject, nextDue, pausedUntil)`
  dans `crypto-core` (message ci-dessus) ; `Transmission`, `Checkin` et
  `cancelTriggered` joignent la signature. Choix du mode d'autonomie à
  l'activation, avec l'avertissement et la contrainte de score.
- **Carte d'autonomie** : écran « Mes contacts sans Relais » qui génère,
  par contact, un QR et un texte (`subject`, adresse du contrat, passerelle
  IPFS, lien vers la page web) à partager par le canal de l'owner.
- **Parcours du contact, mode autonome** (`app-core` `relay/`, `web-relay`) :
  entrée par `subject` (QR) ; lecture des événements `Triggered` et
  `Pointers` via un RPC public (ethers, lecture seule, sans clé) ;
  téléchargement des packs par CID ; vérification des signatures Ed25519
  des parts avec `ed25519_pk` du registre ; réponses, `verify_token`,
  reconstitution N-of-M — tout en mémoire, comme aujourd'hui. Si Relais est
  là, le parcours actuel (escrow, liens par email) reste le chemin normal :
  plus simple et sans exposition des packs.

## 5. Déploiement et migration

1. `contracts/` dans le monorepo : Foundry (tests unitaires, fuzz,
   invariants, rapport de gaz), `forge fmt`, CI dédiée. Plus de Hardhat.
2. Arbitrum Sepolia d'abord : `CHAIN_ENABLED=true` en **mode miroir**
   (écritures, jamais de déclenchement depuis la chaîne), un mois de
   réconciliation sans divergence.
3. Mainnet Arbitrum : mode miroir, puis activation du déclenchement de
   secours (l'API ouvre une transmission sur `Triggered` tiers), puis
   ouverture du mode autonome aux owners (opt-in).
4. Comptes existants : enregistrés au prochain check-in réussi (l'app signe
   le `register` à ce moment) ; `contract_registered` passe à vrai.
5. Une v3 = nouveau contrat + script de migration depuis les événements ;
   `RELAIS_CONTRACT_ADDRESS` change, les clients lisent les deux pendant la
   transition.

## 6. Tests, test-first

- **Contrat (Foundry)** : machine à états complète ; `trigger` par un tiers
  avant et après l'échéance ; pause expirée puis `trigger` ; `checkin` avec
  `nextDue` non croissant refusé ; `cancelTrigger` puis nouveau cycle ;
  `register` après `Completed` ; rotation d'opérateur en deux temps ; fuzz
  sur `secondsUntilTriggerable` ; invariants ci-dessus ; gaz par fonction.
- **API** : un nœud Anvil dans la CI (job `Chaîne`), contrat déployé au
  setup ; tests d'intégration réels comme pour PostgreSQL et Redis (pas de
  mock du client de chaîne) : activation → `Registered` + `Pointers` ;
  check-in → `CheckedIn` avec la signature de l'app vérifiable ;
  déclenchement par le job → `Triggered` ; `trigger` tiers → transmission
  ouverte par la réconciliation ; annulation owner → `TriggerCancelled` ;
  divergence → alerte.
- **Clients** : `crypto-core` signe et vérifie le message ; `app-core`
  relay autonome contre Anvil et un IPFS local (`ipfs daemon` ou Kubo en
  conteneur) : reconstitution sans API.

## 7. Ce qu'il reste à trancher avant d'écrire

**Tranché le 12/09/2026** (« Go, lance le lot 1 d'Arbitrum v2 avec les
valeurs du §7 ») : la colonne « Proposition » fait foi.

| Point | Proposition (retenue) | Alternative |
|---|---|---|
| Épinglage IPFS | Storj (déjà fournisseur) + un second épingleur | web3.storage seul |
| Score minimum du mode autonome | 8 | 7, ou pas de plancher (déconseillé) |
| Mode par défaut à l'activation | `relais` (packs privés), autonomie opt-in expliquée | autonomie par défaut |
| Publier le coffre (P2) en mode autonome | oui — sans lui l'autonomie est vide | parts seulement (le contact ne peut rien ouvrir sans Relais) |
| Granularité des dates on-chain | jour | heure |
| Où vit la clé opérateur | chiffrée au repos, déchiffrée au démarrage, hors HCV | HCV Transit (signature déléguée, plus lent) |

## 8. Estimation

Contrat et tests Foundry : trois jours. API (signataire, file, réconciliation,
packs, migrations) : quatre jours. Clients (signatures, choix du mode, carte
d'autonomie, parcours autonome app et web) : quatre jours. Testnet un mois
en miroir avant tout déclenchement de secours.

## 9. Lot 1 — le contrat ✅ (12/09/2026)

`contracts/` : Foundry (`forge-std` en sous-module, `git submodule update
--init`), solc 0.8.30, EVM `cancun`, optimiseur 10 000 passes, sans
métadonnées CBOR. `src/RelaisDms.sol` (≈ 7,3 Ko déployés), trois suites dans
`test/` : 37 tests unitaires sur la machine à états, 4 tests fuzz (512
tirages), 7 invariants (128 séquences de 64 appels) sur un handler qui joue
des appels valides ou non (48 tests). Deux mutations vérifiées détectées par les
invariants (échéance qui recule, `trigger` sans condition).
`.gas-snapshot` est commité et vérifié en CI (job « Contrat » : `forge fmt
--check`, `forge build --sizes`, `forge test`, `forge snapshot --check`).

```bash
cd contracts
forge test                 # unitaires + fuzz + invariants
forge test --gas-report    # gaz par fonction
forge snapshot             # met à jour .gas-snapshot après un changement voulu
```

Décisions prises en écrivant, par rapport au §2 :

- **Dates alignées au jour, exigées et non arrondies** : `nextDue` et
  `until` doivent être des multiples de 86 400 (`BadDueDate`,
  `BadPauseDate`). Le contrat ne tronque rien en silence : ce que l'API
  envoie est ce que la chaîne publie.
- **`subject == keccak256(ed25519Pk)` est vérifié on-chain** à
  l'enregistrement (`SubjectMismatch`) : le pseudonyme est lié à la clé,
  personne ne peut enregistrer une clé sous un autre sujet.
- **La monotonie de `nextCheckinDue` survit à tout** : `deactivate` et
  `complete` la conservent, un `register` suivant doit la dépasser. Un
  rejeu d'une ancienne signature de check-in est donc impossible même
  après un cycle complet.
- **`checkin` pendant une pause vaut reprise** (l'app fait un check-in,
  l'API n'a pas à choisir entre deux appels) ; `resume` reste pour la
  reprise explicite depuis l'écran de pause. Les deux exigent une échéance
  strictement plus grande.
- **`trigger` n'a pas de passe-droit** : l'opérateur y est soumis à la même
  condition que n'importe qui. `Triggered` publie l'adresse de l'appelant.
- **`deactivate` (signature owner) et `complete` (opérateur) effacent les
  pointeurs et les hachés** : après une purge, la chaîne ne pointe plus vers
  rien. `deactivate` part de tout état vivant (Active, Paused, Triggered).
- **Pointeurs bornés et gelés par le contrat** : au plus `m` CID de packs,
  exactement `m` hachés de parts (`BadThreshold`) ; permis en `Active` ou
  `Paused` seulement — une fois `Triggered`, rien de ce qui décrit les
  blobs ne bouge plus, et `complete` efface tout. Un `bytes32` de CID est le digest sha2-256 d'un
  CIDv1 `raw` ; le lecteur reconstruit le CID (`bafkrei…`).
- **La signature Ed25519 n'est contrôlée qu'en longueur** (64 octets,
  `BadSignature`) et publiée telle quelle dans l'événement : la
  vérification est hors chaîne, par quiconque, avec `ed25519Pk` (D1).
- **Vues** : `triggerable(s) ⇔ secondsUntilTriggerable(s) == 0` ;
  `type(uint256).max` quand le minuteur ne court pas (Inactive, Triggered,
  Completed, sujet inconnu).
- **Rien ne rentre** : pas de `receive` ni de `fallback` (l'ETH est
  refusé), aucun appel externe, aucune dépendance hors `forge-std` pour les
  tests.

Gaz mesuré (tests unitaires, optimiseur 10 000) : `register` ≈ 80 k,
`checkin` ≈ 28 k, `pause` ≈ 33 k, `trigger` ≈ 52 k, `cancelTrigger` ≈ 27 k,
`setPointers` ≈ 63 k pour trois packs. Sur Arbitrum, quelques centimes par
écriture.

Non fait dans ce lot, et volontairement : aucun script de déploiement (il
viendra avec le lot 2, l'API et Anvil en CI), pas de vérification Ed25519
on-chain (D1), pas de proxy (§2).
