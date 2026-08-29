/**
 * Exercise one V3 position through the app's own two verbs, in order.
 *
 *   ID=8 npx hardhat run scripts/exercise-position.js --network sepolia
 *   ID=6 PCT=10 npx hardhat run scripts/exercise-position.js --network baseTestnet
 *
 * The Pool page exposes exactly two writes against a position — `collectFees`
 * and `removeLiquidity` — and the agent exposes the same two as `collectFees`
 * and `removePosition`. Both live in `src/hooks/dex/useV3Positions.ts`, and the
 * calls here are byte-for-byte the calls that hook sends: `collect` with both
 * maxima at uint128 max, then `decreaseLiquidity` with amount0Min/amount1Min at
 * zero and an hour's deadline, then `collect` again to sweep what the decrease
 * credited. Nothing clever is added — an exercise that sends a *different*
 * transaction from the product proves nothing about the product.
 *
 * Three calls rather than two on purpose, because they answer different
 * questions and the middle one hides the first:
 *
 *   1. collect          — did trading actually accrue fees to this position?
 *   2. decreaseLiquidity— does a partial withdraw credit the right principal?
 *   3. collect          — does the second collect return the principal only,
 *                         now that step 1 has already taken the fees?
 *
 * Run step 2 first and its `collect` returns fees *and* principal in one number,
 * so a broken fee accrual and a working one look identical. Separating them is
 * the whole point: step 1's output is fees, step 3's output is principal.
 *
 * PCT defaults to 10, i.e. a tenth of the position's liquidity. The remaining
 * nine tenths stay staked, so the pool keeps its depth and the position stays
 * available for the agent to act on later.
 *
 * Balances are read before and after every call and reported as deltas. The
 * return values of `collect` are not trusted for the report: they are the
 * contract's own accounting, and a wallet delta is the thing a user sees.
 */

const hre = require("hardhat");
const { ethers } = hre;
const { registryFor } = require("./libraries/registry.js");

const UINT128_MAX = (1n << 128n) - 1n;

const NPM_ABI = [
  "function positions(uint256) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function collect((uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max)) payable returns (uint256 amount0, uint256 amount1)",
  "function decreaseLiquidity((uint256 tokenId, uint128 liquidity, uint256 amount0Min, uint256 amount1Min, uint256 deadline)) payable returns (uint256 amount0, uint256 amount1)",
  "function ownerOf(uint256) view returns (address)",
];
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];
const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
];
const FACTORY_ABI = ["function getPool(address,address,uint24) view returns (address)"];

async function main() {
  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const reg = registryFor(chainId);
  if (!reg.v3PositionManager) throw new Error(`no position manager on chain ${chainId}`);

  const id = BigInt(process.env.ID ?? "0");
  if (id === 0n) throw new Error("set ID to a position token id (see list-positions.js)");
  const pct = BigInt(process.env.PCT ?? "10");
  if (pct <= 0n || pct > 100n) throw new Error("PCT must be 1..100");

  const npm = new ethers.Contract(reg.v3PositionManager, NPM_ABI, signer);
  const owner = await npm.ownerOf(id);
  if (owner.toLowerCase() !== me.toLowerCase())
    throw new Error(`position #${id} belongs to ${owner}, not ${me}`);

  const p = await npm.positions(id);
  const t0 = new ethers.Contract(p.token0, ERC20_ABI, signer);
  const t1 = new ethers.Contract(p.token1, ERC20_ABI, signer);
  const [s0, d0, s1, d1] = await Promise.all([
    t0.symbol(),
    t0.decimals().then(Number),
    t1.symbol(),
    t1.decimals().then(Number),
  ]);

  const pool = await new ethers.Contract(reg.v3Factory, FACTORY_ABI, ethers.provider).getPool(
    p.token0,
    p.token1,
    p.fee,
  );
  const tick = Number((await new ethers.Contract(pool, POOL_ABI, ethers.provider).slot0()).tick);
  const inRange = tick >= Number(p.tickLower) && tick < Number(p.tickUpper);

  const f0 = (v) => ethers.formatUnits(v, d0);
  const f1 = (v) => ethers.formatUnits(v, d1);
  const bals = async () => [await t0.balanceOf(me), await t1.balanceOf(me)];

  console.log(`\n=== ${hre.network.name}: position #${id} ${s0}/${s1} @${p.fee} ===`);
  console.log(
    `range [${p.tickLower}, ${p.tickUpper}] live ${tick} ${inRange ? "IN RANGE" : "OUT OF RANGE"}`,
  );
  console.log(`liquidity ${p.liquidity}`);
  if (!inRange)
    console.log(
      "note: out of range earns no fees, so a zero step-1 collect here is correct, not a fault",
    );

  /* ------------------------------------------------------- 1. collect fees -- */
  let [b0, b1] = await bals();
  let tx = await npm.collect({
    tokenId: id,
    recipient: me,
    amount0Max: UINT128_MAX,
    amount1Max: UINT128_MAX,
  });
  let rc = await tx.wait();
  let [a0, a1] = await bals();
  console.log(`\n1. collect (fees)   tx ${tx.hash}  gas ${rc.gasUsed}`);
  console.log(`   +${f0(a0 - b0)} ${s0}  +${f1(a1 - b1)} ${s1}`);
  const fees0 = a0 - b0;
  const fees1 = a1 - b1;

  /* ------------------------------------------- 2. decrease a tenth of it ---- */
  const remove = (p.liquidity * pct) / 100n;
  if (remove === 0n) throw new Error(`${pct}% of ${p.liquidity} rounds to zero liquidity`);
  [b0, b1] = await bals();
  /* Chain time, not local time: the hook uses Date.now() because a browser has
   * nothing better, but a testnet clock can sit minutes off a laptop's and an
   * hour's deadline is not wide enough to absorb that reliably. */
  const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
  tx = await npm.decreaseLiquidity({
    tokenId: id,
    liquidity: remove,
    amount0Min: 0n,
    amount1Min: 0n,
    deadline,
  });
  rc = await tx.wait();
  [a0, a1] = await bals();
  console.log(`\n2. decreaseLiquidity ${pct}% = ${remove}   tx ${tx.hash}  gas ${rc.gasUsed}`);
  console.log(
    `   wallet moved +${f0(a0 - b0)} ${s0}  +${f1(a1 - b1)} ${s1}  (expected 0 — decrease only credits, collect pays)`,
  );

  /* ---------------------------------------------- 3. collect the principal -- */
  [b0, b1] = await bals();
  tx = await npm.collect({
    tokenId: id,
    recipient: me,
    amount0Max: UINT128_MAX,
    amount1Max: UINT128_MAX,
  });
  rc = await tx.wait();
  [a0, a1] = await bals();
  console.log(`\n3. collect (principal)  tx ${tx.hash}  gas ${rc.gasUsed}`);
  console.log(`   +${f0(a0 - b0)} ${s0}  +${f1(a1 - b1)} ${s1}`);

  const after = await npm.positions(id);
  console.log(`\nliquidity ${p.liquidity} -> ${after.liquidity}`);
  const expected = p.liquidity - remove;
  console.log(
    after.liquidity === expected
      ? `  matches ${p.liquidity} - ${remove} exactly`
      : `  MISMATCH: expected ${expected}`,
  );
  console.log(
    `fees taken in step 1: ${f0(fees0)} ${s0} / ${f1(fees1)} ${s1}` +
      (fees0 === 0n && fees1 === 0n
        ? "  <- zero; check the pool has been traded through this range"
        : ""),
  );
}

main().catch((e) => {
  console.error("POSITION EXERCISE FAILED:", e.shortMessage || e.message || e);
  process.exit(1);
});
