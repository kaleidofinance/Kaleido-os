/**
 * Create a V3 pool, price it, and mint the first liquidity into it.
 *
 *   PAIR=usdt/usde FEE=500 USD=100000 \
 *   npx hardhat run scripts/seed-v3-pool.js --network sepolia
 *
 * No script did this. deploy-v3.js deploys the factory, the router, the position
 * manager and the quoter, verifies poolInitCodeHash and stops — which leaves the
 * DEX in the one state that looks deployed and cannot trade. `getPool` returns
 * the zero address for every pair, so the quoter has nothing to quote against and
 * every swap the app or the agent builds reverts without a message a user could
 * act on. Measured before this ran: zero pools on all five testnets.
 *
 * ── The price is derived, never chosen ─────────────────────────────────────
 *
 * The initial sqrtPriceX96 sets the pool's price, and a wrong one is not a
 * cosmetic problem: it is free money for the first arbitrageur and a nonsense
 * quote for every user until someone drains it back to fair. So both sides are
 * priced off the diamond's own oracle — the same getUsdValue that the lending
 * market and the health factor read — and the ratio between those two answers is
 * the pool's opening price. Nothing here picks a number. If the oracle cannot
 * price either side, the run refuses rather than falling back to 1:1, because
 * "these are both stablecoins so call it a dollar" is exactly the assumption that
 * makes a depegged or misconfigured feed invisible.
 *
 * ── Two positions, not one ────────────────────────────────────────────────
 *
 * A full-range position and a tight one around the current tick:
 *
 *   - Full range can never fall out of range, so the pool keeps quoting no matter
 *     which way the price moves. It is the floor under every swap.
 *   - The tight band is where the depth actually comes from. The same capital
 *     concentrated into ±2% gives a stable pair a quote with a sane price impact
 *     instead of the near-zero depth a full-range stable position has.
 *
 * They also give the two position-management verbs something real to act on:
 * `collectFees` and `removePosition` both need a token id that exists and holds
 * liquidity, and until now there was no position on any chain to test them
 * against.
 *
 * ── Decimals are read, not assumed ────────────────────────────────────────
 *
 * USDT is 6 decimals and USDe is 18 on every chain here, so the raw price ratio
 * between them is 1e12 rather than 1 and the current tick is around 276,320
 * rather than 0. A script that assumed 18 everywhere would initialise the pool a
 * factor of a trillion away from fair and mint its liquidity into a range the
 * price is nowhere near. Every decimal below comes from the token's own
 * `decimals()`.
 *
 * Writes deployment-pool-<network>-<t0>-<t1>-<fee>.json.
 */

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

const { registryFor } = require("./libraries/registry.js");
const { feedFor } = require("./libraries/pyth-feeds.js");
const { fetchScaledPrices } = require("./libraries/hermes-prices.js");

/** Uniswap V3's absolute tick bounds. */
const MIN_TICK = -887272;
const MAX_TICK = 887272;

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function owner() view returns (address)",
  "function mint(address,uint256)",
];

const FACTORY_ABI = [
  "function getPool(address,address,uint24) view returns (address)",
  "function feeAmountTickSpacing(uint24) view returns (int24)",
];

const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
];

const NPM_ABI = [
  "function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) payable returns (address pool)",
  "function mint(tuple(address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint256 amount0Desired, uint256 amount1Desired, uint256 amount0Min, uint256 amount1Min, address recipient, uint256 deadline) params) payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  /* The event, not just the function. A state-changing call's return values are
     not visible to an off-chain caller, so the new token id has to come out of a
     log — and a log cannot be decoded from an ABI that declares no events, which
     is why the first run of this script reported every id as "(unknown)". */
  "event IncreaseLiquidity(uint256 indexed tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)",
  "function balanceOf(address) view returns (uint256)",
  "function tokenOfOwnerByIndex(address,uint256) view returns (uint256)",
  "function positions(uint256) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
];

const PROTOCOL_ABI = [
  "function getUsdValue(address,uint256,uint8) view returns (uint256)",
];

/**
 * Integer square root by Newton's method.
 *
 * Needed because sqrtPriceX96 is a Q64.96 fixed-point value and the intermediate
 * `amount1 << 192` overflows every float long before it overflows a BigInt.
 * Doing this in Number would silently lose the low bits of the price.
 */
function sqrtBig(n) {
  if (n < 0n) throw new Error("sqrt of a negative");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** Uniswap's encodeSqrtRatioX96: the price of token0 in token1, as Q64.96. */
function encodeSqrtRatioX96(amount1, amount0) {
  return sqrtBig((amount1 << 192n) / amount0);
}

/**
 * The tick whose price is closest to this sqrtPriceX96, found by bisection.
 *
 * The closed form needs a base-1.0001 logarithm and Uniswap's own TickMath is a
 * Solidity library, so the tick is searched for instead: getSqrtRatioAtTick is
 * monotonic, and 41 halvings of the full ±887272 range land exactly. Slower than
 * a log and immune to the floating-point error that would put the position's
 * range one tick off the price we just set.
 */
function tickAtSqrtRatio(sqrtPriceX96, sqrtAtTick) {
  /* Bounds first: outside them the bisection would silently return an endpoint
     rather than admit the price is unrepresentable, and a pool initialised at an
     endpoint tick is one the price can only move away from. */
  if (sqrtPriceX96 < sqrtAtTick(MIN_TICK) || sqrtPriceX96 > sqrtAtTick(MAX_TICK))
    throw new Error(
      `sqrtPriceX96 ${sqrtPriceX96} is outside V3's representable range — check the decimals on both sides`,
    );
  let lo = MIN_TICK;
  let hi = MAX_TICK;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (sqrtAtTick(mid) <= sqrtPriceX96) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * sqrt(1.0001^tick) * 2^96, computed in BigInt.
 *
 * 1.0001^tick is irrational, so it is built by repeated squaring over a rational
 * approximation held at 128 bits of extra precision. The error is far below one
 * tick, which is all the bisection above needs.
 */
const Q96 = 1n << 96n;
const PREC = 1n << 128n;
function sqrtRatioAtTick(tick) {
  const abs = BigInt(Math.abs(tick));
  /* sqrt(1.0001) as a PREC-scaled rational, from sqrt(1.0001 * PREC^2). */
  let ratio = PREC;
  let base = sqrtBig(10001n * PREC * PREC / 10000n);
  let n = abs;
  while (n > 0n) {
    if (n & 1n) ratio = (ratio * base) / PREC;
    base = (base * base) / PREC;
    n >>= 1n;
  }
  if (tick < 0) ratio = (PREC * PREC) / ratio;
  return (ratio * Q96) / PREC;
}

const num = (v, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

/**
 * One whole token's worth of USD, at 18 decimals, with its provenance.
 *
 * The diamond's oracle answers first, because that is the price the protocol
 * itself will value this token at: a pool opened at the oracle's ratio agrees
 * with the health factors and liquidations that read the same feed, and one
 * opened elsewhere does not.
 *
 * When the diamond has no feed for the token, Hermes does — the same Pyth
 * endpoint deploy-pushable-feeds.js seeds its first round from, queried for the
 * same feed id `register-tokens.js` would register. So the fallback is not a
 * looser standard, it is the identical source one step earlier in the pipeline.
 * That distinction matters on Sepolia, where Chainlink publishes no USDT/USD at
 * all: our mintable mock USDT is unpriced by the diamond, and without this it
 * could not open a pool on the one chain with gas to open one.
 *
 * What is NOT here is a default. No "these are both stablecoins, call it a
 * dollar". A pair neither source can price refuses, because an opening price
 * nobody published is a gift to the first arbitrageur and a lie to every user
 * who reads the quote before they arrive.
 */
async function priceOf(protocol, address, symbol, decimals) {
  try {
    const usd = await protocol.getUsdValue(address, 10n ** BigInt(decimals), decimals);
    if (usd > 0n) return { usd, source: "diamond oracle" };
  } catch {
    /* No feed registered for this token on this chain. Fall through. */
  }

  let feed;
  try {
    feed = feedFor(symbol);
  } catch {
    throw new Error(
      `${symbol}: the diamond cannot price it and there is no Pyth feed id for that symbol`,
    );
  }
  const prices = await fetchScaledPrices([feed.id], 18);
  const hit = prices.get(feed.id.toLowerCase());
  if (!hit)
    throw new Error(
      `${symbol}: the diamond cannot price it and Hermes did not serve ${feed.symbol} (${feed.id})`,
    );
  const ageSeconds = Math.floor(Date.now() / 1000) - hit.publishTime;
  return {
    usd: BigInt(hit.answer),
    source: `hermes ${feed.symbol} (${ageSeconds}s old)`,
  };
}

async function ensureBalance(token, me, need, label) {
  const have = await token.balanceOf(me);
  if (have >= need) return have;
  const short = need - have;
  let owner;
  try {
    owner = await token.owner();
  } catch {
    throw new Error(
      `${label}: short by ${short} raw units and the token has no mint we control`,
    );
  }
  if (owner.toLowerCase() !== me.toLowerCase())
    throw new Error(
      `${label}: short by ${short} raw units and mint is owned by ${owner}`,
    );
  console.log(`  minting ${short} raw ${label}`);
  await (await token.mint(me, short)).wait();
  return token.balanceOf(me);
}

async function ensureAllowance(token, me, spender, need, label) {
  const have = await token.allowance(me, spender);
  if (have >= need) return;
  console.log(`  approving ${label} to the position manager`);
  await (await token.approve(spender, ethers.MaxUint256)).wait();
}

async function main() {
  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const reg = registryFor(chainId);

  const fee = num(process.env.FEE, 500);
  const usd = num(process.env.USD, 100000);
  const bandPct = num(process.env.BAND_PCT, 2);
  const [keyA, keyB] = (process.env.PAIR ?? "usdt/usde").split("/");
  if (!reg[keyA] || !reg[keyB])
    throw new Error(`PAIR ${keyA}/${keyB}: not both in the registry for chain ${chainId}`);
  if (!reg.v3Factory || !reg.v3PositionManager)
    throw new Error(`chain ${chainId} has no V3 factory or position manager`);
  if (!reg.diamond)
    throw new Error(`chain ${chainId} has no diamond, so no oracle to price the pool with`);

  /* token0/token1 is fixed by address order, not by the order they were named.
     Getting this backwards inverts the price. */
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

  /* ---- price, from the diamond's oracle where it has a feed, Hermes where it
         does not. Both sides must resolve; neither is defaulted. ---- */
  const protocol = new ethers.Contract(reg.diamond, PROTOCOL_ABI, ethers.provider);
  const p0 = await priceOf(protocol, a0, s0, d0);
  const p1 = await priceOf(protocol, a1, s1, d1);
  const usd0 = p0.usd;
  const usd1 = p1.usd;
  if (usd0 === 0n || usd1 === 0n)
    throw new Error("a price came back zero; refusing to invent a ratio");
  console.log(`price: 1 ${s0} = $${ethers.formatUnits(usd0, 18)}  [${p0.source}]`);
  console.log(`price: 1 ${s1} = $${ethers.formatUnits(usd1, 18)}  [${p1.source}]`);

  /* Raw-unit amounts worth the same USD on each side. These are both the mint's
     desired amounts and the ratio the opening price is derived from, so the pool
     opens at exactly the price the position is centred on. */
  const usdWei = ethers.parseUnits(String(usd), 18);
  const amount0 = (usdWei * 10n ** BigInt(d0)) / usd0;
  const amount1 = (usdWei * 10n ** BigInt(d1)) / usd1;
  console.log(
    `sizing: ${ethers.formatUnits(amount0, d0)} ${s0} + ${ethers.formatUnits(amount1, d1)} ${s1} (~$${usd} each side)`,
  );

  const sqrtPriceX96 = encodeSqrtRatioX96(amount1, amount0);
  const spacing = Number(
    await new ethers.Contract(reg.v3Factory, FACTORY_ABI, ethers.provider).feeAmountTickSpacing(fee),
  );
  if (spacing === 0) throw new Error(`fee tier ${fee} is not enabled on this factory`);

  const tick = tickAtSqrtRatio(sqrtPriceX96, sqrtRatioAtTick);
  console.log(`opening sqrtPriceX96 ${sqrtPriceX96} -> tick ${tick} (spacing ${spacing})`);

  /* ---- create + initialise ---- */
  const npm = new ethers.Contract(reg.v3PositionManager, NPM_ABI, signer);
  const factory = new ethers.Contract(reg.v3Factory, FACTORY_ABI, ethers.provider);
  let pool = await factory.getPool(a0, a1, fee);
  if (pool === ethers.ZeroAddress) {
    console.log("creating and initialising the pool");
    const tx = await npm.createAndInitializePoolIfNecessary(a0, a1, fee, sqrtPriceX96);
    await tx.wait();
    pool = await factory.getPool(a0, a1, fee);
    console.log(`  pool ${pool}  (tx ${tx.hash})`);
  } else {
    console.log(`pool already exists at ${pool}`);
  }

  /* The live tick, not the one we computed: if the pool already existed its price
     is whatever the market left it at, and centring a band on our own idea of
     fair would mint it out of range. */
  const live = await new ethers.Contract(pool, POOL_ABI, ethers.provider).slot0();
  const liveTick = Number(live.tick);
  console.log(`live tick ${liveTick}`);

  /* ---- fund and approve ---- */
  const needed0 = amount0 * 2n;
  const needed1 = amount1 * 2n;
  await ensureBalance(t0, me, needed0, s0);
  await ensureBalance(t1, me, needed1, s1);
  await ensureAllowance(t0, me, reg.v3PositionManager, needed0, s0);
  await ensureAllowance(t1, me, reg.v3PositionManager, needed1, s1);

  /* ---- mint both positions ---- */
  const align = (t) => Math.round(t / spacing) * spacing;
  const clampLo = Math.ceil(MIN_TICK / spacing) * spacing;
  const clampHi = Math.floor(MAX_TICK / spacing) * spacing;
  /* ±bandPct in price is a fixed number of ticks, because a tick IS a constant
     ratio: 1.0001^n. ln(1+p)/ln(1.0001), aligned to the tier's spacing. */
  const bandTicks = Math.max(
    spacing,
    align(Math.round(Math.log(1 + bandPct / 100) / Math.log(1.0001))),
  );

  const ranges = [
    { label: "full range", lower: clampLo, upper: clampHi },
    {
      label: `±${bandPct}%`,
      lower: Math.max(clampLo, align(liveTick) - bandTicks),
      upper: Math.min(clampHi, align(liveTick) + bandTicks),
    },
  ];

  const minted = [];
  for (const r of ranges) {
    console.log(`\nminting ${r.label} [${r.lower}, ${r.upper}]`);
    const params = {
      token0: a0,
      token1: a1,
      fee,
      tickLower: r.lower,
      tickUpper: r.upper,
      amount0Desired: amount0,
      amount1Desired: amount1,
      /* Zero, and deliberately. On the first mint this script sets the price
         itself moments earlier, so there is no prior price to slip against; on a
         later run the desired amounts are a ceiling the manager draws from as the
         range requires, and a nonzero floor would refuse a correct mint whose
         range simply needs less of one side. Nothing here is a user's money. */
      amount0Min: 0,
      amount1Min: 0,
      recipient: me,
      deadline: Math.floor(Date.now() / 1000) + 1800,
    };
    const tx = await npm.mint(params);
    const receipt = await tx.wait();
    /* IncreaseLiquidity carries the token id; the return values of a state-
       changing call are not available to a caller off-chain. */
    const ev = receipt.logs
      .filter((l) => l.address.toLowerCase() === reg.v3PositionManager.toLowerCase())
      .map((l) => {
        try {
          return npm.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((p) => p && p.name === "IncreaseLiquidity");
    const tokenId = ev ? ev.args.tokenId.toString() : "(unknown)";
    console.log(`  tokenId ${tokenId}  tx ${tx.hash}`);
    minted.push({ label: r.label, tickLower: r.lower, tickUpper: r.upper, tokenId, tx: tx.hash });
  }

  const after = new ethers.Contract(pool, POOL_ABI, ethers.provider);
  console.log(`\npool liquidity now ${await after.liquidity()}`);
  console.log(`t0 left ${ethers.formatUnits(await t0.balanceOf(me), d0)} ${s0}`);
  console.log(`t1 left ${ethers.formatUnits(await t1.balanceOf(me), d1)} ${s1}`);

  /* Protocol fee on this pool, off unless asked for. slot0.feeProtocol starts at
     0 and the pool keeps none of the LP fee until setFeeProtocol is called by the
     factory owner. V3_FEE_PROTOCOL turns it on for a freshly-seeded pool — 0 (off)
     or 4..10, where the pool keeps 1/n of the fee (4 = 25%, 10 = 10%). Left off by
     default: the fee is a multisig-era decision, not a property of seeding a pool.
     For pools that already exist, use set-dex-fees.js. */
  let feeProtocolSet = null;
  if (process.env.V3_FEE_PROTOCOL !== undefined) {
    const n = Number(process.env.V3_FEE_PROTOCOL);
    if (!Number.isInteger(n) || !(n === 0 || (n >= 4 && n <= 10)))
      throw new Error(`V3_FEE_PROTOCOL must be 0 or an integer 4..10 — got "${process.env.V3_FEE_PROTOCOL}"`);
    const factoryOwner = await new ethers.Contract(
      reg.v3Factory,
      ["function owner() view returns (address)"],
      ethers.provider,
    ).owner();
    if (factoryOwner.toLowerCase() !== me.toLowerCase())
      throw new Error(`V3_FEE_PROTOCOL set but signer ${me} is not the factory owner ${factoryOwner}`);
    console.log(`\nsetting feeProtocol ${n}/${n} on the pool`);
    const poolWrite = new ethers.Contract(pool, ["function setFeeProtocol(uint8,uint8)"], signer);
    await (await poolWrite.setFeeProtocol(n, n)).wait();
    feeProtocolSet = n;
  }

  const out = {
    network: hre.network.name,
    chainId,
    timestamp: new Date().toISOString(),
    pool,
    fee,
    token0: { address: a0, symbol: s0, decimals: d0 },
    token1: { address: a1, symbol: s1, decimals: d1 },
    openedAt: { sqrtPriceX96: sqrtPriceX96.toString(), tick, liveTick },
    oracle: {
      usd0: usd0.toString(),
      usd1: usd1.toString(),
      source0: p0.source,
      source1: p1.source,
    },
    positions: minted,
    feeProtocol: feeProtocolSet,
  };
  const file = `deployment-pool-${hre.network.name}-${s0}-${s1}-${fee}.json`;
  fs.writeFileSync(path.join(__dirname, "..", file), JSON.stringify(out, null, 2));
  console.log(`\nwrote ${file}`);
}

main().catch((e) => {
  console.error("SEED FAILED:", e);
  process.exit(1);
});
