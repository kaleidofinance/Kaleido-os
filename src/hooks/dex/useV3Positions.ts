import { useCallback, useEffect, useState } from "react";
import { useActiveAccount } from "thirdweb/react";
import { ethers } from "ethers";
import { KALEIDOSWAP_V3_POSITION_MANAGER, KALEIDOSWAP_V3_FACTORY } from "@/constants/utils/addresses";

const POSITION_MANAGER_ABI = [
  "function balanceOf(address owner) external view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)",
  "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external payable returns (uint256 amount0, uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint256 amount0, uint256 amount1)"
];

export interface V3Position {
  tokenId: string;
  token0: string;
  token1: string;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: string;
  tokensOwed0: string;
  tokensOwed1: string;
  inRange: boolean;
}

export const useV3Positions = () => {
  const activeAccount = useActiveAccount();
  const [positions, setPositions] = useState<V3Position[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPositions = useCallback(async () => {
    if (!activeAccount) {
      setPositions([]);
      return;
    }

    setLoading(true);
    try {
      if (typeof window === "undefined" || !window.ethereum) { setPositions([]); return; }
      const provider = new ethers.BrowserProvider(window.ethereum);
      const posManager = new ethers.Contract(KALEIDOSWAP_V3_POSITION_MANAGER, POSITION_MANAGER_ABI, provider);
      const factory = new ethers.Contract(KALEIDOSWAP_V3_FACTORY, [
          "function getPool(address,address,uint24) view returns (address)"
      ], provider);

      const balance = await posManager.balanceOf(activeAccount.address);
      const balanceNum = Number(balance);
      
      const positionPromises = Array.from({ length: balanceNum }, async (_, i) => {
        try {
          const tokenId = await posManager.tokenOfOwnerByIndex(activeAccount.address, i);
          const pos = await posManager.positions(tokenId);
          
          // Determine if In Range
          let inRange = false;
          try {
              const poolAddr = await factory.getPool(pos.token0, pos.token1, pos.fee);
              if (poolAddr !== ethers.ZeroAddress) {
                  const poolContract = new ethers.Contract(poolAddr, ["function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)"], provider);
                  const { tick } = await poolContract.slot0();
                  const currentTick = Number(tick);
                  inRange = currentTick >= Number(pos.tickLower) && currentTick < Number(pos.tickUpper);
              }
          } catch (tickErr) {
              console.warn("Failed to fetch tick for position:", tokenId.toString(), tickErr);
          }

          return {
            tokenId: tokenId.toString(),
            token0: pos.token0,
            token1: pos.token1,
            fee: Number(pos.fee),
            tickLower: Number(pos.tickLower),
            tickUpper: Number(pos.tickUpper),
            liquidity: pos.liquidity.toString(),
            tokensOwed0: pos.tokensOwed0.toString(),
            tokensOwed1: pos.tokensOwed1.toString(),
            inRange
          } as V3Position;
        } catch (e) {
          console.error(`Error fetching position ${i}:`, e);
          return null;
        }
      });

      const results = await Promise.all(positionPromises);
      const posData = results.filter((p): p is V3Position => p !== null);

      setPositions(posData);
    } catch (error) {
      console.error("Error fetching V3 positions:", error);
    } finally {
      setLoading(false);
    }
  }, [activeAccount]);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  const getSigner = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) return null;
    if (!activeAccount) return null;
    const provider = new ethers.BrowserProvider(window.ethereum);
    return await provider.getSigner();
  }, [activeAccount]);

  const collectFees = useCallback(async (tokenId: string) => {
    const signer = await getSigner();
    if (!signer) throw new Error("Wallet not connected");

    const posManager = new ethers.Contract(KALEIDOSWAP_V3_POSITION_MANAGER, POSITION_MANAGER_ABI, signer);
    const recipient = await signer.getAddress();

    const tx = await posManager.collect({
      tokenId: BigInt(tokenId),
      recipient,
      amount0Max: BigInt("340282366920938463463374607431768211455"), // uint128 max
      amount1Max: BigInt("340282366920938463463374607431768211455"),
    });
    await tx.wait();
    await fetchPositions(); // Refresh
    return tx;
  }, [getSigner, fetchPositions]);

  const removeLiquidity = useCallback(async (tokenId: string, liquidityToRemove: string, amount0Min: string = "0", amount1Min: string = "0") => {
    const signer = await getSigner();
    if (!signer) throw new Error("Wallet not connected");

    const posManager = new ethers.Contract(KALEIDOSWAP_V3_POSITION_MANAGER, POSITION_MANAGER_ABI, signer);
    const deadline = Math.floor(Date.now() / 1000) + 60 * 60;

    // Step 1: Decrease liquidity
    const decreaseTx = await posManager.decreaseLiquidity({
      tokenId: BigInt(tokenId),
      liquidity: BigInt(liquidityToRemove),
      amount0Min: BigInt(amount0Min),
      amount1Min: BigInt(amount1Min),
      deadline,
    });
    await decreaseTx.wait();

    // Step 2: Collect the withdrawn tokens + any accrued fees
    const recipient = await signer.getAddress();
    const collectTx = await posManager.collect({
      tokenId: BigInt(tokenId),
      recipient,
      amount0Max: BigInt("340282366920938463463374607431768211455"),
      amount1Max: BigInt("340282366920938463463374607431768211455"),
    });
    await collectTx.wait();

    await fetchPositions(); // Refresh
    return collectTx;
  }, [getSigner, fetchPositions]);

  return {
    positions,
    loading,
    refresh: fetchPositions,
    collectFees,
    removeLiquidity,
  };
};
