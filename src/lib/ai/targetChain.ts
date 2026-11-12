import { CHAINS } from "@/constants/chains";
import type { NetworkMode } from "./readTools";

/**
 * Find an explicitly named chain in a natural-language analysis request.
 *
 * This is only a read-scope hint. It never changes the action chain and it
 * never invents a chain when the user asks for an all-chain comparison.
 */
export function targetChainHint(
  text: string,
  networkMode: NetworkMode,
): number | undefined {
  const normalized = text.trim().toLowerCase();
  if (!normalized || /\b(?:all|every|each|across)\s+(?:the\s+)?chains?\b/i.test(normalized)) {
    return undefined;
  }

  const candidates = CHAINS
    .filter((chain) => chain.network === networkMode)
    .sort((a, b) => b.name.length - a.name.length);
  const matches = new Set<number>();
  for (const chain of candidates) {
    const aliases = new Set([chain.name, chain.shortName]);
    for (const alias of aliases) {
      const escaped = alias.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\b${escaped}\\b`, "i").test(normalized)) matches.add(chain.id);
    }
  }
  return matches.size === 1 ? matches.values().next().value : undefined;
}
