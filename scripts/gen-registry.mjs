/**
 * Generate src/constants/deployments.generated.ts from the deploy scripts' records.
 *
 *   node --import tsx scripts/gen-registry.mjs        (or: npm run gen:registry)
 *
 * Every script in smart-contract/scripts/ writes a deployment-<component>-<network>.json
 * when it finishes. This reads all of them, folds them into one chain-keyed map,
 * and then runs the registry's own auditRegistry() against the result — failing
 * non-zero if it finds anything.
 *
 * It emits TWO exports, and they answer different questions. GENERATED_DEPLOYMENTS
 * is where our contracts are. GENERATED_LENDING_REGISTRATION is which tokens the
 * lending market on each chain accepts, read back off the diamond by
 * register-tokens.js — per-chain state that no address table implies, and that
 * differs from what the app offers on all five deployed chains. See
 * readRegistration.
 *
 * WHY THIS EXISTS RATHER THAN COPY-PASTE
 *
 * There are about fifteen addresses per chain and five chains in this wave. The
 * failure mode of transcribing them by hand is not a typo that throws: a wrong
 * address is still twenty well-formed bytes, isDeployed() still returns true, the
 * page still renders, and the first symptom is a revert — or, if something else
 * happens to live there, a transaction that succeeds against the wrong contract.
 * Nothing in the type system or the test suite can catch that. Reading the same
 * JSON the deploy wrote can.
 *
 * THREE THINGS IT IS CAREFUL ABOUT, each a real defect in the inputs:
 *
 * 1. Records exist for chains we deliberately dropped. Two Abstract-testnet
 *    records are committed to the repo (deployment-dex-abstractTestnet.json and
 *    deployment-v3-abstractTestnet-1775754669967.json) and are not gitignored, so
 *    a naive glob folds dead chain-11124 addresses straight back into DEPLOYMENTS
 *    — undoing the decision to drop Abstract, silently, on the first run.
 *
 * 2. The records disagree about their own types. deploy-stablecoin.js writes
 *    chainId as a *string* ("11155111") because it stringifies the BigInt;
 *    deploy.js, deploy-v3.js, deploy-dex.js and deploy-oracle.js write it as a
 *    Number. Keyed straight into an object those produce two entries for one
 *    chain, and the second one wins at spread time depending on insertion order.
 *
 * 3. deploy-v3.js writes only a timestamped filename, never a fixed one, so a
 *    chain accumulates one file per V3 deploy and "the addresses" means the
 *    newest. Alphabetical order is not chronological order once epoch-ms digits
 *    change width, so the timestamp is read from inside the record.
 *
 * And one thing it refuses to paper over: if two components disagree about a
 * shared address, that is an error, not a last-write-wins merge. See mergeField.
 */
import { readFileSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress } from "ethers";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const RECORDS_DIR = join(ROOT, "smart-contract");
const OUT_FILE = join(ROOT, "src", "constants", "deployments.generated.ts");

/* ----------------------------------------------------------------- mapping -- */

/**
 * Where each record's addresses land in ChainContracts.
 *
 * Written out per component rather than inferred from key names, because the
 * names do not line up: deploy-v3.js calls the wrapped native `weth` while
 * deploy-dex.js calls the same thing `wrappedNative`, and deploy-stablecoin.js
 * uses SCREAMING keys (`USDT`, `YieldTreasury`) where everything else is
 * camelCase. An inference rule that handled all of those would be more
 * surprising than a table.
 *
 * A key absent from a component's table is dropped and reported, not silently
 * ignored — that is how a new field added to a deploy script gets noticed here
 * instead of going missing for a release.
 */
const FIELD_MAP = {
  oracle: {
    priceOracle: "priceOracle",
    pythContract: "pythContract",
  },
  diamond: {
    diamond: "diamond",
    /* deploy.js records the oracle it was configured with. Same field as the
     * oracle record's, deliberately: if they disagree, the diamond is pointed at
     * an oracle other than the one we deployed and mergeField says so. */
    priceOracle: "priceOracle",
  },
  v3: {
    factory: "v3Factory",
    router: "v3Router",
    quoter: "v3Quoter",
    positionManager: "v3PositionManager",
    positionDescriptor: "v3PositionDescriptor",
    weth: "wrappedNative",
    poolInitCodeHash: "poolInitCodeHash",
    /* NFTDescriptor is a deployed *library*, linked into positionDescriptor at
     * construction. The frontend never calls it, so it has no registry field and
     * is dropped on purpose. */
    nftDescriptor: null,
  },
  dex: {
    v2Factory: "v2Factory",
    v2Router: "v2Router",
    wrappedNative: "wrappedNative",
  },
  stablecoin: {
    kfUSD: "kfUSD",
    kafUSD: "kafUSD",
    YieldTreasury: "yieldTreasury",
    USDC: "usdc",
    USDT: "usdt",
    USDe: "usde",
  },
  /* deploy-faucet.js. Testnet only, and the record also carries the drip and
   * funding per asset under `config` — none of which the registry needs, because
   * the contract itself answers assetInfo(). Only the address is mapped. */
  faucet: {
    faucet: "faucet",
  },
  /* deploy-kld.js. The protocol token and the staking pair that has been waiting
   * for it. `stKLD` maps through unchanged; the other two are renamed to the
   * ChainContracts fields that have existed — and been empty on every chain —
   * since before a KLD ERC20 did: `kld` and `kldVault` at registry.ts:124.
   *
   * The record also carries `config` (max supply, home chain id, cooldown) and a
   * `faucet` block. None of that is mapped: the registry is an address map, and
   * every one of those is answerable on chain from the addresses below. */
  kld: {
    KLD: "kld",
    KLDVault: "kldVault",
    stKLD: "stKLD",
  },
  /* register-tokens.js writes a record of which tokens were registered as
   * collateral and loanable. It carries no address that belongs in
   * ChainContracts — the diamond and oracle in it are copies of what deploy.js
   * already recorded, and are read only as a cross-check, since a tokens record
   * naming a different diamond means one of the two files is stale (see
   * crossCheckTokens).
   *
   * Its `onChain` block, though, is the one fact in these records that nothing
   * else in the repository holds: the two arrays read back OFF THE DIAMOND after
   * registration, `getAllCollateralToken()` and `getLoanableAssets()`. That is
   * what the lending market accepts, which is a different set from what the app
   * offers on every one of the five chains — so it is emitted as its own export
   * rather than folded into the address map. See readRegistration. */
  tokens: {},
};

/**
 * The one component whose record is not an address bag.
 *
 * seed-v3-pool.js writes one file per pool it opens, so a chain has as many of
 * these as it has pools and none of their fields belong in ChainContracts. They
 * are collected separately (see build) into the list the app uses to tell a pool
 * the deployer opened from one a stranger opened at a price they chose.
 */
const POOL_COMPONENT = "pool";

const KNOWN_COMPONENTS = new Set([
  ...Object.keys(FIELD_MAP),
  POOL_COMPONENT,
]);

/* ------------------------------------------------------------- discovery -- */

/**
 * Split deployment-<component>-<network>[-<epochMs>].json.
 *
 * Returns null for anything that does not match, including the legacy
 * two-segment `deployment-<network>.json` that deploy-stablecoin.js used to
 * write. Skipping those is right: without a component in the name there is no
 * way to know which script produced it, and the reason the name changed is that
 * two scripts were overwriting each other's records under it.
 */
function parseName(filename) {
  const m = /^deployment-(.+)\.json$/.exec(filename);
  if (!m) return null;

  const parts = m[1].split("-");
  if (parts.length < 2) return null;

  const component = parts[0];

  /* A pool record's name carries its pair and fee tier after the network:
     deployment-pool-sepolia-USDC-WETH-500.json. So its trailing number is a fee,
     not the epoch stamp deploy-v3.js appends -- read as one, 500 becomes the
     record's timestamp and the network becomes "sepolia-USDC-WETH". Both the pair
     and the fee are inside the record, so nothing here has to parse them. */
  if (component === POOL_COMPONENT)
    return { component, network: parts[1], epochMs: null };

  let epochMs = null;
  let rest = parts.slice(1);
  if (rest.length > 1 && /^\d+$/.test(rest[rest.length - 1])) {
    epochMs = Number(rest[rest.length - 1]);
    rest = rest.slice(0, -1);
  }
  if (rest.length === 0) return null;

  return { component, network: rest.join("-"), epochMs };
}

/**
 * When the record was written, in ms, most trustworthy source first.
 *
 * `timestamp` (ISO) is what deploy.js, deploy-v3.js, deploy-dex.js,
 * deploy-oracle.js and register-tokens.js write; deploy-stablecoin.js nests the
 * same thing under `timestamps.deployed`. The filename epoch is next, and mtime
 * is the last resort — it is the least reliable because copying or checking out
 * a file rewrites it, which is exactly how a stale record ends up looking newest.
 */
function recordTime(record, epochMs, absPath) {
  const iso = record?.timestamp ?? record?.timestamps?.deployed;
  if (typeof iso === "string") {
    const t = Date.parse(iso);
    if (Number.isFinite(t)) return { ms: t, from: "record.timestamp" };
  }
  if (Number.isFinite(epochMs)) return { ms: epochMs, from: "filename" };
  return { ms: statSync(absPath).mtimeMs, from: "mtime (unreliable)" };
}

function discover() {
  let names;
  try {
    names = readdirSync(RECORDS_DIR);
  } catch (error) {
    throw new Error(
      `Cannot read ${RECORDS_DIR}: ${error.message}\n` +
        `Run this from the repository root.`,
    );
  }

  const found = [];
  for (const name of names.sort()) {
    if (!name.startsWith("deployment-") || !name.endsWith(".json")) continue;
    const parsed = parseName(name);
    const absPath = join(RECORDS_DIR, name);
    if (!parsed) {
      found.push({ name, absPath, skip: "filename is not deployment-<component>-<network>[-<ts>].json" });
      continue;
    }
    if (!KNOWN_COMPONENTS.has(parsed.component)) {
      found.push({ name, absPath, skip: `unknown component "${parsed.component}"` });
      continue;
    }

    let record;
    try {
      record = JSON.parse(readFileSync(absPath, "utf8"));
    } catch (error) {
      found.push({ name, absPath, skip: `unparseable JSON: ${error.message}` });
      continue;
    }

    /*
     * The one normalisation the inputs force (header note 2), and a hard stop
     * rather than a skip.
     *
     * A missing chainId here is not an unrecognised file — the name already
     * matched a component we write, so this is a record naming real deployed
     * contracts. Skipping it would drop those addresses from the registry with a
     * one-line note in a wall of output, and the app would come up looking fine
     * with a chain half-configured. Refusing to write anything is the safer
     * failure: it cannot be missed, and the fix (redeploy, or archive the legacy
     * record) is a minute's work.
     */
    const chainId = Number(record?.chainId);
    if (!Number.isInteger(chainId) || chainId <= 0) {
      throw new Error(
        `${name}: chainId is missing or unusable (${JSON.stringify(record?.chainId)}).\n` +
          `  This file names deployed contracts but not the chain they are on, so ` +
          `they cannot be filed. Every current deploy script writes chainId; a record ` +
          `without one predates that. Redeploy, or move it out of ${relative(ROOT, RECORDS_DIR)}/ ` +
          `if it is a historical record.`,
      );
    }

    const time = recordTime(record, parsed.epochMs, absPath);

    /*
     * A record a deploy script is still working through, or gave up on.
     *
     * Scripts that write their record progressively (deploy-kld.js does, because
     * the public RPCs drop mid-run) mark it `status: "partial"` until the last
     * wiring call lands. Those addresses are real and deployed, but the set is
     * not yet known to work — a vault with no stKLD wired, say. Threading that
     * into the registry gives the app a /stake page that reverts on contact.
     *
     * Skipped rather than fatal: unlike a missing chainId, this is a normal and
     * temporary state, and the fix is to rerun the deploy script, which resumes.
     * Anything without a `status` field predates the convention and is treated
     * as complete.
     */
    if (record?.status === "partial") {
      found.push({
        ...parsed,
        name,
        absPath,
        skip: 'status is "partial" — rerun the deploy script to finish it',
      });
      continue;
    }

    found.push({ ...parsed, name, absPath, record, chainId, time });
  }
  return found;
}

/* --------------------------------------------------------------- merging -- */

/**
 * Normalise and validate one value, or throw naming the file it came from.
 *
 * getAddress does two jobs here. It checksums, so every address in the output
 * has one canonical form and a downstream `a === b` cannot fail on case alone.
 * And it *rejects a wrong checksum* — a mixed-case address with a bad checksum
 * is a corrupted or hand-edited value, and catching it here is the whole point of
 * having a generator. All-lowercase input is accepted and checksummed, which is
 * what ethers' own toString gives us in the records.
 */
function normalise(field, value, source) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${source}: ${field} is not a string: ${JSON.stringify(value)}`);
  }
  if (field === "poolInitCodeHash") {
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
      throw new Error(`${source}: poolInitCodeHash is not a 32-byte hash: ${value}`);
    }
    return value.toLowerCase();
  }
  let checksummed;
  try {
    checksummed = getAddress(value);
  } catch {
    throw new Error(`${source}: ${field} is not a valid address: ${value}`);
  }
  if (checksummed === "0x0000000000000000000000000000000000000000") {
    throw new Error(
      `${source}: ${field} is the zero address. A deploy that recorded zero did ` +
        `not deploy; folding it in would make isDeployed() true for nothing.`,
    );
  }
  return checksummed;
}

/**
 * Set a field, or fail if two records disagree about it.
 *
 * Last-write-wins would be wrong for every field that appears in more than one
 * record, and the concrete case is `wrappedNative`: deploy-v3.js records the
 * WETH the V3 periphery was constructed against, deploy-dex.js records the one
 * the V2 router was. Those are constructor arguments, immutable after deploy. If
 * they differ, the two venues wrap native value into two different tokens, their
 * "ETH" liquidity is not fungible, and a native swap routes through whichever the
 * frontend happened to pick — while both deploys and every type check pass.
 *
 * `priceOracle` has the same shape: deploy.js records the oracle the diamond was
 * configured with, deploy-oracle.js the one we deployed. A mismatch means the
 * lending market is pricing off a contract we do not control.
 *
 * Neither is resolvable by choosing a winner, so this stops.
 */
function mergeField(target, provenance, chainId, field, value, source) {
  const existing = target[field];
  if (existing === undefined) {
    target[field] = value;
    provenance[field] = source;
    return;
  }
  if (existing !== value) {
    throw new Error(
      `chain ${chainId}: two records disagree about ${field}\n` +
        `    ${provenance[field]} says ${existing}\n` +
        `    ${source} says ${value}\n` +
        `  These are constructor arguments or configured addresses, not preferences — ` +
        `one of the deploys is stale or was run against the wrong configuration. ` +
        `Delete the stale record or redeploy; do not pick a winner here.`,
    );
  }
}

/** A tokens record naming a different diamond means one of the files is stale. */
function crossCheckTokens(entry, contracts, warnings) {
  const claimed = entry.record?.diamond;
  if (typeof claimed !== "string" || !contracts.diamond) return;
  let normalised;
  try {
    normalised = getAddress(claimed);
  } catch {
    warnings.push(`${entry.name}: diamond is not a valid address: ${claimed}`);
    return;
  }
  if (normalised !== contracts.diamond) {
    warnings.push(
      `${entry.name}: registered tokens against diamond ${normalised}, but the ` +
        `diamond record says ${contracts.diamond}. One is stale — the lending ` +
        `market that has tokens registered may not be the one the app will call.`,
    );
  }
}

/**
 * The two token sets the diamond itself reports, out of a tokens record.
 *
 * WHY THIS IS CARRIED INTO THE APP AT ALL. Which assets a lending market accepts
 * is per-chain on-chain state — the operator passes COLLATERAL_TOKENS and
 * LOANABLE_TOKENS to register-tokens.js, and each call is gated on a usable price
 * feed, so the answer differs per chain and is not derivable from any address
 * table. Measured across the five deployed chains it differs from what the app
 * offers in both directions: kfUSD is offered on five and registered on none,
 * USDT on five and registered on two, the wrapped native is registered on five
 * and offered on none, and native value is offered as a LOAN currency on five
 * while loanable on none. Anything that validated a lending step against an
 * address table therefore passed plans the facet reverts. These arrays are the
 * only record of the real answer, and they are a read-back rather than an
 * intention: register-tokens.js writes them from getAllCollateralToken() and
 * getLoanableAssets() AFTER the transactions confirmed.
 *
 * Returns null and warns rather than throwing, on the same reasoning as the null
 * address values above: a tokens record predating the `onChain` read-back is
 * incomplete, not wrong, and refusing to write the whole registry over it would
 * block a deploy for a field that is a strict addition. A chain with no entry
 * here resolves to "unknown", which the consumer treats as a refusal to build a
 * lending step — see registeredLendingAssets in registry.ts.
 *
 * Duplicates are dropped WITH a warning, not silently: `addLoanableToken` has no
 * duplicate guard and nothing removes from `s_loanableToken`, so a second
 * register-tokens.js run against the same chain appends the whole set again. A
 * duplicate is harmless to a membership test and is a real signal about the
 * chain's state, so it is reported and then collapsed.
 */
function readRegistration(entry, warnings) {
  const onChain = entry.record?.onChain;
  if (!onChain || typeof onChain !== "object") {
    warnings.push(
      `${entry.name}: no "onChain" block, so which tokens this chain's lending ` +
        `market accepts is unrecorded. Re-run register-tokens.js — it reads both ` +
        `getters back after registering. Until then the app refuses to build ` +
        `lending steps on this chain rather than guessing from the address table.`,
    );
    return null;
  }

  const out = {};
  for (const side of ["collateral", "loanable"]) {
    const list = onChain[side];
    if (!Array.isArray(list)) {
      warnings.push(
        `${entry.name}: onChain.${side} is ${JSON.stringify(list)}, not an ` +
          `array — the whole registration is dropped rather than half of it, ` +
          `because a missing side would read as an empty one.`,
      );
      return null;
    }
    const seen = new Set();
    const kept = [];
    for (const value of list) {
      const address = normalise(`onChain.${side}[]`, value, entry.name);
      if (seen.has(address)) {
        warnings.push(
          `${entry.name}: onChain.${side} lists ${address} more than once. ` +
            `s_loanableToken is append-only with no duplicate guard, so this is ` +
            `what a repeated register-tokens.js run leaves behind. Collapsed here.`,
        );
        continue;
      }
      seen.add(address);
      kept.push(address);
    }
    out[side] = kept;
  }
  return out;
}

/* ------------------------------------------------------------------ main -- */

function main() {
  const all = discover();
  const skipped = all.filter((e) => e.skip);
  const usable = all.filter((e) => !e.skip);

  console.log(`Reading deployment records from ${relative(ROOT, RECORDS_DIR)}/`);
  console.log(`  ${all.length} file(s) matched deployment-*.json\n`);

  for (const e of skipped) {
    console.log(`  skip  ${e.name} — ${e.skip}`);
  }

  return { usable, skipped };
}

/**
 * Records for chains that are not tradable are dropped.
 *
 * The filter is `tradable` in chains.ts rather than a list of chain ids to
 * exclude, because `tradable` already means "the Diamond is going here" and is
 * maintained in one place. Two committed Abstract-testnet records are what make
 * this necessary (header note 1), but naming them would leave the next dropped
 * chain to be discovered the hard way — deriving it from chains.ts means the
 * filter follows the decision instead of trailing it.
 */
function partitionByChain(usable, chains) {
  const tradable = new Set(chains.filter((c) => c.tradable).map((c) => c.id));
  const byId = new Map(chains.map((c) => [c.id, c]));

  const kept = [];
  const dropped = [];
  for (const e of usable) {
    if (tradable.has(e.chainId)) {
      kept.push(e);
    } else {
      const meta = byId.get(e.chainId);
      dropped.push({
        ...e,
        why: meta
          ? `${meta.name} (${e.chainId}) is not tradable in chains.ts`
          : `chain ${e.chainId} is not registered in chains.ts at all`,
      });
    }
  }
  return { kept, dropped };
}

/** Newest record per (component, chainId). See header note 3. */
function newestPerComponent(kept) {
  const best = new Map();
  const superseded = [];
  for (const e of kept) {
    /* Pool records are keyed by the pool too, because a chain has many and they do
       not supersede one another -- collapsing them per chain would quietly reduce
       "every pool we opened here" to the most recently opened one. Two records
       naming the SAME pool do supersede, which is what a re-seed leaves behind. */
    const key =
      e.component === POOL_COMPONENT
        ? `${e.chainId}:${e.component}:${String(
            e.record?.pool ?? e.name,
          ).toLowerCase()}`
        : `${e.chainId}:${e.component}`;
    const prev = best.get(key);
    if (!prev || e.time.ms > prev.time.ms) {
      if (prev) superseded.push({ loser: prev, winner: e });
      best.set(key, e);
    } else {
      superseded.push({ loser: e, winner: prev });
    }
  }
  return { chosen: [...best.values()], superseded };
}

function build(chosen) {
  const deployments = {};
  const provenance = {};
  const droppedKeys = [];

  /* Sorted so the output is byte-stable across runs: the file is committed, and a
   * generator whose output reorders on every run makes every deploy show up as a
   * diff of the whole file. */
  const ordered = [...chosen].sort(
    (a, b) => a.chainId - b.chainId || a.component.localeCompare(b.component),
  );

  for (const entry of ordered) {
    /* Before the line below, not after it: that line creates the chain's entry as
       a side effect, and a chain whose only record is a pool would otherwise get
       an empty address bag in GENERATED_DEPLOYMENTS. Collected further down. */
    if (entry.component === POOL_COMPONENT) continue;

    const contracts = (deployments[entry.chainId] ??= {});
    const prov = (provenance[entry.chainId] ??= {});
    const map = FIELD_MAP[entry.component];
    const source = entry.name;

    if (entry.component === "tokens") continue; // handled after, as a cross-check

    const bag = entry.record?.contracts;
    if (!bag || typeof bag !== "object") {
      throw new Error(`${source}: no "contracts" object — the record is incomplete`);
    }

    for (const [key, value] of Object.entries(bag)) {
      if (!(key in map)) {
        /* Printed here rather than collected and returned, because mergeField a
         * few lines down can throw: a batched report is lost on exactly the run
         * where the extra context is most useful. */
        console.log(`  note  ${source}: unmapped key "${key}" (add it to FIELD_MAP)`);
        droppedKeys.push(key);
        continue;
      }
      const field = map[key];
      if (field === null) continue; // deliberately not carried

      /* A null VALUE is a different statement from a null mapping. The mapping
       * above says "this key has no registry field"; a null value says "this
       * contract does not exist on this chain".
       *
       * deploy-oracle.js writes `pythContract: null` on any chain running the
       * aggregator backend, because there is no Pyth contract behind an
       * AggregatorPriceOracle — and normalise() rejected it as "not a string",
       * aborting the entire generation over a field that is correctly absent. Base
       * Sepolia hit this on 2026-08-21 with a complete, verified deployment.
       *
       * Dropped with a note rather than silently, because a null where a value was
       * expected is worth seeing. Dropping is safe because presence is enforced
       * downstream, not here: isDeployed() stays false without `diamond`, and
       * auditRegistry() flags the combinations that matter.
       */
      if (value === null || value === undefined) {
        console.log(
          `  note  ${source}: ${key} is ${value === null ? "null" : "undefined"} — ` +
            `not applicable on this chain, dropped`,
        );
        continue;
      }

      mergeField(contracts, prov, entry.chainId, field, normalise(field, value, source), source);
    }

    /* oracleKind comes from the record's TOP LEVEL, not from `contracts`.
     *
     * It is not an address, so it has no place in the address bag — normalise()
     * would try to checksum it — but the registry needs it, because the two
     * backends are not interchangeable to a caller. auditRegistry() requires a
     * pythContract only on the Pyth backend, and the aggregator path reports
     * conf = 0 because AggregatorV3Interface has no confidence concept.
     *
     * deploy-oracle.js reads this back from the deployed contract's own
     * oracleKind() and refuses to write the record if it disagrees with what the
     * script thought it deployed. So this is the bytecode's answer, not an
     * inference from which branch ran.
     */
    if (entry.component === "oracle" && entry.record?.oracleKind != null) {
      const kind = entry.record.oracleKind;
      if (kind !== "pyth" && kind !== "aggregator-v3") {
        throw new Error(
          `${source}: oracleKind is ${JSON.stringify(kind)}, expected "pyth" or ` +
            `"aggregator-v3". ChainContracts.oracleKind is a union of exactly those ` +
            `two, so an unrecognised value would emit a file that does not type-check.`,
        );
      }
      mergeField(contracts, prov, entry.chainId, "oracleKind", kind, source);
    }
  }

  const warnings = [];
  const registration = {};
  const registrationProvenance = {};
  for (const entry of ordered) {
    if (entry.component !== "tokens") continue;
    crossCheckTokens(entry, deployments[entry.chainId] ?? {}, warnings);
    const reg = readRegistration(entry, warnings);
    if (reg) {
      registration[entry.chainId] = reg;
      registrationProvenance[entry.chainId] = entry.name;
    }
  }

  /* Which pools the deployer opened, per chain.
   *
   * Address only, because that is the entire question the app asks of this: a row
   * in the pool table either matches or it does not. The pair, the tier and the
   * two minted positions are all in the record and none of them help answer it,
   * and restating them here would be a second, staler copy of what the chain
   * already says.
   *
   * Sorted, and de-duplicated across records, so the emitted file is byte-stable
   * run to run for the reason `ordered` above is sorted. */
  const seededPools = {};
  for (const entry of ordered) {
    if (entry.component !== POOL_COMPONENT) continue;
    const address = normalise("pool", entry.record?.pool, entry.name);
    const list = (seededPools[entry.chainId] ??= []);
    if (!list.includes(address)) list.push(address);
  }
  for (const list of Object.values(seededPools)) list.sort();

  return {
    deployments,
    provenance,
    registration,
    registrationProvenance,
    seededPools,
    droppedKeys,
    warnings,
  };
}

function render(
  deployments,
  provenance,
  registration,
  registrationProvenance,
  seededPools,
  sources,
) {
  const chainIds = Object.keys(deployments)
    .map(Number)
    .sort((a, b) => a - b);

  const body = chainIds
    .map((id) => {
      const c = deployments[id];
      const fields = Object.keys(c)
        .sort()
        .map((f) => {
          /* Emit what prettier would already have produced.
           *
           * This file sits inside the glob that `npm run format:check` runs
           * (src, all .ts), so generator output that prettier would reformat
           * fails the format gate on every regeneration — and the failure looks
           * like a source problem rather than a generator one, because the file
           * it names is not hand-written.
           *
           * Prettier's printWidth is 80. It breaks after the colon when the
           * property and its value alone exceed that, and it cannot break a
           * trailing line comment, so an overflowing comment is tolerated and
           * only the pre-comment length decides. That threshold separates the
           * two kinds of value in this map exactly: a 32-byte poolInitCodeHash
           * is 66 characters quoted and lands at 92, while every address, at 42,
           * stays well under. Written as a length test rather than a check for
           * that one field so a future long value is handled too. */
          const head = `    ${f}: "${c[f]}",`;
          const comment = ` // ${provenance[id][f]}`;
          return head.length > 80
            ? `    ${f}:\n      "${c[f]}",${comment}`
            : `${head}${comment}`;
        })
        .join("\n");
      return `  ${id}: {\n${fields}\n  },`;
    })
    .join("\n");

  const map = chainIds.length
    ? `{\n${body}\n}`
    : `{}`;

  /* Rendered separately from the address map because it is a different kind of
   * fact: an address is where a contract is, this is what one of them accepts.
   * Chain ids are the tokens records' own, not `chainIds` above — a chain can
   * have a registration and no addresses of its own only if its records are
   * inconsistent, and keying off this map means such a chain is visible here
   * rather than dropped. */
  const regIds = Object.keys(registration)
    .map(Number)
    .sort((a, b) => a - b);

  const regBody = regIds
    .map((id) => {
      const sides = ["collateral", "loanable"]
        .map((side) => {
          const list = registration[id][side];
          /* One line when it fits, expanded when it does not — prettier's own
           * rule for an array literal, and `npm run format:check` globs every
           * .ts under src, which includes the file this writes. A generator
           * whose output prettier immediately rewrites leaves the tree dirty
           * after every run, which teaches people to ignore the check. */
          const flat = `    ${side}: [${list.map((a) => `"${a}"`).join(", ")}],`;
          if (flat.length <= 80) return flat;
          const items = list.map((a) => `      "${a}",`).join("\n");
          return `    ${side}: [\n${items}\n    ],`;
        })
        .join("\n");
      return `  ${id}: {\n    // ${registrationProvenance[id]}\n${sides}\n  },`;
    })
    .join("\n");

  const regMap = regIds.length ? `{\n${regBody}\n}` : `{}`;

  /* Same one-line-if-it-fits rule as the registration map above, and for the same
   * reason: prettier's printWidth is 80 and this file is inside the glob that
   * `npm run format:check` runs, so output prettier would rewrite fails the format
   * gate on every regeneration. An address is 44 characters quoted, so two of them
   * on one line already overflows and most chains expand. */
  const poolIds = Object.keys(seededPools)
    .map(Number)
    .sort((a, b) => a - b);

  const poolBody = poolIds
    .map((id) => {
      const list = seededPools[id];
      const flat = `  ${id}: [${list.map((a) => `"${a}"`).join(", ")}],`;
      if (flat.length <= 80) return flat;
      const items = list.map((a) => `    "${a}",`).join("\n");
      return `  ${id}: [\n${items}\n  ],`;
    })
    .join("\n");

  const poolMap = poolIds.length ? `{\n${poolBody}\n}` : `{}`;

  const sourceList = sources.length
    ? sources.map((s) => `    "${s}",`).join("\n")
    : "";

  return `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Written by \`node --import tsx scripts/gen-registry.mjs\` (npm run gen:registry),
 * which reads the \`smart-contract/deployment-*.json\` records that each deploy
 * script emits and folds them into one chain-keyed map. Run the generator after
 * every deploy; \`registry.ts\` spreads this into \`DEPLOYMENTS\`.
 *
 * Editing this file by hand is not just discouraged, it is silently undone: the
 * generator rewrites the whole file, so a manual correction survives exactly
 * until the next deploy. If an address here is wrong, fix the deployment record
 * (or add an explicit override in \`registry.ts\`'s \`DEPLOYMENTS\`, which spreads
 * this first for that purpose) — do not edit here.
 *
 * The trailing comment on each address names the record it came from, so a wrong
 * value can be traced to a deploy rather than guessed at.
 *
 * The type import is deliberately \`import type\`. \`registry.ts\` imports the value
 * below, so a value import in this direction would be a genuine runtime cycle;
 * \`import type\` is erased at compile time by tsc, tsx and webpack alike, which
 * leaves a single one-way runtime edge: registry.ts -> deployments.generated.ts.
 */
import type { ChainContracts, LendingRegistration } from "./registry";

export const GENERATED_DEPLOYMENTS: Record<number, ChainContracts> = ${map};

/**
 * What each chain's lending market accepts, read back off the diamond.
 *
 * From the \`onChain\` block of \`deployment-tokens-<network>.json\`, which
 * register-tokens.js writes from \`getAllCollateralToken()\` and
 * \`getLoanableAssets()\` after the registration transactions confirmed. So these
 * are the facet's own answers, not the operator's intent.
 *
 * This is NOT the list above with different names, and treating it as one is the
 * bug it exists to prevent: what the app offers comes from address existence,
 * what the market accepts comes from a per-chain owner transaction gated on a
 * usable price feed, and the two differ on every deployed chain. A chain absent
 * from this map is "we have not recorded what it accepts", which
 * \`registeredLendingAssets\` treats as a refusal rather than as an empty market.
 *
 * A SNAPSHOT, and the one thing to keep in mind about it: registering a token
 * on-chain does not update this file. \`register-tokens.js\` then
 * \`npm run gen:registry\` does. The borrow UI reads the same two getters live
 * (src/lib/lending/assets.ts), so the UI self-corrects and this does not — which
 * is why the synchronous paths that cannot make an RPC call (the intent builder
 * and the plan auditor) are the only intended consumers.
 */
export const GENERATED_LENDING_REGISTRATION: Record<
  number,
  LendingRegistration
> = ${regMap};

/**
 * Every V3 pool the deployer opened, per chain, from the
 * \`deployment-pool-<network>-<pair>-<fee>.json\` that seed-v3-pool.js writes when
 * it creates one and mints the first liquidity into it.
 *
 * This is what the verified tick on a pool row reads, so it is worth being exact
 * about the claim. The record proves the protocol's own deployer opened this pool
 * and funded it at a price taken from the diamond's oracle. It does NOT claim the
 * pool is still ours, still deep, or still correctly priced: any address can add
 * liquidity to a V3 pool, and a seeded pool's price moves with whoever trades it.
 * Sepolia's KLD/USDC has drifted to roughly 2.2x its seed through ordinary
 * trading and is no less ours for it.
 *
 * The distinction it does draw is the one a reader cannot make by looking. A pool
 * at the same pair and the same tier, opened by a stranger at a price they chose,
 * is otherwise identical in the table. That is not hypothetical either: on
 * Robinhood a third party had minted KLD at $9-$11 against our $0.03.
 *
 * Absence means "no record", never "not ours" -- an unseeded chain and an
 * unrecorded seed look the same here. So this list only ever ADDS a tick; nothing
 * uses it to mark a pool as suspect.
 */
export const GENERATED_SEEDED_POOLS: Record<number, string[]> = ${poolMap};

/**
 * What the generator last read, for debugging a wrong or missing address.
 */
export const GENERATED_META: {
  generatedAt: string | null;
  sources: string[];
} = {
  generatedAt: ${chainIds.length ? `"${new Date().toISOString()}"` : "null"},
  sources: [${sourceList ? `\n${sourceList}\n  ` : ""}],
};
`;
}

/* --------------------------------------------------------------- driver -- */

const { usable, skipped: _skipped } = main();

/* Imported dynamically and after the read phase, so a broken registry.ts cannot
 * stop the records from being parsed and reported. */
const { CHAINS } = await import("../src/constants/chains.ts");

const { kept, dropped } = partitionByChain(usable, CHAINS);
for (const d of dropped) {
  console.log(`  drop  ${d.name} — ${d.why}`);
}

const { chosen, superseded } = newestPerComponent(kept);
for (const s of superseded) {
  console.log(
    `  older ${s.loser.name} — superseded by ${s.winner.name} ` +
      `(by ${s.winner.time.from})`,
  );
}

const {
  deployments,
  provenance,
  registration,
  registrationProvenance,
  seededPools,
  droppedKeys,
  warnings,
} = build(chosen);
if (droppedKeys.length) {
  console.log(
    `  note  ${droppedKeys.length} record key(s) had no registry field and were dropped`,
  );
}

const sources = chosen.map((e) => e.name).sort();
writeFileSync(
  OUT_FILE,
  render(
    deployments,
    provenance,
    registration,
    registrationProvenance,
    seededPools,
    sources,
  ),
  "utf8",
);

const chainCount = Object.keys(deployments).length;
const fieldCount = Object.values(deployments).reduce(
  (n, c) => n + Object.keys(c).length,
  0,
);
console.log(
  `\nWrote ${relative(ROOT, OUT_FILE)}: ${fieldCount} address(es) across ` +
    `${chainCount} chain(s) from ${chosen.length} record(s).`,
);

const regChains = Object.keys(registration);
if (regChains.length) {
  const summary = regChains
    .map(Number)
    .sort((a, b) => a - b)
    .map(
      (id) =>
        `${id}: ${registration[id].collateral.length} collateral / ` +
        `${registration[id].loanable.length} loanable`,
    )
    .join(", ");
  console.log(`Lending registration read back from the diamonds — ${summary}.`);
} else {
  console.log(
    "No lending registration recorded: no tokens record carried an `onChain` " +
      "block, so the app will refuse to build lending steps on every chain. " +
      "Re-run register-tokens.js if any chain has assets registered.",
  );
}

const poolChains = Object.keys(seededPools);
if (poolChains.length) {
  const total = Object.values(seededPools).reduce((n, l) => n + l.length, 0);
  console.log(
    `Pools opened by the deployer: ${total} across ${poolChains.length} chain(s) ` +
      `-- these carry the verified tick in the app.`,
  );
} else {
  console.log(
    "No deployment-pool-*.json records, so no pool carries the verified tick. " +
      "Seed a pool with seed-v3-pool.js, or check the records were committed -- " +
      "an untracked record ticks the pool locally and not in production.",
  );
}

/* The audit runs against the file just written. registry.ts reads DEPLOYMENTS
 * from module scope rather than taking it as an argument, so this import has to
 * come after the write — importing earlier would audit the previous contents and
 * pass on a file that no longer exists. */
const { auditRegistry, auditDeployPlan } = await import(
  "../src/constants/registry.ts"
);

const problems = auditRegistry(CHAINS);
const planGaps = auditDeployPlan(CHAINS);

if (warnings.length) {
  console.log("\nWarnings:");
  for (const w of warnings) console.log(`  ! ${w}`);
}

/*
 * auditDeployPlan is reported but does NOT fail the run, and the distinction is
 * the one registry.ts itself draws at its definition: auditRegistry validates
 * recorded data, auditDeployPlan validates intent against what the repository
 * can deliver. The second is expected to be non-empty right now — there is no
 * KLD ERC20 in smart-contract/contracts, which is why staking is out of scope for
 * this wave. Failing on it would make this command permanently red and therefore
 * ignored, which would cost us the auditRegistry failures that do matter.
 */
if (planGaps.length) {
  console.log("\nDeploy-plan gaps (informational — intent vs. what exists):");
  for (const g of planGaps) console.log(`  - ${g}`);
}

if (problems.length) {
  console.error(`\nauditRegistry found ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  x ${p}`);
  console.error(
    "\nThese are data errors in the generated registry, not warnings. " +
      "The most common is a v3Factory with no poolInitCodeHash, which does not " +
      "fail at deploy — it fails at the first swap, in the pool callback.",
  );
  process.exit(1);
}

console.log("\nauditRegistry: no problems.");
