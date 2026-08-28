# Providing liquidity in a range

A liquidity position is not a deposit into a pot. You choose a price range, and your
capital only works — and only earns — while the pair's price is inside it. That is
the whole trade-off: a narrow range earns more per dollar and spends more time
earning nothing.

![A price axis with a range band in the middle. Below the band the position is all WETH and earns nothing, above it all USDC and earns nothing.](/docs-media/range.svg "Outside the range the position is entirely one token, and idle.")

## Inside, outside, and what you are holding

Inside the range you hold a mix of both tokens, and the mix shifts as the price moves
across it. At the lower bound you hold only the token being bought; at the upper
bound only the token being sold. Cross a bound and the position stops earning and
sits entirely in one asset until the price comes back.

Nothing liquidates and nothing is lost when that happens. An out-of-range position is
idle, not closed, and the fees it already collected stay collected.

## Choosing the range

Three ways to specify one, and they behave differently on purpose:

- **Full range.** No bounds. Behaves like a constant-product pool, earns on every
  trade, and earns the least per dollar of the three.
- **A band around the current price.** You give a percentage — ±10%, say — and the
  centre is read from the pool rather than guessed. This is the auditable form: the
  centre is a fact about the market, not a number somebody typed.
- **Explicit prices.** A minimum and a maximum, in the pair's own units.

A band needs a live price to centre on, so it is refused on a pair and tier with no
pool yet. That is not a limitation to work around — the first position in a pool
*sets* the price, so there is nothing to centre on. Open it full range, or give
explicit bounds and choose the opening price deliberately.

## Why your bounds are not the ones you asked for

Pools do not store prices. They store ticks, and a tier only allows ticks at
multiples of its spacing:

| Tier | Fee | Tick spacing | Roughly |
| --- | --- | --- | --- |
| 500 | 0.05% | 10 | 0.1% of price |
| 3000 | 0.3% | 60 | 0.6% of price |
| 10000 | 1% | 200 | 2% of price |

So a request is snapped to the nearest usable tick on each side, and the bounds you
end up with are near the ones you asked for rather than exactly them. Asking for ±10%
on the 0.3% tier lands within a fraction of a percent; asking for it on the 1% tier
lands within a couple.

This has one sharp edge, and it is guarded. On the 1% tier, a band narrower than
about ±1% snaps both bounds onto the same multiple — the range collapses to a single
price and the mint reverts with nothing you could act on. That case is caught before
the transaction is built, and the error says to widen the range or use a finer tier.

## Slippage on the way in

Opening a position deposits two amounts at whatever ratio the current price implies,
which means the amounts that land are not exactly the amounts you typed. Minimums are
computed for both sides from your slippage tolerance and enforced by the position
manager, so a price that moves while the transaction is pending either deposits
inside your tolerance or reverts.

On a pool that does not exist yet the same floor does a different job: the two
amounts you supply set the opening price, and the minimums are what stops someone
front-running the initialisation with a price of their choosing.

## Collecting, and closing

Fees accrue to the position and are not auto-compounded. Collecting is its own
action, and it pays out both tokens in whatever proportion the trades happened to
leave — the position keeps its liquidity and keeps earning.

Closing removes the liquidity and returns both sides at the current ratio. If the
price is outside your range at that moment, you get one token, which is the same
position you were already holding rather than a loss taken on exit.

Both live at `/pool`, alongside every position you hold on the connected chain.

## Where the fee comes from

Every swap through your pool pays the tier's fee, and all of it goes to the providers
in range at that moment. The protocol takes nothing from it today — see
[fees](./fees.md) for the switch that would change that, and
[trading a pair](./trade.md) for the other side of it.
