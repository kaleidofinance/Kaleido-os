// Checks on resolveChain — the chain-name resolver Luca's bridge leans on. Run
// with tsx. Regression cover for two reported misses: "Arc chain" (a trailing
// generic word) and "BNB Chain" (Binance's name for what the registry calls
// "BNB Smart Chain"), while keeping testnets un-collapsible from a mainnet name.
import { resolveChain } from "./bridgeQuotes.ts";

let pass = 0;
let fail = 0;
const eq = (name: string, input: string | number, expectId: number | undefined) => {
  const got = resolveChain(input)?.id;
  if (got === expectId) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name} — got ${got}, want ${expectId}`);
  }
};

console.log("\n— exact + id —");
eq("bare shortName 'Arc'", "Arc", 5042);
eq("full name 'BNB Smart Chain'", "BNB Smart Chain", 56);
eq("shortName 'BSC'", "BSC", 56);
eq("numeric id", 5042, 5042);
eq("numeric string id", "8453", 8453);

console.log("\n— trailing generic word (the 'Arc chain' bug) —");
eq("'arc chain'", "arc chain", 5042);
eq("'Arc network'", "Arc network", 5042);
eq("'base chain'", "base chain", 8453);

console.log("\n— common aliases (the 'BNB Chain' bug) —");
eq("'BNB Chain'", "BNB Chain", 56);
eq("'bnb'", "bnb", 56);
eq("'binance'", "binance", 56);
eq("'eth'", "eth", 1);
eq("'Ethereum'", "Ethereum", 1);

console.log("\n— testnets are NOT collapsed to mainnet —");
eq("'Arc Testnet' stays the testnet", "Arc Testnet", 5042002);
eq("'arc testnet' stays the testnet", "arc testnet", 5042002);
eq("'base sepolia' stays the testnet", "base sepolia", 84532);
eq("bare 'arc' is the mainnet (first match)", "arc", 5042);

console.log("\n— unknown —");
eq("nonsense is undefined", "wonderland chain", undefined);
eq("empty is undefined", "", undefined);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
