const { expect } = require("chai");
const {
  backendFor,
  feedPlanFor,
  aggregatorFor,
} = require("../scripts/libraries/aggregator-feeds");
const { feedFor } = require("../scripts/libraries/pyth-feeds");
const cfg = require("../config/bsc-mainnet.candidate.json");
describe("BSC mainnet configuration preparation", () => {
  it("preserves the user's collateral-only BNB/WBNB policy and gates all five loan candidates", () => {
    expect(cfg.collateralAssets).to.deep.equal(["NATIVE", "WBNB"]);
    expect(Object.keys(cfg.loanCandidates)).to.have.members([
      "USDC",
      "USDT",
      "USD1",
      "FDUSD",
      "BTCB",
    ]);
    expect(cfg.loanAssets).not.to.include("NATIVE");
    expect(cfg.loanAssets).not.to.include("WBNB");
    for (const symbol of cfg.loanAssets)
      expect(cfg.loanCandidates[symbol]).to.equal("approved");
  });
  it("selects aggregator feeds without a Pyth backend override", () =>
    expect(backendFor(56)).to.equal("aggregator-v3"));
  it("collapses native BNB and WBNB into one feed registration", () => {
    expect(feedFor("WBNB").id).to.equal(feedFor("BNB").id);
    expect(feedPlanFor(56)).to.have.length(3);
  });
  it("matches each candidate feed proxy, decimals and bound", () => {
    for (const [symbol, row] of Object.entries(cfg.feeds)) {
      const feed = aggregatorFor(56, symbol);
      expect(feed.aggregator.toLowerCase()).to.equal(
        row.aggregator.toLowerCase(),
      );
      expect(feed.maxAge).to.equal(row.maxAgeSeconds);
      expect(feed.decimals).to.equal(row.decimals);
      expect(feedFor(symbol).id).to.equal(row.id);
    }
  });
  it("allows heartbeat tolerance without giving native BNB a stablecoin bound", () => {
    expect(aggregatorFor(56, "BNB").maxAge).to.be.lessThan(
      aggregatorFor(56, "USDC").maxAge,
    );
    expect(aggregatorFor(56, "USDC").maxAge).to.be.greaterThan(900);
    expect(aggregatorFor(56, "USDT").maxAge).to.be.greaterThan(900);
  });
  it("does not silently admit an unreviewed asset feed", () =>
    expect(() => aggregatorFor(56, "USD1")).to.throw());
});
