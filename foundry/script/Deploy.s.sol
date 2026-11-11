// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockStablecoin} from "../src/MockStablecoin.sol";
import {MockYieldVault} from "../src/MockYieldVault.sol";
import {ReputationRegistry} from "../src/ReputationRegistry.sol";
import {SavingsCircle} from "../src/SavingsCircle.sol";
import {SavingsCircleFactory} from "../src/SavingsCircleFactory.sol";
import {MockRandomnessProvider} from "../src/MockRandomnessProvider.sol";
import {VRFRandomnessProvider} from "../src/VRFRandomnessProvider.sol";

interface VmScript {
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
    function envOr(string calldata name, uint256 defaultValue) external view returns (uint256);
    function envOr(string calldata name, address defaultValue) external view returns (address);
    function envOr(string calldata name, bytes32 defaultValue) external view returns (bytes32);
}

contract DeployScript {
    VmScript constant vm = VmScript(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run()
        external
        returns (
            MockStablecoin stablecoin,
            MockYieldVault yieldVault,
            ReputationRegistry reputation,
            SavingsCircleFactory factory,
            address randomness
        )
    {
        // Clave privada por defecto de la cuenta #0 de Anvil
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY",
            block.chainid == 31337 ? uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80) : 0
        );
        require(deployerPrivateKey != 0, "PRIVATE_KEY required outside Anvil");

        vm.startBroadcast(deployerPrivateKey);

        stablecoin = new MockStablecoin();
        yieldVault = new MockYieldVault(address(stablecoin));
        reputation = new ReputationRegistry();
        if (block.chainid == 31337) {
            randomness = address(new MockRandomnessProvider());
        } else {
            uint256 confirmations = vm.envOr("VRF_CONFIRMATIONS", uint256(3));
            require(confirmations >= 3 && confirmations <= 200, "Invalid VRF confirmations");
            randomness = address(
                new VRFRandomnessProvider(
                    vm.envOr("VRF_COORDINATOR", address(0)),
                    vm.envOr("VRF_SUB_ID", uint256(0)),
                    vm.envOr("VRF_KEY_HASH", bytes32(0)),
                    uint16(confirmations),
                    200_000,
                    vm.envOr("VRF_NATIVE_PAYMENT", uint256(0)) == 1
                )
            );
        }
        factory = new SavingsCircleFactory(address(stablecoin), address(yieldVault), address(reputation), randomness);
        if (block.chainid != 31337) VRFRandomnessProvider(randomness).setFactory(address(factory));

        stablecoin.setAuthorizedMinter(address(yieldVault), true);
        reputation.setFactory(address(factory));

        // Fondear las primeras 5 cuentas de Anvil con 5,000 cUSD cada una para demos inmediatas
        address[5] memory demoAccounts = [
            0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266,
            0x70997970C51812dc3A010C7d01b50e0d17dc79C8,
            0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC,
            0x90F79bf6EB2c4f870365E785982E1f101E93b906,
            0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65
        ];

        for (uint256 i = 0; i < demoAccounts.length; i++) {
            stablecoin.faucet(demoAccounts[i], 5_000e18);
        }

        // Crear 2 círculos iniciales de ejemplo (1 Cadena ROSCA y 1 Natillera ASCA)
        factory.createCircle(
            SavingsCircle.CircleParams({
                name: "Cadena Emprendedores (Turnos)",
                contributionAmount: 100e18,
                collateralAmount: 330e18,
                maxParticipants: 3,
                roundDuration: 7 days,
                gracePeriod: 3 days,
                latePenaltyBps: 1000, // 10%
                yieldRateBps: 200, // 2% por ronda
                payoutMode: SavingsCircle.PayoutMode.ROSCA
            })
        );

        factory.createCircle(
            SavingsCircle.CircleParams({
                name: "Natillera Fin de Ano (Cierre)",
                contributionAmount: 200e18,
                collateralAmount: 840e18,
                maxParticipants: 4,
                roundDuration: 15 days,
                gracePeriod: 5 days,
                latePenaltyBps: 500, // 5%
                yieldRateBps: 300, // 3% por ronda
                payoutMode: SavingsCircle.PayoutMode.ASCA
            })
        );

        vm.stopBroadcast();
    }
}
