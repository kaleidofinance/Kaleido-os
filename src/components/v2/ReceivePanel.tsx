"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { getChainMeta } from "@/constants/chains";
import ChainIcon from "./ChainIcon";
import s from "./ReceivePanel.module.css";

/**
 * Receive — your own address, as a panel inside the agent's plan well.
 *
 * Not a modal, and that is the point of the surface it lives on: the prompt
 * above stays live, so typing a new command is a way out and there is no scrim
 * to trap focus behind. Everything a modal would give us here (dismissal, a
 * back path) is cheaper in flow, and being in flow means it can never hit the
 * `backdrop-filter`-becomes-containing-block trap documented in Portal.tsx.
 *
 * It is also the only thing Luca can do today that touches no contract: there
 * is no transaction, no signature, and no deployment to wait for. An address
 * and a QR are true on every chain, right now.
 *
 * SVG QR rather than canvas: it inherits colours as real CSS values, so the
 * theme toggle needs no re-render and the code stays crisp at any DPI. A canvas
 * raster would have to be redrawn on every theme flip and would show its pixels
 * on a retina screen.
 */

interface Props {
  onBack: () => void;
}

export default function ReceivePanel({ onBack }: Props) {
  const { address, chainId, chainName, isConnected } = useWalletV2();
  const chain = getChainMeta(chainId);
  const [copied, setCopied] = useState(false);

  // Clears the "Copied" confirmation on its own. Cancelled on unmount so a
  // panel dismissed inside the window doesn't setState after teardown.
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
      // Clipboard is permission-gated and fails on insecure origins. The
      // address is rendered in full and selectable, so there is a manual path;
      // a thrown error here would be noise about a route that still works.
    }
  };

  if (!isConnected || !address) {
    return (
      <div className={s.wrap}>
        <div className={s.head}>
          <button className={s.back} onClick={onBack} aria-label="Back">
            ←
          </button>
          <div className={s.title}>Receive</div>
        </div>
        <p className={s.empty}>
          Connect a wallet first — there&rsquo;s no address to show until you
          do.
        </p>
      </div>
    );
  }

  return (
    <div className={s.wrap}>
      <div className={s.head}>
        <button className={s.back} onClick={onBack} aria-label="Back">
          ←
        </button>
        <div className={s.title}>Receive</div>
      </div>

      {/* The chain, stated loudly and first.

          This is the safety control on a receive screen, not a label. The
          address below is byte-identical on every EVM chain, so nothing about
          it tells you where funds will land — the sending network decides that,
          and a transfer sent on the wrong one is gone. Naming the chain in the
          largest type on the panel is the only thing here that prevents that. */}
      <div className={s.chainRow}>
        <span className={s.chainIcon}>
          <ChainIcon
            id={chain?.iconId ?? "ethereum"}
            variant="branded"
            size={20}
            fallback={
              <i style={{ background: chain?.color ?? "var(--k-brand)" }} />
            }
          />
        </span>
        <span className={s.chainName}>
          {chain?.name ?? chainName ?? "Unknown network"}
        </span>
        {chain?.network === "testnet" && (
          <span className={s.testnet}>Testnet</span>
        )}
      </div>

      <div className={s.qrFrame}>
        <QRCodeSVG
          value={address}
          size={168}
          // Explicit hex rather than a token: a QR scanner reads luminance, and
          // a translucent token over glass would drop the contrast ratio below
          // what a phone camera can resolve. This is the one place in the app
          // that must stay pure black on pure white in both themes — which is
          // why the frame around it carries its own white plate.
          bgColor="#ffffff"
          fgColor="#000000"
          level="M"
          marginSize={0}
        />
      </div>

      {/* Never truncated.

          Address-poisoning works by seeding your history with an address whose
          first and last four characters match one you already trust, so a
          `0x28b7…8955` confirmation is precisely the check the attack defeats.
          The full string, broken to wrap, is the only honest form. */}
      <button
        className={s.addr}
        onClick={copy}
        title="Copy address"
        aria-label={`Copy address ${address}`}
      >
        <span className={s.addrText}>{address}</span>
        <span className={s.copyHint}>{copied ? "Copied" : "Copy"}</span>
      </button>

      <p className={s.warn}>
        Same address on every EVM chain — but funds only arrive on the chain
        they were sent from. Send on{" "}
        <b>{chain?.name ?? chainName ?? "this network"}</b> only.
      </p>
    </div>
  );
}
