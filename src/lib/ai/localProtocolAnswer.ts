import { ARGUS_CHAIN_ID } from "@/lib/argus/addresses";
import { launchpadIntegrations } from "./integrationCatalog";

const ARC_CHAIN_ID = ARGUS_CHAIN_ID;

const LAUNCHPAD_WORD = /\blaunch\s*pad(?:s)?\b/i;
const CATALOG_WORD =
  /\b(?:how\s+many|which|what|does|do|can|support|supported|integrat|available|live|on)\b/i;
const ACTION_WORD =
  /\b(?:launch|deploy|create|buy|sell|trade|list|mint)\b(?:(?!\blaunch\s*pad(?:s)?\b).){0,48}\b(?:token|coin|contract|project)\b/i;

/**
 * Answers only the catalogue question Luca can prove without a chain read.
 *
 * This is intentionally narrower than a general FAQ matcher. A user asking
 * how many launchpads are integrated needs the registered adapter inventory;
 * a user asking Luca to launch or trade a token must continue to the planner,
 * live token card, and auditor instead of receiving a static paragraph.
 */
export function launchpadQuestion(text: string): boolean {
  const normalized = text.trim();
  return (
    LAUNCHPAD_WORD.test(normalized) &&
    CATALOG_WORD.test(normalized) &&
    !ACTION_WORD.test(normalized)
  );
}

export function launchpadAnswer(
  text: string,
  opts: { chainId?: number; showTestnets: boolean },
): string | null {
  if (!launchpadQuestion(text)) return null;

  const arcLaunchpads = launchpadIntegrations(ARC_CHAIN_ID, "mainnet");
  const launchpadNames = arcLaunchpads.map((item) => item.name);
  const launchpadCount = arcLaunchpads.length;
  const launchpadList = launchpadNames.join(" and ");
  const asksArc = /\barc\b/i.test(text);
  const asksOtherChain = /\b(?:bnb|bsc|binance|robinhood|elysium|base|sepolia)\b/i.test(text);
  const arcScope = asksArc || (!asksOtherChain && opts.chainId === ARC_CHAIN_ID);

  if (arcScope || launchpadIntegrations(opts.chainId, "mainnet").length > 0) {
    return `Kaleido currently integrates ${launchpadCount} launchpads on Arc: ${launchpadList}. They are separate from swap aggregators. Luca can inspect a pasted launch token and build a trade only after live metadata plus curve or pool verification passes, so a launch is not automatically routeable.`;
  }

  if (opts.showTestnets) {
    return "Launchpad integrations are currently registered on Arc mainnet only: Argus and Peach. The testnet catalog has no launchpad adapter yet.";
  }

  if (asksOtherChain || opts.chainId !== ARC_CHAIN_ID) {
    if (!asksOtherChain && opts.chainId === undefined) {
      return `Kaleido currently integrates ${launchpadCount} launchpads on Arc: ${launchpadList}. They are separate from swap aggregators. Luca verifies a pasted launch token before building a trade.`;
    }
    return `Kaleido currently has ${launchpadCount} launchpad integrations, all on Arc: ${launchpadList}. No launchpad adapter is registered on this chain yet.`;
  }

  return null;
}
