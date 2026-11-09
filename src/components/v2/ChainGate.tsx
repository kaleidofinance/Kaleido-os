"use client";

import { useState } from "react";
import { CHAINS, getChainMeta } from "@/constants/chains";
import {
  hasOrders,
  hasStablecoin,
  hasStaking,
  hasSwaps,
  isDeployed,
  tradableChains,
} from "@/constants/registry";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { useConnectWallet } from "@/hooks/v2/useChainAction";
import { useTestnetMode } from "@/hooks/v2/useTestnetMode";
import { MOCK_DATA } from "@/lib/mock";

import NetworkSelector from "./NetworkSelector";
import s from "./ChainGate.module.css";

/**
 * ChainGate — what a protocol surface shows when it has no contracts to read.
 *
 * Every screen that touches the Diamond, the vault, the stablecoin or the DEX
 * used to resolve its addresses from a flat Abstract-testnet table, so it always
 * had *something* to call regardless of which chain the wallet was on. Those
 * addresses are gone: addresses are now chain-keyed and come from
 * `getContracts(chainId)`, which returns `{}` for a chain with no deployment.
 *
 * That makes an explicit "nothing to read here" state mandatory rather than
 * cosmetic. Without one, an undeployed chain renders an empty table, and a table
 * that renders nothing is indistinguishable from a table that failed to render —
 * which is precisely the distinction the interface audit exists to make.
 *
 * THE REASONS ARE KEPT SEPARATE ON PURPOSE
 *
 * "No wallet", "a chain we do not carry" and "a chain we carry but have not
 * deployed to" all produce an empty screen and all need different words. Folding
 * them into one "unavailable" message would throw away the only information the
 * user can act on.
 *
 * THE COPY NEVER MENTIONS DEPLOYMENT, LAUNCH OR RELEASE STATE. A user has no use
 * for ours, and a panel that explains it reads as a disclaimer stapled to an
 * unfinished product. That leaves two things worth saying: "switch networks, here
 * are the ones that work" when a switch would help, and a plain empty state when
 * it would not. `tradableChains()` decides which — it ands `chains.ts`'s
 * `tradable` intent flag against `isDeployed()` (registry.ts:922), so while it
 * comes back empty every wallet chain gets the empty state, and the moment a real
 * `DEPLOYMENTS` entry lands the same component starts naming chains to switch to.
 * No copy edit required at deploy time.
 */

export type ChainGateState =
  | { ready: true }
  | { ready: false; reason: "disconnected" }
  | { ready: false; reason: "unknown-chain" }
  | {
      ready: false;
      reason: "network-hidden";
      chainName: string;
      expectedNetwork: "mainnet" | "testnet";
    }
  | {
      ready: false;
      reason: "undeployed";
      chainName: string;
      /**
       * Whether switching the wallet's network could fix this. False on a
       * read-chain surface, where the chain is a config value the user cannot
       * influence — offering them a network picker there would be a dead end.
       */
      switchable: boolean;
    };

/**
 * Whether this surface can read anything, and if not, why.
 *
 * Returns a discriminated state rather than a boolean so the caller renders one
 * message per cause without re-deriving the cause itself.
 *
 * @param readChainId Pass this for a **protocol-wide discovery** surface that
 *   reads chains of its own choosing rather than the wallet's — the all-pools
 *   table is the case, and it passes the first chain of its cross-chain sweep
 *   (`pool/page.tsx`), because any one deployed chain means there is something to
 *   enumerate. Doing so skips the connect check entirely, because such a page
 *   genuinely needs no wallet, and asking for one would misdescribe the page. Omit
 *   it for anything showing a user their own position.
 *
 * DEMO MODE opens exactly one of these gates: "undeployed". The fixtures in
 * `src/lib/mock` exist to answer "does this page render and is it wired", and a
 * gate that fires before the table mounts answers neither. The other two reasons
 * stay shut, because they are not about deployment: a page showing someone their
 * own position still needs an address to attribute the rows to (`useStablecoin`,
 * `useV3Positions` and `usePortfolio` substitute only for a connected address, so
 * opening this gate without one would swap a "Connect a wallet" panel for an empty
 * table — worse than the gate), and an unrecognised network is a real
 * misconfiguration that a fixture must not paper over. Delete the two `MOCK_DATA`
 * terms below with `src/lib/mock`.
 */
/**
 * What a surface needs on the chain to have something to read.
 *
 * "protocol" — the Diamond (`isDeployed`), for lending. "dex" — a v3Router
 * (`hasSwaps`), for pool surfaces. The narrower "orders", "stablecoin" and
 * "staking" capabilities keep partially deployed chains such as Elysium from
 * rendering forms whose contracts do not exist yet. They diverge on Arc, which
 * launched DEX-first: its pools are live and seeded while its Diamond is still
 * pending, so a pool page gated on the Diamond wrongly showed "nothing here yet"
 * and locked its buttons. Gate each surface on the capability it actually uses.
 */
export type ChainGateCapability =
  | "protocol"
  | "dex"
  | "orders"
  | "stablecoin"
  | "staking";

export function useChainGate(
  readChainId?: number,
  requires: ChainGateCapability = "protocol",
): ChainGateState {
  const { chainId: walletChainId, isConnected } = useWalletV2();
  const { showTestnets } = useTestnetMode();
  const present =
    requires === "dex"
      ? hasSwaps
      : requires === "orders"
        ? hasOrders
        : requires === "stablecoin"
          ? hasStablecoin
          : requires === "staking"
            ? hasStaking
            : isDeployed;

  if (readChainId !== undefined) {
    if (MOCK_DATA || present(readChainId)) return { ready: true };
    return {
      ready: false,
      reason: "undeployed",
      chainName: getChainMeta(readChainId)?.name ?? `chain ${readChainId}`,
      switchable: false,
    };
  }

  if (!isConnected) return { ready: false, reason: "disconnected" };

  const meta = getChainMeta(walletChainId);
  if (!meta) return { ready: false, reason: "unknown-chain" };

  const expectedNetwork = showTestnets ? "testnet" : "mainnet";
  if (meta.network !== expectedNetwork) {
    return {
      ready: false,
      reason: "network-hidden",
      chainName: meta.name,
      expectedNetwork,
    };
  }

  if (!MOCK_DATA && !present(walletChainId)) {
    return {
      ready: false,
      reason: "undeployed",
      chainName: meta.name,
      switchable: true,
    };
  }

  return { ready: true };
}

/** Prose list: "Base", "Base or Arc", "Base, Arc or BNB". */
const nameList = (names: string[]): string =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;

export default function ChainGate({
  /** What the page is for, phrased to fit "Your {product} will appear here". */
  product,
  state,
  requires = "protocol",
}: {
  product: string;
  state: Exclude<ChainGateState, { ready: true }>;
  requires?: ChainGateCapability;
}) {
  const [picker, setPicker] = useState(false);
  const openConnect = useConnectWallet();
  const { showTestnets } = useTestnetMode();

  /* Deployed AND intended. `tradable` alone is an intention, and reading it as a
     fact is what put "Trading live" under nine chains with no contracts.

     Gated on the selected network mode: a mainnet surface names only mainnet
     chains, and a testnet surface names only testnet chains. The picker and the
     data loaders use the same exclusive rule, so a hidden network cannot leak
     into a recovery CTA. */
  const carries =
    requires === "dex"
      ? CHAINS.filter((c) => c.tradable && hasSwaps(c.id))
      : requires === "orders"
        ? CHAINS.filter((c) => c.tradable && hasOrders(c.id))
        : requires === "stablecoin"
          ? CHAINS.filter((c) => c.tradable && hasStablecoin(c.id))
          : requires === "staking"
            ? CHAINS.filter((c) => c.tradable && hasStaking(c.id))
            : tradableChains(CHAINS);
  const live = carries.filter(
    (c) => c.network === (showTestnets ? "testnet" : "mainnet"),
  );

  let title: string;
  let body: string;
  let action: { label: string; onClick: () => void } | null = null;

  if (state.reason === "disconnected") {
    title = "Connect a wallet";
    body = `Your ${product} is held on-chain, under your own address. Connect a wallet and this fills in.`;
    action = { label: "Connect wallet", onClick: openConnect };
  } else if (state.reason === "unknown-chain") {
    title = "Unrecognised network";
    body =
      "Your wallet is on a network Kaleido doesn't carry, so there is nothing here to read. Switch to one it does.";
    action = { label: "Choose network", onClick: () => setPicker(true) };
  } else if (state.reason === "network-hidden") {
    const networkLabel =
      state.expectedNetwork === "testnet" ? "testnet" : "mainnet";
    title = `Switch to ${networkLabel}`;
    body = `${product} is scoped to ${networkLabel} networks, but your wallet is on ${state.chainName}.`;
    action = { label: "Choose network", onClick: () => setPicker(true) };
  } else if (state.switchable && live.length > 0) {
    /* The wallet is on a network this surface can't read, and there is at least
       one it can. Naming those and opening the picker is the entire fix, so the
       copy is about the switch and nothing else. */
    title = `Not available on ${state.chainName}`;
    body = `Switch to ${nameList(live.map((c) => c.shortName))} to see your ${product}.`;
    action = { label: "Choose network", onClick: () => setPicker(true) };
  } else {
    /* Nothing to read here and no other network to offer — either a discovery
       surface reading a chain the user cannot influence, or a wallet chain with
       no alternative to switch to. From where the user sits both are an ordinary
       empty state, so they read as one: no cause, no roadmap, no reassurance
       that the page isn't broken. A picker here would be a no-op.

       `product` is deliberately unused. It is phrased for "your {product}", and
       the six call sites pass a mix of singulars, plurals and collections
       ("stake", "liquidity positions", "pool list") that no single sentence
       inflects for. The chain name carries the useful information anyway. */
    title = "Nothing here yet";
    body = `There is nothing to show on ${state.chainName} right now.`;
  }

  return (
    <>
      <div className={s.wrap}>
        <div className={s.title}>{title}</div>
        <p className={s.body}>{body}</p>
        {action && (
          <button className={s.cta} onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
      {action?.label === "Choose network" && (
        <NetworkSelector open={picker} onClose={() => setPicker(false)} />
      )}
    </>
  );
}
