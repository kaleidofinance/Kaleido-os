import { strict as assert } from "node:assert";
import { TOKENS } from "@/constants/registry";
import { readExternalPools } from "./externalPools";

async function main() {
  for (const [chainId, network] of [
    [5042, "arc"],
    [4663, "robinhood"],
    [56, "bsc"],
  ] as const) {
    const tokens = TOKENS[chainId];
    const base = tokens.find(
      (t) => t.symbol === (chainId === 4663 ? "USDG" : "USDC"),
    )!;
    const quote = tokens.find(
      (t) => t.symbol === (chainId === 56 ? "WBNB" : "WETH"),
    )!;
    const pool = `0x${"d".repeat(64)}`;
    const unknown = `0x${"f".repeat(40)}`;
    let mode:
      | "valid"
      | "unknown-hop"
      | "zero-output"
      | "unknown-tvl"
      | "empty-tvl"
      | "depeg"
      | "bad-rate"
      | "no-pricing"
      | "launch" = "valid";
    const mock: typeof fetch = async (input) => {
      const url = new URL(String(input));
      assert.ok(
        !url.hostname.includes("earn-service"),
        "never use an unrestricted explorer feed",
      );
      if (url.hostname === "aggregator-api.kyberswap.com") {
        assert.equal(url.pathname, `/${network}/api/v1/routes`);
        assert.equal(
          url.searchParams.get("amountIn"),
          (10n ** BigInt(base.decimals)).toString(),
        );
        const hop =
          mode === "unknown-hop"
            ? unknown
            : mode === "launch"
              ? TOKENS[5042].find((t) => t.symbol === "ARGUS")!.address
              : quote.address;
        return Response.json({
          code: 0,
          data: {
            routeSummary: {
              amountOut: mode === "zero-output" ? "0" : "123456",
              amountInUsd: mode === "depeg" ? "0.21" : "1",
              amountOutUsd:
                mode === "no-pricing"
                  ? null
                  : mode === "bad-rate"
                    ? "0.7"
                    : "0.999",
              route: [
                [
                  {
                    pool,
                    tokenIn: base.address,
                    tokenOut: hop,
                    exchange: "uniswap-v3",
                  },
                ],
              ],
            },
          },
        });
      }
      assert.ok(
        url.pathname.startsWith(`/api/v2/networks/${network}/pools/multi/`),
      );
      return Response.json({
        data: [
          {
            id: `${network}_${pool}`,
            attributes: {
              reserve_in_usd:
                mode === "unknown-tvl"
                  ? null
                  : mode === "empty-tvl"
                    ? "0"
                    : "50000",
              volume_usd: { h24: "200" },
              fee_percentage: "0.3",
            },
          },
        ],
      });
    };
    const valid = await readExternalPools(chainId, mock);
    assert.equal(valid?.source, "kyberswap-routes");
    assert.equal(valid?.pools.length, 1, "deduplicate routes");
    assert.equal(valid?.pools[0].tvlUsd, 50000);
    assert.equal(valid?.pools[0].chainId, chainId);
    for (const rejected of [
      "unknown-hop",
      "zero-output",
      "unknown-tvl",
      "empty-tvl",
      "depeg",
      "bad-rate",
      "no-pricing",
      "launch",
    ] as const) {
      mode = rejected;
      const result = await readExternalPools(chainId, mock);
      assert.equal(
        result?.pools.length ?? 0,
        0,
        `${network}: reject ${rejected}`,
      );
    }
  }
  assert.equal(
    await readExternalPools(1, async () => {
      throw Error("unexpected fetch");
    }),
    null,
  );
  console.log("External pool eligibility checks passed for all three chains");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
