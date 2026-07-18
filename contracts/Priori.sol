// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Priori — onchain pre-registration for quantitative strategy predictions
/// @notice Solves hindsight bias in research: you commit a hash of your hypothesis
///         BEFORE the evaluation window opens, and can only reveal it after the
///         window closes. The chain supplies the one thing a local database cannot —
///         a timestamp you cannot forge, even against yourself.
contract Priori {
    struct Prediction {
        bytes32 commitHash; // keccak256(abi.encode(plaintext, salt))
        uint64 sealedAt;
        uint64 evaluateAfter; // strictly in the future at seal time
        uint64 revealedAt; // 0 while unrevealed
        bool hit; // did the realized metric meet the stated threshold
        int32 metricBps; // realized metric, signed basis points
        string label; // public, non-revealing tag e.g. "BTC 20d momentum"
        string plaintext; // empty until revealed
    }

    mapping(address => Prediction[]) private _predictions;
    address[] private _authors;
    mapping(address => bool) private _known;

    event Sealed(
        address indexed author,
        uint256 indexed id,
        bytes32 commitHash,
        uint64 evaluateAfter,
        string label
    );
    event Revealed(
        address indexed author,
        uint256 indexed id,
        string plaintext,
        bool hit,
        int32 metricBps
    );

    error EvaluationMustBeFuture();
    error TooEarlyToReveal();
    error AlreadyRevealed();
    error HashMismatch();
    error NoSuchPrediction();
    error EmptyLabel();

    /// @notice Commit to a hypothesis. Only the hash goes onchain; the plaintext
    ///         stays with you until the evaluation window closes.
    /// @param commitHash keccak256(abi.encode(plaintext, salt))
    /// @param evaluateAfter unix ts when the forward window closes; must be > now
    /// @param label short public tag that does not give away the hypothesis
    function seal(
        bytes32 commitHash,
        uint64 evaluateAfter,
        string calldata label
    ) external returns (uint256 id) {
        if (evaluateAfter <= block.timestamp) revert EvaluationMustBeFuture();
        if (bytes(label).length == 0) revert EmptyLabel();

        if (!_known[msg.sender]) {
            _known[msg.sender] = true;
            _authors.push(msg.sender);
        }

        id = _predictions[msg.sender].length;
        _predictions[msg.sender].push(
            Prediction({
                commitHash: commitHash,
                sealedAt: uint64(block.timestamp),
                evaluateAfter: evaluateAfter,
                revealedAt: 0,
                hit: false,
                metricBps: 0,
                label: label,
                plaintext: ""
            })
        );

        emit Sealed(msg.sender, id, commitHash, evaluateAfter, label);
    }

    /// @notice Reveal the hypothesis after the window closes. The contract proves
    ///         the plaintext matches what you sealed — you cannot retrofit it.
    function reveal(
        uint256 id,
        string calldata plaintext,
        bytes32 salt,
        bool hit,
        int32 metricBps
    ) external {
        Prediction[] storage list = _predictions[msg.sender];
        if (id >= list.length) revert NoSuchPrediction();

        Prediction storage p = list[id];
        if (p.revealedAt != 0) revert AlreadyRevealed();
        if (block.timestamp < p.evaluateAfter) revert TooEarlyToReveal();
        if (keccak256(abi.encode(plaintext, salt)) != p.commitHash) revert HashMismatch();

        p.plaintext = plaintext;
        p.hit = hit;
        p.metricBps = metricBps;
        p.revealedAt = uint64(block.timestamp);

        emit Revealed(msg.sender, id, plaintext, hit, metricBps);
    }

    // --------------------------------------------------------------------- //
    // views
    // --------------------------------------------------------------------- //

    function count(address author) external view returns (uint256) {
        return _predictions[author].length;
    }

    function get(address author, uint256 id) external view returns (Prediction memory) {
        if (id >= _predictions[author].length) revert NoSuchPrediction();
        return _predictions[author][id];
    }

    function listAll(address author) external view returns (Prediction[] memory) {
        return _predictions[author];
    }

    function authors() external view returns (address[] memory) {
        return _authors;
    }

    /// @notice Track record. `abandoned` is the file-drawer count: windows that
    ///         closed without a reveal — you cannot quietly bury a losing call.
    function stats(
        address author
    )
        external
        view
        returns (uint256 total, uint256 revealed, uint256 hits, uint256 abandoned, uint256 pending)
    {
        Prediction[] storage list = _predictions[author];
        total = list.length;
        for (uint256 i = 0; i < total; i++) {
            Prediction storage p = list[i];
            if (p.revealedAt != 0) {
                revealed++;
                if (p.hit) hits++;
            } else if (block.timestamp >= p.evaluateAfter) {
                abandoned++;
            } else {
                pending++;
            }
        }
    }
}
