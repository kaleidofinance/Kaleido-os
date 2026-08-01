"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useStable } from "../StableContext";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import f from "../form.module.css";

const COLLATERALS = ["USDC", "USDT", "USDe"] as const;
type Collateral = (typeof COLLATERALS)[number];

export default function MintPage() {
  const { isConnected } = useWalletV2();
  const { balances, mintKfUSD } = useStable();
  const [collateral, setCollateral] = useState<Collateral>("USDC");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const balance = balances?.[collateral] ?? "0";
  const insufficient = isConnected && Number(balance) < parseFloat(amount || "0");

  const submit = async () => {
    if (!isConnected) return toast.error("Connect a wallet first.");
    if (!amount || parseFloat(amount) <= 0) return;
    setBusy(true);
    try {
      await mintKfUSD(collateral, amount);
      setAmount("");
    } catch (err) {
      console.error("[v2/stable/mint]", err);
    } finally {
      setBusy(false);
    }
  };

  const cta = !isConnected
    ? "Connect wallet"
    : !amount || parseFloat(amount) <= 0
      ? "Enter an amount"
      : insufficient
        ? `Insufficient ${collateral}`
        : busy
          ? "Minting…"
          : `Mint ${amount} kfUSD`;

  return (
    <div className={f.card}>
      <div className={f.box}>
        <div className={f.assets}>
          {COLLATERALS.map((c) => (
            <button
              key={c}
              className={`${f.assetChip} ${collateral === c ? f.assetChipOn : ""}`}
              onClick={() => setCollateral(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className={f.bl}>You deposit</div>
        <div className={f.amt}>
          <input
            className={`${f.inp} tabular`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0"
            aria-label="Amount to deposit"
          />
          <span className={f.pill}>
            <span className={f.tki}>{collateral.slice(0, 3)}</span>
            {collateral}
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
        <div className={f.bl}>You receive</div>
        <div className={f.amt}>
          <input
            className={`${f.inp} tabular`}
            value={amount}
            placeholder="0"
            readOnly
            aria-label="kfUSD received"
          />
          <span className={f.pill}>
            <span className={f.tki}>kf</span>
            kfUSD
          </span>
        </div>
      </div>

      <div className={f.box} style={{ marginTop: 4 }}>
        <div className={f.kv}>
          <span>Rate</span>
          <b>1 {collateral} = 1 kfUSD</b>
        </div>
        <div className={f.kv}>
          <span>Minting fee</span>
          <b>None</b>
        </div>
        <button className={f.cta} disabled={!isConnected || !amount || insufficient || busy} onClick={submit}>
          {cta}
        </button>
      </div>
    </div>
  );
}
