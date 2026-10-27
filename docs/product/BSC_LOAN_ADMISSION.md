# Selected BSC lending assets and risk screen

User decision, 27 October 2026: **BNB + WBNB collateral; USDC + USDT + USD1 + FDUSD + BTCB loan candidates, after lending risk checks**. Native/wrapped BNB borrowing was not selected. None of the five loan candidates becomes enabled simply by appearing in the registry or this report.

## Live technical screen

`BSC_LOAN_RISK_PROBE.json` records chain-56 reads on 27 October. All five tokens have code, expected symbols, positive supplies and **18 decimals**. USD1 and FDUSD returned `paused=false` at the read; USDC/USD1/FDUSD have nonzero EIP-1967 implementation/admin slots. USDT and BTCB return the same owner address. An unsupported `paused()` or `owner()` read is recorded as a failed optional call; it is not evidence that an asset lacks privileged controls.

For each asset, Kyber returned token-to-WBNB routes at three input sizes: 100/1,000/10,000 for stablecoins and 0.001/0.01/0.1 BTCB. All 15 route requests succeeded. Quote USD values and venues are saved. These observations are not guaranteed liquidation depth, a transfer-fee audit, or executable liquidation proof.

## Oracle and representation decisions

| Loan candidate | Price evidence | Principal admission concern |
| --- | --- | --- |
| Binance-Peg USDC | Dedicated USDC/USD proxy; 8-decimal positive completed round, published heartbeat 900s | Binance representation/backing and proxy controls are distinct from Circle-native USDC; no CCTP assumption |
| Binance-Peg USDT | Dedicated USDT/USD proxy; 8-decimal positive completed round, published heartbeat 900s | Binance custody/issuance controls and peg remain outside the underlying feed |
| USD1 | Dedicated USD1/USD proxy; 8 decimals, published heartbeat 86,400s and deviation threshold 0.3% | Upgrade/freeze/pause controls, redemption/custody requirements and day-class feed freshness policy |
| FDUSD | Dedicated FDUSD/USD proxy; 8 decimals, published heartbeat 86,400s and deviation threshold 0.3% | Upgrade/freeze/pause controls, onboarding for issuer redemption and day-class freshness policy |
| BTCB | BTC/USD reference proxy answers; no BTCB-specific market or reserve feed selected | BTC/USD alone does not measure a BTCB depeg or prove backing; custody and collateral-to-BTCB liquidation pricing need explicit treatment |

Sources for proxies and heartbeat/deviation metadata: [Chainlink BSC directory](https://reference-data-directory.vercel.app/feeds-bsc-mainnet.json). Sources for token provenance and issuer controls are recorded in `BSC_LOAN_ASSET_RESEARCH.md`.

`BSC_FEED_HISTORY.json` checks the latest twelve rounds in the current USD1 and FDUSD proxy phases. All sampled answers are positive/completed. Maximum observed gap for each is **86,427 seconds**, slightly over 24 hours. Stablecoin bounds of 1,200s would therefore reject these assets most of the day. The live Arc source permits per-feed limits up to 108,000s, but this maximum is a capability, not a recommended risk setting. Do not select the similarly named 18-decimal Shared SVR proxy by accident.

Hermes metadata independently provides exact symbol IDs `Crypto.USD1/USD` (`0a2425d43486780990d8b63543029e20556be51fd756cca584212f4d539611d4`) and `Crypto.FDUSD/USD` (`ccdc1a08923e2e4f4b1e6ea89de6acbc5fe1948e9706f5604b8cb50bc1ed3979`). These could serve as oracle mapping identifiers after admission; their existence is not proof that Pyth price publishing is operational on BSC. The selected backend remains Chainlink.

## Remaining admission checks

The isolated local BSC fork now passes the full ERC-20 path for **USDC, USDT, USD1, FDUSD, and BTCB**: WBNB collateral, token funding, repayment, lender-balance withdrawal, and repayment accounting. The candidate pass uses storage injection only to provision fork test balances and a local BTCB freshness tolerance; it does not prove mainnet liquidity, reserves, or production feed identifiers. The production loan list therefore remains empty until the policy gates below are closed.

1. Verify issuer/custodian reserve evidence and actual privileged control paths. Public disclosures and token supply are not an independent reserve audit.
2. Rehearse each proposed loan asset's transfer/approval/fund/repay/withdraw path using the real BSC token on a local fork. Test BNB/WBNB collateral conversion to that debt asset and adverse price movement, including BTCB volatility/peg risk.
3. Review USD1/FDUSD's day-class freshness limits and depeg response. Test stale/nonpositive/incomplete rounds and feed outages; do not silently widen the global limit or substitute another stablecoin's feed.
4. Verify liquidation execution depth for the intended market sizes, keeper RPC support and operational pause/monitoring response. Successful route quotes alone do not settle this.
5. Add approved assets to the actual deploy feed tables and registration plan, collateral first where applicable, then read back on-chain decimals/feeds/asset arrays after deployment. Existing source cannot freely remove a loanable asset, making pre-registration decisions material.

Current outcome: **metadata, feed-read and sampled-route checks passed; loan admission remains pending the checks above**. `loanAssets` stays empty in the candidate configuration; all five requested candidates remain explicitly recorded. No mainnet configuration was changed.
