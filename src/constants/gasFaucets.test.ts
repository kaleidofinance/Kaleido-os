// Checks on the gas-faucet table. Run with plain node (tsx).
//
// This module's only job is to not lie. A faucet link is followed by someone who
// is stuck, in another tab, on a chain they have never used — the worst possible
// moment to send them somewhere wrong. So the checks here are mostly about
// provenance rather than shape: that every chain we hand out test tokens on has
// somewhere to get gas, that no entry contradicts the chain's own native
// currency, and that the two near-misses found while assembling the table stay
// caught.
import {
  GAS_FAUCETS,
  GAS_FAUCET_CHAIN_IDS,
  gasFaucetsFor,
  gasNameFor,
} from "./gasFaucets.ts";
import { CHAINS, CHAINS_BY_ID } from "./chains.ts";
import { faucetChains } from "./registry.ts";

let pass = 0;
let fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

const allEntries = Object.entries(GAS_FAUCETS).flatMap(([id, list]) =>
  list.map((f) => ({ chainId: Number(id), ...f })),
);

console.log("\n— every chain that hands out test tokens can afford the claim —");
{
  /* The point of the module. KaleidoTokenFaucet pays out native gas, but the
     claim is itself a transaction, so a chain with a faucet contract and no gas
     faucet link is a dead end for a wallet at zero. */
  for (const chain of faucetChains(CHAINS)) {
    check(
      `${chain.shortName} (${chain.id}) has somewhere to get gas`,
      gasFaucetsFor(chain.id).length > 0,
    );
  }
}

console.log("\n— every entry describes a chain we actually carry —");
{
  for (const { chainId } of allEntries) {
    check(
      `chain ${chainId} is in chains.ts`,
      CHAINS_BY_ID[chainId] !== undefined,
    );
  }
  check(
    "GAS_FAUCET_CHAIN_IDS matches the table's own keys",
    GAS_FAUCET_CHAIN_IDS.length === Object.keys(GAS_FAUCETS).length &&
      GAS_FAUCET_CHAIN_IDS.every((id) => (GAS_FAUCETS[id]?.length ?? 0) > 0),
    `${GAS_FAUCET_CHAIN_IDS.join(",")} vs ${Object.keys(GAS_FAUCETS).join(",")}`,
  );
}

console.log("\n— the payout matches the chain's own native currency —");
{
  /* Arc's gas is USDC and BSC testnet's is tBNB. An entry promising ETH on
     either would read as plausible and send the reader to a faucet that cannot
     help them, so `gives` has to name the thing the chain actually burns. */
  for (const { chainId, operator, gives } of allEntries) {
    const native = CHAINS_BY_ID[chainId]?.nativeCurrency;
    const said = gives.toLowerCase();
    check(
      `${operator} on ${chainId} pays out ${native?.symbol}`,
      Boolean(native) &&
        (said.includes(native.symbol.toLowerCase()) ||
          said.includes(native.name.toLowerCase())),
      `"${gives}" names neither ${native?.name} nor ${native?.symbol}`,
    );
  }
}

console.log("\n— the two near-misses stay caught —");
{
  /* `arc.network` and `docs.arc.network` both redirect to arc.io, the Arc
     *browser*. Circle's Arc has no faucet of its own because its gas is USDC. */
  check(
    "nothing points at arc.io or arc.network",
    !allEntries.some((f) => /(^|\/\/|\.)arc\.(io|network)(\/|$)/.test(f.url)),
    allEntries.map((f) => f.url).join(" "),
  );
  check(
    "Arc's faucet is Circle's, and pays USDC",
    gasFaucetsFor(5042002).some(
      (f) => f.operator === "Circle" && /usdc/i.test(f.gives),
    ),
  );
  /* docs.base.org/base-chain/tools/network-faucets 302s. Storing the redirect
     target rather than the source saves the reader a request. */
  check(
    "Base's link is the redirect target, not the path that 302s",
    !gasFaucetsFor(84532).some((f) => f.url.includes("network-faucets")),
  );
}

console.log("\n— the pre-native chains lead with the chain team's own faucet —");
{
  /*
   * BSC testnet (97) and Arc (5042002) are the two chains whose faucet runs the
   * 4560-byte pre-native bytecode — Sepolia's native-capable build is 5343 and is
   * the only one carrying `KaleidoTokenFaucet_NativeTransferFailed`. Neither can
   * be upgraded in place: `FAUCET_EXTEND` adds listings, not a `receive()`.
   *
   * What that costs them differs, and the difference is worth keeping written
   * down because it decides how /faucet renders each (measured 2026-08-30):
   *
   *  - 97 has no gas row at all. `claim(address(1))` reverts `AssetNotListed`
   *    (0x3ea1becf), so the page synthesises a row that links out. Redeploying is
   *    blocked on funding, not on us: the deployer holds 0.00144843797 tBNB
   *    against a 0.005 reserve, so a fresh faucet would list gas and stock zero.
   *  - 5042002 pays its gas today. Arc's native currency IS USDC and
   *    `0x3600…0000` is a 6dp ERC20 alias of the same balance (measured ratio
   *    exactly 1e12), so that row hands out spendable gas without any native
   *    branch in `_pay`. It was briefly unpayable — drip 100.0 against a stock of
   *    8.694815 — until `setDrips` took the drip to 0.25 (34 claims); a claim
   *    from a fresh address now simulates clean.
   *
   * Both entries stay, and Arc's is not redundant now that its row pays: a native
   * row solves the SECOND hop, never the zeroth. `claim` is itself a transaction,
   * so a wallet at exactly zero still cannot afford to call it, and Circle's
   * faucet is the only thing on the page that can reach such a wallet.
   *
   * /faucet promotes `gasFaucetsFor(id)[0]` into the asset table as the gas row's
   * Claim button whenever that row cannot pay — keyed on `empty`/`paused`, not on
   * a chain id, so Arc dropped the link-out on its own when the drip changed and
   * Sepolia would gain one the day it runs dry. That makes the FIRST entry
   * load-bearing in a way it is not elsewhere: it has to be the chain's own team,
   * since a third party that closes or starts gating would leave the table's
   * first action a dead end with no in-app fallback behind it.
   *
   * Checked by id rather than by reading the chain, deliberately — a unit test
   * that needs five RPCs to answer fails for reasons that have nothing to do with
   * this table. The ids are the measurement, written down.
   */
  for (const id of [97, 5042002]) {
    const lead = gasFaucetsFor(id)[0];
    check(
      `${CHAINS_BY_ID[id]?.shortName} has a lead faucet to promote`,
      lead !== undefined,
    );
    check(
      `${CHAINS_BY_ID[id]?.shortName}'s lead faucet is first-party`,
      lead?.firstParty === true,
      `lead is ${lead?.operator}`,
    );
  }
}

console.log("\n— links are usable and distinct —");
{
  for (const { operator, url } of allEntries) {
    check(`${operator}'s URL is https`, url.startsWith("https://"), url);
    check(
      `${operator}'s URL has no whitespace or trailing slash-space`,
      url === url.trim() && !/\s/.test(url),
      JSON.stringify(url),
    );
  }
  const urls = allEntries.map((f) => f.url);
  check(
    "no URL is listed twice",
    new Set(urls).size === urls.length,
    urls.join(" "),
  );
}

console.log("\n— every entry records when it was last checked —");
{
  /* A link with no verification date is a link nobody has to answer for. The
     status is kept as measured: Robinhood's returned 429, which is a live
     service rate-limiting the probe, and rounding that up to 200 would be
     recording something that did not happen. */
  for (const { operator, verified } of allEntries) {
    check(
      `${operator} carries an ISO date`,
      /^\d{4}-\d{2}-\d{2}$/.test(verified.on),
      verified.on,
    );
    check(
      `${operator}'s status means the host answered`,
      verified.status === 200 || verified.status === 429,
      String(verified.status),
    );
  }
}

console.log("\n— a chain with no first-party faucet gets more than one option —");
{
  /* Sepolia has no faucet run by the Ethereum Foundation, so every option is a
     third party that can close, gate or rate-limit without notice. One such
     link is a single point of failure; two is a hedge. Where the chain team runs
     its own, one is enough. */
  for (const id of GAS_FAUCET_CHAIN_IDS) {
    const list = gasFaucetsFor(id);
    check(
      `${CHAINS_BY_ID[id]?.shortName} is not left on one third-party link`,
      list.some((f) => f.firstParty) || list.length >= 2,
      `${list.length} option(s), none first-party`,
    );
  }
}

console.log("\n— the accessors —");
{
  const arc = gasFaucetsFor(5042002);
  check("gasFaucetsFor returns entries for a known chain", arc.length === 1);
  check("gasFaucetsFor is empty for a chain with no entry", gasFaucetsFor(1) .length === 0);
  check("gasFaucetsFor is empty for an unknown chain", gasFaucetsFor(999999).length === 0);
  check("gasFaucetsFor tolerates undefined", gasFaucetsFor(undefined).length === 0);

  /* Sorted copy, not the module's array: a caller that reverses or splices the
     result would otherwise reorder the table for every later render. */
  const before = GAS_FAUCETS[11155111].map((f) => f.operator).join(",");
  const handed = gasFaucetsFor(11155111);
  handed.reverse();
  check(
    "the caller gets a copy",
    GAS_FAUCETS[11155111].map((f) => f.operator).join(",") === before,
  );

  /* Sepolia's two are both third-party, so first-party ordering is checked on a
     synthetic pair instead — the sort is what guarantees the chain team's own
     faucet is offered before a third party's. */
  const sorted = [
    { firstParty: false, operator: "third" },
    { firstParty: true, operator: "chain team" },
  ].sort((a, b) => Number(b.firstParty) - Number(a.firstParty));
  check("first-party sorts first", sorted[0].operator === "chain team");

  check("gasNameFor reads Arc's native as USDC", gasNameFor(5042002) === "USDC");
  check("gasNameFor reads BSC testnet's as BNB", gasNameFor(97) === "BNB");
  check("gasNameFor falls back for an unknown chain", gasNameFor(999999) === "gas");
  check("gasNameFor tolerates undefined", gasNameFor(undefined) === "gas");
}

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
