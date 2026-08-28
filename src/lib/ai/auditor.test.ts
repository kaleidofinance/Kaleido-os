// Checks on the plan auditor. Run with `npx tsx src/lib/ai/auditor.test.ts` —
// tsx rather than plain node, because auditor.ts imports the token registry and
// ethers rather than being self-contained the way fromCommand.ts is.
//
// The property under test: a plan arrives here as untrusted model output, and
// anything leaving with `ok: true` is something a user will be asked to sign.
// So most of these assert what does NOT pass.
//
// Prices come from a stub through the `pricer` seam. The real one calls Pyth
// over the network, and a security check whose suite is green only when an
// external API is up is a suite that gets skipped. Fixed prices also mean "$1500
// is over the $1000 cap" asserts the cap and not today's ETH price.

import type { Pricer } from "./auditor";
import type { LendingSide } from "../../constants/registry";

/*
 * The Diamond env var, fixed before the auditor is loaded.
 *
 * `envVars` reads process.env once at module evaluation, and under tsx there is
 * no Next.js runtime to populate NEXT_PUBLIC_* — so the address is undefined
 * here and the auditor's pin would degrade to a shape check, leaving the pinning
 * rule untested. Setting it first makes the check deterministic instead of
 * dependent on whether a .env happened to be loaded.
 *
 * This is why every runtime import in this file is dynamic and lives inside
 * `main()`: a static import is evaluated before any statement in the module
 * body, so envVars would have already frozen `undefined` by the time this line
 * ran. Types are still imported statically — they erase, so they load nothing.
 *
 * WHAT THIS ADDRESS NO LONGER IS: the value the diamond pin compares against.
 * `diamondReasons` now prefers `getContracts(chainId).diamond` and falls back to
 * this only where the registry has none, because NEXT_PUBLIC_KALEIDO_DIAMOND_-
 * ADDRESS is one address for every chain and the five deployed testnets have
 * five distinct diamonds. So on CHAIN below this is the LOSING side of that
 * precedence, and it is deliberately kept as a value the registry disagrees
 * with — `PINNED_DIAMOND` asserts the registry wins, and the send-into-a-
 * protocol-address case asserts `protocolAddresses` still collects both.
 */
const DIAMOND = "0xd1a3000000000000000000000000000000000001";
process.env.NEXT_PUBLIC_KALEIDO_DIAMOND_ADDRESS = DIAMOND;

let pass = 0;
let fail = 0;
let skipped = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} ${detail}`);
  }
};

/*
 * For an assertion whose fixture the live deployment cannot currently supply.
 *
 * Counted and printed rather than omitted, because the whole stance of this file
 * is that a green run must not have asserted nothing — an assertion that
 * silently stops running is the failure mode the fixture guards above exist to
 * prevent. A skip is a visible hole; a missing block is an invisible one.
 *
 * Use this ONLY where the fixture is absent for a structural reason that is
 * stated at the call site, never to quiet a genuine failure.
 */
const skip = (name: string, why: string) => {
  skipped++;
  console.log(`  skip ${name} — ${why}`);
};

/* KLD and stKLD are absent on purpose — they are unpriced pre-TGE, and the
   auditor's behaviour for an unpriceable asset is one of the things under
   test. Anything not listed resolves to null, matching getPrices. */
const PRICES: Record<string, number> = {
  ETH: 3000,
  WETH: 3000,
  USDC: 1,
  USDT: 1,
  DAI: 1,
  kfUSD: 1,
  kafUSD: 1,
};

const stubPricer: Pricer = async (symbol, amount) => {
  const unit = PRICES[symbol];
  const qty = parseFloat(amount);
  if (unit === undefined) return { usd: null, source: "unpriced" };
  return { usd: unit * qty, source: "stub" };
};

/* Sepolia. Chosen because it is a chain the protocol is actually deployed on
   AND its token list is populated — the address checks are most of this suite,
   and a chain whose registry is empty would skip them and report a green run
   that asserted nothing.

   This was 8453 (Base mainnet), which satisfied only the token-list half. That
   was survivable while the addresses under test came from flat tables, but the
   auditor now pins against getContracts(chainId), which returns {} for any
   undeployed chain — so on 8453 every pinned-address check would compare
   against undefined. Abstract (11124) fails the same way and worse: it is not
   in DEPLOYMENTS at all. */
const CHAIN = 11155111;

const LIMITS = {
  maxPerAction: 1000,
  maxPerDay: 5000,
  minHealthFactor: 1.4,
  slippageBps: 50,
};

const ALL_ON = {
  swap: true,
  borrow: true,
  lend: true,
  stake: true,
  provideLiquidity: true,
};

type Step = Record<string, unknown>;

/* Loaded dynamically so the DIAMOND assignment above has already run; see the
   comment at the top of the file. */
async function load() {
  const { chainTokens } = await import("../../constants/tokens");
  const registry = await import("../../constants/registry");
  const { NATIVE_SENTINEL } = registry;
  const { auditPlan, HARD_MAX_NOTIONAL_USD } = await import("./auditor");
  /* The bridge allowlists, read here for the same reason the registry is read
     rather than pasted: these are the tables the auditor itself consults, so an
     assertion against a hand-copied address would stop testing the pin the day
     the table moved. */
  const { isKnownBridgeSpender } = await import("../bridge/route");
  return {
    chainTokens,
    registry,
    NATIVE_SENTINEL,
    auditPlan,
    HARD_MAX_NOTIONAL_USD,
    isKnownBridgeSpender,
  };
}

async function main() {
  const {
    chainTokens,
    registry,
    NATIVE_SENTINEL,
    auditPlan,
    HARD_MAX_NOTIONAL_USD,
    isKnownBridgeSpender,
  } = await load();

  /* Read from the registry rather than pasted in. A pasted address passes the
     day it is copied and silently stops testing anything the day the market
     redeploys — the suite would still be green while asserting a token the
     facet no longer accepts.

     BORROW_CURRENCIES / STABLE_CONTRACTS / LEGACY_CONTRACTS were flat
     Abstract-testnet tables and are gone; their chain-scoped replacements are
     resolved once here against CHAIN so the assertions below are untouched.

     `registeredLendingAssets`, not `borrowCurrencies`, and per SIDE. The two
     mappings the facet checks are different — `_isTokenAllowed` for collateral,
     `s_isLoanable` for lending — and on this chain they hold three assets and
     one. The offered list holds four on every chain and gates nothing. */
  const lendingAddress = (side: LendingSide, symbol: string): string => {
    const found = registry
      .registeredLendingAssets(CHAIN, side)
      .assets.find((c: { symbol: string }) => c.symbol === symbol);
    if (!found) throw new Error(`no registered ${side} ${symbol} on ${CHAIN}`);
    return found.address;
  };
  const USDC_LENDING = lendingAddress("collateral", "USDC");
  const USDC_LOANABLE = lendingAddress("loanable", "USDC");
  const ETH_LENDING = lendingAddress("collateral", "ETH");
  const STABLE = registry.stableContracts(CHAIN);
  const POSITION_MANAGER = registry.getContracts(CHAIN).v3PositionManager;

  /*
   * The two addresses the auditor pins per chain, read from the registry.
   *
   * Both are what a correctly-built plan on CHAIN carries, so every well-formed
   * fixture below uses them. Reading rather than pasting matters more here than
   * for the token addresses above: these are the values the pin compares
   * against, so a pasted copy would make the pinning assertions tautological
   * against a constant the auditor no longer consults.
   *
   * Throwing rather than falling back. A missing router or diamond on CHAIN
   * would silently turn the pinned-address cases into "undefined vs undefined"
   * comparisons, which is the exact shape of green-but-asserting-nothing this
   * file exists to avoid — the same reasoning that moved CHAIN off 8453.
   */
  const PINNED_DIAMOND = registry.getContracts(CHAIN).diamond;
  const ROUTER = registry.getContracts(CHAIN).v3Router;
  if (!PINNED_DIAMOND || !ROUTER)
    throw new Error(
      `chain ${CHAIN} has no diamond or v3Router in DEPLOYMENTS, so the ` +
        `pinned-address cases cannot assert anything — pick a chain that does`,
    );

  const nowSec = Math.floor(Date.now() / 1000);
  const soon = nowSec + 30 * 86400;

  const audit = (plan: Step[], overrides: Record<string, unknown> = {}) =>
    auditPlan({
      plan: plan as never,
      chainId: CHAIN,
      limits: LIMITS,
      allowedActions: ALL_ON,
      pricer: stubPricer,
      ...overrides,
    });

  const tokens = chainTokens(CHAIN);
  const usdc = tokens.find((t) => t.symbol === "USDC");
  const eth = tokens.find((t) => t.symbol === "ETH" || t.symbol === "WETH");

  /*
   * A token the app OFFERS on this chain and the lending market has NOT
   * registered — the fixture for "plausible, and still refused".
   *
   * It has been derived twice, and both derivations were wrong in the same
   * direction. It began as `usdc` on the reasoning that Base's canonical USDC is
   * unknown to the lending market; on Sepolia that inverts, because the chain's
   * USDC entry and the market's are deliberately the same contract, so the plan
   * was valid and the assertion wanted a rejection that should not happen. It
   * then became "a chainTokens entry outside borrowCurrencies", which on Sepolia
   * resolves to WETH9 — a token this chain has registered as collateral since
   * 2026-08-23, so the fixture was a token the facet accepts.
   *
   * Drawn from the offered list minus the registered set instead, which is the
   * exact population the audit exists to catch: `borrowCurrencies` names USDT and
   * kfUSD on all five chains, this chain has registered neither, and a plan
   * naming either reverts. Deriving it means the fixture stays a genuine
   * rejection on any chain rather than depending on which entries coincide.
   *
   * Both native sentinels are excluded: they are protocol conventions rather
   * than ERC20s, and the auditor routes them down a different branch.
   */
  const registeredCollateral = new Set(
    registry
      .registeredLendingAssets(CHAIN, "collateral")
      .assets.map((c: { address: string }) => c.address.toLowerCase()),
  );
  const unlistedToken = registry
    .borrowCurrencies(CHAIN)
    .find(
      (t: { address: string }) =>
        !registeredCollateral.has(t.address.toLowerCase()) &&
        t.address.toLowerCase() !== NATIVE_SENTINEL.dex.toLowerCase() &&
        t.address.toLowerCase() !== NATIVE_SENTINEL.lending.toLowerCase(),
    );
  if (!unlistedToken) {
    throw new Error(
      `chain ${CHAIN} offers nothing outside its registered collateral set — the rejection test would assert nothing`,
    );
  }

  /*
   * A token registered as COLLATERAL on this chain and not as loanable — the
   * fixture for the side distinction, which nothing tested before because the
   * auditor had no sides.
   *
   * OPTIONAL, and structurally so. `addLoanableToken` writes `s_priceFeeds` as
   * well as `s_isLoanable` (ProtocolFacet), so anything loanable is collateral
   * too and `loanable ⊆ collateral` holds by construction on every chain. A
   * collateral-only ERC20 can therefore only come from an `addCollateralToken`
   * that was never followed by `addLoanableToken`.
   *
   * That was Sepolia's WETH9 until 2026-08-24, which is what this fixture used to
   * select and what the comment here used to name. Making the wrapped native
   * borrowable on Sepolia, Base and BSC that day — the shape Aave, Compound and
   * Morpho all use, since none of them makes native ETH the internal asset —
   * left `collateral \ loanable` equal to exactly {native sentinel} on all five
   * chains, and the sentinel is excluded just below.
   *
   * So this is a `skip` rather than a `throw`: the assertion is still a real
   * auditor behaviour, the deployment simply no longer contains an asset that
   * exercises it. It re-arms by itself the moment any chain registers a
   * collateral-only ERC20. Fabricating an address instead would test the
   * unregistered-on-both-sides rejection, which `unlistedToken` above already
   * covers, while reading as though it covered this.
   *
   * The native sentinel is excluded because the auditor routes it down a
   * different branch (`wantsNative` in the lending rules), so it would assert a
   * path this check does not name.
   */
  const registeredLoanable = new Set(
    registry
      .registeredLendingAssets(CHAIN, "loanable")
      .assets.map((c: { address: string }) => c.address.toLowerCase()),
  );
  const collateralOnlyToken = registry
    .registeredLendingAssets(CHAIN, "collateral")
    .assets.find(
      (t: { address: string }) =>
        !registeredLoanable.has(t.address.toLowerCase()) &&
        t.address.toLowerCase() !== NATIVE_SENTINEL.lending.toLowerCase(),
    );

  /*
   * A token the lending market HAS registered that kfUSD does not accept as
   * collateral — the fixture for the opposite direction of the same confusion.
   *
   * Derived separately from `collateralOnlyToken`, which it used to borrow. That
   * fixture demands collateral-only, which no chain supplies any more; this
   * assertion needs something strictly weaker and still plentiful — registered on
   * the diamond, absent from kfUSD's own `supportedCollaterals`. Sepolia's WETH9
   * satisfies it both before and after being made loanable, which is exactly why
   * sharing one variable was wrong: a change to the loanable side had no business
   * disarming a kfUSD assertion.
   *
   * kfUSD's set is USDC/USDT/USDe — `stableCollateral` in auditor.ts, mirroring
   * `stableToken` in build.ts — so anything registered outside those three works.
   * Still a hard throw rather than a skip, because unlike the fixture above this
   * one is satisfiable and its absence would mean the registry, not the
   * deployment, had changed shape.
   */
  const kfUSDCollateral = registry.stableContracts(CHAIN);
  const kfUSDAccepts = new Set(
    [kfUSDCollateral.USDC, kfUSDCollateral.USDT, kfUSDCollateral.USDe]
      .filter((a): a is string => Boolean(a))
      .map((a) => a.toLowerCase()),
  );
  const notStableCollateral = registry
    .registeredLendingAssets(CHAIN, "collateral")
    .assets.find(
      (t: { address: string }) =>
        !kfUSDAccepts.has(t.address.toLowerCase()) &&
        t.address.toLowerCase() !== NATIVE_SENTINEL.lending.toLowerCase(),
    );
  if (!notStableCollateral) {
    throw new Error(
      `chain ${CHAIN} registers no lending collateral outside kfUSD's USDC/USDT/USDe set — the kfUSD-collateral test would assert nothing`,
    );
  }

  console.log(
    `\nregistry on chain ${CHAIN}: ${tokens.map((t) => t.symbol).join(", ") || "(empty)"}\n`,
  );

  /* ------------------------------------------------------ fails closed -- */

  {
    const v = await audit([{ kind: "bridgeEverything", amount: "1" }]);
    check(
      "unknown intent kind is rejected",
      !v.ok && v.blocked.some((b) => b.includes("not an auditable action")),
      JSON.stringify(v.blocked),
    );
  }

  {
    const v = await audit([{ kind: "getPortfolio", address: "0x1" }]);
    check(
      "a read tool smuggled in as a plan step is rejected",
      !v.ok,
      JSON.stringify(v.blocked),
    );
  }

  {
    const v = await auditPlan({
      plan: [
        { kind: "swap", tokenIn: "0x1", tokenOut: "0x2", amountIn: "1" },
      ] as never,
      chainId: undefined,
      limits: LIMITS,
      pricer: stubPricer,
    });
    check(
      "no chain id blocks the whole plan",
      !v.ok && v.blocked.some((b) => b.includes("cannot be verified")),
      JSON.stringify(v.blocked),
    );
  }

  {
    const v = await audit([]);
    check("an empty plan passes", v.ok && v.totalUsd === 0);
  }

  /* --------------------------------------------------------- swap shape -- */

  if (!usdc || !eth) {
    console.log(
      "\n  SKIP swap cases: USDC or ETH is not registered on this chain.\n",
    );
  } else {
    const wellFormed: Step = {
      kind: "swap",
      tokenIn: usdc.address,
      tokenOut: eth.address,
      amountIn: "100",
      // 100 USDC at the stub's $3000 ETH is 0.0333; this concedes ~1%.
      amountOutMin: "0.033",
      fee: 3000,
      decimalsIn: usdc.decimals,
      decimalsOut: eth.decimals,
      symbolIn: "USDC",
      symbolOut: eth.symbol,
      /* The router the swap is sent to. Absent from this fixture until the
         `spender` pin existed — which is precisely how a plan carrying one
         chain's tokens and another chain's router used to pass. */
      spender: ROUTER,
    };

    {
      // 0.5% slippage against a floor that concedes ~1% — over the limit, so
      // the baseline "passes" case needs a tolerance that admits it.
      const v = await audit([wellFormed], {
        limits: { ...LIMITS, slippageBps: 200 },
      });
      check(
        "a well-formed swap inside the caps passes",
        v.ok,
        JSON.stringify(v.blocked),
      );
    }

    {
      const { amountOutMin: _drop, ...noFloor } = wellFormed;
      const v = await audit([noFloor]);
      check(
        "a swap with no amountOutMin is rejected",
        !v.ok && v.blocked.some((b) => b.includes("minimum output")),
        JSON.stringify(v.blocked),
      );
    }

    /*
     * The cross-chain mix, which used to pass.
     *
     * This is the regression case for a measured defect, not a hypothetical.
     * `serverPlanDeps` pinned its reads to READ_ONLY_CHAIN_ID while token
     * symbols resolved against the wallet's chain, so a swap on Base Sepolia was
     * built with Base's USDC, Base's WETH and Sepolia's router — and passed,
     * because the token rules are chain-scoped and nothing looked at the
     * contract in between.
     *
     * Both halves are asserted, because only checking the pin would leave the
     * suite unable to tell "the pin works" from "everything is rejected now".
     * The other chain is read from DEPLOYMENTS rather than invented: a random
     * address would test `isAddress` and not the pin.
     */
    {
      const other = Object.entries(registry.DEPLOYMENTS).find(
        ([id, c]) => Number(id) !== CHAIN && c.v3Router,
      );
      if (!other) {
        skip(
          "a swap carrying another chain's router is rejected",
          "no second chain in DEPLOYMENTS has a v3Router to borrow",
        );
      } else {
        const [otherId, otherContracts] = other;
        const v = await audit([
          { ...wellFormed, spender: otherContracts.v3Router },
        ]);
        check(
          `a swap carrying chain ${otherId}'s router is rejected`,
          !v.ok && v.blocked.some((b) => b.includes("spender")),
          JSON.stringify(v.blocked),
        );

        const a = await audit([
          {
            kind: "approve",
            token: usdc.address,
            spender: otherContracts.v3Router,
            amount: "100",
            decimals: usdc.decimals,
            symbol: "USDC",
          },
        ]);
        check(
          `an approve granting allowance to chain ${otherId}'s router is rejected`,
          !a.ok && a.blocked.some((b) => b.includes("spender")),
          JSON.stringify(a.blocked),
        );
      }
    }

    {
      /* A swap with no spender at all. The catalogue never asks the model for
         one — the builder fills it from the registry — so this is what arrives
         when the builder could not resolve a router for the chain. */
      const { spender: _drop, ...noRouter } = wellFormed;
      const v = await audit([noRouter]);
      check(
        "a swap with no router is rejected",
        !v.ok && v.blocked.some((b) => b.includes("spender")),
        JSON.stringify(v.blocked),
      );
    }

    {
      // The catalog never asks the model for decimals, so this is the shape a
      // real plan actually arrives in.
      const { decimalsIn: _drop, ...noDecimals } = wellFormed;
      const v = await audit([noDecimals]);
      check(
        "a swap with missing decimals is rejected",
        !v.ok && v.blocked.some((b) => b.includes("decimals")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([
        {
          ...wellFormed,
          tokenOut: "0xdEaDBeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF",
        },
      ]);
      check(
        "a hallucinated token address is rejected",
        !v.ok && v.blocked.some((b) => b.includes("unrecognised output token")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([{ ...wellFormed, tokenOut: usdc.address }]);
      check(
        "a swap from a token to itself is rejected",
        !v.ok && v.blocked.some((b) => b.includes("same")),
        JSON.stringify(v.blocked),
      );
    }

    {
      // A floor of a billionth satisfies "a floor exists" and concedes all of it.
      const v = await audit([{ ...wellFormed, amountOutMin: "0.000000001" }]);
      check(
        "a nominal amountOutMin is caught by the slippage check",
        !v.ok && v.blocked.some((b) => b.includes("slippage")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([{ ...wellFormed, amountIn: "0" }]);
      check(
        "a zero-amount swap is rejected",
        !v.ok && v.blocked.some((b) => b.includes("not positive")),
        JSON.stringify(v.blocked),
      );
    }

    /* ------------------------------------------------------------ caps -- */

    {
      const v = await audit([
        { ...wellFormed, amountIn: "5000", amountOutMin: "1.65" },
      ]);
      check(
        "a swap over the per-action cap is rejected",
        !v.ok && v.blocked.some((b) => b.includes("per-action limit")),
        JSON.stringify(v.blocked),
      );
    }

    {
      // The client raising its own ceiling must not work.
      const v = await audit(
        [{ ...wellFormed, amountIn: "60000", amountOutMin: "19.8" }],
        { limits: { ...LIMITS, maxPerAction: 1e12, slippageBps: 200 } },
      );
      check(
        "a client-supplied cap above the hard ceiling does not raise it",
        !v.ok && v.blocked.some((b) => b.includes("per-action limit")),
        `HARD_MAX=${HARD_MAX_NOTIONAL_USD} ${JSON.stringify(v.blocked)}`,
      );
    }

    {
      const v = await audit([wellFormed], {
        allowedActions: { ...ALL_ON, swap: false },
      });
      check(
        "a product switched off in settings is rejected",
        !v.ok && v.blocked.some((b) => b.includes("switched off")),
        JSON.stringify(v.blocked),
      );
    }

    {
      // Two legs, each under the per-action cap, together over the daily one.
      const leg = { ...wellFormed, amountIn: "900", amountOutMin: "0.29" };
      const v = await audit([leg, leg, leg, leg, leg, leg, leg], {
        limits: { ...LIMITS, slippageBps: 300 },
      });
      check(
        "steps under the per-action cap can still breach the daily one",
        !v.ok && v.blocked.some((b) => b.includes("daily limit")),
        JSON.stringify(v.blocked),
      );
    }
  }

  /* ---------------------------------------------------------------------- *
   * Send
   *
   * The one kind whose recipient a model supplies, and the one kind with no
   * contract on the far side to reject a mistake. Every other rule in this
   * suite is a second line in front of a revert; these cases are the only
   * line, so they assert the specific refusal rather than merely `!v.ok` —
   * a send blocked for the wrong reason is a send whose real defect is
   * unchecked.
   * ---------------------------------------------------------------------- */

  /*
   * A plausible counterparty wallet, and the same address with every hex letter
   * case-flipped.
   *
   * Both pasted rather than derived, because unlike a contract address neither
   * can move: this is nobody's wallet and the second is permanently invalid.
   * They were produced by `ethers.getAddress()` and its inverse, and the pairing
   * is what the checksum case below tests — desynchronise them and that check
   * fails loudly rather than passing on a technicality.
   *
   * Case is the whole point. EIP-55 puts an address's checksum in the
   * capitalisation of its hex digits, so RECIPIENT_MISCASED differs from a valid
   * address in nothing a regex would see.
   */
  const RECIPIENT = "0x5A3c9F1e8b7d64A209Fe3B18c7d05E4A6f2B91D3";
  const RECIPIENT_MISCASED = "0x5a3C9f1E8B7D64a209fE3b18C7D05e4a6F2b91d3";

  if (!usdc) {
    console.log("\n  SKIP send cases: USDC is not registered on this chain.\n");
  } else {
    const send: Step = {
      kind: "transfer",
      token: usdc.address,
      to: RECIPIENT,
      amount: "100",
      decimals: usdc.decimals,
      symbol: usdc.symbol,
    };

    {
      const v = await audit([send]);
      check(
        "a well-formed send passes and says the address cannot be verified",
        v.ok && v.notes.some((n) => n.includes("cannot be reversed")),
        JSON.stringify({ blocked: v.blocked, notes: v.notes }),
      );
    }

    {
      /* The documented ungated position, pinned. `ACTION_OF.transfer` is ""
         because useAgentSettings ships no wallet switch, so every product being
         off must not read as a send being off — and if a later edit borrows
         `swap`'s toggle to look covered, this fails. */
      const v = await audit([send], {
        allowedActions: {
          swap: false,
          borrow: false,
          lend: false,
          stake: false,
          provideLiquidity: false,
        },
      });
      check(
        "a send is not gated by any product toggle",
        v.ok,
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([{ ...send, to: "0x1234" }]);
      check(
        "a malformed recipient is rejected",
        !v.ok && v.blocked.some((b) => b.includes("not a valid address")),
        JSON.stringify(v.blocked),
      );
    }

    {
      /* The failure mode the whole rule exists for: 42 well-formed characters,
         one of them wrong. Only the checksum separates this from a real
         address, and only mixed case makes the checksum testable at all. */
      const v = await audit([{ ...send, to: RECIPIENT_MISCASED }]);
      check(
        "a recipient whose EIP-55 checksum fails is rejected",
        !v.ok && v.blocked.some((b) => b.includes("not a valid address")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([
        { ...send, to: "0x0000000000000000000000000000000000000000" },
      ]);
      check(
        "a send to the zero address is rejected",
        !v.ok && v.blocked.some((b) => b.includes("zero address")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([{ ...send, to: NATIVE_SENTINEL.dex }]);
      check(
        "a send to the DEX native sentinel is rejected",
        !v.ok &&
          v.blocked.some((b) => b.includes("dex native-currency sentinel")),
        JSON.stringify(v.blocked),
      );
    }

    {
      /* ADDRESS_1, which is also the ecrecover precompile. Not in Base's token
         registry, so the sentinel rule is the only thing that catches it. */
      const v = await audit([{ ...send, to: NATIVE_SENTINEL.lending }]);
      check(
        "a send to the lending native sentinel is rejected",
        !v.ok &&
          v.blocked.some((b) => b.includes("lending native-currency sentinel")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([{ ...send, to: usdc.address }]);
      check(
        "a send to the token's own contract is rejected",
        !v.ok && v.blocked.some((b) => b.includes("token's own contract")),
        JSON.stringify(v.blocked),
      );
    }

    {
      /* A different registered token — the "pasted the wrong address" case that
         the token's-own-contract rule above does not cover. */
      const other = tokens.find(
        (t) =>
          t.address.toLowerCase() !== usdc.address.toLowerCase() &&
          t.address.toLowerCase() !== NATIVE_SENTINEL.dex.toLowerCase(),
      );
      if (!other) {
        console.log("\n  SKIP other-token case: no second token registered.\n");
      } else {
        const v = await audit([{ ...send, to: other.address }]);
        check(
          `a send to the ${other.symbol} contract is rejected`,
          !v.ok &&
            v.blocked.some((b) => b.includes("token contract, not a wallet")),
          JSON.stringify(v.blocked),
        );
      }
    }

    {
      /* Our own diamond, read from the env value this file set before importing
         the auditor — the same path `protocolAddresses()` reads. */
      const v = await audit([{ ...send, to: DIAMOND }]);
      check(
        "a send into the Kaleido diamond is rejected",
        !v.ok && v.blocked.some((b) => b.includes("Kaleido diamond")),
        JSON.stringify(v.blocked),
      );
    }

    {
      /* And one taken from the registry rather than an env var, so the check
         covers both halves of protocolAddresses(). */
      const v = await audit([{ ...send, to: POSITION_MANAGER }]);
      check(
        "a send into the V3 position manager is rejected",
        !v.ok &&
          v.blocked.some((b) =>
            b.includes("no way to return funds sent to it"),
          ),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([{ ...send, to: STABLE.kfUSD }]);
      check(
        "a send into the kfUSD contract is rejected",
        !v.ok &&
          v.blocked.some((b) =>
            b.includes("no way to return funds sent to it"),
          ),
        JSON.stringify(v.blocked),
      );
    }

    {
      /* 18 on a 6-decimal token asks for 10^12 times the intended amount. No
         callee rejects it, so this rule is the only thing that does. */
      const v = await audit([{ ...send, decimals: 18 }]);
      check(
        "declared decimals that disagree with the registry are rejected",
        !v.ok && v.blocked.some((b) => b.includes(`but ${usdc.symbol} has`)),
        JSON.stringify(v.blocked),
      );
    }

    {
      const { decimals: _drop, ...noDecimals } = send;
      const v = await audit([noDecimals]);
      check(
        "a send with no decimals is rejected",
        !v.ok && v.blocked.some((b) => b.includes("decimals are missing")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([{ ...send, isNative: true }]);
      check(
        "isNative on an ERC20 send is rejected",
        !v.ok && v.blocked.some((b) => b.includes("not the native currency")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([
        { ...send, token: "0xdEaDBeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF" },
      ]);
      check(
        "a send of an unregistered token is rejected",
        !v.ok && v.blocked.some((b) => b.includes("unrecognised token")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([{ ...send, amount: "0" }]);
      check(
        "a zero-amount send is rejected",
        !v.ok && v.blocked.some((b) => b.includes("not positive")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([{ ...send, amount: "5000" }]);
      check(
        "a send over the per-action cap is rejected",
        !v.ok && v.blocked.some((b) => b.includes("per-action limit")),
        JSON.stringify(v.blocked),
      );
    }

    /* The native branch. Its token address is a sentinel rather than a
       contract, so `isNative` is what picks between a bare value transaction
       and a call to a token that does not exist at that address. */
    const native = tokens.find(
      (t) => t.address.toLowerCase() === NATIVE_SENTINEL.dex.toLowerCase(),
    );
    if (!native) {
      console.log("\n  SKIP native send cases: no native token registered.\n");
    } else {
      const nativeSend: Step = {
        kind: "transfer",
        token: native.address,
        to: RECIPIENT,
        amount: "0.1",
        decimals: native.decimals,
        symbol: native.symbol,
        isNative: true,
      };

      {
        const v = await audit([nativeSend]);
        check(
          `a well-formed native ${native.symbol} send passes`,
          v.ok,
          JSON.stringify(v.blocked),
        );
      }

      {
        const { isNative: _drop, ...noFlag } = nativeSend;
        const v = await audit([noFlag]);
        check(
          "a native send with no isNative flag is rejected",
          !v.ok &&
            v.blocked.some((b) =>
              b.includes("isNative is not set on a native-currency send"),
            ),
          JSON.stringify(v.blocked),
        );
      }
    }
  }

  /* -------------------------------------------------------------- bridge -- *
   * A cross-chain move. Send's sibling, and audited like one: the transaction
   * goes to a portal or an aggregator router, never the diamond, so
   * LibAgentPermission cannot bound it and the per-action cap plus the bridge
   * rule are the only line. The native fixture is the canonical Sepolia ->
   * Base Sepolia corridor, which route.ts encodes with no network call; the ERC20
   * one is hand-shaped, since an aggregator route would need a live quote. Every
   * assertion here is deterministic and offline either way.
   * ---------------------------------------------------------------------- */

  {
    /* The L1 standard-bridge portal for 11155111 -> 84532, the address route.ts
       builds a canonical deposit against. Pasted rather than derived because
       there is no "canonical target for this corridor" export to read — but a
       wrong paste cannot pass silently: the well-formed case below asserts the
       auditor RECOGNISES it, so a stale address fails that check loudly. */
    const PORTAL = "0xfd0Bf71F60660E2f608ed56e1659C450eB113120";
    const bridgeNative = tokens.find(
      (t) => t.address.toLowerCase() === NATIVE_SENTINEL.dex.toLowerCase(),
    );

    if (!bridgeNative) {
      console.log("\n  SKIP bridge cases: no native token registered.\n");
    } else {
      const bridge: Step = {
        kind: "bridge",
        token: bridgeNative.address,
        amount: "0.05",
        decimals: bridgeNative.decimals,
        symbol: bridgeNative.symbol,
        isNative: true,
        to: PORTAL,
        data: "0x",
        value: "50000000000000000", // 0.05e18 wei; matches amount to the wei
        fromChainId: CHAIN,
        toChainId: 84532,
        toChainName: "Base Sepolia",
        provider: "canonical",
      };

      {
        const v = await audit([bridge]);
        check(
          `a well-formed native ${bridgeNative.symbol} bridge passes and flags the unbounded hop`,
          v.ok &&
            v.notes.some((n) => n.includes("no on-chain permission bounds it")),
          JSON.stringify({ blocked: v.blocked, notes: v.notes }),
        );
      }

      {
        /* Ungated, and pinned like the send case above: ACTION_OF.bridge is ""
           because there is no wallet-level switch for it, so every product being
           off must not read as a bridge being off. */
        const v = await audit([bridge], {
          allowedActions: {
            swap: false,
            borrow: false,
            lend: false,
            stake: false,
            provideLiquidity: false,
          },
        });
        check(
          "a bridge is not gated by any product toggle",
          v.ok,
          JSON.stringify(v.blocked),
        );
      }

      {
        /* 1 ETH is $3000 at the stub price, over the $1000 per-action cap. The
           value rides the amount so both move together — this is the cap doing
           its job on a transaction no on-chain permission can. */
        const v = await audit([
          { ...bridge, amount: "1", value: "1000000000000000000" },
        ]);
        check(
          "a bridge over the per-action cap is rejected",
          !v.ok && v.blocked.some((b) => b.includes("per-action limit")),
          JSON.stringify(v.blocked),
        );
      }

      {
        /* The flag that picks a bare value transaction over a token call, unset.
           Same refusal the native send has, for the same reason. */
        const { isNative: _drop, ...noFlag } = bridge;
        const v = await audit([noFlag]);
        check(
          "a native bridge with no isNative flag is rejected",
          !v.ok &&
            v.blocked.some((b) =>
              b.includes("isNative is not set on a native-currency bridge"),
            ),
          JSON.stringify(v.blocked),
        );
      }

      {
        const v = await audit([{ ...bridge, provider: "wormhole" }]);
        check(
          "an unrecognised bridge provider is rejected",
          !v.ok &&
            v.blocked.some((b) =>
              b.includes('unrecognised bridge provider "wormhole"'),
            ),
          JSON.stringify(v.blocked),
        );
      }

      {
        /* A well-formed address that is not the corridor's portal. provider is
           still canonical, so the rule re-checks `to` against the very table
           route.ts built it from and finds it absent — the check that a
           canonical `to` actually came from the resolver. */
        const v = await audit([{ ...bridge, to: RECIPIENT }]);
        check(
          "a canonical bridge to an address outside the table is rejected",
          !v.ok &&
            v.blocked.some((b) =>
              b.includes("canonical bridge address is not one recognised"),
            ),
          JSON.stringify(v.blocked),
        );
      }

      {
        /* Built for a chain the wallet is not on. The plan is signed on CHAIN; a
           source that is not CHAIN means the route was resolved elsewhere. */
        const v = await audit([{ ...bridge, fromChainId: 84532 }]);
        check(
          "a bridge whose source chain is not the connected chain is rejected",
          !v.ok &&
            v.blocked.some((b) =>
              b.includes("source chain is not the connected chain"),
            ),
          JSON.stringify(v.blocked),
        );
      }

      {
        const v = await audit([{ ...bridge, toChainId: CHAIN }]);
        check(
          "a bridge whose destination equals its source is rejected",
          !v.ok &&
            v.blocked.some((b) =>
              b.includes("source and destination chains are the same"),
            ),
          JSON.stringify(v.blocked),
        );
      }

      {
        const { toChainId: _drop, ...noDest } = bridge;
        const v = await audit([noDest]);
        check(
          "a bridge with no destination chain is rejected",
          !v.ok &&
            v.blocked.some((b) => b.includes("missing its destination chain")),
          JSON.stringify(v.blocked),
        );
      }

      {
        /* value and amount derive from one number in the resolver, so a gap past
           rounding means the row misstates what actually leaves the wallet —
           here the value is ten times the amount shown. */
        const v = await audit([{ ...bridge, value: "500000000000000000" }]);
        check(
          "a bridge whose value disagrees with its amount is rejected",
          !v.ok &&
            v.blocked.some(
              (b) => b.includes("the row shows") && b.includes("is being sent"),
            ),
          JSON.stringify(v.blocked),
        );
      }

      if (usdc) {
        /* ------------------------------------------------ the ERC20 leg -- *
         * A token bridge, which the auditor now admits. It is the one plan in
         * this file that grants an allowance to a contract Kaleido did not
         * deploy, so the cases below are about exactly that: the router must be
         * the one address the allowlist holds, AND it must be the contract this
         * transaction calls. The second is the check the approve rule cannot
         * make — rules see one step at a time — so it is asserted here, where
         * `spender` and `to` sit side by side.
         *
         * The router is pasted, like PORTAL above, because there is no per-chain
         * export to read; and like PORTAL, a stale paste cannot pass quietly —
         * the first case runs it back through `isKnownBridgeSpender`, and the
         * unrecognised-router case below proves the allowlist rejects something.
         *
         * `value: "0"` and no amount/value tie: a token moves by allowance, so
         * there is no native figure to cross-check the row against. What stands
         * in for it is a note, asserted here rather than assumed.
         * ------------------------------------------------------------------ */
        const ROUTER = "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE";
        const erc20Bridge: Step = {
          ...bridge,
          token: usdc.address,
          symbol: usdc.symbol,
          decimals: usdc.decimals,
          isNative: false,
          provider: "lifi",
          to: ROUTER,
          spender: ROUTER,
          data: "0xdeadbeef",
          value: "0",
        };

        {
          const v = await audit([erc20Bridge]);
          check(
            `a well-formed ${usdc.symbol} bridge passes, with its router on the allowlist`,
            v.ok && isKnownBridgeSpender(ROUTER),
            JSON.stringify({ blocked: v.blocked, notes: v.notes }),
          );
          /* The honesty requirement the Shape.notes doctrine exists for: this
             rule prices the row's amount but never reads the figure inside the
             provider's calldata, and the plan must say so rather than let an
             unchecked amount read as a checked one. */
          check(
            "and says plainly that the amount inside the calldata was not read",
            v.notes.some(
              (n) =>
                n.includes("inside the provider's calldata") &&
                n.includes("the paired approval is what limits it"),
            ),
            JSON.stringify(v.notes),
          );
        }

        {
          /* No router at all. The bridge step's calldata would pull a token it
             holds no allowance for, so there is nothing safe to sign. */
          const { spender: _drop, ...noRouter } = erc20Bridge;
          const v = await audit([noRouter]);
          check(
            "a token bridge with no router to approve is rejected",
            !v.ok &&
              v.blocked.some((b) =>
                b.includes("missing its router to approve"),
              ),
            JSON.stringify(v.blocked),
          );
        }

        {
          /* A well-formed address that is not the allow-listed router, named as
             BOTH the spender and the call target so the pairing check cannot be
             what trips. This is the allowlist itself doing the work: an approve
             is the one step whose mistake survives the transaction, because the
             allowance is a storage write the token makes without ever consulting
             the address it empowers. */
          const v = await audit([
            { ...erc20Bridge, to: RECIPIENT, spender: RECIPIENT },
          ]);
          check(
            "a token bridge through an unrecognised router is rejected",
            !v.ok &&
              v.blocked.some((b) =>
                b.includes(
                  "router being approved is not one this app recognises",
                ),
              ),
            JSON.stringify(v.blocked),
          );
        }

        {
          /* Both addresses allow-listed-shaped, and the allowance split off the
             call: `spender` is the router, `to` is somewhere else. Neither the
             approve rule nor the allowlist can see this — only this rule can,
             and it is the reason the resolver's equality check is re-made here. */
          const v = await audit([{ ...erc20Bridge, to: PORTAL }]);
          check(
            "a token bridge whose allowance goes somewhere other than what it calls is rejected",
            !v.ok &&
              v.blocked.some((b) =>
                b.includes(
                  "router being approved is not the contract this bridge calls",
                ),
              ),
            JSON.stringify(v.blocked),
          );
        }

        {
          /* Native value riding beside a token bridge: a second charge in a row
             shaped to show one, and outside the amount the summary names. */
          const v = await audit([
            { ...erc20Bridge, value: "50000000000000000" },
          ]);
          check(
            "a token bridge that also attaches native value is rejected",
            !v.ok &&
              v.blocked.some((b) => b.includes("must attach no native value")),
            JSON.stringify(v.blocked),
          );
        }

        {
          /* A token through the canonical portal. Not a policy refusal: an
             L1StandardBridge ERC20 deposit needs the destination token to be the
             mintable representation the factory paired with the L1 one, and our
             testnet mocks are independent deployments — so the tokens would land
             in a representation nobody can mint. */
          const v = await audit([
            {
              ...erc20Bridge,
              provider: "canonical",
              to: PORTAL,
              spender: PORTAL,
            },
          ]);
          check(
            "a token through the canonical portal is rejected as native-only",
            !v.ok &&
              v.blocked.some((b) =>
                b.includes("canonical portal deposit is native-currency only"),
              ),
            JSON.stringify(v.blocked),
          );
        }

        {
          /* The paired approve, audited alone — which is how the rules see it.
             It passes, because the router is the one outside address this app
             authorises, and it carries a note saying so: an allowance to a
             third party must never read like an allowance to our own diamond. */
          const v = await audit([
            {
              kind: "approve",
              token: usdc.address,
              spender: ROUTER,
              amount: "100",
              decimals: usdc.decimals,
              symbol: usdc.symbol,
            },
          ]);
          check(
            "an approve to the bridge router passes, and is flagged as an outside address",
            v.ok &&
              v.notes.some((n) =>
                n.includes("approves a bridge provider's router"),
              ),
            JSON.stringify({ blocked: v.blocked, notes: v.notes }),
          );
        }
      }
    }
  }

  /* ------------------------------------------------------------ unpriced -- */

  /* The pre-TGE case, in the only form this repo can currently express it.
     KLD is the real motivation — no market before TGE, so points/prices returns
     null for it by design — but DEPLOYMENTS is empty, so KLD has no address on
     any chain and cannot appear in a plan at all yet. cbBTC stands in: a
     registered, real token that the stub has no price for, which is the same
     code path. Swap it for KLD once a deployment lands. */
  {
    const unpriced = tokens.find((t) => t.symbol === "cbBTC");
    if (!unpriced) {
      console.log("\n  SKIP unpriced case: no unpriced token registered.\n");
    } else {
      const v = await audit([
        {
          kind: "approve",
          token: unpriced.address,
          /* The chain's real router, not an arbitrary address. This case is
             about an unpriced asset, so every other field has to be one the
             auditor accepts or the assertion would pass for the wrong reason. */
          spender: ROUTER,
          amount: "1000000",
          decimals: unpriced.decimals,
          symbol: unpriced.symbol,
        },
      ]);
      check(
        "an unpriced asset passes but is reported as uncapped",
        v.ok && v.notes.some((n) => n.includes("no USD price")),
        JSON.stringify({ blocked: v.blocked, notes: v.notes }),
      );
    }
  }

  /* --------------------------------------------------------- delegation -- */

  {
    const grant: Step = {
      kind: "grantAgentPermission",
      diamond: "0x1111111111111111111111111111111111111111",
      agent: "0x2222222222222222222222222222222222222222",
      maxNotionalPerAction: "500",
      maxNotionalPerEpoch: "2000",
      epochDurationSec: 86400,
      expiryUnix: nowSec + 7 * 86400,
      minHealthFactorBps: 15000,
      allowedActions: 1,
      tokens: [],
    };

    {
      const v = await audit([grant]);
      check(
        "a bounded permission grant passes",
        v.ok,
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([{ ...grant, expiryUnix: nowSec - 10 }]);
      check(
        "an already-expired grant is rejected",
        !v.ok && v.blocked.some((b) => b.includes("expiry")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([
        { ...grant, expiryUnix: nowSec + 5 * 365 * 86400 },
      ]);
      check(
        "a five-year grant is rejected",
        !v.ok && v.blocked.some((b) => b.includes("over a year")),
        JSON.stringify(v.blocked),
      );
    }

    {
      // 1.2 expressed as bps, against the user's 1.4 floor.
      const v = await audit([{ ...grant, minHealthFactorBps: 12000 }]);
      check(
        "a grant looser than the user's health floor is rejected",
        !v.ok && v.blocked.some((b) => b.includes("health floor")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([{ ...grant, agent: "not-an-address" }]);
      check(
        "a grant to a malformed agent address is rejected",
        !v.ok && v.blocked.some((b) => b.includes("agent")),
        JSON.stringify(v.blocked),
      );
    }
  }

  /* ---------------------------------------------------------------------- *
   * Every intent kind has a rule
   *
   * This is the regression test for a bug that had already shipped into the
   * tree: `auditPlan` gated on `EXECUTE_TOOLS.has(kind)`, a set of TOOL names,
   * while the plan it audits carries INTENT kinds. The two vocabularies were
   * the same thing back when a provider spread a tool call into
   * `{kind: toolName, ...args}`, and stopped being the same thing when tools
   * became thin verbs — `deposit` the verb builds `depositCollateral` the
   * intent. Only four names still coincided, so nearly every built plan was
   * refused as "not an auditable action".
   *
   * It failed closed, which is why it was a refusal and not a hole. But a
   * guardrail that rejects everything is indistinguishable from one that is
   * broken, and this asserts the difference: each kind must reach its own rule
   * and be judged on its fields. The steps below are deliberately empty, so
   * every one of them SHOULD be blocked — just never for that reason.
   * ---------------------------------------------------------------------- */

  {
    const KINDS = [
      "approve",
      "swap",
      "stake",
      "transfer",
      "bridge",
      "depositCollateral",
      "withdrawCollateral",
      "repayLoan",
      "createLendingRequest",
      "createLoanListing",
      "borrowFromListing",
      "fillRequest",
      "closeListing",
      "closeRequest",
      "mintStable",
      "redeemStable",
      "lockStable",
      "requestStableWithdrawal",
      "completeStableWithdrawal",
      "claimStableYield",
      "compoundStableYield",
      "collectPoolFees",
      "decreasePoolLiquidity",
      "grantAgentPermission",
    ];

    const unruled: string[] = [];
    for (const kind of KINDS) {
      const v = await audit([{ kind }]);
      if (v.blocked.some((b) => b.includes("not an auditable action")))
        unruled.push(kind);
    }
    check(
      `all ${KINDS.length} intent kinds reach a rule`,
      unruled.length === 0,
      `no rule for: ${unruled.join(", ")}`,
    );
  }

  /* ---------------------------------------------------------------------- *
   * Lending
   *
   * Addresses here are checked against BORROW_CURRENCIES, not the chain token
   * registry: the facet accepts five addresses and reverts on everything else,
   * so "a real token, but not one this market has" is precisely the plan worth
   * refusing — and it is the plan a model is most likely to produce, because a
   * plausible token is exactly what a plausible answer needs.
   * ---------------------------------------------------------------------- */

  {
    const deposit: Step = {
      kind: "depositCollateral",
      diamond: PINNED_DIAMOND,
      token: USDC_LENDING,
      amount: "100",
      decimals: 6,
      symbol: "USDC",
    };

    {
      const v = await audit([deposit]);
      check(
        "a well-formed collateral deposit passes",
        v.ok,
        JSON.stringify(v.blocked),
      );
    }

    {
      // Offered by the app on this chain, registered on the market on none of
      // it. This is the plan the old rule passed.
      const v = await audit([{ ...deposit, token: unlistedToken.address }]);
      check(
        "a token the lending market has not registered is rejected",
        !v.ok &&
          v.blocked.some((b) => b.includes("not registered as collateral")),
        `${unlistedToken.symbol} ${JSON.stringify(v.blocked)}`,
      );
      check(
        "and the rejection names what this chain did register",
        !v.ok &&
          v.blocked.some((b) =>
            b.includes(
              registry
                .registeredLendingAssets(CHAIN, "collateral")
                .assets.map((a: { symbol: string }) => a.symbol)
                .join(", "),
            ),
          ),
        JSON.stringify(v.blocked),
      );
    }

    {
      /* The union, and the reason for it. `addLoanableToken` writes
         `s_priceFeeds` as well as `s_isLoanable` (ProtocolFacet.sol:533-539), so
         a loanable token is depositable whether or not it is in
         `s_collateralToken` — validating a deposit against the collateral array
         alone would refuse one the facet accepts. */
      const loanable = registry.registeredLendingAssets(CHAIN, "loanable")
        .assets[0];
      // `assets[0]` is WETH here: the array's old first entry (Circle USDC) is
      // still registered on the diamond but is no longer a named token — the app
      // ships a mintable mock USDC in its place — so it drops out of the named
      // set and WETH leads. 100 units of a $3000 asset would trip the $1000
      // per-action cap, and that is a spend-limit refusal, not the "not
      // collateral" refusal this test is about. Deposit a fixed ~$300 of
      // whatever the first loanable asset is so the collateral check is the only
      // thing that can fail; `.toFixed(4)` keeps the amount parseable at both 6-
      // and 18-decimal precision.
      const loanableAmount = (300 / (PRICES[loanable.symbol] ?? 1)).toFixed(4);
      const v = await audit([
        {
          ...deposit,
          token: loanable.address,
          decimals: loanable.decimals,
          symbol: loanable.symbol,
          amount: loanableAmount,
        },
      ]);
      check(
        "a loanable asset is accepted as collateral too — addLoanableToken writes the feed",
        v.ok,
        `${loanable.symbol} ${JSON.stringify(v.blocked)}`,
      );
    }

    {
      // USDC read as 18 rather than 6 misparses by 10^12.
      const v = await audit([{ ...deposit, decimals: 18 }]);
      check(
        "declared decimals that disagree with the registry are rejected",
        !v.ok && v.blocked.some((b) => b.includes("USDC has 6")),
        JSON.stringify(v.blocked),
      );
    }

    {
      // A token flagged native would be sent as value, with no accounting.
      const v = await audit([{ ...deposit, isNative: true }]);
      check(
        "isNative on an ERC20 collateral deposit is rejected",
        !v.ok && v.blocked.some((b) => b.includes("isNative")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([
        {
          ...deposit,
          token: ETH_LENDING,
          symbol: "ETH",
          decimals: 18,
          amount: "0.1",
          isNative: true,
        },
      ]);
      check(
        "a native ETH deposit against the lending sentinel passes",
        v.ok,
        JSON.stringify(v.blocked),
      );
    }

    {
      // The pin. A different valid address is not the app's Diamond.
      const v = await audit([
        { ...deposit, diamond: "0xbad0000000000000000000000000000000000001" },
      ]);
      check(
        "a deposit to the wrong diamond is rejected",
        !v.ok && v.blocked.some((b) => b.includes("diamond")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([deposit], {
        allowedActions: { ...ALL_ON, borrow: false },
      });
      check(
        "collateral deposit respects the borrow toggle",
        !v.ok && v.blocked.some((b) => b.includes("switched off")),
        JSON.stringify(v.blocked),
      );
    }
  }

  {
    const withdraw: Step = {
      kind: "withdrawCollateral",
      diamond: PINNED_DIAMOND,
      token: USDC_LENDING,
      amount: "100",
      decimals: 6,
      symbol: "USDC",
    };

    /* The health floor cannot be checked without reading the position, and
       these rules are synchronous by design. So it is surfaced, not enforced —
       and the point of the test is that an unverifiable check is visible rather
       than silently absent. */
    const v = await audit([withdraw]);
    check(
      "a collateral withdrawal passes but flags the health-factor risk",
      v.ok && v.notes.some((n) => n.includes("health factor")),
      JSON.stringify({ blocked: v.blocked, notes: v.notes }),
    );
  }

  {
    /* Base units, and the whole figure. A human-rounded repayment underpays and
       leaves the loan open, which is the entire reason the intent carries both
       a raw amount and a display amount. */
    const repay: Step = {
      kind: "repayLoan",
      diamond: PINNED_DIAMOND,
      requestId: 7,
      amountRaw: "100000000", // 100 USDC at 6dp
      amount: "100",
      symbol: "USDC",
    };

    {
      const v = await audit([repay]);
      check("a well-formed repayment passes", v.ok, JSON.stringify(v.blocked));
    }

    {
      const v = await audit([{ ...repay, amountRaw: "100.5" }]);
      check(
        "a repayment in human units rather than base units is rejected",
        !v.ok && v.blocked.some((b) => b.includes("base-unit")),
        JSON.stringify(v.blocked),
      );
    }

    {
      // What the user reads is not what the contract is sent.
      const v = await audit([{ ...repay, amount: "1" }]);
      check(
        "a repayment whose displayed amount contradicts the raw one is rejected",
        !v.ok && v.blocked.some((b) => b.includes("does not match")),
        JSON.stringify(v.blocked),
      );
    }

    {
      /* Repaying is an exit. Gating it on the borrow toggle would leave a user
         who switched borrowing off unable to clear a debt they already owe —
         worse off than if the agent had done nothing. */
      const v = await audit([repay], {
        allowedActions: { ...ALL_ON, borrow: false },
      });
      check(
        "repaying is not blocked by the borrow toggle",
        v.ok,
        JSON.stringify(v.blocked),
      );
    }
  }

  {
    const request: Step = {
      kind: "createLendingRequest",
      diamond: PINNED_DIAMOND,
      token: USDC_LOANABLE,
      amount: "500",
      decimals: 6,
      symbol: "USDC",
      interestPct: 5,
      returnDate: soon,
    };

    {
      const v = await audit([request]);
      check(
        "a well-formed borrow request passes",
        v.ok,
        JSON.stringify(v.blocked),
      );
    }

    if (!collateralOnlyToken) {
      skip(
        "borrowing a collateral-only asset is rejected on the loanable side",
        `chain ${CHAIN} has no collateral-only ERC20 — see the fixture note above`,
      );
    } else {
      /* The side distinction, which the auditor could not express before: an
         asset the market takes as collateral and refuses as a borrow currency,
         where createLendingRequest reverts Protocol__TokenNotLoanable — and the
         old rule, reading the offered list, did not even have it in scope to
         accept or refuse. WETH9 on Sepolia was the case until it was made
         loanable on 2026-08-24; hence the guard. */
      const v = await audit([
        {
          ...request,
          token: collateralOnlyToken.address,
          decimals: collateralOnlyToken.decimals,
          symbol: collateralOnlyToken.symbol,
        },
      ]);
      check(
        "borrowing a collateral-only asset is rejected on the loanable side",
        !v.ok &&
          v.blocked.some((b) =>
            b.includes("not registered as lendable/borrowable"),
          ),
        `${collateralOnlyToken.symbol} ${JSON.stringify(v.blocked)}`,
      );
    }

    {
      // 5% meant, 500 emitted — indistinguishable from intent by shape alone.
      const v = await audit([{ ...request, interestPct: 500 }]);
      check(
        "an interest rate that looks like a unit error is rejected",
        !v.ok && v.blocked.some((b) => b.includes("unit error")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([{ ...request, returnDate: nowSec - 3600 }]);
      check(
        "a borrow request maturing in the past is rejected",
        !v.ok && v.blocked.some((b) => b.includes("past")),
        JSON.stringify(v.blocked),
      );
    }

    {
      // Milliseconds where seconds were wanted lands past the year 50000.
      const v = await audit([{ ...request, returnDate: soon * 1000 }]);
      check(
        "a millisecond timestamp is caught as a unit error",
        !v.ok && v.blocked.some((b) => b.includes("ten years")),
        JSON.stringify(v.blocked),
      );
    }
  }

  {
    const listing: Step = {
      kind: "createLoanListing",
      diamond: PINNED_DIAMOND,
      token: USDC_LOANABLE,
      amount: "500",
      minAmount: "10",
      maxAmount: "100",
      decimals: 6,
      symbol: "USDC",
      interestPct: 5,
      returnDate: soon,
    };

    {
      const v = await audit([listing]);
      check(
        "a well-formed loan listing passes",
        v.ok,
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([{ ...listing, minAmount: "200" }]);
      check(
        "a listing whose minimum draw exceeds its maximum is rejected",
        !v.ok && v.blocked.some((b) => b.includes("above the maximum")),
        JSON.stringify(v.blocked),
      );
    }

    {
      // Drawable for more than was offered.
      const v = await audit([{ ...listing, maxAmount: "600" }]);
      check(
        "a listing drawable beyond the amount lent is rejected",
        !v.ok && v.blocked.some((b) => b.includes("more than the amount")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([listing], {
        allowedActions: { ...ALL_ON, lend: false },
      });
      check(
        "a loan listing respects the lend toggle",
        !v.ok && v.blocked.some((b) => b.includes("switched off")),
        JSON.stringify(v.blocked),
      );
    }
  }

  {
    /* No token address: the listing on-chain decides the currency, so the
       intent carries a symbol and the auditor prices by that. */
    const draw: Step = {
      kind: "borrowFromListing",
      diamond: PINNED_DIAMOND,
      listingId: 3,
      amount: "100",
      decimals: 6,
      symbol: "USDC",
    };

    {
      const v = await audit([draw]);
      check(
        "a well-formed draw against a listing passes",
        v.ok,
        JSON.stringify(v.blocked),
      );
    }

    {
      const { listingId: _drop, ...noId } = draw;
      const v = await audit([noId]);
      check(
        "a draw with no listing id is rejected",
        !v.ok && v.blocked.some((b) => b.includes("listing id")),
        JSON.stringify(v.blocked),
      );
    }

    {
      // Priced by symbol, so the cap still applies without an address.
      const v = await audit([{ ...draw, amount: "5000" }]);
      check(
        "a draw over the per-action cap is rejected",
        !v.ok && v.blocked.some((b) => b.includes("per-action limit")),
        JSON.stringify(v.blocked),
      );
    }
  }

  {
    /* The principal actually leaves the lender's wallet here, so the amount is
       real money rather than a display field. */
    const fill: Step = {
      kind: "fillRequest",
      diamond: PINNED_DIAMOND,
      requestId: 11,
      token: USDC_LOANABLE,
      amount: "250",
      decimals: 6,
      symbol: "USDC",
    };

    {
      const v = await audit([fill]);
      check(
        "a well-formed request fill passes",
        v.ok,
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([fill], {
        allowedActions: { ...ALL_ON, lend: false },
      });
      check(
        "filling a request respects the lend toggle",
        !v.ok && v.blocked.some((b) => b.includes("switched off")),
        JSON.stringify(v.blocked),
      );
    }
  }

  {
    /* Cancellations carry no token and no amount — an id and the Diamond are
       the whole surface, and the contract rejects an id the caller does not
       own. Ungated, for the same reason repaying is. */
    const v = await audit(
      [
        { kind: "closeListing", diamond: PINNED_DIAMOND, listingId: 3 },
        { kind: "closeRequest", diamond: PINNED_DIAMOND, requestId: 7 },
      ],
      { allowedActions: { ...ALL_ON, borrow: false, lend: false } },
    );
    check(
      "cancelling your own listing or request is never gated",
      v.ok,
      JSON.stringify(v.blocked),
    );
  }

  {
    const v = await audit([{ kind: "closeRequest", diamond: PINNED_DIAMOND }]);
    check(
      "a cancellation with no id is rejected",
      !v.ok && v.blocked.some((b) => b.includes("request id")),
      JSON.stringify(v.blocked),
    );
  }

  /* ---------------------------------------------------------------------- *
   * kfUSD
   *
   * These pin contract addresses rather than validating tokens, because here
   * the token IS the contract: mintStable's target is kfUSD itself, and a wrong
   * address is a transfer into something that is not the vault.
   * ---------------------------------------------------------------------- */

  {
    const mint: Step = {
      kind: "mintStable",
      kfUSD: STABLE.kfUSD,
      collateralToken: STABLE.USDC,
      collateralAmount: "100",
      collateralDecimals: 6,
      collateralSymbol: "USDC",
    };

    {
      const v = await audit([mint]);
      check("a well-formed kfUSD mint passes", v.ok, JSON.stringify(v.blocked));
    }

    {
      /* kfUSD keeps its OWN `supportedCollaterals` mapping, and USDe is in it on
         every chain that deployed one. No chain we deploy to has a USDe price
         feed, so it is registered on the diamond nowhere — which is why this rule
         cannot borrow the lending validator. It did, and the result was a plan
         the builder produced and the auditor blocked: build.ts accepts USDe and
         emits the mint, then this rule looked USDe up in the lending currency
         list, missed, and said "is not accepted as collateral" about a collateral
         kfUSD does accept. */
      if (!STABLE.USDe) {
        throw new Error(
          `chain ${CHAIN} has no USDe deployment — the kfUSD-vs-lending collateral test would assert nothing`,
        );
      }
      const usdeIsUnregistered = !registeredCollateral.has(
        STABLE.USDe.toLowerCase(),
      );
      check(
        "USDe really is absent from this chain's registered lending set",
        usdeIsUnregistered,
        STABLE.USDe,
      );
      const v = await audit([
        {
          ...mint,
          collateralToken: STABLE.USDe,
          collateralDecimals: 18,
          collateralSymbol: "USDe",
        },
      ]);
      check(
        "a USDe mint passes — kfUSD accepts it even though the lending market does not",
        v.ok,
        JSON.stringify(v.blocked),
      );
    }

    {
      /* And the other direction: a token the lending market registered is not
         automatically kfUSD collateral. Sepolia's WETH9 is registered collateral
         and is not in `supportedCollaterals`, so minting against it would revert
         in kfUSD.mint. Uses its own fixture rather than the collateral-only one —
         being loanable is irrelevant to what kfUSD accepts. */
      const v = await audit([
        {
          ...mint,
          collateralToken: notStableCollateral.address,
          collateralDecimals: notStableCollateral.decimals,
          collateralSymbol: notStableCollateral.symbol,
        },
      ]);
      check(
        "a lending collateral kfUSD does not accept is still rejected for minting",
        !v.ok &&
          v.blocked.some((b) => b.includes("not accepted as kfUSD collateral")),
        `${notStableCollateral.symbol} ${JSON.stringify(v.blocked)}`,
      );
    }

    {
      const v = await audit([
        { ...mint, kfUSD: "0xbad0000000000000000000000000000000000002" },
      ]);
      check(
        "a mint into the wrong kfUSD contract is rejected",
        !v.ok && v.blocked.some((b) => b.includes("kfUSD")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([{ ...mint, collateralDecimals: 18 }]);
      check(
        "a mint whose collateral decimals disagree with the registry is rejected",
        !v.ok && v.blocked.some((b) => b.includes("USDC has 6")),
        JSON.stringify(v.blocked),
      );
    }
  }

  {
    const stable: Step[] = [
      {
        kind: "redeemStable",
        kfUSD: STABLE.kfUSD,
        amount: "100",
        outputToken: USDC_LENDING,
        outputSymbol: "USDC",
      },
      {
        kind: "lockStable",
        kafUSD: STABLE.kafUSD,
        kfUSD: STABLE.kfUSD,
        amount: "100",
      },
      {
        kind: "requestStableWithdrawal",
        kafUSD: STABLE.kafUSD,
        amount: "100",
      },
      {
        kind: "completeStableWithdrawal",
        kafUSD: STABLE.kafUSD,
        // The vault releases what was locked, and only kfUSD is lockable, so
        // this is the only payout the builder can produce — a collateral one
        // is refused upstream. The auditor doesn't check which token it is;
        // the fixture says kfUSD so "well-formed" stays true.
        outputToken: STABLE.kfUSD,
        outputSymbol: "kfUSD",
      },
      {
        kind: "claimStableYield",
        yieldTreasury: STABLE.YieldTreasury,
        asset: STABLE.kfUSD,
        assetSymbol: "kfUSD",
      },
      {
        kind: "compoundStableYield",
        yieldTreasury: STABLE.YieldTreasury,
        kfUSD: STABLE.kfUSD,
      },
    ];

    {
      const v = await audit(stable);
      check(
        "the whole kfUSD lifecycle passes when well-formed",
        v.ok,
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([
        {
          kind: "lockStable",
          kafUSD: STABLE.kafUSD,
          kfUSD: "0xbad0000000000000000000000000000000000003",
          amount: "100",
        },
      ]);
      check(
        "a lock naming the wrong kfUSD contract is rejected",
        !v.ok && v.blocked.some((b) => b.includes("kfUSD")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([
        {
          kind: "claimStableYield",
          yieldTreasury: "0xbad0000000000000000000000000000000000004",
          asset: STABLE.kfUSD,
          assetSymbol: "kfUSD",
        },
      ]);
      check(
        "a yield claim against the wrong treasury is rejected",
        !v.ok && v.blocked.some((b) => b.includes("yield treasury")),
        JSON.stringify(v.blocked),
      );
    }

    {
      // Priced as kfUSD at $1, so the per-action cap applies.
      const v = await audit([
        {
          kind: "redeemStable",
          kfUSD: STABLE.kfUSD,
          amount: "5000",
          outputToken: USDC_LENDING,
          outputSymbol: "USDC",
        },
      ]);
      check(
        "a redemption over the per-action cap is rejected",
        !v.ok && v.blocked.some((b) => b.includes("per-action limit")),
        JSON.stringify(v.blocked),
      );
    }
  }

  /* ---------------------------------------------------------------------- *
   * Pool
   *
   * Both are exits and neither is priceable here — a position's value lives in
   * the NFT, and reading it means an on-chain call these synchronous rules
   * cannot make. What is provable is that the step names the app's own position
   * manager and a real token id.
   * ---------------------------------------------------------------------- */

  /* Declared out here rather than inside the block below because the mint
     section reuses them: the `provideLiquidity` toggle must block an opening and
     leave both exits alone, and asserting that needs a real exit to hand. */
  const collect: Step = {
    kind: "collectPoolFees",
    positionManager: POSITION_MANAGER,
    tokenId: "4242",
    pairLabel: "USDC/ETH",
  };

  const remove: Step = {
    kind: "decreasePoolLiquidity",
    positionManager: POSITION_MANAGER,
    tokenId: "4242",
    liquidity: "123456789",
    pairLabel: "USDC/ETH",
  };

  {
    {
      const v = await audit([collect, remove]);
      check(
        "well-formed pool exits pass",
        v.ok,
        JSON.stringify({ blocked: v.blocked, notes: v.notes }),
      );
    }

    {
      // A call into an unknown contract, which is what this rule can prove.
      const v = await audit([
        {
          ...collect,
          positionManager: "0xbad0000000000000000000000000000000000005",
        },
      ]);
      check(
        "a collect against an unknown position manager is rejected",
        !v.ok && v.blocked.some((b) => b.includes("position manager")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([{ ...remove, liquidity: "0" }]);
      check(
        "removing zero liquidity is rejected as a no-op",
        !v.ok && v.blocked.some((b) => b.includes("liquidity")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const { tokenId: _drop, ...noId } = collect;
      const v = await audit([noId]);
      check(
        "a pool exit with no position id is rejected",
        !v.ok && v.blocked.some((b) => b.includes("position id")),
        JSON.stringify(v.blocked),
      );
    }
  }

  /* ---------------------------------------------------------------------- *
   * Pool: opening a position
   *
   * The one pool step that spends, and the only one whose worst outcome is not a
   * revert. A range that does not straddle the market mints a position that is
   * one-sided and earns nothing, and the transaction succeeds — so there is no
   * failure for anyone to notice.
   *
   * This rule cannot check that, and saying so is the point of the split: it is
   * synchronous, it makes no chain call, and where the market sits is a chain
   * read. What keeps the range honest is upstream — build.ts centres the band on
   * the pool's own live price, which is why the tool takes a width and not a tick
   * (see build.test.ts's mint section). What this rule owns is everything
   * provable from the step alone: the contracts, the tier, tick alignment, the
   * slippage floors, and the price.
   *
   * The price is the part with no second line of defence. The mint touches the
   * position manager, not the diamond, so `LibAgentPermission.enforce()` never
   * runs — same standing as `transfer`. This rule is the only thing bounding how
   * much a deposit can move.
   * ---------------------------------------------------------------------- */

  const weth = tokens.find((t) => t.symbol === "WETH");
  if (!weth || !usdc) {
    skip(
      "mint cases",
      `chain ${CHAIN} has no WETH/USDC pair in its token list, so a mint fixture cannot be built`,
    );
  } else {
    /* Aligned to the 0.3% tier's 60-tick spacing, and the same pair of ticks
       build.test.ts asserts a ±10% band snaps to. Alignment is not cosmetic:
       `flipTick` (dex-v3/core/libraries/TickBitmap.sol:31) requires
       `tick % tickSpacing == 0` as a bare require with no reason string, and a
       fresh position flips both bounds. */
    const mint: Step = {
      kind: "mintPoolPosition",
      positionManager: POSITION_MANAGER,
      token0: weth.address,
      token1: usdc.address,
      /* Read, not written down. This rule only checks they are present — it never
         converts a tick to a price — but a hand-typed 6 that disagreed with the
         registry would make the fixture describe a pair that doesn't exist. */
      decimals0: weth.decimals,
      decimals1: usdc.decimals,
      symbol0: weth.symbol,
      symbol1: usdc.symbol,
      fee: 3000,
      tickLower: -202200,
      tickUpper: -200220,
      /* $600 + $300 at the stub's prices, so a well-formed mint sits under the
         $1000 per-action cap and the cases below can move it over deliberately. */
      amount0: "0.2",
      amount1: "300",
      amount0Min: "0.199",
      amount1Min: "298.5",
      lowerPrice: 1655.79,
      upperPrice: 2018.32,
      createsPool: false,
      deadlineMin: 20,
    };

    {
      const v = await audit([mint]);
      check(
        "a well-formed mint passes",
        v.ok,
        JSON.stringify({ blocked: v.blocked, notes: v.notes }),
      );
      /* Both legs, not just the first. The per-action cap has to see the whole
         deposit or a two-token step is half-priced — which on this rule means
         half-capped. */
      check(
        "and both legs are priced into it",
        v.steps[0]?.usd === 900,
        JSON.stringify(v.steps[0]?.usd),
      );
    }

    {
      /* Five ticks off a multiple of 60. This is the failure with no error
         message at all downstream: the require has no reason string, so the
         wallet shows a revert and nothing says which number was wrong. */
      const v = await audit([{ ...mint, tickLower: -202195 }]);
      check(
        "a range bound off the tier's tick spacing is rejected, and named",
        !v.ok &&
          v.blocked.some(
            (b) => b.includes("-202195") && b.includes("60-tick spacing"),
          ),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([
        { ...mint, tickLower: -200220, tickUpper: -202200 },
      ]);
      check(
        "an inverted range is rejected",
        !v.ok && v.blocked.some((b) => b.includes("upper bound is not above")),
        JSON.stringify(v.blocked),
      );
    }

    {
      /* The hole the Pool page shipped with. `NonfungiblePositionManager`
         checks `amount0 >= amount0Min && amount1 >= amount1Min`, so a pair of
         zeroes accepts any execution at all — a sandwich can move the price,
         have the mint consume the deposit at whatever ratio that price implies,
         and still succeed. */
      const v = await audit([{ ...mint, amount0Min: "0", amount1Min: "0" }]);
      check(
        "a mint with both minimums at zero is rejected as no protection",
        !v.ok &&
          v.blocked.some((b) => b.includes("no slippage protection at all")),
        JSON.stringify(v.blocked),
      );
    }

    {
      /* And one zero is fine, because it is a real shape rather than a lapse: a
         range entirely above or below the market is single-sided, and
         mintMinimums returns exactly one zero for it. Blocking this would
         forbid a legitimate position. */
      const v = await audit([{ ...mint, amount1Min: "0" }]);
      check(
        "but one minimum at zero passes — a single-sided range is legitimate",
        v.ok,
        JSON.stringify(v.blocked),
      );
    }

    {
      const { amount0Min: _a, amount1Min: _b, ...noFloors } = mint;
      const v = await audit([noFloors]);
      check(
        "a mint with no minimums at all is rejected",
        !v.ok && v.blocked.some((b) => b.includes("Slippage protection")),
        JSON.stringify(v.blocked),
      );
    }

    {
      /* $900 + $300 over a $1000 cap. The only place the deposit is bounded. */
      const v = await audit([{ ...mint, amount0: "0.3" }]);
      check(
        "a deposit whose two legs together exceed the per-action cap is rejected",
        !v.ok && v.blocked.some((b) => b.includes("per-action limit")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([
        {
          ...mint,
          positionManager: "0xbad0000000000000000000000000000000000005",
        },
      ]);
      check(
        "a mint against an unknown position manager is rejected",
        !v.ok && v.blocked.some((b) => b.includes("position manager")),
        JSON.stringify(v.blocked),
      );
    }

    {
      /* 0.01% has a spacing in TICK_SPACINGS because Uniswap's library does, and
         no pool here because the factory has it disabled. Ticks aligned, so this
         asserts the tier check specifically and not the spacing one. */
      const v = await audit([
        { ...mint, fee: 100, tickLower: -202195, tickUpper: -200221 },
      ]);
      check(
        "a fee tier this DEX has no pool for is rejected",
        !v.ok &&
          v.blocked.some((b) =>
            b.includes("isn't one this DEX has a pool for"),
          ),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([{ ...mint, fee: 777 }]);
      check(
        "a fee that is not a tier at all is rejected",
        !v.ok && v.blocked.some((b) => b.includes("fee tier")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([{ ...mint, token1: weth.address }]);
      check(
        "a mint with the same token on both sides is rejected",
        !v.ok && v.blocked.some((b) => b.includes("same token")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([
        { ...mint, token1: "0xbad0000000000000000000000000000000000006" },
      ]);
      check(
        "a mint naming a token this chain doesn't have is rejected",
        !v.ok && v.blocked.some((b) => b.includes("unrecognised token")),
        JSON.stringify(v.blocked),
      );
    }

    {
      /* The toggle. `provideLiquidity` gated nothing until an opening intent
         existed — the other two pool kinds are exits — so this is the assertion
         that it now does. Switching it off must still leave a user able to
         collect fees and close what they already have. */
      const v = await audit([mint], {
        allowedActions: { ...ALL_ON, provideLiquidity: false },
      });
      check(
        "a mint is blocked when provideLiquidity is switched off",
        !v.ok &&
          v.blocked.some((b) => b.includes("provideLiquidity is switched off")),
        JSON.stringify(v.blocked),
      );
      const exits = await audit([collect, remove], {
        allowedActions: { ...ALL_ON, provideLiquidity: false },
      });
      check(
        "and the exits still pass with it off",
        exits.ok,
        JSON.stringify(exits.blocked),
      );
    }
  }

  console.log("\n— the testnet faucet —");
  /*
   * The one rule here that applies no knownToken() to its token field, and the
   * only one that is deliberately unpriced while naming an amount. Both are
   * measured decisions rather than omissions, so both are asserted.
   *
   * The pin is read from DEPLOYMENTS because that is where the rule reads it
   * from — `getContracts(chainId).faucet`, the single source config/contracts.ts
   * documents after NEXT_PUBLIC_TOKENFAUCET_ADDRESS was retired for being one
   * address across every chain.
   *
   * This block used to WRITE the faucet into DEPLOYMENTS at runtime, because no
   * chain had one recorded and the unconfigured case was the live one. Both are
   * now false: faucets are deployed on all five testnets, so the fixture is read
   * rather than injected, and the unconfigured case moved to a chain that will
   * never have one. The old comment predicted this would start failing "the
   * moment the faucet is deployed" — it did, and the fix is a real fixture
   * rather than a relaxed assertion.
   */
  {
    const FAUCET = registry.getContracts(CHAIN).faucet;
    if (!FAUCET)
      throw new Error(
        `chain ${CHAIN} has no faucet in DEPLOYMENTS, so the pinned-faucet ` +
          `cases cannot assert anything — pick a chain that does`,
      );
    const MOCK_USDT = "0x0000000000000000000000000000000000000abc";
    const claim = {
      kind: "claimTestTokens",
      faucet: FAUCET,
      token: MOCK_USDT,
      amount: "100.0",
      symbol: "USDT",
    };

    {
      /* Fails closed, which is `pinned`'s contract: a step pinning a contract
         the registry cannot name is a step built against a chain this app does
         not serve. Ethereum mainnet is the fixture because a faucet there is a
         contradiction rather than a gap — DEPLOYMENTS records one on all five
         testnets now, so "a chain that hasn't got one yet" no longer exists to
         test with, and this case must not quietly stop running for want of a
         fixture. `getContracts` returns {} for any chain it does not carry. */
      const v = await audit([claim], { chainId: 1 });
      check(
        "on a chain that records no faucet, a claim is rejected",
        !v.ok && v.blocked.some((b) => b.includes("faucet is not configured")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([claim]);
      check("a well-formed claim passes", v.ok, JSON.stringify(v.blocked));
    }

    {
      const v = await audit([
        { ...claim, faucet: "0xbad0000000000000000000000000000000000006" },
      ]);
      check(
        "a claim against a faucet this app did not deploy is rejected",
        !v.ok && v.blocked.some((b) => b.includes("faucet")),
        JSON.stringify(v.blocked),
      );
    }

    {
      /* THE POINT OF LEAVING IT UNPRICED. maxPerAction is 1000, and this claim
         names five million. Pricing it would apply the user's *spend* cap to an
         incoming balance — bounding no risk, and refusing a claim for being too
         generous. Nothing leaves the wallet, which is the same reason the three
         kfUSD claims above carry no `priced`. */
      const v = await audit([{ ...claim, amount: "5000000" }]);
      check(
        "an incoming drip is not measured against the per-action spend cap",
        v.ok,
        JSON.stringify(v.blocked),
      );
    }

    {
      /* No agent toggle gates a faucet claim — ACTION_OF maps it to "" because
         useAgentSettings ships no faucet switch to gate it on. Every mandate
         actions off, and it still passes. */
      const v = await audit([claim], {
        allowedActions: {
          swap: false,
          borrow: false,
          lend: false,
          stake: false,
          provideLiquidity: false,
        },
      });
      check(
        "and no mandate toggle gates it, because there is none to gate on",
        v.ok,
        JSON.stringify(v.blocked),
      );
    }

    {
      /* What replaces knownToken(). The token is not checked for registry
         membership — the mock USDT and USDe are in no chain's TOKENS list, so
         requiring it would reject exactly the assets the faucet hands out — but it
         still has to be an address, and not the zero one. An asset the faucet does
         not list is a revert on a contract we deployed, not a transfer anywhere. */
      const v = await audit([{ ...claim, token: "USDT" }]);
      check(
        "a token that is a symbol rather than an address is rejected",
        !v.ok &&
          v.blocked.some((b) => b.includes("token is not a valid address")),
        JSON.stringify(v.blocked),
      );
    }

    {
      const v = await audit([
        { ...claim, token: "0x0000000000000000000000000000000000000000" },
      ]);
      check(
        "and the zero address is rejected too",
        !v.ok && v.blocked.some((b) => b.includes("zero address")),
        JSON.stringify(v.blocked),
      );
    }

    {
      /* The symbol is display-only — `claim(address)` takes no symbol and no
         amount — but a review row reading "Claim " with nothing after it is a
         rendering fault the user is being asked to sign through. */
      const { symbol: _drop, ...noSymbol } = claim;
      const v = await audit([noSymbol]);
      check(
        "a claim with no symbol to show is rejected",
        !v.ok && v.blocked.some((b) => b.includes("no token symbol")),
        JSON.stringify(v.blocked),
      );
    }

    /* No `delete deployed.faucet` to undo here any more. This block used to
       write the address into DEPLOYMENTS and clean up after itself; it now reads
       the deployed one, so there is nothing to restore. */
  }

  console.log(
    `\n${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ""}\n`,
  );
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
