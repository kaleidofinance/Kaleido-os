/**
 * Move an out-of-range Kaleido V3 position on Arc to a band centred on the
 * pool's current price: withdraw it, sell part of the one-sided token through
 * KyberSwap so the two sides match the new band, then mint the band.
 *
 *   TOKEN_ID=29 WIDTH_PCT=10 [EXECUTE=1] \
 *   npx hardhat run scripts/rebalance-v3-position.js --network arcMainnet
 *
 * Dry run by default: prints what would be withdrawn, sold and minted, and
 * stops. Assumes token0 is the USDC side (the 0x3600 mirror, or the 0x8c6c
 * wrapped native, which is wrapped from native after the swap) and token1 the
 * volatile token — true for both ARGUS pools; anything else refuses.
 */
const hre = require("hardhat");
const { ethers } = hre;

const NPM = "0x55879358eC7eDA609f2264b0348D1915ee8307e1";
const API = "https://aggregator-api.kyberswap.com/arc/api/v1";
const ROUTER = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";
const USDC_MIRROR = "0x3600000000000000000000000000000000000000";
const HEADERS = { "content-type": "application/json", "x-client-id": "kaleido-seed" };
const MAX128 = 2n ** 128n - 1n;
const SPACING = 200; // fee 10000

const npmAbi = [
  "function positions(uint256) view returns (uint96,address,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256,uint256,uint128,uint128)",
  "function ownerOf(uint256) view returns (address)",
  "function factory() view returns (address)",
  "function decreaseLiquidity((uint256 tokenId,uint128 liquidity,uint256 amount0Min,uint256 amount1Min,uint256 deadline)) returns (uint256,uint256)",
  "function collect((uint256 tokenId,address recipient,uint128 amount0Max,uint128 amount1Max)) returns (uint256,uint256)",
  "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function mint((address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint256 amount0Desired,uint256 amount1Desired,uint256 amount0Min,uint256 amount1Min,address recipient,uint256 deadline)) returns (uint256 tokenId,uint128 liquidity,uint256 amount0,uint256 amount1)",
];
const erc = [
  "function balanceOf(address) view returns (uint256)", "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)", "function decimals() view returns (uint8)", "function symbol() view returns (string)",
];

const sqrtAt = (t) => Math.sqrt(1.0001 ** t);
const fmt = (v, d) => Number(ethers.formatUnits(v, d));

async function main() {
  if (hre.network.config.chainId !== 5042) throw new Error("Arc mainnet only");
  const id = BigInt(process.env.TOKEN_ID || "0");
  const W = Number(process.env.WIDTH_PCT || "10") / 100;
  const execute = process.env.EXECUTE === "1";
  if (!id) throw new Error("TOKEN_ID required");
  if (!(W > 0 && W < 0.9)) throw new Error("WIDTH_PCT out of range");

  const [me] = await ethers.getSigners();
  const npm = new ethers.Contract(NPM, npmAbi, me);
  if ((await npm.ownerOf(id)).toLowerCase() !== me.address.toLowerCase()) throw new Error("signer does not own this position");
  const pos = await npm.positions(id);
  const [t0, t1] = [new ethers.Contract(pos.token0, erc, me), new ethers.Contract(pos.token1, erc, me)];
  const [s0, s1, d0, d1] = await Promise.all([t0.symbol(), t1.symbol(), t0.decimals(), t1.decimals()]).then((x) => [x[0], x[1], Number(x[2]), Number(x[3])]);
  const isMirror = pos.token0.toLowerCase() === USDC_MIRROR.toLowerCase();
  const factory = new ethers.Contract(await npm.factory(), ["function getPool(address,address,uint24) view returns (address)"], me);
  const pool = new ethers.Contract(await factory.getPool(pos.token0, pos.token1, pos.fee), ["function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)"], me);
  const readPrice = async () => {
    const [sq, tick] = await pool.slot0();
    const sp = Number(sq) / 2 ** 96;
    return { sp, tick: Number(tick), usd: 1 / (sp * sp * 10 ** (d0 - d1)) }; // token1 priced in token0 (USDC)
  };
  let px = await readPrice();
  const inRange = px.tick >= Number(pos.tickLower) && px.tick < Number(pos.tickUpper);
  console.log(`#${id} ${s0}/${s1} pool ${await pool.getAddress()} — ${s1} $${px.usd.toPrecision(5)}, in range: ${inRange}, liquidity ${pos.liquidity}`);
  if (inRange) throw new Error("position is in range; nothing to rebalance");

  // What the withdrawal returns (liquidity + fees), from a static collect after a static decrease is not
  // possible in one call, so: principal from the liquidity maths, fees from a static collect.
  const L = Number(pos.liquidity);
  const sa = sqrtAt(Number(pos.tickLower)), sb = sqrtAt(Number(pos.tickUpper));
  const c = Math.min(Math.max(px.sp, sa), sb);
  const [f0, f1] = await npm.collect.staticCall([id, me.address, MAX128, MAX128]);
  const have0 = (L * (sb - c)) / (c * sb) / 10 ** d0 + fmt(f0, d0);
  const have1 = (L * (c - sa)) / 10 ** d1 + fmt(f1, d1);

  // New band: ±W around the current price, snapped outward to the tick spacing.
  const tickOf = (usd) => Math.log((1 / usd) / 10 ** (d0 - d1)) / Math.log(1.0001);
  const lo = Math.floor(tickOf(px.usd * (1 + W)) / SPACING) * SPACING; // higher price -> lower tick
  const hi = Math.ceil(tickOf(px.usd * (1 - W)) / SPACING) * SPACING;
  // token0 per token1 needed by that band at the current price (per unit liquidity).
  const nla = sqrtAt(lo), nlb = sqrtAt(hi);
  const per0 = (nlb - px.sp) / (px.sp * nlb) / 10 ** d0, per1 = (px.sp - nla) / 10 ** d1;
  const R = per0 / per1; // USDC needed per ARGUS

  // Quote the sale to size it: sell x so (have0 + x*q) / (have1 - x) = R.
  const q0 = await quote(pos.token1, ethers.parseUnits("100", d1), d1);
  const x = (R * have1 - have0) / (q0 + R);
  if (!(x > 0 && x < have1)) throw new Error(`nothing sensible to sell (x=${x})`);
  const sellRaw = ethers.parseUnits(x.toFixed(6), d1);
  const q = await quote(pos.token1, sellRaw, d1);
  console.log(`withdraw ≈ ${have0.toFixed(4)} ${s0} + ${have1.toFixed(4)} ${s1} (incl. fees)`);
  console.log(`new band ±${W * 100}%: ticks [${lo}, ${hi}] = $${(1 / (sqrtAt(hi) ** 2) / 10 ** (d0 - d1)).toPrecision(4)}–$${(1 / (sqrtAt(lo) ** 2) / 10 ** (d0 - d1)).toPrecision(4)} per ${s1}`);
  console.log(`sell ${x.toFixed(4)} ${s1} on KyberSwap at ~$${q.toPrecision(5)} -> ~${(x * q).toFixed(4)} USDC${isMirror ? "" : ` (then wrap to ${s0})`}`);
  console.log(`mint ≈ ${(have0 + x * q).toFixed(4)} ${s0} + ${(have1 - x).toFixed(4)} ${s1} ≈ $${(have0 + x * q + (have1 - x) * px.usd).toFixed(2)}`);
  if (Math.abs(q / px.usd - 1) > 0.25) throw new Error(`Kyber price $${q} is >25% from the pool's $${px.usd}; refusing`);
  if (!execute) return console.log("dry run — set EXECUTE=1 to rebalance");

  const deadline = Math.floor(Date.now() / 1000) + 1200;
  const wait = async (label, p) => { const tx = await p; console.log(`${label} ${tx.hash}`); const rc = await tx.wait(); if (rc.status !== 1) throw new Error(`${label} reverted`); };

  // 1. withdraw everything.
  await wait("decrease", npm.decreaseLiquidity([id, pos.liquidity, 0, 0, deadline]));
  await wait("collect", npm.collect([id, me.address, MAX128, MAX128]));

  // 2. sell x of token1 through KyberSwap (approve first, then route + build + send at once).
  if ((await t1.allowance(me.address, ROUTER)) < sellRaw) await wait("approve-router", t1.approve(ROUTER, sellRaw));
  const usdcBefore = await ethers.provider.getBalance(me.address);
  const rs = await route(pos.token1, sellRaw);
  const minOut = (BigInt(rs.amountOut) * 97n) / 100n;
  const b = await (await fetch(`${API}/route/build`, { method: "POST", headers: HEADERS, body: JSON.stringify({ routeSummary: rs, sender: me.address, recipient: me.address, slippageTolerance: 100 }) })).json();
  if (!b?.data?.data || ethers.getAddress(b.data.routerAddress) !== ROUTER) throw new Error(`bad build: ${JSON.stringify(b).slice(0, 200)}`);
  if (BigInt(b.data.amountOut) < minOut) throw new Error("built route under the quote's 97%");
  await wait("swap", me.sendTransaction({ to: ROUTER, data: b.data.data, value: 0n }));

  // 3. the USDC side for the pool: the mirror as-is, or wrap the swap proceeds.
  if (!isMirror) {
    const received = (await ethers.provider.getBalance(me.address)) - usdcBefore; // native, 18 dec, net of gas
    const wrapAmt = BigInt(rs.amountOut) * 10n ** 12n; // the quoted proceeds, 6 -> 18 dec
    if (received <= 0n) console.log("note: native delta after gas is not positive; wrapping the quoted proceeds from balance");
    const w = new ethers.Contract(pos.token0, ["function deposit() payable"], me);
    await wait("wrap", w.deposit({ value: wrapAmt }));
  }

  // 4. mint the new band at the price as it is now (the swap may have moved it).
  px = await readPrice();
  const bal0 = await t0.balanceOf(me.address), bal1 = await t1.balanceOf(me.address);
  const want0 = ethers.parseUnits((have0 + x * q).toFixed(d0 > 6 ? 6 : d0), d0);
  const want1 = ethers.parseUnits((have1 - x).toFixed(6), d1);
  const a0 = want0 < bal0 ? want0 : bal0, a1 = want1 < bal1 ? want1 : bal1;
  for (const [t, a] of [[t0, a0], [t1, a1]]) if ((await t.allowance(me.address, NPM)) < a) await wait("approve-npm", t.approve(NPM, a));
  const tx = await npm.mint([pos.token0, pos.token1, pos.fee, lo, hi, a0, a1, 0, 0, me.address, deadline]);
  console.log(`mint ${tx.hash}`);
  const rc = await tx.wait();
  const ev = rc.logs.map((l) => { try { return npm.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "IncreaseLiquidity");
  console.log(`status ${rc.status}; new position minted at $${px.usd.toPrecision(5)}${ev ? ` — tokenId ${ev.args.tokenId}` : ""}`);
}

async function route(tokenIn, amountIn) {
  const qs = new URLSearchParams({ tokenIn, tokenOut: USDC_MIRROR, amountIn: amountIn.toString() });
  const r = await (await fetch(`${API}/routes?${qs}`, { headers: HEADERS })).json();
  if (!r?.data?.routeSummary) throw new Error(`no route: ${JSON.stringify(r).slice(0, 200)}`);
  return r.data.routeSummary;
}
async function quote(tokenIn, amountIn, dec) {
  const rs = await route(tokenIn, amountIn);
  return Number(rs.amountOut) / 1e6 / fmt(amountIn, dec);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
