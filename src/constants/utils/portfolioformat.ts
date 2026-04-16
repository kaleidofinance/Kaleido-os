import BigNumber from "bignumber.js"
import { FormatPortfolioValueOptions } from "../types"

export function formatPortfolioValue(
  value: string | number | BigNumber,
  options: FormatPortfolioValueOptions = {},
): string {
  const { decimals = 2, currency = "USD", locale = "en-US", compact = true } = options

  const bnValue = new BigNumber(value)

  if (bnValue.isNaN()) return "-"

  const thresholds = [
    { value: new BigNumber("1e12"), suffix: "T" },
    { value: new BigNumber("1e9"), suffix: "B" },
    { value: new BigNumber("1e6"), suffix: "M" },
    { value: new BigNumber("1e3"), suffix: "K" },
  ]

  let displayValue = bnValue
  let suffix = ""

  if (compact) {
    for (const threshold of thresholds) {
      if (bnValue.isGreaterThanOrEqualTo(threshold.value)) {
        displayValue = bnValue.dividedBy(threshold.value)
        suffix = threshold.suffix
        break
      }
    }
  }

  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

  const formattedNumber = formatter.format(displayValue.toNumber()).replace(/[^0-9.,]/g, "")

  return `${formattedNumber} ${suffix}`
}
