# BSC preflight results

26 October 2026. Read-only checks using `scripts/preflight-bsc.mjs`; full timestamped results are in `BSC_PREFLIGHT.json`. No transactions sent. Public RPC calls use latest state independently, not a single pinned block; observations must be refreshed before deployment.

## Verified

- Chain-56 public RPC responds with the expected chain ID. Arc endpoint responds with chain ID 5042.
- Arc deployment wallet `0x0Ce7f8Aeaad60b9E19ACBe9803518182adC351Bc` holds **0.008989968228597829 BNB** on BSC. Observed gas price is 50,000,000 wei (0.05 gwei). This is not a total deployment estimate or confirmation of sufficient funds.
- WBNB, Binance-Peg USDC, Binance-Peg USDT and BTCB all hold contract code and return the expected symbols and **18 decimals**. This validates metadata, not peg backing or proxy permissions.
- All four selected Chainlink traditional BSC proxies (BNB/USD, BTC/USD, USDC/USD, USDT/USD) answer with positive prices, matching descriptions and 8 decimals; observed round IDs equal answeredInRound. Round timestamps and observed age are recorded in JSON.
- Kyber MetaAggregationRouterV2 at `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5` has 18,652 bytes of code. Native BNB to USDT quote succeeds through `/bsc/api/v1/routes` and returns that address; the observed route uses `pancake-infinity-cl`. No build, approval, swap or execution simulation was performed.
- Arc diamond owner is Safe `0x4c72B4799d374D2Ad9a8C9716766f8325808B94F`. Its live loupe exposes six facets, including upgraded ProtocolFacet `0xfc055263Dd57A665A612fD7D24cf94Ee390De5bf`, AgentPermissionFacet and LendingAdminFacet; addresses/selectors are recorded in JSON.
- Arc diamond, orders, oracle, V3 factory/router/manager/quoter all have code; code hashes are recorded. The manifest's oracle matches `getPythPriceOracle()` on the diamond.
- Arc configuration reads: `getBPS=500`, `getLiquidityBPS=640`, global `getPriceMaxAge=300`, confidence bound 100. The live collateral list has two ERC20s; the loanable list contains native sentinel address(1). These observations are inventory, not instructions to copy all risk settings onto BSC.

## Configuration implications

1. Use canonical WBNB for wrapped native; BNB pays gas. Keep BSC's ERC20 stablecoins at their measured 18 decimals.
2. Define a reviewed chain-56 aggregator backend/feed table. Chainlink directory heartbeats for USDC/USDT are 900 seconds: copying Arc's 300-second global bound can reject normal price reads. Set reviewed per-feed freshness bounds including tolerance, then rehearse stale/nonpositive/incomplete rounds. See `BSC_ORACLE_SOURCES.md` for official sources and distinct Shared SVR proxies.
3. Support discovery of real routed venues, including the returned Infinity venue. Do not interpret an Infinity/V4 pool ID as a V3 contract address or expose a V3 deposit flow for it.
4. Derive the BSC deployment from live Arc facet inventory plus verified source and compiler settings. Code presence and recorded hashes alone do not prove local source/build parity.

## Remaining before broadcast

- Reproduce Arc runtime from reviewed source/build artifacts, accounting for metadata, linked libraries and constructor immutables; validate exact facet selectors and required initializer/configuration.
- Compile and fork-rehearse the full oracle/diamond/DEX/orders stack; verify the V3 creation-code hash and native wrapping/refund behavior.
- Estimate the complete deployment/configuration transaction set at current BSC fees with a reserve, then compare against wallet balance. No funding requirement has been calculated yet.
- Validate asset backing/proxy controls and separate trading from lending admission. Underlying Chainlink prices do not independently protect a Binance-Peg token depeg.
- Build and simulate representative Kyber calldata; validate allowance spender, receiver, value, target and slippage. Test LI.FI/Relay corridor quotes separately.
- Verify WBNB wrapper surface, external venue factories/fee tiers, and indexing RPC log support; existing metadata/code reads do not establish these.
- Confirm keeper identity/configuration, fees and permissions, and preserve deferred ownership transfer/liquidity/mint-redeem/staking scope.

This closes the initial live network/token/feed/inventory check, not deployment readiness. Next: source/build parity, explicit BSC configuration and a fork rehearsal.
