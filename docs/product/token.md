# What KLD is, and where the supply goes

KLD is the protocol token: a plain ERC-20 with a permit signature, a burn function,
and two mint roles. One billion of them, fixed at deploy and unreachable afterwards.
Everything below is either enforced by `KLD.sol` or expressed as a row in
`KLDVesting.sol` — the allocation is not a slide, it is a contract you can read.

![One billion KLD divided into eight buckets, sized against each other, with the portion unlocked at the token generation event marked on the bar.](/docs-media/token-supply.svg "Community Ecosystem is the largest bucket at 20%; the Public Sale is the smallest at 5%.")

## The eight buckets

| Bucket | KLD | Share | Schedule |
| --- | --- | --- | --- |
| Community Ecosystem | 200,000,000 | 20% | 25% at TGE, remainder linear over 6 months |
| Seed Round | 150,000,000 | 15% | 20% at TGE, 20% at month 3, 60% linear over 10 months |
| Liquidity | 150,000,000 | 15% | 50% at TGE, remainder linear over 24 months |
| Treasury | 150,000,000 | 15% | 12-month cliff, then 36 months linear |
| Team | 100,000,000 | 10% | 12-month cliff, then 36 months linear |
| Grants & Contributors | 100,000,000 | 10% | 3-month cliff, then 12 months linear |
| Advisors and Partners | 100,000,000 | 10% | 6-month cliff, then 24 months linear |
| Public Sale | 50,000,000 | 5% | Unlocked in full at TGE |

The eight rows sum to exactly one billion, and the contract enforces that they can
never sum to more: `addSchedule` refuses to register a bucket unless the vesting
contract already holds enough unallocated KLD to cover it in full. So it has to be
funded before it can be allocated, which makes over-allocation impossible rather than
merely unintended. `unallocated()` is the headroom, and it is a public view.

Every schedule is measured from one immutable `start` timestamp, so the buckets cannot
drift apart by being registered in different blocks.

## What unlocks, and when

![Circulating KLD climbing from 205 million at TGE to the full billion at month 48, with a visible step at month three.](/docs-media/unlock-curve.svg "The first year does most of the work; the last two are the team and treasury tails finishing.")

205,000,000 KLD — 20.5% — is liquid the moment the token generation event happens.
That is the Public Sale in full, plus the day-one tranches of the Seed Round,
Community Ecosystem and Liquidity buckets. Nothing held by the team, the treasury,
advisors or grants is unlocked at TGE; all four sit behind a cliff.

| Month | Released | Share |
| --- | --- | --- |
| 0 (TGE) | 205,000,000 | 20.5% |
| 3 | 319,375,000 | 31.9% |
| 6 | 455,750,000 | 45.6% |
| 12 | 603,500,000 | 60.4% |
| 24 | 808,333,333 | 80.8% |
| 48 | 1,000,000,000 | 100% |

A month is 30 days. That is a convention rather than a fact — a chain has no calendar
— so "36-month linear" means 1,080 days and the schedules drift from calendar months
by roughly five days a year.

One bucket needs a shape that a conventional vesting wallet cannot express. The Seed
Round's second 20% is a **step at month 3**, not the start of a ramp: folding it into
the linear tail would pay the same tokens out gradually over the following ten months
and land on the same total by a different path. That is why the schedule struct carries
a distinct `cliffAmount` field alongside the linear tail, and it is the visible kink in
the curve above.

## Circulating supply is a subtraction, not a report

Every KLD the vesting contract holds is unreleased, which makes circulating supply
computable from two `balanceOf`-class reads and no indexer:

```
circulating = kld.totalSupply() - kld.balanceOf(vesting)
```

Claiming is permissionless — anyone can pay the gas to push a vested tranche out — but
the tokens always move to the beneficiary fixed when the row was added, and there is no
setter for it. There is no admin path to move a beneficiary's tokens and no pause. The
owner's only reach is `sweep`, and its cap is `unallocated()`, so an unclaimed tranche
is not touchable under any argument.

## Why the ceiling is a constructor argument

`maxSupply` is immutable but not a constant. A token whose ceiling is a literal in its
source forces a contract rewrite — and a fresh audit — every time tokenomics moves a
number, and tokenomics settles later than code does. A token whose ceiling is mutable
by an admin has no ceiling. A constructor argument stored in an immutable is the only
shape that lets the number be decided once, at deploy, and never again.

The same reasoning covers distribution: the constructor mints nothing. A freshly
deployed KLD has zero supply and zero holders and is inert until something holding
`MINTER_ROLE` issues the first tokens, so the allocation table lives with the
deployment record that documents it rather than inside the token.

Two supply invariants follow, and both are mechanical:

**Issuance is capped on cumulative mints, not on `totalSupply()`.** `totalIssued` only
ever rises; burning does not hand back headroom. This matters because of bridging —
under burn-and-mint, moving KLD off a chain burns it there, and a cap written against
`totalSupply()` would restore the full headroom and let a minter issue the maximum a
second time. It also gives burns the meaning people assume they have: burnt KLD is
gone, not reissuable.

**Issuance is confined to one chain, in code.** `MINTER_ROLE` cannot be granted
anywhere except the home chain — the `_grantRole` override reverts rather than
silently refusing, so a deploy script cannot report a minter that does not exist. On
every other chain the only way KLD can come into existence is a bridge moving supply
already issued at home. Five chains each honouring a 1× ceiling independently would be
a 5× ceiling; this is what closes that, and it is the kind of invariant usually left to
operational discipline.

A bridge gets its own `BRIDGE_ROLE`, which mints **without** touching `totalIssued`,
because a cross-chain transfer is not issuance — those tokens were counted against the
cap at home and burnt there. It still cannot push a chain's supply past the global
ceiling, which bounds a broken bridge to a supply that looks wrong on one chain rather
than one that is unbounded.

## Deliberately not a voting token

The obvious reach is OpenZeppelin's checkpointing extension, and it is left out on
purpose. Vote checkpoints are per chain: on a multichain token they measure voting
power on whichever chain a holder's balance happens to be sitting on, which is a
property of their bridging history rather than of their stake. It would add a write to
every transfer and a nonce collision with the permit extension to resolve, and it would
not deliver the thing it looks like it delivers. Voting belongs in a separate contract
that holds or escrows the token, where power can be defined once across all chains
instead of once per chain — and that stays available without changing the token.

## What the token does here

Staking is the live path: deposit KLD into the vault and receive stKLD, a rebasing
receipt whose balance steps up each time protocol yield is harvested. The mechanism,
the seven-day unstaking queue and the rate are on [staking](./stake.md).

Points are the other half. Accrual freezes at a stated block, the full table is
published, and allocation is pro-rata on point share after a dispute window — the
sequence is on the [roadmap](./roadmap.md), and none of it is computed in your browser.

Protocol revenue is separate from the token and always has been: the five live fees
are listed with their rates and ceilings on [every charge](./fees.md).

## Where it is deployed

KLD, the staking vault and stKLD are live on all five networks Kaleido runs on.

| Network | KLD |
| --- | --- |
| Sepolia | `0x79C14246120369A98c4226a01158645a7A501F35` |
| Base Sepolia | `0x6140Da1f66fCafa0b5197065ae91A00208F3Cd86` |
| BNB Smart Chain testnet | `0x0d6a6F10adeCdc8a8b93aAc0Fa5210653de3511d` |
| Arc testnet | `0xC0f8D36ec1D96477F26228A629a31248c584f477` |
| Robinhood testnet | `0x6F57844d0C6DCB7eB906d21C99195a3FC446E81D` |

These are five independent deployments rather than one token with four shadows, which
is a deliberate choice for the testnet phase and is the thing a bridge changes. The
vault and stKLD addresses, and what has to be true of a chain before Kaleido can run
there at all, are on the [deployment map](../MULTICHAIN_DEPLOYMENT_MAP.md).

The contracts are
[`KLD.sol`](../../smart-contract/contracts/Token/KLD.sol) and
[`KLDVesting.sol`](../../smart-contract/contracts/Token/KLDVesting.sol).
