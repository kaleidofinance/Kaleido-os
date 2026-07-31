"use client";

import { useState } from "react";
import s from "../trade.module.css";
import d from "../deferred.module.css";

/**
 * Sell — fiat off-ramp. Same story as Buy: real UI, provider deferred.
 *
 * Cashing out to a bank needs an off-ramp. The percentage presets act on a
 * balance the user already holds, which is why Sell offers 25/50/75/Max rather
 * than fixed dollar amounts.
 */
const PRESETS = ["25%", "50%", "75%", "Max"];

export default function SellPage() {
  const [pct, setPct] = useState<string | null>(null);

  return (
    <div className={s.card}>
      <div className={s.box} style={{ padding: "26px 18px 22px" }}>
        <div className={s.bl}>You&apos;re selling</div>
        <div className={`${d.bigZero} ${pct ? d.filled : ""} tabular`}>$0</div>
        <div className={d.centerPresets}>
          {PRESETS.map((p) => (
            <button
              key={p}
              className={`${d.preset} ${pct === p ? d.presetOn : ""}`}
              onClick={() => setPct(p)}
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
            <div className={d.assetSub}>Balance on Abstract</div>
          </div>
          <span className={s.cv} style={{ fontSize: 16 }}>
            ›
          </span>
        </div>
      </div>

      <div className={s.box} style={{ marginTop: 4 }}>
        <button className={s.cta} disabled>
          Off-ramp coming soon
        </button>
        <p className={d.note}>
          Cashing out to a bank needs a fiat off-ramp. To exit to a stablecoin
          today, use Swap.
        </p>
      </div>
    </div>
  );
}
