import { useCallback } from "react";
import { useActiveWalletChain } from "thirdweb/react";
import { ethers } from "ethers";
import { getContracts } from "@/constants/registry";
import { providerForChain } from "@/config/provider";
import { encodeV3Path } from "@/lib/dex/route";
import { MOCK_DATA, mockQuote, mockQuoteMultiHop } from "@/lib/mock";

const QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)",
  "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut)",
];

/**
 * Quoting only. Nothing here signs.
 *
 * THIS HOOK USED TO CARRY A SECOND HALF, and removing it is the fix rather than a
 * tidy-up. `swapV3` and `swapV3MultiHop` built `exactInputSingle` and
 * `exactInput` calldata and sent it, and they had no callers: every signing
 * surface in the app goes through the intent registry, where the same two router
 * functions are reached by `definitions.ts`'s resolvers and every step is checked
 * by `auditor.ts` first. A second, unaudited path to the same two functions is a
 * standing invitation to drift — and it had already drifted, because the encoder
 * beside them was not the encoder the audited path uses.
 *
 * That encoder was the other half. A local `encodePath(path: any[], fees)`
 * checked only `path.length === fees.length + 1`, while `encodeV3Path` in
 * lib/dex/route.ts checks every address against a 20-byte hex shape and every fee
 * against uint24. The consequence was specific and silent: this file encodes the
 * path that gets QUOTED, and `route.ts` encodes the path that goes into the
 * intent and gets AUDITED. Two encoders that agree today are two encoders that
 * can disagree tomorrow, and the failure has no revert behind it — the quote
 * prices one route, the auditor approves another, and `amountOutMin` is a floor
 * computed against pools the transaction never touches. One function, imported.
 */
export const useV3SwapRouter = () => {
  /* The wallet's chain, load-bearing twice over: it selects this chain's V3
     quoter from the registry (a quote must come from the periphery deployed on
     the chain the wallet is actually on, not a stale Abstract one), and it lets
     the mock quote seams below resolve the native sentinel to the right asset —
     0xEeee… names a different token on each chain, so pricing it without a chain
     id would value BNB as ether. */
  const chainId = useActiveWalletChain()?.id;
  const { v3Router, v3Quoter } = getContracts(chainId);

  /**
   * The output a pool would give for `amountIn`, or `null` when we could not ask.
   *
   * WHY THE READ PROVIDER AND NOT `window.ethereum`
   *
   * This read `new ethers.BrowserProvider(window.ethereum)` and returned `"0"`
   * from its catch. It is the same pair of mistakes useTokenBalance was rewritten
   * for — see that hook's docstring — and it reached here because the fix landed
   * on the balance hooks and not on the quoter:
   *
   *   1. **There is often no injected provider.** `window.ethereum` exists when a
   *      browser extension put it there. This app offers six wallets through
   *      thirdweb, and WalletConnect and the in-app (email/social/passkey) wallet
   *      inject nothing on any platform, as does any phone browser. For those,
   *      `new BrowserProvider(undefined)` threw on the try's first line and every
   *      pair on every chain quoted nothing.
   *   2. **The injected node answers for its own chain, not ours.** An extension
   *      is pinned to whatever network it is showing, while the quoter address
   *      comes from `getContracts(chainId)` — thirdweb's active chain. Switch
   *      chains anywhere but in the extension and the two disagree: the call goes
   *      to Sepolia's quoter address on a chain that has no code there, which
   *      reverts for every pair regardless of the pool.
   *
   * `providerForChain(chainId)` dials the chain whose quoter we just looked up, so
   * the address and the endpoint cannot come apart. Quoting is a pure read — there
   * is no reason for it to need the user's signer at all.
   *
   * NULL FOR "NO QUOTE", NEVER `"0"`
   *
   * `"0"` is truthy in JavaScript, so it passed every `if (!out)` guard a caller
   * had and was spent as though a pool had really offered nothing. On the swap
   * card that enabled the CTA, labelled it "Review swap", and put
   * `amountOutMin: 0` into the plan — an unbounded-slippage swap offered for a
   * pair we had failed to price. A quote that did not happen is not a number, and
   * `null` is the only value a caller cannot mistake for one.
   *
   * Uniswap never answers 0 for a nonzero input against a live pool — it reverts —
   * so nothing is lost by reserving null for the failure.
   */
  const getV3AmountOut = useCallback(
    async (
      tokenIn: string,
      tokenOut: string,
      amountIn: string,
      fee: number,
      decimalsIn: number = 18,
      decimalsOut: number = 18,
    ): Promise<string | null> => {
      if (MOCK_DATA) {
        return mockQuote(
          chainId,
          tokenIn,
          tokenOut,
          amountIn,
          fee,
          decimalsIn,
          decimalsOut,
        );
      }
      if (!v3Quoter) return null;
      const provider = providerForChain(chainId);
      if (!provider) return null;
      try {
        const quoter = new ethers.Contract(v3Quoter, QUOTER_ABI, provider);

        const amountInWei = ethers.parseUnits(amountIn, decimalsIn);

        // quoteExactInputSingle is a state-changing function on-chain but can be called via staticCall
        const amountOutWei = await quoter.quoteExactInputSingle.staticCall(
          tokenIn,
          tokenOut,
          fee,
          amountInWei,
          0,
        );

        return ethers.formatUnits(amountOutWei, decimalsOut);
      } catch (error) {
        /* Logged, not swallowed. A revert here is the ordinary "no pool at this
           tier" answer, but it is also how a wrong quoter address or a dead
           endpoint presents, and this used to be commented out — so the one
           symptom the user could see was a card that quoted nothing with an
           empty console. */
        console.error(
          `No V3 quote for ${tokenIn} -> ${tokenOut} at fee ${fee} on chain ${chainId}:`,
          error,
        );
        return null;
      }
    },
    [chainId, v3Quoter],
  );

  /** The multi-hop form of the above, with the same provider and null contract. */
  const getV3MultiHopAmountOut = useCallback(
    async (
      path: string[],
      fees: number[],
      amountIn: string,
      decimalsIn: number = 18,
      decimalsOut: number = 18,
    ): Promise<string | null> => {
      if (MOCK_DATA) {
        return mockQuoteMultiHop(
          chainId,
          path,
          fees,
          amountIn,
          decimalsIn,
          decimalsOut,
        );
      }
      if (!v3Quoter) return null;
      const provider = providerForChain(chainId);
      if (!provider) return null;
      /* Encoded before the try, and a bad encode is a null rather than a caught
         revert. `encodeV3Path` returns "0x" for a mismatched pair of arrays, an
         address that is not 20 bytes of hex, or a fee outside uint24 — all of
         which the quoter would answer by reverting, which reads in the console as
         "no pool" and is not what happened. */
      const encodedPath = encodeV3Path(path, fees);
      if (encodedPath === "0x") {
        console.error(
          `Refusing to quote an unencodable path on chain ${chainId}: [${path.join(" -> ")}] fees [${fees.join(", ")}]`,
        );
        return null;
      }
      try {
        const quoter = new ethers.Contract(v3Quoter, QUOTER_ABI, provider);

        const amountInWei = ethers.parseUnits(amountIn, decimalsIn);

        const amountOutWei = await quoter.quoteExactInput.staticCall(
          encodedPath,
          amountInWei,
        );

        return ethers.formatUnits(amountOutWei, decimalsOut);
      } catch (error) {
        console.error(
          `No V3 multi-hop quote for [${path.join(" -> ")}] on chain ${chainId}:`,
          error,
        );
        return null;
      }
    },
    [chainId, v3Quoter],
  );

  return {
    getV3AmountOut,
    getV3MultiHopAmountOut,
    V3_ROUTER_ADDRESS: v3Router,
  };
};
