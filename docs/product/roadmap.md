# What is done, and what is dated

Four phases. The first has shipped, two are in September 2026, and one is the quarter
after. Each item below is either running now or is a thing with a date on it — there
is no wish list at the end.

![Four phases on one rail: the shipped stack, mainnet in September 2026, the token generation event in late September, and exchange listings in Q4.](/docs-media/roadmap.svg "The two September nodes are the current window; everything left of them is live today.")

## Shipped — the full stack

Four markets, and an agent with the tools to act on all of them.

- A concentrated-liquidity DEX with three fee tiers, a peer-to-peer lending book,
  kfUSD and the kafUSD yield vault, and liquid staking.
- Luca: provider-agnostic reasoning, read tools that hit real contract state, a
  bounded set of execute tools, and a local-first grammar that resolves most
  instructions without a model call at all.
- Bounded on-chain agent mandates — per-action and per-epoch caps, a health floor,
  an expiry, an action bitmask and a token allowlist, all enforced by the diamond
  rather than the interface.
- Season 0 settled: participation credit, capped at 300 points.

The protocol runs on five networks today, and the token, the staking vault and stKLD
are deployed on all five. Addresses are on the [deployment
map](../MULTICHAIN_DEPLOYMENT_MAP.md).

## September 2026 — mainnet

Every market opens for real money.

- **Third-party audit.** Today the contracts have been reviewed internally and the
  critical findings are fixed. That is not the same thing as a completed third-party
  audit, which is exactly why it is a milestone and not a claim.
- **Deployed across the five rollout chains.** The same chain set the protocol runs on
  now, on mainnet instead of testnet.
- **Signed bridging.** The routes and the fees are already live through the aggregators;
  the signature is the part that is missing.
- **Points Season 1 opens** — server-computed, receipt-verified and time-weighted. No
  point is ever computed in your browser, and none is written by anything but a
  service-role key.

## Late September 2026 — TGE

KLD ships, and points become an allocation.

- The KLD token generation event.
- Accrual freezes at a stated block, and the full point table is published.
- Allocation is pro-rata on point share, after a dispute window.
- Initial KLD liquidity in Kaleido's own V3 pools.

The supply, the eight buckets and the unlock curve those dates drive are on [the token
economy](./token.md).

## Q4 2026 — listings

KLD where the volume already is.

- Centralised exchange listings.
- Season 2 opens — the points program continues past TGE.
- The agentic mobile interface.

## What is deliberately not on this list

A roadmap is the easiest place in a protocol to write down something nobody has
committed to, so three absences are worth naming.

**No governance milestone.** There is no governor and no timelock in the contracts —
only `OwnershipFacet` — so a DAO date would be the first invented item on the page.
Why the token deliberately is not a voting token, and where voting would have to live
instead, is on [the token economy](./token.md).

**No named exchange.** "Centralised exchange listings" is the commitment. A logo wall
would be a claim about somebody else's decision.

**No TVL or supply target.** A figure about the future is still a figure, and it would
be the one number on this page that nothing can be checked against.
