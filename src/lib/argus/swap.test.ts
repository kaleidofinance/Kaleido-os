process.env.ARGUS_ENABLED = "1";
/**
 * Argus swap builder — the calldata it emits must decode back to the EXACT
 * UniversalRouter v4 encoding reverse-engineered from a live Arc swap:
 * execute(commands=0x10, [ (actions=0x06,0x0c,0x0f, params[3]) ], deadline).
 * A mistake here sends malformed calldata to a router that moves funds, so this
 * round-trips every field. Run with `npx tsx src/lib/argus/swap.test.ts`.
 */
import { AbiCoder, Interface } from "ethers";
import { buildArgusSwapTx } from "./swap.ts";
import { ARGUS_V4 } from "./addresses.ts";
import type { ArgusLaunch } from "./launch.ts";

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, got?: string) => {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${got === undefined ? "" : ` — ${got}`}`); }
};

const USDC = "0x3600000000000000000000000000000000000000";
const TOKEN = "0x6A70f331a702d0604D9e985d7822ed22D3a0C2fb";
const HOOK = "0x551FD9a18C67d498F3ac8C3F08b9f13EFA1Da044";
const launch = (poolFee = 10000): ArgusLaunch => ({
  token: TOKEN, portal: "0x00000000000000000000000000000000000000B0", hook: HOOK,
  splitter: "0x0000000000000000000000000000000000000004", locker: "0x0000000000000000000000000000000000000005",
  quoteAsset: USDC, buyTaxBps: 100, sellTaxBps: 100, tickStart: 0, tickBond: 800000,
  tokenIsToken0: false, positionId: 1n, currency0: USDC, currency1: TOKEN,
  poolId: "0x" + "11".repeat(32), poolFee,
});

const coder = AbiCoder.defaultAbiCoder();
const iface = new Interface(["function execute(bytes commands, bytes[] inputs, uint256 deadline)"]);
function decode(data: string) {
  const parsed = iface.parseTransaction({ data })!;
  const commands: string = parsed.args[0];
  const inputs: string[] = parsed.args[1];
  const [actions, params] = coder.decode(["bytes", "bytes[]"], inputs[0]) as [string, string[]];
  const [p0] = coder.decode(
    ["tuple(tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,bytes hookData)"],
    params[0],
  ) as any;
  const [settleCur, settleAmt] = coder.decode(["address", "uint256"], params[1]) as [string, bigint];
  const [takeCur, takeAmt] = coder.decode(["address", "uint256"], params[2]) as [string, bigint];
  return { commands, nInputs: inputs.length, actions, nParams: params.length, p0, settleCur, settleAmt, takeCur, takeAmt };
}

console.log("\n— BUY (quote→token) round-trips to ground-truth encoding —");
{
  const amtIn = 10n * 10n ** 6n; // 10 USDC
  const minOut = 3_000_000n * 10n ** 18n;
  const tx = buildArgusSwapTx({ launch: launch(), side: "buy", amountInRaw: amtIn, amountOutMinimum: minOut, deadlineSec: 111 })!;
  check("to = UniversalRouter", tx.to.toLowerCase() === ARGUS_V4.universalRouter.toLowerCase());
  check("value = 0 (ERC-20 quote via Permit2)", tx.value === 0n);
  const d = decode(tx.data);
  check("commands = 0x10 (V4_SWAP)", d.commands === "0x10", d.commands);
  check("one input", d.nInputs === 1);
  check("actions = 0x06 0x0c 0x0f", d.actions === "0x060c0f", d.actions);
  check("three params", d.nParams === 3);
  check("poolKey currency0/1 correct", d.p0.poolKey.currency0.toLowerCase() === USDC && d.p0.poolKey.currency1.toLowerCase() === TOKEN.toLowerCase());
  check("poolKey fee/spacing/hook correct", Number(d.p0.poolKey.fee) === 10000 && Number(d.p0.poolKey.tickSpacing) === 200 && d.p0.poolKey.hooks.toLowerCase() === HOOK.toLowerCase());
  check("buy → zeroForOne true (token is currency1)", d.p0.zeroForOne === true);
  check("amountIn + minOut carried into swap params", BigInt(d.p0.amountIn) === amtIn && BigInt(d.p0.amountOutMinimum) === minOut);
  check("SETTLE_ALL settles the INPUT (USDC, amountIn)", d.settleCur.toLowerCase() === USDC && d.settleAmt === amtIn);
  check("TAKE_ALL takes the OUTPUT (token, minOut)", d.takeCur.toLowerCase() === TOKEN.toLowerCase() && d.takeAmt === minOut);
  check("meta flags the input for Permit2 approval", tx.meta.approvalNeededFor.toLowerCase() === USDC);
  check("marked unverified", tx.unverified === true);
}

console.log("\n— SELL (token→quote) flips direction + currencies —");
{
  const tx = buildArgusSwapTx({ launch: launch(), side: "sell", amountInRaw: 1000n * 10n ** 18n, amountOutMinimum: 1n })!;
  const d = decode(tx.data);
  check("sell → zeroForOne false", d.p0.zeroForOne === false);
  check("SETTLE_ALL settles the token", d.settleCur.toLowerCase() === TOKEN.toLowerCase());
  check("TAKE_ALL takes USDC", d.takeCur.toLowerCase() === USDC);
}

console.log("\n— pool fee is NOT hardcoded (comes from the launch) —");
{
  const tx = buildArgusSwapTx({ launch: launch(0), side: "buy", amountInRaw: 1n, amountOutMinimum: 0n })!;
  check("fee=0 launch → poolKey.fee 0 (validated key, not assumed 10000)", Number(decode(tx.data).p0.poolKey.fee) === 0);
}

console.log("\n— gated off —");
{
  const prev = process.env.ARGUS_ENABLED;
  process.env.ARGUS_ENABLED = "";
  check("ARGUS_ENABLED off → null (cannot build a signable tx)", buildArgusSwapTx({ launch: launch(), side: "buy", amountInRaw: 1n, amountOutMinimum: 0n }) === null);
  process.env.ARGUS_ENABLED = prev;
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
