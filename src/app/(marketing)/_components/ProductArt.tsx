import TokenIcon from "@/components/v2/TokenIcon";
import { TICK_SPACINGS } from "@/constants/utils/v3Math";
import type { ArtKind } from "./products";
import s from "./ProductArt.module.css";

/**
 * One small figure per product, in the panel beside the three facts.
 *
 * WHY THIS EXISTS. The rest of this route group argues in prose. `#can` is the one
 * section that argues by *showing* — TracePlayer replays a real turn built by the
 * product's own parser — and it is the most convincing thing on the page. The
 * product rail was five titles, five sentences and fifteen facts, all type, which
 * is a directory of claims rather than a look at the products. Every DeFi front
 * door worth comparing against puts something in each product card that came out
 * of the product: the tokens you would pool, the shape of the position, the two
 * sides of the book. Not clip art — a crop of the thing itself.
 *
 * SO NOTHING IN HERE IS INVENTED, and that rule is the whole design constraint.
 * The temptation with a figure like this is a depth curve with plausible bars or a
 * headline APY, and that is exactly the mistake the embedded price chart was — it
 * printed a fabricated 19% ETH day on the front door because the mock flag was on.
 * ProductRail.tsx has the long version. Every value below has a source:
 *
 *   - Token marks come from <TokenIcon>, the app's own build-time icon map, so a
 *     disc here is the same asset art /trade draws. Nothing is hotlinked.
 *   - Tick spacings are imported from constants/utils/v3Math.ts, which is the
 *     table the pool contract enforces. They are not retyped.
 *   - The fee tier labels are the three `/pool/new` actually offers.
 *   - The borrow and lend rows are the `example` values in capabilities.ts, which
 *     is the same fixture `#can` types out one section above. A visitor who reads
 *     both sees the same numbers, because they are the same numbers.
 *   - Transaction counts are asserted by capabilities.test.ts against buildIntents.
 *
 * THERE IS NO LIVE DATA AND NO NUMBER NOBODY CONTROLS. No price, no TVL, no APY,
 * no balance. Two figures deliberately withhold a number they could have shown:
 * `range` draws the shape of a position without any liquidity depth, because depth
 * needs pool state this page does not have and a plausible histogram is a lie with
 * a grid behind it; and `wrap` states the mechanism with no exchange rate, because
 * products.ts makes "no advertised APY" a copy rule for Stake.
 *
 * ALL OF IT IS STATIC AND DECORATIVE. No hooks, no fetch, no wallet — the route
 * group's layout.tsx forbids the last of those. The figures are `aria-hidden`
 * where they restate an adjacent fact and labelled where they do not; the three
 * facts under each panel remain the readable content.
 */

/** 20px, matching the rail's marks and the `.chainIcon` in the chains list. */
const DISC = 20;

/**
 * The three tiers `/pool/new` offers, with the spacing each one enforces.
 *
 * The labels are that page's FEE_TIERS (pool/new/page.tsx:35) restated rather than
 * imported, because that module is `"use client"` with the whole wallet stack above
 * it and importing one array would drag all of it onto the front door. The
 * *spacings* are not restated — they come from TICK_SPACINGS, so the pair cannot
 * drift from what the contract enforces.
 *
 * TICK_SPACINGS also has 100 → 1, the 0.01% tier. It is absent here on purpose:
 * the math supports it, the pool UI does not offer it, and this figure shows what a
 * visitor can pick. Do not add a fourth chip without adding it to /pool/new first.
 */
const TIERS = [
  { fee: 500, label: "0.05%" },
  { fee: 3000, label: "0.30%" },
  { fee: 10000, label: "1.00%" },
] as const;

/** A token disc with its symbol beside it. */
function Asset({ symbol }: { symbol: string }) {
  return (
    <span className={s.asset}>
      <TokenIcon symbol={symbol} size={DISC} className={s.disc} />
      <span className={s.sym}>{symbol}</span>
    </span>
  );
}

/** Discs only, overlapped — for the row of three collateral assets. */
function Stack({ symbols }: { symbols: readonly string[] }) {
  return (
    <span className={s.stack}>
      {symbols.map((sym) => (
        <TokenIcon
          key={sym}
          symbol={sym}
          size={DISC}
          className={`${s.disc} ${s.stacked}`}
        />
      ))}
    </span>
  );
}

function Arrow() {
  return (
    <span className={s.arrow} aria-hidden="true">
      →
    </span>
  );
}

/** The uppercase micro-caption, the same one `.groupHead` and `.returnsLabel` use. */
function Cap({ children }: { children: string }) {
  return <span className={s.cap}>{children}</span>;
}

/* ------------------------------------------------------------------
 * Trade — the pair, then the two transactions.
 *
 * "A swap is an approve and then the swap — two transactions, shown as two" is one
 * of Trade's three facts, and capabilities.test.ts asserts that shape against
 * buildIntents. The figure is that sentence as the plan the app would build, using
 * the same numbered-marker rows TracePlayer draws.
 * ------------------------------------------------------------------ */
function Swap() {
  return (
    <>
      <div className={s.row}>
        <Asset symbol="ETH" />
        <Arrow />
        <Asset symbol="USDC" />
      </div>
      <ol className={s.steps}>
        <li className={s.step}>
          <span className={s.marker} aria-hidden="true">
            1
          </span>
          Approve USDC
        </li>
        <li className={s.step}>
          <span className={s.marker} aria-hidden="true">
            2
          </span>
          Swap
        </li>
      </ol>
    </>
  );
}

/* ------------------------------------------------------------------
 * Liquidity — the range bracket, and the real tiers.
 *
 * NO DEPTH HISTOGRAM, and this is the figure the rule at the top of the file was
 * written for. A liquidity distribution needs slot0 and the tick bitmap of a real
 * pool; this page has neither, and bars drawn to look right would be a fabricated
 * market figure with a grid behind it to make it look sourced.
 *
 * What is honest is the *shape*: a price axis, a band you chose, and the fact that
 * your liquidity is only in the band. That is what concentrated liquidity is, and
 * it is what distinguishes this from "a risk slider over someone else's range" —
 * Liquidity's second fact. The band's position is a layout constant, not a quote.
 * ------------------------------------------------------------------ */
function Range() {
  return (
    <>
      <div className={s.row}>
        <Stack symbols={["ETH", "USDC"]} />
        <span className={s.pair}>ETH / USDC</span>
      </div>

      <div className={s.range} aria-hidden="true">
        <span className={s.axis} />
        <span className={s.band} />
        <span className={`${s.edge} ${s.edgeLo}`} />
        <span className={`${s.edge} ${s.edgeHi}`} />
      </div>
      <div className={s.rangeLabels} aria-hidden="true">
        <span>lower tick</span>
        <span>your liquidity</span>
        <span>upper tick</span>
      </div>

      <div className={s.tiers}>
        {/* "Fee tiers" alone left the `·10` beside each label unexplained — for a
            sighted reader and, worse, for a screen reader, which would announce
            "0.05% ·10" with nothing to hang it on. Naming both halves in the
            caption costs six words and needs no visually-hidden text. */}
        <Cap>Fee tier · tick spacing</Cap>
        <span className={s.tierChips}>
          {TIERS.map((t) => (
            <span key={t.fee} className={s.tier}>
              {t.label}
              {/* The spacing the contract enforces for this tier, from
                  TICK_SPACINGS — the reason a tier is not just a fee. */}
              <span className={s.tierSpacing}>·{TICK_SPACINGS[t.fee]}</span>
            </span>
          ))}
        </span>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------
 * Borrow — both sides of the book.
 *
 * "Peer-to-peer, both directions" is the panel's title and a two-column figure is
 * the only honest drawing of it: one side is what you post, the other is what
 * somebody else posted. The four values are the `example` objects on `borrow` and
 * `lend` in capabilities.ts, so they are the same numbers `#can` types into its
 * composer one section up rather than a second set invented here.
 * ------------------------------------------------------------------ */
function Book() {
  return (
    <div className={s.book}>
      <div className={s.side}>
        <Cap>You post</Cap>
        <span className={s.bookAmt}>
          <TokenIcon symbol="USDC" size={16} className={s.disc} />
          5,000 USDC
        </span>
        <span className={s.bookTerms}>7.5% · 30 days</span>
      </div>
      <div className={s.side}>
        <Cap>Or you take</Cap>
        <span className={s.bookAmt}>
          <TokenIcon symbol="USDC" size={16} className={s.disc} />
          10,000 USDC
        </span>
        <span className={s.bookTerms}>6% · 60 days</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------
 * Stake — the round trip, and no rate.
 *
 * THE EXCHANGE RATE IS DELIBERATELY ABSENT. It is the one number that would make
 * this figure look complete, and products.ts makes its absence a copy rule: "No
 * advertised APY — the exchange rate is the whole disclosure" is one of Stake's
 * three facts, and the app quotes no rate for it either. A rate here would need
 * either a live read this page cannot do or a made-up figure.
 *
 * So the figure is the reversibility, which is the actual claim behind "stay
 * liquid", and it is Stake's third fact — "One transaction in, one out" — drawn
 * rather than restated: the same pair, both ways, nothing in between. An earlier
 * draft also carried a note reading "stKLD transfers while it earns", which was the
 * first fact copied word for word from 300px to the left. The figure earns its space
 * by showing something the sentences cannot, not by repeating them.
 *
 * "ROUND TRIP" RATHER THAN "BOTH DIRECTIONS", because Borrow's panel title is
 * already "Peer-to-peer, both directions" and two figures reaching for the same
 * phrase makes them sound like the same idea. It is also two rows and NOT an <ol>:
 * stake and unstake are two independent one-transaction actions, not two steps of
 * one, so `.marker`'s numbering — which belongs to a plan, and Swap is one — would
 * claim you sign both to stake.
 * ------------------------------------------------------------------ */
function Wrap() {
  return (
    <>
      <Cap>Round trip</Cap>
      <ul className={s.steps}>
        <li className={s.step}>
          <Asset symbol="KLD" />
          <Arrow />
          <Asset symbol="stKLD" />
          <span className={s.rowLabel}>Stake</span>
        </li>
        <li className={s.step}>
          <Asset symbol="stKLD" />
          <Arrow />
          <Asset symbol="KLD" />
          <span className={s.rowLabel}>Unstake</span>
        </li>
      </ul>
    </>
  );
}

/* ------------------------------------------------------------------
 * Stable — three into one, then into the vault.
 *
 * Every mark in this figure is a file or a vector this repo already ships: USDC,
 * USDT and USDe are @web3icons vectors in TokenIcon's ICONS table, kfUSD and
 * kafUSD are PNGs under public/stable/ in its RASTER table. The two steps are the
 * two the product has — mint against collateral, lock for yield — and "Unlocking
 * is a request and then a withdrawal" is the fact directly beside it.
 * ------------------------------------------------------------------ */
function Mint() {
  return (
    <div className={s.flow}>
      <div className={s.flowRow}>
        <Stack symbols={["USDC", "USDT", "USDe"]} />
        <span className={s.rowLabel}>Any of three</span>
      </div>
      <span className={s.down} aria-hidden="true">
        ↓
      </span>
      <div className={s.flowRow}>
        <Asset symbol="kfUSD" />
        <span className={s.rowLabel}>Mint</span>
      </div>
      <span className={s.down} aria-hidden="true">
        ↓
      </span>
      <div className={s.flowRow}>
        <Asset symbol="kafUSD" />
        <span className={s.rowLabel}>Lock to earn</span>
      </div>
    </div>
  );
}

const FIGURES: Record<ArtKind, () => React.JSX.Element> = {
  swap: Swap,
  range: Range,
  book: Book,
  wrap: Wrap,
  mint: Mint,
};

export default function ProductArt({ kind }: { kind: ArtKind }) {
  const Figure = FIGURES[kind];
  return (
    <div className={s.art}>
      <Figure />
    </div>
  );
}
