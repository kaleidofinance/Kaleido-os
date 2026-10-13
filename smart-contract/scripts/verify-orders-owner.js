/**
 * Read-only post-check for the orders contract's ownership and config. Sends nothing.
 *
 *   ORDERS=0x… EXPECT_OWNER=0x<Safe> npx hardhat run scripts/verify-orders-owner.js --network arcMainnet
 *
 * Prints owner / pendingOwner / fillerFeeBps and (when given) whether each address in
 * AGGREGATORS=0x…,0x… is on the allowlist. Exits non-zero if EXPECT_OWNER is set and
 * does not match, or a pending nomination is still open.
 */
const hre = require("hardhat");
const { ethers } = hre;

const ABI = [
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function fillerFeeBps() view returns (uint16)",
  "function MAX_FILLER_FEE_BPS() view returns (uint16)",
  "function isAggregator(address) view returns (bool)",
];

async function main() {
  const addr = ethers.getAddress(process.env.ORDERS || "");
  const c = new ethers.Contract(addr, ABI, ethers.provider);
  const [owner, pending, fee] = await Promise.all([c.owner(), c.pendingOwner(), c.fillerFeeBps()]);
  const max = await c.MAX_FILLER_FEE_BPS().catch(() => "n/a");
  console.log(`orders ${addr} on ${hre.network.name}`);
  console.log(`  owner         ${owner}`);
  console.log(`  pendingOwner  ${pending === ethers.ZeroAddress ? "(none)" : pending}`);
  console.log(`  fillerFeeBps  ${fee} (max ${max})`);
  for (const a of (process.env.AGGREGATORS || "").split(",").map((s) => s.trim()).filter(Boolean)) {
    console.log(`  aggregator    ${a}  ${(await c.isAggregator(ethers.getAddress(a))) ? "allowed" : "NOT allowed"}`);
  }
  let bad = false;
  if (process.env.EXPECT_OWNER && owner.toLowerCase() !== ethers.getAddress(process.env.EXPECT_OWNER).toLowerCase()) {
    console.log(`  ❌ owner is not the expected ${process.env.EXPECT_OWNER}`);
    bad = true;
  }
  if (pending !== ethers.ZeroAddress) {
    console.log("  ❌ a nomination is still open");
    bad = true;
  }
  if (!bad) console.log("  ✅ ownership settled");
  process.exitCode = bad ? 1 : 0;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
