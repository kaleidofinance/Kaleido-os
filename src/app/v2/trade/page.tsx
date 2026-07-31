"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import Nav from "@/components/v2/Nav";
import TokenSelector from "@/components/v2/TokenSelector";
import { ABSTRACT_TOKENS } from "@/constants/tokens";
import type { IToken } from "@/constants/types/dex";
import { useTokenBalance } from "@/hooks/dex/useTokenBalance";
import { useV3SwapRouter } from "@/hooks/dex/useV3SwapRouter";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import s from "./trade.module.css";

/** Default 0.30% fee tier — matches the tier CreateOrder and CardLayout assume elsewhere. */
const DEFAULT_FEE = 3000;
const SLIPPAGE_BPS = 50; // 0.50%, matching the "Auto" default shown in the mockup

type Mode = "swap" | "agent" | "limit" | "buy" | "sell";

const findToken = (symbol: string) =>
  ABSTRACT_TOKENS.find((t) => t.symbol === symbol) ?? ABSTRACT_TOKENS[0];

export default function TradePage() {
  const { isConnected } = useWalletV2();
  const [mode, setMode] = useState<Mode>("swap");

  const [tokenIn, setTokenIn] = useState<IToken>(() => findToken("USDC"));
  const [tokenOut, setTokenOut] = useState<IToken>(() => findToken("KLD"));
  const [amountIn, setAmountIn] = useState("500");
  const [amountOut, setAmountOut] = useState("");
  const [quoting, setQuoting] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [pickerFor, setPickerFor] = useState<"in" | "out" | null>(null);

  const { balance: balanceIn, loading: balanceInLoading } = useTokenBalance(tokenIn);
  const { getV3AmountOut, swapV3 } = useV3SwapRouter();

  // Debounced quote — mirrors the pattern in swapCard.tsx but scoped to what
  // this page actually needs, since that component pulls in the full legacy
  // UI along with the quoting logic.
  useEffect(() => {
    const amount = parseFloat(amountIn);
    if (!amount || amount <= 0 || tokenIn.address === tokenOut.address) {
      setAmountOut("");
      return;
    }

    let cancelled = false;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const out = await getV3AmountOut(
          tokenIn.address,
          tokenOut.address,
          amountIn,
          DEFAULT_FEE,
          tokenIn.decimals,
          tokenOut.decimals,
        );
        if (!cancelled) setAmountOut(out ? String(out) : "");
      } catch {
        if (!cancelled) setAmountOut("");
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [amountIn, tokenIn, tokenOut, getV3AmountOut]);

  const insufficientBalance =
    isConnected && !balanceInLoading && Number(balanceIn) < parseFloat(amountIn || "0");

  const minOut = useMemo(() => {
    if (!amountOut) return "";
    const n = Number(amountOut) * (1 - SLIPPAGE_BPS / 10000);
    return n.toFixed(tokenOut.decimals > 6 ? 6 : tokenOut.decimals);
  }, [amountOut, tokenOut.decimals]);

  const flip = () => {
    const nextIn = tokenOut;
    const nextOut = tokenIn;
    setTokenIn(nextIn);
    setTokenOut(nextOut);
    setAmountIn(amountOut || "0");
  };

  const handleSwap = async () => {
    if (!isConnected) {
      toast.error("Connect a wallet to swap.");
      return;
    }
    if (!amountOut || quoting) return;

    setSwapping(true);
    try {
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      await swapV3(
        tokenIn.address,
        tokenOut.address,
        DEFAULT_FEE,
        amountIn,
        minOut,
        deadline,
        tokenIn.decimals,
        tokenOut.decimals,
      );
      toast.success(`Swapped ${amountIn} ${tokenIn.symbol} for ${tokenOut.symbol}`);
      setAmountIn("");
      setAmountOut("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Swap failed";
      toast.error(message.length > 140 ? "Swap failed — see console for details" : message);
      console.error("[v2/trade] swap failed:", err);
    } finally {
      setSwapping(false);
    }
  };

  const ctaLabel = !isConnected
    ? "Connect wallet"
    : !amountIn || parseFloat(amountIn) <= 0
      ? "Enter an amount"
      : insufficientBalance
        ? `Insufficient ${tokenIn.symbol}`
        : quoting
          ? "Fetching quote…"
          : swapping
            ? "Swapping…"
            : "Review swap";

  const ctaDisabled =
    !isConnected ||
    !amountIn ||
    parseFloat(amountIn) <= 0 ||
    insufficientBalance ||
    quoting ||
    swapping ||
    !amountOut;

  return (
    <>
      <Nav />
      <main className={s.hero}>
        <div className={s.tabs}>
          {(["agent", "swap", "limit", "buy", "sell"] as Mode[]).map((m) => (
            <button
              key={m}
              className={`${s.tb} ${mode === m ? s.on : ""}`}
              onClick={() => setMode(m)}
            >
              {m === "swap" ? "Swap" : m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        <div className={s.card}>
          {mode === "swap" && (
            <>
              <div className={s.box}>
                <div className={s.bl}>Sell</div>
                <div className={s.amt}>
                  <input
                    className={`${s.inp} tabular`}
                    inputMode="decimal"
                    value={amountIn}
                    onChange={(e) => setAmountIn(e.target.value.replace(/[^0-9.]/g, ""))}
                    placeholder="0"
                    aria-label="Amount to sell"
                  />
                  <button className={s.pill} onClick={() => setPickerFor("in")}>
                    <span className={s.tki}>
                      {tokenIn.symbol.slice(0, 3)}
                      <i className={s.cb} style={{ background: "var(--k-chain-abstract)" }} />
                    </span>
                    {tokenIn.symbol}
                    <span className={s.cv}>▾</span>
                  </button>
                </div>
                <div className={s.sub}>
                  <span />
                  <span>
                    {isConnected
                      ? balanceInLoading
                        ? "Loading balance…"
                        : `Balance ${Number(balanceIn).toLocaleString(undefined, { maximumFractionDigits: 4 })} · `
                      : ""}
                    {isConnected && !balanceInLoading && (
                      <b onClick={() => setAmountIn(balanceIn)}>Max</b>
                    )}
                  </span>
                </div>
              </div>

              <div className={s.linkRow}>
                <button className={s.arw} onClick={flip} aria-label="Flip tokens">
                  ↓
                </button>
              </div>

              <div className={s.box}>
                <div className={s.bl}>Buy</div>
                <div className={s.amt}>
                  <input
                    className={`${s.inp} tabular`}
                    value={quoting ? "" : amountOut}
                    placeholder={quoting ? "Fetching…" : "0"}
                    readOnly
                    aria-label="Amount to buy"
                  />
                  <button className={s.pill} onClick={() => setPickerFor("out")}>
                    <span className={s.tki}>
                      {tokenOut.symbol.slice(0, 3)}
                      <i className={s.cb} style={{ background: "var(--k-chain-abstract)" }} />
                    </span>
                    {tokenOut.symbol}
                    <span className={s.cv}>▾</span>
                  </button>
                </div>
              </div>

              <div className={s.box} style={{ marginTop: 4 }}>
                <div className={s.kv}>
                  <span>Max slippage</span>
                  <b>{(SLIPPAGE_BPS / 100).toFixed(2)}% · Auto</b>
                </div>
                <div className={s.kv}>
                  <span>Minimum received</span>
                  <b className="tabular">{minOut ? `${minOut} ${tokenOut.symbol}` : "—"}</b>
                </div>
                <button className={s.cta} disabled={ctaDisabled} onClick={handleSwap}>
                  {ctaLabel}
                </button>
              </div>
            </>
          )}

          {mode !== "swap" && (
            <div className={s.box}>
              <div className={s.stubTitle}>
                {mode === "agent" && "Agent"}
                {mode === "limit" && "Limit"}
                {mode === "buy" && "Buy"}
                {mode === "sell" && "Sell"}
              </div>
              <p className={s.stubBody}>
                {mode === "agent" &&
                  "Luca resolves intent into a signable plan here — see /v2/portfolio's attention sidebar for the shape. Not wired to the live chat API yet."}
                {mode === "limit" &&
                  "Needs an on-chain limit order book or a keeper to fill at target price. Kaleido's P2P listings are the closer primitive — this mode is deferred until that's decided."}
                {(mode === "buy" || mode === "sell") &&
                  "Needs a fiat on/off-ramp integration (MoonPay, Stripe, or similar). No provider is wired into this codebase yet."}
              </p>
            </div>
          )}
        </div>
      </main>

      <TokenSelector
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        exclude={pickerFor === "in" ? tokenOut.symbol : tokenIn.symbol}
        onSelect={(t) => {
          if (pickerFor === "in") setTokenIn(t);
          else setTokenOut(t);
          setPickerFor(null);
        }}
      />
    </>
  );
}
