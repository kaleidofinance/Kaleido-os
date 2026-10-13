/**
 * One REAL end-to-end loan on a live lending diamond, then unwound — the
 * "simulation is not landing" check of MAINNET_DEPLOY_CHECKLIST.md §4.
 *
 *   KALEIDO_DIAMOND=0x… COLLATERAL=0x… COLLATERAL_AMOUNT=15000000 \
 *   npx hardhat run scripts/smoke-lending-live.js --network arcTestnet
 *
 * Roles: the hardhat signer is the LENDER (on our deploys it is also the fee
 * vault, which keeps the fee check exact: nothing else moves its balance while
 * the borrower repays). A fresh wallet is the BORROWER; its key is written to
 * SMOKE_KEY_FILE (required, and refused inside the repository) before it is
 * funded, so a run that dies halfway leaves recoverable funds, not stranded ones.
 *
 * Flow, each step asserted: fund borrower (collateral + gas) → deposit →
 * request LOAN_USDC native USDC (default 10.5, above the $10 minimum) → lender
 * services → borrower repays in full → fee == 5%-of-interest config reaches the
 * vault → lender withdraws the ledger credit in native → borrower withdraws the
 * collateral → borrower returns everything to the lender.
 *
 * Mainnet: refuses without CONFIRM_MAINNET=<chainId> typed in the shell.
 */
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
const { confirmMainnet } = require("./libraries/mainnet-guard.js");

const NATIVE = "0x0000000000000000000000000000000000000001";
const ERC20 = [
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

let failures = 0;
function check(label, cond, detail = "") {
  console.log(`   ${cond ? "✅" : "❌"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!cond) failures++;
}

async function main() {
  const [lender] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const diamond = ethers.getAddress(process.env.KALEIDO_DIAMOND);
  const collateralAddr = ethers.getAddress(process.env.COLLATERAL);
  const collateralAmount = BigInt(process.env.COLLATERAL_AMOUNT);
  const loanAmount = ethers.parseUnits(process.env.LOAN_USDC || "10.5", 18);
  const gasFund = ethers.parseUnits(process.env.BORROWER_GAS || "1", 18);
  const keyFile = path.resolve(process.env.SMOKE_KEY_FILE || "");
  if (!process.env.SMOKE_KEY_FILE || keyFile.startsWith(path.resolve(__dirname, "..", ".."))) {
    throw new Error("SMOKE_KEY_FILE must be a path OUTSIDE the repository (the borrower key is written there).");
  }

  const protocol = await ethers.getContractAt("ProtocolFacet", diamond, lender);
  const token = new ethers.Contract(collateralAddr, ERC20, lender);
  const sym = await token.symbol();
  const feeVault = lender.address;

  await confirmMainnet({
    chainId,
    script: "smoke-lending-live.js",
    plan: [
      ["diamond", diamond],
      ["lender / fee vault", lender.address],
      ["collateral", `${collateralAmount} base units of ${sym} ${collateralAddr}`],
      ["loan", `${ethers.formatUnits(loanAmount, 18)} native USDC, repaid and unwound in this run`],
    ],
  });

  const borrower = ethers.Wallet.createRandom().connect(ethers.provider);
  fs.writeFileSync(keyFile, borrower.privateKey, { mode: 0o600 });
  console.log(`Borrower ${borrower.address} (key saved to ${keyFile}; delete it after a clean run)`);
  const P = (s) => protocol.connect(s);

  console.log("\n1. fund the borrower");
  await (await token.transfer(borrower.address, collateralAmount)).wait();
  await (await lender.sendTransaction({ to: borrower.address, value: gasFund })).wait();
  check(`borrower holds ${sym} + gas`, (await token.balanceOf(borrower.address)) === collateralAmount);

  console.log("\n2. deposit → request");
  await (await token.connect(borrower).approve(diamond, collateralAmount)).wait();
  await (await P(borrower).depositCollateral(collateralAddr, collateralAmount)).wait();
  check(`${sym} deposited`, (await protocol.gets_addressToCollateralDeposited(borrower.address, collateralAddr)) === collateralAmount);
  const valued = await protocol.getAccountCollateralValue(borrower.address);
  console.log(`   collateral valued at $${ethers.formatUnits(valued, 18)}`);
  const returnDate = (await ethers.provider.getBlock("latest")).timestamp + 3 * 86400;
  await (await P(borrower).createLendingRequest(loanAmount, 1000, returnDate, NATIVE)).wait();
  const all = await protocol.getAllRequests(0, 100000);
  const mine = all.filter((r) => r.author === borrower.address);
  const id = mine[mine.length - 1].requestId;
  check("request created", mine.length === 1, `request #${id}`);

  console.log("\n3. service → repay");
  const bBefore = await ethers.provider.getBalance(borrower.address);
  await (await P(lender).serviceRequest(id, NATIVE, { value: loanAmount })).wait();
  check("borrower received the loan", (await ethers.provider.getBalance(borrower.address)) - bBefore === loanAmount);
  const total = (await protocol.getRequest(id)).totalRepayment;
  const [fee, toLender] = await protocol.getRepaymentFee(id, total);
  const vBefore = await ethers.provider.getBalance(feeVault);
  await (await P(borrower).repayLoan(id, total, { value: total })).wait();
  check("fee vault received exactly the fee", (await ethers.provider.getBalance(feeVault)) - vBefore === fee,
    `interest ${ethers.formatUnits(total - loanAmount, 18)}, fee ${ethers.formatUnits(fee, 18)} USDC`);
  check("loan closed", (await protocol.getRequest(id)).totalRepayment === 0n);

  console.log("\n4. unwind");
  const credited = await protocol.gets_addressToAvailableBalance(lender.address, NATIVE);
  check("lender credited total − fee", credited >= toLender, `${ethers.formatUnits(credited, 18)} USDC on the ledger`);
  await (await P(lender).withdrawCollateral(NATIVE, credited)).wait();
  check("lender withdrew the repayment", (await protocol.gets_addressToAvailableBalance(lender.address, NATIVE)) === 0n);
  await (await P(borrower).withdrawCollateral(collateralAddr, collateralAmount)).wait();
  check(`borrower withdrew the ${sym}`, (await token.balanceOf(borrower.address)) === collateralAmount);
  await (await token.connect(borrower).transfer(lender.address, collateralAmount)).wait();
  const left = await ethers.provider.getBalance(borrower.address);
  const fees = await ethers.provider.getFeeData();
  const price = fees.maxFeePerGas ?? fees.gasPrice;
  const gasLimit = (await ethers.provider.estimateGas({ from: borrower.address, to: lender.address, value: 1n })) * 12n / 10n;
  const reserve = gasLimit * price;
  if (left > reserve) {
    await (await borrower.sendTransaction({ to: lender.address, value: left - reserve, gasLimit,
      ...(fees.maxFeePerGas ? { maxFeePerGas: price, maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? 0n } : { gasPrice: price }) })).wait();
  }
  check(`${sym} and gas returned to the lender`, (await token.balanceOf(borrower.address)) === 0n,
    `borrower native left ${ethers.formatUnits(await ethers.provider.getBalance(borrower.address), 18)}`);

  if (failures) throw new Error(`${failures} check(s) failed — borrower key kept at ${keyFile}`);
  fs.rmSync(keyFile);
  console.log("\n✅ Live loan landed and unwound; borrower key deleted.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
