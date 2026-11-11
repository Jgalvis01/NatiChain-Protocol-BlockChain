// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRandomnessProvider {
    function requestRandomness(bytes32 commitment) external returns (uint256 requestId);
    function getRandomness(uint256 requestId) external view returns (bool fulfilled, uint256 word);
    function isDemo() external view returns (bool);
}
