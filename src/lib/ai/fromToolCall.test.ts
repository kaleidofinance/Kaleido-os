/**
 * The model tool -> command mapping, where a wrong default or a dropped field
 * ships a mispriced order the maker cannot see.
 *
 * Run with `npx tsx src/lib/ai/fromToolCall.test.ts`.
 *
 * `placeLimitOrder` is the tool that exists for what the grammar declines - a
 * buy (the user names the output, so the model states the input and inPerOut), a
 * recurring order (intervalDays + fills), a relative price (the model reads the
 * market and passes an absolute number). The resolver arithmetic is tested in
 * build.test.ts; this pins the LAYER above it - that the tool's fields land on
 * the command with the defaults that match the grammar, so the two entry points
 * agree.
 */
import { planFromToolCalls } from "./fromToolCall";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got = "") => {
  if (ok) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${got ? " " + got : ""}`);
  }
};

const CHAIN = 11155111;
const OPTS = { slippageBps: 50, deadlineMin: 20 };
const deps = {
  chainId: CHAIN,
  quote: async () => null,
  quotePath: async () => null,
} as never;

async function plan(args: Record<string, unknown>) {
  const r = await planFromToolCalls(
    [{ name: "placeLimitOrder", args }] as never,
    CHAIN,
    deps,
    OPTS,
  );
  return r;
}

async function main() {
  console.log("\n— placeLimitOrder maps to a placeOrder plan —");

  {
    /* A sell-framed one-shot, identical to what the grammar builds from
       "limit sell 500 KLD at 0.05 USDC" - the two entry points must agree. */
    const r = await plan({
      amount: "500",
      tokenIn: "KLD",
      tokenOut: "USDC",
      price: "0.05",
      basis: "outPerIn",
    });
    check("no errors", r.errors.length === 0, r.errors.join("; "));
    const order = r.plan.find((i) => (i as { kind: string }).kind === "placeOrder") as
      | Record<string, unknown>
      | undefined;
    const appr = r.plan.find((i) => (i as { kind: string }).kind === "approve") as
      | Record<string, unknown>
      | undefined;
    check("builds approve then placeOrder", r.plan.map((i) => (i as { kind: string }).kind).join(",") === "approve,placeOrder");
    check("minOut is 25 (500 x 0.05, outPerIn)", order?.minOut === "25.0", String(order?.minOut));
    check("a one-shot approves exactly the input", appr?.amount === "500.0", String(appr?.amount));
    check("expiry defaults to 30 days (grammar's month)", order?.expiresIn === 30 * 86400, String(order?.expiresIn));
    check("one fill, no interval", order?.maxFills === 1 && order?.interval === 0);
  }

  {
    /* A BUY: the user named the output, so the model states the input (USDC) and
       inPerOut. minOut = amount / price. This is the case the grammar declines. */
    const r = await plan({
      amount: "50",
      tokenIn: "USDC",
      tokenOut: "KLD",
      price: "0.04",
      basis: "inPerOut",
      intervalDays: 7,
      fills: 4,
    });
    const order = r.plan.find((i) => (i as { kind: string }).kind === "placeOrder") as
      | Record<string, unknown>
      | undefined;
    const appr = r.plan.find((i) => (i as { kind: string }).kind === "approve") as
      | Record<string, unknown>
      | undefined;
    check("inPerOut minOut is amount / price (50 / 0.04 = 1250)", order?.minOut === "1250.0", String(order?.minOut));
    check("a recurring order approves amount x fills (50 x 4 = 200)", appr?.amount === "200.0", String(appr?.amount));
    check("interval carried in seconds, fills preserved", order?.interval === 604800 && order?.maxFills === 4);
  }

  {
    /* Guards the resolver never sees: a missing price is asked for, not defaulted -
       a limit order at no price lets the filler choose it. */
    const r = await plan({ amount: "500", tokenIn: "KLD", tokenOut: "USDC", basis: "outPerIn" });
    check("a missing price is an error, not a guessed order", r.errors.length > 0 && r.plan.length === 0, r.errors.join("; "));
  }

  {
    /* An unknown token names itself in the error rather than throwing later. */
    const r = await plan({ amount: "1", tokenIn: "NOTATOKEN", tokenOut: "USDC", price: "1", basis: "outPerIn" });
    check("an unknown token is a named error", r.errors.some((e) => e.includes("NOTATOKEN")), r.errors.join("; "));
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
