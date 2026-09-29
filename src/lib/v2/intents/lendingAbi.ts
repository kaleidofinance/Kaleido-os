import { ethers } from "ethers";

/**
 * The lending diamond calls Luca signs — ONE copy, shared by the resolvers that
 * send them (definitions.ts) and the simulator that predicts them (batch.ts
 * `encodeForSimulation`), so a simulated step is byte-for-byte the step signed.
 * Every selector is checked against the facet ABI in lendingAbi.test.ts.
 */
export const LENDING_ABI = [
  "function depositCollateral(address token, uint256 amount) external payable",
  "function withdrawCollateral(address token, uint128 amount) external",
  "function repayLoan(uint96 requestId, uint256 amount) external payable",
  "function createLendingRequest(uint128 amount, uint16 interest, uint256 returnDate, address token) external",
  "function createLoanListing(uint256 amount, uint256 minAmount, uint256 maxAmount, uint256 returnDate, uint16 interest, address token) external payable",
  "function requestLoanFromListing(uint96 listingId, uint256 amount) external",
  "function serviceRequest(uint96 requestId, address token) external payable",
  "function closeListingAd(uint96 listingId) external",
  "function closeRequest(uint96 requestId) external",
];

export const LENDING_IFACE = new ethers.Interface(LENDING_ABI);
