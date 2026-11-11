# Proyecto #3: Círculos de Ahorro Comunitario en Blockchain (NatiChain)

Prototipo funcional completo en **Solidity + Foundry + React/TypeScript (Viem)** para la creación y gestión descentralizada de **Natilleras (ASCA)** y **Cadenas de Ahorro (ROSCA)**.

> **Sorteo corregido:** se fijan participantes y reglas antes de solicitar aleatoriedad; la respuesta se recibe por separado y no puede sustituirse ni repetirse el sorteo. Incluye adaptador Chainlink VRF v2.5 y verificación independiente. **La demo Anvil utiliza una fuente simulada, sin prueba VRF.** Consulta la [revisión y correcciones](./docs/REVISION_BLOCKCHAIN_Y_SORTEO.md).

## Arquitectura de Contratos Inteligentes (`foundry/src/`)
1. **[`SavingsCircle.sol`](./foundry/src/SavingsCircle.sol)**:
   - **Bóveda Inmutable:** Custodia programada sin función de retiro arbitrario del tesorero.
   - **Modalidades Paramétricas:** Soporta desembolso **Por Turnos (`ROSCA` / Cadena)** y **Al Cierre del Ciclo (`ASCA` / Natillera)**.
   - **Reglas Anti-Mora:** Ventana de puntualidad (`gracePeriod`), multas (`latePenaltyBps`) y garantía mínima que cubre todas las cuotas y multas posibles: `N * (cuota + multa)`. Premios proporcionales a pagos puntuales (`onTimeShares`); si nadie tiene puntos, se reparten por igual.
   - **Sorteo asíncrono:** Compromiso de entradas, una solicitud de aleatoriedad, una salida y barajado *Fisher-Yates* con muestreo por rechazo. No usa datos del bloque como semilla. Estado de espera y finalización pública sin resorteos.
   - **Inscripción con salida:** Si no se completan los cupos en 30 días, cualquiera puede cancelar y cada miembro recuperar su garantía. Un sorteo solicitado no admite cancelación ni repetición.
2. **[`MockYieldVault.sol`](./foundry/src/MockYieldVault.sol)**:
   - Simula rendimiento por ronda sobre el principal bloqueado; no reinvierte intereses ni garantiza protección frente a inflación.
3. **[`ReputationRegistry.sol`](./foundry/src/ReputationRegistry.sol)**:
   - Implementa un puntaje crediticio comunitario (escala `100` a `1000`) y un sistema de avales sociales (*vouching*) basado en el paper *Good Reputation: Expanding Access to Credit Leveraging Reputational and Social Network Data (UC Berkeley)*.
4. **[`SavingsCircleFactory.sol`](./foundry/src/SavingsCircleFactory.sol)**:
   - Fábrica para desplegar y consultar múltiples círculos paramétricos.
5. **[`MockStablecoin.sol`](./foundry/src/MockStablecoin.sol)**:
   - Activo estable ERC-20 (`cUSD`) con Faucet integrado para pruebas.
6. **[`VRFRandomnessProvider.sol`](./foundry/src/VRFRandomnessProvider.sol)**:
   - Consumidor Chainlink VRF v2.5 compartido por los círculos de la fábrica. Autentica el coordinador, vincula solicitudes y conserva una sola salida.
   - [`MockRandomnessProvider.sol`](./foundry/src/MockRandomnessProvider.sol) permite simular respuestas únicamente en cadena `31337`; no ofrece la garantía criptográfica del proveedor real.

---

## Comandos Principales

### 1. Ejecutar Pruebas Automatizadas en Foundry
```powershell
cd foundry
forge test -vv
```

### 2. Iniciar Todo el Proyecto (Blockchain Local + Despliegue + DApp Web)
Desde la raíz del proyecto:
```powershell
.\start-demo.ps1
```
Luego abre **`http://localhost:3000`** en tu navegador.

La demo conserva las pantallas originales. Completa los cupos y usa **Simular respuesta y finalizar (Demo)** para iniciar la primera ronda. Los botones de tiempo controlan Anvil por RPC; el contrato no admite alterar su reloj. Las garantías iniciales de los ejemplos son **330** y **840 cUSD**.

Requiere Foundry y Node/npm. El script busca `forge.exe` y `anvil.exe` en `FOUNDRY_BIN`, en `$env:USERPROFILE\.foundry\bin` o en el `PATH`. Para una instalación en otra carpeta, define `FOUNDRY_BIN` antes de iniciar. La configuración no depende de carpetas temporales.

El inicio comprueba que los puertos **8545 y 3000** estén libres, despliega con la cuenta inicial de Anvil y deja ambos servicios en segundo plano. No cambia el directorio de la terminal. La demo necesita un nodo nuevo para conservar las direcciones deterministas de la interfaz; Vite no cambia silenciosamente a otro puerto.

Para detenerla:

```powershell
.\stop-demo.ps1
```

Los scripts registran PID, instante de inicio y ejecutable en `.demo/processes.json`. El apagado solo detiene los procesos de ese registro que todavía coinciden; conserva otros nodos Anvil y aplicaciones web. Si no hay registro, no termina procesos por nombre ni por puerto. Los logs se guardan en `.demo/`, excluida de Git. Si el arranque falla después de crear procesos, los cierra y permite reintentar.

En la interfaz, la **Cadena** muestra los turnos efectivamente cobrados; la **Natillera** indica que todos reciben su liquidación al cierre. La garantía activa queda en cero al completarse el ciclo y se conserva visible el importe devuelto. Los premios se estiman según los puntos acumulados, o por igual si nadie tiene puntos; al cierre se muestra el premio liquidado. Los pagos vencidos se deshabilitan. El pago grupal controla únicamente las cinco cuentas locales del selector y comunica los participantes que todavía faltan por pagar.

### Alcance del sorteo para la sustentación

La demo **no requiere contratar un proveedor externo**. La interfaz obtiene una palabra con `crypto.getRandomValues` y la registra en el proveedor simulado. El contrato fija participantes y reglas, conserva una sola respuesta y permite verificar cómo se obtuvo el orden. Sin embargo, quien envía la respuesta puede escoger otra palabra: la verificación del cálculo no prueba imparcialidad de esa fuente. El adaptador VRF queda como integración opcional posterior, no como requisito para presentar la demo.

### 3. Comprobar la interfaz y verificar un sorteo

```powershell
cd web
npm ci
npm run typecheck
npm run test:draw
npm run build
npm run verify:draw -- 0xDIRECCION_DEL_CIRCULO
```

Las herramientas de consola de verificación y sus pruebas requieren **Node >= 22.18**. `verify:draw` consulta `http://127.0.0.1:8545`; se puede configurar `RPC_URL`. La interfaz muestra la evidencia completa y permite reconstruir compromiso, semilla y orden con TypeScript.

### 4. Opcional: configurar VRF en una testnet compatible

Fuera de la cadena `31337`, [el despliegue](./foundry/script/Deploy.s.sol) exige `PRIVATE_KEY`, `VRF_COORDINATOR`, `VRF_KEY_HASH` y `VRF_SUB_ID`. `VRF_CONFIRMATIONS` permite elegir entre 3 y 200 confirmaciones, con valor inicial 3; debe ajustarse al riesgo y a la red. `VRF_NATIVE_PAYMENT=1` selecciona pago en moneda nativa; el valor inicial 0 utiliza LINK.

1. Crear y financiar una suscripción VRF v2.5 en una red compatible.
2. Configurar esas variables con los datos oficiales de esa red.
3. Ejecutar `forge script script/Deploy.s.sol --rpc-url URL_DE_LA_RED --broadcast` desde la carpeta de contratos.
4. Registrar la dirección desplegada de **VRFRandomnessProvider** como consumidor de la suscripción, antes de completar un círculo.
5. Completar las inscripciones, esperar la entrega real del coordinador y llamar a `finalizeDraw()`.

La interfaz incluida sigue configurada para Anvil; en una testnet se puede operar por CLI y verificar mediante `RPC_URL`. Los contratos económicos siguen usando token y rendimiento simulados. No se realizó una entrega VRF pública durante la validación local. Si el proveedor no responde, el círculo queda pendiente; no se introduce un resorteo como recuperación.

Configuración y límites: [documentación oficial de VRF](https://docs.chain.link/vrf/v2-5/getting-started) y [consideraciones de seguridad](https://docs.chain.link/vrf/v2-5/security).
