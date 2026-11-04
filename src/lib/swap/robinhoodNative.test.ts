import { strict as assert } from "node:assert";
import { resolveKyberSwap } from "./kyberswap";
import { NATIVE_SENTINEL } from "@/constants/registry";

async function main() {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ data: {
      routeSummary: { amountOut: "1000000" },
      data: "0x1234", amountOut: "1000000",
      routerAddress: "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5",
    } });
    const args = {
      chainId: 4663, tokenIn: NATIVE_SENTINEL.dex,
      tokenOut: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
      amountUnits: "1000000000000000",
      address: "0x0000000000000000000000000000000000001234", slippageBps: 50,
    };
    assert.equal((await resolveKyberSwap(args))?.value, args.amountUnits,
      "native ETH must travel as transaction value");
    assert.equal((await resolveKyberSwap({ ...args,
      tokenIn: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
    }))?.value, "0", "WETH is an ERC20 and must not send ETH");
    console.log("2 Robinhood native value checks passed");
  } finally {
    globalThis.fetch = original;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
