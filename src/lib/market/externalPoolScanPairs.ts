import type { ExternalPoolScanPair } from "./externalPoolScanner";

const pair = (
  chainId: number,
  tokenIn: string,
  tokenInSymbol: string,
  tokenOut: string,
  tokenOutSymbol: string,
  amountIn: string,
): ExternalPoolScanPair => ({
  chainId,
  tokenIn,
  tokenOut,
  amountIn,
  tokenSymbols: {
    [tokenIn.toLowerCase()]: tokenInSymbol,
    [tokenOut.toLowerCase()]: tokenOutSymbol,
  },
});

/** Conservative review pairs, not a claim that every pair has liquidity. */
export const EXTERNAL_POOL_SCAN_PAIRS: readonly ExternalPoolScanPair[] = [
  pair(
    5042,
    "0x3600000000000000000000000000000000000000",
    "USDC",
    "0x128cC466B61f542da60c70e3aA11c10e19B84EDB",
    "WETH",
    "1000000",
  ),
  pair(
    4663,
    "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
    "USDG",
    "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
    "WETH",
    "1000000000000000000",
  ),
  pair(
    56,
    "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    "USDC",
    "0x55d398326f99059fF775485246999027B3197955",
    "USDT",
    "1000000000000000000",
  ),
  pair(
    56,
    "0x55d398326f99059fF775485246999027B3197955",
    "USDT",
    "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
    "WBNB",
    "1000000000000000000",
  ),
  pair(
    56,
    "0x55d398326f99059fF775485246999027B3197955",
    "USDT",
    "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
    "BTCB",
    "1000000000000000000",
  ),
  pair(
    56,
    "0x55d398326f99059fF775485246999027B3197955",
    "USDT",
    "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d",
    "USD1",
    "1000000000000000000",
  ),
  pair(
    99901,
    "0xbA876237B0F021A6c6D852d6c26E107997cC5E81",
    "WHYPE",
    "0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65",
    "USDC",
    "1000000000000000000",
  ),
  pair(
    99901,
    "0xbA876237B0F021A6c6D852d6c26E107997cC5E81",
    "WHYPE",
    "0x3BdE42a1dA8F1D95564f2c4a51a0cF73a725674C",
    "USD₮0",
    "1000000000000000000",
  ),
  pair(
    99901,
    "0xbA876237B0F021A6c6D852d6c26E107997cC5E81",
    "WHYPE",
    "0xe45a355d9e9cAd2aD85F2d03E3eE3102A036acF0",
    "KNTQ",
    "1000000000000000000",
  ),
  pair(
    99901,
    "0xbA876237B0F021A6c6D852d6c26E107997cC5E81",
    "WHYPE",
    "0x248888D396A546A69A188f3Deb476964e581E9d0",
    "kHYPE",
    "1000000000000000000",
  ),
];
