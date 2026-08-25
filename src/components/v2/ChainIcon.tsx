import type { ReactNode } from "react";

import NetworkAbstract from "@web3icons/react/icons/networks/NetworkAbstract";
import NetworkAbstractSepolia from "@web3icons/react/icons/networks/NetworkAbstractSepolia";
import NetworkArbitrumOne from "@web3icons/react/icons/networks/NetworkArbitrumOne";
import NetworkArc from "@web3icons/react/icons/networks/NetworkArc";
import NetworkBase from "@web3icons/react/icons/networks/NetworkBase";
import NetworkBaseSepolia from "@web3icons/react/icons/networks/NetworkBaseSepolia";
import NetworkBinanceSmartChain from "@web3icons/react/icons/networks/NetworkBinanceSmartChain";
import NetworkBinanceSmartChainTestnet from "@web3icons/react/icons/networks/NetworkBinanceSmartChainTestnet";
import NetworkEthereum from "@web3icons/react/icons/networks/NetworkEthereum";
import NetworkPolygon from "@web3icons/react/icons/networks/NetworkPolygon";
import NetworkRobinhood from "@web3icons/react/icons/networks/NetworkRobinhood";
import NetworkSepolia from "@web3icons/react/icons/networks/NetworkSepolia";

/**
 * Network icon, resolved at build time.
 *
 * This replaces `<NetworkIcon>` from `@web3icons/react/dynamic`, which is
 * convenient and extremely expensive here. That component resolves an icon by
 * string at runtime, so it reaches for `dynamicIconImports` — a generated map
 * of ~2,200 `() => import(...)` thunks covering every token, wallet, exchange
 * and network the library ships. The bundler cannot know which one a runtime
 * string will pick, so it has to build all of them: measured at 4,360 modules,
 * roughly a third of this app's entire dev module graph, to draw a 16px badge
 * in the nav and a 22px badge in the network list.
 *
 * The registry in constants/chains.ts is a fixed list of 13 chains, so nothing
 * about the lookup is actually dynamic. Importing those 13 icons by name lets
 * the bundler see the whole set, and the other ~2,190 never enter the graph.
 *
 * Keyed on `ChainMeta.iconId` rather than chain id so chains.ts stays the one
 * place a chain is described. Adding a chain means adding its icon here; the
 * `fallback` is what renders until someone does, so the failure mode is a
 * coloured dot rather than a crash or a blank.
 *
 * Hyperliquid is deliberately absent: web3icons ships no asset for it, so it
 * takes the fallback dot. That is the same thing the dynamic component did.
 */
/**
 * Derived from a real icon rather than hand-written. The library types `size`
 * as `string | number`, so a narrower local signature fails to accept its own
 * components — and would silently drift the next time the props change.
 */
type IconComponent = typeof NetworkBase;

const ICONS: Record<string, IconComponent> = {
  abstract: NetworkAbstract,
  "abstract-sepolia": NetworkAbstractSepolia,
  "arbitrum-one": NetworkArbitrumOne,
  arc: NetworkArc,
  base: NetworkBase,
  "base-sepolia": NetworkBaseSepolia,
  "binance-smart-chain": NetworkBinanceSmartChain,
  "binance-smart-chain-testnet": NetworkBinanceSmartChainTestnet,
  ethereum: NetworkEthereum,
  polygon: NetworkPolygon,
  robinhood: NetworkRobinhood,
  sepolia: NetworkSepolia,
};

export default function ChainIcon({
  id,
  size = 16,
  variant = "branded",
  className,
  fallback = null,
}: {
  /** `ChainMeta.iconId`. */
  id: string | undefined;
  size?: number;
  variant?: "branded" | "mono" | "background";
  className?: string;
  /** Rendered when the chain has no icon in the library yet. */
  fallback?: ReactNode;
}) {
  const Icon = id ? ICONS[id] : undefined;
  if (!Icon) return <>{fallback}</>;
  return <Icon size={size} variant={variant} className={className} />;
}
