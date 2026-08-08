# Licensing

This repository is not under a single license. The root `LICENSE` is MIT, but
parts of `smart-contract/contracts/` are forks of third-party code that carry
their own terms, and one of those terms is copyleft.

**There is an unresolved conflict here that needs a lawyer, not a developer.**
It is written up in full below so the decision can be made deliberately rather
than discovered during an audit or an exchange listing review.

## What is forked from where

`smart-contract/contracts/dex-v3/` is a fork of **Uniswap V3** (core and
periphery) with the contract names changed to `KaleidoSwapV3*`. Uniswap's own
license files were carried over verbatim and are still present:

- `contracts/dex-v3/core/libraries/LICENSE`
- `contracts/dex-v3/core/interfaces/LICENSE`

`smart-contract/contracts/dex/` is a fork of **Uniswap V2** with a
Solidly-style `stable()` pool flag added. Uniswap V2 core is GPL-3.0 and the
periphery is GPL-2.0-or-later; neither was ever under BUSL.

Everything else — the EIP-2535 Diamond, the facets, kfUSD/kafUSD, staking, the
points system, and the whole `src/` frontend — is first-party.

## The BUSL headers were expired, and are now corrected

Uniswap published ten V3 core files under BUSL-1.1. That license is not
permanent: it carries a Change Date, after which it converts to a stated Change
License. For Uniswap V3 the Change Date was **2023-04-01** and the Change
License is **GPL-2.0-or-later**. That date has passed, so forking V3 is
permitted and this fork is legitimate.

Until now these ten files still carried `SPDX-License-Identifier: BUSL-1.1`:

```
dex-v3/core/KaleidoSwapV3Pool.sol          dex-v3/core/libraries/Oracle.sol
dex-v3/core/KaleidoSwapV3Factory.sol       dex-v3/core/libraries/Position.sol
dex-v3/core/KaleidoSwapV3PoolDeployer.sol  dex-v3/core/libraries/SqrtPriceMath.sol
dex-v3/core/NoDelegateCall.sol             dex-v3/core/libraries/SwapMath.sol
                                           dex-v3/core/libraries/Tick.sol
                                           dex-v3/core/libraries/TickBitmap.sol
```

That header claimed a restriction on production and commercial use that had
already lapsed — against Kaleido's own contracts. They now read
`GPL-2.0-or-later`, which is what the BUSL text itself converted them to. This
is a factual correction of a stale header, not a relicensing decision.

## The conflict: MIT at the root over a GPL subtree

Root `LICENSE` is MIT (`Copyright (c) 2024 Lend-bit`). MIT is permissive: it
lets anyone take the code closed-source. GPL-2.0-or-later is copyleft: works
derived from it must be distributed under the same terms.

`dex-v3/` is a derivative work of GPL-2.0-or-later code. A blanket MIT grant
covering the repository therefore offers something on that subtree that is not
the project's to offer. The practical exposure is that a third party relies on
the MIT grant, builds a closed-source product on the V3 fork, and the upstream
copyleft obligation surfaces later.

Two ways out, both a business decision:

1. **Scope the MIT grant.** Keep `LICENSE` as MIT but state that it covers
   first-party code only, and that `contracts/dex-v3/` and `contracts/dex/` are
   GPL under their own terms. Lowest-friction, keeps the frontend permissive.
2. **Relicense the repository as GPL-2.0-or-later.** Consistent and simple, but
   it makes the frontend and the Diamond copyleft too, which affects anyone
   wanting to build on Kaleido commercially.

Also worth confirming: the root copyright is attributed to **Lend-bit**, not
Kaleido. If that is a prior name, the notice should be updated; if it is a
different entity, the chain of ownership needs to be established.

## Uniswap V4 is not available to fork

V4 is under BUSL-1.1 with a Change Date of **2027-06-15**. Until then,
commercial and production use of V4 source requires an Additional Use Grant
from Uniswap Governance. Do not copy V4 code — including hooks — into this
repository. Uniswap's own docs are inconsistent about whether V4's Change
License is MIT or GPL; the V4 announcement said GPL and the current support
article says MIT. Either way the date, not the destination, is what binds today.

## Third-party code that is safe to adopt

- **Permit2** — MIT. Would collapse the frontend's two-step
  `approve` → `swap` intent plan into a single signature.
- **`@uniswap/token-lists`** — MIT. A versioned, validated schema for
  chain-keyed token entries; maps closely onto `TokenEntry` in
  `src/constants/registry.ts`.
- **`@uniswap/sdk-core`, `@uniswap/v3-sdk`** — MIT. Audited tick math.
  Caveat: their `ChainId` enum does not know Arc or Robinhood Chain, so wrap
  any adoption to throw on an unrecognized chain instead of falling back to a
  default. That failure mode — a missing lookup silently resolving to the wrong
  chain — is the one `src/constants/tokens.ts` was rewritten to eliminate.

## Sources

- Uniswap V3 licensing: https://support.uniswap.org/hc/en-us/articles/14569783029645-Uniswap-v3-licensing
- Uniswap V4 licensing: https://support.uniswap.org/hc/en-us/articles/33829751588109-Uniswap-v4-licensing
- V3 `LICENSE` (Change Date / Change License): https://github.com/Uniswap/v3-core/blob/main/LICENSE
- V4 `licenses/BUSL_LICENSE`: https://github.com/Uniswap/v4-core/blob/main/licenses/BUSL_LICENSE
- Uniswap Foundation BUSL FAQ: https://paragraph.com/@uniswap-foundation/faq-on-uniswap-v3-s-business-source-license
