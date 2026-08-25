"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useStable } from "../StableContext";
import { quoteAfterFee, trim } from "../quote";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import TokenIcon, { hasTokenIcon } from "@/components/v2/TokenIcon";
import f from "../form.module.css";

const OUTPUTS = ["USDC", "USDT", "USDe"] as const;
type Output = (typeof OUTPUTS)[number];

/**
 * redeem() reverts below 1e15 wei — "kfUSD: Amount below minimum redemption"
 * (kfUSD.sol:202-205). Enforced here so the form declines instead of the wallet.
 */
const MIN_REDEEM = 0.001;

export default function RedeemPage() {
  const { isConnected } = useWalletV2();
  const { balances, stats, redeemKfUSD } = useStable();
  const [output, setOutput] = useState<Output>("USDC");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const balance = balances?.kfUSD ?? "0";
  const typed = parseFloat(amount || "0");
  const insufficient = isConnected && Number(balance) < typed;
  const belowMinimum = typed > 0 && typed < MIN_REDEEM;

  /* Same shape as the mint side: the fee comes out of the amount named, so the
   * collateral returned is less than the kfUSD burned. */
  const {
    fee,
    output: receives,
    rate,
  } = quoteAfterFee(amount, stats?.redeemFee);

  const submit = async () => {
    if (!isConnected) return toast.error("Connect a wallet first.");
    if (!amount || typed <= 0) return;
    if (belowMinimum) {
      return toast.error(`Minimum redemption is ${MIN_REDEEM} kfUSD.`);
    }
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
    : !amount || typed <= 0
      ? "Enter an amount"
      : belowMinimum
        ? `Minimum ${MIN_REDEEM} kfUSD`
        : insufficient
          ? "Insufficient kfUSD"
          : busy
            ? "Redeeming…"
            : `Redeem ${trim(typed, 2)} kfUSD`;

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
            <span
              className={`${f.tki} ${hasTokenIcon("kfUSD") ? f.tkiArt : ""}`}
            >
              <TokenIcon symbol="kfUSD" size={28} fallback="kf" />
            </span>
            kfUSD
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
        <div className={f.assets}>
          {OUTPUTS.map((o) => (
            <button
              key={o}
              className={`${f.assetChip} ${output === o ? f.assetChipOn : ""}`}
              onClick={() => setOutput(o)}
            >
              <TokenIcon symbol={o} size={16} />
              {o}
            </button>
          ))}
        </div>
        <div className={f.bl}>You receive</div>
        <div className={f.amt}>
          <input
            className={`${f.inp} tabular`}
            value={receives === null || receives === 0 ? "" : trim(receives)}
            placeholder="0"
            readOnly
            aria-label="Collateral received"
          />
          <span className={f.pill}>
            <span
              className={`${f.tki} ${hasTokenIcon(output) ? f.tkiArt : ""}`}
            >
              <TokenIcon
                symbol={output}
                size={28}
                fallback={output.slice(0, 3)}
              />
            </span>
            {output}
          </span>
        </div>
      </div>

      <div className={f.box} style={{ marginTop: 4 }}>
        <div className={f.kv}>
          <span>Rate</span>
          <b className="tabular">
            {rate === null ? "—" : `1 kfUSD = ${trim(rate)} ${output}`}
          </b>
        </div>
        <div className={f.kv}>
          <span>Redemption fee</span>
          <b className="tabular">
            {stats?.redeemFee === null || stats?.redeemFee === undefined
              ? "—"
              : fee && fee > 0
                ? `${stats.redeemFee}% · ${trim(fee, 2)} kfUSD`
                : `${stats.redeemFee}%`}
          </b>
        </div>
        <div className={f.kv}>
          <span>Settles</span>
          <b>Immediately</b>
        </div>
        <button
          className={f.cta}
          disabled={
            !isConnected || !amount || insufficient || belowMinimum || busy
          }
          onClick={submit}
        >
          {cta}
        </button>
      </div>
    </div>
  );
}
