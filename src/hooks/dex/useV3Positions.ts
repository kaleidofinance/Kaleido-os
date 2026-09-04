import { useCallback, useEffect, useState } from "react";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { ethers } from "ethers";
import { getContracts } from "@/constants/registry";
import { MOCK_DATA, MOCK_V3_POSITIONS } from "@/lib/mock";

const POSITION_MANAGER_ABI = [
  "function balanceOf(address owner) external view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)",
  "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external payable returns (uint256 amount0, uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint256 amount0, uint256 amount1)",
  /* The one fragment this file was missing, and the reason the app had no way to
     add to a position it had already opened. Nothing in the contract needed
     changing — `NonfungiblePositionManager.increaseLiquidity` has been there since
     the periphery was deployed; it simply was not in this array, so there was no
     callable form of it anywhere in the app. */
  "function increaseLiquidity((uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)",
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
  /**
   * The pool's `slot0().sqrtPriceX96` at the time of the read, or null when the
   * pool could not be read (no pool for the pair on this chain, or the call
   * failed — the same condition that leaves `inRange` false).
   *
   * Carried because the split of a position between its two tokens depends
   * entirely on where price sits inside its range, so this is the one extra field
   * that turns "liquidity 1.2e18 over ticks -6000…6000" into "0.4 ETH and 900
   * USDC" — see lib/dex/positionValue.ts. It costs no extra RPC: the slot0 read
   * that computes `inRange` already returns it and used to discard it.
   *
   * A string, not a number: it is a uint160, and `Number` would silently drop
   * everything past the 53rd bit at the point of capture rather than at the point
   * of display where the loss is understood and documented.
   */
  sqrtPriceX96: string | null;
}

export const useV3Positions = () => {
  const activeAccount = useActiveAccount();
  /* Positions are read and written on the chain the wallet is on — the position
     manager and factory are a per-chain set, and reading this chain's NFTs
     through a manager address deployed on another chain returns whatever code
     (if any) sits at that address there. */
  const chainId = useActiveWalletChain()?.id;
  const { v3PositionManager, v3Factory } = getContracts(chainId);
  const [positions, setPositions] = useState<V3Position[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPositions = useCallback(async () => {
    if (!activeAccount) {
      setPositions([]);
      return;
    }

    setLoading(true);
    try {
      /*
       * Demo mode. Deliberately inside the effect and after the wallet check, so
       * the "connect your wallet" empty state still behaves normally and the rows
       * arrive asynchronously — a fixture delivered synchronously would render
       * during SSR and mismatch on hydration. Delete with src/lib/mock.
       */
      if (MOCK_DATA) {
        setPositions(MOCK_V3_POSITIONS);
        return;
      }
      if (typeof window === "undefined" || !window.ethereum) {
        setPositions([]);
        return;
      }
      if (!v3PositionManager || !v3Factory) {
        setPositions([]);
        return;
      }
      const provider = new ethers.BrowserProvider(window.ethereum);
      const posManager = new ethers.Contract(
        v3PositionManager,
        POSITION_MANAGER_ABI,
        provider,
      );
      const factory = new ethers.Contract(
        v3Factory,
        ["function getPool(address,address,uint24) view returns (address)"],
        provider,
      );

      const balance = await posManager.balanceOf(activeAccount.address);
      const balanceNum = Number(balance);

      const positionPromises = Array.from(
        { length: balanceNum },
        async (_, i) => {
          try {
            const tokenId = await posManager.tokenOfOwnerByIndex(
              activeAccount.address,
              i,
            );
            const pos = await posManager.positions(tokenId);

            // Determine if In Range
            let inRange = false;
            let sqrtPriceX96: string | null = null;
            try {
              const poolAddr = await factory.getPool(
                pos.token0,
                pos.token1,
                pos.fee,
              );
              if (poolAddr !== ethers.ZeroAddress) {
                const poolContract = new ethers.Contract(
                  poolAddr,
                  [
                    "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
                  ],
                  provider,
                );
                const slot0 = await poolContract.slot0();
                const currentTick = Number(slot0.tick);
                /* Kept as a decimal string. It is only useful for valuing the
                   position (positionValue.ts) and stays null when this read
                   failed, so a caller can tell "price unknown" from "position
                   empty" rather than valuing an unread pool at zero. */
                sqrtPriceX96 = slot0.sqrtPriceX96.toString();
                inRange =
                  currentTick >= Number(pos.tickLower) &&
                  currentTick < Number(pos.tickUpper);
              }
            } catch (tickErr) {
              console.warn(
                "Failed to fetch tick for position:",
                tokenId.toString(),
                tickErr,
              );
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
              inRange,
              sqrtPriceX96,
            } as V3Position;
          } catch (e) {
            console.error(`Error fetching position ${i}:`, e);
            return null;
          }
        },
      );

      const results = await Promise.all(positionPromises);
      const posData = results.filter((p): p is V3Position => p !== null);

      setPositions(posData);
    } catch (error) {
      console.error("Error fetching V3 positions:", error);
    } finally {
      setLoading(false);
    }
  }, [activeAccount, v3PositionManager, v3Factory]);

  useEffect(() => {
    fetchPositions();
  }, [fetchPositions]);

  const getSigner = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) return null;
    if (!activeAccount) return null;
    const provider = new ethers.BrowserProvider(window.ethereum);
    return await provider.getSigner();
  }, [activeAccount]);

  const collectFees = useCallback(
    async (tokenId: string) => {
      const signer = await getSigner();
      if (!signer) throw new Error("Wallet not connected");
      if (!v3PositionManager)
        throw new Error(
          "KaleidoSwap V3 position manager is not deployed on this chain",
        );

      const posManager = new ethers.Contract(
        v3PositionManager,
        POSITION_MANAGER_ABI,
        signer,
      );
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
    },
    [getSigner, fetchPositions, v3PositionManager],
  );

  const removeLiquidity = useCallback(
    async (
      tokenId: string,
      liquidityToRemove: string,
      amount0Min: string = "0",
      amount1Min: string = "0",
    ) => {
      const signer = await getSigner();
      if (!signer) throw new Error("Wallet not connected");
      if (!v3PositionManager)
        throw new Error(
          "KaleidoSwap V3 position manager is not deployed on this chain",
        );

      const posManager = new ethers.Contract(
        v3PositionManager,
        POSITION_MANAGER_ABI,
        signer,
      );
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
    },
    [getSigner, fetchPositions, v3PositionManager],
  );

  /**
   * Adds to a position, in the position's own token order.
   *
   * The floors arrive already computed — `increaseV3` in lib/dex/deposit.ts owns
   * them, so the /pool page's mint and this share one slippage derivation — and
   * they arrive as human strings for the same reason the desired amounts do: this
   * is the only layer that knows the tokens' decimals, so it is the only layer
   * that should be doing `parseUnits`.
   *
   * A positional array rather than an object, matching how ethers encodes a
   * single-struct parameter. The struct's field ORDER is the encoding, so the
   * comment naming each one is load-bearing: swapping the two minimums past the
   * two desired amounts type-checks, encodes, and floors the deposit at zero.
   */
  const increaseLiquidity = useCallback(
    async (
      tokenId: string,
      amount0Desired: string,
      amount1Desired: string,
      decimals0: number,
      decimals1: number,
      amount0Min: string,
      amount1Min: string,
      deadline: number,
    ) => {
      const signer = await getSigner();
      if (!signer) throw new Error("Wallet not connected");
      if (!v3PositionManager)
        throw new Error(
          "KaleidoSwap V3 position manager is not deployed on this chain",
        );

      const posManager = new ethers.Contract(
        v3PositionManager,
        POSITION_MANAGER_ABI,
        signer,
      );

      const tx = await posManager.increaseLiquidity([
        BigInt(tokenId),
        ethers.parseUnits(amount0Desired, decimals0),
        ethers.parseUnits(amount1Desired, decimals1),
        ethers.parseUnits(amount0Min, decimals0),
        ethers.parseUnits(amount1Min, decimals1),
        BigInt(deadline),
      ]);
      await tx.wait();
      await fetchPositions(); // Refresh
      return tx;
    },
    [getSigner, fetchPositions, v3PositionManager],
  );

  return {
    positions,
    loading,
    refresh: fetchPositions,
    collectFees,
    increaseLiquidity,
    removeLiquidity,
  };
};
