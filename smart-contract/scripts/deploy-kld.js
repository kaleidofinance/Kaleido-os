const hre = require("hardhat");
const { ethers } = require("hardhat");
const fs = require("fs");

/**
 * Deploys KLD and the staking system that has been waiting for it.
 *
 *   npx hardhat run scripts/deploy-kld.js --network sepolia
 *
 * Three contracts and four wiring calls. KLD is the protocol token described by
 * OWN_TOKENS in src/constants/registry.ts — symbol KLD, name "Kaleido", 18
 * decimals — and until this script ran, no contract in the repository minted it.
 * That absence is why `STAKING_CONTRACTS` held three dead Abstract-era literals,
 * why `getKLDVaultContract` throws while NEXT_PUBLIC_KLD_VAULT_ADDRESS is unset,
 * and why /stake could not be exercised on any chain.
 *
 *   KLD           the token
 *   KLDVaultV2    stake KLD, 7-day withdrawal cooldown, harvests from the
 *                 YieldTreasury already deployed on all five testnets
 *   StKLD         the rebasing receipt, minted only by the vault
 *
 * ── Why the wiring order is not negotiable ──────────────────────────────────
 *
 *   1. KLD                        nothing depends on it
 *   2. KLDVaultV2(yieldTreasury)  treasury address read from the stablecoin
 *                                 record, never hardcoded
 *   3. StKLD(vault, kld)          both immutable in its constructor, so the
 *                                 vault must exist first
 *   4. vault.setStKLD(stKLD)      one-shot; reverts on a second call
 *   5. vault.setSupport(kld,true)  refuses unless stKLD is already wired AND the
 *                                 token is stKLD's own — so 4 must precede 5
 *
 * Step 5's guard is the reason this cannot be reordered: the vault keys
 * `totalPooledKLD` per token while stKLD prices every share against one of those
 * keys, so a vault supporting two tokens misprices every staker silently. The
 * contract now refuses, which turns a reordering mistake into a failed
 * transaction rather than a live accounting bug.
 *
 * ── Every step is resumable, because the RPCs are not reliable ──────────────
 *
 * The first Sepolia run deployed all three contracts, landed setStKLD, and then
 * lost the connection during setSupport. Nothing had been recorded at that
 * point, so three live contracts became unreachable and a rerun would have
 * deployed a second set.
 *
 * So the record is written progressively, `status: "partial"` until the last
 * step lands, and a rerun ADOPTS whatever the record already names instead of
 * redeploying it. Every state change goes through `ensure`, which re-reads the
 * chain before acting and skips the step if it is already done. That makes a
 * rerun safe after a failure at any point, including the case that broke the
 * naive version: a transaction that mined while the response was being lost —
 * the retry sees the new state and does not send it twice.
 *
 * gen-registry.mjs skips `status: "partial"` records, so a half-wired set can
 * never reach the frontend.
 *
 * ── Testnet topology: five homes, deliberately ──────────────────────────────
 *
 * KLD is capped globally, and it enforces that by refusing to grant MINTER_ROLE
 * anywhere except `homeChainId`. On mainnet exactly one chain is home and every
 * other holds only bridged supply.
 *
 * On testnet this script passes each chain its OWN id as the home, so all five
 * deployments can issue independently. That is not the mainnet topology and is
 * not pretending to be: there is no bridge between testnets to move supply
 * across, and a satellite deployment with no bridge is a token with zero supply
 * and an untestable staking page. It is the same call already made for USDC,
 * where four chains run an independently mintable mock. Set KLD_HOME_CHAIN_ID to
 * pin a real home once a bridge exists.
 *
 * ── Supply ──────────────────────────────────────────────────────────────────
 *
 * 1,000,000,000 KLD, the documented total, minted in full to the deployer. The
 * cap is then exhausted — `totalIssued == maxSupply` — so no further issuance is
 * possible on this chain by anyone, ever, which is a stronger statement than the
 * cap alone. Distribution and vesting are not this script's business: the
 * allocation table lives in KLDVesting.sol for TGE and is deliberately not
 * deployed here, because a testnet does not need a four-year cliff to prove that
 * staking works.
 *
 * Env:
 *   KLD_MAX_SUPPLY      Whole KLD, default 1000000000.
 *   KLD_HOME_CHAIN_ID   Chain permitted to issue. Default: this chain.
 *   KLD_FAUCET_FUND     Whole KLD moved to the faucet, default 5000000. 0 skips.
 *   KLD_FAUCET_DRIP     Whole KLD per claim, default 1000.
 *   FORCE_REDEPLOY=1    Redeploy over a COMPLETE record for this network.
 */

const DEFAULT_MAX_SUPPLY = "1000000000";
const DEFAULT_FAUCET_FUND = "5000000";
const DEFAULT_FAUCET_DRIP = "1000";

const ATTEMPTS = 5;
const BACKOFF_MS = 4000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Public testnet RPCs drop reads under no load — the note every script here
 * carries. Sepolia's dropped mid-wiring on the first run of this one. */
const retry = async (label, fn, n = ATTEMPTS) => {
  let last;
  for (let i = 1; i <= n; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      console.log(`  … ${label} attempt ${i}/${n} failed: ${e.shortMessage || e.message}`);
      if (i < n) await sleep(BACKOFF_MS);
    }
  }
  throw last;
};

/**
 * Perform a state change only if the chain does not already show it done.
 *
 * `isDone` is re-read inside every attempt, which is what makes this safe to
 * retry across a dropped connection: if the transaction mined but the response
 * was lost, the next attempt observes the new state and sends nothing. A plain
 * retry around send+wait would double-send in exactly that case.
 */
const ensure = async (label, isDone, act, n = ATTEMPTS) => {
  let last;
  for (let i = 1; i <= n; i++) {
    try {
      if (await isDone()) {
        console.log(`  ${label.padEnd(12)} already in place`);
        return false;
      }
      const tx = await act();
      await tx.wait();
      if (!(await isDone())) {
        throw new Error(
          "transaction mined but the state did not change — refusing to continue",
        );
      }
      console.log(`  ${label.padEnd(12)} done`);
      return true;
    } catch (e) {
      last = e;
      console.log(`  … ${label} attempt ${i}/${n} failed: ${e.shortMessage || e.message}`);
      if (i < n) await sleep(BACKOFF_MS);
    }
  }
  throw last;
};

function wholeTokensFromEnv(name, fallback) {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? fallback : raw;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a whole number of KLD, got "${value}"`);
  }
  return ethers.parseEther(value);
}

function readRecord(name, chainId, why) {
  if (!fs.existsSync(name)) throw new Error(`${name} not found. ${why}`);
  const record = JSON.parse(fs.readFileSync(name, "utf8"));
  if (Number(record.chainId) !== chainId) {
    throw new Error(
      `${name} records chainId ${record.chainId}, but this run is on ${chainId}. ` +
        "One of the two is pointed at the wrong network — refusing to wire " +
        "another chain's contracts together.",
    );
  }
  return record;
}

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

async function main() {
  const net = hre.network.name;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const [deployer] = await ethers.getSigners();

  if (!deployer) {
    throw new Error(
      "No signer. hardhat.config.js reads DEPLOYER_PRIVATE_KEY, and dotenv " +
        "resolves it from smart-contract/.env — not the repo-root .env, which " +
        "names the same key PRIVATE_KEY.",
    );
  }

  const outName = `deployment-kld-${net}.json`;
  let prior = null;
  if (fs.existsSync(outName)) {
    prior = JSON.parse(fs.readFileSync(outName, "utf8"));
    if (prior.status === "complete" && process.env.FORCE_REDEPLOY !== "1") {
      throw new Error(
        `${outName} is a complete deployment. KLD is already live on ${net}; a ` +
          "second deployment would create a token with the same name and a " +
          "different address, and the registry would carry whichever was " +
          "generated last. Delete the record and pass FORCE_REDEPLOY=1 if that " +
          "is the intent.",
      );
    }
    if (process.env.FORCE_REDEPLOY === "1") {
      console.log(`FORCE_REDEPLOY=1 — ignoring ${outName} and deploying fresh.`);
      prior = null;
    } else {
      if (Number(prior.chainId) !== chainId) {
        throw new Error(
          `${outName} is a partial deployment on chain ${prior.chainId}, but ` +
            `this run is on ${chainId}. Refusing to adopt another chain's ` +
            "contracts.",
        );
      }
      console.log(`Resuming the partial deployment recorded in ${outName}.`);
    }
  }

  const maxSupply = wholeTokensFromEnv("KLD_MAX_SUPPLY", DEFAULT_MAX_SUPPLY);
  const homeChainId = Number(process.env.KLD_HOME_CHAIN_ID || chainId);
  const faucetFund = wholeTokensFromEnv("KLD_FAUCET_FUND", DEFAULT_FAUCET_FUND);
  const faucetDrip = wholeTokensFromEnv("KLD_FAUCET_DRIP", DEFAULT_FAUCET_DRIP);
  const isHome = homeChainId === chainId;

  console.log("============================================================");
  console.log(`KLD deployment — ${net} (chain ${chainId})`);
  console.log("============================================================");
  console.log(`  deployer     ${deployer.address}`);
  const balance = await retry("balance", () =>
    ethers.provider.getBalance(deployer.address),
  );
  console.log(`  balance      ${ethers.formatEther(balance)}`);
  console.log(`  max supply   ${ethers.formatEther(maxSupply)} KLD`);
  console.log(
    `  home chain   ${homeChainId}` +
      (isHome
        ? " (this chain — issuance permitted here)"
        : " (SATELLITE: this chain cannot issue, only receive over a bridge)"),
  );

  if (balance === 0n) {
    throw new Error(
      `Deployer holds no native on ${net}. Three deployments and four wiring ` +
        "transactions cannot be paid for.",
    );
  }

  /* The vault's yield source. Read from the stablecoin record rather than
   * hardcoded — it is already deployed on all five testnets, and a literal here
   * would be the same class of mistake as the Abstract addresses this replaces. */
  const stable = readRecord(
    `deployment-stablecoin-${net}.json`,
    chainId,
    "KLDVaultV2 harvests from the YieldTreasury deployed by " +
      "scripts/deploy-stablecoin.js, and takes its address in the constructor.",
  );
  const yieldTreasury = stable.contracts?.YieldTreasury;
  if (!yieldTreasury || !ethers.isAddress(yieldTreasury)) {
    throw new Error(
      `deployment-stablecoin-${net}.json has no YieldTreasury address. The ` +
        "vault constructor rejects address(0), so there is nothing to deploy.",
    );
  }
  console.log(`  treasury     ${yieldTreasury} (from the stablecoin record)`);

  /* The record grows as steps land, so a failure anywhere is resumable. */
  const contracts = { ...(prior?.contracts || {}) };
  let faucetResult = prior?.faucet || null;
  const save = (status) =>
    fs.writeFileSync(
      outName,
      JSON.stringify(
        {
          network: net,
          chainId: String(chainId),
          deployer: deployer.address,
          status,
          contracts,
          config: {
            maxSupply: maxSupply.toString(),
            maxSupplyHuman: ethers.formatEther(maxSupply),
            homeChainId,
            isHomeChain: isHome,
            mintedToDeployer: isHome ? maxSupply.toString() : "0",
            yieldTreasury,
          },
          faucet: faucetResult,
          timestamps: {
            started: prior?.timestamps?.started || new Date().toISOString(),
            ...(status === "complete" ? { deployed: new Date().toISOString() } : {}),
          },
          sources: { stablecoin: `deployment-stablecoin-${net}.json` },
          note: isHome
            ? "Testnet topology: this chain is its own KLD home, so it issues " +
              "its own supply. Mainnet uses a single home chain with every " +
              "other chain holding bridged supply only — see the script header."
            : "Satellite deployment: MINTER_ROLE cannot be granted here. " +
              "Supply arrives only via a BRIDGE_ROLE holder.",
        },
        null,
        2,
      ),
    );

  /**
   * Deploy `name`, or adopt the address the partial record already names.
   *
   * Adoption is checked twice over: there must be code at the address, and
   * `verify` must agree that it is the contract we would have deployed. A
   * record naming a contract from a different run — different cap, different
   * treasury — is worse than no record, so it is a hard stop.
   */
  const deployOrAdopt = async (key, name, args, verify) => {
    const existing = contracts[key];
    if (existing) {
      const code = await retry(`${key} code`, () =>
        ethers.provider.getCode(existing),
      );
      if (code === "0x") {
        throw new Error(
          `${outName} names ${existing} as ${key}, but there is no code there ` +
            `on chain ${chainId}. Delete the record and start again.`,
        );
      }
      const at = await ethers.getContractAt(name, existing);
      const complaint = await verify(at);
      if (complaint) {
        throw new Error(
          `Adopted ${key} at ${existing} does not match this run: ${complaint}. ` +
            "Delete the record and start again rather than wiring mismatched " +
            "contracts together.",
        );
      }
      console.log(`  adopted      ${existing}`);
      return at;
    }
    const deployed = await (await ethers.getContractFactory(name)).deploy(...args);
    await deployed.waitForDeployment();
    contracts[key] = await deployed.getAddress();
    save("partial");
    console.log(`  deployed     ${contracts[key]} (recorded before wiring)`);
    return deployed;
  };

  /* ── 1. KLD ───────────────────────────────────────────────────────────────*/
  console.log("\n[1/5] KLD");
  const kld = await deployOrAdopt(
    "KLD",
    "KLD",
    [maxSupply, homeChainId, deployer.address],
    async (at) => {
      const [cap, home] = await Promise.all([at.maxSupply(), at.homeChainId()]);
      if (cap !== maxSupply) {
        return `cap is ${ethers.formatEther(cap)} KLD, this run wants ${ethers.formatEther(maxSupply)}`;
      }
      if (Number(home) !== homeChainId) {
        return `home chain is ${home}, this run wants ${homeChainId}`;
      }
      return null;
    },
  );
  const kldAddress = await kld.getAddress();
  console.log(`  isHomeChain  ${await kld.isHomeChain()}`);

  /* ── 2. KLDVaultV2 ────────────────────────────────────────────────────────*/
  console.log("\n[2/5] KLDVaultV2");
  const vault = await deployOrAdopt(
    "KLDVault",
    "KLDVaultV2",
    [yieldTreasury],
    async (at) => {
      const wired = await at.yieldTreasury();
      return same(wired, yieldTreasury)
        ? null
        : `harvests from ${wired}, not the recorded treasury ${yieldTreasury}`;
    },
  );
  const vaultAddress = await vault.getAddress();
  console.log(`  cooldown     ${await vault.WITHDRAWAL_WAITING_PERIOD()}s`);

  /* ── 3. StKLD ─────────────────────────────────────────────────────────────*/
  console.log("\n[3/5] StKLD");
  const stkld = await deployOrAdopt(
    "stKLD",
    "StKLD",
    [vaultAddress, kldAddress],
    async (at) => {
      const [v, t] = await Promise.all([at.kldVault(), at.kldToken()]);
      if (!same(v, vaultAddress)) return `prices for vault ${v}, not ${vaultAddress}`;
      if (!same(t, kldAddress)) return `prices token ${t}, not ${kldAddress}`;
      return null;
    },
  );
  const stkldAddress = await stkld.getAddress();

  /* ── 4 & 5. Wiring, in the only order that works ──────────────────────────*/
  console.log("\n[4/5] Wiring");
  await ensure(
    "setStKLD",
    async () => same(await vault.stKLD(), stkldAddress),
    () => vault.setStKLD(stkldAddress),
  );
  await ensure(
    "setSupport",
    () => vault.supportedTokens(kldAddress),
    () => vault.setSupport(kldAddress, true),
  );

  // Read the whole set back rather than trusting the receipts.
  const wired = await retry("wiring read-back", async () => ({
    stKLD: await vault.stKLD(),
    supported: await vault.supportedTokens(kldAddress),
    vaultRole: await stkld.hasRole(await stkld.VAULT_ROLE(), vaultAddress),
    stkldToken: await stkld.kldToken(),
    stkldVault: await stkld.kldVault(),
  }));
  if (
    !same(wired.stKLD, stkldAddress) ||
    !wired.supported ||
    !wired.vaultRole ||
    !same(wired.stkldToken, kldAddress) ||
    !same(wired.stkldVault, vaultAddress)
  ) {
    throw new Error(
      `Wiring did not read back correctly: ${JSON.stringify(wired)}. The three ` +
        "contracts are deployed but do not form a working set — leaving the " +
        "record partial so it stays out of the registry.",
    );
  }
  console.log("  verified     vault↔stKLD↔KLD all agree");

  /* ── Supply ───────────────────────────────────────────────────────────────*/
  console.log("\n[5/5] Supply");
  if (isHome) {
    /* Mints the remaining headroom rather than `maxSupply`, so a rerun after a
     * partial mint finishes the job instead of reverting on the cap. */
    await ensure(
      "mint",
      async () => (await kld.remainingIssuance()) === 0n,
      async () => kld.mint(deployer.address, await kld.remainingIssuance()),
    );
    const [issued, remaining] = await retry("supply read", async () => [
      await kld.totalIssued(),
      await kld.remainingIssuance(),
    ]);
    console.log(`  issued       ${ethers.formatEther(issued)} KLD`);
    console.log(
      `  headroom     ${ethers.formatEther(remaining)} KLD` +
        (remaining === 0n ? " — the cap is exhausted, supply is now fixed" : ""),
    );
  } else {
    console.log("  skipped      satellite chain: supply can only arrive by bridge");
  }

  /* ── Faucet, so /stake is reachable by anyone ─────────────────────────────*/
  if (isHome && faucetFund > 0n) {
    const faucetRecordName = `deployment-faucet-${net}.json`;
    if (!fs.existsSync(faucetRecordName)) {
      console.log(
        `\nFaucet: no ${faucetRecordName} — skipping. Testers will need KLD ` +
          "transferred by hand before /stake can be exercised.",
      );
    } else {
      const faucetAddress = readRecord(faucetRecordName, chainId, "").contracts
        ?.faucet;
      console.log(`\nFaucet ${faucetAddress}`);
      const faucet = await ethers.getContractAt(
        [
          "function setDrip(address token, uint256 amount) external",
          "function drips(address) view returns (uint256 amount, bool listed)",
          "function owner() view returns (address)",
        ],
        faucetAddress,
      );
      const owner = await retry("faucet owner", () => faucet.owner());
      if (!same(owner, deployer.address)) {
        console.log(
          `  ! owned by ${owner}, not the deployer — cannot list KLD. Skipping.`,
        );
      } else {
        /* Fund BEFORE listing. The faucet transfers from its own balance rather
         * than minting, so a listed asset with no stock is a claim button that
         * reverts — worse than an unlisted one. */
        await ensure(
          "fund",
          async () => (await kld.balanceOf(faucetAddress)) >= faucetFund,
          () => kld.transfer(faucetAddress, faucetFund),
        );
        await ensure(
          "setDrip",
          async () => (await faucet.drips(kldAddress)).amount === faucetDrip,
          () => faucet.setDrip(kldAddress, faucetDrip),
        );
        const stocked = await retry("faucet stock", () =>
          kld.balanceOf(faucetAddress),
        );
        console.log(`  stocked      ${ethers.formatEther(stocked)} KLD`);
        console.log(
          `  drip         ${ethers.formatEther(faucetDrip)} KLD per claim ` +
            `(${stocked / faucetDrip} claims of stock)`,
        );
        faucetResult = {
          address: faucetAddress,
          funded: faucetFund.toString(),
          fundedHuman: ethers.formatEther(faucetFund),
          drip: faucetDrip.toString(),
          dripHuman: ethers.formatEther(faucetDrip),
        };
      }
    }
  }

  save("complete");

  console.log("\n============================================================");
  console.log("SUMMARY");
  console.log("============================================================");
  console.log(`  KLD        ${kldAddress}`);
  console.log(`  KLDVault   ${vaultAddress}`);
  console.log(`  stKLD      ${stkldAddress}`);
  console.log(`  record     ${outName} (status: complete)`);
  console.log("\nNext: npm run gen:registry (from the repo root) to thread these");
  console.log("into src/constants/deployments.generated.ts.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
