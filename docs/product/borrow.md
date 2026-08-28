# Two sides of one book

Lending on Kaleido is peer to peer. There is no utilisation curve and no pooled rate:
someone posts an amount, a rate and a term, and someone else takes it. Both sides of
the book are visible, and which side you are on depends only on which row you act on.

![A lending book with borrow requests on the left and lend listings on the right.](/docs-media/book.svg "Fill a request and you are the lender; take a listing and you are the borrower.")

## Requests and listings

A **borrow request** says "I want 5,000 USDC for 30 days and I will pay 7.5%". Fill
it and you are the lender: your capital goes out, and the borrower's collateral is
already locked behind it.

A **lend listing** says "I will lend 10,000 USDC for 60 days at 6%". Take part or all
of it and you are the borrower, on the terms as posted.

Either way the rate and the term are what the two of you agreed. Nothing re-prices
them afterwards.

## The rate is an APR, and the interest is fixed at origination

The rate you see is an annual percentage rate, charged pro rata for the term:

```
interest = amount × rateBps × seconds / (10000 × 365 days)
```

So 5,000 USDC for 30 days at 7.5% is about 30.82 USDC of interest, and that figure is
computed once, when the loan opens, and stored. It does not compound, it does not
drift with utilisation, and it does not change if you repay late or early — a term
loan behaves like a term loan.

One consequence is worth stating: a rate and a term small enough that the interest
rounds to zero is refused rather than accepted as a free loan.

## Collateral, and the health factor

Collateral is deposited before you borrow and is tracked as a balance you own inside
the contract, not as a per-loan escrow. You can add to it or withdraw from it at any
time, subject to one rule.

That rule is the health factor:

```
health factor = collateral value × 80% ÷ debt value
```

Below 1.0 the position can be liquidated. Above it, nothing happens. The 80% is the
liquidation threshold and it is a constant, not a per-asset parameter — see
[`constant.sol`](../../smart-contract/contracts/utils/constants/constant.sol).

Borrowing has a separate, tighter limit: you may draw up to 75% of your collateral's
value. Those two numbers together are the headroom you open with. Borrow the maximum
and your health factor starts at about 1.07 — roughly 6% of adverse price movement
before you are liquidatable. That is thin on purpose: the protocol lets you take it,
and does not pretend it is comfortable.

The check is not advisory and it is not in the interface. Every action that could move
the health factor — borrowing, withdrawing collateral, filling, taking — is checked by
the contract, so a client that forgets to check cannot produce an unhealthy position.

## Floors

| Rule | Value |
| --- | --- |
| Smallest loan | 10 USD of value |
| Shortest term | 1 day |
| Interest that rounds to zero | Refused |

## Repaying

Repayment can be partial. Each payment is split between principal and interest in the
proportion the loan was originated at, so paying half the total pays half the
principal and half the interest rather than being applied to one first.

The protocol's fee is taken from the interest portion of each payment and never from
principal — 10% of the interest, which on the 30-day example above is about 3.08 USDC
against 27.74 USDC to the lender. Every division floors, so the fee can only ever
round down and the lender's share can only ever round up.

You can read the exact split before you send it: `getRepaymentFee` returns the fee
and the amount that will reach the lender for any payment size, and `getQuote` returns
the total repayment for a proposed amount, rate and return date.

## Liquidation

If the health factor drops below 1.0, anyone can clear the debt and take collateral
for it. The penalty is 6.4% of the debt cleared, split three parts to one: 4.8% to
whoever performed the liquidation, 1.6% to the protocol.

It is a waterfall rather than a flat rate, and the ordering is the important part.
The lender's claim on what was seized is settled first; the penalty is only whatever
was seized *above* that claim, capped at 6.4% of it. A position that still holds
enough collateral therefore yields the full penalty, and an underwater one yields
less or nothing — the shortfall lands on the penalty, never on the lender.

The split is deliberately uneven. The liquidator is not paid in the loan currency
they can bank immediately; they are paid a share of the borrower's collateral as an
internal position, which they then have to withdraw and sell, wearing gas on both
legs and whatever the price does in between. An even split would leave 3.2% to cover
all of that, which is thin enough that anything but the most liquid collateral would
sit unclosed.

Seized collateral is credited to the liquidator's balance inside the contract rather
than transferred out, so a liquidator finishes with a collateral balance and withdraws
it as a second step. That is the same balance any depositor has, which is why there is
one withdrawal path rather than a special one.

## Doing it by asking

The agent covers this whole surface — borrowing, lending, taking a listing, filling a
request, repaying, cancelling, and moving collateral either way. It is also the part
of the protocol delegation is designed around, because the on-chain mandate's action
flags are exactly these actions: see [letting it act without
you](./delegation.md).

The contract is [`ProtocolFacet.sol`](../../smart-contract/contracts/facets/ProtocolFacet.sol),
and the pages are at `/borrow`.
