const { expect } = require("chai");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const code = fs.readFileSync(
  path.join(__dirname, "../scripts/deploy-v3.js"),
  "utf8",
);
async function run({
  label = "BNB",
  wrapper = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  declared = "0x" + "22".repeat(32),
} = {}) {
  let factoryCalls = 0,
    message = "";
  const outcome = await new Promise((resolve) => {
    const hre = {
      network: { name: "bsc", config: { zksync: false } },
      artifacts: { readArtifact: async () => ({ bytecode: "0x1234" }) },
      ethers: {
        getSigners: async () => [
          { address: "0x0000000000000000000000000000000000000002" },
        ],
        provider: {
          getNetwork: async () => ({ chainId: 56n }),
          getBalance: async () => 1n,
          getCode: async () => "0x01",
        },
        isAddress: () => true,
        formatEther: () => "0",
        keccak256: () => "0x" + "11".repeat(32),
        getContractFactory: async () => {
          factoryCalls++;
          throw Error("unexpected factory access");
        },
      },
    };
    vm.runInNewContext(code, {
      __dirname: path.join(__dirname, "../scripts"),
      require: (name) => {
        if (name === "hardhat") return hre;
        if (name === "fs")
          return {
            readFileSync: () =>
              declared
                ? `POOL_INIT_CODE_HASH = ${declared}`
                : "missing constant",
          };
        if (name === "path") return path;
        if (name === "./libraries/mainnet-guard.js")
          return { confirmMainnet: () => {} };
        throw Error("unexpected import " + name);
      },
      process: {
        env: { NATIVE_LABEL: label, WRAPPED_NATIVE: wrapper },
        exit: (status) => resolve(status),
      },
      console: {
        log: () => {},
        error: (...args) => {
          message = args.map((a) => a.message || String(a)).join(" ");
        },
      },
    });
  });
  return { outcome, factoryCalls, message };
}
describe("BSC V3 deployment preflight executes before broadcasts", () => {
  it("refuses another chain's native label", async () => {
    const r = await run({ label: "ETH" });
    expect(r.outcome).to.equal(1);
    expect(r.factoryCalls).to.equal(0);
    expect(r.message).to.include("BSC requires");
  });
  it("refuses a noncanonical wrapped token", async () => {
    const r = await run({
      wrapper: "0x0000000000000000000000000000000000000002",
    });
    expect(r.factoryCalls).to.equal(0);
    expect(r.message).to.include("canonical WBNB");
  });
  it("refuses a mismatched pool creation hash before even creating a factory object", async () => {
    const r = await run();
    expect(r.factoryCalls).to.equal(0);
    expect(r.message).to.include("POOL_INIT_CODE_HASH mismatch");
  });
  it("refuses an absent creation hash", async () => {
    const r = await run({ declared: null });
    expect(r.factoryCalls).to.equal(0);
    expect(r.message).to.include("POOL_INIT_CODE_HASH mismatch");
  });
});
