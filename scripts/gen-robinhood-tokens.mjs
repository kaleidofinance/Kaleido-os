/**
 * Generate src/constants/robinhoodTokens.generated.ts from Robinhood Chain's
 * official on-chain asset registry.
 *
 *   node scripts/gen-robinhood-tokens.mjs
 *
 * Source of truth: https://api.robinhood.com/rhj/assets — the same registry the
 * Robinhood Chain docs' "Token Contracts" page renders live. Each asset is a
 * canonical tokenized stock/ETF on chain 4663 (all 18-dec ERC-20). We take only
 * ACTIVE assets that carry a 4663 deployment, so a delisted or not-yet-deployed
 * symbol never lands in the token list. WETH and USDG are NOT here — they are
 * not stock assets and stay hand-written in registry.ts's TOKENS[4663] core.
 *
 * Re-run whenever Robinhood adds/removes stock tokens; the output is sorted by
 * symbol so the diff is legible.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ethers } from "ethers";

const CHAIN_ID = 4663;
const API = "https://api.robinhood.com/rhj/assets";
const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "constants",
  "robinhoodTokens.generated.ts",
);

const res = await fetch(API, { headers: { accept: "application/json" } });
if (!res.ok) throw new Error(`assets API ${res.status}`);
const { assets } = await res.json();
if (!Array.isArray(assets)) throw new Error("unexpected shape: no assets[]");

const rows = [];
for (const a of assets) {
  if (a.status !== "ASSET_STATUS_ACTIVE") continue;
  const dep = (a.deployments ?? []).find((d) => d.chainId === CHAIN_ID);
  if (!dep?.contractAddress || !ethers.isAddress(dep.contractAddress)) continue;
  rows.push({
    chainId: CHAIN_ID,
    address: ethers.getAddress(dep.contractAddress),
    symbol: a.tokenSymbol,
    name: a.tokenName,
    decimals: Number(a.tokenDecimals ?? 18),
    tags: ["stock"],
    logoURI: a.logoUrl || undefined,
  });
}
rows.sort((x, y) => x.symbol.localeCompare(y.symbol));

const body = rows
  .map((r) => {
    const parts = [
      `chainId: ${r.chainId}`,
      `address: ${JSON.stringify(r.address)}`,
      `symbol: ${JSON.stringify(r.symbol)}`,
      `name: ${JSON.stringify(r.name)}`,
      `decimals: ${r.decimals}`,
      `tags: ["stock"]`,
    ];
    if (r.logoURI) parts.push(`logoURI: ${JSON.stringify(r.logoURI)}`);
    return `  { ${parts.join(", ")} },`;
  })
  .join("\n");

const header = `/**
 * GENERATED FILE — do not edit by hand.
 * Regenerate: node scripts/gen-robinhood-tokens.mjs
 *
 * Robinhood Chain (chainId ${CHAIN_ID}) canonical tokenized stocks/ETFs, from the
 * official asset registry (${API}). ${rows.length} ACTIVE assets, all ERC-20.
 * WETH and USDG are NOT here — they are the hand-written core in registry.ts.
 */
import type { TokenEntry } from "./registry";

export const ROBINHOOD_STOCK_TOKENS: TokenEntry[] = [
${body}
];
`;

writeFileSync(OUT, header, "utf8");
console.log(`wrote ${rows.length} stock tokens -> ${OUT}`);
