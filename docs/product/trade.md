# Trading a pair

A swap on Kaleido goes through a concentrated-liquidity pool — the same shape as
Uniswap V3, deployed as our own contracts. You are trading against the liquidity
providers in that pool, not against Kaleido and not against an order book.

## The four steps, two of which you sign

![A swap in four steps: read a quote, approve the router, swap, settle.](/docs-media/swap-steps.svg "The quote is a read. Only the middle two steps are transactions.")

The quote is a call to the pool's quoter. It returns exactly what the pool would give
you for that input right now, which is why it re-prices as you type and why it costs
nothing — no signature, no gas, no transaction.

The approve and the swap are separate transactions and stay separate. An interface
that hides one of them behind the other is hiding the fact that you granted an
allowance. When the allowance already exists it is not requested again, so the
second swap on the same pair is a single prompt.

Settlement has no middle step. The router sends the output token to your address in
the same transaction, so there is nothing held on your behalf and nothing to
withdraw afterwards.

## Fee tiers, and which one you get

Three tiers are traded, and the fee is paid by the swapper to the pool's liquidity
providers:

| Tier | Fee | Typically used for |
| --- | --- | --- |
| 500 | 0.05% | Stable pairs, where the two sides track each other |
| 3000 | 0.3% | The general case |
| 10000 | 1% | Thin or volatile pairs |

The tuple lives in [`FEE_TIERS`](../../src/lib/dex/liquidity.ts) and everything that
needs a tier reads it from there rather than repeating the numbers.

Which tier you actually trade depends on how you asked, and the difference is worth
knowing:

- **The swap page trades the 0.3% pool.** One tier, fixed, so the quote is one
  round trip and the pool you are trading in never changes under you.
- **The agent quotes all three and takes the best fill.** It asks every tier
  concurrently, ignores the ones with no pool, and routes through whichever returns
  the most output. Ties go to the cheaper tier, which is the stable-pair case.

If you want a specific tier on a pair the swap page does not route through, ask the
agent for the swap and it will find the pool.

## Slippage and the deadline

Slippage defaults to 0.5%. It is not advice about the market — it is arithmetic: the
quote is multiplied down by that percentage and the result goes into the call as a
minimum output the pool enforces. Fill better than it and you keep the difference;
fill worse and the transaction reverts, unfilled, and you pay gas for a swap that
did not happen. That is the intended failure.

The deadline defaults to twenty minutes. It exists for the transaction that gets
stuck in the mempool: without it, a swap signed at one price can execute an hour
later at another.

## More than one hop

When no pool holds both tokens, the route can go through an intermediate token — the
path is encoded into a single call, so a two-hop trade is still one transaction and
one signature. You do not choose the intermediate; it is part of the route the
quote was priced on.

## When there is no price

A pair with no pool at any traded tier has no quote, and the app says so instead of
showing a zero. The same is true if the chain you are on has no router registered:
swapping is unavailable there rather than silently pointing at another chain's
contracts. Which chain has what is in
[the deployment map](../MULTICHAIN_DEPLOYMENT_MAP.md).

## Where the fee goes

All of it goes to the liquidity providers in the pool. There is a protocol-fee
switch in the pool contracts, and it is off — see [fees](./fees.md) for what it
would do if it were on, and [providing liquidity](./liquidity.md) for the other side
of the trade you just made.
