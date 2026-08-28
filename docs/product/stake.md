# Holding KLD as stKLD

Staking KLD is not a lock-up with a posted rate. You deposit KLD, you hold stKLD
against it, and your balance grows whenever the protocol's fees are harvested into
the vault. There is no advertised APY anywhere in the product, because there is no
number the contract could honestly print — the return is whatever the protocol
earned.

![Depositing KLD returns stKLD one for one. The underlying share is fixed, and the balance it is worth steps up at every harvest.](/docs-media/stake-rate.svg "Your share of the pool never changes. What the share is worth does.")

## Depositing, and what you get back

The vault mints you shares, and stKLD reports those shares priced in KLD. The
first deposit into an empty vault mints one for one; every deposit after that mints
in proportion to what the pool already holds, so nobody can buy in cheaply after a
harvest and nobody's existing position is diluted by a later one.

The consequence is worth being precise about, because two things are often confused:

- **Your share count is fixed.** It only moves when you deposit or withdraw.
- **Your stKLD balance is not fixed.** It is your share re-priced in KLD, so it
  rises as the pool grows. The token rebases; there is no separate reward to claim
  and nothing to compound by hand.

There is no deposit fee and no withdrawal fee. Not "currently zero" — the contract
has no fee parameter to set.

## Where the yield comes from

Protocol fees accumulate in the yield treasury. Harvesting pulls them into the
vault and adds them to the pooled total, which is the moment every holder's balance
steps up. Anyone can call the harvest; it takes no privileged role, because it can
only ever move fees in the one direction and to the holders they were already owed
to.

That also means the increments are lumpy rather than smooth. A day with no fees is
a day with no growth, and a large harvest is a visible step. A page showing a smooth
curve here would be showing you an interpolation, not the vault.

Which fees reach the treasury, and in what proportion, is on [the fee
page](./fees.md).

## Leaving takes three moves

| Step | What it does |
| --- | --- |
| Request the withdrawal | Starts a seven-day clock on your account |
| Wait seven days | Enforced by the contract, not the interface |
| Withdraw an amount | Burns the matching shares and transfers the KLD |

The request names no amount — it is a clock on the account, and the amount is
chosen at the end. Two details follow from that and are worth knowing before you
start:

- **Withdrawing spends the request.** Even a partial withdrawal clears it, so a
  second exit starts another seven days. Take out what you need in one call.
- **You keep earning while you wait.** The shares are not escrowed during the
  cooldown, so harvests during those seven days still reach you.

You can cancel a pending request and go back to holding normally. Re-requesting
restarts the full seven days from scratch; the clock is not banked.

## One asset, deliberately

The vault holds KLD and only KLD. It can be told which token it supports, and it
refuses anything but stKLD's own underlying — because stKLD's balance is computed
from a single pooled total, so a second asset in the same pool would mis-price every
holder's balance rather than diversify it.

## Getting KLD to stake

KLD is deployed on all five networks with a one-billion maximum supply. On testnets
each chain issues its own supply and each has its own faucet, which drips 1,000 KLD
per claim — that is the practical way to get some. On mainnet the topology is
different: one home chain issues supply and every other chain holds bridged supply
only, which is set out in [the deployment map](../MULTICHAIN_DEPLOYMENT_MAP.md).

The vault, the token and stKLD are three separate contracts and their addresses per
chain are in
[`deployments.generated.ts`](../../src/constants/deployments.generated.ts). What the
supply is, how the eight allocation buckets unlock, and why issuance is confined to
one chain in code are on [KLD and its supply](./token.md). The
pages are at `/stake`. The agent can stake for you from a sentence — "stake 1200
KLD" — but the exit is deliberately not one of its actions: requesting, cancelling
and withdrawing are done on the page, by you. See [saying it instead of clicking
it](./agent.md).
