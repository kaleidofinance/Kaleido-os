import { useCallback } from "react";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { ethers } from "ethers";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { useQuery } from "@tanstack/react-query";
import { client } from "@/config/client";
import { getContracts } from "@/constants/registry";
import { providerForChain } from "@/config/provider";
import { MOCK_DATA, MOCK_V3_POSITIONS } from "@/lib/mock";
import { uncollectedFees } from "@/lib/dex/feeGrowth";

/*
 * The pool's own fee accounting, the part `slot0` does not carry. The two globals
 * only ever grow; `ticks(t)` gives the growth recorded on the far side of a tick.
 * Combined with the position's `feeGrowthInsideLast` (already on the NFT) these
 * reconstruct fees earned since the last touch — see lib/dex/feeGrowth.ts. The
 * `ticks` return tuple is the full V3 shape; only the two `feeGrowthOutside`
 * fields are read, but the whole tuple has to be declared for ethers to decode.
 */
const POOL_FEE_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function feeGrowthGlobal0X128() view returns (uint256)",
  "function feeGrowthGlobal1X128() view returns (uint256)",
  "function ticks(int24 tick) view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)",
];

const POSITION_MANAGER_ABI = [
  "function balanceOf(address owner) external view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) external view returns (uint256)",
  "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) external payable returns (uint256 amount0, uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint256 amount0, uint256 amount1)",
  "function increaseLiquidity((uint256 tokenId, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) external payable returns (uint128 liquidity, uint256 amount0, uint256 amount1)",
];

const UINT128_MAX = BigInt("340282366920938463463374607431768211455");

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
  /**
   * What a `collect` would actually pay right now, in raw base units, per token
   * in pool order — the LIVE figure, not the stale `tokensOwed` checkpoint. Falls
   * back to the checkpoint (never below it) when the pool's fee-growth reads fail.
   * DISPLAY ONLY: `collect` sweeps with uint128-max and takes whatever the pool
   * says at execution.
   */
  uncollectedFees0: string | null;
  uncollectedFees1: string | null;
  inRange: boolean;
  /** The pool's `slot0().sqrtPriceX96` at read time, or null when unread. A
   *  string because it is a uint160 and `Number` would drop its low bits. */
  sqrtPriceX96: string | null;
}

export const useV3Positions = () => {
  const activeAccount = useActiveAccount();
  const activeChain = useActiveWalletChain();
  /* Positions are read and written on the chain the wallet is on — the position
     manager and factory are a per-chain set, and reading this chain's NFTs
     through a manager address deployed on another chain returns whatever code
     (if any) sits at that address there. */
  const chainId = activeChain?.id;
  const { v3PositionManager, v3Factory } = getContracts(chainId);
  const address = activeAccount?.address;

  /*
   * The read, now through react-query and `providerForChain` rather than a manual
   * effect over `new ethers.BrowserProvider(window.ethereum)`.
   *
   * The provider swap is the correctness half: `window.ethereum` is absent for
   * WalletConnect, the in-app (email/social/passkey) wallet, and every phone
   * browser, so this whole page showed "no positions" to a connected wallet that
   * held them — the same failure useTokenBalance and the quoter were already
   * fixed for. `providerForChain(chainId)` dials the chain the wallet is on and is
   * always present. react-query is the caching half: the positions tab and the
   * portfolio both mount this, and one shared query with a refetch after each
   * write beats two effects re-reading the same NFTs.
   */
  const {
    data,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["v3Positions", chainId, v3PositionManager ?? null, address ?? null],
    enabled: Boolean(address),
    queryFn: async (): Promise<V3Position[]> => {
      if (MOCK_DATA) return MOCK_V3_POSITIONS;
      if (!address || !v3PositionManager || !v3Factory) return [];
      const provider = providerForChain(chainId);
      if (!provider) return [];

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

      const balance = await posManager.balanceOf(address);
      const balanceNum = Number(balance);

      const positionPromises = Array.from(
        { length: balanceNum },
        async (_, i) => {
          try {
            const tokenId = await posManager.tokenOfOwnerByIndex(address, i);
            const pos = await posManager.positions(tokenId);

            // Determine if In Range
            let inRange = false;
            let sqrtPriceX96: string | null = null;
            /* Default to the on-NFT checkpoint. If the pool's fee-growth reads
               below succeed we replace these with the live figure; if they fail
               the row still shows the (understated but never wrong-direction)
               owed amount rather than null. */
            let uncollectedFees0: string | null = pos.tokensOwed0.toString();
            let uncollectedFees1: string | null = pos.tokensOwed1.toString();
            try {
              const poolAddr = await factory.getPool(
                pos.token0,
                pos.token1,
                pos.fee,
              );
              if (poolAddr !== ethers.ZeroAddress) {
                const poolContract = new ethers.Contract(
                  poolAddr,
                  POOL_FEE_ABI,
                  provider,
                );
                /* One round of reads: slot0 for price/tick, the two globals, and
                   each of the position's two boundary ticks. All independent, so
                   fired together rather than awaited in series. */
                const [slot0, global0, global1, lowerTick, upperTick] =
                  await Promise.all([
                    poolContract.slot0(),
                    poolContract.feeGrowthGlobal0X128(),
                    poolContract.feeGrowthGlobal1X128(),
                    poolContract.ticks(pos.tickLower),
                    poolContract.ticks(pos.tickUpper),
                  ]);
                const currentTick = Number(slot0.tick);
                /* Kept as a decimal string. It is only useful for valuing the
                   position (positionValue.ts) and stays null when this read
                   failed, so a caller can tell "price unknown" from "position
                   empty" rather than valuing an unread pool at zero. */
                sqrtPriceX96 = slot0.sqrtPriceX96.toString();
                inRange =
                  currentTick >= Number(pos.tickLower) &&
                  currentTick < Number(pos.tickUpper);

                /* The live uncollected figure. All the accumulators are BigInt
                   already off ethers; feeGrowth.ts does the uint256-wrapping
                   maths that a float cannot. A null return (impossible range)
                   leaves the checkpoint fallback in place. */
                const fees = uncollectedFees({
                  tickLower: Number(pos.tickLower),
                  tickUpper: Number(pos.tickUpper),
                  tickCurrent: currentTick,
                  liquidity: BigInt(pos.liquidity),
                  feeGrowthInside0LastX128: BigInt(pos.feeGrowthInside0LastX128),
                  feeGrowthInside1LastX128: BigInt(pos.feeGrowthInside1LastX128),
                  tokensOwed0: BigInt(pos.tokensOwed0),
                  tokensOwed1: BigInt(pos.tokensOwed1),
                  token0: {
                    feeGrowthGlobalX128: BigInt(global0),
                    feeGrowthOutsideLowerX128: BigInt(lowerTick.feeGrowthOutside0X128),
                    feeGrowthOutsideUpperX128: BigInt(upperTick.feeGrowthOutside0X128),
                  },
                  token1: {
                    feeGrowthGlobalX128: BigInt(global1),
                    feeGrowthOutsideLowerX128: BigInt(lowerTick.feeGrowthOutside1X128),
                    feeGrowthOutsideUpperX128: BigInt(upperTick.feeGrowthOutside1X128),
                  },
                });
                if (fees) {
                  uncollectedFees0 = fees.amount0.toString();
                  uncollectedFees1 = fees.amount1.toString();
                }
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
              uncollectedFees0,
              uncollectedFees1,
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
      return results.filter((p): p is V3Position => p !== null);
    },
  });

  const positions = data ?? [];
  const refresh = useCallback(() => {
    refetch();
  }, [refetch]);

  /*
   * The writing signer, through thirdweb's adapter rather than
   * `window.ethereum`.
   *
   * Same reason as the read above and the same fix the rest of the app already
   * uses (see /pool/new and this page's own onAdd): a wallet that injects nothing
   * — WalletConnect, in-app, any phone — has no `window.ethereum`, so collect and
   * remove threw "Wallet not connected" for a wallet that plainly was. The adapter
   * signs through whichever wallet thirdweb has active.
   */
  const getSigner = useCallback(async () => {
    if (!activeAccount || !activeChain) return null;
    return ethers6Adapter.signer.toEthers({
      client,
      chain: activeChain,
      account: activeAccount,
    });
  }, [activeAccount, activeChain]);

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
        amount0Max: UINT128_MAX,
        amount1Max: UINT128_MAX,
      });
      await tx.wait();
      await refetch(); // Refresh
      return tx;
    },
    [getSigner, refetch, v3PositionManager],
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
        amount0Max: UINT128_MAX,
        amount1Max: UINT128_MAX,
      });
      await collectTx.wait();

      await refetch(); // Refresh
      return collectTx;
    },
    [getSigner, refetch, v3PositionManager],
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
      await refetch(); // Refresh
      return tx;
    },
    [getSigner, refetch, v3PositionManager],
  );

  return {
    positions,
    loading: isLoading,
    refresh,
    collectFees,
    increaseLiquidity,
    removeLiquidity,
  };
};
