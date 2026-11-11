// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {SavingsCircleTest} from "./SavingsCircle.t.sol";
import {SavingsCircle} from "../src/SavingsCircle.sol";
import {SavingsCircleFactory} from "../src/SavingsCircleFactory.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";
import {VRFRandomnessProvider} from "../src/VRFRandomnessProvider.sol";
import {MockRandomnessProvider} from "../src/MockRandomnessProvider.sol";
import {VRFV2PlusClient} from "../lib/chainlink/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

interface IVRFCallback {
    function rawFulfillRandomWords(uint256 id, uint256[] calldata words) external;
}

// Authenticated coordinator test double, not a cryptographic VRF verifier.
contract TestVRFCoordinator {
    uint256 public nextId = 1;
    uint16 public requestedConfirmations;

    function requestRandomWords(VRFV2PlusClient.RandomWordsRequest calldata req) external returns (uint256) {
        requestedConfirmations = req.requestConfirmations;
        return nextId++;
    }

    function deliver(address consumer, uint256 id, uint256 word) external {
        uint256[] memory words = new uint256[](1);
        words[0] = word;
        IVRFCallback(consumer).rawFulfillRandomWords(id, words);
    }
}

contract JoinAndInspectAttack {
    function commit(SavingsCircle circle) external {
        circle.stablecoin().approve(address(circle), type(uint256).max);
        circle.joinCircle();
    }

    function joinOnlyIfFirst(SavingsCircle circle) external {
        circle.stablecoin().approve(address(circle), type(uint256).max);
        circle.joinCircle();
        address[] memory order = circle.getTurnOrder();
        require(order.length > 0 && order[0] == address(this), "No known favorable result");
    }
}

// Runs the original economic regressions against the production VRF adapter too.
contract SavingsCircleSecurityTest is SavingsCircleTest {
    TestVRFCoordinator coordinator;
    VRFRandomnessProvider provider;

    function setUp() public override {
        super.setUp();
        coordinator = new TestVRFCoordinator();
        provider = new VRFRandomnessProvider(address(coordinator), 1, bytes32(uint256(1)), 3, 200_000, false);
        reputation = new ReputationRegistry();
        factory =
            new SavingsCircleFactory(address(stablecoin), address(yieldVault), address(reputation), address(provider));
        reputation.setFactory(address(factory));
        provider.setFactory(address(factory));
    }

    function _join(SavingsCircle c, address member) internal {
        vm.startPrank(member);
        stablecoin.approve(address(c), type(uint256).max);
        c.joinCircle();
        vm.stopPrank();
    }

    function _pending() internal returns (SavingsCircle c) {
        c = _createDefaultCircle(SavingsCircle.PayoutMode.ROSCA);
        _join(c, alice);
        _join(c, bob);
        _join(c, carol);
    }

    function _joinAllThree(SavingsCircle c) internal override {
        _join(c, alice);
        _join(c, bob);
        _join(c, carol);
        assert(c.state() == SavingsCircle.CircleState.DRAW_PENDING && c.currentRound() == 0);
        coordinator.deliver(address(provider), c.drawRequestId(), 123456);
        c.finalizeDraw();
    }

    function _params(SavingsCircle c) internal view returns (SavingsCircle.CircleParams memory p) {
        (p,,,,,,,,,) = c.getCircleOverview();
    }

    function test_LastJoinCannotInspectOrChooseResult() public {
        SavingsCircle c = _createDefaultCircle(SavingsCircle.PayoutMode.ROSCA);
        _join(c, alice);
        _join(c, bob);
        JoinAndInspectAttack attacker = new JoinAndInspectAttack();
        stablecoin.faucet(address(attacker), 1_000e18);
        (bool success,) = address(attacker).call(abi.encodeCall(attacker.joinOnlyIfFirst, (c)));
        assert(!success && c.getParticipants().length == 2);
        attacker.commit(c);
        assert(c.getParticipants().length == 3 && c.getTurnOrder().length == 0);
        assert(c.verifiableSeed() == bytes32(0) && c.state() == SavingsCircle.CircleState.DRAW_PENDING);
    }

    function test_PendingCannotPayFinalizeEarlyJoinCancelOrResort() public {
        SavingsCircle c = _pending();
        vm.expectRevert(SavingsCircle.RandomnessNotReady.selector);
        c.finalizeDraw();
        vm.expectRevert(SavingsCircle.CircleNotActive.selector);
        c.payContribution();
        vm.expectRevert(SavingsCircle.CircleNotActive.selector);
        c.settleCurrentRound();
        vm.expectRevert(SavingsCircle.CircleNotOpen.selector);
        c.joinCircle();
        vm.warp(c.registrationDeadline() + 1);
        vm.expectRevert(SavingsCircle.CannotCancel.selector);
        c.cancelUnfilledCircle();
        bytes32 commitment = c.drawCommitment();
        vm.prank(address(c));
        vm.expectRevert(VRFRandomnessProvider.UnauthorizedRequest.selector);
        provider.requestRandomness(commitment);
    }

    function test_UnknownCallerCannotRequestOrFulfill() public {
        SavingsCircle c = _pending();
        uint256[] memory words = new uint256[](1);
        (bool success,) =
            address(provider).call(abi.encodeCall(provider.rawFulfillRandomWords, (c.drawRequestId(), words)));
        assert(!success);
        vm.expectRevert(VRFRandomnessProvider.UnauthorizedRequest.selector);
        provider.requestRandomness(bytes32(0));
        (bool ready,) = provider.getRandomness(c.drawRequestId());
        assert(!ready);
        assert(coordinator.requestedConfirmations() == 3);
    }

    function test_ZeroWordValidAndDuplicateCannotReplaceIt() public {
        SavingsCircle c = _pending();
        coordinator.deliver(address(provider), c.drawRequestId(), 0);
        coordinator.deliver(address(provider), c.drawRequestId(), 999);
        (bool ready, uint256 word) = provider.getRandomness(c.drawRequestId());
        assert(ready && word == 0);
        c.finalizeDraw();
        assert(c.state() == SavingsCircle.CircleState.ACTIVE);
        vm.expectRevert(SavingsCircle.DrawNotPending.selector);
        c.finalizeDraw();
    }

    function test_WrongRequestDoesNotCompleteDraw() public {
        SavingsCircle c = _pending();
        coordinator.deliver(address(provider), c.drawRequestId() + 100, 12);
        vm.expectRevert(SavingsCircle.RandomnessNotReady.selector);
        c.finalizeDraw();
    }

    function test_CoordinatorMigrationCannotInjectRandomness() public {
        SavingsCircle c = _pending();
        TestVRFCoordinator attacker = new TestVRFCoordinator();
        provider.setCoordinator(address(attacker));
        attacker.deliver(address(provider), c.drawRequestId(), 777);
        (bool ready,) = provider.getRandomness(c.drawRequestId());
        assert(!ready);
        provider.setCoordinator(address(coordinator));
        coordinator.deliver(address(provider), c.drawRequestId(), 42);
        c.finalizeDraw();
    }

    function test_ResultIgnoresFinalizerAndTimeAndMatchesCommitment() public {
        SavingsCircle c = _pending();
        bytes32 commitment =
            keccak256(abi.encode(c.DRAW_VERSION(), block.chainid, address(c), _params(c), c.getParticipants()));
        assert(commitment == c.drawCommitment());
        coordinator.deliver(address(provider), c.drawRequestId(), 555);
        bytes32 seed = keccak256(abi.encode(c.DRAW_VERSION(), commitment, c.drawRequestId(), uint256(555)));
        address[] memory expected = c.computeTurnOrder(c.getParticipants(), seed);
        vm.warp(c.registrationDeadline() + 365 days);
        vm.prank(address(0xBAD));
        c.finalizeDraw();
        assert(c.verifiableSeed() == seed);
        assert(keccak256(abi.encode(expected)) == keccak256(abi.encode(c.getTurnOrder())));
        assert(c.currentRoundStart() == c.getCurrentTime());
    }

    function test_OutsiderCannotAdvanceClockOrForceDefaults() public {
        SavingsCircle c = _createDefaultCircle(SavingsCircle.PayoutMode.ROSCA);
        _joinAllThree(c);
        (bool success,) = address(c).call(abi.encodeWithSignature("advanceVirtualTime(uint256)", 7 days));
        assert(!success);
        vm.expectRevert(SavingsCircle.RoundNotReadyToSettle.selector);
        c.settleCurrentRound();
    }

    function test_CollateralCoversEveryDefaultAndEveryPot() public {
        SavingsCircle c = _createDefaultCircle(SavingsCircle.PayoutMode.ROSCA);
        _joinAllThree(c);
        for (uint256 r = 1; r <= 3; r++) {
            vm.warp(c.currentRoundStart() + ROUND_DURATION);
            c.settleCurrentRound();
            (,,,,, uint256 pot,,,) = c.roundSummaries(r);
            assert(pot == 3 * CONTRIBUTION);
        }
        assert(c.state() == SavingsCircle.CircleState.COMPLETED);
        assert(yieldVault.principalBalance(address(c)) == 0 && stablecoin.balanceOf(address(c)) == 0);
    }

    function test_UnderCollateralizedCircleRejected() public {
        SavingsCircle c = _createDefaultCircle(SavingsCircle.PayoutMode.ROSCA);
        SavingsCircle.CircleParams memory p = _params(c);
        p.collateralAmount = 150e18;
        vm.expectRevert(SavingsCircle.InsufficientCollateralToJoin.selector);
        factory.createCircle(p);
    }

    function test_UnfilledCircleRefundsAfterDeadlineOnlyOnce() public {
        SavingsCircle c = _createDefaultCircle(SavingsCircle.PayoutMode.ROSCA);
        _join(c, alice);
        vm.expectRevert(SavingsCircle.CannotCancel.selector);
        c.cancelUnfilledCircle();
        vm.warp(c.registrationDeadline());
        vm.startPrank(bob);
        stablecoin.approve(address(c), type(uint256).max);
        vm.expectRevert(SavingsCircle.RegistrationClosed.selector);
        c.joinCircle();
        vm.stopPrank();
        c.cancelUnfilledCircle();
        vm.prank(alice);
        c.claimCancelledCollateral();
        assert(stablecoin.balanceOf(alice) == 1_000e18);
        vm.prank(alice);
        vm.expectRevert(SavingsCircle.NoRefundAvailable.selector);
        c.claimCancelledCollateral();
        assert(yieldVault.principalBalance(address(c)) == 0);
    }

    function test_PaymentAtDeadlineIsRejected() public {
        SavingsCircle c = _createDefaultCircle(SavingsCircle.PayoutMode.ROSCA);
        _joinAllThree(c);
        vm.warp(c.currentRoundStart() + ROUND_DURATION);
        vm.prank(alice);
        vm.expectRevert(SavingsCircle.RoundExpired.selector);
        c.payContribution();
    }

    function test_FreshWalletCannotVouchAndOwnerCannotFabricatePayments() public {
        vm.prank(alice);
        vm.expectRevert(ReputationRegistry.LowVoucherReputation.selector);
        reputation.vouchForMember(bob);
        vm.expectRevert(ReputationRegistry.Unauthorized.selector);
        reputation.recordPayment(alice, true, 1e18);
        vm.expectRevert(ReputationRegistry.Unauthorized.selector);
        reputation.registerCircle(alice);
    }

    function test_OutOfOrderResponsesRemainBoundToTheirCircle() public {
        SavingsCircle first = _pending();
        SavingsCircle second = _pending();
        coordinator.deliver(address(provider), second.drawRequestId(), 22);
        coordinator.deliver(address(provider), first.drawRequestId(), 11);
        first.finalizeDraw();
        second.finalizeDraw();
        assert(
            first.verifiableSeed()
                == keccak256(
                    abi.encode(first.DRAW_VERSION(), first.drawCommitment(), first.drawRequestId(), uint256(11))
                )
        );
        assert(
            second.verifiableSeed()
                == keccak256(
                    abi.encode(second.DRAW_VERSION(), second.drawCommitment(), second.drawRequestId(), uint256(22))
                )
        );
    }

    function test_RealDrawAtMinimumAndMaximumParticipantCounts() public {
        SavingsCircle template = _createDefaultCircle(SavingsCircle.PayoutMode.ROSCA);
        for (uint256 n = 2; n <= 50; n += 48) {
            SavingsCircle.CircleParams memory p = _params(template);
            p.maxParticipants = n;
            p.collateralAmount = n * 110e18;
            SavingsCircle c = SavingsCircle(factory.createCircle(p));
            for (uint256 i = 0; i < n; i++) {
                address member = address(uint160(0x1000 + i));
                stablecoin.faucet(member, 10_000e18);
                _join(c, member);
            }
            coordinator.deliver(address(provider), c.drawRequestId(), n);
            c.finalizeDraw();
            assert(c.getTurnOrder().length == n && c.currentRound() == 1);
            for (uint256 i = 0; i < n; i++) {
                (,,,,,,,,, uint256 turn) = c.participantData(c.getTurnOrder()[i]);
                assert(turn == i + 1);
            }
        }
    }

    function test_MockCannotDeployOutsideLocalChain() public {
        vm.chainId(1);
        vm.expectRevert(MockRandomnessProvider.DemoOnly.selector);
        new MockRandomnessProvider();
        vm.chainId(31337);
    }

    function testFuzz_PermutationContainsEachMemberOnce(uint256 word, uint8 count) public {
        SavingsCircle c = _createDefaultCircle(SavingsCircle.PayoutMode.ROSCA);
        uint256 n = 2 + uint256(count) % 49;
        address[] memory members = new address[](n);
        for (uint256 i; i < n; i++) {
            members[i] = address(uint160(i + 1));
        }
        address[] memory order = c.computeTurnOrder(members, bytes32(word));
        bool[] memory seen = new bool[](n);
        for (uint256 i; i < n; i++) {
            uint256 index = uint160(order[i]) - 1;
            assert(index < n && !seen[index]);
            seen[index] = true;
        }
    }
}
