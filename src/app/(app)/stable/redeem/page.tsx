"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useStable } from "../StableContext";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import f from "../form.module.css";

const OUTPUTS = ["USDC", "USDT", "USDe"] as const;
type Output = (typeof OUTPUTS)[number];

export default function RedeemPage() {
  const { isConnected } = useWalletV2();
  const { balances, redeemKfUSD } = useStable();
  const [output, setOutput] = useState<Output>("USDC");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const balance = balances?.kfUSD ?? "0";
  const insufficient = isConnected && Number(balance) < parseFloat(amount || "0");

  const submit = async () => {
    if (!isConnected) return toast.error("Connect a wallet first.");
    if (!amount || parseFloat(amount) <= 0) return;
    setBusy(true);
    try {
      await redeemKfUSD(amount, output);
      setAmount("");
    } catch (err) {
      console.error("[v2/stable/redeem]", err);
    } finally {
      setBusy(false);
    }
  };

  const cta = !isConnected
    ? "Connect wallet"
    : !amount || parseFloat(amount) <= 0
      ? "Enter an amount"
      : insufficient
        ? "Insufficient kfUSD"
        : busy
          ? "Redeeming…"
          : `Redeem ${amount} kfUSD`;

  return (
    <div className={f.card}>
      <div className={f.box}>
        <div className={f.bl}>You redeem</div>
        <div className={f.amt}>
          <input
            className={`${f.inp} tabular`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0"
            aria-label="Amount to redeem"
          />
          <span className={f.pill}>
            <span className={f.tki}>kf</span>
            kfUSD
          </span>
        </div>
        <div className={f.sub}>
          <span />
          <span>
            {isConnected && (
              <>
                Balance {Number(balance).toLocaleString(undefined, { maximumFractionDigits: 2 })} ·{" "}
                <b onClick={() => setAmount(String(balance))}>Max</b>
              </>
            )}
          </span>
        </div>
      </div>

      <div className={f.linkRow}>
        <span className={f.arw}>↓</span>
      </div>

      <div className={f.box}>
        <div className={f.assets}>
          {OUTPUTS.map((o) => (
            <button
              key={o}
              className={`${f.assetChip} ${output === o ? f.assetChipOn : ""}`}
              onClick={() => setOutput(o)}
            >
              {o}
            </button>
          ))}
        </div>
        <div className={f.bl}>You receive</div>
        <div className={f.amt}>
          <input
            className={`${f.inp} tabular`}
            value={amount}
            placeholder="0"
            readOnly
            aria-label="Collateral received"
          />
          <span className={f.pill}>
            <span className={f.tki}>{output.slice(0, 3)}</span>
            {output}
          </span>
        </div>
      </div>

      <div className={f.box} style={{ marginTop: 4 }}>
        <div className={f.kv}>
          <span>Rate</span>
          <b>1 kfUSD = 1 {output}</b>
        </div>
        <div className={f.kv}>
          <span>Settles</span>
          <b>Immediately</b>
        </div>
        <button className={f.cta} disabled={!isConnected || !amount || insufficient || busy} onClick={submit}>
          {cta}
        </button>
      </div>
    </div>
  );
}
