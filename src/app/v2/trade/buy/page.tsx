"use client";

import { useState } from "react";
import s from "../trade.module.css";
import d from "../deferred.module.css";

/**
 * Buy — fiat on-ramp. UI is real; execution needs a provider.
 *
 * Turning fiat into crypto means a KYC'd on-ramp (MoonPay, Stripe, Transak, …).
 * None is wired into this codebase, so the preset amounts and token row are
 * built to the mockup and the CTA states the missing piece plainly.
 */
const PRESETS = ["$100", "$300", "$1,000"];

export default function BuyPage() {
  const [amount, setAmount] = useState<string | null>(null);

  return (
    <div className={s.card}>
      <div className={s.box} style={{ padding: "26px 18px 22px" }}>
        <div className={s.bl}>You&apos;re buying</div>
        <div className={`${d.bigZero} ${amount ? d.filled : ""} tabular`}>
          {amount ?? "$0"}
        </div>
        <div className={d.centerPresets}>
          {PRESETS.map((p) => (
            <button
              key={p}
              className={`${d.preset} ${amount === p ? d.presetOn : ""}`}
              onClick={() => setAmount(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className={s.box} style={{ marginTop: 4 }}>
        <div className={d.assetRow}>
          <span className={s.tki} style={{ width: 34, height: 34 }}>
            KLD
            <i className={s.cb} style={{ background: "var(--k-chain-abstract)" }} />
          </span>
          <div className={d.assetName}>
            <div className={d.assetTitle}>KLD</div>
            <div className={d.assetSub}>on Abstract</div>
          </div>
          <span className={s.cv} style={{ fontSize: 16 }}>
            ›
          </span>
        </div>
      </div>

      <div className={s.box} style={{ marginTop: 4 }}>
        <button className={s.cta} disabled>
          On-ramp coming soon
        </button>
        <p className={d.note}>
          Buying with a card or bank needs a KYC&apos;d fiat on-ramp. Until one
          is connected, fund your wallet elsewhere and use Swap.
        </p>
      </div>
    </div>
  );
}
