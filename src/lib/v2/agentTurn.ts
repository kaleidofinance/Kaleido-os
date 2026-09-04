import type { Intent } from "@/lib/v2/intents";

/**
 * What a turn shows beyond its prose: the route a swap takes, and the record of
 * how the answer was reached.
 *
 * Both are derived rather than stored — a plan already carries everything the
 * route needs, and /api/chat already reports which read tools the model called —
 * so this file holds no state and does no I/O. It is a plain module rather than
 * part of page.tsx for the usual reason: the formatting decisions here (fee
 * tiers, whether two swaps are one path, which tool call is worth a line) are
 * exactly the kind that go quietly wrong, and a plain module can be run through
 * a test without a React renderer or a wallet.
 */

/* ------------------------------------------------------------ swap route -- */

/** One pool the swap passes through. */
export interface Hop {
  from: string;
  to: string;
  /** This leg's own input, so an unchained plan can label each of its legs. */
  amountIn: string;
  /** This leg's own floor, for the same reason. */
  minOut: string;
  /**
   * The pool's fee tier, in the units the V3 pool itself uses: hundredths of a
   * basis point, so 3000 is 0.3%. Kept raw and formatted at the edge — see
   * `feeLabel` — because the number in the intent is the number the router is
   * called with, and a pre-formatted string could not be checked against it.
   */
  fee: number;
}

export interface SwapRoute {
  hops: Hop[];
  /**
   * The plan's two ends: what goes in at the first leg and the floor on what
   * comes out of the last.
   *
   * Only meaningful when `chained`. Two unrelated swaps have two inputs and two
   * outputs, and pairing the first with the last would state a conversion that
   * nothing performs — which is why the display drops this summary and labels
   * each hop instead.
   */
  amountIn: string;
  symbolIn: string;
  /**
   * Not a quote and not a total: the smallest amount the final swap will
   * accept, which is the number that decides whether the transaction reverts.
   */
  minOut: string;
  symbolOut: string;
  /**
   * True when each leg's output is the next leg's input, i.e. the plan is one
   * path through several pools. False when the plan happens to contain two
   * unrelated swaps — which the model can propose — and there is no single
   * route to draw.
   */
  chained: boolean;
}

/**
 * The route a plan's swaps describe, or null when it has none.
 *
 * Reads the plan rather than a quote because the plan is what gets signed: the
 * pool fee, the token pair and the slippage floor in it are the actual arguments
 * to `exactInputSingle`. A route drawn from anything else could disagree with
 * the transaction under it, which is the one thing this display must not do.
 */
export function swapRoute(intents: Intent[] | undefined): SwapRoute | null {
  const swaps = (intents ?? []).filter(
    (
      i,
    ): i is Extract<Intent, { kind: "swap" | "swapMultiHop" }> =>
      i.kind === "swap" || i.kind === "swapMultiHop",
  );
  if (swaps.length === 0) return null;

  /*
   * A `swapMultiHop` is already a path, so it contributes one hop per pool
   * rather than one hop per intent.
   *
   * Without this it fell out of the filter entirely and a routed swap rendered
   * with no route at all — the one plan shape where the display matters most,
   * since it is the only one that moves the user's money through a token they
   * never named. Its per-leg amounts are the fields this shape has no source
   * for: `exactInput` is quoted end to end and never states what the middle pool
   * received, so the intermediate legs carry the ends' own figures. That is why
   * `Hop.amountIn`/`minOut` are documented as only meaningful on an unchained
   * plan — a path's legs have no separate floors, one `amountOutMinimum` governs
   * the whole transaction.
   */
  const hops: Hop[] = swaps.flatMap((sw) =>
    sw.kind === "swap"
      ? [
          {
            from: sw.symbolIn,
            to: sw.symbolOut,
            amountIn: sw.amountIn,
            minOut: sw.amountOutMin,
            fee: sw.fee,
          },
        ]
      : sw.hops.map((h) => ({
          from: h.symbolIn,
          to: h.symbolOut,
          amountIn: sw.amountIn,
          minOut: sw.amountOutMin,
          fee: h.fee,
        })),
  );
  const first = swaps[0];
  const last = swaps[swaps.length - 1];

  return {
    hops,
    amountIn: first.amountIn,
    symbolIn: first.symbolIn,
    minOut: last.amountOutMin,
    symbolOut: last.symbolOut,
    chained: hops.every((h, i) => i === 0 || hops[i - 1].to === h.from),
  };
}

/**
 * A fee tier as a percentage. 500 → "0.05%", 3000 → "0.3%", 10000 → "1%".
 *
 * Trailing zeros are trimmed rather than padded to a fixed width, because these
 * are the three tiers a reader recognises by shape — "0.3%" is the middle pool —
 * and "0.3000%" reads as a measurement of something rather than a name for it.
 */
export function feeLabel(fee: number): string {
  return `${String(Number((fee / 10000).toFixed(4)))}%`;
}

/**
 * The token sequence to draw, for a route that is one path.
 *
 * Only meaningful when `chained` — with two unrelated swaps the caller shows
 * each leg on its own line instead, since joining them would invent a hop from
 * the first swap's output to the second swap's input that nothing performs.
 */
export function routePath(route: SwapRoute): string[] {
  return [route.hops[0].from, ...route.hops.map((h) => h.to)];
}

/* -------------------------------------------------------- thinking trace -- */

/**
 * What each read tool did, in the user's terms.
 *
 * The model's own reasoning is not available to us — /api/chat answers in one
 * non-streaming reply — but the read tools it called are, and they are the part
 * of the reasoning that touched the outside world: which markets it looked at,
 * whose portfolio, which quote. That is a record worth showing, and it is a
 * record rather than a narration, so it is written in the past tense.
 *
 * Args are the model's own output, so nothing here interpolates one without
 * checking it first: `str` returns undefined for anything that is not a short
 * plain string, and every label degrades to a version that names no argument.
 */
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.length > 0 && v.length <= 24 ? v : undefined;

/*
 * Every key read below is one the matching catalogue spec actually declares as
 * required. Worth stating because an earlier version guessed: it looked for
 * `symbol`, `token`, `tokenIn` and `destination`, none of which any tool
 * declares, so those labels silently fell back to their argument-free form on
 * every real turn and three different reads printed the same sentence.
 */
const READ_LABELS: Record<string, (args: Record<string, unknown>) => string> = {
  /* Named for what each one actually reads, which is not what their names
     suggest: getPortfolio returns the lending position — collateral value and
     health factor — and explicitly not wallet balances, because collateral has
     left the wallet. A label saying "balances" on the one tool that does not read
     them sat next to getBalances in the same fold. */
  getPortfolio: () => "Checked your lending position",
  getBalances: () => "Checked what your wallet holds",
  /* "open orders" because that is what the limit page calls them on the screen
     the user is looking at, and the fold should not introduce a second name for
     the same rows. Its only argument is a wallet address, which is never worth
     printing — `str` would refuse it at 42 characters anyway. */
  getOrders: () => "Checked your open orders",
  /* A loan quote, not a swap quote — it takes an APR and a maturity date.
     "Quoted USDC → KLD" here would name an action that did not happen. */
  getQuote: (a) => {
    const amount = str(a.amount);
    return amount
      ? `Worked out the repayment on ${amount}`
      : "Worked out the loan repayment";
  },
  getMarkets: (a) => {
    const asset = str(a.asset);
    return asset ? `Compared ${asset} rates` : "Checked the lending markets";
  },
  getPrice: (a) => {
    const asset = str(a.asset);
    return asset ? `Checked the ${asset} price` : "Checked prices";
  },
  getChains: (a) => {
    const asset = str(a.asset);
    return asset
      ? `Found your ${asset} across chains`
      : "Checked where your assets sit";
  },
  /* Named from both ends. The model calls this once per candidate source
     chain, so naming only the destination repeats the line verbatim.
     "the" rather than "a/an" because the article would have to agree with a
     chain name this file does not know: a vowel-letter test gets "a USDC"
     wrong, and there is no reason to carry a pronunciation heuristic here. */
  getBridgeRoute: (a) => {
    const from = str(a.fromChain);
    const to = str(a.toChain);
    if (from && to) return `Looked for the ${from} → ${to} route`;
    return to ? `Looked for a route to ${to}` : "Looked for a bridge route";
  },
  /* Both ends, same reasoning as the bridge above: the model may check several
     pairs in one turn, and a line naming one of them repeats verbatim. The
     amount is deliberately left out — it is optional on this tool, so printing
     it would make two lines out of the same question asked with and without a
     size. */
  getSwapRoute: (a) => {
    const from = str(a.tokenIn);
    const to = str(a.tokenOut);
    return from && to
      ? `Priced the ${from} → ${to} route`
      : "Looked for a swap route";
  },
};

/**
 * Collapses a run of identical lines into one, counted.
 *
 * The model is free to repeat a call with the same arguments, and in a 520px
 * column the same sentence three times reads as a rendering fault rather than
 * as three reads. Only *consecutive* repeats collapse, so the trace stays in
 * the order the reads happened.
 */
function collapse(lines: string[]): string[] {
  const out: string[] = [];
  let run = 0;
  for (let i = 0; i < lines.length; i++) {
    run++;
    if (lines[i + 1] === lines[i]) continue;
    out.push(run > 1 ? `${lines[i]} ×${run}` : lines[i]);
    run = 0;
  }
  return out;
}

/** A tool name safe to print: the catalogue's own shape, nothing else. */
const NAME_OK = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

interface ChatTrace {
  context?: {
    reads?: unknown;
    plan?: unknown;
    audit?: { ok?: unknown } | null;
    [k: string]: unknown;
  };
}

/**
 * The server's half of the trace, as lines to append to the ones the page
 * collected while it waited.
 *
 * Defensive for the same reason `intentsFromChat` is: the array it reads is
 * assembled from tool calls the model produced. An entry that is not a
 * recognisable `{name, args}` is dropped rather than printed, and an unknown
 * tool name is reported as itself rather than guessed at.
 */
export function traceFromChat(data: unknown): string[] {
  const chat = data as ChatTrace;
  const lines: string[] = [];

  const reads = chat?.context?.reads;
  if (Array.isArray(reads)) {
    for (const r of reads) {
      if (!r || typeof r !== "object") continue;
      const name = (r as { name?: unknown }).name;
      if (typeof name !== "string" || !NAME_OK.test(name)) continue;
      const rawArgs = (r as { args?: unknown }).args;
      const args =
        rawArgs && typeof rawArgs === "object"
          ? (rawArgs as Record<string, unknown>)
          : {};
      const label = READ_LABELS[name];
      lines.push(label ? label(args) : `Called ${name}`);
    }
  }

  /* The outcome, which is the one part of the turn the trace can state as a
     fact: the auditor either passed the plan or dropped it whole, and a plan
     that survived has a step count the user is about to sign. */
  const audit = chat?.context?.audit;
  const plan = chat?.context?.plan;
  const steps = Array.isArray(plan) ? plan.length : 0;
  if (audit && typeof audit === "object" && audit.ok === false) {
    lines.push("Auditor refused the plan — see the reply");
  } else if (steps > 0) {
    lines.push(`Built ${steps} step${steps === 1 ? "" : "s"} to sign`);
  }

  return collapse(lines);
}
