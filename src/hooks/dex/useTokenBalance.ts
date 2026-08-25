import { useCallback, useState, useEffect } from "react";
import { useActiveAccount } from "thirdweb/react";
import { ethers } from "ethers";
import { IToken } from "@/constants/types/dex";
import { MOCK_DATA, mockBalance } from "@/lib/mock";

const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
];

export const useTokenBalance = (token: IToken | null) => {
  const activeAccount = useActiveAccount();
  const [balance, setBalance] = useState("0");
  const [loading, setLoading] = useState(false);

  const fetchBalance = useCallback(async () => {
    if (!activeAccount || !token) {
      setBalance("0");
      return;
    }
    /* Fixture balances, above the try so no BrowserProvider is ever built: on a
       chain with no deployment every call below fails and the wallet reads empty,
       which disables Max, the quick-percentage buttons and every CTA. Placed
       after the guard rather than before it, so it is scoped to a connected
       address for free — a wallet balance without a wallet is not a number this
       should invent. Deleting ./mock deletes these three lines. */
    if (MOCK_DATA) {
      setBalance(mockBalance(token));
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const provider = new ethers.BrowserProvider(window.ethereum);
      let rawBalance;
      let decimals = 18;

      // Check if native (ETH)
      if (
        token.isNative ||
        token.address === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"
      ) {
        rawBalance = await provider.getBalance(activeAccount.address);
        decimals = 18;
      } else {
        const tokenContract = new ethers.Contract(
          token.address,
          ERC20_ABI,
          provider,
        );
        const [bal, dec] = await Promise.all([
          tokenContract.balanceOf(activeAccount.address),
          token.decimals
            ? Promise.resolve(token.decimals)
            : tokenContract.decimals().catch(() => 18),
        ]);
        rawBalance = bal;
        decimals = Number(dec);
      }

      const formatted = ethers.formatUnits(rawBalance, decimals);
      // Format to 6 decimal places for display, but keep string precise if needed?
      // The UI usually expects a string.
      // Let's strip trailing zeros if it has a dot?
      // Actually standard formatUnits returns string like "1.5".
      setBalance(formatted);
    } catch (error) {
      console.error("Error fetching balance for", token.symbol, error);
      setBalance("0");
    } finally {
      setLoading(false);
    }
  }, [activeAccount, token]);

  useEffect(() => {
    fetchBalance();
    const interval = setInterval(fetchBalance, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, [fetchBalance]);

  return { balance, loading, refetch: fetchBalance };
};
