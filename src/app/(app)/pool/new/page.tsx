"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { client } from "@/config/client";
import TokenSelector from "@/components/v2/TokenSelector";
import ChainGate, { useChainGate } from "@/components/v2/ChainGate";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { useTokenBalance } from "@/hooks/dex/useTokenBalance";
import { useV3PositionManager } from "@/hooks/dex/useV3PositionManager";
import { readPoolState, type PoolState } from "@/lib/dex/pool";
import { providerForChain } from "@/config/provider";
import {
  SLIPPAGE_BPS,
  depositFailure,
  depositV3,
  pairedAmount,
} from "@/lib/dex/deposit";
import {
  FEE_TIERS as TRADED_TIERS,
  isTradedTier,
  ticksForRange,
} from "@/lib/dex/liquidity";
import { getV3AmountRatio } from "@/constants/utils/v3Math";
import { chainTokens } from "@/constants/tokens";
import { getChainMeta } from "@/constants/chains";
import { useSpotPrices } from "@/hooks/useSpotPrices";
import type { IToken } from "@/constants/types/dex";
import s from "../pool.module.css";

/**
 * The tiers, with the copy that says what each one is for.
 *
 * Derived from the shared `FEE_TIERS` rather than listed again, because this page
 * is where a tier the factory does not have would be offered as a button. The
 * Record is exhaustive over that tuple, so adding a fourth tier there is a
 * compile error here until someone writes its label — which is the point: the
 * numbers are shared, and only the wording is local.
 */
const TIER_COPY: Record<
  (typeof TRADED_TIERS)[number],
  { label: string; desc: string }
> = {
  500: { label: "0.05%", desc: "Best for stable pairs" },
  3000: { label: "0.30%", desc: "Most pairs" },
  10000: { label: "1.00%", desc: "Exotic pairs" },
};

const FEE_TIERS = TRADED_TIERS.map((fee) => ({ fee, ...TIER_COPY[fee] }));

const RANGE_PRESETS = ["Full range", "±5%", "±10%", "Custom"] as const;

/** Six significant figures, without the zeros `toPrecision` pads with. */
const showPrice = (n: number) => String(Number(n.toPrecision(6)));

/**
 * Where this pair's market sits, and where the number came from.
 *
 * Two sources, and the distinction is the point rather than a detail. `pool` is
 * the tier's own `slot0` — the price the mint will actually meet, and the only
 * one a range may be centred on. `feed` is the USD spot table, which knows what
 * ETH and USDC are worth on a real exchange and therefore has an answer for a
 * pair this DEX has never listed.
 *
 * A feed price is shown and never silently used as a range centre, because the
 * two can disagree by any amount: a testnet pool seeded at $0.03 is a real
 * market that a $4,300 mainnet quote would misprice a band around by five orders
 * of magnitude. `applyPreset` only accepts `pool`; the feed is an anchor for the
 * human typing bounds into Custom, and for the "no pool yet" case where the
 * amounts themselves set the opening price and a reference is genuinely useful.
 */
type PriceSource = "pool" | "feed";

interface MarketPrice {
  /** token1 per token0, in the caller's order. */
  price: number;
  source: PriceSource;
}

/**
 * mintPosition already handles token sorting, pool-init-if-needed and the
 * sqrtPriceX96 math internally — real logic worth trusting rather than
 * reimplementing inside an intent resolver. It is reached through `depositV3`,
 * which is the approve → approve → floor → mint → wait sequence this page used to
 * carry inline; it moved to `lib/dex/deposit` when the pools table grew a Deposit
 * button on every row, so that both paths cannot drift.
 *
 * The range and the slippage floor come from `lib/dex/liquidity`, which is where
 * both used to live inline here. They were lifted out for the agent's
 * `provideLiquidity` and then this page was pointed at them, in that order and
 * deliberately: a second copy of either would be a second chance to reintroduce
 * the two defects they carry regression notes for — the missing tick inversion
 * and the zero slippage floor — on whichever path nobody was looking at. The write
 * sequence moved for exactly the same reason, one layer up.
 *
 * What this page still owns that the modal does not: choosing the pair and the
 * tier, which is the difference between opening a pool and adding to one that
 * exists. A row in the table has already answered both.
 */
export default function NewPositionPage() {
  const router = useRouter();
  const { isConnected, address, chainId } = useWalletV2();
  const account = useActiveAccount();
  const chain = useActiveWalletChain();
  const { mintPosition, POSITION_MANAGER_ADDRESS: positionManager } =
    useV3PositionManager();
  const gate = useChainGate();

  /*
   * The pair and tier a link asked for, matching /pool/[address]'s own `chain`
   * parameter.
   *
   * Every route in here used to arrive bare, so the seeding effect below fell
   * through to its KLD/USDC fallback and the form opened on a pair nobody had
   * chosen — including from "+ Add liquidity" on a pool's own page, where the
   * reader had just named one. Addresses rather than symbols because a symbol is
   * not an identity: two USDCs are registered on Sepolia (see the mock cutover),
   * and the fee is validated against the tiers this form actually offers so a V2
   * pair's bps-of-10000 cannot name a tier that does not exist here.
   *
   * Read from `window.location` in an effect rather than through
   * `useSearchParams`, the same call `trade/swap` and `pool/[address]` make: that
   * hook forces a Suspense boundary on the route to prerender, and every value
   * here only ever seeds state. `null` is "not read yet" and not "nothing asked",
   * which is what stops the seeding effect below from filling in its defaults on
   * the first render and then finding both sides already valid.
   */
  const [wanted, setWanted] = useState<{
    token0: string;
    token1: string;
    fee: number | null;
    chainId: number | null;
  } | null>(null);

  // Seeded from the connected chain's registry, never from a compiled-in list:
  // a KLD address is only meaningful together with the chain it lives on.
  const available = useMemo(() => chainTokens(chainId), [chainId]);
  const [token0, setToken0] = useState<IToken | null>(null);
  const [token1, setToken1] = useState<IToken | null>(null);
  const [pickerFor, setPickerFor] = useState<"0" | "1" | null>(null);
  const [fee, setFee] = useState(3000);
  const [preset, setPreset] = useState<(typeof RANGE_PRESETS)[number]>("±10%");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [amount0, setAmount0] = useState("");
  const [amount1, setAmount1] = useState("");
  /* Which box was typed into last, so the other one is the derived one. */
  const [side, setSide] = useState<"0" | "1">("0");
  const [busy, setBusy] = useState(false);

  /* Once, on mount. A link is the initial URL of a navigation here, not something
     that changes underneath the form — and re-reading it would fight the pickers,
     which are the reader editing the same two values by hand. */
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const tier = Number(p.get("fee"));
    const forChain = Number(p.get("chain"));
    const asked = {
      token0: (p.get("token0") ?? "").toLowerCase(),
      token1: (p.get("token1") ?? "").toLowerCase(),
      fee: Number.isFinite(tier) && isTradedTier(tier) ? tier : null,
      chainId: Number.isInteger(forChain) && forChain > 0 ? forChain : null,
    };
    setWanted(asked);
    if (asked.fee !== null) setFee(asked.fee);
  }, []);

  /*
   * A link that named a pool on a chain the wallet is not on.
   *
   * Worth saying rather than swallowing: the prefill below can only match tokens
   * in `available`, which holds one chain's, so those addresses resolve to
   * nothing and the form falls back to its defaults. That fallback is correct —
   * and indistinguishable, from the reader's side, from the bug where no link
   * carried a pair at all. A link cannot switch the wallet's network, so the only
   * honest thing left is to say which network it wanted.
   */
  const linkChain =
    wanted && wanted.chainId !== null && wanted.chainId !== chainId
      ? wanted.chainId
      : null;

  /*
   * Fills whichever side is not a token on this chain.
   *
   * It reset both sides on every `available` change until TokenSelector started
   * switching the wallet's network as part of returning a token — the chain
   * update and the selection then land together in an order nothing here
   * controls, and an unconditional reset threw the pick away whenever the reset
   * went last. Checking validity settles it without depending on the order. See
   * the same effect in trade/swap/page.tsx.
   *
   * A genuine chain switch still reseeds both sides: identity is
   * (chainId, address), and `available` only ever holds one chain's tokens, so
   * nothing from the previous chain can survive the test.
   */
  useEffect(() => {
    /* Before the URL has been read there is nothing to prefer, and seeding the
       defaults now would make both sides valid by the time it has been. */
    if (!wanted) return;

    const validHere = (t: IToken | null) =>
      t &&
      available.some((a) => a.chainId === t.chainId && a.address === t.address)
        ? t
        : null;

    const ok0 = validHere(token0);
    const ok1 = validHere(token1);
    if (ok0 && ok1) return;

    const pick = (sym: string, not?: IToken | null) =>
      available.find((t) => t.symbol === sym && t.address !== not?.address);

    /* What the link asked for, ahead of any default. Only ever an address on
       this chain — a link naming another chain's pool matches nothing here, and
       `linkChain` above is what tells the reader why. */
    const asked = (addr: string, not?: IToken | null) =>
      addr
        ? available.find(
            (t) =>
              t.address.toLowerCase() === addr && t.address !== not?.address,
          )
        : undefined;

    /* Each side now avoids the other's address. `available[1]` was the previous
       fallback for the second slot and it is only "the other token" by accident
       of ordering — on a chain whose USDC sits at index 0 with nothing before it,
       both slots resolved to the same asset, and a pool of one token against
       itself cannot be created. */
    const first =
      ok0 ??
      asked(wanted.token0, ok1) ??
      pick("KLD", ok1) ??
      available.find((t) => t.address !== ok1?.address) ??
      null;
    const second =
      ok1 ??
      asked(wanted.token1, first) ??
      pick("USDC", first) ??
      available.find((t) => t.address !== first?.address) ??
      null;

    if (!ok0) setToken0(first);
    if (!ok1) setToken1(second);
  }, [available, token0, token1, wanted]);

  const { balance: balance0, unread: unread0 } = useTokenBalance(token0);
  const { balance: balance1, unread: unread1 } = useTokenBalance(token1);

  /**
   * Where this pair's market sits at a tier, on the chain the wallet is on.
   *
   * `usePoolV3.getCurrentTick`, which this replaces, resolved its factory from
   * `READ_ONLY_CHAIN_ID` while the mint below goes through the connected wallet's
   * chain. A wallet anywhere other than the read chain therefore centred its ±10%
   * band on Sepolia's price and then opened the position on its own chain at a
   * range derived from a different market. Nothing reverts when that happens; the
   * position simply opens out of range and earns nothing.
   */
  const poolAt = useCallback(
    (tier: number) =>
      token0 && token1
        ? readPoolState(
            providerForChain(chainId),
            chainId,
            token0.address,
            token1.address,
            tier,
            token0.decimals,
            token1.decimals,
          )
        : Promise.resolve(null),
    [chainId, token0, token1],
  );

  /*
   * The pool for the pair and tier currently selected, held in state.
   *
   * IT USED TO BE FETCHED INSIDE THE PRESET CLICK HANDLER AND NOWHERE ELSE, and
   * that single fact is what made the range controls look broken. Three
   * consequences, all visible in the screenshot this was reported from:
   *
   *   1. Nothing on the page ever said where the market was. The read happened,
   *      its price was spread into two input strings, and the state itself was
   *      dropped — so a pair with a live pool rendered identically to one with
   *      none, and "Full range · 0 / ∞" was the whole of what the user was told.
   *   2. Every band click paid for its own round trip, and until it landed the
   *      chip that had been pressed showed no sign of having been. On a throttled
   *      endpoint that is a second or more of a control that looks dead.
   *   3. `preset` was set BEFORE the await and then reverted to "Custom" on a
   *      null read, so the pressed chip lit up, sat there, and then quietly
   *      un-pressed itself with a toast about a starting price.
   *
   * Reading it here instead means the price is known before anything is clicked,
   * which is also what lets the band chips be disabled when there is no market to
   * centre on — the same rule DepositModal already follows, where the row it was
   * opened from carried the price.
   */
  const [pool, setPool] = useState<PoolState | null>(null);
  const [poolLoading, setPoolLoading] = useState(false);

  useEffect(() => {
    if (!token0 || !token1) {
      setPool(null);
      return;
    }
    let live = true;
    setPoolLoading(true);
    /* Cleared while the next read is in flight. Keeping the previous tier's
       price on screen would attribute one pool's market to another, and the
       tiers genuinely differ — that is what a tier is. */
    setPool(null);
    poolAt(fee)
      .then((state) => {
        if (!live) return;
        setPool(state);
      })
      .catch(() => {
        if (live) setPool(null);
      })
      .finally(() => {
        if (live) setPoolLoading(false);
      });
    return () => {
      live = false;
    };
  }, [poolAt, fee]);

  /*
   * The USD table, used only to derive a reference rate for a pair with no pool.
   *
   * This is the "their live price should have been shown since they are already
   * listed pairs somewhere else" case. ETH/USDC has a knowable market price
   * whether or not this chain's factory has a pool at 0.3%, and showing nothing
   * leaves the user to invent an opening price for a pool they are creating —
   * which is the one number in this form that cannot be recovered from later.
   *
   * `priceOf` returns null for anything the table has no price for (KLD before
   * TGE, USDe), and a ratio needs both legs, so this is null far more often than
   * it is a number. That is correct and it is why the label below always says
   * which source it is quoting.
   */
  const { priceOf } = useSpotPrices();
  const feedPrice = useMemo(() => {
    if (!token0 || !token1) return null;
    const usd0 = priceOf(token0.symbol);
    const usd1 = priceOf(token1.symbol);
    if (!usd0 || !usd1) return null;
    /* token1 per token0, matching every other price in this form. */
    const ratio = usd0 / usd1;
    return Number.isFinite(ratio) && ratio > 0 ? ratio : null;
  }, [priceOf, token0, token1]);

  /**
   * The price to show, preferring the pool's own over the feed's.
   *
   * The pool wins whenever there is one, because it is the price the mint meets;
   * the feed is what makes the form useful before a pool exists.
   */
  /**
   * The pool's own quote, or null when it has none to give.
   *
   * Narrowed once and read three times below, because those three readers have
   * to agree on what "the pool has a price" means. `readPoolState` returns null
   * here for a pool whose tick is pinned at the clamp a drained pool stops at,
   * which is not a price but the end of the number line - see `isTickPinned`.
   * Centring a band on it is the failure the note under `applyPreset` describes,
   * except fifty orders of magnitude out rather than four.
   */
  const poolPrice =
    pool && pool.price !== null && pool.price > 0 ? pool.price : null;

  /**
   * A pool that exists and declines to quote, which is a different sentence to
   * say than "there is no pool here". `readPoolState` nulls `price` only for a
   * pinned tick, so this is that case and no other.
   */
  const poolPinned = pool !== null && pool.price === null;

  const market: MarketPrice | null = useMemo(() => {
    if (poolPrice !== null) return { price: poolPrice, source: "pool" };
    if (feedPrice !== null) return { price: feedPrice, source: "feed" };
    return null;
  }, [poolPrice, feedPrice]);

  /** A band can only be centred on a pool. See `MarketPrice`. */
  const bandsAvailable = poolPrice !== null;

  const applyPreset = (p: (typeof RANGE_PRESETS)[number]) => {
    if (!token0 || !token1) return;

    /*
     * Full range needs no price at all, which is why it is answered before any
     * check on the pool. Asking for one first is what used to stop anyone opening
     * a NEW pool: the read returns null for a pool that does not exist yet, which
     * bounced the preset to Custom and demanded a starting price for the one
     * range that does not depend on the market. The displayed bounds stay 0/∞ —
     * `ticks` ignores both inputs under this preset.
     */
    if (p === "Full range") {
      setPreset(p);
      setMinPrice("0");
      setMaxPrice("∞");
      return;
    }

    if (p === "Custom") {
      setPreset(p);
      /* Seeded from whatever is currently resolved, so Custom opens on the range
         already on screen rather than on two empty boxes — the same courtesy
         DepositModal extends. Full range is the exception: its real bounds are
         10^±38 and pasting those in would be worse than blank. */
      if (ticks && preset !== "Full range") {
        setMinPrice(showPrice(ticks.lowerPrice));
        setMaxPrice(showPrice(ticks.upperPrice));
      } else if (market) {
        setMinPrice(showPrice(market.price * 0.9));
        setMaxPrice(showPrice(market.price * 1.1));
      }
      return;
    }

    /*
     * A band, centred on the pool and never on the feed.
     *
     * The chip is disabled without a pool, so this is unreachable from the UI —
     * it is here because "unreachable" is a claim about today's render, and
     * centring a ±10% band on a mainnet quote when the pool is seeded four orders
     * of magnitude away would open the position out of range and earn nothing,
     * silently. The refusal names the two things that do work.
     */
    if (poolPrice === null) {
      toast.error(
        pool
          ? `The ${(fee / 10_000).toString()}% pool exists, but it has run to the far end of its price range: a trade took everything on one side, so there is no market here to centre a band on. Set explicit bounds around what you believe the pair is worth, and expect to be the one who moves the price back.`
          : market
            ? `No pool at ${(fee / 10_000).toString()}% for this pair yet, so there's no market to centre a band on. Open it with full range, or set explicit bounds around ${showPrice(market.price)}.`
            : "There's no pool at this tier yet, so there's no market price to centre a band on. Open it with full range, or set explicit bounds.",
      );
      return;
    }

    setPreset(p);
    const pct = p === "±5%" ? 0.05 : 0.1;
    setMinPrice(showPrice(poolPrice * (1 - pct)));
    setMaxPrice(showPrice(poolPrice * (1 + pct)));
  };

  /**
   * The tick range, resolved by the shared function rather than here.
   *
   * It returns either a range or a sentence, and the sentence is now shown. The
   * bad range this form can produce without anything looking wrong is a band that
   * snaps onto a single tick: the 1% tier's spacing is 200 ticks, about 2% of
   * price, so any band under ±1% on that tier collapses and the mint reverts with
   * nothing a user could act on. Previously that arrived as a disabled button
   * reading "Enter an amount and range", with an amount and a range both entered.
   *
   * `spot` is null because neither branch here needs one — explicit prices are the
   * bounds, and full range has none. The band case, which does need a price, is
   * resolved in `applyPreset` above and written into these two inputs so the user
   * sees the numbers before signing.
   */
  const resolved = useMemo(() => {
    if (!token0 || !token1) return null;
    if (preset === "Full range")
      return ticksForRange(
        { kind: "full" },
        null,
        fee,
        token0.decimals,
        token1.decimals,
      );
    const lo = parseFloat(minPrice);
    const hi = parseFloat(maxPrice);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    return ticksForRange(
      { kind: "prices", minPrice: lo, maxPrice: hi },
      null,
      fee,
      token0.decimals,
      token1.decimals,
    );
  }, [minPrice, maxPrice, preset, fee, token0, token1]);

  const ticks = resolved && !("error" in resolved) ? resolved : null;
  const rangeError = resolved && "error" in resolved ? resolved.error : null;

  /* Both amounts must be positive numbers, not merely non-empty strings.
   * `amount0 && amount1` passed for "0" — a truthy string — which let the form
   * submit a deposit with a zero leg, and a zero leg makes the slippage floor
   * below zero as well. */
  const positive = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0;
  };

  /*
   * token1 per token0 as THIS RANGE will consume it, which is the whole of what
   * links the two amount boxes.
   *
   * The boxes were two independent strings and nothing derived one from the
   * other, so this form asked for a ratio it already knew and then silently
   * ignored whatever was typed: the position manager draws the ratio the range
   * requires and refunds the rest, so an over-supplied leg came back without
   * comment and the position was smaller than the numbers on screen said. That
   * is the same arithmetic DepositModal has always done — `getV3AmountRatio` and
   * `pairedAmount`, imported rather than restated, so the two paths cannot drift.
   *
   * It is the RANGE's ratio and not the market's: a band above the market takes
   * only token0 and one below takes only token1, which is why this depends on
   * `ticks` and moves when a preset is clicked.
   */
  const ratio = useMemo(() => {
    if (!token0 || !token1 || !ticks || poolPrice === null) return null;
    return getV3AmountRatio(
      poolPrice,
      ticks.lowerPrice,
      ticks.upperPrice,
      token0.decimals,
      token1.decimals,
    );
  }, [ticks, poolPrice, token0, token1]);

  /* A range wholly on one side of the market takes one token and none of the
     other — a legitimate position, and not one this can mint, because
     `mintMinimums` refuses a zero leg. Said rather than attempted, as in the
     modal. */
  const oneSided =
    ratio === 0 ? "0" : ratio !== null && ratio === Infinity ? "1" : null;

  const edit = (which: "0" | "1", raw: string) => {
    const value = raw.replace(/[^0-9.]/g, "");
    setSide(which);
    if (which === "0") setAmount0(value);
    else setAmount1(value);
    /* Untouched when there is nothing to pair by — a pair with no pool at this
       tier is exactly the case where both legs are the reader's to choose, since
       the deposit is what sets the opening price. */
    if (ratio === null || !token0 || !token1) return;
    const other = pairedAmount({
      value,
      from: which,
      ratio,
      decimals: which === "0" ? token1.decimals : token0.decimals,
    });
    if (which === "0") setAmount1(other);
    else setAmount0(other);
  };

  /* Re-pairs the derived box when the range moves under a typed amount: widening
     a band changes what it consumes, and leaving the old counter-amount on screen
     would show a ratio the mint is not going to use. Writing only the OTHER side
     is what keeps this from feeding back — the typed side is an input to it. */
  useEffect(() => {
    if (ratio === null || !token0 || !token1) return;
    const value = side === "0" ? amount0 : amount1;
    if (!positive(value)) return;
    const other = pairedAmount({
      value,
      from: side,
      ratio,
      decimals: side === "0" ? token1.decimals : token0.decimals,
    });
    if (side === "0") setAmount1(other);
    else setAmount0(other);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratio, side, amount0, amount1, token0, token1]);

  const ready =
    isConnected &&
    token0 &&
    token1 &&
    positive(amount0) &&
    positive(amount1) &&
    ticks !== null;

  const submit = async () => {
    if (
      !ready ||
      !account ||
      !chain ||
      !token0 ||
      !token1 ||
      !positionManager ||
      !ticks
    )
      return;
    setBusy(true);
    try {
      const signer = ethers6Adapter.signer.toEthers({ client, chain, account });

      /*
       * The whole sequence — approve, approve, read the spot, floor the slippage,
       * mint, wait — is `depositV3` in `lib/dex/deposit`, shared with the Deposit
       * button on every row of the pools table. It was inline here, and the reason
       * it moved is the same one that took the range and the floor into
       * `lib/dex/liquidity` before it: two copies of a five-step write path is two
       * chances to reintroduce the defects it carries regression notes for, on
       * whichever copy nobody is looking at.
       *
       * `readSpot` rather than a price, and read at submission rather than at range
       * time, for the reason the function documents: the floor belongs to the price
       * the mint is about to meet, not the one the preset was centred on minutes
       * ago. A null answer means the pool does not exist yet, where these two
       * amounts set its opening price — the floor still matters there, as
       * protection against someone front-running the initialize with a different
       * one.
       */
      const result = await depositV3({
        signer,
        owner: address!,
        positionManager,
        token0,
        token1,
        fee,
        amount0,
        amount1,
        tickLower: ticks.tickLower,
        tickUpper: ticks.tickUpper,
        readSpot: () => poolAt(fee).then((state) => state?.price ?? null),
        slippageBps: SLIPPAGE_BPS,
        mint: mintPosition,
      });
      if (result) {
        toast.error(result.error);
        return;
      }

      toast.success("Position created");
      /* The positions tab, not /pool — landing on a table of every pool after
         minting one hides the thing that was just created. */
      router.push("/pool/positions");
    } catch (err) {
      console.error("[v2/pool/new] mint failed", err);
      /* Was one sentence for everything: a declined signature, an empty gas tank
         and a genuine revert all read "Couldn't create the position", and the first
         of those is the common case — where the user knows exactly what happened
         and is being told the app is broken. */
      toast.error(await depositFailure(err));
    } finally {
      setBusy(false);
    }
  };

  /*
   * Every hook has run, so returning here is safe.
   *
   * Two returns, because there are two distinct facts. No deployment is the
   * general case and belongs to ChainGate — which derives the deploy order from
   * the registry, where this used to name the five chains in prose that nothing
   * would have updated. A deployed chain that still has no pairable token is a
   * narrower thing, and keeps its own message: the form below dereferences both
   * tokens on every line, so it cannot render either way.
   */
  if (!gate.ready) {
    return <ChainGate product="liquidity position" state={gate} />;
  }

  if (!token0 || !token1) {
    const here = getChainMeta(chainId)?.name;
    return (
      <div className={s.form}>
        <div className={s.box}>
          <div className={s.bl}>No pools here yet</div>
          <p className={s.priceHint}>
            Nothing pairable is registered
            {here ? ` on ${here}` : ""} yet, so there is no pool to add
            liquidity to.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={s.form}>
        <div className={s.box}>
          <div className={s.bl}>Pair</div>
          <div className={s.pairRow}>
            <button className={s.pairPick} onClick={() => setPickerFor("0")}>
              {token0.symbol} <span>▾</span>
            </button>
            <button className={s.pairPick} onClick={() => setPickerFor("1")}>
              {token1.symbol} <span>▾</span>
            </button>
          </div>
          {/* Only when a link named another chain — see `linkChain`. Without it
              the fallback pair below is indistinguishable from an ignored link. */}
          {linkChain ? (
            <div className={s.priceHint} style={{ marginTop: 8 }}>
              That pool is on{" "}
              {getChainMeta(linkChain)?.name ?? `chain ${linkChain}`}. Switch your
              wallet to it to open this form on its pair — a link cannot switch
              networks for you.
            </div>
          ) : null}
          <div className={s.bl} style={{ marginTop: 14 }}>
            Fee tier
          </div>
          <div className={s.feeRow}>
            {FEE_TIERS.map((t) => (
              <button
                key={t.fee}
                className={`${s.feeOpt} ${fee === t.fee ? s.feeOptOn : ""}`}
                onClick={() => setFee(t.fee)}
              >
                <span className={s.feePct}>{t.label}</span>
                <span className={s.feeDesc}>{t.desc}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={s.box} style={{ marginTop: 4 }}>
          <div className={s.bl}>Price range</div>
          <div className={s.rangePresets}>
            {RANGE_PRESETS.map((p) => {
              /* Only the bands need a market to centre on. Full range and Custom
                 are always available — disabling them is what made this whole
                 control look broken on a pair with no pool yet, which is exactly
                 the case someone opening a new pool is in. */
              const needsMarket = p !== "Full range" && p !== "Custom";
              return (
                <button
                  key={p}
                  className={`${s.preset} ${preset === p ? s.presetOn : ""}`}
                  onClick={() => applyPreset(p)}
                  disabled={needsMarket && !bandsAvailable}
                  title={
                    needsMarket && !bandsAvailable
                      ? poolLoading
                        ? "Reading this tier's price…"
                        : "No pool at this tier yet, so there's no market price to centre a band on."
                      : undefined
                  }
                >
                  {p}
                </button>
              );
            })}
          </div>
          {/*
           * What the market is, and where the number came from.
           *
           * Two prices with the same shape and very different standing, so the
           * line says which one it is showing. The pool's own slot0 is the price a
           * band is centred on. The feed rate is a reference only — a testnet pool
           * seeded at $0.03 and a mainnet ETH/USDC quote differ by orders of
           * magnitude, so labelling it "market" without qualification would invite
           * someone to type bounds around a number this pool has never traded at.
           *
           * Under both, a third state: a pool that exists and reports no price,
           * because its tick is pinned. That used to render as the no-pool
           * sentence, which then promised the deposit would set the starting
           * price - it would not. The pool is already initialised, and the mint
           * would land entirely on one side of the clamp.
           */}
          <div className={s.currentPrice}>
            {poolLoading ? (
              "Reading market price…"
            ) : market ? (
              <>
                {market.source === "pool" ? "Market" : "Reference"}:{" "}
                <span className="tabular">{showPrice(market.price)}</span>{" "}
                {token1.symbol} per {token0.symbol}
                {market.source === "feed"
                  ? poolPinned
                    ? " — from price feeds. This tier's pool has run to the far end of its range, so bands are unavailable"
                    : " — from price feeds; no pool at this tier yet, so bands are unavailable"
                  : ""}
              </>
            ) : poolPinned ? (
              "This tier's pool has run to the far end of its price range: a trade took everything on one side of it, so it has no price to quote. Set explicit bounds around what you believe the pair is worth — until someone moves the price back, a deposit here is trading against that clamp."
            ) : (
              "No market price for this pair on this chain. Open it with full range, or set explicit bounds — the two amounts you deposit will set the starting price."
            )}
          </div>
          <div className={s.priceRow}>
            <div className={s.priceBox}>
              <div className={s.priceLabel}>Min price</div>
              <input
                className={s.priceInput}
                value={minPrice}
                onChange={(e) => {
                  setPreset("Custom");
                  setMinPrice(e.target.value.replace(/[^0-9.]/g, ""));
                }}
                placeholder="0"
              />
              <div className={s.priceHint}>
                {token1.symbol} per {token0.symbol}
              </div>
            </div>
            <div className={s.priceBox}>
              <div className={s.priceLabel}>Max price</div>
              <input
                className={s.priceInput}
                value={maxPrice}
                onChange={(e) => {
                  setPreset("Custom");
                  setMaxPrice(e.target.value.replace(/[^0-9.]/g, ""));
                }}
                placeholder="0"
              />
              <div className={s.priceHint}>
                {token1.symbol} per {token0.symbol}
              </div>
            </div>
          </div>
          {rangeError ? (
            <div className={s.priceHint} style={{ marginTop: 8 }} role="alert">
              {rangeError}
            </div>
          ) : null}
        </div>

        <div className={s.box} style={{ marginTop: 4 }}>
          <div className={s.bl}>Deposit {token0.symbol}</div>
          <div className={s.amt}>
            <input
              className={`${s.inp} tabular`}
              value={amount0}
              onChange={(e) => edit("0", e.target.value)}
              placeholder="0"
              aria-label={`Amount of ${token0.symbol}`}
            />
            <span className={s.tkPill}>{token0.symbol}</span>
          </div>
          <div className={s.priceHint}>
            {/* A dash rather than a formatted "0" when the read did not land —
                see useTokenBalance's `unread`. */}
            Balance{" "}
            {unread0
              ? "—"
              : Number(balance0).toLocaleString(undefined, {
                  maximumFractionDigits: 4,
                })}
          </div>
        </div>

        <div className={s.box} style={{ marginTop: 4 }}>
          <div className={s.bl}>Deposit {token1.symbol}</div>
          <div className={s.amt}>
            <input
              className={`${s.inp} tabular`}
              value={amount1}
              onChange={(e) => edit("1", e.target.value)}
              placeholder="0"
              aria-label={`Amount of ${token1.symbol}`}
            />
            <span className={s.tkPill}>{token1.symbol}</span>
          </div>
          <div className={s.priceHint}>
            Balance{" "}
            {unread1
              ? "—"
              : Number(balance1).toLocaleString(undefined, {
                  maximumFractionDigits: 4,
                })}
          </div>
        </div>

        {/*
         * What the range will actually take, under the boxes it links.
         *
         * Three states and they are different sentences. A pairing ratio means
         * the second box is derived and the reader should know why it moved. A
         * one-sided range takes nothing of one token — legitimate as a position,
         * refused by `mintMinimums`, so it is named here rather than surfacing as
         * a disabled button with no reason. And no pool at this tier means there
         * is no ratio to derive from at all, which is the case where both legs
         * really are the reader's to choose: the deposit sets the opening price.
         */}
        {oneSided ? (
          <div className={s.priceHint} style={{ marginTop: 8 }} role="alert">
            This range sits entirely {oneSided === "0" ? "above" : "below"} the
            market, so it would take only{" "}
            {oneSided === "0" ? token0.symbol : token1.symbol} and none of{" "}
            {oneSided === "0" ? token1.symbol : token0.symbol}. Move a bound
            across the current price to deposit into it.
          </div>
        ) : ratio !== null && Number.isFinite(ratio) && ratio > 0 ? (
          <div className={s.priceHint} style={{ marginTop: 8 }}>
            This range takes{" "}
            <span className="tabular">{showPrice(ratio)}</span>{" "}
            {token1.symbol} per {token0.symbol} — the second amount follows the
            first.
          </div>
        ) : ticks && poolPrice === null ? (
          <div className={s.priceHint} style={{ marginTop: 8 }}>
            No pool at this tier yet, so both amounts are yours to set: their
            ratio is what opens the price.
          </div>
        ) : null}

        <button className={s.cta} disabled={!ready || busy} onClick={submit}>
          {!isConnected
            ? "Connect wallet"
            : busy
              ? "Creating position…"
              : !ready
                ? "Enter an amount and range"
                : "Add liquidity"}
        </button>
      </div>

      <TokenSelector
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        exclude={pickerFor === "0" ? token1 : token0}
        onSelect={(t) => {
          if (pickerFor === "0") setToken0(t);
          else setToken1(t);
          setPickerFor(null);
        }}
      />
    </>
  );
}
