import type { ethers } from "ethers";

/**
 * The intent bus.
 *
 * From the component map: pages never import each other's components, and Luca
 * never imports each page. They emit *intents* — plain, serialisable objects —
 * and a registry turns each into (a) a row you can read and (b) calldata you
 * can sign. Adding a product means registering two functions, not editing every
 * caller. This is the one mechanism that keeps Portfolio→Repay, Pool→Rebalance,
 * and Luca's multi-step plans from tangling into a dependency cycle.
 *
 * An intent is atomic. A multi-step action (approve then swap, bridge then
 * deposit) is an ordered array of intents — a plan — executed in sequence.
 */

export type Intent =
  | {
      kind: "approve";
      token: string;
      spender: string;
      /** Human amount; resolver parses with `decimals`. */
      amount: string;
      decimals: number;
      symbol: string;
    }
  | {
      kind: "swap";
      tokenIn: string;
      tokenOut: string;
      amountIn: string;
      amountOutMin: string;
      fee: number;
      decimalsIn: number;
      decimalsOut: number;
      symbolIn: string;
      symbolOut: string;
      /** Transaction deadline in minutes. Defaults to 20 if omitted. */
      deadlineMin?: number;
    }
  | {
      kind: "stake";
      /** Vault contract address (envVars.vaultAddress). */
      vault: string;
      token: string;
      stToken: string;
      amount: string;
      symbol: string;
    }
  | {
      kind: "grantAgentPermission";
      /** Diamond address exposing AgentPermissionFacet. */
      diamond: string;
      agent: string;
      maxNotionalPerAction: string;
      maxNotionalPerEpoch: string;
      epochDurationSec: number;
      expiryUnix: number;
      maxInterestBps: number;
      minHealthFactorBps: number;
      /** Bitmask of ACTION_* flags. */
      allowedActions: number;
      tokens: string[];
    };

/** AgentPermissionFacet action bitmask (mirrors LibAgentPermission). */
export const AGENT_ACTIONS = {
  BORROW: 1,
  LEND: 2,
  REPAY: 4,
  DEPOSIT_COLLATERAL: 8,
  WITHDRAW_COLLATERAL: 16,
  CLOSE: 32,
} as const;

export type IntentKind = Intent["kind"];

/** Narrow an Intent to a specific kind. */
export type IntentOf<K extends IntentKind> = Extract<Intent, { kind: K }>;

/**
 * Everything a resolver needs to sign and send, gathered once by the caller.
 * The signer is built the app-standard way (thirdweb ethers6 adapter) in
 * useResolverContext, so resolvers stay free of React and wallet-stack details.
 */
export interface ResolverContext {
  signer: ethers.Signer;
  address: string;
  chainId: number;
}

/** How a step reads. Pure — derived from the intent alone, no I/O. */
export interface IntentView {
  title: string;
  detail?: string;
  /** Optional chain label, for cross-chain plans where legs differ. */
  chain?: string;
}

export interface IntentResult {
  /** Tx hash, or null when the step was a no-op (e.g. allowance already set). */
  hash: string | null;
  /** Set when the step did nothing, so the UI can say "already approved". */
  skipped?: boolean;
}

export interface IntentDef<K extends IntentKind = IntentKind> {
  render: (intent: IntentOf<K>) => IntentView;
  resolve: (ctx: ResolverContext, intent: IntentOf<K>) => Promise<IntentResult>;
}
