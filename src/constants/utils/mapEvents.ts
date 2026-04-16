export const LABEL_MAP: Record<string, Record<string, string>> = {
  CollateralDeposited: {
    "0": "Sender:",
    "1": "Collateral Token:",
    "2": "Amount:",
  },
  RequestCreated: {
    "0": "Borrower:",
    "1": "Request ID:",
    "2": "Amount:",
    "3": "Interest:",
    "4": "Token:",
  },
  LoanRepayment: {
    "0": "Sender:",
    "1": "Request ID:",
    "2": "Amount:",
  },
  CollateralWithdrawn: {
    "0": "Sender:",
    "1": "Collateral Token:",
    "2": "Amount:",
  },
  RequestLiquidated: {
    "0": "Request ID:",
    "1": "Lender:",
    "2": "Borrower",
    "3": "Total Repayment:",
  },
  RequestServiced: {
    "0": "Request ID:",
    "1": "Lender:",
    "2": "Borrower:",
    "3": "Amount:",
  },
  LoanListingCreated: {
    "0": "Listing ID:",
    "1": "Sender:",
    "2": "Token:",
    "3": "Amount:",
  },
}
