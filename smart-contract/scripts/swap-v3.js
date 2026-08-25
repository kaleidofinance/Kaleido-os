/**
 * Swap through the V3 router, the way the app and the agent do.
 *
 *   IN=usdt OUT=usde AMOUNT=2500 \
 *   npx hardhat run scripts/swap-v3.js --network sepolia
 *
 * Two jobs. The first is validation: the quoter, the router, the pool's tick
 * crossing and the position's fee accrual are four separate pieces of the V3
 * deployment and nothing had ever exercised any of them on any of these chains.
 * A pool that exists and is priced can still fail to trade — a wrong
 * poolInitCodeHash, an unenabled fee tier, a router pointed at the wrong factory
 * — and every one of those surfaces here rather than in front of a user.
 *
 * The second is that it puts fees into the positions. `collectFees` is one of the
 * agent's execute verbs and it returns zero for a position nobody has traded
 * against, which is indistinguishable from a broken call. After this runs the
 * in-range position owes real, nonzero amounts.
 *
 * ── The minimum out is quoted, not zero ────────────────────────────────────
 *
 * The quoter is called first and `amountOutMinimum` is set to that answer less
 * the slippage tolerance, which is the same shape the swap page uses. Passing
 * zero would trade at any price the pool happens to offer, and on a pool this
 * script is also the first user of, a bad quote is exactly the failure worth
 * catching. So a swap whose realised price is worse than the quote by more than
 * the tolerance reverts instead of completing quietly.
 *
 * Quoting is an eth_call against a function that reverts by design in V3's
 * QuoterV1 — it is `staticCall`ed for that reason, not sent.
 */

const hre = require("hardhat");
const { ethers } = hre;

const { registryFor } = require("./libraries/registry.js");

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];

const QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) returns (uint256 amountOut)",
];

const ROUTER_ABI = [
  "function exactInputSingle(tuple(address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
];

const POOL_ABI = [
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
];

const FACTORY_ABI = ["function getPool(address,address,uint24) view returns (address)"];

const num = (v, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

async function main() {
  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const reg = registryFor(chainId);

  const keyIn = process.env.IN ?? "usdt";
  const keyOut = process.env.OUT ?? "usde";
  const fee = num(process.env.FEE, 500);
  const slippageBps = num(process.env.SLIPPAGE_BPS, 50);
  if (!reg[keyIn] || !reg[keyOut])
    throw new Error(`${keyIn}/${keyOut}: not both in the registry for chain ${chainId}`);
  if (!reg.v3Router || !reg.v3Quoter)
    throw new Error(`chain ${chainId} has no V3 router or quoter`);

  const tin = new ethers.Contract(reg[keyIn], ERC20_ABI, signer);
  const tout = new ethers.Contract(reg[keyOut], ERC20_ABI, signer);
  const [sIn, dIn, sOut, dOut] = [
    await tin.symbol(),
    Number(await tin.decimals()),
    await tout.symbol(),
    Number(await tout.decimals()),
  ];
  const amountIn = ethers.parseUnits(process.env.AMOUNT ?? "1000", dIn);

  const pool = await new ethers.Contract(reg.v3Factory, FACTORY_ABI, ethers.provider).getPool(
    reg[keyIn],
    reg[keyOut],
    fee,
  );
  if (pool === ethers.ZeroAddress)
    throw new Error(`no ${sIn}/${sOut} pool at fee ${fee} — run seed-v3-pool.js first`);
  const poolC = new ethers.Contract(pool, POOL_ABI, ethers.provider);
  const before = await poolC.slot0();

  console.log(`\n=== ${hre.network.name}: swap ${ethers.formatUnits(amountIn, dIn)} ${sIn} -> ${sOut} @${fee} ===`);
  console.log(`pool ${pool}  tick ${before.tick}  liquidity ${await poolC.liquidity()}`);

  const bal = await tin.balanceOf(me);
  if (bal < amountIn)
    throw new Error(
      `short of ${sIn}: have ${ethers.formatUnits(bal, dIn)}, need ${ethers.formatUnits(amountIn, dIn)}`,
    );

  /* Quote. QuoterV1 computes by reverting with the answer, so this is an
     eth_call and never a transaction, however much it looks like one. */
  const quoter = new ethers.Contract(reg.v3Quoter, QUOTER_ABI, signer);
  const quoted = await quoter.quoteExactInputSingle.staticCall(
    reg[keyIn],
    reg[keyOut],
    fee,
    amountIn,
    0,
  );
  const minOut = (quoted * BigInt(10000 - slippageBps)) / 10000n;
  console.log(
    `quote ${ethers.formatUnits(quoted, dOut)} ${sOut}, min ${ethers.formatUnits(minOut, dOut)} at ${slippageBps} bps`,
  );

  if ((await tin.allowance(me, reg.v3Router)) < amountIn) {
    console.log(`approving ${sIn} to the router`);
    await (await tin.approve(reg.v3Router, ethers.MaxUint256)).wait();
  }

  const outBefore = await tout.balanceOf(me);
  const router = new ethers.Contract(reg.v3Router, ROUTER_ABI, signer);
  const tx = await router.exactInputSingle({
    tokenIn: reg[keyIn],
    tokenOut: reg[keyOut],
    fee,
    recipient: me,
    deadline: Math.floor(Date.now() / 1000) + 1800,
    amountIn,
    amountOutMinimum: minOut,
    sqrtPriceLimitX96: 0,
  });
  const receipt = await tx.wait();
  const gained = (await tout.balanceOf(me)) - outBefore;
  const after = await poolC.slot0();

  console.log(`swapped  tx ${tx.hash}  gas ${receipt.gasUsed}`);
  console.log(`received ${ethers.formatUnits(gained, dOut)} ${sOut}`);
  console.log(
    `quote error ${
      quoted === 0n ? "n/a" : `${Number(((gained - quoted) * 1000000n) / quoted) / 10000}%`
    }`,
  );
  console.log(`tick ${before.tick} -> ${after.tick}`);
}

main().catch((e) => {
  console.error("SWAP FAILED:", e);
  process.exit(1);
});
