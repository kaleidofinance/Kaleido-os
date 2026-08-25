/**
 * What a kfUSD mint or redeem actually pays out, after the contract's fee.
 *
 * Both directions take the fee out of the amount the user names, so the figure
 * they receive is never the figure they typed:
 *
 *   mint()   fee = (_amount * mintFee) / BASIS_POINTS, then _mint(to, _amount - fee)
 *   redeem() fee = (_amount * redeemFee) / BASIS_POINTS, then pays out _amount - fee
 *            scaled to the output token's decimals
 *
 * (kfUSD.sol:136-137 and :220-221, :247-266.)
 *
 * Neither form showed this. The mint page put the raw input in a read-only
 * "You receive" box, quoted "1 USDC = 1 kfUSD", promised the pre-fee figure in
 * its own button, and stated "Minting fee: None" — four claims, all of them off
 * by the live fee. The redeem page quoted 1:1 and had no fee row at all. This
 * exists so both read the same number from the same place.
 *
 * Deliberately float math on display values. The contract floors integer
 * division on the token's smallest unit, so the last wei can differ; that is
 * below the two decimals either form renders and is not worth a bigint quote
 * path. It does mean this is an estimate of the settled amount, not a promise
 * of it.
 */
export interface FeeQuote {
  /** Fee in input units — USDC on a mint, kfUSD on a redeem. Null if unknown. */
  fee: number | null;
  /** What the user receives: input minus fee. Null if the fee is unknown. */
  output: number | null;
  /** Output per unit of input, for the rate row. Null if the fee is unknown. */
  rate: number | null;
}

const UNKNOWN: FeeQuote = { fee: null, output: null, rate: null };

/**
 * @param amount      Raw form input, as typed. Empty or unparseable reads as 0.
 * @param feePercent  Fee as a percent string from `stats` — 5 bps is "0.05".
 *                    Null means it has not been read off-chain yet, which is
 *                    not the same as zero: quoting an unread fee as free is the
 *                    bug this replaced. Null in, nulls out.
 */
export function quoteAfterFee(
  amount: string,
  feePercent: string | null,
): FeeQuote {
  if (feePercent === null) return UNKNOWN;

  const pct = parseFloat(feePercent);
  if (!Number.isFinite(pct) || pct < 0) return UNKNOWN;

  const rate = 1 - pct / 100;
  const input = parseFloat(amount || "0");

  // An empty form has a known rate but nothing to apply it to.
  if (!Number.isFinite(input) || input <= 0) return { fee: 0, output: 0, rate };

  const fee = input * (pct / 100);
  return { fee, output: input - fee, rate };
}

/** Display helper: trims to `max` decimals without padding whole numbers. */
export function trim(value: number, max = 6): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: max });
}
