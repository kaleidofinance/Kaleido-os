"use client";

import { useState } from "react";
import s from "../trade.module.css";
import d from "../deferred.module.css";

/**
 * Limit — the UI is real; execution is deferred.
 *
 * Kaleido has no on-chain limit-order primitive. Its P2P listings are the
 * closest thing (a lender posts a rate and waits to be filled), but a
 * price-triggered spot limit needs either an order book or a keeper network.
 * So the form is built to the mockup, and the submit says exactly why it can't
 * fire yet rather than pretending.
 */
const PRESETS = ["Market", "+1%", "+5%", "+10%"];
const EXPIRY = ["1 day", "1 week", "1 month", "1 year"];

export default function LimitPage() {
  const [preset, setPreset] = useState("+1%");
  const [expiry, setExpiry] = useState("1 week");

  return (
    <div className={s.card}>
      <div className={s.box}>
        <div className={s.bl}>
          When 1{" "}
          <span className={s.pill} style={{ padding: "4px 10px 4px 4px", fontSize: 15 }}>
            <span className={s.tki} style={{ width: 22, height: 22, fontSize: 9 }}>
              KLD
            </span>
            KLD
          </span>{" "}
          is worth
        </div>
        <div className={s.amt}>
          <input className={`${s.inp} tabular`} defaultValue="1.3500" inputMode="decimal" aria-label="Limit price" />
          <span className={s.pill}>
            <span className={s.tki}>USD</span>
            USDC
          </span>
        </div>
        <div className={d.presets}>
          {PRESETS.map((p) => (
            <button
              key={p}
              className={`${d.preset} ${preset === p ? d.presetOn : ""}`}
              onClick={() => setPreset(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className={s.box} style={{ marginTop: 4 }}>
        <div className={s.bl}>Sell</div>
        <div className={s.amt}>
          <input className={`${s.inp} tabular`} defaultValue="2,000" inputMode="decimal" aria-label="Amount to sell" />
          <span className={s.pill}>
            <span className={s.tki}>KLD</span>
            KLD
          </span>
        </div>
      </div>

      <div className={s.box} style={{ marginTop: 4 }}>
        <div className={s.kv}>
          <span>Expires in</span>
          <span className={d.presets} style={{ margin: 0 }}>
            {EXPIRY.map((e) => (
              <button
                key={e}
                className={`${d.preset} ${expiry === e ? d.presetOn : ""}`}
                onClick={() => setExpiry(e)}
              >
                {e}
              </button>
            ))}
          </span>
        </div>
        <button className={s.cta} disabled>
          Limit orders coming soon
        </button>
        <p className={d.note}>
          Needs an order book or keeper to fill at your target price. For a
          rate you set today, post a lending offer under Borrow → Lend.
        </p>
      </div>
    </div>
  );
}
