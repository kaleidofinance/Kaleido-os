export const usdAmount = (amount: string, symbol: string | undefined, priceOf: (symbol: string) => number | null) => {
  if (!symbol || !amount.trim()) return null;
  const amountNumber = Number(amount);
  const price = priceOf(symbol);
  if (!Number.isFinite(amountNumber) || price === null || !Number.isFinite(price)) return null;
  return amountNumber * price;
};

export const usdText = (value: number | null) =>
  value === null
    ? "—"
    : `$${value.toLocaleString(undefined, { maximumFractionDigits: value < 1 ? 6 : 2 })}`;

