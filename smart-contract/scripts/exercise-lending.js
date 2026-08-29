/**
 * Act on a lending book that already exists: service, repay, close, withdraw.
 *
 *   READ=1 npx hardhat run scripts/exercise-lending.js --network sepolia
 *   SERVICE=5 npx hardhat run scripts/exercise-lending.js --network sepolia
 *   REPAY=4,5 CLOSE_REQUEST=6 CLOSE_LISTING=2 WITHDRAW=1 \
 *     npx hardhat run scripts/exercise-lending.js --network sepolia
 *
 * `seed-lending.js` creates a book. This one exercises the verbs that consume it
 * — the four calls that only exist once there is something on the book to act on,
 * and that therefore cannot be tested by any script that starts from empty:
 * `serviceRequest`, `repayLoan` (both its partial and its closing branch),
 * `closeRequest`, `closeListingAd` and `withdrawCollateral`.
 *
 * It is a separate script rather than a `--finish` flag on the seeder for a
 * reason the seeder's own header hints at: an RPC `ConnectTimeout` can land after
 * a transaction is broadcast, so a seed run can leave the book half-built with
 * the script convinced it failed. Re-running the seeder in that state does not
 * resume — it mints a second listing and three more requests. Something had to be
 * able to pick a book up where it was left, and that same something is what route
 * 7 needs anyway. So this reads the book first, always, and every id it acts on
 * comes from `READ` output or from the caller, never from a counter it advanced
 * itself.
 *
 * ── What it will not do without being told ────────────────────────────────
 *
 * With no env vars beyond READ it only reports. Each verb is opt-in by id
 * because the ids on a shared testnet book are also the agent's standing targets:
 * `deployment-lending-<network>.json` records which request the agent's
 * `fillRequest` is meant to find and which listing `takeListing` is meant to
 * draw on. A script that helpfully closed every open thing it found would leave
 * the agent's verbs with nothing to address, and the failure would surface much
 * later as "I can't find that request" — the same message a broken verb gives.
 *
 * ── Sizing comes from the contract, not from arithmetic here ───────────────
 *
 * `withdrawCollateral` asserts the health factor on the *decremented* state, and
 * separately refuses to touch collateral earmarked to a funded loan. Rather than
 * reimplement either bound, the largest legal withdrawal is found by static-call:
 * ask for the whole available balance, and halve until the contract stops
 * reverting. That measures the real ceiling instead of predicting it, and costs
 * nothing.
 *
 * Repayment is read back rather than computed. `totalRepayment` is decremented by
 * each partial payment, so after the first one the remainder is whatever the
 * contract now says it is — which is exactly what the closing branch needs, and
 * exactly what a locally-computed "half of the original, twice" would get wrong.
 */

const hre = require("hardhat");
const { ethers } = hre;
const { registryFor } = require("./libraries/registry.js");

const PROTOCOL_ABI = require(
  "../artifacts/contracts/facets/ProtocolFacet.sol/ProtocolFacet.json",
).abi;

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
];
const WETH_ABI = ["function deposit() payable"];

const NATIVE = "0x0000000000000000000000000000000000000001";
const STATUS = ["OPEN", "SERVICED", "CLOSED"];
const usd = (v) => `$${Number(ethers.formatUnits(v, 18)).toFixed(2)}`;

/** Same derivation as seed-lending.js — the borrower has to be the same wallet. */
function counterpartyWallet(provider) {
  const explicit = process.env.COUNTERPARTY_PRIVATE_KEY;
  if (explicit)
    return new ethers.Wallet(explicit.startsWith("0x") ? explicit : `0x${explicit}`, provider);
  const seed = process.env.DEPLOYER_PRIVATE_KEY;
  if (!seed) throw new Error("no DEPLOYER_PRIVATE_KEY to derive a counterparty from");
  return new ethers.Wallet(
    ethers.keccak256(ethers.toUtf8Bytes(`kaleido-testnet-counterparty-v1:${seed}`)),
    provider,
  );
}

const ids = (v) =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);

async function main() {
  const [deployer] = await ethers.getSigners();
  const lender = await deployer.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const reg = registryFor(chainId);
  if (!reg.diamond) throw new Error(`chain ${chainId} has no diamond`);

  const borrowerWallet = counterpartyWallet(ethers.provider);
  const borrower = await borrowerWallet.getAddress();
  const protocol = new ethers.Contract(reg.diamond, PROTOCOL_ABI, deployer);
  const asBorrower = protocol.connect(borrowerWallet);

  /* The seeder funds the borrower for exactly the transactions it is about to
   * send, so by the time this script runs the borrower is usually down to dust —
   * and a borrower-signed call then fails with "insufficient funds for gas",
   * which is a statement about the wallet and reads like a statement about the
   * verb. Topped up from the lender before any borrower-signed section. */
  const ensureBorrowerGas = async () => {
    const fee = await ethers.provider.getFeeData();
    const price = fee.maxFeePerGas ?? fee.gasPrice ?? 1_000_000_000n;
    const want = price * 3_000_000n;
    const has = await ethers.provider.getBalance(borrower);
    if (has >= want) return;
    console.log(`  funding the borrower with ${ethers.formatEther(want - has)} native for gas`);
    await (await deployer.sendTransaction({ to: borrower, value: want - has })).wait();
  };

  console.log(`\n=== ${hre.network.name}: lending book at ${reg.diamond} ===`);
  console.log(`lender ${lender}\nborrower ${borrower}`);

  /* ---- the book, read before anything is sent ---- */
  const meta = new Map();
  const describe = async (a) => {
    if (a === NATIVE) return { symbol: "NATIVE", decimals: 18 };
    if (!meta.has(a)) {
      const c = new ethers.Contract(a, ERC20_ABI, ethers.provider);
      meta.set(a, {
        symbol: await c.symbol().catch(() => a.slice(0, 8)),
        decimals: Number(await c.decimals().catch(() => 18)),
      });
    }
    return meta.get(a);
  };

  const count = Number(await protocol.getRequestId());
  const requests = [];
  for (let id = 1; id <= count; id += 1) {
    const r = await protocol.getRequest(id).catch(() => null);
    if (!r) continue;
    const m = await describe(r.loanRequestAddr);
    requests.push({ id, r, m });
    console.log(
      `  request #${id}  ${STATUS[Number(r.status)]}  ${ethers.formatUnits(r.amount, m.decimals)} ${m.symbol}` +
        `  owes ${ethers.formatUnits(r.totalRepayment, m.decimals)}  interest ${Number(r.interest) / 100}%` +
        `  author ${r.author === borrower ? "B" : r.author === lender ? "L" : r.author}` +
        `  lender ${r.lender === ethers.ZeroAddress ? "—" : r.lender === lender ? "L" : r.lender}`,
    );
  }

  for (let id = 1; id <= 64; id += 1) {
    const l = await protocol.getLoanListing(id).catch(() => null);
    if (!l) break;
    const m = await describe(l.tokenAddress);
    console.log(
      `  listing #${id}  ${l.listingStatus === 0n || Number(l.listingStatus) === 0 ? "OPEN" : "CLOSED"}` +
        `  ${ethers.formatUnits(l.amount, m.decimals)} ${m.symbol} left` +
        `  bounds ${ethers.formatUnits(l.min_amount, m.decimals)}..${ethers.formatUnits(l.max_amount, m.decimals)}` +
        `  author ${l.author === lender ? "L" : l.author}`,
    );
  }

  const [collateralValue, availableValue, debt, hf] = await Promise.all([
    protocol.getAccountCollateralValue(borrower),
    protocol.getAccountAvailableValue(borrower),
    protocol.getLoanCollectedInUsd(borrower),
    protocol.getHealthFactor(borrower),
  ]);
  console.log(
    `\nborrower: collateral ${usd(collateralValue)}  available ${usd(availableValue)}  debt ${usd(debt)}  health ${ethers.formatUnits(hf, 18)}`,
  );

  /* The debt side of the health factor does not come from the request list — it
   * comes from `userActiveRequet[user]`, an index each creation site appends to.
   * A SERVICED request missing from that index is invisible to
   * `getLoanCollectedInUsd`, so the health factor divides collateral by less debt
   * than exists. Worth printing both, because the two agreeing is the only thing
   * that makes a health-factor reading mean what it says.
   *
   * Requests created before the facet gained `_indexUserRequest` are exactly the
   * ones that can be missing, and `addUserActiveRequest` is the owner-gated
   * backfill the contract ships for them. */
  const indexed = (await protocol.getUserActiveRequests(borrower)).map((r) => Number(r.requestId));
  const servicedHere = requests.filter((q) => Number(q.r.status) === 1).map((q) => q.id);
  const missing = servicedHere.filter((id) => !indexed.includes(id));
  console.log(
    `  serviced requests on the book: #${servicedHere.join(", #") || "none"}` +
      `\n  counted by the health factor: #${indexed.join(", #") || "none"}`,
  );
  if (missing.length)
    console.log(
      `  #${missing.join(", #")} are SERVICED but not indexed, so the health factor understates the debt` +
        `\n  backfill with: BACKFILL=${missing.join(",")} npx hardhat run scripts/exercise-lending.js --network ${hre.network.name}`,
    );

  if (process.env.READ === "1") return;

  /* ---- backfill the debt index, owner-gated ---- */
  for (const id of ids(process.env.BACKFILL)) {
    /* Rebuilt field by field rather than passed back as the decoded `Result`:
     * ethers freezes that object, and ABI-encoding a struct argument writes into
     * the array it is handed. Only `requestId` is actually read — the function
     * checks the author against storage precisely so calldata cannot decide whose
     * debt this becomes — but every field still has to encode. */
    const r = await protocol.getRequest(id);
    const struct = [
      r.listingId,
      r.requestId,
      r.author,
      r.amount,
      r.interest,
      r.totalRepayment,
      r.returnDate,
      r.lender,
      r.loanRequestAddr,
      [...r.collateralTokens],
      r.status,
      r.interestAccrued,
    ];
    console.log(`\nbackfilling request #${id} into the borrower's debt index`);
    await protocol.addUserActiveRequest.staticCall(r.author, struct);
    const tx = await protocol.addUserActiveRequest(r.author, struct);
    const rc = await tx.wait();
    console.log(
      `  tx ${tx.hash}  gas ${rc.gasUsed}  debt now ${usd(await protocol.getLoanCollectedInUsd(borrower))}` +
        `  health ${ethers.formatUnits(await protocol.getHealthFactor(borrower), 18)}`,
    );
  }

  /* ---- serviceRequest: the leg that finishes an interrupted seed ---- */
  for (const id of ids(process.env.SERVICE)) {
    const row = requests.find((q) => q.id === id);
    if (!row) throw new Error(`request #${id} does not exist`);
    if (Number(row.r.status) !== 0)
      throw new Error(`request #${id} is ${STATUS[Number(row.r.status)]}, not OPEN — nothing to service`);
    const token = new ethers.Contract(row.r.loanRequestAddr, ERC20_ABI, deployer);
    const need = row.r.amount;
    let have = await token.balanceOf(lender);
    if (have < need && row.r.loanRequestAddr.toLowerCase() === (reg.wrappedNative ?? "").toLowerCase()) {
      console.log(`\nwrapping ${ethers.formatUnits(need - have, row.m.decimals)} native to service #${id}`);
      await (
        await new ethers.Contract(row.r.loanRequestAddr, WETH_ABI, deployer).deposit({
          value: need - have,
        })
      ).wait();
      have = await token.balanceOf(lender);
    }
    if (have < need)
      throw new Error(
        `short of ${row.m.symbol}: have ${ethers.formatUnits(have, row.m.decimals)}, need ${ethers.formatUnits(need, row.m.decimals)}`,
      );
    if ((await token.allowance(lender, reg.diamond)) < need)
      await (await token.approve(reg.diamond, ethers.MaxUint256)).wait();

    console.log(`\nservicing request #${id} as the lender`);
    await protocol.serviceRequest.staticCall(id, row.r.loanRequestAddr);
    const tx = await protocol.serviceRequest(id, row.r.loanRequestAddr);
    const rc = await tx.wait();
    const after = await protocol.getRequest(id);
    console.log(
      `  tx ${tx.hash}  gas ${rc.gasUsed}  now ${STATUS[Number(after.status)]}, owes ${ethers.formatUnits(after.totalRepayment, row.m.decimals)} ${row.m.symbol}`,
    );
  }

  /* ---- a second open request, if one is wanted as a target ---- */
  if (process.env.OPEN_REQUEST) {
    await ensureBorrowerGas();
    const [amountKey, bps, days] = process.env.OPEN_REQUEST.split(",");
    const template = requests.find((q) => q.id === Number(amountKey));
    if (!template) throw new Error(`OPEN_REQUEST wants request #${amountKey} as a size template`);
    const now = Number((await ethers.provider.getBlock("latest")).timestamp);
    console.log(
      `\ncreating an open request for ${ethers.formatUnits(template.r.amount, template.m.decimals)} ${template.m.symbol} @ ${Number(bps) / 100}%`,
    );
    const tx = await asBorrower.createLendingRequest(
      template.r.amount,
      Number(bps),
      now + Number(days) * 86400,
      template.r.loanRequestAddr,
    );
    const rc = await tx.wait();
    console.log(`  tx ${tx.hash}  gas ${rc.gasUsed}  request #${await protocol.getRequestId()} OPEN`);
  }

  /* ---- repayLoan: partial branch on the first id, closing branch after ----
     The borrower received `amount` and owes `totalRepayment`, so it is short by
     the interest and by nothing else. Topped up from the lender, wrapping if the
     currency is the wrapped native, because otherwise the closing branch reverts
     on a transferFrom for the last few wei and reads as a repay bug. */
  const repayIds = ids(process.env.REPAY);
  if (repayIds.length) {
    await ensureBorrowerGas();
    const rows = repayIds.map((id) => {
      const row = requests.find((q) => q.id === id);
      if (!row) throw new Error(`request #${id} does not exist`);
      return row;
    });
    /* Re-read: SERVICE above may have just changed one of these. */
    for (const row of rows) row.r = await protocol.getRequest(row.id);
    for (const row of rows)
      if (Number(row.r.status) !== 1)
        throw new Error(`request #${row.id} is ${STATUS[Number(row.r.status)]}, not SERVICED`);

    const token = new ethers.Contract(rows[0].r.loanRequestAddr, ERC20_ABI, borrowerWallet);
    const dec = rows[0].m.decimals;
    const owed = rows.reduce((a, row) => a + row.r.totalRepayment, 0n);
    let held = await token.balanceOf(borrower);
    console.log(
      `\nrepaying #${repayIds.join(", #")}: owes ${ethers.formatUnits(owed, dec)} ${rows[0].m.symbol}, holds ${ethers.formatUnits(held, dec)}`,
    );
    if (held < owed) {
      const short = owed - held;
      const asLender = new ethers.Contract(rows[0].r.loanRequestAddr, ERC20_ABI, deployer);
      let lenderHas = await asLender.balanceOf(lender);
      if (
        lenderHas < short &&
        rows[0].r.loanRequestAddr.toLowerCase() === (reg.wrappedNative ?? "").toLowerCase()
      ) {
        console.log(`  lender wrapping ${ethers.formatUnits(short - lenderHas, dec)} native`);
        await (
          await new ethers.Contract(rows[0].r.loanRequestAddr, WETH_ABI, deployer).deposit({
            value: short - lenderHas,
          })
        ).wait();
        lenderHas = await asLender.balanceOf(lender);
      }
      if (lenderHas < short)
        throw new Error(`the lender cannot cover the borrower's ${ethers.formatUnits(short, dec)} shortfall`);
      console.log(`  lender sends the borrower ${ethers.formatUnits(short, dec)} ${rows[0].m.symbol} of interest`);
      await (await asLender.transfer(borrower, short)).wait();
      held = await token.balanceOf(borrower);
    }
    if ((await token.allowance(borrower, reg.diamond)) < owed)
      await (await token.approve(reg.diamond, ethers.MaxUint256)).wait();

    /* First id gets both branches; the rest are repaid in one call. */
    const [first, ...rest] = rows;
    const half = first.r.totalRepayment / 2n;
    console.log(
      `  #${first.id} partial: ${ethers.formatUnits(half, dec)} of ${ethers.formatUnits(first.r.totalRepayment, dec)}`,
    );
    let tx = await asBorrower.repayLoan(first.id, half);
    let rc = await tx.wait();
    let now = await protocol.getRequest(first.id);
    console.log(
      `    tx ${tx.hash}  gas ${rc.gasUsed}  ${STATUS[Number(now.status)]}, remainder ${ethers.formatUnits(now.totalRepayment, dec)}` +
        (now.totalRepayment === first.r.totalRepayment - half ? "  (exact)" : "  — MISMATCH"),
    );

    console.log(`  #${first.id} closing: ${ethers.formatUnits(now.totalRepayment, dec)}`);
    tx = await asBorrower.repayLoan(first.id, now.totalRepayment);
    rc = await tx.wait();
    now = await protocol.getRequest(first.id);
    console.log(
      `    tx ${tx.hash}  gas ${rc.gasUsed}  ${STATUS[Number(now.status)]}, owes ${ethers.formatUnits(now.totalRepayment, dec)}`,
    );

    for (const row of rest) {
      console.log(`  #${row.id} in full: ${ethers.formatUnits(row.r.totalRepayment, dec)}`);
      tx = await asBorrower.repayLoan(row.id, row.r.totalRepayment);
      rc = await tx.wait();
      const after = await protocol.getRequest(row.id);
      console.log(
        `    tx ${tx.hash}  gas ${rc.gasUsed}  ${STATUS[Number(after.status)]}, owes ${ethers.formatUnits(after.totalRepayment, dec)}`,
      );
    }
  }

  /* ---- closeRequest: terminal, and only for an OPEN one ---- */
  for (const id of ids(process.env.CLOSE_REQUEST)) {
    await ensureBorrowerGas();
    const before = await protocol.getRequest(id);
    console.log(`\nclosing request #${id} (${STATUS[Number(before.status)]})`);
    await asBorrower.closeRequest.staticCall(id);
    const tx = await asBorrower.closeRequest(id);
    const rc = await tx.wait();
    console.log(
      `  tx ${tx.hash}  gas ${rc.gasUsed}  now ${STATUS[Number((await protocol.getRequest(id)).status)]}`,
    );
  }

  /* ---- closeListingAd: returns the undrawn escrow to the lender ---- */
  for (const id of ids(process.env.CLOSE_LISTING)) {
    const l = await protocol.getLoanListing(id);
    const m = await describe(l.tokenAddress);
    const token = new ethers.Contract(l.tokenAddress, ERC20_ABI, ethers.provider);
    const before = await token.balanceOf(lender);
    console.log(`\nclosing listing #${id}, ${ethers.formatUnits(l.amount, m.decimals)} ${m.symbol} undrawn`);
    await protocol.closeListingAd.staticCall(id);
    const tx = await protocol.closeListingAd(id);
    const rc = await tx.wait();
    const back = (await token.balanceOf(lender)) - before;
    console.log(
      `  tx ${tx.hash}  gas ${rc.gasUsed}  returned ${ethers.formatUnits(back, m.decimals)} ${m.symbol}` +
        (back === l.amount ? "  (the whole undrawn escrow, exact)" : "  — not the escrowed amount"),
    );
  }

  /* ---- withdrawCollateral: the only call that checks health on the way down --- */
  if (process.env.WITHDRAW === "1") {
    await ensureBorrowerGas();
    const tokens = await protocol.getUserCollateralTokens(borrower);
    for (const addr of tokens) {
      const m = await describe(addr);
      /* The available balance is the ceiling the earmark check imposes; the health
       * factor imposes a second one. Static-call finds where the real bound is
       * instead of predicting which of the two binds — converted from USD through
       * the same oracle the seeder sizes with. */
      const availUsd = await protocol.getAccountAvailableValue(borrower);
      const perWhole = await protocol.getUsdValue(addr, 10n ** BigInt(m.decimals), m.decimals);
      let ask = perWhole === 0n ? 0n : (availUsd * 10n ** BigInt(m.decimals)) / perWhole;
      if (ask === 0n) {
        console.log(`\n${m.symbol}: nothing available to withdraw`);
        continue;
      }
      let reason = "";
      let ok = false;
      for (let i = 0; i < 8 && !ok; i += 1) {
        try {
          await asBorrower.withdrawCollateral.staticCall(addr, ask);
          ok = true;
        } catch (e) {
          reason = e.shortMessage || e.message;
          ask /= 2n;
        }
      }
      console.log(
        `\n${m.symbol}: largest withdrawal the contract accepts is ${ethers.formatUnits(ask, m.decimals)}` +
          (reason ? `  (the full available balance reverted: ${reason})` : "  (the full available balance)"),
      );
      if (!ok || ask === 0n) {
        console.log(`  no legal withdrawal found`);
        continue;
      }

      /* Taking the whole ceiling would leave the position at a health factor of
       * about 1.07 — legal, and the correct measurement of the bound, but this
       * borrower's collateral is also what keeps the *other* open requests on this
       * book fundable, and those are the agent's standing targets. So the verb is
       * exercised with a fraction of the measured maximum and the maximum is
       * reported rather than taken. */
      const pct = BigInt(Number(process.env.WITHDRAW_PCT ?? 50));
      const take = (ask * pct) / 100n;
      console.log(`  taking ${pct}% of it: ${ethers.formatUnits(take, m.decimals)} ${m.symbol}`);
      const beforeBal = await ethers.provider.getBalance(borrower);
      const tx = await asBorrower.withdrawCollateral(addr, take);
      const rc = await tx.wait();
      const afterBal = await ethers.provider.getBalance(borrower);
      console.log(
        `  tx ${tx.hash}  gas ${rc.gasUsed}  native ${ethers.formatEther(beforeBal)} -> ${ethers.formatEther(afterBal)}` +
          (addr === NATIVE ? " (the withdrawal, less gas)" : ""),
      );
      console.log(
        `  collateral ${usd(await protocol.getAccountCollateralValue(borrower))}  health ${ethers.formatUnits(await protocol.getHealthFactor(borrower), 18)}`,
      );
    }
  }

  console.log(
    `\n--- after ---\nborrower: collateral ${usd(await protocol.getAccountCollateralValue(borrower))}` +
      `  debt ${usd(await protocol.getLoanCollectedInUsd(borrower))}` +
      `  health ${ethers.formatUnits(await protocol.getHealthFactor(borrower), 18)}`,
  );
}

main().catch((e) => {
  console.error("LENDING EXERCISE FAILED:", e.shortMessage || e.message || e);
  process.exit(1);
});
