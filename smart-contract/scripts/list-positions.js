/**
 * List the V3 positions a wallet holds, decoded.
 *
 *   npx hardhat run scripts/list-positions.js --network sepolia
 *   OWNER=0x… npx hardhat run scripts/list-positions.js --network sepolia
 *
 * Exists because two of the agent's execute verbs — `collectFees` and
 * `removePosition` — take a position id and nothing else, and until a pool was
 * seeded there was no id on any chain to hand them. A plan built for position #1
 * on a chain with no positions refuses with "I can't find position #1 in your
 * wallet", which is the correct answer and indistinguishable from a bug.
 *
 * Reports the range against the live tick, because in-range and out-of-range are
 * different objects to a fee collection: an out-of-range position earns nothing
 * no matter how much liquidity it holds, so "collectFees returned zero" needs
 * this to tell a working call from a broken one.
 */

const hre = require("hardhat");
const { ethers } = hre;

const { registryFor } = require("./libraries/registry.js");

const NPM_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function tokenOfOwnerByIndex(address,uint256) view returns (uint256)",
  "function positions(uint256) view returns (uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper, uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1)",
  "function collect(tuple(uint256 tokenId, address recipient, uint128 amount0Max, uint128 amount1Max) params) payable returns (uint256 amount0, uint256 amount1)",
];
const FACTORY_ABI = ["function getPool(address,address,uint24) view returns (address)"];
const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
];
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const owner = process.env.OWNER || (await signer.getAddress());
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const reg = registryFor(chainId);
  if (!reg.v3PositionManager) throw new Error(`no position manager on chain ${chainId}`);

  const npm = new ethers.Contract(reg.v3PositionManager, NPM_ABI, ethers.provider);
  const factory = new ethers.Contract(reg.v3Factory, FACTORY_ABI, ethers.provider);
  const count = Number(await npm.balanceOf(owner));
  console.log(`\n=== ${hre.network.name}: ${count} position(s) held by ${owner} ===`);

  const meta = new Map();
  const describe = async (address) => {
    if (!meta.has(address)) {
      const c = new ethers.Contract(address, ERC20_ABI, ethers.provider);
      meta.set(address, {
        symbol: await c.symbol().catch(() => address.slice(0, 8)),
        decimals: Number(await c.decimals().catch(() => 18)),
      });
    }
    return meta.get(address);
  };

  for (let i = 0; i < count; i += 1) {
    const tokenId = await npm.tokenOfOwnerByIndex(owner, i);
    const p = await npm.positions(tokenId);
    const m0 = await describe(p.token0);
    const m1 = await describe(p.token1);
    const pool = await factory.getPool(p.token0, p.token1, p.fee);
    let inRange = "?";
    let liveTick = "?";
    try {
      const s0 = await new ethers.Contract(pool, POOL_ABI, ethers.provider).slot0();
      liveTick = Number(s0.tick);
      inRange =
        liveTick >= Number(p.tickLower) && liveTick < Number(p.tickUpper)
          ? "IN RANGE"
          : "out of range";
    } catch {
      inRange = "pool unreadable";
    }
    /*
     * What collectFees would actually pay out, obtained by static-calling the
     * same `collect` the app's hook sends. `tokensOwed` is NOT that number: it is
     * only written when a position is poked, so a position that has earned real
     * fees still reports zero owed until someone touches it. Reading the struct
     * and stopping there is why "collectFees returns nothing" looks like a broken
     * verb on a pool that has in fact been traded against.
     */
    let collectable = "n/a";
    try {
      const [c0, c1] = await npm.connect(signer).collect.staticCall(
        {
          tokenId,
          recipient: owner,
          amount0Max: (1n << 128n) - 1n,
          amount1Max: (1n << 128n) - 1n,
        },
        { from: owner },
      );
      collectable = `${ethers.formatUnits(c0, m0.decimals)} ${m0.symbol} / ${ethers.formatUnits(c1, m1.decimals)} ${m1.symbol}`;
    } catch (e) {
      collectable = `collect would revert — ${e.shortMessage ?? e.message}`;
    }

    console.log(
      `  #${tokenId}  ${m0.symbol}/${m1.symbol} @${p.fee}  ` +
        `[${p.tickLower}, ${p.tickUpper}] live=${liveTick} ${inRange}\n` +
        `        liquidity ${p.liquidity}\n` +
        `        collectable now ${collectable}\n` +
        `        pool ${pool}`,
    );
  }
  if (count === 0) console.log("  (none — run seed-v3-pool.js first)");
}

main().catch((e) => {
  console.error("LIST FAILED:", e);
  process.exit(1);
});
