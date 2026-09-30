# DefiLlama listing — Kaleido

TVL adapters for [DefiLlama-Adapters](https://github.com/DefiLlama/DefiLlama-Adapters), written and
**tested with DefiLlama's own harness** (`node test.js projects/<name>/index.js`) on 2026-09-30.
They live here until the PR is open; the source of truth after that is the DefiLlama repo.

| Adapter | Reads | Result on 2026-09-30 |
| --- | --- | --- |
| `kaleido-swap` | pools from Kaleido's V3 factory `0xbB74…a649` (getPool over every token pair × fee tier); the WETH9 quote asset `0x8c6c…5C75b` is counted as USDC | $483 (EURC $241, USDC $222, cirBTC $20) |
| `kaleido-lending` | balances of the lending diamond `0xE4e7…A6E3`: collateral tokens + native USDC (sentinel `address(1)`), enumerated from the contract | $0.23 (went live 2026-09-29) |

Arc (`arc`) is already a supported chain in DefiLlama (RPCs, chain list and core assets).

## To submit
1. Fork `DefiLlama/DefiLlama-Adapters`, add `projects/kaleido-swap/index.js` and `projects/kaleido-lending/index.js`,
   open a PR (tick "Allow edits by maintainers"; don't touch the lockfiles).
2. Email **metadata@defillama.com** with the listing details below (logo, links, category).

## Listing details (numbers from `/analytics`, 2026-09-30)
- **Name:** Kaleido (parent) → Kaleido Swap (category: Dexs), Kaleido Lending (category: Lending)
- **Website:** https://kaleidofi.xyz — **Twitter:** https://x.com/kaleido_finance — **GitHub:** https://github.com/kaleidofinance
- **Chain:** Arc (mainnet, chain id 5042)
- **Description:** Kaleido is an onchain trading agent (Luca) with a peer-to-peer lending market and swap pools on Arc. Tell it what you want in plain language; it plans the steps and you sign.
- **Logo:** `public/icon-512.png` (square mark)
- **Tracked today:** all-time swap volume $9,232 · fees $18.15 · 712 swaps · 742 wallets · Luca 733 turns

## Not included (deliberately)
- Volume / fees (`dimension-adapters`): `/analytics` derives them from the 0.2% fee-receiver scan plus our own pool
  `Swap` events, and the fee wallet is shared with bridges. A DefiLlama adapter would need that logic re-expressed
  purely on-chain — a separate piece of work.
- Borrowed funds: not counted in TVL.
