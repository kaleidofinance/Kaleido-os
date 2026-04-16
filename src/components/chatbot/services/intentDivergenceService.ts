/**
 * Intent Divergence Service
 * 
 * Audits the semantic consistency between a User Prompt and an Agent Action.
 * Protects against "Strategy Drift" or "Model Hallucinations."
 */

export interface IntentAudit {
    divergent: boolean;
    reason?: string;
    divergenceScore: number; // 0 to 100
}

/**
 * Compares the user's initial prompt with the generated macro action.
 */
export const auditIntentDivergence = (
    userPrompt: string,
    proposedAction: string,
    proposedAsset: string
): IntentAudit => {
    
    const promptLower = userPrompt.toLowerCase();
    const assetLower = proposedAsset.toLowerCase();
    const actionLower = proposedAction.toLowerCase();

    // Mapping keywords to safety logic
    const yields = ['yield', 'apy', 'earn', 'farming', 'deposit'];
    const stablecoins = ['usdc', 'usdt', 'dai', 'frax'];
    
    // 1. STABLECOIN ESCAPE CHECK
    // If the user asked for yield on a stablecoin, but the action moves into a volatile asset
    const promptMentionsStables = stablecoins.some(s => promptLower.includes(s));
    const actionIsVolatile = !stablecoins.some(s => assetLower.includes(s));

    if (promptMentionsStables && actionIsVolatile) {
        return {
            divergent: true,
            reason: `Strategy Drift: You requested steady yield on stables, but the agent proposed a volatile asset (${proposedAsset}).`,
            divergenceScore: 85
        };
    }

    // 2. YIELD-GUARD
    const promptRequestsYield = yields.some(y => promptLower.includes(y));
    const actionIsYielding = yields.some(y => actionLower.includes(y)) || actionLower === 'bridge';

    if (promptRequestsYield && !actionIsYielding) {
         return {
            divergent: true,
            reason: `Intent Mismatch: Request for yield was mapped to a non-yielding swap.`,
            divergenceScore: 40
        };
    }

    // 3. LOGIC-ANOMALY FILTERS (SCONE PATTERN #1)
    const isCalculatorSwap = promptLower.includes('calculate') || promptLower.includes('check');
    const stateModifyingMethods = ['transfer', 'approve', 'mint', 'withdraw', 'claim'];
    
    if (isCalculatorSwap && stateModifyingMethods.some(m => actionLower.includes(m))) {
        return {
            divergent: true,
            reason: `LOGIC ANOMALY: Interaction attempts to modify state during a supposed 'calculation' (SCONE-bench Pattern #1).`,
            divergenceScore: 95
        };
    }

    // 4. NULL-BENEFICIARY SENTINEL (SCONE PATTERN #2)
    if (actionLower.includes('0x0000000000000000000000000000000000000000')) {
        return {
            divergent: true,
            reason: `SECURITY ALERT: Execution involves a Null-Address beneficiary. Potential Hijack Trap (SCONE-bench Pattern #2).`,
            divergenceScore: 100
        };
    }

    return {
        divergent: false,
        divergenceScore: 0
    };
};
