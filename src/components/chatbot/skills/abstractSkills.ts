import { ethers } from "ethers";
import { fetchOmniAssetBalance } from "@/constants/utils/omniChainBalances";

/**
 * Abstract Agent Skills (MCP Standard)
 * These skills follow the format released by Abstract Foundation for Agentic execution.
 */

export interface AgentSkill {
    id: string;
    description: string;
    parameters: any;
    execute: (params: any) => Promise<any>;
}

export const abstractSkillSet: AgentSkill[] = [
    {
        id: "abs_get_balance",
        description: "Fetch the native or token balance for a specific wallet on the Abstract network.",
        parameters: { address: "string", token: "string (optional)" },
        execute: async ({ address, token = "ETH" }) => {
            const res = await fetchOmniAssetBalance(address, token, [2741]);
            return res.totalBalance;
        }
    },
    {
        id: "abs_send_token",
        description: "Prepare an Abstract native or ERC20 token transfer transaction.",
        parameters: { to: "string", amount: "string", token: "string" },
        execute: async ({ to, amount, token }) => {
            return {
                type: 'send',
                to,
                amount,
                token,
                chain: 'Abstract',
                status: 'proposed'
            };
        }
    },
    {
        id: "abs_contract_call",
        description: "Execute a generic smart contract call on Abstract. Requires contract address and call data.",
        parameters: { contract: "string", data: "string", value: "string (optional)" },
        execute: async (params) => {
            return { ...params, chain: 'Abstract', status: 'proposed' };
        }
    }
];
