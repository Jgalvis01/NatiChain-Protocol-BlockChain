// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockStablecoin} from "./MockStablecoin.sol";

/**
 * @title MockYieldVault
 * @notice Simulador de un protocolo de rendimiento DeFi (ej. Aave / Compound / RWA Treasury)
 *         que custodia el saldo bloqueado de cada Círculo de Ahorro y genera un rendimiento base
 *         simulado por ronda, sin reinvertir intereses ni garantizar protección frente a la inflación.
 */
contract MockYieldVault {
    MockStablecoin public immutable stablecoin;

    /// @notice Capital principal actualmente bloqueado por cada círculo de ahorro
    mapping(address => uint256) public principalBalance;

    /// @notice Rendimiento acumulado disponible para retirar por cada círculo
    mapping(address => uint256) public accruedYieldBalance;

    /// @notice Rendimiento histórico total generado por cada círculo (para auditoría y métricas)
    mapping(address => uint256) public totalHistoricalYield;

    event Deposited(address indexed circle, uint256 amount, uint256 newPrincipal);
    event PrincipalWithdrawn(address indexed circle, address indexed to, uint256 amount);
    event YieldAccrued(address indexed circle, uint256 principalBase, uint256 yieldRateBps, uint256 yieldGenerated);
    event YieldClaimed(address indexed circle, address indexed to, uint256 amount);

    error InsufficientPrincipal();
    error InsufficientYield();
    error ZeroAmount();

    constructor(address _stablecoin) {
        stablecoin = MockStablecoin(_stablecoin);
    }

    /**
     * @notice Deposita capital del círculo en la bóveda generadora de rendimiento.
     */
    function deposit(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        stablecoin.transferFrom(msg.sender, address(this), amount);
        principalBalance[msg.sender] += amount;
        emit Deposited(msg.sender, amount, principalBalance[msg.sender]);
    }

    /**
     * @notice Calcula y acredita el rendimiento base sobre el saldo bloqueado actual del círculo.
     * @param yieldRateBps Tasa de rendimiento en puntos básicos por periodo (ej. 150 = 1.50%).
     * @return yieldGenerated Monto de rendimiento en stablecoin acreditado al círculo.
     */
    function accrueYield(uint256 yieldRateBps) external returns (uint256 yieldGenerated) {
        uint256 currentPrincipal = principalBalance[msg.sender];
        if (currentPrincipal == 0 || yieldRateBps == 0) {
            return 0;
        }
        yieldGenerated = (currentPrincipal * yieldRateBps) / 10_000;
        if (yieldGenerated > 0) {
            stablecoin.mintYield(address(this), yieldGenerated);
            accruedYieldBalance[msg.sender] += yieldGenerated;
            totalHistoricalYield[msg.sender] += yieldGenerated;
            emit YieldAccrued(msg.sender, currentPrincipal, yieldRateBps, yieldGenerated);
        }
    }

    /**
     * @notice Retira capital principal desde la bóveda hacia un destinatario (ej. desembolso de turno o devolución de garantía).
     */
    function withdrawPrincipal(address to, uint256 amount) external {
        if (principalBalance[msg.sender] < amount) revert InsufficientPrincipal();
        unchecked {
            principalBalance[msg.sender] -= amount;
        }
        stablecoin.transfer(to, amount);
        emit PrincipalWithdrawn(msg.sender, to, amount);
    }

    /**
     * @notice Retira el rendimiento acumulado hacia el círculo o participante puntual.
     */
    function withdrawYield(address to, uint256 amount) external {
        if (accruedYieldBalance[msg.sender] < amount) revert InsufficientYield();
        unchecked {
            accruedYieldBalance[msg.sender] -= amount;
        }
        stablecoin.transfer(to, amount);
        emit YieldClaimed(msg.sender, to, amount);
    }
}
