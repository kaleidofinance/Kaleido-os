"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useActiveWallet, useDisconnect } from "thirdweb/react";
import { toast } from "sonner";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { getContracts } from "@/constants/registry";
import Portal from "./Portal";
import s from "./WalletMenu.module.css";

/**
 * The connected-address pill, and the small menu it opens.
 *
 * Anchored to the button rather than centred as a modal: this holds two or three
 * items, and a full-screen scrim with a dialog in the middle is a heavier gesture
 * than "copy my address" deserves. It still renders through `Portal`, because the
 * nav gains `backdrop-filter` the moment the page scrolls, and a `backdrop-filter`
 * ancestor becomes the containing block for `position: fixed` — see Portal.tsx.
 * Anchoring inside the nav would clip the menu to the nav strip on a scrolled
 * page but not on an unscrolled one, which is the kind of bug that only shows up
 * after release.
 *
 * Position is measured from the trigger and passed as inline top/right. That is
 * the one thing here that has to be inline: the menu lives in a different DOM
 * subtree from its anchor, so no CSS rule can relate them.
 */
export default function WalletMenu() {
  const { address, shortAddress, chainId } = useWalletV2();
  const wallet = useActiveWallet();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  /*
   * /faucet, but only where there is a faucet to reach.
   *
   * Here rather than in the nav's LINKS, which is already seven items and only
   * five of those fit the mobile tab bar — and the faucet is not a product
   * alongside Trade and Borrow, it is an account errand like copying your
   * address. Gated on the chain's own `faucet` field rather than shown always,
   * because the item is a dead end on a chain with no faucet: the page would
   * open only to say there is nothing to claim.
   */
  const hasFaucet = Boolean(getContracts(chainId).faucet);

  /* Measured on open rather than on mount: the pill's width changes when the
     address resolves, so measuring early anchors the menu to where the button
     used to be. */
  const toggle = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    /* Dismisses on scroll instead of following the trigger. The alternative is
       recomputing every scroll frame, and a menu drifting while the page moves
       under it reads worse than one that closes. */
    const onScroll = () => setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll);
    };
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      /* Clipboard is permission-gated and throws on insecure origins. The full
         address is rendered above and is selectable, so a manual path exists. */
      toast.error("Couldn't copy — select the address and copy it manually.");
    }
  };

  const cut = () => {
    /* `wallet` can be undefined for a frame if a disconnect happened elsewhere.
       disconnect() requires it, so guard rather than assert. */
    if (!wallet) return;
    disconnect(wallet);
    setOpen(false);
    toast.success("Wallet disconnected");
  };

  return (
    <>
      <button
        ref={btnRef}
        className={s.addr}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Wallet ${shortAddress ?? ""}, account menu`}
      >
        <span className={s.avatar} />
        {shortAddress}
      </button>

      {open && (
        <Portal>
          {/* Click-outside rather than a visible scrim: the menu is small and
              anchored, so darkening the page would overstate it. The layer is
              still full-viewport, because a dismiss target you have to aim at
              is not a dismiss target. */}
          <div
            className={s.catcher}
            onClick={() => setOpen(false)}
            role="presentation"
          >
            <div
              className={s.menu}
              style={{ top: pos.top, right: pos.right }}
              role="menu"
              aria-label="Account"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Never truncated. Address-poisoning seeds your history with an
                  address whose first and last four characters match one you
                  trust, so a 0x28b7…8955 confirmation is exactly the check that
                  attack defeats. Same reasoning as ReceivePanel. */}
              <div className={s.full}>{address}</div>
              <button className={s.item} onClick={copy} role="menuitem">
                {copied ? "Copied" : "Copy address"}
              </button>
              {hasFaucet && (
                <Link
                  className={s.item}
                  href="/faucet"
                  role="menuitem"
                  onClick={() => setOpen(false)}
                >
                  Get test tokens
                </Link>
              )}
              <button
                className={`${s.item} ${s.danger}`}
                onClick={cut}
                role="menuitem"
              >
                Disconnect
              </button>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
