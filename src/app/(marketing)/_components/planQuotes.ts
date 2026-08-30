import { getContracts } from "@/constants/registry";
import type { PlanDeps, QuoteRequest } from "@/lib/v2/intents/build";

/**
 * Recorded pool quotes, so the landing page's planner can price a swap without
 * calling anything.
 *
 * WHY A RECORDING AND NOT A LIVE QUOTE. The planner in the hero makes one claim
 * about itself — that nothing it does leaves the tab — and that claim is worth
 * more than a live number. `serverPlanDeps` already exists and would give real
 * prices through a route handler, but it would put an unauthenticated RPC proxy
 * in front of the marketing site, add a round trip to the first interaction, and
 * make the copy above it false.
 *
 * WHY A RECORDING AND NOT AN INVENTED NUMBER. Every figure below came off the
 * chain. They are `quoteExactInputSingle` answers from the deployed Sepolia
 * QuoterV2, against the seeded USDC/KLD 0.3% pool, at the block named in
 * `SNAPSHOT`. Re-read them with:
 *
 *   cast call $QUOTER "quoteExactInputSingle(address,address,uint24,uint256,uint160)" \
 *     $USDC $KLD 3000 500000000 0 --rpc-url https://11155111.rpc.thirdweb.com
 *
 * The alternative — deriving a price from the pool's tick and applying the fee —
 * was measured against these and reads 0.21% high on a 500 USDC trade, because
 * it cannot see price impact. A recording of what the pool actually answered is
 * both simpler and closer.
 *
 * WHAT IS APPROXIMATE. Only one size per pair was recorded, and any other amount
 * scales linearly off it (see `snapshotQuote`). Price impact is not linear, so a
 * trade far larger than the recorded one is quoted better than the pool would
 * fill it. That is why the card says the price is a snapshot and the app
 * re-quotes: the number is real, the extrapolation is ours, and the swap is not
 * signable from this page in any case.
 *
 * The addresses are read from the registry rather than pasted, so a redeploy
 * that moves KLD makes the pair stop matching — and an unmatched pair returns
 * null, which the builder reports as "no pool for that pair". A stale recording
 * therefore degrades to the honest refusal rather than to a wrong price.
 */
export const SNAPSHOT = {
  chainId: 11155111,
  chain: "Sepolia",
  /** deployment-v3-sepolia-1787339244721.json */
  quoter: "0x6653B81FEE8CECf0AB5ce2863A63D9D3C28C1DE7",
  /** deployment-pool-sepolia-USDC-KLD-3000.json */
  pool: "0x04EfB41F6aCeCB6B1eB46be75A929cD5b42dC1e4",
  block: 11585222,
  readAt: "2026-08-28T13:49:12Z",
} as const;

/**
 * One recorded answer per direction.
 *
 * `amountIn`/`amountOut` are the literal numbers the quoter returned, in human
 * units, kept as strings so nothing is lost to a float literal before it is
 * used. The fee tier is part of the key because the builder quotes all three and
 * takes the best fill — 0.05% and 1% have no pool for this pair and revert,
 * which is why only 0.3% is here and why the other two must return null rather
 * than fall back to this one.
 */
const MEASURED: ReadonlyArray<{
  from: "usdc" | "kld";
  to: "usdc" | "kld";
  fee: number;
  amountIn: string;
  amountOut: string;
}> = [
  {
    from: "usdc",
    to: "kld",
    fee: 3000,
    amountIn: "500",
    amountOut: "16607.564089515923251289",
  },
  {
    from: "kld",
    to: "usdc",
    fee: 3000,
    amountIn: "5000",
    amountOut: "149.611932",
  },
];

/** Registry addresses for the two tokens the recording covers, lower-cased. */
function addressOf(which: "usdc" | "kld"): string | undefined {
  const c = getContracts(SNAPSHOT.chainId);
  return (which === "usdc" ? c.usdc : c.kld)?.toLowerCase();
}

/**
 * The quoted output for one leg, or null.
 *
 * Null is the important return. It is what `quote` gives on a pair with no pool,
 * and `buildIntents` turns it into a named refusal — so a visitor who asks for a
 * pair this page has no recording for gets the planner's real answer rather than
 * a made-up one. Only the two directions in MEASURED resolve.
 *
 * Trimmed to six decimals at most, matching the swap page: `parseUnits` is
 * called on this string downstream and 18 significant decimals off a float
 * multiply is where that throws.
 */
export function snapshotQuote(req: QuoteRequest): string | null {
  const usdc = addressOf("usdc");
  const kld = addressOf("kld");
  if (!usdc || !kld) return null;

  const key = (a: string): "usdc" | "kld" | null => {
    const lower = a.toLowerCase();
    if (lower === usdc) return "usdc";
    if (lower === kld) return "kld";
    return null;
  };
  const from = key(req.tokenIn);
  const to = key(req.tokenOut);
  if (!from || !to) return null;

  const row = MEASURED.find(
    (m) => m.from === from && m.to === to && m.fee === req.fee,
  );
  if (!row) return null;

  const asked = Number(req.amountIn);
  if (!Number.isFinite(asked) || asked <= 0) return null;

  const out = (asked / Number(row.amountIn)) * Number(row.amountOut);
  if (!Number.isFinite(out) || out <= 0) return null;
  return out.toFixed(Math.min(req.decimalsOut, 6));
}

/**
 * The deps the landing page plans with, plus a place to read the winning quote
 * back out of.
 *
 * The builder quotes every fee tier and keeps the best fill; it does not hand
 * that number back — the plan carries `amountOutMin`, which is the floor after
 * slippage rather than the quote. The card wants the quote itself, to say what
 * the swap is expected to return, so the closure records the largest answer it
 * gave. Recording the largest is not a guess at which one won: it is the same
 * `>` comparison build.ts uses to choose.
 *
 * Everything other than `quote` answers empty, and each one is the answer the
 * app itself gets with no wallet connected. A market row, a loan, a pool
 * position and a faucet claim are all reads *about a specific address*, and this
 * page has none — so the builder refuses by name ("I can't find an open listing
 * #7"), which is true here and true in the app. A bridge is the one dep that
 * would reach an external provider even with an address, so it refuses too.
 */
export function snapshotDeps(): {
  deps: PlanDeps;
  quoted: () => string | null;
} {
  let best: number | null = null;

  const deps: PlanDeps = {
    chainId: SNAPSHOT.chainId,
    quote: async (req) => {
      const out = snapshotQuote(req);
      if (out !== null) {
        const n = Number(out);
        if (Number.isFinite(n) && (best === null || n > best)) best = n;
      }
      return out;
    },
    marketRow: async () => null,
    positions: async () => [],
    loans: async () => [],
    faucetAssets: async () => [],
    poolState: async () => null,
    bridgeRoute: async () => ({
      error:
        "A bridge route resolves against a live provider, which this page does not call. Bridging works in the app.",
    }),
  };

  return { deps, quoted: () => (best === null ? null : String(best)) };
}
