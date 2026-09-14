// What a plan spends out of the wallet, for the pre-sign balance check. The
// property under test is one-directional: this must never report MORE than a
// plan actually spends, because an over-report blocks a plan the chain would
// have accepted. So the allowance-not-double-counted and brings-in cases matter
// as much as the spends.
import { outgoingLegs } from "./outgoing.ts";
import type { Intent } from "./types.ts";

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

const USDC = "0x0000000000000000000000000000000000000001";
const KLD = "0x0000000000000000000000000000000000000002";
const WETH = "0x0000000000000000000000000000000000000003";
const TO = "0x0000000000000000000000000000000000000009";

const swap = (over: Partial<Intent> = {}): Intent =>
  ({
    kind: "swap",
    tokenIn: USDC,
    tokenOut: KLD,
    amountIn: "1500",
    amountOutMin: "1",
    fee: 3000,
    decimalsIn: 6,
    decimalsOut: 18,
    symbolIn: "USDC",
    symbolOut: "KLD",
    spender: TO,
    ...over,
  }) as Intent;

const approve: Intent = {
  kind: "approve",
  token: USDC,
  spender: TO,
  amount: "1500",
  decimals: 6,
  symbol: "USDC",
} as Intent;

console.log("\n— a swap spends its input, once —");
{
  const legs = outgoingLegs([swap()]);
  check("one leg", legs.length === 1, String(legs.length));
  check(
    "names the input token, amount and decimals",
    legs[0]?.symbol === "USDC" &&
      legs[0]?.token === USDC &&
      legs[0]?.amount === "1500" &&
      legs[0]?.decimals === 6 &&
      legs[0]?.isNative === false,
    JSON.stringify(legs[0]),
  );

  // The one that matters most: the approve authorises the same 1500, and
  // counting it would report a 3000 USDC spend for a 1500 USDC swap.
  const withApprove = outgoingLegs([approve, swap()]);
  check(
    "an approve ahead of the swap is not counted",
    withApprove.length === 1 && withApprove[0]?.amount === "1500",
    JSON.stringify(withApprove),
  );
}

console.log("\n— a native sell is read as native, not as a token —");
{
  const legs = outgoingLegs([
    swap({ symbolIn: "ETH", tokenIn: WETH, decimalsIn: 18, nativeIn: true }),
  ]);
  check(
    "isNative is set, so the check reads getBalance not balanceOf(WETH)",
    legs[0]?.isNative === true && legs[0]?.symbol === "ETH",
    JSON.stringify(legs[0]),
  );
}

console.log("\n— multi-hop spends the first hop's input —");
{
  const multi: Intent = {
    kind: "swapMultiHop",
    hops: [
      { tokenIn: USDC, tokenOut: WETH, symbolIn: "USDC", symbolOut: "WETH", fee: 500 },
      { tokenIn: WETH, tokenOut: KLD, symbolIn: "WETH", symbolOut: "KLD", fee: 3000 },
    ],
    path: "0x",
    amountIn: "2000",
    amountOutMin: "1",
    decimalsIn: 6,
    decimalsOut: 18,
    symbolIn: "USDC",
    symbolOut: "KLD",
    spender: TO,
  } as Intent;
  const legs = outgoingLegs([approve, multi]);
  check(
    "the leg is the first hop's input, not the routed token",
    legs.length === 1 &&
      legs[0]?.token === USDC &&
      legs[0]?.amount === "2000" &&
      legs[0]?.decimals === 6,
    JSON.stringify(legs),
  );
}

console.log("\n— transfer, deposit and stake each spend one token —");
{
  const transfer: Intent = {
    kind: "transfer",
    token: USDC,
    to: TO,
    amount: "50",
    decimals: 6,
    symbol: "USDC",
  } as Intent;
  const deposit: Intent = {
    kind: "depositCollateral",
    diamond: TO,
    token: USDC,
    amount: "500",
    decimals: 6,
    symbol: "USDC",
  } as Intent;
  const stake: Intent = {
    kind: "stake",
    vault: TO,
    token: KLD,
    stToken: TO,
    amount: "100",
    symbol: "KLD",
  } as Intent;

  const t = outgoingLegs([transfer]);
  check("transfer spends its amount", t[0]?.amount === "50" && t[0]?.symbol === "USDC");
  const d = outgoingLegs([approve, deposit]);
  check("deposit spends its amount, approve ignored", d.length === 1 && d[0]?.amount === "500");
  const s = outgoingLegs([stake]);
  check(
    "stake spends KLD at 18 decimals",
    s[0]?.symbol === "KLD" && s[0]?.decimals === 18 && s[0]?.amount === "100",
    JSON.stringify(s),
  );
}

console.log("\n— what brings tokens IN is never counted —");
{
  for (const kind of [
    "approve",
    "withdrawCollateral",
    "redeemStable",
    "withdrawStake",
    "claimYield",
    "collectPoolFees",
    "decreasePoolLiquidity",
    "cancelOrders",
  ]) {
    const legs = outgoingLegs([{ kind } as Intent]);
    check(`"${kind}" contributes no spend`, legs.length === 0, JSON.stringify(legs));
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
