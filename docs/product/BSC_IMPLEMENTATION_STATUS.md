# BSC implementation status

Updated 27 October 2026 (Africa/Lagos). Preparation branch; no BSC mainnet broadcasts and no production frontend deployment.

## Implemented

- Chain 56 uses the reviewed Chainlink aggregator backend. BNB/WBNB share a feed ID; stablecoins retain independent feeds. Freshness bounds are 120s for BNB and 1200s for USDC/USDT. Unit checks compare the real deploy-table output to the candidate configuration.
- BSC Kyber routes use slug `bsc` and the exact V2 router allowlist. Different router versions stay rejected. Native BNB retains the native input path and transaction value.
- USD route prices use BSC's 18-decimal USDC leg. WBNB shares the BNB display/points price feed.
- External BSC pool snapshots are derived from actual Kyber route legs, then enriched with BSC-only market data. Existing cache and unavailable-data behavior is retained. No blanket external DEX TVL/volume is attributed to Kaleido.
- Orders keeper workflow can receive `RPC_URL_56`. Existing chain discovery remains gated on real orders deployment manifests. No fake chain-56 deployment addresses were generated.
- V3 deployment now checks native identity and requires explicit mainnet settings before sending. Its compiled pool hash must match the periphery constant before factory deployment; an absent or mismatched constant aborts without broadcasts.

## Live-provider/fork evidence

`BSC_ROUTING_REHEARSAL.json` records real route builds through the changed Kaleido adapter and local fork simulation/execution for native BNB to USDT, USDT to native BNB, and USDT to USDC. The three cases also verified 20bps output-fee collection into the candidate fee wallet. OrdersV2 filled a maker-signed WBNB-to-USDT order through actual Kyber calldata with its minimum-output floor enforced.

The aggregator-only order test uses a code-bearing constructor router placeholder, since that path does not call the V3 router. `BSC_REHEARSAL.json` separately covers complete V3 deployment and signed fills through the real newly deployed local V3 router. No source execution or settlement occurred on mainnet.

`BSC_BRIDGE_QUOTES.json` records LI.FI executable quote data and direct Relay quote availability for ten USDC in each direction between BSC and Arc. Source/destination addresses and 18-to-6 decimal scaling were checked in these requests. These are provider responses, not settled bridge tests. Relay's direct probe is not proof the existing app Relay quote-only helper or executable route supports these corridors: the app execution resolver currently uses LI.FI, while the older Relay read helper sends symbol strings. A dedicated Relay execution adapter remains separate work if direct Relay fallback is required beyond routes supplied through LI.FI.

The first route-build probe using Anvil's well-known default wallet returned a Kyber `wallets invalid` validation error. Fresh ephemeral local test wallets succeeded. Their keys are not stored in artifacts. No product route-validation bypass was introduced.

## Validation

- Previous full stack: 274 compiled Solidity files, runtime parity with 13 live Arc contracts, lending/DEX/order fork lifecycles and 201 focused contract tests.
- Current preparation: 36 Kyber adapter checks, 47 fill-policy checks, five new BSC configuration tests plus 23 existing mainnet guard tests; external pool regression checks and BSC USD quote scaling pass. TypeScript check passes.
- Full app production build passed (61 static pages generated). This isolated checkout lacks Supabase public variables and the thirdweb client key, so the build warned that those features are disabled. The build verifies code, not a deployable credential configuration or connected-wallet browser behavior. The existing ox/viem dynamic-import warning remains.

## Production choices and next work

- User selected native BNB/WBNB as collateral and USDC/USDT/USD1/FDUSD/BTCB as loan candidates, conditional on lending risk checks. None of these loan candidates is automatically admitted by that selection. The broad fork registration should not be copied into production; native BNB/WBNB borrowing is outside this selected initial scope.
- Candidate `feeVault` reuses the recorded Arc recipient/deployment wallet `0x0Ce7f8Aeaad60b9E19ACBe9803518182adC351Bc`. Native/ERC20 output-fee reception was verified on the BSC fork; recheck its identity in the final deployment plan. No ownership transfer to the Arc Safe is scheduled.
- Existing deployer wallet covers the recorded rehearsed gas set at the sampled price. Recheck current fees, balance, signer and all constructor/configuration values immediately before broadcast.
- Execute the reviewed deploy scripts, verify addresses/source/configuration, generate the registry, and wire capabilities/ingestion/analytics to the resulting actual chain-56 manifests.
- Complete the scheduled keeper's database/signing/RPC deployment and a dry run against the real deployed settlement contract. The local fill does not prove the hosted scheduler or database connection.
- Verify desktop/mobile wallet flows and API data, then release the approved app commit to Vercel and all Hostinger sites. Keep liquidity seeding, mint/redeem, KLD staking and ownership transfer deferred.
