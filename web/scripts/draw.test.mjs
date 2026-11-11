import assert from 'node:assert/strict';
import test from 'node:test';
import { computeTurnOrder, drawCommitment, drawSeed, verifyDraw } from '../src/contracts/draw.ts';

const members = [1, 2, 3].map(i => `0x${i.toString(16).padStart(40, '0')}`);
const circle = `0x${'c'.repeat(40)}`;
const params = { name: 'Prueba', contributionAmount: 100n, collateralAmount: 330n, maxParticipants: 3n,
  roundDuration: 600n, gracePeriod: 300n, latePenaltyBps: 1000n, yieldRateBps: 200n, payoutMode: 0 };
const commitment = drawCommitment(31337n, circle, params, members);
const seed = drawSeed(commitment, 1n, 0n);
const order = computeTurnOrder(members, seed);
const verify = (overrides = {}) => {
  const evidence = { chain: 31337n, circle, params, members, commitment, id: 1n, word: 0n, seed, order, ...overrides };
  return verifyDraw(evidence.chain, evidence.circle, evidence.params, evidence.members, evidence.commitment,
    evidence.id, evidence.word, evidence.seed, evidence.order);
};

test('reconstruction accepts a complete result, including a zero source word', () => assert.equal(verify(), true));
test('verification detects changed source, request, chain, contract, rules or membership', () => {
  for (const changed of [{ word: 1n }, { id: 2n }, { chain: 1n }, { circle: members[0] },
    { params: { ...params, contributionAmount: 101n } }, { members: [...members].reverse() }]) {
    assert.equal(verify(changed), false);
  }
});
test('verification rejects duplicate, missing or reordered turns', () => {
  assert.equal(verify({ order: [order[0], order[0], order[2]] }), false);
  assert.equal(verify({ order: order.slice(1) }), false);
  assert.equal(verify({ order: [...order].reverse() }), false);
});
test('shuffle preserves every participant for the minimum and maximum sizes', () => {
  for (const size of [2, 50]) {
    const input = Array.from({ length: size }, (_, i) => `0x${(i + 1).toString(16).padStart(40, '0')}`);
    const output = computeTurnOrder(input, seed);
    assert.equal(new Set(output).size, size);
    assert.deepEqual([...output].sort(), [...input].sort());
    assert.deepEqual(computeTurnOrder(input, seed), output);
  }
});
