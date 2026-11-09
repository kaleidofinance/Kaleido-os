/**
 * HyperEVM (999) ↔ Elysium (99901) bridge surface, checked offline.
 *
 *   npx tsx src/lib/bridge/hyperElysium.test.ts
 *
 * Covers the eight assets Kalos bridges (HYPE, USDC, KNTQ, WHYPE, kHYPE, USD₮0,
 * UBTC, UETH): both chains resolve each symbol (USDT0 typed as ASCII too), the
 * provider is asked by contract on these chains (LI.FI calls Elysium USDC
 * "USDCe"), the HyperEVM LI.FI diamond is an admitted spender, "HyperEVM"
 * names chain 999, and the Orbit Inbox fallback is a known canonical target.
 */

import { chainTokenBySymbol, bridgeSourceCandidates } from "@/constants/tokens";
import { providerTokenRef, resolveChain } from "@/lib/ai/bridgeQuotes";
import {
  isKnownBridgeAddress,
  isKnownBridgeSpender,
  isOrbitDeposit,
  ORBIT_DEPOSIT_ETH_DATA,
} from "@/lib/bridge/route";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`  FAIL: ${name}${extra === undefined ? "" : ` — ${JSON.stringify(extra)}`}`);
  }
}

const ZERO = "0x0000000000000000000000000000000000000000";
const PAIRS: Array<[string, string | null, string | null, number]> = [
  ["HYPE", null, null, 18],
  ["USDC", "0xb88339CB7199b77E23DB6E890353E22632Ba630f", "0xb47c4C8F73F009CC0C0d3f92B388d13E293F0B65", 6],
  ["KNTQ", "0x000000000000780555bD0BCA3791f89f9542c2d6", "0xe45a355d9e9cAd2aD85F2d03E3eE3102A036acF0", 18],
  ["WHYPE", "0x5555555555555555555555555555555555555555", "0xbA876237B0F021A6c6D852d6c26E107997cC5E81", 18],
  ["kHYPE", "0xfD739d4e423301CE9385c1fb8850539D657C296D", "0x248888D396A546A69A188f3Deb476964e581E9d0", 18],
  ["USD\u20ae0", "0xB8CE59FC3717ada4C02eaDF9682A9e934F625ebb", "0x3BdE42a1dA8F1D95564f2c4a51a0cF73a725674C", 6],
  ["UBTC", "0x9FDBdA0A5e284c32744D2f17Ee5c74B284993463", "0xE9C29585EAe4B9a55b02a9605AEa892B40d972E8", 8],
  ["UETH", "0xBe6727B535545C67d5cAa73dEa54865B92CF7907", "0x7A66A75fe41Bc26867C17fe1bc7D1C076EBd4eCd", 18],
];
const eq = (a?: string | null, b?: string | null) =>
  (a ?? "").toLowerCase() === (b ?? "").toLowerCase();

for (const [sym, parent, child, dec] of PAIRS) {
  for (const [chain, addr] of [[999, parent], [99901, child]] as const) {
    const t = chainTokenBySymbol(chain, sym);
    check(`${sym} resolves on ${chain}`, !!t);
    if (!t) continue;
    check(`${sym} decimals on ${chain}`, t.decimals === dec, t.decimals);
    if (addr) check(`${sym} address on ${chain}`, eq(t.address, addr), t.address);
    else check(`${sym} is native on ${chain}`, !!t.isNative);
    check(
      `${sym} provider ref on ${chain}`,
      eq(providerTokenRef(chain, sym), addr ?? ZERO),
      providerTokenRef(chain, sym),
    );
  }
}

// ASCII spelling of USD₮0, in any case.
for (const typed of ["USDT0", "usdt0", "UsDt0"]) {
  check(`${typed} → USD₮0 on 999`, eq(chainTokenBySymbol(999, typed)?.address, PAIRS[5][1]));
  check(`${typed} → USD₮0 on 99901`, eq(chainTokenBySymbol(99901, typed)?.address, PAIRS[5][2]));
}
check(
  "USDT0 bridge sources include both chains",
  ["Hyperliquid", "Elysium"].every((n) =>
    bridgeSourceCandidates("USDT0", "mainnet").some((c) => c.chainName === n),
  ),
);

// Off the address-quoted chains the symbol path is untouched.
check("Base USDC still by symbol", providerTokenRef(8453, "USDC") === "USDC");

// Chain naming.
for (const n of ["HyperEVM", "hyperevm", "HyperEVM chain", "Hyperliquid EVM", "Hyperliquid"])
  check(`"${n}" → 999`, resolveChain(n)?.id === 999, resolveChain(n)?.id);
check(`"Elysium" → 99901`, resolveChain("Elysium")?.id === 99901);

// Spenders and canonical targets.
check("HyperEVM LI.FI diamond admitted", isKnownBridgeSpender("0x0a0758d937d1059c356D4714e57F5df0239bce1A"));
check("Elysium LI.FI diamond admitted", isKnownBridgeSpender("0x24E6dA91AA4A8FEe2447F542c92E006243bd6Dc5"));
const INBOX = "0xce59f8B65ad41C9DAE4c07A0571a39824bD92cff";
check("Orbit inbox known on 999", isKnownBridgeAddress(999, INBOX));
check("Orbit inbox NOT known on 99901", !isKnownBridgeAddress(99901, INBOX));
check("Orbit inbox is not an approvable spender", !isKnownBridgeSpender(INBOX));
check("depositEth recognised", isOrbitDeposit(999, INBOX, ORBIT_DEPOSIT_ETH_DATA));
check("other calldata not a depositEth", !isOrbitDeposit(999, INBOX, "0xdeadbeef"));

console.log(`hyperElysium: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
