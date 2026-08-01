/**
 * Reports deployed-bytecode size for every compiled contract and fails if any
 * exceeds the EVM limit.
 *
 * Why this matters here
 * ---------------------
 * EIP-170 caps deployed bytecode at 24,576 bytes on Ethereum and every chain
 * that clones it — Sepolia, Base, BNB, Robinhood, Arc. Abstract does not
 * enforce the same ceiling, because zkSync compiles to its own bytecode format
 * with far more permissive limits.
 *
 * So a contract can deploy happily on Abstract and be undeployable on
 * Ethereum. `allowUnlimitedContractSize: true` in the hardhat network config
 * hides it locally too: that flag exists specifically to bypass this check.
 *
 * The Diamond pattern is the escape hatch — logic is meant to be split across
 * facets precisely so no single one hits the ceiling. A facet over the limit
 * should be split, not squeezed.
 *
 * Run before any EVM deploy:
 *   npx hardhat compile && npx hardhat run scripts/check-contract-sizes.js
 */

const { artifacts } = require("hardhat");

const EIP170_LIMIT = 24576;
/** Warn before the ceiling — optimiser settings shift sizes between builds. */
const WARN_AT = EIP170_LIMIT * 0.9;

async function main() {
  const names = await artifacts.getAllFullyQualifiedNames();
  const rows = [];

  for (const name of names) {
    const art = await artifacts.readArtifact(name);
    // deployedBytecode is what lives on chain and what EIP-170 measures.
    // bytecode includes constructor code and is not the thing capped.
    const hex = art.deployedBytecode || "0x";
    if (hex === "0x") continue;
    const bytes = (hex.length - 2) / 2;
    rows.push({ name: name.split(":").pop(), bytes });
  }

  rows.sort((a, b) => b.bytes - a.bytes);

  const over = rows.filter((r) => r.bytes > EIP170_LIMIT);
  const near = rows.filter((r) => r.bytes <= EIP170_LIMIT && r.bytes >= WARN_AT);

  console.log(`\nLargest contracts (limit ${EIP170_LIMIT} bytes):\n`);
  for (const r of rows.slice(0, 15)) {
    const pct = ((r.bytes / EIP170_LIMIT) * 100).toFixed(0);
    const flag = r.bytes > EIP170_LIMIT ? "OVER" : r.bytes >= WARN_AT ? "near" : "    ";
    console.log(`  ${flag}  ${String(r.bytes).padStart(6)}  ${pct.padStart(3)}%  ${r.name}`);
  }

  if (near.length > 0) {
    console.log(`\n${near.length} contract(s) within 10% of the limit — a compiler or optimiser change could push them over.`);
  }

  if (over.length > 0) {
    console.error(
      `\n${over.length} contract(s) EXCEED the EIP-170 limit and cannot deploy to Ethereum, Base, BNB, Robinhood or Arc:\n` +
        over.map((r) => `  ${r.name}: ${r.bytes} bytes (${r.bytes - EIP170_LIMIT} over)`).join("\n") +
        `\n\nThese may still deploy on Abstract, which does not enforce the same\n` +
        `ceiling — that is why the problem can stay hidden. Split the logic\n` +
        `across additional facets rather than raising a gas limit.`,
    );
    process.exitCode = 1;
    return;
  }

  console.log("\nAll contracts are within the EIP-170 limit.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
