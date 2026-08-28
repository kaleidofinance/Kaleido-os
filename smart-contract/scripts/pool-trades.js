/**
 * Read-only: every Swap that has ever happened in each of this chain's pools.
 *
 *   npx hardhat run scripts/pool-trades.js --network sepolia
 *   FROM=9000000 npx hardhat run scripts/pool-trades.js --network baseTestnet
 *
 * Written to settle a question a fee balance cannot answer. Position #8 on
 * Sepolia collected exactly three times the fees its Base twin did, from what the
 * run log said was one identical swap — and the honest reading of that is not
 * "the fee maths is wrong" but "the log is incomplete". A `ConnectTimeout` from
 * the RPC can land *after* the transaction is broadcast: the client gives up
 * reading the receipt and reports failure, while the swap is mined anyway. Every
 * retry then sends another one.
 *
 * So the record of what has been exercised cannot be built from run logs. It has
 * to be read off the chain, and the Swap event is the only thing that knows.
 *
 * `amount0`/`amount1` are signed from the pool's point of view: negative is what
 * the pool paid out, positive what it took in. They are printed as in -> out from
 * the trader's side, which is the direction a human reads.
 *
 * Pools are discovered the same way `survey-assets.js` does — every registry
 * asset against every other, at every tier the app trades — so a pool nobody
 * remembers creating still shows up.
 */

const hre = require("hardhat");
const { ethers } = hre;
const { registryFor } = require("./libraries/registry.js");

const FEE_TIERS = [500, 3000, 10000];
const ASSET_KEYS = ["wrappedNative", "usdc", "usdt", "usde", "kld", "stKLD", "kfUSD", "kafUSD"];

const FACTORY_ABI = ["function getPool(address,address,uint24) view returns (address)"];
const POOL_ABI = [
  "event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)",
  /* Flash pays the pool a fee on both sides and emits no Swap, so a pool whose
   * fee growth outruns its swap history is not necessarily missing a swap. */
  "event Flash(address indexed sender, address indexed recipient, uint256 amount0, uint256 amount1, uint256 paid0, uint256 paid1)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function fee() view returns (uint24)",
  "function feeGrowthGlobal0X128() view returns (uint256)",
  "function feeGrowthGlobal1X128() view returns (uint256)",
  "function liquidity() view returns (uint128)",
];
const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

/* Some testnet RPCs cap eth_getLogs at a block span rather than a result count,
 * and the cap is not advertised. Scanning in windows costs a few more round
 * trips and works everywhere. */
const WINDOW = Number(process.env.WINDOW ?? 45000);

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const reg = registryFor(chainId);
  if (!reg.v3Factory) throw new Error(`no v3Factory on chain ${chainId}`);

  const latest = await ethers.provider.getBlockNumber();
  const from = Number(process.env.FROM ?? Math.max(0, latest - Number(process.env.BACK ?? 200000)));
  console.log(`\n=== ${hre.network.name}: swaps in blocks ${from}..${latest} ===`);

  const factory = new ethers.Contract(reg.v3Factory, FACTORY_ABI, ethers.provider);
  const meta = new Map();
  const describe = async (a) => {
    if (!meta.has(a)) {
      const c = new ethers.Contract(a, ERC20_ABI, ethers.provider);
      meta.set(a, {
        symbol: await c.symbol().catch(() => a.slice(0, 8)),
        decimals: Number(await c.decimals().catch(() => 18)),
      });
    }
    return meta.get(a);
  };

  const keys = ASSET_KEYS.filter((k) => reg[k]);
  const pools = [];
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++)
      for (const fee of FEE_TIERS) {
        const addr = await factory
          .getPool(reg[keys[i]], reg[keys[j]], fee)
          .catch(() => ethers.ZeroAddress);
        if (addr && addr !== ethers.ZeroAddress) pools.push({ addr, fee });
      }

  let grand = 0;
  for (const { addr, fee } of pools) {
    const pool = new ethers.Contract(addr, POOL_ABI, ethers.provider);
    const [t0, t1] = await Promise.all([pool.token0(), pool.token1()]);
    const [m0, m1] = [await describe(t0), await describe(t1)];

    const logs = [];
    for (let start = from; start <= latest; start += WINDOW) {
      const end = Math.min(start + WINDOW - 1, latest);
      try {
        logs.push(...(await pool.queryFilter(pool.filters.Swap(), start, end)));
      } catch (e) {
        console.log(`  ${m0.symbol}/${m1.symbol} @${fee}: log query ${start}..${end} failed — ${e.shortMessage ?? e.message}`);
      }
    }

    console.log(`\n  ${m0.symbol}/${m1.symbol} @${await pool.fee()}  ${addr}  ${logs.length} swap(s)`);

    /* Fee growth is the pool's own ledger, and it is the number a position's
     * `collect` is computed from — so when a collected amount disagrees with
     * "fee tier x swap size", this says which of the two is wrong. Expressed as
     * whole tokens earned per unit of *current* liquidity, which is only exact if
     * liquidity has not changed since the swaps; printed as a cross-check, not a
     * claim. */
    const [g0, g1, liq] = await Promise.all([
      pool.feeGrowthGlobal0X128(),
      pool.feeGrowthGlobal1X128(),
      pool.liquidity(),
    ]);
    console.log(
      `    fee growth implies ${ethers.formatUnits((g0 * liq) >> 128n, m0.decimals)} ${m0.symbol} / ${ethers.formatUnits((g1 * liq) >> 128n, m1.decimals)} ${m1.symbol} earned at current liquidity`,
    );
    const flashes = await pool.queryFilter(pool.filters.Flash(), from, latest).catch(() => []);
    if (flashes.length)
      console.log(`    ${flashes.length} flash loan(s) — these pay fees with no Swap event`);

    grand += logs.length;
    const traders = new Map();
    for (const l of logs) {
      const a0 = l.args.amount0;
      const a1 = l.args.amount1;
      const zeroForOne = a0 > 0n;
      const inS = zeroForOne ? m0 : m1;
      const outS = zeroForOne ? m1 : m0;
      const inA = zeroForOne ? a0 : a1;
      const outA = zeroForOne ? -a1 : -a0;
      console.log(
        `    block ${l.blockNumber}  ${ethers.formatUnits(inA, inS.decimals)} ${inS.symbol} -> ${ethers.formatUnits(outA, outS.decimals)} ${outS.symbol}   tick ${l.args.tick}  ${l.transactionHash}`,
      );
      traders.set(l.args.recipient, (traders.get(l.args.recipient) ?? 0) + 1);
    }
    for (const [who, n] of traders) console.log(`    recipient ${who}: ${n}`);
  }

  console.log(`\ntotal swaps across ${pools.length} pool(s): ${grand}`);
}

main().catch((e) => {
  console.error("TRADE SCAN FAILED:", e.shortMessage || e.message || e);
  process.exit(1);
});
