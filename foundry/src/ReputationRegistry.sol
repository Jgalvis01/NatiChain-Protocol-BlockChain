// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ReputationRegistry
 * @notice Sistema de Reputación y Red Social para acceso a microcrédito y ahorro comunitario.
 *         Inspirado en "Good Reputation: Expanding Access to Credit Leveraging Reputational
 *         and Social Network Data" (UC Berkeley).
 */
contract ReputationRegistry {
    struct UserReputation {
        uint256 onTimePayments;
        uint256 latePayments;
        uint256 defaults;
        uint256 circlesJoined;
        uint256 circlesCompletedClean;
        uint256 totalSavedVolume;
        uint256 socialEndorsements;
    }

    address public owner;
    address public factory;

    mapping(address => bool) public authorizedCircles;
    mapping(address => UserReputation) private reputations;
    mapping(address => mapping(address => bool)) public hasVouched;

    event CircleAuthorized(address indexed circle);
    event PaymentRecorded(address indexed user, address indexed circle, bool onTime, uint256 amount);
    event DefaultRecorded(address indexed user, address indexed circle, uint256 coveredAmount);
    event CircleCompletionRecorded(address indexed user, address indexed circle, bool cleanRecord);
    event SocialVouchAdded(address indexed voucher, address indexed candidate, uint256 voucherScore);

    error Unauthorized();
    error CannotVouchSelf();
    error AlreadyVouched();
    error LowVoucherReputation();

    constructor() {
        owner = msg.sender;
    }

    modifier onlyAuthorizedCircle() {
        if (!authorizedCircles[msg.sender]) {
            revert Unauthorized();
        }
        _;
    }

    function setFactory(address _factory) external {
        if (msg.sender != owner || factory != address(0) || _factory.code.length == 0) revert Unauthorized();
        factory = _factory;
    }

    function registerCircle(address circle) external {
        if (msg.sender != factory) revert Unauthorized();
        authorizedCircles[circle] = true;
        emit CircleAuthorized(circle);
    }

    /**
     * @notice Permite a un miembro con buena reputación respaldar socialmente a otro (Social Network Data).
     */
    function vouchForMember(address candidate) external {
        if (candidate == msg.sender || candidate == address(0)) revert CannotVouchSelf();
        if (hasVouched[msg.sender][candidate]) revert AlreadyVouched();

        uint256 voucherScore = getReputationScore(msg.sender);
        if (voucherScore < 500 || reputations[msg.sender].circlesCompletedClean == 0) {
            revert LowVoucherReputation();
        }

        hasVouched[msg.sender][candidate] = true;
        reputations[candidate].socialEndorsements += 1;

        emit SocialVouchAdded(msg.sender, candidate, voucherScore);
    }

    function recordJoin(address user) external onlyAuthorizedCircle {
        reputations[user].circlesJoined += 1;
    }

    function recordPayment(address user, bool onTime, uint256 amount) external onlyAuthorizedCircle {
        if (onTime) {
            reputations[user].onTimePayments += 1;
        } else {
            reputations[user].latePayments += 1;
        }
        reputations[user].totalSavedVolume += amount;
        emit PaymentRecorded(user, msg.sender, onTime, amount);
    }

    function recordDefault(address user, uint256 coveredAmount) external onlyAuthorizedCircle {
        reputations[user].defaults += 1;
        emit DefaultRecorded(user, msg.sender, coveredAmount);
    }

    function recordCircleCompletion(address user, bool cleanRecord) external onlyAuthorizedCircle {
        if (cleanRecord) {
            reputations[user].circlesCompletedClean += 1;
        }
        emit CircleCompletionRecorded(user, msg.sender, cleanRecord);
    }

    function getUserStats(address user) external view returns (UserReputation memory) {
        return reputations[user];
    }

    /**
     * @notice Calcula el puntaje crediticio comunitario en escala de 100 a 1000.
     *         Base: 500 pts.
     *         +25 pts por pago puntual | +60 pts por círculo completado limpio | +15 pts por aval social (máx 90)
     *         -40 pts por pago en mora | -150 pts por incumplimiento (default).
     */
    function getReputationScore(address user) public view returns (uint256) {
        UserReputation memory rep = reputations[user];
        uint256 positive = 500 + (rep.onTimePayments * 25) + (rep.circlesCompletedClean * 60);

        uint256 endorsementBonus = rep.socialEndorsements * 15;
        if (endorsementBonus > 90) {
            endorsementBonus = 90;
        }
        positive += endorsementBonus;

        uint256 negative = (rep.latePayments * 40) + (rep.defaults * 150);

        if (negative >= positive || positive - negative < 100) {
            return 100;
        }
        uint256 finalScore = positive - negative;
        if (finalScore > 1000) {
            return 1000;
        }
        return finalScore;
    }
}
