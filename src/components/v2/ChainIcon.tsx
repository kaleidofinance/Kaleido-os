import type { ReactNode } from "react";

import NetworkAbstract from "@web3icons/react/icons/networks/NetworkAbstract";
import NetworkAbstractSepolia from "@web3icons/react/icons/networks/NetworkAbstractSepolia";
import NetworkArbitrumOne from "@web3icons/react/icons/networks/NetworkArbitrumOne";
import NetworkArc from "@web3icons/react/icons/networks/NetworkArc";
import NetworkAvalanche from "@web3icons/react/icons/networks/NetworkAvalanche";
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

function NetworkElysium({
  size = 16,
  className,
}: {
  size?: string | number;
  variant?: "branded" | "mono" | "background";
  className?: string;
}) {
  return (
    <img
      src="/icons/elysium.svg"
      width={size}
      height={size}
      className={className}
      alt="Elysium"
      style={{ borderRadius: "50%", display: "inline-block", verticalAlign: "middle" }}
    />
  );
}

function NetworkZero({
  size = 16,
  className,
}: {
  size?: string | number;
  variant?: "branded" | "mono" | "background";
  className?: string;
}) {
  return (
    <img
      src="/icons/zero.svg"
      width={size}
      height={size}
      className={className}
      alt="Zero"
      style={{ borderRadius: "50%", display: "inline-block", verticalAlign: "middle" }}
    />
  );
}

function NetworkOptimism({
  size = 16,
  className,
}: {
  size?: string | number;
  variant?: "branded" | "mono" | "background";
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      style={{ display: "inline-block", verticalAlign: "middle", borderRadius: "50%" }}
    >
      <circle cx="16" cy="16" r="16" fill="#FF0420" />
      <path
        d="M11.6 20.6c-1.7 0-3-.5-3.8-1.4-.8-.9-1.1-2.1-.9-3.6.2-1.5.9-2.8 1.9-3.7 1.1-.9 2.4-1.4 4-1.4 1.7 0 2.9.5 3.7 1.4.8.9 1.1 2.1.9 3.6-.2 1.5-.9 2.8-1.9 3.7-1 .9-2.3 1.4-3.9 1.4zm.4-2.4c.7 0 1.4-.2 1.9-.7.5-.5.8-1.2 1-2.1.1-.9 0-1.6-.4-2-.4-.5-1-.7-1.7-.7-.8 0-1.4.2-1.9.7-.5.5-.8 1.2-1 2.1-.1.9 0 1.5.4 2 .4.5 1 .7 1.7.7zm6.1 2.2l1.6-9.7h4.2c1.2 0 2.1.3 2.7.9.6.6.9 1.4.7 2.4-.2 1.1-.7 1.9-1.5 2.5-.8.6-1.9.9-3.1.9h-1.6l-.5 3h-2.5zm3.4-5.1h1.3c.6 0 1-.1 1.4-.4.3-.3.5-.6.6-1.1.1-.4 0-.8-.2-1-.2-.2-.6-.4-1.1-.4h-1.4l-.6 3z"
        fill="#FFFFFF"
      />
    </svg>
  );
}

const ICONS: Record<string, IconComponent> = {
  abstract: NetworkAbstract,
  "abstract-sepolia": NetworkAbstractSepolia,
  "arbitrum-one": NetworkArbitrumOne,
  arc: NetworkArc,
  avalanche: NetworkAvalanche,
  base: NetworkBase,
  "base-sepolia": NetworkBaseSepolia,
  "binance-smart-chain": NetworkBinanceSmartChain,
  "binance-smart-chain-testnet": NetworkBinanceSmartChainTestnet,
  elysium: NetworkElysium as unknown as IconComponent,
  ethereum: NetworkEthereum,
  optimism: NetworkOptimism as unknown as IconComponent,
  polygon: NetworkPolygon,
  robinhood: NetworkRobinhood,
  sepolia: NetworkSepolia,
  zero: NetworkZero as unknown as IconComponent,
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
