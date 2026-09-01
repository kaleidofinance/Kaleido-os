"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import Nav from "@/components/v2/Nav";
import ChainGate, { useChainGate } from "@/components/v2/ChainGate";
import TokenIcon, { hasTokenIcon } from "@/components/v2/TokenIcon";
import { useStakeV2 } from "@/hooks/v2/useStakeV2";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { useTokenBalance } from "@/hooks/dex/useTokenBalance";
import { chainTokenBySymbol } from "@/constants/tokens";
import s from "./stake.module.css";

const fmt = (n: number | null, dp = 2) =>
  n === null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: dp });

/** Cooldown countdown, e.g. "13d 4h" or "2h 15m". */
const fmtCooldown = (secs: number) => {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

/**
 * The share-price index as a yield percentage. The index starts at 1.0 and rises
 * as yield is harvested, so `index - 1` is the growth to date.
 */
const fmtYield = (index: number | null) =>
  index === null
    ? "—"
    : `${index >= 1 ? "+" : ""}${((index - 1) * 100).toFixed(2)}%`;

export default function StakePage() {
  const { isConnected, chainId } = useWalletV2();
  const stake = useStakeV2();
  // Resolved per-chain rather than from a compiled-in constant. Returns
  // undefined until KLD is registered for this chain; useTokenBalance accepts
  // null and reports 0, which is the truthful reading when there is no token.
  const kld = useMemo(
    () => chainTokenBySymbol(chainId, "KLD") ?? null,
    [chainId],
  );
  const {
    balance: kldBalance,
    loading: kldLoading,
    unread: kldUnread,
  } = useTokenBalance(kld);

  const [mode, setMode] = useState<"stake" | "unstake">("stake");
  const [amount, setAmount] = useState("");

  const balance = mode === "stake" ? kldBalance : stake.stakedBalance;
  /* Only the KLD side can be unread — `stake.stakedBalance` comes from the
     staking hook, which has its own read path. */
  const balanceUnread = mode === "stake" && kldUnread;
  const balanceLabel = mode === "stake" ? "KLD" : "stKLD";
  /* Always the other one — the form only ever swaps these two. */
  const receiveLabel = mode === "stake" ? "stKLD" : "KLD";
  const busy = mode === "stake" ? stake.staking : stake.unstaking;

  /*
   * 1:1 in both directions.
   *
   * stKLD rebases — balanceOf returns the holder's pooled-KLD claim, not a share
   * count — so staking X KLD raises the stKLD balance by exactly X, and
   * unstaking X stKLD returns exactly X KLD. This previously divided by the
   * share price on stake and multiplied on unstake, double-counting the rebase.
   * It only looked correct while the index sat at 1.0, i.e. before any yield had
   * been harvested.
   */
  const receive = useMemo(() => {
    const a = parseFloat(amount);
    return Number.isFinite(a) && a > 0 ? String(a) : "";
  }, [amount]);

  /* Never against a balance that was not read: `balance` carries "0" then, and
     gating the CTA on it tells a holder they have no KLD and leaves them no way
     forward. Unknown means let the transaction be attempted. */
  const insufficient =
    isConnected &&
    !balanceUnread &&
    Number(balance) < parseFloat(amount || "0");

  /** Unstaking is gated on an open request whose cooldown has elapsed. */
  const canWithdraw = stake.hasRequest && !stake.cooldownActive;

  const submit = async () => {
    if (!isConnected) return toast.error("Connect a wallet first.");
    const a = parseFloat(amount);
    if (!a || a <= 0) return;
    try {
      if (mode === "stake") {
        await stake.stake(amount);
      } else if (!canWithdraw) {
        // Either no request has been made or the cooldown is still running —
        // the vault would revert NoWithdrawalRequest / CooldownNotPassed.
        return;
      } else {
        await stake.unstake(amount);
      }
      setAmount("");
    } catch (err) {
      console.error("[v2/stake]", err);
      toast.error(mode === "stake" ? "Stake failed" : "Unstake failed");
    }
  };

  const onRequest = async () => {
    if (!isConnected) return toast.error("Connect a wallet first.");
    if (Number(stake.stakedBalance) <= 0)
      return toast.error("You have no stake to withdraw.");
    try {
      // No amount: the vault stores a per-account cooldown timestamp, and the
      // size is chosen later at withdraw time.
      await stake.requestWithdrawal();
    } catch (err) {
      console.error("[v2/stake] request", err);
    }
  };

  const onCancel = async () => {
    try {
      await stake.cancelWithdrawal();
    } catch (err) {
      console.error("[v2/stake] cancel", err);
    }
  };

  const cta = !isConnected
    ? "Connect wallet"
    : !amount || parseFloat(amount) <= 0
      ? "Enter an amount"
      : insufficient
        ? `Insufficient ${balanceLabel}`
        : busy
          ? mode === "stake"
            ? "Staking…"
            : "Unstaking…"
          : mode === "stake"
            ? `Stake ${amount} KLD`
            : !stake.hasRequest
              ? "Request withdrawal first"
              : stake.cooldownActive
                ? `Unlocks in ${fmtCooldown(stake.cooldownLeft)}`
                : `Unstake ${amount} stKLD`;

  /* Both the protocol totals and the personal figures come from the KLD vault
     and stKLD, so there is no half-useful state to preserve here: with no
     deployment, "Total staked" is as unknowable as "Your stake". */
  const gate = useChainGate();

  return (
    <>
      <Nav />
      <main className={s.wrap}>
        {!gate.ready ? (
          <ChainGate product="stake" state={gate} />
        ) : (
          <>
            <div className={s.strip}>
              <div className={s.stat}>
                <span className={s.sl}>Total staked</span>
                <span className={`${s.sv} tabular`}>
                  {fmt(stake.totalStaked, 0)} KLD
                </span>
              </div>
              <div className={s.stat}>
                <span className={s.sl}>Yield to date</span>
                <span className={`${s.sv} tabular`}>
                  {fmtYield(stake.yieldIndex)}
                </span>
              </div>
              <div className={s.stat}>
                <span className={s.sl}>Your stake</span>
                <span className={`${s.sv} tabular`}>
                  {fmt(Number(stake.stakedBalance))} stKLD
                </span>
              </div>
              <div className={s.stat}>
                <span className={s.sl}>Stakers</span>
                <span className={`${s.sv} tabular`}>
                  {fmt(stake.stakers, 0)}
                </span>
              </div>
            </div>

            <div className={s.center}>
              <div className={s.tabs}>
                <button
                  className={`${s.tb} ${mode === "stake" ? s.on : ""}`}
                  onClick={() => {
                    setMode("stake");
                    setAmount("");
                  }}
                >
                  Stake
                </button>
                <button
                  className={`${s.tb} ${mode === "unstake" ? s.on : ""}`}
                  onClick={() => {
                    setMode("unstake");
                    setAmount("");
                  }}
                >
                  Unstake
                </button>
              </div>

              <div className={s.card}>
                <div className={s.box}>
                  <div className={s.bl}>
                    You {mode === "stake" ? "stake" : "unstake"}
                  </div>
                  <div className={s.amt}>
                    <input
                      className={`${s.inp} tabular`}
                      inputMode="decimal"
                      value={amount}
                      onChange={(e) =>
                        setAmount(e.target.value.replace(/[^0-9.]/g, ""))
                      }
                      placeholder="0"
                      aria-label={`Amount to ${mode}`}
                    />
                    <span className={s.pill}>
                      <span
                        className={`${s.tki} ${hasTokenIcon(balanceLabel) ? s.tkiArt : ""}`}
                      >
                        <TokenIcon
                          symbol={balanceLabel}
                          size={28}
                          fallback={balanceLabel.slice(0, 3)}
                        />
                      </span>
                      {balanceLabel}
                    </span>
                  </div>
                  <div className={s.sub}>
                    <span />
                    <span>
                      {isConnected && !(mode === "stake" && kldLoading) && (
                        /* Max is dropped with the number, not left pointing at a
                           stale one — it writes the balance into the field, so
                           offering it without a balance to write is the one thing
                           it must not do. */
                        <>
                          {balanceUnread ? (
                            <>Balance —</>
                          ) : (
                            <>
                              Balance {fmt(Number(balance), 4)} ·{" "}
                              <b onClick={() => setAmount(String(balance))}>
                                Max
                              </b>
                            </>
                          )}
                        </>
                      )}
                    </span>
                  </div>
                </div>

                <div className={s.linkRow}>
                  <span className={s.arw}>↓</span>
                </div>

                <div className={s.box}>
                  <div className={s.bl}>You receive</div>
                  <div className={s.amt}>
                    <input
                      className={`${s.inp} tabular`}
                      value={receive}
                      placeholder="0"
                      readOnly
                      aria-label="You receive"
                    />
                    <span className={s.pill}>
                      <span
                        className={`${s.tki} ${hasTokenIcon(receiveLabel) ? s.tkiArt : ""}`}
                      >
                        <TokenIcon
                          symbol={receiveLabel}
                          size={28}
                          fallback={receiveLabel.slice(0, 3)}
                        />
                      </span>
                      {receiveLabel}
                    </span>
                  </div>
                </div>

                <div className={s.box} style={{ marginTop: 4 }}>
                  <div className={s.kv}>
                    <span>Rate</span>
                    <b className="tabular">1 stKLD = 1 KLD</b>
                  </div>
                  <div className={s.kv}>
                    <span>stKLD stays liquid</span>
                    <b>Usable as collateral</b>
                  </div>
                  <div className={s.kv}>
                    <span>How yield accrues</span>
                    <b>Your stKLD balance grows</b>
                  </div>
                  {mode === "unstake" && (
                    <div className={s.kv}>
                      <span>Unstaking</span>
                      <b>
                        {!stake.hasRequest
                          ? "Request, then withdraw after the cooldown"
                          : stake.cooldownActive
                            ? `Unlocks in ${fmtCooldown(stake.cooldownLeft)}`
                            : "Unlocked — withdraw any amount"}
                      </b>
                    </div>
                  )}
                  <button
                    className={s.ctaBtn}
                    disabled={
                      !isConnected ||
                      !amount ||
                      insufficient ||
                      busy ||
                      (mode === "unstake" && !canWithdraw)
                    }
                    onClick={submit}
                  >
                    {cta}
                  </button>

                  {mode === "unstake" && (
                    <div className={s.subActions}>
                      <button
                        className={s.subBtn}
                        disabled={
                          !isConnected || stake.requesting || stake.hasRequest
                        }
                        onClick={onRequest}
                      >
                        {stake.requesting
                          ? "Requesting…"
                          : stake.hasRequest
                            ? "Requested"
                            : "Request withdrawal"}
                      </button>
                      <button
                        className={s.subBtn}
                        disabled={
                          !isConnected || stake.cancelling || !stake.hasRequest
                        }
                        onClick={onCancel}
                      >
                        {stake.cancelling ? "Cancelling…" : "Cancel request"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}
