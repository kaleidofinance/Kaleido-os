# Saying it instead of clicking it

Luca is the agent panel. You write a sentence — "lend 10000 USDC at 6% for 60 days"
— and it comes back with named steps you sign one at a time. It is not a separate
protocol and not a smart wallet. It builds the same transactions the pages build,
against the same contracts, and it never holds a key.

![A sentence becomes a plan, a second pass checks the plan, you sign each step, and the contract checks its own limits again.](/docs-media/agent-loop.svg "Five checkpoints, and only two of them are you.")

## What it can actually do

Twenty-three actions and six reads. The reads cost nothing and need no signature —
your portfolio, the markets, a quote, a price, which chains are live, a bridge
route. The actions are the same surface the app exposes:

| Product | Actions |
| --- | --- |
| Trade | Swap |
| Move funds | Send, bridge |
| Borrow and lend | Borrow, lend, take a listing, fill a request, repay, cancel, deposit collateral, withdraw collateral |
| Stablecoin | Mint, redeem, lock, unlock, complete a withdrawal, claim yield, compound yield |
| Liquidity | Provide, collect fees, remove a position |
| Staking | Stake |
| Delegation | Grant a mandate |

The list is generated from
`src/app/(marketing)/_components/capabilities.ts`, which is
the same file the marketing page counts from — so the number on the front page and
the number here cannot drift apart.

Anything not on that list, it will not attempt. There is no free-form contract call
and no "let me try something".

## An incomplete sentence is asked about, not guessed at

"Stake" with no amount does not become a default amount. The parser recognises the
verb, notices the missing slot and asks for it. Same for a swap with no pair, or a
loan with no term.

This is worth stating plainly because the alternative is common and much worse: an
agent that fills a gap with a plausible number produces a transaction you did not
describe, and it will look reasonable right up to the moment you sign it.

## The second pass

Once a plan exists, a separate server-side check reads it before you ever see it.
Four properties are the reason it is worth trusting:

- **It audits the intents, not the prose.** It reads the exact objects you would be
  asked to sign, not the model's description of them. A description can be
  reassuring about a transaction that does something else.
- **It fails closed.** An intent kind it does not recognise, an amount it cannot
  price, a token address that resolves to nothing — each blocks the plan. A check
  that guesses is a check that approves.
- **It can only tighten.** Your own limits are applied against a server ceiling
  using whichever is smaller, so a client that posts a huge cap gets the ceiling and
  a client that omits one gets the ceiling too. The default ceiling is $25,000 of
  notional per action.
- **It runs on the server, only.** The module refuses to load in a browser at all.
  A guardrail evaluated client-side is a guardrail the client can remove.

And one property it deliberately does not have: it is **not** the security boundary.
It is the layer that stops an unreasonable plan from being presented as reasonable.
What actually protects you is further down.

## What actually protects you

Two things, in this order.

**Your signature.** Every step is a transaction you approve in your own wallet, with
the amounts and the destination visible. Nothing is batched behind a single prompt to
make the flow feel shorter. If a plan has four steps you sign four times, and you can
stop after the second.

**The contract.** For anything delegated, the bounds you granted live on chain and
are enforced by the contract itself, which means they hold even if the app, the
model and the auditor were all replaced by something hostile. That is the subject of
[letting it act without you](./delegation.md).

## Where the numbers come from

Prices and quotes are read from the same oracle and the same pools the pages read.
The agent does not maintain its own view of the market, so a figure it quotes and a
figure the swap page quotes are the same figure — and when a quote fails, it says so
rather than falling back to a stale one.

One place the agent is genuinely better than the page: swaps. The page trades a
single fee tier; the agent quotes all three concurrently and routes through whichever
returns the most output. See [trading a pair](./trade.md).

## Getting started with it

The panel is at `/trade/agent`, and it works on every chain that has a deployment.
Actions need a connected wallet, because they are transactions — and a plan built
with no chain connected is blocked outright rather than built against a guess, since
without a chain there is no token registry to check the addresses against.

If you have not used the protocol at all yet, [your first ten
minutes](./getting-started.md) is the faster path — a completed swap makes the agent's
plans much easier to read.
