// Write the app's contract ABIs (src/abi/*.json) from the compiled Hardhat artifacts.
//
//   npm run gen:abis           rewrite every mapped file from smart-contract/artifacts
//   npm run test:abis          --check: exit 1 if any file differs from its artifact
//
// Why: src/abi/ was hand-copied, and it drifted — the app's ProtocolFacet still listed
// the removed pyth()/pythPriceOracle() and lacked Protocol__Paused, OwnershipFacet had
// no two-step ownership, LendingAdminFacet had no ABI at all. A revert the app cannot
// name reaches the user as a raw selector (see src/lib/v2/protocolErrors.ts).
//
// Artifacts are not committed (smart-contract/artifacts is build output), so --check
// needs `cd smart-contract && npx hardhat compile` first. Without artifacts it says so
// and exits 0 — loudly, with SKIPPED — because a checkout that never compiled contracts
// has nothing to compare against, not a drift.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARTIFACTS = path.join(ROOT, "smart-contract", "artifacts", "contracts");
const OUT = path.join(ROOT, "src", "abi");

/** src/abi file → artifact path under smart-contract/artifacts/contracts. */
export const ABI_MAP = {
  "ProtocolFacet.json": "facets/ProtocolFacet.sol/ProtocolFacet.json",
  "OwnershipFacet.json": "facets/OwnershipFacet.sol/OwnershipFacet.json",
  "AgentPermissionFacet.json": "facets/AgentPermissionFacet.sol/AgentPermissionFacet.json",
  "DiamondLoupeFacet.json": "facets/DiamondLoupeFacet.sol/DiamondLoupeFacet.json",
  "LendingAdminFacet.json": "facets/LendingAdminFacet.sol/LendingAdminFacet.json",
  "PushablePriceFeed.json": "utils/oracle/PushablePriceFeed.sol/PushablePriceFeed.json",
  "TokenFaucet.json": "Faucet.sol/KaleidoTokenFaucet.json",
  "KLDVaultAbi.json": "Staking/Modernized/KLDVaultV2.sol/KLDVaultV2.json",
  "StKLDAbi.json": "Staking/Modernized/StKLD.sol/StKLD.json",
};

const render = (abi) => `${JSON.stringify(abi, null, 2)}\n`;

const check = process.argv.includes("--check");
const missing = Object.values(ABI_MAP).filter((a) => !fs.existsSync(path.join(ARTIFACTS, a)));
if (missing.length) {
  const msg = `artifacts missing (${missing.length}/${Object.keys(ABI_MAP).length}) — run \`cd smart-contract && npx hardhat compile\` first`;
  if (check) {
    console.log(`SKIPPED: ${msg}`);
    process.exit(0);
  }
  console.error(msg);
  process.exit(1);
}

let drift = 0;
for (const [file, artifact] of Object.entries(ABI_MAP)) {
  const abi = JSON.parse(fs.readFileSync(path.join(ARTIFACTS, artifact), "utf8")).abi;
  const want = render(abi);
  const target = path.join(OUT, file);
  const have = fs.existsSync(target) ? fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") : null;
  if (have === want) {
    console.log(`  ok       ${file}`);
    continue;
  }
  if (check) {
    drift++;
    console.log(`  DRIFT    ${file}  (regenerate: npm run gen:abis)`);
  } else {
    fs.writeFileSync(target, want);
    console.log(`  written  ${file}  (${abi.length} fragments)`);
  }
}
if (check) {
  console.log(drift ? `\n${drift} ABI file(s) differ from the artifacts.` : "\nAll ABIs match the artifacts.");
  process.exit(drift ? 1 : 0);
}
