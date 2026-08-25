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
import { isDeployed } from "@/constants/registry";
import { client } from "@/config/client";
import { WALLETS } from "@/config/wallets";
import ChainIcon from "./ChainIcon";
import Portal from "./Portal";
import s from "./NetworkSelector.module.css";

/**
 * NetworkSelector — global tier, same modal pattern as TokenSelector.
 *
 * Lists every chain in the registry grouped Mainnet/Testnet. Every chain is
 * switchable, because a wallet on a chain we have not deployed to can still
 * read its own balances and is a legitimate place to be.
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
  onSelect,
}: {
  meta: ChainMeta;
  active: boolean;
  onSelect: (m: ChainMeta) => void;
}) {
  return (
    <button className={s.row} onClick={() => onSelect(meta)} disabled={active}>
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
          {isDeployed(meta.id)
            ? "Trading live"
            : meta.tradable
              ? "Balances only · deploy pending"
              : "Balances only"}
        </div>
      </div>
      {active && <span className={s.current}>Connected</span>}
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
    const mainnets = CHAINS.filter((c) => c.network === "mainnet");
    const testnets = CHAINS.filter((c) => c.network === "testnet");
    return { mainnets, testnets };
  }, []);

  if (!open) return null;

  const handleSelect = async (meta: ChainMeta) => {
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
            <div className={s.list}>
              <div className={s.group}>Mainnet</div>
              {mainnets.map((m) => (
                <ChainRow
                  key={m.id}
                  meta={m}
                  active={activeChain?.id === m.id}
                  onSelect={handleSelect}
                />
              ))}
              <div className={s.group}>Testnet</div>
              {testnets.map((m) => (
                <ChainRow
                  key={m.id}
                  meta={m}
                  active={activeChain?.id === m.id}
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
