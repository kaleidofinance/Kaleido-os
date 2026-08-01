/**
 * Verifies POOL_INIT_CODE_HASH against the bytecode actually compiled.
 *
 * Why this exists
 * ---------------
 * PoolAddress.sol hardcodes the keccak of the V3 pool's creation bytecode as a
 * Solidity `constant`. The periphery — router, position manager, quoter —
 * derives pool addresses from it via CREATE2 instead of asking the factory, and
 * the swap callback authenticates the caller by comparing msg.sender against
 * that derived address.
 *
 * The catch: the hash is a property of the compiled bytecode, and Kaleido
 * targets two different compilers.
 *
 *   - Abstract mainnet/testnet are zkSync-stack, compiled with zksolc
 *   - Ethereum, Base, BNB, Robinhood and Arc are EVM, compiled with solc
 *
 * Identical source produces different bytecode under each, so a hash baked in
 * for one family is wrong for the other. Nothing reverts at deploy time — the
 * factory still creates pools fine. It breaks later, at the first swap, when
 * the callback compares against an address that holds no code.
 *
 * Run this before deploying to any EVM chain:
 *   npx hardhat run scripts/verify-pool-init-hash.js
 *
 * ZKSYNC NOTE: on zkSync, CREATE2 address derivation itself differs from the
 * EVM `0xff` scheme — it hashes the bytecode hash with a zkSync-specific
 * prefix. PoolAddress.computeAddress is therefore structurally wrong on
 * Abstract regardless of which hash is stored, and pool addresses there must
 * come from factory.getPool() rather than from computation. This script
 * refuses to give a misleading pass on a zksolc build.
 */

const fs = require("fs");
const path = require("path");
const { ethers, network, artifacts } = require("hardhat");

const POOL_CONTRACT = "KaleidoSwapV3Pool";
const POOL_ADDRESS_SOL = path.join(
  __dirname,
  "..",
  "contracts",
  "dex-v3",
  "periphery",
  "libraries",
  "PoolAddress.sol",
);

function readConstantFromSource() {
  const src = fs.readFileSync(POOL_ADDRESS_SOL, "utf8");
  const m = src.match(
    /POOL_INIT_CODE_HASH\s*=\s*(0x[0-9a-fA-F]{64})/,
  );
  if (!m) throw new Error("Could not find POOL_INIT_CODE_HASH in PoolAddress.sol");
  return m[1].toLowerCase();
}

async function main() {
  const isZkSync = Boolean(network.config.zksync);

  console.log(`network:  ${network.name}`);
  console.log(`compiler: ${isZkSync ? "zksolc (zkSync stack)" : "solc (EVM)"}`);

  const declared = readConstantFromSource();
  console.log(`declared: ${declared}`);

  if (isZkSync) {
    console.log(
      "\nzkSync build — skipping the equality check on purpose.\n" +
        "CREATE2 derivation differs from the EVM scheme here, so a matching\n" +
        "hash would not make PoolAddress.computeAddress correct. On Abstract,\n" +
        "resolve pools through factory.getPool() rather than by computation.",
    );
    return;
  }

  const artifact = await artifacts.readArtifact(POOL_CONTRACT);
  if (!artifact.bytecode || artifact.bytecode === "0x") {
    throw new Error(`${POOL_CONTRACT} has empty bytecode — compile first`);
  }

  const actual = ethers.keccak256(artifact.bytecode).toLowerCase();
  console.log(`actual:   ${actual}`);

  if (actual !== declared) {
    console.error(
      "\nMISMATCH — do not deploy.\n\n" +
        `PoolAddress.sol declares ${declared}\n` +
        `but this build produces  ${actual}\n\n` +
        "Every pool address the periphery derives would be wrong, and swaps\n" +
        "would revert in the callback rather than failing at deploy.\n\n" +
        "Fix: set POOL_INIT_CODE_HASH in PoolAddress.sol to the actual value\n" +
        "above, recompile, and re-run this check.",
    );
    process.exitCode = 1;
    return;
  }

  console.log("\nOK — declared hash matches this build.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
