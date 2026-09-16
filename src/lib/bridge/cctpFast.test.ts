// Checks on CCTP Fast Transfer: the fee/allowance resolver and the fast burn
// encoding. Run with tsx. Circle's endpoints are mocked by URL, so no network.
import { ethers } from "ethers";
import { resolveCctpFastFee } from "./cctpFast.ts";
import { buildCctpBurnRoute } from "./cctp.ts";

let pass = 0;
let fail = 0;
const j = (x: unknown) =>
  JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
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
const BASE = 8453;
const ETH = 1;
const BNB = 56;
const USER = "0x1111111111111111111111111111111111111111";
const units = (n: string) => ethers.parseUnits(n, 6);

// A fetch stand-in routing by URL: fees array + allowance object.
const mkFetch =
  (feeRows: unknown, allowance: number, feeStatus = 200) =>
  async (url: string) => {
    if (url.includes("/fees/"))
      return {
        ok: feeStatus >= 200 && feeStatus < 300,
        status: feeStatus,
        json: async () => feeRows,
      };
    if (url.includes("/allowance"))
      return { ok: true, status: 200, json: async () => ({ allowance }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };

const FEES_FREE = [
  { finalityThreshold: 1000, minimumFee: 0 },
  { finalityThreshold: 2000, minimumFee: 0 },
];
const FEES_PAID = [
  { finalityThreshold: 1000, minimumFee: 0.25 },
  { finalityThreshold: 2000, minimumFee: 0 },
];

const iTm = new ethers.Interface([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) returns (uint64)",
]);

async function main() {
  console.log("\n— resolveCctpFastFee —");
  const free = await resolveCctpFastFee({
    sourceChainId: ARC,
    destChainId: BASE,
    units: units("100"),
    fetchImpl: mkFetch(FEES_FREE, 1_000_000) as unknown as typeof fetch,
  });
  check("free corridor quotes ok with zero maxFee", free.ok === true && free.maxFeeUnits === 0n, j(free));

  const paid = await resolveCctpFastFee({
    sourceChainId: ETH,
    destChainId: ARC,
    units: units("100"),
    fetchImpl: mkFetch(FEES_PAID, 1_000_000) as unknown as typeof fetch,
  });
  // 100 USDC * 0.25 bps = ceil(100e6 * 250000 / 1e10) = 2500, x2 buffer = 5000
  check("paid corridor quotes a capped fee", paid.ok === true && paid.maxFeeUnits === 5000n, j(paid));
  check("the fee bps is carried through", paid.ok === true && paid.feeBps === 0.25);

  const noRoom = await resolveCctpFastFee({
    sourceChainId: ETH,
    destChainId: ARC,
    units: units("1000000"),
    fetchImpl: mkFetch(FEES_PAID, 500) as unknown as typeof fetch, // allowance 500 USDC
  });
  check("amount over the fast allowance is unavailable", noRoom.ok === false && "unavailable" in noRoom);

  const noFast = await resolveCctpFastFee({
    sourceChainId: ARC,
    destChainId: BASE,
    units: units("100"),
    fetchImpl: mkFetch([{ finalityThreshold: 2000, minimumFee: 0 }], 1e9) as unknown as typeof fetch,
  });
  check("a corridor with no fast level is unavailable", noFast.ok === false && "unavailable" in noFast);

  const feeDown = await resolveCctpFastFee({
    sourceChainId: ARC,
    destChainId: BASE,
    units: units("100"),
    fetchImpl: mkFetch(FEES_FREE, 1e9, 503) as unknown as typeof fetch,
  });
  check("a fee-service outage is unavailable (falls back to standard)", feeDown.ok === false && "unavailable" in feeDown);

  const notCctp = await resolveCctpFastFee({
    sourceChainId: BNB,
    destChainId: BASE,
    units: units("100"),
    fetchImpl: mkFetch(FEES_FREE, 1e9) as unknown as typeof fetch,
  });
  check("a non-CCTP corridor errors", notCctp.ok === false && "error" in notCctp);

  console.log("\n— buildCctpBurnRoute: fast vs standard encoding —");
  const dest = { id: BASE, shortName: "Base" };
  const common = {
    fromChainId: ARC,
    dest,
    asset: "USDC",
    amount: "100",
    decimals: 6,
    isNative: false,
    tokenAddress: "0x3600000000000000000000000000000000000000",
    userAddress: USER,
  };

  const std = buildCctpBurnRoute(common);
  if (!("error" in std)) {
    const [, , , , , maxFee, threshold] = iTm.decodeFunctionData("depositForBurn", std.data);
    check("standard: maxFee 0", maxFee === 0n);
    check("standard: threshold 2000", Number(threshold) === 2000);
  } else check("standard builds", false, std.error);

  const fastR = buildCctpBurnRoute({ ...common, speed: "fast", maxFeeUnits: 5000n });
  if (!("error" in fastR)) {
    const [, , , , , maxFee, threshold] = iTm.decodeFunctionData("depositForBurn", fastR.data);
    check("fast: maxFee is the quoted cap", maxFee === 5000n);
    check("fast: threshold 1000", Number(threshold) === 1000);
  } else check("fast builds", false, fastR.error);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main();
