"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import TokenSelector from "@/components/v2/TokenSelector";
import PlanReview from "@/components/v2/PlanReview";
import TxHistory from "@/components/v2/TxHistory";
import { ChartToggle, usePublishChartPair } from "@/components/v2/ChartPanel";
import TokenIcon, { hasTokenIcon } from "@/components/v2/TokenIcon";
import { providerForChain } from "@/config/provider";
import { getContracts } from "@/constants/registry";
import { chainTokenByAddress, chainTokens } from "@/constants/tokens";
import type { IToken } from "@/constants/types/dex";
import { useTokenBalance } from "@/hooks/dex/useTokenBalance";
import { useV3SwapRouter } from "@/hooks/dex/useV3SwapRouter";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import Chevron from "@/components/v2/Chevron";
import { useConnectModal } from "thirdweb/react";
import { client } from "@/config/client";
import { WALLETS } from "@/config/wallets";
import type { Intent } from "@/lib/v2/intents";
import {
  EXPIRY_CHOICES,
  INTERVAL_CHOICES,
  describeInterval,
  fetchOrders,
  minOutFor,
  pathFor,
  swapInputFor,
  type StoredOrder,
} from "@/lib/dex/orders";
import s from "../trade.module.css";
import d from "../deferred.module.css";
import l from "./limit.module.css";

/**
 * Limit — a signed order, not a queued transaction.
 *
 * This card used to be a mockup with a disabled CTA and a note saying the
 * protocol had no limit-order primitive. It has one now: KaleidoOrders holds a
 * maker's EIP-712 `Order`, and `fill` passes the maker's own signed `minOut`
 * straight to the V3 router as `amountOutMinimum`, sending the output to the
 * maker. Three consequences shape everything below.
 *
 * THE PRICE IS THE FLOOR AND THE FLOOR IS THE TRIGGER. There is no oracle and
 * none is needed: whoever fills the order cannot fill it below `minOut`, because
 * the router refuses. So the only thing this form has to get right is turning
 * the price you type into base units — see {minOutFor}, which rounds up, because
 * rounding a maker's own bound down hands the difference to the filler. It is
 * also why KLD works here at all: no price feed on any chain we are on carries
 * it, and this mechanism never asks one.
 *
 * PLACING IS A SIGNATURE, CANCELLING IS A TRANSACTION. That asymmetry is the
 * thing users get wrong about signed orders, so the copy says it in both
 * directions: the `placeOrder` step returns no hash and writes no history row
 * (nothing was broadcast), while every cancel here is a real transaction,
 * because a row deleted from our store is still a valid signature that anyone
 * holding a copy can fill.
 *
 * ONE STRUCT, TWO PRODUCTS. `maxFills = 1, interval = 0` is a limit order;
 * `maxFills = 8, interval = 1 week` is a recurring buy. The Repeat row is the
 * whole of the difference, which is why this page carries the DCA feature rather
 * than a second tab that would duplicate the pair, the amount and the price.
 *
 * The approve is to KaleidoOrders and covers `amountIn × maxFills`, since the
 * contract pulls the input per fill and one signature authorises all of them.
 */

/** The tier the pair's own pool is on, and what this card quotes against. */
const DEFAULT_FEE = 3000;

/** Quick sell amounts, as fractions of the sell-side balance. */
const QUICK = [0.25, 0.5, 0.75, 1] as const;

/** Display-only, before a wallet arrives. See PREVIEW_CHAIN_ID on /trade/swap. */
const PREVIEW_CHAIN_ID = 1;

/**
 * Seeding order per side, most wanted first.
 *
 * Unlike the swap card's, neither list carries the chain's native asset, and the
 * reason differs by side. A gas token has no allowance to give, and `_settle`
 * pulls the input with `transferFrom` — so an order selling ETH could be signed,
 * stored and listed and would revert on every fill. On the buy side the router
 * pays the maker in the path's last token, and a sentinel address names no pool
 * at all, so the fill fails a step earlier. Either way the pair is unfillable,
 * and opening the form on an unfillable pair is worse than opening it on a token
 * the user may hold less of.
 *
 * KLD first because it is the pair we seed pools on and the one asset a limit
 * order is actually interesting for here; WETH and USDC are the fallbacks for
 * chains that carry no KLD.
 */
const PREFER_SELL = ["KLD", "WETH", "USDC"] as const;
const PREFER_BUY = ["USDC", "USDT", "WETH"] as const;

/**
 * Limit price presets, as a premium over the live market rate.
 *
 * Over and never under, because this side of the card sells: an order priced
 * below market is one a filler takes immediately at your expense, which is a
 * market order with extra steps. "Market" is 0% — a resting order at today's
 * rate, which fills the moment the pool moves in your favour by a wei.
 */
const PRESETS = [
  { label: "Market", over: 0 },
  { label: "+1%", over: 0.01 },
  { label: "+5%", over: 0.05 },
  { label: "+10%", over: 0.1 },
] as const;

/** Fill counts a recurring order may take. Filtered by what the window holds. */
const FILL_COUNTS = [2, 4, 8, 12] as const;

const QUOTER_ABI = [
  "function quoteExactInput(bytes path, uint256 amountIn) external returns (uint256 amountOut)",
];

/**
 * The two reads the open-order list needs, and nothing else.
 *
 * `checkFill` answers every reason a fill can be refused that the contract can
 * see — cancelled, early, expired, spent, waiting on the interval, bad signature
 * — and deliberately says nothing about the price, because a V3 quote writes
 * state inside the call frame and is unreachable from a `view`. So the price
 * half is the quoter call below it, against `swapInputFor(amountIn)` rather than
 * `amountIn`: a fill swaps the input minus the filler's cut, and quoting the
 * whole of it overstates the output by exactly that fee.
 */
const ORDERS_VIEW_ABI = [
  "function fillerFeeBps() external view returns (uint16)",
  "function checkFill((address maker, address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint64 startAt, uint64 expiry, uint32 interval, uint32 maxFills, uint64 epoch, uint256 salt) o, bytes signature, bytes path) external view returns (bool ok, string reason)",
];

/** Six significant figures, which is what a rate needs at either end of the scale. */
const fmt = (n: number) =>
  n.toLocaleString(undefined, { maximumSignificantDigits: 6 });

/** See balanceText on /trade/swap: a dash means "not read", not "empty". */
const balanceText = (balance: string, unread: boolean) =>
  unread
    ? "—"
    : Number(balance).toLocaleString(undefined, { maximumFractionDigits: 4 });

/**
 * A price as a plain decimal string, never an exponent.
 *
 * `parseUnits` refuses "2.3e-7", and a limit price on a thin pair is easily that
 * small — KLD sits at $0.03, so anything quoted against WETH lands there. Eight
 * significant figures expressed as decimals, which is more precision than a
 * price input needs and less than the 18 `parseUnits` would accept.
 */
const priceText = (n: number) => {
  if (!Number.isFinite(n) || n <= 0) return "";
  const places = Math.min(18, Math.max(0, 7 - Math.floor(Math.log10(n))));
  return n
    .toFixed(places)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
};

/** "3d left" / "expired". Only ever rendered for rows fetched after mount. */
const timeLeft = (expiry: number) => {
  const secs = expiry - Math.floor(Date.now() / 1000);
  if (secs <= 0) return "expired";
  const days = Math.floor(secs / 86_400);
  if (days >= 1) return `${days}d left`;
  const hours = Math.floor(secs / 3_600);
  if (hours >= 1) return `${hours}h left`;
  return `${Math.max(1, Math.floor(secs / 60))}m left`;
};

const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/**
 * The token button on a side of the pair. Nullable, because an unselected side
 * is an ordinary state — see TokenPill on /trade/swap for the badge's job.
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
      <Chevron className={s.cv} />
    </button>
  );
}

/** What the chain says about one stored order, when it could be asked. */
interface Live {
  /** `checkFill`'s verdict on the terms. Nothing about the price. */
  ok: boolean;
  /** Its own words when `ok` is false — "expired", "waiting for the next interval". */
  reason: string;
  /** How far the pool's current output sits from the floor, in percent. */
  pct: number | null;
}

/**
 * The maker's open orders on this chain, with what the chain says about each.
 *
 * Reads status live rather than rendering the stored `status` column, because
 * that column is a keeper cache: it can be one cycle stale, and "cancelled" in
 * particular is true on chain the instant the transaction lands while the row
 * still says open. The stored value is the fallback for when the chain cannot be
 * reached, which is what `.stale` marks.
 *
 * Only open rows appear. A filled or cancelled order is history, and a form's
 * job is the orders that can still do something.
 */
function OpenOrders({
  maker,
  chainId,
  orders,
  reloadKey,
  onPlan,
}: {
  maker: string;
  chainId: number;
  orders: string;
  /** Bumped by the page after a placement or a cancel lands. */
  reloadKey: number;
  onPlan: (intents: Intent[]) => void;
}) {
  const [rows, setRows] = useState<StoredOrder[]>([]);
  const [live, setLive] = useState<Record<string, Live>>({});
  const [error, setError] = useState("");
  const { v3Quoter } = getContracts(chainId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const got = await fetchOrders(maker, chainId);
        if (cancelled) return;
        setRows(got.filter((r) => r.status === "open"));
        setError("");
      } catch (e) {
        if (!cancelled) {
          setRows([]);
          setError(e instanceof Error ? e.message : "Couldn't load your orders.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [maker, chainId, reloadKey]);

  /*
   * `providerForChain` and not a BrowserProvider over `window.ethereum`, which
   * is what the quote path on /trade/swap still uses. An in-app email or social
   * wallet is a smart account and injects nothing, so a BrowserProvider read
   * fails outright for exactly the makers whose orders are signed via ERC-1271 —
   * the case this list must not go blank on. Same call useTokenBalance made when
   * it was migrated for the same reason.
   */
  useEffect(() => {
    const provider = providerForChain(chainId);
    if (!provider || !rows.length) return;
    let cancelled = false;
    (async () => {
      const view = new ethers.Contract(orders, ORDERS_VIEW_ABI, provider);
      const quoter = v3Quoter
        ? new ethers.Contract(v3Quoter, QUOTER_ABI, provider)
        : null;

      /* Read, never assumed: the fee is storage and can be raised without a
         redeploy, which is what lets third-party filling be turned on later
         without invalidating anything already signed. Zero is the current value
         and a safe floor if the read fails — it makes the quote optimistic by
         the fee rather than wrong by a factor. */
      let feeBps = 0;
      try {
        feeBps = Number(await view.fillerFeeBps());
      } catch {
        /* Left at zero. */
      }

      const next: Record<string, Live> = {};
      await Promise.all(
        rows.map(async (r) => {
          try {
            const path = pathFor(r.order, DEFAULT_FEE);
            const [ok, reason] = await view.checkFill(
              r.order,
              r.signature,
              path,
            );
            let pct: number | null = null;
            const floor = BigInt(r.order.minOut);
            if (quoter && floor > BigInt(0)) {
              try {
                const out: bigint = await quoter.quoteExactInput.staticCall(
                  path,
                  swapInputFor(BigInt(r.order.amountIn), feeBps),
                );
                pct =
                  Number(((out - floor) * BigInt(10_000)) / floor) / 100;
              } catch {
                /* No pool at this tier, or not enough liquidity for this size.
                   The terms verdict above still stands on its own. */
              }
            }
            next[r.hash] = { ok: Boolean(ok), reason: String(reason), pct };
          } catch {
            /* This row keeps its stored status and renders as `.stale`. */
          }
        }),
      );
      if (!cancelled) setLive(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [rows, orders, chainId, v3Quoter]);

  if (error) return <p className={l.warn}>{error}</p>;
  if (!rows.length) return null;

  return (
    <div className={l.orders}>
      <div className={l.head}>
        <span className={l.title}>
          {rows.length === 1 ? "1 open order" : `${rows.length} open orders`}
        </span>
        <button
          className={`${l.ghost} ${l.danger}`}
          onClick={() => onPlan([{ kind: "cancelAllOrders", orders }])}
        >
          Cancel all
        </button>
      </div>

      {rows.map((r) => {
        const inTok = chainTokenByAddress(r.chainId, r.order.tokenIn);
        const outTok = chainTokenByAddress(r.chainId, r.order.tokenOut);
        const symIn = inTok?.symbol ?? shortAddr(r.order.tokenIn);
        const symOut = outTok?.symbol ?? shortAddr(r.order.tokenOut);
        const st = live[r.hash];

        /* Amounts only when both decimals are known. A token this build does not
           carry cannot be formatted — 18 is a guess, and a wrong guess here
           misstates the maker's own floor by orders of magnitude. The pair and
           the cancel button work regardless, which is the case that matters:
           an order you cannot read is the one you most want to be able to kill. */
        const terms =
          inTok && outTok
            ? `Sell ${fmt(
                Number(ethers.formatUnits(r.order.amountIn, inTok.decimals)),
              )} ${symIn} for ≥ ${fmt(
                Number(ethers.formatUnits(r.order.minOut, outTok.decimals)),
              )} ${symOut}`
            : `${symIn} → ${symOut}`;

        return (
          <div key={r.hash} className={l.row}>
            <div className={l.body}>
              <div className={l.terms}>{terms}</div>
              <div className={l.meta}>
                <span>{timeLeft(r.order.expiry)}</span>
                {r.order.maxFills > 1 && (
                  <span>
                    {r.fills}/{r.order.maxFills} filled, every{" "}
                    {describeInterval(r.order.interval)}
                  </span>
                )}
                {st ? (
                  st.ok ? (
                    <span className={st.pct !== null && st.pct >= 0 ? l.ready : ""}>
                      {st.pct === null
                        ? "Ready — waiting on a quote"
                        : st.pct >= 0
                          ? `Your price is met (+${st.pct.toFixed(2)}%)`
                          : `${Math.abs(st.pct).toFixed(2)}% below your floor`}
                    </span>
                  ) : (
                    <span>{st.reason}</span>
                  )
                ) : (
                  <span className={l.stale}>{r.status}</span>
                )}
              </div>
            </div>
            <button
              className={`${l.ghost} ${l.danger}`}
              onClick={() =>
                onPlan([
                  {
                    kind: "cancelOrder",
                    orders,
                    order: r.order,
                    pairLabel: `${symIn} → ${symOut}`,
                  },
                ])
              }
            >
              Cancel
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default function LimitPage() {
  const { address, isConnected, chainId, chainName } = useWalletV2();
  /* See swap: /trade has no ChainGate, so a disconnected CTA connects rather
     than sits disabled. */
  const { connect } = useConnectModal();
  const openConnect = () => {
    connect({ client, wallets: WALLETS, size: "compact" }).catch(() => {});
  };
  const { orders: ordersAddress } = getContracts(chainId);

  const available = useMemo(
    () => chainTokens(chainId ?? PREVIEW_CHAIN_ID),
    [chainId],
  );
  const [tokenIn, setTokenIn] = useState<IToken | null>(null);
  const [tokenOut, setTokenOut] = useState<IToken | null>(null);
  const [amountIn, setAmountIn] = useState("");
  const [price, setPrice] = useState("");
  /** Index into PRESETS, or null once the price is typed by hand. */
  const [preset, setPreset] = useState<number | null>(1);
  const [expiryIdx, setExpiryIdx] = useState(1);
  const [intervalIdx, setIntervalIdx] = useState(0);
  const [fills, setFills] = useState(4);
  const [market, setMarket] = useState(0);
  const [quoting, setQuoting] = useState(false);
  const [pickerFor, setPickerFor] = useState<"in" | "out" | null>(null);
  /** The plan under review, whichever control raised it. Null while editing. */
  const [reviewing, setReviewing] = useState<Intent[] | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  /*
   * Fills whichever side is not a token on this chain — the validity check from
   * /trade/swap, with one extra rule: neither side ever seeds to the native
   * asset. See PREFER_SELL. A user can still pick it in the selector, which has
   * no way to exclude it, and the CTA says why it will not work.
   */
  useEffect(() => {
    const validHere = (t: IToken | null) =>
      t &&
      available.some((a) => a.chainId === t.chainId && a.address === t.address)
        ? t
        : null;

    const inOk = validHere(tokenIn);
    const outOk = validHere(tokenOut);
    if (inOk && outOk) return;

    const usable = (not?: IToken | null) => (t: IToken) =>
      !t.isNative && t.address !== not?.address;

    const pick = (prefs: readonly string[], not?: IToken | null) =>
      prefs.reduce<IToken | undefined>(
        (found, sym) =>
          found ?? available.find((t) => t.symbol === sym && usable(not)(t)),
        undefined,
      );

    const first =
      inOk ?? pick(PREFER_SELL, outOk) ?? available.find(usable(outOk)) ?? null;
    const second =
      outOk ?? pick(PREFER_BUY, first) ?? available.find(usable(first)) ?? null;

    if (!inOk) setTokenIn(first);
    if (!outOk) setTokenOut(second);
  }, [available, tokenIn, tokenOut]);

  usePublishChartPair(tokenIn?.symbol, tokenOut?.symbol);

  const {
    balance: balanceIn,
    loading: balanceInLoading,
    unread: balanceInUnread,
  } = useTokenBalance(tokenIn);
  const { getV3AmountOut } = useV3SwapRouter();

  const expiresIn = EXPIRY_CHOICES[expiryIdx].seconds;
  const interval: number | null = INTERVAL_CHOICES[intervalIdx].seconds;

  /*
   * The most fills the chosen window can hold.
   *
   * `_shapeValid` on the contract does not check this and cannot: it sees one
   * order, not the maker's intent, so `8 × weekly` inside a one-month expiry is
   * a perfectly valid order that quietly does four fills and stops. `buildOrder`
   * refuses it with a sentence, and this is what keeps the form from ever
   * producing one — fill counts and intervals the window cannot hold are
   * disabled rather than accepted and then rejected at signing time.
   *
   * (maxFills - 1) gaps, because the first fill happens immediately.
   */
  const fillsAllowed =
    interval === null ? 1 : 1 + Math.floor(expiresIn / interval);
  const maxFills = interval === null ? 1 : Math.min(fills, fillsAllowed);

  /* Shortening the expiry under a recurrence that no longer fits it resets the
     recurrence rather than leaving a selected chip the CTA refuses. The chips
     are disabled in the other direction, so this only ever fires on an expiry
     change — which is the one case where the user changed something else. */
  useEffect(() => {
    if (interval !== null && fillsAllowed < 2) setIntervalIdx(0);
  }, [interval, fillsAllowed]);

  /* The market rate, as `1 tokenIn = n tokenOut`.
   *
   * Quoted for the amount actually being sold rather than for one unit, so the
   * rate on this card is the rate the swap tab shows for the same trade — price
   * impact included. One unit only while the amount field is empty, which is
   * what lets the preset chips fill a price before anything is typed. */
  useEffect(() => {
    if (!tokenIn || !tokenOut || tokenIn.address === tokenOut.address) {
      setMarket(0);
      return;
    }
    const size = Number(amountIn) > 0 ? amountIn : "1";
    let cancelled = false;
    setQuoting(true);
    const t = setTimeout(async () => {
      try {
        const out = await getV3AmountOut(
          tokenIn.address,
          tokenOut.address,
          size,
          DEFAULT_FEE,
          tokenIn.decimals,
          tokenOut.decimals,
        );
        const rate = Number(out) / Number(size);
        if (!cancelled) setMarket(Number.isFinite(rate) && rate > 0 ? rate : 0);
      } catch {
        if (!cancelled) setMarket(0);
      } finally {
        if (!cancelled) setQuoting(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [amountIn, tokenIn, tokenOut, getV3AmountOut]);

  /* A preset is a mode, not a button: it re-derives the price every time the
     market moves, so "Market" keeps meaning market. Typing clears it. */
  useEffect(() => {
    if (preset === null || !market) return;
    setPrice(priceText(market * (1 + PRESETS[preset].over)));
  }, [preset, market]);

  /** The sell amount in base units, or null while the field is not a number. */
  const amountBase = useMemo(() => {
    if (!tokenIn || !amountIn) return null;
    try {
      const v = ethers.parseUnits(amountIn, tokenIn.decimals);
      return v > BigInt(0) ? v : null;
    } catch {
      return null;
    }
  }, [amountIn, tokenIn]);

  /**
   * The floor in base units — the one number this whole form exists to produce.
   *
   * "outPerIn" because the head above the field says so: `1 KLD is worth n
   * USDC`. The basis has to be stated rather than inferred, since the two
   * directions are reciprocals and both read naturally to a user.
   */
  const floor = useMemo(() => {
    if (!tokenIn || !tokenOut || !amountBase || !price.trim()) return null;
    return minOutFor({
      amountIn: amountBase,
      price,
      basis: "outPerIn",
      decimalsIn: tokenIn.decimals,
      decimalsOut: tokenOut.decimals,
    });
  }, [amountBase, price, tokenIn, tokenOut]);

  const minOutHuman =
    floor && "minOut" in floor && tokenOut
      ? ethers.formatUnits(floor.minOut, tokenOut.decimals)
      : "";
  const floorError = floor && "error" in floor ? floor.error : "";

  /* Against one fill, not against the total. A recurring buy funds itself over
     weeks — that is what it is for — so demanding the whole commitment up front
     would refuse the product's main case. The allowance still covers every fill,
     because an allowance is a permission and a balance is money. */
  const insufficient =
    isConnected &&
    !balanceInLoading &&
    !balanceInUnread &&
    Number(balanceIn) < parseFloat(amountIn || "0");

  /** Why the CTA is refusing, and the sentence that explains it when short isn't enough. */
  const block: { label: string; why?: string } | null = !isConnected
    ? { label: "Connect wallet" }
    : !tokenIn || !tokenOut
      ? { label: "Select a token" }
      : !ordersAddress
        ? {
            label: `Limit orders aren't live on ${chainName ?? "this network"} yet`,
          }
        : tokenIn.isNative
          ? {
              label: `A limit order can't sell ${tokenIn.symbol}`,
              why: `${tokenIn.symbol} is this chain's gas token, and a gas token has no allowance to give — the order contract takes the input with transferFrom when someone fills it. Sell the wrapped version instead.`,
            }
          : tokenOut.isNative
            ? {
                label: `A limit order can't buy ${tokenOut.symbol}`,
                why: `A fill pays you through the pool route, and there is no pool that ends in ${tokenOut.symbol} itself. Buy the wrapped version and unwrap it whenever you like.`,
              }
            : !amountBase
              ? { label: "Enter an amount" }
              : insufficient
                ? { label: `Insufficient ${tokenIn.symbol}` }
                : !price.trim()
                  ? { label: "Set a price" }
                  : floorError
                    ? { label: "Check the price", why: floorError }
                    : null;

  const plan: Intent[] = useMemo(() => {
    if (!tokenIn || !tokenOut || !ordersAddress || !amountBase || !minOutHuman) {
      return [];
    }
    return [
      {
        kind: "approve",
        token: tokenIn.address,
        spender: ordersAddress,
        /* Every fill, not one: `fill` pulls `amountIn` from the maker each time
           and there is no second signature to raise the allowance later. */
        amount: ethers.formatUnits(
          amountBase * BigInt(maxFills),
          tokenIn.decimals,
        ),
        decimals: tokenIn.decimals,
        symbol: tokenIn.symbol,
      },
      {
        kind: "placeOrder",
        orders: ordersAddress,
        tokenIn: tokenIn.address,
        tokenOut: tokenOut.address,
        decimalsIn: tokenIn.decimals,
        decimalsOut: tokenOut.decimals,
        symbolIn: tokenIn.symbol,
        symbolOut: tokenOut.symbol,
        amountIn,
        minOut: minOutHuman,
        expiresIn,
        interval: interval ?? 0,
        maxFills,
      },
    ];
  }, [
    tokenIn,
    tokenOut,
    ordersAddress,
    amountBase,
    amountIn,
    minOutHuman,
    expiresIn,
    interval,
    maxFills,
  ]);

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

  const quickDisabled =
    !isConnected || !tokenIn || balanceInUnread || !Number(balanceIn);

  /** The premium over market the typed price represents, or null without one. */
  const premium = useMemo(() => {
    const p = parseFloat(price);
    if (!market || !p) return null;
    return (p / market - 1) * 100;
  }, [price, market]);

  const placing = reviewing?.some((i) => i.kind === "placeOrder") ?? false;

  const onComplete = () => {
    setReviewing(null);
    /* Only a placement clears the form. A cancel leaves the fields alone, since
       the usual reason to cancel is to place the same order at another price. */
    if (placing) setAmountIn("");
    setReloadKey((k) => k + 1);
  };

  if (reviewing) {
    const label = reviewing.some((i) => i.kind === "cancelAllOrders")
      ? "Cancel every order"
      : reviewing.some((i) => i.kind === "cancelOrder")
        ? "Cancel order"
        : maxFills > 1
          ? "Sign & schedule"
          : "Sign & place";
    return (
      <div className={s.card}>
        <div className={s.box}>
          <PlanReview
            intents={reviewing}
            submitLabel={label}
            onComplete={onComplete}
            onCancel={() => setReviewing(null)}
          />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={s.card}>
        {/* Overlays the price well's top-right corner. See `.settings` in
            trade.module.css for why it is a sibling of the well. TxHistory
            belongs here now that this card signs transactions: a cancel is one,
            and "did that go through?" is a question about this card. */}
        <div className={s.settings}>
          <TxHistory />
          <ChartToggle />
        </div>

        {/* Top well recessed, bottom well raised — the positional rule every
            trade tab follows, so flipping between them shows one card. */}
        <div className={`${s.box} ${s.deep}`}>
          <div className={d.head}>
            <span>When 1</span>
            {/* A restatement of the sell token, not a second control for it:
                one clickable pill per side of the pair, and this side's lives in
                the Sell well below. */}
            <span className={`${s.pill} ${d.headPill}`}>
              <span
                className={`${s.tki} ${d.headIcon} ${
                  tokenIn && hasTokenIcon(tokenIn.symbol) ? s.tkiArt : ""
                }`}
              >
                {tokenIn ? (
                  <TokenIcon
                    symbol={tokenIn.symbol}
                    size={22}
                    fallback={tokenIn.symbol.slice(0, 3)}
                    chainId={tokenIn.chainId}
                  />
                ) : (
                  "?"
                )}
              </span>
              {tokenIn?.symbol ?? "token"}
            </span>
            <span>is worth</span>
          </div>
          <div className={s.amt}>
            <input
              className={`${s.inp} tabular`}
              inputMode="decimal"
              value={price}
              onChange={(e) => {
                setPreset(null);
                setPrice(e.target.value.replace(/[^0-9.]/g, ""));
              }}
              placeholder={quoting ? "Fetching…" : "0"}
              aria-label="Limit price"
            />
            <TokenPill
              token={tokenOut}
              onClick={() => setPickerFor("out")}
              label="Select the token to buy"
            />
          </div>
          <div className={d.presets}>
            {PRESETS.map((p, i) => (
              <button
                key={p.label}
                className={`${d.preset} ${preset === i ? d.presetOn : ""}`}
                onClick={() => setPreset(i)}
                disabled={!market}
                title={
                  market
                    ? undefined
                    : "No quote for this pair on this chain, so there is no market rate to price against. Type a price instead."
                }
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className={`${s.box} ${s.raised}`} style={{ marginTop: 4 }}>
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
          {/* The fractions sit beside the balance they are computed from, rather
              than in the card's corner as they do on Swap — that corner is the
              price well's here, and its head already fills the row. */}
          <div className={s.sub}>
            <span className={s.quick}>
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
            </span>
            <span>
              {isConnected && !balanceInLoading && tokenIn && (
                <>Balance {balanceText(balanceIn, balanceInUnread)}</>
              )}
            </span>
          </div>

          {/* Expiry and recurrence ride with the amount rather than owning a
              well of their own — each is one more fact about this order, and a
              third card would cost ~40px of chrome per row on a surface whose
              whole job is fitting the viewport. */}
          <div className={s.kv}>
            <span>Expires in</span>
            <span className={d.presets} style={{ margin: 0 }}>
              {EXPIRY_CHOICES.map((c, i) => (
                <button
                  key={c.label}
                  className={`${d.preset} ${expiryIdx === i ? d.presetOn : ""}`}
                  onClick={() => setExpiryIdx(i)}
                >
                  {c.label}
                </button>
              ))}
            </span>
          </div>

          <div className={s.kv}>
            <span>Repeat</span>
            <span className={d.presets} style={{ margin: 0 }}>
              {INTERVAL_CHOICES.map((c, i) => {
                /* Disabled when the chosen expiry cannot hold two fills at this
                   cadence, which is the only honest answer: a weekly order
                   inside a one-day window is one fill, i.e. the limit order the
                   first chip already is. */
                const impossible =
                  c.seconds !== null && expiresIn < c.seconds;
                return (
                  <button
                    key={c.label}
                    className={`${d.preset} ${intervalIdx === i ? d.presetOn : ""}`}
                    onClick={() => setIntervalIdx(i)}
                    disabled={impossible}
                    title={
                      impossible
                        ? `Longer than this order runs. Pick an expiry of at least one ${describeInterval(c.seconds!)}.`
                        : undefined
                    }
                  >
                    {c.label}
                  </button>
                );
              })}
            </span>
          </div>

          {interval !== null && (
            <div className={s.kv} style={{ paddingBottom: 0 }}>
              <span>Fills</span>
              <span className={d.presets} style={{ margin: 0 }}>
                {FILL_COUNTS.map((n) => (
                  <button
                    key={n}
                    className={`${d.preset} ${maxFills === n ? d.presetOn : ""}`}
                    onClick={() => setFills(n)}
                    disabled={n > fillsAllowed}
                    title={
                      n > fillsAllowed
                        ? `${n} fills every ${describeInterval(interval)} need longer than this order runs.`
                        : undefined
                    }
                  >
                    {n}
                  </button>
                ))}
              </span>
            </div>
          )}
        </div>

        <button
          className={s.cta}
          disabled={isConnected ? block !== null : false}
          onClick={isConnected ? () => setReviewing(plan) : openConnect}
        >
          {block?.label ??
            (maxFills > 1 ? "Review recurring buy" : "Review limit order")}
        </button>

        {(minOutHuman || market) && tokenIn && tokenOut && (
          <div className={s.quote}>
            <span className="tabular">
              {market
                ? `1 ${tokenIn.symbol} = ${fmt(market)} ${tokenOut.symbol}`
                : "No market rate for this pair"}
            </span>
            {minOutHuman && (
              <span
                className="tabular"
                title={`The least you will receive${
                  maxFills > 1 ? " on each fill" : ""
                }. Whoever fills the order cannot do better for themselves than this.`}
              >
                Floor{" "}
                <b>
                  {fmt(Number(minOutHuman))} {tokenOut.symbol}
                </b>
                {premium !== null &&
                  (Math.abs(premium) < 0.05
                    ? " · at market"
                    : ` · ${premium > 0 ? "+" : ""}${premium.toFixed(1)}%`)}
              </span>
            )}
          </div>
        )}

        {block?.why && <p className={l.warn}>{block.why}</p>}

        <p className={d.note}>
          Signed, not sent. Nothing moves until the market reaches your floor,
          and the floor is the worst price you can get — whoever fills the order
          hands you the output directly. Cancelling is a transaction.
        </p>

        {isConnected && address && chainId && ordersAddress && (
          <OpenOrders
            maker={address}
            chainId={chainId}
            orders={ordersAddress}
            reloadKey={reloadKey}
            onPlan={setReviewing}
          />
        )}
      </div>

      <TokenSelector
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
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
