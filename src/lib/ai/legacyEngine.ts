export interface LegacyGuardContext { chainId?: number }

export interface LegacyGuardResult {
  blocked: boolean;
  response?: string;
  context?: Record<string, unknown>;
}

const MULTICHAIN_WHITELIST: Record<string, string[]> = {
  "8453": ["Base", "Aave", "Aerodrome", "Uniswap"],
  "84532": ["Base", "Aave", "Aerodrome", "Uniswap"],
  "137": ["Polygon", "Aave", "Quickswap"],
  "56": ["BSC", "Pancakeswap", "Venus", "Stargate"],
  "97": ["BSC", "Pancakeswap", "Venus", "Stargate"],
  "1": ["Ethereum", "Aave", "Uniswap", "Lido"],
  "11155111": ["Ethereum", "Aave", "Uniswap", "Lido"],
  "4663": ["Robinhood"],
  "46630": ["Robinhood"],
  "5042002": ["Arc", "USDC"],
};

/** Shared policy for the legacy provider path and the typed agent path. */
export function guardLegacyPlan(data: any, { chainId }: LegacyGuardContext): LegacyGuardResult {
  const result = data?.context?.functionData?.result;
  if (!result) return { blocked: false };
  const amount = parseFloat(result.amount || "0");
  if (amount > 1000) {
    return {
      blocked: true,
      response: "I've drafted a high-value strategy, but the safety checks blocked it for your protection (Exceeds $1,000 limit). Please break your request into smaller chunks.",
      context: { status: "blocked_by_safety_check", reason: "threshold_exceeded" },
    };
  }
  const allowedNames = chainId === undefined ? [] : MULTICHAIN_WHITELIST[String(chainId)] || [];
  const target = String(result.target ?? "");
  const protocol = String(result.protocol ?? "");
  const isWhitelisted = allowedNames.some((name) => target.toLowerCase().includes(name.toLowerCase()) || protocol.toLowerCase().includes(name.toLowerCase()));
  if (target && !isWhitelisted) {
    return {
      blocked: true,
      response: `This transaction was blocked by safety checks. The protocol "${target}" is not currently whitelisted for high-security operations on Chain ID ${chainId ?? "unknown"}.`,
      context: { status: "blocked_by_safety_check", reason: "unvetted_omnichain_target" },
    };
  }
  return { blocked: false };
}

export function legacyEngineRequest(input: { url: string; body: unknown; timeoutMs: number }): Promise<Response> {
  return fetch(`${input.url}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input.body),
    signal: AbortSignal.timeout(input.timeoutMs),
  });
}
