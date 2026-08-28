# Every charge, and who takes it

Nine places in the protocol can take a fee. Five of them are on, two are off, one is
capped at zero by the design of the contract, and one is not ours to charge. This
page lists all nine, with the rate, the ceiling the contract enforces, and where the
money goes — because a fee page that only lists what is currently charged is a fee
page you cannot rely on after the next configuration change.

## What you pay when you trade

| Fee | Rate | Paid to | Ceiling |
| --- | --- | --- | --- |
| Swap fee | 0.05%, 0.3% or 1%, by pool tier | The pool's liquidity providers | Fixed per tier |
| V3 protocol fee | Off | — | Pool keeps between 1/10 and 1/4 of the LP fee |
| V2 protocol fee | Off | — | About 0.05% of volume, as LP tokens |

The swap fee is the tier, in full, to the providers who were in range. Kaleido takes
none of it.

The two switches below it are real and worth understanding rather than glossing.
Each pool has a protocol-fee setting that, if enabled, would divert a fraction of the
liquidity providers' fee to the protocol. On the concentrated-liquidity venue that
setting is currently zero on every pool; on the constant-product venue the recipient
address is unset, which makes the mechanism a no-op. Both are reversible in either
direction, and both being off is an economics decision, not an oversight.

Which tier you trade, and why the swap page and the agent choose differently, is on
[trading a pair](./trade.md).

## What you pay when you borrow or lend

| Fee | Rate | Paid to | Ceiling |
| --- | --- | --- | --- |
| Protocol fee on interest | 10% of the interest | The protocol's fee vault | 25% |
| Liquidation penalty | 6.4% of the debt cleared | 75% liquidator, 25% protocol | 15% |

The protocol fee is taken **from the interest portion of a repayment and never from
principal**. On a 5,000 USDC loan for 30 days at 7.5% — about 30.82 USDC of interest
— the protocol takes roughly 3.08 and the lender receives about 27.74. Every
division in that split floors, so the fee can only round down and the lender's share
can only round up. A payment small enough can round the fee to zero.

There is no origination fee, no fee to post collateral, no fee to withdraw it, and no
fee to cancel a request. Lending is free to enter and free to leave; the only charge
is on interest actually earned.

The liquidation penalty behaves as a waterfall rather than a flat rate, and this is
the part that is usually described wrongly. The lender's claim on the seized
collateral is settled first, and the penalty is only whatever was seized *above* that
claim, capped at 6.4% of it. So a position with enough collateral yields the full
penalty, and an underwater one yields less or nothing — the shortfall lands on the
penalty, never on the lender.

Full detail, including the health factor that triggers it, is on [the lending
book](./borrow.md).

## What you pay on the stablecoin

| Fee | Rate | Paid to | Ceiling |
| --- | --- | --- | --- |
| kfUSD mint | 0.05% | The yield treasury | 3% |
| kfUSD redeem | 0.05% | The yield treasury | 3% |
| Yield performance fee | 10% of yield distributed | The protocol's fee vault | 20% |

A full round trip through kfUSD is 0.1%. Both legs are charged in kfUSD, deducted
from the amount rather than added on top, and pushed to the yield treasury as they
are collected — which means kfUSD's fees are paid to kafUSD holders, less the
performance fee taken off the top.

There is no fee to lock kfUSD into kafUSD, no fee to unlock it, and no fee to claim
or compound yield. The performance fee is the only charge on the yield path, it
applies only to distributions arriving after it was set, and an unset recipient waives
it entirely and gives depositors everything.

See [kfUSD and kafUSD](./stable.md).

## What you pay to stake

Nothing, and not as a promotion. The staking vault has no fee parameter of any kind —
no deposit fee, no withdrawal fee, no performance fee on the harvest. There is nothing
to set, which is a stronger guarantee than a rate currently set to zero.

The seven-day withdrawal wait is not a fee. Nothing is charged for it and nothing is
forfeited by it; you keep earning through the whole cooldown.

See [holding KLD as stKLD](./stake.md).

## Fees that are not ours

Two, and they are worth separating out because they will appear on your statement
alongside the ones above.

**Gas.** Every action is a transaction and the network charges for it. On four chains
that is ether or tBNB; on Arc Testnet the gas token is USDC. Kaleido does not sponsor
gas, and does not add anything to it.

**Bridge fees.** A bridge route is a third party's, and its fee is that third party's.
One case is refused outright rather than passed through: a route that asks for native
currency as a relayer fee alongside an ERC-20 bridge is not signed, because that
shape lets a fee be attached to a transaction that otherwise looks like a plain token
move.

The faucet is free. It is a contract, so it costs gas to claim from, and nothing else.

## Where the protocol's revenue accumulates

One vault, deliberately. The lending protocol's cut of interest, its share of
liquidation penalties, and the yield treasury's performance fee all go to the same
address — because two vaults would mean two withdrawal procedures and two things to
forget about.

From there, revenue reaches stakers by being harvested out of the treasury into the
staking vault, which raises every stKLD balance at once. That path is described on
[holding KLD as stKLD](./stake.md), and the contracts that implement all of the above
are laid out in [how it is put together](./architecture.md).

## The ceilings are the promise, not the rates

Every configurable rate on this page has a maximum written into the contract, and
those maxima cannot be raised by configuration — only by an upgrade, through the
diamond's own upgrade path, which is public and observable. The rates are what they
are set to today; the ceilings are what the code will permit at all.

| Ceiling | Value |
| --- | --- |
| Protocol fee on interest | 25% |
| Liquidation penalty | 15% |
| kfUSD mint fee | 3% |
| kfUSD redeem fee | 3% |
| Yield performance fee | 20% |

Those five numbers live in
[`constant.sol`](../../smart-contract/contracts/utils/constants/constant.sol),
[`kfUSD.sol`](../../smart-contract/contracts/Stablecoin/kfUSD.sol) and
[`YieldTreasury.sol`](../../smart-contract/contracts/Stablecoin/YieldTreasury.sol).
