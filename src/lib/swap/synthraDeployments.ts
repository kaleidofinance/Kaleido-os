/**
 * Synthra's documented same-chain execution contracts.
 *
 * These addresses are keyed by chain because Synthra intentionally reuses
 * address strings across Arc, Robinhood Chain, and Elysium.  Never compare a
 * Synthra router without the chain id alongside it.
 */
/**
 * Routers whose calldata we can decode and simulate in the current adapter.
 * Universal Router addresses are kept in the separate registry below; they
 * must not enter this allowlist until we validate their command bytecode too.
 */
export const SYNTHRA_INTERNAL_ROUTERS: Readonly<
  Record<number, readonly string[]>
> = {
  4663: [
    "0xfe5b981813c0dAC5a935E3fb9616e32ed0a57877", // V3.1 SwapRouter02
    "0xa50eDe66a573eE5bB37E28AF5789B76aE5FEb828", // legacy SwapRouter02
  ],
  5042: [
    "0x0abd8A8F8c6188C55f7e817273FCb7d9c3699962", // V3.1 SwapRouter02
    "0xa50eDe66a573eE5bB37E28AF5789B76aE5FEb828", // legacy SwapRouter02
  ],
  99901: [
    "0xa50eDe66a573eE5bB37E28AF5789B76aE5FEb828", // V3.1 SwapRouter02
  ],
};

/** Documented Universal Router deployments. These are metadata only until a
 * command-level decoder is added; accepting them as executable targets would
 * bypass the exactInput/multicall checks in synthraInternalCall.ts. */
export const SYNTHRA_INTERNAL_UNIVERSAL_ROUTERS: Readonly<
  Record<number, readonly string[]>
> = {
  4663: [
    "0x1eb882c8a3bb0d6334475dfb9305e3f75adddff2",
    "0x18D33De5eefB2F91B09385f35f6a1317659cc1F9",
  ],
  5042: [
    "0x800ffd3d737bf069d5ac62297b1f718776a18929",
    "0xe4C51D643A7d6D94be2646e482C59CF681B7AcEB",
  ],
  99901: ["0x18D33De5eefB2F91B09385f35f6a1317659cc1F9"],
};

export const SYNTHRA_INTERNAL_FACTORIES: Readonly<
  Record<number, readonly string[]>
> = {
  4663: [
    "0x8F419898DA502d3F49eF379775507210de2BfE3A", // V3.1
    "0x6307fc239C7964942c1BfFE51930E55606619c74", // legacy V3
  ],
  5042: [
    "0x84169F9aDF4F5F0e483BfC350498a85b1d7eC638", // V3.1
    "0x6307fc239C7964942c1BfFE51930E55606619c74", // legacy V3
  ],
  99901: ["0x6307fc239C7964942c1BfFE51930E55606619c74"],
};

/**
 * Synthra's documented execution contracts for routes that do not settle in
 * Kaleido's V3 pools.  Elysium launchpad and third-party routes use this
 * executor for both same-chain swaps and the approval spender.  Keep it out
 * of the internal-router map: its calldata is a different executor ABI and
 * must be validated by the dedicated server boundary.
 */
export const SYNTHRA_EXECUTORS: Readonly<Record<number, readonly string[]>> = {
  99901: ["0x8f419898da502d3f49ef379775507210de2bfe3a"],
};

/** Direct Synthra LaunchPad write contracts (Arc + Robinhood mainnet). */
export const SYNTHRA_LAUNCHPADS: Readonly<Record<number, readonly string[]>> = {
  4663: ["0x3D26D96BC9d1C3FcAE0D156E830c723051364847"],
  5042: ["0x18D33De5eefB2F91B09385f35f6a1317659cc1F9"],
};

const lower = (value: string) => value.toLowerCase();

export function synthraInternalRoutersFor(chainId: number): readonly string[] {
  return SYNTHRA_INTERNAL_ROUTERS[chainId] ?? [];
}

export function synthraInternalFactoriesFor(
  chainId: number,
): readonly string[] {
  return SYNTHRA_INTERNAL_FACTORIES[chainId] ?? [];
}

export function synthraExecutorsFor(chainId: number): readonly string[] {
  return SYNTHRA_EXECUTORS[chainId] ?? [];
}

export function synthraLaunchpadsFor(chainId: number): readonly string[] {
  return SYNTHRA_LAUNCHPADS[chainId] ?? [];
}

export function isSynthraInternalRouter(
  chainId: number | undefined,
  address: string,
): boolean {
  return (
    typeof chainId === "number" &&
    synthraInternalRoutersFor(chainId).some(
      (candidate) => lower(candidate) === lower(address),
    )
  );
}

export function isSynthraExecutor(
  chainId: number | undefined,
  address: string,
): boolean {
  return (
    typeof chainId === "number" &&
    synthraExecutorsFor(chainId).some(
      (candidate) => lower(candidate) === lower(address),
    )
  );
}

export function isSynthraLaunchpad(
  chainId: number | undefined,
  address: string,
): boolean {
  return (
    typeof chainId === "number" &&
    synthraLaunchpadsFor(chainId).some(
      (candidate) => lower(candidate) === lower(address),
    )
  );
}
