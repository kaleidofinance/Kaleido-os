# One place to trade, lend and hold

Kaleido is five products sitting on one deployment per chain: a swap, a liquidity
manager, a peer-to-peer lending book, a staking vault, and a dollar you can mint
against your own collateral. Nothing here is a front end onto somebody else's
protocol — the pools, the book, the vault and the stablecoin are all contracts in
[this repository](../../smart-contract/contracts/).

There are three ways to reach them, and they are equivalent. The app has a page per
product. Luca, the agent, takes the same actions from a sentence. And the contracts
are public, so you can call them directly.

![Three ways in — the app, the agent and direct contract calls — reaching the same contracts, deployed once per chain across five networks.](/docs-media/overview.svg "Whichever way in you take, the same contract runs.")

## The five products

| Product | What you do | Where |
| --- | --- | --- |
| Swap | Trade one token for another through a concentrated-liquidity pool | [Trading a pair](./trade.md) |
| Liquidity | Put two tokens to work inside a price range and collect the fees | [Providing liquidity](./liquidity.md) |
| Borrow and lend | Post a rate and a term, or take one somebody else posted | [The lending book](./borrow.md) |
| Stake | Hold KLD as stKLD and let the protocol's fees accrue to it | [Staking KLD](./stake.md) |
| Stablecoin | Mint kfUSD against USDC, USDT or USDe, and lock it for yield | [kfUSD and kafUSD](./stable.md) |

Two things are shared rather than duplicated. Prices come from one oracle per chain,
so a swap quote, a health factor and a mint all value the same token the same way.
And collateral is one balance: what you post for a loan is tracked by the same
contract that checks whether you can still borrow against it.

## Three ways in

### The app

A page per product, at `/trade/swap`, `/pool`, `/borrow`, `/stake` and `/stable`,
with your positions collected at `/portfolio`. Every number on those pages is read
from a contract on the chain your wallet is connected to.

### Luca

The agent panel takes a sentence — "lend 10000 USDC at 6% for 60 days" — and turns
it into named steps you sign one at a time. It has twenty-three actions and six
reads, and it never holds your keys. See [Saying it instead of clicking
it](./agent.md), and [Letting it act without you](./delegation.md) for the case
where you want it to move without a prompt each time.

### The contracts

Addresses for all five networks are in
[`deployments.generated.ts`](../../src/constants/deployments.generated.ts), and
[the deployment map](../MULTICHAIN_DEPLOYMENT_MAP.md) says what has to exist on a
chain before the app can point at it.

## What is the same on every chain

The same code is deployed to Sepolia, Base Sepolia, BNB Smart Chain Testnet,
Robinhood Chain Testnet and Arc Testnet. What differs per chain is everything the
contracts do not own: which price feed answers, which router the swaps go through,
and which tokens are registered as collateral.

That separation is why Arc works at all. Arc's native currency is USDC rather than
ether, so a protocol with a hardcoded wrapped-native address or a hardcoded feed
would need a fork to run there. Ours needs a different row in a registry.
[Architecture](./architecture.md) covers how that is arranged.

## Where to go next

If you have never used it, [your first ten minutes](./getting-started.md) walks
from an empty wallet to one completed swap.

If you are integrating, start with [architecture](./architecture.md) for the shape
of the deployment and [fees](./fees.md) for every charge in the system and who
takes it.

If you are here about the token, [KLD and its supply](./token.md) has the eight
buckets and the unlock curve, and [the roadmap](./roadmap.md) has the dates they are
measured from.
