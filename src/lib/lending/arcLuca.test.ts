// Luca on the Arc lending book (items 1–5 of the 2026-09-29 integration audit).
//
//   npm run test:arclending
//
// What these protect:
//   - the pre-check refuses what the contract refuses (pause, stale price, $10
//     floor, 75% capacity incl. the >= edge) and fails open on unknowns;
//   - collateral deposited EARLIER in the same plan counts toward a borrow;
//   - lending steps are simulated as signed (native value included), bundling is
//     unchanged, and a ledger-changing step stops the walk instead of predicting a
//     false revert;
//   - the resolvers' ABI matches the deployed facet selector for selector;
//   - "USDC offers" on Arc matches native-USDC book rows;
//   - what Luca says about Arc lending follows the registry, not a hand edit;
//   - grammar → plan works on the Arc-shaped book (Arc testnet, the parity
//     deploy), and on Arc mainnet itself once its diamond is in the registry.
import { ethers } from "ethers";

import facetAbi from "../../abi/ProtocolFacet.json";
import { lendingVerdict, MIN_LOAN_USD, type LendingCheck } from "./guard.ts";
import { arcLending, ARC_MAINNET } from "./arcLending.ts";
import { LENDING_ABI, LENDING_IFACE } from "../v2/intents/lendingAbi.ts";
import { encodeBatch, encodeForSimulation, isBatchable, LENDING_STATE_KINDS } from "../v2/intents/batch.ts";
import { simulatePlan } from "../ai/simulatePlan.ts";
import { bookAssetAddresses } from "../ai/readTools.ts";
import { arcMainnetLine, arcPointsLine, ARC_LENDING, MAINNET_DIRECTIVE, PRODUCT_STATE } from "../ai/normalizer.ts";
import { capabilityHelp, parseCommand } from "../v2/intents/fromCommand.ts";
import { buildIntents, type PlanDeps } from "../v2/intents/build.ts";
import { planFromToolCalls } from "../ai/fromToolCall.ts";
import { chainTokens, toIToken } from "../../constants/tokens.ts";
import { getContracts } from "../../constants/registry.ts";
import type { Intent } from "../v2/intents/types.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got = "") => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${got ? " — " + got : ""}`);
  }
};

const NATIVE = "0x0000000000000000000000000000000000000001";
const ARC_TESTNET = 5042002;
const E18 = 10n ** 18n;
const usdc = (n: number) => BigInt(Math.round(n * 100)) * 10n ** 16n;

async function run() {
  // ───────────────────────────────────────────── 4. the pre-check verdict
  console.log("\n4. pre-checks mirror the contract");
  const c = (over: Partial<LendingCheck> = {}): LendingCheck => ({
    action: "borrow", token: NATIVE, symbol: "USDC", amountRaw: 10n * E18, decimals: 18, ...over,
  });
  check("paused refuses a borrow with the pause sentence", /paused/i.test(lendingVerdict(c(), { paused: true }) ?? ""));
  check("paused refuses lend, take and fill too", ["lend", "takeListing", "fill"].every((a) =>
    /paused/i.test(lendingVerdict(c({ action: a as LendingCheck["action"] }), { paused: true }) ?? "")));
  check("a stale price refuses", /out of date/i.test(lendingVerdict(c(), { stale: true }) ?? ""));
  check("borrow under $10 refuses and names the floor",
    /minimum loan is \$10/.test(lendingVerdict(c({ amountRaw: 5n * E18 }), { loanUsd: usdc(4.99) }) ?? ""));
  check("lend under $10 refuses too", /minimum loan is \$10/.test(lendingVerdict(c({ action: "lend" }), { loanUsd: usdc(9.99) }) ?? ""));
  check("taking a listing has no $10 floor (the contract has none there)",
    lendingVerdict(c({ action: "takeListing" }), { loanUsd: usdc(5), collateralUsd: usdc(100), debtUsd: 0n }) === null);
  check("exactly $10 passes the floor", lendingVerdict(c({ action: "lend" }), { loanUsd: MIN_LOAN_USD }) === null);
  const cap = { collateralUsd: usdc(100), debtUsd: usdc(20) }; // 75% of 100 = 75 → room 55
  check("within capacity passes", lendingVerdict(c(), { loanUsd: usdc(54), ...cap }) === null);
  check("at the cap refuses (the contract reverts on >=)", lendingVerdict(c(), { loanUsd: usdc(55), ...cap }) !== null);
  const over = lendingVerdict(c(), { loanUsd: usdc(60), ...cap }) ?? "";
  check("over capacity says how much room is left", /borrow up to about \$55\.00 more/.test(over) && /\$20\.00 you already owe/.test(over), over);
  check("no collateral says deposit first", /deposited any collateral/i.test(lendingVerdict(c(), { loanUsd: usdc(10), collateralUsd: 0n, debtUsd: 0n }) ?? ""));
  check("unknown reads fail open", lendingVerdict(c(), {}) === null);
  check("a fill is never capacity-checked (it is the borrower's collateral)",
    lendingVerdict(c({ action: "fill" }), { loanUsd: usdc(1000), collateralUsd: 0n, debtUsd: 0n }) === null);

  // ───────────────────────────────────────────── 4b. same-plan collateral counts
  console.log("\n4b. collateral deposited earlier in the plan counts toward the borrow");
  {
    const seen: LendingCheck[] = [];
    const deps = fakeDeps(ARC_TESTNET, { lendingCheck: async (chk) => (seen.push(chk), null) });
    const built = await planFromToolCalls(
      [
        { name: "deposit", args: { amount: "20", token: "EURC" } },
        { name: "borrow", args: { amount: "10", token: "USDC", interestPct: 8, days: 30 } },
      ] as never,
      ARC_TESTNET,
      deps,
      { slippageBps: 50, deadlineMin: 20, impactCeiling: null },
    );
    const borrowCheck = seen.find((s) => s.action === "borrow");
    const pending = borrowCheck?.pendingCollateral ?? [];
    check("the borrow's check carries the EURC deposited in the step before",
      pending.length === 1 && pending[0].amountRaw === 20_000_000n && pending[0].decimals === 6,
      JSON.stringify(pending, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
    check("and the plan is deposit then borrow", built.plan.map((p) => (p as { kind: string }).kind).join(",") === "approve,depositCollateral,createLendingRequest",
      built.plan.map((p) => (p as { kind: string }).kind).join(",") + " " + built.errors.join("|"));
  }

  // ───────────────────────────────────────────── 3. simulation encoders
  console.log("\n3. lending steps are simulated as signed");
  const D = "0x898e9774b58d23d2EFEF3eb940782d9Ee1a03fa3";
  const EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
  const dep = { kind: "depositCollateral", diamond: D, token: NATIVE, amount: "2", decimals: 18, symbol: "USDC", isNative: true } as unknown as Intent;
  const sim = encodeForSimulation([dep], 0, "0x0000000000000000000000000000000000000abc");
  check("a native deposit simulates WITH its value", sim?.value === 2n * E18, String(sim?.value));
  check("while bundling still refuses it (unchanged)", encodeBatch([dep], [0], "0x0000000000000000000000000000000000000abc") === null);
  const req = { kind: "createLendingRequest", diamond: D, token: NATIVE, amount: "10.5", decimals: 18, symbol: "USDC", interestPct: 10, returnDate: 1_900_000_000 } as unknown as Intent;
  const reqCall = encodeForSimulation([req], 0, "0x0000000000000000000000000000000000000abc");
  const decoded = reqCall ? LENDING_IFACE.decodeFunctionData("createLendingRequest", reqCall.data) : null;
  check("a borrow request encodes amount, rate, date and currency as the resolver sends them",
    !!decoded && decoded[0] === 10_500_000_000_000_000_000n && Number(decoded[1]) === 1000 && Number(decoded[2]) === 1_900_000_000 && decoded[3] === NATIVE,
    decoded ? decoded.map(String).join(",") : "null");
  check("and a borrow request is still not bundleable", !isBatchable("createLendingRequest"));
  const fill = { kind: "fillRequest", diamond: D, token: NATIVE, requestId: 7, amount: "10.5", decimals: 18, symbol: "USDC", isNative: true } as unknown as Intent;
  check("a native fill carries the principal as value", encodeForSimulation([fill], 0, "0xabc0000000000000000000000000000000000000")?.value === 10_500_000_000_000_000_000n);
  const repay = { kind: "repayLoan", diamond: D, token: NATIVE, requestId: 7, amount: "10.51", amountRaw: "10510000000000000000", decimals: 18, symbol: "USDC", isNative: true } as unknown as Intent;
  check("a native repay carries amountRaw as value", encodeForSimulation([repay], 0, "0xabc0000000000000000000000000000000000000")?.value === 10_510_000_000_000_000_000n);
  check("every lending kind is a ledger step", ["depositCollateral", "withdrawCollateral", "repayLoan", "createLendingRequest", "createLoanListing", "borrowFromListing", "fillRequest", "closeListing", "closeRequest"].every((k) => LENDING_STATE_KINDS.has(k as never)));

  console.log("\n3b. simulatePlan walks lending plans honestly");
  {
    const sent: { value?: string }[] = [];
    const call = async (_m: string, params: unknown[]) => {
      sent.push(params[0] as { value?: string });
      return { jsonrpc: "2.0", id: 1, result: "0x" };
    };
    const r = await simulatePlan([dep, req], ARC_TESTNET, "0x0000000000000000000000000000000000000abc", call as never);
    check("deposit-then-borrow: the deposit is simulated with its value", sent[0]?.value === ethers.toBeHex(2n * E18), JSON.stringify(sent[0]));
    check("then the walk stops unverified rather than simulate the borrow against a ledger without the deposit",
      r.indeterminate && !r.firstFailure && r.steps.length === 1 && sent.length === 1, JSON.stringify(r));
  }
  {
    const paused = new ethers.Interface(facetAbi as ethers.InterfaceAbi).encodeErrorResult("Protocol__Paused", []);
    const call = async () => ({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "execution reverted", data: paused } });
    const r = await simulatePlan([req], ARC_TESTNET, "0x0000000000000000000000000000000000000abc", call as never);
    check("a lone borrow that would revert is predicted, by name", r.firstFailure?.reason === "Protocol__Paused", JSON.stringify(r.firstFailure));
  }

  // ───────────────────────────────────────────── the one ABI
  console.log("\nthe resolvers' ABI is the deployed facet's");
  const facet = new ethers.Interface(facetAbi as ethers.InterfaceAbi);
  new ethers.Interface(LENDING_ABI).forEachFunction((f) => {
    const real = facet.getFunction(f.selector);
    check(`${f.format()} exists on the facet with the same payability`, !!real && real.payable === f.payable, real?.format() ?? "missing");
  });

  // ───────────────────────────────────────────── 2. book filter
  console.log("\n2. USDC offers on Arc match native-USDC rows");
  const arcTestBook = bookAssetAddresses(ARC_TESTNET, "USDC");
  check("Arc testnet: USDC matches the native lending currency (address(1))", arcTestBook.has(NATIVE), [...arcTestBook].join(","));
  check("an unknown symbol matches nothing", bookAssetAddresses(ARC_TESTNET, "NOPE").size === 0);

  // ───────────────────────────────────────────── 1. what Luca says about Arc lending
  console.log("\n1. Luca's statement follows the registry");
  const live = arcMainnetLine({ collateral: ["EURC", "cirBTC"], loanable: ["USDC"] });
  check("live: four products, lending among them", /exactly FOUR things/.test(live) && /peer-to-peer lending book/.test(live));
  check("live: names the real collateral and the loan currency", /against EURC or cirBTC collateral/.test(live) && /borrow USDC \(native USDC/.test(live));
  check("live: states the 75% cap, the $10 floor, and that USDC is not collateral", /75%/.test(live) && /\$10 minimum/.test(live) && /NOT accepted as collateral/.test(live));
  check("live: no longer lists the lending book as testnet-only", !/lending book, kfUSD/.test(live));
  check("not live: the old statement, word for word", /exactly THREE things/.test(arcMainnetLine(null)) && /lending book, kfUSD\/kafUSD, KLD staking, and limit orders run only on the testnets/.test(arcMainnetLine(null)));
  check("points line: lending on Arc only when live", /lending and borrowing on Arc mainnet/.test(arcPointsLine({ collateral: ["EURC"], loanable: ["USDC"] })) && /lending, borrowing and staking on the testnets/.test(arcPointsLine(null)));
  check("PRODUCT_STATE carries the registry's answer", PRODUCT_STATE.includes(arcMainnetLine(ARC_LENDING)));
  check("the mainnet directive names the lending book iff live", MAINNET_DIRECTIVE.includes("the lending book") === !!ARC_LENDING);
  check("ARC_LENDING is exactly the registry reading", JSON.stringify(ARC_LENDING) === JSON.stringify(arcLending()));

  const helpLive = capabilityHelp({ showTestnets: false, arcLending: { collateral: ["EURC", "cirBTC"], loanable: ["USDC"] } });
  const helpNot = capabilityHelp({ showTestnets: false, arcLending: null });
  check("capability help lists Borrow & lend on mainnet when Arc lending is live", /Borrow & lend/.test(helpLive) && /deposit 20 EURC/.test(helpLive) && /borrow 10 USDC/.test(helpLive));
  check("and not when it isn't", !/Borrow & lend/.test(helpNot));

  // ───────────────────────────────────────────── 5. grammar → plan on the Arc shape
  for (const chainId of [ARC_TESTNET, ...(getContracts(ARC_MAINNET).diamond ? [ARC_MAINNET] : [])]) {
    const name = chainId === ARC_MAINNET ? "Arc mainnet" : "Arc testnet (mainnet parity)";
    console.log(`\n5. grammar → plan on ${name}`);
    const tokens = chainTokens(chainId).map(toIToken);
    const plan = async (text: string, over: Partial<PlanDeps> = {}) => {
      const parsed = parseCommand(text, tokens) as { status: string; command?: never };
      if (parsed.status !== "ok" || !parsed.command) return { ok: false as const, error: `parse:${parsed.status}` };
      return buildIntents(parsed.command, { slippageBps: 50, deadlineMin: 20, impactCeiling: null }, fakeDeps(chainId, over));
    };
    const kinds = (r: Awaited<ReturnType<typeof plan>>) => (r.ok ? r.build.intents.map((i) => i.kind).join(",") : `error:${r.error}`);

    const d = await plan("deposit 20 EURC");
    const depIntent = d.ok ? (d.build.intents.find((i) => i.kind === "depositCollateral") as { token: string; decimals: number; isNative?: boolean } | undefined) : undefined;
    check("deposit 20 EURC → approve + depositCollateral, 6 decimals, not native",
      kinds(d) === "approve,depositCollateral" && depIntent?.decimals === 6 && !depIntent?.isNative, kinds(d));
    check("deposit USDC is refused: native USDC is not collateral", /EURC/.test(kinds(await plan("deposit 20 USDC"))), kinds(await plan("deposit 20 USDC")));

    const seen: LendingCheck[] = [];
    const b = await plan("borrow 10 USDC at 8% for 30 days", { lendingCheck: async (chk) => (seen.push(chk), null) });
    const bi = b.ok ? (b.build.intents[0] as { kind: string; token: string; decimals: number }) : undefined;
    check("borrow 10 USDC → one createLendingRequest in native USDC at 18 decimals",
      kinds(b) === "createLendingRequest" && bi?.token === NATIVE && bi?.decimals === 18, kinds(b));
    check("and the pre-check was asked, with the raw amount", seen[0]?.action === "borrow" && seen[0]?.amountRaw === 10n * E18);
    const refused = await plan("borrow 10 USDC at 8% for 30 days", { lendingCheck: async () => "NOPE-PAUSED" });
    check("a pre-check refusal becomes the plan's answer", kinds(refused) === "error:NOPE-PAUSED", kinds(refused));

    const l = await plan("lend 100 USDC at 10% for 60 days");
    const li = l.ok ? (l.build.intents[0] as { kind: string; isNative?: boolean; token: string }) : undefined;
    check("lend 100 USDC → a native listing with no approve", kinds(l) === "createLoanListing" && li?.isNative === true && li?.token === NATIVE, kinds(l));
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

/** Lending needs only these reads; everything else answers "nothing". */
function fakeDeps(chainId: number, over: Partial<PlanDeps> = {}): PlanDeps {
  return {
    chainId,
    quote: async () => null,
    quotePath: async () => null,
    marketRow: async () => null,
    positions: async () => [],
    loans: async () => [],
    faucetAssets: async () => [],
    poolState: async () => null,
    collateralDeposits: async () => [],
    ...over,
  } as unknown as PlanDeps;
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
