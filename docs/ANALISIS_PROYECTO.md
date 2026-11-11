# Análisis del Proyecto #3: Círculos de Ahorro Comunitario (Blockchain)

> La [revisión y correcciones de blockchain y sorteo](./REVISION_BLOCKCHAIN_Y_SORTEO.md) describe el mecanismo vigente: cierre de entradas, solicitud asíncrona, adaptador VRF y barajado verificable. En Anvil se usa una fuente explícitamente simulada. Los diagramas siguientes resumen el flujo general.

## 1. Comprensión del Problema y Contexto
En Latinoamérica (especialmente en Colombia), existen dos variantes principales de ahorro comunitario mencionadas en el enunciado:
1. **La "Cadena" o Pasanaku (ROSCA - *Rotating Savings and Credit Association*):** Un grupo de $N$ participantes aporta una cuota fija cada periodo. En cada ronda, uno de los participantes recibe el pozo acumulado de ese periodo (adjudicado por sorteo o turno). El ciclo termina cuando todos han recibido el pozo una vez.
2. **La "Natillera" (ASCA - *Accumulating Savings and Credit Association*):** Los participantes aportan periódicamente a un fondo común que genera rendimientos durante todo el ciclo (ej. 6 o 12 meses), y al cierre del ciclo se liquida y reparte el capital más los rendimientos proporcionales (premiando la puntualidad).

### Problemas del modelo tradicional que resolvemos con Blockchain:
| Riesgo Tradicional | Solución en Smart Contract |
| :--- | :--- |
| **Riesgo de custodia / Robo / Embargo al tesorero** | **Bóveda Inmutable (Escrow descentralizado):** Los fondos residen en el contrato inteligente, sin que ningún administrador pueda retirarlos arbitrariamente. |
| **Morosidad (especialmente quien cobra primero en una cadena)** | **Garantía (Colateral) + Reglas Anti-Mora:** Depósito de garantía inicial, penalizaciones automáticas sobre rendimientos o colateral, y sistema de reputación on-chain. |
| **Falta de transparencia en turnos y cuentas** | **Sorteo Verificable y Contabilidad Pública:** Orden de turnos determinístico/verificable y trazabilidad en tiempo real de quién ha pagado y cuánto rendimiento hay acumulado. |
| **Pérdida de valor por inflación** | **Stablecoins + Yield Simulado:** Uso de un token ERC-20 estable (`cUSD`) y un módulo generador de rendimiento base (`MockYieldVault`). |

---

## 2. Arquitectura del Sistema

```mermaid
flowchart TD
    subgraph Frontend ["Aplicación Web3 (React + TypeScript + Viem)"]
        UI_Create["Crear Círculo Paramétrico"]
        UI_Dash["Dashboard: Estado de Cuentas y Turnos"]
        UI_Pay["Aportar Cuota / Faucet Stablecoin"]
    end

    subgraph Blockchain ["Red EVM (Foundry / Anvil / Sepolia)"]
        Token["MockStablecoin (ERC-20)\ncUSD"]
        Factory["SavingsCircleFactory\n(Crea y lista círculos)"]
        Circle["SavingsCircle (Bóveda Inmutable)\nLógica de Rondas, Sorteo y Mora"]
        Yield["MockYieldVault\n(Simulador de Rendimiento Base)"]
        Rep["ReputationRegistry\n(Historial crediticio comunitario)"]
    end

    UI_Create --> Factory
    Factory -->|Despliega| Circle
    UI_Pay -->|Approve & Deposit| Token
    UI_Pay -->|Pagar Cuota| Circle
    UI_Dash -->|Lectura en tiempo real| Circle
    Circle <-->|Deposita y genera interés| Yield
    Circle -->|Actualiza puntaje| Rep
    Circle -->|Desembolso automático| Token
```

---

## 3. Ciclo de Vida del Contrato (`SavingsCircle`)

```mermaid
stateDiagram-v2
    [*] --> ABIERTA: Creador define parámetros
    ABIERTA --> SORTEO: Se completan N participantes ( + Garantía)
    SORTEO --> ACTIVA_RONDA_K: Sorteo verificable asigna orden de turnos (1..N)
    ACTIVA_RONDA_K --> LIQUIDACION_RONDA: Participantes pagan cuota (Puntual o con Mora)
    LIQUIDACION_RONDA --> ACTIVA_RONDA_K: Desembolsa turno K (si es Cadena) y avanza a K+1
    LIQUIDACION_RONDA --> CIERRE_CICLO: Se completan las N rondas
    CIERRE_CICLO --> FINALIZADA: Reparto de rendimientos + devolución de garantías a puntuales
    FINALIZADA --> [*]
```
