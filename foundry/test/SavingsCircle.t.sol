// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockStablecoin} from "../src/MockStablecoin.sol";
import {MockYieldVault} from "../src/MockYieldVault.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";
import {SavingsCircle} from "../src/SavingsCircle.sol";
import {SavingsCircleFactory} from "../src/SavingsCircleFactory.sol";
import {MockRandomnessProvider} from "../src/MockRandomnessProvider.sol";

interface Vm {
    function prank(address msgSender) external;
    function startPrank(address msgSender) external;
    function stopPrank() external;
    function warp(uint256 newTimestamp) external;
    function chainId(uint256 chainId) external;
    function expectRevert(bytes4 revertData) external;
}

contract SavingsCircleTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockStablecoin public stablecoin;
    MockYieldVault public yieldVault;
    ReputationRegistry public reputation;
    SavingsCircleFactory public factory;
    MockRandomnessProvider public randomness;

    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);
    address public carol = address(0xCA201);

    uint256 constant CONTRIBUTION = 100e18; // 100 cUSD
    uint256 constant COLLATERAL = 330e18; // 3 * (100 cuota + 10 multa)
    uint256 constant ROUND_DURATION = 7 days;
    uint256 constant GRACE_PERIOD = 3 days;
    uint256 constant LATE_PENALTY_BPS = 1000; // 10% multa por mora
    uint256 constant YIELD_RATE_BPS = 200; // 2% rendimiento base por ronda

    function setUp() public virtual {
        stablecoin = new MockStablecoin();
        yieldVault = new MockYieldVault(address(stablecoin));
        reputation = new ReputationRegistry();
        randomness = new MockRandomnessProvider();
        factory = new SavingsCircleFactory(
            address(stablecoin), address(yieldVault), address(reputation), address(randomness)
        );

        stablecoin.setAuthorizedMinter(address(yieldVault), true);
        reputation.setFactory(address(factory));

        // Fondear a Alice, Bob y Carol con 1,000 cUSD cada uno
        stablecoin.faucet(alice, 1_000e18);
        stablecoin.faucet(bob, 1_000e18);
        stablecoin.faucet(carol, 1_000e18);
    }

    function _createDefaultCircle(SavingsCircle.PayoutMode mode) internal returns (SavingsCircle) {
        SavingsCircle.CircleParams memory params = SavingsCircle.CircleParams({
            name: mode == SavingsCircle.PayoutMode.ROSCA ? "Cadena Emprendedores" : "Natillera Navidena",
            contributionAmount: CONTRIBUTION,
            collateralAmount: COLLATERAL,
            maxParticipants: 3,
            roundDuration: ROUND_DURATION,
            gracePeriod: GRACE_PERIOD,
            latePenaltyBps: LATE_PENALTY_BPS,
            yieldRateBps: YIELD_RATE_BPS,
            payoutMode: mode
        });

        address circleAddr = factory.createCircle(params);
        return SavingsCircle(circleAddr);
    }

    function _joinAllThree(SavingsCircle circle) internal virtual {
        vm.startPrank(alice);
        stablecoin.approve(address(circle), type(uint256).max);
        circle.joinCircle();
        vm.stopPrank();

        vm.startPrank(bob);
        stablecoin.approve(address(circle), type(uint256).max);
        circle.joinCircle();
        vm.stopPrank();

        vm.startPrank(carol);
        stablecoin.approve(address(circle), type(uint256).max);
        circle.joinCircle();
        vm.stopPrank();

        assert(circle.state() == SavingsCircle.CircleState.DRAW_PENDING);
        assert(circle.currentRound() == 0);
        randomness.fulfill(circle.drawRequestId(), 123456);
        circle.finalizeDraw();
    }

    function test_CreateJoinAndVerifiableDraw() public {
        SavingsCircle circle = _createDefaultCircle(SavingsCircle.PayoutMode.ROSCA);
        _joinAllThree(circle);

        // El círculo debe estar ACTIVE en la ronda 1 y con semilla verificable generada
        assert(circle.state() == SavingsCircle.CircleState.ACTIVE);
        assert(circle.currentRound() == 1);
        assert(circle.verifiableSeed() != bytes32(0));

        // Garantía suficiente para todas las cuotas y multas posibles del ciclo.
        assert(yieldVault.principalBalance(address(circle)) == 3 * COLLATERAL);

        // Verificar que los 3 participantes tengan turnos únicos del 1 al 3
        address[] memory order = circle.getTurnOrder();
        assert(order.length == 3);
        uint256 sumTurns = 0;
        for (uint256 i = 0; i < 3; i++) {
            (,,,,,,,,, uint256 assignedTurn) = circle.participantData(order[i]);
            assert(assignedTurn == i + 1);
            sumTurns += assignedTurn;
        }
        assert(sumTurns == 6); // 1 + 2 + 3
    }

    function test_FullROSCACycleWithYield() public {
        SavingsCircle circle = _createDefaultCircle(SavingsCircle.PayoutMode.ROSCA);
        _joinAllThree(circle);

        address[] memory order = circle.getTurnOrder();

        // Ejecutar las 3 rondas con pagos 100% puntuales
        for (uint256 r = 1; r <= 3; r++) {
            address expectedBeneficiary = order[r - 1];

            vm.prank(alice);
            circle.payContribution();
            vm.prank(bob);
            circle.payContribution();
            vm.prank(carol);
            circle.payContribution();

            uint256 balanceBeforeTurn = stablecoin.balanceOf(expectedBeneficiary);
            circle.settleCurrentRound();

            if (r < 3) {
                // En las rondas 1 y 2, el beneficiario recibe exactamente el pozo de 300 cUSD al liquidar la ronda
                uint256 balanceAfterTurn = stablecoin.balanceOf(expectedBeneficiary);
                assert(balanceAfterTurn - balanceBeforeTurn == 300e18);
            }
        }

        // Al terminar la ronda 3, el estado es COMPLETED
        assert(circle.state() == SavingsCircle.CircleState.COMPLETED);

        // 2% de (990 de garantía + 300 de cuota), durante tres rondas.
        assert(circle.totalYieldGenerated() == 77.4e18);
        assert(stablecoin.balanceOf(alice) == 1_025.8e18);
        assert(stablecoin.balanceOf(bob) == 1_025.8e18);
        assert(stablecoin.balanceOf(carol) == 1_025.8e18);
    }

    function test_LatePaymentPenaltyDistributedToPunctualMembers() public {
        SavingsCircle circle = _createDefaultCircle(SavingsCircle.PayoutMode.ROSCA);
        _joinAllThree(circle);

        // Ronda 1: Alice y Bob pagan puntual; Carol paga en ventana de mora (con multa de 10 cUSD)
        vm.prank(alice);
        circle.payContribution();
        vm.prank(bob);
        circle.payContribution();

        // Avanzar el tiempo más allá del gracePeriod (3 días + 1 hora)
        vm.warp(circle.currentRoundStart() + GRACE_PERIOD + 1 hours);

        vm.prank(carol);
        circle.payContribution();

        circle.settleCurrentRound();

        // Rondas 2 y 3: Todos pagan puntual
        for (uint256 r = 2; r <= 3; r++) {
            vm.prank(alice);
            circle.payContribution();
            vm.prank(bob);
            circle.payContribution();
            vm.prank(carol);
            circle.payContribution();
            circle.settleCurrentRound();
        }

        // Alice y Bob tienen 3 onTimeShares cada uno; Carol tiene 2 onTimeShares (total = 8 shares)
        // Carol pagó 10 cUSD de multa y recibe menos proporción del pozo de premios
        assert(circle.totalPenaltiesCollected() == 10e18);
        assert(stablecoin.balanceOf(alice) > stablecoin.balanceOf(carol));
        assert(stablecoin.balanceOf(bob) == stablecoin.balanceOf(alice));

        // Además, el score de reputación de Alice es mayor que el de Carol
        assert(reputation.getReputationScore(alice) > reputation.getReputationScore(carol));
    }

    function test_DefaultCoveredByCollateralProtectsBeneficiary() public {
        SavingsCircle circle = _createDefaultCircle(SavingsCircle.PayoutMode.ROSCA);
        _joinAllThree(circle);

        // Ronda 1: Todos pagan puntual
        vm.prank(alice);
        circle.payContribution();
        vm.prank(bob);
        circle.payContribution();
        vm.prank(carol);
        circle.payContribution();
        circle.settleCurrentRound();

        // Ronda 2: Alice y Bob pagan puntual, pero Carol NO paga (incumple)
        vm.prank(alice);
        circle.payContribution();
        vm.prank(bob);
        circle.payContribution();

        // Avanzar el tiempo hasta el vencimiento de la Ronda 2
        vm.warp(circle.currentRoundStart() + ROUND_DURATION + 1);

        address round2Beneficiary = circle.getTurnOrder()[1];
        uint256 beneficiaryBalBefore = stablecoin.balanceOf(round2Beneficiary);

        // Liquidar ronda: la garantía cubre automáticamente cuota (100) + multa (10).
        circle.settleCurrentRound();

        uint256 beneficiaryBalAfter = stablecoin.balanceOf(round2Beneficiary);
        // El beneficiario del Turno 2 recibe sus 300 cUSD completos sin verse afectado por el incumplimiento de Carol
        assert(beneficiaryBalAfter - beneficiaryBalBefore == 300e18);

        // La garantía restante conserva cobertura de las rondas pendientes.
        (,, uint256 carolCollateral,,,, uint256 carolDefaults,,,) = circle.participantData(carol);
        assert(carolCollateral == COLLATERAL - 110e18);
        assert(carolDefaults == 1);
    }

    function test_FullASCACycleWithAccumulatedYield() public {
        SavingsCircle circle = _createDefaultCircle(SavingsCircle.PayoutMode.ASCA);
        _joinAllThree(circle);

        // En modo Natillera (ASCA), los fondos no se retiran en cada ronda sino que se acumulan hasta el cierre
        for (uint256 r = 1; r <= 3; r++) {
            vm.prank(alice);
            circle.payContribution();
            vm.prank(bob);
            circle.payContribution();
            vm.prank(carol);
            circle.payContribution();
            circle.settleCurrentRound();

            if (r < 3) {
                assert(yieldVault.principalBalance(address(circle)) == 3 * COLLATERAL + (r * 300e18));
            }
        }

        assert(circle.state() == SavingsCircle.CircleState.COMPLETED);
        // Rendimiento sobre principal acumulado; los intereses no se reinvierten.
        assert(circle.totalYieldGenerated() == 95.4e18);
        assert(stablecoin.balanceOf(alice) == 1_031.8e18);
        assert(stablecoin.balanceOf(bob) == 1_031.8e18);
        assert(stablecoin.balanceOf(carol) == 1_031.8e18);
    }

    function test_ReputationAndSocialVouching() public {
        SavingsCircle circle = _createDefaultCircle(SavingsCircle.PayoutMode.ROSCA);
        _joinAllThree(circle);
        for (uint256 r = 0; r < 3; r++) {
            vm.prank(alice);
            circle.payContribution();
            vm.prank(bob);
            circle.payContribution();
            vm.prank(carol);
            circle.payContribution();
            circle.settleCurrentRound();
        }
        uint256 baseScore = reputation.getReputationScore(carol);

        // Alice y Bob respaldan socialmente a Carol
        vm.prank(alice);
        reputation.vouchForMember(carol);
        vm.prank(bob);
        reputation.vouchForMember(carol);

        uint256 newScore = reputation.getReputationScore(carol);
        assert(newScore == baseScore + 30); // +15 por aval de un miembro con historial
    }
}
