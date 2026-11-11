import { encodeAbiParameters, keccak256, stringToHex, type Address, type Hex } from 'viem';

export const DRAW_VERSION = keccak256(stringToHex('NatiChain.Draw.v2'));
export interface DrawParams {
  name: string;
  contributionAmount: bigint;
  collateralAmount: bigint;
  maxParticipants: bigint;
  roundDuration: bigint;
  gracePeriod: bigint;
  latePenaltyBps: bigint;
  yieldRateBps: bigint;
  payoutMode: number;
}

const paramsComponents = [
  { name: 'name', type: 'string' },
  { name: 'contributionAmount', type: 'uint256' },
  { name: 'collateralAmount', type: 'uint256' },
  { name: 'maxParticipants', type: 'uint256' },
  { name: 'roundDuration', type: 'uint256' },
  { name: 'gracePeriod', type: 'uint256' },
  { name: 'latePenaltyBps', type: 'uint256' },
  { name: 'yieldRateBps', type: 'uint256' },
  { name: 'payoutMode', type: 'uint8' },
] as const;

export function drawCommitment(chainId: bigint, circle: Address, params: DrawParams, members: readonly Address[]): Hex {
  return keccak256(encodeAbiParameters([
    { type: 'bytes32' }, { type: 'uint256' }, { type: 'address' },
    { type: 'tuple', components: paramsComponents }, { type: 'address[]' },
  ], [DRAW_VERSION, chainId, circle, params, members]));
}

export function drawSeed(commitment: Hex, requestId: bigint, word: bigint): Hex {
  return keccak256(encodeAbiParameters([
    { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' },
  ], [DRAW_VERSION, commitment, requestId, word]));
}

// Independent reconstruction in TypeScript; no call to the Solidity shuffle.
export function computeTurnOrder(members: readonly Address[], seed: Hex): Address[] {
  if (members.length < 2 || members.length > 50) throw new Error('Cantidad de participantes inválida');
  const order = [...members];
  let counter = 0n;
  for (let i = order.length - 1; i > 0; i--) {
    const bound = BigInt(i + 1);
    const threshold = (1n << 256n) % bound;
    let sample: bigint;
    do {
      sample = BigInt(keccak256(encodeAbiParameters(
        [{ type: 'bytes32' }, { type: 'uint256' }], [seed, counter++],
      )));
    } while (sample < threshold);
    const j = Number(sample % bound);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export function verifyDraw(chainId: bigint, circle: Address, params: DrawParams, members: readonly Address[],
  commitment: Hex, requestId: bigint, word: bigint, seed: Hex, actual: readonly Address[]): boolean {
  const expectedCommitment = drawCommitment(chainId, circle, params, members);
  if (expectedCommitment !== commitment || drawSeed(commitment, requestId, word) !== seed) return false;
  if (new Set(members.map(a => a.toLowerCase())).size !== members.length) return false;
  const expected = computeTurnOrder(members, seed);
  return actual.length === expected.length && actual.every((a, i) => a.toLowerCase() === expected[i].toLowerCase());
}
