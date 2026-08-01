"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useStable } from "../StableContext";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import f from "../form.module.css";

/**
 * Earn — the kafUSD vault.
 *
 * Deposit is lockAssets(). Exiting is a lifecycle, not one call:
 * requestWithdrawal → notice period → completeWithdrawal, with
 * withdrawFromVault as the direct path where no notice applies. Shipping only
 * the deposit side (as this page first did) meant funds could go in with no
 * way out, so claim/compound and the full exit are wired here too.
 */

type Mode = "deposit" | "withdraw";

const OUTPUT_TOKENS = ["USDC", "USDT", "USDe"] as const;

export default function EarnPage() {
  const { isConnected } = useWalletV2();
  const {
    balances,
    stats,
    lockAssets,
    withdrawalInfo,
    userRewards,
    requestWithdrawal,
    completeWithdrawal,
    withdrawFromVault,
    claimYield,
    claimAndCompound,
  } = useStable();

  const [mode, setMode] = useState<Mode>("deposit");
  const [amount, setAmount] = useState("");
  const [outputToken, setOutputToken] = useState<(typeof OUTPUT_TOKENS)[number]>("USDC");
  const [busy, setBusy] = useState<string | null>(null);

  const depositBalance = balances?.kfUSD ?? "0";
  const vaultBalance = balances?.kafUSD ?? "0";
  const balance = mode === "deposit" ? depositBalance : vaultBalance;
  const insufficient = isConnected && Number(balance) < parseFloat(amount || "0");

  const run = async (key: string, fn: () => Promise<unknown>, successMsg?: string) => {
    if (!isConnected) return toast.error("Connect a wallet first.");
    setBusy(key);
    try {
      await fn();
      if (successMsg) toast.success(successMsg);
      setAmount("");
    } catch (err) {
      console.error(`[v2/stable/earn] ${key}`, err);
    } finally {
      setBusy(null);
    }
  };

  const submit = () => {
    if (!amount || parseFloat(amount) <= 0) return;
    if (mode === "deposit") {
      return run("deposit", () => lockAssets("kfUSD", amount));
    }
    return run("withdraw", () => withdrawFromVault(amount, outputToken));
  };

  const cta = !isConnected
    ? "Connect wallet"
    : !amount || parseFloat(amount) <= 0
      ? "Enter an amount"
      : insufficient
        ? `Insufficient ${mode === "deposit" ? "kfUSD" : "kafUSD"}`
        : busy === "deposit"
          ? "Depositing…"
          : busy === "withdraw"
            ? "Withdrawing…"
            : mode === "deposit"
              ? `Deposit ${amount} kfUSD`
              : `Withdraw ${amount} kafUSD`;

  const hasRewards =
    !!userRewards?.totalRewards && userRewards.totalRewards !== "$0.00";

  return (
    <div className={f.card}>
      <div className={f.seg}>
        <button
          className={`${f.segBtn} ${mode === "deposit" ? f.segOn : ""}`}
          onClick={() => {
            setMode("deposit");
            setAmount("");
          }}
        >
          Deposit
        </button>
        <button
          className={`${f.segBtn} ${mode === "withdraw" ? f.segOn : ""}`}
          onClick={() => {
            setMode("withdraw");
            setAmount("");
          }}
        >
          Withdraw
        </button>
      </div>

      <div className={f.box}>
        <div className={f.bl}>You {mode === "deposit" ? "deposit" : "withdraw"}</div>
        <div className={f.amt}>
          <input
            className={`${f.inp} tabular`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0"
            aria-label={mode === "deposit" ? "kfUSD to deposit" : "kafUSD to withdraw"}
          />
          <span className={f.pill}>
            <span className={f.tki}>{mode === "deposit" ? "kf" : "kaf"}</span>
            {mode === "deposit" ? "kfUSD" : "kafUSD"}
          </span>
        </div>
        <div className={f.sub}>
          <span />
          <span>
            {isConnected && (
              <>
                Balance{" "}
                {Number(balance).toLocaleString(undefined, { maximumFractionDigits: 2 })} ·{" "}
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
            aria-label="Amount received"
          />
          <span className={f.pill}>
            <span className={f.tki}>{mode === "deposit" ? "kaf" : outputToken.slice(0, 3)}</span>
            {mode === "deposit" ? "kafUSD" : outputToken}
          </span>
        </div>
        {mode === "withdraw" && (
          <div className={f.tokenRow}>
            {OUTPUT_TOKENS.map((t) => (
              <button
                key={t}
                className={`${f.tokenOpt} ${outputToken === t ? f.tokenOn : ""}`}
                onClick={() => setOutputToken(t)}
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className={f.box} style={{ marginTop: 4 }}>
        <div className={f.kv}>
          <span>Yield</span>
          <b className="tabular">
            {stats?.totalYieldAPY ? `${stats.totalYieldAPY}% APY` : "—"}
          </b>
        </div>
        <div className={f.kv}>
          <span>Where it comes from</span>
          <b>Lending &amp; pool fees</b>
        </div>
        <div className={f.kv}>
          <span>Withdrawal notice</span>
          <b>
            {withdrawalInfo?.hasWithdrawal
              ? `Unlocks in ${withdrawalInfo.unlockTime}`
              : "Applies on exit"}
          </b>
        </div>

        <button
          className={f.cta}
          disabled={!isConnected || !amount || insufficient || busy !== null}
          onClick={submit}
        >
          {cta}
        </button>

        {mode === "withdraw" && (
          <div className={f.subActions}>
            {withdrawalInfo?.hasWithdrawal ? (
              <button
                className={f.subBtn}
                disabled={busy !== null}
                onClick={() =>
                  run("complete", () => completeWithdrawal(outputToken), "Withdrawal completed")
                }
              >
                {busy === "complete" ? "Completing…" : "Complete withdrawal"}
              </button>
            ) : (
              <button
                className={f.subBtn}
                disabled={busy !== null || !amount}
                onClick={() =>
                  run("request", () => requestWithdrawal(amount), "Withdrawal requested")
                }
              >
                {busy === "request" ? "Requesting…" : "Request withdrawal"}
              </button>
            )}
          </div>
        )}
      </div>

      <div className={f.box} style={{ marginTop: 4 }}>
        <div className={f.kv}>
          <span>Unclaimed yield</span>
          <b className="tabular">{userRewards?.totalRewards ?? "$0.00"}</b>
        </div>
        <div className={f.subActions}>
          <button
            className={f.subBtn}
            disabled={!isConnected || !hasRewards || busy !== null}
            onClick={() => run("claim", () => claimYield("kfUSD"), "Yield claimed")}
          >
            {busy === "claim" ? "Claiming…" : "Claim"}
          </button>
          <button
            className={f.subBtn}
            disabled={!isConnected || !hasRewards || busy !== null}
            onClick={() => run("compound", () => claimAndCompound(), "Yield compounded")}
          >
            {busy === "compound" ? "Compounding…" : "Claim & compound"}
          </button>
        </div>
      </div>
    </div>
  );
}
