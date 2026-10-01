# Admin actions through the Safe

The lending diamond, its price oracle and the limit-orders contract on Arc mainnet are owned by one
Safe (`0x4c72B4799d374D2Ad9a8C9716766f8325808B94F`). Every admin action — a pause, a contract
upgrade, a router allowlist change, a change of signers — is a transaction **from the Safe**.

`smart-contract/scripts/safe-tx.js` prepares those transactions. It is **read-only**: it sends
nothing and needs no private key. It reads the chain, checks the action makes sense, and writes
two files to `smart-contract/safe-txs/` (git-ignored):

| File | Use |
| --- | --- |
| `<time>-<action>.json` | A batch for the Safe web app's **Transaction Builder** |
| `<time>-<action>.md` | The **review card**: what it does, the target, the decoded call, the exact calldata, and the Safe transaction hash the signers' devices show |

It works the same with one signer or many. That is the point: when the second signer exists, nothing
about preparing a transaction changes — only who signs it.

## Make a transaction

```bash
cd smart-contract
ACTION=pause npx hardhat run scripts/safe-tx.js --network arcMainnet
```

| Action | Variables | What it does |
| --- | --- | --- |
| `pause` / `unpause` | — | Stops / re-opens NEW loans, listings, fills, draws (repay, withdraw, liquidation always work) |
| `facet-upgrade` | `NEW_FACET`, `[FACET=ProtocolFacet]` | A pure Replace of what the live facet serves. Deploy the facet first (any wallet can). Also writes `…-ROLLBACK.json` |
| `set-aggregator` | `AGGREGATOR`, `ALLOWED=true\|false`, `[TARGET]` | The router allowlist for limit-order fills |
| `set-filler-fee` | `BPS`, `[TARGET]` | The filler fee (the contract caps it) |
| `set-token-feed` | `TOKEN`, `FEED_ID` | Re-points a token's price feed |
| `set-feed-max-age` | `FEED_ID`, `MAX_AGE` | How old a price may be |
| `accept-ownership` | `[TARGET]` | The Safe accepts a nominated ownership |
| `transfer-ownership` | `TARGET`, `NEW_OWNER` | Nominates a new owner (two-step) |
| `safe-add-owner` | `NEW_OWNER`, `THRESHOLD` | Adds a signer |
| `safe-remove-owner` | `OWNER`, `THRESHOLD` | Removes a signer |
| `safe-swap-owner` | `OLD_OWNER`, `NEW_OWNER` | Replaces a signer |
| `safe-change-threshold` | `THRESHOLD` | Changes how many signers must approve |
| `call` | `TARGET`, `SIGNATURE="fn(type)"`, `ARGS='[…]'` | Any other call |
| `raw` | `TARGET`, `DATA=0x…` | Raw calldata (nothing checked — verify it with whoever made it) |

`[TARGET]` defaults to the live Arc mainnet contracts. It refuses what would lock the Safe for ever
(a threshold above the number of signers), a facet swap that is not a pure Replace, a facet whose
on-chain code is not the build in your checkout (`ALLOW_CODE_MISMATCH=1` overrides, deliberately), and a
target with no contract code.

## Sign it

1. Open **app.safe.global**, connect, choose the Safe, then **Apps → Transaction Builder**, drop the
   `.json` in, **Create batch → Send batch**.
2. Each signer opens the pending transaction and compares **To**, the function and arguments with the
   review card. On a hardware wallet, the **Safe transaction hash** shown on the device must equal the
   one on the card. Sign only if they match.
3. When the threshold is reached, anyone presses **Execute**.

If the Transaction Builder import misbehaves: **New transaction → Custom data** and paste **To**, value
`0` and the calldata from the card. (The hash on the card is for the Safe's *current* nonce; if the app
shows another nonce, re-run the tool.)

## Adding the second signer (when the hardware wallet arrives)

Do it in this order, so you can never lock yourself out:

1. **Get the new signer's address from the device itself** (never typed in from a message).
2. `ACTION=safe-add-owner NEW_OWNER=0x… THRESHOLD=1` → sign it. Both signers can now act alone.
3. **Prove the new signer works**: have it approve something harmless in the Safe app (a `pause` then
   `unpause` of the lending market is a good test).
4. `ACTION=safe-change-threshold THRESHOLD=2` → sign it. Now two signers must approve everything.
5. Only after that consider retiring the old deployer key: `safe-swap-owner` it for a second hardware
   wallet or another person's, then remove the key from `smart-contract/.env`.

**At threshold 2 the single-signer scripts stop working** (`safe-exec.js`,
`upgrade-facet-via-safe.js`, `handover-orders-to-safe.js` — they sign as one owner). Use this tool and
the Safe app instead; the review card replaces their built-in checks.

## Upgrading a contract through the Safe

1. Deploy the new facet from any funded wallet (the deployer works).
2. `ACTION=facet-upgrade NEW_FACET=0x…` — read the card (the on-chain code must equal your build).
3. Sign and execute. Keep the `…-ROLLBACK.json` file: signing it puts the old code back in one step.

## How it was tested

`scripts/test-safe-tx-fork.js` runs every action on an anvil fork of Arc mainnet: it generates each
transaction with the real tool, executes it through the live Safe using the hash printed on the card
(each signer pre-approves that exact hash, which only works if the card's hash equals the Safe's own),
and checks the effect — including a real 2-of-2 flow (one signature is refused, two succeed), the
upgrade and its rollback, and every guard rail. 32 checks.

Not tested: importing the `.json` into the Safe web app itself (it needs a connected wallet). The
file follows the Transaction Builder format; if the import is refused, use Custom data above.
