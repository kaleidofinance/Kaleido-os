/** Routing is separate from the transaction grammar: a mentioned verb is not consent. */
export function isDirectInstruction(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (
    /\b(?:explain|analyse|analyze|compare|recommend|should|would it|worth|best|cheapest|safest|why|how does|how do|what if|later|thinking|think)\b/.test(
      t,
    )
  )
    return false;
  return /^(?:(?:hey\s+)?luca[,!]?\s+)?(?:please\s+)?(?:(?:can|could|would) you\s+)?(?:please\s+)?(?:swap|trade|convert|exchange|sell|buy|purchase|dump|unload|ape|cop|grab|snag|flip|yeet|spend|stake|unstake|approve|allow|send|transfer|bridge|borrow|lend|supply|offer|deposit|collateralise|collateralize|withdraw|repay|payback|take|draw|fill|fund|cancel|mint|redeem|lock|unlock|complete|collect|remove|faucet|claim|compound|add|increase|provide|reinvest|move|exit|migrate|wrap|unwrap|show|check|list|repeat|redo|receive|help)\b/.test(
    t,
  );
}

/** Only a small, explicit reference may reuse a previous transaction. */
export function isDirectFollowUp(text: string): boolean {
  return /^(?:please\s+)?(?:again|repeat(?: that)?|do (?:that|it)(?: again)?|same again|use .+|make (?:it|that) .+|instead .+)\s*[.!]?$/i.test(
    text.trim(),
  );
}

/** A pending slot cannot swallow an unrelated sentence. */
export function isSlotReply(
  text: string,
  knownValue: (value: string) => boolean,
): boolean {
  const value = text
    .trim()
    .replace(/^(?:use|on|in|as)\s+/i, "")
    .replace(/[.!]$/, "");
  return (
    /^(?:0x[0-9a-f]{40}|\d+(?:\.\d+)?(?:\s*(?:%|bps|days?|weeks?|months?|years?))?|all|half|max)$/i.test(
      value,
    ) || knownValue(value)
  );
}

/** Static text is limited to definitions; current product/market facts require tools. */
export function isStableExplanation(text: string): boolean {
  if (
    /\b(?:my|mine|our|your|kaleido|now|today|current|live|available|price|volume|revenue|tvl|balance|rate|apy|apr|best|cheapest|supported|support|chains?|networks?)\b/i.test(
      text,
    )
  )
    return false;
  return /^(?:what (?:is|are)|define|explain(?: what)?|how does)\s+(?:a |an |the )?(?:slippage|health factor|liquidation|impermanent loss|liquidity|a?\s*limit order|bridging|token approval|collateral|ltv)\b/i.test(
    text.trim(),
  );
}
