import { ethers } from "ethers";
import { readOnlyProvider } from "@/config/provider";
import { USDC_ADDRESS, USDR, kfUSD_ADDRESS, USDT_ADDRESS } from "./addresses";
import { CHAINS_BY_ID } from "@/constants/chains";

const providerCache = new Map<number, ethers.JsonRpcProvider>();

// High-Performance Omni-Chain Provider Hub
export const getOmniProvider = (chainId: number) => {
  if (chainId === 11124 || chainId === 2741) return readOnlyProvider; // Abstract — shares the app's RPC

  const cached = providerCache.get(chainId);
  if (cached) return cached;

  const meta = CHAINS_BY_ID[chainId];
  if (!meta) return readOnlyProvider;

  const provider = new ethers.JsonRpcProvider(
    meta.rpcUrls[0],
    { chainId, name: meta.shortName.toLowerCase() },
    { staticNetwork: true },
  );
  providerCache.set(chainId, provider);
  return provider;
};

export interface ChainBalance {
  chainId: number;
  chainName: string;
  balance: string;
}

export interface OmniPortfolioItem {
  token: string;
  totalBalance: string;
  chains: ChainBalance[];
}

const TOKEN_CONFIG: Record<string, { address: string; decimals: number }> = {
  USDC: { address: USDC_ADDRESS, decimals: 6 },
  USDR: { address: USDR, decimals: 18 },
  kfUSD: { address: kfUSD_ADDRESS, decimals: 18 },
  USDT: { address: USDT_ADDRESS, decimals: 6 },
};

const resolveChainName = (chainId: number) => CHAINS_BY_ID[chainId]?.name ?? "Unknown";

export const fetchOmniAssetBalance = async (address: string, token: string, chainIds: number[]): Promise<OmniPortfolioItem> => {
  const config = TOKEN_CONFIG[token];
  
  const balances = await Promise.all(
    chainIds.map(async (chainId) => {
      try {
        const provider = getOmniProvider(chainId);
        
        if (token === "ETH") {
          const bal = await provider.getBalance(address);
          return {
            chainId,
            chainName: resolveChainName(chainId),
            balance: parseFloat(ethers.formatEther(bal)).toFixed(4)
          };
        }

        if (!config) return { chainId, chainName: resolveChainName(chainId), balance: "0" };

        const contract = new ethers.Contract(
          config.address,
          ["function balanceOf(address owner) view returns (uint256)"],
          provider
        );
        
        const bal = await contract.balanceOf(address);
        return {
          chainId,
          chainName: resolveChainName(chainId),
          balance: ethers.formatUnits(bal, config.decimals)
        };
      } catch (e) {
        return { chainId, chainName: resolveChainName(chainId), balance: "0" };
      }
    })
  );

  const total = balances.reduce((acc, curr) => acc + parseFloat(curr.balance), 0);

  return {
    token,
    totalBalance: total.toString(),
    chains: balances.filter(b => parseFloat(b.balance) > 0)
  };
};
