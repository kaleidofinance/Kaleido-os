// Checks on the chain-keyed registry. Run with plain node.
//
// These pin the multichain hazards the old Abstract-only constants hid:
// nine chains sharing the "ETH" symbol, BNB changing ticker on testnet, and
// Arc's native USDC being 18 decimals where ERC20 USDC is 6 everywhere else.
import {
  NATIVE_SENTINEL,
  isNativeSentinel,
  nativeTokenOf,
  resolveUserToken,
  getToken,
  getContracts,
  isDeployed,
  auditRegistry,
  tradableChains,
  DEPLOYMENTS,
} from "./registry.ts";
import { CHAINS, CHAINS_BY_ID } from "./chains.ts";

/** Mirrors how app code pairs the two modules: look up meta, then pass it. */
const meta = (chainId) => CHAINS_BY_ID[chainId];
const getNativeToken = (chainId, protocol) => nativeTokenOf(meta(chainId), protocol);

let pass = 0;
let fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const ABSTRACT_TESTNET = 11124;
const BASE = 8453;
const ARBITRUM = 42161;
const BSC_TESTNET = 97;
const ARC_TESTNET = 5042002;
const POLYGON = 137;
const HYPERLIQUID = 999;

console.log("\n— native asset is read per chain, never assumed —");
{
  const base = getNativeToken(BASE, "dex");
  check("Base native is ETH", base?.symbol === "ETH", base?.symbol);

  const bscTest = getNativeToken(BSC_TESTNET, "dex");
  check("BNB testnet native is tBNB, not BNB", bscTest?.symbol === "tBNB", bscTest?.symbol);

  const pol = getNativeToken(POLYGON, "dex");
  check("Polygon native is POL, not MATIC or ETH", pol?.symbol === "POL", pol?.symbol);

  const hype = getNativeToken(HYPERLIQUID, "dex");
  check("Hyperliquid native is HYPE", hype?.symbol === "HYPE", hype?.symbol);

  check("unknown chain yields no native", getNativeToken(999999, "dex") === undefined);
  check("undefined chain yields no native", getNativeToken(undefined, "dex") === undefined);
}

console.log("\n— Arc: native USDC at 18 decimals, the case that breaks symbol rules —");
{
  const arc = getNativeToken(ARC_TESTNET, "dex");
  check("Arc native symbol is USDC", arc?.symbol === "USDC", arc?.symbol);
  check(
    "Arc native is 18 decimals, NOT the 6 that USDC means elsewhere",
    arc?.decimals === 18,
    String(arc?.decimals),
  );

  // The whole point: a symbol-keyed decimals table would return 6 here and be
  // wrong by a factor of a trillion.
  const wouldHaveBeen = 6;
  check("a symbol-based rule would have been wrong here", arc?.decimals !== wouldHaveBeen);
}

console.log("\n— same symbol across chains is not the same asset —");
{
  const abstract = getNativeToken(ABSTRACT_TESTNET, "dex");
  const base = getNativeToken(BASE, "dex");
  const arb = getNativeToken(ARBITRUM, "dex");

  check("all three call it ETH", abstract?.symbol === "ETH" && base?.symbol === "ETH" && arb?.symbol === "ETH");
  check(
    "but they are distinct entries, keyed by chain",
    abstract?.chainId !== base?.chainId && base?.chainId !== arb?.chainId,
  );
}

console.log("\n— the sentinel depends on the protocol, not the chain —");
{
  const dex = getNativeToken(BASE, "dex");
  const lending = getNativeToken(BASE, "lending");

  check("same chain, same symbol", dex?.symbol === lending?.symbol);
  check("different sentinel address per protocol", dex?.address !== lending?.address);
  check("dex sentinel is the 0xEeee… convention", isNativeSentinel(dex.address, "dex"));
  check("lending sentinel is ADDRESS_1", isNativeSentinel(lending.address, "lending"));
  check(
    "a dex sentinel is NOT valid for lending — the original bug",
    !isNativeSentinel(NATIVE_SENTINEL.dex, "lending"),
  );
  check("sentinel comparison is case-insensitive", isNativeSentinel(NATIVE_SENTINEL.dex.toLowerCase(), "dex"));
}

console.log("\n— user input resolves against the right chain —");
{
  const onBase = resolveUserToken(meta(BASE), "eth", "dex");
  check("'eth' on Base resolves to Base's native", onBase?.chainId === BASE && onBase?.isNative);

  const arcUsdc = resolveUserToken(meta(ARC_TESTNET), "usdc", "dex");
  check("'usdc' on Arc resolves to the NATIVE asset", arcUsdc?.isNative === true, JSON.stringify(arcUsdc));
  check("…and therefore carries 18 decimals", arcUsdc?.decimals === 18, String(arcUsdc?.decimals));

  check("case insensitive", resolveUserToken(meta(BASE), "ETH", "dex")?.isNative === true);
  check("unknown symbol resolves to nothing", resolveUserToken(meta(BASE), "notacoin", "dex") === undefined);
}

console.log("\n— deployments are checkable, not assumed —");
{
  // Deliberately empty until the fresh multichain deploy lands. These assert
  // the *absence* is handled cleanly rather than crashing or being faked.
  check("no contracts for an undeployed chain", Object.keys(getContracts(BASE)).length === 0);
  check("isDeployed is false while empty", isDeployed(BASE) === false);
  check("undefined chain is safe", Object.keys(getContracts(undefined)).length === 0);
  check("tradableChains is empty until something deploys", tradableChains(CHAINS).length === 0);
  check("getToken on an empty registry returns nothing", getToken(BASE, "0xabc") === undefined);
}

console.log("\n— registry audit —");
{
  const problems = auditRegistry(CHAINS);
  check("registry has no structural problems", problems.length === 0, problems.join("; "));
}

console.log("\n— audit catches the late-failing deploy mistakes —");
{
  // These are the failures that do NOT surface at deploy time. A missing
  // poolInitCodeHash deploys cleanly and breaks at the first swap; a missing
  // pythContract deploys cleanly and breaks at the first price read. Asserting
  // them statically is the whole point of the audit.
  const stash = { ...DEPLOYMENTS };
  const clear = () => Object.keys(DEPLOYMENTS).forEach((k) => delete DEPLOYMENTS[k]);
  const has = (problems, needle) => problems.some((p) => p.includes(needle));

  clear();
  DEPLOYMENTS[8453] = { v3Factory: "0x" + "a".repeat(40), v3Router: "0x" + "b".repeat(40) };
  let p = auditRegistry(CHAINS);
  check("flags a factory with no poolInitCodeHash", has(p, "poolInitCodeHash"), p.join("; "));
  check("flags a router with no wrappedNative", has(p, "wrappedNative"), p.join("; "));

  clear();
  DEPLOYMENTS[8453] = { priceOracle: "0x" + "c".repeat(40) };
  p = auditRegistry(CHAINS);
  check("flags an oracle with no pythContract", has(p, "pythContract"), p.join("; "));

  clear();
  DEPLOYMENTS[8453] = { kafUSD: "0x" + "d".repeat(40) };
  p = auditRegistry(CHAINS);
  check("flags kafUSD with no kfUSD", has(p, "nothing to wrap"), p.join("; "));
  check("flags a stablecoin with no yieldTreasury", has(p, "yieldTreasury"), p.join("; "));

  clear();
  DEPLOYMENTS[8453] = { diamond: "0xnope" };
  p = auditRegistry(CHAINS);
  check("flags a malformed address", has(p, "not a well-formed address"), p.join("; "));

  clear();
  DEPLOYMENTS[8453] = { v3Factory: "0x" + "a".repeat(40), poolInitCodeHash: "0xtooshort" };
  p = auditRegistry(CHAINS);
  check("flags a malformed init code hash", has(p, "not a well-formed hash"), p.join("; "));

  clear();
  DEPLOYMENTS[999999] = { diamond: "0x" + "e".repeat(40) };
  p = auditRegistry(CHAINS);
  check("flags a chain absent from chains.ts", has(p, "not in chains.ts"), p.join("; "));

  clear();
  Object.assign(DEPLOYMENTS, stash);
  check("restored to a clean registry", auditRegistry(CHAINS).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
