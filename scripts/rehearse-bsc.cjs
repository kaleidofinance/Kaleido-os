// Only a local Anvil fork can execute this script; no keys or live send endpoints.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const {
  JsonRpcProvider,
  Contract,
  ContractFactory,
  Interface,
  AbiCoder,
  solidityPacked,
  keccak256,
  parseEther,
  formatEther,
  encodeBytes32String,
  toUtf8Bytes,
} = require("ethers");
const root = path.resolve(process.argv[2] || "../merge-rewards/smart-contract");
const output = path.resolve(
  __dirname,
  process.env.BSC_LOAN_ONLY === "1"
    ? "../docs/product/BSC_LOAN_LIFECYCLE.json"
    : "../docs/product/BSC_REHEARSAL.json",
);
const artifacts = [];
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p);
    else if (ent.name.endsWith(".json") && !ent.name.endsWith(".dbg.json"))
      artifacts.push(p);
  }
}
walk(path.join(root, "artifacts/contracts"));
function art(name) {
  const matches = artifacts.filter((p) => path.basename(p) === name + ".json");
  assert.equal(matches.length, 1, `ambiguous artifact ${name}`);
  return { ...JSON.parse(fs.readFileSync(matches[0])), file: matches[0] };
}
const report = {
  checkedAt: new Date().toISOString(),
  artifactRoot: root,
  parity: [],
  transactions: [],
  checks: [],
};
const local = new JsonRpcProvider("http://127.0.0.1:8556", 56, {
  staticNetwork: true,
});
local.pollingInterval = 100;
const arc = new JsonRpcProvider("https://rpc.mainnet.arc.io", 5042, {
  staticNetwork: true,
});
function stripMetadata(hex) {
  const len = parseInt(hex.slice(-4), 16);
  return len > 0 && len < 512 && len * 2 + 4 < hex.length - 2
    ? hex.slice(0, -(len * 2 + 4))
    : hex;
}
function normalized(hex, refs) {
  let value = hex.slice(2);
  for (const r of refs)
    value =
      value.slice(0, r.start * 2) +
      "0".repeat(r.length * 2) +
      value.slice((r.start + r.length) * 2);
  return stripMetadata("0x" + value).toLowerCase();
}
async function parity(name, address) {
  const a = art(name),
    dbg = JSON.parse(fs.readFileSync(a.file.replace(/\.json$/, ".dbg.json"))),
    build = JSON.parse(
      fs.readFileSync(path.resolve(path.dirname(a.file), dbg.buildInfo)),
    );
  const c = build.output.contracts[a.sourceName][a.contractName];
  const refs = Object.values(
    c.evm.deployedBytecode.immutableReferences || {},
  ).flat();
  for (const src of Object.values(c.evm.deployedBytecode.linkReferences || {}))
    refs.push(...Object.values(src).flat());
  const live = await arc.getCode(address);
  const matches =
    normalized(live, refs) === normalized(a.deployedBytecode, refs);
  report.parity.push({
    name,
    address,
    matches,
    runtimeBytes: (live.length - 2) / 2,
    compiler: build.solcLongVersion,
    maskedRanges: refs.length,
  });
  assert(matches, `${name} source/build runtime mismatch against Arc`);
}
let owner;
async function tx(label, promise, kind = "configuration") {
  const result = await promise;
  const receipt = await result.wait();
  assert.equal(receipt.status, 1);
  report.transactions.push({
    label,
    kind,
    gasUsed: receipt.gasUsed.toString(),
  });
  return receipt;
}
async function deploy(name, args = [], libraries = {}) {
  const a = art(name);
  let bytecode = a.bytecode;
  for (const src of Object.values(a.linkReferences || {}))
    for (const [lib, refs] of Object.entries(src)) {
      assert(libraries[lib], `missing ${lib}`);
      for (const ref of refs)
        bytecode =
          bytecode.slice(0, 2 + ref.start * 2) +
          libraries[lib].slice(2).toLowerCase() +
          bytecode.slice(2 + (ref.start + ref.length) * 2);
    }
  const f = new ContractFactory(a.abi, bytecode, owner);
  const c = await f.deploy(...args);
  await tx(name, Promise.resolve(c.deploymentTransaction()), "deployment");
  await c.waitForDeployment();
  return c;
}
function check(name) {
  report.checks.push(name);
  console.log("PASS " + name);
}
const NATIVE = "0x0000000000000000000000000000000000000001";
const WBNB = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
const USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const USDT = "0x55d398326f99059fF775485246999027B3197955";
const USD1 = "0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d";
const FDUSD = "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409";
const BTCB = "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c";
const FEEDS = {
  BNB: [
    "0x2f95862b045670cd22bee3114c39763a4a08beeb663b145d283c31d7d1101c4f",
    "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE",
    120,
  ],
  USDC: [
    "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
    "0x51597f405303C4377E36123cBc172b13269EA163",
    1200,
  ],
  USDT: [
    "0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b",
    "0xB97Ad0E74fa7d920791E90258A6E2085088b4320",
    1200,
  ],
};
async function main() {
  let info = await local.send("anvil_nodeInfo", []);
  assert.equal(Number((await local.getNetwork()).chainId), 56);
  assert(info.forkConfig?.forkUrl, "requires a real Anvil fork");
  await local.send("anvil_reset", [
    { forking: { jsonRpcUrl: info.forkConfig.forkUrl } },
  ]);
  await local.send("anvil_setBlockTimestampInterval", [1]);
  info = await local.send("anvil_nodeInfo", []);
  report.fork = info;
  owner = await local.getSigner(0);
  const alice = await local.getSigner(1),
    bob = await local.getSigner(2);
  const feeVault = await (await local.getSigner(3)).getAddress();
  const targets = {
    Diamond: "0xE4e7f16DB22e6bb2E505fbC504d7B2B4B995A6E3",
    DiamondCutFacet: "0xE8F836c0d48a07c970c66BeD358a7C3c4C7a7235",
    DiamondLoupeFacet: "0x7EEB33f9E9FBd09653F893bA1f113BEcF8F7116b",
    OwnershipFacet: "0x59E73C9490E43df879495dCFb1dA28c8eA03d797",
    ProtocolFacet: "0xfc055263Dd57A665A612fD7D24cf94Ee390De5bf",
    AgentPermissionFacet: "0x22B0AD978a7F8eE943D5AE85621E312Ce1835a38",
    LendingAdminFacet: "0x1D53F2601f32558C6737e7C8D8e4f67391154CA9",
    AggregatorPriceOracle: "0x5027ACF31cEf802d6A89D170691Fa256e079D39B",
    KaleidoOrdersV2: "0x83CA08cd25a663f0a66bda93E5f3c67D382C9856",
    KaleidoSwapV3Factory: "0xbB74f2319494461B2591F8fbF126654Dd4c2a649",
    SwapRouter: "0x98D4f47b6F06d30527b61ea3d68656f7Da9B442E",
    NonfungiblePositionManager: "0x55879358eC7eDA609f2264b0348D1915ee8307e1",
    Quoter: "0x898e9774b58d23d2EFEF3eb940782d9Ee1a03fa3",
  };
  for (const [name, address] of Object.entries(targets))
    await parity(name, address);
  check(
    "compiled runtime parity with live Arc (metadata/immutables normalized)",
  );
  for (const name of Object.keys(targets)) {
    const a = art(name);
    assert(
      (a.deployedBytecode.length - 2) / 2 <= 24576,
      `${name} exceeds EIP170`,
    );
  }
  check("deployment runtime sizes below EIP170");
  const oracle = await deploy("AggregatorPriceOracle");
  await tx(
    "oracle feeds",
    oracle.setFeeds(
      Object.values(FEEDS).map((f) => f[0]),
      Object.values(FEEDS).map((f) => f[1]),
    ),
  );
  const factory = await deploy("KaleidoSwapV3Factory");
  const factoryAddress = await factory.getAddress();
  const router = await deploy("SwapRouter", [factoryAddress, WBNB]);
  const nft = await deploy("NFTDescriptor");
  const descriptor = await deploy(
    "NonfungibleTokenPositionDescriptor",
    [WBNB, encodeBytes32String("BNB")],
    { NFTDescriptor: await nft.getAddress() },
  );
  const manager = await deploy("NonfungiblePositionManager", [
    factoryAddress,
    WBNB,
    await descriptor.getAddress(),
  ]);
  const quoter = await deploy("Quoter", [factoryAddress, WBNB]);
  const orders = await deploy("KaleidoOrdersV2", [
    await router.getAddress(),
    await owner.getAddress(),
  ]);
  await tx(
    "order aggregator allowlist",
    orders.setAggregator("0x6131B5fae19EA4f9D964eAc0408E4408b66337b5", true),
  );
  const cutFacet = await deploy("DiamondCutFacet");
  const diamond = await deploy("Diamond", [
    await owner.getAddress(),
    await cutFacet.getAddress(),
  ]);
  const init = await deploy("DiamondInit");
  const cuts = [];
  for (const name of [
    "DiamondLoupeFacet",
    "OwnershipFacet",
    "ProtocolFacet",
    "AgentPermissionFacet",
    "LendingAdminFacet",
  ]) {
    const facet = await deploy(name);
    const iface = facet.interface;
    cuts.push({
      facetAddress: await facet.getAddress(),
      action: 0,
      functionSelectors: iface.fragments
        .filter((f) => f.type === "function")
        .map((f) => iface.getFunction(f.format()).selector),
    });
  }
  const address = await diamond.getAddress();
  await tx(
    "diamond cut",
    new Contract(address, art("DiamondCutFacet").abi, owner).diamondCut(
      cuts,
      await init.getAddress(),
      init.interface.encodeFunctionData("init"),
    ),
  );
  const protocol = new Contract(address, art("ProtocolFacet").abi, owner);
  for (const [label, args] of Object.entries({
    setPythOracle: [await oracle.getAddress()],
    setFeeVault: [feeVault],
    setBPS: [500],
    setLiquidityBps: [640],
    setPriceBounds: [300, 100],
    setSwapRouter: [await router.getAddress()],
  }))
    await tx(label, protocol[label](...args));
  for (const [label, feed] of Object.entries(FEEDS))
    await tx("freshness " + label, protocol.setFeedMaxAge(feed[0], feed[2]));
  for (const [token, feed] of [
    [WBNB, FEEDS.BNB],
    [NATIVE, FEEDS.BNB],
    [USDC, FEEDS.USDC],
    [USDT, FEEDS.USDT],
  ]) {
    await tx(
      "collateral " + token,
      protocol.addCollateralToken(token, feed[0]),
    );
    await tx("loanable " + token, protocol.addLoanableToken(token, feed[0]));
  }
  check("oracle/DEX/orders/diamond configured on local BSC fork");
  assert.equal(await protocol.getFeedMaxAge(FEEDS.USDC[0]), 1200n);
  assert.equal(await protocol.getFeedMaxAge(FEEDS.BNB[0]), 120n);
  check("BSC per-feed bounds read back");
  const wbnb = new Contract(
    WBNB,
    [
      "function deposit() payable",
      "function withdraw(uint256)",
      "function approve(address,uint256) returns(bool)",
      "function balanceOf(address) view returns(uint256)",
    ],
    alice,
  );
  const collateral = parseEther("1");
  await tx("wrap BNB", wbnb.deposit({ value: collateral }), "scenario");
  await tx("approve collateral", wbnb.approve(address, collateral), "scenario");
  await tx(
    "deposit WBNB",
    protocol.connect(alice).depositCollateral(WBNB, collateral),
    "scenario",
  );
  assert.equal(
    await protocol.gets_addressToCollateralDeposited(
      await alice.getAddress(),
      WBNB,
    ),
    collateral,
  );
  const amount = parseEther("0.02"),
    now = (await local.getBlock("latest")).timestamp;
  await tx(
    "request BNB loan",
    protocol
      .connect(alice)
      .createLendingRequest(amount, 1000, now + 3 * 86400, NATIVE),
    "scenario",
  );
  const reqs = await protocol.getAllRequests(0, 10000);
  const id = reqs[reqs.length - 1].requestId;
  await tx(
    "fund BNB loan",
    protocol.connect(bob).serviceRequest(id, NATIVE, { value: amount }),
    "scenario",
  );
  const total = (await protocol.getRequest(id)).totalRepayment;
  await tx(
    "repay BNB loan",
    protocol.connect(alice).repayLoan(id, total, { value: total }),
    "scenario",
  );
  const balance = await protocol.gets_addressToAvailableBalance(
    await bob.getAddress(),
    NATIVE,
  );
  assert(balance > amount);
  await tx(
    "withdraw lender BNB",
    protocol.connect(bob).withdrawCollateral(NATIVE, balance),
    "scenario",
  );
  await tx(
    "withdraw WBNB collateral",
    protocol.connect(alice).withdrawCollateral(WBNB, collateral),
    "scenario",
  );
  assert.equal(await wbnb.balanceOf(await alice.getAddress()), collateral);
  check("real WBNB collateral / native BNB loan full lifecycle");
  if (process.env.BSC_LOAN_ONLY === "1") {
    const token = new Contract(
      USDT,
      [
        "function balanceOf(address) view returns(uint256)",
        "function approve(address,uint256) returns(bool)",
      ],
      alice,
    );
    const amount = parseEther("100");
    async function inject(holder, tokenAddress, tokenInterface, value) {
      const holderAddress = await holder.getAddress();
      for (let slot = 0; slot < 100; slot++) {
        const snap = await local.send("evm_snapshot", []);
        const key = keccak256(
          AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [holderAddress, slot]),
        );
        await local.send("anvil_setStorageAt", [
          tokenAddress,
          key,
          "0x" + value.toString(16).padStart(64, "0"),
        ]);
        const raw = await local.send("eth_call", [
          { to: tokenAddress, data: tokenInterface.encodeFunctionData("balanceOf", [holderAddress]) },
          "latest",
        ]);
        if (BigInt(raw) === value) return;
        await local.send("evm_revert", [snap]);
      }
      throw new Error("token balance slot not found");
    }
    const lender = await local.getSigner(2);
    await inject(lender, USDT, token.interface, amount);
    await inject(alice, USDT, token.interface, amount);
    await tx("re-approve WBNB collateral", wbnb.approve(address, collateral), "scenario");
    await tx("re-deposit WBNB collateral", protocol.connect(alice).depositCollateral(WBNB, collateral), "scenario");
    await tx("approve USDT repayment", token.approve(address, amount), "scenario");
    const loanNow = (await local.getBlock("latest")).timestamp;
    await tx(
      "request USDT loan",
      protocol.connect(alice).createLendingRequest(parseEther("12"), 1000, loanNow + 3 * 86400, USDT),
      "scenario",
    );
    const loanRequests = await protocol.getAllRequests(0, 10000);
    const loanId = loanRequests[loanRequests.length - 1].requestId;
    await tx("approve USDT funding", token.connect(lender).approve(address, amount), "scenario");
    await tx("fund USDT loan", protocol.connect(lender).serviceRequest(loanId, USDT), "scenario");
    const repayment = (await protocol.getRequest(loanId)).totalRepayment;
    await tx("repay USDT loan", protocol.connect(alice).repayLoan(loanId, repayment), "scenario");
    const lenderBalance = await protocol.gets_addressToAvailableBalance(await lender.getAddress(), USDT);
    assert(lenderBalance > parseEther("12"));
    await tx("withdraw USDT lender balance", protocol.connect(lender).withdrawCollateral(USDT, lenderBalance), "scenario");
    check("forked USDT loan funding / repayment / withdrawal full lifecycle");
    const candidateFeeds = [
      [keccak256(toUtf8Bytes("USD1/USD")), "0xaD8b4e59A7f25B68945fAf0f3a3EAF027832FFB0", 108000],
      [keccak256(toUtf8Bytes("FDUSD/USD")), "0x390180e80058A8499930F0c13963AD3E0d86Bfc9", 108000],
      [keccak256(toUtf8Bytes("BTCB/USD")), "0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf", 600],
    ];
    await tx("set remaining candidate feeds", oracle.setFeeds(candidateFeeds.map((f) => f[0]), candidateFeeds.map((f) => f[1])));
    for (const [feedId, , maxAge] of candidateFeeds) await tx("candidate feed bound", protocol.setFeedMaxAge(feedId, maxAge));
    const candidates = [
      ["USDC", USDC, FEEDS.USDC[0], parseEther("12")],
      ["USD1", USD1, candidateFeeds[0][0], parseEther("12")],
      ["FDUSD", FDUSD, candidateFeeds[1][0], parseEther("12")],
      ["BTCB", BTCB, candidateFeeds[2][0], parseEther("0.001")],
    ];
    for (const [label, tokenAddress, feedId, loanAmount] of candidates) {
      if (label !== "USDC") await tx("register " + label + " loanable", protocol.addLoanableToken(tokenAddress, feedId));
      const candidateToken = new Contract(tokenAddress, [
        "function balanceOf(address) view returns(uint256)",
        "function approve(address,uint256) returns(bool)",
      ], alice);
      const candidateBalance = loanAmount * 10n;
      await inject(lender, tokenAddress, candidateToken.interface, candidateBalance);
      await inject(alice, tokenAddress, candidateToken.interface, candidateBalance);
      await tx(label + " repayment approval", candidateToken.approve(address, candidateBalance), "scenario");
      const candidateNow = (await local.getBlock("latest")).timestamp;
      await tx(label + " loan request", protocol.connect(alice).createLendingRequest(loanAmount, 1000, candidateNow + 3 * 86400, tokenAddress), "scenario");
      const candidateRequests = await protocol.getAllRequests(0, 10000);
      const candidateId = candidateRequests[candidateRequests.length - 1].requestId;
      await tx(label + " funding approval", candidateToken.connect(lender).approve(address, candidateBalance), "scenario");
      await tx(label + " fund loan", protocol.connect(lender).serviceRequest(candidateId, tokenAddress), "scenario");
      const candidateRepayment = (await protocol.getRequest(candidateId)).totalRepayment;
      await tx(label + " repay loan", protocol.connect(alice).repayLoan(candidateId, candidateRepayment), "scenario");
      const candidateLenderBalance = await protocol.gets_addressToAvailableBalance(await lender.getAddress(), tokenAddress);
      assert(candidateLenderBalance > loanAmount, label + " lender balance did not accrue repayment");
      await tx(label + " withdraw lender balance", protocol.connect(lender).withdrawCollateral(tokenAddress, candidateLenderBalance), "scenario");
      check(label + " loan funding / repayment / withdrawal full lifecycle");
    }
    report.candidateLoanLifecycle = "USDC, USDT, USD1, FDUSD and BTCB passed on a local BSC fork; balances were storage-injected locally";
    report.status = "loan-only-passed";
    return;
  }
  const inputHash = keccak256(art("KaleidoSwapV3Pool").bytecode);
  const src = fs.readFileSync(
    path.join(root, "contracts/dex-v3/periphery/libraries/PoolAddress.sol"),
    "utf8",
  );
  assert(src.toLowerCase().includes(inputHash.slice(2).toLowerCase()));
  report.poolInitCodeHash = inputHash;
  await tx(
    "create empty pool",
    factory.createPool(WBNB, USDT, 3000),
    "scenario",
  );
  const pool = await factory.getPool(WBNB, USDT, 3000);
  assert.notEqual(await local.getCode(pool), "0x");
  check("V3 creation hash matches periphery and pool deploys");
  const stable = new Contract(
    USDT,
    [
      "function balanceOf(address) view returns(uint256)",
      "function approve(address,uint256) returns(bool)",
    ],
    alice,
  );
  const who = await alice.getAddress(),
    minted = parseEther("2000");
  let found = false;
  for (let slot = 0; slot < 20; slot++) {
    const snap = await local.send("evm_snapshot", []);
    const key = keccak256(
      AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [who, slot]),
    );
    await local.send("anvil_setStorageAt", [
      USDT,
      key,
      "0x" + minted.toString(16).padStart(64, "0"),
    ]);
    const raw = await local.send("eth_call", [
      {
        to: USDT,
        data: stable.interface.encodeFunctionData("balanceOf", [who]),
      },
      "latest",
    ]);
    if (BigInt(raw) === minted) {
      found = true;
      report.forkInjectedUSDTBalanceSlot = slot;
      break;
    }
    await local.send("evm_revert", [snap]);
  }
  assert(found, "USDT balance slot not found");
  await tx(
    "initialize local pool",
    new Contract(pool, ["function initialize(uint160)"], owner).initialize(
      2n ** 96n / 27n,
    ),
    "scenario",
  );
  await tx(
    "USDT manager allowance",
    stable.approve(await manager.getAddress(), minted),
    "scenario",
  );
  await tx(
    "WBNB manager allowance",
    wbnb.approve(await manager.getAddress(), collateral),
    "scenario",
  );
  const deadline = (await local.getBlock("latest")).timestamp + 3600;
  const mintParams = {
    token0: USDT,
    token1: WBNB,
    fee: 3000,
    tickLower: -887220,
    tickUpper: 887220,
    amount0Desired: parseEther("500"),
    amount1Desired: parseEther("0.7"),
    amount0Min: 0,
    amount1Min: 0,
    recipient: who,
    deadline,
  };
  await tx(
    "mint local LP",
    manager.connect(alice).mint(mintParams),
    "scenario",
  );
  const tokenId = await manager.tokenOfOwnerByIndex(who, 0);
  assert((await manager.positions(tokenId)).liquidity > 0n);
  check("V3 position mint with real WBNB and fork-funded real USDT");
  await tx(
    "WBNB router allowance",
    wbnb.approve(await router.getAddress(), parseEther("0.01")),
    "scenario",
  );
  const before = await stable.balanceOf(who);
  await tx(
    "V3 swap",
    router
      .connect(alice)
      .exactInputSingle({
        tokenIn: WBNB,
        tokenOut: USDT,
        fee: 3000,
        recipient: who,
        deadline,
        amountIn: parseEther("0.001"),
        amountOutMinimum: 1,
        sqrtPriceLimitX96: 0,
      }),
    "scenario",
  );
  assert((await stable.balanceOf(who)) > before);
  check("V3 swap callback executes against created pool");
  const types = {
    Order: [
      ["maker", "address"],
      ["tokenIn", "address"],
      ["tokenOut", "address"],
      ["amountIn", "uint256"],
      ["minOut", "uint256"],
      ["startAt", "uint64"],
      ["expiry", "uint64"],
      ["interval", "uint32"],
      ["maxFills", "uint32"],
      ["epoch", "uint64"],
      ["salt", "uint256"],
    ].map(([name, type]) => ({ name, type })),
  };
  const domain = {
    name: "Kaleido Orders",
    version: "2",
    chainId: 56,
    verifyingContract: await orders.getAddress(),
  };
  const order = {
    maker: who,
    tokenIn: WBNB,
    tokenOut: USDT,
    amountIn: parseEther("0.001"),
    minOut: 1,
    startAt: 0,
    expiry: deadline,
    interval: 0,
    maxFills: 1,
    epoch: 0,
    salt: 1,
  };
  const signature = await alice.signTypedData(domain, types, order);
  await tx(
    "order WBNB allowance",
    wbnb.approve(await orders.getAddress(), order.amountIn),
    "scenario",
  );
  const packed = solidityPacked(
    ["address", "uint24", "address"],
    [WBNB, 3000, USDT],
  );
  await tx(
    "signed order fill",
    orders.connect(bob).fill(order, signature, packed),
    "scenario",
  );
  assert.equal((await orders.stateOf(order)).fills, 1n);
  check("chain-56 signed OrdersV2 fill through real local V3 router");
  const position = await manager.positions(tokenId);
  await tx(
    "remove liquidity",
    manager
      .connect(alice)
      .decreaseLiquidity({
        tokenId,
        liquidity: position.liquidity,
        amount0Min: 0,
        amount1Min: 0,
        deadline,
      }),
    "scenario",
  );
  await tx(
    "collect LP",
    manager
      .connect(alice)
      .collect({
        tokenId,
        recipient: who,
        amount0Max: (1n << 128n) - 1n,
        amount1Max: (1n << 128n) - 1n,
      }),
    "scenario",
  );
  assert.equal((await manager.positions(tokenId)).liquidity, 0n);
  check("V3 liquidity decrease and collection");
  assert.equal((await orders.eip712Domain()).chainId, 56n);
  check("OrdersV2 EIP712 domain binds chain 56");
  const gas = report.transactions
    .filter((t) => t.kind !== "scenario")
    .reduce((s, t) => s + BigInt(t.gasUsed), 0n);
  const live = new JsonRpcProvider("https://bsc-rpc.publicnode.com", 56, {
    staticNetwork: true,
  });
  const price = BigInt(await live.send("eth_gasPrice", []));
  const realBalance = await live.getBalance(
    "0x0Ce7f8Aeaad60b9E19ACBe9803518182adC351Bc",
  );
  report.gas = {
    deploymentAndConfig: gas.toString(),
    gasPriceWei: price.toString(),
    costBNB: formatEther(gas * price),
    costWith50PercentGasReserveBNB: formatEther((gas * price * 150n) / 100n),
    walletBNB: formatEther(realBalance),
    enoughAtObservedPrice: realBalance >= (gas * price * 150n) / 100n,
    excludes:
      "external explorer verification, liquidity seeding, user scenario transactions, other risk-policy changes and fee volatility",
  };
  report.localContracts = {
    diamond: address,
    oracle: await oracle.getAddress(),
    factory: factoryAddress,
    router: await router.getAddress(),
    manager: await manager.getAddress(),
    quoter: await quoter.getAddress(),
    orders: await orders.getAddress(),
  };
  report.status = "passed";
  console.log(JSON.stringify(report.gas));
}
main()
  .catch((e) => {
    report.status = "failed";
    report.error = e.shortMessage || e.message;
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
    local.destroy();
    arc.destroy();
  });
