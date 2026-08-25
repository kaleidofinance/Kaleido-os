"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useStable } from "../StableContext";
import { quoteAfterFee, trim } from "../quote";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import TokenIcon, { hasTokenIcon } from "@/components/v2/TokenIcon";
import f from "../form.module.css";

const COLLATERALS = ["USDC", "USDT", "USDe"] as const;
type Collateral = (typeof COLLATERALS)[number];

export default function MintPage() {
  const { isConnected } = useWalletV2();
  const { balances, stats, mintKfUSD } = useStable();
  const [collateral, setCollateral] = useState<Collateral>("USDC");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const balance = balances?.[collateral] ?? "0";
  const insufficient =
    isConnected && Number(balance) < parseFloat(amount || "0");

  /* kfUSD takes its mint fee out of the amount minted, so the user receives
   * less kfUSD than the collateral they deposit. Everything below quotes off
   * this one result rather than restating the input. */
  const { fee, output, rate } = quoteAfterFee(amount, stats?.mintFee);

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
          : /* The post-fee figure. This used to promise the pre-fee one, so the
             * button named an amount the transaction could not deliver. */
            output === null
            ? "Mint kfUSD"
            : `Mint ${trim(output, 2)} kfUSD`;

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
              <TokenIcon symbol={c} size={16} />
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
            <span
              className={`${f.tki} ${hasTokenIcon(collateral) ? f.tkiArt : ""}`}
            >
              <TokenIcon
                symbol={collateral}
                size={28}
                fallback={collateral.slice(0, 3)}
              />
            </span>
            {collateral}
          </span>
        </div>
        <div className={f.sub}>
          <span />
          <span>
            {isConnected && (
              <>
                Balance{" "}
                {Number(balance).toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}{" "}
                · <b onClick={() => setAmount(String(balance))}>Max</b>
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
            value={output === null ? "" : output === 0 ? "" : trim(output)}
            placeholder="0"
            readOnly
            aria-label="kfUSD received"
          />
          <span className={f.pill}>
            <span
              className={`${f.tki} ${hasTokenIcon("kfUSD") ? f.tkiArt : ""}`}
            >
              <TokenIcon symbol="kfUSD" size={28} fallback="kf" />
            </span>
            kfUSD
          </span>
        </div>
      </div>

      <div className={f.box} style={{ marginTop: 4 }}>
        <div className={f.kv}>
          <span>Rate</span>
          <b className="tabular">
            {rate === null ? "—" : `1 ${collateral} = ${trim(rate)} kfUSD`}
          </b>
        </div>
        <div className={f.kv}>
          <span>Minting fee</span>
          <b className="tabular">
            {stats?.mintFee === null || stats?.mintFee === undefined
              ? "—"
              : fee && fee > 0
                ? `${stats.mintFee}% · ${trim(fee, 2)} ${collateral}`
                : `${stats.mintFee}%`}
          </b>
        </div>
        <button
          className={f.cta}
          disabled={!isConnected || !amount || insufficient || busy}
          onClick={submit}
        >
          {cta}
        </button>
      </div>
    </div>
  );
}
