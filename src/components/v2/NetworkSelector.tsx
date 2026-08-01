"use client";

import { useEffect, useMemo } from "react";
import { NetworkIcon } from "@web3icons/react/dynamic";
import { useActiveWalletChain, useSwitchActiveWalletChain } from "thirdweb/react";
import { toast } from "sonner";
import { CHAINS, toThirdwebChainOptions, type ChainMeta } from "@/constants/chains";
import { defineChain } from "thirdweb/chains";
import s from "./NetworkSelector.module.css";

/**
 * NetworkSelector — global tier, same modal pattern as TokenSelector.
 *
 * Lists every chain in the registry grouped Mainnet/Testnet. Only Abstract
 * has the Kaleido Diamond deployed, so every other chain is switchable (for
 * balance viewing, general wallet use) but labeled "Balances only" rather
 * than silently pretending Trade/Pool/Stake work there.
 */

interface NetworkSelectorProps {
  open: boolean;
  onClose: () => void;
}

function ChainRow({ meta, active, onSelect }: { meta: ChainMeta; active: boolean; onSelect: (m: ChainMeta) => void }) {
  return (
    <button className={s.row} onClick={() => onSelect(meta)} disabled={active}>
      <span className={s.tki}>
        <NetworkIcon id={meta.iconId} variant="branded" size={22} fallback={<i className={s.dot} style={{ background: meta.color }} />} />
      </span>
      <div className={s.rb}>
        <div className={s.rn}>{meta.name}</div>
        <div className={s.rs}>{meta.tradable ? "Trading live" : "Balances only"}</div>
      </div>
      {active && <span className={s.current}>Connected</span>}
    </button>
  );
}

export default function NetworkSelector({ open, onClose }: NetworkSelectorProps) {
  const activeChain = useActiveWalletChain();
  const switchChain = useSwitchActiveWalletChain();

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
    try {
      const chain = defineChain(toThirdwebChainOptions(meta));
      await switchChain(chain);
      toast.success(`Switched to ${meta.name}`);
      onClose();
    } catch {
      toast.error("Couldn't switch network — try switching manually in your wallet.");
    }
  };

  return (
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
              <ChainRow key={m.id} meta={m} active={activeChain?.id === m.id} onSelect={handleSelect} />
            ))}
            <div className={s.group}>Testnet</div>
            {testnets.map((m) => (
              <ChainRow key={m.id} meta={m} active={activeChain?.id === m.id} onSelect={handleSelect} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
