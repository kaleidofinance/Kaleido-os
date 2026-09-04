import {
  getContracts,
  isNativeSentinel,
  registeredTokens,
} from "@/constants/registry";
import { FEE_TIERS } from "@/lib/dex/liquidity";

/**
 * Which pools a swap should go through, direct or via one intermediate token.
 *
 * WHY THIS FILE EXISTS
 *
 * The multi-hop machinery was already written and had no callers. `encodePath`,
 * `getV3MultiHopAmountOut` and `swapV3MultiHop` have sat in `useV3SwapRouter.ts`
 * since the V3 periphery went in, and nothing outside that hook and its mock
 * ever named them — so every path in the app quoted exactly one pool. The Swap
 * page quoted `DEFAULT_FEE = 3000` and nothing else; the planner quoted all three
 * tiers of the direct pair and nothing else. Both then said "no route", which was
 * true of the pool they asked about and false of the DEX.
 *
 * That is the whole bug, and it is a routing bug rather than a missing feature.
 * KLD is seeded against USDC on Sepolia and Base and against nothing else, so
 * every KLD pair that is not KLD/USDC has no direct pool — WETH→KLD is
 * unroutable directly and trivially routable through USDC, which is where the
 * liquidity was deliberately put. A user asking to buy KLD with ETH was told the
 * DEX could not do it.
 *
 * WHY PATH-FINDING BELONGS HERE AND NOT IN A HOOK
 *
 * Same argument as `pool.ts` and `book.ts`: three callers need this answer — the
 * Swap page, the browser planner and the server planner — and a route that
 * resolves one way in the swap card and another way in the chat is worse than
 * either being wrong alone, because the two then disagree about where the money
 * goes. A hook cannot be imported by a route handler (it pulls thirdweb/react in
 * at module scope), so the shared thing has to be a plain module that takes its
 * quoting function as an argument.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * Two hops maximum, and one candidate list of intermediates. This is not a
 * general-purpose pathfinder and should not become one: a third hop multiplies
 * the quote count by the candidate count again, every quote is an `eth_call` on a
 * chain we have measured throttling on (see `rpcRetry.ts`), and the marginal
 * route it finds on a five-pool testnet is one that barely has liquidity anyway.
 * Splitting an order across several routes is likewise out — one signature per
 * plan step is what makes a plan auditable, and a split route's slippage floor
 * cannot be attributed to any single pool.
 */

/** One pool a route passes through. */
export interface RouteHop {
  tokenIn: string;
  tokenOut: string;
  symbolIn: string;
  symbolOut: string;
  decimalsIn: number;
  decimalsOut: number;
  fee: number;
}

export interface SwapPath {
  hops: RouteHop[];
  /** Human amount out, as the quoter reported it for the whole path. */
  amountOut: number;
  /**
   * The token addresses in order, `hops.length + 1` of them. Ready for
   * `encodeV3Path`, which is the form both the quoter and the router take.
   */
  tokens: string[];
  /** One fee per hop, same order. */
  fees: number[];
}

/**
 * How a caller asks a route to be quoted.
 *
 * A single function for both the one-hop and the multi-hop case, because the
 * caller supplying it knows which quoter surface it has and this module does not
 * need to. `tokens.length === 2` is the direct case; anything longer is a path.
 *
 * Returns the human output amount, or null for "could not price this". Null and
 * a throw are both handled — a rejected `eth_call` is the ordinary way a pool
 * that does not exist presents itself.
 */
export type PathQuoter = (
  tokens: string[],
  fees: number[],
  amountIn: string,
  decimalsIn: number,
  decimalsOut: number,
) => Promise<string | number | null>;

/**
 * Encodes a V3 path: token, fee, token, fee, token…
 *
 * Uniswap's own packing — 20 bytes of address, 3 bytes of fee, repeating — and
 * the exact format both `quoteExactInput` and `exactInput` take. Lifted out of
 * `useV3SwapRouter` so the server can encode a path too, and typed: the version
 * in the hook took `any[]`, which is how a `string | undefined` could have been
 * sliced into a path that encodes to plausible-looking nonsense.
 *
 * Returns "0x" on a mismatched pair of arrays rather than throwing, and every
 * caller treats "0x" as "no path" — the router reverts on it, so a bad encode can
 * never become a sent transaction.
 */
export function encodeV3Path(tokens: string[], fees: number[]): string {
  if (tokens.length !== fees.length + 1 || tokens.length < 2) return "0x";
  if (tokens.some((t) => !/^0x[0-9a-fA-F]{40}$/.test(t))) return "0x";
  if (fees.some((f) => !Number.isInteger(f) || f <= 0 || f > 0xffffff))
    return "0x";

  let encoded = "0x" + tokens[0].slice(2);
  for (let i = 0; i < fees.length; i++) {
    encoded += fees[i].toString(16).padStart(6, "0");
    encoded += tokens[i + 1].slice(2);
  }
  return encoded.toLowerCase();
}

/**
 * The tokens worth trying as a middle leg on this chain, most liquid first.
 *
 * Resolved from the registry rather than listed, for the reason every hardcoded
 * address in this app was removed: the same symbol is a different contract on
 * each of the five chains, and Arc's USDC is the native asset at 18 decimals
 * where everywhere else it is a 6-decimal ERC20. `wrappedNative` comes from the
 * deployment record because the V3 periphery took it as a constructor argument,
 * so it is the one intermediate guaranteed to exist wherever a router does.
 *
 * The order is the order they are tried in, and it is a liquidity claim: USDC is
 * the quote asset every seeded pool here has a side in, and the wrapped native is
 * what the router itself wraps through. USDT is last because only two chains have
 * a pool for it.
 *
 * Anything already at either end of the swap is excluded by the caller, not here.
 */
export function intermediateTokens(
  chainId: number | undefined,
): { address: string; symbol: string; decimals: number }[] {
  const contracts = getContracts(chainId);
  const registered = registeredTokens(chainId);

  const bySymbol = (symbol: string) =>
    registered.find(
      (t) => t.symbol.toLowerCase() === symbol.toLowerCase() && !t.isNative,
    );

  const wrapped = contracts.wrappedNative
    ? registered.find(
        (t) =>
          t.address.toLowerCase() === contracts.wrappedNative!.toLowerCase(),
      )
    : undefined;

  const ordered = [bySymbol("USDC"), wrapped, bySymbol("USDT")];

  /* Deduped by address, because `wrappedNative` IS the USDC entry on Arc — the
     chain wraps its native USDC, so the two lookups return one token and
     quoting it twice would double the calls for one candidate. */
  const seen = new Set<string>();
  const out: { address: string; symbol: string; decimals: number }[] = [];
  for (const t of ordered) {
    if (!t) continue;
    const key = t.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ address: t.address, symbol: t.symbol, decimals: t.decimals });
  }
  return out;
}

/** A quote that resolves to a positive number, or null. Never a throw. */
async function safeQuote(
  quote: PathQuoter,
  tokens: string[],
  fees: number[],
  amountIn: string,
  decimalsIn: number,
  decimalsOut: number,
): Promise<number | null> {
  try {
    const q = await quote(tokens, fees, amountIn, decimalsIn, decimalsOut);
    const n = Number(q);
    /* `q &&` first, because "0" is truthy as a string and 0 is falsy as a
       number — the exact conflation that let an unpriced pair through as a
       quote of zero and put `amountOutMin: 0` on a signable swap. */
    return q !== null && q !== undefined && Number.isFinite(n) && n > 0
      ? n
      : null;
  } catch {
    return null;
  }
}

export interface RouteToken {
  address: string;
  symbol: string;
  decimals: number;
}

export interface PoolSide {
  /**
   * The token a pool can actually hold: the caller's own, unless they named the
   * chain's currency, in which case this is its wrapped form — with the SYMBOL
   * the user typed kept as-is.
   *
   * That split is deliberate. The address has to be the wrapped one because it
   * goes into an encoded path and into `exactInputSingle`, and the symbol has to
   * be the user's because it goes into the row they read before signing: the
   * money that leaves the wallet is ETH, and a confirmation saying WETH would be
   * describing an intermediate state that only exists inside the transaction.
   */
  token: RouteToken;
  /** True when the caller named the native currency and the router must wrap. */
  native: boolean;
}

/**
 * The pool-side form of one end of a swap, or null when this chain cannot do it.
 *
 * WHY THE SENTINEL CANNOT JUST BE PASSED THROUGH
 *
 * `NATIVE_SENTINEL.dex` is a magic value, not an address: nothing is deployed at
 * 0xEeee…, and neither the V3 quoter nor the router has a line of code that looks
 * for it. Handing it to either produces a failure at a distance rather than a
 * refusal — the quoter `eth_call`s an address with no code and reverts, which
 * reads in the console as "no pool for this pair", and an `approve` step built
 * around it calls `allowance()` on nothing and throws mid-plan, one wallet
 * confirmation in. Both symptoms describe a missing pool; neither is one.
 *
 * The router's real native path is WETH9's address in the parameters plus `value`
 * on the transaction — see `PeripheryPayments.pay()`, which wraps `msg.value`
 * when the token it is asked to pull IS WETH9. So the substitution here is not a
 * workaround: it is the calldata the periphery was written to receive.
 *
 * NULL RATHER THAN A THROW OR A GUESS. Two ways this legitimately has no answer:
 * a chain with no `wrappedNative` recorded, and one whose wrapped token is not in
 * any token table (so the auditor's `knownToken` would refuse the step it is
 * about to build). Both are our own deployment records being incomplete rather
 * than the user's mistake, so callers refuse the plan and say so.
 *
 * DECIMALS MUST AGREE, and the check is not ceremonial. WETH9 mints
 * `msg.value` 1:1, so the wrapped token always has the native decimals — if our
 * two records disagree, one of them is wrong, and the amount parsed for `value`
 * would differ from the amount named in the swap parameters by a power of ten.
 */
export function poolSide(
  chainId: number | undefined,
  token: {
    address: string;
    symbol: string;
    decimals: number;
    isNative?: boolean;
  },
): PoolSide | null {
  /* All three tests, because the same asset arrives here under three different
     descriptions: the pickers' `IToken` carries `isNative`, the DEX-side token
     list carries the 0xEeee… sentinel, and a token that came back through a
     lending screen carries ADDRESS_1. */
  const native =
    token.isNative === true ||
    isNativeSentinel(token.address, "dex") ||
    isNativeSentinel(token.address, "lending");

  if (!native) {
    return {
      token: {
        address: token.address,
        symbol: token.symbol,
        decimals: token.decimals,
      },
      native: false,
    };
  }

  const wrapped = getContracts(chainId).wrappedNative;
  if (!wrapped) return null;

  const entry = registeredTokens(chainId).find(
    (t) => t.address.toLowerCase() === wrapped.toLowerCase(),
  );
  if (!entry || entry.decimals !== token.decimals) return null;

  return {
    token: {
      address: entry.address,
      symbol: token.symbol,
      decimals: entry.decimals,
    },
    native: true,
  };
}

/**
 * The best route from one token to another, or null when there is none.
 *
 * Direct pools first, all three tiers at once, and the deepest fill wins — that
 * is the existing `build.ts` behaviour, preserved exactly, including `>` rather
 * than `>=` so a tie keeps `FEE_TIERS` order and the cheaper tier wins a
 * stable-pair draw.
 *
 * WHY A DIRECT ROUTE DOES NOT SHORT-CIRCUIT
 *
 * Both sets of quotes are requested together and compared on output, so a
 * two-hop route that fills better than a thin direct pool is taken. On a testnet
 * that is the common case rather than the exotic one: a pair can have a pool
 * holding $30 of liquidity at one tier and a well-seeded path through USDC, and
 * "there is a direct pool" is not the same claim as "the direct pool can fill
 * this". Each hop's fee compounds, so a two-hop route only wins when the depth
 * difference genuinely outweighs the extra fee — which is the comparison being
 * made rather than assumed.
 *
 * THE COST, STATED
 *
 * Three quotes for the direct pair plus nine per intermediate — three tiers on
 * each leg — so up to 30 `eth_call`s on a chain with three candidates. They all
 * go out concurrently, which makes it one round trip's latency rather than
 * thirty, and it is the reason `maxIntermediates` exists for the server path
 * where a chat turn is already several round trips deep.
 */
export async function findBestRoute(
  chainId: number | undefined,
  tokenIn: RouteToken,
  tokenOut: RouteToken,
  amountIn: string,
  quote: PathQuoter,
  opts: { maxIntermediates?: number } = {},
): Promise<SwapPath | null> {
  if (tokenIn.address.toLowerCase() === tokenOut.address.toLowerCase()) {
    return null;
  }
  const amount = Number(amountIn);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const hop = (a: RouteToken, b: RouteToken, fee: number): RouteHop => ({
    tokenIn: a.address,
    tokenOut: b.address,
    symbolIn: a.symbol,
    symbolOut: b.symbol,
    decimalsIn: a.decimals,
    decimalsOut: b.decimals,
    fee,
  });

  /* ------------------------------------------------------------- direct -- */
  const direct = FEE_TIERS.map(async (fee) => {
    const out = await safeQuote(
      quote,
      [tokenIn.address, tokenOut.address],
      [fee],
      amountIn,
      tokenIn.decimals,
      tokenOut.decimals,
    );
    if (out === null) return null;
    return {
      hops: [hop(tokenIn, tokenOut, fee)],
      amountOut: out,
      tokens: [tokenIn.address, tokenOut.address],
      fees: [fee],
    } satisfies SwapPath;
  });

  /* -------------------------------------------------------------- via -- */
  const ends = new Set([
    tokenIn.address.toLowerCase(),
    tokenOut.address.toLowerCase(),
  ]);
  const candidates = intermediateTokens(chainId)
    .filter((t) => !ends.has(t.address.toLowerCase()))
    .slice(0, opts.maxIntermediates ?? Infinity);

  /*
   * Every tier pair on both legs, quoted as one `quoteExactInput` per
   * combination rather than as two single quotes multiplied together.
   *
   * The distinction is load-bearing and it is why this cannot be done cheaply:
   * `quoteExactInput` walks the ticks of each pool in sequence with the real
   * output of the previous hop as the next hop's input, so it prices the
   * slippage the route actually incurs. Multiplying two independent
   * `quoteExactInputSingle` results prices each hop as though it were the only
   * trade, which overstates the fill on exactly the thin pools where the answer
   * matters — and the number becomes `amountOutMin` on a signed transaction.
   */
  const via = candidates.flatMap((mid) =>
    FEE_TIERS.flatMap((feeA) =>
      FEE_TIERS.map(async (feeB) => {
        const tokens = [tokenIn.address, mid.address, tokenOut.address];
        const fees = [feeA, feeB];
        const out = await safeQuote(
          quote,
          tokens,
          fees,
          amountIn,
          tokenIn.decimals,
          tokenOut.decimals,
        );
        if (out === null) return null;
        return {
          hops: [hop(tokenIn, mid, feeA), hop(mid, tokenOut, feeB)],
          amountOut: out,
          tokens,
          fees,
        } satisfies SwapPath;
      }),
    ),
  );

  const results = await Promise.all([...direct, ...via]);

  /* Best fill wins. `>` and not `>=`, so a tie keeps the order the candidates
     were generated in: direct before two-hop, and cheaper tier before dearer.
     A route that ties with a direct pool should be the direct pool — fewer
     pools is less that can move between the quote and the block. */
  let best: SwapPath | null = null;
  for (const r of results) {
    if (r && (!best || r.amountOut > best.amountOut)) best = r;
  }
  return best;
}

/**
 * A route as a line of prose: "WETH → USDC → KLD through 0.3% and 0.3%".
 *
 * Here rather than in a component because both the swap card and the planner's
 * summary state it, and a route the user reads must be the route that was
 * quoted. `feeLabel` lives in `agentTurn.ts`, which imports the Intent union;
 * this file is imported by the builder that produces it, so the formatting is
 * repeated rather than creating a cycle.
 */
export function describeRoute(path: SwapPath): string {
  const symbols = [path.hops[0].symbolIn, ...path.hops.map((h) => h.symbolOut)];
  const tiers = path.fees.map((f) => `${String(Number((f / 10_000).toFixed(4)))}%`);
  return path.hops.length === 1
    ? `${symbols.join(" → ")} through the ${tiers[0]} pool`
    : `${symbols.join(" → ")} through the ${tiers.join(" and ")} pools`;
}
