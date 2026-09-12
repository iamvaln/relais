# Contrat Arbitrum — revue de la proposition `RelaisDeadManSwitch.sol` (12/09/2026)

Proposition reçue avec la révision des specs du 12 septembre
(`specs/SmartContract/` : contrat, tests Hardhat, script de déploiement,
document `Relais_Contract_DMS_v1.docx`). Décisions de référence : DEC-08
(Arbitrum L2), DEC-09 (dead man's switch = smart contract), DEC-10 (ce qui va
on-chain), DEC-11 (migration future), DEC-35 (déclenchement après trois
relances et silence écoulé). Verdict : **ne pas brancher en l'état** — le
Solidity est propre, mais le modèle ne correspond ni aux décisions ni à l'API,
et il ne tient pas la promesse d'autonomie.

## 1. Ce que fait le contrat

Un registre par adresse Ethereum : `configs[owner]` (schéma N/M, durée de
silence, fréquence de check-in, statut), `lastCheckin`, la clé Ed25519 sur
deux slots, `vaultPathHash`, `shareHashes[owner][contact][catégorie]` et
`notificationHashes`. États `Inactive → Active ⇄ Paused → Triggered →
Completed`. Toutes les écritures (`register`, `setContactHashes`, `checkin`,
`pause`, `unpause`, `markTriggered`, `markCompleted`, `deactivate`) sont
clés sur `msg.sender` ; aucun rôle, aucun propriétaire, pas d'upgrade.
`isTriggered(owner)` = `status == Active && now >= lastCheckin +
silenceDurationSecs`. Un événement par transition.

## 2. Points bloquants

1. **Qui signe ?** Le document dit « appelé par le backend », mais l'identité
   est `msg.sender`. Si le backend signe, tous les utilisateurs partagent
   `configs[backend]`. Si chaque owner signe (DEC-05, dérivation
   `m/44'/60'/0'/0/0`), rien n'existe dans `crypto-core` ni dans l'app (pas
   de secp256k1, pas de wallet, pas de gaz), et le backend ne peut plus
   appeler `checkin()` après le mini-jeu. À trancher : clé owner, clé
   opérateur, ou méta-transaction EIP-712 signée par l'owner et relayée par
   Relais.
2. **Sémantique du silence (DEC-35).** Le contrat compte depuis
   `lastCheckin` ; `jobs/deadman.ts` compte le retard depuis
   `next_checkin_due` et exige `relance_count = 3`. Le contrat déclare
   « déclenché » une période de check-in trop tôt, et `markTriggered()` ne
   vérifie pas que le silence est écoulé.
3. **Pause.** `pause()` remet `lastCheckin = now` (l'API ne touche
   `last_checkin_at` qu'à la reprise) ; la reprise n'a lieu que dans
   `checkin()` : un owner qui met en pause puis décède reste `Paused` pour
   toujours et `isTriggered()` reste faux. L'API reprend seule
   (`sweepPauses`). `PAUSE_MAX_SECS` figé à 90 jours alors que l'API lit
   `dms.pause_max_months`.
4. **Promesse « fonctionne même si Relais disparaît ».** Personne d'autre que
   la clé owner (le défunt) ne peut appeler `markTriggered()`. Un contact
   peut lire `isTriggered` / `getStatus` / `shareHashes` sans Relais, rien
   de plus : les `Si_enc` sont sur notre stockage, `notification_enc` en
   base, les liens relay émis par l'API, `vaultPathHash` n'est pas un
   pointeur. C'est un minuteur public et un registre d'intégrité, pas un
   relais autonome. Minimum pour tendre vers la promesse : un
   `trigger(owner)` sans permission conditionné à `isTriggered`, puis un
   jour des pointeurs vers des blobs chiffrés adressés par contenu.

## 3. Écarts secondaires

- Annulation admin (`cancelTransmission`) impossible on-chain : `Triggered`
  est terminal (`notTerminal`), seule la clé owner peut `deactivate()` puis
  `register()`.
- `deactivate()` laisse `shareHashes`, `ed25519Pk`, `vaultPathHash` en
  place ; `setContactHashes` ignore `bytes32(0)`, impossible d'effacer un
  hash ; `Completed` interdit tout `register()` à vie ; `register()`
  accepté en `Paused` (termine la pause en silence) ; `schemaN == 1`
  accepté alors que la base impose `schema_n >= 2` ; `checkinFreqSecs = 0`
  non validé ; `deactivate()` autorisé depuis `Triggered` et `Inactive`.
- DEC-10 demande `Hash(notification_enc + sig)` ; le contrat hache
  `notification_enc` seul. DEC-11 veut les événements comme source de
  vérité : `vaultPathHash` et `checkinFreqSecs` n'apparaissent dans aucun.
- Deux slots `ed25519PkHigh/Low` pour 32 octets (un `bytes32` suffit ; les
  tests y mettent deux keccak de 32 octets) ; `lastCheckin` en `uint256`
  hors de la struct packée.
- `deploy.js` utilise `run` sans l'importer : la vérification Arbiscan
  échouera toujours. `package.json` attend `contracts/`, `scripts/`,
  `test/`, `.env.example` ; la structure livrée est plate.

## 4. Vie privée

Rien de personnel en clair, aucun hash d'email : `SHA256(Si_enc)` et
`SHA256(notification_enc)` sont des hachés de chiffrés que le serveur
détient déjà — compatible avec la règle « le serveur ne lit jamais une
donnée utilisateur en clair ». `ed25519_pk` est publique par DEC-05.

En revanche les **métadonnées sont publiques et permanentes** : chaque
`CheckinRecorded` horodate la vie de la personne ; `DmsPaused(pausedUntil)`
publie « absent jusqu'au X » (mode Voyage = annonce d'absence) ;
`DmsTriggered` annonce un décès présumé ; `schemaN/M` révèle le nombre de
proches ; `vaultPathHash = keccak256('payloads/{user_id}/')` relie l'adresse
à l'identifiant en base pour qui a la base. Si l'adresse est dérivée du
seed, c'est un identifiant permanent. À décider en connaissance de cause,
ou à atténuer (adresse par transmission, événements sans date de fin de
pause, pas de `vaultPathHash`).

## 5. Sécurité Solidity

Pas d'appel externe ni d'ETH : pas de réentrance. Arithmétique 0.8,
`uint32` secondes (≈ 136 ans). Tolérance à `block.timestamp` sans enjeu à
l'échelle du mois. Struct bien packée. Non upgradable : toute correction est
un redéploiement et une migration des états.

## 6. Tests Hardhat

Bonne couverture des fonctions, de la machine à états et de l'isolation
entre owners. Manquent : un tiers appelant `checkin()` ou `markTriggered()`
pour un autre owner ; pause expirée sans check-in (`isTriggered()` reste
faux) ; `register()` pendant `Paused` ; `deactivate()` depuis `Triggered`
puis re-`register()` ; `schemaN = 1` ; `markTriggered()` avant le silence
écoulé (passe, ce qu'il ne devrait pas) ; rapport de gaz et invariants
(fuzz sur `secondsUntilTrigger`).

## 7. Intégration côté API, quand le modèle sera fixé

`ARBITRUM_RPC_URL`, `RELAIS_CONTRACT_ADDRESS`, une clé signataire hors HCV
(ETH pour le gaz, rotation, nonce, retry, reorg) ; `arbitrum_address` et
`contract_registered` existent déjà en base. Appels : `register` +
`setContactHashes` à l'activation, `checkin` dans `POST /checkin/complete`,
`pause` / `unpause`, `markTriggered` dans `trigger()`, `markCompleted` au
confirm, `deactivate`. La base reste maître ; l'on-chain n'est qu'un miroir,
et toute divergence de §2 rendra `isTriggered()` faux ou prématuré.

## 8. Décisions à prendre avant une v2 du contrat

Tranchées le 12/09/2026 : le design de la v2 est dans
`docs/smart-contract-v2.md` (opérateur qui écrit, owner qui signe ;
silence aligné sur `next_checkin_due` ; déclenchement sans permission et
pause qui expire on-chain ; packs adressés par contenu). La liste ci-dessous
est conservée pour l'historique.

1. Qui signe (owner, opérateur, ou EIP-712 relayé).
2. Aligner le silence sur `next_checkin_due` + trois relances, ou changer
   DEC-35 pour le modèle du contrat.
3. Déclenchement sans permission et expiration de pause on-chain.
4. Ce qu'on accepte de publier comme métadonnées.
5. Séquence de migration (redéploiement, `contract_registered`).
