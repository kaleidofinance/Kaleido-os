import {
  readSynthraPending,
  recordSynthraPending,
  removeSynthraPending,
} from "./synthraPending";

const WALLET = "0x0000000000000000000000000000000000000001";
const HASH = `0x${"ab".repeat(32)}`;

type Storage = { [key: string]: string };
const storage: Storage = {};
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => {
      storage[key] = value;
    },
  },
};

recordSynthraPending(WALLET, {
  txHash: HASH,
  requestId: "req_12345678",
  sourceChainId: 99901,
  destinationChainId: 999,
  destinationChainName: "HyperEVM",
  amount: "1000000000000000",
  symbol: "HYPE",
  createdAt: Date.now(),
});

if (readSynthraPending(WALLET).length !== 1)
  throw new Error("Synthra pending record was not stored");

recordSynthraPending(WALLET, {
  txHash: HASH,
  requestId: "bad",
  sourceChainId: 99901,
  destinationChainId: 999,
  destinationChainName: "HyperEVM",
  amount: "1",
  symbol: "HYPE",
  createdAt: Date.now(),
});
if (readSynthraPending(WALLET).length !== 1)
  throw new Error("Malformed Synthra request id was accepted");

removeSynthraPending(WALLET, "req_12345678");
if (readSynthraPending(WALLET).length !== 0)
  throw new Error("Synthra pending record was not removed");

console.log("Synthra pending storage passed");
