// Real Kyber route builds through Kaleido's adapter; sends only to local Anvil.
import fs from "node:fs";
import assert from "node:assert/strict";
import {
  JsonRpcProvider,
  Contract,
  ContractFactory,
  AbiCoder,
  Wallet,
  NonceManager,
  keccak256,
  parseEther,
} from "ethers";
import { resolveKyberSwap } from "../src/lib/swap/kyberswap.ts";
import {
  swapFeeBps,
  swapFeeReceiver,
} from "../src/lib/swap/kyberswapServer.ts";
const rpc = new JsonRpcProvider("http://127.0.0.1:8556", 56, {
  staticNetwork: true,
});
rpc.pollingInterval = 100;
const native = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
  wbnb = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c",
  usdt = "0x55d398326f99059fF775485246999027B3197955",
  usdc = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const result: any = {
  checkedAt: new Date().toISOString(),
  cases: [],
  scope:
    "Real route builds and local BSC fork executions only; no mainnet transactions",
};
result.fee = { bps: swapFeeBps(), receiver: swapFeeReceiver() ?? null };
const realFetch = globalThis.fetch;
globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
  const r = await realFetch(...args);
  if (!r.ok) {
    const detail = await r.clone().text();
    (result.providerErrors ??= []).push({
      url: String(args[0]).split("?")[0],
      status: r.status,
      detail: detail.slice(0, 800),
    });
  }
  return r;
};
const save = () =>
  fs.writeFileSync(
    "docs/product/BSC_ROUTING_REHEARSAL.json",
    JSON.stringify(result, null, 2) + "\n",
  );
async function fundToken(address: string, who: string, amount: bigint) {
  const t = new Contract(
    address,
    ["function balanceOf(address) view returns(uint256)"],
    rpc,
  );
  for (let i = 0; i < 20; i++) {
    const snap = await rpc.send("evm_snapshot", []);
    const key = keccak256(
      AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [who, i]),
    );
    await rpc.send("anvil_setStorageAt", [
      address,
      key,
      "0x" + amount.toString(16).padStart(64, "0"),
    ]);
    const raw = await rpc.send("eth_call", [
      { to: address, data: t.interface.encodeFunctionData("balanceOf", [who]) },
      "latest",
    ]);
    if (BigInt(raw) === amount) return i;
    await rpc.send("evm_revert", [snap]);
  }
  throw Error("cannot locate fork balance slot");
}
async function reset() {
  const info = await rpc.send("anvil_nodeInfo", []);
  assert(info.forkConfig?.forkUrl);
  assert.equal(Number((await rpc.getNetwork()).chainId), 56);
  await rpc.send("anvil_reset", [
    { forking: { jsonRpcUrl: info.forkConfig.forkUrl } },
  ]);
  await rpc.send("anvil_setBlockTimestampInterval", [1]);
}
async function testSigner() {
  const s = new NonceManager(Wallet.createRandom().connect(rpc));
  await rpc.send("anvil_setBalance", [
    await s.getAddress(),
    "0x3635c9adc5dea00000",
  ]);
  return s;
}
async function main() {
  for (const [label, input, output, amount] of [
    ["BNB to USDT", native, usdt, parseEther("0.001")],
    ["USDT to BNB", usdt, native, parseEther("1")],
    ["USDT to USDC", usdt, usdc, parseEther("1")],
  ] as const) {
    await reset();
    const signer = await testSigner(),
      who = await signer.getAddress();
    const row: any = { label, amountIn: amount.toString() };
    result.cases.push(row);
    if (input !== native)
      row.forkBalanceSlot = await fundToken(input, who, amount * 10n);
    const exec = await resolveKyberSwap({
      chainId: 56,
      tokenIn: input,
      tokenOut: output,
      amountUnits: amount.toString(),
      address: who,
      slippageBps: 100,
    });
    assert(exec, "route/build unavailable");
    row.router = exec.to;
    row.spender = exec.spender;
    row.quotedOutput = exec.amountOut;
    row.value = exec.value;
    assert.equal(
      exec.to.toLowerCase(),
      "0x6131b5fae19ea4f9d964eac0408e4408b66337b5",
    );
    assert.equal(exec.spender.toLowerCase(), exec.to.toLowerCase());
    assert.equal(BigInt(exec.value), input === native ? amount : 0n);
    if (input !== native)
      await (
        await new Contract(
          input,
          ["function approve(address,uint256) returns(bool)"],
          signer,
        ).approve(exec.spender, amount)
      ).wait();
    const outToken =
      output === native
        ? null
        : new Contract(
            output,
            ["function balanceOf(address) view returns(uint256)"],
            rpc,
          );
    const before = outToken
      ? await outToken.balanceOf(who)
      : await rpc.getBalance(who);
    const receiver = swapFeeReceiver();
    const feeBefore = receiver
      ? outToken
        ? await outToken.balanceOf(receiver)
        : await rpc.getBalance(receiver)
      : 0n;
    const tx = { to: exec.to, data: exec.data, value: BigInt(exec.value) };
    await rpc.call({ ...tx, from: who });
    row.simulated = true;
    const receipt = await (await signer.sendTransaction(tx)).wait();
    assert.equal(receipt!.status, 1);
    const after = outToken
      ? await outToken.balanceOf(who)
      : await rpc.getBalance(who);
    const received = outToken
      ? after - before
      : after - before + receipt!.gasUsed * receipt!.gasPrice;
    assert(received > 0n);
    assert(received >= (BigInt(exec.amountOut) * 99n) / 100n);
    if (receiver && swapFeeBps() > 0) {
      const feeAfter = outToken
        ? await outToken.balanceOf(receiver)
        : await rpc.getBalance(receiver);
      assert(feeAfter > feeBefore, "fee not collected");
      row.feeReceived = (feeAfter - feeBefore).toString();
    }
    row.received = received.toString();
    row.localGasUsed = receipt!.gasUsed.toString();
    row.passed = true;
    console.log("PASS " + label);
    save();
  }
  await reset();
  const signer = await testSigner(),
    maker = await testSigner(),
    who = await maker.getAddress();
  const owner = await signer.getAddress();
  const artifact = JSON.parse(
    fs.readFileSync(
      "smart-contract/artifacts/contracts/Orders/KaleidoOrdersV2.sol/KaleidoOrdersV2.json",
      "utf8",
    ),
  );
  const orders = await new ContractFactory(
    artifact.abi,
    artifact.bytecode,
    signer,
  ).deploy(wbnb, owner);
  await orders.waitForDeployment();
  const addr = await orders.getAddress();
  const target = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5";
  await (await orders.setAggregator(target, true)).wait();
  // Router constructor is a code-bearing placeholder here: only aggregator fills
  // are exercised, and this path must never call the local V3 router.
  const amount = parseEther("0.001");
  const w = new Contract(
    wbnb,
    [
      "function deposit() payable",
      "function approve(address,uint256) returns(bool)",
    ],
    maker,
  );
  await (await w.deposit({ value: amount })).wait();
  await (await w.approve(addr, amount)).wait();
  const exec = await resolveKyberSwap({
    chainId: 56,
    tokenIn: wbnb,
    tokenOut: usdt,
    amountUnits: amount.toString(),
    address: addr,
    slippageBps: 100,
  });
  assert(exec, "keeper build unavailable");
  assert.equal(exec.to.toLowerCase(), target.toLowerCase());
  assert.equal(exec.value, "0");
  const order = {
    maker: who,
    tokenIn: wbnb,
    tokenOut: usdt,
    amountIn: amount,
    minOut: (BigInt(exec.amountOut) * 99n) / 100n,
    startAt: 0,
    expiry: (await rpc.getBlock("latest"))!.timestamp + 600,
    interval: 0,
    maxFills: 1,
    epoch: 0,
    salt: 123,
  };
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
  const sig = await maker.signTypedData(
    {
      name: "Kaleido Orders",
      version: "2",
      chainId: 56,
      verifyingContract: addr,
    },
    types,
    order,
  );
  const token = new Contract(
    usdt,
    ["function balanceOf(address) view returns(uint256)"],
    rpc,
  );
  const before = await token.balanceOf(who);
  await orders.fillViaAggregator.staticCall(order, sig, exec.to, exec.data);
  const receipt = await (
    await orders.fillViaAggregator(order, sig, exec.to, exec.data)
  ).wait();
  const received = (await token.balanceOf(who)) - before;
  assert(received >= order.minOut);
  assert.equal((await orders.stateOf(order)).fills, 1n);
  result.keeper = {
    passed: true,
    simulated: true,
    router: exec.to,
    received: received.toString(),
    gasUsed: receipt!.gasUsed.toString(),
    scope:
      "OrdersV2 real Kyber calldata fill on local BSC fork; not the database/scheduled keeper service",
  };
  console.log("PASS OrdersV2 real Kyber aggregator fill");
  result.status = "passed";
}
main()
  .catch((e) => {
    result.status = "failed";
    result.error = e.shortMessage || e.message;
    console.error(result.error);
    process.exitCode = 1;
  })
  .finally(() => {
    save();
    rpc.destroy();
  });
