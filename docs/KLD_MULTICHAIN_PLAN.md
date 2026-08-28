# Making $KLD multichain

How KLD goes from five independent testnet deployments to one token with one
supply that moves between chains. Written against the deployed contracts and the
installed SDK, not against the marketing plan — every address, chain id and
package claim below was read out of the repository or the Wormhole SDK's own
tables, and the checks that produced them are given so they can be rerun.

Companion to [MULTICHAIN_DEPLOYMENT_MAP.md](./MULTICHAIN_DEPLOYMENT_MAP.md),
which covers deploying the protocol stack per chain. This covers one token
crossing between chains, which is a different problem: the stack can be five
independent copies, and a token cannot.

---

## 1. Where we actually are

`scripts/deploy-kld.js` ran on all five testnets on 2026-08-27. Read from the
deployment records:

| network            | chainId  | KLD                                          | home       | issued  |
| ------------------ | -------- | -------------------------------------------- | ---------- | ------- |
| `sepolia`          | 11155111 | `0x79C14246120369A98c4226a01158645a7A501F35` | itself     | 1B      |
| `baseTestnet`      | 84532    | `0x6140Da1f66fCafa0b5197065ae91A00208F3Cd86` | itself     | 1B      |
| `bscTestnet`       | 97       | `0x0d6a6F10adeCdc8a8b93aAc0Fa5210653de3511d` | itself     | 1B      |
| `robinhoodTestnet` | 46630    | `0x6F57844d0C6DCB7eB906d21C99195a3FC446E81D` | itself     | 1B      |
| `arcTestnet`       | 5042002  | `0xC0f8D36ec1D96477F26228A629a31248c584f477` | itself     | 1B      |

**Five homes, deliberately.** Each deployment passed its own chain id as
`homeChainId`, so each is its own issuer and each minted its own 1,000,000,000.
That is 5B nominal across the wave, and it is the right call for testnets and the
wrong one for mainnet. The reason is in `deploy-kld.js`'s own record note: there
is no bridge between testnets, and a satellite with no bridge is a zero-supply
token — `/stake` cannot be exercised, the faucet has nothing to hand out, and the
whole point of the testnet wave is that those paths get exercised. The same call
was already made for mock USDC.

So the starting position is not "KLD is single-chain and needs bridging". It is
"KLD is five unrelated tokens that share a symbol, and the mainnet shape is one
token on many chains". Those are different tokens by definition — a bridge cannot
link two independent issuers without one of them giving up issuance.

## 2. What the token already supports

`contracts/Token/KLD.sol` was written for this and needs **no changes**. The
three things that matter:

- **`BRIDGE_ROLE` mints without consuming cap headroom** (`KLD.sol:214-225`). A
  cross-chain transfer is not issuance: the tokens were counted against the cap
  at home and burnt there. A bridge holding `MINTER_ROLE` instead would eat real
  headroom on every inbound transfer and eventually wedge at a cap nothing had
  breached.
- **`MINTER_ROLE` cannot be granted off the home chain** (`_grantRole` override,
  `KLD.sol:237-245`, reverts rather than no-opping). This is the invariant most
  projects leave to operational discipline. It is the one whose failure is
  unrecoverable — a satellite that can issue is a second uncapped supply — so it
  is in code.
- **The cap counts cumulative mints, not `totalSupply()`** (`totalIssued`,
  `KLD.sol:139`). Under burn-and-mint, bridging the entire supply off the home
  chain drops `totalSupply()` to zero. A `totalSupply() + amount <= maxSupply`
  cap would hand back the full headroom and let a minter issue `maxSupply` twice.

`mint(address,uint256)` plus `burn(uint256)`/`burnFrom(address,uint256)` from
`ERC20Burnable` is exactly the surface a Wormhole NTT manager expects of a token
in **burning mode**, and also what a LayerZero OFT adapter expects. Making KLD
multichain is a role grant, not a token rewrite.

There is also a backstop worth naming because it constrains the design below: a
`BRIDGE_ROLE` mint still cannot push a chain's `totalSupply()` past the global
`maxSupply` (`KLD.sol:218-221`). It is not the cap; it bounds the blast radius of
a compromised bridge to "supply looks wrong on one chain" rather than "supply is
unbounded". It does mean the sum of bridged balances on any single chain is
ceilinged at 1B, which is not a real constraint while 1B is also the global total.

## 3. The target shape

```
                       ┌──────────────── Ethereum (home) ────────────────┐
                       │  KLD, homeChainId = 1                           │
                       │  MINTER_ROLE  → deployer at genesis, then       │
                       │                 MasterChef + YieldTreasury      │
                       │  BRIDGE_ROLE  → NttManager (this chain)         │
                       │  totalIssued  ≤ maxSupply, forever              │
                       └───────┬──────────────────┬──────────────────┬────┘
                               │ burn/mint        │                  │
                       ┌───────▼──────┐   ┌───────▼──────┐   ┌───────▼──────┐
                       │ Base         │   │ BNB Chain    │   │ …            │
                       │ homeChainId=1│   │ homeChainId=1│   │ homeChainId=1│
                       │ BRIDGE_ROLE  │   │ BRIDGE_ROLE  │   │ BRIDGE_ROLE  │
                       │ no MINTER    │   │ no MINTER    │   │ no MINTER    │
                       │ totalIssued=0│   │ totalIssued=0│   │ totalIssued=0│
                       └──────────────┘   └──────────────┘   └──────────────┘
```

One home, N satellites, **burn-and-mint** on every leg. Not lock-and-mint: a
locking hub makes the hub's escrow balance the single point of loss for every
chain at once, and it makes the satellites' KLD a claim on a bridge rather than
KLD. Burn-and-mint keeps `Σ totalSupply()` across chains equal to
`totalIssued − burns`, which is a property that can be monitored and alarmed on.

`totalIssued = 0` on every satellite is not a bug to explain away; it is the
observable form of invariant 2. Anyone can read it and confirm the satellite has
never issued.

## 4. Which bridge, and why

**Wormhole NTT, burning mode.** Three reasons, in order of weight:

1. **The token keeps its own contract and its own roles.** NTT in burning mode
   calls `mint`/`burn` on a token we deployed and control. The alternative shapes
   either wrap (a second token, so a second address per chain and a permanent
   liquidity split) or require the token to inherit the bridge's base contract
   (LayerZero's `OFT`), which would mean redeploying KLD as a different contract
   and giving up `AccessControl` for `Ownable`.
2. **`@wormhole-foundation/sdk` is already a dependency**
   (`smart-contract/package.json`, `^1.14.0`, installed). Nothing else is:
   `node_modules` contains no `layerzero`, no `native-token-transfers`, no
   Axelar, no CCIP, no Hyperlane. That is not decisive on its own, but it means
   the client-side integration and the chain tables below are already vendored.
3. **Rate limits are first-class in NTT**, per chain and per direction, settable
   after deploy. On a token with a fixed cap this is the difference between a
   bridge bug costing a day's outbound limit and costing the supply.

What would change the answer: if KLD needs to reach a chain Wormhole does not
support and LayerZero does, the OFT path becomes worth its cost for that chain
specifically. Both can coexist — two managers, two `BRIDGE_ROLE` grants — at the
cost of two accounting surfaces to monitor, so it is a last resort, not a hedge.

**The NTT manager contracts are not in this repository.** They live in
`wormhole-foundation/native-token-transfers` and are a separate dependency to
add. The token side needs nothing; the manager side is entirely new code to
vendor, and it must be vendored at a pinned tag, not tracked.

## 5. Chain coverage — the part that decides the rollout

Queried from the SDK's own tables rather than assumed:

```bash
cd smart-contract && node -e "
const wh = require('./node_modules/@wormhole-foundation/sdk-base/dist/cjs/index.js');
for (const id of [1, 11155111, 8453, 84532, 56, 97, 4663, 46630, 5042002]) {
  const hit = wh.chains.find(c => {
    try { return wh.nativeChainIds.platformNativeChainIdToNetworkChain('Evm', BigInt(id))?.[1] === c; }
    catch { return false; }
  });
  console.log(id, '->', hit ?? 'NOT KNOWN TO WORMHOLE');
}"
```

| chain                       | id       | Wormhole    | core bridge (Testnet)                        |
| --------------------------- | -------- | ----------- | -------------------------------------------- |
| Ethereum / Sepolia          | 1 / 11155111 | `Ethereum` / `Sepolia` | `0x4a8bc80Ed5a4067f1CCf107057b8270E0cC11A78` |
| Base / Base Sepolia         | 8453 / 84532 | `Base` / `BaseSepolia` | `0x79A1027a6A159502049F10906D333EC57E95F083` |
| BNB Chain / BSC testnet     | 56 / 97  | `Bsc`       | `0x68605AD7b15c732a30b1BbC62BE8F2A509D74b4D` |
| Robinhood Chain / testnet   | 4663 / 46630 | **none**    | —                                            |
| Arc Testnet                 | 5042002  | **none**    | —                                            |

Relayer addresses exist for all three supported testnets
(`0x7B1bD7a6b4E61c2a123AC6BC2cbfC614437D0470`,
`0x93BAD53DDfB6132b0aC8E37f6029163E63372cEE`,
`0x80aC94316391752A193C1c47E27D382b507c93F3`), so the automatic-delivery path is
available and users do not have to submit VAAs by hand.

**Two of our five chains have no Wormhole coverage at all**, on testnet or
mainnet. Robinhood Chain and Arc are not in Wormhole's chain set. That much is
verified above; whether LayerZero covers either is **not** checked here, because
no LayerZero package is installed to query and a marketing page is not a
verification — check it against their deployed-endpoints table before treating
either chain as reachable by that route. Assume no coverage until then, which
leaves exactly three honest answers:

- **(a) KLD is simply not on those chains.** Lending, the DEX, the stablecoin and
  the faucet all work there without KLD; staking and farming do not. The app
  already handles this correctly with no changes —
  `stakingContracts(chainId).supported` is false where the addresses are absent,
  and `/stake` refuses by name rather than throwing.
- **(b) Wait for coverage and ship those chains later.** Both are new chains and
  both are the kind that get Wormhole support once they matter; neither is a
  chain we can accelerate.
- **(c) Run our own attestation for those legs.** A `BRIDGE_ROLE` grant to a
  manager we operate, with our own guardian. This is a custodial bridge wearing a
  trustless bridge's clothes and it should be written down as such: it makes the
  Kaleido multisig the sole attester of supply on those chains. Not recommended,
  and listed only so nobody proposes it later as though it were free.

**Recommendation: (a) now, (b) as coverage lands.** KLD ships on Ethereum, Base
and BNB Chain, and Robinhood and Arc get the protocol without the token. Say it
plainly in the docs rather than leaving users to discover a missing /stake.

## 6. What has to be built

Ordered by dependency. Nothing here touches `KLD.sol`.

### 6.1 Satellite mode in `deploy-kld.js` — mostly already there

The script is already written for this, which is worth stating precisely because
it changes the size of step 1 from "build satellite mode" to "close two gaps in
it". Read from `scripts/deploy-kld.js`:

```js
const homeChainId = Number(process.env.KLD_HOME_CHAIN_ID || chainId);   // :213
const isHome = homeChainId === chainId;                                 // :216
```

and `isHome` is threaded through the three places it has to be:

- **The genesis mint is skipped** (`:427`), printing "satellite chain: supply can
  only arrive by bridge" instead. This matters more than it looks: on a satellite
  `remainingIssuance()` is 0, so the `ensure("mint", …)` guard would consider the
  mint already done and pass silently — the explicit branch is what keeps the
  record honest rather than recording a mint that never happened.
- **The faucet fund and `setDrip` are skipped** (`:449`). A satellite has no stock
  to transfer, and listing an asset the faucet cannot pay is a claim button that
  reverts. Funding it has to happen *after* the first bridge in, from bridged
  supply — which makes it a step in §6.4, not in the deploy.
- **The record states which it is** — `config.isHomeChain`,
  `config.mintedToDeployer: "0"` and a `note` that differs by role (`:276-286`).

So deploying a satellite today is one env var:

```bash
KLD_HOME_CHAIN_ID=11155111 npx hardhat run scripts/deploy-kld.js --network baseTestnet
```

Two gaps remain, and both are real:

- **Nothing asserts the satellite cannot issue.** The constructor argument is
  read back (`:345-350` compares `maxSupply()` and `homeChainId()`), which proves
  the *intent* landed, but not the consequence. The check worth spending a call on
  is the consequence: `hasRole(MINTER_ROLE, deployer) === false`, plus a
  `staticCall` on `grantRole(MINTER_ROLE, deployer)` expected to revert with
  `IssuanceIsHomeChainOnly`. A satellite that can mint is the one failure that is
  unrecoverable, and it should be ruled out positively rather than inferred.
- **`KLDVaultV2` and `StKLD` are still deployed on a satellite.** Nothing gates
  steps 2–5 on `isHome`, so a satellite gets a full staking set wired to a token
  with zero supply. That should be gated, for a reason that is not just tidiness:
  the vault pays rewards from a `yieldTreasury` and a second vault on a second
  chain is a second independent exchange rate, so stKLD from one chain is not
  stKLD from the other. Staking stays on the home chain until there is a reason
  for it not to be, and the frontend already expresses that — `supported`
  requires all three addresses, so a satellite with only `kld` recorded shows KLD
  in the token pickers and no `/stake`.

A `"role": "home" | "satellite"` field on the record is worth adding alongside,
so `gen-registry.mjs` and any later audit can tell them apart without inferring
it from `config.isHomeChain`.

### 6.2 The NTT manager, per chain

Vendor `native-token-transfers` at a pinned tag. Per chain: an `NttManager` in
**burning** mode pointed at that chain's KLD, plus a `WormholeTransceiver`
pointed at that chain's core bridge and relayer (§5). Then:

```
kld.grantRole(BRIDGE_ROLE, nttManager)     // on every chain, home included
manager.setPeer(otherChain, otherManager, decimals, inboundLimit)   // both directions
manager.setOutboundLimit(...)              // per chain
```

`setPeer` is the step that must not be got wrong: an unset peer means transfers
are rejected (safe), a *wrong* peer means transfers are accepted from an address
that is not our manager (not safe). It is also symmetric — both sides must name
each other — so the wiring is O(n²) in chains and belongs in a script with a
read-back, exactly as the diamond's facet cuts do.

The home chain gets `BRIDGE_ROLE` too. Outbound transfers from home burn, and
inbound returns mint — the manager needs both on every chain including the issuer.

### 6.3 Rate limits, chosen rather than defaulted

NTT's limits are per chain and per direction, in token units, with a 24h refill.
They are the only mechanism that bounds a bridge bug, so leaving them at whatever
the deploy script defaults to is a decision made by accident. Starting point,
against a 1B cap:

| leg                    | outbound / 24h | rationale                                                        |
| ---------------------- | -------------- | ---------------------------------------------------------------- |
| home → any satellite   | 10,000,000     | 1% of supply. Enough for real liquidity provisioning, small enough that a full-limit loss is survivable. |
| satellite → home       | 10,000,000     | Symmetric, so a satellite cannot become a one-way sink.          |
| satellite → satellite  | disabled       | Route through home. Fewer peer pairs to wire and monitor, and every transfer touches the chain that owns issuance. |

These are testnet-appropriate figures to be revisited before mainnet against
actual float, not constants to carry forward unexamined.

### 6.4 Testnet migration — the part with a real cost

The current five-home wave cannot demonstrate a bridge, because five issuers are
five tokens. Proving the mainnet shape on testnet means at least one pair of
chains where one is a genuine satellite of the other. The honest version:

1. **Sepolia stays home.** It already is, and it is the chain with the deepest
   testnet tooling.
2. **Redeploy KLD on Base Sepolia and BSC testnet as satellites** of 11155111.
   New addresses; the existing ones become dead records. `gen-registry.mjs`
   regenerates and the frontend follows with no code change.
3. **Cost, stated rather than buried:** each satellite starts at zero supply. The
   faucet on those chains holds 5,000,000 KLD of the *old* token, which the new
   token knows nothing about — so faucet claims and `/stake` on Base Sepolia and
   BSC testnet are dead between step 2 and step 4. `KLDVaultV2` and `StKLD` are
   not redeployed there at all under §6.1, so `/stake` on those two chains is
   gone for good, by design.
4. **Bridge 5,000,000 KLD from Sepolia to each satellite and refund the
   faucets from bridged supply.** This is the step that makes the exercise worth
   its cost: it proves burn-at-home, attest, mint-at-satellite, and it proves the
   faucet works against bridged supply — which is the exact mainnet path for
   getting KLD onto a satellite in the first place.
5. **Leave Robinhood and Arc as they are**, self-homed, and note it. They are not
   part of the bridged set and cannot be; a self-homed KLD there is strictly more
   useful for exercising staking than a satellite that can never receive supply.

Alternative considered and rejected: keep all five homes and prove the bridge on
a throwaway pair of chains. It avoids the dead-faucet window, and it also avoids
proving anything about *our* deployment — the thing that goes wrong at mainnet is
the wiring of the real addresses, and a scratch pair does not exercise that.

### 6.5 Monitoring the invariant

The property that must hold across all chains:

```
Σ totalSupply(chain)  ==  totalIssued(home) − Σ burns
```

Nothing enforces this — no contract can see another chain's supply. It has to be
measured, and it is the only signal that distinguishes a healthy bridge from one
minting supply nobody sent. A keeper reading `totalSupply()` on every chain and
`totalIssued()` at home, on a schedule, alarming on divergence. The pattern is
already in the repo twice (`.github/workflows/price-keeper.yml`,
`push-watcher.yml`), so this is a third instance of a shape that works rather
than new infrastructure.

Divergence is expected transiently — a transfer is burnt before it is minted, so
the sum dips for as long as attestation takes. The alarm is on divergence that
persists past a threshold, and on divergence in the *wrong direction* (sum above
issued), which is never legitimate and should page immediately.

## 7. What the frontend needs

**Almost nothing, and that is worth checking rather than assuming.** Nothing in
`src/` reads `remainingIssuance`, `totalIssued`, `isHomeChain`, `maxSupply` or
`BRIDGE_ROLE`:

```bash
grep -rn "remainingIssuance\|totalIssued\|isHomeChain\|maxSupply\|BRIDGE_ROLE" src/ --include=*.ts --include=*.tsx
```

returns nothing today. Satellite-ness is invisible to the app: KLD is an address
in `DEPLOYMENTS`, read through `ownTokens`, and a satellite's KLD is the same
ERC20 from the app's point of view. Balances, transfers, approvals and the token
pickers all work unchanged.

What is genuinely new, when the bridge lands:

- **A bridge UI**, or a link out to Wormhole Connect. `stakingContracts` has no
  equivalent yet — a `bridgeContracts(chainId)` reading a new `nttManager` field
  in `ChainContracts`, gated the same way, with the same "not available on this
  chain" refusal for Robinhood and Arc.
- **`prices.ts` stays as it is.** KLD is UNPRICED because there is no market
  before TGE; that is unaffected by which chains it exists on, and every
  consumer already handles a null USD figure (`auditor.ts:219`,
  `bookValue.ts:183`, `spot.ts:26`).
- **The auditor already covers every chain's KLD.** `protocolAddresses` folds
  `kld`, `kldVault` and `stKLD` for every entry in `DEPLOYMENTS`, labelled with
  the chain when it is not the active one, so a send to a satellite's KLD is
  described as such rather than as an unknown address.

## 8. Sequence

| # | step                                                    | blocked by |
| - | ------------------------------------------------------- | ---------- |
| 1 | Close the two gaps in satellite mode (§6.1): cannot-issue read-back, and gate the vault/stKLD deploy on `isHome` | — |
| 2 | Vendor `native-token-transfers` at a pinned tag          | — |
| 3 | Redeploy Base Sepolia + BSC testnet as satellites of Sepolia (`KLD_HOME_CHAIN_ID=11155111`) | 1 |
| 4 | Deploy `NttManager` + `WormholeTransceiver` on the three chains | 2, 3 |
| 5 | `grantRole(BRIDGE_ROLE)`, `setPeer` both directions, rate limits, with read-back | 4 |
| 6 | Bridge 5M Sepolia → each satellite; refund both faucets from bridged supply | 5 |
| 7 | Supply-invariant keeper (§6.5)                           | 6 |
| 8 | Bridge UI or Connect link, `bridgeContracts(chainId)`    | 5 |
| 9 | Mainnet: single home on Ethereum, satellites on Base and BNB Chain | 6, 7 |

Steps 1–2 are independent and can run in parallel. Step 9 is the only one that
needs the multisig to hold `DEFAULT_ADMIN_ROLE` first — the same handover the
Robinhood price feeds need, and for the same reason.

---

## Decisions this document makes

Recorded so they are arguable rather than assumed:

1. **Burn-and-mint, not lock-and-mint.** No escrow to be the single point of loss;
   satellite KLD is KLD, not a claim on a bridge.
2. **Wormhole NTT over LayerZero OFT.** The token keeps its contract and its
   `AccessControl` roles; OFT would mean redeploying KLD as a different contract.
3. **One home on mainnet, five homes on testnet.** Already made and already in
   the code; restated because the testnet shape looks like a mistake and is not.
4. **Robinhood and Arc get the protocol without KLD.** Neither is in Wormhole's
   chain set, and running our own attestation for them would
   make the multisig the sole attester of supply on those chains.
5. **Staking stays home-chain only.** A second vault is a second exchange rate
   and a split pool; stKLD from one chain is not stKLD from the other.
6. **Satellite → satellite transfers disabled.** Every hop touches the issuer, so
   there are n peer pairs to wire and monitor rather than n².
