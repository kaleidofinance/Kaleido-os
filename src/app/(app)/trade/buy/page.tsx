"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import s from "../trade.module.css";
import d from "../deferred.module.css";

/**
 * Buy — fiat on-ramp via MoonPay.
 *
 * The widget URL is built and signed by /api/moonpay, never here: signing
 * needs the MoonPay secret key, and anything shipped to the browser is public.
 * This page collects an amount and asset, then opens the returned URL.
 *
 * No contract is involved. On-ramping is entirely MoonPay's KYC'd flow — they
 * take the card or bank payment and deliver crypto to the user's wallet.
 */

const PRESETS = [100, 300, 1000];

/** MoonPay currency codes for what we let people buy into. */
const ASSETS = [
  { code: "eth", label: "ETH", sub: "Ethereum" },
  { code: "eth_base", label: "ETH", sub: "Base" },
  { code: "usdc", label: "USDC", sub: "Ethereum" },
  { code: "usdc_base", label: "USDC", sub: "Base" },
];

export default function BuyPage() {
  const { isConnected, address } = useWalletV2();
  const [amount, setAmount] = useState<number | null>(null);
  const [asset, setAsset] = useState(ASSETS[3]);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (!isConnected || !address) {
      toast.error("Connect a wallet first — MoonPay delivers the crypto to it.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/moonpay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "buy",
          walletAddress: address,
          currencyCode: asset.code,
          amount: amount ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't start the on-ramp");
        return;
      }
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("[v2/trade/buy]", err);
      toast.error("Couldn't reach the on-ramp");
    } finally {
      setBusy(false);
    }
  };

  const cta = !isConnected
    ? "Connect wallet"
    : busy
      ? "Opening MoonPay…"
      : amount
        ? `Buy $${amount.toLocaleString()} of ${asset.label}`
        : `Buy ${asset.label}`;

  return (
    <div className={s.card}>
      <div className={s.box} style={{ padding: "26px 18px 22px" }}>
        <div className={s.bl}>You&apos;re buying</div>
        <div className={`${d.bigZero} ${amount ? d.filled : ""} tabular`}>
          {amount ? `$${amount.toLocaleString()}` : "$0"}
        </div>
        <div className={d.centerPresets}>
          {PRESETS.map((p) => (
            <button
              key={p}
              className={`${d.preset} ${amount === p ? d.presetOn : ""}`}
              onClick={() => setAmount(amount === p ? null : p)}
            >
              ${p.toLocaleString()}
            </button>
          ))}
        </div>
      </div>

      <div className={s.box} style={{ marginTop: 4 }}>
        <div className={s.bl}>Deliver to your wallet as</div>
        <div className={d.centerPresets} style={{ justifyContent: "flex-start" }}>
          {ASSETS.map((a) => (
            <button
              key={a.code}
              className={`${d.preset} ${asset.code === a.code ? d.presetOn : ""}`}
              onClick={() => setAsset(a)}
            >
              {a.label} · {a.sub}
            </button>
          ))}
        </div>
      </div>

      <div className={s.box} style={{ marginTop: 4 }}>
        <button className={s.cta} disabled={busy || !isConnected} onClick={start}>
          {cta}
        </button>
        <p className={d.note}>
          Card and bank payments are handled by MoonPay, who verify your
          identity and deliver the crypto straight to your wallet. Leave the
          amount blank to choose it on their side.
        </p>
      </div>
    </div>
  );
}
