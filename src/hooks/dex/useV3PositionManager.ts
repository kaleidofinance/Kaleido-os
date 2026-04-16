import { useCallback } from "react";
import { useActiveAccount } from "thirdweb/react";
import { ethers } from "ethers";
import { KALEIDOSWAP_V3_POSITION_MANAGER, KALEIDOSWAP_V3_FACTORY, WETH_ADDRESS } from "@/constants/utils/addresses";

const POSITION_MANAGER_ABI = [
  "function mint((address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline)) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool)",
  "function positions(uint256 tokenId) external view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
];

const FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool)"
];

export const useV3PositionManager = () => {
  const activeAccount = useActiveAccount();

  const getSigner = useCallback(async () => {
    if (typeof window === "undefined" || !window.ethereum) return null;
    if (!activeAccount) return null;
    const provider = new ethers.BrowserProvider(window.ethereum);
    return await provider.getSigner();
  }, [activeAccount]);

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
      initialPrice?: string // Required if pool needs initialization
    ) => {
      const signer = await getSigner();
      if (!signer) throw new Error("Wallet not connected");

      const posManager = new ethers.Contract(KALEIDOSWAP_V3_POSITION_MANAGER, POSITION_MANAGER_ABI, signer);
      const factory = new ethers.Contract(KALEIDOSWAP_V3_FACTORY, FACTORY_ABI, signer);

      // Sort tokens if necessary (Uniswap V3 expects token0 < token1)
      let t0 = token0;
      let t1 = token1;
      let a0 = amount0Desired;
      let a1 = amount1Desired;
      let d0 = decimals0;
      let d1 = decimals1;
      let min0 = amount0Min;
      let min1 = amount1Min;

      if (token0.toLowerCase() > token1.toLowerCase()) {
        t0 = token1;
        t1 = token0;
        a0 = amount1Desired;
        a1 = amount0Desired;
        d0 = decimals1;
        d1 = decimals0;
        min0 = amount1Min;
        min1 = amount0Min;
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
        
        const initTx = await posManager.createAndInitializePoolIfNecessary(t0, t1, fee, sqrtPriceX96);
        await initTx.wait();
        console.log("✅ Pool Initialized.");
      }

      // Determine if we need to send value (Native ETH)
      // Note: We set value to 0 because the UI handles wrapping to WETH.
      // Sending native ETH alongside WETH tokens causes reverts in NonfungiblePositionManager.
      let value = BigInt(0);

      // Prepare the params as a positional array (more stable for Ethers V6 Tuples)
      const mintParams = [
        t0,
        t1,
        fee,
        Math.round(tickLower),
        Math.round(tickUpper),
        ethers.parseUnits(a0, d0),
        ethers.parseUnits(a1, d1),
        BigInt(min0),
        BigInt(min1),
        recipient,
        BigInt(deadline)
      ];

      console.log("Minting V3 Position (Strict Array):", mintParams, "Value:", value.toString());
      return await posManager.mint(mintParams, { value });
    },
    [getSigner]
  );

  return {
    mintPosition,
    POSITION_MANAGER_ADDRESS: KALEIDOSWAP_V3_POSITION_MANAGER,
  };
};
