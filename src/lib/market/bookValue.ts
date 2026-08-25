/**
 * Valuing a book of base-unit amounts, as pure arithmetic.
 *
 * Split out of `api/market/overview/route.ts` so the part that was wrong can be
 * tested. The bug this replaces was not a missing null check or a bad query — it
 * was `Number(item.amount)` summed across tokens with different decimals and no
 * price, which is arithmetic, and arithmetic is provable. A route handler is not
 * importable from a test runner; this is.
 *
 * Nothing here touches the network, Supabase, ethers or Next. Currencies and
 * prices are arguments, so a test can hand it a book whose answer is known by
 * hand. See bookValue.test.ts.
 */

/** A row of either mirror table, narrowed to the two columns valuation needs. */
export interface BookRow {
  tokenAddress: string | null;
  amount: string | null;
}

/** The decimals authority, passed in rather than imported — see the header. */
export interface Currency {
  symbol: string;
  address: string;
  decimals: number;
}

/**
 * What a headline total leaves out.
 *
 * Counts are ROWS, not tokens, because this feeds a footnote read by a human
 * deciding whether to trust the number: "3 of 17 positions unpriced" is
 * actionable, "1 of 4 tokens unpriced" is not.
 *
 * `valued + unpriced + unknownToken + malformedAmount === rows` is an invariant.
 * The whole point of returning it is that it can be checked — bookValue.test.ts
 * asserts it on every case, and /api/market/overview returns it so a caller can
 * too.
 */
export interface MarketCoverage {
  /** Rows read from the mirror tables. */
  rows: number;
  /** Rows whose token resolved to a decimals entry AND a USD price. */
  valued: number;
  /** Rows whose token is known but has no USD price (KLD before TGE, say). */
  unpriced: number;
  /** Rows whose tokenAddress is absent from the currency list. Never guessed. */
  unknownToken: number;
  /** Rows whose amount is not a base-unit integer. Never coerced. */
  malformedAmount: number;
}

/** Headline figures for the protocol stat strips. Every field is nullable. */
export interface MarketOverview {
  /** USD value of the OPEN lending book (offers + requests). */
  lendingTvlUsd: number | null;
  /** OPEN rows in `kaleido_listings` — offers a borrower can take right now. */
  openOffers: number | null;
  /** OPEN rows in `kaleido_requests` — requests a lender can fund right now. */
  openRequests: number | null;
  /** Count of SERVICED requests — loans that have been funded. */
  loansOutstanding: number | null;
  /** kfUSD.totalSupply(), whole units. */
  kfUsdSupply: number | null;
  /** Pooled KLD in the staking vault, in KLD — never dollars: KLD is UNPRICED. */
  kldStaked: number | null;
  coverage: MarketCoverage;
  /** ISO timestamp the figures were computed at, so a stale serve is visible. */
  asOf: string;
  /** Legs that failed. Non-empty means at least one field above is null. */
  degraded: string[];
}

export interface TokenTotal {
  symbol: string;
  decimals: number;
  /** Exact sum in base units. */
  total: bigint;
  /** Rows that contributed, for the coverage footnote. */
  rows: number;
}

export interface FoldedBook {
  totals: TokenTotal[];
  rows: number;
  unknownToken: number;
  malformedAmount: number;
}

/**
 * A base-unit amount is an unsigned integer, and the column holding it is TEXT.
 *
 * Anything else — "1.5", "1e18", "", "-1", "0x…" — is counted as malformed
 * rather than coerced. `BigInt("1.5")` throws and `Number("1.5")` silently
 * changes the units, so there is no third option that is not a guess.
 */
const BASE_UNITS = /^[0-9]+$/;

export const EMPTY_COVERAGE: MarketCoverage = {
  rows: 0,
  valued: 0,
  unpriced: 0,
  unknownToken: 0,
  malformedAmount: 0,
};

/**
 * Sum rows per token, exactly.
 *
 * Summing in BigInt and converting once per token is not merely tidier than
 * converting per row: it leaves the final multiply by a price as the only
 * floating-point operation in the whole path.
 *
 * Addresses are matched case-insensitively because the mirror tables are
 * populated from chain logs, which are lowercase, while the registry stores
 * checksummed addresses.
 */
export function foldBook(rows: BookRow[], currencies: readonly Currency[]) {
  const byAddress = new Map<string, Currency>(
    currencies.map((c) => [c.address.toLowerCase(), c]),
  );
  const buckets = new Map<string, TokenTotal>();
  let unknownToken = 0;
  let malformedAmount = 0;

  for (const row of rows) {
    const key = (row.tokenAddress ?? "").trim().toLowerCase();
    const currency = byAddress.get(key);
    if (!currency) {
      unknownToken++;
      continue;
    }

    const raw = (row.amount ?? "").trim();
    if (!BASE_UNITS.test(raw)) {
      malformedAmount++;
      continue;
    }

    const bucket = buckets.get(key) ?? {
      symbol: currency.symbol,
      decimals: currency.decimals,
      total: BigInt(0),
      rows: 0,
    };
    bucket.total += BigInt(raw);
    bucket.rows += 1;
    buckets.set(key, bucket);
  }

  const folded: FoldedBook = {
    totals: Array.from(buckets.values()),
    rows: rows.length,
    unknownToken,
    malformedAmount,
  };
  return folded;
}

/**
 * Convert one token's base-unit total to whole units.
 *
 * Deliberately not `ethers.formatUnits`: this module stays dependency-free so
 * the test runner can load it without a bundler, and the operation is exact
 * integer division plus a decimal point. The result is a string for the same
 * reason `formatUnits` returns one — the caller decides when precision is lost.
 */
export function toWholeUnits(total: bigint, decimals: number): string {
  if (decimals === 0) return total.toString();
  /* `BigInt(10) ** BigInt(decimals)` is TS2791 on this repo's ES5 target, the
   * same reason `0n` literals are unusable here. Building the scale as a digit
   * string is exact and needs no exponentiation operator. */
  const scale = BigInt(`1${"0".repeat(decimals)}`);
  const whole = total / scale;
  const frac = (total % scale).toString().padStart(decimals, "0");
  return `${whole}.${frac}`;
}

/**
 * Price a folded book.
 *
 * `priceOf` returns null for an asset with no USD price, which is a normal
 * condition rather than an error — KLD has no market before TGE.
 *
 * The total is null, never 0, when rows were read and none of them could be
 * priced. An empty book genuinely is $0 and says so; a dead price feed is not
 * a measurement of zero. Where *some* tokens priced and others did not, the
 * partial total is returned and `coverage` says what it excludes — dropping
 * rows silently is what made the old strip untrustworthy.
 */
export function valueBook(
  folded: FoldedBook,
  priceOf: (symbol: string) => number | null,
): { usd: number | null; coverage: MarketCoverage } {
  let usd = 0;
  let valued = 0;
  let unpriced = 0;

  for (const bucket of folded.totals) {
    const price = priceOf(bucket.symbol);
    if (price === null || !Number.isFinite(price)) {
      unpriced += bucket.rows;
      continue;
    }
    usd += parseFloat(toWholeUnits(bucket.total, bucket.decimals)) * price;
    valued += bucket.rows;
  }

  const priceable = folded.rows - folded.unknownToken - folded.malformedAmount;
  const measurable = priceable === 0 || valued > 0;

  return {
    usd: measurable ? usd : null,
    coverage: {
      rows: folded.rows,
      valued,
      unpriced,
      unknownToken: folded.unknownToken,
      malformedAmount: folded.malformedAmount,
    },
  };
}
