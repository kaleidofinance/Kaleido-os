import { ethers } from "ethers";
import { ErrorType, type DecodedError } from "ethers-decode-error";

/**
 * Turning a failed transaction into a sentence a reader can act on.
 *
 * ── Why this is not inline in the toast handlers ─────────────────────────────
 *
 * `TxFactory` decodes failures with `ethers-decode-error` and switches on
 * `err.fragment.name`, which is only set when the failure was a revert whose
 * selector matched the ABI. Everything else fell to one line — "An unexpected
 * error occurred. Please try again later" — which covered a declined signature,
 * an empty gas tank, a wallet on the wrong network and a genuine contract revert
 * the decoder simply failed to see. Three of those four the reader fixes in ten
 * seconds once told which one it is, and the fourth is a bug report that cannot
 * be filed without the name.
 *
 * The logic lives here, away from `react` and `sonner`, because every claim in
 * the comments below is a claim about what a library returns for a shape a wallet
 * throws — and those are checked in txErrors.test.ts against errors built with
 * ethers' own `makeError`, not against my reading of the decoder's source. Each
 * branch corresponds to a case in that file.
 *
 * ── The hole that actually caused the faucet's generic toast ────────────────
 *
 * The decoder's data lookup reads `error.data` and `error.error.data` only. Some
 * providers — thirdweb's adapter among them — nest the same field one level
 * further, at `error.info.error.data`. Measured: an ordinary
 * `KaleidoTokenFaucet_CooldownNotOver` arriving that way decodes to
 * `{ type: RpcError, name: "CALL_EXCEPTION", data: null, fragment: null }`, so
 * the cooldown case in the switch never fires and the reader is told nothing.
 * `digRevertData` walks the error for the first revert-data-shaped string, which
 * recovers those.
 */

/**
 * `Error(string)` and `Panic(uint256)` — the two reverts every contract can
 * produce without declaring them. `Interface.parseError` reports them under these
 * names, so a caller asking "which of *our* errors was this" has to exclude them
 * or it will match a plain `require` message against a fragment name of "Error".
 */
const BUILTIN_REVERTS = new Set(["Error", "Panic"]);

/**
 * Reasons that carry no information, which the decoder still hands back as the
 * `reason` field. Passing one of these through to a toast reads as a bug, because
 * from the reader's side it is indistinguishable from one.
 */
const OPAQUE_REASON =
  /^(invalid error|unknown error|missing revert data|execution reverted|could not coalesce error|internal error)\.?$/i;

/** Revert data as a hex string: a 4-byte selector, optionally with arguments. */
const REVERT_DATA = /^0x[0-9a-fA-F]{8}(?:[0-9a-fA-F]{2})*$/;

/**
 * Revert data, dug out of wherever the provider buried it.
 *
 * Depth-first over the handful of keys wallets and providers actually nest under,
 * returning the first value that looks like revert data. Bounded depth because
 * these objects hold cyclic references (`error.info.error` back to `error`) and an
 * unbounded walk would not return.
 */
export function digRevertData(error: unknown, depth = 0): string | null {
  if (depth > 5 || error === null || typeof error !== "object") return null;
  const o = error as Record<string, unknown>;
  if (typeof o.data === "string" && REVERT_DATA.test(o.data)) return o.data;
  for (const key of ["data", "error", "info", "cause", "value"] as const) {
    const found = digRevertData(o[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/** Revert data parsed against an ABI, or null when it is not in there. */
function parseRevert(
  abi: ethers.InterfaceAbi | undefined,
  data: string,
): { name: string; args: readonly unknown[] } | null {
  if (!abi) return null;
  try {
    const parsed = new ethers.Interface(abi).parseError(data);
    return parsed ? { name: parsed.name, args: [...parsed.args] } : null;
  } catch {
    return null;
  }
}

/**
 * The contract's own named error behind a failure, or null when it was not one.
 *
 * Callers use this to key their `switch`, so it deliberately returns null for
 * `Error(string)` and `Panic` — those are not errors the contract declared, and a
 * `case "Error"` in a switch over custom errors would be a mistake waiting to
 * happen. `describeFailure` speaks to them instead.
 */
export function namedRevert(
  err: DecodedError | null,
  error: unknown,
  abi?: ethers.InterfaceAbi,
): string | null {
  const found = err?.fragment?.name;
  if (found && !BUILTIN_REVERTS.has(found)) return found;

  const data = err?.data ?? digRevertData(error);
  if (!data) return null;
  const parsed = parseRevert(abi, data);
  return parsed && !BUILTIN_REVERTS.has(parsed.name) ? parsed.name : null;
}

/**
 * A signature the reader declined, which is not a failure and should not be
 * dressed as one. Exported separately from the message because the caller needs
 * it to pick the kind of toast, not just the words.
 *
 * `UserRejectError` exists in the library and never fires for this: its predicate
 * looks for "rejected transaction" in the message, and ethers 6 says "user
 * rejected action". So a decline arrives as `RpcError` carrying ethers' own code,
 * and both spellings are matched here rather than only the tidy one.
 */
export function isRejection(err: DecodedError | null): boolean {
  return (
    err?.type === ErrorType.UserRejectError || err?.name === "ACTION_REJECTED"
  );
}

const clamp = (s: string, n = 160) =>
  s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;

/**
 * What to tell the reader when the failure was not one of the contract's named
 * errors.
 *
 * `error` is the original throw and `abi` the contract's, both optional: without
 * them the RPC-level cases still work, and with them a revert the decoder missed
 * is recovered and named.
 */
export function describeFailure(
  err: DecodedError | null,
  error?: unknown,
  abi?: ethers.InterfaceAbi,
): string {
  const reason = err?.reason?.trim() ?? "";
  const code = err?.name ?? "";

  if (isRejection(err)) {
    return "You dismissed the request in your wallet — nothing was sent.";
  }
  if (
    code === "INSUFFICIENT_FUNDS" ||
    /* Arc v0.8.0 / revm 38 renamed these: "insufficient funds for gas * price +
       value" → "OutOfFunds"; simple-transfer case → "gas required exceeds allowance".
       Activates on Arc testnet 2026-09-03 and mainnet 2026-09-10. */
    /insufficient funds|OutOfFunds|gas required exceeds allowance/i.test(reason)
  ) {
    return "This wallet cannot cover the gas for this transaction. Send it a little of the network's own token first — what the faucet hands out is free, the transaction that fetches it is not.";
  }
  if (
    code === "NETWORK_ERROR" ||
    code === "UNSUPPORTED_OPERATION" ||
    /underlying network changed|unsupported chain|chain ?id/i.test(reason)
  ) {
    return "Your wallet is on a different network than the app. Switch it and try again.";
  }
  if (
    code === "NONCE_EXPIRED" ||
    code === "REPLACEMENT_UNDERPRICED" ||
    /nonce too low|already known|replacement transaction/i.test(reason)
  ) {
    return "An earlier transaction from this wallet is still pending. Wait for it to land, then try again.";
  }

  /* A revert. Either the decoder saw the data or it is nested where it does not
     look; both end up here. */
  const data = err?.data ?? digRevertData(error);
  if (data) {
    const parsed = parseRevert(abi, data);
    if (parsed && BUILTIN_REVERTS.has(parsed.name)) {
      /* `require("...")` or a panic. The decoder's reason is already the message
         in both cases; the parsed argument is the fallback for when this was
         called without it. */
      const first = parsed.args[0];
      if (reason && !OPAQUE_REASON.test(reason)) return clamp(reason);
      return parsed.name === "Error" && typeof first === "string" && first
        ? clamp(first)
        : "The contract refused the call.";
    }
    if (parsed) return `The contract rejected this: ${parsed.name}.`;
    /* Data that no ABI here knows. Naming the selector is not friendly, but it is
       the difference between a report that can be acted on and one that cannot. */
    return `The contract rejected this with an error this build does not recognise (${data.slice(0, 10)}).`;
  }

  /*
   * No data anywhere. Overwhelmingly this is a call that never reached the
   * contract it was aimed at — a stale address, or a wallet on another chain —
   * because a contract that means to refuse says why.
   */
  if (code === "CALL_EXCEPTION" || err?.type === ErrorType.EmptyError) {
    return "The contract refused the call without saying why. Check that your wallet is on the network the app is showing.";
  }
  if (reason && !OPAQUE_REASON.test(reason)) return clamp(reason);
  return "Something went wrong before the transaction was sent. Please try again.";
}
