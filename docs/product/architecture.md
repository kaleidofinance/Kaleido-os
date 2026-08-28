# How it is put together

One address per chain receives every lending and delegation call. Everything else —
the pools, the stablecoin, the staking vault, the oracle — sits beside it as separate
contracts, wired together by a registry rather than by hardcoded addresses. This page
is the shape of that, for anyone integrating against it or reading the source.

![One diamond address receives every call and delegates it to a facet. The facets hold the code, the diamond holds the storage, and the oracle, router and tokens sit outside it.](/docs-media/architecture.svg "The address you integrate against does not change when the code behind it does.")

## One address, five facets

The lending protocol is an EIP-2535 diamond. Calls land on the diamond, which looks
up which facet implements the function and delegates to it. The facet supplies the
code; the diamond supplies the storage. Five are deployed, identically, on all five
chains:

| Facet | What it holds |
| --- | --- |
| `ProtocolFacet` | The lending book, collateral, health factors, liquidation |
| `AgentPermissionFacet` | Mandates: granting, revoking, reading, enforcing |
| `OwnershipFacet` | Who may upgrade |
| `DiamondCutFacet` | The upgrade itself |
| `DiamondLoupeFacet` | Introspection — which facet answers which selector |

Two consequences matter to anyone building on it.

**Shared storage, not per-facet storage.** Every facet reads and writes the same
slots, held by the diamond. A position created through one facet is visible to
another without a message between them, which is why collateral is a single balance
rather than a per-product escrow.

**Upgrades keep the address.** Swapping a facet swaps a function's code. The address
you integrated against, the approvals users granted it, and the positions inside it
all survive. That is the reason for the pattern; it is not an incidental benefit.

## What lives beside it

The diamond is not the whole protocol, and it would be misleading to draw it that
way. These are separate deployments with their own addresses:

| Group | Contracts |
| --- | --- |
| DEX (V3) | Factory, router, quoter, position manager, position descriptor |
| DEX (V2) | A second, constant-product venue: factory and router |
| Stablecoin | `kfUSD`, `kafUSD`, `YieldTreasury` |
| Staking | `KLD`, `KLDVault`, `stKLD` |
| Oracle | One wrapper per chain, plus the feed it reads |
| Testing | The faucet |

Two notes on that table. The V2 venue is deployed on every chain but the app's swap
path routes V3 only — every quote and every swap in the interface and in the agent
goes through the V3 quoter and router. And the V3 pool address is derived with
CREATE2, so the registry carries the pool init-code hash; V2's library asks the
factory for a pair instead, which is why there is no equivalent field and no
equivalent class of bug to guard against.

## The registry is the only place addresses live

`deployments.generated.ts` is written by a generator that folds every
`deployment-*.json` record the deploy scripts emit into one chain-keyed map:

```
npm run gen:registry
```

It is generated, and editing it by hand is not merely discouraged — the next run
rewrites the whole file, so a manual correction survives exactly until the next
deploy. Every address carries a trailing comment naming the record it came from, so a
wrong value is traceable to a deploy rather than a guess. `registry.ts` spreads the
generated map first and can override it explicitly, which is where a genuine
exception belongs.

Nothing in the application derives an address any other way. That is what makes the
next two sections possible.

## Prices: one wrapper, two backends

Each chain has our own oracle wrapper, and the diamond calls it through a
single-function interface. Behind that interface there are two implementations:

- `PythPriceOracle`, reading Pyth. Deployed on Arc.
- `AggregatorPriceOracle`, reading a Chainlink-shaped `AggregatorV3Interface` feed.
  Deployed on Sepolia, Base Sepolia, BNB Smart Chain Testnet and Robinhood Chain
  Testnet.

Which one a chain has is recorded as `oracleKind` in the registry, read back from the
deployed contract's own accessor rather than inferred, so it cannot drift from the
bytecode. It is carried into the frontend for one specific reason: Pyth returns a
confidence interval and the aggregator path returns a confidence of zero, because
`AggregatorV3Interface` has no such concept. Anything rendering a price band has to
know which of the two it is looking at.

Freshness is bounded twice, and the second bound is the one that matters:

| Bound | Value |
| --- | --- |
| Global maximum age | 300 seconds |
| Global maximum confidence | 100 bps |
| Per-feed maximum age | Set individually, and overrides the global |

The per-feed override exists because heartbeats genuinely differ — an ETH feed
updates in well under a minute and a stablecoin feed can go the better part of a day
without moving. A single global constant tight enough for the first would reject the
second permanently. So if you are checking whether a price is stale, ask the chain's
oracle; do not compare a timestamp to 300 seconds and conclude anything.

## Why a chain whose gas is USDC works

Arc Testnet's native currency is USDC, with eighteen decimals. A protocol carrying a
hardcoded wrapped-native address, a hardcoded feed, or an assumption that gas is
ether would need a fork to run there.

Nothing here is hardcoded, so it needs a different row in the registry instead: its
own wrapped native, its own oracle wrapper, its own registered collateral set. The
same is true in the other direction — the reason the codebase went to the trouble of
removing every chain literal is that the alternative is a fork per chain, and five
forks do not stay in sync.

Which registrations a chain needs before the app will point at it is set out in [the
deployment map](../MULTICHAIN_DEPLOYMENT_MAP.md).

## Reading it yourself

Contracts are under
[`smart-contract/contracts/`](../../smart-contract/contracts/); the lending facets are
in [`facets/`](../../smart-contract/contracts/facets/) and the oracle wrappers in
[`utils/oracle/`](../../smart-contract/contracts/utils/oracle/). Addresses for all
five chains are in
[`deployments.generated.ts`](../../src/constants/deployments.generated.ts).

For what each product does with all this, start at [the
overview](./overview.md); for every charge the system takes, [the fee
page](./fees.md).
