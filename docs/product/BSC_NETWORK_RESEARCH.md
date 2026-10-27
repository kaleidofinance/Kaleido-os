# BNB Smart Chain mainnet research

Checked 26 October 2026. Planning only; no deployments or signed transactions.

## Confirmed network facts

- Mainnet chain ID is **56** (`0x38`), gas currency **BNB**, explorer **BscScan**. WBNB is an ERC-20 wrapper; it is not the gas balance. [BNB official network configuration](https://github.com/bnb-chain/bnb-chain.github.io/blob/main/docs/bnb-smart-chain/developers/wallet-configuration.md)
- Official public RPC: `https://bsc-dataseed.bnbchain.org`. BNB's public endpoints have a documented rate limit and disable `eth_getLogs`; production indexing must use a provider supporting historical logs, rather than relying on the wallet RPC. [BNB RPC documentation](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/)
- Canonical WBNB: `0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c`. [Uniswap BNB deployment reference](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-bnb-deployments)

## Providers and actual liquidity venues

- Direct requests to [LI.FI chains](https://li.quest/v1/chains) and [Relay chains](https://api.relay.link/chains) both returned HTTP 200 and chain **56** on this check. LI.FI identifies BSC as mainnet and relayer supported. Relay identifies BNB as enabled (`disabled:false`, `depositEnabled:true`) with BNB, USDC and USDT bridge support. This confirms chain availability, not any specific pair, amount, destination, fee, or executable route.
- KyberSwap's official supported-network page lists BNB Chain. Pair quotes and build-transaction simulation must still be tested through Kaleido before enabling execution. [KyberSwap support](https://support.kyberswap.com/hc/en-us/articles/13774514997785-What-Blockchain-Networks-Does-KyberSwap-Support)
- PancakeSwap v3 is a first-party documented BSC venue: factory `0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865`, quoter `0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997`. [PancakeSwap deployments](https://developer.pancakeswap.finance/contracts/v3/addresses)
- Uniswap v3 is also documented on BSC: factory `0xdB1d10011AD0Ff90774D0C6Bb92e5C5c8b4461F7`, quoter `0x78D78E420Da98ad378D7799bE8f4AF69033EB077`. [Uniswap deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-bnb-deployments)
- PancakeSwap's v3 fee tiers include **0.25%**, rather than assuming every v3 venue uses Uniswap's common 0.30% tier. Fee-on-transfer and rebase tokens are not supported by PancakeSwap v3. Venue-specific configuration and token screening are required. [PancakeSwap swap FAQ](https://docs.pancakeswap.finance/trade/trading-faq/swap-faq)

## Asset registry implications

The live Relay registry lists these BSC representations with **18 decimals**:

| Symbol | Address | Required distinction |
| --- | --- | --- |
| USDC | `0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d` | Existing Binance-Peg representation; never assume Circle-native USDC or 6 decimals |
| USDT | `0x55d398326f99059ff775485246999027b3197955` | Existing Binance-Peg representation; never inherit another chain's decimals or issuer assumptions |
| WBNB | `0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c` | Wrapped token; Relay currently lists direct bridging false for this token while native BNB is bridge supported |

Source: [Relay live registry](https://api.relay.link/chains). Contract code, `decimals()`, symbols, and token provenance still need independent on-chain verification before registration. Circle's current Mint chain list does not list BNB, and warns that bridged USDC is unsupported for Mint deposits; do not equate the Binance-Peg token with issuer-native Circle redemption/CCTP support. [Circle supported chains](https://developers.circle.com/circle-mint/supported-chains-and-currencies)

USD1 is explicitly listed by its issuer as available on BNB Smart Chain. Its final full address, decimals, proxy permissions, oracle support and liquid routing pairs remain to be verified before admission. [USD1 issuer](https://worldlibertyfinancial.com/usd1). FDUSD is a candidate requiring issuer-source address verification, live decimal reads and liquidity/oracle assessment; it is **not approved by this research**.

## Predeployment evidence still required

1. Query every selected token and oracle on chain 56; record address, decimals, proxy owner and applicable bridge/issuer provenance.
2. Fetch real LI.FI, KyberSwap and Relay quotes for representative stablecoin, BNB, cross-chain and size scenarios. Check actual underlying venues; simulate executable calldata and validate spender/recipient/value.
3. Pool availability does not imply safe liquidity. Verify pool addresses, factory, fee tier, reserves/depth, impact and price consistency. Display only external pools Kaleido actually routes through.
4. Use approved live Arc contract versions as the Kaleido baseline; validate BSC EVM target, feed freshness/heartbeat, native-BNB wrapping/refunds, keeper support and deployment gas by a full dry run before funding or signing.
