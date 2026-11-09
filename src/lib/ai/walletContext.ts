import { getChainMeta } from "@/constants/chains";

/** Explicit wallet context takes precedence over conversation history and docs. */
export function walletChainContext(chainId?: number): string {
  if (chainId === undefined) return "No wallet chain is available. Do not guess the current chain.";
  const meta = getChainMeta(chainId);
  return meta
    ? `The connected wallet is on ${meta.name} (chain ID ${chainId}, ${meta.network}). Use this current context instead of older conversation or documentation when identifying the current chain.`
    : `The connected wallet is on an unrecognised network (chain ID ${chainId}). Do not guess its name.`;
}

export function isCurrentChainQuestion(text: string): boolean {
  return /\b(?:what|which)\s+(?:chain|network)\s+(?:(?:are|am)\s+(?:we|i)|is\s+(?:this|my wallet|the wallet))\s*(?:on|using|connected to|now)?\s*[?.!]*$/i.test(text.trim()) ||
    /\b(?:what|which)\s+(?:chain|network)\s+(?:am i|are we)\s+on\s+now\s*[?.!]*$/i.test(text.trim());
}
