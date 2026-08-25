"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useStable } from "../StableContext";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import TokenIcon, { hasTokenIcon } from "@/components/v2/TokenIcon";
import f from "../form.module.css";

/**
 * Earn — the kafUSD vault.
 *
 * Deposit is lockAssets(). Exiting is a lifecycle, not one call:
 * requestWithdrawal → 7-day notice → completeWithdrawal(asset). kafUSD.sol has
 * no immediate path, so the two steps are both shown rather than hidden behind
 * one "Withdraw" button that could only ever do the first of them.
 *
 * In and out is kfUSD. lockAssets accepts any supported asset, but this tab only
 * ever locks kfUSD, and completeWithdrawal releases from
 * assetLockBalances[user][asset] — so USDC/USDT/USDe, which this page used to
 * offer as payout options, could only revert with "Insufficient asset balance".
 * Cashing out to those is Redeem's job (kfUSD → collateral), one step later.
 */

type Mode = "deposit" | "withdraw";

/* The vault's two sides. Named once so the pills below cannot disagree about
 * which way round the swap goes, and so the monogram each falls back to travels
 * with its symbol instead of being sliced off it — "kfUSD".slice(0, 3) is "kfU".
 */
const KFUSD = { symbol: "kfUSD", mono: "kf" } as const;
const KAFUSD = { symbol: "kafUSD", mono: "kaf" } as const;

const fmt = (v: string | number) =>
  Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });

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
    claimYield,
    claimAndCompound,
  } = useStable();

  const [mode, setMode] = useState<Mode>("deposit");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const paying = mode === "deposit" ? KFUSD : KAFUSD;
  const receiving = mode === "deposit" ? KAFUSD : KFUSD;

  const depositBalance = balances?.kfUSD ?? "0";
  const vaultBalance = balances?.kafUSD ?? "0";
  const lockedBalance = withdrawalInfo?.lockedAmount ?? "0";

  /*
   * completeWithdrawal burns kafUSD *and* releases locked kfUSD
   * (kafUSD.sol:185,193), so the exit is capped by whichever of the two is
   * smaller. kafUSD is a plain transferable ERC20, so a holder can have more
   * than they locked — requesting against the balance alone queues a withdrawal
   * that sits through the whole notice and then reverts.
   */
  const withdrawMax =
    Number(vaultBalance) <= Number(lockedBalance)
      ? vaultBalance
      : lockedBalance;
  const balance = mode === "deposit" ? depositBalance : withdrawMax;
  const typed = parseFloat(amount || "0");
  const insufficient = isConnected && Number(balance) < typed;

  const queued = withdrawalInfo?.pendingAmount ?? "0";
  const hasQueued = !!withdrawalInfo?.hasWithdrawal;
  const canComplete = hasQueued && !!withdrawalInfo?.isReady;

  const run = async (
    key: string,
    fn: () => Promise<unknown>,
    successMsg?: string,
  ) => {
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
    if (!amount || typed <= 0) return;
    if (mode === "deposit") {
      return run("deposit", () => lockAssets("kfUSD", amount));
    }
    return run("request", () => requestWithdrawal(amount), "Withdrawal queued");
  };

  /*
   * Which cap the amount broke. "Insufficient kafUSD" is the wrong thing to say
   * when the wallet holds it but never locked the kfUSD behind it — that is a
   * different problem with a different fix.
   */
  const capMsg =
    mode === "deposit"
      ? "Insufficient kfUSD"
      : typed > Number(vaultBalance)
        ? "Insufficient kafUSD"
        : `Only ${fmt(lockedBalance)} kafUSD unlockable`;

  const cta = !isConnected
    ? "Connect wallet"
    : !amount || typed <= 0
      ? "Enter an amount"
      : insufficient
        ? capMsg
        : busy === "deposit"
          ? "Depositing…"
          : busy === "request"
            ? "Queueing…"
            : mode === "deposit"
              ? `Deposit ${amount} kfUSD`
              : hasQueued
                ? `Replace request with ${amount} kafUSD`
                : `Request withdrawal of ${amount} kafUSD`;

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
        <div className={f.bl}>
          You {mode === "deposit" ? "deposit" : "withdraw"}
        </div>
        <div className={f.amt}>
          <input
            className={`${f.inp} tabular`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0"
            aria-label={
              mode === "deposit" ? "kfUSD to deposit" : "kafUSD to withdraw"
            }
          />
          <span className={f.pill}>
            <span
              className={`${f.tki} ${hasTokenIcon(paying.symbol) ? f.tkiArt : ""}`}
            >
              <TokenIcon
                symbol={paying.symbol}
                size={28}
                fallback={paying.mono}
              />
            </span>
            {paying.symbol}
          </span>
        </div>
        <div className={f.sub}>
          <span />
          <span>
            {isConnected && (
              <>
                {mode === "deposit" ? "Balance" : "Unlockable"} {fmt(balance)} ·{" "}
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
            <span
              className={`${f.tki} ${hasTokenIcon(receiving.symbol) ? f.tkiArt : ""}`}
            >
              <TokenIcon
                symbol={receiving.symbol}
                size={28}
                fallback={receiving.mono}
              />
            </span>
            {receiving.symbol}
          </span>
        </div>
        {mode === "withdraw" && (
          <div className={f.sub}>
            <span className={f.cv}>
              Cash out to USDC, USDT or USDe on Redeem.
            </span>
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
            {!hasQueued
              ? `${withdrawalInfo?.unlockTime ?? "7d 0h 0m"} from request`
              : canComplete
                ? "Ready to withdraw"
                : `Unlocks in ${withdrawalInfo?.unlockTime}`}
          </b>
        </div>

        <button
          className={f.cta}
          disabled={!isConnected || !amount || insufficient || busy !== null}
          onClick={submit}
        >
          {cta}
        </button>

        {/*
         * The vault keeps one request slot per address and requestWithdrawal
         * overwrites it unconditionally (kafUSD.sol:138-139), so a second
         * request silently throws away however much of the notice had already
         * elapsed. Said before the click, not after.
         */}
        {mode === "withdraw" && hasQueued && typed > 0 && (
          <div className={f.cv} style={{ marginTop: 8 }}>
            Replaces the {fmt(queued)} kafUSD already queued and restarts the
            notice.
          </div>
        )}
      </div>

      {mode === "withdraw" && hasQueued && (
        <div className={f.box} style={{ marginTop: 4 }}>
          {/*
           * completeWithdrawal takes no amount — it burns the figure recorded
           * at request time (kafUSD.sol:166). So the claim lives here, next to
           * the queued amount, rather than reading whatever is in the form.
           */}
          <div className={f.kv}>
            <span>Queued withdrawal</span>
            <b className="tabular">{fmt(queued)} kafUSD</b>
          </div>
          <div className={f.kv}>
            <span>{canComplete ? "Status" : "Unlocks in"}</span>
            <b className="tabular">
              {canComplete ? "Ready" : withdrawalInfo?.unlockTime}
            </b>
          </div>
          <div className={f.subActions}>
            <button
              className={f.subBtn}
              disabled={!canComplete || busy !== null}
              onClick={() =>
                run(
                  "complete",
                  () => completeWithdrawal("kfUSD"),
                  "Withdrawal completed",
                )
              }
            >
              {busy === "complete"
                ? "Withdrawing…"
                : canComplete
                  ? `Withdraw ${fmt(queued)} kfUSD`
                  : "Locked until the notice ends"}
            </button>
          </div>
        </div>
      )}

      <div className={f.box} style={{ marginTop: 4 }}>
        <div className={f.kv}>
          <span>Unclaimed yield</span>
          <b className="tabular">{userRewards?.totalRewards ?? "$0.00"}</b>
        </div>
        <div className={f.subActions}>
          <button
            className={f.subBtn}
            disabled={!isConnected || !hasRewards || busy !== null}
            onClick={() =>
              run("claim", () => claimYield("kfUSD"), "Yield claimed")
            }
          >
            {busy === "claim" ? "Claiming…" : "Claim"}
          </button>
          <button
            className={f.subBtn}
            disabled={!isConnected || !hasRewards || busy !== null}
            onClick={() =>
              run("compound", () => claimAndCompound(), "Yield compounded")
            }
          >
            {busy === "compound" ? "Compounding…" : "Claim & compound"}
          </button>
        </div>
      </div>
    </div>
  );
}
