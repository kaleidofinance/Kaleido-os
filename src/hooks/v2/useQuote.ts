"use client";

import { useCallback } from "react";
import { ethers } from "ethers";
import { readOnlyProvider } from "@/config/provider";
import { envVars } from "@/constants/envVars";
import protocolAbi from "@/abi/ProtocolFacet.json";

/**
 * getQuote — the truthful loan cost.
 *
 * The contract now normalises interest by term (feat(contracts): getQuote), so
 * this returns the exact total repayment and interest for an amount at a rate
 * over a term. Before this existed, the UI could only show a raw APR and let
 * the user do the arithmetic. A read call — no signer, no gas.
 */
export interface Quote {
  totalRepayment: bigint;
  interestAmount: bigint;
  durationSeconds: bigint;
}

export function useQuote() {
  return useCallback(
    async (
      amount: bigint,
      interestBps: number,
      returnDateUnix: number,
    ): Promise<Quote | null> => {
      const diamond = envVars.lendbitDiamondAddress;
      if (!diamond) return null;
      try {
        const contract = new ethers.Contract(diamond, protocolAbi, readOnlyProvider);
        const [totalRepayment, interestAmount, durationSeconds] =
          await contract.getQuote(amount, interestBps, returnDateUnix);
        return { totalRepayment, interestAmount, durationSeconds };
      } catch (err) {
        console.error("[useQuote] getQuote failed:", err);
        return null;
      }
    },
    [],
  );
}
