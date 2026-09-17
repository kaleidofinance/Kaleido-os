import { ethers } from "ethers";

import type { Intent } from "@/lib/v2/intents/types";
import { encodeBatch } from "@/lib/v2/intents/batch";
import { PROTOCOL_ERROR_ABI } from "@/lib/v2/protocolErrors";
import { CHAINS_BY_ID } from "@/constants/chains";
import {
  allowanceSlot,
  detectAllowanceSlot,
  type RpcCall,
} from "./tokenSlots";

/**
 * Simulating a built plan before it is offered as signable — so Luca can say a
 * step will revert, and why, rather than the user finding out at the wallet.
 *
 * This is the propose-time counterpart to the sign-time preflight (withPreflight):
 * that one runs against real state one signature at a time; this one runs against
 * the current block for the whole plan at once, faking each approve into the step
 * it authorises so a first-time swap is checked as one unit. Both fail open, and
 * they compose — this catches a bad plan before it is shown, the preflight catches
 * drift between showing it and signing it.
 *
 * NEVER BLOCKS, NEVER LIES. Every branch that is not a decoded, honoured revert
 * ends in `indeterminate` and no claim: an unencodable step, an RPC error, a token
 * whose allowance slot could not be found (which also means overrides are not being
 * honoured on this chain — see tokenSlots). A predicted failure is surfaced ONLY
 * when a step reverted with the overrides provably applied, so a warning is never
 * an artefact of a chain that ignored the fake.
 *
 * NO BALANCE OVERRIDE, DELIBERATELY. Only the inter-step dependency — the allowance
 * a prior approve would have set — is faked. The user's real token and gas balances
 * are left untouched, so a genuine "you don't hold enough" still surfaces as the
 * true revert it is, rather than being papered over.
 */

/** One step's verdict. `ok:false` carries the decoded reason it would revert. */
export interface StepSim {
  index: number;
  kind: string;
  ok: boolean;
  reason?: string;
}

export interface PlanSim {
  /** True only when every step simulated and none reverted. */
  ok: boolean;
  /** True when some step could not be simulated — the plan is not vouched for. */
  indeterminate: boolean;
  steps: StepSim[];
  /** The first step predicted to revert, when there is one. */
  firstFailure?: StepSim;
}

/* Every protocol custom error, plus the two standard ones a revert can carry, so a
   decoded reason reads as "SlippageExceeded" or "insufficient allowance" rather
   than a 4-byte selector. Built once. */
const ERROR_IFACE = new ethers.Interface([
  ...PROTOCOL_ERROR_ABI,
  "error Error(string)",
  "error Panic(uint256)",
]);

/** A revert's data → a human reason, or undefined when it can't be decoded. */
function decodeRevert(data?: string): string | undefined {
  if (!data || !data.startsWith("0x") || data.length < 10) return undefined;
  try {
    const parsed = ERROR_IFACE.parseError(data);
    if (!parsed) return undefined;
    if (parsed.name === "Error") return String(parsed.args[0]);
    if (parsed.name === "Panic") return `Panic(0x${BigInt(parsed.args[0]).toString(16)})`;
    return parsed.name;
  } catch {
    return undefined;
  }
}

/**
 * Classify an eth_call error object: is it the EVM reverting (a real prediction),
 * or the RPC layer failing (which says nothing about the transaction)?
 *
 * Conservative on purpose — only a clear revert is treated as one, so throttling,
 * timeouts and node quirks fall through to `indeterminate` rather than surfacing as
 * a false "this will revert".
 */
function revertOf(error: { code?: number; message?: string; data?: string }): {
  reverts: boolean;
  reason?: string;
} {
  const data =
    typeof error.data === "string" && error.data.startsWith("0x")
      ? error.data
      : undefined;
  const msg = String(error.message ?? "");
  const looksLikeRevert = !!data || error.code === 3 || /execution reverted|reverted/i.test(msg);
  if (!looksLikeRevert) return { reverts: false };
  const decoded =
    decodeRevert(data) ??
    /* geth puts a plain string revert in the message: "execution reverted: X". */
    msg.match(/execution reverted:?\s*(.+)$/i)?.[1]?.trim() ??
    undefined;
  return { reverts: true, reason: decoded };
}

/** A JSON-RPC caller over a chain's first RPC URL, for production use. */
export function rpcCallFor(chainId: number): RpcCall | null {
  const url = CHAINS_BY_ID[chainId]?.rpcUrls?.find((u) => !!u);
  if (!url) return null;
  return async (method, params) => {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    return res.json();
  };
}

/** The state-override map an eth_call carries: address → { stateDiff: slot→word }. */
type Overrides = Record<string, { stateDiff: Record<string, string> }>;

/**
 * Simulate a plan. Returns per-step verdicts; a predicted revert stops the walk,
 * since a later step's success is meaningless once an earlier one would fail.
 */
export async function simulatePlan(
  plan: Intent[],
  chainId: number,
  address: string,
  call: RpcCall,
): Promise<PlanSim> {
  const steps: StepSim[] = [];
  const overrides: Overrides = {};
  let indeterminate = false;

  for (let i = 0; i < plan.length; i++) {
    const intent = plan[i];

    /* Server-side calldata for this one step. `encodeBatch` covers the batchable
       kinds — the ones a plan strings together — and returns null for the rest;
       an unencodable step cannot be simulated, and a later step may depend on it,
       so the walk stops and the plan is left un-vouched-for rather than judged on
       half its steps. */
    const encoded = encodeBatch(plan, [i], address);
    if (!encoded || encoded.length !== 1) {
      indeterminate = true;
      break;
    }
    const c = encoded[0];

    let res: Awaited<ReturnType<RpcCall>>;
    try {
      res = await call("eth_call", [
        {
          from: address,
          to: c.to,
          data: c.data,
          ...(c.value ? { value: ethers.toBeHex(c.value) } : {}),
        },
        "latest",
        overrides,
      ]);
    } catch {
      /* Transport failure — no verdict. */
      indeterminate = true;
      break;
    }

    if (res.error) {
      const { reverts, reason } = revertOf(res.error);
      if (reverts) {
        const failure: StepSim = { index: i, kind: intent.kind, ok: false, reason };
        steps.push(failure);
        return { ok: false, indeterminate, steps, firstFailure: failure };
      }
      /* An RPC error that is not a revert says nothing about the transaction. */
      indeterminate = true;
      break;
    }

    steps.push({ index: i, kind: intent.kind, ok: true });

    /* An approve grants an allowance the next step relies on. Fake it forward for
       the rest of the plan — but only once detection has PROVEN the override is
       honoured for this token on this chain. If it can't be found, the plan's
       approve→spend chain is not something this can vouch for, so the walk stops
       rather than risk a false revert on the un-faked allowance. */
    if (intent.kind === "approve") {
      const base = await detectAllowanceSlot(
        call,
        chainId,
        intent.token,
        address,
        intent.spender,
      );
      if (base === null) {
        indeterminate = true;
        break;
      }
      const slot = allowanceSlot(address, intent.spender, base);
      let word: string;
      try {
        word = ethers.toBeHex(ethers.parseUnits(intent.amount, intent.decimals), 32);
      } catch {
        indeterminate = true;
        break;
      }
      const tokenKey = intent.token.toLowerCase();
      overrides[tokenKey] = {
        stateDiff: { ...(overrides[tokenKey]?.stateDiff ?? {}), [slot]: word },
      };
    }
  }

  /* `ok` means the WHOLE plan was simulated and nothing reverted — so a walk that
     bailed early (indeterminate) is never ok, even though the steps it did reach
     passed. Only a fully-simulated, revert-free plan is vouched for. */
  return {
    ok: !indeterminate && steps.length > 0 && steps.every((s) => s.ok),
    indeterminate,
    steps,
  };
}
