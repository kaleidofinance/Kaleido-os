/**
 * Mint a mock token to an address. Nothing else.
 *
 *   TOKEN=usdc AMOUNT=200000 npx hardhat run scripts/mint-mock.js --network sepolia
 *   TOKEN=usdt AMOUNT=5000 TO=0xabc… npx hardhat run scripts/mint-mock.js --network baseTestnet
 *
 * The exercise plan needs the same three or four mock balances topped up over and
 * over — a pool seeding consumes every USDC the deployer holds, then the lending
 * route wants collateral, then kfUSD wants mint collateral. `seed-v3-pool.js` has
 * an `ensureBalance` that does this, but it is private to that script and only
 * ever mints the shortfall for a pool. This is the same capability with one job.
 *
 * `mint(address,uint256)` is the shape on all of them, but the gate differs: the
 * plain-ERC20 mock USDC (contracts/test/MockERC20.sol) has a public mint and no
 * owner at all, while the USDT/USDe mocks gate it on `owner()`. So the owner is
 * read first and a mint we know will revert is refused here with a readable
 * message rather than an out-of-gas trace from the node.
 *
 * TOKEN is a registry key (`usdc`, `usdt`, `usde`, `kld`), not an address, so this
 * cannot be pointed at a token the app does not know about. AMOUNT is in whole
 * units and scaled by the token's own decimals, read off the token.
 */

const hre = require("hardhat");
const { ethers } = hre;
const { registryFor } = require("./libraries/registry.js");

const ABI = [
  "function mint(address,uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function owner() view returns (address)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const me = await signer.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const reg = registryFor(chainId);

  const key = process.env.TOKEN;
  if (!key) throw new Error("set TOKEN to a registry key, e.g. TOKEN=usdc");
  const address = reg[key];
  if (!address) throw new Error(`no "${key}" on chain ${chainId}`);
  const to = process.env.TO ?? me;

  const t = new ethers.Contract(address, ABI, signer);
  const [symbol, decimals] = await Promise.all([t.symbol(), t.decimals()]);
  const d = Number(decimals);
  const amount = ethers.parseUnits(process.env.AMOUNT ?? "100000", d);

  /* Refused here rather than by the node: a revert from a gated mint arrives as
   * an unattributed "execution reverted", and the useful information — who does
   * own the mint — is only available before the call. */
  let owner = null;
  try {
    owner = await t.owner();
  } catch {
    /* No owner() at all is the mock USDC's public-mint case, not an error. */
  }
  if (owner && owner.toLowerCase() !== me.toLowerCase())
    throw new Error(`${symbol}.mint is owned by ${owner}, not ${me}`);

  const before = await t.balanceOf(to);
  const tx = await t.mint(to, amount);
  await tx.wait();
  const after = await t.balanceOf(to);

  console.log(
    `${hre.network.name}: minted ${ethers.formatUnits(amount, d)} ${symbol} to ${to}`,
  );
  console.log(
    `  ${ethers.formatUnits(before, d)} -> ${ethers.formatUnits(after, d)}  (tx ${tx.hash})`,
  );
}

main().catch((e) => {
  console.error("MINT FAILED:", e.shortMessage || e.message || e);
  process.exit(1);
});
