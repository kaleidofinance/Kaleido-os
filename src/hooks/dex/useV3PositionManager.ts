import { useCallback } from "react";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { ethers } from "ethers";
import { getContracts } from "@/constants/registry";
import { initialSqrtPriceX96, sortMintParams } from "@/lib/dex/liquidity";

const POSITION_MANAGER_ABI = [
  "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool)",
  "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
];

const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)",
];

export const useV3PositionManager = () => {
  const activeAccount = useActiveAccount();
  /* Minting a position touches the position manager and factory of the chain the
     wallet is on; both are a per-chain set, so they are resolved from the wallet
     chain rather than a fixed address. */
  const chainId = useActiveWalletChain()?.id;
  const { v3PositionManager, v3Factory } = getContracts(chainId);

  const getSigner = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) return null;
    if (!activeAccount) return null;
    const provider = new ethers.BrowserProvider(window.ethereum);
    return await provider.getSigner();
  }, [activeAccount]);

  /**
   * Mints a concentrated position, sorting the pair for the caller.
   *
   * `token0`/`token1` are whatever order the caller holds them in, and
   * `tickLower`/`tickUpper` must be in that same frame — a tick derived from a
   * price the UI presented as "token1 per token0". `sortMintParams` converts all
   * of it to the pool's sorted frame in one step, ticks included; the inversion
   * used to be written out here with the six amount and decimal swaps around it,
   * and it was once missing while they were present, which minted the mirror
   * image of the range asked for. It is one function now so a reordering cannot
   * be made without the ticks coming along.
   *
   * If the pool doesn't exist yet it is created at the ratio of the two
   * deposited amounts, since nothing else on the way in carries a price. That
   * ratio is only the intended starting price for a full-range deposit; a
   * narrow first position will open the pool somewhere the depositor didn't
   * choose. Asking for a starting price is a UI change, not a fix here.
   */
  const mintPosition = useCallback(
    async (
      token0: string,
      token1: string,
      fee: number,
      tickLower: number,
      tickUpper: number,
      amount0Desired: string,
      amount1Desired: string,
      recipient: string,
      deadline: number,
      decimals0: number = 18,
      decimals1: number = 18,
      amount0Min: string = "0",
      amount1Min: string = "0",
    ) => {
      const signer = await getSigner();
      if (!signer) throw new Error("Wallet not connected");
      if (!v3PositionManager || !v3Factory)
        throw new Error("KaleidoSwap V3 is not deployed on this chain");

      const posManager = new ethers.Contract(
        v3PositionManager,
        POSITION_MANAGER_ABI,
        signer,
      );
      const factory = new ethers.Contract(v3Factory, FACTORY_ABI, signer);

      /* Into the pool's frame — `token0 < token1`, with the ticks negated and
         swapped and every paired value moved with them. Everything below this
         line is in the pool's order. */
      const p = sortMintParams({
        token0,
        token1,
        fee,
        tickLower,
        tickUpper,
        amount0: amount0Desired,
        amount1: amount1Desired,
        amount0Min,
        amount1Min,
        decimals0,
        decimals1,
      });

      const desired0 = ethers.parseUnits(p.amount0, p.decimals0);
      const desired1 = ethers.parseUnits(p.amount1, p.decimals1);

      // Check if pool exists
      const poolAddress = await factory.getPool(p.token0, p.token1, fee);
      if (poolAddress === ethers.ZeroAddress) {
        /* sqrt((amount1 << 192) / amount0), in integer math throughout — the
           value exceeds 2^96 and a float would lose the low bits that decide the
           opening tick. Amounts are already in the pool's order. */
        const sqrtPriceX96 = initialSqrtPriceX96(desired0, desired1);

        const initTx = await posManager.createAndInitializePoolIfNecessary(
          p.token0,
          p.token1,
          fee,
          sqrtPriceX96,
        );
        await initTx.wait();
      }

      // Determine if we need to send value (Native ETH)
      // Note: We set value to 0 because the UI handles wrapping to WETH.
      // Sending native ETH alongside WETH tokens causes reverts in NonfungiblePositionManager.
      let value = BigInt(0);

      // Prepare the params as a positional array (more stable for Ethers V6 Tuples)
      /*
       * The minimums are parsed the same way as the desired amounts, and used to
       * be `BigInt(min0)`. That read them as base units while `amount0Desired`
       * beside them was a decimal string, so the two adjacent parameters of the
       * same type wanted different scales — and a caller doing the obvious thing
       * and passing "1.5" got a `SyntaxError` from `BigInt`, not a revert or a
       * bad quote. Both are decimal strings in the token's own units now.
       */
      const mintParams = [
        p.token0,
        p.token1,
        fee,
        p.tickLower,
        p.tickUpper,
        desired0,
        desired1,
        ethers.parseUnits(p.amount0Min, p.decimals0),
        ethers.parseUnits(p.amount1Min, p.decimals1),
        recipient,
        BigInt(deadline),
      ];

      return await posManager.mint(mintParams, { value });
    },
    [getSigner, v3PositionManager, v3Factory],
  );

  return {
    mintPosition,
    POSITION_MANAGER_ADDRESS: v3PositionManager,
  };
};
