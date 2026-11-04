import type { Signer } from "ethers";

export function assertPositionNetwork(expected: number | undefined, actual: number | undefined) {
  if (expected === undefined || actual !== expected) {
    throw new Error(`Switch your wallet to the position's network (${expected ?? "unknown"}) before continuing.`);
  }
}

/** Check live wallet state for every submission, including multi-step approvals. */
export function guardPositionSigner(signer: Signer, expected: number | undefined, currentChain: () => number | undefined): Signer {
  assertPositionNetwork(expected, currentChain());
  return new Proxy(signer, {
    get(target, key) {
      if (key === "sendTransaction") return async (...args: Parameters<Signer["sendTransaction"]>) => {
        assertPositionNetwork(expected, currentChain());
        return target.sendTransaction(...args);
      };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
