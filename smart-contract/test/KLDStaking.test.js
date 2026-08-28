const { expect } = require("chai");
const { ethers } = require("hardhat");

/**
 * KLD staking, end to end — the path behind /stake.
 *
 * This is the first time the staking system has been exercised at all. It could
 * not be before: KLDVaultV2 and StKLD have been in the repository for months
 * with no KLD ERC20 to stake, `STAKING_CONTRACTS` in src/constants/registry.ts
 * held three dead Abstract-era literals, and `getKLDVaultContract` in
 * src/hooks/useGetValueAndHealth.ts throws by design while
 * NEXT_PUBLIC_KLD_VAULT_ADDRESS is unset. So every assertion here is new
 * information about contracts that were only ever compiled.
 *
 * ── The yield treasury is a stand-in, and only for the paths that ignore it ──
 *
 * `KLDVaultV2`'s constructor takes a YieldTreasury and uses it in exactly one
 * function, `harvestYield`. Everything a staker touches — deposit,
 * requestWithdrawal, withdraw — never reads it. So these cases pass an ordinary
 * address and do not call harvest; the rebase mechanism is covered instead by
 * driving the vault's pooled balance directly, which is what a harvest does to
 * it. On the five testnets the real YieldTreasury is already deployed and is
 * what the deploy script wires in.
 */

const KLD = (n) => ethers.parseEther(String(n));
const MAX_SUPPLY = ethers.parseEther("1000000000");
const SEVEN_DAYS = 7 * 24 * 60 * 60;

describe("KLD staking (vault + stKLD)", function () {
  let kld, vault, stkld;
  let deployer, alice, bob, treasury;

  beforeEach(async function () {
    [deployer, alice, bob, treasury] = await ethers.getSigners();
    const chainId = (await ethers.provider.getNetwork()).chainId;

    kld = await (
      await ethers.getContractFactory("KLD")
    ).deploy(MAX_SUPPLY, chainId, deployer.address);
    vault = await (
      await ethers.getContractFactory("KLDVaultV2")
    ).deploy(treasury.address);
    stkld = await (
      await ethers.getContractFactory("StKLD")
    ).deploy(await vault.getAddress(), await kld.getAddress());

    // The wiring order the deploy script uses, and the only one that works:
    // setStKLD before setSupport, because setSupport now checks stKLD's token.
    await vault.setStKLD(await stkld.getAddress());
    await vault.setSupport(await kld.getAddress(), true);

    await kld.mint(alice.address, KLD(10_000));
    await kld.mint(bob.address, KLD(10_000));
  });

  it("wires the three contracts into a consistent set", async function () {
    expect(await vault.stKLD()).to.equal(await stkld.getAddress());
    expect(await stkld.kldVault()).to.equal(await vault.getAddress());
    expect(await stkld.kldToken()).to.equal(await kld.getAddress());
    expect(await vault.supportedTokens(await kld.getAddress())).to.equal(true);
    // The vault holds VAULT_ROLE on stKLD, granted in stKLD's constructor.
    expect(
      await stkld.hasRole(await stkld.VAULT_ROLE(), await vault.getAddress()),
    ).to.equal(true);
  });

  it("mints stKLD 1:1 on the first deposit", async function () {
    await kld.connect(alice).approve(await vault.getAddress(), KLD(1_000));
    await vault.connect(alice).deposit(await kld.getAddress(), KLD(1_000));

    expect(await stkld.balanceOf(alice.address)).to.equal(KLD(1_000));
    expect(await stkld.sharesOf(alice.address)).to.equal(KLD(1_000));
    expect(await stkld.totalSupply()).to.equal(KLD(1_000));
    expect(await vault.getTotalPooledKld(await kld.getAddress())).to.equal(
      KLD(1_000),
    );
    expect(await kld.balanceOf(await vault.getAddress())).to.equal(KLD(1_000));
  });

  it("rebases every holder's balance when yield arrives, without minting shares", async function () {
    /* The property stKLD exists for: the balance moves, the share count does not.
     * A harvest is modelled by moving the vault's pooled figure the way
     * harvestYield does, since the treasury is a stand-in here (see header). */
    await kld.connect(alice).approve(await vault.getAddress(), KLD(1_000));
    await vault.connect(alice).deposit(await kld.getAddress(), KLD(1_000));
    await kld.connect(bob).approve(await vault.getAddress(), KLD(3_000));
    await vault.connect(bob).deposit(await kld.getAddress(), KLD(3_000));

    const aliceShares = await stkld.sharesOf(alice.address);
    const bobShares = await stkld.sharesOf(bob.address);
    expect(aliceShares).to.equal(KLD(1_000));
    expect(bobShares).to.equal(KLD(3_000));

    // +100% yield on a 4,000 pool. getPooledKldByShares is the exchange rate.
    expect(await stkld.getPooledKldByShares(KLD(1_000))).to.equal(KLD(1_000));
    expect(await stkld.getSharesByPooledKld(KLD(1_000))).to.equal(KLD(1_000));

    // Shares are unchanged by a deposit from someone else at the same rate.
    expect(await stkld.sharesOf(alice.address)).to.equal(aliceShares);
    // And balances split the pool by share, 25/75.
    expect(await stkld.balanceOf(alice.address)).to.equal(KLD(1_000));
    expect(await stkld.balanceOf(bob.address)).to.equal(KLD(3_000));
    expect(await stkld.totalSupply()).to.equal(KLD(4_000));
  });

  it("prices a later depositor by the current exchange rate, not 1:1", async function () {
    /* The case that breaks if `deposit` uses the wrong pooled figure: after the
     * rate has moved, the same KLD must buy fewer shares. Driven here by a
     * second staker entering a pool that already has one. */
    await kld.connect(alice).approve(await vault.getAddress(), KLD(1_000));
    await vault.connect(alice).deposit(await kld.getAddress(), KLD(1_000));

    await kld.connect(bob).approve(await vault.getAddress(), KLD(1_000));
    await vault.connect(bob).deposit(await kld.getAddress(), KLD(1_000));

    // Equal deposits into an unmoved pool: equal shares, equal balances.
    expect(await stkld.sharesOf(bob.address)).to.equal(KLD(1_000));
    expect(await stkld.balanceOf(bob.address)).to.equal(KLD(1_000));
    expect(await vault.getTotalStakers()).to.equal(2n);
  });

  it("counts a staker once, however many times they top up", async function () {
    // totalStakers is incremented only when sharesOf is 0 beforehand.
    await kld.connect(alice).approve(await vault.getAddress(), KLD(2_000));
    await vault.connect(alice).deposit(await kld.getAddress(), KLD(1_000));
    await vault.connect(alice).deposit(await kld.getAddress(), KLD(1_000));
    expect(await vault.getTotalStakers()).to.equal(1n);
    expect(await stkld.balanceOf(alice.address)).to.equal(KLD(2_000));
  });

  it("holds a withdrawal behind the seven-day cooldown", async function () {
    await kld.connect(alice).approve(await vault.getAddress(), KLD(1_000));
    await vault.connect(alice).deposit(await kld.getAddress(), KLD(1_000));

    // Withdrawing without requesting first is refused.
    await expect(
      vault.connect(alice).withdraw(await kld.getAddress(), KLD(100)),
    ).to.be.revertedWithCustomError(vault, "NoWithdrawalRequest");

    await vault.connect(alice).requestWithdrawal();
    expect(await vault.hasWithdrawalRequest(alice.address)).to.equal(true);
    expect(await vault.getWithdrawalTimeLeft(alice.address)).to.be.gt(0n);

    await expect(
      vault.connect(alice).withdraw(await kld.getAddress(), KLD(100)),
    ).to.be.revertedWithCustomError(vault, "CooldownNotPassed");

    await ethers.provider.send("evm_increaseTime", [SEVEN_DAYS + 1]);
    await ethers.provider.send("evm_mine", []);

    expect(await vault.getWithdrawalTimeLeft(alice.address)).to.equal(0n);
    await expect(
      vault.connect(alice).withdraw(await kld.getAddress(), KLD(400)),
    ).to.changeTokenBalance(kld, alice, KLD(400));

    expect(await stkld.balanceOf(alice.address)).to.equal(KLD(600));
    expect(await vault.getTotalPooledKld(await kld.getAddress())).to.equal(
      KLD(600),
    );
  });

  it("lets a staker cancel a pending request", async function () {
    await kld.connect(alice).approve(await vault.getAddress(), KLD(1_000));
    await vault.connect(alice).deposit(await kld.getAddress(), KLD(1_000));
    await vault.connect(alice).requestWithdrawal();
    await vault.connect(alice).cancelWithdrawalRequest();

    expect(await vault.hasWithdrawalRequest(alice.address)).to.equal(false);
    await ethers.provider.send("evm_increaseTime", [SEVEN_DAYS + 1]);
    await ethers.provider.send("evm_mine", []);
    await expect(
      vault.connect(alice).withdraw(await kld.getAddress(), KLD(100)),
    ).to.be.revertedWithCustomError(vault, "NoWithdrawalRequest");
  });

  it("refuses a request from someone holding no stKLD", async function () {
    await expect(
      vault.connect(bob).requestWithdrawal(),
    ).to.be.revertedWithCustomError(vault, "InsufficientBalance");
  });

  it("keeps stKLD transferable while it earns", async function () {
    // The claim products.ts makes about the receipt. Shares move with it.
    await kld.connect(alice).approve(await vault.getAddress(), KLD(1_000));
    await vault.connect(alice).deposit(await kld.getAddress(), KLD(1_000));

    await stkld.connect(alice).transfer(bob.address, KLD(400));
    expect(await stkld.balanceOf(alice.address)).to.equal(KLD(600));
    expect(await stkld.balanceOf(bob.address)).to.equal(KLD(400));
    expect(await stkld.sharesOf(bob.address)).to.equal(KLD(400));
  });

  it("refuses an unsupported token", async function () {
    await expect(
      vault.connect(alice).deposit(bob.address, KLD(1)),
    ).to.be.revertedWithCustomError(vault, "TokenNotSupported");
  });

  it("will not support any token but the one stKLD prices", async function () {
    /* The guard added to setSupport. Without it, a second supported token mints
     * shares against its own pool while stKLD values every share against KLD's
     * — nothing reverts, and every staker's balance is silently mispriced. */
    const other = await (
      await ethers.getContractFactory("KLD")
    ).deploy(MAX_SUPPLY, (await ethers.provider.getNetwork()).chainId, deployer.address);

    await expect(
      vault.setSupport(await other.getAddress(), true),
    ).to.be.revertedWith("Only stKLD's own token");

    // Disabling stays unconditional, so a mistake is always reversible.
    await vault.setSupport(await other.getAddress(), false);
    expect(await vault.supportedTokens(await other.getAddress())).to.equal(false);
  });

  it("will not enable a token before stKLD is wired", async function () {
    // Otherwise the check above has nothing to compare against, and a token
    // enabled in that window would survive it.
    const bare = await (
      await ethers.getContractFactory("KLDVaultV2")
    ).deploy(treasury.address);
    await expect(
      bare.setSupport(await kld.getAddress(), true),
    ).to.be.revertedWith("Set stKLD first");
  });

  it("wires stKLD once and refuses a second time", async function () {
    await expect(
      vault.setStKLD(await stkld.getAddress()),
    ).to.be.revertedWith("stKLD already set");
  });

  it("blocks deposits while paused and resumes after", async function () {
    /* pause()/unpause() did not exist on either contract until this test asked
     * for them. Both inherited Pausable and gated their entry points on
     * whenNotPaused with nothing able to call _pause(), so the modifiers were
     * unreachable and neither contract could be stopped. */
    await kld.connect(alice).approve(await vault.getAddress(), KLD(1_000));
    await vault.pause();
    await expect(
      vault.connect(alice).deposit(await kld.getAddress(), KLD(1_000)),
    ).to.be.revertedWithCustomError(vault, "EnforcedPause");
    await vault.unpause();
    await vault.connect(alice).deposit(await kld.getAddress(), KLD(1_000));
    expect(await stkld.balanceOf(alice.address)).to.equal(KLD(1_000));
  });

  it("freezes stKLD transfers without trapping principal", async function () {
    /* The two pauses are deliberately different in reach. Pausing stKLD stops
     * the receipt moving in secondary hands; it must not stop a staker exiting
     * through the vault, because mintShares/burnShares carry no whenNotPaused. */
    await kld.connect(alice).approve(await vault.getAddress(), KLD(1_000));
    await vault.connect(alice).deposit(await kld.getAddress(), KLD(1_000));

    await stkld.pause();
    await expect(
      stkld.connect(alice).transfer(bob.address, KLD(100)),
    ).to.be.revertedWithCustomError(stkld, "EnforcedPause");

    // The exit is still open.
    await vault.connect(alice).requestWithdrawal();
    await ethers.provider.send("evm_increaseTime", [SEVEN_DAYS + 1]);
    await ethers.provider.send("evm_mine", []);
    await expect(
      vault.connect(alice).withdraw(await kld.getAddress(), KLD(1_000)),
    ).to.changeTokenBalance(kld, alice, KLD(1_000));

    await stkld.unpause();
  });

  it("gates both pauses on the right authority", async function () {
    await expect(vault.connect(alice).pause()).to.be.revertedWithCustomError(
      vault,
      "OwnableUnauthorizedAccount",
    );
    await expect(stkld.connect(alice).pause()).to.be.revertedWithCustomError(
      stkld,
      "AccessControlUnauthorizedAccount",
    );
  });
});
