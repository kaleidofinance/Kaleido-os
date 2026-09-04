// Checks on the shared plan builder. Run with
// `npx tsx src/lib/v2/intents/build.test.ts` — tsx rather than plain node,
// because build.ts imports ethers and the address registry, rather than being
// self-contained the way fromCommand.ts is.
//
// build.ts claims to be "pure enough to test offline with no wallet and no
// network". This suite is what makes that claim checkable: every chain read
// arrives through a fake PlanDeps that records its calls, so a test can assert
// both what a command builds and what it declines to read.
//
// What is under test, in order of how badly it fails when wrong:
//
//   1. Address fills. The parser and the model supply amounts and symbols; the
//      builder supplies every address. A wrong fill sends funds to the wrong
//      contract, and no auditor rule downstream can tell a plausible address
//      from the right one — it only sees the same constant twice.
//   2. Protocol re-resolution. A DEX token must never reach the lending facet
//      (see build.ts:156). Native ETH carries a different sentinel on each
//      side, so passing one through fails silently rather than loudly.
//   3. Decimals, always from the registry and never defaulted. Approving a
//      6-decimal token as an 18-decimal one asks for 10^12 times the amount.
//   4. Native handling. ETH rides as value, so emitting an approve for it
//      reverts the step.
//   5. Laziness. Each dep is a real RPC round trip on the server, so a swap
//      must not enumerate pool positions.

import type { IToken } from "../../../constants/types/dex";
import type { LendingSide } from "../../../constants/registry";
import type { Command } from "./fromCommand";
import type { IntentKind } from "./types";
import type {
  BridgeRouteRequest,
  PathQuoteRequest,
  PlanDeps,
  PlanResult,
  QuoteRequest,
} from "./build";

/*
 * Addresses fixed before the builder loads.
 *
 * `envVars` reads process.env once at module evaluation, and under tsx there is
 * no Next.js runtime to populate NEXT_PUBLIC_*. Left undefined, every lending
 * command would return "The protocol address isn't configured." and this file
 * would assert nothing but that one refusal.
 *
 * So every runtime import lives inside `load()`: a static import is evaluated
 * before any statement in the module body, which would freeze `undefined` into
 * envVars before these two lines ran. Type imports stay static — they erase.
 */
const DIAMOND = "0xd1a3000000000000000000000000000000000001";
process.env.NEXT_PUBLIC_KALEIDO_DIAMOND_ADDRESS = DIAMOND;
/* NEXT_PUBLIC_KLD_VAULT_ADDRESS was set here too. It is gone from envVars: the
   vault is deployed per chain and comes from the deployment records like the
   diamond, so there is no env var left to seed. The diamond's stays because
   `envVars.lendbitDiamondAddress` is still the fallback the registry's value is
   asserted to beat, further down. */

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

/* Sepolia, because it is a chain the protocol is actually deployed on.
   This was 8453 (Base mainnet) on the reasoning that its token list is
   populated, so pool pair labels resolve to real symbols instead of truncated
   addresses. That reasoning only held while addresses came from flat tables:
   now that buildIntents resolves every address through getContracts(chainId),
   an undeployed chain returns {} and the whole suite fails at setup on
   `no lending currency USDC`. Sepolia satisfies both requirements — it has a
   populated token list AND all twelve deployment fields. */
const CHAIN = 11155111;

const OPTS = { slippageBps: 50, deadlineMin: 20 };

/**
 * A PlanDeps that reads nothing and remembers everything asked of it.
 *
 * Overrides are wrapped rather than replacing the recorder, so a test can both
 * supply data and assert which reads happened.
 */
function fakeDeps(over: Partial<PlanDeps> = {}) {
  const calls = {
    quote: [] as QuoteRequest[],
    /** Routes the builder asked to price, in order. See `quotePath` below. */
    paths: [] as PathQuoteRequest[],
    rows: [] as string[],
    positions: 0,
    loans: 0,
    faucet: 0,
    /* The fee tiers asked about, in the order they were asked. The mint branch
       reads all three when `fee` is omitted and exactly one when it is given, so
       this is how the tier-resolution cases tell those two apart — a branch that
       silently defaulted to 0.3% instead of reading would still return a plan. */
    pools: [] as number[],
    /* The corridors asked to resolve. build.ts refuses a bridge for its own
       reasons — no chain, over-precise amount — BEFORE it reaches the resolver,
       so this is how the ordering cases prove the refusal came first: a recorded
       call means a guard that should have fired did not. It is also where the
       ERC20 case reads back `tokenAddress`, the field the resolver cross-checks
       against the provider's own idea of what the symbol resolves to. */
    bridge: [] as BridgeRouteRequest[],
  };
  const deps: PlanDeps = {
    chainId: over.chainId ?? CHAIN,
    quote: async (req) => {
      calls.quote.push(req);
      return over.quote ? over.quote(req) : null;
    },
    /*
     * Null unless a test asks for a route, so the swap cases below keep
     * describing the direct pool they were written for.
     *
     * Recorded as well as answered, because "did the builder look for a route at
     * all?" is a distinct assertion from "which route did it pick": a swap branch
     * that quoted only the direct tiers would still return a plan on every
     * existing case here, which is precisely how the missing multi-hop search
     * went unnoticed for as long as it did.
     */
    quotePath: async (req) => {
      calls.paths.push(req);
      return over.quotePath ? over.quotePath(req) : null;
    },
    marketRow: async (kind, id) => {
      calls.rows.push(`${kind}#${id}`);
      return over.marketRow ? over.marketRow(kind, id) : null;
    },
    positions: async () => {
      calls.positions++;
      return over.positions ? over.positions() : [];
    },
    loans: async () => {
      calls.loans++;
      return over.loans ? over.loans() : [];
    },
    faucetAssets: async () => {
      calls.faucet++;
      return over.faucetAssets ? over.faucetAssets() : [];
    },
    /* Null by default, which is "no pool at this tier" and not "no answer" — the
       distinction the mint branch turns into either a full-range create or a
       refusal. A default of some priced pool would make every range case pass
       without the test having said which market it was centred on. */
    poolState: async (a, b, fee, da, db) => {
      calls.pools.push(fee);
      return over.poolState ? over.poolState(a, b, fee, da, db) : null;
    },
    /* An error by default, not a silent success. A bridge route is the one dep
       that can leave the chain for an external provider, so a fixture that
       forgot to stub it must refuse rather than resolve to nothing. The
       canonical-corridor cases below override this with the real resolver,
       which needs no network for the Sepolia→Base Sepolia leg. */
    bridgeRoute: async (req) => {
      calls.bridge.push(req);
      return over.bridgeRoute
        ? over.bridgeRoute(req)
        : { error: "no bridge route in this fixture" };
    },
  };
  return { deps, calls };
}

/* Loaded dynamically so the assignments above have already run; see the
   comment beside them. */
async function load() {
  const { buildIntents, isParsableAmount } = await import("./build");
  const { isRegistered } = await import("./index");
  const registry = await import("../../../constants/registry");
  const { envVars } = await import("../../../constants/envVars");
  const { chainTokens } = await import("../../../constants/tokens");
  /* The bridge resolver, loaded here with the rest so the env pins above have
     already run — it reads none of them, but the file's whole discipline is
     that every runtime import is dynamic. It is the real resolveBridgeRoute the
     browser and the route handler call, network-free on the canonical corridor
     the bridge cases exercise. */
  const { resolveBridgeRoute, isKnownBridgeAddress, isKnownBridgeSpender } =
    await import("../../bridge/route");
  /* The pool fixtures below carry a tick, and deriving it beats writing one
     down: a hand-typed tick is a second statement of the same price, free to
     disagree with it. */
  const { priceToTick } = await import("../../../constants/utils/v3Math");
  return {
    buildIntents,
    isParsableAmount,
    isRegistered,
    registry,
    envVars,
    chainTokens,
    priceToTick,
    resolveBridgeRoute,
    isKnownBridgeAddress,
    isKnownBridgeSpender,
  };
}
async function main() {
  const {
    buildIntents,
    isParsableAmount,
    isRegistered,
    registry,
    envVars,
    chainTokens,
    priceToTick,
    resolveBridgeRoute,
    isKnownBridgeAddress,
    isKnownBridgeSpender,
  } = await load();
  const { NATIVE_SENTINEL } = registry;

  /* The three flat tables these assertions used to read — BORROW_CURRENCIES,
     STABLE_CONTRACTS and LEGACY_CONTRACTS — were Abstract-testnet only and are
     gone. Their replacements are chain-scoped functions, so they are resolved
     once here against CHAIN and the assertions below are otherwise untouched.
     LEGACY_CONTRACTS is whole again: its staking fields were a chain-blind
     constant while KLD had no ERC20, and now come from the same records as the
     DEX fields. */
  const DEPLOYED = registry.getContracts(CHAIN);
  const STABLE_CONTRACTS = registry.stableContracts(CHAIN);
  const STAKING = registry.stakingContracts(CHAIN);
  const LEGACY_CONTRACTS = {
    v3Router: DEPLOYED.v3Router,
    v3PositionManager: DEPLOYED.v3PositionManager,
    kld: STAKING.kld,
    stKLD: STAKING.stKLD,
  };

  /* Read from the registry rather than pasted in, so the day the market
     redeploys these assertions move with it instead of staying green against
     an address the facet no longer accepts.

     `registeredLendingAssets`, not `borrowCurrencies`: the builder now resolves
     lending tokens against what each diamond was actually registered to accept,
     and the two lists differ on this chain. Sepolia registers three collateral
     assets (native, WETH9, USDC) and exactly one loanable one (USDC), while the
     offered list names four on every chain. Keying the expectations off the
     offered list would assert the bug this suite exists to catch. */
  const lendingAddress = (side: LendingSide, symbol: string): string => {
    const found = registry
      .registeredLendingAssets(CHAIN, side)
      .assets.find((c: { symbol: string }) => c.symbol === symbol);
    if (!found) throw new Error(`no registered ${side} ${symbol} on ${CHAIN}`);
    return found.address;
  };
  const USDC_LENDING = lendingAddress("collateral", "USDC");
  const ETH_LENDING = lendingAddress("collateral", "ETH");

  /* The exact "Accepted:" list the refusals print, derived the same way the
     builder derives it — so an assertion cannot pass against a list the user
     would never be shown. */
  const acceptedList = (side: LendingSide): string => {
    const { assets, unnamed } = registry.registeredLendingAssets(CHAIN, side);
    return [
      ...assets.map((a: { symbol: string }) => a.symbol),
      ...unnamed,
    ].join(", ");
  };

  const tk = (symbol: string, decimals: number, address: string): IToken => ({
    address,
    name: symbol,
    symbol,
    decimals,
    chainId: CHAIN,
  });

  /* The DEX-side tokens deliberately carry addresses the lending facet has
     never heard of. If a lending branch trusted the parser's token instead of
     re-resolving by symbol, the built intent would carry one of these — which
     is exactly the failure that has no downstream detector. */
  const DEX_USDC = tk("USDC", 6, "0xdec0000000000000000000000000000000000001");
  const DEX_ETH = tk("ETH", 18, NATIVE_SENTINEL.dex);
  const DEX_KLD = tk("KLD", 18, LEGACY_CONTRACTS.kld);
  const DEX_USDE = tk("USDe", 18, "0xdec0000000000000000000000000000000000002");

  /* Every plan built in this file passes through here, so the bus check at the
     end covers each command rather than a hand-listed subset. */
  const unregistered = new Set<string>();
  const build = async (command: Command, deps: PlanDeps, opts = OPTS) => {
    const r = await buildIntents(command, opts, deps);
    if (r.ok) {
      for (const i of r.build.intents) {
        if (!isRegistered(i.kind as IntentKind)) unregistered.add(i.kind);
      }
    }
    return r;
  };

  const kinds = (r: PlanResult) =>
    r.ok ? r.build.intents.map((i) => i.kind).join(",") : `error:${r.error}`;
  /* Steps read as bags of fields. The assertions are about the data a resolver
     receives, and narrowing the Intent union at each call site would bury that
     in casts. */
  const at = (r: PlanResult, i: number): Record<string, unknown> =>
    r.ok ? (r.build.intents[i] as unknown as Record<string, unknown>) : {};
  const errorOf = (r: PlanResult) => (r.ok ? "" : r.error);
  /* The slot a refusal offers to re-ask, or "" for a terminal one. What the
     agent page reads to keep a refused turn local instead of handing the
     follow-up to a model. */
  const retryOf = (r: PlanResult) => (r.ok ? "" : (r.retry?.slot ?? ""));
  const summaryOf = (r: PlanResult) => (r.ok ? r.build.summary : "");
  const same = (a: unknown, b: string) =>
    typeof a === "string" && a.toLowerCase() === b.toLowerCase();
  const quiet = (c: ReturnType<typeof fakeDeps>["calls"]) =>
    c.quote.length +
      c.rows.length +
      c.positions +
      c.loans +
      c.faucet +
      c.pools.length +
      c.bridge.length ===
    0;

  console.log("\n— commands with no transaction —");
  {
    const { deps, calls } = fakeDeps();
    const r = await build({ kind: "help" }, deps);
    check(
      "help resolves to a panel, not a plan",
      !r.ok && r.error === "help",
      kinds(r),
    );
    check("help reads nothing", quiet(calls));
  }
  {
    const { deps, calls } = fakeDeps();
    const r = await build({ kind: "receive" }, deps);
    check(
      "receive resolves to a panel, not a plan",
      !r.ok && r.error === "receive",
      kinds(r),
    );
    check("receive reads nothing", quiet(calls));
  }

  console.log("\n— swap —");
  {
    const { deps, calls } = fakeDeps({ quote: async () => "1000" });
    const r = await build(
      { kind: "swap", amount: "500", tokenIn: DEX_USDC, tokenOut: DEX_KLD },
      deps,
    );
    check(
      "swap builds approve then swap",
      kinds(r) === "approve,swap",
      kinds(r),
    );
    check(
      "the approve targets the V3 router",
      same(at(r, 0).spender, LEGACY_CONTRACTS.v3Router),
      String(at(r, 0).spender),
    );
    check(
      "the approve carries the input token at its own decimals",
      same(at(r, 0).token, DEX_USDC.address) && at(r, 0).decimals === 6,
      JSON.stringify(at(r, 0)),
    );
    const s = at(r, 1);
    check(
      "the swap keeps both sides as typed",
      same(s.tokenIn, DEX_USDC.address) && same(s.tokenOut, DEX_KLD.address),
      JSON.stringify(s),
    );
    /* Every tier quotes 1000 here, so this is the tie-break: `>` rather than
       `>=` in build.ts keeps FEE_TIERS order, and the cheapest tier wins. Used
       to assert a flat 3000, which was one hardcoded tier — measured on
       2026-08-25 against Sepolia, whose only pool is USDT/USDe at 500, so the
       agent could not price the one pair the chain has. */
    check(
      "a tie routes through the cheapest tier",
      s.fee === 500,
      String(s.fee),
    );
    check(
      "the swap carries the caller's deadline",
      s.deadlineMin === 20,
      String(s.deadlineMin),
    );
    check(
      "50bps of slippage comes off the quote",
      s.amountOutMin === "995.000000",
      String(s.amountOutMin),
    );
    check(
      "every tier is quoted, once each, at the swap's own decimals",
      calls.quote.length === 3 &&
        calls.quote.map((q) => q.fee).join(",") === "500,3000,10000" &&
        calls.quote.every((q) => q.decimalsIn === 6 && q.decimalsOut === 18),
      JSON.stringify(calls.quote.map((q) => q.fee)),
    );
    check(
      "the swap routes through a tier that was actually quoted",
      calls.quote.some((q) => q.fee === s.fee),
      `fee ${s.fee}`,
    );
    check(
      "a swap enumerates no positions, loans or market rows",
      calls.positions === 0 && calls.loans === 0 && calls.rows.length === 0,
    );
  }
  {
    /* Best fill wins, not first fill. Untestable while the tier was hardcoded,
       and it is the half of the fix that decides the price the user gets: the
       1% pool quotes highest here, so a builder that stopped at the first tier
       with a pool would route 500 and hand over 4% less. */
    const { deps, calls } = fakeDeps({
      quote: async (req) =>
        req.fee === 500 ? "960" : req.fee === 3000 ? "980" : "1000",
    });
    const r = await build(
      { kind: "swap", amount: "500", tokenIn: DEX_USDC, tokenOut: DEX_KLD },
      deps,
    );
    const s = at(r, 1);
    check(
      "the best-priced tier wins, not the cheapest or the first",
      s.fee === 10000,
      `fee ${s.fee} out of ${JSON.stringify(calls.quote.map((q) => q.fee))}`,
    );
    check(
      "and the minimum out comes off that tier's quote",
      s.amountOutMin === "995.000000",
      String(s.amountOutMin),
    );
  }
  {
    /* One thin tier must not be mistaken for a priceable pair: a zero or empty
       quote is discarded, so a pool that exists but returns nothing does not
       become the route. */
    const { deps } = fakeDeps({
      quote: async (req) =>
        req.fee === 3000 ? "0" : req.fee === 500 ? "" : "700",
    });
    const r = await build(
      { kind: "swap", amount: "500", tokenIn: DEX_USDC, tokenOut: DEX_KLD },
      deps,
    );
    check(
      "a zero or empty quote is not a route",
      at(r, 1).fee === 10000,
      `fee ${at(r, 1).fee}`,
    );
  }
  {
    const { deps } = fakeDeps({ quote: async () => null });
    const r = await build(
      { kind: "swap", amount: "1", tokenIn: DEX_KLD, tokenOut: DEX_USDC },
      deps,
    );
    check(
      "an unpriced pair refuses rather than guessing a minimum out",
      !r.ok && errorOf(r).includes("couldn't get a price for KLD to USDC"),
      errorOf(r),
    );
    check(
      "the refusal names every tier it tried, not one",
      errorOf(r).includes("0.05%") &&
        errorOf(r).includes("0.3%") &&
        errorOf(r).includes("1%"),
      errorOf(r),
    );
  }
  {
    /* A throwing quoter is the realistic RPC failure — build.ts wraps the call
       so a network error reads as "no price" rather than crashing the route. */
    const { deps } = fakeDeps({
      quote: async () => {
        throw new Error("RPC down");
      },
    });
    const r = await build(
      { kind: "swap", amount: "1", tokenIn: DEX_KLD, tokenOut: DEX_USDC },
      deps,
    );
    check("a throwing quoter is a refusal, not a crash", !r.ok, kinds(r));
  }
  {
    const { deps } = fakeDeps({ quote: async () => "0" });
    const r = await build(
      { kind: "swap", amount: "1", tokenIn: DEX_KLD, tokenOut: DEX_USDC },
      deps,
    );
    check("a zero quote is refused", !r.ok, kinds(r));
  }
  {
    const { deps } = fakeDeps({ quote: async () => 1000 });
    const r = await build(
      { kind: "swap", amount: "1", tokenIn: DEX_KLD, tokenOut: DEX_USDC },
      deps,
      { slippageBps: 100, deadlineMin: 5 },
    );
    check(
      "slippage and deadline come from the caller, not a constant",
      at(r, 1).amountOutMin === "990.000000" && at(r, 1).deadlineMin === 5,
      JSON.stringify(at(r, 1)),
    );
  }

  console.log("\n— swapping the chain's own currency —");
  /*
   * The default state of the Swap card, and until the wrapped substitution went
   * in it was the one state that could not trade: the sell side seeds with the
   * chain's native asset, so `swap 0.1 ETH for KLD` was the first thing anyone
   * tried and the sentinel went straight into the quoter. Neither failure named
   * ETH — the quote came back empty (an `eth_call` to an address with no code)
   * and read as "no pool for that pair", and the plan's `approve` step called
   * `allowance()` on 0xEeee… and threw after the user had already agreed to sign.
   *
   * Same class as the lending case further down ("native collateral skips the
   * approve that would revert"), and asserted the same way: what the plan omits
   * matters as much as what it contains.
   */
  const WRAPPED = String(DEPLOYED.wrappedNative);
  {
    const { deps, calls } = fakeDeps({ quote: async () => "1000" });
    const r = await build(
      { kind: "swap", amount: "0.5", tokenIn: DEX_ETH, tokenOut: DEX_KLD },
      deps,
    );
    check(
      "selling the native asset is one step — no allowance to grant",
      kinds(r) === "swap",
      kinds(r),
    );
    const s = at(r, 0);
    check(
      "the calldata names the wrapped token, which is what a pool holds",
      same(s.tokenIn, WRAPPED),
      `${String(s.tokenIn)} (wrapped ${WRAPPED})`,
    );
    check(
      "the row still names the asset leaving the wallet",
      s.symbolIn === "ETH" && s.symbolOut === "KLD",
      `${String(s.symbolIn)} → ${String(s.symbolOut)}`,
    );
    check(
      "and the step is flagged, so the resolver attaches value",
      s.nativeIn === true && s.nativeOut === false,
      JSON.stringify({ nativeIn: s.nativeIn, nativeOut: s.nativeOut }),
    );
    /* The substitution has to happen BEFORE the quote, not between the quote and
       the plan: a route priced against the sentinel prices nothing, and
       `intermediateTokens` excludes whatever sits at either end, so a sentinel
       end would leave WETH in the candidate list and let the search return
       WETH→WETH→KLD. */
    check(
      "every quote asked about the wrapped token, never the sentinel",
      calls.quote.length === 3 &&
        calls.quote.every((q) => same(q.tokenIn, WRAPPED)),
      JSON.stringify(calls.quote.map((q) => q.tokenIn)),
    );
  }
  {
    const { deps } = fakeDeps({ quote: async () => "0.25" });
    const r = await build(
      { kind: "swap", amount: "100", tokenIn: DEX_KLD, tokenOut: DEX_ETH },
      deps,
    );
    check(
      "buying the native asset still approves the token being sold",
      kinds(r) === "approve,swap",
      kinds(r),
    );
    const s = at(r, 1);
    check(
      "the swap buys wrapped and is flagged to unwrap on the way out",
      same(s.tokenOut, WRAPPED) &&
        s.symbolOut === "ETH" &&
        s.nativeOut === true &&
        s.nativeIn === false,
      JSON.stringify(s),
    );
  }
  {
    /* One asset held two ways, so in pool form both sides are one address. This
       used to fall through to "I couldn't get a price", which is a claim about
       liquidity — and it sends the user looking for the pool that would fix it.
       There is no pool between a token and its own wrapper and there never will
       be. */
    const { deps, calls } = fakeDeps({ quote: async () => "1000" });
    const r = await build(
      {
        kind: "swap",
        amount: "1",
        tokenIn: DEX_ETH,
        tokenOut: tk("WETH", 18, WRAPPED),
      },
      deps,
    );
    check(
      "ETH for its own wrapper is refused as one asset, not as no liquidity",
      !r.ok &&
        errorOf(r).includes("same asset") &&
        !errorOf(r).includes("couldn't get a price"),
      errorOf(r),
    );
    check(
      "and it costs no quotes to say so",
      calls.quote.length === 0,
      String(calls.quote.length),
    );
  }

  console.log("\n— stake and approve —");
  {
    const { deps, calls } = fakeDeps();
    const r = await build({ kind: "stake", amount: "100" }, deps);
    check(
      "stake builds approve then stake",
      kinds(r) === "approve,stake",
      kinds(r),
    );
    check(
      "the approve targets this chain's recorded vault",
      same(at(r, 0).spender, STAKING.kldVault) &&
        same(at(r, 1).vault, STAKING.kldVault),
      `${String(at(r, 0).spender)} / ${String(at(r, 1).vault)} (registry ${String(STAKING.kldVault)})`,
    );
    check(
      "staking is KLD for stKLD, from the registry",
      same(at(r, 1).token, LEGACY_CONTRACTS.kld) &&
        same(at(r, 1).stToken, LEGACY_CONTRACTS.stKLD),
      JSON.stringify(at(r, 1)),
    );
    check("stake reads nothing", quiet(calls));
  }
  {
    const { deps } = fakeDeps();
    const r = await build(
      { kind: "approve", amount: "5", token: DEX_USDC },
      deps,
    );
    check("a bare approve is one step", kinds(r) === "approve", kinds(r));
    check(
      "it approves the router, at the token's decimals",
      same(at(r, 0).spender, LEGACY_CONTRACTS.v3Router) &&
        at(r, 0).decimals === 6,
      JSON.stringify(at(r, 0)),
    );
  }

  console.log("\n— send —");
  /*
   * The one command that leaves Kaleido's contracts, and so the one with no
   * revert waiting behind it. Every other builder check in this file is a second
   * line of defence in front of a facet that would reject bad input anyway;
   * here the builder is the only line, so each case asserts the specific
   * refusal rather than merely that nothing crashed.
   *
   * The three constants below are one address in three forms, and the pairing is
   * itself the test. EIP-55 encodes the checksum in the capitalisation of the
   * hex digits, so `getAddress()` verifies mixed-case input and waves
   * all-lowercase input through unchecked. FLIPPED is CHECKSUMMED with every hex
   * letter's case inverted: still 0x, still 40 valid hex digits, still
   * real-looking, and invalid. Pasted rather than derived because neither can
   * move — one is nobody's wallet and the other is permanently malformed — and
   * because a desync between them fails loudly on the first case below.
   */
  const CHECKSUMMED = "0x5A3c9F1e8b7d64A209Fe3B18c7d05E4A6f2B91D3";
  const LOWERCASE = "0x5a3c9f1e8b7d64a209fe3b18c7d05e4a6f2b91d3";
  const FLIPPED = "0x5a3C9f1E8B7D64a209fE3b18C7D05e4a6F2b91d3";
  {
    const { deps, calls } = fakeDeps();
    const r = await build(
      { kind: "send", amount: "50", token: DEX_USDC, to: CHECKSUMMED },
      deps,
    );
    check("a send is a single transfer", kinds(r) === "transfer", kinds(r));
    /* An ERC20 transfer moves the caller's own balance, so there is no
       allowance for a spender to hold. An approve here would be a signature the
       user pays gas for and nothing spends. */
    check("and emits no approve", !kinds(r).includes("approve"), kinds(r));
    const t = at(r, 0);
    /* A send re-resolves nothing, because there is no protocol table to
       re-resolve against — so DEX_USDC's deliberately-fictional address is
       meant to arrive untouched. That is the exact opposite of every lending
       check below, and the difference is the point: for a send, the token the
       parser matched *is* the token. */
    check(
      "the token and its decimals pass through as matched",
      same(t.token, DEX_USDC.address) &&
        t.decimals === 6 &&
        t.symbol === "USDC",
      JSON.stringify(t),
    );
    check(
      "the amount is carried as typed",
      t.amount === "50",
      String(t.amount),
    );
    check(
      "an ERC20 send is not native",
      t.isNative === false,
      String(t.isNative),
    );
    /* Address poisoning works by seeding history with an address sharing the
       first and last four digits of the real one, so an abbreviated summary
       renders the attacker's row and the intended one identically. The full
       string is the only thing that defeats it. */
    check(
      "the summary carries the whole address, not a truncation",
      summaryOf(r).includes(CHECKSUMMED) && !summaryOf(r).includes("…"),
      summaryOf(r),
    );
    check("a send reads nothing", quiet(calls), JSON.stringify(calls));
  }
  {
    const { deps } = fakeDeps();
    const r = await build(
      { kind: "send", amount: "50", token: DEX_USDC, to: LOWERCASE },
      deps,
    );
    /* Compared exactly, never through same(): the checksum *is* the case, so a
       case-insensitive assertion here would pass against the very output this
       check exists to rule out. */
    check(
      "an all-lowercase recipient is accepted and returned checksummed",
      r.ok && at(r, 0).to === CHECKSUMMED,
      String(at(r, 0).to),
    );
  }
  {
    const { deps, calls } = fakeDeps();
    const r = await build(
      { kind: "send", amount: "50", token: DEX_USDC, to: FLIPPED },
      deps,
    );
    check(
      "a recipient whose checksum fails is refused",
      !r.ok && errorOf(r).includes("isn't a valid recipient address"),
      errorOf(r),
    );
    check(
      "the refusal quotes the address as typed and says it is unrecoverable",
      errorOf(r).includes(FLIPPED) && errorOf(r).includes("unrecoverable"),
      errorOf(r),
    );
    check(
      "nothing is read before refusing",
      quiet(calls),
      JSON.stringify(calls),
    );
  }
  {
    const { deps } = fakeDeps();
    const r = await build(
      { kind: "send", amount: "50", token: DEX_USDC, to: "0x1234" },
      deps,
    );
    check(
      "a too-short address is refused",
      !r.ok && errorOf(r).includes("isn't a valid recipient address"),
      errorOf(r),
    );
  }
  {
    /* Unreachable from the typed grammar and refused earlier on the tool-call
       path, so this is the guard behind both rather than the only one. It is
       here because an empty recipient reaching `ethers.Contract` would be a
       transfer to address zero. */
    const { deps } = fakeDeps();
    const r = await build(
      { kind: "send", amount: "50", token: DEX_USDC, to: "" },
      deps,
    );
    check("an empty recipient is refused", !r.ok, kinds(r));
  }
  {
    const { deps } = fakeDeps();
    const r = await build(
      { kind: "send", amount: "0.0000001", token: DEX_USDC, to: CHECKSUMMED },
      deps,
    );
    check(
      "an amount finer than the token's decimals is refused",
      !r.ok && errorOf(r).includes("more precision than USDC"),
      errorOf(r),
    );
    check(
      "and the refusal names the token's real precision",
      errorOf(r).includes("6 decimal places"),
      errorOf(r),
    );
  }
  {
    /* The same digits on an 18-decimal token. Proves the precision check reads
       the matched token's decimals rather than a constant — the failure that
       would send a millionth of what was asked for. */
    const { deps } = fakeDeps();
    const r = await build(
      { kind: "send", amount: "0.0000001", token: DEX_USDE, to: CHECKSUMMED },
      deps,
    );
    check(
      "the same amount is fine on an 18-decimal token",
      r.ok && at(r, 0).amount === "0.0000001",
      errorOf(r) || String(at(r, 0).amount),
    );
  }
  {
    const { deps } = fakeDeps();
    const r = await build(
      { kind: "send", amount: "0.1", token: DEX_ETH, to: CHECKSUMMED },
      deps,
    );
    const t = at(r, 0);
    check(
      "a native send is flagged native and keeps the sentinel it arrived with",
      t.isNative === true && same(t.token, NATIVE_SENTINEL.dex),
      JSON.stringify(t),
    );
  }
  {
    /* Registry rule 3: a sentinel is a *protocol* convention, and a
       wallet-to-wallet send is not a protocol call — so whichever vocabulary
       the parser matched against, this is the same transaction. Only the lending
       table uses ADDRESS_1, and reading it as an ERC20 would mean calling
       `transfer` on the ecrecover precompile. */
    const { deps } = fakeDeps();
    const r = await build(
      {
        kind: "send",
        amount: "0.1",
        token: tk("ETH", 18, NATIVE_SENTINEL.lending),
        to: CHECKSUMMED,
      },
      deps,
    );
    check(
      "the lending sentinel is native too, not an ERC20 at ADDRESS_1",
      r.ok && at(r, 0).isNative === true,
      JSON.stringify(at(r, 0)),
    );
  }

  console.log("\n— bridge —");
  /*
   * Send's cross-chain sibling, and the second command that ends in a call to
   * no Kaleido contract — so, like send, the builder is the only line of defence
   * and each case asserts the specific refusal rather than merely that nothing
   * crashed. It has one more thing to hold in place than send does: a bridge
   * goes to a portal or an aggregator router, the diamond never scopes it, and
   * so the `to`/`data`/`value` MUST originate in the resolver and never in the
   * model. The NATIVE happy path below runs the REAL resolveBridgeRoute over the
   * canonical Sepolia→Base Sepolia corridor, which encodes with no network call,
   * so this stays an offline suite while exercising the exact bytes the wallet
   * would sign. The ERC20 one cannot: every token corridor is an aggregator
   * corridor, and an aggregator route comes from a live quote. So it is stubbed,
   * and what it asserts is the builder's half — that an approve is paired with
   * the router the bridge calls. The route's own vetting lives in route.check.ts.
   *
   * The refusal cases turn on ORDER: build.ts refuses a bridge for its own
   * reasons — no chain, over-precise amount — before it reaches the resolver, so
   * each asserts `calls.bridge` stayed empty. A recorded call there would mean a
   * guard that should have fired first did not, and a route was resolved for a
   * plan that was going to be refused anyway.
   */
  const BRIDGE_USER = "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984";
  const realBridge: Partial<PlanDeps> = {
    bridgeRoute: (req) =>
      resolveBridgeRoute({
        ...req,
        fromChainId: CHAIN,
        userAddress: BRIDGE_USER,
      }),
  };
  {
    const { deps, calls } = fakeDeps(realBridge);
    const r = await build(
      {
        kind: "bridge",
        amount: "0.05",
        token: DEX_ETH,
        toChain: "Base Sepolia",
      },
      deps,
    );
    check(
      "a native bridge is one step — value rides along, so there is nothing to approve",
      kinds(r) === "bridge",
      kinds(r),
    );
    check("and emits no approve", !kinds(r).includes("approve"), kinds(r));
    const b = at(r, 0);
    check(
      "the corridor was resolved once, with the command's own asset and destination",
      calls.bridge.length === 1 &&
        calls.bridge[0].asset === "ETH" &&
        calls.bridge[0].toChain === "Base Sepolia" &&
        calls.bridge[0].isNative === true,
      JSON.stringify(calls.bridge),
    );
    /* The `to` is a portal, and the auditor allow-lists a canonical one by
       re-checking it against the same table it was built from. Asserting both
       here is the seam that keeps builder and auditor reading one source: a `to`
       the builder emits but `isKnownBridgeAddress` rejects would pass this file
       and be refused at audit time, which is the disagreement this catches. */
    check(
      "the `to` is the canonical portal from the resolver, and the auditor's table agrees",
      same(b.to, "0xfd0Bf71F60660E2f608ed56e1659C450eB113120") &&
        isKnownBridgeAddress(CHAIN, String(b.to)),
      String(b.to),
    );
    check(
      "it is tagged canonical and carries the gas floor the OP portal underruns",
      b.provider === "canonical" && b.gasLimit === "1000000",
      JSON.stringify({ provider: b.provider, gasLimit: b.gasLimit }),
    );
    /* The one number the auditor prices against the per-action cap, and the one
       the model is never asked for. 0.05 ETH is 5·10^16 wei; a value that did
       not match the typed amount would move a different sum than the summary
       promises, unseen by any on-chain bound. */
    check(
      "value is the typed amount in wei at the asset's own decimals",
      b.value === "50000000000000000",
      String(b.value),
    );
    check(
      "the chain fields are the source it leaves and the destination it resolved",
      b.fromChainId === CHAIN &&
        b.toChainId === 84532 &&
        b.toChainName === "Base Sepolia" &&
        b.isNative === true,
      JSON.stringify(b),
    );
    /* depositETHTo credits an L2 recipient, and it must be the caller's own
       address. A deposit crediting anyone else is a theft the auditor's `to`
       check cannot see — `to` is the portal, not the recipient, which lives in
       the calldata. So the recipient is checked where it actually is: the user's
       address, encoded into `data`, with nothing of the model's standing in. */
    check(
      "the calldata credits the caller's own address on the far side",
      typeof b.data === "string" &&
        String(b.data)
          .toLowerCase()
          .includes(BRIDGE_USER.slice(2).toLowerCase()),
      String(b.data),
    );
    check(
      "the summary names the amount, the asset and where it lands",
      summaryOf(r) === "Bridge 0.05 ETH to Base Sepolia.",
      summaryOf(r),
    );
  }
  {
    /* An ERC20 leg, which is two signatures rather than one: the router needs an
       allowance before its calldata can pull the token. The pairing is the whole
       point of the case — an approve whose spender is not the contract the bridge
       step calls would grant an allowance to one address and hand calldata to
       another, and because an allowance is a storage write on the token that
       never consults the spender, that wrong grant SUCCEEDS and persists.

       A stub stands in for the resolver: the only ERC20 corridor that resolves is
       an aggregator one, and aggregator routes come from a live HTTP quote this
       suite makes none of. What is under test here is what the builder does with
       a route it was handed — the vetting of that route's own spender is
       route.check.ts's job. So the stub names the real LI.FI diamond, and the
       assertion below runs it back through `isKnownBridgeSpender` rather than
       comparing it to a literal: the builder and the auditor must be reading one
       table, or a plan this file passes is refused at audit time. */
    const ROUTER = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE";
    const { deps, calls } = fakeDeps({
      bridgeRoute: async () => ({
        to: ROUTER,
        data: "0xdeadbeef",
        value: "0",
        spender: ROUTER,
        toChainId: 84532,
        toChainName: "Base Sepolia",
        provider: "lifi",
        etaSeconds: 120,
      }),
    });
    const r = await build(
      {
        kind: "bridge",
        amount: "100",
        token: DEX_USDC,
        toChain: "Base Sepolia",
      },
      deps,
    );
    check(
      "an ERC20 bridge is two steps — the allowance the router needs, then the route",
      kinds(r) === "approve,bridge",
      kinds(r),
    );
    const a = at(r, 0);
    const b = at(r, 1);
    check(
      "the approve names the token the command asked for, at its own decimals",
      same(a.token, DEX_USDC.address) &&
        a.amount === "100" &&
        a.decimals === 6 &&
        a.symbol === "USDC",
      JSON.stringify(a),
    );
    /* The invariant that makes an allowance to a contract we do not own
       auditable: one address, in three places, all from the resolver. */
    check(
      "the allowance goes to the router the bridge itself calls, and the table knows it",
      same(a.spender, ROUTER) &&
        same(b.to, ROUTER) &&
        same(b.spender, ROUTER) &&
        isKnownBridgeSpender(String(a.spender)),
      JSON.stringify({
        spender: a.spender,
        to: b.to,
        bridgeSpender: b.spender,
      }),
    );
    /* A token bridge moves the token, so it attaches no native value. A non-zero
       one here would be an unpriced second transfer riding beside the amount the
       summary names — the auditor refuses it, and so should nothing produce it. */
    check(
      "the bridge step sends no native value — the token is what moves",
      b.value === "0" && b.isNative === false,
      JSON.stringify({ value: b.value, isNative: b.isNative }),
    );
    /* The resolver cross-checks the provider's own symbol resolution against
       this address, because LI.FI resolves `USDC` against its own per-chain list
       and Sepolia lending runs a mock. It can only do that if the builder passes
       the contract it is about to approve, so assert it was passed. */
    check(
      "the corridor was resolved with the exact contract the approve authorises",
      calls.bridge.length === 1 &&
        calls.bridge[0].isNative === false &&
        same(calls.bridge[0].tokenAddress, DEX_USDC.address),
      JSON.stringify(calls.bridge),
    );
    check(
      "the summary names the amount, the asset and where it lands",
      summaryOf(r) === "Bridge 100 USDC to Base Sepolia.",
      summaryOf(r),
    );
  }
  {
    /* A token route that came back with no router to approve. The resolver never
       returns this shape — it refuses first — so this is the seam between the two
       files rather than a case anyone expects to hit: were the resolver's spender
       vetting ever relaxed into silence, the builder would emit a bridge step
       whose calldata pulls a token it never got an allowance for. That reverts
       on-chain, which is the good outcome; refusing before signing is better. */
    const { deps } = fakeDeps({
      bridgeRoute: async () => ({
        to: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
        data: "0xdeadbeef",
        value: "0",
        toChainId: 84532,
        toChainName: "Base Sepolia",
        provider: "lifi",
        etaSeconds: 120,
      }),
    });
    const r = await build(
      {
        kind: "bridge",
        amount: "100",
        token: DEX_USDC,
        toChain: "Base Sepolia",
      },
      deps,
    );
    check(
      "a token route with no router to approve is refused rather than half-signed",
      !r.ok && errorOf(r).includes("without a router to approve"),
      errorOf(r),
    );
  }
  {
    /* An amount finer than the token's decimals. Refused ahead of the resolver
       too, so a corridor is never resolved for an amount that could not be
       parsed into a value — same order as send's precision check. */
    const { deps, calls } = fakeDeps(realBridge);
    const r = await build(
      {
        kind: "bridge",
        amount: "0.0000000000000000001",
        token: DEX_ETH,
        toChain: "Base Sepolia",
      },
      deps,
    );
    check(
      "an amount more precise than the token is refused, with the decimals named",
      !r.ok &&
        errorOf(r).includes("more precision than ETH") &&
        errorOf(r).includes("18 decimal"),
      errorOf(r),
    );
    check(
      "and refused before any corridor is resolved",
      calls.bridge.length === 0,
      JSON.stringify(calls.bridge),
    );
  }
  {
    /* No wallet chain. A bridge is defined by the chain it leaves; with none
       there is no `fromChainId` to resolve against, so this refuses first of
       all — even before the amount and native checks — and reads nothing. */
    const { deps, calls } = fakeDeps(realBridge);
    const r = await build(
      {
        kind: "bridge",
        amount: "0.05",
        token: DEX_ETH,
        toChain: "Base Sepolia",
      },
      { ...deps, chainId: undefined },
    );
    check(
      "with no connected chain, a bridge refuses and says to connect one",
      !r.ok &&
        errorOf(r).includes(
          "Connect a wallet on the chain you want to bridge from",
        ),
      errorOf(r),
    );
    check(
      "and refuses before resolving a corridor",
      calls.bridge.length === 0,
      JSON.stringify(calls.bridge),
    );
  }
  {
    /* The resolver's own error becomes the plan's refusal, verbatim — build.ts
       does not paraphrase it. A stub stands in for the resolver here rather than
       the real one: the offline way to make resolveBridgeRoute return `{ error }`
       is a corridor with no canonical portal, which falls through to the
       aggregator's live HTTP call, and this suite makes none. The propagation is
       what is under test, not the resolver's routing — that is route.check.ts's
       job — so a fixed error string is the honest fixture. */
    const { deps, calls } = fakeDeps({
      bridgeRoute: async () => ({
        error: "No executable route for ETH to Sepolia right now.",
      }),
    });
    const r = await build(
      {
        kind: "bridge",
        amount: "0.05",
        token: DEX_ETH,
        toChain: "Sepolia",
      },
      deps,
    );
    check(
      "a resolver that can't route the corridor refuses with its own words",
      !r.ok &&
        errorOf(r) === "No executable route for ETH to Sepolia right now.",
      errorOf(r),
    );
    check(
      "the resolver was reached — this refusal came from it, not an earlier guard",
      calls.bridge.length === 1,
      JSON.stringify(calls.bridge),
    );
  }

  console.log("\n— lending: collateral —");
  {
    const { deps, calls } = fakeDeps();
    const r = await build(
      { kind: "deposit", amount: "500", token: DEX_USDC },
      deps,
    );
    check(
      "deposit builds approve then depositCollateral",
      kinds(r) === "approve,depositCollateral",
      kinds(r),
    );
    check(
      "the DEX address is re-resolved to the lending currency",
      same(at(r, 1).token, USDC_LENDING) &&
        !same(at(r, 1).token, DEX_USDC.address),
      String(at(r, 1).token),
    );
    check(
      "both steps point at the Diamond",
      same(at(r, 0).spender, DEPLOYED.diamond) &&
        same(at(r, 1).diamond, DEPLOYED.diamond),
      `${String(at(r, 0).spender)} / ${String(at(r, 1).diamond)} vs registry ${String(DEPLOYED.diamond)}`,
    );
    check(
      "decimals come from the lending registry",
      at(r, 0).decimals === 6 && at(r, 1).decimals === 6,
      JSON.stringify([at(r, 0).decimals, at(r, 1).decimals]),
    );
    check("deposit reads nothing", quiet(calls));
  }
  {
    const { deps } = fakeDeps();
    const r = await build(
      { kind: "deposit", amount: "1", token: DEX_ETH },
      deps,
    );
    check(
      "native collateral skips the approve that would revert",
      kinds(r) === "depositCollateral",
      kinds(r),
    );
    check(
      "and carries the lending sentinel, not the DEX one",
      same(at(r, 0).token, ETH_LENDING) &&
        !same(at(r, 0).token, NATIVE_SENTINEL.dex),
      String(at(r, 0).token),
    );
    check("isNative is set for the resolver", at(r, 0).isNative === true);
  }
  {
    const { deps } = fakeDeps();
    const r = await build(
      { kind: "deposit", amount: "1", token: DEX_KLD },
      deps,
    );
    check(
      "a currency the facet doesn't accept is refused by name",
      !r.ok && errorOf(r).includes("doesn't accept KLD to use as collateral"),
      errorOf(r),
    );
    check(
      "and the refusal lists what this chain has actually registered",
      // Derived, not pasted — pasting is how this assertion broke twice. It once
      // expected "ETH, USDC, USDT, USDR, kfUSD"; then it read BORROW_SYMBOLS,
      // which is the list the app OFFERS and has nothing to do with what any
      // diamond accepts. On this chain the two are "ETH, USDC, USDT, kfUSD"
      // against "ETH, WETH, USDC" — so the old assertion was green while the
      // builder was naming two currencies (USDT, kfUSD) that revert here and
      // hiding one (WETH) that works.
      errorOf(r).includes(acceptedList("collateral")),
      errorOf(r),
    );
    /* And it says which value to re-ask about, which is what stops "use USDC"
       from becoming a reasoning request. The list above is only useful if the
       user's reply to it can be read locally. */
    check(
      "and it offers to take a different token without re-parsing the sentence",
      retryOf(r) === "token",
      retryOf(r) || "none",
    );
  }
  {
    const { deps } = fakeDeps();
    const r = await build(
      { kind: "withdraw", amount: "250", token: DEX_USDC },
      deps,
    );
    check(
      "withdraw is a single step — nothing to approve to take your own back",
      kinds(r) === "withdrawCollateral",
      kinds(r),
    );
    check(
      "it withdraws the lending currency at its own decimals",
      same(at(r, 0).token, USDC_LENDING) && at(r, 0).decimals === 6,
      JSON.stringify(at(r, 0)),
    );
  }

  console.log("\n— lending: requests and listings —");
  {
    const { deps, calls } = fakeDeps();
    const r = await build(
      {
        kind: "borrow",
        amount: "1000",
        token: DEX_USDC,
        interestPct: 5,
        days: 30,
      },
      deps,
    );
    check(
      "borrow posts a createLendingRequest",
      kinds(r) === "createLendingRequest",
      kinds(r),
    );
    check(
      "it re-resolves to the lending currency",
      same(at(r, 0).token, USDC_LENDING),
      String(at(r, 0).token),
    );
    check(
      "returnDate is now + days * 86400",
      typeof at(r, 0).returnDate === "number" &&
        at(r, 0).returnDate > Date.now() / 1000,
      String(at(r, 0).returnDate),
    );
    check("borrow reads nothing", quiet(calls));
  }
  {
    const { deps } = fakeDeps();
    const r = await build(
      {
        kind: "lend",
        amount: "500",
        token: DEX_ETH,
        interestPct: 3,
        days: 60,
      },
      deps,
    );
    /* This block used to assert that native lend builds a listing. It does not
       any more, and the change is a fix rather than a regression: the native
       sentinel is registered COLLATERAL on all five deployed chains and loanable
       on none, while createLoanListing checks `s_isLoanable`. So the plan this
       once built reverted `Protocol__TokenNotLoanable` after the user had
       confirmed it in their wallet. One sentence now, instead of a failed
       transaction and a gas bill.

       Native-skips-approve is still covered — by `deposit 1 ETH` above, which is
       gated on the collateral side where the sentinel IS registered. The branch
       inside the lend arm stays in build.ts because registration is on-chain
       state one owner call changes, not an invariant. */
    check(
      "lending native is refused — it is registered collateral, not loanable",
      !r.ok && errorOf(r).includes("doesn't accept ETH to lend or borrow"),
      errorOf(r),
    );
    check(
      "and the refusal names the loanable set, not the offered currencies",
      !r.ok && errorOf(r).includes(acceptedList("loanable")),
      errorOf(r),
    );
    check(
      "the loanable set on this chain really is narrower than the collateral one",
      registry.registeredLendingAssets(CHAIN, "loanable").assets.length <
        registry.registeredLendingAssets(CHAIN, "collateral").assets.length,
      `${acceptedList("loanable")} vs ${acceptedList("collateral")}`,
    );
  }
  {
    const { deps } = fakeDeps();
    const r = await build(
      {
        kind: "lend",
        amount: "2000",
        token: DEX_USDC,
        interestPct: 4,
        days: 45,
      },
      deps,
    );
    check(
      "non-native lend builds approve then listing",
      kinds(r) === "approve,createLoanListing",
      kinds(r),
    );
    check(
      "the listing carries the lending address at lending decimals",
      same(at(r, 1).token, USDC_LENDING) && at(r, 1).decimals === 6,
      JSON.stringify(at(r, 1)),
    );
    check(
      "minAmount and maxAmount equal the full amount — no partial draw invented",
      at(r, 1).minAmount === "2000" && at(r, 1).maxAmount === "2000",
      JSON.stringify({ min: at(r, 1).minAmount, max: at(r, 1).maxAmount }),
    );
  }
  {
    const { deps, calls } = fakeDeps();
    const r = await build({ kind: "cancel", target: "listing", id: 42 }, deps);
    check(
      "cancel a listing is one step — no market data needed when you only need an id",
      kinds(r) === "closeListing" && calls.rows.length === 0,
      kinds(r),
    );
    check("the id is preserved", at(r, 0).listingId === 42);
  }
  {
    const { deps, calls } = fakeDeps();
    const r = await build({ kind: "cancel", target: "request", id: 17 }, deps);
    check(
      "cancel a request is closeRequest",
      kinds(r) === "closeRequest" && calls.rows.length === 0,
      kinds(r),
    );
    check("the id is preserved", at(r, 0).requestId === 17);
  }
  {
    const { deps, calls } = fakeDeps({
      marketRow: async (kind, id) =>
        kind === "listings" && id === 99
          ? { tokenAddress: USDC_LENDING, amount: "500000000" }
          : null,
    });
    const r = await build(
      { kind: "takeListing", listingId: 99, amount: "500" },
      deps,
    );
    check(
      "takeListing reads the listing row to learn the currency",
      calls.rows.length === 1 && calls.rows[0] === "listings#99",
      JSON.stringify(calls.rows),
    );
    check(
      "and builds one borrowFromListing step",
      kinds(r) === "borrowFromListing",
      kinds(r),
    );
    check(
      "the listing id and amount are preserved",
      at(r, 0).listingId === 99 && at(r, 0).amount === "500",
      JSON.stringify(at(r, 0)),
    );
    check(
      "the symbol and decimals come from describeToken",
      at(r, 0).symbol === "USDC" && at(r, 0).decimals === 6,
      JSON.stringify(at(r, 0)),
    );
  }
  {
    const { deps } = fakeDeps({ marketRow: async () => null });
    const r = await build(
      { kind: "takeListing", listingId: 404, amount: "1" },
      deps,
    );
    check(
      "a missing listing is refused by id",
      !r.ok && errorOf(r).includes("can't find an open listing #404"),
      errorOf(r),
    );
  }
  {
    const { deps, calls } = fakeDeps({
      marketRow: async (kind, id) =>
        kind === "requests" && id === 55
          ? { tokenAddress: ETH_LENDING, amount: "2000000000000000000" }
          : null,
    });
    const r = await build({ kind: "fillRequest", requestId: 55 }, deps);
    check(
      "fillRequest reads the request row to learn currency and amount",
      calls.rows.length === 1 && calls.rows[0] === "requests#55",
      JSON.stringify(calls.rows),
    );
    check("native ETH skips approve", kinds(r) === "fillRequest", kinds(r));
    check(
      "the amount is formatUnits(row.amount, decimals)",
      at(r, 0).amount === "2.0",
      String(at(r, 0).amount),
    );
    check("isNative is set for ETH", at(r, 0).isNative === true);
  }
  {
    const { deps } = fakeDeps({
      marketRow: async (kind, id) =>
        kind === "requests" && id === 10
          ? { tokenAddress: USDC_LENDING, amount: "1500000000" }
          : null,
    });
    const r = await build({ kind: "fillRequest", requestId: 10 }, deps);
    check(
      "non-native fillRequest builds approve then fillRequest",
      kinds(r) === "approve,fillRequest",
      kinds(r),
    );
    check(
      "the approve and fillRequest both carry the lending address at the currency's decimals",
      same(at(r, 0).token, USDC_LENDING) &&
        at(r, 0).decimals === 6 &&
        same(at(r, 1).token, USDC_LENDING) &&
        at(r, 1).decimals === 6,
      JSON.stringify([at(r, 0), at(r, 1)]),
    );
    check(
      "the amount is 1500 USDC (row.amount / 10^6)",
      at(r, 1).amount === "1500.0",
      String(at(r, 1).amount),
    );
  }

  console.log("\n— kfUSD —");
  {
    const { deps } = fakeDeps();
    const r = await build(
      { kind: "mint", amount: "500", token: DEX_USDC },
      deps,
    );
    check(
      "mint builds approve then mintStable",
      kinds(r) === "approve,mintStable",
      kinds(r),
    );
    check(
      "the collateral is approved to the kfUSD contract",
      same(at(r, 0).spender, STABLE_CONTRACTS.kfUSD),
      String(at(r, 0).spender),
    );
    check(
      "the collateral address comes from STABLE_CONTRACTS, not the parser",
      same(at(r, 1).collateralToken, STABLE_CONTRACTS.USDC) &&
        !same(at(r, 1).collateralToken, DEX_USDC.address),
      String(at(r, 1).collateralToken),
    );
    check(
      "collateral decimals are 6 for USDC",
      at(r, 1).collateralDecimals === 6,
      String(at(r, 1).collateralDecimals),
    );
  }
  {
    /* The lookup upper-cases the symbol, so a "USDe"-keyed table never matched
       and every USDe mint was refused for a collateral the contracts accept.
       Fixed in the move to build.ts; this is the regression test. */
    const { deps } = fakeDeps();
    const r = await build(
      { kind: "mint", amount: "10", token: DEX_USDE },
      deps,
    );
    check(
      "USDe is accepted despite the case of its symbol",
      r.ok && same(at(r, 1).collateralToken, STABLE_CONTRACTS.USDe),
      errorOf(r) || String(at(r, 1).collateralToken),
    );
    check(
      "and carries 18 decimals, unlike the other two",
      at(r, 1).collateralDecimals === 18,
      String(at(r, 1).collateralDecimals),
    );
  }
  {
    const { deps } = fakeDeps();
    const r = await build({ kind: "mint", amount: "1", token: DEX_KLD }, deps);
    check(
      "a collateral the stablecoin never heard of is refused by name",
      !r.ok && errorOf(r).startsWith("KLD isn't accepted as kfUSD collateral"),
      errorOf(r),
    );
    check(
      "and the amount is kept, so only the collateral is re-asked",
      retryOf(r) === "token",
      retryOf(r) || "none",
    );
  }
  {
    /* The other half of the contract: a refusal no answer can fix must NOT set
       `retry`. Staking is unavailable on this chain full stop, so holding a
       draft open would ask a question whose every possible reply is refused —
       the slot loop the agent page's `pending` handling exists to avoid. */
    const { deps } = fakeDeps({ chainId: 1 });
    const r = await build({ kind: "stake", amount: "100" }, deps);
    check(
      "a terminal refusal offers no retry",
      !r.ok && retryOf(r) === "",
      `${errorOf(r)} / ${retryOf(r) || "none"}`,
    );
  }
  {
    const { deps } = fakeDeps();
    const r = await build(
      { kind: "redeem", amount: "200", token: DEX_USDC },
      deps,
    );
    check(
      "redeem builds approve then redeemStable",
      kinds(r) === "approve,redeemStable",
      kinds(r),
    );
    check(
      "kfUSD approves itself, matching useStablecoin's redeemKfUSD",
      same(at(r, 0).token, STABLE_CONTRACTS.kfUSD) &&
        same(at(r, 0).spender, STABLE_CONTRACTS.kfUSD),
      JSON.stringify(at(r, 0)),
    );
    check(
      "the payout token is the resolved collateral",
      same(at(r, 1).outputToken, STABLE_CONTRACTS.USDC) &&
        at(r, 1).outputSymbol === "USDC",
      JSON.stringify(at(r, 1)),
    );
  }
  {
    const { deps } = fakeDeps();
    const r = await build({ kind: "lock", amount: "300" }, deps);
    check(
      "lock builds approve then lockStable",
      kinds(r) === "approve,lockStable",
      kinds(r),
    );
    check(
      "kfUSD is approved to the kafUSD vault",
      same(at(r, 0).token, STABLE_CONTRACTS.kfUSD) &&
        same(at(r, 0).spender, STABLE_CONTRACTS.kafUSD),
      JSON.stringify(at(r, 0)),
    );
    check(
      "both vault and asset addresses are pinned",
      same(at(r, 1).kafUSD, STABLE_CONTRACTS.kafUSD) &&
        same(at(r, 1).kfUSD, STABLE_CONTRACTS.kfUSD),
      JSON.stringify(at(r, 1)),
    );
  }
  {
    const { deps } = fakeDeps();
    const r = await build({ kind: "unlock", amount: "300" }, deps);
    check(
      "unlock only requests — the payout is a second, later step",
      kinds(r) === "requestStableWithdrawal",
      kinds(r),
    );
    check(
      "the summary says the cooldown hasn't paid out",
      summaryOf(r).includes("doesn't pay out yet"),
      summaryOf(r),
    );
  }
  {
    const { deps } = fakeDeps();
    /* Address deliberately wrong, as with every DEX_* token here: the payout is
       the vault's own kfUSD, so the builder must supply that address and not
       echo back whatever the parser resolved. */
    const r = await build(
      { kind: "completeWithdrawal", token: tk("kfUSD", 18, DEX_USDE.address) },
      deps,
    );
    check(
      "completeWithdrawal is one step with no amount",
      kinds(r) === "completeStableWithdrawal" && at(r, 0).amount === undefined,
      kinds(r),
    );
    check(
      "it pays out the kfUSD the vault released, not the token it was handed",
      same(at(r, 0).outputToken, STABLE_CONTRACTS.kfUSD) &&
        at(r, 0).outputSymbol === "kfUSD",
      JSON.stringify(at(r, 0)),
    );
  }
  {
    /* The vault releases assetLockBalances[user][asset] (kafUSD.sol:185) and
       `lock` only ever locks kfUSD, so every other balance there is zero. A
       collateral payout doesn't pay out in collateral — it reverts, after the
       cooldown has already run its full seven days. Refuse at build time. */
    const { deps } = fakeDeps();
    const r = await build(
      { kind: "completeWithdrawal", token: DEX_USDC },
      deps,
    );
    check(
      "a collateral payout is refused rather than built into a revert",
      !r.ok && errorOf(r).includes("pays out in kfUSD"),
      kinds(r),
    );
    check(
      "and the refusal names redeeming as the way to get that collateral",
      errorOf(r).includes("redeem"),
      errorOf(r),
    );
  }
  {
    const { deps } = fakeDeps();
    const r = await build({ kind: "claimYield" }, deps);
    check("claimYield is one step", kinds(r) === "claimStableYield", kinds(r));
    check(
      "it claims kfUSD from the yield treasury",
      same(at(r, 0).yieldTreasury, STABLE_CONTRACTS.YieldTreasury) &&
        same(at(r, 0).asset, STABLE_CONTRACTS.kfUSD),
      JSON.stringify(at(r, 0)),
    );
  }
  {
    const { deps } = fakeDeps();
    const r = await build({ kind: "compoundYield" }, deps);
    check(
      "compoundYield is one step",
      kinds(r) === "compoundStableYield",
      kinds(r),
    );
    check(
      "it names both treasury and asset",
      same(at(r, 0).yieldTreasury, STABLE_CONTRACTS.YieldTreasury) &&
        same(at(r, 0).kfUSD, STABLE_CONTRACTS.kfUSD),
      JSON.stringify(at(r, 0)),
    );
  }

  console.log("\n— pool —");
  const baseTokens = chainTokens(CHAIN);
  /*
   * The pair every position fixture below holds, read out of the registry rather
   * than fabricated the way the mint's legs are.
   *
   * The difference is real and not stylistic: a `provideLiquidity` command
   * carries an IToken per leg, so the mint is handed its decimals. A position
   * branch is handed nothing but two addresses off the chain and looks the
   * decimals up with `declaredDecimals`. A made-up address has none, and every
   * increase case here would assert nothing but that one refusal.
   */
  const WETH_TOKEN = baseTokens.find((t) => t.symbol === "WETH");
  const USDC_TOKEN = baseTokens.find((t) => t.symbol === "USDC");
  if (!WETH_TOKEN || !USDC_TOKEN) {
    throw new Error(`chain ${CHAIN} has no WETH and USDC in its token registry`);
  }
  /* 1834.61 USDC per WETH, the same figure the landing-page fixture uses so the
     two cannot describe different markets. */
  const WETH_USDC_SPOT = 1834.61;
  /*
   * ±10% of that spot, snapped outward to the 0.3% tier's 60-tick spacing.
   *
   * Written down in one place because two branches have to agree on it. The mint
   * case ASSERTS the band resolves to exactly this pair — nothing feeds it a
   * tick, so the assertion is as strong against a named constant as against a
   * literal — and the increase fixture is GIVEN it. That makes an increase into
   * this position and a fresh mint of the same band two paths to one range, so
   * the floors and bounds they print have to match, and a divergence in either
   * shows up as a number the other case already measured.
   */
  const BAND_TICKS = { lower: -202200, upper: -200220 };
  const POSITION = {
    tokenId: "7",
    token0: WETH_TOKEN.address,
    token1: USDC_TOKEN.address,
    liquidity: "123456789",
    /* Neither `collectFees` nor `removePosition` reads the tier or the ticks — a
       collect takes a tokenId and a recipient, a decrease takes an amount of
       liquidity — so these three are here because `increasePosition` made them
       required on PoolPositionRef. They are the real range rather than zeroes for
       the reason the pool fixtures carry a real `tick`: a fixture that lies about
       a field nothing reads is still a lie waiting for a reader. */
    fee: 3000,
    tickLower: BAND_TICKS.lower,
    tickUpper: BAND_TICKS.upper,
  };
  {
    const { deps, calls } = fakeDeps({ positions: async () => [POSITION] });
    const r = await build({ kind: "collectFees", positionId: 7 }, deps);
    check(
      "collectFees enumerates positions once",
      calls.positions === 1,
      String(calls.positions),
    );
    check("and builds one step", kinds(r) === "collectPoolFees", kinds(r));
    check(
      "pinned to the V3 position manager",
      same(at(r, 0).positionManager, LEGACY_CONTRACTS.v3PositionManager),
      String(at(r, 0).positionManager),
    );
    check(
      "the pair label resolves both symbols from the chain registry",
      at(r, 0).pairLabel === `${WETH_TOKEN.symbol}/${USDC_TOKEN.symbol}`,
      String(at(r, 0).pairLabel),
    );
  }
  {
    const { deps } = fakeDeps({ positions: async () => [POSITION] });
    const r = await build({ kind: "removePosition", positionId: 7 }, deps);
    check(
      "removePosition is decrease then collect, each signed separately",
      kinds(r) === "decreasePoolLiquidity,collectPoolFees",
      kinds(r),
    );
    check(
      "the decrease carries the position's full raw liquidity",
      at(r, 0).liquidity === "123456789",
      String(at(r, 0).liquidity),
    );
    check(
      "both legs act on the same token id",
      at(r, 0).tokenId === "7" && at(r, 1).tokenId === "7",
      JSON.stringify([at(r, 0).tokenId, at(r, 1).tokenId]),
    );
  }
  {
    const { deps } = fakeDeps({ positions: async () => [POSITION] });
    const r = await build({ kind: "collectFees", positionId: 8 }, deps);
    check(
      "a position the wallet doesn't hold is refused by id",
      !r.ok && errorOf(r).includes("can't find position #8 in your wallet"),
      errorOf(r),
    );
  }

  console.log("\n— pool: opening a position —");
  /*
   * The only pool action that spends, and the only branch in build.ts that can
   * create the market it is reading. Three things are being held in place here,
   * and each of them fails silently rather than loudly if it breaks:
   *
   *   THE RANGE IS DERIVED. Nothing upstream of the builder names a tick — the
   *   band's centre is read off `poolState` — so the cases below assert what the
   *   band resolved to, not merely that it resolved. A range that does not
   *   straddle the market opens the position one-sided; it earns nothing and
   *   nothing reverts to say so.
   *
   *   THE FLOORS ARE NOT ZERO. `NonfungiblePositionManager` checks
   *   `amount0 >= amount0Min && amount1 >= amount1Min`, so a pair of zeroes
   *   accepts any execution at all. The /pool page shipped exactly that until it
   *   was fixed, which is why it is asserted here and again in the auditor.
   *
   *   THE PAIR'S ORDER IS THE CALLER'S. Every price, amount and decimal in the
   *   built intent is in the order the command named, and `sortMintParams` does
   *   the single crossing at resolve time. A test that accepted either order
   *   would not notice half of that crossing going missing.
   *
   * WETH is `tk`'d locally rather than taken from the registry: these assertions
   * are about arithmetic at 18-vs-6 decimals, and a registry symbol whose
   * decimals changed would move the expected ticks without the test saying why.
   */
  const DEX_WETH = tk("WETH", 18, "0xdec0000000000000000000000000000000000003");
  /* The spot and the band both live at the top of the pool section now, shared
     with the position fixtures — see BAND_TICKS there for why. `tick` is what
     that price is in the contracts' own terms; nothing in build.ts reads it, and
     a fixture that lies about an unread field is still a lie. */
  const pool = (liquidity: string, price = WETH_USDC_SPOT) => ({
    address: "0x0000000000000000000000000000000000000f01",
    tick: priceToTick(price, 18, 6),
    price,
    liquidity,
  });
  /* A band's consumed ratio is NOT the spot price — measured 1968.01 USDC per
     WETH for ±10% around 1834.61 — so 1 and 2000 leaves USDC slightly
     over-supplied and WETH the binding side. Chosen so both floors land near the
     typed amounts; see the note on the minimums case. */
  const MINT = {
    kind: "provideLiquidity" as const,
    token0: DEX_WETH,
    amount0: "1",
    token1: DEX_USDC,
    amount1: "2000",
  };

  {
    const { deps, calls } = fakeDeps({ poolState: async () => pool("9000") });
    const r = await build(
      { ...MINT, fee: 3000, range: { kind: "band", pct: 0.1 } },
      deps,
    );
    check(
      "a mint is approve, approve, then the position",
      kinds(r) === "approve,approve,mintPoolPosition",
      kinds(r),
    );
    check(
      "a named tier is the only one read",
      calls.pools.join(",") === "3000",
      calls.pools.join(","),
    );
    check(
      "both approves authorise the position manager, not the router",
      same(at(r, 0).spender, LEGACY_CONTRACTS.v3PositionManager) &&
        same(at(r, 1).spender, LEGACY_CONTRACTS.v3PositionManager),
      `${at(r, 0).spender} / ${at(r, 1).spender}`,
    );
    check(
      "each approve carries its own token at its own decimals",
      same(at(r, 0).token, DEX_WETH.address) &&
        at(r, 0).decimals === 18 &&
        same(at(r, 1).token, DEX_USDC.address) &&
        at(r, 1).decimals === 6,
      `${JSON.stringify(at(r, 0))} ${JSON.stringify(at(r, 1))}`,
    );
    const m = at(r, 2);
    check(
      "the mint keeps the caller's token order, decimals and symbols together",
      same(m.token0, DEX_WETH.address) &&
        same(m.token1, DEX_USDC.address) &&
        m.decimals0 === 18 &&
        m.decimals1 === 6 &&
        m.symbol0 === "WETH" &&
        m.symbol1 === "USDC",
      JSON.stringify(m),
    );
    /* The tick assertion, and the reason it names numbers rather than a
       relation: ±10% of 1834.61 is 1651.15–2018.07, which snaps OUTWARD to the
       60-tick multiples BAND_TICKS holds. Asserting only "lower < upper" would
       pass for a band centred anywhere at all. */
    check(
      "the band snapped to the 0.3% tier's 60-tick multiples around the spot",
      m.tickLower === BAND_TICKS.lower && m.tickUpper === BAND_TICKS.upper,
      `${m.tickLower}..${m.tickUpper}`,
    );
    check(
      "both bounds are integer multiples of the tier's spacing",
      Number(m.tickLower) % 60 === 0 && Number(m.tickUpper) % 60 === 0,
      `${m.tickLower}..${m.tickUpper}`,
    );
    /* The market has to be inside the range. This is the assertion that would
       catch an inverted spot or a band centred on the wrong price — both of
       which produce a plan that builds, signs and earns nothing. */
    check(
      "and the current price sits inside the range it resolved to",
      Number(m.lowerPrice) < WETH_USDC_SPOT &&
        WETH_USDC_SPOT < Number(m.upperPrice),
      `${m.lowerPrice} < ${WETH_USDC_SPOT} < ${m.upperPrice}`,
    );
    /*
     * Neither floor is zero and neither is the typed amount. 0.995 is 1 WETH less
     * 50bps, because WETH binds; 1958.169197 is what the range consumes of the
     * over-supplied USDC leg, also less 50bps. Flooring both at 99.5% of what was
     * typed — the obvious version — would revert nearly every honest deposit,
     * because the pool takes `min(L(amount0), L(amount1))` and leaves the rest.
     */
    check(
      "the floors come from what the range consumes, not from what was typed",
      m.amount0Min === "0.995" && m.amount1Min === "1958.169197",
      `${m.amount0Min} / ${m.amount1Min}`,
    );
    check(
      "the position does not claim to be creating the pool",
      m.createsPool === false,
      String(m.createsPool),
    );
    check(
      "and it carries the caller's deadline and the position manager",
      m.deadlineMin === 20 &&
        same(m.positionManager, LEGACY_CONTRACTS.v3PositionManager),
      JSON.stringify([m.deadlineMin, m.positionManager]),
    );
    check(
      "the summary names the pair, the tier and the bounds",
      summaryOf(r).includes("WETH/USDC 0.3% pool") &&
        summaryOf(r).includes("1655.79") &&
        summaryOf(r).includes("2018.32"),
      summaryOf(r),
    );
  }
  {
    /* No pool at the named tier. The mint still builds — that is the point of
       the branch — but only at full range, and the summary has to say it is
       creating the pool rather than joining one. */
    const { deps } = fakeDeps({ poolState: async () => null });
    const r = await build(
      { ...MINT, fee: 3000, range: { kind: "full" } },
      deps,
    );
    const m = at(r, 2);
    check(
      "a pool that doesn't exist yet still builds a full-range mint",
      kinds(r) === "approve,approve,mintPoolPosition",
      kinds(r),
    );
    check(
      "flagged as creating the pool",
      m.createsPool === true,
      String(m.createsPool),
    );
    /* ±887272 is a multiple of no spacing — MIN_TICK/MAX_TICK are not aligned —
       so full range on the 0.3% tier is ±887220. An unaligned bound reverts
       inside TickBitmap.flipTick on a bare require with no reason string. */
    check(
      "full range is the widest 60-aligned pair, not MIN_TICK/MAX_TICK",
      m.tickLower === -887220 && m.tickUpper === 887220,
      `${m.tickLower}..${m.tickUpper}`,
    );
    check(
      "the summary says it is creating the pool, at the price the amounts set",
      summaryOf(r).startsWith("Create the WETH/USDC 0.3% pool") &&
        summaryOf(r).includes("2000.00 USDC per WETH"),
      summaryOf(r),
    );
    /* The two amounts set the opening price, so the floor is what protects
       against someone front-running the initialise with a different one. */
    check(
      "and it still carries a slippage floor on both sides",
      Number(m.amount0Min) > 0 && Number(m.amount1Min) > 0,
      `${m.amount0Min} / ${m.amount1Min}`,
    );
  }
  {
    /* A band on a pool that doesn't exist has no centre. Refused rather than
       centred on the amounts, which would silently turn "±10% of the market"
       into "±10% of whatever I just deposited". */
    const { deps } = fakeDeps({ poolState: async () => null });
    const r = await build(
      { ...MINT, fee: 3000, range: { kind: "band", pct: 0.1 } },
      deps,
    );
    check(
      "a band on a pool that doesn't exist is refused, and says why",
      !r.ok &&
        errorOf(r).includes("no market price to centre a range on") &&
        errorOf(r).includes("full range"),
      errorOf(r),
    );
  }
  {
    /* The 1% tier's spacing is 200 ticks, about 2% of price, so anything under
       ±1% there lands both bounds on the same multiple. The mint would revert
       with nothing a user could act on. */
    const { deps } = fakeDeps({ poolState: async () => pool("9000") });
    const r = await build(
      { ...MINT, fee: 10000, range: { kind: "band", pct: 0.005 } },
      deps,
    );
    check(
      "a band narrower than the tier's spacing is refused by name",
      !r.ok &&
        errorOf(r).includes("narrower than the 1% tier's tick spacing") &&
        errorOf(r).includes("finer tier"),
      errorOf(r),
    );
  }
  {
    /* Explicit bounds, and the case that proves the band is not the only path
       to a range: prices are token1 per token0 in the caller's order. */
    const { deps } = fakeDeps({ poolState: async () => pool("9000") });
    const r = await build(
      {
        ...MINT,
        fee: 3000,
        range: { kind: "prices", minPrice: 1600, maxPrice: 2100 },
      },
      deps,
    );
    const m = at(r, 2);
    check(
      "explicit prices snap to the tier and still straddle the market",
      r.ok &&
        Number(m.lowerPrice) < WETH_USDC_SPOT &&
        WETH_USDC_SPOT < Number(m.upperPrice) &&
        Number(m.tickLower) % 60 === 0 &&
        Number(m.tickUpper) % 60 === 0,
      `${errorOf(r)} ${m.lowerPrice}..${m.upperPrice}`,
    );
  }
  {
    /* Tier resolution, and the assertion that it read rather than guessed: the
       0.3% pool is thinnest and the 1% deepest, so a builder that defaulted to
       3000 would still return a plan and still look right. */
    const { deps, calls } = fakeDeps({
      poolState: async (_a, _b, fee) =>
        fee === 500 ? pool("100") : fee === 3000 ? pool("50") : pool("9000"),
    });
    const r = await build({ ...MINT, range: { kind: "band", pct: 0.1 } }, deps);
    check(
      "with no tier named, all three are read",
      calls.pools.join(",") === "500,3000,10000",
      calls.pools.join(","),
    );
    check(
      "and the deepest pool wins, not the cheapest or the first",
      at(r, 2).fee === 10000,
      String(at(r, 2).fee),
    );
  }
  {
    /* The tie-break, and it goes the other way from depth: two equally deep
       pools is the stable-pair case, where the cheaper tier is the one to be in.
       `>` rather than `>=` in build.ts is what keeps FEE_TIERS order. */
    const { deps } = fakeDeps({ poolState: async () => pool("9000") });
    const r = await build({ ...MINT, range: { kind: "full" } }, deps);
    check(
      "equal depth breaks to the cheapest tier",
      at(r, 2).fee === 500,
      String(at(r, 2).fee),
    );
  }
  {
    /* Liquidity is a uint128. Compared as a BigInt because a pool deep enough to
       matter does not survive a float: these two differ by 1 in the last place
       and Number() reads them as equal. */
    const { deps } = fakeDeps({
      poolState: async (_a, _b, fee) =>
        fee === 500
          ? pool("340282366920938463463374607431768211454")
          : fee === 3000
            ? pool("340282366920938463463374607431768211455")
            : null,
    });
    const r = await build({ ...MINT, range: { kind: "full" } }, deps);
    check(
      "depth is compared as a uint128, not as a float",
      at(r, 2).fee === 3000,
      String(at(r, 2).fee),
    );
  }
  {
    /* No pool at any tier and no tier named. This one is a question rather than
       a default, and deliberately: the first position sets the fee the pool
       charges forever, so guessing 0.3% on the user's behalf is a permanent
       decision made silently. */
    const { deps, calls } = fakeDeps({ poolState: async () => null });
    const r = await build({ ...MINT, range: { kind: "full" } }, deps);
    check(
      "no pool at any tier asks which tier, and names all three",
      !r.ok &&
        errorOf(r).includes("sets the fee it charges permanently") &&
        errorOf(r).includes("0.05%") &&
        errorOf(r).includes("0.3%") &&
        errorOf(r).includes("1%"),
      errorOf(r),
    );
    check(
      "and it asked all three before asking the user",
      calls.pools.join(",") === "500,3000,10000",
      calls.pools.join(","),
    );
  }
  {
    /* 0.01% has a tick spacing in TICK_SPACINGS because Uniswap's library does,
       and no pool here because the factory has it disabled. Refused before any
       read: otherwise it reads as a pool that merely does not exist yet, takes
       the create-and-initialise path, and reverts inside the factory with two
       approvals already signed. */
    const { deps, calls } = fakeDeps({ poolState: async () => pool("9000") });
    const r = await build({ ...MINT, fee: 100, range: { kind: "full" } }, deps);
    check(
      "a tier this DEX hasn't got is refused, and no pool is read for it",
      !r.ok &&
        errorOf(r).includes("0.01% isn't a fee tier this DEX has") &&
        calls.pools.length === 0,
      `${errorOf(r)} pools:${calls.pools.join(",")}`,
    );
  }
  {
    /* Native is refused rather than wrapped for us: wrapping is a transaction of
       its own, and inserting one silently means the user signs a deposit into
       WETH they never asked for. The refusal has to name the wrapped token, or
       the retry cannot succeed. */
    const { deps, calls } = fakeDeps({ poolState: async () => pool("9000") });
    const r = await build(
      {
        ...MINT,
        token0: DEX_ETH,
        range: { kind: "full" },
      },
      deps,
    );
    check(
      "native ETH is refused by name, and points at the wrapped token",
      !r.ok &&
        errorOf(r).includes("can't take native ETH") &&
        errorOf(r).includes("Wrap it to W"),
      errorOf(r),
    );
    check(
      "and refused before any pool is read",
      calls.pools.length === 0,
      calls.pools.join(","),
    );
  }
  {
    const { deps } = fakeDeps({ poolState: async () => pool("9000") });
    const r = await build(
      { ...MINT, token1: DEX_WETH, range: { kind: "full" } },
      deps,
    );
    check(
      "the same token on both sides is refused",
      !r.ok && errorOf(r).includes("two different tokens"),
      errorOf(r),
    );
  }
  {
    /* Zero on either side is refused by mintMinimums rather than by the pool.
       A one-sided mint is legitimate in V3 — a range entirely above or below the
       market — but it is expressed as a range, not as a zero amount, and a zero
       here would make the whole floor calculation meaningless. */
    const { deps } = fakeDeps({ poolState: async () => pool("9000") });
    const r = await build(
      { ...MINT, amount1: "0", fee: 3000, range: { kind: "band", pct: 0.1 } },
      deps,
    );
    check(
      "a zero on either side is refused",
      !r.ok && errorOf(r).includes("need a positive amount"),
      errorOf(r),
    );
  }
  {
    /* More decimals than the token has. parseUnits throws on it, and an
       unhandled throw here would surface as a stack trace in the chat rather
       than as a sentence. */
    const { deps } = fakeDeps({ poolState: async () => pool("9000") });
    const r = await build(
      {
        ...MINT,
        amount1: "2000.1234567",
        fee: 3000,
        range: { kind: "band", pct: 0.1 },
      },
      deps,
    );
    check(
      "an amount more precise than the token is refused, with the decimals named",
      !r.ok && errorOf(r).includes("18 and 6 decimals"),
      errorOf(r),
    );
  }
  {
    /* A failed read is a missing pool, not a thrown plan. `readPoolState`
       already swallows its own failures, so this is the belt on top of the
       braces — and it must not become a band centred on nothing. */
    const { deps } = fakeDeps({
      poolState: async () => {
        throw new Error("RPC down");
      },
    });
    const r = await build(
      { ...MINT, fee: 3000, range: { kind: "full" } },
      deps,
    );
    check(
      "a failing pool read degrades to 'no pool', not to a thrown plan",
      r.ok && at(r, 2).createsPool === true,
      `${errorOf(r)} ${String(at(r, 2).createsPool)}`,
    );
  }

  console.log("\n— pool: adding to and trimming a position —");
  /*
   * The two branches that act on a position that already exists and change what
   * it holds. What is being held in place here:
   *
   *   THE POOL'S ORDER WINS. `increasePoolLiquidity` carries amounts in the
   *   POSITION's token0/token1 order, not the caller's — the opposite of the mint
   *   — because `increaseLiquidity` reads the pair out of storage and its
   *   resolver therefore sorts nothing. Getting this backwards does not revert:
   *   it deposits the pair upside down. So the first two cases call with the
   *   tokens named in each order and assert the same intent comes out.
   *
   *   THE RANGE IS READ, NOT CHOSEN. An increase cannot move a position's bounds,
   *   so the floors come from the ticks in storage. The fixture is given
   *   BAND_TICKS and the amounts the mint case uses, which makes every number
   *   below one the mint already measured — a floor derived from the caller's
   *   amounts instead of from the range would show up as a different pair.
   *
   *   A SHARE IS AN EXACT SHARE. Liquidity is a uint128 past 2^53, so the burn is
   *   integer maths on a BigInt, and 100 is the position's own figure rather than
   *   the arithmetic's — "remove 100%" must not leave dust that a later collect
   *   then reports as a balance.
   */
  const INCREASE = {
    kind: "increasePosition" as const,
    positionId: 7,
    /* Bare words, not IToken objects — the command carries what the model said,
       and the position is what resolves it. Named USDC-first, which is the
       OPPOSITE of the fixture's pool order: the whole point of the case is that
       the builder has to cross them. */
    symbol0: "USDC",
    amount0: "2000",
    symbol1: "WETH",
    amount1: "1",
  };
  {
    const { deps, calls } = fakeDeps({
      positions: async () => [POSITION],
      poolState: async () => pool("9000"),
    });
    const r = await build(INCREASE, deps);
    check(
      "an increase is approve, approve, then the increase",
      kinds(r) === "approve,approve,increasePoolLiquidity",
      kinds(r),
    );
    check(
      "it reads the position's own tier and nothing else",
      calls.pools.join(",") === "3000" && calls.positions === 1,
      `${calls.pools.join(",")} / ${calls.positions}`,
    );
    check(
      "both approves authorise the position manager, each at its own decimals",
      same(at(r, 0).spender, LEGACY_CONTRACTS.v3PositionManager) &&
        same(at(r, 1).spender, LEGACY_CONTRACTS.v3PositionManager) &&
        same(at(r, 0).token, WETH_TOKEN.address) &&
        at(r, 0).decimals === 18 &&
        same(at(r, 1).token, USDC_TOKEN.address) &&
        at(r, 1).decimals === 6,
      `${JSON.stringify(at(r, 0))} ${JSON.stringify(at(r, 1))}`,
    );
    const inc = at(r, 2);
    check(
      "the amounts cross into the pool's order, not the caller's",
      same(inc.token0, WETH_TOKEN.address) &&
        inc.amount0 === "1" &&
        same(inc.token1, USDC_TOKEN.address) &&
        inc.amount1 === "2000",
      JSON.stringify(inc),
    );
    check(
      "and so do the decimals and the symbols",
      inc.decimals0 === 18 &&
        inc.decimals1 === 6 &&
        inc.symbol0 === "WETH" &&
        inc.symbol1 === "USDC",
      JSON.stringify(inc),
    );
    check(
      "it carries the position's tier and token id, and the caller's deadline",
      inc.fee === 3000 &&
        inc.tokenId === "7" &&
        inc.deadlineMin === 20 &&
        same(inc.positionManager, LEGACY_CONTRACTS.v3PositionManager),
      JSON.stringify(inc),
    );
    /* The same floors the mint case measured for this band and these amounts,
       which is the assertion that says the range came out of storage: a floor
       taken from the typed amounts would be 0.995 and 1990 instead. */
    check(
      "the floors come from the position's range, matching the mint of the same band",
      inc.amount0Min === "0.995" && inc.amount1Min === "1958.169197",
      `${inc.amount0Min} / ${inc.amount1Min}`,
    );
    check(
      "the bounds it reports are the position's, and they straddle the market",
      Number(inc.lowerPrice) < WETH_USDC_SPOT &&
        WETH_USDC_SPOT < Number(inc.upperPrice),
      `${inc.lowerPrice} < ${WETH_USDC_SPOT} < ${inc.upperPrice}`,
    );
    check(
      "the summary names the pair, the id and the range it will earn over",
      summaryOf(r).includes("WETH/USDC #7") &&
        summaryOf(r).includes("1655.79") &&
        summaryOf(r).includes("2018.32"),
      summaryOf(r),
    );
  }
  {
    /* The same increase with the tokens named in the pool's own order. Two
       different sentences, one transaction — if this and the case above ever
       disagree, one of them is depositing the pair inverted. */
    const { deps } = fakeDeps({
      positions: async () => [POSITION],
      poolState: async () => pool("9000"),
    });
    const r = await build(
      {
        ...INCREASE,
        symbol0: "WETH",
        amount0: "1",
        symbol1: "USDC",
        amount1: "2000",
      },
      deps,
    );
    const inc = at(r, 2);
    check(
      "naming the pair in the pool's order builds the identical increase",
      same(inc.token0, WETH_TOKEN.address) &&
        inc.amount0 === "1" &&
        inc.amount1 === "2000" &&
        inc.amount0Min === "0.995" &&
        inc.amount1Min === "1958.169197",
      JSON.stringify(inc),
    );
  }
  {
    /* A token the position does not hold. The refusal names both of the ones it
       does, which is the whole reason this branch matches against the position
       instead of resolving the words through the registry. */
    const { deps } = fakeDeps({
      positions: async () => [POSITION],
      poolState: async () => pool("9000"),
    });
    const r = await build({ ...INCREASE, symbol0: "KLD" }, deps);
    check(
      "a token the position doesn't hold is refused, naming the two it does",
      !r.ok &&
        errorOf(r).includes("WETH/USDC position") &&
        errorOf(r).includes("I was given KLD and WETH"),
      errorOf(r),
    );
  }
  {
    /* Native, refused rather than aliased onto the wrapped leg — the same answer
       the mint gives, and for the same reason: what the position takes is WETH,
       and someone asking to add ETH may be holding only ETH. The message has to
       carry the wrapped symbol or the retry has nothing to go on. */
    const { deps, calls } = fakeDeps({
      positions: async () => [POSITION],
      poolState: async () => pool("9000"),
    });
    const r = await build({ ...INCREASE, symbol1: "ETH" }, deps);
    check(
      "a native name is refused with the wrapped symbol to retry with",
      !r.ok &&
        errorOf(r).includes("not native ETH") &&
        errorOf(r).includes("then add 1 WETH"),
      errorOf(r),
    );
    check(
      "and it refuses before pricing the pool",
      calls.pools.length === 0,
      calls.pools.join(","),
    );
  }
  {
    /* No price, no floor. Refused rather than built with `spot: null`, which
       mintMinimums reads as "this pool is about to be created" and answers by
       deriving the ratio from the caller's own amounts — a floor that agrees with
       whatever was typed is not a floor. */
    const { deps } = fakeDeps({
      positions: async () => [POSITION],
      poolState: async () => null,
    });
    const r = await build(INCREASE, deps);
    check(
      "a pool that can't be priced refuses the increase rather than flooring at the typed amounts",
      !r.ok && errorOf(r).includes("can't set a slippage floor"),
      errorOf(r),
    );
  }
  {
    const { deps } = fakeDeps({ positions: async () => [POSITION] });
    const r = await build({
        kind: "increasePosition",
        positionId: 9,
        symbol0: "WETH",
        amount0: "1",
        symbol1: "USDC",
        amount1: "2000",
      }, deps);
    check(
      "an increase into a position the wallet doesn't hold is refused by id",
      !r.ok && errorOf(r).includes("can't find position #9 in your wallet"),
      errorOf(r),
    );
  }
  {
    const { deps } = fakeDeps({ positions: async () => [POSITION] });
    const r = await build(
      { kind: "removePosition", positionId: 7, percent: 25 },
      deps,
    );
    check(
      "a partial removal is still decrease then collect",
      kinds(r) === "decreasePoolLiquidity,collectPoolFees",
      kinds(r),
    );
    /* 123456789 × 2500 / 10000, truncated. Written as the answer rather than as
       the expression so the test states a number the reader can check. */
    check(
      "it burns exactly a quarter of the raw liquidity, truncated",
      at(r, 0).liquidity === "30864197",
      String(at(r, 0).liquidity),
    );
    check(
      "the share rides along for the render, and the summary says it",
      at(r, 0).percent === 25 && summaryOf(r).includes("25% of the liquidity"),
      `${String(at(r, 0).percent)} / ${summaryOf(r)}`,
    );
  }
  {
    /* A fractional share, which a model will reach for the moment a user says
       "an eighth". Taken in hundredths of a percent, so 12.5 is exact rather than
       rounded up to 13 — 123456789 × 1250 / 10000. */
    const { deps } = fakeDeps({ positions: async () => [POSITION] });
    const r = await build(
      { kind: "removePosition", positionId: 7, percent: 12.5 },
      deps,
    );
    check(
      "a fractional share is exact, not rounded to a whole percent",
      at(r, 0).liquidity === "15432098",
      String(at(r, 0).liquidity),
    );
  }
  {
    const { deps } = fakeDeps({ positions: async () => [POSITION] });
    const r = await build(
      { kind: "removePosition", positionId: 7, percent: 100 },
      deps,
    );
    check(
      "100% is the position's own figure, so it cannot leave dust",
      at(r, 0).liquidity === POSITION.liquidity &&
        at(r, 0).percent === undefined &&
        summaryOf(r).includes("all liquidity"),
      `${String(at(r, 0).liquidity)} / ${String(at(r, 0).percent)} / ${summaryOf(r)}`,
    );
  }
  {
    const { deps } = fakeDeps({ positions: async () => [POSITION] });
    const over = await build(
      { kind: "removePosition", positionId: 7, percent: 140 },
      deps,
    );
    const under = await build(
      { kind: "removePosition", positionId: 7, percent: 0 },
      deps,
    );
    check(
      "a share outside 1–100 is refused in both directions",
      !over.ok &&
        errorOf(over).includes("isn't a share of a position") &&
        !under.ok &&
        errorOf(under).includes("isn't a share of a position"),
      `${errorOf(over)} / ${errorOf(under)}`,
    );
  }
  {
    /* A position so small the share truncates to zero. `decreaseLiquidity(0)`
       does not revert — it succeeds, burns nothing, and the plan would read as a
       withdrawal that happened. */
    const { deps } = fakeDeps({
      positions: async () => [{ ...POSITION, liquidity: "40" }],
    });
    const r = await build(
      { kind: "removePosition", positionId: 7, percent: 1 },
      deps,
    );
    check(
      "a share that truncates to zero is refused rather than burning nothing",
      !r.ok && errorOf(r).includes("rounds to nothing"),
      errorOf(r),
    );
  }

  console.log("\n— repay —");
  const USDC_LOAN = {
    requestId: 3,
    totalRepayment: "1050.5",
    totalRepaymentRaw: "1050500000",
    symbol: "USDC",
    tokenAddress: USDC_LENDING,
  };
  const ETH_LOAN = {
    requestId: 4,
    totalRepayment: "1.05",
    totalRepaymentRaw: "1050000000000000000",
    symbol: "ETH",
    tokenAddress: ETH_LENDING,
  };
  {
    const { deps, calls } = fakeDeps({ loans: async () => [] });
    const r = await build({ kind: "repay" }, deps);
    check(
      "with no loans, repay refuses",
      !r.ok && errorOf(r) === "You have no open loans to repay.",
      errorOf(r),
    );
    check("it asked for loans exactly once", calls.loans === 1);
  }
  {
    const { deps } = fakeDeps({ loans: async () => [USDC_LOAN] });
    const r = await build({ kind: "repay" }, deps);
    check(
      "one open loan needs no id",
      kinds(r) === "approve,repayLoan",
      kinds(r),
    );
    check(
      "the approve uses the registry's decimals, not a default of 18",
      at(r, 0).decimals === 6,
      String(at(r, 0).decimals),
    );
    check(
      "raw and human amounts are both carried, in their own units",
      at(r, 1).amountRaw === "1050500000" && at(r, 1).amount === "1050.5",
      JSON.stringify(at(r, 1)),
    );
    check("the loan id is preserved", at(r, 1).requestId === 3);
  }
  {
    const { deps } = fakeDeps({ loans: async () => [ETH_LOAN] });
    const r = await build({ kind: "repay" }, deps);
    check("a native loan skips approve", kinds(r) === "repayLoan", kinds(r));
    check("isNative is set", at(r, 0).isNative === true);
  }
  {
    const { deps } = fakeDeps({ loans: async () => [USDC_LOAN, ETH_LOAN] });
    const r = await build({ kind: "repay" }, deps);
    check(
      "two loans and no id asks which, rather than picking one",
      !r.ok && errorOf(r).startsWith("You have 2 open loans."),
      errorOf(r),
    );
    check(
      "and lists them so the answer is one word",
      errorOf(r).includes("#3 (1050.5 USDC)") &&
        errorOf(r).includes("#4 (1.05 ETH)"),
      errorOf(r),
    );
  }
  {
    const { deps } = fakeDeps({ loans: async () => [USDC_LOAN, ETH_LOAN] });
    const r = await build({ kind: "repay", loanId: 4 }, deps);
    check(
      "a stated id selects that loan",
      r.ok && at(r, 0).requestId === 4,
      kinds(r),
    );
  }
  {
    const { deps } = fakeDeps({ loans: async () => [USDC_LOAN] });
    const r = await build({ kind: "repay", loanId: 99 }, deps);
    check(
      "an id that isn't open is refused by id",
      !r.ok && errorOf(r).includes("can't find an open loan #99"),
      errorOf(r),
    );
  }

  console.log("\n— unconfigured deployments —");
  /*
   * The env vars are read through the `envVars` object at call time, not
   * captured when build.ts loaded, so flipping a field here exercises the real
   * guard rather than a copy of it. Restored immediately: every later check
   * would otherwise see an unconfigured protocol.
   */
  {
    /*
     * Ethereum mainnet AND no env var, because the guard now needs both sources
     * empty to fire — and that is the fix rather than the obstacle.
     *
     * build.ts used to take the diamond from `envVars.lendbitDiamondAddress`
     * alone, so unsetting that one field was enough to reach this refusal. That
     * env var is a single NEXT_PUBLIC value for every chain (it holds Sepolia's),
     * while the five deployed testnets have five distinct diamonds, so every
     * lending intent was built against Sepolia's contract wherever the wallet
     * was. Measured once the auditor began pinning the registry's diamond per
     * chain: `deposit` and `withdraw` were blocked on four of the five with
     * "diamond is not the diamond this app deploys against" — the builder naming
     * one chain and the auditor the correct one.
     *
     * So the registry answers first and the env var is only a fallback, which
     * means the honest fixture for "no protocol address" is a chain that has
     * neither. Mainnet is that chain permanently: `getContracts` returns {} for
     * any chain DEPLOYMENTS does not carry, and a Kaleido diamond on Ethereum
     * mainnet is a deploy decision rather than a gap this suite should predict.
     */
    envVars.lendbitDiamondAddress = undefined;
    const { deps, calls } = fakeDeps();
    const r = await build(
      { kind: "deposit", amount: "1", token: DEX_USDC },
      {
        ...deps,
        chainId: 1,
      },
    );
    envVars.lendbitDiamondAddress = DIAMOND;
    check(
      "with no Diamond, lending refuses instead of building an undefined address",
      !r.ok && errorOf(r) === "The protocol address isn't configured.",
      errorOf(r),
    );
    check(
      "and it refuses before spending a chain read",
      quiet(calls),
      JSON.stringify(calls),
    );
  }
  {
    /* The precedence itself, asserted rather than assumed: the env var is set to
       a fake address here and the registry carries a real one for CHAIN, so a
       step naming the registry's proves the registry wins. Without this, a future
       edit could reinstate the env var as the primary source and every other
       check in this suite would still pass — the two only disagree on a chain
       that is not the env var's. */
    const { deps } = fakeDeps();
    const r = await build(
      { kind: "deposit", amount: "1", token: DEX_USDC },
      deps,
    );
    check(
      "the registry's diamond wins over the chain-blind env var",
      r.ok &&
        same(at(r, 1).diamond, DEPLOYED.diamond) &&
        !same(at(r, 1).diamond, DIAMOND),
      `${String(at(r, 1).diamond)} (registry ${String(DEPLOYED.diamond)}, env ${DIAMOND})`,
    );
  }
  {
    /* The refusal used to be driven by clearing `envVars.vaultAddress`, one env
       var for every chain. Staking now resolves all three addresses from the
       chain's deployment record, so the case that has to refuse is a chain KLD
       was never deployed to — and Ethereum mainnet is one, permanently, which is
       a stronger fixture than an env var a later edit could set. */
    const { deps } = fakeDeps({ chainId: 1 });
    const r = await build({ kind: "stake", amount: "1" }, deps);
    check(
      "on a chain with no KLD deployment, staking refuses",
      !r.ok && errorOf(r) === "Staking isn't available on this chain yet.",
      errorOf(r),
    );
  }
  {
    /* And the three it does resolve must be the same chain's. A vault from one
       deployment with a token from another is not a type error and does not
       revert on the client — it is a `deposit` the vault refuses with
       TokenNotSupported, after the approve has already been signed. */
    const { deps } = fakeDeps();
    const r = await build({ kind: "stake", amount: "1" }, deps);
    check(
      "all three staking addresses come from one chain's record",
      r.ok &&
        same(at(r, 1).vault, DEPLOYED.kldVault) &&
        same(at(r, 1).token, DEPLOYED.kld) &&
        same(at(r, 1).stToken, DEPLOYED.stKLD),
      JSON.stringify(at(r, 1)),
    );
  }
  {
    /* build.ts places the send branch above the diamond guard deliberately: a
       wallet-to-wallet transfer touches none of Kaleido's contracts, so an
       unconfigured deployment is no reason to refuse one. If a later edit moves
       the branch below the guard, send breaks on exactly the deployments where
       it is the only thing that still works. */
    envVars.lendbitDiamondAddress = undefined;
    const { deps } = fakeDeps();
    const r = await build(
      { kind: "send", amount: "1", token: DEX_USDC, to: CHECKSUMMED },
      deps,
    );
    envVars.lendbitDiamondAddress = DIAMOND;
    check(
      "a send needs no protocol address at all",
      r.ok && kinds(r) === "transfer",
      errorOf(r),
    );
  }
  {
    const { deps } = fakeDeps();
    const r = await build(
      { kind: "deposit", amount: "1", token: DEX_USDC },
      deps,
    );
    check("the pins are restored for later checks", r.ok, errorOf(r));
  }

  console.log("\n— the testnet faucet —");
  /*
   * The faucet is the one command here whose asset list cannot come from the
   * token registry, so every case below feeds `deps.faucetAssets` directly. That
   * is not a shortcut around a resolver: measured against TOKENS, the mock USDT
   * and USDe are in no chain's list and the mock USDC is missing from two of the
   * five, so a registry lookup would refuse by name exactly the assets the faucet
   * exists to hand out. The faucet is its own authority on what it lists, and
   * these assertions are what hold that seam in place.
   *
   * `DEPLOYED.faucet` is read rather than pinned through envVars, because the
   * builder reads `getContracts(chainId).faucet` and nothing else — see
   * config/contracts.ts, which documents the registry as the single source after
   * NEXT_PUBLIC_TOKENFAUCET_ADDRESS was retired for being one address across
   * every chain.
   *
   * It used to be WRITTEN here, and then removed again, because no chain had one
   * recorded. Faucets are now deployed on all five testnets, so the address is
   * read and the "not configured" case moved to a chain that will never carry
   * one — the comment below predicted this branch would go stale, and a fixture
   * is the fix rather than dropping the assertion.
   */
  {
    const FAUCET = DEPLOYED.faucet;
    if (!FAUCET)
      throw new Error(
        `chain ${CHAIN} records no faucet in DEPLOYMENTS, so the claim cases ` +
          `below would assert against undefined — pick a chain that does`,
      );
    /* Six decimals on purpose. A mock USDC dripping 100 tokens is 100000000 base
       units, and the difference between formatting that at 6 and at 18 is the
       difference between "100.0" and "0.0000000001" — the exact failure a
       registry default of 18 would have produced silently. */
    const asset = (over: Record<string, unknown> = {}) => ({
      address: "0x0000000000000000000000000000000000000abc",
      symbol: "USDT",
      decimals: 6,
      amountRaw: "100000000",
      stockRaw: "500000000",
      nextClaimAt: 0,
      ...over,
    });
    const usdt = asset();
    const usde = asset({
      address: "0x0000000000000000000000000000000000000de1",
      symbol: "USDe",
      decimals: 18,
      amountRaw: "50000000000000000000",
      stockRaw: "900000000000000000000",
    });
    const faucetDeps = (assets: unknown[]) =>
      fakeDeps({
        faucetAssets: async () => assets as never,
      });

    {
      /* Ethereum mainnet, because a faucet there is a contradiction rather than
         a gap: DEPLOYMENTS carries one on every chain it records, so "a chain
         that hasn't got one yet" no longer exists to test with. Refusing by name
         is the correct behaviour, and it must not depend on a chain read. */
      const { deps, calls } = faucetDeps([usdt]);
      const r = await build(
        { kind: "claimTestTokens" },
        { ...deps, chainId: 1 },
      );
      check(
        "on a chain with no faucet recorded, it refuses instead of claiming at undefined",
        !r.ok && errorOf(r) === "There's no test-token faucet on this chain.",
        errorOf(r),
      );
      check("and it refuses before spending a chain read", calls.faucet === 0);
    }

    {
      /* The placement claim, and the reason this branch sits above the diamond
         guard rather than beside the other claims. Everything past that guard is
         unreachable on a chain with no lending diamond, which is precisely the
         freshly-deployed chain a faucet exists to serve. Move the branch below it
         and the faucet breaks on the only deployments that need it. */
      envVars.lendbitDiamondAddress = undefined;
      const { deps } = faucetDeps([usdt]);
      const r = await build({ kind: "claimTestTokens" }, deps);
      envVars.lendbitDiamondAddress = DIAMOND;
      check(
        "a claim needs no lending diamond at all",
        r.ok && kinds(r) === "claimTestTokens",
        errorOf(r),
      );
    }

    {
      const { deps, calls } = faucetDeps([usdt]);
      const r = await build({ kind: "claimTestTokens" }, deps);
      check(
        "one listed asset and no symbol resolves without asking",
        r.ok && kinds(r) === "claimTestTokens",
        errorOf(r),
      );
      check("it read the faucet exactly once", calls.faucet === 1);
      check(
        "the drip is formatted at the asset's own decimals",
        at(r, 0).amount === "100.0",
        String(at(r, 0).amount),
      );
      check(
        "the faucet address is the registry's, not the model's",
        same(at(r, 0).faucet, FAUCET),
        String(at(r, 0).faucet),
      );
      check(
        "and the token is the address the faucet reported",
        same(at(r, 0).token, usdt.address) && at(r, 0).symbol === "USDT",
        `${String(at(r, 0).token)} ${String(at(r, 0).symbol)}`,
      );
      check(
        "the summary names the amount and the symbol",
        summaryOf(r) === "Claim 100.0 USDT from the testnet faucet.",
        summaryOf(r),
      );
    }

    {
      const { deps } = faucetDeps([usdt, usde]);
      const r = await build({ kind: "claimTestTokens" }, deps);
      check(
        "two listed assets and no symbol asks which, rather than picking one",
        !r.ok &&
          errorOf(r) ===
            'The faucet lists USDT, USDe — say which one you want, or "all" for everything that\'s due.',
        errorOf(r),
      );
    }

    {
      /* Lowercased on the way in by parseCommand, so the match has to be
         case-insensitive in both directions — "usde" against a listed "USDe". */
      const { deps } = faucetDeps([usdt, usde]);
      const r = await build({ kind: "claimTestTokens", symbol: "usde" }, deps);
      check(
        "a stated symbol selects that asset, whatever its case",
        r.ok && at(r, 0).symbol === "USDe" && at(r, 0).amount === "50.0",
        `${errorOf(r)}${String(at(r, 0).amount)}`,
      );
    }

    {
      const { deps } = faucetDeps([usdt, usde]);
      const r = await build(
        { kind: "claimTestTokens", symbol: usde.address.toUpperCase() },
        deps,
      );
      check(
        "an address works as the key too, since the model may name either",
        r.ok && at(r, 0).symbol === "USDe",
        errorOf(r),
      );
    }

    {
      /* The refusal that must not be a guess. An unlisted word resolves to
         nothing rather than to the nearest asset, and the message names what the
         faucet does have so the next sentence is one word long. */
      const { deps } = faucetDeps([usdt, usde]);
      const r = await build({ kind: "claimTestTokens", symbol: "weth" }, deps);
      check(
        "an unlisted symbol is refused by name, and the list is offered",
        !r.ok &&
          errorOf(r) ===
            "The faucet doesn't hand out weth. It lists USDT, USDe.",
        errorOf(r),
      );
    }

    {
      /* Listed with a zero drip is how Faucet.sol pauses an asset, which is why
         assetInfo returns it at all instead of filtering it out: a dropped asset
         would be indistinguishable from one the faucet never had. */
      const { deps } = faucetDeps([asset({ amountRaw: "0" })]);
      const r = await build({ kind: "claimTestTokens" }, deps);
      check(
        "a paused asset is refused as paused, not as unlisted",
        !r.ok &&
          errorOf(r) === "USDT claims are paused on the faucet right now.",
        errorOf(r),
      );
    }

    {
      /* Stock short of one whole drip. The contract reverts
         _InsufficientContractBalance here; refusing first turns that into a
         sentence instead of a failed signature. */
      const { deps } = faucetDeps([asset({ stockRaw: "99999999" })]);
      const r = await build({ kind: "claimTestTokens" }, deps);
      check(
        "stock that cannot cover one drip is refused before signing",
        !r.ok &&
          errorOf(r) === "The faucet is out of USDT — it can't cover a claim.",
        errorOf(r),
      );
    }

    {
      /* A deadline rather than a duration, because that is what claimableAt
         returns. The wait is the one faucet failure a user can act on, so it is
         quoted rather than left to come back as _CooldownNotOver. */
      const now = Math.floor(Date.now() / 1000);
      const { deps } = faucetDeps([asset({ nextClaimAt: now + 7200 })]);
      const r = await build({ kind: "claimTestTokens" }, deps);
      check(
        "an unelapsed cooldown is refused with the wait quoted",
        !r.ok &&
          errorOf(r) ===
            "You've claimed USDT recently. The faucet will hand out more in about 2h.",
        errorOf(r),
      );
    }

    {
      const now = Math.floor(Date.now() / 1000);
      const { deps } = faucetDeps([asset({ nextClaimAt: now + 90 })]);
      const r = await build({ kind: "claimTestTokens" }, deps);
      check(
        "and a sub-hour wait is quoted in minutes",
        !r.ok && errorOf(r).includes("in about 2 min."),
        errorOf(r),
      );
    }

    {
      /* Every implementation of this dep degrades to [] rather than throwing, so
         a chain call falling over arrives here as an empty list. Two causes, one
         signal — the wording covers both instead of asserting the first. */
      const { deps } = faucetDeps([]);
      const r = await build({ kind: "claimTestTokens", symbol: "usdt" }, deps);
      check(
        "a faucet that lists nothing refuses without naming a cause it can't know",
        !r.ok &&
          errorOf(r) ===
            "Couldn't read anything to claim from the faucet on this chain.",
        errorOf(r),
      );
    }

    {
      /* Nothing leaves the wallet, so there is no allowance to grant. An approve
         step here would make the review list claim a signature the transaction
         never needs. */
      const { deps } = faucetDeps([usdt]);
      const r = await build({ kind: "claimTestTokens" }, deps);
      check(
        "a claim is one transaction and no approval",
        kinds(r) === "claimTestTokens",
      );
    }

    /* No teardown. This section used to write the faucet into DEPLOYMENTS, so it
       deleted it again and asserted the removal took, to keep the later sections
       from inheriting a mutated registry. It reads the deployed address now, so
       there is nothing to restore and nothing to leak. */
  }

  console.log("\n— amount parsing —");
  {
    check("one wei is parsable at 18 decimals", isParsableAmount("1", 18));
    check(
      "a fraction below the token's precision is not",
      !isParsableAmount("0.0000001", 6),
    );
    check("text is not an amount", !isParsableAmount("some", 18));
    check("an empty string is not an amount", !isParsableAmount("", 18));
  }

  console.log("\n— every built intent is on the bus —");
  /* A plan whose kind no resolver registered renders as a blank row and fails
     at signing time, which is the worst place to find out. */
  check(
    "no intent left the builder unregistered",
    unregistered.size === 0,
    `unregistered: ${[...unregistered].join(", ")}`,
  );

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
