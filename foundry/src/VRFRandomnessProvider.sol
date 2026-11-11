// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRandomnessProvider} from "./IRandomnessProvider.sol";
import {VRFConsumerBaseV2Plus} from "../lib/chainlink/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "../lib/chainlink/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

interface ICircleFactoryRegistry {
    function isCircle(address circle) external view returns (bool);
}

/// @notice One subscription consumer for all circles; the coordinator verifies VRF proofs.
contract VRFRandomnessProvider is VRFConsumerBaseV2Plus, IRandomnessProvider {
    struct Request {
        address circle;
        bytes32 commitment;
        uint256 word;
        bool fulfilled;
    }

    address public immutable trustedCoordinator;
    uint256 public immutable subscriptionId;
    bytes32 public immutable keyHash;
    uint16 public immutable confirmations;
    uint32 public immutable callbackGasLimit;
    bool public immutable nativePayment;
    address public factory;
    mapping(uint256 => Request) public requests;
    mapping(address => bool) public hasRequested;

    event RandomnessRequested(uint256 indexed requestId, address indexed circle, bytes32 commitment);
    event RandomnessStored(uint256 indexed requestId, uint256 word);
    error InvalidConfiguration();
    error UnauthorizedRequest();

    constructor(
        address coordinator,
        uint256 subId,
        bytes32 gasLane,
        uint16 requestConfirmations,
        uint32 gasLimit,
        bool payNative
    ) VRFConsumerBaseV2Plus(coordinator) {
        if (
            coordinator.code.length == 0 || subId == 0 || gasLane == bytes32(0) || requestConfirmations < 3
                || requestConfirmations > 200 || gasLimit < 100_000
        ) {
            revert InvalidConfiguration();
        }
        trustedCoordinator = coordinator;
        subscriptionId = subId;
        keyHash = gasLane;
        confirmations = requestConfirmations;
        callbackGasLimit = gasLimit;
        nativePayment = payNative;
    }

    function setFactory(address circleFactory) external onlyOwner {
        if (factory != address(0) || circleFactory.code.length == 0) revert InvalidConfiguration();
        factory = circleFactory;
    }

    function isDemo() external pure returns (bool) {
        return false;
    }

    function requestRandomness(bytes32 commitment) external returns (uint256 requestId) {
        if (factory == address(0) || !ICircleFactoryRegistry(factory).isCircle(msg.sender) || hasRequested[msg.sender]) revert UnauthorizedRequest();
        hasRequested[msg.sender] = true;
        requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: keyHash,
                subId: subscriptionId,
                requestConfirmations: confirmations,
                callbackGasLimit: callbackGasLimit,
                numWords: 1,
                extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: nativePayment}))
            })
        );
        if (requests[requestId].circle != address(0)) revert InvalidConfiguration();
        requests[requestId] = Request(msg.sender, commitment, 0, false);
        emit RandomnessRequested(requestId, msg.sender, commitment);
    }

    function fulfillRandomWords(uint256 requestId, uint256[] calldata words) internal override {
        // Even the inherited coordinator-migration facility cannot substitute our source.
        // Invalid/duplicate data is ignored so it cannot erase a previously stored result.
        Request storage request = requests[requestId];
        if (msg.sender != trustedCoordinator || request.circle == address(0) || request.fulfilled || words.length != 1) return;
        request.word = words[0];
        request.fulfilled = true;
        emit RandomnessStored(requestId, words[0]);
    }

    function getRandomness(uint256 requestId) external view returns (bool, uint256) {
        Request storage request = requests[requestId];
        return (request.fulfilled, request.word);
    }
}
