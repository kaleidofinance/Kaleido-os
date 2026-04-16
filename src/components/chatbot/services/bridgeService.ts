/**
 * Bridge Service for Kaleido Agentic OS
 * Integrates Li.Fi and Relay for cross-chain liquidity discovery
 */

const LIFI_API = 'https://li.quest/v1';
const RELAY_API = 'https://api.relay.link';

// Mapping human names to Chain IDs for Omni-Chain support
const CHAIN_MAP: Record<string, number> = {
    'abstract': 11124, 
    'mainnet': 1,
    'ethereum': 1,
    'optimism': 10,
    'bsc': 56,
    'binance': 56,
    'gnosis': 100,
    'polygon': 137,
    'zkevm': 1101,
    'fantom': 250,
    'zkSync': 324,
    'base': 8453,
    'arbitrum': 42161,
    'avalanche': 43114,
    'linea': 59144,
    'scroll': 534352,
    'blast': 81457,
    'mode': 34443,
    'zora': 7777777,
    'mantle': 5000,
    'hyperliquid': 999
};

export interface BridgeQuote {
    provider: 'LIFI' | 'RELAY';
    fromChain: string;
    toChain: string;
    fromToken: string;
    toToken: string;
    amount: string;
    estimatedFee: string;
    estimatedTime: string;
    transactionRequest: any; // The data needed to sign the tx
}

/**
 * Fetches the best quote from Li.Fi or Relay
 */
export const getGatewayQuote = async (
    fromChain: string, 
    toChain: string, 
    amount: string, 
    fromToken: string = 'USDC', 
    toToken: string = 'USDC',
    userAddress: string = '0x0000000000000000000000000000000000000000'
): Promise<BridgeQuote | null> => {
    
    const fromId = CHAIN_MAP[fromChain.toLowerCase()] || 8453; // Default to Base
    const toId = CHAIN_MAP[toChain.toLowerCase()] || 11124; // Default to Abstract

    try {
        // 1. Try Relay first (optimized for Abstract)
        const relayResponse = await fetch(`${RELAY_API}/quote`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user: userAddress,
                originChainId: fromId,
                destinationChainId: toId,
                originCurrency: fromToken,
                destinationCurrency: toToken,
                amount: (parseFloat(amount) * 1e6).toString(),
                tradeType: 'EXACT_INPUT'
            })
        });

        if (relayResponse.ok) {
            const data = await relayResponse.json();
            return {
                provider: 'RELAY',
                fromChain,
                toChain,
                fromToken,
                toToken,
                amount,
                estimatedFee: '0.00',
                estimatedTime: 'Sub-3s',
                transactionRequest: data.steps?.[0]?.items?.[0]?.data
            };
        }

        // 2. Fallback to Li.Fi (The industry aggregator)
        const lifiResponse = await fetch(`${LIFI_API}/quote?fromChain=${fromId}&toChain=${toId}&fromToken=${fromToken}&toToken=${toToken}&fromAmount=${(parseFloat(amount) * 1e6)}&fromAddress=${userAddress}`);
        
        if (lifiResponse.ok) {
            const data = await lifiResponse.json();
            return {
                provider: 'LIFI',
                fromChain,
                toChain,
                fromToken,
                toToken,
                amount,
                estimatedFee: data.estimate.feeCosts?.[0]?.amountUSD || '1.50',
                estimatedTime: `${Math.round(data.estimate.executionDuration / 60)} mins`,
                transactionRequest: data.transactionRequest
            };
        }

        return null;
    } catch (error) {
        console.error('Bridge Service Error:', error);
        return null;
    }
};
