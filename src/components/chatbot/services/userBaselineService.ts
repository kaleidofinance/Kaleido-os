/**
 * User Baseline Service
 * 
 * Tracks historical "Safe" behavior to detect Cognitive Divergence.
 * Persists to localStorage to maintain a record of the user's risk profile.
 */

export interface UserBaseline {
    maxTxValue: number;      // Highest single transaction value (in USD)
    frequentAssets: string[]; // Whitelist of assets the user interacts with
    avgGasUsed: number;      // Average gas limit for successful txs
    lastActivity: number;    // Timestamp of last manual interaction
}

const BASELINE_KEY = 'luca_user_baseline';

const DEFAULT_BASELINE: UserBaseline = {
    maxTxValue: 5000, // Default conservative limit
    frequentAssets: ['USDC', 'WETH', 'USDT', 'WBTC'],
    avgGasUsed: 250000,
    lastActivity: Date.now()
};

/**
 * Retrieves the current behavioral baseline
 */
export const getBaseline = (): UserBaseline => {
    const stored = localStorage.getItem(BASELINE_KEY);
    if (!stored) return DEFAULT_BASELINE;
    return JSON.parse(stored);
};

/**
 * Updates the baseline with new transaction data
 * Call this after every SUCCESSFUL user-signed transaction.
 */
export const updateBaseline = (valUsd: number, asset: string) => {
    const current = getBaseline();
    
    // Smoothly grow the max tx value limit if the user is scaling up
    const newMax = valUsd > current.maxTxValue ? valUsd * 1.2 : current.maxTxValue;
    
    const newAssets = Array.from(new Set([...current.frequentAssets, asset]));

    const updated: UserBaseline = {
        ...current,
        maxTxValue: newMax,
        frequentAssets: newAssets,
        lastActivity: Date.now()
    };

    localStorage.setItem(BASELINE_KEY, JSON.stringify(updated));
    console.log(`[BASELINE] Profile updated. New Max Limit: $${newMax.toFixed(2)}`);
};

/**
 * Validates a proposed action against the baseline
 * Returns a score from 0 (Normal) to 100 (Suspicious Anomaly)
 */
export const validateAgainstBaseline = (proposedUsd: number, proposedAsset: string): number => {
    const baseline = getBaseline();
    let score = 0;

    // 1. Value Anomaly: Is the tx 5x higher than personal record?
    if (proposedUsd > baseline.maxTxValue * 5) {
        score += 60;
    } else if (proposedUsd > baseline.maxTxValue) {
        score += 20;
    }

    // 2. Asset Anomaly: Is this an unvetted 'Shitcoin' or newly deployed contract?
    if (!baseline.frequentAssets.includes(proposedAsset)) {
        score += 40;
    }

    return Math.min(score, 100);
};
