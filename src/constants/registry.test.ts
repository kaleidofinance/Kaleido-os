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
  auditDeployPlan,
  ownTokens,
  deployTarget,
  TESTNET_WAVE,
  tradableChains,
  DEPLOYMENTS,
  TOKENS,
} from "./registry.ts";
import { CHAINS, CHAINS_BY_ID } from "./chains.ts";

/** Mirrors how app code pairs the two modules: look up meta, then pass it. */
const meta = (chainId) => CHAINS_BY_ID[chainId];
const getNativeToken = (chainId, protocol) =>
  nativeTokenOf(meta(chainId), protocol);

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
const SEPOLIA = 11155111;
const BASE_SEPOLIA = 84532;
const ROBINHOOD_TESTNET = 46630;

console.log("\n— native asset is read per chain, never assumed —");
{
  const base = getNativeToken(BASE, "dex");
  check("Base native is ETH", base?.symbol === "ETH", base?.symbol);

  const bscTest = getNativeToken(BSC_TESTNET, "dex");
  check(
    "BNB testnet native is tBNB, not BNB",
    bscTest?.symbol === "tBNB",
    bscTest?.symbol,
  );

  const pol = getNativeToken(POLYGON, "dex");
  check(
    "Polygon native is POL, not MATIC or ETH",
    pol?.symbol === "POL",
    pol?.symbol,
  );

  const hype = getNativeToken(HYPERLIQUID, "dex");
  check("Hyperliquid native is HYPE", hype?.symbol === "HYPE", hype?.symbol);

  check(
    "unknown chain yields no native",
    getNativeToken(999999, "dex") === undefined,
  );
  check(
    "undefined chain yields no native",
    getNativeToken(undefined, "dex") === undefined,
  );
}

console.log(
  "\n— Arc: native USDC at 18 decimals, the case that breaks symbol rules —",
);
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
  check(
    "a symbol-based rule would have been wrong here",
    arc?.decimals !== wouldHaveBeen,
  );
}

console.log("\n— same symbol across chains is not the same asset —");
{
  const abstract = getNativeToken(ABSTRACT_TESTNET, "dex");
  const base = getNativeToken(BASE, "dex");
  const arb = getNativeToken(ARBITRUM, "dex");

  check(
    "all three call it ETH",
    abstract?.symbol === "ETH" &&
      base?.symbol === "ETH" &&
      arb?.symbol === "ETH",
  );
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
  check(
    "different sentinel address per protocol",
    dex?.address !== lending?.address,
  );
  check(
    "dex sentinel is the 0xEeee… convention",
    isNativeSentinel(dex.address, "dex"),
  );
  check(
    "lending sentinel is ADDRESS_1",
    isNativeSentinel(lending.address, "lending"),
  );
  check(
    "a dex sentinel is NOT valid for lending — the original bug",
    !isNativeSentinel(NATIVE_SENTINEL.dex, "lending"),
  );
  check(
    "sentinel comparison is case-insensitive",
    isNativeSentinel(NATIVE_SENTINEL.dex.toLowerCase(), "dex"),
  );
}

console.log("\n— user input resolves against the right chain —");
{
  const onBase = resolveUserToken(meta(BASE), "eth", "dex");
  check(
    "'eth' on Base resolves to Base's native",
    onBase?.chainId === BASE && onBase?.isNative,
  );

  const arcUsdc = resolveUserToken(meta(ARC_TESTNET), "usdc", "dex");
  check(
    "'usdc' on Arc resolves to the NATIVE asset",
    arcUsdc?.isNative === true,
    JSON.stringify(arcUsdc),
  );
  check(
    "…and therefore carries 18 decimals",
    arcUsdc?.decimals === 18,
    String(arcUsdc?.decimals),
  );

  check(
    "case insensitive",
    resolveUserToken(meta(BASE), "ETH", "dex")?.isNative === true,
  );
  check(
    "unknown symbol resolves to nothing",
    resolveUserToken(meta(BASE), "notacoin", "dex") === undefined,
  );
}

console.log("\n— deployments are checkable, not assumed —");
{
  // BASE here is Base *mainnet* (8453), where nothing is deployed and nothing is
  // planned this wave. These assert the absence is handled cleanly rather than
  // crashing or being faked.
  check(
    "no contracts for an undeployed chain",
    Object.keys(getContracts(BASE)).length === 0,
  );
  check("isDeployed is false while empty", isDeployed(BASE) === false);
  check(
    "undefined chain is safe",
    Object.keys(getContracts(undefined)).length === 0,
  );

  /* This was "tradableChains is empty until something deploys", which encoded the
   * pre-deploy world and so failed the moment Base Sepolia went live on
   * 2026-08-21 — a successful deploy should not break a test. Replaced with a
   * negative and a positive case, because the failure this guards against runs in
   * both directions: a tradableChains that returns everything puts an undeployed
   * mainnet in the chain switcher, and one that returns nothing leaves the app
   * with no tradable chains however much is deployed. */
  const tradable = tradableChains(CHAINS).map((c) => c.id);
  check(
    "no chain is tradable without contracts recorded",
    tradable.every((id) => Object.keys(getContracts(id)).length > 0),
  );
  check(
    "an undeployed chain is excluded",
    !tradable.includes(BASE),
  );
  check(
    "a deployed testnet is included",
    tradable.includes(BASE_SEPOLIA),
  );
  check(
    "getToken on an empty registry returns nothing",
    getToken(BASE, "0xabc") === undefined,
  );
}

console.log("\n— registry audit —");
{
  const problems = auditRegistry(CHAINS);
  check(
    "registry has no structural problems",
    problems.length === 0,
    problems.join("; "),
  );
}

console.log("\n— audit catches the late-failing deploy mistakes —");
{
  // These are the failures that do NOT surface at deploy time. A missing
  // poolInitCodeHash deploys cleanly and breaks at the first swap; a missing
  // pythContract deploys cleanly and breaks at the first price read. Asserting
  // them statically is the whole point of the audit.
  const stash = { ...DEPLOYMENTS };
  const clear = () =>
    Object.keys(DEPLOYMENTS).forEach((k) => delete DEPLOYMENTS[k]);
  const has = (problems, needle) => problems.some((p) => p.includes(needle));

  clear();
  DEPLOYMENTS[8453] = {
    v3Factory: "0x" + "a".repeat(40),
    v3Router: "0x" + "b".repeat(40),
  };
  let p = auditRegistry(CHAINS);
  check(
    "flags a factory with no poolInitCodeHash",
    has(p, "poolInitCodeHash"),
    p.join("; "),
  );
  check(
    "flags a router with no wrappedNative",
    has(p, "wrappedNative"),
    p.join("; "),
  );

  clear();
  DEPLOYMENTS[8453] = { priceOracle: "0x" + "c".repeat(40) };
  p = auditRegistry(CHAINS);
  check(
    "flags an oracle with no pythContract",
    has(p, "pythContract"),
    p.join("; "),
  );

  clear();
  DEPLOYMENTS[8453] = { kafUSD: "0x" + "d".repeat(40) };
  p = auditRegistry(CHAINS);
  check("flags kafUSD with no kfUSD", has(p, "nothing to wrap"), p.join("; "));
  check(
    "flags a stablecoin with no yieldTreasury",
    has(p, "yieldTreasury"),
    p.join("; "),
  );

  clear();
  DEPLOYMENTS[8453] = { diamond: "0xnope" };
  p = auditRegistry(CHAINS);
  check(
    "flags a malformed address",
    has(p, "not a well-formed address"),
    p.join("; "),
  );

  clear();
  DEPLOYMENTS[8453] = {
    v3Factory: "0x" + "a".repeat(40),
    poolInitCodeHash: "0xtooshort",
  };
  p = auditRegistry(CHAINS);
  check(
    "flags a malformed init code hash",
    has(p, "not a well-formed hash"),
    p.join("; "),
  );

  clear();
  DEPLOYMENTS[999999] = { diamond: "0x" + "e".repeat(40) };
  p = auditRegistry(CHAINS);
  check(
    "flags a chain absent from chains.ts",
    has(p, "not in chains.ts"),
    p.join("; "),
  );

  clear();
  Object.assign(DEPLOYMENTS, stash);
  check("restored to a clean registry", auditRegistry(CHAINS).length === 0);
}

console.log("\n— our own tokens follow DEPLOYMENTS, not a second list —");
{
  // The point of OWN_TOKENS is that the descriptor and the address live apart:
  // the identity is known now, the address only after deploy. Populating a
  // chain's contracts has to be the only step needed to make its tokens appear,
  // which is what the empty-registry cases below and the positive case after them
  // assert from both directions.
  const stash = { ...DEPLOYMENTS };
  const clear = () =>
    Object.keys(DEPLOYMENTS).forEach((k) => delete DEPLOYMENTS[k]);

  clear();
  for (const id of [SEPOLIA, BASE_SEPOLIA, ROBINHOOD_TESTNET]) {
    check(
      `chain ${id} has none of our tokens while undeployed`,
      ownTokens(id).length === 0,
    );
  }
  check("undefined chain is safe", ownTokens(undefined).length === 0);

  DEPLOYMENTS[SEPOLIA] = {
    kfUSD: "0x" + "1".repeat(40),
    yieldTreasury: "0x" + "2".repeat(40),
  };
  const ours = ownTokens(SEPOLIA);
  check("recording kfUSD makes it appear", ours.length === 1, ours.length);
  check("it carries the chain it came from", ours[0]?.chainId === SEPOLIA);
  check("and its declared decimals, not a guess", ours[0]?.decimals === 18);
  check(
    "the address is the recorded one, not a copy",
    ours[0]?.address === DEPLOYMENTS[SEPOLIA].kfUSD,
  );
  check(
    "a partial deploy does not invent the rest",
    ownTokens(SEPOLIA).every((t) => t.symbol === "kfUSD"),
  );

  clear();
  Object.assign(DEPLOYMENTS, stash);
  /* Asserts the RESTORE worked, not that Sepolia is undeployed.
   *
   * This was `ownTokens(SEPOLIA).length === 0`, which encoded the pre-deploy world
   * and broke the moment Sepolia's kfUSD went live on 2026-08-21 — the same way
   * the tradableChains assertion above did, and for the same reason. A successful
   * deploy must not fail a test.
   *
   * What this block actually has to guarantee is that it left no mutation behind
   * for the blocks that run after it, and that is a comparison against the stash
   * rather than against zero. The stash is a shallow copy, so the original entry
   * objects come back by reference and identity is the strict check. */
  check(
    "restored",
    Object.keys(DEPLOYMENTS).length === Object.keys(stash).length &&
      Object.keys(stash).every((k) => DEPLOYMENTS[k] === stash[k]),
  );
  /* And the invariant the block is really about, now that a real deploy exists to
   * state it against: a chain with a recorded kfUSD reports it. Held only by the
   * mock entry before, which could not distinguish "derives from DEPLOYMENTS"
   * from "derives from a test fixture". */
  check(
    "a really-deployed kfUSD appears without a second list",
    ownTokens(BASE_SEPOLIA).some(
      (t) => t.symbol === "kfUSD" && t.address === DEPLOYMENTS[BASE_SEPOLIA]?.kfUSD,
    ),
    JSON.stringify(ownTokens(BASE_SEPOLIA).map((t) => t.symbol)),
  );
}

console.log("\n— the testnet wave is checked against what exists —");
{
  const problems = auditDeployPlan(CHAINS);
  const has = (needle) => problems.some((p) => p.includes(needle));

  // Every wave chain must be a real testnet in chains.ts, and every symbol the
  // plan calls an existing counterparty must really be registered — otherwise
  // the plan quietly promises collateral that is not there.
  check(
    "no chain in the wave is unknown or mislabelled",
    !has("not in chains.ts") && !has("chains.ts calls it"),
    problems.join("; "),
  );
  check(
    "no counterparty is claimed that TOKENS lacks",
    !has("no such entry"),
    problems.join("; "),
  );
  check(
    "no mock duplicates a real contract",
    !has("already registers"),
    problems.join("; "),
  );

  // KLD is the one gap the plan cannot close on its own: nothing in
  // smart-contract/contracts mints it, so staking is untestable on every chain
  // until that exists. The audit must keep saying so rather than going quiet.
  check("KLD's missing contract is reported", has("KLD"), problems.join("; "));

  const wave = TESTNET_WAVE.map((t) => t.chainId);
  check(
    "the wave is exactly the five chains asked for",
    wave.length === 5 &&
      wave.includes(SEPOLIA) &&
      wave.includes(BASE_SEPOLIA) &&
      wave.includes(BSC_TESTNET) &&
      wave.includes(ROBINHOOD_TESTNET) &&
      wave.includes(ARC_TESTNET),
    wave.join(","),
  );
  // The wave and chains.ts must not drift apart. Every chain marked tradable and
  // testnet is one we intend to deploy to, so a chain gaining that pair in
  // chains.ts without gaining a plan here is a chain the UI will offer and the
  // deploy will skip.
  {
    const intended = CHAINS.filter(
      (c) => c.tradable && c.network === "testnet",
    ).map((c) => c.id);
    const missing = intended.filter((id) => !wave.includes(id));
    check(
      "every tradable testnet in chains.ts has a plan",
      missing.length === 0,
      missing.join(","),
    );
  }
  check(
    "steps are distinct so the order is unambiguous",
    new Set(TESTNET_WAVE.map((t) => t.step)).size === TESTNET_WAVE.length,
  );
  /* Robinhood testnet used to be the chain this check existed for — "no ERC20 at
   * all, so every asset must come from us". That was never verified against the
   * chain and it was false: Robinhood publishes a canonical L2 Weth for testnet
   * which carries deposit/withdraw and already holds ~1,914 WETH. So the
   * assertion is inverted from what it was, and the reason is recorded here
   * because the old version would now pass only by our ignoring the chain.
   *
   * What still holds is the half that was right: there is no canonical dollar
   * here. USDG is Robinhood's stablecoin and it is mainnet-only — its address
   * holds no code on 46630. So a mock USDC is genuinely required, and a mock
   * WETH is genuinely not. */
  const rh = deployTarget(ROBINHOOD_TESTNET);
  check(
    "Robinhood testnet uses the canonical L2 WETH rather than mocking one",
    rh?.counterparties.includes("WETH") === true && !rh?.mocks.includes("WETH"),
    `${rh?.counterparties.join(",")} / ${rh?.mocks.join(",")}`,
  );
  check(
    "and still mocks the dollar, because USDG is mainnet-only",
    rh?.mocks.includes("USDC") === true,
    rh?.mocks.join(","),
  );
  check(
    "the counterparty it claims is really in TOKENS at 18 decimals",
    (TOKENS[ROBINHOOD_TESTNET] ?? []).some(
      (t) =>
        t.symbol === "WETH" &&
        t.decimals === 18 &&
        t.tags?.includes("wrapped-native") === true,
    ),
    JSON.stringify(
      (TOKENS[ROBINHOOD_TESTNET] ?? []).map((t) => `${t.symbol}@${t.decimals}`),
    ),
  );
  // BSC is the chain where a defaulted ETH price feed would misprice collateral
  // rather than merely look wrong, so the plan must name a counterparty that is
  // not ether-denominated.
  const bsc = deployTarget(BSC_TESTNET);
  check(
    "BSC testnet trades against WBNB, not a wrapped ether",
    bsc?.counterparties.includes("WBNB") && !bsc?.mocks.includes("WETH"),
    `${bsc?.counterparties.join(",")} / ${bsc?.mocks.join(",")}`,
  );
  // Arc's native currency is USDC, so the dollar is the gas token. The chain
  // turned out to issue a canonical 6-decimal USDC anyway, so this no longer
  // asserts "don't invent a second dollar" but the stronger "use the one that is
  // already there" — a mock USDC here would sit beside a canonical one.
  const arc = deployTarget(ARC_TESTNET);
  check(
    "Arc testnet does not mock a second USDC alongside its USDC native",
    arc !== undefined && !arc.mocks.includes("USDC"),
    arc?.mocks.join(","),
  );
  check(
    "and claims the canonical USDC and wrapped USDC it actually has",
    arc?.counterparties.includes("USDC") === true &&
      arc?.counterparties.includes("WUSDC") === true,
    arc?.counterparties.join(","),
  );
  // The 0x3600 predeploy is the ERC20 face of the native balance, not a token
  // beside it, so it is one dollar at 6 decimals and the native asset is the same
  // dollar at 18. Both are recorded on purpose; what must never happen is the two
  // being given the same decimals, because then one of them is silently wrong by
  // a factor of 1e12.
  {
    const arcTokens = TOKENS[ARC_TESTNET] ?? [];
    const usdc = arcTokens.find((t) => t.symbol === "USDC");
    const wusdc = arcTokens.find((t) => t.symbol === "WUSDC");
    check(
      "Arc's canonical USDC is the 6-decimal predeploy",
      usdc?.address === "0x3600000000000000000000000000000000000000" &&
        usdc?.decimals === 6,
      `${usdc?.address} @ ${usdc?.decimals}dp`,
    );
    check(
      "Arc's wrapped native is WUSDC at 18 decimals, matching the native asset",
      wusdc?.decimals === 18 &&
        wusdc?.tags?.includes("wrapped-native") === true &&
        meta(ARC_TESTNET)?.nativeCurrency.decimals === 18,
      `${wusdc?.decimals}dp / native ${meta(ARC_TESTNET)?.nativeCurrency.decimals}dp`,
    );
    // cirBTC is the one asset on this chain whose decimals are neither 6 nor 18,
    // and the faucet hands it out at 8 like every other wrapped bitcoin. Assuming
    // 18 would read a 0.0001 BTC balance as 1e-14 BTC; assuming 6 overstates it
    // 100-fold. Pinned because nothing else in the codebase uses 8.
    const cirbtc = arcTokens.find((t) => t.symbol === "cirBTC");
    check(
      "Arc's cirBTC is the Circle FiatTokenProxy at 8 decimals",
      cirbtc?.address === "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF" &&
        cirbtc?.decimals === 8,
      `${cirbtc?.address} @ ${cirbtc?.decimals}dp`,
    );
    // ArcScan returns ten tokens whose symbol is some case of "cirBTC", several at
    // 8 decimals and one calling itself "Wrapped Bitcoin". Symbol plus decimals
    // therefore does not identify the real one, so the address above is the whole
    // assertion — and it must never be duplicated by a second cirBTC-ish entry.
    check(
      "and is the only BTC-denominated entry on the chain",
      arcTokens.filter((t) => t.symbol.toLowerCase().includes("btc")).length ===
        1,
      arcTokens
        .filter((t) => t.symbol.toLowerCase().includes("btc"))
        .map((t) => t.symbol)
        .join(","),
    );
    // Every Arc entry is a distinct contract. The chain's three faces of one
    // dollar make a copy-paste address the easy mistake here, and two symbols
    // sharing an address silently merges two markets into one.
    check(
      "no two Arc token entries share an address",
      new Set(arcTokens.map((t) => t.address.toLowerCase())).size ===
        arcTokens.length,
      `${arcTokens.length} entries`,
    );
    // The faucet assets Circle actually hands out here, all three confirmed as
    // real deployer balances on 2026-08-22. USYC is documented on Arc too and is
    // deliberately NOT listed: its Entitlements allowlist would make every swap
    // and liquidation against it revert.
    check(
      "Arc lists all three Circle faucet assets",
      ["USDC", "EURC", "cirBTC"].every((s) =>
        arcTokens.some((t) => t.symbol === s),
      ) && !arcTokens.some((t) => t.symbol === "USYC"),
      arcTokens.map((t) => t.symbol).join(","),
    );
  }
  check(
    "a chain outside the wave has no plan",
    deployTarget(BASE) === undefined,
  );
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
