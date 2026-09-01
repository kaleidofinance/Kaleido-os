"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  useActiveAccount,
  useActiveWalletChain,
  useSwitchActiveWalletChain,
} from "thirdweb/react";
import { defineChain } from "thirdweb/chains";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { client } from "@/config/client";
import { providerForChain } from "@/config/provider";
import { getChainMeta, toThirdwebChainOptions } from "@/constants/chains";
import { getContracts } from "@/constants/registry";
import { getV3AmountRatio } from "@/constants/utils/v3Math";
import { useTokenBalance } from "@/hooks/dex/useTokenBalance";
import { useV3PositionManager } from "@/hooks/dex/useV3PositionManager";
import { isTradedTier, ticksForRange } from "@/lib/dex/liquidity";
import { readPoolState } from "@/lib/dex/pool";
import {
  V2_ROUTER_ABI,
  depositFailure,
  depositV2,
  depositV3,
  pairedAmount,
  reserveRatio,
} from "@/lib/dex/deposit";
import type { ITradingPair } from "@/constants/types/dex";
import ChainTag from "./ChainTag";
import PairIcon from "./PairIcon";
import PoolModal from "./PoolModal";
import { feeLabel } from "../format";
import s from "../pool.module.css";

/**
 * Deposit into one pool, from its row in the table.
 *
 * WHY THIS EXISTS RATHER THAN A LINK TO THE FORM
 *
 * The flow already existed at /pool/new, and every route into it started from
 * nothing: the pair cell went to the detail page, whose "+ Add liquidity" button
 * went to a blank form that then had to be told the pair, the tier and the range
 * over again — three things the row the reader clicked already knew. Worse, the
 * form only mints V3 at the three tiers it offers, so there was no path at all
 * from a V2 row to adding liquidity to that pair. A row is where the reader has
 * already decided which pool; the only questions left are how much, and — for a
 * concentrated position — how wide, which is all this asks.
 *
 * ONE RATIO, TWO VENUES
 *
 * The two boxes are linked, and the number linking them is not the price. On V2 it
 * is the reserve ratio, which is what the pair will take. On V3 it is what the
 * *range* consumes at the current price, from `getV3AmountRatio` — a position
 * centred on the market takes a mix that depends on its width, one entirely above
 * the market takes only token1, and the pool keeps whatever the over-supplied side
 * put in beyond that. Both come out as token1-per-token0 as consumed, so
 * `pairedAmount` is the single input-linking rule here instead of one per venue.
 *
 * The second box is written into state by the edit handler rather than derived at
 * render, so it stays editable when there is no ratio to link by — an empty V2
 * pair and an uninitialised V3 pool both quote nothing, and there the two amounts
 * are what set the opening price. The effect below re-derives it when the range
 * moves under a typed amount.
 */

const RANGE_PRESETS = ["Full range", "±5%", "±10%", "Custom"] as const;
type Preset = (typeof RANGE_PRESETS)[number];

const positive = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
};

/** Six significant figures, without the trailing zeros `toPrecision` pads with. */
const showPrice = (n: number) => String(Number(n.toPrecision(6)));

const numeric = (v: string) => v.replace(/[^0-9.]/g, "");

export default function DepositModal({
  pool,
  onClose,
  onDeposited,
}: {
  pool: ITradingPair;
  onClose: () => void;
  /** Re-read the table, so the row's TVL reflects what was just added. */
  onDeposited?: () => void;
}) {
  const account = useActiveAccount();
  const chain = useActiveWalletChain();
  const switchChain = useSwitchActiveWalletChain();
  const { mintPosition } = useV3PositionManager();

  const { token0, token1 } = pool;
  const isV3 = pool.version === "v3";
  const meta = getChainMeta(pool.chainId);
  const onRightChain = chain?.id === pool.chainId;

  /*
   * `feeBps` is bps of 10000 for both venues — the V2 pair's own `swapFee()`, and
   * for V3 the tier divided by 100 on the way in (see `useV3Pools`). So the tier
   * to mint at is that number times 100: 30 → 3000. Getting this wrong does not
   * fail loudly; it addresses a different pool at the same pair, or one that does
   * not exist, after two approvals have been signed.
   */
  const tier = pool.feeBps === null ? null : pool.feeBps * 100;

  const contracts = getContracts(pool.chainId);
  const spender = isV3 ? contracts.v3PositionManager : contracts.v2Router;

  const [preset, setPreset] = useState<Preset>(() =>
    pool.price !== null && pool.price > 0 ? "±10%" : "Full range",
  );
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [amounts, setAmounts] = useState({ a0: "", a1: "" });
  const [side, setSide] = useState<"0" | "1">("0");
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);

  /*
   * The range, resolved by the shared function.
   *
   * A band rather than two prices written into the inputs, which is how /pool/new
   * does it: there the pair and tier are still in flux and the price has to be
   * fetched, here the row already carries `price` for this exact pool and tier, so
   * the band can be centred without a round trip. The snapped bounds are shown
   * below instead of being put in editable boxes, so what is displayed is the
   * range that will actually be minted — `ticksForRange` snaps to the tier's
   * spacing, and on the 1% tier that moves a bound by up to 2%.
   */
  const resolved = useMemo(() => {
    if (!isV3 || tier === null) return null;
    if (preset === "Full range")
      return ticksForRange(
        { kind: "full" },
        null,
        tier,
        token0.decimals,
        token1.decimals,
      );
    if (preset === "Custom") {
      const lo = parseFloat(minPrice);
      const hi = parseFloat(maxPrice);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
      return ticksForRange(
        { kind: "prices", minPrice: lo, maxPrice: hi },
        null,
        tier,
        token0.decimals,
        token1.decimals,
      );
    }
    return ticksForRange(
      { kind: "band", pct: preset === "±5%" ? 0.05 : 0.1 },
      pool.price,
      tier,
      token0.decimals,
      token1.decimals,
    );
  }, [isV3, tier, preset, minPrice, maxPrice, pool.price, token0, token1]);

  const ticks = resolved && !("error" in resolved) ? resolved : null;
  const rangeError = resolved && "error" in resolved ? resolved.error : null;

  /*
   * token1 per token0, as this deposit will be consumed.
   *
   * Raw from both sources, including `0`, `Infinity` and `NaN` — `pairedAmount`
   * treats all three as "no pairing" and empties the box, and the two finite ones
   * are read below to say *why* it is empty. Collapsing them to null here would
   * lose that.
   */
  const ratio = useMemo(() => {
    if (!isV3)
      return reserveRatio({
        reserve0: pool.reserves.reserve0,
        reserve1: pool.reserves.reserve1,
        decimals0: token0.decimals,
        decimals1: token1.decimals,
      });
    if (!ticks || pool.price === null) return null;
    return getV3AmountRatio(
      pool.price,
      ticks.lowerPrice,
      ticks.upperPrice,
      token0.decimals,
      token1.decimals,
    );
  }, [isV3, ticks, pool.price, pool.reserves, token0, token1]);

  /* A range wholly on one side of the market takes one token and none of the
     other. That is a legitimate position — and it is not one this can mint, because
     `mintMinimums` refuses a zero leg, so it is said rather than attempted. */
  const oneSided =
    ratio === 0 ? "0" : ratio !== null && ratio === Infinity ? "1" : null;

  const edit = (which: "0" | "1", raw: string) => {
    const value = numeric(raw);
    setSide(which);
    const other = pairedAmount({
      value,
      from: which,
      ratio,
      decimals: which === "0" ? token1.decimals : token0.decimals,
    });
    setAmounts((prev) =>
      which === "0"
        ? { a0: value, a1: ratio === null ? prev.a1 : other }
        : { a0: ratio === null ? prev.a0 : other, a1: value },
    );
  };

  /* Re-pairs the untouched box when the range moves under a typed amount: widening
     a band changes what it consumes, and leaving the old counter-amount on screen
     would show a ratio the mint is not going to use. Keyed on the ratio and the
     side, never on the amounts, so typing does not feed back into this. */
  useEffect(() => {
    if (ratio === null) return;
    setAmounts((prev) => {
      const value = side === "0" ? prev.a0 : prev.a1;
      if (!positive(value)) return prev;
      const other = pairedAmount({
        value,
        from: side,
        ratio,
        decimals: side === "0" ? token1.decimals : token0.decimals,
      });
      return side === "0"
        ? { a0: prev.a0, a1: other }
        : { a0: other, a1: prev.a1 };
    });
  }, [ratio, side, token0.decimals, token1.decimals]);

  /* Null on the wrong chain, so the hook reads nothing: `useTokenBalance` dials
     the token's own chain now, and a deposit gated on a balance the depositor
     cannot spend from here would be a number about the wrong place. The switch
     prompt in the hint below is the answer instead. */
  const { balance: balance0, unread: unread0 } = useTokenBalance(
    onRightChain ? token0 : null,
  );
  const { balance: balance1, unread: unread1 } = useTokenBalance(
    onRightChain ? token1 : null,
  );

  /* An unread balance never makes the deposit look short. `balance0` carries "0"
     when the read failed, and "Not enough USDC" on a funded wallet is a dead end:
     the CTA is disabled, so there is nothing the user can do about a message that
     is not true. Let the deposit be attempted and let the chain refuse it. */
  const shortOf = (amount: string, balance: string, unread: boolean) =>
    onRightChain &&
    !unread &&
    positive(amount) &&
    Number(amount) > Number(balance);
  const short0 = shortOf(amounts.a0, balance0, unread0);
  const short1 = shortOf(amounts.a1, balance1, unread1);

  const venueReady =
    Boolean(spender) && (!isV3 || (tier !== null && isTradedTier(tier)));
  const bothPositive = positive(amounts.a0) && positive(amounts.a1);
  const ready =
    Boolean(account) &&
    onRightChain &&
    venueReady &&
    bothPositive &&
    !short0 &&
    !short1 &&
    (!isV3 || ticks !== null);

  const goToChain = async () => {
    if (!meta) {
      toast.error("This pool's network is not in the registry.");
      return;
    }
    setSwitching(true);
    try {
      await switchChain(defineChain(toThirdwebChainOptions(meta)));
    } catch {
      toast.error(
        `Couldn't switch to ${meta.name} — switch manually in your wallet, then deposit.`,
      );
    } finally {
      setSwitching(false);
    }
  };

  const submit = async () => {
    if (!ready || !account || !chain || !spender) return;
    setBusy(true);
    try {
      const signer = ethers6Adapter.signer.toEthers({ client, chain, account });
      const shared = {
        signer,
        owner: account.address,
        token0,
        token1,
        amount0: amounts.a0,
        amount1: amounts.a1,
      };

      const result =
        isV3 && ticks && tier !== null
          ? await depositV3({
              ...shared,
              positionManager: spender,
              fee: tier,
              tickLower: ticks.tickLower,
              tickUpper: ticks.tickUpper,
              /* Read again at submission, through this pool's own chain: the floor
                 belongs to the price the mint is about to meet, not the one the
                 table swept minutes ago. */
              readSpot: () =>
                readPoolState(
                  providerForChain(pool.chainId),
                  pool.chainId,
                  token0.address,
                  token1.address,
                  tier,
                  token0.decimals,
                  token1.decimals,
                ).then((state) => state?.price ?? null),
              mint: mintPosition,
            })
          : await depositV2({
              ...shared,
              router: spender,
              feeBps: pool.feeBps,
            });

      if (result) {
        toast.error(result.error);
        return;
      }
      toast.success(
        `Added liquidity to ${token0.symbol} / ${token1.symbol} on ${meta?.shortName ?? "chain " + pool.chainId}`,
      );
      onDeposited?.();
      onClose();
    } catch (err) {
      console.error("[v2/pool] deposit failed", err);
      toast.error(await depositFailure(err, V2_ROUTER_ABI));
    } finally {
      setBusy(false);
    }
  };

  const cta = !account
    ? "Connect wallet"
    : !onRightChain
      ? switching
        ? "Switching…"
        : `Switch to ${meta?.shortName ?? `chain ${pool.chainId}`}`
      : !venueReady
        ? "This venue isn't deployed here"
        : busy
          ? "Depositing…"
          : short0
            ? `Not enough ${token0.symbol}`
            : short1
              ? `Not enough ${token1.symbol}`
              : !bothPositive
                ? "Enter an amount"
                : "Add liquidity";

  const amountBox = (which: "0" | "1") => {
    const token = which === "0" ? token0 : token1;
    const value = which === "0" ? amounts.a0 : amounts.a1;
    const balance = which === "0" ? balance0 : balance1;
    const unread = which === "0" ? unread0 : unread1;
    return (
      <div className={s.mBox}>
        <div className={s.bl}>{token.symbol}</div>
        <div className={s.amt}>
          <input
            className={`${s.inp} tabular`}
            value={value}
            onChange={(e) => edit(which, e.target.value)}
            placeholder="0"
            inputMode="decimal"
            aria-label={`Amount of ${token.symbol}`}
          />
          <span className={s.tkPill}>
            <PairIcon symbol={token.symbol} />
            {token.symbol}
          </span>
        </div>
        <div className={s.priceHint}>
          {!onRightChain
            ? `Balance on ${meta?.shortName ?? "this pool's network"} — switch to see it`
            : unread
              ? "Balance —"
              : `Balance ${Number(balance).toLocaleString(undefined, {
                  maximumFractionDigits: 4,
                })}`}
        </div>
      </div>
    );
  };

  return (
    <PoolModal
      title={`Deposit into ${token0.symbol} / ${token1.symbol}`}
      onClose={onClose}
      wide
    >
      {/* The pool this is about, spelled out. The button was pressed on one row of
          a table that lists the same pair at several fees on five chains, and a
          modal that only said "USDC / USDT" would not distinguish them. */}
      <div className={s.mPool}>
        <div className={s.pair}>
          <PairIcon symbol={token0.symbol} />
          <PairIcon symbol={token1.symbol} />
        </div>
        <div>
          <div className={s.pairName}>
            {token0.symbol} / {token1.symbol}
          </div>
          <div className={s.pairFee}>
            <span>
              {feeLabel(pool.feeBps)} · {pool.version.toUpperCase()}
            </span>
            <ChainTag chainId={pool.chainId} />
          </div>
        </div>
      </div>

      {isV3 ? (
        <div className={s.mBox}>
          <div className={s.bl}>Price range</div>
          <div className={s.rangePresets}>
            {RANGE_PRESETS.map((p) => (
              <button
                key={p}
                className={`${s.preset} ${preset === p ? s.presetOn : ""}`}
                onClick={() => {
                  /* Seeded from whatever is resolved, so Custom opens on the range
                     already on screen rather than on two empty boxes. */
                  if (p === "Custom" && ticks) {
                    setMinPrice(showPrice(ticks.lowerPrice));
                    setMaxPrice(showPrice(ticks.upperPrice));
                  }
                  setPreset(p);
                }}
                disabled={p !== "Full range" && p !== "Custom" && !pool.price}
              >
                {p}
              </button>
            ))}
          </div>

          {preset === "Custom" ? (
            <div className={s.priceRow}>
              <div className={s.priceBox}>
                <div className={s.priceLabel}>Min price</div>
                <input
                  className={s.priceInput}
                  value={minPrice}
                  onChange={(e) => setMinPrice(numeric(e.target.value))}
                  placeholder="0"
                  inputMode="decimal"
                  aria-label="Minimum price"
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
                  onChange={(e) => setMaxPrice(numeric(e.target.value))}
                  placeholder="0"
                  inputMode="decimal"
                  aria-label="Maximum price"
                />
                <div className={s.priceHint}>
                  {token1.symbol} per {token0.symbol}
                </div>
              </div>
            </div>
          ) : null}

          {/* The snapped bounds, not the ones asked for — see the note on
              `resolved`. Full range is shown as 0 – ∞ because its real bounds are
              10^±38 and printing those says less than the words do. */}
          {ticks ? (
            <div className={s.currentPrice}>
              {preset === "Full range"
                ? `0 – ∞ · the whole curve`
                : `${showPrice(ticks.lowerPrice)} – ${showPrice(ticks.upperPrice)} ${token1.symbol} per ${token0.symbol}`}
              {pool.price !== null
                ? ` · market ${showPrice(pool.price)}`
                : null}
            </div>
          ) : null}
          {rangeError ? (
            <div className={s.mWarn} role="alert">
              {rangeError}
            </div>
          ) : null}
          {oneSided ? (
            <div className={s.mWarn} role="alert">
              That range sits entirely {oneSided === "0" ? "above" : "below"}{" "}
              the market, so it would take only{" "}
              {oneSided === "0" ? token0.symbol : token1.symbol} and none of the
              other side. Move a bound across the current price to deposit into
              it.
            </div>
          ) : null}
        </div>
      ) : null}

      {amountBox("0")}
      {amountBox("1")}

      {/* Not a rate — what this deposit is consumed at, which for a concentrated
          range is not the market price. Only shown when there is one to show: an
          empty pool quotes nothing, and both amounts then set its opening price. */}
      {ratio !== null && Number.isFinite(ratio) && ratio > 0 ? (
        <div className={s.currentPrice}>
          Deposits at {showPrice(ratio)} {token1.symbol} per {token0.symbol}
        </div>
      ) : null}

      {/* Two actions behind one button. On the wrong chain it switches the wallet
          and stays open, because that is a step on the way to depositing rather
          than a different intent — the alternative is a disabled button reading
          "Switch to Base Sepolia" and no way to do it from here. */}
      <button
        className={s.cta}
        disabled={!account || busy || switching || (onRightChain && !ready)}
        onClick={onRightChain ? submit : goToChain}
      >
        {cta}
      </button>
    </PoolModal>
  );
}
