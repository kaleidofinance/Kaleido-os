/**
 * Per-chain rules on WHICH assets may be registered with the lending diamond.
 *
 * Registration is the least reversible thing the protocol does: a loanable token
 * can never be removed, and removing collateral strands its depositors. So the
 * three asset mistakes this project has already made, or nearly made, are
 * refused here before anything is sent, rather than written up after:
 *
 *   1. Native priced as the wrong asset. register-tokens.js prices `NATIVE`
 *      (address(1)) with NATIVE_FEED_SYMBOL, which defaults to ETH. On Arc the
 *      native currency IS USDC, so the default values every native deposit at
 *      ETH's price (~2,700x). It happened on BSC testnet's BNB (caught) and a
 *      stale `NATIVE_FEED_SYMBOL=BNB` is recorded against Sepolia.
 *
 *   2. The same dollar registered twice. On Arc, `0x3600…` is the system
 *      ERC20 face of the native USDC balance — its balanceOf mirrors native to
 *      the wei. Registering both it and NATIVE creates two ledger keys over one
 *      asset, and CannotBorrowCollateralAsset compares ADDRESSES, so a user could
 *      borrow USDC against their own USDC.
 *
 *   3. A token whose on-chain identity lies. Arc mainnet's wrapped native at
 *      0x8c6c… is a stock WETH9 we deployed: it reports "WETH / Wrapped Ether"
 *      but wraps USDC. It already opened a pool ~2,400x mispriced once, because a
 *      script read its symbol and priced it as ether.
 */

const ARC_NATIVE_ALIAS = "0x3600000000000000000000000000000000000000";

/** The feed symbol the native currency MUST be priced by, per chain. */
const NATIVE_SYMBOL = {
  1: "ETH",
  56: "BNB",
  97: "BNB",
  4663: "ETH",
  5042: "USDC",
  8453: "ETH",
  46630: "ETH",
  84532: "ETH",
  5042002: "USDC",
  11155111: "ETH",
};

/** ERC20s that ARE the native balance under another address. */
const NATIVE_ALIASES = {
  5042: [ARC_NATIVE_ALIAS],
  5042002: [ARC_NATIVE_ALIAS],
};

/** Addresses never to register on a chain, with the reason printed on refusal. */
const FORBIDDEN = {
  5042: {
    [ARC_NATIVE_ALIAS.toLowerCase()]:
      "the 6-decimal ERC20 face of native USDC — register NATIVE instead, never both",
    "0x8c6c0a4c5500c2bc196383b4d85feb7f08a5c75b":
      "our WETH9 wrapper: reads \"WETH\" on chain but wraps USDC (the 2,400x seed mispricing)",
  },
};

/**
 * @param {number} chainId
 * @param {{symbol: string, address: string, isNative: boolean}[]} tokens
 *        Every token in the run, collateral and loanable together.
 * @param {string} nativeFeedSymbol  What NATIVE will be priced by.
 * @returns {string[]} Problems; empty means the list is allowed.
 */
function assetRuleViolations(chainId, tokens, nativeFeedSymbol) {
  const id = Number(chainId);
  const problems = [];
  const hasNative = tokens.some((t) => t.isNative);

  if (hasNative) {
    const want = NATIVE_SYMBOL[id];
    if (!want) {
      problems.push(
        `No native-currency symbol is recorded for chain ${id}, so NATIVE cannot be ` +
          "checked. Add it to NATIVE_SYMBOL in scripts/libraries/chain-asset-rules.js.",
      );
    } else if (String(nativeFeedSymbol).toUpperCase() !== want) {
      problems.push(
        `NATIVE would be priced as ${nativeFeedSymbol}, but chain ${id}'s native ` +
          `currency is ${want}. Set NATIVE_FEED_SYMBOL=${want}.`,
      );
    }
  }

  const aliases = (NATIVE_ALIASES[id] || []).map((a) => a.toLowerCase());
  const aliasHit = tokens.find((t) => aliases.includes(t.address.toLowerCase()));
  if (hasNative && aliasHit) {
    problems.push(
      `${aliasHit.symbol} (${aliasHit.address}) is the same balance as NATIVE on chain ${id}. ` +
        "Registering both lets a user borrow the asset against itself. Pick one.",
    );
  }

  const forbidden = FORBIDDEN[id] || {};
  for (const t of tokens) {
    const why = forbidden[t.address.toLowerCase()];
    if (why) problems.push(`${t.symbol} (${t.address}) must not be registered on chain ${id}: ${why}.`);
  }

  return problems;
}

module.exports = { NATIVE_SYMBOL, NATIVE_ALIASES, FORBIDDEN, assetRuleViolations };
