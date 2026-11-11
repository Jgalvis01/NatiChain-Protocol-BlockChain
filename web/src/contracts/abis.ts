import { parseAbi } from 'viem';

export const ANVIL_RPC_URL = 'http://127.0.0.1:8545';

// Direcciones determinísticas al desplegar con Deploy.s.sol desde una instancia limpia de Anvil
export const DEFAULT_ADDRESSES = {
  stablecoin: '0x5FbDB2315678afecb367f032d93F642f64180aa3' as `0x${string}`,
  yieldVault: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512' as `0x${string}`,
  reputation: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0' as `0x${string}`,
  factory: '0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9' as `0x${string}`,
};

export interface DemoWallet {
  name: string;
  role: string;
  address: `0x${string}`;
  privateKey: `0x${string}`;
  avatarColor: string;
}

export const DEMO_WALLETS: DemoWallet[] = [
  {
    name: 'Camila Gómez',
    role: 'Participante #1 (Líder)',
    address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    avatarColor: 'from-emerald-500 to-teal-600',
  },
  {
    name: 'Mateo Restrepo',
    role: 'Participante #2',
    address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    privateKey: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    avatarColor: 'from-blue-500 to-indigo-600',
  },
  {
    name: 'Valentina Ríos',
    role: 'Participante #3',
    address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    privateKey: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    avatarColor: 'from-purple-500 to-pink-600',
  },
  {
    name: 'Sebastián Vargas',
    role: 'Participante #4',
    address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    privateKey: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
    avatarColor: 'from-amber-500 to-orange-600',
  },
  {
    name: 'Lucía Mendoza',
    role: 'Participante #5',
    address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    privateKey: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
    avatarColor: 'from-rose-500 to-red-600',
  },
];

export const STABLECOIN_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function faucet(address to, uint256 amount)',
]);

export const REPUTATION_ABI = parseAbi([
  'struct UserReputation { uint256 onTimePayments; uint256 latePayments; uint256 defaults; uint256 circlesJoined; uint256 circlesCompletedClean; uint256 totalSavedVolume; uint256 socialEndorsements; }',
  'function getReputationScore(address user) view returns (uint256)',
  'function getUserStats(address user) view returns (UserReputation)',
  'function vouchForMember(address candidate)',
  'function hasVouched(address voucher, address candidate) view returns (bool)',
]);

export const FACTORY_ABI = parseAbi([
  'struct CircleParams { string name; uint256 contributionAmount; uint256 collateralAmount; uint256 maxParticipants; uint256 roundDuration; uint256 gracePeriod; uint256 latePenaltyBps; uint256 yieldRateBps; uint8 payoutMode; }',
  'struct CircleCard { address circleAddress; address creator; string name; uint8 payoutMode; uint8 state; uint256 contributionAmount; uint256 collateralAmount; uint256 maxParticipants; uint256 currentParticipants; uint256 currentRound; uint256 roundDuration; uint256 yieldRateBps; uint256 latePenaltyBps; uint256 vaultLockedPrincipal; uint256 totalYieldGenerated; uint256 totalPenaltiesCollected; }',
  'function createCircle(CircleParams params) returns (address)',
  'function getAllCircleCards() view returns (CircleCard[])',
  'function getAllCircles() view returns (address[])',
]);

export const SAVINGS_CIRCLE_ABI = parseAbi([
  'struct CircleParams { string name; uint256 contributionAmount; uint256 collateralAmount; uint256 maxParticipants; uint256 roundDuration; uint256 gracePeriod; uint256 latePenaltyBps; uint256 yieldRateBps; uint8 payoutMode; }',
  'struct ParticipantInfo { address account; bool joined; uint256 collateralBalance; uint256 principalSaved; uint256 onTimeShares; uint256 latePaymentsCount; uint256 defaultsCount; uint256 totalReceivedAtClose; uint256 turnPayoutReceived; uint256 assignedTurn; }',
  'struct RoundSummary { uint256 roundNumber; uint256 startTime; uint256 graceDeadline; uint256 endTime; uint256 paidCount; uint256 poolCollected; uint256 yieldGenerated; address beneficiary; bool settled; }',
  'function getCircleOverview() view returns (CircleParams _params, uint8 _state, uint256 _currentRound, uint256 _currentTime, uint256 _participantsCount, uint256 _vaultLockedPrincipal, uint256 _totalYieldGenerated, uint256 _totalPenaltiesCollected, uint256 _totalOnTimeShares, bytes32 _verifiableSeed)',
  'function getAllParticipantsInfo() view returns (ParticipantInfo[])',
  'function getTurnOrder() view returns (address[])',
  'function getDrawDetails() view returns (address provider, bool demo, uint256 requestId, bytes32 commitment, bool fulfilled, uint256 word, uint256 deadline)',
  'function getParticipants() view returns (address[])',
  'function finalizeDraw()',
  'function cancelUnfilledCircle()',
  'function claimCancelledCollateral()',
  'function getRoundStatuses(uint256 roundNum) view returns (uint8[])',
  'function getAllRoundSummaries() view returns (RoundSummary[])',
  'function joinCircle()',
  'function payContribution()',
  'function settleCurrentRound()',
]);

export const RANDOMNESS_ABI = parseAbi([
  'function fulfill(uint256 requestId, uint256 word)',
]);
