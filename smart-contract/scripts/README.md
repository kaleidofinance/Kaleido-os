# Deployment scripts

This directory held 93 files. 81 were deleted, leaving the 12 below (plus two
stray probes removed from the `smart-contract/` root: `check-pairs.js` and
`selector_check.js`). What went was one-off probes written against a single
Abstract testnet deployment that no longer exists, with its addresses baked in
as literals. They could not be run — they would have queried dead contracts and
reported confident nonsense — and they buried the handful of scripts that
matter.

Deleted with them: all of `scripts/abi/`, roughly 6,000 lines of ABI JSON
referenced only by those probes. The frontend has its own copies under
`src/abi/` and never read these.

What survives is the deploy path plus the two checks that catch failures which
do not surface until after money is at risk.

## Nothing is deployed yet

`DEPLOYMENTS` in `src/constants/registry.ts` is empty for every chain. The app
reads addresses only from there — never from the `deployment-*.json` files
these scripts emit. Copying the output into the registry is a manual step, and
`isDeployed()` stays false until `diamond` is set for that chain.

## Order

```bash
cd smart-contract
npm install              # node_modules here holds one package; nothing has been built
npx hardhat compile
```

Then, before deploying anywhere:

```bash
npx hardhat run scripts/check-contract-sizes.js
```

EIP-170 caps deployed bytecode at 24,576 bytes on every EVM chain. Abstract
does not enforce it, and `allowUnlimitedContractSize` hides it locally — so a
facet can deploy fine on Abstract and be undeployable on Base. A facet over the
limit should be split, not squeezed.

### V3 DEX

```bash
WRAPPED_NATIVE=0x... NATIVE_LABEL=ETH \
  npx hardhat run scripts/deploy-v3.js --network baseTestnet

npx hardhat run scripts/verify-pool-init-hash.js --network baseTestnet
```

`WRAPPED_NATIVE` is required, with no default. It is not derivable from the
chain's native symbol: WETH on Ethereum, WBNB on BNB, WPOL on Polygon, and on
Arc it wraps USDC rather than ether. The script also rejects an address holding
no code on the target chain, which is what a value copied from another chain
looks like.

`verify-pool-init-hash.js` is the one that will bite you. `PoolAddress.sol`
hardcodes the keccak of the pool's creation bytecode, and the periphery derives
pool addresses from it via CREATE2 rather than asking the factory. The hash is a
property of the *compiled bytecode*, so it changes with the compiler and with
optimizer settings — see the `0.7.6` entry in `hardhat.config.js`. A wrong value
does not fail at deploy. The factory still creates pools. It fails at the first
swap, when the callback authenticates `msg.sender` against a derived address
that holds no code.

On Abstract this check refuses to give a pass at all: zkSync's CREATE2
derivation differs from the EVM `0xff` scheme, so `computeAddress` is
structurally wrong there no matter which hash is stored, and pools must be
resolved through `factory.getPool()`.

### Diamond, V2 DEX, stablecoin, staking

```bash
npx hardhat run scripts/deploy.js            --network <net>   # EIP-2535 Diamond + facets
npx hardhat run scripts/deploy-dex.js        --network <net>   # V2 factory + router
npx hardhat run scripts/deploy-stablecoin.js --network <net>   # kfUSD / kafUSD / YieldTreasury
npx hardhat run scripts/deploy-masterchef.js --network <net>   # farm emissions
scripts/KLDVault/deployment/                                   # KLDVault + stKLD
```

`genSelectors.js` and `libraries/diamond.js` compute the facet selector arrays
that `deploy.js` cuts into the Diamond.

## Addresses still hardcoded in the kept scripts

These survived because the deploy logic is sound, but each carries a literal
from the dead deployment and will deploy against a non-contract if run as-is.
Parameterise as you reach them:

| Script | Literal |
|---|---|
| `deploy.js` | oracle, Pyth oracle, vault addresses |
| `deploy-dex.js` | `wethAddress` — marked "Old WETH" in the source |
| `deploy-stablecoin.js` | `USDC_ADDRESS` default (overridable by env) |
| `deploy-masterchef.js` | `KLD_ADDRESS` |
| `KLDVault/deployment/STkLD.js` | vault and KLD token addresses |

`deploy-v3.js` was the sixth and is now fixed: it takes `WRAPPED_NATIVE` from
the environment and verifies code exists at it.

## Credentials

`DEPLOYER_PRIVATE_KEY` and the RPC overrides come from `.env` — see
`hardhat.config.js`. A previous version of that config committed a deployer key
and two explorer API keys; those are permanently public and must never be
reused. Generate a fresh deployer offline for anything touching mainnet.
