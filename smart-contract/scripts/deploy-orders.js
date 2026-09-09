/**
 * KaleidoOrders deployment — the settlement contract behind /trade/limit.
 *
 *   npx hardhat run scripts/deploy-orders.js --network sepolia
 *
 * A maker signs an EIP-712 `Order` off-chain and anyone may call `fill`. The
 * contract passes the maker's own signed `minOut` to the V3 router as
 * `amountOutMinimum` and sends the output straight to the maker, so a filler that
 * is late, offline or hostile can only fail to fill — never fill badly. That is
 * why there is no oracle here and no keeper allowlist.
 *
 * Takes no required input. The router is read from
 * deployment-v3-<network>[-<epochMs>].json rather than an env var, and that is
 * deliberate: it is a constructor argument held `immutable`, so a typo cannot be
 * corrected afterwards — it can only be redeployed, and a redeploy invalidates
 * every signature already in the order book (see the FORCE_REDEPLOY refusal
 * below). Reading the record means the pairing is the one the V3 deploy recorded
 * or the script stops.
 *
 * V3 and not V2 because that is where the liquidity is. The V2 factory has never
 * created a pair on any of the five chains, while the V3 KLD/USDC pool is what
 * /trade quotes and what the chart on the limit page draws.
 *
 * Optional:
 *   ORDERS_OWNER=0x...            owner; defaults to the deployer.
 *   ORDERS_FILLER_FEE_BPS=5       filler reimbursement, in bps of the input.
 *                                 Defaults to 0 — see the note below.
 *   FORCE_REDEPLOY=1              deploy anyway when a record already exists.
 *
 * Writes deployment-orders-<network>.json, which scripts/gen-registry.mjs folds
 * into ChainContracts.orders. Until the generator runs, /trade/limit still points
 * at the previous address — and a signature made against the previous address is
 * not a weaker signature, it is a different one, so nothing signed after this
 * deploy is fillable until the registry catches up.
 */

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");

/**
 * The V3 router this chain's periphery was deployed with.
 *
 * deploy-v3.js stamps its record with an epoch suffix, so a network can hold
 * several — Robinhood holds two whole V3 deployments an hour apart. The wrong
 * pick here is unrecoverable, because the address goes into an immutable, so the
 * question is which router is *live*, and there is already an answer to that:
 * gen-registry.mjs picks the newest record per (component, chain) and that pick is
 * what lands in ChainContracts.v3Router — the address /trade quotes against. So
 * this uses the same rule and the same ordering, rather than a stricter one.
 *
 * It was stricter once: every record had to agree, on the reasoning that a
 * generator's preference should not decide an immutable. That reads well and is
 * wrong in one specific way — it makes this script refuse to deploy on a chain the
 * app is running on perfectly well, and the only fixes available to whoever hits
 * it are to delete a record of a real deployment or to hand-edit history. Worse,
 * agreeing with the generator is the actual safety property: binding to a router
 * that no longer matches the registry is precisely the failure that would have
 * every fill revert, and unanimity does not prevent it — a chain with one stale
 * record passes the unanimity test and fails the real one.
 *
 * What is kept: the chainId guard (the records sit in one flat directory named by
 * hardhat network, so a mis-set --network reads a real, well-formed record
 * belonging to another chain), a refusal when the newest cannot be distinguished,
 * and — at the call site — the check that the winner holds code.
 *
 * Every record not chosen is printed. Choosing quietly is the part of the old
 * refusal worth keeping: an operator should see what this did not bind to.
 */
function readV3Router(net, chainId) {
  const prefix = `deployment-v3-${net}`;
  const names = fs
    .readdirSync(".")
    .filter(
      (n) =>
        n === `${prefix}.json` ||
        (n.startsWith(`${prefix}-`) && n.endsWith(".json")),
    )
    .sort();

  if (names.length === 0) {
    throw new Error(
      `No ${prefix}[-<epochMs>].json found. KaleidoOrders settles through the ` +
        "V3 router, so the V3 periphery must be deployed here first: " +
        `\`npx hardhat run scripts/deploy-v3.js --network ${net}\`.`,
    );
  }

  /* Same order of trust as gen-registry.mjs's recordTime: the ISO timestamp the
     deploy wrote, then the epoch in the filename. mtime is deliberately not a
     fallback here — a checkout rewrites it, which is how a stale record ends up
     looking newest, and this one is choosing an immutable. */
  const candidates = [];
  for (const name of names) {
    const record = JSON.parse(fs.readFileSync(name, "utf8"));
    if (Number(record.chainId) !== chainId) {
      throw new Error(
        `${name} records chainId ${record.chainId}, but this run is on ` +
          `${chainId}. One of the two is pointed at the wrong network — ` +
          "refusing to bind this contract to another chain's router.",
      );
    }
    const found = record?.contracts?.router;
    if (!found) continue;

    const iso = Date.parse(record?.timestamp ?? "");
    const epochMs = Number(name.match(/-(\d{10,})\.json$/)?.[1]);
    const time = Number.isFinite(iso)
      ? { ms: iso, from: "record.timestamp" }
      : Number.isFinite(epochMs)
        ? { ms: epochMs, from: "filename" }
        : null;
    if (!time) {
      throw new Error(
        `${name} carries neither a parseable "timestamp" nor an epoch in its ` +
          "filename, so it cannot be ordered against the others. Which V3 " +
          "periphery is live is not guessable from an unordered record.",
      );
    }
    candidates.push({ name, router: found, time });
  }

  if (candidates.length === 0) {
    throw new Error(`${names.join(", ")} has no usable contracts.router.`);
  }

  candidates.sort((a, b) => b.time.ms - a.time.ms);
  const [winner, ...rest] = candidates;

  /* A tie is the one case newest-wins cannot answer. Two records written in the
     same millisecond naming different routers means the ordering is not real. */
  const tied = rest.filter(
    (c) =>
      c.time.ms === winner.time.ms &&
      c.router.toLowerCase() !== winner.router.toLowerCase(),
  );
  if (tied.length > 0) {
    throw new Error(
      `${winner.name} and ${tied[0].name} name different V3 routers ` +
        `(${winner.router} vs ${tied[0].router}) and carry the same timestamp, ` +
        "so neither is newer. The router goes into an immutable; this script " +
        "will not guess. Delete the stale record and re-run.",
    );
  }

  for (const c of rest) {
    const same = c.router.toLowerCase() === winner.router.toLowerCase();
    console.log(
      `  note:      ${c.name} is older` +
        (same
          ? " (same router)"
          : ` and names a DIFFERENT router ${c.router} — not used`),
    );
  }

  return { router: winner.router, from: `${winner.name} (${winner.time.from})` };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = hre.network.name;
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  console.log("Deploying KaleidoOrders");
  console.log("  network:  ", net, `(chainId ${chainId})`);
  console.log("  deployer: ", deployer.address);
  console.log(
    "  balance:  ",
    ethers.formatEther(await ethers.provider.getBalance(deployer.address)),
  );

  /* A second orders contract on one chain is worse than a second faucet. The
   * registry can only carry one address, and that address is the EIP-712
   * `verifyingContract` — part of the digest. So every order already signed
   * against the old one becomes unfillable through the app the moment the
   * registry moves, AND uncancellable through it, because `cancel` is a call to
   * the contract that holds the order's state. The allowances point at the old
   * address too. None of that is visible in the UI; the orders simply stop
   * working.
   *
   * If a redeploy is genuinely needed: tell makers to cancel, or call
   * `cancelAll()` per maker on the old contract first — that bumps the epoch and
   * kills every signature at once — then delete the record and pass
   * FORCE_REDEPLOY=1. */
  const outName = `deployment-orders-${net}.json`;
  if (fs.existsSync(outName) && process.env.FORCE_REDEPLOY !== "1") {
    const prev = JSON.parse(fs.readFileSync(outName, "utf8"));
    throw new Error(
      `${outName} already exists (${prev?.contracts?.orders}).\n` +
        "The address is the EIP-712 verifyingContract, so redeploying does not " +
        "migrate the order book — it orphans it: every signed order becomes " +
        "unfillable and uncancellable through the app, and the makers' ERC20 " +
        "approvals still point at the old contract.\nIf that is understood, have " +
        "makers cancel (or call cancelAll() for each), delete the record, and " +
        "pass FORCE_REDEPLOY=1.",
    );
  }

  /* The router is the venue every fill routes through, and the contract holds it
   * immutable. Read from the V3 record so the two cannot disagree —
   * gen-registry.mjs cross-checks the same field across both records and stops if
   * they do. */
  const { router: routerAddress, from: routerFrom } = readV3Router(net, chainId);
  if (!ethers.isAddress(routerAddress)) {
    throw new Error(
      `${routerFrom} names a contracts.router that is not an address ` +
        `(${JSON.stringify(routerAddress)}).`,
    );
  }
  if ((await ethers.provider.getCode(routerAddress)) === "0x") {
    throw new Error(
      `v3Router ${routerAddress} holds no code on ${net}. ${routerFrom} names ` +
        "a contract that is not there — it is stale, or the deploy failed. " +
        "KaleidoOrders would deploy cleanly and revert on every fill.",
    );
  }
  console.log("  v3Router: ", routerAddress, `(${routerFrom})`);

  const owner = process.env.ORDERS_OWNER || deployer.address;
  if (!ethers.isAddress(owner)) {
    throw new Error(`ORDERS_OWNER is not a valid address: ${owner}`);
  }

  /* The owner's only power is setFillerFeeBps, capped at MAX_FILLER_FEE_BPS in
   * the contract. There is deliberately no rescue or sweep function: the router
   * pulls exactly what was approved and the output goes straight to the maker, so
   * a failed swap reverts the whole fill rather than stranding funds, and a
   * contract that transiently holds user input should not carry an owner-drain
   * path. Worth stating at deploy time because "owner" usually implies more. */
  console.log("  owner:    ", owner, owner === deployer.address ? "(deployer)" : "");

  console.log("\nDeploying KaleidoOrders...");
  const Orders = await ethers.getContractFactory("KaleidoOrders");
  const orders = await Orders.deploy(routerAddress, owner);
  await orders.waitForDeployment();
  const ordersAddress = await orders.getAddress();
  console.log("KaleidoOrders deployed to:", ordersAddress);

  /* Read the immutable back rather than trusting the argument. It cannot be
   * changed later, so this is the only moment the pairing can be checked at all,
   * and the failure it catches — a constructor argument silently reordered —
   * would otherwise surface as every fill reverting. */
  const boundRouter = await orders.router();
  if (boundRouter.toLowerCase() !== routerAddress.toLowerCase()) {
    throw new Error(
      `KaleidoOrders at ${ordersAddress} reports router ${boundRouter}, but was ` +
        `deployed with ${routerAddress}. The immutable cannot be corrected; this ` +
        "deployment is unusable.",
    );
  }

  /* Zero by default, and that is a decision rather than an omission: while we run
   * the only filler, a fee taken out of the maker's input to reimburse our own
   * keeper is a fee the maker pays us for a service we chose to provide. It is
   * read from storage on every fill, so turning it on later needs no redeploy —
   * which is what makes third-party filling possible without breaking anything
   * signed before. */
  let fillerFeeBps = 0;
  if (process.env.ORDERS_FILLER_FEE_BPS) {
    fillerFeeBps = Number(process.env.ORDERS_FILLER_FEE_BPS);
    if (!Number.isInteger(fillerFeeBps) || fillerFeeBps < 0) {
      throw new Error(
        `ORDERS_FILLER_FEE_BPS must be a non-negative integer, got ` +
          `${process.env.ORDERS_FILLER_FEE_BPS}`,
      );
    }
    const cap = Number(await orders.MAX_FILLER_FEE_BPS());
    if (fillerFeeBps > cap) {
      throw new Error(
        `ORDERS_FILLER_FEE_BPS ${fillerFeeBps} exceeds the contract's ` +
          `MAX_FILLER_FEE_BPS of ${cap}. The cap exists because the fee comes out ` +
          "of input the maker already signed for.",
      );
    }
    if (owner !== deployer.address) {
      throw new Error(
        `ORDERS_FILLER_FEE_BPS was set but the owner is ${owner}, not the ` +
          "deployer — setFillerFeeBps is onlyOwner, so this run cannot make the " +
          "call. Deploy with the fee at zero and have the owner set it.",
      );
    }
    console.log(`\nSetting fillerFeeBps to ${fillerFeeBps}...`);
    await (await orders.setFillerFeeBps(fillerFeeBps)).wait();
  }
  const onChainFee = Number(await orders.fillerFeeBps());

  /* The EIP-712 domain, recorded because the frontend must reproduce it exactly
   * and a mismatch in any of the four values produces a signature that is valid
   * nowhere. Read off the contract via ERC-5267 rather than restated from the
   * constructor, so what is written here is the digest's own answer. */
  const [, domainName, domainVersion, domainChainId, verifying] =
    await orders.eip712Domain();

  const deploymentInfo = {
    network: net,
    chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      orders: ordersAddress,
      /* Recorded so gen-registry.mjs can cross-check it against the V3 record —
       * an immutable pairing that silently goes stale is the one failure mode
       * this contract cannot recover from. */
      v3Router: routerAddress,
    },
    config: {
      owner,
      fillerFeeBps: onChainFee,
      maxFillerFeeBps: Number(await orders.MAX_FILLER_FEE_BPS()),
    },
    eip712: {
      name: domainName,
      version: domainVersion,
      chainId: Number(domainChainId),
      verifyingContract: verifying,
    },
    notes: {
      priceTrigger:
        "The maker's signed minOut is passed to the router as amountOutMinimum, " +
        "so the price bound and the trigger are the same value. No oracle.",
      venue:
        "V3. The V2 factory has created no pair on any chain; the V3 pools are " +
        "what /trade quotes. Paths are V3-packed: token || fee || token.",
      output: "Swapped straight to the maker; the contract never holds it.",
      cancellation:
        "cancel(order) per order, cancelAll() bumps the maker's epoch and kills " +
        "every signature at once. Deleting a row from the off-chain store does " +
        "not invalidate a signature.",
    },
  };

  fs.writeFileSync(outName, JSON.stringify(deploymentInfo, null, 2));

  console.log("\n============================================================");
  console.log("KALEIDO ORDERS DEPLOYMENT SUMMARY");
  console.log("============================================================");
  console.log("Orders:        ", ordersAddress);
  console.log("Router:        ", routerAddress);
  console.log("Owner:         ", owner);
  console.log("fillerFeeBps:  ", onChainFee);
  console.log(
    "EIP-712 domain:",
    `${domainName} v${domainVersion} @ chain ${Number(domainChainId)}`,
  );
  console.log(
    "\nRun `npm run gen:registry` from the repo root to fold this into\n" +
      `src/constants/deployments.generated.ts — DEPLOYMENTS[${chainId}].orders.\n` +
      "/trade/limit gates on that field, and it is also the address the maker\n" +
      "approves and the verifyingContract their wallet signs over, so nothing\n" +
      "can be signed here until the generator has run.",
  );
  console.log("Saved to:", outName);
  console.log("============================================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
