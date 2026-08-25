import { qty, usd } from "@/lib/format/figures";

import s from "../pool.module.css";

/**
 * What the pool holds, as a proportion and as two figures.
 *
 * THE SPLIT IS PRICED EXTERNALLY, AND IT HAS TO BE.
 *
 * Measured at the pool's own ratio the two legs are always *exactly* equal —
 * that is what the ratio means, and `usePoolData` says so in as many words
 * ("At the pool's own price the two sides hold equal value", usePoolData.ts:307).
 * A bar drawn that way would be 50/50 for every pool that has ever existed,
 * which is a decoration rather than a measurement. So it splits on `value0` /
 * `value1` from the shared spot table, and the gap from centre is the pool's
 * drift against that table.
 *
 * With only one leg priced there is no ratio to draw, and the bar is omitted
 * rather than filled to some default: half a split is not a split. The balances
 * themselves still render, because those are read straight off the pair and are
 * true regardless of whether anyone can price them.
 *
 * Colours are the system's two accents (`--k-brand`, `--k-alt`) rather than
 * pos/neg — neither leg of a pair is the good one.
 */
export default function PoolBalanceBar({
  symbol0,
  symbol1,
  amount0,
  amount1,
  value0,
  value1,
}: {
  symbol0: string;
  symbol1: string;
  /** Display units, already scaled out of base units. */
  amount0: number;
  amount1: number;
  value0: number | null;
  value1: number | null;
}) {
  const priced = value0 !== null && value1 !== null;
  const total = priced ? value0 + value1 : 0;
  /* A pool with both legs priced at zero is priced, but has nothing to divide.
     Guarded here rather than upstream so `priced` keeps meaning "both legs have
     a price" and not "the bar will render". */
  const share0 = priced && total > 0 ? (value0 / total) * 100 : null;

  return (
    <div className={s.bal}>
      <div className={s.balHead}>Pool balances</div>

      {share0 !== null && (
        <div
          className={s.balBar}
          /* The reader gets the same figure twice — as a length and, on the rows
             below, as a number — so the bar itself is decorative to a screen
             reader and hidden from it. */
          aria-hidden="true"
        >
          <span className={s.balFill0} style={{ width: `${share0}%` }} />
          <span className={s.balFill1} style={{ width: `${100 - share0}%` }} />
        </div>
      )}

      <div className={s.balRows}>
        <BalanceRow
          dot={s.balDot0}
          symbol={symbol0}
          amount={amount0}
          value={value0}
        />
        <BalanceRow
          dot={s.balDot1}
          symbol={symbol1}
          amount={amount1}
          value={value1}
        />
      </div>
    </div>
  );
}

/**
 * Decimals scaled to the size of the number.
 *
 * 522,000,000 WISE wants none and 28.5 ETH wants four — the same two decimals on
 * both would print a meaningless `.00` on the first and round the second to
 * nothing. Mirrors the price column's own `p.price < 1 ? 6 : 4` on the pools
 * table, which exists for the same reason.
 */
const amountDp = (n: number) => (n >= 1000 ? 0 : n >= 1 ? 4 : 6);

function BalanceRow({
  dot,
  symbol,
  amount,
  value,
}: {
  dot: string;
  symbol: string;
  amount: number;
  value: number | null;
}) {
  return (
    <div className={s.balRow}>
      <span className={`${s.balDot} ${dot}`} aria-hidden="true" />
      <span className={s.balSym}>{symbol}</span>
      <span className={`${s.balAmt} tabular`}>
        {qty(amount, amountDp(amount))}
      </span>
      {/* An em dash, never a blank: this leg holds what it holds whether or not
          the spot table can price it, and an empty cell reads as zero. */}
      <span className={`${s.balUsd} tabular`}>{usd(value)}</span>
    </div>
  );
}
