# Archived deployment records

These are records of deployments that are no longer part of the app. They are
kept because a record of what was once live at an address is worth having, and
moved out of `smart-contract/` because `scripts/gen-registry.mjs` globs
`smart-contract/deployment-*.json` and folds what it finds into
`src/constants/deployments.generated.ts`.

Nothing reads this directory. Adding a file here has no effect on the app.

## Why each file is here

### `deployment-dex-abstractTestnet.json`, `deployment-v3-abstractTestnet-1775754669967.json`

Abstract Testnet (chain 11124) was the original home chain and is not a deploy
target any more — it is registered in `src/constants/chains.ts` for balance
reading only, with `tradable` unset, and the decision to drop its addresses
rather than carry them forward is the reason `DEPLOYMENTS` was emptied.

Three independent things make these two records unusable, not just obsolete:

- **The chain is dropped.** `gen-registry.mjs` filters on `tradable` in
  chains.ts, so 11124 would be excluded even if these files stayed put.
- **The V3 record carries a `poolInitCodeHash` we have since proven wrong.**
  It records `0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54`,
  which is upstream Uniswap's value. Our pool is a renamed fork
  (`KaleidoSwapV3PoolDeployer` deploys `KaleidoSwapV3Pool`), so the real hash
  differs — that constant was corrected in `PoolAddress.sol` during this
  deployment wave. A hash that is wrong does not fail at deploy; the factory
  still creates pools and it breaks at the first swap, in the callback that
  authenticates `msg.sender` against the CREATE2-derived address. Folding this
  value into the registry would reintroduce exactly that bug.
- **The DEX record predates the current schema and has no `chainId` at all.**
  Its keys are `KaleidoSwapFactory` / `KaleidoSwapRouter` / `WETH9`, where
  `deploy-dex.js` now writes `v2Factory` / `v2Router` / `wrappedNative`. The
  generator treats a componentised record with no `chainId` as a hard error
  rather than a skip, on the grounds that a file naming deployed contracts
  should never be dropped quietly — so leaving it in place would stop the
  generator outright.

These were also deployed from the compromised deployer key (`0x28b7b3dc…8955`,
derived from a private key that was committed to git and is therefore public).
Anything still holding value at these addresses should be treated as spendable
by anyone.
