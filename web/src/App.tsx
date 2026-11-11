import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  createPublicClient,
  createWalletClient,
  createTestClient,
  http,
  formatEther,
  parseEther,
  custom,
  BaseError,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import {
  ShieldCheck,
  Coins,
  Users,
  Clock,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Trophy,
  PlusCircle,
  RefreshCw,
  FastForward,
  Award,
  ArrowRight,
  Lock,
  Shuffle,
  TrendingUp,
  UserCheck,
  Wallet,
  Layers,
  Info,
} from 'lucide-react';
import {
  ANVIL_RPC_URL,
  DEFAULT_ADDRESSES,
  DEMO_WALLETS,
  STABLECOIN_ABI,
  REPUTATION_ABI,
  FACTORY_ABI,
  SAVINGS_CIRCLE_ABI,
  RANDOMNESS_ABI,
} from './contracts/abis';
import { verifyDraw } from './contracts/draw';

const publicClient = createPublicClient({
  chain: foundry,
  transport: http(ANVIL_RPC_URL),
});

const errorMessage = (error: unknown) => error instanceof BaseError ? error.shortMessage
  : error instanceof Error ? error.message : String(error);

const waitForSuccessfulTransaction = async (hash: `0x${string}`) => {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('La transacción fue revertida; el cambio no se realizó.');
  return receipt;
};

// Consulta un mismo bloque y evita pagar accidentalmente otra ronda al usar datos de pantalla antiguos.
const ensureRoundAcceptsPayments = async (circle: `0x${string}`, expectedRound: bigint) => {
  const blockNumber = await publicClient.getBlockNumber({ cacheTime: 0 });
  const [overview, rounds] = await Promise.all([
    publicClient.readContract({ address: circle, abi: SAVINGS_CIRCLE_ABI, functionName: 'getCircleOverview', blockNumber }),
    publicClient.readContract({ address: circle, abi: SAVINGS_CIRCLE_ABI, functionName: 'getAllRoundSummaries', blockNumber }),
  ]);
  if (overview[1] !== 1 || overview[2] !== expectedRound) {
    throw new Error('La ronda cambió o el círculo ya no está activo. Actualiza los datos antes de pagar.');
  }
  const round = rounds[Number(expectedRound) - 1];
  if (!round || overview[3] >= round.endTime) {
    throw new Error('El plazo de pago venció. Liquida la ronda para cubrir los impagos con la garantía.');
  }
};

interface CircleCardData {
  circleAddress: `0x${string}`;
  creator: `0x${string}`;
  name: string;
  payoutMode: number;
  state: number;
  contributionAmount: bigint;
  collateralAmount: bigint;
  maxParticipants: bigint;
  currentParticipants: bigint;
  currentRound: bigint;
  roundDuration: bigint;
  yieldRateBps: bigint;
  latePenaltyBps: bigint;
  vaultLockedPrincipal: bigint;
  totalYieldGenerated: bigint;
  totalPenaltiesCollected: bigint;
}

interface ParticipantData {
  account: `0x${string}`;
  joined: boolean;
  collateralBalance: bigint;
  principalSaved: bigint;
  onTimeShares: bigint;
  latePaymentsCount: bigint;
  defaultsCount: bigint;
  totalReceivedAtClose: bigint;
  turnPayoutReceived: bigint;
  assignedTurn: bigint;
}

interface RoundSummaryData {
  roundNumber: bigint;
  startTime: bigint;
  graceDeadline: bigint;
  endTime: bigint;
  paidCount: bigint;
  poolCollected: bigint;
  yieldGenerated: bigint;
  beneficiary: `0x${string}`;
  settled: boolean;
}

interface CircleDetailData {
  circleAddress: `0x${string}`;
  viewerAddress: `0x${string}`;
  selectionVersion: number;
  params: {
    name: string;
    contributionAmount: bigint;
    collateralAmount: bigint;
    maxParticipants: bigint;
    roundDuration: bigint;
    gracePeriod: bigint;
    latePenaltyBps: bigint;
    yieldRateBps: bigint;
    payoutMode: number;
  };
  state: number;
  currentRound: bigint;
  currentTime: bigint;
  participantsCount: bigint;
  vaultLockedPrincipal: bigint;
  totalYieldGenerated: bigint;
  totalPenaltiesCollected: bigint;
  totalOnTimeShares: bigint;
  verifiableSeed: `0x${string}`;
  participants: ParticipantData[];
  turnOrder: `0x${string}`[];
  roundStatuses: number[];
  roundSummaries: RoundSummaryData[];
  draw: { provider: `0x${string}`; demo: boolean; requestId: bigint; commitment: `0x${string}`;
    fulfilled: boolean; word: bigint; deadline: bigint };
}

interface UserRepStats {
  score: number;
  onTimePayments: number;
  latePayments: number;
  defaults: number;
  circlesJoined: number;
  circlesCompletedClean: number;
  totalSavedVolume: string;
  socialEndorsements: number;
}

export function App() {
  const [selectedWalletIndex, setSelectedWalletIndex] = useState<number>(0);
  const [useBrowserWallet, setUseBrowserWallet] = useState<boolean>(false);
  const [browserAddress, setBrowserAddress] = useState<`0x${string}` | null>(null);

  const [rpcConnected, setRpcConnected] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [txMessage, setTxMessage] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null);

  const [userBalance, setUserBalance] = useState<bigint>(0n);
  const [userRep, setUserRep] = useState<UserRepStats>({
    score: 500,
    onTimePayments: 0,
    latePayments: 0,
    defaults: 0,
    circlesJoined: 0,
    circlesCompletedClean: 0,
    totalSavedVolume: '0',
    socialEndorsements: 0,
  });

  const [circles, setCircles] = useState<CircleCardData[]>([]);
  const [selectedCircleAddr, setSelectedCircleAddr] = useState<`0x${string}` | null>(null);
  const [loadedCircleDetail, setCircleDetail] = useState<CircleDetailData | null>(null);
  const [memberScores, setMemberScores] = useState<Record<string, number>>({});

  // Modal de creación de nuevo círculo paramétrico
  const [showCreateModal, setShowCreateModal] = useState<boolean>(false);
  const [newCircleForm, setNewCircleForm] = useState({
    name: 'Cadena Comunitaria Cafeteros',
    payoutMode: 0, // 0 = ROSCA (Turnos), 1 = ASCA (Natillera Cierre)
    contributionAmount: '100',
    collateralAmount: '330',
    maxParticipants: '3',
    roundDurationDays: '7',
    gracePeriodDays: '3',
    latePenaltyPercent: '10',
    yieldRatePercent: '2',
  });

  const activeAddress: `0x${string}` =
    useBrowserWallet && browserAddress
      ? browserAddress
      : DEMO_WALLETS[selectedWalletIndex].address;

  // La selección invalida inmediatamente los datos anteriores, antes de que responda el RPC.
  const selection = useRef({ circle: selectedCircleAddr, viewer: activeAddress, version: 0 });
  if (selection.current.circle !== selectedCircleAddr || selection.current.viewer !== activeAddress) {
    selection.current = { circle: selectedCircleAddr, viewer: activeAddress, version: selection.current.version + 1 };
  }
  const circleDetail = loadedCircleDetail?.circleAddress === selectedCircleAddr &&
    loadedCircleDetail.viewerAddress === activeAddress && loadedCircleDetail.selectionVersion === selection.current.version
    ? loadedCircleDetail : null;
  const nextFetchId = useRef(0);
  const lastAppliedFetchId = useRef(0);

  const getWalletName = (addr: string) => {
    const found = DEMO_WALLETS.find((w) => w.address.toLowerCase() === addr.toLowerCase());
    if (found) return found.name;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const getActiveWalletClient = useCallback(async () => {
    if (useBrowserWallet && (window as unknown as { ethereum?: unknown }).ethereum) {
      return createWalletClient({
        account: activeAddress,
        chain: foundry,
        transport: custom((window as unknown as { ethereum: Parameters<typeof custom>[0] }).ethereum),
      });
    }
    const demoAccount = privateKeyToAccount(DEMO_WALLETS[selectedWalletIndex].privateKey);
    return createWalletClient({
      account: demoAccount,
      chain: foundry,
      transport: http(ANVIL_RPC_URL),
    });
  }, [useBrowserWallet, activeAddress, selectedWalletIndex]);

  const notify = (type: 'info' | 'success' | 'error', text: string) => {
    setTxMessage({ type, text });
    if (type !== 'info') {
      setTimeout(() => {
        setTxMessage((prev) => (prev?.text === text ? null : prev));
      }, 6000);
    }
  };

  const fetchAllData = useCallback(async () => {
    const selectionVersion = selection.current.version;
    const fetchId = ++nextFetchId.current;
    const isCurrent = () => selection.current.version === selectionVersion &&
      selection.current.circle === selectedCircleAddr && selection.current.viewer === activeAddress &&
      fetchId >= lastAppliedFetchId.current;
    try {
      await publicClient.getChainId();
      if (!isCurrent()) return;
      setRpcConnected(true);
      const blockNumber = await publicClient.getBlockNumber({ cacheTime: 0 });

      // 1. Balance y Reputación del usuario activo
      const [bal, repScore, repStats] = await Promise.all([
        publicClient.readContract({
          address: DEFAULT_ADDRESSES.stablecoin,
          abi: STABLECOIN_ABI,
          functionName: 'balanceOf',
          args: [activeAddress],
          blockNumber,
        }),
        publicClient.readContract({
          address: DEFAULT_ADDRESSES.reputation,
          abi: REPUTATION_ABI,
          functionName: 'getReputationScore',
          args: [activeAddress],
          blockNumber,
        }),
        publicClient.readContract({
          address: DEFAULT_ADDRESSES.reputation,
          abi: REPUTATION_ABI,
          functionName: 'getUserStats',
          args: [activeAddress],
          blockNumber,
        }),
      ]);

      if (!isCurrent()) return;
      setUserBalance(bal);
      setUserRep({
        score: Number(repScore),
        onTimePayments: Number(repStats.onTimePayments),
        latePayments: Number(repStats.latePayments),
        defaults: Number(repStats.defaults),
        circlesJoined: Number(repStats.circlesJoined),
        circlesCompletedClean: Number(repStats.circlesCompletedClean),
        totalSavedVolume: formatEther(repStats.totalSavedVolume),
        socialEndorsements: Number(repStats.socialEndorsements),
      });

      // 2. Lista de todos los círculos desde el Factory
      const rawCards = await publicClient.readContract({
        address: DEFAULT_ADDRESSES.factory,
        abi: FACTORY_ABI,
        functionName: 'getAllCircleCards',
        blockNumber,
      });
      if (!isCurrent()) return;

      const formattedCards: CircleCardData[] = rawCards.map((c) => ({
        circleAddress: c.circleAddress,
        creator: c.creator,
        name: c.name,
        payoutMode: Number(c.payoutMode),
        state: Number(c.state),
        contributionAmount: c.contributionAmount,
        collateralAmount: c.collateralAmount,
        maxParticipants: c.maxParticipants,
        currentParticipants: c.currentParticipants,
        currentRound: c.currentRound,
        roundDuration: c.roundDuration,
        yieldRateBps: c.yieldRateBps,
        latePenaltyBps: c.latePenaltyBps,
        vaultLockedPrincipal: c.vaultLockedPrincipal,
        totalYieldGenerated: c.totalYieldGenerated,
        totalPenaltiesCollected: c.totalPenaltiesCollected,
      }));

      setCircles(formattedCards);

      const targetCircle =
        selectedCircleAddr ||
        (formattedCards.length > 0 ? formattedCards[0].circleAddress : null);

      if (targetCircle && !selectedCircleAddr) {
        setSelectedCircleAddr(targetCircle);
        return; // La nueva selección dispara su propia carga.
      }

      if (targetCircle) {
        const [overview, participants, turnOrder, roundSummaries] = await Promise.all([
          publicClient.readContract({
            address: targetCircle,
            abi: SAVINGS_CIRCLE_ABI,
            functionName: 'getCircleOverview',
            blockNumber,
          }),
          publicClient.readContract({
            address: targetCircle,
            abi: SAVINGS_CIRCLE_ABI,
            functionName: 'getAllParticipantsInfo',
            blockNumber,
          }),
          publicClient.readContract({
            address: targetCircle,
            abi: SAVINGS_CIRCLE_ABI,
            functionName: 'getTurnOrder',
            blockNumber,
          }),
          publicClient.readContract({
            address: targetCircle,
            abi: SAVINGS_CIRCLE_ABI,
            functionName: 'getAllRoundSummaries',
            blockNumber,
          }),
        ]);
        if (!isCurrent()) return;

        const currentRoundNum = overview[2];
        let statuses: readonly number[] = [];
        if (currentRoundNum > 0n) {
          statuses = await publicClient.readContract({
            address: targetCircle,
            abi: SAVINGS_CIRCLE_ABI,
            functionName: 'getRoundStatuses',
            args: [currentRoundNum],
            blockNumber,
          });
        }

        // Cargar scores de reputación de todos los miembros de la mesa
        const scoresMap: Record<string, number> = {};
        await Promise.all(
          participants.map(async (p) => {
            const sc = await publicClient.readContract({
              address: DEFAULT_ADDRESSES.reputation,
              abi: REPUTATION_ABI,
              functionName: 'getReputationScore',
              args: [p.account],
              blockNumber,
            });
            scoresMap[p.account.toLowerCase()] = Number(sc);
          })
        );
        const draw = await publicClient.readContract({
          address: targetCircle, abi: SAVINGS_CIRCLE_ABI, functionName: 'getDrawDetails', blockNumber,
        });
        if (!isCurrent()) return;
        lastAppliedFetchId.current = fetchId;
        setMemberScores(scoresMap);
        setCircleDetail({
          circleAddress: targetCircle,
          viewerAddress: activeAddress,
          selectionVersion,
          params: {
            name: overview[0].name,
            contributionAmount: overview[0].contributionAmount,
            collateralAmount: overview[0].collateralAmount,
            maxParticipants: overview[0].maxParticipants,
            roundDuration: overview[0].roundDuration,
            gracePeriod: overview[0].gracePeriod,
            latePenaltyBps: overview[0].latePenaltyBps,
            yieldRateBps: overview[0].yieldRateBps,
            payoutMode: Number(overview[0].payoutMode),
          },
          state: Number(overview[1]),
          currentRound: overview[2],
          currentTime: overview[3],
          participantsCount: overview[4],
          vaultLockedPrincipal: overview[5],
          totalYieldGenerated: overview[6],
          totalPenaltiesCollected: overview[7],
          totalOnTimeShares: overview[8],
          verifiableSeed: overview[9],
          participants: participants.map((p) => ({ ...p })),
          turnOrder: [...turnOrder],
          roundStatuses: statuses.map((s) => Number(s)),
          roundSummaries: roundSummaries.map((r) => ({ ...r })),
          draw: { provider: draw[0], demo: draw[1], requestId: draw[2], commitment: draw[3],
            fulfilled: draw[4], word: draw[5], deadline: draw[6] },
        });
      }
    } catch (err) {
      if (!isCurrent()) return;
      console.error('Error conectando a Anvil:', err);
      setRpcConnected(false);
      setCircleDetail(null);
    }
  }, [activeAddress, selectedCircleAddr]);

  useEffect(() => {
    fetchAllData();
    const interval = setInterval(fetchAllData, 4000);
    return () => clearInterval(interval);
  }, [fetchAllData]);

  // ===========================================================================
  // Acciones en Blockchain
  // ===========================================================================

  const handleFaucet = async () => {
    try {
      setLoading(true);
      notify('info', 'Solicitando 1,000 cUSD del Faucet...');
      const wallet = await getActiveWalletClient();
      const hash = await wallet.writeContract({
        address: DEFAULT_ADDRESSES.stablecoin,
        abi: STABLECOIN_ABI,
        functionName: 'faucet',
        args: [activeAddress, parseEther('1000')],
      });
      await waitForSuccessfulTransaction(hash);
      notify('success', '¡+1,000 cUSD acreditados en tu billetera!');
      await fetchAllData();
    } catch (e: unknown) {
      notify('error', `Error en Faucet: ${errorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCircle = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setLoading(true);
      notify('info', 'Desplegando nuevo contrato SavingsCircle desde Factory...');
      const wallet = await getActiveWalletClient();

      const params = {
        name: newCircleForm.name,
        contributionAmount: parseEther(newCircleForm.contributionAmount || '100'),
        collateralAmount: parseEther(newCircleForm.collateralAmount || '330'),
        maxParticipants: BigInt(newCircleForm.maxParticipants || '3'),
        roundDuration: BigInt(Math.round(Number(newCircleForm.roundDurationDays || '7') * 86400)),
        gracePeriod: BigInt(Math.round(Number(newCircleForm.gracePeriodDays || '3') * 86400)),
        latePenaltyBps: BigInt(Math.round(Number(newCircleForm.latePenaltyPercent || '10') * 100)),
        yieldRateBps: BigInt(Math.round(Number(newCircleForm.yieldRatePercent || '2') * 100)),
        payoutMode: Number(newCircleForm.payoutMode),
      };
      const minimumCollateral = params.maxParticipants *
        (params.contributionAmount + params.contributionAmount * params.latePenaltyBps / 10_000n);
      if (params.collateralAmount < minimumCollateral) {
        throw new Error(`La garantía mínima para cubrir el ciclo completo es ${formatEther(minimumCollateral)} cUSD.`);
      }

      const hash = await wallet.writeContract({
        address: DEFAULT_ADDRESSES.factory,
        abi: FACTORY_ABI,
        functionName: 'createCircle',
        args: [params],
      });
      await waitForSuccessfulTransaction(hash);

      setShowCreateModal(false);
      notify('success', `¡Círculo "${newCircleForm.name}" creado e inscrito en la bóveda!`);
      await fetchAllData();
      // Seleccionar el nuevo círculo recién creado
      const updatedCircles = await publicClient.readContract({
        address: DEFAULT_ADDRESSES.factory,
        abi: FACTORY_ABI,
        functionName: 'getAllCircles',
      });
      if (updatedCircles.length > 0) {
        setSelectedCircleAddr(updatedCircles[updatedCircles.length - 1]);
      }
    } catch (e: unknown) {
      notify('error', `Error al crear círculo: ${errorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleJoinCircle = async () => {
    if (!selectedCircleAddr || !circleDetail) return;
    try {
      setLoading(true);
      notify('info', 'Aprobando garantía cUSD y uniéndose al círculo...');
      const wallet = await getActiveWalletClient();

      const approveHash = await wallet.writeContract({
        address: DEFAULT_ADDRESSES.stablecoin,
        abi: STABLECOIN_ABI,
        functionName: 'approve',
        args: [selectedCircleAddr, parseEther('100000')],
      });
      await waitForSuccessfulTransaction(approveHash);

      const joinHash = await wallet.writeContract({
        address: selectedCircleAddr,
        abi: SAVINGS_CIRCLE_ABI,
        functionName: 'joinCircle',
      });
      await waitForSuccessfulTransaction(joinHash);

      notify('success', '¡Inscripción exitosa! Garantía depositada en el MockYieldVault.');
      await fetchAllData();
    } catch (e: unknown) {
      notify('error', `Error al unirse: ${errorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  };

  // Función de 1-Click Demo para inscribir a todas las cuentas de prueba restantes y disparar el sorteo verificable
  const handleQuickFillParticipants = async () => {
    if (!selectedCircleAddr || !circleDetail) return;
    try {
      setLoading(true);
      notify('info', 'Inscribiendo participantes. El sorteo esperará una respuesta de aleatoriedad separada...');

      const joinedSet = new Set(circleDetail.participants.map((p) => p.account.toLowerCase()));
      const needed = Number(circleDetail.params.maxParticipants) - circleDetail.participants.length;
      let added = 0;

      for (const demoW of DEMO_WALLETS) {
        if (added >= needed) break;
        if (!joinedSet.has(demoW.address.toLowerCase())) {
          const wClient = createWalletClient({
            account: privateKeyToAccount(demoW.privateKey),
            chain: foundry,
            transport: http(ANVIL_RPC_URL),
          });
          const appHash = await wClient.writeContract({
            address: DEFAULT_ADDRESSES.stablecoin,
            abi: STABLECOIN_ABI,
            functionName: 'approve',
            args: [selectedCircleAddr, parseEther('100000')],
          });
          await waitForSuccessfulTransaction(appHash);

          const jHash = await wClient.writeContract({
            address: selectedCircleAddr,
            abi: SAVINGS_CIRCLE_ABI,
            functionName: 'joinCircle',
          });
          await waitForSuccessfulTransaction(jHash);
          added++;
        }
      }

      notify('success', added === needed
        ? '¡Cupo completado! Lista cerrada; solicitud de aleatoriedad registrada.'
        : `Se inscribieron ${added} participantes de demo; faltan ${needed - added} cupos.`);
      await fetchAllData();
    } catch (e: unknown) {
      notify('error', `Error al autocompletar cupos: ${errorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePayContribution = async () => {
    if (!selectedCircleAddr || !circleDetail) return;
    try {
      setLoading(true);
      await ensureRoundAcceptsPayments(selectedCircleAddr, circleDetail.currentRound);
      notify('info', `Pagando cuota de la Ronda #${circleDetail.currentRound.toString()}...`);
      const wallet = await getActiveWalletClient();
      const maximumPayment = circleDetail.params.contributionAmount +
        circleDetail.params.contributionAmount * circleDetail.params.latePenaltyBps / 10_000n;

      const allowance = await publicClient.readContract({
        address: DEFAULT_ADDRESSES.stablecoin,
        abi: STABLECOIN_ABI,
        functionName: 'allowance',
        args: [activeAddress, selectedCircleAddr],
      });

      if (allowance < maximumPayment) {
        const appHash = await wallet.writeContract({
          address: DEFAULT_ADDRESSES.stablecoin,
          abi: STABLECOIN_ABI,
          functionName: 'approve',
          args: [selectedCircleAddr, maximumPayment],
        });
        await waitForSuccessfulTransaction(appHash);
      }

      await ensureRoundAcceptsPayments(selectedCircleAddr, circleDetail.currentRound);
      const payHash = await wallet.writeContract({
        address: selectedCircleAddr,
        abi: SAVINGS_CIRCLE_ABI,
        functionName: 'payContribution',
      });
      await waitForSuccessfulTransaction(payHash);

      notify('success', `¡Aporte de la Ronda #${circleDetail.currentRound.toString()} registrado en la bóveda!`);
    } catch (e: unknown) {
      notify('error', `Error al pagar cuota: ${errorMessage(e)}`);
    } finally {
      await fetchAllData();
      setLoading(false);
    }
  };

  // Solo controla las cuentas locales del selector; las billeteras externas pagan individualmente.
  const handleQuickPayAllPending = async () => {
    if (!selectedCircleAddr || !circleDetail) return;
    let paid = 0;
    try {
      setLoading(true);
      await ensureRoundAcceptsPayments(selectedCircleAddr, circleDetail.currentRound);
      notify('info', 'Procesando los aportes pendientes de las cuentas de demo...');
      const statuses = await publicClient.readContract({ address: selectedCircleAddr,
        abi: SAVINGS_CIRCLE_ABI, functionName: 'getRoundStatuses', args: [circleDetail.currentRound] });
      const maximumPayment = circleDetail.params.contributionAmount +
        circleDetail.params.contributionAmount * circleDetail.params.latePenaltyBps / 10_000n;

      for (let i = 0; i < circleDetail.participants.length; i++) {
        const p = circleDetail.participants[i];
        const status = statuses[i];
        if (status === 0) {
          const demoW = DEMO_WALLETS.find(
            (w) => w.address.toLowerCase() === p.account.toLowerCase()
          );
          if (demoW) {
            await ensureRoundAcceptsPayments(selectedCircleAddr, circleDetail.currentRound);
            const wClient = createWalletClient({
              account: privateKeyToAccount(demoW.privateKey),
              chain: foundry,
              transport: http(ANVIL_RPC_URL),
            });
            const allowance = await publicClient.readContract({ address: DEFAULT_ADDRESSES.stablecoin,
              abi: STABLECOIN_ABI, functionName: 'allowance', args: [demoW.address, selectedCircleAddr] });
            if (allowance < maximumPayment) {
              const approveHash = await wClient.writeContract({ address: DEFAULT_ADDRESSES.stablecoin,
                abi: STABLECOIN_ABI, functionName: 'approve', args: [selectedCircleAddr, maximumPayment] });
              await waitForSuccessfulTransaction(approveHash);
            }
            await ensureRoundAcceptsPayments(selectedCircleAddr, circleDetail.currentRound);
            const payHash = await wClient.writeContract({
              address: selectedCircleAddr,
              abi: SAVINGS_CIRCLE_ABI,
              functionName: 'payContribution',
            });
            await waitForSuccessfulTransaction(payHash);
            paid++;
          }
        }
      }

      const updatedStatuses = await publicClient.readContract({ address: selectedCircleAddr,
        abi: SAVINGS_CIRCLE_ABI, functionName: 'getRoundStatuses', args: [circleDetail.currentRound] });
      const pending = updatedStatuses.filter(status => status === 0).length;
      const confirmation = paid === 1 ? 'Se confirmó 1 aporte de demo.' : `Se confirmaron ${paid} aportes de demo.`;
      notify(pending === 0 ? 'success' : 'info', pending === 0
        ? `${confirmation} Todos los pagos de la ronda están completos.`
        : `${confirmation} ${pending === 1 ? 'Queda 1 participante pendiente' : `Quedan ${pending} participantes pendientes`}; las billeteras externas deben pagar individualmente.`);
    } catch (e: unknown) {
      notify('error', `Pago grupal interrumpido tras ${paid} aportes confirmados: ${errorMessage(e)}`);
    } finally {
      await fetchAllData();
      setLoading(false);
    }
  };

  const handleSettleRound = async () => {
    if (!selectedCircleAddr || !circleDetail) return;
    try {
      setLoading(true);
      notify('info', 'Acreditando rendimiento base en MockYieldVault y ejecutando desembolso automático...');
      const wallet = await getActiveWalletClient();

      const hash = await wallet.writeContract({
        address: selectedCircleAddr,
        abi: SAVINGS_CIRCLE_ABI,
        functionName: 'settleCurrentRound',
      });
      await waitForSuccessfulTransaction(hash);

      const isLastRound = circleDetail.currentRound === circleDetail.params.maxParticipants;
      notify(
        'success',
        isLastRound
          ? '¡Ciclo finalizado! Garantías y capital devueltos; premios repartidos según los puntos de puntualidad o por igual si nadie tiene puntos.'
          : `¡Ronda #${circleDetail.currentRound.toString()} liquidada! ${circleDetail.params.payoutMode === 0 ? 'Pozo desembolsado.' : 'Aportes acumulados para el cierre.'}`
      );
      await fetchAllData();
    } catch (e: unknown) {
      notify('error', `Error al liquidar ronda: ${errorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAdvanceTime = async (seconds: bigint, label: string) => {
    if (!selectedCircleAddr) return;
    try {
      setLoading(true);
      notify('info', `Simulando avance de tiempo: ${label}...`);
      if (await publicClient.getChainId() !== 31337) throw new Error('El avance de tiempo solo está disponible en Anvil local.');
      const localNode = createTestClient({ mode: 'anvil', chain: foundry, transport: http(ANVIL_RPC_URL) });
      await localNode.increaseTime({ seconds: Number(seconds) });
      await localNode.mine({ blocks: 1 });
      notify('success', `Tiempo del nodo local avanzado (${label}).`);
      await fetchAllData();
    } catch (e: unknown) {
      notify('error', `Error al avanzar tiempo: ${errorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleFinalizeDraw = async () => {
    if (!selectedCircleAddr || !circleDetail) return;
    try {
      setLoading(true);
      const wallet = await getActiveWalletClient();
      if (circleDetail.draw.demo && !circleDetail.draw.fulfilled) {
        if (await publicClient.getChainId() !== 31337) throw new Error('Proveedor simulado permitido solo en Anvil.');
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        const word = BigInt(`0x${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`);
        const response = await wallet.writeContract({ address: circleDetail.draw.provider,
          abi: RANDOMNESS_ABI, functionName: 'fulfill', args: [circleDetail.draw.requestId, word] });
        await waitForSuccessfulTransaction(response);
      }
      const hash = await wallet.writeContract({ address: selectedCircleAddr,
        abi: SAVINGS_CIRCLE_ABI, functionName: 'finalizeDraw' });
      await waitForSuccessfulTransaction(hash);
      notify('success', 'Orden fijado una sola vez. Ronda #1 iniciada.');
      await fetchAllData();
    } catch (e) { notify('error', `No se pudo finalizar: ${(e as Error).message}`); }
    finally { setLoading(false); }
  };

  const handleCancelOrRefund = async (refund: boolean) => {
    if (!selectedCircleAddr) return;
    try {
      setLoading(true);
      const wallet = await getActiveWalletClient();
      const hash = await wallet.writeContract({ address: selectedCircleAddr, abi: SAVINGS_CIRCLE_ABI,
        functionName: refund ? 'claimCancelledCollateral' : 'cancelUnfilledCircle' });
      await waitForSuccessfulTransaction(hash);
      notify('success', refund ? 'Garantía devuelta.' : 'Inscripción vencida cancelada; cada miembro puede recuperar su garantía.');
      await fetchAllData();
    } catch (e) { notify('error', (e as Error).message); }
    finally { setLoading(false); }
  };

  const handleVerifyDraw = () => {
    if (!selectedCircleAddr || !circleDetail) return;
    const d = circleDetail;
    const valid = verifyDraw(BigInt(foundry.id), selectedCircleAddr, d.params, d.participants.map(p => p.account),
      d.draw.commitment, d.draw.requestId, d.draw.word, d.verifiableSeed, d.turnOrder);
    notify(valid ? 'success' : 'error', valid
      ? `Compromiso, semilla y orden coinciden con el cálculo independiente.${d.draw.demo ? ' La fuente es simulada, sin prueba VRF.' : ' Revisar también la entrega del coordinador VRF.'}`
      : 'La evidencia del sorteo no coincide con el cálculo independiente.');
  };

  const handleVouch = async (candidateAddress: `0x${string}`) => {
    try {
      setLoading(true);
      notify('info', `Registrando aval social comunitario para ${getWalletName(candidateAddress)}...`);
      const wallet = await getActiveWalletClient();

      const hash = await wallet.writeContract({
        address: DEFAULT_ADDRESSES.reputation,
        abi: REPUTATION_ABI,
        functionName: 'vouchForMember',
        args: [candidateAddress],
      });
      await waitForSuccessfulTransaction(hash);

      notify('success', `¡Aval social registrado! El puntaje crediticio de ${getWalletName(candidateAddress)} subió +15 pts.`);
      await fetchAllData();
    } catch (e: unknown) {
      notify('error', `No se pudo avalar: ${errorMessage(e)}`);
    } finally {
      setLoading(false);
    }
  };

  const connectBrowserWallet = async () => {
    const eth = (window as unknown as { ethereum?: { request: (args: { method: string }) => Promise<string[]> } }).ethereum;
    if (!eth) {
      notify('error', 'No se detectó MetaMask en el navegador. Puedes usar el selector de participantes integrado arriba.');
      return;
    }
    try {
      const accounts = await eth.request({ method: 'eth_requestAccounts' });
      if (accounts && accounts.length > 0) {
        setBrowserAddress(accounts[0] as `0x${string}`);
        setUseBrowserWallet(true);
        notify('success', `Billetera MetaMask conectada: ${accounts[0]}`);
      }
    } catch (e: unknown) {
      notify('error', `Error conectando MetaMask: ${(e as Error).message}`);
    }
  };

  // Cálculos de estado de tiempo en la ronda activa
  const currentRoundSummary =
    circleDetail && circleDetail.currentRound > 0n
      ? circleDetail.roundSummaries[Number(circleDetail.currentRound) - 1]
      : null;

  const isGraceWindow =
    circleDetail && currentRoundSummary
      ? circleDetail.currentTime <= currentRoundSummary.graceDeadline
      : true;

  const isRoundExpired =
    circleDetail && currentRoundSummary
      ? circleDetail.currentTime >= currentRoundSummary.endTime
      : false;

  const activeUserParticipantIndex = circleDetail
    ? circleDetail.participants.findIndex(
        (p) => p.account.toLowerCase() === activeAddress.toLowerCase()
      )
    : -1;

  const activeUserJoined = activeUserParticipantIndex !== -1;
  const activeUserRoundStatus =
    activeUserJoined && circleDetail
      ? circleDetail.roundStatuses[activeUserParticipantIndex]
      : 0;

  const allPaidInCurrentRound =
    circleDetail && currentRoundSummary
      ? currentRoundSummary.paidCount === circleDetail.params.maxParticipants
      : false;

  const pendingDemoParticipantsCount = circleDetail
    ? circleDetail.participants.filter((p, i) => circleDetail.roundStatuses[i] === 0 &&
      DEMO_WALLETS.some(w => w.address.toLowerCase() === p.account.toLowerCase())).length
    : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header Principal */}
      <header className="border-b border-slate-800/80 bg-slate-900/75 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-950/60">
              <ShieldCheck className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white">NatiChain Protocol</h1>
                <span className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  Proyecto #3 • Microfinanzas
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Círculos de Ahorro Comunitario (Natilleras & Cadenas) con Bóveda Inmutable, Reglas Anti-Mora y Sorteo Verificable
              </p>
            </div>
          </div>

          {/* Estado RPC y Billetera Activa */}
          <div className="flex flex-wrap items-center gap-3">
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border ${
                rpcConnected
                  ? 'bg-emerald-950/50 border-emerald-700/50 text-emerald-300'
                  : 'bg-rose-950/50 border-rose-700/50 text-rose-300'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  rpcConnected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'
                }`}
              />
              {rpcConnected ? 'Foundry Anvil (Local EVM)' : 'Desconectado de Anvil (8545)'}
            </div>

            <div className="flex items-center gap-2 bg-slate-800/90 border border-slate-700/80 rounded-xl px-3 py-1.5">
              <Coins className="w-4 h-4 text-amber-400" />
              <div className="text-xs">
                <span className="text-slate-400 mr-1.5">Saldo:</span>
                <span className="font-bold text-white">
                  {Number(formatEther(userBalance)).toLocaleString('es-CO', {
                    maximumFractionDigits: 2,
                  })}{' '}
                  cUSD
                </span>
              </div>
              <button
                onClick={handleFaucet}
                disabled={loading}
                className="ml-2 px-2 py-0.5 text-[11px] font-semibold rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 transition"
                title="Obtener 1,000 cUSD de prueba gratis"
              >
                + Faucet
              </button>
            </div>

            <div className="flex items-center gap-2 bg-slate-800/90 border border-slate-700/80 rounded-xl px-3 py-1.5">
              <Award className="w-4 h-4 text-indigo-400" />
              <div className="text-xs">
                <span className="text-slate-400 mr-1.5">Score Berkeley:</span>
                <span className="font-bold text-indigo-300">{userRep.score} / 1000</span>
              </div>
            </div>
          </div>
        </div>

        {/* Barra de Cambio Rápido de Participante (Modo Demo Multi-Agente) */}
        <div className="bg-slate-900/95 border-t border-slate-800/70">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Users className="w-3.5 h-3.5 text-emerald-400" />
              <span className="font-medium text-slate-300">Simulador Multi-Participante (1-Click Switch):</span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {DEMO_WALLETS.map((w, idx) => {
                const isSelected = !useBrowserWallet && selectedWalletIndex === idx;
                return (
                  <button
                    key={w.address}
                    onClick={() => {
                      setUseBrowserWallet(false);
                      setSelectedWalletIndex(idx);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition flex items-center gap-1.5 border ${
                      isSelected
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50 shadow-sm'
                        : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:bg-slate-800 hover:text-slate-200'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full bg-gradient-to-r ${w.avatarColor}`} />
                    <span>{w.name.split(' ')[0]}</span>
                    <span className="text-[10px] opacity-70">({w.address.slice(0, 5)}..)</span>
                  </button>
                );
              })}

              <button
                onClick={connectBrowserWallet}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition flex items-center gap-1.5 border ${
                  useBrowserWallet
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                    : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                <Wallet className="w-3 h-3" />
                {useBrowserWallet && browserAddress
                  ? `MetaMask (${browserAddress.slice(0, 6)}...)`
                  : 'Conectar MetaMask'}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Banner de Notificaciones de Transacción */}
      {txMessage && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-4 w-full">
          <div
            className={`px-4 py-3 rounded-xl border flex items-center justify-between text-sm ${
              txMessage.type === 'success'
                ? 'bg-emerald-950/70 border-emerald-600/60 text-emerald-200'
                : txMessage.type === 'error'
                ? 'bg-rose-950/70 border-rose-600/60 text-rose-200'
                : 'bg-indigo-950/70 border-indigo-600/60 text-indigo-200'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {txMessage.type === 'info' && <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />}
              {txMessage.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
              {txMessage.type === 'error' && <AlertTriangle className="w-4 h-4 text-rose-400" />}
              <span>{txMessage.text}</span>
            </div>
            <button
              onClick={() => setTxMessage(null)}
              className="text-xs opacity-70 hover:opacity-100 ml-4"
            >
              Cerrar
            </button>
          </div>
        </div>
      )}

      {/* Contenido Principal */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex-1 w-full grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Columna Izquierda: Catálogo de Círculos y Perfil Reputacional */}
        <div className="lg:col-span-4 space-y-6">
          {/* Tarjeta de Círculos Disponibles */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-emerald-400" />
                  Círculos de Ahorro
                </h2>
                <p className="text-xs text-slate-400">
                  Selecciona un círculo o crea uno nuevo paramétrico
                </p>
              </div>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-emerald-950/50 transition"
              >
                <PlusCircle className="w-3.5 h-3.5" />
                Crear Círculo
              </button>
            </div>

            <div className="space-y-3">
              {circles.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-sm">
                  No hay círculos desplegados aún.
                </div>
              ) : (
                circles.map((c) => {
                  const isSelected =
                    selectedCircleAddr?.toLowerCase() === c.circleAddress.toLowerCase();
                  return (
                    <button
                      key={c.circleAddress}
                      onClick={() => setSelectedCircleAddr(c.circleAddress)}
                      className={`w-full text-left p-3.5 rounded-xl border transition ${
                        isSelected
                          ? 'bg-slate-800/95 border-emerald-500/70 shadow-md shadow-emerald-950/30'
                          : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700 hover:bg-slate-900'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span className="font-semibold text-sm text-white leading-snug">
                          {c.name}
                        </span>
                        <span
                          className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full shrink-0 ${
                            c.state === 0
                              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                              : c.state === 1
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/30'
                          }`}
                        >
                          {c.state === 0 ? 'Abierta' : c.state === 1 ? `Ronda ${c.currentRound.toString()}/${c.maxParticipants.toString()}` : c.state === 3 ? 'Sorteo pendiente' : c.state === 4 ? 'Cancelada' : 'Finalizada'}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400 mb-2.5">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">
                          {c.payoutMode === 0 ? '🔄 Por Turnos (Cadena)' : '🏦 Al Cierre (Natillera)'}
                        </span>
                        <span>•</span>
                        <span>
                          Cuota:{' '}
                          <strong className="text-slate-200">
                            {formatEther(c.contributionAmount)} cUSD
                          </strong>
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/80 text-[11px]">
                        <div>
                          <span className="text-slate-500 block">Cupos</span>
                          <span className="font-semibold text-slate-200">
                            {c.currentParticipants.toString()} / {c.maxParticipants.toString()}
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">TVL Bóveda</span>
                          <span className="font-semibold text-emerald-400">
                            {Number(formatEther(c.vaultLockedPrincipal)).toFixed(0)} cUSD
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-500 block">Yield Base</span>
                          <span className="font-semibold text-amber-300">
                            {(Number(c.yieldRateBps) / 100).toFixed(1)}% / ronda
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Tarjeta de Reputación Crediticia (Berkeley Paper) */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Award className="w-4 h-4 text-indigo-400" />
                Pasaporte de Reputación On-Chain
              </h3>
              <span className="text-[11px] px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 font-medium">
                {getWalletName(activeAddress)}
              </span>
            </div>
            <p className="text-xs text-slate-400 mb-4">
              Inspirado en <em>Good Reputation (UC Berkeley)</em>: historial de pagos verificable y respaldo de red social para acceso a microcrédito.
            </p>

            <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-3.5 mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-slate-400">Puntaje Crediticio Comunitario</span>
                <span className="text-lg font-extrabold text-indigo-400">
                  {userRep.score} <span className="text-xs font-normal text-slate-500">/ 1000</span>
                </span>
              </div>
              <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-emerald-400 transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(10, userRep.score / 10))}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="bg-slate-950/60 border border-slate-800/70 rounded-lg p-2.5">
                <span className="text-slate-400 block">Pagos Puntuales</span>
                <span className="text-sm font-bold text-emerald-400">
                  {userRep.onTimePayments} (+{userRep.onTimePayments * 25} pts)
                </span>
              </div>
              <div className="bg-slate-950/60 border border-slate-800/70 rounded-lg p-2.5">
                <span className="text-slate-400 block">Pagos en Mora</span>
                <span className="text-sm font-bold text-amber-400">
                  {userRep.latePayments} (-{userRep.latePayments * 40} pts)
                </span>
              </div>
              <div className="bg-slate-950/60 border border-slate-800/70 rounded-lg p-2.5">
                <span className="text-slate-400 block">Avales Sociales</span>
                <span className="text-sm font-bold text-indigo-300">
                  {userRep.socialEndorsements} respaldos
                </span>
              </div>
              <div className="bg-slate-950/60 border border-slate-800/70 rounded-lg p-2.5">
                <span className="text-slate-400 block">Incumplimientos</span>
                <span className="text-sm font-bold text-rose-400">
                  {userRep.defaults} defaults
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Columna Derecha: Panel Operativo de la Bóveda Inmutable */}
        <div className="lg:col-span-8 space-y-6">
          {!circleDetail ? (
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-12 text-center">
              <p className="text-slate-400" role="status">
                {selectedCircleAddr
                  ? rpcConnected ? 'Cargando datos del círculo seleccionado…' : 'No se pudieron cargar los datos. Comprueba el nodo y reintenta.'
                  : 'Selecciona o crea un círculo de ahorro para ver su bóveda inteligente.'}
              </p>
              {selectedCircleAddr && !rpcConnected && (
                <button onClick={fetchAllData} className="mt-3 px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs">
                  Reintentar carga
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Cabecera del Círculo Seleccionado + KPIs de la Bóveda */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl">
                <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
                  <div>
                    <div className="flex flex-wrap items-center gap-2.5 mb-1">
                      <h2 className="text-xl font-bold text-white">{circleDetail.params.name}</h2>
                      <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-800 text-emerald-300 border border-emerald-500/30">
                        {circleDetail.params.payoutMode === 0
                          ? '🔄 Modalidad Por Turnos (Cadena / ROSCA)'
                          : '🏦 Modalidad Al Cierre del Ciclo (Natillera / ASCA)'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 font-mono">
                      Contrato Bóveda Inmutable: {circleDetail.circleAddress}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${
                        circleDetail.state === 0
                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                          : circleDetail.state === 1
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                          : 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40'
                      }`}
                    >
                      {circleDetail.state === 0
                        ? '1. Inscripción Abierta'
                        : circleDetail.state === 1
                        ? `2. En Curso — Ronda #${circleDetail.currentRound.toString()} de ${circleDetail.params.maxParticipants.toString()}`
                        : circleDetail.state === 3 ? 'Esperando sorteo'
                        : circleDetail.state === 4 ? 'Cancelada — Garantías reembolsables'
                        : '3. Ciclo Completado y Liquidado'}
                    </span>
                  </div>
                </div>

                {/* 4 Métricas Clave de la Bóveda */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                  <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-3.5">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                      <span>Saldo Bloqueado (Vault)</span>
                      <Lock className="w-3.5 h-3.5 text-emerald-400" />
                    </div>
                    <div className="text-lg font-bold text-white">
                      {formatEther(circleDetail.vaultLockedPrincipal)} <span className="text-xs font-normal text-slate-400">cUSD</span>
                    </div>
                    <span className="text-[11px] text-slate-500">
                      Custodiado sin tesorero humano
                    </span>
                  </div>

                  <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-3.5">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                      <span>Rendimiento Base</span>
                      <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
                    </div>
                    <div className="text-lg font-bold text-amber-300">
                      +{formatEther(circleDetail.totalYieldGenerated)} <span className="text-xs font-normal text-slate-400">cUSD</span>
                    </div>
                    <span className="text-[11px] text-slate-500">
                      Tasa: {(Number(circleDetail.params.yieldRateBps) / 100).toFixed(1)}% por ronda
                    </span>
                  </div>

                  <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-3.5">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                      <span>Pozo Multas Anti-Mora</span>
                      <Sparkles className="w-3.5 h-3.5 text-rose-400" />
                    </div>
                    <div className="text-lg font-bold text-rose-300">
                      +{formatEther(circleDetail.totalPenaltiesCollected)} <span className="text-xs font-normal text-slate-400">cUSD</span>
                    </div>
                    <span className="text-[11px] text-slate-500">
                      Recargo mora: {(Number(circleDetail.params.latePenaltyBps) / 100).toFixed(1)}%
                    </span>
                  </div>

                  <div className="bg-slate-950/80 border border-slate-800/90 rounded-xl p-3.5">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                      <span>Cuota / Garantía</span>
                      <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                    </div>
                    <div className="text-lg font-bold text-indigo-300">
                      {formatEther(circleDetail.params.contributionAmount)} / {formatEther(circleDetail.params.collateralAmount)}
                    </div>
                    <span className="text-[11px] text-slate-500">
                      cUSD cuota / cUSD colateral
                    </span>
                  </div>
                </div>

                {/* Zona de Acciones Principales según el estado del círculo */}
                {circleDetail.state === 0 && (
                  <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border border-amber-500/30 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h3 className="text-sm font-bold text-white mb-1">
                        Fase de Inscripción ({circleDetail.participantsCount.toString()} de{' '}
                        {circleDetail.params.maxParticipants.toString()} participantes unidos)
                      </h3>
                      <p className="text-xs text-slate-400">
                        Al inscribirte depositas{' '}
                        <strong className="text-slate-200">
                          {formatEther(circleDetail.params.collateralAmount)} cUSD
                        </strong>{' '}
                        de garantía reembolsable. Al completar el cupo se cierra la lista y se solicita{' '}
                        <strong className="text-emerald-300">aleatoriedad en una transacción separada</strong>.
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                      {!activeUserJoined ? (
                        <button
                          onClick={handleJoinCircle}
                          disabled={loading || circleDetail.currentTime >= circleDetail.draw.deadline}
                          className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-950/50 transition"
                        >
                          <UserCheck className="w-4 h-4" />
                          Unirme con {getWalletName(activeAddress).split(' ')[0]} ({formatEther(circleDetail.params.collateralAmount)} cUSD)
                        </button>
                      ) : (
                        <span className="px-3 py-2 rounded-xl bg-emerald-950/60 border border-emerald-600/40 text-emerald-300 text-xs font-semibold flex items-center gap-1.5">
                          <CheckCircle2 className="w-4 h-4" />
                          {getWalletName(activeAddress).split(' ')[0]} ya está inscrito(a)
                        </span>
                      )}

                      <button
                        onClick={handleQuickFillParticipants}
                        disabled={loading || circleDetail.currentTime >= circleDetail.draw.deadline}
                        className="px-3.5 py-2.5 rounded-xl bg-indigo-600/25 hover:bg-indigo-600/40 border border-indigo-500/40 text-indigo-200 text-xs font-semibold flex items-center gap-1.5 transition"
                        title="Completa las inscripciones con cuentas de Anvil; el sorteo se finaliza por separado"
                      >
                        <Shuffle className="w-4 h-4 text-indigo-400" />
                        Autocompletar Cupos (Demo)
                      </button>
                    </div>
                  </div>
                )}

                {circleDetail.state === 0 && circleDetail.currentTime >= circleDetail.draw.deadline && (
                  <button onClick={() => handleCancelOrRefund(false)} disabled={loading} className="px-4 py-2 text-amber-300 border rounded-xl">
                    Cancelar inscripción vencida y habilitar devoluciones
                  </button>
                )}
                {circleDetail.state === 4 && activeUserJoined && (
                  <button onClick={() => handleCancelOrRefund(true)} disabled={loading || circleDetail.participants.find(p => p.account.toLowerCase() === activeAddress.toLowerCase())?.collateralBalance === 0n} className="px-4 py-2 text-emerald-300 border rounded-xl">
                    Recuperar mi garantía
                  </button>
                )}
                {circleDetail.state === 3 && (
                  <div className="border border-amber-500/40 rounded-xl p-4 space-y-3">
                    <h3 className="font-bold text-white">Inscripciones cerradas · Sorteo pendiente</h3>
                    <p className="text-sm text-slate-300">{circleDetail.draw.demo
                      ? 'Demo local sin proveedor externo: la respuesta se simula y quien la envía puede escogerla. Se verifica el cálculo del orden; no se garantiza imparcialidad de la fuente.'
                      : 'Esperando la respuesta del coordinador VRF. Los participantes y las reglas ya están fijados.'}</p>
                    <p className="text-xs font-mono break-all text-slate-400">Solicitud: {circleDetail.draw.requestId.toString()} · Compromiso: {circleDetail.draw.commitment}</p>
                    <button onClick={handleFinalizeDraw} disabled={loading || (!circleDetail.draw.demo && !circleDetail.draw.fulfilled)}
                      className="px-4 py-2 rounded-xl bg-emerald-600 disabled:opacity-50 text-white">
                      {circleDetail.draw.demo && !circleDetail.draw.fulfilled ? 'Simular respuesta y finalizar (Demo)' : 'Finalizar sorteo recibido'}
                    </button>
                  </div>
                )}

                {circleDetail.state === 1 && currentRoundSummary && (
                  <div className="space-y-4">
                    {/* Barra de Estado de la Ronda Actual y Ventana Anti-Mora */}
                    <div className="bg-slate-950/90 border border-slate-800 rounded-xl p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                        <div className="flex items-center gap-2.5">
                          <Clock className="w-4 h-4 text-emerald-400" />
                          <span className="text-sm font-bold text-white">
                            Ronda Activa #{circleDetail.currentRound.toString()} de{' '}
                            {circleDetail.params.maxParticipants.toString()}
                          </span>
                          {isGraceWindow && !isRoundExpired && (
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              ✓ Ventana Puntual Activa (Sin recargo + 1 Punto de Puntualidad)
                            </span>
                          )}
                          {!isGraceWindow && !isRoundExpired && (
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                              ⚠️ Ventana de Mora Activa (+
                              {(Number(circleDetail.params.latePenaltyBps) / 100).toFixed(1)}% multa para el pozo de puntuales)
                            </span>
                          )}
                          {isRoundExpired && (
                            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-300 border border-rose-500/30">
                              ⏰ Plazo de Ronda Vencido (Incumplimientos se cubrirán con Garantía)
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-slate-400">
                          Pagos recibidos en la ronda:{' '}
                          <strong className="text-white">
                            {currentRoundSummary.paidCount.toString()} /{' '}
                            {circleDetail.params.maxParticipants.toString()}
                          </strong>
                        </div>
                      </div>

                      {circleDetail.params.payoutMode === 0 && (
                        <div className="text-xs text-slate-300 bg-slate-900/90 border border-slate-800/80 rounded-lg px-3 py-2 mb-3 flex items-center justify-between">
                          <span>
                            Beneficiario del Turno #{circleDetail.currentRound.toString()}:{' '}
                            <strong className="text-emerald-400">
                              {getWalletName(currentRoundSummary.beneficiary)} (
                              {currentRoundSummary.beneficiary.slice(0, 6)}...
                              {currentRoundSummary.beneficiary.slice(-4)})
                            </strong>
                          </span>
                          <span className="font-semibold text-white">
                            Pozo a desembolsar:{' '}
                            {formatEther(
                              circleDetail.params.contributionAmount *
                                circleDetail.params.maxParticipants
                            )}{' '}
                            cUSD
                          </span>
                        </div>
                      )}

                      {/* Botones de Pago y Liquidación de Ronda */}
                      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
                        <div className="flex flex-wrap items-center gap-2">
                          {activeUserJoined && activeUserRoundStatus === 0 ? (
                            <button
                              onClick={handlePayContribution}
                              disabled={loading || isRoundExpired}
                              className={`px-4 py-2 rounded-xl text-white text-xs font-bold flex items-center gap-2 shadow-lg transition disabled:opacity-40 ${
                                isGraceWindow
                                  ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-950/50'
                                  : 'bg-amber-600 hover:bg-amber-500 shadow-amber-950/50'
                              }`}
                            >
                              <Coins className="w-4 h-4" />
                              {isRoundExpired
                                ? 'Plazo vencido · Liquidar ronda'
                                : isGraceWindow
                                ? `Pagar Cuota Puntual con ${getWalletName(activeAddress).split(' ')[0]} (${formatEther(circleDetail.params.contributionAmount)} cUSD)`
                                : `Pagar en Mora con ${getWalletName(activeAddress).split(' ')[0]} (${formatEther(
                                    circleDetail.params.contributionAmount +
                                      (circleDetail.params.contributionAmount *
                                        circleDetail.params.latePenaltyBps) /
                                        10000n
                                  )} cUSD incl. multa)`}
                            </button>
                          ) : activeUserJoined ? (
                            <span className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-emerald-400 text-xs font-semibold flex items-center gap-1.5">
                              <CheckCircle2 className="w-4 h-4" />
                              {getWalletName(activeAddress).split(' ')[0]} ya pagó esta ronda
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">
                              Selecciona arriba un participante inscrito para pagar individualmente
                            </span>
                          )}

                          {!allPaidInCurrentRound && (
                            <button
                              onClick={handleQuickPayAllPending}
                              disabled={loading || isRoundExpired || pendingDemoParticipantsCount === 0}
                              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition disabled:opacity-40"
                              title="Paga solo con las cuentas locales del selector. Las billeteras externas pagan individualmente."
                            >
                              <Users className="w-3.5 h-3.5 text-emerald-400" />
                              Pagar pendientes de demo ({pendingDemoParticipantsCount})
                            </button>
                          )}
                        </div>

                        <button
                          onClick={handleSettleRound}
                          disabled={loading || (!allPaidInCurrentRound && !isRoundExpired)}
                          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-2 shadow-lg shadow-indigo-950/50 transition"
                        >
                          <ArrowRight className="w-4 h-4" />
                          {circleDetail.currentRound === circleDetail.params.maxParticipants
                            ? 'Liquidar Ronda Final y Cerrar Ciclo'
                            : `Ejecutar Desembolso y Avanzar a Ronda #${(
                                circleDetail.currentRound + 1n
                              ).toString()}`}
                        </button>
                      </div>
                    </div>

                    {/* Barra de Simulación de Tiempo para Sustentación en Vivo */}
                    <div className="bg-indigo-950/30 border border-indigo-500/30 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs text-indigo-200">
                        <FastForward className="w-4 h-4 text-indigo-400 shrink-0" />
                        <span>
                          <strong>Laboratorio de Tiempo (Sustentación):</strong> Avanza el tiempo del nodo Anvil local para probar mora o cobertura de impagos; los contratos usan el tiempo del bloque.
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() =>
                            handleAdvanceTime(
                              circleDetail.params.gracePeriod + 3600n,
                              'Entrar a Ventana de Mora'
                            )
                          }
                          disabled={loading || !isGraceWindow}
                          className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-40 text-amber-300 border border-amber-500/30 text-xs font-semibold transition"
                        >
                          + Saltar a Ventana de Mora
                        </button>
                        <button
                          onClick={() =>
                            handleAdvanceTime(
                              circleDetail.params.roundDuration + 3600n,
                              'Vencer Plazo de Ronda (Forzar Default)'
                            )
                          }
                          disabled={loading || isRoundExpired}
                          className="px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 disabled:opacity-40 text-rose-300 border border-rose-500/30 text-xs font-semibold transition"
                        >
                          + Vencer Ronda (Cubrir Morosos con Garantía)
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {circleDetail.state === 2 && (
                  <div className="bg-indigo-950/40 border border-indigo-500/40 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <Trophy className="w-8 h-8 text-amber-400 shrink-0" />
                      <div>
                        <h3 className="text-sm font-bold text-white">
                          ¡Ciclo de Ahorro Completado y Liquidado Exitosamente!
                        </h3>
                        <p className="text-xs text-slate-300">
                          La bóveda distribuyó automáticamente las garantías restantes, el ahorro acumulado y un pozo de premios de{' '}
                          <strong className="text-amber-300">
                            {formatEther(
                              circleDetail.totalYieldGenerated +
                                circleDetail.totalPenaltiesCollected
                            )}{' '}
                            cUSD
                          </strong>{' '}
                          (Rendimiento Base + Multas){' '}
                          {circleDetail.totalOnTimeShares > 0n
                            ? 'según los puntos acumulados por pagos puntuales.'
                            : 'por igual entre los participantes, porque nadie acumuló puntos de puntualidad.'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Sección de Sorteo Algorítmico Verificable y Orden de Turnos */}
              {circleDetail.turnOrder.length > 0 && (
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center gap-2">
                        <Shuffle className="w-4 h-4 text-emerald-400" />
                        Sorteo Algorítmico Verificable ({circleDetail.params.payoutMode === 0 ? 'Orden de Turnos' : 'Orden de Referencia'})
                      </h3>
                      <p className="text-xs text-slate-400">
                        Fisher-Yates con muestreo por rechazo; inscripciones cerradas antes de recibir la aleatoriedad
                        {circleDetail.params.payoutMode === 1 && '. En la natillera todos reciben su liquidación al cierre del ciclo.'}
                      </p>
                      {circleDetail.draw.demo && (
                        <p className="mt-1 text-xs text-amber-300">
                          Fuente simulada sin proveedor externo: el cálculo es verificable, pero quien envía la respuesta puede escogerla.
                        </p>
                      )}
                    </div>
                    <div className="text-[11px] font-mono bg-slate-950 border border-slate-800 px-3 py-1 rounded-lg text-slate-400">
                      {circleDetail.draw.demo ? 'Fuente simulada · Demo local' : 'Fuente: proveedor VRF'}
                    </div>
                  </div>

                  <details className="mb-4 text-xs text-slate-400">
                    <summary className="cursor-pointer">Evidencia completa del sorteo</summary>
                    <div className="space-y-2 mt-3 font-mono break-all">
                      <p>Proveedor: {circleDetail.draw.provider}</p>
                      <p>Solicitud: {circleDetail.draw.requestId.toString()}</p>
                      <p>Compromiso: {circleDetail.draw.commitment}</p>
                      <p>Salida de la fuente: {circleDetail.draw.word.toString()}</p>
                      <p>Semilla: {circleDetail.verifiableSeed}</p>
                    </div>
                    <button onClick={handleVerifyDraw} className="mt-3 px-3 py-2 rounded-lg bg-indigo-600 text-white">
                      Verificar compromiso, semilla y orden
                    </button>
                  </details>

                  <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-5 gap-3">
                    {circleDetail.turnOrder.map((addr, idx) => {
                      const turnNum = idx + 1;
                      const member = circleDetail.participants.find(p => p.account.toLowerCase() === addr.toLowerCase());
                      const isRosca = circleDetail.params.payoutMode === 0;
                      const isCurrentTurn =
                        isRosca && circleDetail.state === 1 &&
                        Number(circleDetail.currentRound) === turnNum;
                      const isPaid = isRosca
                        ? (member?.turnPayoutReceived ?? 0n) > 0n
                        : circleDetail.state === 2 && (member?.totalReceivedAtClose ?? 0n) > 0n;

                      return (
                        <div
                          key={addr}
                          className={`p-3.5 rounded-xl border relative ${
                            isCurrentTurn
                              ? 'bg-emerald-950/40 border-emerald-500/60 shadow-md'
                              : isPaid
                              ? 'bg-slate-950/70 border-slate-800 opacity-85'
                              : 'bg-slate-950/40 border-slate-800/70'
                          }`}
                        >
                          <div className="flex items-center justify-between text-xs mb-1.5">
                            <span className="font-bold text-emerald-400">{isRosca ? 'Turno' : 'Posición'} #{turnNum}</span>
                            {isPaid && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                                {isRosca ? 'Cobrado' : 'Liquidado'}
                              </span>
                            )}
                            {!isRosca && !isPaid && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300">Al cierre</span>
                            )}
                            {isCurrentTurn && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 animate-pulse">
                                En Curso
                              </span>
                            )}
                          </div>
                          <div className="font-semibold text-sm text-white truncate">
                            {getWalletName(addr)}
                          </div>
                          <div className="text-[11px] font-mono text-slate-500">
                            {addr.slice(0, 8)}...{addr.slice(-4)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Tabla de Estado de Cuentas, Garantías y Distribución de Rendimientos a Puntuales */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Users className="w-4 h-4 text-indigo-400" />
                      Estado de Cuentas, Puntualidad y Garantías por Participante
                    </h3>
                    <p className="text-xs text-slate-400">
                      Transparencia contable en tiempo real: aportes, puntos de puntualidad (shares de rendimiento) y avales sociales
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Los premios se reparten según los puntos acumulados; si nadie tiene puntos, se reparten por igual.
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider text-[11px]">
                        <th className="py-3 px-3">Participante</th>
                        <th className="py-3 px-3">{circleDetail.params.payoutMode === 0 ? 'Turno' : 'Orden sorteado'}</th>
                        <th className="py-3 px-3">Estado Ronda Actual</th>
                        <th className="py-3 px-3">Garantía Activa</th>
                        <th className="py-3 px-3">Ahorro Aportado</th>
                        <th className="py-3 px-3">Puntos Puntualidad</th>
                        <th className="py-3 px-3">Cobrado (Turno / Cierre)</th>
                        <th className="py-3 px-3 text-right">Red Social (Berkeley)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {circleDetail.participants.map((p, idx) => {
                        const rStatus = circleDetail.roundStatuses[idx] || 0;
                        const repScore = memberScores[p.account.toLowerCase()] ?? 500;
                        const isSelf = p.account.toLowerCase() === activeAddress.toLowerCase();

                        const activeCollateral = circleDetail.state === 2 ? 0n : p.collateralBalance;
                        // El contrato conserva el saldo histórico de garantía al completar el ciclo.
                        const returnedPrincipal = p.collateralBalance +
                          (circleDetail.params.payoutMode === 1 ? p.principalSaved : 0n);
                        const totalRewards =
                          circleDetail.totalYieldGenerated +
                          circleDetail.totalPenaltiesCollected;
                        const estimatedReward =
                          circleDetail.state === 2
                            ? p.totalReceivedAtClose - returnedPrincipal
                            : circleDetail.totalOnTimeShares > 0n
                            ? (totalRewards * p.onTimeShares) / circleDetail.totalOnTimeShares
                            : totalRewards / BigInt(circleDetail.participants.length);

                        return (
                          <tr key={p.account} className="hover:bg-slate-800/40 transition">
                            <td className="py-3 px-3">
                              <div className="font-semibold text-white flex items-center gap-1.5">
                                {getWalletName(p.account)}
                                {isSelf && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                                    Tú
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-500 font-mono">
                                {p.account.slice(0, 6)}...{p.account.slice(-4)} • Score: {repScore}
                              </div>
                            </td>

                            <td className="py-3 px-3 font-bold text-slate-200">
                              {p.assignedTurn > 0n ? `#${p.assignedTurn.toString()}` : 'Por sortear'}
                            </td>

                            <td className="py-3 px-3">
                              {circleDetail.state === 0 && (
                                <span className="text-slate-400">Esperando inicio</span>
                              )}
                              {circleDetail.state === 2 && (
                                <span className="text-indigo-300 font-semibold">Ciclo cerrado</span>
                              )}
                              {circleDetail.state === 3 && <span className="text-amber-300">Sorteo pendiente</span>}
                              {circleDetail.state === 4 && <span className="text-slate-400">Círculo cancelado</span>}
                              {circleDetail.state === 1 && (
                                <>
                                  {rStatus === 0 && (
                                    <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300">
                                      Pendiente
                                    </span>
                                  )}
                                  {rStatus === 1 && (
                                    <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold">
                                      ✓ Puntual
                                    </span>
                                  )}
                                  {rStatus === 2 && (
                                    <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-semibold">
                                      ⚠️ Pagó con Mora
                                    </span>
                                  )}
                                  {rStatus === 3 && (
                                    <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 font-semibold">
                                      🛡️ Cubierto con Garantía
                                    </span>
                                  )}
                                </>
                              )}
                            </td>

                            <td className="py-3 px-3">
                              <span
                                className={`font-semibold ${
                                  circleDetail.state !== 2 && p.collateralBalance < circleDetail.params.collateralAmount
                                    ? 'text-rose-400'
                                    : 'text-slate-200'
                                }`}
                              >
                                {formatEther(activeCollateral)} cUSD
                              </span>
                              {circleDetail.state === 2 && (
                                <span className="block text-[10px] text-indigo-300">
                                  Devuelta al cierre: {formatEther(p.collateralBalance)} cUSD
                                </span>
                              )}
                              {p.defaultsCount > 0n && (
                                <span className="block text-[10px] text-rose-400">
                                  ({p.defaultsCount.toString()} default descontado)
                                </span>
                              )}
                            </td>

                            <td className="py-3 px-3 font-semibold text-slate-200">
                              {formatEther(p.principalSaved)} cUSD
                            </td>

                            <td className="py-3 px-3">
                              <div className="font-bold text-emerald-400">
                                {p.onTimeShares.toString()} pts
                              </div>
                              <div className="text-[10px] text-amber-300">
                                {circleDetail.state === 2 ? 'Premio liquidado' : 'Premio estimado'}: +{ Number(formatEther(estimatedReward)).toFixed(2) } cUSD
                              </div>
                            </td>

                            <td className="py-3 px-3">
                              <div className="text-slate-200">
                                Turno: <strong>{formatEther(p.turnPayoutReceived)} cUSD</strong>
                              </div>
                              {p.totalReceivedAtClose > 0n && (
                                <div className="text-[11px] text-indigo-300">
                                  Liquidación final: +{ Number(formatEther(p.totalReceivedAtClose)).toFixed(2) } cUSD
                                </div>
                              )}
                            </td>

                            <td className="py-3 px-3 text-right">
                              {!isSelf ? (
                                <button
                                  onClick={() => handleVouch(p.account)}
                                  disabled={loading}
                                  className="px-2.5 py-1 rounded-lg bg-indigo-500/20 hover:bg-indigo-500/30 border border-indigo-500/30 text-indigo-300 text-[11px] font-semibold transition"
                                  title="Respaldar socialmente a este participante para elevar su score crediticio comunitario"
                                >
                                  + Avalar Miembro
                                </button>
                              ) : (
                                <span className="text-[11px] text-slate-500">Cuenta activa</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Historial Auditable de Rondas */}
              {circleDetail.roundSummaries.length > 0 && (
                <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl">
                  <h3 className="text-base font-bold text-white mb-3 flex items-center gap-2">
                    <Info className="w-4 h-4 text-emerald-400" />
                    Libro Mayor Auditable por Ronda
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {circleDetail.roundSummaries.map((r) => (
                      <div
                        key={r.roundNumber.toString()}
                        className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white">
                            Ronda #{r.roundNumber.toString()}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              r.settled
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-amber-500/20 text-amber-300'
                            }`}
                          >
                            {r.settled ? 'Liquidada' : 'En Curso'}
                          </span>
                        </div>
                        <div className="text-slate-400 flex justify-between">
                          <span>Pozo Recaudado:</span>
                          <strong className="text-slate-200">{formatEther(r.poolCollected)} cUSD</strong>
                        </div>
                        <div className="text-slate-400 flex justify-between">
                          <span>Yield Generado:</span>
                          <strong className="text-amber-300">+{formatEther(r.yieldGenerated)} cUSD</strong>
                        </div>
                        {circleDetail.params.payoutMode === 0 && (
                          <div className="text-slate-400 flex justify-between">
                            <span>Beneficiario Turno:</span>
                            <strong className="text-emerald-400">
                              {getWalletName(r.beneficiary).split(' ')[0]}
                            </strong>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Modal para Crear Nuevo Círculo de Ahorro Paramétrico */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-emerald-400" />
                Crear Círculo de Ahorro Paramétrico
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateCircle} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Nombre del Círculo / Natillera / Cadena
                </label>
                <input
                  type="text"
                  required
                  value={newCircleForm.name}
                  onChange={(e) => setNewCircleForm({ ...newCircleForm, name: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white focus:border-emerald-500 outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Regla de Adjudicación (Modalidad)
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setNewCircleForm({ ...newCircleForm, payoutMode: 0 })}
                    className={`p-3 rounded-xl border text-left transition ${
                      newCircleForm.payoutMode === 0
                        ? 'bg-emerald-950/50 border-emerald-500 text-emerald-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    <div className="font-bold text-white mb-0.5">🔄 Por Turnos (Cadena)</div>
                    <div className="text-[11px] opacity-80">
                      Desembolsa el pozo acumulado en cada ronda según el sorteo verificable.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setNewCircleForm({ ...newCircleForm, payoutMode: 1 })}
                    className={`p-3 rounded-xl border text-left transition ${
                      newCircleForm.payoutMode === 1
                        ? 'bg-emerald-950/50 border-emerald-500 text-emerald-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400'
                    }`}
                  >
                    <div className="font-bold text-white mb-0.5">🏦 Al Cierre (Natillera)</div>
                    <div className="text-[11px] opacity-80">
                      Acumula los aportes y el rendimiento simulado hasta cerrar el ciclo.
                    </div>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Cuota Periódica (cUSD)
                  </label>
                  <input
                    type="number"
                    min="10"
                    required
                    value={newCircleForm.contributionAmount}
                    onChange={(e) =>
                      setNewCircleForm({ ...newCircleForm, contributionAmount: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Garantía Inicial (cUSD)
                  </label>
                  <input
                    type="number"
                    min={Number(newCircleForm.maxParticipants) * Number(newCircleForm.contributionAmount) * (1 + Number(newCircleForm.latePenaltyPercent) / 100)}
                    required
                    value={newCircleForm.collateralAmount}
                    onChange={(e) =>
                      setNewCircleForm({ ...newCircleForm, collateralAmount: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  />
                  <p className="text-slate-400 mt-1">Debe cubrir las cuotas y multas de todo el ciclo.</p>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    N° Participantes (2-10)
                  </label>
                  <input
                    type="number"
                    min="2"
                    max="10"
                    required
                    value={newCircleForm.maxParticipants}
                    onChange={(e) =>
                      setNewCircleForm({ ...newCircleForm, maxParticipants: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Periodicidad de Ronda (Días)
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={newCircleForm.roundDurationDays}
                    onChange={(e) =>
                      setNewCircleForm({ ...newCircleForm, roundDurationDays: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Ventana Puntual sin Mora (Días)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max={newCircleForm.roundDurationDays}
                    required
                    value={newCircleForm.gracePeriodDays}
                    onChange={(e) =>
                      setNewCircleForm({ ...newCircleForm, gracePeriodDays: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Penalización por Mora (%)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    required
                    value={newCircleForm.latePenaltyPercent}
                    onChange={(e) =>
                      setNewCircleForm({ ...newCircleForm, latePenaltyPercent: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Rendimiento Base Vault (% / ronda)
                  </label>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    max="20"
                    required
                    value={newCircleForm.yieldRatePercent}
                    onChange={(e) =>
                      setNewCircleForm({ ...newCircleForm, yieldRatePercent: e.target.value })
                    }
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-white"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold shadow-lg shadow-emerald-950/60"
                >
                  Desplegar Contrato en Blockchain
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
