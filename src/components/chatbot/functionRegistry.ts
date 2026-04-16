import { ethers } from "ethers";
import { 
    KALEIDOSWAP_V3_FACTORY, 
    KLD_ADDRESS,
    ADDRESS_1,
    USDC_ADDRESS 
} from "@/constants/utils/addresses";
import { readOnlyProvider } from "@/config/provider";
import { getKaleidoContract } from "@/config/contracts";
import { getGatewayQuote } from './services/bridgeService';
import { calculateSimilarity, normalizeInput } from './services/nlpService';
import { getProviderByChainId } from '@/constants/utils/getUsdcBalance';

const ERC20_ABI = [
  "function balanceOf(address owner) external view returns (uint256)",
  "function symbol() external view returns (string)",
  "function decimals() external view returns (uint8)"
];

import { abstractSkillSet } from "./skills/abstractSkills";
import { macroSkillSet } from "./skills/macroSkills";

// Define types for functions and triggers
export interface FunctionDefinition {
  id: string
  name: string
  description: string
  requiresWallet: boolean
  isAction?: boolean // Whether this triggers a transaction
  patterns: string[] // Keywords that might trigger this function
  execute: (params?: any) => Promise<any>
}

// Get wallet address from localStorage
export const getWalletAddress = (): string | null => {
  try {
    return localStorage.getItem("kaleidoAddress")
  } catch (error) {
    return null
  }
}

// Live Data Fetching Logic (Abstract Testnet)
const getLoanRiskScore = async (walletAddress: string): Promise<any> => {
  try {
    const contract = getKaleidoContract(readOnlyProvider);
    const healthFactorRaw = await contract.getHealthFactor(walletAddress);
    const hf = Number(ethers.formatUnits(healthFactorRaw, 18));
    
    // Scale Health Factor to 0-100 Score
    // HF <= 1.0 (Liquidation) = 0 score
    // HF >= 2.0 (Solid) = 90+ score
    const score = Math.max(0, Math.min(100, Math.floor((hf - 1.0) * 100)));
    
    let status = "Healthy";
    let riskLevel = "Low";
    
    if (hf <= 1.05) { status = "Critical"; riskLevel = "Extreme"; }
    else if (hf <= 1.2) { status = "Warning"; riskLevel = "High"; }
    else if (hf <= 1.5) { status = "Fair"; riskLevel = "Moderate"; }

    const collateralValue = await contract.getAccountCollateralValue(walletAddress);
    
    return {
      score,
      riskLevel,
      status,
      breakdown: {
        healthFactor: hf.toFixed(2),
        collateralValueUSD: `$${Number(ethers.formatUnits(collateralValue, 18)).toFixed(2)}`,
        liquidationPoint: "1.00",
      },
    }
  } catch (error) {
    return { score: 0, status: "No Active Loans", riskLevel: "N/A", breakdown: { healthFactor: "0", collateralValueUSD: "$0" } };
  }
}

const getWalletBalance = async (walletAddress: string, chainId: number = 11124): Promise<any> => {
  try {
    const provider = getProviderByChainId(chainId);
    const ethBalance = await provider.getBalance(walletAddress);
    
    // Default tokens for Abstract, update for other chains if needed
    const tokensToTrack = chainId === 11124 ? [
        { address: USDC_ADDRESS, decimals: 6, symbol: "USDC" },
        { address: KLD_ADDRESS, decimals: 18, symbol: "KALE" }
    ] : [];

    const tokenBalances = await Promise.all(tokensToTrack.map(async (t) => {
        const contract = new ethers.Contract(t.address, ERC20_ABI, provider);
        const bal = await contract.balanceOf(walletAddress);
        return {
            symbol: t.symbol,
            amount: ethers.formatUnits(bal, t.decimals),
            valueUSD: Number(ethers.formatUnits(bal, t.decimals))
        };
    }));

    const ethPrice = 2500; // Mock price
    const ethValue = Number(ethers.formatEther(ethBalance)) * ethPrice;
    const totalBalanceUSD = ethValue + tokenBalances.reduce((acc, t) => acc + t.valueUSD, 0);

    return {
      totalBalanceUSD: totalBalanceUSD.toFixed(2),
      chainId,
      tokens: [
        { symbol: "ETH", amount: ethers.formatEther(ethBalance).slice(0, 6), valueUSD: ethValue.toFixed(2) },
        ...tokenBalances
      ],
    }
  } catch (error) {
    console.error("Balance fetch error:", error);
    return { totalBalanceUSD: "0.00", tokens: [] };
  }
}

// Transaction Proposal Generators (Agent Mode)
const executeSwap = async (params: { fromToken: string, toToken: string, amount: string }): Promise<any> => {
  return {
    type: 'swap',
    fromToken: params.fromToken || 'ETH',
    toToken: params.toToken || 'USDC',
    amount: params.amount || '0',
    status: 'proposed'
  };
}

const executeLendingDeposit = async (params: { token: string, amount: string }): Promise<any> => {
    return {
        type: 'lend',
        token: params.token || 'USDC',
        amount: params.amount || '0',
        status: 'proposed'
    };
}

const executeAddLiquidity = async (params: any): Promise<any> => {
    return { type: 'addLiquidity', tokenA: params.tokenA || 'ETH', tokenB: params.tokenB || 'USDC', amountA: params.amountA || '0', amountB: params.amountB || '0', status: 'proposed' };
}

const executeRemoveLiquidity = async (params: any): Promise<any> => {
    return { type: 'removeLiquidity', tokenA: params.tokenA || 'ETH', tokenB: params.tokenB || 'USDC', lpAmount: params.amount || '100%', status: 'proposed' };
}

const executeClaimRewards = async (params: any): Promise<any> => {
    return { type: 'claimRewards', rewardType: params.rewardType || 'KLD', status: 'proposed' };
}

const executeStake = async (params: any): Promise<any> => {
    return { type: 'stake', amount: params.amount || '0', status: 'proposed' };
}

const executeUnstake = async (params: any): Promise<any> => {
    return { type: 'unstake', amount: params.amount || '0', status: 'proposed' };
}

const executeMintStablecoin = async (params: any): Promise<any> => {
    return { type: 'mintStablecoin', token: params.token || 'USDC', amount: params.amount || '0', status: 'proposed' };
}

const executeBorrow = async (params: any): Promise<any> => {
    return { type: 'borrow', amount: params.amount || '0', token: params.token || 'USDR', status: 'proposed' };
}

const executeRepay = async (params: any): Promise<any> => {
    return { type: 'repay', amount: params.amount || '0', token: params.token || 'USDR', requestId: params.requestId || 0, status: 'proposed' };
}

const executeMarketplaceAction = async (params: any): Promise<any> => {
    return { type: 'marketplace', action: params.action || 'buy', listingId: params.listingId || 0, amount: params.amount || '0', status: 'proposed' };
}

const getPoolLiquidity = async (poolId: string): Promise<any> => {
    try {
        // This would be replaced with actual blockchain API call
        // console.log(`Getting pool liquidity for ${poolId}`);

        // For now, just return mock data
        return {
          poolId,
          name: poolId === "default" ? "Main Pool" : `Pool ${poolId}`,
          totalLiquidityUSD: 2500000,
          tokens: [
            { symbol: "ETH", percentage: 40, valueUSD: 1000000 },
            { symbol: "USDC", percentage: 35, valueUSD: 875000 },
            { symbol: "DAI", percentage: 25, valueUSD: 625000 },
          ],
          apr: "5.2%",
          utilizationRate: "68%",
        }
    } catch (error) {
        // console.error('Error getting pool liquidity:', error);
        throw error
    }
}

const executeVolumeFarming = async (params: any): Promise<any> => {
    const targetVolume = parseInt(params.targetVolume || "1000");
    const swapAmount = params.amount || "100";
    const iterations = Math.ceil(targetVolume / (parseInt(swapAmount) * 2)); // Assuming back-and-forth swap
    
    return { 
        type: 'macro', 
        action: 'volume_farming',
        targetVolume,
        iterations,
        currentStep: 1,
        steps: [
            { type: 'swap', fromToken: 'USDC', toToken: 'ETH', amount: swapAmount },
            { type: 'swap', fromToken: 'ETH', toToken: 'USDC', amount: '0' } // '0' implies total balance
        ],
        status: 'proposed' 
    };
}

const bridgeAssets = async (params: any): Promise<any> => {
    const fromChain = params.fromChain || 'Base';
    const toChain = params.toChain || 'Abstract';
    const amount = params.amount || '100';
    const token = params.token || 'USDC';
    
    try {
        const quote = await getGatewayQuote(fromChain, toChain, amount, token, token);
        
        if (quote) {
            return {
                type: 'bridge',
                fromChain: quote.fromChain,
                toChain: quote.toChain,
                amount: quote.amount,
                token: quote.fromToken,
                estimatedFee: quote.estimatedFee,
                estimatedTime: quote.estimatedTime,
                status: 'proposed',
                provider: quote.provider,
                txData: quote.transactionRequest
            };
        }
        
        throw new Error("No liquidity routes found for this bridge.");
    } catch (error) {
        // Fallback to mock for development if API fails
        return {
            type: 'bridge',
            fromChain,
            toChain,
            amount,
            token,
            estimatedFee: '1.25',
            estimatedTime: '2 mins',
            status: 'proposed'
        };
    }
}

const getMarketplaceListings = async (): Promise<any> => {
    try {
        const response = await fetch('/api/listings?status=OPEN&limit=5');
        const data = await response.json();
        if (data.success) {
            return {
                listings: data.data.slice(0, 5),
                total: data.data.length
            };
        }
        throw new Error("Failed to fetch listings");
    } catch (error) {
        // console.error('Error fetching marketplace listings:', error);
        // Return mock data if API fails in this environment
        return {
            listings: [
                { listingId: 101, amount: "500", tokenAddress: "USDC", interest: 5, status: "OPEN" },
                { listingId: 102, amount: "1200", tokenAddress: "ETH", interest: 8, status: "OPEN" }
            ],
            total: 2
        };
    }
}

// The Function Registry
export const functionRegistry: FunctionDefinition[] = [
  {
    id: "getLoanRiskScore",
    name: "Check Loan Risk Score",
    description: "Check your current loan risk score and health status",
    requiresWallet: true,
    patterns: ["loan risk", "risk score", "loan health", "collateral ratio", "liquidation risk", "my risk", "my score", "how safe is my loan", "am i being liquidated", "check my health"],
    execute: async () => {
      const walletAddress = getWalletAddress()
      if (!walletAddress) throw new Error("Wallet not connected")
      return getLoanRiskScore(walletAddress)
    },
  },
  {
    id: "getWalletBalance",
    name: "Portfolio Snapshot",
    description: "View your total net worth and asset distribution across the protocol",
    requiresWallet: true,
    patterns: ["my balance", "wallet balance", "tokens", "holdings", "check balance", "portfolio", "snapshot", "how am i doing", "summary", "my assets", "whats my balance", "what is my balance", "what tokens do i have", "how much money"],
    execute: async (params) => {
      const walletAddress = getWalletAddress()
      if (!walletAddress) throw new Error("Wallet not connected")
      const CHAIN_MAP: Record<string, number> = { 
          'abstract': 11124, 
          'base': 8453, 
          'arbitrum': 42161, 
          'polygon': 137, 
          'mainnet': 1,
          'hyperliquid': 999
      };
      const chainId = CHAIN_MAP[params.fromChain?.toLowerCase()] || 11124;
      return getWalletBalance(walletAddress, chainId)
    },
  },
  {
    id: "getPoolLiquidity",
    name: "Check Pool Liquidity",
    description: "Check the current liquidity in a specific pool",
    requiresWallet: false,
    patterns: ["pool liquidity", "liquidity pool", "pool status", "pool info", "check pool", "liquidity in pool", "how much in pool"],
    execute: async (params) => {
      const poolId = params?.poolId || "default"
      return getPoolLiquidity(poolId)
    },
  },
  {
    id: "executeSwap",
    name: "Swap Tokens",
    requiresWallet: true,
    isAction: true,
    description: "Prepare an optimal token swap",
    patterns: ["swap", "exchange", "convert", "buy", "sell", "trade", "change tokens", "get some usdc", "get some eth"],
    execute: async (params) => executeSwap(params),
  },
  {
    id: "executeLendingDeposit",
    name: "Lend Tokens",
    requiresWallet: true,
    isAction: true,
    description: "Deposit tokens into the lending pool",
    patterns: ["lend", "deposit", "stake", "supply liquidity", "invest my usdc", "put money to work", "earn yield"],
    execute: async (params) => executeLendingDeposit(params),
  },
  {
    id: "executeAddLiquidity",
    name: "Add Liquidity",
    requiresWallet: true,
    isAction: true,
    description: "Provide liquidity to a pair",
    patterns: ["add liquidity", "provide liquidity", "create pool", "join pool"],
    execute: async (params) => executeAddLiquidity(params),
  },
  {
    id: "executeRemoveLiquidity",
    name: "Remove Liquidity",
    requiresWallet: true,
    isAction: true,
    description: "Remove liquidity from a pair",
    patterns: ["remove liquidity", "withdraw from pool", "burn lp", "unstake pool"],
    execute: async (params) => executeRemoveLiquidity(params),
  },
  {
    id: "executeClaimRewards",
    name: "Claim Rewards",
    requiresWallet: true,
    isAction: true,
    description: "Harvest your earned rewards and fees",
    patterns: ["claim", "harvest", "collect rewards", "get rewards", "get fees"],
    execute: async (params) => executeClaimRewards(params),
  },
  {
    id: "executeStake",
    name: "Stake Tokens",
    requiresWallet: true,
    isAction: true,
    description: "Stake KLD to earn rewards",
    patterns: ["stake", "lock tokens", "stake kld"],
    execute: async (params) => executeStake(params),
  },
  {
    id: "executeUnstake",
    name: "Unstake Tokens",
    requiresWallet: true,
    isAction: true,
    description: "Unstake KLD tokens",
    patterns: ["unstake", "unlock short", "withdraw stake"],
    execute: async (params) => executeUnstake(params),
  },
  {
    id: "executeMintStablecoin",
    name: "Mint kfUSD",
    requiresWallet: true,
    isAction: true,
    description: "Mint kfUSD using collateral",
    patterns: ["mint kfusd", "create stablecoin", "mint stablecoin", "print kfusd"],
    execute: async (params) => executeMintStablecoin(params),
  },
  {
    id: "executeBorrow",
    name: "Borrow Assets",
    requiresWallet: true,
    isAction: true,
    description: "Borrow assets from the protocol",
    patterns: ["borrow", "get loan", "draw debt", "take credit", "i need money", "borrow usdc", "need a loan"],
    execute: async (params) => executeBorrow(params),
  },
  {
    id: "executeRepay",
    name: "Repay Loan",
    requiresWallet: true,
    isAction: true,
    description: "Repay an outstanding loan",
    patterns: ["repay", "pay back", "settle debt", "close loan", "repay my borrow", "give back money"],
    execute: async (params) => executeRepay(params),
  },
  {
    id: "executeMarketplaceAction",
    name: "Marketplace Activity",
    requiresWallet: true,
    isAction: true,
    description: "Buy, sell, or list on the marketplace",
    patterns: ["buy listing", "accept ad", "create listing", "marketplace", "buy loan"],
    execute: async (params) => executeMarketplaceAction(params),
  },
  {
    id: "getMarketplaceListings",
    name: "Marketplace Discovery",
    requiresWallet: false,
    description: "Scan the marketplace for open loan opportunities and listings",
    patterns: ["what is on the market", "show marketplace", "marketplace listings", "find loans", "scout market", "active listings"],
    execute: async () => getMarketplaceListings(),
  },
  {
    id: "executeVolumeFarming",
    name: "Volume Farming Macro",
    requiresWallet: true,
    isAction: true,
    description: "Generate on-chain trading volume via automated circular swaps",
    patterns: ["generate volume", "farm volume", "do multiple swaps", "trade volume", "circular swap"],
    execute: async (params) => executeVolumeFarming(params),
  },
  {
    id: "bridgeAssets",
    name: "Gateway Bridge",
    requiresWallet: true,
    isAction: true,
    description: "Move assets from another chain (Base, Arbitrum, Mainnet) to Abstract via Relay/Li.Fi",
    patterns: ["bridge", "move funds from", "send from chain", "cross chain", "move asset"],
    execute: async (params) => bridgeAssets(params),
  },
  {
    id: "startTour",
    name: "Autonomous Tour",
    requiresWallet: false,
    isAction: true,
    description: "Initialize an autonomous guided tour of the platform features",
    patterns: ["start tour", "show me around", "explain the app", "how do i use this", "guide me", "tour", "walkthrough"],
    execute: async (params) => ({
      type: 'tour',
      tourType: params.tourType || 'dashboard',
      status: 'proposed'
    }),
  },
  {
    id: "identifyAgent",
    name: "Agent Identity",
    requiresWallet: false,
    isAction: false,
    description: "Get information about Luca's identity and mission",
    patterns: ["who are you", "what is your name", "tell me about yourself", "who is luca"],
    execute: async () => {
      return "I am Luca, your AI-powered DeFi Co-Pilot and the central intelligence of the Kaleido Agentic OS. I live on the Abstract Chain, and my mission is to help you automate, monitor, and scale your wealth across the multichain ecosystem.";
    },
  },
  {
    id: "checkCapabilities",
    name: "Capabilities Check",
    requiresWallet: false,
    isAction: false,
    description: "List the core DeFi and AI features Luca can perform locally",
    patterns: ["what can you do", "help", "commands", "features", "how do you work"],
    execute: async () => {
      return "I can manage your entire DeFi lifecycle locally. My core modules include:\n\n" +
             "• **Gateway Agent:** Omni-chain bridging from 15+ networks.\n" +
             "• **Risk Sentinel:** Real-time health factor monitoring.\n" +
             "• **Recursive Autonomy:** Circular swap and volume farming macros.\n" +
             "• **Portfolio Oracle:** Instant snapshots across Base, Arbitrum, Mainnet, and Hyperliquid.\n\n" +
             "Just ask me to 'Swap', 'Bridge', or 'Check my risk' to start.";
    },
  },
  {
    id: "explainProtocol",
    name: "Platform Vision",
    requiresWallet: false,
    isAction: false,
    description: "Understand the vision and benefits of the Kaleido DeFi OS",
    patterns: ["what is kaleido", "tell me about kaleido", "kaleido vision", "why use kaleido"],
    execute: async () => {
      return "Kaleido is the first **Agentic DeFi OS** built natively on the Abstract Chain. We combine peer-to-peer liquidity with autonomous AI agents to remove the friction from decentralized finance. Here, you don't just trade; you command an ecosystem.";
    },
  },
  // --- NATIVE ABSTRACT AGENT SKILLS ---
  ...abstractSkillSet.map(skill => ({
    id: skill.id,
    name: skill.id.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
    description: skill.description,
    requiresWallet: true,
    isAction: skill.id !== 'abs_get_balance',
    patterns: [
      skill.id, 
      skill.id.replace('abs_', 'abstract '),
      skill.id.replace('abs_get_', 'check abstract '),
      skill.id.replace('abs_send_', 'send on abstract '),
    ],
    execute: skill.execute
  })),
  // --- KALEIDO MACRO STRATEGY SKILLS ---
  ...macroSkillSet.map(skill => ({
    id: skill.id,
    name: skill.id.split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' '),
    description: skill.description,
    requiresWallet: true,
    isAction: true,
    patterns: [
      skill.id, 
      skill.id.replace('macro_', 'run '),
      skill.id.replace('macro_', 'automate '),
      skill.id.replace('macro_', 'optimize '),
      'rebalance my wallet',
      'sentinel mode',
    ],
    execute: skill.execute
  }))
]

export enum ConfidenceLevel {
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
  NONE = "none",
}

export interface FunctionDetectionResult {
  confidence: ConfidenceLevel
  exactMatches: FunctionDefinition[]
  partialMatches: FunctionDefinition[]
  bestFunction?: FunctionDefinition
  isGeneralQuestion: boolean
  extractedParams?: any
}

// Helper to extract amounts/tokens
const extractParameters = (message: string): any => {
    const amountMatch = message.match(/(\d+\.?\d*)/g);
    const tokenMatches = message.match(/(USDC|USDT|ETH|KALE|KLD|WBTC|DAI)/gi);
    const tokens = tokenMatches ? tokenMatches.map(t => t.toUpperCase()) : [];
    
    let rewardType = 'KLD';
    if (message.toLowerCase().includes('yield')) rewardType = 'YIELD';
    else if (message.toLowerCase().includes('fee')) rewardType = 'FEES';

    const listingIdMatch = message.match(/(?:listing|id|#)\s*(\d+)/i);

    const targetMatch = message.match(/(?:\$|volume|target)\s*(\d+(?:\.\d+)?)/i);
    const fromChainMatch = message.match(/(?:from)\s+([a-zA-Z]+)/i);
    const toChainMatch = message.match(/(?:to)\s+([a-zA-Z]+)/i);

    return {
        amount: amountMatch ? amountMatch[0] : undefined,
        amounts: amountMatch || [],
        tokens: tokens,
        rewardType,
        listingId: listingIdMatch ? listingIdMatch[1] : undefined,
        targetVolume: targetMatch ? targetMatch[1] : undefined,
        fromChain: fromChainMatch ? fromChainMatch[1] : undefined,
        toChain: toChainMatch ? toChainMatch[1] : undefined
    };
}

export const detectFunctions = (message: string): FunctionDetectionResult => {
  const messageLower = message.toLowerCase()
  const params = extractParameters(message)
  const exact: FunctionDefinition[] = []
  const partial: FunctionDefinition[] = []

  // --- FULLY RESTORED: All General Conversational Patterns ---
  const generalQuestionPatterns = [
    // Kaleido-specific queries
    "what is kaleido",
    "tell me about kaleido",
    "how does kaleido work",
    "kaleido features",
    "kaleido benefits",
    "kaleido protocol",
    "kaleido tokenomics",

    // User & Bot identity
    "who are you",
    "what can you do",
    "what is your name",
    "tell me about yourself",
    "what is luca",

    // Knowledge & explanation markers
    "help me understand",
    "explain",
    "tell me more",
    "information about",
    "details on",
    "how to",
    "why is",
    "what happens",
    "can you",
    "difference between",
    "when should",
    "how would",
    "how does",
    "how do",

    // Financial concept queries
    "what is pool",
    "what is loan",
    "what is risk",
    "what is wallet",
    "what is a pool",
    "what is a loan",
    "what is liquidity",
    "what is liquidity pool",
    "what does pool",
    "what does loan",
    "liquidity pool",
    "liquidity pools",
    "what are pools",
    "what are liquidity",
    "how do pools",
    "types of pools",
    "pool types",
    "pools in kaleido",

    // Rationale & motivation queries
    "why would i",
    "why would someone",
    "why do people",
    "why use",
    "benefits of",
    "advantages of",
    "risks of",
    "downside of",

    // Definition queries
    "definition of",
    "meaning of",
    "define",
    "what are",
    "what is",
    "describe",
    "terminology",
    "glossary",
    "terms",
  ]
  
  const greetingPatterns = [
    "hi",
    "hello",
    "hey",
    "morning",
    "afternoon",
    "evening",
    "greetings",
    "howdy",
    "what's up",
    "sup",
    "good day",
    "good morning",
    "good afternoon",
    "good evening",
    "hola",
    "bonjour",
    "ciao",
    "namaste",
  ]

  // Check if message is just a greeting
  const isJustGreeting = greetingPatterns.some((pattern) => {
    return (
      messageLower === pattern ||
      messageLower === pattern + "!" ||
      messageLower === pattern + "." ||
      messageLower === pattern + "?"
    )
  })
  
  if (isJustGreeting) {
    return {
      confidence: ConfidenceLevel.NONE,
      exactMatches: [],
      partialMatches: [],
      isGeneralQuestion: true,
    }
  }

  // --- FULLY RESTORED: Personalized Detection ---
  const personalizedPrefixPatterns = [
    "what is my",
    "what's my",
    "what are my",
    "what about my",
    "whats my",
    "what was my",
    "show me my",
    "show my",
    "display my",
    "can you show me my",
    "can you show my",
    "get my",
    "tell me my",
    "check my",
    "can you get my",
    "can you tell me my",
    "can you check my",
    "could you get my",
    "how is my",
    "how's my",
    "how are my",
    "where is my",
    "where's my",
    "where are my",
    "i want to see my",
    "i need to know my",
    "i want my",
    "i need my",
    "my current",
    "my latest",
    "my personal",
  ]

  const isPersonalizedQuery = personalizedPrefixPatterns.some(
    (prefix) => messageLower.startsWith(prefix) || messageLower.includes(" " + prefix),
  )

  const myKeywordPatterns = [
    "my risk",
    "my score",
    "my balance",
    "my wallet",
    "my tokens",
    "my holdings",
    "my funds",
    "my liquidity",
    "my portfolio",
    "my assets",
    "my account",
  ]

  const hasStandaloneMyPattern = myKeywordPatterns.some(
    (pattern) => messageLower === pattern || messageLower === pattern + "?" || messageLower.startsWith(pattern + " "),
  )

  const isPersonalQuery = isPersonalizedQuery || hasStandaloneMyPattern

  // Helper check for function keywords in personal context
  let hasMatchingFunctionKeyword = false
  if (isPersonalQuery) {
    hasMatchingFunctionKeyword = functionRegistry.some((func) => {
      const exactPatternMatch = func.patterns.some((pattern) => messageLower.includes(pattern.toLowerCase()))
      if (!exactPatternMatch && (messageLower.includes("risk") || messageLower.includes("score")) && func.id === "getLoanRiskScore") return true
      if (!exactPatternMatch && (messageLower.includes("balance") || messageLower.includes("wallet")) && func.id === "getWalletBalance") return true
      if (!exactPatternMatch && (messageLower.includes("pool") || messageLower.includes("liquidity")) && func.id === "getPoolLiquidity") return true
      return exactPatternMatch
    })
  }

  // Frontend check for general questions
  const isLikelyGeneralQuestion =
    generalQuestionPatterns.some((pattern) => messageLower.includes(pattern)) ||
    (greetingPatterns.some((greeting) => messageLower.startsWith(greeting + " ")) && messageLower.split(" ").length < 5) ||
    ((!isPersonalQuery || !hasMatchingFunctionKeyword) &&
      (messageLower.startsWith("what is") ||
        messageLower.startsWith("what are") ||
        messageLower.startsWith("how does") ||
        messageLower.startsWith("explain") ||
        messageLower.startsWith("tell me about")) &&
      functionRegistry.some((func) =>
        func.patterns.some(
          (pattern) =>
            messageLower.includes(pattern) &&
            !messageLower.includes("check") &&
            !messageLower.includes("show") &&
            !messageLower.includes("get") &&
            !messageLower.includes("my"),
        ),
      )) ||
    messageLower.startsWith("explain") ||
    messageLower.includes("how does") ||
    messageLower.includes("why do") ||
    messageLower.includes("what does") ||
    messageLower.includes("definition of") ||
    messageLower.includes("difference between")

  if (isLikelyGeneralQuestion) {
    return {
      confidence: ConfidenceLevel.NONE,
      exactMatches: [],
      partialMatches: [],
      isGeneralQuestion: true,
    }
  }

  // --- LEVEL 1: RULE-BASED REFLEX (FAST PATH) ---
  const normalizedMessage = normalizeInput(message);
  
  functionRegistry.forEach((func) => {
    let hasExactPatternMatch = false;

    for (const pattern of func.patterns) {
      if (messageLower.includes(pattern)) {
        hasExactPatternMatch = true;
        break;
      }
    }

    if (hasExactPatternMatch) {
      exact.push(func);
    }
  });

  // --- LEVEL 2: SEMANTIC SENTIENCE (SIMILARITY PATH) ---
  if (exact.length === 0) {
    let bestLocalScore = 0;
    let bestLocalMatch: FunctionDefinition | null = null;

    for (const func of functionRegistry) {
      for (const pattern of func.patterns) {
        const score = calculateSimilarity(normalizedMessage, pattern.toLowerCase());
        if (score > bestLocalScore) {
          bestLocalScore = score;
          bestLocalMatch = func;
        }
      }
    }

    // High hurdle for semantic autonomy (90% precision goal)
    if (bestLocalScore > 0.75) {
      console.log(`[Sentient] Autonomous match: ${bestLocalMatch?.id} (${Math.round(bestLocalScore * 100)}%)`);
      exact.push(bestLocalMatch!);
    } else if (bestLocalScore > 0.45) {
      console.log(`[Sentient] Suggestions mode: ${bestLocalMatch?.id} (${Math.round(bestLocalScore * 100)}%)`);
      partial.push(bestLocalMatch!);
    }
  }

  let confidence: ConfidenceLevel = ConfidenceLevel.NONE
  let bestFunction: FunctionDefinition | undefined
  const wordCount = messageLower.split(/\s+/).length
  const isComplexQuery = message.includes("?") || wordCount > 10

  if (exact.length === 1 && !isComplexQuery) {
    confidence = ConfidenceLevel.HIGH
    bestFunction = exact[0]
  } else if (exact.length > 0) {
    confidence = ConfidenceLevel.MEDIUM
    bestFunction = exact[0]
  } else if (partial.length > 0) {
    confidence = ConfidenceLevel.MEDIUM // Show suggestions for partial semantic matches
  }

  // Override: If it's a personalized query and we found a match, boost it to HIGH
  if (isPersonalQuery && (exact.length > 0 || partial.length > 0)) {
    confidence = ConfidenceLevel.HIGH
    bestFunction = exact.length > 0 ? exact[0] : partial[0]
  }

  let extractedParams: any = {
      amount: params.amount,
      fromToken: params.tokens[0],
      toToken: params.tokens[1] || 'USDC',
      token: params.tokens[0]
  };

  if (bestFunction?.id === 'executeSwap') {
      extractedParams = { amount: params.amount, fromToken: params.tokens[0], toToken: params.tokens[1] || 'USDC' };
  } else if (bestFunction?.id === 'executeLendingDeposit') {
      extractedParams = { amount: params.amount, token: params.tokens[0] || 'USDC' };
  } else if (bestFunction?.id === 'executeAddLiquidity') {
      extractedParams = { amountA: params.amounts[0], amountB: params.amounts[1], tokenA: params.tokens[0], tokenB: params.tokens[1] || 'USDC' };
  } else if (bestFunction?.id === 'executeRemoveLiquidity') {
      extractedParams = { amount: params.amount, tokenA: params.tokens[0], tokenB: params.tokens[1] || 'USDC' };
  } else if (bestFunction?.id === 'executeClaimRewards') {
      extractedParams = { rewardType: params.rewardType };
  } else if (bestFunction?.id === 'executeStake' || bestFunction?.id === 'executeUnstake') {
      extractedParams = { amount: params.amount };
  } else if (bestFunction?.id === 'executeMintStablecoin') {
      extractedParams = { amount: params.amount, token: params.tokens[0] || 'USDC' };
  } else if (bestFunction?.id === 'executeBorrow') {
      extractedParams = { amount: params.amount, token: params.tokens[0] || 'USDR' };
  } else if (bestFunction?.id === 'executeRepay') {
      extractedParams = { amount: params.amount, token: params.tokens[0] || 'USDR', requestId: params.listingId };
  } else if (bestFunction?.id === 'executeMarketplaceAction') {
      extractedParams = { 
          action: messageLower.includes('list') || messageLower.includes('create') ? 'list' : 'buy',
          amount: params.amount, 
          listingId: params.listingId 
      };
  } else if (bestFunction?.id === 'executeVolumeFarming') {
      extractedParams = { targetVolume: params.targetVolume, amount: params.amount || '100' };
  } else if (bestFunction?.id === 'bridgeAssets') {
      extractedParams = { 
          amount: params.amount, 
          fromChain: params.fromChain || 'Base',
          toChain: params.toChain || 'Abstract',
          token: params.tokens?.[0] || 'USDC'
      };
  }

  return {
    confidence,
    exactMatches: exact,
    partialMatches: partial,
    bestFunction,
    isGeneralQuestion: false,
    extractedParams
  }
}
