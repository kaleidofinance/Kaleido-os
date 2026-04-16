import { useCallback } from "react";
import { useActiveAccount } from "thirdweb/react";
import { ethers } from "ethers";
import { KALEIDOSWAP_V3_ROUTER, KALEIDOSWAP_V3_QUOTER } from "@/constants/utils/addresses";

const QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
  "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut)"
];

const SWAP_ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external payable returns (uint256 amountOut)",
  "function exactInput((bytes path, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum)) external payable returns (uint256 amountOut)"
];

/**
 * Encodes a path for Uniswap V3
 * [tokenIn, fee, tokenOut] or [tokenIn, fee, tokenMid, fee, tokenOut]
 */
const encodePath = (path: any[], fees: number[]) => {
  if (path.length !== fees.length + 1) return "0x";
  let encoded = "0x" + path[0].slice(2);
  for (let i = 0; i < fees.length; i++) {
    encoded += fees[i].toString(16).padStart(6, "0");
    encoded += path[i + 1].slice(2);
  }
  return encoded.toLowerCase();
};

export const useV3SwapRouter = () => {
  const activeAccount = useActiveAccount();

  const getSigner = useCallback(async () => {
    if (!activeAccount) return null;
    const provider = new ethers.BrowserProvider(window.ethereum);
    return await provider.getSigner();
  }, [activeAccount]);

  const getV3AmountOut = useCallback(
    async (tokenIn: string, tokenOut: string, amountIn: string, fee: number, decimalsIn: number = 18, decimalsOut: number = 18) => {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const quoter = new ethers.Contract(KALEIDOSWAP_V3_QUOTER, QUOTER_ABI, provider);
        
        const amountInWei = ethers.parseUnits(amountIn, decimalsIn);
        
        // quoteExactInputSingle is a state-changing function on-chain but can be called via staticCall
        const amountOutWei = await quoter.quoteExactInputSingle.staticCall(
          tokenIn,
          tokenOut,
          fee,
          amountInWei,
          0
        );

        return ethers.formatUnits(amountOutWei, decimalsOut);
      } catch (error) {
        // console.error("V3 Quote Error:", error);
        return "0";
      }
    },
    []
  );

  const getV3MultiHopAmountOut = useCallback(
    async (path: string[], fees: number[], amountIn: string, decimalsIn: number = 18, decimalsOut: number = 18) => {
      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const quoter = new ethers.Contract(KALEIDOSWAP_V3_QUOTER, QUOTER_ABI, provider);
        
        const amountInWei = ethers.parseUnits(amountIn, decimalsIn);
        const encodedPath = encodePath(path, fees);
        
        const amountOutWei = await quoter.quoteExactInput.staticCall(
          encodedPath,
          amountInWei
        );

        return ethers.formatUnits(amountOutWei, decimalsOut);
      } catch (error) {
        return "0";
      }
    },
    []
  );

  const swapV3 = useCallback(
    async (
      tokenIn: string,
      tokenOut: string,
      fee: number,
      amountIn: string,
      amountOutMin: string,
      deadline: number,
      decimalsIn: number = 18,
      decimalsOut: number = 18
    ) => {
      const signer = await getSigner();
      if (!signer) throw new Error("Wallet not connected");

      const router = new ethers.Contract(KALEIDOSWAP_V3_ROUTER, SWAP_ROUTER_ABI, signer);
      const amountInWei = ethers.parseUnits(amountIn, decimalsIn);
      const amountOutMinWei = ethers.parseUnits(amountOutMin, decimalsOut);
      const to = await signer.getAddress();

      const params = {
        tokenIn,
        tokenOut,
        fee,
        recipient: to,
        deadline,
        amountIn: amountInWei,
        amountOutMinimum: amountOutMinWei,
        sqrtPriceLimitX96: 0,
      };

      console.log("Executing V3 Swap with params:", params);
      return await router.exactInputSingle(params);
    },
    [getSigner]
  );

  const swapV3MultiHop = useCallback(
    async (
      path: string[],
      fees: number[],
      amountIn: string,
      amountOutMin: string,
      deadline: number,
      decimalsIn: number = 18,
      decimalsOut: number = 18
    ) => {
      const signer = await getSigner();
      if (!signer) throw new Error("Wallet not connected");

      const router = new ethers.Contract(KALEIDOSWAP_V3_ROUTER, SWAP_ROUTER_ABI, signer);
      const amountInWei = ethers.parseUnits(amountIn, decimalsIn);
      const amountOutMinWei = ethers.parseUnits(amountOutMin, decimalsOut);
      const to = await signer.getAddress();
      const encodedPath = encodePath(path, fees);

      const params = {
        path: encodedPath,
        recipient: to,
        deadline,
        amountIn: amountInWei,
        amountOutMinimum: amountOutMinWei,
      };

      console.log("Executing V3 Multi-Hop Swap with params:", params);
      return await router.exactInput(params);
    },
    [getSigner]
  );

  return {
    getV3AmountOut,
    getV3MultiHopAmountOut,
    swapV3,
    swapV3MultiHop,
    V3_ROUTER_ADDRESS: KALEIDOSWAP_V3_ROUTER
  };
};
