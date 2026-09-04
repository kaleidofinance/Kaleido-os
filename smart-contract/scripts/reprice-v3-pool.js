/**
 * Move an initialised V3 pool's price back to a stated one, and cost it first.
 *
 *   PAIR=kld/usdc FEE=3000 STABLE_USD="kld=0.03,usdc=1" \
 *   npx hardhat run scripts/reprice-v3-pool.js --network robinhoodTestnet
 *
 * Read-only unless EXECUTE=1. The default run prints the plan and stops, because
 * every line of it is a claim about someone else's liquidity.
 *
 * ── Why a script and not a swap ────────────────────────────────────────────
 *
 * seed-v3-pool.js opens a pool and mints into it, and for an existing pool it
 * centres the new position on the LIVE tick — correct, and useless here. The two
 * pools this was written for:
 *
 *   - Robinhood Chain Testnet KLD/USDC 0.30%: tick 887271, sqrtPriceX96 one below
 *     MAX_SQRT_RATIO, holding 0.019 KLD and 116.99 USDC. Someone minted a position
 *     across ticks -254340..-252360 — KLD at $9.01 to $10.98, three hundred times
 *     what it is worth — and a buy walked the price up through the whole band and
 *     out to the ceiling, because a V3 swap that exhausts its path clamps instead
 *     of reverting. Seeding it again would centre a band on 3.4e50.
 *   - BSC Testnet KLD/USDC 0.05%: empty, initialised at $4.00, 133x the real
 *     price. Minting a band around $0.03 there would open it entirely out of
 *     range and the pool would keep quoting $4.00.
 *
 * A pool can only be initialised once, so the price has to be moved rather than
 * set, and moving it means a swap whose sqrtPriceLimitX96 IS the target: such a
 * swap stops at a price instead of at an amount.
 *
 * On the pool that is nearly free when the region is empty — computeSwapStep with
 * no liquidity consumes no input and walks sqrtPriceX96 straight to the limit. It
 * is not reachable through SwapRouter, which is the thing this script had to learn
 * by being reverted. SwapRouter's callback opens with
 *
 *     require(amount0Delta > 0 || amount1Delta > 0);
 *
 * commented in Uniswap's own source as "swaps entirely within 0-liquidity regions
 * are not supported". A swap that consumes nothing has no delta to pay, so it
 * reverts in the callback — and consuming nothing is exactly what repricing an
 * empty pool does. Reaching pool.swap directly needs a contract to receive that
 * callback and none is deployed here, so an empty pool is handled the other way
 * round: mint a small full-range position at the current wrong price first, and
 * the swap's opening segment pays a nonzero delta before walking the rest for
 * free. Full range because its span already covers the target, and because a
 * full-range position is 50/50 by value at whatever the price happens to be, so
 * the reprice rebalances it instead of stranding it out of range. The refusal
 * prints that recipe.
 *
 * ── What it checks ─────────────────────────────────────────────────────────
 *
 * The tick bitmap, word by word, from the current tick to the target, and then it
 * walks those ticks the way the pool would in order to price the move. Two gates:
 *
 *   - Cost. Anything above zero needs MAX_IN, a ceiling in whole tokens of the side
 *     going in. Gating instead on "is someone else's position in the path" was the
 *     first version and it had a hole: a full-range position of my own has its
 *     ticks at ±887220, outside every path, so a swap spending hundreds of tokens
 *     against it would have found the path empty and sent itself. When a withdrawal
 *     is part of the plan the ceiling is checked twice — once against the path as
 *     found, and again against a fresh quote taken after the withdrawal, since that
 *     second number is the only one the swap will actually pay. On BSC the two were
 *     289,071 KLD and 0.51 KLD, so gating on the first would have refused a move
 *     that cost half a token.
 *   - Ownership. Positions of mine in the path are traded through, which is a wash
 *     — I am the LP on both sides of it — or pulled out first: WITHDRAW=1 for every
 *     position of mine overlapping the path, or WITHDRAW=<id,id> for a named subset.
 *     The subset is not a nicety. Pulling all of them can empty the path, and an
 *     empty path is precisely what the router refuses (above), so leaving one small
 *     position in is what keeps the swap sendable at all.
 *     An earlier version refused this case outright, which was incoherent once the
 *     empty-pool recipe above turned "swap through my own liquidity" into the
 *     intended path rather than the accident. MAX_IN is the gate that matters.
 *     Positions that are not mine are not mine to move, so the price there can only
 *     be *traded* back, and the run reports it as the trade it is. That is the
 *     Robinhood case: ~11.9 KLD in for ~117 USDC out, cheap only because the
 *     position is mispriced by 300x. Arbitraging it back is the mechanism V3
 *     expects, but it is still a stranger's money, so it happens because a number
 *     was typed and not because a script decided.
 *
 * SCAN_OWNERS=1 names the owners, which costs one read per minted position and
 * changes nothing about what must happen — only what can honestly be said about it.
 *
 * ── The price is stated, never guessed ─────────────────────────────────────
 *
 * Same rule as seed-v3-pool.js and the same STABLE_USD override, for the same
 * reason: KLD has no feed before TGE, so the operator states its price and the
 * script logs that it was stated. A pair it cannot price refuses. What it will
 * not do is derive a target from the pool's own tick, which is the number under
 * repair.
 *
 * Afterwards, run seed-v3-pool.js on the same pair to mint depth at the new
 * price — it reads the live tick, which by then is the right one.
 */

const hre = require("hardhat");
const { ethers } = hre;

const { registryFor } = require("./libraries/registry.js");
const {
  MIN_TICK,
  MAX_TICK,
  encodeSqrtRatioX96,
  sqrtRatioAtTick,
  tickAtSqrtRatio,
} = require("./libraries/tick-math.js");

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

const FACTORY_ABI = [
  "function getPool(address,address,uint24) view returns (address)",
  "function feeAmountTickSpacing(uint24) view returns (int24)",
];

const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function tickSpacing() view returns (int24)",
  "function tickBitmap(int16) view returns (uint256)",
  "function ticks(int24) view returns (uint128 liquidityGross, int128 liquidityNet, uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128, int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128, uint32 secondsOutside, bool initialized)",
];

const NPM_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function tokenOfOwnerByIndex(address,uint256) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function tokenByIndex(uint256) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function positions(uint256) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function decreaseLiquidity(tuple(uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline) params) payable returns (uint256 amount0, uint256 amount1)",
  "function collect(tuple(uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) payable returns (uint256 amount0, uint256 amount1)",
];

const ROUTER_ABI = [
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
];

/** Uniswap's own bounds on sqrtPriceX96, which `swap` requires the limit inside. */
const MIN_SQRT_RATIO = 4295128739n;
const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;

const UINT128_MAX = (1n << 128n) - 1n;

/**
 * STABLE_USD, parsed exactly as seed-v3-pool.js parses it.
 *
 *   STABLE_USD="kld=0.03,usdc=1"
 *
 * An operator stating a price is a different act from a script assuming one, so
 * every line that uses one says it was stated. A pair with an un-named side still
 * refuses.
 */
function parsePriceOverrides(spec) {
  const out = new Map();
  if (!spec) return out;
  for (const part of spec.split(",")) {
    if (!part.trim()) continue;
    const eq = part.indexOf("=");
    if (eq < 0)
      throw new Error(`STABLE_USD entry "${part}" is not symbol=price`);
    const sym = part.slice(0, eq).trim().toLowerCase();
    const val = part.slice(eq + 1).trim();
    if (!sym) throw new Error(`STABLE_USD entry "${part}" has no symbol`);
    let usd;
    try {
      usd = ethers.parseUnits(val, 18);
    } catch {
      throw new Error(`STABLE_USD ${sym}: price "${val}" is not a number`);
    }
    if (usd <= 0n) throw new Error(`STABLE_USD ${sym}: price must be > 0`);
    out.set(sym, usd);
  }
  return out;
}

const PRICE_OVERRIDES = parsePriceOverrides(process.env.STABLE_USD);

const PROTOCOL_ABI = [
  "function getUsdValue(address,uint256,uint8) view returns (uint256)",
];

/** The operator's stated price, else the diamond's. No default. */
async function priceOf(protocol, address, symbol, decimals) {
  const override = PRICE_OVERRIDES.get(symbol.toLowerCase());
  if (override !== undefined)
    return {
      usd: override,
      source: `operator override $${ethers.formatUnits(override, 18)}`,
    };
  try {
    const usd = await protocol.getUsdValue(
      address,
      10n ** BigInt(decimals),
      decimals,
    );
    if (usd > 0n) return { usd, source: "diamond oracle" };
  } catch {
    /* No feed registered for this token on this chain. */
  }
  throw new Error(
    `${symbol}: the diamond cannot price it and STABLE_USD does not name it — state a price or this run would be inventing one`,
  );
}

/**
 * Every initialised tick between two ticks, from the bitmap.
 *
 * Read rather than inferred from `liquidity()`, which reports only the tick the
 * price is currently in. A pool can read zero there and still hold every dollar
 * it has ever been given, in a range the price has left — which is exactly the
 * state that makes this whole script necessary.
 *
 * The bitmap is indexed by tick/spacing packed 256 to a word, so this is one
 * eth_call per 256 usable ticks. Both ends inclusive.
 */
async function initialisedTicksBetween(pool, spacing, tickA, tickB) {
  const lo = Math.min(tickA, tickB);
  const hi = Math.max(tickA, tickB);
  const compressedLo = Math.floor(lo / spacing);
  const compressedHi = Math.floor(hi / spacing);
  const wordLo = compressedLo >> 8;
  const wordHi = compressedHi >> 8;

  /* Batched, because a full-range path is 70-odd words and Robinhood's RPC gave up
     partway through the sequential version with a headers timeout. The words are
     independent reads, so the only reason to serialise them was that it was easier
     to write; the batch is kept modest because two of these endpoints answer a rate
     limit with HTTP 200 and a JSON-RPC error body, which surfaces as a decode
     failure rather than as anything that says "slow down". */
  const BATCH = 12;
  const words = [];
  for (let word = wordLo; word <= wordHi; word++) words.push(word);
  const bitmaps = [];
  for (let i = 0; i < words.length; i += BATCH)
    bitmaps.push(
      ...(await Promise.all(
        words.slice(i, i + BATCH).map(async (w) => ({
          word: w,
          bits: BigInt(await pool.tickBitmap(w)),
        })),
      )),
    );

  const candidates = [];
  for (const { word, bits } of bitmaps) {
    if (bits === 0n) continue;
    for (let bit = 0; bit < 256; bit++) {
      if (((bits >> BigInt(bit)) & 1n) === 0n) continue;
      const tick = ((word << 8) + bit) * spacing;
      if (tick < lo || tick > hi) continue;
      candidates.push(tick);
    }
  }

  const found = [];
  for (let i = 0; i < candidates.length; i += BATCH)
    found.push(
      ...(await Promise.all(
        candidates.slice(i, i + BATCH).map(async (tick) => {
          const t = await pool.ticks(tick);
          return {
            tick,
            liquidityGross: BigInt(t.liquidityGross),
            liquidityNet: BigInt(t.liquidityNet),
          };
        }),
      )),
    );
  return found.sort((a, b) => a.tick - b.tick);
}

/**
 * Uniswap's getAmount0Delta / getAmount1Delta between two sqrt prices.
 *
 * BigInt, and token0 rounds up, because these decide how much to send: a float
 * here would be a few wei short at the far end of the range and the swap would
 * stop just before the target, which reads exactly like "the path was not empty"
 * and would send me looking for liquidity that was never there.
 */
const Q96 = 1n << 96n;
const amount0Between = (sqrtLo, sqrtHi, L) => {
  const denom = sqrtHi * sqrtLo;
  return ((L << 96n) * (sqrtHi - sqrtLo) + denom - 1n) / denom;
};
const amount1Between = (sqrtLo, sqrtHi, L) => (L * (sqrtHi - sqrtLo)) / Q96;

/**
 * What a swap to the target would cost, by walking the ticks the pool would walk.
 *
 * Uniswap's own loop, minus the parts that only matter on chain: for each segment
 * between initialised ticks it takes the curve's two deltas, then crosses the tick
 * by applying liquidityNet in the direction of travel (negated going down, which
 * is what `swap` does). Written because the alternative is guessing an input and
 * letting the limit stop the swap — and a guess that is too generous is a blank
 * cheque against liquidity nobody has looked at.
 *
 * Returns the input grossed up by the fee, since the pool takes its cut before the
 * curve sees the money.
 */
function simulateToTarget({
  startSqrt,
  targetSqrt,
  startLiquidity,
  ticks,
  zeroForOne,
  fee,
}) {
  const ordered = [...ticks].sort((a, b) =>
    zeroForOne ? b.tick - a.tick : a.tick - b.tick,
  );
  let liquidity = startLiquidity;
  let sqrtCur = startSqrt;
  let amountIn = 0n;
  let amountOut = 0n;
  const crossed = [];

  const step = (from, to) => {
    const [lo, hi] = from < to ? [from, to] : [to, from];
    if (liquidity <= 0n || lo === hi) return;
    const a0 = amount0Between(lo, hi, liquidity);
    const a1 = amount1Between(lo, hi, liquidity);
    amountIn += zeroForOne ? a0 : a1;
    amountOut += zeroForOne ? a1 : a0;
  };

  for (const t of ordered) {
    const sqrtNext = sqrtRatioAtTick(t.tick);
    /* Behind us, or past where we are going: neither is crossed. */
    if (zeroForOne ? sqrtNext >= sqrtCur : sqrtNext <= sqrtCur) continue;
    if (zeroForOne ? sqrtNext <= targetSqrt : sqrtNext >= targetSqrt) break;
    step(sqrtCur, sqrtNext);
    liquidity += zeroForOne ? -t.liquidityNet : t.liquidityNet;
    crossed.push(t.tick);
    sqrtCur = sqrtNext;
  }
  step(sqrtCur, targetSqrt);

  const grossed =
    amountIn === 0n
      ? 0n
      : (amountIn * 1_000_000n) / (1_000_000n - BigInt(fee)) + 1n;
  return { amountIn: grossed, amountOut, crossed };
}

/**
 * Who owns the positions whose range covers a tick in the path.
 *
 * Behind SCAN_OWNERS because it is one call per minted position on the chain and
 * the answer changes nothing about what has to happen — the price cannot reach the
 * target without going through them either way. It changes what I can honestly
 * say about it, which is worth one slow read: "a stranger mispriced this" and "one
 * of our own scripts did" are the same tick and different problems.
 */
async function ownersOfPositionsAt(npm, ticks, a0, a1, fee, cap) {
  const total = Number(await npm.totalSupply());
  const scanned = Math.min(total, cap);
  const wanted = new Set(ticks.map((t) => t.tick));
  const out = [];
  /* Newest first, and the cap truncates the oldest. A position I am asking about
     is one that broke something recently, so mint order is a decent prior and
     scanning from index 0 would spend the whole budget on the chain's history. */
  for (let i = total - 1; i >= total - scanned; i--) {
    let id;
    try {
      id = await npm.tokenByIndex(i);
    } catch {
      continue; /* burned */
    }
    const pos = await npm.positions(id);
    if (
      pos.token0.toLowerCase() !== a0.toLowerCase() ||
      pos.token1.toLowerCase() !== a1.toLowerCase() ||
      Number(pos.fee) !== fee
    )
      continue;
    if (
      !wanted.has(Number(pos.tickLower)) &&
      !wanted.has(Number(pos.tickUpper))
    )
      continue;
    out.push({
      id,
      owner: await npm.ownerOf(id),
      tickLower: Number(pos.tickLower),
      tickUpper: Number(pos.tickUpper),
      liquidity: BigInt(pos.liquidity),
    });
  }
  return { positions: out, scanned, total };
}

const num = (v, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

/** token1 per token0 in human units, from a tick. Mirrors src tickToPrice. */
const humanPrice = (tick, d0, d1) =>
  Math.pow(1.0001, tick) * Math.pow(10, d0 - d1);

async function main() {
  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const reg = registryFor(chainId);

  const pair = (process.env.PAIR ?? "kld/usdc").toLowerCase();
  const [keyA, keyB] = pair.split("/");
  const fee = num(process.env.FEE, 3000);
  const execute = process.env.EXECUTE === "1";
  /* WITHDRAW is either "1" — every position of mine that overlaps the path — or a
     comma-separated list of token ids. The list exists because pulling all of them
     out can leave the pool with no liquidity at all, and the router refuses a swap
     that consumes nothing (see the zero-delta note further down); keeping one small
     position in is what makes the move payable at all. */
  const withdrawEnv = (process.env.WITHDRAW ?? "").trim();
  const withdrawAll = withdrawEnv === "1";
  const withdrawIds = withdrawAll
    ? null
    : withdrawEnv
      ? withdrawEnv
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  const withdraw = withdrawAll || (withdrawIds?.length ?? 0) > 0;

  if (!reg[keyA] || !reg[keyB])
    throw new Error(
      `chain ${chainId} has no address for ${!reg[keyA] ? keyA : keyB}`,
    );
  if (!reg.v3Factory || !reg.v3Router || !reg.v3PositionManager)
    throw new Error(`chain ${chainId} has no V3 factory, router or manager`);

  /* Address order, not the order they were named: getting this backwards inverts
     the price and would move the pool the wrong way. */
  const [a0, a1] =
    reg[keyA].toLowerCase() < reg[keyB].toLowerCase()
      ? [reg[keyA], reg[keyB]]
      : [reg[keyB], reg[keyA]];
  const t0 = new ethers.Contract(a0, ERC20_ABI, signer);
  const t1 = new ethers.Contract(a1, ERC20_ABI, signer);
  const [s0, d0, s1, d1] = [
    await t0.symbol(),
    Number(await t0.decimals()),
    await t1.symbol(),
    Number(await t1.decimals()),
  ];

  console.log(`\n=== ${hre.network.name}: ${s0}/${s1} @ ${fee} ===`);
  console.log(`token0 ${s0} d=${d0} ${a0}`);
  console.log(`token1 ${s1} d=${d1} ${a1}`);
  console.log(`signer ${me}`);
  console.log(
    execute ? "MODE execute" : "MODE read-only (set EXECUTE=1 to send)",
  );

  const factory = new ethers.Contract(reg.v3Factory, FACTORY_ABI, signer);
  const poolAddress = await factory.getPool(a0, a1, fee);
  if (poolAddress === ethers.ZeroAddress)
    throw new Error(
      `no ${s0}/${s1} pool at ${fee} on this chain — that is seed-v3-pool.js's job, not this one`,
    );
  const pool = new ethers.Contract(poolAddress, POOL_ABI, signer);
  const spacing = Number(await pool.tickSpacing());

  const before = await pool.slot0();
  const beforeTick = Number(before.tick);
  const beforeSqrt = BigInt(before.sqrtPriceX96);
  const inRangeLiquidity = BigInt(await pool.liquidity());
  const [bal0, bal1] = [
    await t0.balanceOf(poolAddress),
    await t1.balanceOf(poolAddress),
  ];

  console.log(`\npool ${poolAddress}  spacing ${spacing}`);
  console.log(
    `now  tick ${beforeTick}  sqrtPriceX96 ${beforeSqrt}  ${humanPrice(
      beforeTick,
      d0,
      d1,
    )} ${s1} per ${s0}`,
  );
  console.log(
    `     in-range liquidity ${inRangeLiquidity}  holds ${ethers.formatUnits(
      bal0,
      d0,
    )} ${s0} + ${ethers.formatUnits(bal1, d1)} ${s1}`,
  );
  if (beforeSqrt === MAX_SQRT_RATIO - 1n || beforeSqrt === MIN_SQRT_RATIO + 1n)
    console.log(
      "     ^ this is the clamp a swap stops at, not a price anyone traded at",
    );

  const [my0, my1] = [await t0.balanceOf(me), await t1.balanceOf(me)];
  console.log(
    `mine ${ethers.formatUnits(my0, d0)} ${s0} + ${ethers.formatUnits(
      my1,
      d1,
    )} ${s1}`,
  );

  /* ---- the target, stated ---- */
  if (!reg.diamond && PRICE_OVERRIDES.size < 2)
    throw new Error(`chain ${chainId} has no diamond to price a side with`);
  const protocol = reg.diamond
    ? new ethers.Contract(reg.diamond, PROTOCOL_ABI, ethers.provider)
    : null;
  const p0 = await priceOf(protocol, a0, s0, d0);
  const p1 = await priceOf(protocol, a1, s1, d1);
  console.log(
    `\nprice: 1 ${s0} = $${ethers.formatUnits(p0.usd, 18)}  [${p0.source}]`,
  );
  console.log(
    `price: 1 ${s1} = $${ethers.formatUnits(p1.usd, 18)}  [${p1.source}]`,
  );

  /* One dollar of each side, in raw units: their ratio IS the target price, with
     no rounding through a float. */
  const unit = ethers.parseUnits("1", 18);
  const amount0 = (unit * 10n ** BigInt(d0)) / p0.usd;
  const amount1 = (unit * 10n ** BigInt(d1)) / p1.usd;
  const targetSqrt = encodeSqrtRatioX96(amount1, amount0);
  const targetTick = tickAtSqrtRatio(targetSqrt, sqrtRatioAtTick);
  console.log(
    `target tick ${targetTick}  sqrtPriceX96 ${targetSqrt}  ${humanPrice(
      targetTick,
      d0,
      d1,
    )} ${s1} per ${s0}`,
  );

  if (targetTick === beforeTick) {
    console.log("\nalready there; nothing to do");
    return;
  }
  /* Down means selling token0. The direction is derived from the two ticks and
     never from which token reads as "the volatile one". */
  const zeroForOne = targetSqrt < beforeSqrt;
  console.log(
    `direction ${zeroForOne ? `${s0} in, price down` : `${s1} in, price up`}`,
  );

  /* ---- is the path empty? ---- */
  const inPath = (
    await initialisedTicksBetween(pool, spacing, beforeTick, targetTick)
  ).filter((t) => t.tick !== beforeTick && t.tick !== targetTick);
  console.log(
    `\ninitialised ticks strictly between: ${
      inPath.length === 0 ? "none" : inPath.length
    }`,
  );
  for (const t of inPath)
    console.log(
      `  tick ${t.tick} (${humanPrice(t.tick, d0, d1)} ${s1}/${s0})  gross ${
        t.liquidityGross
      }  net ${t.liquidityNet}`,
    );

  /* ---- whose liquidity is it? ---- */
  const npm = new ethers.Contract(reg.v3PositionManager, NPM_ABI, signer);
  const mine = [];
  const count = Number(await npm.balanceOf(me));
  for (let i = 0; i < count; i++) {
    const id = await npm.tokenOfOwnerByIndex(me, i);
    const pos = await npm.positions(id);
    if (
      pos.token0.toLowerCase() !== a0.toLowerCase() ||
      pos.token1.toLowerCase() !== a1.toLowerCase() ||
      Number(pos.fee) !== fee
    )
      continue;
    mine.push({
      id,
      tickLower: Number(pos.tickLower),
      tickUpper: Number(pos.tickUpper),
      liquidity: BigInt(pos.liquidity),
      owed0: BigInt(pos.tokensOwed0),
      owed1: BigInt(pos.tokensOwed1),
    });
  }
  console.log(`\nmy positions in this pool: ${mine.length}`);
  for (const p of mine)
    console.log(
      `  #${p.id} [${p.tickLower}, ${p.tickUpper}] liquidity ${
        p.liquidity
      } owed ${ethers.formatUnits(p.owed0, d0)} ${s0} / ${ethers.formatUnits(
        p.owed1,
        d1,
      )} ${s1}`,
    );

  /* A tick is in the way if some position's range covers the path. Matching by
     range rather than by the bitmap's ticks, because one position contributes two
     bitmap entries and only one of them may fall in the window. */
  const lowPath = Math.min(beforeTick, targetTick);
  const highPath = Math.max(beforeTick, targetTick);
  const blocking = inPath.filter(
    (t) => !mine.some((p) => p.tickLower === t.tick || p.tickUpper === t.tick),
  );
  const minePathed = mine.filter(
    (p) => p.liquidity > 0n && p.tickLower < highPath && p.tickUpper > lowPath,
  );
  /* Which of those WITHDRAW actually names. An id that matches nothing is an error
     rather than an empty selection: read as "nothing to withdraw", a typo would go
     on to swap against the very liquidity it was told to pull out first. */
  if (!withdrawAll)
    for (const id of withdrawIds)
      if (!minePathed.some((p) => String(p.id) === id))
        throw new Error(
          `WITHDRAW names #${id}, which is not a funded position of mine overlapping the path`,
        );
  const toWithdraw = withdrawAll
    ? minePathed
    : minePathed.filter((p) => withdrawIds.includes(String(p.id)));

  /* What this actually costs. An empty path costs one wei and the swap is free; a
     path with liquidity in it is a real trade, and the figure below is what makes
     sending it a decision instead of a hope. */
  const tokenInSym = zeroForOne ? s0 : s1;
  const tokenOutSym = zeroForOne ? s1 : s0;
  const dIn = zeroForOne ? d0 : d1;
  const dOut = zeroForOne ? d1 : d0;
  const usdIn = zeroForOne ? p0.usd : p1.usd;
  const usdOut = zeroForOne ? p1.usd : p0.usd;

  const quote = simulateToTarget({
    startSqrt: beforeSqrt,
    targetSqrt,
    startLiquidity: inRangeLiquidity,
    /* Everything in the path, mine included. Withdrawing mine first can only make
       the trade smaller, so this stands as an upper bound either way. */
    ticks: inPath,
    zeroForOne,
    fee,
  });
  /* A hair over the curve's own answer, because its last wei is a rounding
     argument and stopping one wei short of the target is indistinguishable from
     finding liquidity that was never there. The margin is free: the pool's
     callback asks for what it consumed, so input the limit stopped us from
     spending is never transferred. */
  const send = quote.amountIn === 0n ? 1n : (quote.amountIn * 101n) / 100n + 1n;
  const asUsd = (raw, dec, usd) =>
    Number(ethers.formatUnits((raw * usd) / 10n ** BigInt(dec), 18));

  if (quote.amountIn > 0n) {
    console.log(
      `\ncost ${ethers.formatUnits(
        quote.amountIn,
        dIn,
      )} ${tokenInSym} in ($${asUsd(quote.amountIn, dIn, usdIn).toFixed(
        2,
      )}) for ${ethers.formatUnits(
        quote.amountOut,
        dOut,
      )} ${tokenOutSym} out ($${asUsd(quote.amountOut, dOut, usdOut).toFixed(
        2,
      )})`,
    );
    console.log(
      `     crossing ${
        quote.crossed.length
      } tick(s); sending ${ethers.formatUnits(
        send,
        dIn,
      )} ${tokenInSym} so the limit binds before the input runs out`,
    );
  }

  /* The ceiling on what may be spent, stated in whole tokens of whichever side is
     going in. There is deliberately no default: the whole point is that a trade
     through someone else's liquidity is authorised by a number a person typed. */
  const maxIn = process.env.MAX_IN
    ? ethers.parseUnits(process.env.MAX_IN, dIn)
    : null;

  if (blocking.length > 0) {
    console.log(
      `\n${blocking.length} initialised tick(s) in the path belong to no position of mine:`,
    );
    if (process.env.SCAN_OWNERS === "1") {
      const { positions, scanned, total } = await ownersOfPositionsAt(
        npm,
        blocking,
        a0,
        a1,
        fee,
        num(process.env.SCAN_CAP, 400),
      );
      for (const p of positions)
        console.log(
          `  #${p.id} [${p.tickLower}, ${p.tickUpper}] liquidity ${p.liquidity} owner ${p.owner}`,
        );
      if (positions.length === 0) console.log("  none matched");
      console.log(`  (scanned ${scanned} of ${total} minted positions)`);
    } else {
      console.log(
        "  set SCAN_OWNERS=1 to name their owners — one read per minted position on this chain",
      );
    }
  }

  /* Anything this costs needs a ceiling a person typed, and the trigger is the
     cost rather than whose liquidity it crosses. Gating on "someone else's
     position is in the path" was the first version and it had a hole: in-range
     liquidity of my own sits at no tick inside the path at all — a full-range
     position's ticks are at ±887220 — so a swap that spent hundreds of tokens
     against it would have found `blocking` empty and sent itself. */
  if (quote.amountIn > 0n && withdraw && toWithdraw.length > 0) {
    /* The figure above is the path as it stands, and the withdrawal below changes
       it. Pulling my own liquidity out is a wash rather than a spend, so the number
       MAX_IN has to authorise is the one measured after it — gating on this one
       would refuse a cheap move on account of liquidity that is about to be gone. */
    console.log(
      `\nthat is the path before withdrawing ${toWithdraw.length} position(s) of mine; MAX_IN is checked again on a fresh quote once they are out`,
    );
  } else if (quote.amountIn > 0n) {
    if (maxIn === null) {
      console.log(
        `\nREFUSING: this is a trade, not a free move — ${ethers.formatUnits(
          send,
          dIn,
        )} ${tokenInSym} for ${ethers.formatUnits(
          quote.amountOut,
          dOut,
        )} ${tokenOutSym}.`,
      );
      if (blocking.length > 0)
        console.log(
          "  The price cannot reach the target without going through liquidity that is not mine.",
        );
      console.log(
        `  Authorise it with MAX_IN=<${tokenInSym}>, the ceiling on what I may spend.`,
      );
      process.exitCode = 1;
      return;
    }
    if (send > maxIn) {
      console.log(
        `\nREFUSING: the trade needs ${ethers.formatUnits(
          send,
          dIn,
        )} ${tokenInSym} and MAX_IN is ${ethers.formatUnits(maxIn, dIn)}.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `\nauthorised: MAX_IN ${ethers.formatUnits(
        maxIn,
        dIn,
      )} ${tokenInSym} covers it`,
    );
  } else {
    /* The free move is real on the pool and unreachable through the router.
       SwapRouter's callback opens with
         require(amount0Delta > 0 || amount1Delta > 0);
       commented in Uniswap's own source as "swaps entirely within 0-liquidity
       regions are not supported" — so a swap that consumes nothing reverts in the
       callback, which is what an empty pool's reprice is by definition. Calling
       pool.swap directly needs a contract to receive that callback, and there is
       no such contract deployed here.

       The way through is to give the swap something to consume: mint a small
       position at the pool's current (wrong) price, and the first segment of the
       swap pays a nonzero delta, after which it walks the empty region to the
       limit for free. A full-range position is the one to use — its span already
       covers the target, and a full-range position is 50/50 by value at whatever
       the price happens to be, so repricing rebalances it instead of stranding
       it. */
    console.log(
      "\nREFUSING: the path is empty, so this swap would consume nothing — and",
    );
    console.log(
      "  SwapRouter's callback rejects a swap with no delta on both sides",
    );
    console.log(
      '  ("swaps entirely within 0-liquidity regions are not supported").',
    );
    console.log("  Give it something to consume first:");
    console.log(
      `    PAIR=${pair} FEE=${fee} USD=2 STABLE_USD="${
        process.env.STABLE_USD ?? ""
      }" npx hardhat run scripts/seed-v3-pool.js --network ${hre.network.name}`,
    );
    console.log(
      "  then run this again with MAX_IN set — the tiny position makes the move a",
    );
    console.log(
      "  cheap trade against my own liquidity, which is a wash rather than a cost.",
    );
    process.exitCode = 1;
    return;
  }

  console.log("\nplan");
  let n = 1;
  if (minePathed.length > 0)
    console.log(
      withdraw
        ? `  ${n++}. withdraw ${toWithdraw.length} of my ${minePathed.length} position(s) overlapping the path first`
        : `  ${n++}. trade through ${minePathed.length} position(s) of my own in the path — a wash, since I am the LP on both sides of it (WITHDRAW=1, or WITHDRAW=<id,id>, to pull them out instead)`,
    );
  console.log(
    withdraw && toWithdraw.length > 0
      ? `  ${n++}. swap whatever the fresh quote comes to with sqrtPriceLimitX96 ${targetSqrt}, stopping at the target`
      : `  ${n++}. swap up to ${ethers.formatUnits(
          send,
          dIn,
        )} ${tokenInSym} with sqrtPriceLimitX96 ${targetSqrt}, trading through the path and stopping at the target`,
  );
  console.log(
    `  ${n++}. then: PAIR=${pair} FEE=${fee} USD=<size> STABLE_USD="${
      process.env.STABLE_USD ?? ""
    }" npx hardhat run scripts/seed-v3-pool.js --network ${hre.network.name}`,
  );

  if (!execute) {
    console.log("\nread-only; nothing sent");
    return;
  }

  /* ---- withdraw ---- */
  let sendNow = send;
  for (const p of withdraw ? toWithdraw : []) {
    console.log(`\ndecreasing #${p.id} to zero`);
    let tx = await npm.decreaseLiquidity({
      tokenId: p.id,
      liquidity: p.liquidity,
      /* Zero floors. There is no price to slip against: the pool's own tick is
         the number being repaired, so any bound derived from it would be derived
         from the fault. Nothing here is a user's money. */
      amount0Min: 0,
      amount1Min: 0,
      deadline: Math.floor(Date.now() / 1000) + 1800,
    });
    await tx.wait();
    console.log(`  decreased (tx ${tx.hash})`);
    tx = await npm.collect({
      tokenId: p.id,
      recipient: me,
      amount0Max: UINT128_MAX,
      amount1Max: UINT128_MAX,
    });
    const rc = await tx.wait();
    console.log(`  collected (tx ${tx.hash}, gas ${rc.gasUsed})`);
  }

  if (withdraw && toWithdraw.length > 0) {
    const still = BigInt(await pool.liquidity());
    const left = await initialisedTicksBetween(
      pool,
      spacing,
      beforeTick,
      targetTick,
    );
    const stray = left.filter(
      (t) =>
        t.tick !== beforeTick && t.tick !== targetTick && t.liquidityGross > 0n,
    );
    /* Only a surprise when I asked for the path to be cleared entirely and it was
       not. A named subset leaves liquidity in the path on purpose — that is what
       the subset is for — and the re-quote below is what guards its cost. */
    if (stray.length > 0 && blocking.length === 0 && withdrawAll)
      throw new Error(
        `after withdrawing, ${stray.length} initialised tick(s) still hold liquidity in the path — stopping rather than swapping into them`,
      );
    console.log(
      `\nwithdrawn; in-range liquidity now ${still}, ${stray.length} funded tick(s) left in the path`,
    );

    /* Re-quote against the state the swap will actually meet. Withdrawing does not
       move the price, so the starting point is unchanged and only the liquidity in
       the way has to be re-read — `still` and `left` above are exactly that. */
    const fresh = simulateToTarget({
      startSqrt: beforeSqrt,
      targetSqrt,
      startLiquidity: still,
      ticks: left,
      zeroForOne,
      fee,
    });
    sendNow = fresh.amountIn === 0n ? 1n : (fresh.amountIn * 101n) / 100n + 1n;
    console.log(
      `re-quoted: ${ethers.formatUnits(
        fresh.amountIn,
        dIn,
      )} ${tokenInSym} in for ${ethers.formatUnits(
        fresh.amountOut,
        dOut,
      )} ${tokenOutSym} out`,
    );
    if (fresh.amountIn === 0n)
      throw new Error(
        "the path is empty now, and the router refuses a swap that consumes nothing — re-run with WITHDRAW=<id,id> naming all but one small position, so the swap has something to pay for on its way out",
      );
    if (maxIn === null)
      throw new Error(
        `the re-quoted trade costs ${ethers.formatUnits(
          sendNow,
          dIn,
        )} ${tokenInSym} — set MAX_IN to authorise it and run again (the withdrawal above has already landed)`,
      );
    if (sendNow > maxIn)
      throw new Error(
        `the re-quoted trade needs ${ethers.formatUnits(
          sendNow,
          dIn,
        )} ${tokenInSym} and MAX_IN is ${ethers.formatUnits(maxIn, dIn)}`,
      );
    console.log(
      `authorised: MAX_IN ${ethers.formatUnits(
        maxIn,
        dIn,
      )} ${tokenInSym} covers the re-quoted trade`,
    );
  }

  /* ---- the reprice ---- */
  const tokenIn = zeroForOne ? t0 : t1;
  const have = await tokenIn.balanceOf(me);
  if (have < sendNow)
    throw new Error(
      `need ${ethers.formatUnits(
        sendNow,
        dIn,
      )} ${tokenInSym} to send this swap and the signer holds ${ethers.formatUnits(
        have,
        dIn,
      )}`,
    );
  const allowance = await tokenIn.allowance(me, reg.v3Router);
  if (allowance < sendNow) {
    console.log(`\napproving the router for ${tokenInSym}`);
    const tx = await tokenIn.approve(reg.v3Router, ethers.MaxUint256);
    await tx.wait();
    console.log(`  approved (tx ${tx.hash})`);
  }

  /* The limit is the target itself. `swap` requires it strictly inside Uniswap's
     bounds and strictly the correct side of the current price, so a target at the
     very edge is nudged one unit inward rather than reverting with a bare
     `SPL`. */
  let limit = targetSqrt;
  if (zeroForOne && limit <= MIN_SQRT_RATIO) limit = MIN_SQRT_RATIO + 1n;
  if (!zeroForOne && limit >= MAX_SQRT_RATIO) limit = MAX_SQRT_RATIO - 1n;

  console.log(
    `\nswapping ${ethers.formatUnits(
      sendNow,
      dIn,
    )} ${tokenInSym} with sqrtPriceLimitX96 ${limit}`,
  );
  const router = new ethers.Contract(reg.v3Router, ROUTER_ABI, signer);
  const tx = await router.exactInputSingle({
    tokenIn: zeroForOne ? a0 : a1,
    tokenOut: zeroForOne ? a1 : a0,
    fee,
    recipient: me,
    deadline: Math.floor(Date.now() / 1000) + 1800,
    amountIn: sendNow,
    /* Zero, because the limit is the constraint that matters and the intended
       output is whatever the path happens to hold — nothing at all when it is
       empty. A nonzero floor here would refuse the free case outright. */
    amountOutMinimum: 0,
    sqrtPriceLimitX96: limit,
  });
  const rc = await tx.wait();
  console.log(`  sent (tx ${tx.hash}, gas ${rc.gasUsed})`);

  /* ---- did it land? ---- */
  const after = await pool.slot0();
  const afterTick = Number(after.tick);
  console.log(
    `\nafter tick ${afterTick}  sqrtPriceX96 ${BigInt(
      after.sqrtPriceX96,
    )}  ${humanPrice(afterTick, d0, d1)} ${s1} per ${s0}`,
  );
  const drift = Math.abs(afterTick - targetTick);
  if (drift > spacing)
    console.log(
      `  WARNING ${drift} ticks off target — the swap ran out of input before reaching it, which means the path was not empty after all`,
    );
  else console.log(`  within ${drift} tick(s) of target`);
  const [after0, after1] = [
    await t0.balanceOf(poolAddress),
    await t1.balanceOf(poolAddress),
  ];
  console.log(
    `  pool now holds ${ethers.formatUnits(
      after0,
      d0,
    )} ${s0} + ${ethers.formatUnits(after1, d1)} ${s1}`,
  );
  console.log(
    `\nnow mint depth:  PAIR=${pair} FEE=${fee} USD=<size> STABLE_USD="${
      process.env.STABLE_USD ?? ""
    }" npx hardhat run scripts/seed-v3-pool.js --network ${hre.network.name}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
