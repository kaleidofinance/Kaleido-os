import { ethers } from "ethers";
import { readOnlyProvider } from "@/config/provider";
import { USDC_ADDRESS, USDR, kfUSD_ADDRESS, USDT_ADDRESS } from "./addresses";

// High-Performance Omni-Chain Provider Hub
export const getOmniProvider = (chainId: number) => {
  switch (chainId) {
    case 11124: // Abstract Testnet
    case 2741:
      return readOnlyProvider;
    case 8453: // Base
      return new ethers.JsonRpcProvider("https://mainnet.base.org", { chainId: 8453, name: 'base' }, { staticNetwork: true });
    case 56: // BSC
      return new ethers.JsonRpcProvider("https://rpc.ankr.com/bsc", { chainId: 56, name: 'bsc' }, { staticNetwork: true });
    case 137: // Polygon
      return new ethers.JsonRpcProvider("https://polygon-rpc.com", { chainId: 137, name: 'polygon' }, { staticNetwork: true });
    case 42161: // Arbitrum
      return new ethers.JsonRpcProvider("https://arb1.arbitrum.io/rpc", { chainId: 42161, name: 'arbitrum' }, { staticNetwork: true });
    case 1: // Ethereum Mainnet
      return new ethers.JsonRpcProvider("https://cloudflare-eth.com", { chainId: 1, name: 'mainnet' }, { staticNetwork: true });
    case 999: // Hyperliquid
      return new ethers.JsonRpcProvider("https://rpc.hyperliquid.xyz/evm", { chainId: 999, name: 'hyperliquid' }, { staticNetwork: true });
    default:
      return readOnlyProvider;
  }
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

const CHAIN_METADATA: Record<number, string> = {
  2741: "Abstract",
  8453: "Base",
  56: "BSC",
  137: "Polygon",
  999: "Hyperliquid",
  1: "Mainnet",
  42161: "Arbitrum"
};

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
            chainName: CHAIN_METADATA[chainId] || "Unknown",
            balance: parseFloat(ethers.formatEther(bal)).toFixed(4)
          };
        }

        if (!config) return { chainId, chainName: CHAIN_METADATA[chainId] || "Unknown", balance: "0" };

        const contract = new ethers.Contract(
          config.address,
          ["function balanceOf(address owner) view returns (uint256)"],
          provider
        );
        
        const bal = await contract.balanceOf(address);
        return {
          chainId,
          chainName: CHAIN_METADATA[chainId] || "Unknown",
          balance: ethers.formatUnits(bal, config.decimals)
        };
      } catch (e) {
        return { chainId, chainName: CHAIN_METADATA[chainId] || "Unknown", balance: "0" };
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
