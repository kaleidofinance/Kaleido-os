const { expect } = require("chai");
const fs = require("fs");
const path = require("path");

describe("SwapRouter exact-output multihop guard", function () {
  it("checks the terminal callback amount, not the outer intermediate hop", function () {
    const source = fs.readFileSync(
      path.join(__dirname, "../contracts/dex-v3/periphery/SwapRouter.sol"),
      "utf8",
    );

    expect(source).to.include("uint256 private amountInCached = DEFAULT_AMOUNT_IN_CACHED;");
    expect(source).to.include("amountInCached = amountToPay;");
    expect(source).to.include("amountIn = amountInCached;");
    expect(source).to.include("amountInCached = DEFAULT_AMOUNT_IN_CACHED;");

    // The multihop entrypoint must not assign its cap check from the outer
    // exactOutputInternal return value; that value is the intermediate token.
    const multihop = source.slice(source.indexOf("function exactOutput(ExactOutputParams"));
    expect(multihop).to.not.include("amountIn = exactOutputInternal(");
  });
});
