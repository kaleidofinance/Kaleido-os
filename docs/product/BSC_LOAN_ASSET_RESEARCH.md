# BSC loan-asset research

Checked 2026-10-27. Scope: the user's requested BNB/WBNB collateral and USDC, USDT, USD1, FDUSD and BTCB loan candidates. This is a source review plus a reference to separate live technical probes, **not a completed lending-risk approval or instruction to enable markets**.

## Token identity

All addresses below are BSC mainnet (chain ID 56); the separate live probe reports 18 token decimals for all five.

| Candidate | BSC token address | Identity evidence |
| --- | --- | --- |
| Binance-Peg USDC | `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | Existing Kaleido BSC registry and live token reads; issuer collateral-row verification remains outstanding |
| Binance-Peg USDT | `0x55d398326f99059fF775485246999027B3197955` | Existing Kaleido BSC registry and live token reads; issuer collateral-row verification remains outstanding |
| USD1 | `0x8d0D000Ee44948FC98c9B98A4FA4921476f08B0d` | Official USD1 proof-of-reserves application's BSC token map |
| FDUSD | `0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409` | First Digital's FDUSD page, BNB Chain contract section |
| BTCB | `0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c` | BNB Chain's BTCB documentation explicitly identifies this address |

Sources: [USD1 official PoR](https://por.worldlibertyfinancial.com/), [official application token map](https://por.worldlibertyfinancial.com/_next/static/immutable/chunks/1bitcz6o0977_.js), [FDUSD issuer](https://www.firstdigitallabs.com/fdusd), [BTCB chain documentation](https://www.bnbchain.org/en/blog/btcb-on-binance-smart-chain-101). The hashed USD1 application URL is an observed build artifact and can change. Its token map assigns the address above to `bsc`, marks that deployment native to the issuer, and separately describes a CCIP lock pool. Do not confuse an issuer token with its bridge pool.

## Issuers, redemption and control risks

**USD1:** BitGo issues the token; World Liberty Financial owns its brand. The issuer describes reserves as dollars, government money-market funds and cash equivalents, with monthly attestations. Direct dollar redemption is for eligible holders after BitGo onboarding: holding a token does not provide permissionless dollar redemption. These are issuer representations, not an independent solvency conclusion. [Issuer explanation](https://worldlibertyfinancial.com/usd1)

The issuer's published source implements owner-controlled mint/burn, global pause and account freeze; transfers and approvals check pause/freeze status. Its deployment uses an upgradeable transparent proxy. This reference-source review does not establish byte-for-byte parity with the current BSC implementation or its entire governance configuration. Parent live probes separately establish proxy metadata and current pause status. [Issuer source](https://github.com/worldliberty/usd1-smart-contracts), [transfer/approval and owner controls](https://raw.githubusercontent.com/worldliberty/usd1-smart-contracts/main/src/Stablecoin.sol)

**FDUSD:** FD121 (BVI) Limited issues FDUSD; First Digital Trust is its reserve custodian. The issuer describes cash/cash-equivalent backing, a bankruptcy-remote trust and monthly independent attestations. Direct minting/redemption requires client onboarding and AML/CTF checks; retail holders generally depend on secondary-market liquidity. The issuer restricts its mint/redemption service for US persons. These restrictions matter to arbitrage and liquidation during stress. A live proxy/paused read is not a full inventory of implementation roles, blacklist, seizure or upgrade powers; that inspection remains required. [Issuer contract, reserves and redemption information](https://www.firstdigitallabs.com/fdusd)

**BTCB:** BNB Chain describes BTCB as Binance-issued BTC backed 1:1 by custodied Bitcoin, and identifies its BSC address. Its 2021 article is identity/model evidence, not current reserve or current redemption availability evidence. BTCB adds Binance custody/redemption and wrapper-depeg risk to BTC price exposure. The Binance collateral page distinguishes bridge-token collateral from exchange-wide proof of reserves. Its server-rendered response did not expose current collateral rows during this review; apparent zero rows in that response must not be interpreted as zero backing. [BNB Chain](https://www.bnbchain.org/en/blog/btcb-on-binance-smart-chain-101), [Binance collateral](https://www.binance.com/en/proof-of-collateral)

**Binance-Peg USDC/USDT:** Treat these exact BSC contracts as wrapper exposures, not automatically as direct Circle/Tether redemption claims. The wrapper's collateral, mint/burn authority and redemption path require independent verification. Binance's collateral endpoint did not return usable asset rows, and explorer source requests returned 403 during this review. Consequently, exact reserve sufficiency, all administrative powers and live verified-source parity are **unresolved**, rather than silently marked passed. [Binance bridge-token collateral disclosure](https://www.binance.com/en/proof-of-collateral)

## Oracle candidates and freshness

The official Chainlink BSC reference directory identifies the following traditional proxies. Values are directory configuration, not a promise that every subsequent round arrives on time. [Official directory](https://reference-data-directory.vercel.app/feeds-bsc-mainnet.json)

| Price | Proxy | Directory heartbeat |
| --- | --- | --- |
| BNB/USD | `0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE` | 27 seconds |
| USDC/USD | `0x51597f405303C4377E36123cBc172b13269EA163` | 900 seconds |
| USDT/USD | `0xB97Ad0E74fa7d920791E90258A6E2085088b4320` | 900 seconds |
| USD1/USD | `0xaD8b4e59A7f25B68945fAf0f3a3EAF027832FFB0` | 86,400 seconds |
| FDUSD/USD | `0x390180e80058A8499930F0c13963AD3E0d86Bfc9` | 86,400 seconds |
| BTC/USD | `0x264990fbd0A4796A3E3d8E37C4d5F87a3aCa5Ebf` | 60 seconds |

USD1 and FDUSD feeds use eight answer decimals and a 0.3% deviation threshold. Their daily heartbeat is material: a five-minute freshness configuration copied from another market would routinely reject healthy rounds. Conversely, extending freshness toward the protocol's 108,000-second ceiling is not itself a lending-risk approval. The parent's 12-round history observed approximately daily updates; assess depeg detection and independent price/liquidity circuit-breakers before use. BTC/USD is an underlying-price candidate, **not proof BTCB trades at par**; the same distinction applies to generic USDC/USDT pricing and Binance wrappers.

## Decision boundary

The parent recorded successful token metadata and three-size route probes in [BSC_LOAN_RISK_PROBE.json](BSC_LOAN_RISK_PROBE.json), plus feed history in [BSC_FEED_HISTORY.json](BSC_FEED_HISTORY.json). Current unpaused state and an executable quote do not prove future liquidation or reserve safety.

Before enabling each loan market: verify live implementation/control roles and collateral/redemption evidence; agree per-asset freshness and depeg policy; rehearse supply, borrow, repay and liquidation on a fork with realistic stressed depth; select conservative initial debt caps and monitoring. BTCB debt additionally exposes BNB collateral borrowers to BTC appreciation relative to BNB. Keep all five as candidates until these gates are resolved. No on-chain writes, registrations or lending enablement were performed by this research.
