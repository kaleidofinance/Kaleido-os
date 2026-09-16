"use client";

import { useEffect, useMemo } from "react";
import {
  useActiveWallet,
  useActiveWalletChain,
  useConnectModal,
  useSwitchActiveWalletChain,
} from "thirdweb/react";
import { toast } from "sonner";
import {
  CHAINS,
  toThirdwebChainOptions,
  type ChainMeta,
} from "@/constants/chains";
import { defineChain } from "thirdweb/chains";
import { isDeployed, isComingSoon, hasSwaps } from "@/constants/registry";
import { useTestnetMode } from "@/hooks/v2/useTestnetMode";
import { client } from "@/config/client";
import { WALLETS } from "@/config/wallets";
import ChainIcon from "./ChainIcon";
import Portal from "./Portal";
import s from "./NetworkSelector.module.css";

/**
 * NetworkSelector — global tier, same modal pattern as TokenSelector.
 *
 * One list, mainnets or testnets, chosen by a toggle rather than both stacked
 * with headers. The toggle OPENS on testnets while no mainnet is deployed —
 * those are the networks that actually work — and flips to opening on mainnets
 * the day one ships, driven off `isDeployed`, so nothing here changes at launch.
 * Every chain is switchable either way, because a wallet on a chain we have not
 * deployed to can still read its own balances and is a legitimate place to be.
 *
 * THE SUBLABEL IS DERIVED, NOT DECLARED. It used to read
 * `meta.tradable ? "Trading live" : "Balances only"`, which was wrong twice
 * over: `tradable` is an *intention* flag in `chains.ts`, so it promised live
 * trading on nine chains that have no contracts, and the comment here claimed
 * Abstract was the deployed one — Abstract is deprioritised to balance reading
 * and nothing is deployed anywhere yet. `isDeployed()` reads `DEPLOYMENTS`, so
 * this label can only ever say what is actually true.
 */

interface NetworkSelectorProps {
  open: boolean;
  onClose: () => void;
}

function ChainRow({
  meta,
  active,
  comingSoon,
  onSelect,
}: {
  meta: ChainMeta;
  active: boolean;
  comingSoon: boolean;
  onSelect: (m: ChainMeta) => void;
}) {
  return (
    <button
      className={`${s.row} ${comingSoon ? s.rowSoon : ""}`}
      onClick={() => onSelect(meta)}
      disabled={active || comingSoon}
      aria-disabled={active || comingSoon}
    >
      <span className={s.tki}>
        <ChainIcon
          id={meta.iconId}
          variant="branded"
          size={22}
          fallback={<i className={s.dot} style={{ background: meta.color }} />}
        />
      </span>
      <div className={s.rb}>
        <div className={s.rn}>{meta.name}</div>
        <div className={s.rs}>
          {comingSoon
            ? "Coming soon"
            : isDeployed(meta.id)
              ? "Trading live"
              : hasSwaps(meta.id)
                ? "Swaps live"
                : meta.tradable
                  ? "Balances only · deploy pending"
                  : "Balances only"}
        </div>
      </div>
      {active ? (
        <span className={s.current}>Connected</span>
      ) : comingSoon ? (
        <span className={s.soon}>Coming soon</span>
      ) : null}
    </button>
  );
}

export default function NetworkSelector({
  open,
  onClose,
}: NetworkSelectorProps) {
  const activeChain = useActiveWalletChain();
  const switchChain = useSwitchActiveWalletChain();
  const wallet = useActiveWallet();
  const { connect } = useConnectModal();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const { mainnets, testnets } = useMemo(() => {
    /* Only the chains we are launching on — `tradable`, which is what draws the
       "deploy pending" sublabel — or ones already live. A plain "Balances only"
       chain we have no plans for (Polygon, Arbitrum, Hyperliquid, Abstract) is
       hidden from the switcher; the multichain portfolio still reads its balances,
       so nothing a wallet holds there disappears, it just is not a place to
       switch TO. Deploying or marking a chain tradable reveals it here on its own. */
    const shown = (c: ChainMeta) => Boolean(c.tradable) || isDeployed(c.id);
    const mainnets = CHAINS.filter(
      (c) => c.network === "mainnet" && shown(c),
    );
    const testnets = CHAINS.filter(
      (c) => c.network === "testnet" && shown(c),
    );
    return { mainnets, testnets };
  }, []);

  /* The toggle. On shows testnets, off shows mainnets. It reads a shared,
     persisted signal rather than local state, so this switch is the same one the
     faucet tab and the /faucet page gate on — flipping it here turns the testnet
     surfaces on everywhere at once. It opens on mainnet for the launch (see
     showTestnetsAtom), and a tester who winds testnet back on stays there across
     reloads, which is what makes the testnet button a real way back in. */
  const { showTestnets, setShowTestnets } = useTestnetMode();

  if (!open) return null;

  const shown = showTestnets ? testnets : mainnets;

  const handleSelect = async (meta: ChainMeta) => {
    /* A coming-soon mainnet is not a place to switch to yet: the row is disabled,
       and this refuses the switch even if a click still lands (keyboard path, a
       stale render). */
    if (isComingSoon(meta.id)) return;
    const chain = defineChain(toThirdwebChainOptions(meta));

    /* Disconnected, this list is a chooser rather than a switcher: there is no
       wallet to switch. switchChain() would throw, and the catch below would
       tell you to switch manually in a wallet you never connected. Opening the
       connect modal pinned to the chain you picked answers what the click
       actually meant. */
    if (!wallet) {
      onClose();
      try {
        await connect({ client, wallets: WALLETS, chain, size: "compact" });
      } catch {
        /* Dismissing the modal rejects. That is a decision, not a fault. */
      }
      return;
    }

    try {
      await switchChain(chain);
      toast.success(`Switched to ${meta.name}`);
      onClose();
    } catch {
      toast.error(
        "Couldn't switch network — try switching manually in your wallet.",
      );
    }
  };

  return (
    <Portal>
      <div className={s.overlay} onClick={onClose} role="presentation">
        <div
          className={s.modal}
          role="dialog"
          aria-modal="true"
          aria-label="Select a network"
          onClick={(e) => e.stopPropagation()}
        >
          <div className={s.mh}>
            <span className={s.mt}>Select a network</span>
            <button className={s.mx} onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>

          <div className={s.mb}>
            <div className={s.toggleRow}>
              <div className={s.toggleText}>
                <div className={s.toggleLabel}>Testnets</div>
                <div className={s.toggleHint}>
                  {showTestnets
                    ? "Showing test networks"
                    : "Showing mainnet networks"}
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showTestnets}
                aria-label="Show testnets"
                className={`${s.switch} ${showTestnets ? s.switchOn : ""}`}
                onClick={() => setShowTestnets((v) => !v)}
              >
                <span className={s.knob} />
              </button>
            </div>

            <div className={s.list}>
              {shown.map((m) => (
                <ChainRow
                  key={m.id}
                  meta={m}
                  active={activeChain?.id === m.id}
                  comingSoon={isComingSoon(m.id)}
                  onSelect={handleSelect}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </Portal>
  );
}
