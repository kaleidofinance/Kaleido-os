// Checks on the KyberSwap swap-route helpers. Run with tsx.
//
// The network calls (resolveKyberSwap / getKyberSwapExecution) are not exercised
// here — they hit a live aggregator. What is checked is the pure surface that the
// auditor and the planner depend on: which chains route through KyberSwap, the
// one router each is pinned to, the case-insensitive whitelist, and that the fee
// body is empty until a receiver is configured (so a missing receiver degrades to
// a zero-fee swap, never a broken request).
import {
  kyberSwapChainSlug,
  kyberSwapRouter,
  hasKyberSwap,
  isKnownSwapRouter,
  resolveKyberSwap,
  aggregatorToken,
  nativeSwapErc20,
} from "./kyberswap.ts";
import { kyberFeeParams, swapFeeBps } from "./kyberswapServer.ts";

let pass = 0;
let fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const ARC = 5042;
const ARC_ROUTER = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";

// Wrapped in an async IIFE: the tsx runner emits CJS, which has no top-level
// await, and one check awaits resolveKyberSwap.
async function main() {
console.log("\n— chain routing —");
check("Arc has a KyberSwap slug", kyberSwapChainSlug(ARC) === "arc");
check("a non-Arc chain has no slug", kyberSwapChainSlug(1) === undefined);
check("Arc has a KyberSwap router", kyberSwapRouter(ARC) === ARC_ROUTER);
check("hasKyberSwap is true for Arc", hasKyberSwap(ARC) === true);
check("hasKyberSwap is false off Arc", hasKyberSwap(1) === false);

console.log("\n— router whitelist —");
check("the pinned router is recognised", isKnownSwapRouter(ARC, ARC_ROUTER));
check(
  "the whitelist is case-insensitive",
  isKnownSwapRouter(ARC, ARC_ROUTER.toLowerCase()),
);
check(
  "a different address on Arc is refused",
  !isKnownSwapRouter(ARC, "0x0000000000000000000000000000000000000001"),
);
check(
  "the right router on the wrong chain is refused",
  !isKnownSwapRouter(1, ARC_ROUTER),
);
check("an empty address is refused", !isKnownSwapRouter(ARC, ""));

console.log("\n— resolve refuses an unrouted chain without a network call —");
{
  const r = await resolveKyberSwap({
    chainId: 999,
    tokenIn: "0x0000000000000000000000000000000000000001",
    tokenOut: "0x0000000000000000000000000000000000000002",
    amountUnits: "1000000",
    address: "0x000000000000000000000000000000000000dEaD",
    slippageBps: 100,
  });
  check("an off-KyberSwap chain resolves to null", r === null);
}

console.log("\n— fee params are gated on a configured receiver —");
{
  delete process.env.SWAP_FEE_RECEIVER;
  check("no receiver → no fee params", Object.keys(kyberFeeParams()).length === 0);

  process.env.SWAP_FEE_RECEIVER = "0x00000000000000000000000000000000000FEE01";
  process.env.SWAP_FEE_BPS = "20";
  const body = kyberFeeParams();
  check("receiver set → fee is charged on input", body.chargeFeeBy === "currency_in");
  check("fee is 20 bps in bps mode", body.feeAmount === "20" && body.isInBps === "true");
  check("fee receiver is echoed", body.feeReceiver === process.env.SWAP_FEE_RECEIVER);
  check("swapFeeBps reads the env", swapFeeBps() === 20);
  delete process.env.SWAP_FEE_RECEIVER;
  delete process.env.SWAP_FEE_BPS;
  check("default fee is 20 bps when unset", swapFeeBps() === 20);
}

console.log("\n— native USDC trades as its 0x3600 mirror —");
const USDC_3600 = "0x3600000000000000000000000000000000000000";
const nativeUsdc = {
  address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  symbol: "USDC",
  decimals: 18,
  isNative: true,
};
const inTok = aggregatorToken(ARC, nativeUsdc);
check("Arc native USDC maps to the 0x3600 ERC20", inTok.address === USDC_3600);
check("at the mirror's 6 decimals", inTok.decimals === 6);
check("no longer flagged native (so it gets an approve)", inTok.isNative === false);
check("the display symbol is preserved", inTok.symbol === "USDC");

const cir = {
  address: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0",
  symbol: "cirBTC",
  decimals: 8,
};
const outTok = aggregatorToken(ARC, cir);
check("a non-native token is unchanged", outTok.address === cir.address && outTok.decimals === 8);

const noMirror = aggregatorToken(1, nativeUsdc);
check("a native token on a chain with no mirror is unchanged", noMirror.isNative === true);

check("the auditor recognises the 0x3600 mirror", !!nativeSwapErc20(ARC, USDC_3600));
check("mirror lookup is case-insensitive", !!nativeSwapErc20(ARC, USDC_3600.toUpperCase()));
check("a non-mirror address is not recognised", nativeSwapErc20(ARC, cir.address) === null);
check("no mirror off Arc", nativeSwapErc20(1, USDC_3600) === null);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
}

main();
