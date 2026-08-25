/**
 * Put a real lending book on chain: collateral, a listing, two live loans, and
 * one open request and one open listing left behind as targets.
 *
 *   npx hardhat run scripts/seed-lending.js --network sepolia
 *   COLLATERAL_USD=400 LISTING_USD=300 LOAN_USD=60 CURRENCY=wrappedNative \
 *     npx hardhat run scripts/seed-lending.js --network sepolia
 *
 * Nothing had ever exercised the lending market on any of the five testnets.
 * `getRequestId()` answered 0 and `getLoanListing(1)` reverted Protocol__IdNotExist
 * on every one of them, which means six of the agent's execute verbs — `borrow`,
 * `lend`, `takeListing`, `fillRequest`, `repay`, `cancel` — had no id anywhere to
 * act on. A plan built for request #1 on an empty book refuses with "I can't find
 * that request", which is the correct answer and indistinguishable from a broken
 * verb. So this creates the state those verbs need, and every id it produces is
 * written to deployment-lending-<network>.json.
 *
 * ── Two wallets, because the contract requires two ─────────────────────────
 *
 * A lender and a borrower cannot be the same address. `serviceRequest` reverts
 * Protocol__CantFundSelf when `_foundRequest.author == msg.sender`, and
 * `requestLoanFromListing` reverts Protocol__OwnerCreatedListing when
 * `_listing.author == msg.sender`. Both are deliberate — a self-funded loan is
 * free points and a fake book — so a single-signer script can create an offer and
 * can never fill one.
 *
 * hardhat.config.js hands out exactly one account (`accounts()` returns
 * `[DEPLOYER_PRIVATE_KEY]`), so the counterparty is derived here and funded from
 * the deployer. It is derived deterministically rather than randomly so that
 * re-runs land on the same address: a random wallet per run strands its gas and
 * its borrowed tokens somewhere nobody will look again, and leaves the book full
 * of loans whose borrower nobody can sign for.
 *
 * That derived key is exactly as public as the deployer key it comes from, which
 * on these testnets is permanently public and documented as such. It must never
 * be used on a mainnet. Set COUNTERPARTY_PRIVATE_KEY to point this at a wallet
 * you already hold instead — which is the better option if you want to open the
 * app as the borrower, since then the borrower side of /borrow is a wallet you
 * can already switch to in MetaMask.
 *
 * ── Sizes are USD targets converted through the diamond's own oracle ───────
 *
 * COLLATERAL_USD / LISTING_USD / LOAN_USD are dollars, and every raw token amount
 * below comes from `getUsdValue` on the same feed the health factor reads. A
 * hardcoded "0.05 WETH" would be a different loan every week and would silently
 * cross MIN_LOAN_AMOUNT ($10) or the 75% borrow cap as the price moved. Sizing in
 * USD means the collateral ratios this script sets up are the ones it prints.
 *
 * ── What it leaves on the book ─────────────────────────────────────────────
 *
 *   listing #L    OPEN, partially drawn      -> takeListing / cancel
 *   request #A    SERVICED, drawn from #L    -> repay
 *   request #B    SERVICED by the deployer   -> repay
 *   request #C    OPEN, unfunded             -> fillRequest / cancel
 *
 * plus native collateral on the borrower, so `withdraw` has a balance and the
 * health factor has something to divide.
 */

const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

const { registryFor } = require("./libraries/registry.js");

/** Constants.NATIVE_TOKEN — the sentinel the protocol keys native collateral by. */
const NATIVE = "0x0000000000000000000000000000000000000001";
/** Constants.MIN_LOAN_AMOUNT, 10 * PRECISION. */
const MIN_LOAN_USD = 10n * 10n ** 18n;
/** Constants.COLLATERALIZATION_RATIO. */
const LTV_PCT = 75n;

/*
 * The compiled ABI, not a hand-written one.
 *
 * `Request` begins `listingId, requestId, …` and `interestAccrued` is appended
 * after `status`, both for reasons documented in model/Protocol.sol. A minimal
 * human-readable ABI that gets that order wrong does not fail — it decodes
 * `totalRepayment` out of `interest` and reports a plausible wrong number, which
 * is the worst possible outcome for a script whose whole job is to report what
 * the book now contains. The artifact cannot drift from the contract it was
 * compiled from.
 */
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

const WETH_ABI = ["function deposit() payable", "function withdraw(uint256)"];

const num = (v, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
};

const usd = (v) => `$${Number(ethers.formatUnits(v, 18)).toFixed(2)}`;

/**
 * The counterparty wallet, connected to this network's provider.
 *
 * keccak256 over a labelled copy of the deployer key: deterministic, so the same
 * borrower comes back on every run and its leftover gas is reused rather than
 * stranded, and domain-separated by the label so this is not the deployer key
 * itself under a different name. A keccak digest lands outside secp256k1's valid
 * range with probability around 2^-128; if it ever did, `new Wallet` would throw
 * here rather than produce a wallet that cannot sign.
 */
function counterpartyWallet(provider) {
  const explicit = process.env.COUNTERPARTY_PRIVATE_KEY;
  if (explicit)
    return new ethers.Wallet(explicit.startsWith("0x") ? explicit : `0x${explicit}`, provider);
  const seed = process.env.DEPLOYER_PRIVATE_KEY;
  if (!seed)
    throw new Error(
      "no DEPLOYER_PRIVATE_KEY to derive a counterparty from, and no COUNTERPARTY_PRIVATE_KEY set",
    );
  const key = ethers.keccak256(
    ethers.toUtf8Bytes(`kaleido-testnet-counterparty-v1:${seed}`),
  );
  return new ethers.Wallet(key, provider);
}

/** How many raw units of `token` are worth `usdWei`, priced by the diamond. */
async function rawFor(protocol, token, decimals, usdWei) {
  const perWhole = await protocol.getUsdValue(token, 10n ** BigInt(decimals), decimals);
  if (perWhole === 0n)
    throw new Error(`the diamond prices ${token} at zero — refusing to size against it`);
  return { raw: (usdWei * 10n ** BigInt(decimals)) / perWhole, perWhole };
}

/** The first listing id that does not exist yet, by probing the getter. */
async function nextListingId(protocol, limit = 64) {
  for (let id = 1; id <= limit; id += 1) {
    try {
      await protocol.getLoanListing(id);
    } catch {
      return id;
    }
  }
  throw new Error(`more than ${limit} listings already exist; raise the probe limit`);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const lender = await deployer.getAddress();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const reg = registryFor(chainId);
  if (!reg.diamond) throw new Error(`chain ${chainId} has no diamond`);

  const borrowerWallet = counterpartyWallet(ethers.provider);
  const borrower = await borrowerWallet.getAddress();

  const collateralUsd = ethers.parseUnits(String(num(process.env.COLLATERAL_USD, 400)), 18);
  const listingUsd = ethers.parseUnits(String(num(process.env.LISTING_USD, 300)), 18);
  const loanUsd = ethers.parseUnits(String(num(process.env.LOAN_USD, 60)), 18);
  const currencyKey = process.env.CURRENCY ?? "wrappedNative";

  console.log(`\n=== ${hre.network.name} (chain ${chainId}): seeding the lending book ===`);
  console.log(`lender   ${lender}`);
  console.log(`borrower ${borrower}${process.env.COUNTERPARTY_PRIVATE_KEY ? " (from COUNTERPARTY_PRIVATE_KEY)" : " (derived)"}`);

  const protocol = new ethers.Contract(reg.diamond, PROTOCOL_ABI, deployer);

  /* ---- 0. the currency has to be loanable and priced, and native has to be
          registered collateral. All four are owner-set flags, so none of them can
          be assumed from the fact that the token exists. ---- */
  const currency = reg[currencyKey];
  if (!currency) throw new Error(`CURRENCY=${currencyKey} is not in the registry for chain ${chainId}`);
  const loanable = (await protocol.getLoanableAssets()).map((a) => a.toLowerCase());
  if (!loanable.includes(currency.toLowerCase()))
    throw new Error(
      `${currencyKey} ${currency} is not loanable on chain ${chainId}. Loanable: ${loanable.join(", ")}`,
    );
  const collateralTokens = (await protocol.getAllCollateralToken()).map((a) => a.toLowerCase());
  if (!collateralTokens.includes(NATIVE))
    throw new Error(
      `the native sentinel is not registered collateral on chain ${chainId}; collateral: ${collateralTokens.join(", ")}`,
    );

  const token = new ethers.Contract(currency, ERC20_ABI, deployer);
  const symbol = await token.symbol();
  const decimals = Number(await token.decimals());

  const { raw: collateralRaw, perWhole: nativePrice } = await rawFor(
    protocol,
    NATIVE,
    18,
    collateralUsd,
  );
  const { raw: listingRaw, perWhole: tokenPrice } = await rawFor(
    protocol,
    currency,
    decimals,
    listingUsd,
  );
  const { raw: loanRaw } = await rawFor(protocol, currency, decimals, loanUsd);

  console.log(`currency ${symbol} d=${decimals} ${currency} @ ${usd(tokenPrice)}`);
  console.log(`native   @ ${usd(nativePrice)}`);
  console.log(
    `sizing   collateral ${ethers.formatEther(collateralRaw)} native (${usd(collateralUsd)})` +
      `  listing ${ethers.formatUnits(listingRaw, decimals)} ${symbol} (${usd(listingUsd)})` +
      `  loan ${ethers.formatUnits(loanRaw, decimals)} ${symbol} (${usd(loanUsd)})`,
  );

  /* Refuse early on the two limits the contract enforces late, so a run that
     cannot possibly succeed fails before it spends anything. */
  if (loanUsd < MIN_LOAN_USD)
    throw new Error(`LOAN_USD ${usd(loanUsd)} is under MIN_LOAN_AMOUNT ${usd(MIN_LOAN_USD)}`);
  if (listingUsd < MIN_LOAN_USD)
    throw new Error(`LISTING_USD ${usd(listingUsd)} is under MIN_LOAN_AMOUNT ${usd(MIN_LOAN_USD)}`);
  /* Three loans of LOAN_USD are taken below, and each borrow checks
     `totalLoanCollected + loanUsd >= collateralValue * 75/100` with a strict
     `>=`. So the cap is what makes 3x fit, not 2x. */
  const cap = (collateralUsd * LTV_PCT) / 100n;
  if (loanUsd * 3n >= cap)
    throw new Error(
      `three loans of ${usd(loanUsd)} do not fit under the ${LTV_PCT}% cap on ${usd(collateralUsd)} of collateral (${usd(cap)}) — raise COLLATERAL_USD or lower LOAN_USD`,
    );
  if (listingRaw < loanRaw)
    throw new Error(`LISTING_USD must be at least LOAN_USD, or the listing cannot be drawn against`);

  /* ---- 1. gas and native budget ----
     The borrower needs its collateral plus gas for four transactions of its own.
     Sized off live fee data rather than a magic number, and printed, because on a
     chain whose gas price has spiked the honest failure is "you are short by X",
     not a wallet that runs out three transactions in. */
  const fee = await ethers.provider.getFeeData();
  const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  if (gasPrice === 0n) throw new Error("could not read a gas price from the node");
  const borrowerGas = gasPrice * 2_500_000n;
  /* The listing, the deployer's own fill of request B, and a slice for the
     interest buffer at the end. Without that third term the deployer's balance
     is exactly zero after servicing and the buffer transfer reverts on the last
     line of a run that otherwise succeeded — the interest itself is under 1% of a
     loan, so a tenth of one loan is a comfortable ceiling. */
  const bufferCeiling = loanRaw / 10n;
  const wrapRaw = listingRaw + loanRaw + bufferCeiling;
  const wrapNative = currencyKey === "wrappedNative" ? wrapRaw : 0n;
  const lenderNeed = collateralRaw + borrowerGas + wrapNative + gasPrice * 2_000_000n;
  const lenderHas = await ethers.provider.getBalance(lender);
  console.log(
    `gas      ${ethers.formatUnits(gasPrice, "gwei")} gwei` +
      `  borrower allowance ${ethers.formatEther(borrowerGas)}` +
      `  lender needs ~${ethers.formatEther(lenderNeed)}, has ${ethers.formatEther(lenderHas)}`,
  );
  if (lenderHas < lenderNeed)
    throw new Error(
      `short of native: need ~${ethers.formatEther(lenderNeed)}, have ${ethers.formatEther(lenderHas)}`,
    );

  /* ---- 2. the lender's loan currency ----
     Wrapping is the only way the deployer gets WETH: it holds none, and WETH9 has
     no mint. For any other currency the balance has to already be there. */
  let lenderBal = await token.balanceOf(lender);
  if (lenderBal < wrapRaw) {
    if (currencyKey !== "wrappedNative")
      throw new Error(
        `short of ${symbol}: have ${ethers.formatUnits(lenderBal, decimals)}, need ${ethers.formatUnits(wrapRaw, decimals)} and it is not the wrapped native we can mint by depositing`,
      );
    const short = wrapRaw - lenderBal;
    console.log(`\nwrapping ${ethers.formatEther(short)} native into ${symbol}`);
    await (await new ethers.Contract(currency, WETH_ABI, deployer).deposit({ value: short })).wait();
    lenderBal = await token.balanceOf(lender);
  }
  console.log(`lender holds ${ethers.formatUnits(lenderBal, decimals)} ${symbol}`);

  if ((await token.allowance(lender, reg.diamond)) < wrapRaw) {
    console.log(`approving ${symbol} to the diamond`);
    await (await token.approve(reg.diamond, ethers.MaxUint256)).wait();
  }

  /* ---- 3. the listing ----
     Bounds must bracket the escrow: createLoanListing rejects max > amount, and
     requestLoanFromListing needs min <= draw <= max. min is half a loan so a
     partial draw is legal and the listing survives it. */
  const now = Number((await ethers.provider.getBlock("latest")).timestamp);
  const DAY = 86400;
  const listingId = await nextListingId(protocol);
  console.log(`\ncreating listing #${listingId}: ${ethers.formatUnits(listingRaw, decimals)} ${symbol} @ 5.00% APR, due in 60 days`);
  {
    const tx = await protocol.createLoanListing(
      listingRaw,
      loanRaw / 2n,
      listingRaw,
      now + 60 * DAY,
      500,
      currency,
    );
    const r = await tx.wait();
    console.log(`  tx ${tx.hash}  gas ${r.gasUsed}`);
  }

  /* ---- 4. fund the borrower ---- */
  const borrowerHas = await ethers.provider.getBalance(borrower);
  const borrowerNeed = collateralRaw + borrowerGas;
  if (borrowerHas < borrowerNeed) {
    const send = borrowerNeed - borrowerHas;
    console.log(`\nfunding the borrower with ${ethers.formatEther(send)} native`);
    const tx = await deployer.sendTransaction({ to: borrower, value: send });
    await tx.wait();
    console.log(`  tx ${tx.hash}`);
  } else {
    console.log(`\nborrower already holds ${ethers.formatEther(borrowerHas)} native`);
  }

  const asBorrower = protocol.connect(borrowerWallet);

  /* ---- 5. collateral ----
     Native, under the sentinel. Deliberately not the loan currency: borrowing an
     asset you have posted as collateral reverts Protocol__CannotBorrowCollateralAsset,
     and the sentinel is a different storage key from WETH even though the two are
     the same underlying asset — which is what makes native-collateral/WETH-loan a
     legal pair. */
  console.log(`\ndepositing ${ethers.formatEther(collateralRaw)} native as collateral`);
  {
    const tx = await asBorrower.depositCollateral(NATIVE, collateralRaw, { value: collateralRaw });
    const r = await tx.wait();
    console.log(`  tx ${tx.hash}  gas ${r.gasUsed}`);
  }
  console.log(`  collateral value ${usd(await protocol.getAccountCollateralValue(borrower))}`);

  /* ---- 6. draw against the listing -> request A, SERVICED ---- */
  const idBefore = Number(await protocol.getRequestId());
  console.log(`\ndrawing ${ethers.formatUnits(loanRaw, decimals)} ${symbol} from listing #${listingId}`);
  {
    const tx = await asBorrower.requestLoanFromListing(listingId, loanRaw);
    const r = await tx.wait();
    console.log(`  tx ${tx.hash}  gas ${r.gasUsed}`);
  }
  const requestA = Number(await protocol.getRequestId());
  if (requestA !== idBefore + 1)
    throw new Error(`expected request ${idBefore + 1}, counter says ${requestA}`);
  console.log(`  request #${requestA} SERVICED, lender ${lender}`);

  /* ---- 7. an open request the deployer then services -> request B ---- */
  console.log(`\ncreating a lending request for ${ethers.formatUnits(loanRaw, decimals)} ${symbol} @ 8.00% APR, due in 30 days`);
  {
    const tx = await asBorrower.createLendingRequest(loanRaw, 800, now + 30 * DAY, currency);
    const r = await tx.wait();
    console.log(`  tx ${tx.hash}  gas ${r.gasUsed}`);
  }
  const requestB = Number(await protocol.getRequestId());
  console.log(`  request #${requestB} OPEN`);

  console.log(`servicing request #${requestB} as the lender`);
  {
    const tx = await protocol.serviceRequest(requestB, currency);
    const r = await tx.wait();
    console.log(`  tx ${tx.hash}  gas ${r.gasUsed}`);
  }
  console.log(`  request #${requestB} SERVICED`);

  /* ---- 8. one request left open, as a target for fillRequest ---- */
  console.log(`\ncreating a second lending request, left OPEN @ 12.00% APR, due in 45 days`);
  {
    const tx = await asBorrower.createLendingRequest(loanRaw, 1200, now + 45 * DAY, currency);
    const r = await tx.wait();
    console.log(`  tx ${tx.hash}  gas ${r.gasUsed}`);
  }
  const requestC = Number(await protocol.getRequestId());
  console.log(`  request #${requestC} OPEN — unfunded on purpose`);

  /* ---- 9. the interest, so repay is testable ----
     The borrower received exactly `amount` on each loan and owes
     `totalRepayment`, so it is short by the interest and nothing else. Read back
     rather than recomputed: _calculateLoanInterest prorates by the real block
     timestamp at origination, which this script does not control. */
  const [ra, rb] = [await protocol.getRequest(requestA), await protocol.getRequest(requestB)];
  const owed = ra.totalRepayment - ra.amount + (rb.totalRepayment - rb.amount);
  const want = owed + owed / 10n;
  const spare = await token.balanceOf(lender);
  const buffer = want > spare ? spare : want;
  console.log(
    `\ninterest owed across #${requestA} and #${requestB}: ${ethers.formatUnits(owed, decimals)} ${symbol}` +
      ` — sending ${ethers.formatUnits(buffer, decimals)} to the borrower so repay has funds`,
  );
  if (buffer < want)
    console.log(
      `  clamped to the lender's remaining balance; the borrower is ${ethers.formatUnits(owed - buffer, decimals)} ${symbol} short of a full repayment`,
    );
  if (buffer > 0n) {
    const tx = await token.transfer(borrower, buffer);
    await tx.wait();
    console.log(`  tx ${tx.hash}`);
  }

  /* ---- state ---- */
  const listing = await protocol.getLoanListing(listingId);
  const hf = await protocol.getHealthFactor(borrower);
  console.log(`\n--- book ---`);
  console.log(
    `listing #${listingId}: ${ethers.formatUnits(listing.amount, decimals)} ${symbol} left of ${ethers.formatUnits(listingRaw, decimals)}, ` +
      `bounds [${ethers.formatUnits(listing.min_amount, decimals)}, ${ethers.formatUnits(listing.max_amount, decimals)}], status ${listing.listingStatus}`,
  );
  for (const id of [requestA, requestB, requestC]) {
    const r = await protocol.getRequest(id);
    console.log(
      `request #${id}: ${ethers.formatUnits(r.amount, decimals)} ${symbol} @ ${Number(r.interest) / 100}% ` +
        `repay ${ethers.formatUnits(r.totalRepayment, decimals)} status ${r.status} lender ${r.lender}`,
    );
  }
  console.log(`borrower debt ${usd(await protocol.getLoanCollectedInUsd(borrower))} of ${usd(cap)} allowed`);
  console.log(
    `borrower health factor ${hf === ethers.MaxUint256 ? "unbounded" : ethers.formatUnits(hf, 18)}`,
  );
  console.log(`borrower ${symbol} ${ethers.formatUnits(await token.balanceOf(borrower), decimals)}`);
  console.log(`borrower native ${ethers.formatEther(await ethers.provider.getBalance(borrower))}`);
  console.log(`lender ${symbol} ${ethers.formatUnits(await token.balanceOf(lender), decimals)}`);
  console.log(`lender native ${ethers.formatEther(await ethers.provider.getBalance(lender))}`);

  const out = {
    network: hre.network.name,
    chainId,
    timestamp: new Date().toISOString(),
    diamond: reg.diamond,
    lender,
    borrower,
    borrowerSource: process.env.COUNTERPARTY_PRIVATE_KEY
      ? "COUNTERPARTY_PRIVATE_KEY"
      : "keccak256('kaleido-testnet-counterparty-v1:' + DEPLOYER_PRIVATE_KEY)",
    currency: { key: currencyKey, address: currency, symbol, decimals },
    sizing: {
      collateralUsd: collateralUsd.toString(),
      listingUsd: listingUsd.toString(),
      loanUsd: loanUsd.toString(),
      nativeUsdPerWhole: nativePrice.toString(),
      currencyUsdPerWhole: tokenPrice.toString(),
    },
    listing: { id: listingId, remaining: listing.amount.toString(), status: Number(listing.listingStatus) },
    requests: {
      fromListing: requestA,
      serviced: requestB,
      open: requestC,
    },
    targets: {
      takeListing: listingId,
      fillRequest: requestC,
      repay: [requestA, requestB],
      cancel: requestC,
    },
  };
  const file = `deployment-lending-${hre.network.name}.json`;
  fs.writeFileSync(path.join(__dirname, "..", file), JSON.stringify(out, null, 2));
  console.log(`\nwrote ${file}`);
}

main().catch((e) => {
  console.error("SEED LENDING FAILED:", e);
  process.exit(1);
});
