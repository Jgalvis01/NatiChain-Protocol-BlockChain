import { createPublicClient, http, parseAbi, isAddress } from 'viem';
import { verifyDraw } from '../src/contracts/draw.ts';

const circle = process.argv[2];
if (!circle || !isAddress(circle)) {
  console.error('Uso: npm run verify:draw -- 0xDIRECCION_DEL_CIRCULO (Node >= 22.18). RPC_URL es opcional.');
  process.exit(1);
}
const client = createPublicClient({ transport: http(process.env.RPC_URL || 'http://127.0.0.1:8545') });
const abi = parseAbi([
  'struct CircleParams { string name; uint256 contributionAmount; uint256 collateralAmount; uint256 maxParticipants; uint256 roundDuration; uint256 gracePeriod; uint256 latePenaltyBps; uint256 yieldRateBps; uint8 payoutMode; }',
  'function getCircleOverview() view returns (CircleParams, uint8, uint256, uint256, uint256, uint256, uint256, uint256, uint256, bytes32)',
  'function getParticipants() view returns (address[])',
  'function getTurnOrder() view returns (address[])',
  'function getDrawDetails() view returns (address, bool, uint256, bytes32, bool, uint256, uint256)',
]);
try {
  // Read one block so a concurrent finalization cannot produce inconsistent evidence.
  const blockNumber = await client.getBlockNumber();
  const read = functionName => client.readContract({ address: circle, abi, functionName, blockNumber });
  const [overview, members, order, draw, chainId] = await Promise.all([
    read('getCircleOverview'), read('getParticipants'), read('getTurnOrder'), read('getDrawDetails'), client.getChainId(),
  ]);
  if (!draw[4] || order.length === 0) throw new Error('El sorteo todavía no tiene resultado definitivo.');
  const valid = verifyDraw(BigInt(chainId), circle, overview[0], members, draw[3], draw[2], draw[5], overview[9], order);
  console.log(JSON.stringify({ valid, chainId, blockNumber: blockNumber.toString(), circle,
    provider: draw[0], demo: draw[1], requestId: draw[2].toString(), commitment: draw[3],
    word: draw[5].toString(), seed: overview[9], members, order,
    scope: 'Comprueba compromiso, derivación y barajado. La autenticidad VRF depende del coordinador configurado.',
  }, null, 2));
  if (!valid) process.exitCode = 1;
} catch (error) { console.error(error.message); process.exitCode = 1; }
