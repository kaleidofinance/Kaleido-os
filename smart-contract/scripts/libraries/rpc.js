/**
 * Read-after-write helpers for deploy scripts talking to public RPC endpoints.
 *
 * ── The problem these solve ────────────────────────────────────────────────
 *
 * `waitForDeployment()` and `tx.wait()` both resolve when the transaction has a
 * receipt. Neither promises that the *next* `eth_call` can see the state that
 * transaction produced. A public endpoint is a load balancer in front of many
 * nodes at slightly different heights, so a read issued milliseconds later can be
 * served by a node that has not applied that block yet.
 *
 * The reason this is worth a library rather than a retry at each call site is how
 * it fails. A lagging node does not return an error — it returns the state as of
 * an earlier block, which for a freshly deployed contract is empty:
 *
 *   getCode(newContract)        -> "0x"      -> ethers cannot decode, BAD_DATA
 *   feedAggregator(newFeedId)   -> address(0) -> looks like setFeeds never landed
 *   getFeedMaxAge(id)           -> 0          -> looks like setFeedMaxAge was lost
 *
 * All three are indistinguishable from a genuine failure, and all three appear
 * *after* the gas has been spent. Both were measured on Base Sepolia on
 * 2026-08-21 against https://sepolia.base.org, on transactions that were
 * confirmed and correct: a `pyth()` read-back and, on a later run, a
 * `feedAggregator()` read-back that reported the zero address while the same
 * call from a fresh process twenty blocks later returned all four feeds
 * correctly. In both cases the script aborted a healthy deploy and, having
 * thrown before its JSON-writing step, left the addresses recoverable only from
 * console scrollback.
 *
 * ── Why polling and not a block-tag pin ────────────────────────────────────
 *
 * Reading at an explicit `blockTag: receipt.blockNumber` looks like the tidier
 * fix, and it does convert the silent-zero into an error on nodes that reject
 * unknown heights. But not every endpoint does reject: an archive-less node may
 * answer from its earliest available state instead, and some return the latest
 * state for any tag it does not have. Polling makes no assumption about how the
 * endpoint handles a height it lacks — it just asks again until the answer stops
 * looking empty, which is the property actually wanted.
 *
 * Both helpers poll rather than sleeping a fixed interval, so the common case
 * where the RPC is already current costs exactly one extra call.
 */

/** How many times to ask before giving up, and how long to wait between asks. */
const ATTEMPTS = 10;
const INTERVAL_MS = 1500;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait until a freshly deployed contract's code is visible to `provider`.
 *
 * @param {import("ethers").Provider} provider
 * @param {string} address  the deployed address
 * @param {string} label    what to call it in messages, e.g. "AggregatorPriceOracle"
 */
async function waitForCode(provider, address, label) {
  for (let i = 0; i < ATTEMPTS; i++) {
    if ((await provider.getCode(address)) !== "0x") {
      if (i > 0) {
        console.log(`   (${label} became visible after ${i + 1} checks)`);
      }
      return;
    }
    await sleep(INTERVAL_MS);
  }
  throw new Error(
    `${label} at ${address} still reports no code after ${ATTEMPTS} checks.\n` +
      "The deploy transaction had a receipt, so the contract almost certainly\n" +
      "exists — this is more likely an RPC lagging or load-balancing across\n" +
      "nodes at different heights. Check the address on a block explorer before\n" +
      "redeploying, and set a dedicated RPC endpoint if it is genuinely missing.",
  );
}

/**
 * Read a value repeatedly until it looks like the write landed.
 *
 * @template T
 * @param {object} opts
 * @param {() => Promise<T>} opts.read     performs the call. Re-invoked per attempt.
 * @param {(value: T) => boolean} opts.accept  true once the value is not the
 *        empty/zero answer a lagging node would give. This is deliberately a
 *        "does it look written" test and NOT an equality check against the value
 *        expected: the caller still has to assert the value is *right*, because
 *        polling until a wrong value matches would loop forever and then blame
 *        the RPC for what is actually a bad address.
 * @param {string} opts.label              what is being read, for messages.
 * @param {string} [opts.hint]             appended to the failure message.
 * @returns {Promise<T>} the accepted value.
 */
async function waitForState({ read, accept, label, hint = "" }) {
  let last;
  for (let i = 0; i < ATTEMPTS; i++) {
    last = await read();
    if (accept(last)) {
      if (i > 0) console.log(`   (${label} read back after ${i + 1} checks)`);
      return last;
    }
    await sleep(INTERVAL_MS);
  }
  throw new Error(
    `${label} still reads as unset after ${ATTEMPTS} checks (last value: ${last}).\n` +
      "The transaction that should have written it was confirmed, so this is\n" +
      "either an RPC serving state from behind the write, or the write did not do\n" +
      "what it appeared to. Check the transaction's logs on a block explorer\n" +
      "before re-sending it — re-sending is safe for an idempotent setter and is\n" +
      "not safe for anything that appends." +
      (hint ? `\n${hint}` : ""),
  );
}

module.exports = { waitForCode, waitForState, ATTEMPTS, INTERVAL_MS };
