import { guardLegacyPlan } from "./legacyEngine";
const blocked = guardLegacyPlan({ context: { functionData: { result: { amount: "1001" } } } }, { chainId: 4663 });
if (!blocked.blocked || blocked.context?.reason !== "threshold_exceeded") throw new Error("threshold guard failed");
const unvetted = guardLegacyPlan({ context: { functionData: { result: { target: "UnknownProtocol" } } } }, { chainId: 4663 });
if (!unvetted.blocked || unvetted.context?.reason !== "unvetted_omnichain_target") throw new Error("destination guard failed");
const safe = guardLegacyPlan({ context: { functionData: { result: { target: "Robinhood Router" } } } }, { chainId: 4663 });
if (safe.blocked) throw new Error("whitelisted destination should pass");
console.log("Legacy engine guard checks passed.");
