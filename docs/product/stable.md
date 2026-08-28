# kfUSD and kafUSD

Two tokens, and the difference between them is the whole design. kfUSD is a dollar
backed by the stablecoins that minted it. kafUSD is kfUSD you have locked, and it is
the thing the protocol's fees are paid to. Holding the first earns nothing; holding
the second earns.

![Collateral mints kfUSD, kfUSD locks into kafUSD, and unwinding runs the other way through a seven-day cooldown.](/docs-media/stable-flow.svg "Going in is two steps. Coming out is the same two steps, plus a wait.")

## Minting kfUSD

Collateral is USDC, USDT or USDe. It goes in, kfUSD comes out, and the fee is
0.05% — five basis points, charged in kfUSD, deducted from what is minted rather
than added on top.

The mint entry point is role-gated, and that is a structural decision rather than a
lock on the door. The function takes two independent numbers — how much collateral
arrives and how much kfUSD to issue against it — and does not derive one from the
other. That flexibility is what lets a mint be denominated correctly across
collaterals with different decimals, and it is exactly why the caller has to be an
authorised minter: the role, not an on-chain ratio check, is what guarantees the
supply is backed.

Redemption carries no such gate, which is the asymmetry that matters. Anyone holding
kfUSD can redeem it.

## Where your collateral sits

Minting splits the collateral in half:

| Half | Where it goes | Why |
| --- | --- | --- |
| 50% | Held idle in the contract | So redemptions can be served without unwinding anything |
| 50% | Deployed to the vault | So it can earn |

That ratio is a parameter, not a constant, and 50/50 is what it is set to. The idle
half is the honest part of the design: a stablecoin that deploys everything is one
that cannot pay a redemption without a queue.

## Redeeming

Name an amount and name the collateral you want back. You get it one for one, less
the same 0.05%, provided the contract holds enough of that particular token — the
idle balance is per asset, so redeeming into a collateral nobody minted with will
tell you so rather than silently substituting another.

Two floors apply. The smallest redemption is 0.001 kfUSD, which exists because kfUSD
carries eighteen decimals and USDC and USDT carry six: below that the conversion
would round to nothing. And the conversion itself is checked rather than trusted —
if scaling eighteen decimals down to six would lose value, the transaction reverts
instead of quietly keeping the remainder.

A full round trip therefore costs 0.1%. Both legs are capped at 3% by the contract,
so the ceiling is known even though the setting is not fixed.

## Locking for kafUSD

Lock kfUSD and you get kafUSD one for one. From that moment your share of every fee
the treasury receives accrues to you, in proportion to your kafUSD balance against
everyone else's.

Coming back out takes three moves, and it is not the same shape as the going-in:

- **Request the amount.** Unlike the staking vault, this one names a figure up
  front, and it is that figure the cooldown applies to.
- **Wait seven days.** Enforced on chain.
- **Complete it, naming an asset.** The kafUSD is burned then, not at the request,
  and you are handed back the same asset you locked — normally kfUSD.

That last point is the one people trip on. Unlocking does not return collateral.
Leaving the system entirely is unlocking *and then* redeeming, two decisions rather
than one, and each has its own step.

## How the yield actually reaches you

The treasury keeps a running accumulator per asset instead of a per-holder balance.
When fees arrive, a 10% performance fee is taken off the top and sent to the
protocol's fee vault — the same vault the lending fees go to, deliberately, so
there is one place to account for revenue rather than two. The remaining 90% moves
the accumulator, and your claim is the difference between the accumulator now and
where it stood when your balance last changed.

The practical consequences:

- Yield is **claimed, not rebased**. Your kafUSD balance does not grow; a claimable
  amount does. Claim one asset, claim all of them at once, or compound a claim
  straight back into more kafUSD.
- The performance fee applies only to fees arriving **after** it was set. Past
  distributions have already moved the accumulator and are not retroactively
  re-cut. The ceiling on it is 20%.
- An unset fee recipient means the fee is waived and depositors take everything,
  which is the safe default rather than the intended state.

## What feeds the treasury

kfUSD's mint and redeem fees are pushed to the treasury as they are charged. The
lending protocol's cut of interest goes to the same fee vault. And the staking vault
harvests from the treasury, which is how protocol revenue ends up moving an stKLD
balance — see [holding KLD as stKLD](./stake.md).

Every charge in the system, with its rate and its ceiling, is on [the fee
page](./fees.md). The contracts are
[`kfUSD.sol`](../../smart-contract/contracts/Stablecoin/kfUSD.sol),
[`kafUSD.sol`](../../smart-contract/contracts/Stablecoin/kafUSD.sol) and
[`YieldTreasury.sol`](../../smart-contract/contracts/Stablecoin/YieldTreasury.sol),
and the pages are at `/stable`.
