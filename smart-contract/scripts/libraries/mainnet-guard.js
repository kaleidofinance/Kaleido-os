/**
 * The last check before a script broadcasts to a MAINNET.
 *
 * Every mainnet redeploy this project has done traced back to a value nobody
 * looked at before it was sent: a stale `smart-contract/.env` carrying another
 * chain's settings (the "BNB" native label baked into the Arc V3 position
 * descriptor, `NATIVE_FEED_SYMBOL=BNB` recorded on Sepolia), or a default that
 * was right for a testnet and wrong for money. So on a mainnet a script must:
 *
 *   1. print every value it is about to use, in one place, before sending;
 *   2. refuse to fall back on a default for any setting that moves money —
 *      the caller names those in `explicit`, and each must be set in the env;
 *   3. refuse to send at all unless CONFIRM_MAINNET equals this chain's id,
 *      so a command copied from a testnet run cannot broadcast to mainnet.
 *
 * Testnets pass straight through (the plan is still printed).
 */

/** chainId -> name, for every mainnet the protocol can reach. */
const MAINNETS = {
  1: "Ethereum",
  56: "BNB Smart Chain",
  2741: "Abstract",
  4663: "Robinhood Chain",
  5042: "Arc",
  8453: "Base",
};

/**
 * Env vars that override a feed table entry. Refused on mainnet.
 *
 * Case-INSENSITIVE and any suffix, on purpose: Node's process.env is
 * case-insensitive on Windows, so a lowercase `feed_eurc=` line in .env is read
 * as FEED_EURC by the scripts — a case-sensitive pattern let it through. And
 * dotenv accepts `.`/`-` in keys, which a `[A-Z0-9_]` suffix missed.
 */
const OVERRIDE_ENV = /^(FEED_|AGGREGATOR_|FEED_MAX_AGE_).+$|^ORACLE_BACKEND$|^PYTH_CONTRACT$/i;

/** Real settings that happen to share an override prefix. */
const NOT_AN_OVERRIDE = new Set(["FEED_MAX_DEVIATION_BPS"]); // deploy-pushable-feeds.js

function isMainnet(chainId) {
  return Object.prototype.hasOwnProperty.call(MAINNETS, Number(chainId));
}

/**
 * @param {object} args
 * @param {number} args.chainId
 * @param {string} args.script      Name shown in the banner.
 * @param {Array<[string, unknown]>} args.plan  Label/value rows to print.
 * @param {string[]} [args.explicit] Env vars that must be set explicitly on a mainnet.
 * @param {object} [args.env]       Injected for tests; defaults to process.env.
 * @param {(line: string) => void} [args.log]
 */
function confirmMainnet({ chainId, script, plan, explicit = [], env = process.env, log = console.log }) {
  const id = Number(chainId);
  const mainnet = isMainnet(id);
  const width = Math.max(...plan.map(([k]) => String(k).length), 10);

  log("");
  log(`══ ${script} on ${mainnet ? `${MAINNETS[id]} MAINNET` : "a testnet"} (chainId ${id}) ══`);
  for (const [k, v] of plan) log(`   ${String(k).padEnd(width)}  ${v === undefined || v === null || v === "" ? "(unset)" : v}`);
  log("");

  if (!mainnet) return { mainnet: false };

  /* On a mainnet, prices come from the reviewed tables in scripts/libraries —
   * never from the environment. FEED_<SYM>, AGGREGATOR_<SYM> and
   * FEED_MAX_AGE_<SYM> each silently replace a table entry, and a stale .env from
   * a testnet run is exactly how a wrong value reached mainnet before. Change the
   * table (reviewed, committed) instead. */
  const overrides = Object.keys(env).filter(
    (k) =>
      OVERRIDE_ENV.test(k) &&
      !NOT_AN_OVERRIDE.has(k.toUpperCase()) &&
      String(env[k] ?? "").trim(),
  );
  if (overrides.length) {
    throw new Error(
      `Refusing to run ${script} on mainnet with price overrides set in the ` +
        `environment:\n   ${overrides.join("\n   ")}\n` +
        "Unset them. On mainnet every feed, bound and backend comes from the tables " +
        "in scripts/libraries/aggregator-feeds.js and pyth-feeds.js.",
    );
  }

  const missing = explicit.filter((name) => !String(env[name] ?? "").trim());
  if (missing.length) {
    throw new Error(
      `Refusing to run ${script} on mainnet with defaulted money settings.\n` +
        `Set each of these explicitly in the environment (the value you intend,\n` +
        `even if it equals the default):\n   ${missing.join("\n   ")}`,
    );
  }
  if (String(env.CONFIRM_MAINNET ?? "").trim() !== String(id)) {
    throw new Error(
      `Nothing was sent. This is ${MAINNETS[id]} mainnet (chainId ${id}).\n` +
        `Read every row printed above. If each one is what you intend, re-run with\n` +
        `CONFIRM_MAINNET=${id}.`,
    );
  }
  log(`   CONFIRM_MAINNET=${id} — proceeding.\n`);
  return { mainnet: true };
}

module.exports = { MAINNETS, OVERRIDE_ENV, isMainnet, confirmMainnet };
