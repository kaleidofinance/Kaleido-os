"use client";

import { useState } from "react";
import { ChartToggle, usePublishChartPair } from "@/components/v2/ChartPanel";
import TokenIcon from "@/components/v2/TokenIcon";
import s from "../trade.module.css";
import d from "../deferred.module.css";

/**
 * Limit — the UI is real; execution is deferred.
 *
 * Kaleido has no on-chain limit-order primitive. Its P2P listings are the
 * closest thing (a lender posts a rate and waits to be filled), but a
 * price-triggered spot limit needs either an order book or a keeper network.
 * So the form is built to the mockup, the submit is disabled, and the note under
 * it names the missing mechanism and points at the P2P book — a mechanism the
 * protocol doesn't have, not a release we are waiting on.
 */
const PRESETS = ["Market", "+1%", "+5%", "+10%"];
const EXPIRY = ["1 day", "1 week", "1 month", "1 year"];

export default function LimitPage() {
  const [preset, setPreset] = useState("+1%");
  const [expiry, setExpiry] = useState("1 week");

  /* The pair is hardcoded here because the form is, so it publishes what the
     card actually says rather than pretending to a selection this tab does not
     have yet. KLD is carried by no price feed, so the panel says exactly that
     (see usePriceSeries's `unsupported`); USDC is the side with a real price. */
  usePublishChartPair("KLD", "USDC");

  return (
    <div className={s.card}>
      {/* Limit has no settings popover of its own, so this corner carries the one
          control it does have. Same `.settings` group as the swap card, which is
          absolutely positioned over the first well's label row — see
          trade.module.css for why it is a sibling of the well and not a child. */}
      <div className={s.settings}>
        <ChartToggle />
      </div>
      {/* Top well recessed, bottom well raised — the same positional rule as
          every other trade tab, so flipping between them shows one card. You
          type into both wells here, so there is no "the one you fund" side to
          hang it on. */}
      <div className={`${s.box} ${s.deep}`}>
        <div className={d.head}>
          <span>When 1</span>
          <span className={`${s.pill} ${d.headPill}`}>
            <span className={`${s.tki} ${d.headIcon}`}>KLD</span>
            KLD
          </span>
          <span>is worth</span>
        </div>
        <div className={s.amt}>
          <input
            className={`${s.inp} tabular`}
            defaultValue="1.3500"
            inputMode="decimal"
            aria-label="Limit price"
          />
          <span className={s.pill}>
            <span className={`${s.tki} ${s.tkiArt}`}>
              <TokenIcon symbol="USDC" size={28} />
            </span>
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

      <div className={`${s.box} ${s.raised}`} style={{ marginTop: 4 }}>
        <div className={s.bl}>Sell</div>
        <div className={s.amt}>
          <input
            className={`${s.inp} tabular`}
            defaultValue="2,000"
            inputMode="decimal"
            aria-label="Amount to sell"
          />
          <span className={s.pill}>
            <span className={s.tki}>KLD</span>
            KLD
          </span>
        </div>
        {/* Expiry rides with the amount rather than owning a card. It is one
            more thing about this order, and the third well it used to sit in
            cost ~40px of chrome to frame a single row — on a surface whose
            whole job is fitting the viewport. */}
        <div className={s.kv} style={{ paddingBottom: 0 }}>
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
      </div>

      <button className={s.cta} disabled>
        Place limit order
      </button>
      <p className={d.note}>
        Filling at a target price needs an order book or a keeper, neither of
        which Kaleido has on-chain. For a rate you set yourself, post a lending
        offer under Borrow → Lend.
      </p>
    </div>
  );
}
