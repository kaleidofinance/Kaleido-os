import { ARGUS_CHAIN_ID } from "@/lib/argus/addresses";
import { CHAINS, getChainMeta } from "@/constants/chains";
import {
  integrationNameList,
  launchpadIntegrations,
} from "./integrationCatalog";

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

  const asksArc = /\barc\b/i.test(text);
  const asksElysium = /\belysium\b/i.test(text);
  const asksBsc = /\b(?:bnb|bsc|binance)\b/i.test(text);
  const asksRobinhood = /\brobinhood\b/i.test(text);
  const asksBase = /\bbase\b/i.test(text);
  const asksSepolia = /\bsepolia\b/i.test(text);
  const explicitChainId = asksArc
    ? ARC_CHAIN_ID
    : asksElysium
      ? 99901
      : asksBsc
        ? 56
        : asksRobinhood
          ? 4663
          : undefined;
  const explicitlyUnsupported = asksBase || asksSepolia;
  const chainId = explicitChainId ?? opts.chainId;
  const meta = getChainMeta(chainId);
  const mode = meta?.network ?? (opts.showTestnets ? "testnet" : "mainnet");
  const scoped = explicitlyUnsupported
    ? []
    : launchpadIntegrations(chainId, mode);

  if (scoped.length > 0) {
    return `Kaleido currently integrates ${scoped.length} launchpads on ${meta?.name ?? "this chain"}: ${integrationNameList(scoped)}. They are separate from swap aggregators. Luca can inspect a pasted launch token and build a trade only after live metadata plus pool verification passes, so a launch is not automatically routeable.`;
  }

  const byMainnet = CHAINS.filter((c) => c.network === "mainnet")
    .map((c) => ({
      chain: c,
      items: launchpadIntegrations(c.id, "mainnet"),
    }))
    .filter((entry) => entry.items.length > 0);

  if (
    explicitChainId !== undefined ||
    explicitlyUnsupported ||
    chainId !== undefined
  ) {
    const names = byMainnet.map((e) => e.chain.shortName).join(", ");
    return `No launchpad trading adapter is registered on ${meta?.name ?? "that chain"}. Kaleido's registered launchpad integrations are on ${names} mainnet; testnet catalogues do not imply mainnet support.`;
  }

  const total = byMainnet.reduce((sum, e) => sum + e.items.length, 0);
  const summary = byMainnet
    .map((e) => `${e.items.length} on ${e.chain.shortName} (${integrationNameList(e.items)})`)
    .join(", ");
  return `Kaleido currently integrates ${total} launchpads across ${byMainnet.length} mainnets: ${summary}. They are separate from swap aggregators, and every pasted token still requires live pool verification before Luca builds a trade.`;
}
