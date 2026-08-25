"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ethers } from "ethers";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { client } from "@/config/client";
import TokenSelector from "@/components/v2/TokenSelector";
import ChainGate, { useChainGate } from "@/components/v2/ChainGate";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import { useTokenBalance } from "@/hooks/dex/useTokenBalance";
import { useV3PositionManager } from "@/hooks/dex/useV3PositionManager";
import { usePoolV3 } from "@/hooks/v2/usePoolV3";
import { chainTokens } from "@/constants/tokens";
import { getChainMeta } from "@/constants/chains";
import type { IToken } from "@/constants/types/dex";
import {
  TICK_SPACINGS,
  priceToTick,
  tickToPrice,
  nearestUsableTick,
  fullRangeTicks,
  getV3AmountRatio,
} from "@/constants/utils/v3Math";
import s from "../pool.module.css";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
];

const FEE_TIERS = [
  { fee: 500, label: "0.05%", desc: "Best for stable pairs" },
  { fee: 3000, label: "0.30%", desc: "Most pairs" },
  { fee: 10000, label: "1.00%", desc: "Exotic pairs" },
];

const RANGE_PRESETS = ["Full range", "±5%", "±10%", "Custom"] as const;

/**
 * Slippage tolerance applied to the mint's minimum amounts. Same 0.5% as
 * SwapSettings' "Auto" (AUTO_SLIPPAGE_BPS), kept as a local constant rather than
 * imported so a page does not pull in the swap gear popover for one integer.
 * There is no control for it here yet; unlike a swap, the number that would
 * change is not on screen.
 */
const SLIPPAGE_BPS = 50;

/**
 * mintPosition already handles token sorting, pool-init-if-needed and the
 * sqrtPriceX96 math internally — real logic worth trusting rather than
 * reimplementing inside an intent resolver. So this page calls it directly
 * with sequential approve → approve → mint, the same shape useStake.ts
 * already uses for approve → deposit.
 */
export default function NewPositionPage() {
  const router = useRouter();
  const { isConnected, address, chainId } = useWalletV2();
  const account = useActiveAccount();
  const chain = useActiveWalletChain();
  const { getCurrentTick } = usePoolV3();
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
    const tick = await getCurrentTick(
      token0.address,
      token1.address,
      fee,
      token0.decimals,
      token1.decimals,
    );
    if (!tick) {
      toast.error(
        "This pool doesn't exist yet — enter a starting price manually.",
      );
      setPreset("Custom");
      return;
    }
    const pct = p === "±5%" ? 0.05 : 0.1;
    setMinPrice((tick.price * (1 - pct)).toPrecision(6));
    setMaxPrice((tick.price * (1 + pct)).toPrecision(6));
  };

  const spacing = TICK_SPACINGS[fee] ?? 60;

  const ticks = useMemo(() => {
    // Aligned to the fee tier's spacing, not the raw ±887272 bounds: those are
    // multiples of no spacing and flipTick rejects them without a message.
    if (preset === "Full range") return fullRangeTicks(spacing);
    if (!token0 || !token1) return null;
    const lo = parseFloat(minPrice);
    const hi = parseFloat(maxPrice);
    if (!lo || !hi || hi <= lo) return null;
    const rawLower = priceToTick(lo, token0.decimals, token1.decimals);
    const rawUpper = priceToTick(hi, token0.decimals, token1.decimals);
    return {
      tickLower: nearestUsableTick(Math.min(rawLower, rawUpper), spacing),
      tickUpper: nearestUsableTick(Math.max(rawLower, rawUpper), spacing),
    };
  }, [minPrice, maxPrice, preset, spacing, token0, token1]);

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
    if (!ready || !account || !chain || !token0 || !token1 || !positionManager)
      return;
    setBusy(true);
    try {
      const signer = ethers6Adapter.signer.toEthers({ client, chain, account });
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;

      for (const [token, amount, decimals] of [
        [token0, amount0, token0.decimals],
        [token1, amount1, token1.decimals],
      ] as const) {
        if (token.isNative) continue;
        const erc20 = new ethers.Contract(token.address, ERC20_ABI, signer);
        const needed = ethers.parseUnits(amount, decimals);
        const current: bigint = await erc20.allowance(address, positionManager);
        if (current < needed) {
          const tx = await erc20.approve(positionManager, needed);
          await tx.wait();
        }
      }

      /*
       * Slippage floor for the mint.
       *
       * Both minimums were left at the hook's `"0"` default, so every position
       * opened from this page accepted any execution at all: a sandwich could
       * move the pool's price, have the mint consume the deposit at whatever
       * ratio that price implied, and the transaction would still succeed.
       * `NonfungiblePositionManager` has the check — `amount0 >= amount0Min &&
       * amount1 >= amount1Min` — and it was being handed a floor of nothing.
       *
       * The floor cannot come from the typed amounts directly. This form takes
       * two independent numbers, and the pool takes `min(L(amount0),
       * L(amount1))` worth: one side is consumed in full and the other only as
       * far as the range needs it. Flooring both at 99.5% of what was typed
       * would therefore revert nearly every deposit, including honest ones. So
       * the ratio the range actually consumes at is computed first, the expected
       * consumption derived from it, and the tolerance applied to that.
       *
       * `spot` for a pool that doesn't exist yet is the price this mint is about
       * to initialize it at — mintPosition derives sqrtPriceX96 from the same two
       * amounts. The floor still matters there: it is what protects against
       * someone front-running the initialize with a different price.
       */
      const lowerPrice = tickToPrice(
        ticks!.tickLower,
        token0.decimals,
        token1.decimals,
      );
      const upperPrice = tickToPrice(
        ticks!.tickUpper,
        token0.decimals,
        token1.decimals,
      );
      const existing = await getCurrentTick(
        token0.address,
        token1.address,
        fee,
        token0.decimals,
        token1.decimals,
      );
      const h0 = Number(amount0);
      const h1 = Number(amount1);
      const spot = existing ? existing.price : h1 / h0;
      const ratio = getV3AmountRatio(
        spot,
        lowerPrice,
        upperPrice,
        token0.decimals,
        token1.decimals,
      );
      if (Number.isNaN(ratio)) {
        toast.error("Couldn't price this range — check the min and max.");
        return;
      }

      const desired0 = ethers.parseUnits(amount0, token0.decimals);
      const desired1 = ethers.parseUnits(amount1, token1.decimals);
      /* Rounded to the token's own decimals before parsing, because the ratio is
       * a float and `parseUnits` rejects a fractional part longer than the token
       * supports. Only ever used for the non-binding side, and clamped by the
       * desired amount below, so float error cannot push a floor above what the
       * pool can actually take. */
      const toBase = (human: number, decimals: number) =>
        Number.isFinite(human) && human > 0 && human < 1e21
          ? ethers.parseUnits(human.toFixed(decimals), decimals)
          : BigInt(0);
      const smaller = (a: bigint, b: bigint) => (a < b ? a : b);

      let expected0 = desired0;
      let expected1 = desired1;
      if (ratio === 0) {
        expected1 = BigInt(0); // price at or below the range — all token0
      } else if (!Number.isFinite(ratio)) {
        expected0 = BigInt(0); // price at or above the range — all token1
      } else if (h1 / h0 >= ratio) {
        // token0 binds; token1 is over-supplied and only partly consumed
        expected1 = smaller(desired1, toBase(h0 * ratio, token1.decimals));
      } else {
        expected0 = smaller(desired0, toBase(h1 / ratio, token0.decimals));
      }

      const withTolerance = (v: bigint) =>
        (v * BigInt(10_000 - SLIPPAGE_BPS)) / BigInt(10_000);
      const amount0Min = ethers.formatUnits(
        withTolerance(expected0),
        token0.decimals,
      );
      const amount1Min = ethers.formatUnits(
        withTolerance(expected1),
        token1.decimals,
      );

      await mintPosition(
        token0.address,
        token1.address,
        fee,
        ticks!.tickLower,
        ticks!.tickUpper,
        amount0,
        amount1,
        address!,
        deadline,
        token0.decimals,
        token1.decimals,
        amount0Min,
        amount1Min,
      );

      toast.success("Position created");
      /* The positions tab, not /pool — landing on a table of every pool after
         minting one hides the thing that was just created. */
      router.push("/pool/positions");
    } catch (err) {
      console.error("[v2/pool/new] mint failed", err);
      toast.error("Couldn't create the position");
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
