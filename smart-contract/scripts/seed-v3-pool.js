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
 * The one sanctioned exception is a price the operator types explicitly
 * (STABLE_USD, see parsePriceOverrides) — a number the run logs as an override
 * on every line it prints, not one the script chose for you. It exists because
 * both fallbacks are now unavailable for our mock stablecoins at once: each
 * diamond prices only one $1 stable (Sepolia USDC, Base USDT) and Pyth's public
 * Hermes endpoint began returning 401. That is still not "call it a dollar" —
 * the script invents nothing; a pair with one un-named side refuses as before.
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
 * ── The wrapped native is deposited, not minted ────────────────────────────
 *
 * Every other token here is a mock with a mint we control. The chain's wrapped
 * native has neither mint nor owner, and issues one token per unit of native
 * sent to it — so a WETH side is funded by wrapping, and the run holds
 * GAS_RESERVE (0.05 native, by default) back so it can still pay for the mints
 * that follow. Note that "wrapped native" is not ETH everywhere: it is WBNB on
 * BSC, and WUSDC on Arc, whose gas token is USDC.
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
/* The tick math both this script and reprice-v3-pool.js depend on. Shared so
   the two cannot disagree about which tick a price is: one moves the price and
   the other centres a position on it. */
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
  "function owner() view returns (address)",
  "function mint(address,uint256)",
  /* The wrapped native's deposit. Not ERC20, and only ever called on the one
     token that has it — see wrapNative. */
  "function deposit() payable",
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

const num = (v, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

/**
 * Operator-supplied USD prices, keyed by lowercased symbol, parsed from
 * STABLE_USD once at load:
 *
 *   STABLE_USD="usdc=1,usdt=1,usde=1"
 *
 * This is the only way to price a token the diamond has no feed for and Hermes
 * will not serve, and it is intentionally awkward: the operator names every
 * symbol and its price on the command line, priceOf logs each one as an
 * override, and a symbol that is not named here is not priced here — a pair with
 * one un-named side still refuses. It is a fixed number, not a feed, so it is
 * only ever correct for an asset whose price is pinned by construction (a
 * $1-pegged mock stablecoin on a testnet). Never point it at a volatile asset.
 */
function parsePriceOverrides(spec) {
  const out = new Map();
  if (!spec) return out;
  for (const raw of spec.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const eq = part.indexOf("=");
    if (eq < 0) throw new Error(`STABLE_USD entry "${part}" is not symbol=price`);
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
  /* An explicit operator price wins over both feeds. This is the assertion the
     script will not make on its own — see parsePriceOverrides — so when the
     operator has made it, it is authoritative, and taking it first also gives a
     pegged pair a clean exact ratio instead of the oracle's $0.9999 dust. */
  const override = PRICE_OVERRIDES.get(symbol.toLowerCase());
  if (override !== undefined)
    return { usd: override, source: `operator override $${ethers.formatUnits(override, 18)}` };

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

/* Native left unwrapped, in whole units. Every write after the wrap — two
   approvals and two mints — pays gas out of the same balance the wrap draws
   from, so a run that wrapped its shortfall exactly would fund the pool and
   then be unable to fill it. */
const GAS_RESERVE = ethers.parseEther(process.env.GAS_RESERVE ?? "0.05");

/* A funded balance, confirmed rather than assumed. A token that takes the call
   and credits somebody else reports nothing wrong, and the mint two calls later
   would be the first thing to notice. */
async function confirmFunded(token, me, need, label) {
  const now = await token.balanceOf(me);
  if (now < need)
    throw new Error(
      `${label}: funded, and still short — ${now} raw units against ${need} needed`,
    );
  return now;
}

/**
 * Cover a shortfall in the chain's wrapped native by depositing native for it.
 *
 * This is the one token here that cannot be minted and does not need to be:
 * WETH9 issues exactly one token per unit of native sent, so the shortfall is a
 * deposit. Without this it falls through to the mint path below, whose report —
 * "no mint we control" — is true, useless, and the reason an ETH pool could not
 * be seeded at all.
 *
 * Two mechanisms, because the deployed contract is not always inspectable: the
 * explicit deposit(), and a bare value transfer into receive()/fallback(), which
 * every WETH9 forwards to that same deposit. Which one exists is settled by
 * simulating each. Not by scanning the bytecode for the selector: on Robinhood
 * that reads absent for totalSupply() too, which demonstrably answers, so the
 * scan proves nothing there — and a real send is far too expensive a way to ask.
 */
async function wrapNative(token, me, short, need, label) {
  const native = await ethers.provider.getBalance(me);
  if (native < short + GAS_RESERVE)
    throw new Error(
      `${label}: short by ${ethers.formatEther(short)} with ${ethers.formatEther(native)} native to wrap it from, ` +
        `which does not clear the ${ethers.formatEther(GAS_RESERVE)} gas reserve. Lower USD, or fund ${me} on this chain.`,
    );

  let send;
  try {
    await token.deposit.staticCall({ value: short });
    send = () => token.deposit({ value: short });
  } catch (e) {
    try {
      await ethers.provider.call({ to: token.target, from: me, value: short, data: "0x" });
      send = () => token.runner.sendTransaction({ to: token.target, value: short });
    } catch {
      throw new Error(
        `${label}: short by ${ethers.formatEther(short)} and it takes neither deposit() nor a bare ` +
          `transfer (${e.shortMessage ?? e.message}) — not a wrapped native this script can obtain`,
      );
    }
  }

  console.log(
    `  wrapping ${ethers.formatEther(short)} native into ${label}, leaving ${ethers.formatEther(native - short)}`,
  );
  await (await send()).wait();
  return confirmFunded(token, me, need, label);
}

async function ensureBalance(token, me, need, label, wrappedNative) {
  const have = await token.balanceOf(me);
  if (have >= need) return have;
  const short = need - have;

  /* The wrapped native goes through a deposit instead of a mint. Checked by
     address rather than by symbol or by probing for deposit(), because the
     registry is the thing that decides which token this chain wraps into. */
  if (wrappedNative && token.target.toLowerCase() === wrappedNative.toLowerCase())
    return wrapNative(token, me, short, need, label);

  /* Two mint shapes live behind this list. The Ownable stablecoin mocks
     (USDT/USDe) expose owner() and gate mint() on it; the plain-ERC20 mock USDC
     (contracts/test/MockERC20.sol) has a PUBLIC mint() and no owner() at all.
     So an owner() that reverts is not "no mint" — it is the second shape, whose
     mint we can still call. Only when owner() names someone else is the mint
     genuinely out of reach, and checking that first avoids spending gas on a
     mint() we know will revert. A token with no mint at all still lands here and
     still reports itself unfundable; the wrapped native used to be the one that
     did, which is what the branch above exists to stop. */
  let owner = null;
  try {
    owner = await token.owner();
  } catch {
    /* No owner() — the public-mint mock, or a token with no mint at all. */
  }
  if (owner !== null && owner.toLowerCase() !== me.toLowerCase())
    throw new Error(
      `${label}: short by ${short} raw units and mint is owned by ${owner}`,
    );
  console.log(`  minting ${short} raw ${label}`);
  try {
    await (await token.mint(me, short)).wait();
  } catch (e) {
    throw new Error(
      `${label}: short by ${short} raw units and the token has no mint we control (${e.shortMessage ?? e.message})`,
    );
  }
  return confirmFunded(token, me, need, label);
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

  /* Refuse when the pool's price and the price just asserted are not the same
     market. amount0/amount1 above are sized from the oracle, but the manager draws
     whichever ratio the LIVE price requires — so on a pool sitting somewhere else
     "~$N each side" is a ceiling and the deposit lands lopsided, at a price nobody
     asked for. Not hypothetical: a BSC KLD/USDC pool left at $4.00 took 50k KLD +
     200k USDC against a $0.03 assertion and still read $4.00 afterwards. Reprice
     it first, or say plainly that the market is the price. */
  const driftPct = num(process.env.MAX_DRIFT_PCT, 100);
  const driftTicks = Math.round(Math.log(1 + driftPct / 100) / Math.log(1.0001));
  if (Math.abs(liveTick - tick) > driftTicks) {
    const ratio = Math.pow(1.0001, liveTick - tick);
    if (process.env.ACCEPT_LIVE !== "1")
      throw new Error(
        `the pool is at tick ${liveTick}, the asserted price at tick ${tick} — ${ratio.toFixed(3)}x apart, past MAX_DRIFT_PCT=${driftPct}. ` +
          `Reprice it first: PAIR=${keyA}/${keyB} FEE=${fee} STABLE_USD="${process.env.STABLE_USD ?? ""}" MAX_IN=<n> EXECUTE=1 npx hardhat run scripts/reprice-v3-pool.js --network ${hre.network.name} ` +
          `— or set ACCEPT_LIVE=1 to mint at the live price, in which case the sizing above is a ceiling per side rather than the deposit.`,
      );
    console.log(
      `  ACCEPT_LIVE: minting at the live price, ${ratio.toFixed(3)}x the asserted one — the sizing above is a ceiling per side, not the deposit`,
    );
  }


  /* ---- fund and approve ---- */
  const needed0 = amount0 * 2n;
  const needed1 = amount1 * 2n;
  await ensureBalance(t0, me, needed0, s0, reg.wrappedNative);
  await ensureBalance(t1, me, needed1, s1, reg.wrappedNative);
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
