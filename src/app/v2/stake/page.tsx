"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import Nav from "@/components/v2/Nav";
import { useStakeV2 } from "@/hooks/v2/useStakeV2";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { useTokenBalance } from "@/hooks/dex/useTokenBalance";
import { ABSTRACT_TOKENS } from "@/constants/tokens";
import s from "./stake.module.css";

const KLD = ABSTRACT_TOKENS.find((t) => t.symbol === "KLD") ?? ABSTRACT_TOKENS[0];

const fmt = (n: number | null, dp = 2) =>
  n === null
    ? "—"
    : n.toLocaleString("en-US", { maximumFractionDigits: dp });

export default function StakePage() {
  const { isConnected } = useWalletV2();
  const stake = useStakeV2();
  const { balance: kldBalance, loading: kldLoading } = useTokenBalance(KLD);

  const [mode, setMode] = useState<"stake" | "unstake">("stake");
  const [amount, setAmount] = useState("");

  const balance = mode === "stake" ? kldBalance : stake.stakedBalance;
  const balanceLabel = mode === "stake" ? "KLD" : "stKLD";
  const busy = mode === "stake" ? stake.staking : stake.unstaking;

  // stake: KLD → stKLD (divide by rate); unstake: stKLD → KLD (multiply).
  const receive = useMemo(() => {
    const a = parseFloat(amount);
    if (!a || !stake.exchangeRate) return "";
    const out = mode === "stake" ? a / stake.exchangeRate : a * stake.exchangeRate;
    return out.toFixed(4);
  }, [amount, mode, stake.exchangeRate]);

  const insufficient =
    isConnected && Number(balance) < parseFloat(amount || "0");

  const submit = async () => {
    if (!isConnected) return toast.error("Connect a wallet first.");
    const a = parseFloat(amount);
    if (!a || a <= 0) return;
    try {
      if (mode === "stake") await stake.stake(amount);
      else await stake.unstake(amount);
      setAmount("");
    } catch (err) {
      console.error("[v2/stake]", err);
      toast.error(mode === "stake" ? "Stake failed" : "Unstake failed");
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
            : `Unstake ${amount} stKLD`;

  return (
    <>
      <Nav />
      <main className={s.wrap}>
        <div className={s.strip}>
          <div className={s.stat}>
            <span className={s.sl}>Total staked</span>
            <span className={`${s.sv} tabular`}>{fmt(stake.totalStaked, 0)} KLD</span>
          </div>
          <div className={s.stat}>
            <span className={s.sl}>Exchange rate</span>
            <span className={`${s.sv} tabular`}>
              {stake.exchangeRate ? `${stake.exchangeRate.toFixed(4)}` : "—"}
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
            <span className={`${s.sv} tabular`}>{fmt(stake.stakers, 0)}</span>
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
              <div className={s.bl}>You {mode === "stake" ? "stake" : "unstake"}</div>
              <div className={s.amt}>
                <input
                  className={`${s.inp} tabular`}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  placeholder="0"
                  aria-label={`Amount to ${mode}`}
                />
                <span className={s.pill}>
                  <span className={s.tki}>{balanceLabel.slice(0, 3)}</span>
                  {balanceLabel}
                </span>
              </div>
              <div className={s.sub}>
                <span />
                <span>
                  {isConnected && !(mode === "stake" && kldLoading) && (
                    <>
                      Balance {fmt(Number(balance), 4)} ·{" "}
                      <b onClick={() => setAmount(String(balance))}>Max</b>
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
                  <span className={s.tki}>
                    {mode === "stake" ? "stK" : "KLD"}
                  </span>
                  {mode === "stake" ? "stKLD" : "KLD"}
                </span>
              </div>
            </div>

            <div className={s.box} style={{ marginTop: 4 }}>
              <div className={s.kv}>
                <span>Rate</span>
                <b className="tabular">
                  {stake.exchangeRate
                    ? `1 stKLD = ${stake.exchangeRate.toFixed(4)} KLD`
                    : "—"}
                </b>
              </div>
              <div className={s.kv}>
                <span>stKLD stays liquid</span>
                <b>Usable as collateral</b>
              </div>
              <div className={s.kv}>
                <span>How yield accrues</span>
                <b>Exchange rate rises</b>
              </div>
              <button className={s.ctaBtn} disabled={!isConnected || !amount || insufficient || busy} onClick={submit}>
                {cta}
              </button>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
