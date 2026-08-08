"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ethers } from "ethers";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { client } from "@/config/client";
import TokenSelector from "@/components/v2/TokenSelector";
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
  nearestUsableTick,
} from "@/constants/utils/v3Math";
import { KALEIDOSWAP_V3_POSITION_MANAGER } from "@/constants/utils/addresses";
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
  const { mintPosition } = useV3PositionManager();

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

  // Re-seed on chain change. Carrying a token across chains would pair two
  // addresses that never shared a pool, and the decimals may differ too.
  useEffect(() => {
    const pick = (sym: string) => available.find((t) => t.symbol === sym);
    setToken0(pick("KLD") ?? available[0] ?? null);
    setToken1(pick("USDC") ?? available[1] ?? null);
  }, [available]);

  const { balance: balance0 } = useTokenBalance(token0);
  const { balance: balance1 } = useTokenBalance(token1);

  const applyPreset = async (p: (typeof RANGE_PRESETS)[number]) => {
    if (!token0 || !token1) return;
    setPreset(p);
    if (p === "Custom") return;
    const tick = await getCurrentTick(
      token0.address,
      token1.address,
      fee,
      token0.decimals,
      token1.decimals,
    );
    if (!tick) {
      toast.error("This pool doesn't exist yet — enter a starting price manually.");
      setPreset("Custom");
      return;
    }
    if (p === "Full range") {
      setMinPrice("0");
      setMaxPrice("∞");
      return;
    }
    const pct = p === "±5%" ? 0.05 : 0.1;
    setMinPrice((tick.price * (1 - pct)).toPrecision(6));
    setMaxPrice((tick.price * (1 + pct)).toPrecision(6));
  };

  const spacing = TICK_SPACINGS[fee] ?? 60;

  const ticks = useMemo(() => {
    if (preset === "Full range") {
      return { tickLower: -887272, tickUpper: 887272 };
    }
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

  const ready = isConnected && token0 && token1 && amount0 && amount1 && ticks !== null;

  const submit = async () => {
    if (!ready || !account || !chain || !token0 || !token1) return;
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
        const current: bigint = await erc20.allowance(
          address,
          KALEIDOSWAP_V3_POSITION_MANAGER,
        );
        if (current < needed) {
          const tx = await erc20.approve(KALEIDOSWAP_V3_POSITION_MANAGER, needed);
          await tx.wait();
        }
      }

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
      );

      toast.success("Position created");
      router.push("/pool");
    } catch (err) {
      console.error("[v2/pool/new] mint failed", err);
      toast.error("Couldn't create the position");
    } finally {
      setBusy(false);
    }
  };

  /*
   * Every hook has run, so returning here is safe. Without a pair there is
   * nothing to render: no pool exists to add liquidity to, and the form below
   * dereferences both tokens on every line.
   */
  if (!token0 || !token1) {
    const here = getChainMeta(chainId)?.name;
    return (
      <div className={s.form}>
        <div className={s.box}>
          <div className={s.bl}>No pools here yet</div>
          <p className={s.priceHint}>
            Kaleido&apos;s contracts aren&apos;t deployed
            {here ? ` on ${here}` : " on any network"} yet, so there are no
            tokens to pair. They&apos;re being redeployed from scratch — testnet
            first — starting with Arc, Base, Robinhood, BNB Smart Chain and
            Ethereum.
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
              onChange={(e) => setAmount0(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0"
              aria-label={`Amount of ${token0.symbol}`}
            />
            <span className={s.tkPill}>{token0.symbol}</span>
          </div>
          <div className={s.priceHint}>
            Balance {Number(balance0).toLocaleString(undefined, { maximumFractionDigits: 4 })}
          </div>
        </div>

        <div className={s.box} style={{ marginTop: 4 }}>
          <div className={s.bl}>Deposit {token1.symbol}</div>
          <div className={s.amt}>
            <input
              className={`${s.inp} tabular`}
              value={amount1}
              onChange={(e) => setAmount1(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0"
              aria-label={`Amount of ${token1.symbol}`}
            />
            <span className={s.tkPill}>{token1.symbol}</span>
          </div>
          <div className={s.priceHint}>
            Balance {Number(balance1).toLocaleString(undefined, { maximumFractionDigits: 4 })}
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
        exclude={pickerFor === "0" ? token1.symbol : token0.symbol}
        onSelect={(t) => {
          if (pickerFor === "0") setToken0(t);
          else setToken1(t);
          setPickerFor(null);
        }}
      />
    </>
  );
}
