import { stableContracts } from "@/constants/registry";
import { chainTokens } from "@/constants/tokens";
import { priceToTick } from "@/constants/utils/v3Math";
import { planFromToolCalls } from "@/lib/ai/fromToolCall";
import { TOOL_CATALOG } from "@/lib/ai/toolCatalog";
import { renderIntent } from "@/lib/v2/intents";
import { buildIntents, type PlanDeps } from "@/lib/v2/intents/build";
import { parseCommand } from "@/lib/v2/intents/fromCommand";
import { resolveBridgeRoute } from "@/lib/bridge/route";
import { ALL_GROUPS, type Group, type Tool } from "./capabilities";

/**
 * Turns each tool into the chat turn the product would actually run.
 *
 * THIS IS THE POINT OF THE SECTION. The panel used to list parameter names,
 * which answered "what can it do" with a signature — true, and roughly as
 * interesting as a header file. What a reader wants to know is what happens
 * *after* they ask: what Luca says back, how many transactions it comes to, in
 * what order, each one described. So none of that is written here. It is built,
 * by the same two entry points the app itself has:
 *
 *   THE TYPED PATH, which is what the app tries first and what 20 of the 22
 *   execute tools use here. `parseCommand(tool.prompt)` → `buildIntents`, and
 *   then the agent's own line is `built.build.summary` — verbatim what
 *   agent/page.tsx:271 says on a local turn, down to the tag reading "Direct".
 *   No model, no network, no authored copy.
 *
 *   THE MODEL PATH, for the two that cannot be typed — see `via` below. The tool
 *   call goes through `planFromToolCalls`, the same function /api/chat calls, and
 *   only Luca's sentence is authored, because at runtime a model writes it.
 *
 * Either way the steps are labelled by `renderIntent`, the same renderer the
 * in-app plan panel uses. Change a step's wording in definitions.ts and this
 * section changes with it, because there is no second copy to forget.
 *
 * Server-only, and it has to be: these builders pull in ethers and the whole
 * intent registry, which is a large dependency to hand a browser for a
 * transcript that never changes after render. `CapabilityTabs` is a client
 * component because it holds two selection indices and drives the playback
 * clock, so the built traces cross the boundary as a plain serialisable prop.
 *
 * WHAT IS REAL HERE AND WHAT IS A FIXTURE, stated plainly so nobody later
 * mistakes the second for the first:
 *
 *   Real — the parse, the step list, its order, each step's `kind`, every title
 *   and detail string, and the agent's line on all 20 typed turns. Also every
 *   refusal: if a builder rejects an example, that rejection is its own words.
 *   Fixture — the prompts and argument values in `capabilities.ts`, the one
 *   authored reply, and the four chain reads below. There is no other option
 *   for the reads. `repay` cannot show a turn without a loan to repay, and this
 *   route group has no wallet to read one from; `(marketing)/layout.tsx` exists
 *   to keep it that way.
 *
 * The fixtures are shaped like the reads' real return types rather than invented
 * loosely, because build.ts computes from them — `repay`'s approve amount is
 * `totalRepaymentRaw` formatted at the token's decimals, so a sloppy fixture
 * would produce a plausible-looking wrong number.
 */

/**
 * Sepolia — and it has to be two things at once, which is what the previous value
 * stopped being.
 *
 * DEPLOYED, because the builders resolve every address from
 * `getContracts(chainId)` now rather than from the flat Abstract table they used
 * to read. On a chain with no deployment record they refuse by name — "Swapping
 * isn't available on this chain yet" — and this section stayed pinned to Base
 * mainnet (8453) through that cutover, which turned twelve of the execute
 * examples into refusals rendered on the landing page. Nothing looked
 * broken: the panel simply showed the product declining to trade.
 *
 * AND POPULATED, because the typed path needs `USDC` and `WETH` to resolve out of
 * the grammar — once to parse the symbol out of the sentence, once to render a
 * pool pair as `USDC/WETH` instead of two truncated addresses. Sepolia's token
 * table carries both, and its ChainContracts carry the router, the quoter, the
 * position manager, kfUSD, kafUSD and the yield treasury.
 *
 * A LITERAL RATHER THAN `READ_ONLY_CHAIN_ID`, which is the obvious way to write
 * this and is wrong. That constant is operator-configurable, and two of the five
 * deployed testnets would break the section outright: BSC testnet's token table is
 * WBNB alone and Robinhood's is WETH alone, so `swap 1000 USDC to WETH` would stop
 * parsing and the refusals would return under a different cause. A static
 * transcript must not move with deployment config.
 *
 * The chain is a lookup table and not a claim about where the protocol runs.
 * Nothing renders it either: `TraceStep.chain` is undefined on every step here and
 * read by nothing — see its own note below.
 *
 * Exported for capabilities.test.ts, which rebuilds the tool-call path with the
 * same three inputs to prove the two entry points agree step for step.
 */
export const TRACE_CHAIN = 11155111;

/** The app's own defaults, so a quoted minimum matches what the Swap page shows. */
export const TRACE_OPTS = { slippageBps: 50, deadlineMin: 20 };

/**
 * The parser's vocabulary — the same call the agent page makes.
 *
 * `chainTokens(11155111)` is ETH, WETH and USDC out of the chain's token table,
 * plus kfUSD, kafUSD, KLD and stKLD out of `ownTokens`, which projects them from
 * the deployment record. KLD and stKLD used to be absent from every chain — a
 * fact about the token rather than about this chain, since no KLD ERC20 existed
 * in the contracts at all. They resolve now: contracts/Token/KLD.sol is deployed
 * on all five testnets, so `ownTokens` finds an address for both.
 *
 * kfUSD being in here is what moved `completeWithdrawal` onto the typed path. Its
 * payout token resolves as `findToken("kfusd", tokens)` (fromCommand.ts:763),
 * which used to find nothing on every chain — see its note in capabilities.ts.
 */
const VOCABULARY = chainTokens(TRACE_CHAIN);

/**
 * The fixture addresses, read out of the registry rather than written down.
 *
 * These were two Base mainnet literals, and one of them was load-bearing in a way
 * that is easy to miss: `quote` below picks which direction it is pricing by
 * comparing `req.tokenIn` against DEX_USDC, so a literal from the wrong chain
 * takes the inverse branch and prints a minimum of 1,834,610 WETH under a 1000
 * USDC swap. Deriving both from `VOCABULARY` means they cannot disagree with
 * TRACE_CHAIN at all, which is the only guarantee worth having here.
 *
 * The lending currency and the DEX one are now the SAME address — both the token
 * table and the lending facet point at `getContracts().usdc` — so the "two USDC
 * addresses, not interchangeable" distinction this block used to draw is gone
 * rather than papered over. It was real while the lending list was a separate
 * Abstract table; both are projections of one deployment record now. The
 * consequence worth naming is the good one: `describeToken` resolves a listing's
 * token against `borrowCurrencies(TRACE_CHAIN)`, so the lending fixtures render
 * "USDC" instead of the truncated address they used to.
 *
 * A missing entry degrades to an empty string rather than throwing at module
 * scope during a marketing render. capabilities.test.ts is what fails on it, and
 * loudly — an empty tokenIn flips the quote branch and breaks the swap assertion.
 */
const addressOf = (symbol: string) =>
  VOCABULARY.find((t) => t.symbol === symbol)?.address ?? "";
const DEX_USDC = addressOf("USDC");
const WETH = addressOf("WETH");
const LENDING_USDC = stableContracts(TRACE_CHAIN).USDC ?? DEX_USDC;

/* Read out of the same vocabulary as the addresses, for the same reason: the
   position fixture's ticks are a price expressed in the pool's frame, and a
   hardcoded 6 against a token the registry declares differently would put the
   range 10^12 away from the market. Only the tick derivation uses these — every
   other fixture is handed decimals by its caller. */
const decimalsOf = (symbol: string) =>
  VOCABULARY.find((t) => t.symbol === symbol)?.decimals ?? 18;
const USDC_DECIMALS = decimalsOf("USDC");
const WETH_DECIMALS = decimalsOf("WETH");

/** The one price the fixtures need, and only the swap quote consumes it. */
const ETH_USD = 1834.61;

/**
 * The wallet the bridge fixture credits on the destination chain.
 *
 * A canonical deposit encodes the recipient into its calldata, so the resolver
 * needs a real, checksummed address or it refuses before building. This is a
 * fixture, not a live wallet — the same throwaway address the send and grant
 * examples use in capabilities.ts — and it never signs anything here.
 */
const TRACE_USER = "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984";

/**
 * The six chain reads, answered from fixtures.
 *
 * Every value is in the units its real caller returns: `marketRow.amount` and
 * `loans[].totalRepaymentRaw` are base units (6-decimal USDC), `liquidity` is
 * the raw uint128 the position manager stores and is not a token amount. Getting
 * these wrong does not fail — it renders a wrong number confidently.
 *
 * Exported alongside CHAIN and OPTS for the gate check.
 */
export const TRACE_DEPS: PlanDeps = {
  chainId: TRACE_CHAIN,
  /*
   * The quoter returns an amount of the *output* token in human units, not a
   * price — build.ts:236 is its only caller and hands it `amountIn` as typed.
   * So it is priced rather than constant, and worth spelling out because the
   * wrong version type-checks and reads plausibly: returning ETH_USD flat put
   * "Minimum received 1825.436950 WETH" under a 1000 USDC swap, roughly $3.3m
   * of ETH for a thousand dollars. Both directions are handled so that adding a
   * WETH-in example later cannot silently invert it.
   */
  quote: async (req) =>
    req.tokenIn.toLowerCase() === DEX_USDC.toLowerCase()
      ? (Number(req.amountIn) / ETH_USD).toFixed(6)
      : (Number(req.amountIn) * ETH_USD).toFixed(2),
  /*
   * No route quotes, so every trace on this page routes through one pool.
   *
   * Deliberate rather than unfinished. These traces are the swap the marketing
   * copy describes — USDC↔WETH, the pair whose direct pool is the deepest thing
   * on the chain — and a fixture that made a two-hop route win would print a path
   * through a third token in a panel that claims to show what the app does with
   * this pair. Null means "cannot price this route", which the builder reads as
   * the direct pool winning by default.
   */
  quotePath: async () => null,
  marketRow: async () => ({ tokenAddress: LENDING_USDC, amount: "5000000000" }),
  positions: async () => [
    {
      tokenId: "48211",
      token0: DEX_USDC,
      token1: WETH,
      liquidity: "1240998877665544",
      /* The tier and range `increasePosition` derives its floor from. 0.3% is
         the tier the `provideLiquidity` example names, so both liquidity traces
         describe the same pool.

         The ticks are DERIVED from the band that example asks for rather than
         typed, for the reason the pool fixture's `tick` is: a hand-written pair
         would be a second, disagreeing statement of where this position sits, and
         a position whose range does not contain the price would render an
         increase whose floor is one-sided — true of the fixture and untrue of the
         product. ±10% of the market, snapped to the 60-tick spacing the 0.3% tier
         uses, in the pool's USDC-first frame. */
      fee: 3000,
      ...(() => {
        const spacing = 60;
        const snap = (price: number) =>
          Math.round(priceToTick(price, USDC_DECIMALS, WETH_DECIMALS) / spacing) *
          spacing;
        /* USDC-first, so the price is WETH per USDC and the band's *lower* price
           bound in dollars is the *upper* one here. Sorted rather than assumed. */
        const [tickLower, tickUpper] = [
          snap(1 / (ETH_USD * 1.1)),
          snap(1 / (ETH_USD * 0.9)),
        ].sort((a, b) => a - b);
        return { tickLower, tickUpper };
      })(),
    },
  ],
  loans: async () => [
    {
      requestId: 314,
      totalRepayment: "5062.5",
      totalRepaymentRaw: "5062500000",
      symbol: "USDC",
      tokenAddress: LENDING_USDC,
    },
  ],
  /*
   * Empty, and not for lack of a fixture: no trace on this page claims a faucet.
   * The faucet is an internal testing errand rather than one of the products
   * this section inventories — see the exclusion in capabilities.test.ts, which
   * is what keeps that decision from being a silently missing entry.
   */
  faucetAssets: async () => [],
  /*
   * The USDC/WETH pool, priced off the same ETH_USD the quote uses so the range
   * the panel prints and the minimum the swap prints cannot describe two different
   * markets.
   *
   * Direction-aware for the reason `quote` above is: `price` is token1 per token0
   * as the CALLER named them, so a USDC-first call wants 1/1834.61 and a WETH-first
   * call wants 1834.61. Returning one of them flat would centre a ±10% band three
   * million times away from the market, and the panel would render it as a plan.
   *
   * `tick` is derived rather than written down — it is the price expressed the way
   * the contracts hold it, and a hand-typed one would be a second, disagreeing
   * statement of the same fact. Nothing in build.ts reads it; it is here because
   * PoolState carries it and a fixture that lies about an unread field is still a
   * lie waiting for a reader.
   */
  poolState: async (tokenA, _tokenB, _fee, decimalsA, decimalsB) => {
    const price =
      tokenA.toLowerCase() === DEX_USDC.toLowerCase() ? 1 / ETH_USD : ETH_USD;
    return {
      address: "0x1F98431c8aD98523631AE4a59f267346ea31F984",
      tick: priceToTick(price, decimalsA, decimalsB),
      price,
      /* Raw uint128, like the position fixture's — a pool with depth, so the
         builder's tier pick has something to prefer. */
      liquidity: "8891240998877665544",
    };
  },
  /*
   * The only dep that runs the real resolver rather than a fixture, and it can:
   * the one bridge example is the canonical Sepolia → Base Sepolia corridor,
   * which route.ts encodes from a constant with no network call — so the trace
   * shows the exact depositETHTo transaction the app would sign, not a stand-in.
   * A non-canonical corridor would reach an aggregator over the network; none is
   * asked for here, and capabilities.test.ts would surface it as a refusal if one
   * were rather than let the render hang on a fetch.
   */
  bridgeRoute: (req) =>
    resolveBridgeRoute({
      ...req,
      fromChainId: TRACE_CHAIN,
      userAddress: TRACE_USER,
    }),
};

export interface TraceStep {
  /** The Intent kind — `approve`, `swap`, `repayLoan`. Shown as the step's tag. */
  kind: string;
  title: string;
  detail?: string;
  /**
   * `renderIntent`'s chain label. The bridge step sets it (`→ Base Sepolia`) —
   * the cross-chain case this field was added for, and the day the comment here
   * used to anticipate — while every other step leaves it undefined. The app's
   * row prints `v.chain ?? "—"`, so TracePlayer shows the step's `kind` in that
   * slot rather than a column of em-dashes and says so at the rule; the label
   * rides through the shared renderer without needing a column of its own yet.
   */
  chain?: string;
}

export interface ToolTrace {
  name: string;
  params: readonly string[];
  optional?: readonly string[];
  /** What the user types or asks, verbatim from `capabilities.ts`. */
  prompt: string;
  /**
   * Which of the app's two entry points served this turn — measured, not
   * declared: "local" means `parseCommand` returned a complete command and
   * `buildIntents` accepted it, which is the branch agent/page.tsx takes before
   * it will spend a credit. The player tags those turns "Direct", the same word
   * and the same tooltip the app uses.
   *
   * Exactly two execute tools come back "model", for reasons recorded in
   * capabilities.ts, and capabilities.test.ts names both — so a third tool
   * quietly falling off the typed path fails the gate instead of shipping.
   * Reads are always "model": no read is reachable from the grammar at all.
   */
  via: "local" | "model";
  /**
   * Luca's line. Computed on a local turn (`built.build.summary`), authored on
   * the two model turns, and absent on a read — a read's answer depends on a
   * wallet and a live market, and inventing one would be the single dishonest
   * thing in this section.
   */
  say?: string;
  /** The example call rendered as the model emits it. Shown on model turns. */
  call: string;
  steps: readonly TraceStep[];
  /**
   * Set instead of `steps` when the builder declined. Nothing should reach the
   * page with this set — capabilities.test.ts fails on it — but rendering the
   * refusal beats rendering an empty panel if one ever does.
   */
  refusal?: string;
  /**
   * Reads only: the catalog's own first sentence, as what the call comes back
   * with. See `say` for why there is no answer under it.
   */
  returns?: string;
}

export interface GroupTrace extends Omit<Group, "tools"> {
  tools: readonly ToolTrace[];
}

/**
 * `foo(a: 1, b: "x")` — the example as a call, not as JSON.
 *
 * Strings stay quoted so `"30"` and `30` are distinguishable, which matters
 * here: several of these tools take an amount as a string and a count as a
 * number, and flattening the two would misrepresent the API. Long values are
 * middle-truncated rather than cut, so an address stays recognisable as one.
 */
function renderCall(name: string, args: Readonly<Record<string, unknown>>) {
  const parts = Object.entries(args).map(([k, v]) => {
    let shown: string;
    if (typeof v === "string") {
      shown =
        v.length > 14 ? `"${v.slice(0, 6)}…${v.slice(-4)}"` : JSON.stringify(v);
    } else if (Array.isArray(v)) {
      shown = `[${v.map((x) => JSON.stringify(x)).join(", ")}]`;
    } else {
      shown = String(v);
    }
    return `${k}: ${shown}`;
  });
  return `${name}(${parts.join(", ")})`;
}

/**
 * The catalog description's first sentence.
 *
 * The full descriptions are written at the model — "Use before proposing or
 * comparing a borrow", "Call this first for any 'what should I do' request" —
 * and that guidance is noise to a human reader. The first sentence is the *what*
 * in every one of the six cases. Split on a period followed by whitespace, which
 * survives `LI.FI.` (no space inside) and `(unix).` (the sentence really does
 * end there); backticks come out because the panel is not markdown.
 */
function firstSentence(text: string): string {
  const end = text.search(/\.\s/);
  const one = end === -1 ? text : text.slice(0, end + 1);
  return one.replace(/`/g, "").trim();
}

function catalogDescription(name: string): string {
  const entry = TOOL_CATALOG.find((t) => t.name === name);
  return entry ? firstSentence(entry.description) : "";
}

/**
 * An Intent as the step row shows it. `as never` because `renderIntent` is typed
 * over the discriminated Intent union and these came back through a boundary
 * that widened them; the registry dispatches on `kind` at runtime regardless.
 */
function stepOf(step: unknown): TraceStep {
  const view = renderIntent(step as never);
  return {
    kind: (step as { kind: string }).kind,
    title: view.title,
    detail: view.detail,
    chain: view.chain,
  };
}

/**
 * The typed path, or null if this tool cannot be reached by typing.
 *
 * Null is a real answer rather than an error: two tools genuinely have no typed
 * form, and the app answers exactly this way — it tries the parser first and
 * only pays for a model when the parser cannot close the sentence.
 *
 * A build that parses but refuses also returns null, so the model path gets its
 * turn at it. That would be the wrong outcome to hide, which is why the gate
 * asserts *which* tools come back on which path rather than only that each one
 * produced something.
 */
async function typedTurn(
  tool: Tool,
): Promise<{ say: string; steps: TraceStep[] } | null> {
  const parsed = parseCommand(tool.prompt, VOCABULARY);
  if (parsed.status !== "ok") return null;
  const built = await buildIntents(parsed.command, TRACE_OPTS, TRACE_DEPS);
  if (!built.ok) return null;
  return {
    say: built.build.summary,
    steps: built.build.intents.map(stepOf),
  };
}

/**
 * Builds every trace once.
 *
 * Sequential, matching `planFromToolCalls`' own contract — the builders may
 * issue reads and the fixtures above are shared — and 29 pure turns over static
 * fixtures is not work worth parallelising.
 */
export async function getCapabilityTraces(): Promise<readonly GroupTrace[]> {
  const out: GroupTrace[] = [];

  for (const group of ALL_GROUPS) {
    const tools: ToolTrace[] = [];

    for (const tool of group.tools) {
      const base = {
        name: tool.name,
        params: tool.params,
        optional: tool.optional,
        prompt: tool.prompt,
      };

      // A read: no example, no steps, the catalog's own sentence instead.
      if (!tool.example) {
        tools.push({
          ...base,
          via: "model",
          call: `${tool.name}(${tool.params.join(", ")})`,
          steps: [],
          returns: catalogDescription(tool.name),
        });
        continue;
      }

      const call = renderCall(tool.name, tool.example);

      const typed = await typedTurn(tool);
      if (typed) {
        tools.push({
          ...base,
          via: "local",
          say: typed.say,
          call,
          steps: typed.steps,
        });
        continue;
      }

      const built = await planFromToolCalls(
        [{ name: tool.name, args: tool.example }],
        TRACE_CHAIN,
        TRACE_DEPS,
        TRACE_OPTS,
      );

      if (built.plan.length === 0) {
        tools.push({
          ...base,
          via: "model",
          say: tool.reply,
          call,
          steps: [],
          refusal:
            built.errors[0] ?? "The planner returned no steps for this call.",
        });
        continue;
      }

      /*
       * `planFromToolCalls` has no summary to offer — it merges several tool
       * calls into one plan and keeps only the steps — which is the other half
       * of why these turns carry an authored `reply` and the 20 typed ones do
       * not. At runtime the model writes this sentence; here a human did, once,
       * and it says nothing the steps below it do not already commit to.
       */
      tools.push({
        ...base,
        via: "model",
        say: tool.reply,
        call,
        steps: built.plan.map(stepOf),
      });
    }

    out.push({ ...group, tools });
  }

  return out;
}
