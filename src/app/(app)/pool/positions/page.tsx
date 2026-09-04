"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";
import { ethers6Adapter } from "thirdweb/adapters/ethers6";
import { client } from "@/config/client";
import { useV3Positions, type V3Position } from "@/hooks/dex/useV3Positions";
import { readPoolState, type PoolState } from "@/lib/dex/pool";
import {
  SLIPPAGE_BPS,
  depositFailure,
  increaseV3,
  type IncreaseLiquidityFn,
} from "@/lib/dex/deposit";
import { shareOfLiquidity } from "@/lib/dex/liquidity";
import { providerForChain } from "@/config/provider";
import {
  chainTokenByAddress,
  decimalsForAddress,
  symbolForAddress,
} from "@/constants/tokens";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";
import ChainGate, { useChainGate } from "@/components/v2/ChainGate";
import { getContracts } from "@/constants/registry";
import { tickToPrice } from "@/constants/utils/v3Math";
import PairIcon from "../_components/PairIcon";
import s from "../pool.module.css";

/**
 * Your positions — the wallet-scoped half of the Liquidity section.
 *
 * Moved here from /pool when the all-pools table took the section's landing
 * slot. The two are deliberately separate routes rather than client state: the
 * repo's convention (see pool/layout.tsx, trade/layout.tsx) is that a tab bar
 * navigates, so both halves are linkable and the back button works.
 *
 * V3 only, and read through the injected wallet — `useV3Positions` needs an
 * owner to enumerate NFTs from. That makes this the one page in the section a
 * visitor with no wallet cannot see anything on, which the empty state says
 * outright rather than claiming they hold no positions.
 *
 * ALL FOUR THINGS A POSITION CAN DO ARE HERE. Collect, add, remove all, remove
 * part. The first and third were the whole page for a while, and the gap that
 * left was not cosmetic: a position could be opened at /pool/new and emptied
 * here, and adding to one meant opening a second position over the same range —
 * a second NFT, a second set of fees to collect, and a range chosen twice. The
 * agent's `increasePosition` and `removePosition` tools resolve to the same two
 * calls these buttons make, which is the parity the section is held to.
 */

/**
 * Display-only decimals for a position's token.
 *
 * The `?? 18` is a deliberate, visible guess and only safe because these feed
 * tickToPrice for a rendered price label. Never reuse this shape to size a
 * transfer: an unregistered 6-decimal token read as 18 is off by 10^12. The add
 * form below is what that rule looks like in practice — it resolves both legs
 * through `chainTokenByAddress` and refuses rather than guessing.
 */
const decimalsFor = (chainId: number | undefined, address: string) =>
  decimalsForAddress(chainId, address) ?? 18;

/** The shares the remove control offers. 100 is the default and closes it. */
const SHARES = [25, 50, 75, 100] as const;

/**
 * Pool state per position — fetched once per position on mount.
 *
 * Reads through `readPoolState`, the same reader /pool/new and both planners use.
 * The hook this replaced pinned its factory to `READ_ONLY_CHAIN_ID` while the
 * positions on screen are the connected wallet's, so a wallet on any other chain
 * had every marker on this page placed from Sepolia's price — or, more often, no
 * marker at all, because that chain's factory has no pool for the pair.
 *
 * The whole state is kept rather than just the tick, because the add form needs
 * the price: an increase's slippage floor comes from what the position's range
 * consumes at the current price, so a page that had already read it and thrown it
 * away would either re-read it or floor at zero. Called with the position's own
 * token order, so `price` is token1-per-token0 in the position's frame and needs
 * no inversion.
 */
function usePoolStates(positions: V3Position[], chainId: number | undefined) {
  const [states, setStates] = useState<Record<string, PoolState | null>>({});

  useEffect(() => {
    let cancelled = false;
    positions.forEach((p) => {
      if (p.tokenId in states) return;
      readPoolState(
        providerForChain(chainId),
        chainId,
        p.token0,
        p.token1,
        p.fee,
        decimalsFor(chainId, p.token0),
        decimalsFor(chainId, p.token1),
      ).then((r) => {
        if (!cancelled) setStates((prev) => ({ ...prev, [p.tokenId]: r }));
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions.map((p) => p.tokenId).join(","), chainId]);

  return states;
}

function RangeBar({
  tickLower,
  tickUpper,
  currentTick,
  decimals0,
  decimals1,
}: {
  tickLower: number;
  tickUpper: number;
  currentTick: number | null;
  decimals0: number;
  decimals1: number;
}) {
  const lo = tickToPrice(tickLower, decimals0, decimals1);
  const hi = tickToPrice(tickUpper, decimals0, decimals1);
  const cur =
    currentTick !== null
      ? tickToPrice(currentTick, decimals0, decimals1)
      : null;

  // Position the marker within a padded window around [lo, hi] on a log scale
  // — V3 ranges are naturally log-spaced, and this keeps a tight range from
  // collapsing to a single pixel.
  const logLo = Math.log(lo);
  const logHi = Math.log(hi);
  const pad = Math.max((logHi - logLo) * 0.4, 0.05);
  const windowLo = logLo - pad;
  const windowHi = logHi + pad;
  const pct = (v: number) =>
    Math.max(
      0,
      Math.min(100, ((Math.log(v) - windowLo) / (windowHi - windowLo)) * 100),
    );

  const bandLeft = pct(lo);
  const bandRight = 100 - pct(hi);
  const markerPct = cur !== null ? pct(cur) : null;
  const inRange = cur !== null && cur >= lo && cur <= hi;

  const fmt = (v: number) =>
    v >= 1000 ? v.toFixed(0) : v >= 1 ? v.toFixed(4) : v.toFixed(6);

  return (
    <div className={s.range}>
      <div className={s.rangeBar}>
        <div
          className={s.rangeBand}
          style={{ left: `${bandLeft}%`, right: `${bandRight}%` }}
        />
        {markerPct !== null && (
          <div
            className={`${s.rangeMark} ${inRange ? "" : s.out}`}
            style={{ left: `${markerPct}%` }}
          />
        )}
      </div>
      <div className={s.rangeLabels}>
        <span>{fmt(lo)}</span>
        <span className={inRange ? "" : s.out}>
          {cur !== null ? (inRange ? "in range" : "out of range") : "…"}
        </span>
        <span>{fmt(hi)}</span>
      </div>
    </div>
  );
}

/** An amount box holds a quantity, not merely a non-empty string. */
const positive = (v: string) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
};

/**
 * One position, and the four things it can do to itself.
 *
 * A component rather than a block inside the page's map, because two of the four
 * actions carry form state — an amount per leg, and a share to remove — and
 * holding those in the page means records keyed by tokenId that a refresh leaves
 * stale rows in. Local state unmounts with the card it belongs to.
 */
function PositionCard({
  p,
  poolState,
  chainId,
  symbolFor,
  collectFees,
  increaseLiquidity,
  removeLiquidity,
  refresh,
}: {
  p: V3Position;
  /** Undefined while the read is in flight, null when the pool couldn't be read. */
  poolState: PoolState | null | undefined;
  chainId: number | undefined;
  symbolFor: (address: string) => string;
  collectFees: (tokenId: string) => Promise<unknown>;
  increaseLiquidity: IncreaseLiquidityFn;
  removeLiquidity: (tokenId: string, liquidity: string) => Promise<unknown>;
  refresh: () => void;
}) {
  const account = useActiveAccount();
  const chain = useActiveWalletChain();
  const { v3PositionManager } = getContracts(chainId);

  const [busy, setBusy] = useState<"collect" | "add" | "remove" | null>(null);
  const [adding, setAdding] = useState(false);
  const [amount0, setAmount0] = useState("");
  const [amount1, setAmount1] = useState("");
  const [share, setShare] = useState<number>(100);

  /* Both legs resolved through the registry, which returns undefined rather than
     guessing. `decimalsFor` above is a visible guess and fine for a price label;
     these decimals size an approval and a transfer, where reading an unregistered
     6-decimal token as 18 sends 10^12 times the intended amount. So a leg that
     doesn't resolve disables the add — the same refusal the agent's
     `increasePosition` gives for a token it can't name. */
  const token0 = chainTokenByAddress(chainId, p.token0);
  const token1 = chainTokenByAddress(chainId, p.token1);
  const legs = token0 && token1 ? { token0, token1 } : null;

  const owedTotal = Number(p.tokensOwed0) + Number(p.tokensOwed1);
  const canAdd =
    legs !== null &&
    account !== undefined &&
    chain !== undefined &&
    v3PositionManager !== undefined &&
    positive(amount0) &&
    positive(amount1) &&
    busy === null;

  const onCollect = async () => {
    setBusy("collect");
    try {
      await collectFees(p.tokenId);
      toast.success("Fees collected");
      refresh();
    } catch (err) {
      console.error("[v2/pool] collect failed", err);
      toast.error("Couldn't collect fees");
    } finally {
      setBusy(null);
    }
  };

  const onAdd = async () => {
    if (!canAdd || !legs || !account || !chain || !v3PositionManager) return;
    setBusy("add");
    try {
      const signer = ethers6Adapter.signer.toEthers({ client, chain, account });
      /* The whole sequence — floor the slippage, approve, approve, increase,
         wait — is `increaseV3` in lib/dex/deposit, which is also what the agent's
         `increasePosition` resolves to. One derivation of the floor for both, for
         the reason that module was created: the two live defects it carries
         regression notes for were both in a copied write path. */
      const result = await increaseV3({
        signer,
        owner: account.address,
        positionManager: v3PositionManager,
        tokenId: p.tokenId,
        /* The POSITION's order, straight off `positions(tokenId)`, which is
           what `increaseLiquidity` encodes against. Handing it the pair the
           other way round does not revert — it deposits inverted. */
        token0: legs.token0,
        token1: legs.token1,
        amount0,
        amount1,
        tickLower: p.tickLower,
        tickUpper: p.tickUpper,
        /* Read again at submission rather than reusing the card's mounted read:
           the floor belongs to the price this deposit is about to meet, not the
           one that placed the range marker when the page loaded. Named in the
           position's own token order, so `price` needs no inversion, and with
           the legs' real decimals rather than the display guess. */
        readSpot: () =>
          readPoolState(
            providerForChain(chainId),
            chainId,
            p.token0,
            p.token1,
            p.fee,
            legs.token0.decimals,
            legs.token1.decimals,
          ).then((r) => r?.price ?? null),
        slippageBps: SLIPPAGE_BPS,
        increase: increaseLiquidity,
      });
      if (result) {
        toast.error(result.error);
        return;
      }
      toast.success(`Added to position #${p.tokenId}`);
      setAdding(false);
      setAmount0("");
      setAmount1("");
      refresh();
    } catch (err) {
      console.error("[v2/pool] increase failed", err);
      toast.error(await depositFailure(err));
    } finally {
      setBusy(null);
    }
  };

  const onRemove = async () => {
    const liquidity = shareOfLiquidity(p.liquidity, share);
    if (BigInt(liquidity) === 0n) {
      toast.error(
        `${share}% of position #${p.tokenId} rounds to nothing — it's too small to split that finely.`,
      );
      return;
    }
    setBusy("remove");
    try {
      await removeLiquidity(p.tokenId, liquidity);
      toast.success(
        share === 100 ? "Liquidity removed" : `Removed ${share}% of the position`,
      );
      refresh();
    } catch (err) {
      console.error("[v2/pool] remove failed", err);
      toast.error(await depositFailure(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={s.card}>
      <div className={s.cardTop}>
        <div className={s.pair}>
          <PairIcon symbol={symbolFor(p.token0)} />
          <PairIcon symbol={symbolFor(p.token1)} />
        </div>
        <div>
          <div className={s.pairName}>
            {symbolFor(p.token0)} / {symbolFor(p.token1)}
          </div>
          <div className={s.pairFee}>
            V3 · {(p.fee / 10000).toFixed(2)}% fee · #{p.tokenId}
          </div>
        </div>
        <span className={`${s.badge} ${p.inRange ? "" : s.out}`}>
          {p.inRange ? "In range" : "Out of range"}
        </span>
      </div>

      <RangeBar
        tickLower={p.tickLower}
        tickUpper={p.tickUpper}
        currentTick={poolState?.tick ?? null}
        decimals0={decimalsFor(chainId, p.token0)}
        decimals1={decimalsFor(chainId, p.token1)}
      />

      <div className={s.stats}>
        <div className={s.stat}>
          <span className={s.statLabel}>Liquidity</span>
          <span className={`${s.statValue} tabular`}>{p.liquidity}</span>
        </div>
        <div className={s.stat}>
          <span className={s.statLabel}>Unclaimed fees</span>
          <span className={`${s.statValue} tabular`}>
            {p.tokensOwed0} {symbolFor(p.token0)} + {p.tokensOwed1}{" "}
            {symbolFor(p.token1)}
          </span>
        </div>
      </div>

      {/* Defaults to All, so the button below reads and behaves exactly as it did
          when full removal was the only thing it could do. Picking a share is
          additive: nobody has to notice this row to close a position. */}
      <div className={s.shareRow}>
        <span className={s.shareLabel}>Remove</span>
        {SHARES.map((v) => (
          <button
            key={v}
            className={`${s.preset} ${share === v ? s.presetOn : ""}`}
            disabled={busy !== null}
            onClick={() => setShare(v)}
          >
            {v === 100 ? "All" : `${v}%`}
          </button>
        ))}
      </div>

      <div className={s.actions}>
        <button
          className={`${s.actBtn} ${s.primary}`}
          disabled={owedTotal === 0 || busy !== null}
          onClick={onCollect}
        >
          {busy === "collect" ? "Collecting…" : "Collect fees"}
        </button>
        <button
          className={s.actBtn}
          disabled={legs === null || busy !== null}
          onClick={() => setAdding((v) => !v)}
        >
          {adding ? "Close" : "Add liquidity"}
        </button>
        <button
          className={s.actBtn}
          disabled={busy !== null}
          onClick={onRemove}
        >
          {busy === "remove"
            ? "Removing…"
            : share === 100
              ? "Remove liquidity"
              : `Remove ${share}%`}
        </button>
      </div>

      {legs === null && (
        <p className={s.addNote}>
          One of this position&apos;s tokens isn&apos;t in this chain&apos;s
          registry, so its decimals are unknown — adding is disabled rather than
          guessing at how much to send. Collecting and removing don&apos;t need
          them.
        </p>
      )}

      {adding && legs !== null && (
        <div className={s.addForm}>
          <div className={s.priceRow}>
            <label className={s.priceBox}>
              <div className={s.priceLabel}>{legs.token0.symbol}</div>
              <input
                className={s.priceInput}
                inputMode="decimal"
                placeholder="0.0"
                value={amount0}
                onChange={(e) => setAmount0(e.target.value)}
              />
            </label>
            <label className={s.priceBox}>
              <div className={s.priceLabel}>{legs.token1.symbol}</div>
              <input
                className={s.priceInput}
                inputMode="decimal"
                placeholder="0.0"
                value={amount1}
                onChange={(e) => setAmount1(e.target.value)}
              />
            </label>
          </div>
          {/* Both facts a reader needs and cannot see: nothing about the position
              changes except its size, and an over-supplied leg is not a loss.
              `increaseLiquidity` sizes the deposit from min(L(amount0),
              L(amount1)) and the pool pulls only what that liquidity costs, so
              the surplus is never transferred — it stays in the wallet. */}
          <p className={s.addNote}>
            Deposited into this position&apos;s own pool, {(p.fee / 10000).toFixed(2)}%
            tier and range — the bounds don&apos;t move. Whichever side the range
            doesn&apos;t need is left in your wallet.
          </p>
          <div className={s.actions}>
            <button
              className={`${s.actBtn} ${s.primary}`}
              disabled={!canAdd}
              onClick={onAdd}
            >
              {busy === "add" ? "Adding…" : "Confirm add"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PositionsPage() {
  const {
    positions,
    loading,
    collectFees,
    increaseLiquidity,
    removeLiquidity,
    refresh,
  } = useV3Positions();
  const { chainId, isConnected } = useWalletV2();
  const poolStates = usePoolStates(positions, chainId);
  const gate = useChainGate();

  // Bound to this chain so a position's raw addresses resolve against the right
  // registry — the same address means a different token on a different chain.
  const symbolFor = (address: string) => symbolForAddress(chainId, address);

  const withActive = positions.filter((p) => Number(p.liquidity) > 0);

  /* The third fact the two empty states below do not cover: a connected wallet
     on a chain with no PositionManager. `useV3Positions` reads nothing there, so
     "No liquidity positions yet." would be the same unchecked claim the comment
     further down rejects for the no-wallet case.
     Checked before the skeleton, not after: the gate is derived from the
     registry, so it is already known, and showing a loading state for a read
     that will never happen would be a fabricated wait. */
  if (!gate.ready) {
    return <ChainGate product="liquidity positions" state={gate} />;
  }

  if (loading && positions.length === 0) {
    return (
      <div className={s.cards}>
        {[0, 1].map((i) => (
          <div key={i} className={s.card} style={{ opacity: 0.5 }}>
            <div className={s.cardTop}>
              <div className={s.pair}>
                {/* Bare `.tki`, not a PairIcon — here the grey plate is the
                    point. `.tkiArt` drops it for real artwork, which would leave
                    the skeleton with nothing to draw. */}
                <span className={s.tki} />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  /* Two different empty states, because they are two different facts. With no
     wallet `useV3Positions` returns [] without asking the chain anything, so
     "no positions yet" would be a claim we never checked — and the fix for it
     is a connect, not a deposit. */
  if (withActive.length === 0) {
    return (
      <div className={s.empty}>
        <div className={s.emptyTitle}>
          {isConnected
            ? "No liquidity positions yet."
            : "Connect a wallet to see your positions."}
        </div>
        <div className={s.emptySub}>
          {isConnected
            ? "Provide liquidity to a pool to start earning trading fees."
            : "Positions are held as NFTs in your wallet, so there is nothing to read until one is connected."}{" "}
          Browse{" "}
          <Link href="/pool" className={s.emptyLink}>
            all pools
          </Link>{" "}
          or{" "}
          <Link href="/pool/new" className={s.emptyLink}>
            open a position
          </Link>
          .
        </div>
      </div>
    );
  }

  return (
    <div className={s.cards}>
      {withActive.map((p) => (
        <PositionCard
          key={p.tokenId}
          p={p}
          poolState={poolStates[p.tokenId]}
          chainId={chainId}
          symbolFor={symbolFor}
          collectFees={collectFees}
          increaseLiquidity={increaseLiquidity}
          removeLiquidity={removeLiquidity}
          refresh={refresh}
        />
      ))}
    </div>
  );
}
