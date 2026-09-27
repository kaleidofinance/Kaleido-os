const { expect } = require("chai");
const { assetRuleViolations } = require("../scripts/libraries/chain-asset-rules.js");
const { confirmMainnet, isMainnet } = require("../scripts/libraries/mainnet-guard.js");
const { backendFor, aggregatorFor, feedPlanFor } = require("../scripts/libraries/aggregator-feeds.js");
const { FEEDS } = require("../scripts/libraries/pyth-feeds.js");

/**
 * The script-side guards for the Arc mainnet lending deploy. Pure functions —
 * no chain — so each refusal is pinned exactly.
 */
describe("Mainnet guards (Arc lending, Phase A)", function () {
  const ARC = 5042;
  const NATIVE = { symbol: "USDC", address: "0x0000000000000000000000000000000000000001", isNative: true };
  const EURC = { symbol: "EURC", address: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1", isNative: false };
  const CIRBTC = { symbol: "CIRBTC", address: "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0", isNative: false };
  const ALIAS = { symbol: "USDC", address: "0x3600000000000000000000000000000000000000", isNative: false };
  const WRAPPER = { symbol: "WETH", address: "0x8c6c0A4C5500c2bC196383B4D85feb7f08a5C75b", isNative: false };

  describe("asset rules", function () {
    it("the Arc launch set passes: native USDC loanable, EURC + cirBTC collateral", function () {
      expect(assetRuleViolations(ARC, [EURC, CIRBTC, NATIVE], "USDC")).to.deep.equal([]);
    });

    it("refuses native priced as ETH on Arc (the script's default)", function () {
      const p = assetRuleViolations(ARC, [NATIVE], "ETH");
      expect(p).to.have.length(1);
      expect(p[0]).to.match(/NATIVE_FEED_SYMBOL=USDC/);
    });

    it("refuses native priced as BNB (the stale Sepolia .env value) on an ETH chain", function () {
      expect(assetRuleViolations(11155111, [NATIVE], "BNB")[0]).to.match(/NATIVE_FEED_SYMBOL=ETH/);
    });

    it("refuses native and the 0x3600 alias together", function () {
      const p = assetRuleViolations(ARC, [NATIVE, ALIAS], "USDC");
      expect(p.some((m) => /same balance as NATIVE/.test(m))).to.equal(true);
    });

    it("refuses the 0x3600 alias alone on Arc mainnet (register NATIVE instead)", function () {
      expect(assetRuleViolations(ARC, [ALIAS], "USDC")[0]).to.match(/register NATIVE instead/);
    });

    it("refuses the mislabelled 0x8c6c wrapper on Arc mainnet, whatever case it is typed in", function () {
      const lower = { ...WRAPPER, address: WRAPPER.address.toLowerCase() };
      expect(assetRuleViolations(ARC, [lower], "USDC")[0]).to.match(/wraps USDC/);
    });

    it("refuses native on a chain with no recorded native symbol, rather than guessing", function () {
      expect(assetRuleViolations(999999, [NATIVE], "ETH")[0]).to.match(/No native-currency symbol/);
    });

    it("leaves ERC20-only lists on unlisted chains alone", function () {
      expect(assetRuleViolations(999999, [EURC], "ETH")).to.deep.equal([]);
    });
  });

  describe("mainnet confirmation", function () {
    const quiet = () => {};
    const plan = [["fee", "500 bps"]];

    it("knows which chains are mainnets", function () {
      expect(isMainnet(5042)).to.equal(true);
      expect(isMainnet(2741)).to.equal(true); // Abstract mainnet
      expect(isMainnet(5042002)).to.equal(false);
    });

    it("testnets pass through without CONFIRM_MAINNET", function () {
      expect(confirmMainnet({ chainId: 5042002, script: "t", plan, env: {}, log: quiet }).mainnet).to.equal(false);
    });

    it("mainnet refuses without CONFIRM_MAINNET, and with another chain's id", function () {
      expect(() => confirmMainnet({ chainId: ARC, script: "t", plan, env: {}, log: quiet })).to.throw(/CONFIRM_MAINNET=5042/);
      expect(() => confirmMainnet({ chainId: ARC, script: "t", plan, env: { CONFIRM_MAINNET: "5042002" }, log: quiet })).to.throw(/Nothing was sent/);
    });

    it("mainnet refuses a defaulted money setting even when confirmed", function () {
      expect(() =>
        confirmMainnet({ chainId: ARC, script: "t", plan, explicit: ["PROTOCOL_FEE_BPS"], env: { CONFIRM_MAINNET: "5042" }, log: quiet }),
      ).to.throw(/PROTOCOL_FEE_BPS/);
    });

    it("mainnet proceeds only with every explicit setting and the matching id", function () {
      const r = confirmMainnet({
        chainId: ARC, script: "t", plan, explicit: ["PROTOCOL_FEE_BPS"],
        env: { CONFIRM_MAINNET: "5042", PROTOCOL_FEE_BPS: "500" }, log: quiet,
      });
      expect(r.mainnet).to.equal(true);
    });

    it("mainnet refuses feed overrides from the environment, even when confirmed", function () {
      for (const k of ["FEED_EURC", "AGGREGATOR_USDC", "FEED_MAX_AGE_CIRBTC", "ORACLE_BACKEND"]) {
        expect(() =>
          confirmMainnet({ chainId: ARC, script: "t", plan, env: { CONFIRM_MAINNET: "5042", [k]: "x" }, log: quiet }),
        ).to.throw(new RegExp(k));
      }
      // An empty value is not an override.
      expect(
        confirmMainnet({ chainId: ARC, script: "t", plan, env: { CONFIRM_MAINNET: "5042", FEED_EURC: "" }, log: quiet }).mainnet,
      ).to.equal(true);
    });

    it("testnets may still use overrides", function () {
      expect(
        confirmMainnet({ chainId: 5042002, script: "t", plan, env: { AGGREGATOR_USDC: "0x1" }, log: quiet }).mainnet,
      ).to.equal(false);
    });

    it("prints every plan row before deciding", function () {
      const lines = [];
      try {
        confirmMainnet({ chainId: ARC, script: "t", plan: [["fee", "500 bps"], ["vault", null]], env: {}, log: (l) => lines.push(l) });
      } catch { /* refused, as expected */ }
      expect(lines.join("\n")).to.match(/fee\s+500 bps/).and.match(/vault\s+\(unset\)/);
    });
  });

  describe("Arc mainnet oracle tables", function () {
    it("Arc mainnet is on the Chainlink aggregator backend", function () {
      expect(backendFor(ARC)).to.equal("aggregator-v3");
    });

    it("maps the three launch assets to the on-chain-verified Chainlink proxies", function () {
      expect(aggregatorFor(ARC, "USDC").aggregator).to.equal("0x84EA90AC252Dc437031461836DB5164219147905");
      expect(aggregatorFor(ARC, "EURC").aggregator).to.equal("0x361b95c10b76Ca3f35C686d423e43A951755Bf23");
      expect(aggregatorFor(ARC, "CIRBTC").aggregator).to.equal("0xa109B535C70C8Be9995be64Bb6751AcDB27e03De");
      for (const s of ["USDC", "EURC", "CIRBTC"]) {
        const f = aggregatorFor(ARC, s);
        expect(f.decimals).to.equal(8);
        expect(f.maxAge).to.equal(97200); // heartbeat + 3h, under the 108000 cap
      }
    });

    it("the oracle plan is exactly three feeds with distinct ids", function () {
      const plan = feedPlanFor(ARC);
      expect(plan.map((f) => f.symbols.join("/")).sort()).to.deep.equal(["CIRBTC", "EURC", "USDC"]);
      expect(new Set(plan.map((f) => f.id)).size).to.equal(3);
    });

    it("EURC uses Pyth's Crypto.EURC/USD id, cirBTC shares BTC's", function () {
      expect(FEEDS.EURC.id).to.equal("0x76fa85158bf14ede77087fe3ae472f66213f6ea2f5b411cb2de472794990fa5c");
      expect(FEEDS.CIRBTC.id).to.equal(FEEDS.BTC.id);
    });
  });
});
