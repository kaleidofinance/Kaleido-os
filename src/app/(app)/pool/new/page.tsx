"use client";

import { useEffect, useMemo, useState } from "react";
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
import { readPoolState } from "@/lib/dex/pool";
import { providerForChain } from "@/config/provider";
import {
  SLIPPAGE_BPS,
  depositFailure,
  depositV3,
} from "@/lib/dex/deposit";
import { FEE_TIERS as TRADED_TIERS, ticksForRange } from "@/lib/dex/liquidity";
import { chainTokens } from "@/constants/tokens";
import { getChainMeta } from "@/constants/chains";
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
  const [busy, setBusy] = useState(false);

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

    /* Each side now avoids the other's address. `available[1]` was the previous
       fallback for the second slot and it is only "the other token" by accident
       of ordering — on a chain whose USDC sits at index 0 with nothing before it,
       both slots resolved to the same asset, and a pool of one token against
       itself cannot be created. */
    const first =
      ok0 ??
      pick("KLD", ok1) ??
      available.find((t) => t.address !== ok1?.address) ??
      null;
    const second =
      ok1 ??
      pick("USDC", first) ??
      available.find((t) => t.address !== first?.address) ??
      null;

    if (!ok0) setToken0(first);
    if (!ok1) setToken1(second);
  }, [available, token0, token1]);

  const { balance: balance0 } = useTokenBalance(token0);
  const { balance: balance1 } = useTokenBalance(token1);

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
  const poolAt = (tier: number) =>
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
      : Promise.resolve(null);

  const applyPreset = async (p: (typeof RANGE_PRESETS)[number]) => {
    if (!token0 || !token1) return;
    setPreset(p);
    if (p === "Custom") return;
    /*
     * Full range needs no price read, and asking for one before this check is
     * what stopped anyone opening a new pool: the fetch returns null for a pool
     * that doesn't exist yet, which bounced the preset to Custom and demanded a
     * starting price for the one range that doesn't depend on the market. The
     * displayed bounds stay 0/∞ — `ticks` ignores them under this preset.
     */
    if (p === "Full range") {
      setMinPrice("0");
      setMaxPrice("∞");
      return;
    }
    const state = await poolAt(fee);
    if (!state) {
      toast.error(
        "This pool doesn't exist yet — enter a starting price manually.",
      );
      setPreset("Custom");
      return;
    }
    const pct = p === "±5%" ? 0.05 : 0.1;
    setMinPrice((state.price * (1 - pct)).toPrecision(6));
    setMaxPrice((state.price * (1 + pct)).toPrecision(6));
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
            {RANGE_PRESETS.map((p) => (
              <button
                key={p}
                className={`${s.preset} ${preset === p ? s.presetOn : ""}`}
                onClick={() => applyPreset(p)}
              >
                {p}
              </button>
            ))}
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
              onChange={(e) =>
                setAmount0(e.target.value.replace(/[^0-9.]/g, ""))
              }
              placeholder="0"
              aria-label={`Amount of ${token0.symbol}`}
            />
            <span className={s.tkPill}>{token0.symbol}</span>
          </div>
          <div className={s.priceHint}>
            Balance{" "}
            {Number(balance0).toLocaleString(undefined, {
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
              onChange={(e) =>
                setAmount1(e.target.value.replace(/[^0-9.]/g, ""))
              }
              placeholder="0"
              aria-label={`Amount of ${token1.symbol}`}
            />
            <span className={s.tkPill}>{token1.symbol}</span>
          </div>
          <div className={s.priceHint}>
            Balance{" "}
            {Number(balance1).toLocaleString(undefined, {
              maximumFractionDigits: 4,
            })}
          </div>
        </div>

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
