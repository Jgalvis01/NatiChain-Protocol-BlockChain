// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRandomnessProvider} from "./IRandomnessProvider.sol";

/// @notice LOCAL DEMO ONLY: chosen words have no cryptographic proof or fairness guarantee.
///         Deliberately unavailable outside Anvil's chain ID.
contract MockRandomnessProvider is IRandomnessProvider {
    struct Request {
        address circle;
        bytes32 commitment;
        uint256 word;
        bool fulfilled;
    }
    mapping(uint256 => Request) public requests;
    mapping(address => bool) public hasRequested;
    uint256 public nextRequestId = 1;
    error DemoOnly();
    error InvalidRequest();
    event RandomnessRequested(uint256 indexed requestId, address indexed circle, bytes32 commitment);
    event RandomnessStored(uint256 indexed requestId, uint256 word);

    constructor() {
        if (block.chainid != 31337) revert DemoOnly();
    }

    function isDemo() external pure returns (bool) {
        return true;
    }

    function requestRandomness(bytes32 commitment) external returns (uint256 requestId) {
        if (hasRequested[msg.sender]) revert InvalidRequest();
        hasRequested[msg.sender] = true;
        requestId = nextRequestId++;
        requests[requestId] = Request(msg.sender, commitment, 0, false);
        emit RandomnessRequested(requestId, msg.sender, commitment);
    }

    // Anyone on the local node can simulate the provider, never a real VRF proof.
    function fulfill(uint256 requestId, uint256 word) external {
        Request storage request = requests[requestId];
        if (request.circle == address(0) || request.fulfilled) revert InvalidRequest();
        request.word = word;
        request.fulfilled = true;
        emit RandomnessStored(requestId, word);
    }

    function getRandomness(uint256 requestId) external view returns (bool, uint256) {
        Request storage request = requests[requestId];
        return (request.fulfilled, request.word);
    }
}
