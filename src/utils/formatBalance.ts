export const formatBalance = (
  balance: string | number | undefined | null,
  decimals: number = 2
): string => {
  if (!balance) return "0.00";
  const num = Number(balance);
  if (isNaN(num) || num === 0) return "0.00";
  
  return num.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};
