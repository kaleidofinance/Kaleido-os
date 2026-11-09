import { hasLifiSwap, isKnownLifiSwapRouter, resolveLifiSwap } from "./lifi";

const ROUTER = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE";
const INPUT = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const OUTPUT = "0x55d398326f99059fF775485246999027B3197955";
const USER = "0x0000000000000000000000000000000000000001";

function ok(name: string, value: boolean, detail = "") {
  if (!value) throw new Error(`${name}${detail ? `: ${detail}` : ""}`);
  console.log(`  ok   ${name}`);
}

ok("BSC has a LI.FI same-chain route", hasLifiSwap(56));
ok("Elysium mainnet has a LI.FI same-chain route", hasLifiSwap(99901));
ok("Elysium testnet remains fail-closed", !hasLifiSwap(99801));
ok("the reviewed router is pinned", isKnownLifiSwapRouter(56, ROUTER));
ok(
  "the reviewed Elysium mainnet router is pinned",
  isKnownLifiSwapRouter(99901, "0x24E6dA91AA4A8FEe2447F542c92E006243bd6Dc5"),
);
ok(
  "a router on the wrong chain is refused",
  !isKnownLifiSwapRouter(5042, ROUTER),
);

async function run() {
  const execution = await resolveLifiSwap({
    chainId: 56,
    tokenIn: INPUT,
    tokenOut: OUTPUT,
    amountUnits: "1000000000000000000",
    address: USER,
    slippageBps: 50,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          estimate: { toAmount: "998588039873322240", approvalAddress: ROUTER },
          transactionRequest: { to: ROUTER, data: "0xdeadbeef", value: "0x0" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  });
  ok(
    "a LI.FI quote returns executable calldata",
    execution?.data === "0xdeadbeef",
  );
  ok(
    "the quote carries the expected output",
    execution?.amountOut === "998588039873322240",
  );
  ok(
    "the approval is pinned to LI.FI",
    execution?.spender.toLowerCase() === ROUTER.toLowerCase(),
  );

  const refused = await resolveLifiSwap({
    chainId: 56,
    tokenIn: INPUT,
    tokenOut: OUTPUT,
    amountUnits: "1",
    address: USER,
    slippageBps: 50,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          estimate: {
            toAmount: "2",
            approvalAddress: "0x0000000000000000000000000000000000000002",
          },
          transactionRequest: {
            to: "0x0000000000000000000000000000000000000002",
            data: "0xdeadbeef",
            value: "0x0",
          },
        }),
        { status: 200 },
      ),
  });
  ok("an unrecognised LI.FI router is refused", refused === null);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
