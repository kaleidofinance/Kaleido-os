"use client";

import { getKaleidoContract } from "@/config/contracts";
import { providerForChain, READ_ONLY_CHAIN_ID } from "@/config/provider";
import { Request } from "@/constants/types";
import { getTokenDecimals } from "@/constants/utils/formatTokenDecimals";

import { ethers } from "ethers";
import { useCallback, useEffect, useState } from "react";
import { useWalletV2 } from "@/hooks/v2/useWalletV2";

const useGetActiveRequest = () => {
  const [activeReq, setActiveReq] = useState<Request[] | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const { address, chainId } = useWalletV2();
  /* The WALLET's chain, not a pinned read chain — a loan is written on the
     chain the wallet is on, so its read has to follow the wallet the way the
     write does. Pinning to READ_ONLY_CHAIN_ID showed "0 loans" to anyone whose
     loans were on any other chain (e.g. Base Sepolia), while the portfolio,
     which sweeps every chain, showed them — the mismatch a tester reported.
     Falls back to the read chain only when walletless. */
  const readChain = chainId ?? READ_ONLY_CHAIN_ID;

  useEffect(() => {
    const fetchUserStatus = async () => {
      try {
        const provider = providerForChain(readChain);
        if (!provider) return;
        const contract = getKaleidoContract(provider, readChain);
        const res = await contract.getUserActiveRequests(address);

        // console.log("RESPONSE", res);

        // const formattedRequests: Request[] = res.map((req: any) => ({
        //   requestId: Number(req[0]), // Convert BigNumber to number
        //   author: req[1],
        //   amount: String(req[2]), // Convert BigNumber to string for amount
        //   interest: Number(req[3]), // Convert BigNumber to number for interest
        //   totalRepayment: ethers.formatUnits(req[4], getTokenDecimals(req[7])),
        //   returnDate: Number(req[5]), // Convert BigNumber to number for date
        //   lender: req[6],
        //   tokenAddress: req[7], // Assuming you meant tokenAddress from `loanRequestAddr`
        //   status: String(Number(req[9])), // Map the status to a string representation
        // }))

        const formattedRequests: Request[] = res.map((req: any) => ({
          requestId: Number(req[1]), // from index 1
          author: req[2], // from index 2
          amount: String(req[3]), // from index 3
          interest: Number(req[4]), // from index 4
          totalRepayment: ethers.formatUnits(
            req[5],
            // `readChain`, the wallet's chain: `res` came from the diamond on
            // that chain, so req[8] is a token address on it and only it can say
            // what the token is. useBorrowV2 parseUnits() this same string back
            // into base units for the repay, reading decimals on the SAME wallet
            // chain — the two must agree or the round trip rescales the amount
            // (Arc's USDC is 18-dec where every other chain's is 6).
            getTokenDecimals(readChain, req[8]),
          ), // from index 5
          returnDate: Number(req[6]), // from index 6
          lender: req[7], // from index 7
          tokenAddress: req[8], // from index 8 (loanRequestAddr or tokenAddr)
          status: String(Number(req[10])), // from index 10
        }));

        setActiveReq(formattedRequests);
      } catch (err) {
        // console.error(err)
      }
    };

    if (address) {
      fetchUserStatus();
    }
  }, [address, readChain, refreshNonce]);

  // Function to parse status from the contract's Status enum
  const parseStatus = (status: number): string => {
    switch (status) {
      case 0:
        return "OPEN";
      case 1:
        return "SERVICED";
      case 2:
        return "CLOSED";
      default:
        return "UNKNOWN";
    }
  };

  // Bumping the nonce re-runs the fetch effect above. useBorrowV2 calls this
  // after a repay/take-loan so the active-loan list re-reads instead of staying
  // stale until the address changes or a full reload.
  const refresh = useCallback(() => setRefreshNonce((n) => n + 1), []);

  return { requests: activeReq, refresh };
};

export default useGetActiveRequest;
