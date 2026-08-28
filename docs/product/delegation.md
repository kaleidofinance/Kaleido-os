# Letting it act without you

Delegation is one transaction that grants an agent authority over your positions
inside stated bounds. The bounds are stored in the contract, not in the app, which
is the only property that makes the arrangement worth considering: they hold even if
the interface, the model and the server-side checks were all replaced by something
hostile.

![One transaction carrying eight bounds: a per-action cap, a per-epoch cap, the epoch length, an expiry, a health floor, an action bitmask, a token allowlist and an optional interest ceiling.](/docs-media/mandate.svg "Nine parameters, one signature, and the contract keeps every one of them.")

## The nine parameters

An address, and eight bounds on what it may do with it:

| Parameter | What it bounds |
| --- | --- |
| Agent address | Who may act. Cannot be you, cannot be the zero address |
| Max notional per action | The ceiling on any single action, in USD |
| Max notional per epoch | The ceiling on everything inside one window |
| Epoch duration | How long that window lasts, in seconds |
| Expiry | The timestamp at which the grant dies by itself |
| Max interest | The worst rate it may accept on your behalf. Zero disables the check |
| Min health factor | The floor it may never push you under |
| Allowed actions | A bitmask — which actions at all |
| Token allowlist | The only tokens it may touch |

Every one of them is checked when you grant it, not just when it is used, and the
grant reverts rather than being stored in a shape that means nothing:

- An expiry in the past, an epoch of zero seconds, or a bitmask with no bits set.
- Either cap set to zero.
- A per-action cap **above** the per-epoch cap — meaningless, and almost always a
  units mistake in the caller.
- A health floor below 1.0. Below that the position is already liquidatable, so such
  a floor would be authorising the agent to hand you straight to a liquidation bot.

One case is not a revert but is worth knowing anyway: an empty token allowlist
grants nothing usable. The mandate exists, and every action fails the token check.

## Which actions can be delegated

Six flags, and they are all lending:

| Flag | Action |
| --- | --- |
| 1 | Borrow |
| 2 | Lend |
| 4 | Repay |
| 8 | Deposit collateral |
| 16 | Withdraw collateral |
| 32 | Close a position |

Combine them by adding. Lend and repay only is 2 + 4 = 6.

What is *not* on that list is the point of the list. Swapping, providing liquidity,
staking, minting kfUSD and bridging cannot be delegated at all — no bit exists for
them, so no mandate can authorise them. Those actions always need your signature at
the moment they happen. And no mandate scopes a plain token transfer: delegation is
authority over protocol actions, never over your balance.

## How the epoch actually behaves

The window is not a calendar day. It starts when you grant the mandate and rolls
forward lazily: the first action taken after the window has lapsed resets the start
to that moment and zeroes the spend. So a mandate that goes unused for a month has a
full budget when it is next used, rather than a month of accrued allowance.

Spend accumulates in USD within the live window and is checked before each action,
so the per-epoch cap is a real ceiling and not an average. When it is exhausted,
actions revert until the window rolls.

Re-granting the mandate resets the budget to zero. That is deliberate — changing the
terms starts a fresh window rather than inheriting whatever was already spent under
the old ones.

## Revoking

Revocation is immediate and unconditional. No timelock, no minimum notice, no
conditions, and no owner override — the protocol's owner cannot revoke on your
behalf and cannot stop you revoking. It is the panic button, and the reason it is
written the way it is written is that it must never be able to fail.

You can also adjust a single token in the allowlist afterwards, in either direction,
without touching the rest of the mandate.

## Reading it back

Three reads, and they are the source of truth for any interface that displays your
limits: the whole grant, whether a specific token is allowed, and how much budget
remains in the current epoch. An app showing you a number it did not get from those
is showing you its own opinion.

## What the app fills in

A mandate is granted from the agent's settings panel on `/trade/agent`. Three of the
nine parameters are yours to set there, and the defaults are deliberately well inside
what the contract would accept: $1,000 per action, $5,000 per epoch, and a health
floor of 1.4 where the contract's own minimum is 1.0. Confirmation on every step is
left switched on, which is an app-side setting rather than one of the nine — the
contract has no opinion about whether you were asked first.

The rest the panel decides for you: a one-day epoch, a thirty-day expiry, and an
allowlist scoped to the tokens registered on the chain you are signing from, so a
mandate signed on one network cannot name a token from another. One parameter it
leaves off — max interest is submitted as zero, which disables the rate check. If you
want a borrow rate ceiling enforced on-chain, that is the one bound you have to set
by calling the facet yourself.

Raising the numbers later means signing a new grant, which replaces the old one
outright and resets the epoch budget to zero. That direction is only ever available
to you: the agent cannot widen its own mandate, cannot grant onward to another
address, and neither can the protocol's owner — grants are scoped to `msg.sender` and
there is no admin path into them. The same asymmetry runs through the whole agent
path, and [saying it instead of clicking it](./agent.md) describes the layers above
this one.

The contract is
[`AgentPermissionFacet.sol`](../../smart-contract/contracts/facets/AgentPermissionFacet.sol)
and the enforcement is in
[`LibAgentPermission.sol`](../../smart-contract/contracts/libraries/LibAgentPermission.sol).
