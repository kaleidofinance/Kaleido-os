/**
 * Read the frontend's generated deployment registry from a hardhat script.
 *
 * `src/constants/deployments.generated.ts` is the one place that knows which
 * contract is at which address on which chain, and it is generated from the
 * `deployment-*.json` records these scripts write. Scripts that re-derive an
 * address by re-reading those records get to disagree with the app about what is
 * deployed — which is the whole class of bug the generated file exists to close.
 * So they read it instead.
 *
 * Parsed rather than imported: it is a TypeScript module, and pulling tsx into a
 * `hardhat run` to evaluate a file of string literals is a heavier dependency
 * than a regex over something nothing here writes to. The shape is machine-
 * generated and stable — `gen-registry.mjs` emits one `key: "0x…",` per line —
 * so the parse is checked rather than trusted: a chain with no address at all
 * throws instead of returning an empty object that later reads as "not deployed".
 */

const fs = require("fs");
const path = require("path");

const GENERATED = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "constants",
  "deployments.generated.ts",
);

/**
 * Every address recorded for one chain, keyed as the app keys them
 * (`diamond`, `v3Router`, `usdt`, …). Non-address fields such as `oracleKind`
 * and the multi-line `poolInitCodeHash` are skipped: callers that need those
 * should read the deployment record, since a hex string that is not an address
 * would fail an `isAddress` check in every consumer here anyway.
 */
function registryFor(chainId) {
  const src = fs.readFileSync(GENERATED, "utf8");
  const marker = `\n  ${chainId}: {`;
  const at = src.indexOf(marker);
  if (at === -1)
    throw new Error(
      `chain ${chainId} is not in deployments.generated.ts — run npm run gen:registry after deploying`,
    );
  const body = src.slice(at + marker.length);
  const out = {};
  for (const line of body.split("\n")) {
    if (line.startsWith("  },")) break;
    const m = line.match(/^\s{4}(\w+):\s*"(0x[0-9a-fA-F]{40})"/);
    if (m) out[m[1]] = m[2];
  }
  if (Object.keys(out).length === 0)
    throw new Error(`chain ${chainId} parsed to no addresses — the generated file's shape changed`);
  return out;
}

module.exports = { registryFor, GENERATED };
