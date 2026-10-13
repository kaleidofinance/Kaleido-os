/**
 * poolLegsUsd / feesOn — pure valuation of native-pool Swap logs.
 * Run: npx tsx src/lib/points/poolVolume.test.ts
 */
import { ethers } from "ethers";
import { V3_SWAP_TOPIC, feesOn, poolLegsUsd, poolTotalKey } from "./poolVolume";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
  }
}

const POOL = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const coder = ethers.AbiCoder.defaultAbiCoder();
const swapData = (a0: bigint, a1: bigint) =>
  coder.encode(
    ["int256", "int256", "uint160", "uint128", "int24"],
    [a0, a1, BigInt(1) << BigInt(96), BigInt(1000), 0],
  );
const log = (address: string, a0: bigint, a1: bigint, index: number, topic = V3_SWAP_TOPIC) => ({
  address,
  topics: [topic],
  data: swapData(a0, a1),
  index,
});

const e18 = BigInt(10) ** BigInt(18);
const e6 = BigInt(10) ** BigInt(6);

{
  // Dollar on side 1 (18-dec wrapped native): trader paid in 25 dollars.
  const legs = poolLegsUsd([log(POOL, BigInt(-7) * e6, BigInt(25) * e18, 3)], {
    [POOL]: { side: 1, decimals: 18 },
  });
  check("values the dollar leg", legs.length === 1 && Math.abs(legs[0].usd - 25) < 1e-9, JSON.stringify(legs));
  check("keeps the log index", legs[0]?.logIndex === 3);
}
{
  // Dollar on side 0 and NEGATIVE (the pool paid dollars out): absolute value.
  const legs = poolLegsUsd([log(POOL, BigInt(-12) * e6, BigInt(5) * e18, 0)], {
    [POOL]: { side: 0, decimals: 6 },
  });
  check("negative dollar leg counts as its size", Math.abs(legs[0].usd - 12) < 1e-9, JSON.stringify(legs));
}
{
  const legs = poolLegsUsd(
    [
      log(OTHER, BigInt(1) * e6, BigInt(1) * e18, 0),
      log(POOL, BigInt(1) * e6, BigInt(1) * e18, 1, ethers.id("Transfer(address,address,uint256)")),
    ],
    { [POOL]: { side: 0, decimals: 6 } },
  );
  check("ignores unknown pools and non-Swap logs", legs.length === 0, JSON.stringify(legs));
}
{
  // A multi-hop route through two of our pools books each pool's own leg.
  const legs = poolLegsUsd(
    [log(POOL, BigInt(10) * e6, BigInt(-3) * e18, 2), log(OTHER, BigInt(4) * e18, BigInt(-9) * e6, 5)],
    { [POOL]: { side: 0, decimals: 6 }, [OTHER]: { side: 0, decimals: 18 } },
  );
  check("each pool gets its own leg", legs.length === 2 && legs[0].usd === 10 && legs[1].usd === 4, JSON.stringify(legs));
}
{
  const legs = poolLegsUsd([log(POOL.toUpperCase().replace("0X", "0x"), BigInt(2) * e6, BigInt(0), 0)], {
    [POOL]: { side: 0, decimals: 6 },
  });
  check("pool address match is case-insensitive", legs.length === 1);
}
check("fees at 5 bps", feesOn(1000, 5) === 0.5);
check("fees null without volume", feesOn(null, 30) === null);
check("fees null on an impossible fee", feesOn(100, 10_000) === null);
check("total key lowercases", poolTotalKey(5042, "0xAB") === "5042:0xab");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
