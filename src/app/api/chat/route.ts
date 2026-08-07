import { NextRequest, NextResponse } from 'next/server';
import { getProvider } from '@/lib/ai';
import { runAgent } from '@/lib/ai/agent';
import { consumeModelRequest, peekModelUsage } from '@/lib/ai/credits';

/**
 * Reports remaining model quota without spending any, so the UI can show a
 * balance on load. Kept separate from POST because rendering a number must
 * never cost a request.
 */
export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get('address') ?? undefined;
  const usage = await peekModelUsage(wallet);
  return NextResponse.json({
    provider: Boolean(getProvider()),
    ...usage,
  });
}

// The AI Engine API URL and timeout (set in environment variables)
const AI_ENGINE_API_URL = process.env.AI_ENGINE_API_URL || 'http://127.0.0.1:8000';
const AI_ENGINE_TIMEOUT = parseInt(process.env.AI_ENGINE_TIMEOUT || '300000', 10);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // --- Provider-agnostic agent loop -----------------------------------
    // When an AI key is configured (Claude, OpenAI, …) Luca runs here: read
    // tools ground the reasoning, execute tools become the signable plan the
    // frontend renders via PlanReview. Falls through to the legacy AI-engine
    // proxy below when no key is set, so existing deployments are unaffected.
    const provider = getProvider();
    if (provider) {
      // Quota is spent here, at the point of dispatch, and nowhere earlier.
      // A turn the client answered locally never reaches this route at all, so
      // routing locally first is what makes the allowance go far.
      const quota = await consumeModelRequest(body.address);
      if (!quota.allowed) {
        return NextResponse.json(
          {
            response: !body.address
              ? "Connect your wallet to use the reasoning engine. Direct commands like `swap 500 USDC to KLD` work without it."
              : `You've used all ${quota.quota} reasoning requests for today. Direct commands still work, and the allowance resets at 00:00 UTC.`,
            context: {
              status: 'quota_exhausted',
              credits: { used: quota.used, quota: quota.quota, remaining: 0 },
            },
          },
          { status: 429 },
        );
      }

      try {
        const result = await runAgent(provider, {
          message: String(body.message ?? ""),
          address: body.address,
          chainId: body.chainId,
          limits: body.limits,
        });
        return NextResponse.json({
          response: result.text,
          context: {
            plan: result.plan,
            provider: result.provider,
            model: result.model,
            credits: {
              used: quota.used,
              quota: quota.quota,
              remaining: quota.remaining,
            },
          },
        });
      } catch (aiError: any) {
        console.error("[chat] provider failed:", aiError);
        return NextResponse.json({
          response:
            "I couldn't complete that just now — the reasoning service returned an error. Try again shortly.",
          context: { status: "provider_error" },
        });
      }
    }

    // Check if AI Engine API is available
    try {      // Forward the request to the AI Engine API
      const response = await fetch(`${AI_ENGINE_API_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },        body: JSON.stringify(body),
        // Use configurable timeout for AI response generation
        signal: AbortSignal.timeout(AI_ENGINE_TIMEOUT)
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        return NextResponse.json(
          { error: errorData.detail || 'Failed to get response from AI Engine' },
          { status: response.status }
        );
      }
      
      const data = await response.json();

      // --- ASL-4 PHASE 1: ADVERSARIAL AUDITOR PASS ---
      // This logic simulates a secondary Auditor Agent verifying the proposal.
      if (data.context?.functionData?.result) {
          const result = data.context.functionData.result;
          
          // 🛡️ Security Gate: Threshold Verification
          const amount = parseFloat(result.amount || "0");
          if (amount > 1000) {
              console.warn(`[Safety] Blocked high-value action: ${amount} units.`);
              return NextResponse.json({
                  response: "I've drafted a high-value strategy, but the safety checks blocked it for your protection (Exceeds $1,000 limit). Please break your request into smaller chunks.",
                  context: { status: 'blocked_by_safety_check', reason: 'threshold_exceeded' }
              });
          }

          // 🛡️ Security Gate: Omni-Chain Destination Verification
          // We validate the destination protocol against a chain-specific whitelist.
          const chainId = result.chainId || body.chainId || 11124; // Default to Abstract Testnet
          
          const MULTICHAIN_WHITELIST: Record<string, string[]> = {
              "11124": ["Kaleido", "Morpho", "USDC", "KLD"], // Abstract
              "8453": ["Base", "Aave", "Aerodrome", "Uniswap"], // Base
              "137": ["Polygon", "Aave", "Quickswap"],       // Polygon
              "56": ["BSC", "Pancakeswap", "Venus", "Stargate"], // BSC
              "1": ["Ethereum", "Aave", "Uniswap", "Lido"]   // Mainnet
          };

          const allowedNames = MULTICHAIN_WHITELIST[chainId.toString()] || [];
          const isWhitelisted = allowedNames.some(name => 
              (result.target?.toLowerCase().includes(name.toLowerCase())) || 
              (result.protocol?.toLowerCase().includes(name.toLowerCase()))
          );

          if (!isWhitelisted && result.target) {
              console.warn(`[Safety] Blocked unverified destination on Chain ${chainId}: ${result.target}`);
              return NextResponse.json({
                  response: `This transaction was blocked by safety checks. The protocol "${result.target}" is not currently whitelisted for high-security operations on Chain ID ${chainId}.`,
                  context: { status: 'blocked_by_safety_check', reason: 'unvetted_omnichain_target' }
              });
          }
      }

      return NextResponse.json(data);
    } catch (fetchError: any) {
      console.error('Error connecting to AI Engine:', fetchError);
      
      // Return a fallback response when the AI Engine is unavailable
      return NextResponse.json({
        response: "I'm currently unable to connect to my backend services. Please try again later or contact support if the issue persists.",
        context: {
          conversation_id: body.conversation_id || "fallback-" + Date.now(),
        },
        error_details: {
          type: "connection_error",
          message: fetchError.message,
          cause: fetchError.cause?.code || "unknown"
        }
      });
    }
  } catch (error: any) {
    console.error('Error in chat API route:', error);
    return NextResponse.json(
      { error: error.message || 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
