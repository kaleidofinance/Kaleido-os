/**
 * Buy a token for the deployer with native USDC through KyberSwap on Arc — the
 * step before seeding a pool whose second side the deployer does not hold.
 *
 *   OUT=0x… USDC=21 MIN_OUT=1270 EXPECT_PRICE=0.0158 [EXECUTE=1] \
 *   npx hardhat run scripts/acquire-via-kyberswap.js --network arcMainnet
 *
 * Dry run by default: prints the route's output and implied price and stops.
 * Refuses when the output is under MIN_OUT or the implied price is more than
 * MAX_DEV_PCT (default 10) away from EXPECT_PRICE — a wrong route is a loss,
 * not a cosmetic issue.
 *
 * Order matters (the 2026-09-16 lesson): approve FIRST, then fetch and build the
 * route, then send at once. A route built before an approval mines goes stale in
 * the gap and the router reverts.
 *
 * KyberSwap quotes and pulls native USDC as the 0x3600 ERC-20 mirror (6 dec),
 * value 0 — the native sentinel is not routable on Arc.
 */
const hre = require("hardhat");
const { ethers } = hre;

const API = "https://aggregator-api.kyberswap.com/arc/api/v1";
const ROUTER = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5"; // KyberSwap MetaAggregationRouterV2 on Arc
const USDC_MIRROR = "0x3600000000000000000000000000000000000000";
const HEADERS = { "content-type": "application/json", "x-client-id": "kaleido-seed" };

async function main() {
  if (hre.network.config.chainId !== 5042) throw new Error("Arc mainnet only");
  const out = ethers.getAddress(process.env.OUT || "");
  const usdcIn = ethers.parseUnits(process.env.USDC || "0", 6);
  if (usdcIn <= 0n) throw new Error("USDC=<amount> required");
  const minOut = Number(process.env.MIN_OUT || "0");
  const expect = Number(process.env.EXPECT_PRICE || "0");
  const maxDev = Number(process.env.MAX_DEV_PCT || "10");
  const execute = process.env.EXECUTE === "1";

  const [me] = await ethers.getSigners();
  const erc = ["function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function decimals() view returns (uint8)", "function symbol() view returns (string)"];
  const usdc = new ethers.Contract(USDC_MIRROR, erc, me);
  const tok = new ethers.Contract(out, erc, me);
  const [sym, dec, have, usdcBal] = await Promise.all([tok.symbol(), tok.decimals(), tok.balanceOf(me.address), usdc.balanceOf(me.address)]);
  console.log(`buyer ${me.address}: ${ethers.formatUnits(usdcBal, 6)} USDC, ${ethers.formatUnits(have, dec)} ${sym}`);
  if (usdcBal < usdcIn) throw new Error("not enough USDC");

  if (execute && (await usdc.allowance(me.address, ROUTER)) < usdcIn) {
    const tx = await usdc.approve(ROUTER, usdcIn);
    console.log(`approve ${tx.hash}`);
    await tx.wait();
  }

  const qs = new URLSearchParams({ tokenIn: USDC_MIRROR, tokenOut: out, amountIn: usdcIn.toString() });
  const r = await (await fetch(`${API}/routes?${qs}`, { headers: HEADERS })).json();
  const rs = r?.data?.routeSummary;
  if (!rs) throw new Error(`no route: ${JSON.stringify(r).slice(0, 200)}`);
  const outAmt = Number(ethers.formatUnits(rs.amountOut, dec));
  const price = Number(ethers.formatUnits(usdcIn, 6)) / outAmt;
  console.log(`route: ${ethers.formatUnits(usdcIn, 6)} USDC -> ${outAmt} ${sym} (implied $${price.toPrecision(5)})`);
  if (outAmt < minOut) throw new Error(`output ${outAmt} < MIN_OUT ${minOut}`);
  if (expect > 0 && Math.abs(price / expect - 1) * 100 > maxDev)
    throw new Error(`implied price $${price} is more than ${maxDev}% from EXPECT_PRICE $${expect}`);
  if (!execute) return console.log("dry run — set EXECUTE=1 to buy");

  const b = await (await fetch(`${API}/route/build`, { method: "POST", headers: HEADERS, body: JSON.stringify({ routeSummary: rs, sender: me.address, recipient: me.address, slippageTolerance: 100 }) })).json();
  const d = b?.data;
  if (!d?.data || ethers.getAddress(d.routerAddress) !== ROUTER) throw new Error(`bad build: ${JSON.stringify(b).slice(0, 200)}`);
  const tx = await me.sendTransaction({ to: ROUTER, data: d.data, value: 0n });
  console.log(`swap ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`status ${rc.status}; now ${ethers.formatUnits(await tok.balanceOf(me.address), dec)} ${sym}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
