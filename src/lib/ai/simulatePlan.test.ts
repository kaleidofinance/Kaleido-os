/**
 * Plan simulation: it must surface a real revert with its reason, forward a
 * plan's approve into the step it authorises, and — above all — NEVER claim a
 * revert it cannot prove.
 *
 * Run with `npx tsx src/lib/ai/simulatePlan.test.ts`.
 *
 * The RPC is a mock: the property under test is what the simulator does with the
 * answers, not any real chain. The mock answers allowance-detection probes from a
 * chosen base slot and lets each test script the plan steps' results, so both the
 * happy path and every fail-open branch are exercised offline.
 */
import { ethers } from "ethers";
import { simulatePlan, isStaleQuoteRevert } from "./simulatePlan.ts";
import { allowanceSlot, _resetSlotCache, type RpcCall } from "./tokenSlots.ts";
import type { Intent } from "../v2/intents/types.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got?: string) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — ${got}`}`); }
};

const OWNER = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";
const ROUTER = "0x3333333333333333333333333333333333333333";
const TOKEN_OUT = "0x4444444444444444444444444444444444444444";
const ALLOWANCE_SELECTOR = "0xdd62ed3e"; // allowance(address,address)

const errIface = new ethers.Interface([
  "error Error(string)",
  "error Panic(uint256)",
]);
const revertError = (data: string) => ({ code: 3, message: "execution reverted", data });

const approve: Intent = {
  kind: "approve", token: TOKEN, spender: ROUTER, amount: "100", decimals: 6, symbol: "USDC",
};
const swap: Intent = {
  kind: "swap", tokenIn: TOKEN, tokenOut: TOKEN_OUT, amountIn: "100", amountOutMin: "90",
  fee: 3000, decimalsIn: 6, decimalsOut: 18, symbolIn: "USDC", symbolOut: "KLD", spender: ROUTER,
} as Intent;

/**
 * A mock RPC. `slotBase` is the token's real allowance base slot for detection to
 * find (undefined = a token whose layout is not detectable). `onStep` scripts the
 * result of a non-detection eth_call, and sees the overrides that call carried.
 */
function mockRpc(opts: {
  slotBase?: number;
  onStep?: (to: string, overrides: Record<string, { stateDiff: Record<string, string> }>) => {
    result?: unknown; error?: { code?: number; message?: string; data?: string };
  };
}): RpcCall {
  return async (_method, params) => {
    const [call, , overrides] = params as [
      { to: string; data: string },
      string,
      Record<string, { stateDiff: Record<string, string> }>,
    ];
    if (call.data?.slice(0, 10) === ALLOWANCE_SELECTOR) {
      if (opts.slotBase === undefined) return { result: ethers.toBeHex(0n, 32) };
      const want = allowanceSlot(OWNER, ROUTER, opts.slotBase).toLowerCase();
      const diff = overrides?.[TOKEN.toLowerCase()]?.stateDiff ?? {};
      const hit = Object.entries(diff).some(
        ([s, v]) => s.toLowerCase() === want && BigInt(v) === 42n,
      );
      return { result: ethers.toBeHex(hit ? 42n : 0n, 32) };
    }
    return opts.onStep?.(call.to, overrides ?? {}) ?? { result: "0x" };
  };
}

async function main() {
  console.log("\n— a plan that simulates clean is vouched for —");
  {
    _resetSlotCache();
    let sawOverrideOnSwap = false;
    const rpc = mockRpc({
      slotBase: 1,
      onStep: (to, ov) => {
        if (to.toLowerCase() === ROUTER.toLowerCase()) {
          sawOverrideOnSwap = !!ov[TOKEN.toLowerCase()];
        }
        return { result: "0x" };
      },
    });
    const sim = await simulatePlan([approve, swap], 5042, OWNER, rpc);
    check("ok, not indeterminate", sim.ok && !sim.indeterminate, JSON.stringify(sim));
    check("both steps recorded ok", sim.steps.length === 2 && sim.steps.every((s) => s.ok));
    check("the approve was faked into the swap's eth_call", sawOverrideOnSwap);
  }

  console.log("\n— a step that would revert is surfaced with its reason —");
  {
    _resetSlotCache();
    const rpc = mockRpc({
      slotBase: 1,
      onStep: (to) =>
        to.toLowerCase() === ROUTER.toLowerCase()
          ? { error: revertError(errIface.encodeErrorResult("Error", ["Too little received"])) }
          : { result: "0x" },
    });
    const sim = await simulatePlan([approve, swap], 5042, OWNER, rpc);
    check("not ok", !sim.ok);
    check("firstFailure is the swap (index 1)", sim.firstFailure?.index === 1, JSON.stringify(sim.firstFailure));
    check("its reason is decoded", sim.firstFailure?.reason === "Too little received", sim.firstFailure?.reason);
  }

  console.log("\n— a Panic decodes too —");
  {
    _resetSlotCache();
    const rpc = mockRpc({
      onStep: () => ({ error: revertError(errIface.encodeErrorResult("Panic", [17])) }),
    });
    const sim = await simulatePlan([swap], 5042, OWNER, rpc);
    check("panic surfaced with its code", sim.firstFailure?.reason === "Panic(0x11)", sim.firstFailure?.reason);
  }

  console.log("\n— NEVER lies: undetectable allowance slot → indeterminate, no claim —");
  {
    _resetSlotCache();
    /* Detection never reads the sentinel back (a chain that ignores overrides, or
       a non-standard token). The approve→swap chain cannot be faked, so the walk
       stops and NOTHING is claimed about the swap. */
    const rpc = mockRpc({ slotBase: undefined, onStep: () => ({ result: "0x" }) });
    const sim = await simulatePlan([approve, swap], 5042, OWNER, rpc);
    check("indeterminate", sim.indeterminate);
    check("no false failure", !sim.firstFailure && !sim.ok, JSON.stringify(sim));
    check("only the approve was simulated", sim.steps.length === 1 && sim.steps[0].kind === "approve");
  }

  console.log("\n— fail open: a non-revert RPC error says nothing —");
  {
    _resetSlotCache();
    const rpc = mockRpc({
      onStep: () => ({ error: { code: -32005, message: "rate limited" } }),
    });
    const sim = await simulatePlan([swap], 5042, OWNER, rpc);
    check("indeterminate, no failure", sim.indeterminate && !sim.firstFailure, JSON.stringify(sim));
  }

  console.log("\n— fail open: an unencodable kind is not judged —");
  {
    _resetSlotCache();
    const bridge = { kind: "bridge" } as Intent; // no batch encoder
    const rpc = mockRpc({ onStep: () => ({ result: "0x" }) });
    const sim = await simulatePlan([bridge], 5042, OWNER, rpc);
    check("indeterminate, nothing claimed", sim.indeterminate && !sim.firstFailure && !sim.ok);
  }

  console.log("\n— a single already-approved swap needs no override —");
  {
    _resetSlotCache();
    let steps = 0;
    const rpc = mockRpc({ onStep: () => { steps++; return { result: "0x" }; } });
    const sim = await simulatePlan([swap], 5042, OWNER, rpc);
    check("ok with one eth_call, no detection", sim.ok && steps === 1, `steps=${steps}`);
  }

  console.log("\n— the stale-quote classifier (what route.ts retries) —");
  {
    /* Slippage-floor reverts a fresh quote can clear — these trigger the rebuild. */
    for (const r of ["Too little received", "Too much requested", "STF", "Price slippage check", "INSUFFICIENT_OUTPUT_AMOUNT"]) {
      check(`retries "${r}"`, isStaleQuoteRevert(r), r);
    }
    /* Everything else is not a stale number — surface, do not retry. */
    for (const r of ["NoCollateralDeposited", "Panic(0x11)", "HealthFactorTooLow", "ERC20: transfer amount exceeds balance"]) {
      check(`does NOT retry "${r}"`, !isStaleQuoteRevert(r), r);
    }
    check("no reason is not retried", !isStaleQuoteRevert(undefined));
  }

  console.log("\n— D-b1: a stale-quote revert clears on a re-priced retry —");
  {
    /* First simulation of the swap reverts with a slippage message; the caller (in
       route.ts) rebuilds and re-simulates. Here we prove the second simulation of
       the SAME plan can come back clean when the mock's step result flips — i.e.
       simulatePlan is a pure function of the RPC, so a re-priced retry that no
       longer reverts is vouched for. */
    _resetSlotCache();
    let call = 0;
    const rpc = mockRpc({
      slotBase: 1,
      onStep: (to) => {
        if (to.toLowerCase() !== ROUTER.toLowerCase()) return { result: "0x" };
        call += 1;
        return call === 1
          ? { error: revertError(errIface.encodeErrorResult("Error", ["Too little received"])) }
          : { result: "0x" };
      },
    });
    const first = await simulatePlan([approve, swap], 5042, OWNER, rpc);
    check("first pass predicts the slippage revert", !first.ok && isStaleQuoteRevert(first.firstFailure?.reason), JSON.stringify(first.firstFailure));
    _resetSlotCache();
    const second = await simulatePlan([approve, swap], 5042, OWNER, rpc);
    check("the re-priced retry is clean", second.ok, JSON.stringify(second));
  }
}

main().then(() => {
  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exit(1);
});
