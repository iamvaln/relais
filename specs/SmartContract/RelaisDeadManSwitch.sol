// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  RelaisDeadManSwitch
 * @notice Dead man's switch on-chain pour l'application Relais.
 *         Réseau : Arbitrum One L2 (DEC-08).
 *         Contrat simple, non-upgradeable (DEC-11 : autonomie > flexibilité).
 *
 * @dev    Rôle du contrat (DEC-10) :
 *           - Stocker ed25519_pk de l'owner (preuve d'identité cryptographique)
 *           - Enregistrer les hash des parts Shamir Si_enc (intégrité on-chain)
 *           - Tenir le registre des check-ins (timestamp last_checkin)
 *           - Exposer isTriggered() pour audit autonome
 *
 *         Ce que le contrat NE fait PAS :
 *           - Il n'envoie pas d'emails (BullMQ côté serveur)
 *           - Il ne stocke pas les données du vault ni les Si_enc eux-mêmes
 *           - Il ne vérifie pas les réponses aux questions (DEC-13 : 100% client)
 *
 *         Dérivation adresse owner (DEC-05) :
 *           BIP39 seed → BIP32/BIP44 m/44'/60'/0'/0/0 → adresse Ethereum
 *           La même clé seed génère K1/K2/K3 + ed25519_pk + adresse Ethereum.
 */
contract RelaisDeadManSwitch {

    // ─── Types ────────────────────────────────────────────────────────────────

    enum Status { Inactive, Active, Paused, Triggered, Completed }

    /// @notice Configuration du dead man's switch d'un owner.
    struct DmsConfig {
        Status  status;
        uint32  silenceDurationSecs; // Durée silence avant déclenchement
        uint32  checkinFreqSecs;     // Fréquence check-in (info, pas enforced on-chain)
        uint8   schemaN;             // N contacts minimum pour reconstituer K
        uint8   schemaM;             // M contacts désignés au total
        uint64  registeredAt;
        uint64  pausedUntil;         // 0 si pas en pause
    }

    // ─── Constantes ───────────────────────────────────────────────────────────

    uint256 public constant PAUSE_MAX_SECS = 7_776_000; // 90 jours (DEC-22 : 3 mois max)
    uint8   public constant MAX_CONTACTS   = 5;
    uint8   public constant KEY_CATS       = 3;           // k1, k2, k3

    // ─── Storage ──────────────────────────────────────────────────────────────

    /// @notice État DMS par owner
    mapping(address => DmsConfig) public configs;

    /// @notice Dernier timestamp de check-in par owner
    mapping(address => uint256) public lastCheckin;

    /**
     * @notice Clé publique Ed25519 de l'owner (32 bytes = deux slots bytes32).
     *         Stockée pour audit cryptographique externe.
     *         ed25519_pk = Ed25519.keypair(seed).pk   (DEC-05)
     */
    mapping(address => bytes32) public ed25519PkHigh; // 16 premiers bytes
    mapping(address => bytes32) public ed25519PkLow;  // 16 derniers bytes

    /**
     * @notice Hash du chemin Storj du vault (keccak256 du path string).
     *         Permet de vérifier que le backup Storj est bien lié à cet owner.
     */
    mapping(address => bytes32) public vaultPathHash;

    /**
     * @notice Hash SHA256 des parts Shamir chiffrées.
     *         shareHashes[owner][contactIndex][keyCategory] = SHA256(Si_enc)
     *         keyCategory : 0=k1, 1=k2, 2=k3
     *         DEC-29 : intégrité on-chain — un access token volé ne peut pas
     *                  remplacer Si_enc sans casser ce hash.
     */
    mapping(address => mapping(uint8 => mapping(uint8 => bytes32))) public shareHashes;

    /**
     * @notice Hash SHA256 des notification_enc par contact (audit/traçabilité).
     *         notificationHashes[owner][contactIndex] = SHA256(notification_enc)
     */
    mapping(address => mapping(uint8 => bytes32)) public notificationHashes;

    // ─── Events ───────────────────────────────────────────────────────────────

    event DmsRegistered(
        address indexed owner,
        uint32  silenceDurationSecs,
        uint8   schemaN,
        uint8   schemaM,
        uint64  registeredAt
    );

    event CheckinRecorded(
        address indexed owner,
        uint256 checkinAt,
        uint256 nextDueAt
    );

    event ShareHashSet(
        address indexed owner,
        uint8   indexed contactIndex,
        uint8   indexed keyCategory,
        bytes32 hash
    );

    event NotificationHashSet(
        address indexed owner,
        uint8   indexed contactIndex,
        bytes32 hash
    );

    event DmsPaused(
        address indexed owner,
        uint64  pausedUntil
    );

    event DmsUnpaused(address indexed owner, uint256 resumedAt);

    event DmsTriggered(
        address indexed owner,
        uint256 triggeredAt,
        uint256 silenceSinceCheckin
    );

    event DmsCompleted(address indexed owner, uint256 completedAt);

    event DmsDeactivated(address indexed owner);

    event Ed25519PkRegistered(
        address indexed owner,
        bytes32 pkHigh,
        bytes32 pkLow
    );

    // ─── Errors ───────────────────────────────────────────────────────────────

    error NotRegistered();
    error AlreadyTriggered();
    error AlreadyCompleted();
    error InvalidConfig(string reason);
    error NotActive();
    error NotPaused();
    error PauseExceedsMax();
    error PauseInPast();
    error ContactIndexOutOfRange(uint8 index, uint8 max);
    error InvalidKeyCategory(uint8 category);

    // ─── Modifiers ────────────────────────────────────────────────────────────

    modifier onlyRegistered() {
        if (configs[msg.sender].status == Status.Inactive) revert NotRegistered();
        _;
    }

    modifier notTerminal() {
        Status s = configs[msg.sender].status;
        if (s == Status.Triggered) revert AlreadyTriggered();
        if (s == Status.Completed) revert AlreadyCompleted();
        _;
    }

    // ─── Enregistrement ───────────────────────────────────────────────────────

    /**
     * @notice Enregistrer ou mettre à jour la configuration DMS.
     *         Appelé par le backend après POST /transmission/activate.
     *
     * @param silenceDurationSecs  Durée de silence avant déclenchement en secondes
     *                             (ex: 2592000 = 30j, 7776000 = 90j, 15552000 = 180j)
     * @param checkinFreqSecs      Fréquence de check-in en secondes (info, non enforced)
     * @param schemaN              Minimum de contacts requis (N-of-M)
     * @param schemaM              Total de contacts désignés
     * @param ed25519PkH           16 premiers bytes de ed25519_pk (DEC-05)
     * @param ed25519PkL           16 derniers bytes de ed25519_pk
     * @param _vaultPathHash       keccak256(storj_vault_path)
     */
    function register(
        uint32  silenceDurationSecs,
        uint32  checkinFreqSecs,
        uint8   schemaN,
        uint8   schemaM,
        bytes32 ed25519PkH,
        bytes32 ed25519PkL,
        bytes32 _vaultPathHash
    ) external notTerminal {
        if (silenceDurationSecs == 0)
            revert InvalidConfig("silenceDuration must be > 0");
        if (schemaN == 0 || schemaM < 2 || schemaN > schemaM)
            revert InvalidConfig("invalid N-of-M schema");
        if (schemaM > MAX_CONTACTS)
            revert InvalidConfig("schemaM exceeds MAX_CONTACTS");

        DmsConfig storage cfg = configs[msg.sender];
        cfg.status              = Status.Active;
        cfg.silenceDurationSecs = silenceDurationSecs;
        cfg.checkinFreqSecs     = checkinFreqSecs;
        cfg.schemaN             = schemaN;
        cfg.schemaM             = schemaM;
        cfg.registeredAt        = uint64(block.timestamp);
        cfg.pausedUntil         = 0;

        ed25519PkHigh[msg.sender] = ed25519PkH;
        ed25519PkLow[msg.sender]  = ed25519PkL;
        vaultPathHash[msg.sender] = _vaultPathHash;

        // Le check-in commence à la date d'enregistrement
        lastCheckin[msg.sender] = block.timestamp;

        emit Ed25519PkRegistered(msg.sender, ed25519PkH, ed25519PkL);
        emit DmsRegistered(
            msg.sender,
            silenceDurationSecs,
            schemaN,
            schemaM,
            uint64(block.timestamp)
        );
        emit CheckinRecorded(
            msg.sender,
            block.timestamp,
            block.timestamp + checkinFreqSecs
        );
    }

    /**
     * @notice Enregistrer les hash Shamir d'un contact.
     *         Appelé une fois par contact lors de l'activation.
     *         Peut être rappelé si les questions changent (recréation des parts).
     *
     * @param contactIndex  Index du contact (0-based, < schemaM)
     * @param hashK1        SHA256(S1_enc) ou bytes32(0) si pas de rôle k1
     * @param hashK2        SHA256(S2_enc) ou bytes32(0) si pas de rôle k2
     * @param hashK3        SHA256(S3_enc) ou bytes32(0) si pas de rôle k3
     * @param notifHash     SHA256(notification_enc) pour traçabilité
     */
    function setContactHashes(
        uint8   contactIndex,
        bytes32 hashK1,
        bytes32 hashK2,
        bytes32 hashK3,
        bytes32 notifHash
    ) external onlyRegistered notTerminal {
        DmsConfig storage cfg = configs[msg.sender];
        if (contactIndex >= cfg.schemaM)
            revert ContactIndexOutOfRange(contactIndex, cfg.schemaM - 1);

        if (hashK1 != bytes32(0)) {
            shareHashes[msg.sender][contactIndex][0] = hashK1;
            emit ShareHashSet(msg.sender, contactIndex, 0, hashK1);
        }
        if (hashK2 != bytes32(0)) {
            shareHashes[msg.sender][contactIndex][1] = hashK2;
            emit ShareHashSet(msg.sender, contactIndex, 1, hashK2);
        }
        if (hashK3 != bytes32(0)) {
            shareHashes[msg.sender][contactIndex][2] = hashK3;
            emit ShareHashSet(msg.sender, contactIndex, 2, hashK3);
        }
        if (notifHash != bytes32(0)) {
            notificationHashes[msg.sender][contactIndex] = notifHash;
            emit NotificationHashSet(msg.sender, contactIndex, notifHash);
        }
    }

    // ─── Check-in ─────────────────────────────────────────────────────────────

    /**
     * @notice Enregistrer un check-in réussi.
     *         Appelé par le backend après validation du mini-jeu (DEC-33).
     *         La vérification est off-chain — ce call enregistre uniquement le résultat.
     */
    function checkin() external onlyRegistered notTerminal {
        DmsConfig storage cfg = configs[msg.sender];

        // Reprise automatique si la pause est expirée
        if (cfg.status == Status.Paused) {
            if (block.timestamp < cfg.pausedUntil) revert NotActive();
            cfg.status      = Status.Active;
            cfg.pausedUntil = 0;
            emit DmsUnpaused(msg.sender, block.timestamp);
        }

        lastCheckin[msg.sender] = block.timestamp;

        emit CheckinRecorded(
            msg.sender,
            block.timestamp,
            block.timestamp + cfg.checkinFreqSecs
        );
    }

    // ─── Pause ────────────────────────────────────────────────────────────────

    /**
     * @notice Activer le mode pause (mode Voyage).
     *         DEC-22 / BO-05 : maximum 90 jours.
     * @param until  Timestamp Unix de fin de pause.
     */
    function pause(uint64 until) external onlyRegistered {
        DmsConfig storage cfg = configs[msg.sender];
        if (cfg.status != Status.Active) revert NotActive();
        if (until <= block.timestamp) revert PauseInPast();
        if (until > block.timestamp + PAUSE_MAX_SECS) revert PauseExceedsMax();

        cfg.status      = Status.Paused;
        cfg.pausedUntil = until;

        // Reset du compteur silence pendant la pause
        lastCheckin[msg.sender] = block.timestamp;

        emit DmsPaused(msg.sender, until);
    }

    /**
     * @notice Reprendre avant la fin de la pause.
     */
    function unpause() external onlyRegistered {
        DmsConfig storage cfg = configs[msg.sender];
        if (cfg.status != Status.Paused) revert NotPaused();

        cfg.status      = Status.Active;
        cfg.pausedUntil = 0;
        lastCheckin[msg.sender] = block.timestamp;

        emit DmsUnpaused(msg.sender, block.timestamp);
    }

    // ─── Déclenchement ────────────────────────────────────────────────────────

    /**
     * @notice Marquer le DMS comme déclenché.
     *         Appelé par le backend après 3 relances + silence_duration_secs écoulé.
     *         DEC-35 : les relances sont trackées off-chain (BullMQ),
     *                  ce call enregistre le déclenchement on-chain.
     */
    function markTriggered() external onlyRegistered {
        DmsConfig storage cfg = configs[msg.sender];
        if (cfg.status != Status.Active) revert NotActive();

        uint256 silence = block.timestamp - lastCheckin[msg.sender];
        cfg.status = Status.Triggered;

        emit DmsTriggered(msg.sender, block.timestamp, silence);
    }

    /**
     * @notice Marquer la transmission comme complète après confirmation des contacts.
     *         Appelé par le backend après POST /relay/:token/confirm.
     */
    function markCompleted() external onlyRegistered {
        DmsConfig storage cfg = configs[msg.sender];
        if (cfg.status != Status.Triggered) revert NotActive();

        cfg.status = Status.Completed;
        emit DmsCompleted(msg.sender, block.timestamp);
    }

    /**
     * @notice Désactiver le DMS (l'owner arrête Relais).
     */
    function deactivate() external {
        DmsConfig storage cfg = configs[msg.sender];
        if (cfg.status == Status.Completed) revert AlreadyCompleted();

        cfg.status = Status.Inactive;
        emit DmsDeactivated(msg.sender);
    }

    // ─── Vues ─────────────────────────────────────────────────────────────────

    /**
     * @notice Le DMS est-il déclenché ? (audit autonome)
     *         Retourne true si le contrat pense que le silence est écoulé.
     *         Note : le backend suit aussi les relances off-chain (DEC-35).
     */
    function isTriggered(address owner) external view returns (bool) {
        DmsConfig storage cfg = configs[owner];
        if (cfg.status != Status.Active) return false;
        return block.timestamp >= lastCheckin[owner] + cfg.silenceDurationSecs;
    }

    /**
     * @notice Secondes restantes avant déclenchement (0 si déjà dépassé ou pas actif).
     */
    function secondsUntilTrigger(address owner) external view returns (uint256) {
        DmsConfig storage cfg = configs[owner];
        if (cfg.status != Status.Active) return 0;
        uint256 triggerAt = lastCheckin[owner] + cfg.silenceDurationSecs;
        if (block.timestamp >= triggerAt) return 0;
        return triggerAt - block.timestamp;
    }

    /**
     * @notice Récupérer la clé publique Ed25519 complète (32 bytes en deux slots).
     */
    function getEd25519Pk(address owner) external view
        returns (bytes32 high, bytes32 low)
    {
        return (ed25519PkHigh[owner], ed25519PkLow[owner]);
    }

    /**
     * @notice Vue d'ensemble du statut DMS.
     */
    function getStatus(address owner) external view returns (
        Status  status,
        uint256 lastCheckinAt,
        uint256 silenceDurationSecs,
        uint256 triggerAt,
        bool    isPastDue
    ) {
        DmsConfig storage cfg = configs[owner];
        status              = cfg.status;
        lastCheckinAt       = lastCheckin[owner];
        silenceDurationSecs = cfg.silenceDurationSecs;
        triggerAt           = lastCheckin[owner] + cfg.silenceDurationSecs;
        isPastDue           = (cfg.status == Status.Active) &&
                              (block.timestamp >= triggerAt);
    }
}
