import { ethers } from "ethers";
import { getContracts } from "@/constants/registry";
import { readContracts, type Call } from "@/lib/chain/multicall";
import { encodeV3Path, type PathQuoter } from "@/lib/dex/route";
import { MOCK_DATA, mockQuoteMultiHop } from "@/lib/mock";

/**
 * A `PathQuoter` that answers every route `findBestRoute` asks about in ONE call.
 *
 * `findBestRoute` prices up to thirty routes for a single swap — three tiers of
 * the direct pair and nine per intermediate — and it already fires them together,
 * so the happy path was one round trip's latency. But "together" meant thirty
 * concurrent `eth_call`s, and on the testnet RPCs this app runs (throttling
 * measured — see rpcRetry.ts) thirty at once is what trips the rate limiter:
 * some calls come back throttled, get retried, and the quote the user is waiting
 * on arrives late. That is the "execution is a little slow" a tester reported.
 *
 * This coalesces them instead. `findBestRoute` invokes its quoter for every route
 * synchronously within one tick — the `Promise.all(map(...))` enqueues them all
 * before any await resolves — so a quoter that collects the tick's calls and
 * flushes them on the next microtask sees the whole set at once and prices them
 * with a single Multicall3 `aggregate3`. Thirty round trips become one, and the
 * thirty prices are read at the same block rather than smeared across whatever
 * order a throttled endpoint let through.
 *
 * `findBestRoute` needs no change and does not know: it still calls a `PathQuoter`
 * per route and still compares the numbers that come back. This is the same
 * transparent-batching shape a DataLoader uses, kept local to the one caller that
 * benefits.
 *
 * Every quote here goes through `quoteExactInput` with an encoded path — a
 * single-hop path is a valid one-element path — so the batch is homogeneous and
 * the multi-hop quoter's sequential tick-walk (the number that becomes
 * `amountOutMin`) is the one used for direct pairs too.
 *
 * Stateful, so make a fresh one per search: `const quote = makeBatchingQuoter(chainId)`.
 */
export function makeBatchingQuoter(
  chainId: number | undefined,
  /**
   * The QuoterV2 to price against. Defaults to our own deployment; an external
   * venue (Uniswap V3 on Robinhood) passes its quoter here so the same batching
   * path prices its pools — the ABI is identical, only the address differs. The
   * Multicall3 the batch aggregates through is the canonical one on every chain,
   * so nothing else has to be deployed for a venue quote to land.
   */
  quoterOverride?: string,
): PathQuoter {
  const quoterAddr = quoterOverride ?? getContracts(chainId).v3Quoter;

  const QUOTER = new ethers.Interface([
    "function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut)",
  ]);

  interface Pending {
    tokens: string[];
    fees: number[];
    amountIn: string;
    decimalsIn: number;
    decimalsOut: number;
    resolve: (value: string | null) => void;
  }

  let batch: Pending[] = [];
  let scheduled = false;

  const flush = async () => {
    const current = batch;
    batch = [];
    scheduled = false;

    if (!quoterAddr) {
      current.forEach((p) => p.resolve(null));
      return;
    }

    /* Encode each route's call. A route that cannot be encoded (a bad address, a
       mismatched pair of arrays) resolves null here rather than being sent as a
       "0x" path the quoter would revert on — the same refusal `encodeV3Path`
       makes everywhere. Its slot in `current` is skipped so the multicall's
       results line up with the routes that actually went out. */
    const calls: Call[] = [];
    const slotForCall: number[] = [];
    current.forEach((p, i) => {
      const path = encodeV3Path(p.tokens, p.fees);
      if (path === "0x") {
        p.resolve(null);
        return;
      }
      let amountInWei: bigint;
      try {
        amountInWei = ethers.parseUnits(p.amountIn, p.decimalsIn);
      } catch {
        p.resolve(null);
        return;
      }
      calls.push({
        target: quoterAddr,
        iface: QUOTER,
        method: "quoteExactInput",
        args: [path, amountInWei],
        allowFailure: true,
      });
      slotForCall.push(i);
    });

    if (calls.length === 0) return;

    const results = await readContracts(chainId, calls);
    results.forEach((r, j) => {
      const p = current[slotForCall[j]];
      if (r.success && r.value !== null) {
        try {
          p.resolve(ethers.formatUnits(r.value as bigint, p.decimalsOut));
        } catch {
          p.resolve(null);
        }
      } else {
        /* A reverted quote is the ordinary "no pool at this tier" answer — the
           same null `safeQuote` already turns into "route not taken". */
        p.resolve(null);
      }
    });
  };

  return (tokens, fees, amountIn, decimalsIn, decimalsOut) => {
    /* Mock mode is per-call: there is no chain to batch against, and the fixture
       quoter is already synchronous. */
    if (MOCK_DATA) {
      return Promise.resolve(
        mockQuoteMultiHop(
          chainId,
          tokens,
          fees,
          amountIn,
          decimalsIn,
          decimalsOut,
        ),
      );
    }
    return new Promise<string | null>((resolve) => {
      batch.push({ tokens, fees, amountIn, decimalsIn, decimalsOut, resolve });
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    });
  };
}
