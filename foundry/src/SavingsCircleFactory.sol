// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SavingsCircle} from "./SavingsCircle.sol";
import {ReputationRegistry} from "./ReputationRegistry.sol";

/**
 * @title SavingsCircleFactory
 * @notice Fábrica descentralizada para crear y descubrir Círculos de Ahorro Comunitario paramétricos.
 */
contract SavingsCircleFactory {
    struct CircleCard {
        address circleAddress;
        address creator;
        string name;
        SavingsCircle.PayoutMode payoutMode;
        SavingsCircle.CircleState state;
        uint256 contributionAmount;
        uint256 collateralAmount;
        uint256 maxParticipants;
        uint256 currentParticipants;
        uint256 currentRound;
        uint256 roundDuration;
        uint256 yieldRateBps;
        uint256 latePenaltyBps;
        uint256 vaultLockedPrincipal;
        uint256 totalYieldGenerated;
        uint256 totalPenaltiesCollected;
    }

    address public immutable stablecoin;
    address public immutable yieldVault;
    ReputationRegistry public immutable reputationRegistry;
    address public immutable randomnessProvider;
    mapping(address => bool) public isCircle;

    address[] public allCircles;

    event CircleCreated(
        address indexed circleAddress,
        address indexed creator,
        string name,
        SavingsCircle.PayoutMode payoutMode,
        uint256 contributionAmount,
        uint256 maxParticipants
    );

    constructor(address _stablecoin, address _yieldVault, address _reputationRegistry, address _randomnessProvider) {
        stablecoin = _stablecoin;
        yieldVault = _yieldVault;
        reputationRegistry = ReputationRegistry(_reputationRegistry);
        randomnessProvider = _randomnessProvider;
    }

    /**
     * @notice Crea un nuevo círculo de ahorro comunitario con reglas paramétricas personalizadas.
     */
    function createCircle(SavingsCircle.CircleParams calldata params) external returns (address circleAddress) {
        SavingsCircle newCircle = new SavingsCircle(
            stablecoin, yieldVault, address(reputationRegistry), msg.sender, randomnessProvider, params
        );

        circleAddress = address(newCircle);
        isCircle[circleAddress] = true;
        allCircles.push(circleAddress);
        reputationRegistry.registerCircle(circleAddress);

        emit CircleCreated(
            circleAddress, msg.sender, params.name, params.payoutMode, params.contributionAmount, params.maxParticipants
        );
    }

    function getCirclesCount() external view returns (uint256) {
        return allCircles.length;
    }

    function getAllCircles() external view returns (address[] memory) {
        return allCircles;
    }

    /**
     * @notice Devuelve el resumen de todos los círculos desplegados para mostrarlos en el catálogo de la DApp.
     */
    function getAllCircleCards() external view returns (CircleCard[] memory cards) {
        uint256 count = allCircles.length;
        cards = new CircleCard[](count);

        for (uint256 i = 0; i < count; i++) {
            SavingsCircle circle = SavingsCircle(allCircles[i]);
            (
                SavingsCircle.CircleParams memory p,
                SavingsCircle.CircleState st,
                uint256 curRound,,
                uint256 pCount,
                uint256 locked,
                uint256 yieldGen,
                uint256 penaltiesGen,,
            ) = circle.getCircleOverview();

            cards[i] = CircleCard({
                circleAddress: allCircles[i],
                creator: circle.creator(),
                name: p.name,
                payoutMode: p.payoutMode,
                state: st,
                contributionAmount: p.contributionAmount,
                collateralAmount: p.collateralAmount,
                maxParticipants: p.maxParticipants,
                currentParticipants: pCount,
                currentRound: curRound,
                roundDuration: p.roundDuration,
                yieldRateBps: p.yieldRateBps,
                latePenaltyBps: p.latePenaltyBps,
                vaultLockedPrincipal: locked,
                totalYieldGenerated: yieldGen,
                totalPenaltiesCollected: penaltiesGen
            });
        }
    }
}
