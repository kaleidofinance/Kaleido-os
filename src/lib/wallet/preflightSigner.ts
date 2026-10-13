import type { Signer, TransactionRequest, TransactionResponse } from "ethers";

/**
 * A signer that eth_calls each transaction before it asks the wallet to sign it.
 *
 * WHY. A plan step that is going to revert — a swap whose floor the market has
 * moved past, a borrow that would breach the health factor, a transfer of more
 * than the wallet holds — reaches the user today as a wallet prompt they sign,
 * that then fails at the wallet's own gas estimate or on chain. PlanReview
 * already decodes that failure (errorDecoder + describeFailure over
 * PROTOCOL_ERROR_ABI), so the reason is good; what is missing is catching it
 * BEFORE the prompt, so the user is never asked to sign a doomed transaction and
 * never pays gas for one that a bundle would have half-applied.
 *
 * HOW. Every resolver sends through `ctx.signer.sendTransaction` — a raw send, or
 * an `ethers.Contract` method whose runner is this signer, which ends in the same
 * call. So wrapping that one method preflights all of them, without touching a
 * single resolver. The wrapper eth_calls the exact transaction against current
 * state first; a revert is thrown now, before the wallet is opened.
 *
 * WHY IT NEEDS NO STATE OVERRIDE. The hard part of simulating a multi-step plan is
 * that step two (swap) depends on step one (approve) having executed. This runs at
 * SIGN time, one step at a time, and PlanReview's sequential path only reaches
 * step two after step one has actually mined — so the eth_call sees the real
 * post-approval allowance. No `eth_call` state override, and so no dependence on
 * whether a given chain's RPC supports one (Arc's is unverified). The trade-off is
 * that this covers the sequential path, not the EIP-5792 bundle path, which sends
 * one atomic transaction that reverts as a whole and is reported as such already.
 *
 * FAIL OPEN, ALWAYS. The preflight must never block a transaction that would have
 * succeeded. Only an actual EVM revert (`CALL_EXCEPTION`) aborts the send; a
 * throttled RPC, an endpoint that refuses eth_call, a transient network error —
 * none of which are evidence the transaction is bad — fall straight through to the
 * real send, which is exactly the behaviour before this wrapper existed.
 */

/**
 * True for an ethers v6 error that is an EVM revert, as opposed to a transport or
 * RPC-layer failure. `CALL_EXCEPTION` is what ethers raises when eth_call reverts,
 * and it carries the revert `data` the decoder downstream reads — so re-throwing
 * it lands in PlanReview's catch exactly as a revert seen at the wallet's estimate
 * would. Everything else (`NETWORK_ERROR`, `TIMEOUT`, `SERVER_ERROR`, a plain
 * `TypeError` from a signer with no `.call`) is not a revert and must not abort.
 */
function isExecutionRevert(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    (err as { code?: unknown }).code === "CALL_EXCEPTION"
  );
}

/**
 * Wraps a signer so `sendTransaction` eth_calls the transaction first and throws a
 * predicted revert before the wallet is opened. Every other member is forwarded to
 * the original signer untouched, bound to it so a forwarded method's `this` is the
 * real signer and can never recurse back through this wrapper.
 */
export function withPreflight(signer: Signer): Signer {
  const preflightSend = async (
    tx: TransactionRequest,
  ): Promise<TransactionResponse> => {
    try {
      /* The exact transaction the resolver is about to send, eth_called against
         current state from the signer's own address (Signer.call populates
         `from`). A revert here is the transaction reverting for real. */
      await signer.call(tx);
    } catch (err) {
      if (isExecutionRevert(err)) throw err;
      /* Not a revert — a flaky RPC, an endpoint that won't eth_call, a network
         blip. None of these say the transaction is bad, so proceed to the real
         send rather than block a good one on the preflight's own trouble. */
    }
    return signer.sendTransaction(tx);
  };

  return new Proxy(signer, {
    get(target, prop) {
      if (prop === "sendTransaction") return preflightSend;
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
