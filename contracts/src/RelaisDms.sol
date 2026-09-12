// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @title RelaisDms — minuteur public, registre d'intégrité et annuaire de pointeurs
/// @notice Chemin de secours de Relais : quand une personne a cessé de donner signe de vie,
///         n'importe qui peut le constater et le déclarer. Le contrat ne détient aucun secret.
///         L'opérateur (Relais) envoie les transactions ; chaque écriture qui engage l'owner porte
///         sa signature Ed25519, publiée dans l'événement et vérifiable par tous hors chaîne
///         (docs/smart-contract-v2.md, D1). L'identité on-chain est `keccak256(ed25519_pk)`.
contract RelaisDms {
    enum Status {
        Inactive,
        Active,
        Paused,
        Triggered,
        Completed
    }

    struct Dms {
        Status status;
        uint8 n; // parts nécessaires
        uint8 m; // contacts
        uint32 silenceSecs;
        uint32 checkinFreqSecs;
        uint64 nextCheckinDue; // aligné au jour, strictement croissant
        uint64 pausedUntil; // 0 hors pause
        uint64 triggeredAt;
        bytes32 ed25519Pk;
    }

    uint64 internal constant DAY = 1 days;
    uint32 internal constant MIN_SILENCE = 30 days;
    uint64 internal constant MAX_PAUSE = 365 days;
    uint256 internal constant SIGNATURE_LENGTH = 64;

    address public operator;
    address public pendingOperator;
    mapping(bytes32 subject => Dms) internal _dms;
    mapping(bytes32 subject => bytes32[]) internal _packCids;
    mapping(bytes32 subject => bytes32) internal _vaultCid;
    mapping(bytes32 subject => bytes32[]) internal _shareHashes;

    event Registered(
        bytes32 indexed subject,
        bytes32 ed25519Pk,
        uint8 n,
        uint8 m,
        uint32 silenceSecs,
        uint32 checkinFreqSecs,
        uint64 nextCheckinDue,
        bytes ownerSig
    );
    event CheckedIn(bytes32 indexed subject, uint64 nextCheckinDue, bytes ownerSig);
    event Paused(bytes32 indexed subject, uint64 pausedUntil, bytes ownerSig);
    event Resumed(bytes32 indexed subject, uint64 nextCheckinDue, bytes ownerSig);
    event Triggered(bytes32 indexed subject, uint64 at, address by);
    event TriggerCancelled(bytes32 indexed subject, uint64 nextCheckinDue, bytes ownerSig);
    event Completed(bytes32 indexed subject);
    event Deactivated(bytes32 indexed subject, bytes ownerSig);
    event Pointers(bytes32 indexed subject, bytes32[] packCids, bytes32 vaultCid);
    event ShareHashes(bytes32 indexed subject, bytes32[] siEncHashes);
    event OperatorProposed(address indexed next);
    event OperatorAccepted(address indexed next);

    error ZeroAddress();
    error NotOperator();
    error NotPendingOperator();
    error SubjectMismatch();
    error BadStatus();
    error BadThreshold();
    error BadDuration();
    error BadDueDate();
    error BadPauseDate();
    error BadSignature();
    error NotTriggerable();

    modifier onlyOperator() {
        _onlyOperator();
        _;
    }

    function _onlyOperator() internal view {
        if (msg.sender != operator) revert NotOperator();
    }

    constructor(address operator_) {
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
    }

    // ------------------------------------------------------------------ opérateur

    function proposeOperator(address next) external onlyOperator {
        pendingOperator = next;
        emit OperatorProposed(next);
    }

    function acceptOperator() external {
        if (msg.sender != pendingOperator || msg.sender == address(0)) revert NotPendingOperator();
        operator = msg.sender;
        pendingOperator = address(0);
        emit OperatorAccepted(msg.sender);
    }

    // ------------------------------------------------------------------ écritures signées par l'owner

    function register(
        bytes32 subject,
        bytes32 ed25519Pk,
        uint8 n,
        uint8 m,
        uint32 silenceSecs,
        uint32 checkinFreqSecs,
        uint64 nextDue,
        bytes calldata ownerSig
    ) external onlyOperator {
        if (keccak256(abi.encodePacked(ed25519Pk)) != subject) {
            revert SubjectMismatch();
        }
        Dms storage d = _dms[subject];
        if (d.status != Status.Inactive && d.status != Status.Completed) revert BadStatus();
        if (n < 2 || m < n) revert BadThreshold();
        if (checkinFreqSecs == 0 || silenceSecs < MIN_SILENCE) revert BadDuration();
        _checkDueDate(d, nextDue);
        _checkSignature(ownerSig);

        d.status = Status.Active;
        d.n = n;
        d.m = m;
        d.silenceSecs = silenceSecs;
        d.checkinFreqSecs = checkinFreqSecs;
        d.nextCheckinDue = nextDue;
        d.pausedUntil = 0;
        d.triggeredAt = 0;
        d.ed25519Pk = ed25519Pk;
        emit Registered(subject, ed25519Pk, n, m, silenceSecs, checkinFreqSecs, nextDue, ownerSig);
    }

    /// Un check-in réussi avance l'échéance ; pendant une pause il vaut reprise.
    function checkin(bytes32 subject, uint64 nextDue, bytes calldata ownerSig)
        external
        onlyOperator
    {
        Dms storage d = _dms[subject];
        if (d.status != Status.Active && d.status != Status.Paused) revert BadStatus();
        _checkDueDate(d, nextDue);
        _checkSignature(ownerSig);
        d.status = Status.Active;
        d.pausedUntil = 0;
        d.nextCheckinDue = nextDue;
        emit CheckedIn(subject, nextDue, ownerSig);
    }

    /// La pause expire d'elle-même (D3) : passé `until`, l'échéance devient `until + freq`.
    function pause(bytes32 subject, uint64 until, bytes calldata ownerSig) external onlyOperator {
        Dms storage d = _dms[subject];
        if (d.status != Status.Active) revert BadStatus();
        if (until % DAY != 0 || until <= block.timestamp || until > block.timestamp + MAX_PAUSE) {
            revert BadPauseDate();
        }
        _checkSignature(ownerSig);
        d.status = Status.Paused;
        d.pausedUntil = until;
        emit Paused(subject, until, ownerSig);
    }

    function resume(bytes32 subject, uint64 nextDue, bytes calldata ownerSig)
        external
        onlyOperator
    {
        Dms storage d = _dms[subject];
        if (d.status != Status.Paused) revert BadStatus();
        _checkDueDate(d, nextDue);
        _checkSignature(ownerSig);
        d.status = Status.Active;
        d.pausedUntil = 0;
        d.nextCheckinDue = nextDue;
        emit Resumed(subject, nextDue, ownerSig);
    }

    /// L'owner est vivant : l'opérateur relaie sa signature, le cycle repart (D4).
    function cancelTrigger(bytes32 subject, uint64 nextDue, bytes calldata ownerSig)
        external
        onlyOperator
    {
        Dms storage d = _dms[subject];
        if (d.status != Status.Triggered) revert BadStatus();
        _checkDueDate(d, nextDue);
        _checkSignature(ownerSig);
        d.status = Status.Active;
        d.triggeredAt = 0;
        d.nextCheckinDue = nextDue;
        emit TriggerCancelled(subject, nextDue, ownerSig);
    }

    /// Retour à Inactive depuis tout état vivant ; les pointeurs sont effacés, l'échéance
    /// est conservée pour que la monotonie survive à un nouvel enregistrement.
    function deactivate(bytes32 subject, bytes calldata ownerSig) external onlyOperator {
        Dms storage d = _dms[subject];
        if (d.status == Status.Inactive || d.status == Status.Completed) revert BadStatus();
        _checkSignature(ownerSig);
        d.status = Status.Inactive;
        d.pausedUntil = 0;
        d.triggeredAt = 0;
        _clearPointers(subject);
        emit Deactivated(subject, ownerSig);
    }

    // ------------------------------------------------------------------ écritures de l'opérateur seul

    /// CID (digest sha2-256 d'un CIDv1 raw) des packs de relais, au plus un par contact, et du coffre.
    /// Permis en Active ou Paused seulement : une fois déclenché, rien de ce qui décrit les blobs
    /// ne bouge plus.
    function setPointers(bytes32 subject, bytes32[] calldata packCids, bytes32 vaultCid)
        external
        onlyOperator
    {
        Dms storage d = _dms[subject];
        _requireLiveAndNotTriggered(d);
        if (packCids.length > d.m) revert BadThreshold();
        _packCids[subject] = packCids;
        _vaultCid[subject] = vaultCid;
        emit Pointers(subject, packCids, vaultCid);
    }

    /// Hachés des parts chiffrées, exactement un par contact (DEC-10, intégrité).
    function setShareHashes(bytes32 subject, bytes32[] calldata siEncHashes) external onlyOperator {
        Dms storage d = _dms[subject];
        _requireLiveAndNotTriggered(d);
        if (siEncHashes.length != d.m) revert BadThreshold();
        _shareHashes[subject] = siEncHashes;
        emit ShareHashes(subject, siEncHashes);
    }

    /// Après la purge chez Relais ; `Completed` n'est pas terminal, `register` reste permis.
    function complete(bytes32 subject) external onlyOperator {
        Dms storage d = _dms[subject];
        if (d.status != Status.Triggered) revert BadStatus();
        d.status = Status.Completed;
        _clearPointers(subject);
        emit Completed(subject);
    }

    // ------------------------------------------------------------------ sans permission

    /// N'importe qui, dès que `triggerable` est vrai : un contact, un tiers, Relais elle-même.
    function trigger(bytes32 subject) external {
        if (!triggerable(subject)) revert NotTriggerable();
        Dms storage d = _dms[subject];
        d.status = Status.Triggered;
        d.pausedUntil = 0;
        d.triggeredAt = uint64(block.timestamp);
        emit Triggered(subject, uint64(block.timestamp), msg.sender);
    }

    // ------------------------------------------------------------------ vues

    function get(bytes32 subject) external view returns (Dms memory) {
        return _dms[subject];
    }

    function pointers(bytes32 subject)
        external
        view
        returns (bytes32[] memory packCids, bytes32 vaultCid)
    {
        return (_packCids[subject], _vaultCid[subject]);
    }

    function shareHashes(bytes32 subject) external view returns (bytes32[] memory) {
        return _shareHashes[subject];
    }

    /// Vrai dès que le silence a couru depuis l'échéance (D2), pause expirée comprise (D3).
    function triggerable(bytes32 subject) public view returns (bool) {
        return secondsUntilTriggerable(subject) == 0;
    }

    /// 0 si déclenchable ; `type(uint256).max` si le minuteur ne court pas.
    function secondsUntilTriggerable(bytes32 subject) public view returns (uint256) {
        Dms storage d = _dms[subject];
        if (d.status != Status.Active && d.status != Status.Paused) return type(uint256).max;
        uint256 at = _deadline(d) + d.silenceSecs;
        return at <= block.timestamp ? 0 : at - block.timestamp;
    }

    // ------------------------------------------------------------------ internes

    /// L'échéance courante : celle posée au dernier check-in, ou la fin de pause plus une période.
    function _deadline(Dms storage d) internal view returns (uint256) {
        if (d.status == Status.Paused) return uint256(d.pausedUntil) + d.checkinFreqSecs;
        return d.nextCheckinDue;
    }

    /// Une échéance est alignée au jour, dans le futur, et ne recule jamais.
    function _checkDueDate(Dms storage d, uint64 nextDue) internal view {
        if (nextDue % DAY != 0 || nextDue <= block.timestamp || nextDue <= d.nextCheckinDue) {
            revert BadDueDate();
        }
    }

    function _requireLiveAndNotTriggered(Dms storage d) internal view {
        if (d.status != Status.Active && d.status != Status.Paused) revert BadStatus();
    }

    function _clearPointers(bytes32 subject) internal {
        delete _packCids[subject];
        delete _vaultCid[subject];
        delete _shareHashes[subject];
    }

    function _checkSignature(bytes calldata ownerSig) internal pure {
        if (ownerSig.length != SIGNATURE_LENGTH) revert BadSignature();
    }
}
