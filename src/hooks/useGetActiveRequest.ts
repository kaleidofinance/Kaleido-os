"use client";

import { getKaleidoContract } from "@/config/contracts";
import { readOnlyProvider, READ_ONLY_CHAIN_ID } from "@/config/provider";
import { Request } from "@/constants/types";
import { getTokenDecimals } from "@/constants/utils/formatTokenDecimals";

import { ethers } from "ethers";
import { useCallback, useEffect, useState } from "react";
import { useActiveAccount, useActiveWalletChain } from "thirdweb/react";

const useGetActiveRequest = () => {
  const [activeReq, setActiveReq] = useState<Request[] | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const activeAccount = useActiveAccount();
  const address = activeAccount?.address;

  useEffect(() => {
    const fetchUserStatus = async () => {
      try {
        const contract = getKaleidoContract(
          readOnlyProvider,
          READ_ONLY_CHAIN_ID,
        );
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
            // READ_ONLY_CHAIN_ID, not the wallet chain: `res` came from the
            // diamond on the read chain two lines up, so req[8] is a read-chain
            // token address and only the read chain can say what it is. It also
            // has to match useBorrowV2, which parseUnits() this same string back
            // into base units to build the repay transaction — if the two chose
            // different decimals the round trip would silently scale the amount.
            getTokenDecimals(READ_ONLY_CHAIN_ID, req[8]),
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
  }, [address, refreshNonce]);

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
