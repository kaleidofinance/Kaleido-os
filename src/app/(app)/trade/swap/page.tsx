"use client";

import { useEffect, useMemo, useState } from "react";
import TokenSelector from "@/components/v2/TokenSelector";
import PlanReview from "@/components/v2/PlanReview";
import SwapSettings, { AUTO_SLIPPAGE_BPS } from "@/components/v2/SwapSettings";
import TxHistory from "@/components/v2/TxHistory";
import { ChartToggle, usePublishChartPair } from "@/components/v2/ChartPanel";
import TokenIcon, { hasTokenIcon } from "@/components/v2/TokenIcon";
import { chainTokens } from "@/constants/tokens";
import type { IToken } from "@/constants/types/dex";
import { useTokenBalance } from "@/hooks/dex/useTokenBalance";
import { useV3SwapRouter } from "@/hooks/dex/useV3SwapRouter";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import type { Intent } from "@/lib/v2/intents";
import s from "../trade.module.css";

const DEFAULT_FEE = 3000;

/** Quick sell amounts, as fractions of the sell-side balance. */
const QUICK = [0.25, 0.5, 0.75, 1] as const;

/**
 * The chain whose token list fills the form before a wallet is connected.
 *
 * This is NOT the DEFAULT_CHAIN_ID that chains.ts deliberately refuses to
 * export, and the difference is worth being precise about. That constant was
 * read by code that sent transactions and fetched balances, so it silently
 * produced answers about a chain the user was not on. This one is display-only:
 * it seeds two pills and a chart label on a form whose CTA is already disabled
 * by `!isConnected`, and it is discarded the moment a wallet arrives, because
 * `available` changes and the seeding effect re-runs against the real chain.
 *
 * Ethereum because it is the one chain carrying both ETH and USDT, which is
 * what a swap form should open on: an empty pair reads as broken, and "Select
 * token" twice gives a first-time visitor nothing to look at.
 */
const PREVIEW_CHAIN_ID = 1;

/**
 * Seeding order per side, most wanted first.
 *
 * Symbols rather than addresses because this is a *preference*, resolved
 * against whatever the connected chain actually has — the list is a ranking,
 * not a claim that any of these exist. Every entry after the first is a
 * fallback for a chain missing the one above it: Base and the Sepolias carry no
 * USDT, so they open on USDC instead, which is true rather than empty.
 *
 * "ETH" does not lead the sell list even though ETH is what we want to open on,
 * because the sell side asks for the *native* asset before it reads this at all.
 * Naming ETH here instead would have seeded BNB Smart Chain with USDC and
 * Polygon with USDC — a form that opens on a stablecoin you may not hold, on a
 * chain whose gas token is sitting right there.
 */
const PREFER_SELL = ["WETH", "USDC"] as const;
const PREFER_BUY = ["USDT", "USDC", "WETH", "ETH"] as const;

/**
 * A balance for the row under each well, or a dash when there isn't one.
 *
 * `useTokenBalance` reports `unread` when the read did not land — a dead RPC in
 * chains.ts, an endpoint still refusing after its retries. Formatting the "0" it
 * carries in that state would tell the user their wallet is empty on the strength
 * of a request that failed, which is the failure this whole path was rewritten
 * for. A dash says the same thing the code knows: not read.
 */
const balanceText = (balance: string, unread: boolean) =>
  unread
    ? "—"
    : Number(balance).toLocaleString(undefined, { maximumFractionDigits: 4 });

/**
 * The token button on a swap side. Takes a nullable token so the form can
 * render before a pair is chosen — an unselected side is an ordinary state, not
 * an error, and it reads as "Select token" rather than replacing the screen.
 */
function TokenPill({
  token,
  onClick,
  label,
}: {
  token: IToken | null;
  onClick: () => void;
  label: string;
}) {
  return (
    <button className={s.pill} onClick={onClick} aria-label={label}>
      {token ? (
        <>
          <span
            className={`${s.tki} ${hasTokenIcon(token.symbol) ? s.tkiArt : ""}`}
          >
            {/* The badge is load-bearing here, not decoration. The picker opens
                filtered to the connected chain but the filter is a control, so a
                user who changes it can pick a token from a chain the wallet isn't
                on — and then the quote is requested from the wallet chain's router
                and comes back empty. The pill is the only place that state is
                visible, and until now it showed a nameless coloured dot: the ring
                was drawn and left empty, so the one screen where a token's chain
                is least obvious was the one screen that didn't say it.

                Labelled (the default), because unlike a list row nothing else
                here names the chain — the pill prints the bare symbol. */}
            <TokenIcon
              symbol={token.symbol}
              size={28}
              fallback={token.symbol.slice(0, 3)}
              chainId={token.chainId}
            />
          </span>
          {token.symbol}
        </>
      ) : (
        "Select token"
      )}
      <span className={s.cv}>▾</span>
    </button>
  );
}

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
  /*
   * Falls back to the preview chain only while disconnected — never while
   * connected to a chain that happens to be thin. Robinhood testnet has one
   * asset and Arc has one; offering Ethereum's list there would put tokens in
   * the picker that do not exist on the chain you are on, which is the exact
   * ABSTRACT_TOKENS failure this module was rewritten to end.
   */
  const available = useMemo(
    () => chainTokens(chainId ?? PREVIEW_CHAIN_ID),
    [chainId],
  );
  const [tokenIn, setTokenIn] = useState<IToken | null>(null);
  const [tokenOut, setTokenOut] = useState<IToken | null>(null);
  const [amountIn, setAmountIn] = useState("500");
  const [amountOut, setAmountOut] = useState("");
  const [quoting, setQuoting] = useState(false);
  /**
   * The quote was asked for and came back with no price.
   *
   * Distinct from `!amountOut`, which is also true before the first quote and
   * between keystrokes. Without it the CTA read "Review swap" for a pair it had
   * failed to price — enabled, because `amountOut` held the string `"0"` and
   * `"0"` is truthy. The button is the control that sends a transaction, so it is
   * the one place that has to say what is actually known.
   */
  const [noRoute, setNoRoute] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [pickerFor, setPickerFor] = useState<"in" | "out" | null>(null);
  const [slippageBps, setSlippageBps] = useState(AUTO_SLIPPAGE_BPS);
  const [deadlineMin, setDeadlineMin] = useState(20);

  /*
   * Fills whichever side is not a token on this chain.
   *
   * IT USED TO RESET BOTH SIDES UNCONDITIONALLY whenever `available` changed,
   * which was fine while the only thing that changed `available` was the user
   * switching network behind the form. TokenSelector now switches the network
   * *as part of* returning a token, so the two updates land together and their
   * order is not ours to decide: seed-then-select gives the picked token, while
   * select-then-seed threw it away and left the form on the new chain's defaults,
   * one click after the user asked for something else.
   *
   * Checking validity instead of tracking the change removes the ordering
   * question rather than betting on it. A token from the previous chain is never
   * in the new list — identity is (chainId, address) and `available` is one
   * chain's worth — so a genuine chain switch still reseeds both sides exactly as
   * before. The only case that behaves differently is the one that was broken.
   *
   * `tokenIn`/`tokenOut` are dependencies now, so this runs after every pick and
   * returns on the first two lines. That is the cost of not needing a ref written
   * during render to read state the effect must not re-run on.
   */
  useEffect(() => {
    /* By identity, never by symbol or address alone. Same-address-different-chain
       is the collision this guards: a token bridged to the same 20 bytes on two
       chains would otherwise look valid on both. */
    const validHere = (t: IToken | null) =>
      t &&
      available.some((a) => a.chainId === t.chainId && a.address === t.address)
        ? t
        : null;

    const inOk = validHere(tokenIn);
    const outOk = validHere(tokenOut);
    if (inOk && outOk) return;

    const pick = (prefs: readonly string[], not?: IToken | null) =>
      prefs.reduce<IToken | undefined>(
        (found, sym) =>
          found ??
          available.find((t) => t.symbol === sym && t.address !== not?.address),
        undefined,
      );

    /*
     * ?in / ?out — where the pool detail page's Swap button lands.
     *
     * Read from `window.location` inside the effect rather than through
     * `useSearchParams`, which would require wrapping this page in a Suspense
     * boundary to prerender. Same call this makes as NotificationsContext's
     * ?notif handler: the value is only ever used to seed state in an effect, so
     * the hook buys nothing here.
     *
     * Matched against `available`, so an address that is not a token on this
     * chain is ignored rather than selected. That is not defensive padding — the
     * addresses come from READ_ONLY_CHAIN_ID's factory while the wallet may be
     * on any chain, where the same 20 bytes are either nothing at all or a
     * different asset with different decimals.
     */
    const params =
      typeof window === "undefined"
        ? null
        : new URLSearchParams(window.location.search);
    const asked = (key: string) => {
      const raw = params?.get(key)?.trim().toLowerCase();
      if (!raw) return null;
      return available.find((t) => t.address.toLowerCase() === raw) ?? null;
    };
    const askedIn = asked("in");
    const askedOut = asked("out");

    /* The chain's own gas token leads, whatever it is called. Ethereum and the
       Sepolias give ETH, which is the pair we want to open on; BNB Smart Chain
       gives BNB and Polygon gives POL, which is the same answer expressed
       honestly rather than a hardcoded "ETH" that neither chain has. It is also
       the one asset a first-time visitor is guaranteed to need, since it is what
       pays for the trade.

       A side that survived leads all of it: seeding around the user's own choice
       is the whole point, and every candidate below then avoids it so the form
       cannot land on a pair of the same asset. */
    const first =
      inOk ??
      askedIn ??
      available.find((t) => t.isNative && t.address !== outOk?.address) ??
      pick(PREFER_SELL, outOk) ??
      available.find((t) => t.address !== outOk?.address) ??
      null;
    /* Excluding `first` by address, not by index: with the native asset first
       in the list, index 0 and 1 can be the same asset by symbol (native USDC
       on Arc sitting beside nothing else), and seeding both sides identical
       renders a pair that can never quote. The same test gates `askedOut`,
       which is why a link naming one token twice falls through to the default
       rather than opening a pair that cannot quote. */
    const second =
      outOk ??
      (askedOut && askedOut.address !== first?.address ? askedOut : null) ??
      pick(PREFER_BUY, first) ??
      available.find((t) => t.address !== first?.address) ??
      null;

    if (!inOk) setTokenIn(first);
    if (!outOk) setTokenOut(second);
    setAmountOut("");
  }, [available, tokenIn, tokenOut]);

  // Tells the chart which pair this card is on, so the panel beside it follows
  // the tokens you pick rather than holding whatever was selected first.
  usePublishChartPair(tokenIn?.symbol, tokenOut?.symbol);

  const {
    balance: balanceIn,
    loading: balanceInLoading,
    unread: balanceInUnread,
  } = useTokenBalance(tokenIn);
  /*
   * The buy side's balance. Read for symmetry as much as for the number: `.sub`
   * carries a 20px floor, so giving the Buy well the same row is what keeps the
   * two wells the same height in every state — connected or not, quoting or
   * not. Without it the Sell well stands ~29px taller and the pair reads as two
   * different components stacked, rather than one control with two sides.
   */
  const {
    balance: balanceOut,
    loading: balanceOutLoading,
    unread: balanceOutUnread,
  } = useTokenBalance(tokenOut);
  const { getV3AmountOut, V3_ROUTER_ADDRESS: v3Router } = useV3SwapRouter();

  useEffect(() => {
    const amount = parseFloat(amountIn);
    if (
      !tokenIn ||
      !tokenOut ||
      !amount ||
      amount <= 0 ||
      tokenIn.address === tokenOut.address
    ) {
      setAmountOut("");
      setNoRoute(false);
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
        /* A quote is a positive number or it is nothing. `getV3AmountOut` returns
           null when it could not ask, and the numeric test covers the rest: a
           pool cannot fill a nonzero input with zero output, so a zero here is a
           failure wearing a number's clothes — which is exactly what this page
           used to spend as `amountOutMin`. */
        const n = Number(out);
        const quoted = out !== null && Number.isFinite(n) && n > 0;
        if (!cancelled) {
          setAmountOut(quoted ? String(out) : "");
          setNoRoute(!quoted);
        }
      } catch {
        if (!cancelled) {
          setAmountOut("");
          setNoRoute(true);
        }
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [amountIn, tokenIn, tokenOut, getV3AmountOut]);

  /*
   * Only ever true against a balance we actually read.
   *
   * `balanceIn` falls back to "0" when the read did not land, and blocking the
   * CTA on that told a funded wallet it held nothing of the token it was trying
   * to sell — with no way past it, since the button is disabled. An unread
   * balance means we do not know, so the swap proceeds and the chain decides;
   * being short there costs a rejected simulation, which is recoverable. Saying
   * "Insufficient WETH" to someone holding WETH is not.
   */
  const insufficientBalance =
    isConnected &&
    !balanceInLoading &&
    !balanceInUnread &&
    Number(balanceIn) < parseFloat(amountIn || "0");

  const minOut = useMemo(() => {
    if (!amountOut || !tokenOut) return "";
    const n = Number(amountOut) * (1 - slippageBps / 10000);
    return n.toFixed(tokenOut.decimals > 6 ? 6 : tokenOut.decimals);
  }, [amountOut, slippageBps, tokenOut]);

  /*
   * The executed rate, quoted per unit of the sell token.
   *
   * Significant digits rather than fixed decimals because a pair can sit at
   * either end of the scale — 1 USDC = 0.00023 WETH and 1 WETH = 4340 USDC are
   * the same trade, and any fixed precision renders one of them as a wall of
   * zeros or a rounded-away number.
   */
  const rate = useMemo(() => {
    const sold = parseFloat(amountIn);
    const bought = parseFloat(amountOut);
    if (!sold || !bought || !tokenIn || !tokenOut) return "";
    return `1 ${tokenIn.symbol} = ${(bought / sold).toLocaleString(undefined, {
      maximumSignificantDigits: 6,
    })} ${tokenOut.symbol}`;
  }, [amountIn, amountOut, tokenIn, tokenOut]);

  const flip = () => {
    setTokenIn(tokenOut);
    setTokenOut(tokenIn);
    setAmountIn(amountOut || "0");
  };

  /*
   * Fills the sell field from the balance.
   *
   * Max passes `balanceIn` through untouched rather than multiplying by 1: the
   * balance is already a decimal string of the exact on-chain amount, and a
   * round trip through a float can land a hair above it — which turns the Max
   * button into "Insufficient WETH", the one thing it must never do.
   *
   * The fractions round to the token's own decimals, capped at 8. Past that the
   * digits are noise in a 34px input, and an 18-decimal token would otherwise
   * paste in a number longer than the field.
   */
  const setFraction = (f: number) => {
    if (f === 1) {
      setAmountIn(balanceIn);
      return;
    }
    const decimals = Math.min(tokenIn?.decimals ?? 6, 8);
    setAmountIn(
      (Number(balanceIn) * f)
        .toFixed(decimals)
        .replace(/(\.\d*?)0+$/, "$1")
        .replace(/\.$/, ""),
    );
  };

  /* Max and the fractions compute from `balanceIn`, so they are only offered
     when that number is one we read. Unread keeps whatever the last successful
     read said, which is the right thing to keep showing and the wrong thing to
     paste into the field as though it were current. */
  const quickDisabled =
    !isConnected || !tokenIn || balanceInUnread || !Number(balanceIn);

  // A swap is a two-step plan: approve the router to move tokenIn, then swap.
  // The approve resolver no-ops when allowance already covers it, so the step
  // simply shows "already done" — one code path whether or not approval exists.
  // No router means this chain has no V3 deployment: the plan is empty and the
  // CTA already reads "Connect wallet" / "Select a token" rather than offering a
  // swap that would route to a dead address.
  //
  // `minOut` is required for the same reason, and it is not belt-and-braces: this
  // read `amountOutMin: minOut || "0"`, so an unpriced pair produced a plan with a
  // zero minimum — a swap that accepts any output at all, which is the one term
  // protecting the trade. Nothing signable is built without a quote to bound it.
  const plan: Intent[] = useMemo(
    () =>
      !tokenIn || !tokenOut || !v3Router || !minOut
        ? []
        : [
            {
              kind: "approve",
              token: tokenIn.address,
              spender: v3Router,
              amount: amountIn || "0",
              decimals: tokenIn.decimals,
              symbol: tokenIn.symbol,
            },
            {
              kind: "swap",
              tokenIn: tokenIn.address,
              tokenOut: tokenOut.address,
              spender: v3Router,
              amountIn: amountIn || "0",
              amountOutMin: minOut,
              fee: DEFAULT_FEE,
              decimalsIn: tokenIn.decimals,
              decimalsOut: tokenOut.decimals,
              symbolIn: tokenIn.symbol,
              symbolOut: tokenOut.symbol,
              deadlineMin,
            },
          ],
    [tokenIn, tokenOut, amountIn, minOut, deadlineMin, v3Router],
  );

  const onComplete = () => {
    setReviewing(false);
    setAmountIn("");
    setAmountOut("");
    setNoRoute(false);
  };

  const ctaLabel = !isConnected
    ? "Connect wallet"
    : !tokenIn || !tokenOut
      ? "Select a token"
      : !amountIn || parseFloat(amountIn) <= 0
        ? "Enter an amount"
        : insufficientBalance
          ? `Insufficient ${tokenIn.symbol}`
          : quoting
            ? "Fetching quote…"
            : noRoute
              ? `No route for ${tokenIn.symbol} → ${tokenOut.symbol}`
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
   * No early return for a missing pair. This used to replace the whole card
   * with a "Swap unavailable" notice, which was the wrong call twice over: it
   * hid the component we are still building, and it blamed a missing deployment
   * for what is now just an unselected token. The form renders either way and
   * the pill says "Select token"; the CTA is where the honesty belongs, since
   * that is the control that would actually send a transaction.
   */
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
        {/* Overlays the Sell well's top-right corner. See `.settings` in
            trade.module.css for why it is a sibling of the well and not a
            child of its label row. */}
        <div className={s.settings}>
          {/* Sell side only. There is no percentage of what you are
           *receiving* — you set one side and the quote sets the other. */}
          <div className={s.quick}>
            {QUICK.map((f) => (
              <button
                key={f}
                className={s.qk}
                onClick={() => setFraction(f)}
                disabled={quickDisabled}
              >
                {f === 1 ? "Max" : `${f * 100}%`}
              </button>
            ))}
          </div>
          <SwapSettings
            slippageBps={slippageBps}
            onSlippage={setSlippageBps}
            deadlineMin={deadlineMin}
            onDeadline={setDeadlineMin}
          />
          {/* Between the settings pill and the chart toggle, which keeps the two
              ghost icon buttons together on the outside of the row. It answers
              "did that go through?" about the swaps signed on this card, so it
              belongs on the card rather than in the nav. */}
          <TxHistory />
          {/* Last in the group, so the two settings surfaces stay adjacent and
              the chart toggle reads as the outermost control — the same order
              the reference puts it in. */}
          <ChartToggle />
        </div>
        <div className={`${s.box} ${s.deep}`}>
          <div className={s.bl}>Sell</div>
          <div className={s.amt}>
            <input
              className={`${s.inp} tabular`}
              inputMode="decimal"
              value={amountIn}
              onChange={(e) =>
                setAmountIn(e.target.value.replace(/[^0-9.]/g, ""))
              }
              placeholder="0"
              aria-label="Amount to sell"
            />
            <TokenPill
              token={tokenIn}
              onClick={() => setPickerFor("in")}
              label="Select the token to sell"
            />
          </div>
          {/* Balance alone — the Max that used to sit here as an inline word is
              now a chip in the corner, beside the fractions it belongs with.
              Two Maxes doing the same thing on one card is one too many. */}
          <div className={s.sub}>
            <span />
            <span>
              {isConnected && !balanceInLoading && tokenIn && (
                <>Balance {balanceText(balanceIn, balanceInUnread)}</>
              )}
            </span>
          </div>
        </div>

        <div className={s.linkRow}>
          <button className={s.arw} onClick={flip} aria-label="Flip tokens">
            ↓
          </button>
        </div>

        <div className={`${s.box} ${s.raised}`}>
          <div className={s.bl}>Buy</div>
          <div className={s.amt}>
            <input
              className={`${s.inp} tabular`}
              value={quoting ? "" : amountOut}
              placeholder={quoting ? "Fetching…" : "0"}
              readOnly
              aria-label="Amount to buy"
            />
            <TokenPill
              token={tokenOut}
              onClick={() => setPickerFor("out")}
              label="Select the token to buy"
            />
          </div>
          {/* Carries a balance the buy side has no real use for, so the two
              wells measure the same. See `balanceOut` above. */}
          <div className={s.sub}>
            <span />
            <span>
              {isConnected && !balanceOutLoading && tokenOut && (
                <>Balance {balanceText(balanceOut, balanceOutUnread)}</>
              )}
            </span>
          </div>
        </div>

        <button
          className={s.cta}
          disabled={ctaDisabled}
          onClick={() => setReviewing(true)}
        >
          {ctaLabel}
        </button>

        {rate && (
          <div className={s.quote}>
            <span className="tabular">{rate}</span>
            {minOut && tokenOut && (
              <span
                className="tabular"
                title={`The least you will receive at ${(slippageBps / 100).toFixed(2)}% max slippage`}
              >
                Min{" "}
                <b>
                  {minOut} {tokenOut.symbol}
                </b>
              </span>
            )}
          </div>
        )}
      </div>

      <TokenSelector
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        /* The whole other-side token, so the picker excludes it by
           (chainId, address) rather than by symbol. */
        exclude={pickerFor === "in" ? tokenOut : tokenIn}
        onSelect={(t) => {
          if (pickerFor === "in") setTokenIn(t);
          else setTokenOut(t);
          setPickerFor(null);
        }}
      />
    </>
  );
}
