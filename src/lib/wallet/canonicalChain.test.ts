import { defineChain } from "thirdweb/chains";
import { canonicalThirdwebChain } from "./canonicalChain";

const elysium = canonicalThirdwebChain(
  defineChain({
    id: 99901,
    name: "Elysium (thirdweb fallback)",
    rpc: "https://99901.rpc.thirdweb.com/client",
    nativeCurrency: { name: "HYPE", symbol: "HYPE", decimals: 18 },
  }),
);

if (elysium.id !== 99901) throw new Error(`expected 99901, got ${elysium.id}`);
if (elysium.rpc !== "https://rpc.elysium.kinetiq.xyz") {
  throw new Error(`Elysium signer RPC was not canonicalized: ${elysium.rpc}`);
}

const unknown = defineChain({
  id: 31337,
  name: "Local",
  rpc: "http://127.0.0.1:8545",
});
if (canonicalThirdwebChain(unknown) !== unknown) {
  throw new Error("unregistered chains should keep their provider metadata");
}

console.log("canonical chain tests passed");
