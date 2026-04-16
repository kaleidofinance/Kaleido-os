import { AgentSkill } from "./abstractSkills";
import { findYieldGap } from "@/constants/utils/yieldOracle";

/**
 * Kaleido Macro Skills
 * Higher-level agentic strategies that combine primitive skills into complex intent.
 */

export const macroSkillSet: AgentSkill[] = [
    {
        id: "macro_omni_rebalance",
        description: "Scout asset balances across all enabled chains (Base, Abstract, Hyperliquid) and propose a rebalancing move to Abstract if liquidity is needed.",
        parameters: { token: "string" },
        execute: async ({ token = "USDC" }) => {
            return {
                type: 'macro',
                action: 'rebalance',
                token,
                steps: [
                    { type: 'scout', message: 'Scanning all chains for ' + token },
                    { type: 'bridge', message: 'Bridge identified liquidity to Abstract' },
                    { type: 'deposit', message: 'Deposit into Kaleido protocol' }
                ],
                status: 'proposed'
            };
        }
    },
    {
        id: "macro_yield_sentinel",
        description: "Analyze lending rates across Abstract and propose moving collateral to the highest yielding vault.",
        parameters: { amount: "string", token: "string" },
        execute: async ({ amount, token }) => {
            return {
                type: 'macro',
                action: 'yield_optimization',
                token,
                amount,
                target: 'Kaleido High-Yield Vault',
                status: 'proposed'
            };
        }
    }
];
