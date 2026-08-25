const { expect } = require("chai");
const { ethers } = require("hardhat");
const { getSelectors, FacetCutAction } = require("../scripts/libraries/diamond.js");

/**
 * Protocol__UnexpectedNativeValue — ETH attached to an ERC20 call is rejected.
 *
 * ProtocolFacet has four `payable` external functions, and every one of them can
 * move either the native token or an ERC20. `payable` is required for the native
 * branch, which reads `msg.value`; the consequence was that the ERC20 branch of
 * each was silently absorbing. The value arrived, the ERC20 branch pulled the
 * tokens with `transferFrom` and never looked at `msg.value`, no ledger was
 * credited, and the ETH stayed in the diamond belonging to nobody — not the
 * sender, not the protocol's fee accounting, not `s_addressToAvailableBalance`.
 * Nothing could pay it out again.
 *
 * The four, and where each is guarded:
 *
 *   depositCollateral    _valueMoreThanZero  (first modifier)
 *   createLoanListing    _valueMoreThanZero  (first modifier)
 *   serviceRequest       _nativeMoreThanZero (first modifier)
 *   repayLoan            inline, after the request is read out of storage
 *
 * The first three share a modifier that was already branching on
 * `_token == NATIVE_TOKEN` to require value on the native side; the fix checks
 * the other direction of the same branch. `repayLoan` cannot use them because
 * the currency is `_request.loanRequestAddr`, which is not known until the
 * request has been loaded — hence the inline check, and hence this file needs a
 * fully serviced loan rather than the bare diamond the other three need.
 *
 * Each case is paired with a control that sends the SAME call with no value, so
 * a passing test means "the guard fires on stray value and only on stray value"
 * rather than "the call reverted for some reason". Two of the controls are
 * deliberately calls that revert for a *different* reason — that is what proves
 * the guard runs before the allowlist and the loanable check, which is what makes
 * it total: a guard placed after them would leave value attached to a rejected
 * token stranded just the same, because the revert refunds but the modifiers
 * ordering decides which error the caller sees.
 *
 * On the harness: ProtocolFacet is deployed behind a real diamond, not called
 * directly. Its owner-only setters go through `LibDiamond.enforceIsContractOwner`,
 * which reads LibDiamond's own storage slot — on a standalone facet that slot has
 * never been written, so `owner` is `address(0)` and every setter reverts. Same
 * reason `FeedMaxAge.test.js` builds a diamond.
 */
describe("Protocol__UnexpectedNativeValue", function () {
  /** address(1). Not the 0xEeee… convention — see Constants.NATIVE_TOKEN. */
  const NATIVE = "0x0000000000000000000000000000000000000001";

  /* MockPyth ignores the feed id and returns one price for every lookup, so the
     ids only have to be distinct and non-zero: `_priceScaled18` rejects
     bytes32(0) as "price feed not set". Both assets therefore price at $1. */
  const FEED_COL = "0x" + "11".repeat(32);
  const FEED_LOAN = "0x" + "22".repeat(32);
  const FEED_NATIVE = "0x" + "33".repeat(32);

  const ONE = ethers.parseEther("1");
  const COLLATERAL = ethers.parseEther("1000"); // $1000
  const LOAN_AMOUNT = ethers.parseEther("100"); // $100, well under the 75% cap
  const INTEREST_BPS = 1000; // 10%

  async function fixture() {
    const [owner, borrower, lender] = await ethers.getSigners();

    const cut = await (await ethers.getContractFactory("DiamondCutFacet")).deploy();
    const diamond = await (
      await ethers.getContractFactory("Diamond")
    ).deploy(owner.address, await cut.getAddress());
    const facet = await (await ethers.getContractFactory("ProtocolFacet")).deploy();

    const diamondAddress = await diamond.getAddress();
    await (await ethers.getContractAt("IDiamondCut", diamondAddress)).diamondCut(
      [
        {
          facetAddress: await facet.getAddress(),
          action: FacetCutAction.Add,
          functionSelectors: getSelectors(facet),
        },
      ],
      ethers.ZeroAddress,
      "0x"
    );
    const protocol = await ethers.getContractAt("ProtocolFacet", diamondAddress);

    /* price 1e8 at expo -8 is $1: _priceScaled18 shifts by 18 + expo. conf 0
       keeps the confidence check out of the way — it is not what is under test. */
    const pyth = await (await ethers.getContractFactory("MockPyth")).deploy(0);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    await pyth.setPrice(100000000n, 0n, -8, now);
    const oracle = await (
      await ethers.getContractFactory("PythPriceOracle")
    ).deploy(await pyth.getAddress());

    await protocol.setPythOracle(await oracle.getAddress());
    /* Both bounds must be non-zero or _priceScaled18 refuses to price anything:
       an unconfigured bound is never read as "no limit". */
    await protocol.setPriceBounds(3600, 100);

    const erc20 = await ethers.getContractFactory("MockERC20");
    const col = await erc20.deploy("Collateral", "COL", 18);
    const loan = await erc20.deploy("Loan", "LOAN", 18);
    /* Registered nowhere — the negative control for modifier ordering. */
    const stranger = await erc20.deploy("Stranger", "STR", 18);

    await protocol.addCollateralTokens(
      [await col.getAddress(), NATIVE],
      [FEED_COL, FEED_NATIVE]
    );
    await protocol.addLoanableToken(await loan.getAddress(), FEED_LOAN);

    /* repayLoan takes the protocol's cut of the interest before crediting the
       lender, and both of these are require-guarded sentinels rather than
       defaults — an unset vault reverts Protocol__InvalidFeeVault and an unset
       rate reverts on the fee split. Set here so the no-value CONTROLS get all
       the way through; the stray-value cases revert long before reaching them. */
    await protocol.setFeeVault(owner.address);
    await protocol.setBPS(100);

    return { owner, borrower, lender, protocol, col, loan, stranger };
  }

  /**
   * A borrower with collateral down and two OPEN requests.
   *
   * Two because the serviceRequest case has to fund one and leave one open: a
   * serviced request fails the `status != OPEN` check before reaching anything
   * this file is testing, and a test that passes for that reason is worthless.
   */
  async function withOpenRequests() {
    const f = await fixture();
    const { protocol, borrower, col, loan } = f;

    await col.mint(borrower.address, COLLATERAL);
    await col.connect(borrower).approve(await protocol.getAddress(), COLLATERAL);
    await protocol.connect(borrower).depositCollateral(await col.getAddress(), COLLATERAL);

    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const returnDate = now + 30 * 24 * 60 * 60;
    for (const _ of [1, 2]) {
      await protocol
        .connect(borrower)
        .createLendingRequest(LOAN_AMOUNT, INTEREST_BPS, returnDate, await loan.getAddress());
    }

    return { ...f, returnDate };
  }

  /** ...and request 1 serviced, so repayLoan's guard is reachable. */
  async function withServicedLoan() {
    const f = await withOpenRequests();
    const { protocol, lender, loan } = f;

    await loan.mint(lender.address, LOAN_AMOUNT);
    await loan.connect(lender).approve(await protocol.getAddress(), LOAN_AMOUNT);
    await protocol.connect(lender).serviceRequest(1, await loan.getAddress());

    return f;
  }

  describe("depositCollateral", function () {
    it("rejects value attached to an ERC20 deposit, and reports how much", async function () {
      const { protocol, borrower, col } = await fixture();
      await col.mint(borrower.address, ONE);
      await col.connect(borrower).approve(await protocol.getAddress(), ONE);

      await expect(
        protocol.connect(borrower).depositCollateral(await col.getAddress(), ONE, { value: 1 })
      )
        .to.be.revertedWithCustomError(protocol, "Protocol__UnexpectedNativeValue")
        .withArgs(1);
    });

    it("still accepts the same deposit with no value", async function () {
      const { protocol, borrower, col } = await fixture();
      await col.mint(borrower.address, ONE);
      await col.connect(borrower).approve(await protocol.getAddress(), ONE);

      await protocol.connect(borrower).depositCollateral(await col.getAddress(), ONE);

      /* Asserted through the USD valuation rather than a raw ledger read, since
         that is the getter the facet exposes. At $1 and 18 decimals one token is
         1e18 of value, so this also confirms the deposit was priced rather than
         merely recorded. */
      expect(await protocol.getAccountCollateralValue(borrower.address)).to.equal(ONE);
    });

    it("still accepts a native deposit, where the value IS the amount", async function () {
      const { protocol, borrower } = await fixture();

      await protocol.connect(borrower).depositCollateral(NATIVE, ONE, { value: ONE });

      expect(await protocol.getAccountCollateralValue(borrower.address)).to.equal(ONE);
    });

    it("fires before the token allowlist, so value cannot ride in on a rejected token", async function () {
      const { protocol, borrower, stranger } = await fixture();

      /* Same call twice. Without value the allowlist rejects it; with value the
         stray-value guard gets there first. If the ordering were reversed both
         would report TokenNotAllowed and the ETH would still be sitting in the
         diamond on the paths where the token IS allowed. */
      await expect(
        protocol.connect(borrower).depositCollateral(await stranger.getAddress(), ONE)
      ).to.be.revertedWithCustomError(protocol, "Protocol__TokenNotAllowed");

      await expect(
        protocol.connect(borrower).depositCollateral(await stranger.getAddress(), ONE, { value: 7 })
      )
        .to.be.revertedWithCustomError(protocol, "Protocol__UnexpectedNativeValue")
        .withArgs(7);
    });
  });

  describe("createLoanListing", function () {
    it("rejects value attached to an ERC20 listing", async function () {
      const { protocol, lender, loan } = await fixture();
      await loan.mint(lender.address, LOAN_AMOUNT);
      await loan.connect(lender).approve(await protocol.getAddress(), LOAN_AMOUNT);
      const now = (await ethers.provider.getBlock("latest")).timestamp;

      await expect(
        protocol
          .connect(lender)
          .createLoanListing(
            LOAN_AMOUNT,
            ONE,
            LOAN_AMOUNT,
            now + 30 * 24 * 60 * 60,
            INTEREST_BPS,
            await loan.getAddress(),
            { value: 5 }
          )
      )
        .to.be.revertedWithCustomError(protocol, "Protocol__UnexpectedNativeValue")
        .withArgs(5);
    });

    it("still accepts the same listing with no value", async function () {
      const { protocol, lender, loan } = await fixture();
      await loan.mint(lender.address, LOAN_AMOUNT);
      await loan.connect(lender).approve(await protocol.getAddress(), LOAN_AMOUNT);
      const now = (await ethers.provider.getBlock("latest")).timestamp;

      await expect(
        protocol
          .connect(lender)
          .createLoanListing(
            LOAN_AMOUNT,
            ONE,
            LOAN_AMOUNT,
            now + 30 * 24 * 60 * 60,
            INTEREST_BPS,
            await loan.getAddress()
          )
      ).to.emit(protocol, "LoanListingCreated");
    });
  });

  describe("serviceRequest", function () {
    it("rejects value attached to servicing an ERC20 request", async function () {
      const { protocol, lender, loan } = await withOpenRequests();
      await loan.mint(lender.address, LOAN_AMOUNT);
      await loan.connect(lender).approve(await protocol.getAddress(), LOAN_AMOUNT);

      await expect(
        protocol.connect(lender).serviceRequest(2, await loan.getAddress(), { value: 3 })
      )
        .to.be.revertedWithCustomError(protocol, "Protocol__UnexpectedNativeValue")
        .withArgs(3);
    });

    it("still services the same request with no value", async function () {
      const { protocol, borrower, lender, loan } = await withOpenRequests();
      await loan.mint(lender.address, LOAN_AMOUNT);
      await loan.connect(lender).approve(await protocol.getAddress(), LOAN_AMOUNT);

      await protocol.connect(lender).serviceRequest(2, await loan.getAddress());

      /* The lender's tokens reached the borrower, which is the whole point of
         the call — a guard that let the call through but broke the transfer
         would still pass a revert-shaped assertion. */
      expect(await loan.balanceOf(borrower.address)).to.equal(LOAN_AMOUNT);
    });
  });

  describe("repayLoan", function () {
    it("rejects value attached to an ERC20 repayment", async function () {
      const { protocol, borrower, loan } = await withServicedLoan();
      await loan.connect(borrower).approve(await protocol.getAddress(), LOAN_AMOUNT);

      await expect(
        protocol.connect(borrower).repayLoan(1, ONE, { value: 9 })
      )
        .to.be.revertedWithCustomError(protocol, "Protocol__UnexpectedNativeValue")
        .withArgs(9);
    });

    it("still accepts the same repayment with no value", async function () {
      const { protocol, borrower, loan } = await withServicedLoan();
      await loan.connect(borrower).approve(await protocol.getAddress(), LOAN_AMOUNT);

      const before = await loan.balanceOf(borrower.address);
      await protocol.connect(borrower).repayLoan(1, ONE);

      expect(before - (await loan.balanceOf(borrower.address))).to.equal(ONE);
    });
  });

  /**
   * The guard leaves the diamond unable to accumulate unowned ETH through any
   * of the four. Asserted on the balance rather than on the revert, because the
   * balance is the thing that was actually wrong: every one of these calls used
   * to succeed and leave the value behind.
   */
  it("leaves no unaccounted native balance in the diamond", async function () {
    const { protocol, borrower, lender, loan, col } = await withServicedLoan();
    const diamondAddress = await protocol.getAddress();

    await col.mint(borrower.address, ONE);
    await col.connect(borrower).approve(diamondAddress, ONE);
    await loan.connect(borrower).approve(diamondAddress, LOAN_AMOUNT);
    await loan.mint(lender.address, LOAN_AMOUNT);
    await loan.connect(lender).approve(diamondAddress, LOAN_AMOUNT);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const returnDate = now + 30 * 24 * 60 * 60;
    const colAddress = await col.getAddress();
    const loanAddress = await loan.getAddress();

    for (const attempt of [
      () => protocol.connect(borrower).depositCollateral(colAddress, ONE, { value: 1 }),
      () => protocol.connect(lender).serviceRequest(2, loanAddress, { value: 1 }),
      () => protocol.connect(borrower).repayLoan(1, ONE, { value: 1 }),
      () =>
        protocol
          .connect(lender)
          .createLoanListing(LOAN_AMOUNT, ONE, LOAN_AMOUNT, returnDate, INTEREST_BPS, loanAddress, {
            value: 1,
          }),
    ]) {
      await expect(attempt()).to.be.revertedWithCustomError(
        protocol,
        "Protocol__UnexpectedNativeValue"
      );
    }

    expect(await ethers.provider.getBalance(diamondAddress)).to.equal(0);
  });
});
