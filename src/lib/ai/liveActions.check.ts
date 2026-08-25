/**
 * Runs the agent's own read tools and its build→audit path against real
 * on-chain state, on a chain where the protocol is actually deployed.
 *
 *   node --import tsx --env-file=.env src/lib/ai/liveActions.check.ts
 *
 * NOT part of `npm test`, and it must not become part of it. Every other suite
 * in this repo is offline by construction — build.test.ts injects a fake
 * PlanDeps precisely so it can assert what the builder reads as well as what it
 * emits, and auditor.test.ts stubs the pricer. Those are the right shape for
 * logic. They are also the reason a whole class of defect survives them: a fake
 * dep returns the row the test author expected, so a handler that reads the
 * wrong contract, mis-scales a uint, or asks a chain for an id that is not on it
 * passes every one of them.
 *
 * This file exists because the state to check against now exists. Sepolia
 * carries a real V3 pool, real swaps, a real lending listing and three real
 * loan requests, so "would the agent actually build this transaction" is a
 * question with a measurable answer rather than a mocked one.
 *
 * What it does NOT do: sign, send, or hold a key. Every execute verb is taken
 * as far as a plan and a verdict and then dropped. The point is the plan's
 * contents — which addresses got filled in, which chain they came from, what the
 * auditor said — and none of that needs a signature. A live check that could
 * spend is a live check nobody runs.
 *
 * Facts are read off the chain rather than pasted in. The ids and the borrower
 * come from `getRequestId`/`getListingId`/`getRequest(n).author`, so this keeps
 * working after the next seeding run instead of silently asserting against a
 * book that has moved on. The one hardcoded address is the diamond, and it comes
 * from the registry the app itself uses.
 */

import { ethers } from "ethers";
import { providerForChain } from "@/config/provider";
import { getContracts } from "@/constants/registry";
import protocolAbi from "@/abi/ProtocolFacet.json";
import { runReadTool } from "@/lib/ai/readTools";
import { serverPlanDeps } from "@/lib/ai/planDeps";
import { planFromToolCalls, type ToolCall } from "@/lib/ai/fromToolCall";
import { auditPlan } from "@/lib/ai/auditor";
import { EXECUTE_TOOLS } from "@/lib/ai/toolCatalog";
import { isReadTool } from "@/lib/ai/readTools";

const CHAIN = 11155111;
const OPTS = { slippageBps: 50, deadlineMin: 20 };

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass += 1;
    console.log(`   PASS  ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail += 1;
    console.log(`   FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

const section = (n: number, title: string) => {
  console.log(`\n${n}. ${title}`);
};

/** Compact one-line rendering of a plan, showing the fields that can be wrong. */
function describePlan(plan: Record<string, unknown>[]): string {
  if (plan.length === 0) return "(empty)";
  return plan
    .map((s) => {
      const kind = String(s.kind);
      const parts: string[] = [];
      for (const k of [
        "token",
        "tokenIn",
        "tokenOut",
        "spender",
        "target",
        "amount",
        "amountOutMin",
        "listingId",
        "requestId",
        "positionId",
        "fee",
      ]) {
        const v = s[k];
        if (v === undefined || v === null) continue;
        const shown =
          typeof v === "object"
            ? String((v as Record<string, unknown>).symbol ?? "?")
            : typeof v === "string" && ethers.isAddress(v)
              ? `${v.slice(0, 6)}…${v.slice(-4)}`
              : String(v);
        parts.push(`${k}=${shown}`);
      }
      return `${kind}(${parts.join(" ")})`;
    })
    .join(" → ");
}

/**
 * Every address in a plan, flattened, so one assertion can test them all.
 *
 * Recurses because the token fields are IToken objects and the intents nest
 * them one level down. An address that leaked in from another chain is the
 * failure this exists to catch, and it can hide at any depth.
 */
function addressesIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    if (ethers.isAddress(value)) out.push(value.toLowerCase());
    return out;
  }
  if (Array.isArray(value)) {
    for (const v of value) addressesIn(v, out);
    return out;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) addressesIn(v, out);
  }
  return out;
}

async function main() {
  const provider = providerForChain(CHAIN);
  const contracts = getContracts(CHAIN);
  if (!provider) throw new Error(`no RPC for chain ${CHAIN} in chains.ts`);
  if (!contracts.diamond) throw new Error(`no diamond for chain ${CHAIN}`);

  const head = await provider.getBlockNumber();
  const p = new ethers.Contract(contracts.diamond, protocolAbi, provider);

  console.log(`\n${"═".repeat(78)}`);
  console.log(`  Sepolia @ block ${head}   diamond ${contracts.diamond}`);
  console.log(`${"═".repeat(78)}`);

  /* ── the real state, read rather than assumed ───────────────────────────── */
  const requestCount = Number(await p.getRequestId());
  const listingCount = Number(await p.getListingId());
  const requests: Record<number, ethers.Result> = {};
  for (let id = 1; id <= requestCount; id += 1) requests[id] = await p.getRequest(id);
  const listings: Record<number, ethers.Result> = {};
  for (let id = 1; id <= listingCount; id += 1) listings[id] = await p.getLoanListing(id);
  const listing1 = listings[1] ?? null;
  const borrower = requestCount > 0 ? String(requests[1].author) : "";
  const openRequest = Object.entries(requests).find(
    ([, r]) => Number(r.status) === 0,
  )?.[0];
  const servicedRequest = Object.entries(requests).find(
    ([, r]) => Number(r.status) === 1,
  )?.[0];

  console.log(`  borrower/author  ${borrower}`);
  console.log(`  requests ${requestCount}   listings ${listingCount}`);
  for (let id = 1; id <= requestCount; id += 1) {
    const r = requests[id];
    console.log(
      `    #${id} ${ethers.formatUnits(r.amount, 18)} of ${r.loanRequestAddr} ` +
        `repay ${ethers.formatUnits(r.totalRepayment, 18)} status ${r.status}`,
    );
  }
  if (listing1)
    console.log(
      `    listing #1 ${ethers.formatUnits(listing1.amount, 18)} of ${listing1.tokenAddress} @${Number(listing1.interest) / 100}% status ${listing1.listingStatus}`,
    );

  if (!borrower) throw new Error("no requests on this chain — nothing to validate against");

  /* ── which pairs the DEX can actually price, asked rather than assumed ───── */
  /**
   * Every V3 pool on this chain, discovered from the factory.
   *
   * The swap cases below need to know which pairs have liquidity, and pasting
   * that in is how the last defect hid: `build.ts` quoted one hardcoded 3000 tier
   * and refused USDT/USDe — a pair with a real pool at 500 — with a sentence that
   * read as true. A harness carrying its own list of pools would have asserted the
   * same wrong thing. So the factory is asked, at the same three tiers the builder
   * now quotes and the /pool/new page offers, and each swap case takes its
   * expectation from the answer.
   *
   * Measured 2026-08-25: exactly one pool on Sepolia, USDT/USDe at 500 with
   * 9.95e18 liquidity. So "swap ETH → USDT" being refused is the CORRECT outcome
   * here, and asserting a plan for it would have been asserting a pool into
   * existence.
   */
  const FEE_TIERS = [500, 3000, 10000];
  const factory = new ethers.Contract(
    contracts.v3Factory ?? ethers.ZeroAddress,
    ["function getPool(address,address,uint24) view returns (address)"],
    provider,
  );
  const { chainTokens } = await import("@/constants/tokens");
  const tokens = chainTokens(CHAIN);
  /** Lower-cased "SYMA|SYMB" keys, both orders, for every pair with a pool. */
  const pooledPairs = new Set<string>();
  if (contracts.v3Factory) {
    for (let i = 0; i < tokens.length; i += 1) {
      for (let j = i + 1; j < tokens.length; j += 1) {
        for (const fee of FEE_TIERS) {
          const addr = await factory.getPool(
            tokens[i].address,
            tokens[j].address,
            fee,
          );
          if (addr === ethers.ZeroAddress) continue;
          const a = tokens[i].symbol.toUpperCase();
          const b = tokens[j].symbol.toUpperCase();
          pooledPairs.add(`${a}|${b}`);
          pooledPairs.add(`${b}|${a}`);
          console.log(`  pool ${a}/${b} @${fee / 10_000}%  ${addr}`);
        }
      }
    }
  }
  if (pooledPairs.size === 0) console.log(`  no V3 pools on this chain`);
  /* ETH and WETH are the same pool as far as a swap is concerned — the builder
     wraps — so a native-in swap is priceable exactly when the wrapped pair is. */
  const hasPool = (a: string, b: string) => {
    const norm = (s: string) => (s.toUpperCase() === "ETH" ? "WETH" : s.toUpperCase());
    return pooledPairs.has(`${norm(a)}|${norm(b)}`);
  };

  // ─────────────────────────────────────────────────────────────────────────
  section(1, "The catalog: every declared tool is dispatchable");

  /* A tool the model can call but the server cannot dispatch is the one failure
     mode a schema check cannot see: the catalog is what the model is shown, and
     a name in it with no handler produces a confident tool call that answers
     "Unknown read tool" mid-turn. Asserted in both directions. */
  const { TOOL_CATALOG } = await import("@/lib/ai/toolCatalog");
  const declaredReads = TOOL_CATALOG.filter((t) => t.kind === "read").map((t) => t.name);
  const declaredExecutes = TOOL_CATALOG.filter((t) => t.kind === "execute").map((t) => t.name);
  const unroutedReads = declaredReads.filter((n) => !isReadTool(n));
  const unroutedExecutes = declaredExecutes.filter((n) => !EXECUTE_TOOLS.has(n));

  console.log(`   ${declaredReads.length} read tools, ${declaredExecutes.length} execute tools`);
  check(
    "every declared read tool has a handler",
    unroutedReads.length === 0,
    unroutedReads.join(", ") || `${declaredReads.length} routed`,
  );
  check(
    "every declared execute tool is in EXECUTE_TOOLS",
    unroutedExecutes.length === 0,
    unroutedExecutes.join(", ") || `${declaredExecutes.length} routed`,
  );

  // ─────────────────────────────────────────────────────────────────────────
  section(2, "Read tools, against the live diamond");

  const portfolio = await runReadTool("getPortfolio", { address: borrower }, CHAIN);
  console.log(`   getPortfolio  ${JSON.stringify(portfolio)}`);
  check(
    "getPortfolio reads the chain it was asked for",
    portfolio.chainId === CHAIN,
    `chainId ${portfolio.chainId}`,
  );
  check(
    "collateral is priced, not null",
    typeof portfolio.collateralUsd === "number" && portfolio.collateralUsd > 0,
    `$${portfolio.collateralUsd}`,
  );

  /* The health factor the agent would relay. `getLoanCollectedInUsd` derives
     debt from an index that no longer has an owner-keyed keeper writing it, so
     pre-upgrade this borrower's debt reads zero and `_healthFactor` returns its
     type(uint256).max short-circuit. Whether that reaches the user as `null` or
     as a 60-digit number is not a cosmetic difference: the model relays it as
     fact and sizes a plan off it. */
  const hf = portfolio.healthFactor;
  console.log(`   healthFactor as the model would receive it: ${hf}`);
  check(
    "the max-uint sentinel is not relayed as a health factor",
    hf === null || (typeof hf === "number" && hf < 1e6),
    hf === null ? "null (no debt)" : `${hf}`,
  );

  const borrowBook = await runReadTool("getMarkets", { side: "borrow" }, CHAIN);
  const lendBook = await runReadTool("getMarkets", { side: "lend" }, CHAIN);
  const borrowOffers = (borrowBook.offers ?? []) as Record<string, unknown>[];
  const lendOffers = (lendBook.offers ?? []) as Record<string, unknown>[];
  console.log(`   getMarkets borrow → ${borrowOffers.length} offers  ${JSON.stringify(borrowOffers.slice(0, 3))}`);
  console.log(`   getMarkets lend   → ${lendOffers.length} offers  ${JSON.stringify(lendOffers.slice(0, 3))}`);
  check(
    "getMarkets names the chain its rows are on",
    borrowBook.chainId === CHAIN,
    `chainId ${borrowBook.chainId}`,
  );
  /* Both sides of the book are read from the diamond now, so the chain's own
     state is the expectation rather than a note about an indexer that never ran.
     This used to print "the Supabase mirror returned none — the indexer has not
     caught up", which is exactly the shape of report that let the defect sit: a
     tool telling users the market was empty over a book with real escrow in it,
     logged as an infrastructure footnote instead of a failure.

     `getMarkets` drops matured entries — a term that has already ended is not an
     offer — so the chain-side expectation applies the same filter, or the
     assertion would be about a different set than the tool returns. */
  const nowSec = Math.floor(Date.now() / 1000);
  const liveListings = Object.entries(listings).filter(
    ([, l]) => Number(l.listingStatus) === 0 && Number(l.returnDate) > nowSec,
  );
  const liveRequests = Object.entries(requests).filter(
    ([, r]) => Number(r.status) === 0 && Number(r.returnDate) > nowSec,
  );
  check(
    "every open listing on chain reaches the borrow book",
    borrowOffers.length >= liveListings.length,
    `${borrowOffers.length} offers for ${liveListings.length} open listing(s) on chain`,
  );
  check(
    "every open request on chain reaches the lend book",
    lendOffers.length >= liveRequests.length,
    `${lendOffers.length} offers for ${liveRequests.length} open request(s) on chain`,
  );
  /* Ids, not just counts. A book of the right length holding the wrong entries
     passes a count check, and the id is the whole payload — it is what a
     follow-up takeListing or fillRequest names. */
  const missedListing = liveListings.find(
    ([id]) => !borrowOffers.some((o) => Number(o.id) === Number(id)),
  );
  check(
    "the borrow book names the listing ids the chain holds",
    !missedListing,
    missedListing
      ? `listing #${missedListing[0]} missing`
      : borrowOffers.map((o) => `#${o.id}`).join(" ") || "none open",
  );
  const missedRequest = liveRequests.find(
    ([id]) => !lendOffers.some((o) => Number(o.id) === Number(id)),
  );
  check(
    "the lend book names the request ids the chain holds",
    !missedRequest,
    missedRequest
      ? `request #${missedRequest[0]} missing`
      : lendOffers.map((o) => `#${o.id}`).join(" ") || "none open",
  );
  /* An unreadable book and an empty one must not produce the same sentence: the
     second is a claim about the market that a model relays as fact. */
  check(
    "an empty book is never reported as unreadable, or the reverse",
    typeof borrowBook.error !== "string" && Array.isArray(borrowBook.offers),
    typeof borrowBook.error === "string" ? String(borrowBook.error) : "read ok",
  );

  const unknownAsset = await runReadTool("getMarkets", { side: "borrow", asset: "NOTATOKEN" }, CHAIN);
  check(
    "an unknown asset is refused by name with the real alternatives",
    typeof unknownAsset.error === "string" &&
      Array.isArray(unknownAsset.knownAssets) &&
      (unknownAsset.knownAssets as string[]).length > 0,
    `${(unknownAsset.knownAssets as string[] | undefined)?.length ?? 0} known assets`,
  );

  /* getQuote against the loan the chain actually holds, checked to the wei
     against the facet's own arithmetic rather than to a remembered number. */
  const r1 = requests[1];
  const termSec = Number(r1.returnDate) - Math.floor(Date.now() / 1000);
  const quote = await runReadTool(
    "getQuote",
    {
      amount: ethers.formatUnits(r1.amount, 18),
      interestBps: Number(r1.interest),
      returnDate: Number(r1.returnDate),
    },
    CHAIN,
  );
  console.log(`   getQuote  ${JSON.stringify(quote)}   (term ${(termSec / 86400).toFixed(1)}d)`);
  if (termSec > 0) {
    const onChain = await p.getQuote(r1.amount, Number(r1.interest), Number(r1.returnDate));
    check(
      "getQuote's formatted total round-trips the facet's raw answer",
      quote.totalRepayment === ethers.formatUnits(onChain[0], 18),
      `${quote.totalRepayment} vs ${ethers.formatUnits(onChain[0], 18)}`,
    );
  } else {
    console.log(`   NOTE: request #1 matured ${(-termSec / 86400).toFixed(1)}d ago, so getQuote's duration is negative — skipping the round-trip`);
  }

  const price = await runReadTool("getPrice", { asset: "ETH" }, CHAIN);
  console.log(`   getPrice ETH  priced=${price.priced} usd=${price.usd} ${price.asOfSecondsAgo}s old`);
  check("getPrice returns a live ETH number", price.priced === true && typeof price.usd === "number" && (price.usd as number) > 0, `$${price.usd}`);

  const kld = await runReadTool("getPrice", { asset: "KLD" }, CHAIN);
  check(
    "an unlaunched token reports no feed rather than a number",
    kld.priced === false && kld.usd === undefined,
    `priced=${kld.priced}`,
  );

  const chains = await runReadTool("getChains", { address: borrower, asset: "ETH" }, CHAIN);
  console.log(`   getChains ETH  total=${chains.totalBalance} across ${((chains.byChain ?? []) as unknown[]).length} chain(s)`);
  check(
    "getChains resolves an indexed asset",
    typeof chains.error !== "string",
    String(chains.error ?? "ok"),
  );

  const badTool = await runReadTool("getSomethingElse", {}, CHAIN);
  check(
    "an unrouted read tool answers rather than throwing",
    typeof badTool.error === "string",
    String(badTool.error),
  );

  // ─────────────────────────────────────────────────────────────────────────
  section(3, "Build → audit, per verb, against the real ids on this chain");

  const deps = serverPlanDeps(borrower, CHAIN);

  /* Both are read once and shared across every case below. `positions()` and
     `loans()` are what several verbs resolve their target from, and knowing
     what they return turns "the plan was refused" into a specific finding. */
  const positions = await deps.positions();
  const loans = await deps.loans();
  const faucetAssets = await deps.faucetAssets();
  console.log(
    `   deps: ${positions.length} V3 position(s), ${loans.length} open loan(s), ${faucetAssets.length} faucet asset(s)`,
  );
  if (servicedRequest && loans.length === 0)
    console.log(
      `   NOTE: request #${servicedRequest} is SERVICED on chain but getUserActiveRequests returns nothing — ` +
        `the debt index is unwritten, so repay cannot resolve a loan`,
    );

  type Case = {
    label: string;
    calls: ToolCall[];
    /** What a correct outcome looks like: a built plan, or a refusal. */
    expect: "plan" | "refusal";
    /** Substring the refusal must contain, when we can predict it. */
    because?: string;
  };

  const cases: Case[] = [
    {
      label: `swap 10 USDT → USDe${hasPool("USDT", "USDe") ? " (pool exists)" : " (no pool)"}`,
      calls: [{ name: "swap", args: { amount: "10", tokenIn: "USDT", tokenOut: "USDe" } }],
      expect: hasPool("USDT", "USDe") ? "plan" : "refusal",
    },
    {
      /* Refused on Sepolia today, and correctly: the factory has no WETH pool at
         any tier, so there is no price to derive `amountOutMin` from. The point of
         driving this off `hasPool` is that seeding one later flips the expectation
         without an edit here. */
      label: `swap 0.001 ETH → USDT${hasPool("ETH", "USDT") ? " (pool exists)" : " (no pool at any tier)"}`,
      calls: [{ name: "swap", args: { amount: "0.001", tokenIn: "ETH", tokenOut: "USDT" } }],
      expect: hasPool("ETH", "USDT") ? "plan" : "refusal",
      because: hasPool("ETH", "USDT") ? undefined : "pool",
    },
    {
      label: "swap into a token this chain does not carry",
      calls: [{ name: "swap", args: { amount: "1", tokenIn: "USDT", tokenOut: "NOTATOKEN" } }],
      expect: "refusal",
      because: "NOTATOKEN",
    },
    {
      label: "deposit 0.01 WETH as collateral",
      calls: [{ name: "deposit", args: { amount: "0.01", token: "WETH" } }],
      expect: "plan",
    },
    {
      label: "deposit native ETH as collateral (rides as value, no approve)",
      calls: [{ name: "deposit", args: { amount: "0.01", token: "ETH" } }],
      expect: "plan",
    },
    {
      label: "borrow 0.05 WETH at 5% for 30 days",
      calls: [{ name: "borrow", args: { amount: "0.05", token: "WETH", interestPct: 5, days: 30 } }],
      expect: "plan",
    },
    {
      label: "lend 0.05 WETH at 5% for 30 days",
      calls: [{ name: "lend", args: { amount: "0.05", token: "WETH", interestPct: 5, days: 30 } }],
      expect: "plan",
    },
    {
      label: `takeListing #1 for 0.01 (the listing on chain)`,
      calls: [{ name: "takeListing", args: { listingId: 1, amount: "0.01" } }],
      expect: "plan",
    },
    {
      label: "takeListing against an id that is not on the book",
      calls: [{ name: "takeListing", args: { listingId: 999, amount: "0.01" } }],
      expect: "refusal",
      because: "999",
    },
    {
      label: openRequest
        ? `fillRequest #${openRequest} (the OPEN request on chain)`
        : "fillRequest #1",
      calls: [{ name: "fillRequest", args: { requestId: Number(openRequest ?? 1) } }],
      expect: "plan",
    },
    {
      label: "repay, id resolved from the chain",
      calls: [{ name: "repay", args: {} }],
      expect: loans.length === 1 ? "plan" : "refusal",
    },
    {
      label: openRequest ? `cancel request #${openRequest}` : "cancel request #1",
      calls: [{ name: "cancel", args: { target: "request", id: Number(openRequest ?? 1) } }],
      expect: "plan",
    },
    {
      label: "collectFees on a position id the wallet does not hold",
      calls: [{ name: "collectFees", args: { positionId: 999999 } }],
      expect: "refusal",
      because: "999999",
    },
    {
      label: "claimTestTokens, asset resolved from the faucet",
      calls: [{ name: "claimTestTokens", args: { token: "USDT" } }],
      expect: faucetAssets.length > 0 ? "plan" : "refusal",
    },
    {
      label: "claim every due faucet asset",
      calls: [{ name: "claimTestTokens", args: { token: "all" } }],
      expect: faucetAssets.length > 0 ? "plan" : "refusal",
    },
    {
      label: "a round-trip swap pair, in the order the model proposed it",
      calls: [
        { name: "swap", args: { amount: "5", tokenIn: "USDT", tokenOut: "USDe" } },
        { name: "swap", args: { amount: "5", tokenIn: "USDe", tokenOut: "USDT" } },
      ],
      expect: hasPool("USDT", "USDe") ? "plan" : "refusal",
    },
    {
      /* Not a hypothetical: the model picks the verb, and a name that is in no
         part of the catalog must be REPORTED, not dropped. /api/chat prints the
         model's prose next to the plan and lists what it couldn't prepare from
         `errors` — so a silently skipped verb is prose describing a step the user
         is not about to sign. */
      label: "a verb that is not in the catalog at all",
      calls: [{ name: "rugTheTreasury", args: { amount: "1" } }],
      expect: "refusal",
      because: "rugTheTreasury",
    },
  ];

  /* Every address the registry declares for this chain. A plan may only touch
     these — a leaked address from another chain is the defect that made
     serverPlanDeps take a chainId, and it is invisible in a plan that otherwise
     looks correct. */
  const allowed = new Set<string>(
    [
      ...Object.values(contracts).filter((v): v is string => typeof v === "string" && ethers.isAddress(v)),
      ...tokens.map((t) => t.address),
    ].map((a) => a.toLowerCase()),
  );
  /* The two native sentinels and the borrower's own address are legitimate
     without being registry entries. */
  allowed.add("0x0000000000000000000000000000000000000001");
  allowed.add("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
  allowed.add(borrower.toLowerCase());
  for (const a of faucetAssets) allowed.add(a.address.toLowerCase());
  for (const pos of positions) {
    allowed.add(pos.token0.toLowerCase());
    allowed.add(pos.token1.toLowerCase());
  }
  for (let id = 1; id <= requestCount; id += 1) {
    allowed.add(String(requests[id].loanRequestAddr).toLowerCase());
    for (const c of requests[id].collateralTokens) allowed.add(String(c).toLowerCase());
  }
  if (listing1) allowed.add(String(listing1.tokenAddress).toLowerCase());

  for (const c of cases) {
    const built = await planFromToolCalls(c.calls, CHAIN, deps, OPTS);
    const gotPlan = built.plan.length > 0;
    const label = c.label;

    if (c.expect === "plan") {
      check(label, gotPlan, gotPlan ? describePlan(built.plan) : built.errors.join(" | ") || "no plan, no error");
    } else {
      const said = built.errors.join(" | ");
      const matched = !gotPlan && (c.because ? said.includes(c.because) : said.length > 0);
      check(
        `refused: ${label}`,
        matched,
        gotPlan ? `BUILT a plan instead: ${describePlan(built.plan)}` : said || "refused with no reason",
      );
    }

    if (!gotPlan) continue;

    /* Only plans get audited and address-checked; a refusal has nothing to
       inspect and would otherwise report a vacuous pass. */
    const foreign = addressesIn(built.plan).filter((a) => !allowed.has(a));
    check(
      `  ↳ every address is registered on chain ${CHAIN}`,
      foreign.length === 0,
      foreign.length ? foreign.join(", ") : `${new Set(addressesIn(built.plan)).size} distinct, all known`,
    );

    const verdict = await auditPlan({ plan: built.plan, chainId: CHAIN });
    const detail =
      `ok=${verdict.ok} $${verdict.totalUsd.toFixed(2)}` +
      (verdict.blocked.length ? ` blocked: ${verdict.blocked.join(" | ")}` : "") +
      (verdict.notes.length ? ` notes: ${verdict.notes.join(" | ")}` : "");
    check(`  ↳ audit passes`, verdict.ok, detail);
  }

  // ─────────────────────────────────────────────────────────────────────────
  section(4, "The auditor still refuses a plan it should");

  /* The address check above proves a correctly-built plan is clean. This proves
     the auditor is what would stop a dirty one, rather than the builder having
     been the only thing standing in the way — the two are separate layers and
     only one of them runs on a plan the model assembled by other means.

     `depositCollateral`, not `deposit`. `deposit` is the TOOL name; the intent
     kind the builder emits is `depositCollateral`, and AUDITORS is keyed by
     intent kind. Using the tool name here blocked on `"deposit" is not an
     auditable action` — a pass, but a vacuous one: the plan failed closed on an
     unregistered kind and the foreign-address rule was never reached, so this
     case asserted nothing about the check it was written for. */
  const foreignChain = getContracts(97);
  const foreignToken = foreignChain.usdt ?? foreignChain.usdc ?? foreignChain.diamond;
  if (foreignToken && foreignToken.toLowerCase() !== (contracts.usdt ?? "").toLowerCase()) {
    const smuggled = await auditPlan({
      plan: [
        {
          kind: "depositCollateral",
          token: foreignToken,
          symbol: "USDT",
          decimals: 6,
          amount: "1",
          isNative: false,
          diamond: contracts.diamond,
        },
      ],
      chainId: CHAIN,
    });
    check(
      "a BSC token address in a Sepolia plan is blocked",
      !smuggled.ok,
      smuggled.blocked.join(" | ") || "PASSED the audit",
    );
    /* And the reason has to be the address, not some other field of the step —
       a block for the wrong reason would still hide a broken address check. */
    check(
      "  ↳ blocked for the token, not incidentally",
      smuggled.blocked.some((b) => b.toLowerCase().includes(foreignToken.toLowerCase())),
      smuggled.blocked.join(" | ") || "(nothing blocked)",
    );
  } else {
    console.log("   SKIP: no BSC deployment to source a foreign address from");
  }

  /* The same step with THIS chain's registered collateral must pass, or the
     block above proves only that the rule refuses everything. Sepolia's
     registered collateral is NATIVE / WETH9 / USDC, and `wrappedNative` is the
     registry's name for WETH9 — there is no `weth` key. */
  const cleanDeposit = await auditPlan({
    plan: [
      {
        kind: "depositCollateral",
        token: contracts.wrappedNative ?? "",
        symbol: "WETH",
        decimals: 18,
        amount: "0.01",
        isNative: false,
        diamond: contracts.diamond,
      },
    ],
    chainId: CHAIN,
  });
  check(
    "the same step with this chain's WETH passes",
    cleanDeposit.ok,
    cleanDeposit.blocked.join(" | ") || `ok $${cleanDeposit.totalUsd.toFixed(2)}`,
  );

  const noChain = await auditPlan({
    plan: [{ kind: "swap", tokenIn: { address: contracts.usdt, symbol: "USDT", decimals: 6 }, amount: "1" }],
    chainId: undefined,
  });
  check(
    "a plan with no connected chain is blocked",
    !noChain.ok,
    noChain.blocked.join(" | ") || "PASSED the audit",
  );

  const unknownKind = await auditPlan({
    plan: [{ kind: "drainWallet", amount: "1" }],
    chainId: CHAIN,
  });
  check(
    "an unregistered intent kind fails closed",
    !unknownKind.ok,
    unknownKind.blocked.join(" | ") || "PASSED the audit",
  );

  console.log(`\n${"─".repeat(78)}`);
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log(`${"─".repeat(78)}\n`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("LIVE CHECK FAILED:", e);
  process.exit(1);
});
