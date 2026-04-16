/**
 * Formats a number with comma separators.
 * @param value The value to format (number or string)
 * @param decimals Number of decimal places (default 2)
 * @returns Formatted string (e.g., 1,000,000.00)
 */
export const formatWithCommas = (value: string | number | undefined | null, decimals: number = 2): string => {
  if (value === undefined || value === null || value === "") return "0.00";
  
  const num = Number(value);
  if (isNaN(num)) return String(value);

  return num.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};
