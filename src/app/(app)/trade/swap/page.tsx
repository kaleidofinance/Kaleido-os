"use client";

import { useEffect, useMemo, useState } from "react";
import TokenSelector from "@/components/v2/TokenSelector";
import PlanReview from "@/components/v2/PlanReview";
import SwapSettings, { AUTO_SLIPPAGE_BPS } from "@/components/v2/SwapSettings";
import { chainTokens } from "@/constants/tokens";
import { getChainMeta } from "@/constants/chains";
import type { IToken } from "@/constants/types/dex";
import { useTokenBalance } from "@/hooks/dex/useTokenBalance";
import { useV3SwapRouter } from "@/hooks/dex/useV3SwapRouter";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import type { Intent } from "@/lib/v2/intents";
import { KALEIDOSWAP_V3_ROUTER } from "@/constants/utils/addresses";
import s from "../trade.module.css";

const DEFAULT_FEE = 3000;

export default function SwapPage() {
  const { isConnected, chainId } = useWalletV2();

  /*
   * Token state is nullable and seeded from the chain, not from a module-level
   * constant. The previous `ABSTRACT_TOKENS.find(...) ?? ABSTRACT_TOKENS[0]`
   * could never return undefined, so the whole page assumed a token always
   * existed — true only while a hardcoded Abstract list was compiled in. With a
   * real per-chain registry the honest answer on an undeployed chain is "none",
   * and the page has to be able to say so.
   */
  const available = useMemo(() => chainTokens(chainId), [chainId]);
  const [tokenIn, setTokenIn] = useState<IToken | null>(null);
  const [tokenOut, setTokenOut] = useState<IToken | null>(null);
  const [amountIn, setAmountIn] = useState("500");
  const [amountOut, setAmountOut] = useState("");
  const [quoting, setQuoting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [pickerFor, setPickerFor] = useState<"in" | "out" | null>(null);
  const [slippageBps, setSlippageBps] = useState(AUTO_SLIPPAGE_BPS);
  const [deadlineMin, setDeadlineMin] = useState(20);

  // Re-seed on every chain change. A token from the previous chain is not a
  // valid selection here — same symbol, different asset, possibly different
  // decimals — so the pair resets rather than carrying across.
  useEffect(() => {
    const pick = (sym: string) => available.find((t) => t.symbol === sym);
    setTokenIn(pick("USDC") ?? available[0] ?? null);
    setTokenOut(pick("KLD") ?? available[1] ?? null);
    setAmountOut("");
  }, [available]);

  const { balance: balanceIn, loading: balanceInLoading } = useTokenBalance(tokenIn);
  const { getV3AmountOut } = useV3SwapRouter();

  useEffect(() => {
    const amount = parseFloat(amountIn);
    if (!tokenIn || !tokenOut || !amount || amount <= 0 || tokenIn.address === tokenOut.address) {
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
    if (!amountOut || !tokenOut) return "";
    const n = Number(amountOut) * (1 - slippageBps / 10000);
    return n.toFixed(tokenOut.decimals > 6 ? 6 : tokenOut.decimals);
  }, [amountOut, slippageBps, tokenOut]);

  const flip = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmountIn(amountOut || "0");
  };

  // A swap is a two-step plan: approve the router to move tokenIn, then swap.
  // The approve resolver no-ops when allowance already covers it, so the step
  // simply shows "already done" — one code path whether or not approval exists.
  const plan: Intent[] = useMemo(
    () =>
      !tokenIn || !tokenOut
        ? []
        : [
            {
              kind: "approve",
              token: tokenIn.address,
              spender: KALEIDOSWAP_V3_ROUTER,
              amount: amountIn || "0",
              decimals: tokenIn.decimals,
              symbol: tokenIn.symbol,
            },
            {
              kind: "swap",
              tokenIn: tokenIn.address,
              tokenOut: tokenOut.address,
              amountIn: amountIn || "0",
              amountOutMin: minOut || "0",
              fee: DEFAULT_FEE,
              decimalsIn: tokenIn.decimals,
              decimalsOut: tokenOut.decimals,
              symbolIn: tokenIn.symbol,
              symbolOut: tokenOut.symbol,
              deadlineMin,
            },
          ],
    [tokenIn, tokenOut, amountIn, minOut, deadlineMin],
  );

  const onComplete = () => {
    setReviewing(false);
    setAmountIn("");
    setAmountOut("");
  };

  const ctaLabel = !isConnected
    ? "Connect wallet"
    : !tokenIn || !tokenOut
      ? "No tokens on this network"
      : !amountIn || parseFloat(amountIn) <= 0
        ? "Enter an amount"
        : insufficientBalance
          ? `Insufficient ${tokenIn.symbol}`
          : quoting
            ? "Fetching quote…"
            : "Review swap";

  const ctaDisabled =
    !isConnected ||
    !tokenIn ||
    !tokenOut ||
    !amountIn ||
    parseFloat(amountIn) <= 0 ||
    insufficientBalance ||
    quoting ||
    !amountOut;

  /*
   * All hooks have run by this point, so an early return here is safe.
   * Rendering the swap form without a token pair would mean dereferencing null
   * in a dozen places; more importantly there is nothing useful to show, since
   * no token on this chain means no pool to route through either.
   */
  if (!tokenIn || !tokenOut) {
    const here = getChainMeta(chainId)?.name;
    return (
      <div className={s.card}>
        <div className={s.box}>
          <div className={s.bl}>Swap unavailable</div>
          <p>
            Kaleido&apos;s contracts aren&apos;t deployed
            {here ? ` on ${here}` : " on any network"} yet, so there are no
            tokens to swap here. They&apos;re being redeployed from scratch —
            testnet first — starting with Arc, Base, Robinhood, BNB Smart Chain
            and Ethereum.
          </p>
        </div>
      </div>
    );
  }

  if (reviewing) {
    return (
      <div className={s.card}>
        <div className={s.box}>
          <PlanReview
            intents={plan}
            submitLabel={`Sign & swap`}
            onComplete={onComplete}
            onCancel={() => setReviewing(false)}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={s.card}>
        <div className={s.cardTop}>
          <SwapSettings
            slippageBps={slippageBps}
            onSlippage={setSlippageBps}
            deadlineMin={deadlineMin}
            onDeadline={setDeadlineMin}
          />
        </div>
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
              {isConnected && !balanceInLoading && (
                <>
                  Balance {Number(balanceIn).toLocaleString(undefined, { maximumFractionDigits: 4 })} ·{" "}
                  <b onClick={() => setAmountIn(balanceIn)}>Max</b>
                </>
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
            <b>
              {(slippageBps / 100).toFixed(2)}%
              {slippageBps === AUTO_SLIPPAGE_BPS ? " · Auto" : ""}
            </b>
          </div>
          <div className={s.kv}>
            <span>Minimum received</span>
            <b className="tabular">{minOut ? `${minOut} ${tokenOut.symbol}` : "—"}</b>
          </div>
          <button className={s.cta} disabled={ctaDisabled} onClick={() => setReviewing(true)}>
            {ctaLabel}
          </button>
        </div>
      </div>

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
