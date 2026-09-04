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
import {
  describeRoute,
  encodeV3Path,
  findBestRoute,
  poolSide,
  type SwapPath,
} from "@/lib/dex/route";
import s from "../trade.module.css";

/*
 * There is no default fee tier any more, and its removal is the fix rather than a
 * cleanup.
 *
 * `DEFAULT_FEE = 3000` was the only tier this card ever quoted. Everything
 * followed from that one constant: a pair whose pool is at 0.05% or 1% quoted
 * nothing and the CTA read "No route", the plan hardcoded 3000 into the `swap`
 * intent regardless of where liquidity actually was, and a pair with no direct
 * pool at all — WETH→KLD on every chain, since KLD is seeded only against USDC —
 * was unreachable from this page while being perfectly routable through USDC.
 *
 * The tier and the path now both come from `findBestRoute`, which is what the
 * agent's planner calls too, so the card and the chat cannot route the same
 * request through different pools.
 */


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
  const {
    getV3AmountOut,
    getV3MultiHopAmountOut,
    V3_ROUTER_ADDRESS: v3Router,
  } = useV3SwapRouter();

  /**
   * The route the quote came from, or null when the pair could not be priced.
   *
   * Held rather than discarded, which is the same mistake `/pool/new` was making
   * with its pool read: the route decides the fee tier the plan carries, whether
   * the plan is one `exactInputSingle` or an `exactInput` path, and what the card
   * should tell the user about the pools their money passes through. Deriving any
   * of that a second time from the amounts would let the quote and the
   * transaction disagree.
   */
  const [route, setRoute] = useState<SwapPath | null>(null);

  /**
   * The two ends as a pool can hold them.
   *
   * The card opens on the chain's own currency (see the seeding note above), so
   * until this existed the DEFAULT state of the page was the one state that could
   * not trade: the native sentinel went into the quoter, which `eth_call`s an
   * address with no code, and the card said "No route for ETH → KLD" about pools
   * that were sitting there with liquidity. `poolSide` swaps in the wrapped
   * address — which is the calldata the periphery wants — and keeps the symbol the
   * user is reading, so nothing on screen starts claiming they are selling WETH.
   *
   * Recomputed from `chainId` as well as the token, because the wrapped address
   * is per-chain and switching networks with the form filled must not leave the
   * previous chain's WETH in the quote.
   */
  const sell = useMemo(
    () => (tokenIn ? poolSide(chainId, tokenIn) : null),
    [chainId, tokenIn],
  );
  const buy = useMemo(
    () => (tokenOut ? poolSide(chainId, tokenOut) : null),
    [chainId, tokenOut],
  );

  /* ETH and WETH are one asset held two ways, so in pool form both sides
     collapse to a single address. Tracked as its own state rather than falling
     through to "no route": there is no pool between a token and its own wrapper
     and there never will be, so calling it a liquidity problem sends the user
     looking for the pool that would fix it. */
  const samePoolSide =
    !!sell &&
    !!buy &&
    sell.token.address.toLowerCase() === buy.token.address.toLowerCase();

  useEffect(() => {
    const amount = parseFloat(amountIn);
    if (!sell || !buy || !amount || amount <= 0 || samePoolSide) {
      setAmountOut("");
      setNoRoute(false);
      setRoute(null);
      return;
    }
    let cancelled = false;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        /*
         * Every tier of the direct pool AND every two-hop route through this
         * chain's quote assets, best fill wins. `findBestRoute` is shared with
         * the planner — see lib/dex/route.ts for why that sharing is
         * load-bearing rather than tidy.
         *
         * The quoter is chosen by path length here rather than inside the search,
         * because this component is where the two hook functions live: a direct
         * pair goes to `quoteExactInputSingle`, a path to `quoteExactInput`, and
         * only the latter prices the hops in sequence.
         */
        const found = await findBestRoute(
          chainId,
          sell.token,
          buy.token,
          amountIn,
          (tokens, fees, amt, decIn, decOut) =>
            tokens.length === 2
              ? getV3AmountOut(
                  tokens[0],
                  tokens[1],
                  amt,
                  fees[0],
                  decIn,
                  decOut,
                )
              : getV3MultiHopAmountOut(tokens, fees, amt, decIn, decOut),
        );
        /* A quote is a positive number or it is nothing. `findBestRoute` already
           rejects null, zero and non-finite answers — a pool cannot fill a
           nonzero input with zero output, so a zero is a failure wearing a
           number's clothes, which is exactly what this page used to spend as
           `amountOutMin`. */
        if (!cancelled) {
          setRoute(found);
          setAmountOut(found ? String(found.amountOut) : "");
          setNoRoute(!found);
        }
      } catch {
        if (!cancelled) {
          setRoute(null);
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
  }, [
    amountIn,
    sell,
    buy,
    samePoolSide,
    chainId,
    getV3AmountOut,
    getV3MultiHopAmountOut,
  ]);

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
    if (!amountOut || !buy) return "";
    const n = Number(amountOut) * (1 - slippageBps / 10000);
    return n.toFixed(buy.token.decimals > 6 ? 6 : buy.token.decimals);
  }, [amountOut, slippageBps, buy]);

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
  // One step when the sell side is the chain's own currency: `value` on the
  // transaction is the payment, and there is no allowance to grant.
  // No router means this chain has no V3 deployment: the plan is empty and the
  // CTA already reads "Connect wallet" / "Select a token" rather than offering a
  // swap that would route to a dead address.
  //
  // `minOut` is required for the same reason, and it is not belt-and-braces: this
  // read `amountOutMin: minOut || "0"`, so an unpriced pair produced a plan with a
  // zero minimum — a swap that accepts any output at all, which is the one term
  // protecting the trade. Nothing signable is built without a quote to bound it.
  // `route` is required for the same reason as `minOut`, and it is the second
  // half of the same guarantee: the tier the plan carries has to be the tier the
  // quote came from. This used to write `fee: DEFAULT_FEE` unconditionally, so a
  // pair quoted at 0.05% was submitted against the 0.3% pool — a floor computed
  // from liquidity the transaction would never touch, which is a worse failure
  // than no floor at all because it looks correct.
  const plan: Intent[] = useMemo(() => {
    if (!sell || !buy || !v3Router || !minOut || !route) return [];

    /* Built from `sell`/`buy`, never from `tokenIn`/`tokenOut`: those still hold
       the native sentinel, and the whole point of the substitution is that the
       calldata names a token that exists. The symbols inside them are still the
       user's, so the review rows read ETH. */
    const approve: Intent | null = sell.native
      ? null
      : {
          kind: "approve",
          token: sell.token.address,
          spender: v3Router,
          amount: amountIn || "0",
          decimals: sell.token.decimals,
          symbol: sell.token.symbol,
        };

    // One pool is `exactInputSingle`, more is `exactInput`. Two kinds because
    // they are two router functions with two calldata shapes — see the note on
    // `swapMultiHop` in intents/types.ts.
    const trade: Intent =
      route.hops.length === 1
        ? {
            kind: "swap",
            tokenIn: sell.token.address,
            tokenOut: buy.token.address,
            spender: v3Router,
            amountIn: amountIn || "0",
            amountOutMin: minOut,
            fee: route.fees[0],
            decimalsIn: sell.token.decimals,
            decimalsOut: buy.token.decimals,
            symbolIn: sell.token.symbol,
            symbolOut: buy.token.symbol,
            deadlineMin,
            nativeIn: sell.native,
            nativeOut: buy.native,
          }
        : {
            kind: "swapMultiHop",
            hops: route.hops.map((h) => ({
              tokenIn: h.tokenIn,
              tokenOut: h.tokenOut,
              symbolIn: h.symbolIn,
              symbolOut: h.symbolOut,
              fee: h.fee,
            })),
            path: encodeV3Path(route.tokens, route.fees),
            spender: v3Router,
            amountIn: amountIn || "0",
            amountOutMin: minOut,
            decimalsIn: sell.token.decimals,
            decimalsOut: buy.token.decimals,
            symbolIn: sell.token.symbol,
            symbolOut: buy.token.symbol,
            deadlineMin,
            nativeIn: sell.native,
            nativeOut: buy.native,
          };

    return approve ? [approve, trade] : [trade];
  }, [sell, buy, amountIn, minOut, deadlineMin, v3Router, route]);

  const onComplete = () => {
    setReviewing(false);
    setAmountIn("");
    setAmountOut("");
    setNoRoute(false);
    /* With the amount cleared there is nothing for a route to price, and a
       stale one left here would let the next `plan` build against pools that
       were chosen for the previous trade's size. */
    setRoute(null);
  };

  const ctaLabel = !isConnected
    ? "Connect wallet"
    : !tokenIn || !tokenOut
      ? "Select a token"
      : /* Both of these used to arrive as "No route", which is a claim about
           liquidity. Neither is: one is a pair that can never have a pool, the
           other is a gap in our own deployment record. */
        samePoolSide
        ? `${tokenIn.symbol} and ${tokenOut.symbol} are the same asset`
        : !sell || !buy
          ? `No wrapped ${(!sell ? tokenIn : tokenOut).symbol} on this chain`
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

        {/* The route, on its own row and stated before signing.
            Two hops means the trade passes through a token the user never
            named, and PlanReview's own summary is the last place they'd see
            it — after they've committed to reviewing. It is also the only
            visible evidence of which tier won: the rate above is the same
            string whether it came from the 0.05% pool or a path through
            USDC. Shown for a single hop too, since "which pool" is the same
            question either way and a row that appears only sometimes reads
            as a warning. */}
        {route && (
          <div className={s.quote}>
            <span title="The pools this swap is quoted through, in order">
              {route.hops.length > 1 ? "Route " : "Pool "}
              <b>{describeRoute(route)}</b>
            </span>
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
