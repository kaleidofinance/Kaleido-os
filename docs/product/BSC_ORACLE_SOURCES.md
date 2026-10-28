# BSC oracle and aggregator source check

Checked 26 October 2026. Read-only planning evidence; no contract configuration or transactions.

## Chainlink traditional price-feed proxies

Freshly fetched [Chainlink's BSC mainnet reference directory](https://reference-data-directory.vercel.app/feeds-bsc-mainnet.json), linked by the [official contract-address documentation](https://docs.chain.link/data-feeds/price-feeds/addresses?network=bnb-chain&page=1). These are the traditional `*-usd` entries, not the `*-usd-shared-svr` entries.

| Feed | Proxy | Directory decimals | Heartbeat seconds | Deviation threshold |
| --- | --- | --- | --- | --- |
| BNB / USD | `0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE` | 8 | 27 | 0.1% |
| BTC / USD | `0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf` | 8 | 60 | 0.1% |
| USDC / USD | `0x51597f405303C4377E36123cBc172b13269EA163` | 8 | 900 | 0.1% |
| USDT / USD | `0xB97Ad0E74fa7d920791E90258A6E2085088b4320` | 8 | 900 | 0.1% |

The directory also exposes Shared SVR entries with the same names and **18** decimals. Do not select by display name alone or assume every feed uses eight decimals. Shared SVR proxies for reference: BNB `0xd5D290Fe2ae6b55F385ab9C14d2CeB91DD3d9022`, BTC `0x14Aed7178df8d33755b1c4b8f3CC3e0EAa2B203B`, USDC `0x8068600c8f6d2fB3d44F5B4cb7E7f4Ac47c2c742`, USDT `0x501e21126486424567f40D490856094D72986E41`. This report does not approve selecting those alternatives.

Read `decimals()`, `description()`, `latestRoundData()`, current proxy aggregator and bytecode on chain 56 before registration. Directory heartbeat is configuration evidence, not a guarantee each block will carry a fresh answer. Set an explicitly reviewed freshness limit with appropriate operational tolerance; do not inherit Arc's five-minute bound for stablecoin feeds whose heartbeat is fifteen minutes. [Chainlink freshness guidance](https://docs.chain.link/data-feeds/overview)

These feeds price the named underlying assets. They do not independently establish Binance-Peg redemption/backing, BTCB peg safety, or a particular lending collateral policy.

## KyberSwap BSC targets

[KyberSwap's official Contracts & Addresses](https://docs.kyberswap.com/developer-guide/aggregator-api/contracts) explicitly lists **BSC chain 56**:

- MetaAggregationRouterV2: `0x6131B5fae19EA4f9D964eAc0408E4408b66337b5`.
- KSAggregationRouterV3: `0x6868d319c8c9a78f7d39dc3602c5c917315132d7`.
- AggregationExecutorProxy: `0x8F10B468b06c6FD214B65F87778827F7D113f996`.
- InputScalingHelperV2: `0x2f577A41BeC1BE1152AeEA12e73b7391d15f655D`.

The current Kaleido adapter uses MetaAggregationRouterV2 on Arc and Robinhood. For BSC, verify the actual route/build response and on-chain bytecode against that exact allowlisted version. The documentation listing V3 alongside V2 does not authorize silently accepting either target. Spender, receiver, value and calldata still require validation and simulation for each supported execution path.
