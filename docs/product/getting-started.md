# Your first ten minutes

This is the short path from an empty wallet to one completed swap. It assumes
nothing except a browser wallet.

## Connect a wallet

Open the app and connect. Kaleido runs on five networks — Sepolia, Base Sepolia,
BNB Smart Chain Testnet, Robinhood Chain Testnet and Arc Testnet — and the network
selector only offers the ones that have a deployment, so you cannot land on a chain
where half the app is missing.

Pick one and stay on it for the rest of this page. Positions are per chain: a loan
opened on Base Sepolia is not visible from Sepolia, because it is a different
contract on a different ledger.

## Gas comes first, and it has to come from outside

Every action below is a transaction, so the first thing you need is the chain's own
gas token. On four of the five networks that is ether or tBNB; on Arc it is USDC,
which is unusual enough to be worth knowing before you wonder why your ETH balance
is empty.

Kaleido's own faucet cannot solve this for you, and the reason is structural rather
than an omission: claiming from the faucet is itself a transaction, so a wallet with
zero gas cannot pay for the claim that would give it gas. Get a small amount from
the network's public faucet first — that is the one step that happens off Kaleido.

## Claim everything else from the faucet

With gas in hand, the faucet page at `/faucet` hands out the tokens the protocol
actually uses: USDC, USDT, USDe and the wrapped native. It is a contract, not a
server, so everything the page shows you is read from it — the amount per claim, how
much is left, how long until you can claim again, and how many addresses have
claimed already.

Native gas is listed first there anyway, so if you skipped the paragraph above the
page will make the ordering obvious.

## Make one swap

Go to `/trade/swap`, pick a pair, and type an amount. Three things happen before you
sign anything:

- The output is quoted by reading the pool. That is a call, not a transaction, so it
  costs nothing and needs no signature. It also re-runs as you type.
- Slippage defaults to 0.5%, which becomes a minimum-output figure the pool will
  enforce. If the price moves past it, the swap reverts rather than filling badly.
- A deadline of twenty minutes goes into the same call, so a transaction that sits
  unmined does not execute an hour later at an unrelated price.

Then there are two signatures, and they are deliberately not merged into one.

![A swap in four steps: read a quote, approve the router, swap, settle.](/docs-media/swap-steps.svg "The approve is skipped when an allowance is already in place, so the second swap on a pair is one signature.")

The first lets the router move the token you are spending. The second is the swap.
Once an allowance is in place it is not asked for again, so the next swap on that
pair is a single prompt. Output lands in your wallet directly — there is no Kaleido
balance to withdraw from afterwards.

## Then pick a direction

You now have a funded wallet on a working chain, and everything else branches from
here:

- **Earn on the pair you just traded.** [Providing liquidity](./liquidity.md) — put
  both tokens into a price range and collect the fees the swaps pay.
- **Borrow against what you hold, or lend it out.** [The lending book](./borrow.md)
  — you set the rate and the term, not a curve.
- **Mint a dollar against your stablecoins.** [kfUSD and kafUSD](./stable.md).
- **Do all of it by asking.** [Saying it instead of clicking it](./agent.md).
