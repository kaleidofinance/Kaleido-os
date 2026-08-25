import { useCallback } from "react";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { ethers } from "ethers";
import { getContracts } from "@/constants/registry";
import { poolOrderInverted, invertTickRange } from "@/constants/utils/v3Math";

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
   * price the UI presented as "token1 per token0". Both are converted to the
   * pool's sorted frame here, together, and the amounts, decimals and minimums
   * ride along with them.
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

      // Sort tokens if necessary (Uniswap V3 expects token0 < token1)
      let t0 = token0;
      let t1 = token1;
      let a0 = amount0Desired;
      let a1 = amount1Desired;
      let d0 = decimals0;
      let d1 = decimals1;
      let min0 = amount0Min;
      let min1 = amount1Min;
      // Rounded before any inversion so the negation acts on whole ticks.
      let tl = Math.round(tickLower);
      let tu = Math.round(tickUpper);

      if (poolOrderInverted(token0, token1)) {
        t0 = token1;
        t1 = token0;
        a0 = amount1Desired;
        a1 = amount0Desired;
        d0 = decimals1;
        d1 = decimals0;
        min0 = amount1Min;
        min1 = amount0Min;
        /*
         * The range has to turn over with the pair. Ticks arrive in the
         * caller's frame — derived from a price the UI labelled "token1 per
         * token0" in *its* order — and the pool only understands its own. This
         * line used to be missing while the six above it were present, so a
         * pair the caller happened to name in reverse address order minted a
         * range that was the mirror image of the one asked for: the mint
         * succeeds, the position is simply in the wrong place, usually
         * one-sided and earning nothing.
         */
        ({ tickLower: tl, tickUpper: tu } = invertTickRange(tl, tu));
      }

      // Check if pool exists
      const poolAddress = await factory.getPool(t0, t1, fee);
      if (poolAddress === ethers.ZeroAddress) {
        // Calculate initial sqrtPriceX96 from amounts
        // Formula: sqrt(amount1 / amount0) * 2^96
        const amount0Wei = ethers.parseUnits(a0, d0);
        const amount1Wei = ethers.parseUnits(a1, d1);

        if (amount0Wei === BigInt(0) || amount1Wei === BigInt(0)) {
          throw new Error("Initial amounts required to initialize pool.");
        }

        // sqrtPriceX96 = sqrt((amount1 << 192) / amount0)
        const shiftedAmount1 = amount1Wei << BigInt(192);
        const ratio = shiftedAmount1 / amount0Wei;

        // Simple BigInt sqrt
        const sqrt = (value: bigint) => {
          if (value < BigInt(0)) throw new Error("Negative sqrt");
          if (value < BigInt(2)) return value;
          let x = value / BigInt(2) + BigInt(1);
          let y = (x + value / x) / BigInt(2);
          while (y < x) {
            x = y;
            y = (x + value / x) / BigInt(2);
          }
          return x;
        };

        const sqrtPriceX96 = sqrt(ratio);

        console.log("🚀 Initializing new V3 pool...");
        console.log("   Price Ratio:", a1, "/", a0);
        console.log("   sqrtPriceX96:", sqrtPriceX96.toString());

        const initTx = await posManager.createAndInitializePoolIfNecessary(
          t0,
          t1,
          fee,
          sqrtPriceX96,
        );
        await initTx.wait();
        console.log("✅ Pool Initialized.");
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
        t0,
        t1,
        fee,
        tl,
        tu,
        ethers.parseUnits(a0, d0),
        ethers.parseUnits(a1, d1),
        ethers.parseUnits(min0, d0),
        ethers.parseUnits(min1, d1),
        recipient,
        BigInt(deadline),
      ];

      console.log(
        "Minting V3 Position (Strict Array):",
        mintParams,
        "Value:",
        value.toString(),
      );
      return await posManager.mint(mintParams, { value });
    },
    [getSigner, v3PositionManager, v3Factory],
  );

  return {
    mintPosition,
    POSITION_MANAGER_ADDRESS: v3PositionManager,
  };
};
