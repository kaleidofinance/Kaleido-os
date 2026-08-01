"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import s from "../trade.module.css";
import d from "../deferred.module.css";

/**
 * Sell — fiat off-ramp via MoonPay.
 *
 * Mirrors Buy: /api/moonpay builds and signs the widget URL server-side, and
 * this page opens it. MoonPay takes the crypto and settles fiat to the user's
 * bank, so the wallet address is passed as the refund address rather than the
 * delivery address.
 *
 * Assets are limited to what off-ramps cleanly. Selling KLD to a bank is not
 * a thing MoonPay can do — swap to a stablecoin first, which is what the note
 * tells the user.
 */

const PRESETS = [100, 300, 1000];

const ASSETS = [
  { code: "usdc", label: "USDC", sub: "Ethereum" },
  { code: "usdc_base", label: "USDC", sub: "Base" },
  { code: "eth", label: "ETH", sub: "Ethereum" },
  { code: "eth_base", label: "ETH", sub: "Base" },
];

export default function SellPage() {
  const { isConnected, address } = useWalletV2();
  const [amount, setAmount] = useState<number | null>(null);
  const [asset, setAsset] = useState(ASSETS[0]);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    if (!isConnected || !address) {
      toast.error("Connect a wallet first.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/moonpay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "sell",
          walletAddress: address,
          currencyCode: asset.code,
          amount: amount ?? undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Couldn't start the off-ramp");
        return;
      }
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      console.error("[v2/trade/sell]", err);
      toast.error("Couldn't reach the off-ramp");
    } finally {
      setBusy(false);
    }
  };

  const cta = !isConnected
    ? "Connect wallet"
    : busy
      ? "Opening MoonPay…"
      : amount
        ? `Sell $${amount.toLocaleString()} of ${asset.label}`
        : `Sell ${asset.label}`;

  return (
    <div className={s.card}>
      <div className={s.box} style={{ padding: "26px 18px 22px" }}>
        <div className={s.bl}>You&apos;re selling</div>
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
        <div className={s.bl}>Sell from your wallet</div>
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
          MoonPay settles the sale to your bank account. Holding something other
          than these? Swap to USDC first, then sell.
        </p>
      </div>
    </div>
  );
}
