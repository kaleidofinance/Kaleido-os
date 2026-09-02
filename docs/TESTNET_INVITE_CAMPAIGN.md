# Testnet invite campaign

Sending the access code to the 3,000+ people who registered on the form. The
promise made publicly was that **every registrant receives the code**, so this is
fulfilling a commitment rather than running a marketing send — which is why the
email below is four sentences and a link rather than a pitch.

Read `docs/KEEPER_SCHEDULING.md` first. Two of the three pre-flight blockers are
closed; the keeper is the one that still needs action outside this repository, and
sending before it is scheduled points 3,000 people at a protocol whose prices go
stale within the hour.

## Where things stand

| | State |
| --- | --- |
| Faucet capacity | **Done.** 12h cooldown on all five chains; Sepolia serves 2,992, Robinhood 2,996, Base Sepolia 2,998, BSC 3,000. Re-check with `npm run verify:faucet -- 3000`. |
| Agent | **Verified working** end to end in production through the Cloudflare relay. Quota is 25 requests/day per wallet, and it refuses entirely without a connected wallet. |
| Keeper | **Blocked on three manual steps** — see the runbook. Do not send until `?dryRun=1` returns `wouldPush > 0` in production. |
| Arc Testnet | **Do not steer anyone there.** 34 users of faucet capacity, and its oracle is down on the Hermes 401. It stays listed in the app because it is deployed; it is simply not where a new user should start. |
| Gas drip | `/api/gas-drip` is off in production (`GAS_DRIP_PRIVATE_KEY` unset), by decision. The zeroth-transaction wall is handled by the external faucet links `/faucet` already renders per chain. |

**Recommend Base Sepolia in the email.** Highest faucet capacity, a working
third-party oracle so it does not depend on our keeper at all, negligible gas, and
the easiest public gas faucet to reach. Steering belongs in the email, not in the
docs — `/docs/getting-started` correctly describes all five networks.

## 1. The list

Google Forms → Responses → **Link to Sheets** → File → Download → CSV.

**The CSV never enters this repository.** It is public, and a committed export of
3,000 addresses is a breach that a force-push does not undo: the objects stay
reachable and forks keep their own copies. `.gitignore` now refuses `*.csv`,
`*.tsv`, `*.xlsx` and `campaign-list*` for exactly this reason, but the safe habit
is to keep the file somewhere outside the working tree entirely and pass its path.

Then clean it, in this order:

1. **Lowercase and trim.** Form entries carry stray whitespace and mixed case.
2. **Deduplicate.** People submitted twice. Sending twice reads as a mistake and
   costs you complaints on a list you cannot afford complaints on.
3. **Drop syntactically invalid addresses.** Every one is a guaranteed hard bounce,
   and hard bounces are what providers score you on.
4. **Drop role addresses** — `admin@`, `info@`, `support@`, `noreply@`. They are
   shared inboxes and disproportionately generate complaints.
5. **Keep the raw file.** Every step above is reversible only if you did not
   overwrite the export.

`npm run campaign:send -- --list <path>` does all five and reports the counts
without sending anything, because **dry run is the default and `--send` is the only
thing that changes it.** Run it before you have an API key — the point is to see how
many addresses survive.

It finds the email column by looking for `email` in the header, and if the form
named that column after the question instead, falls back to whichever column
actually contains the most addresses. Check the reported count against what the form
says it collected; a much smaller number means it picked the wrong column.

### What the real export measured

Run against the 2026-09-02 download of the whitelist form:

| | |
| --- | --- |
| Registrations | 3,165 |
| Address found in another column | 32 |
| Unusable | **0** |
| Role addresses | 0 |
| Duplicates | 88 |
| **Deliverable** | **3,077** |

**Nobody on the form is unreachable.** That is worth stating because the first pass
said 32 people were: they had put their address in the form's *Username* field and
answered the email question with "yes", "ok", or a wallet address. The two questions
are adjacent and Username is asked first, so they answered it with the thing they
were about to be asked for. `campaign:send` now reads the rest of the row before
giving up on anyone — only cells that are *entirely* an address, and only when the
row offers exactly one, so a free-text answer mentioning some other address cannot
be mistaken for the registrant's.

Two consequences worth knowing:

- **99.8% of the list is `gmail.com`** — 3,072 of 3,077. Deliverability here is not a
  general question, it is a question about one provider. Gmail is the strictest of
  them about authentication and about volume from a domain with no history, so DKIM
  alignment and the warm-up below are the campaign, not precautions around it.
- **About six addresses are typo'd but syntactically valid** — misspellings of
  `gmail.com` that a person can see and a regex cannot, plus four on one near-miss of
  `hotmail.com`. They are left alone deliberately: correcting an address means mailing
  someone who did not enter it, and `gmail.co` and `mail.com` are both real domains,
  so the rule that fixes the obvious ones also breaks the legitimate ones. Six hard
  bounces in 3,077 is 0.2%, well under the 5% that stops the send.

There is also a cluster worth a look before anything is *paid out*, though it does
not affect the email: four unusual shared domains account for 24 registrations
between them, in runs of 8, 7, 5 and 4. Distinct addresses on a domain nobody else
uses is what one person entering repeatedly looks like, and the form promised
"rewards & whitelisting". Mailing them costs nothing; rewarding them as 24 separate
people would. The domains are not named here because this repository is public and
the pattern is a suspicion rather than a finding — regenerate it from the export
with a group-by on the domain.

## 2. Sending identity

The domain `kaleidofi.xyz` is already owned, so **nothing needs registering.** What
is needed is DNS records authorising a sending service, and — separately, and only
if replies should reach a human — a mailbox.

> **Do not send 3,000 messages through a Workspace or Zoho mailbox.** Those are
> personal mailboxes with recipient caps around 2,000/day and terms that prohibit
> bulk sending. It will be throttled, and it puts the mailbox at risk. A mailbox is
> for receiving replies; sending is a separate service.

**Use Resend, on the $20/month tier.** 50,000 emails a month, no daily cap, and no
approval queue. Amazon SES is far cheaper for this volume — about $0.30 — but new
accounts start in a sandbox that can only mail verified addresses, and leaving it
requires a review that asks how the list was collected. That review is answerable
and it is also a wait with a rejection risk, positioned immediately before a send
you have publicly committed to. Pay the $20 this once; move to SES later if these
sends become routine.

Three DNS records, from the provider's dashboard:

- **SPF** — `TXT` authorising the service's servers.
- **DKIM** — the `CNAME` records the provider generates. This is what actually
  signs the mail; skip it and Gmail will not accept the message as authenticated.
- **DMARC** — `TXT` at `_dmarc.kaleidofi.xyz`, starting at
  `v=DMARC1; p=none; rua=mailto:dmarc@kaleidofi.xyz`.

Start DMARC at `p=none`, not `p=reject`. `none` still delivers the aggregate
reports that tell you whether your own mail is passing; tightening to `quarantine`
or `reject` before you have read a single report is how a campaign discovers a
misconfigured DKIM key by having every message rejected.

Send from the **root domain** as `official@kaleidofi.xyz`, as decided. The usual
advice is a `send.` subdomain to isolate reputation, and that is right for ongoing
bulk — but here the anti-phishing step below depends on the From address being one
recipients recognise from the website, and an unfamiliar subdomain undercuts it.
This is one opt-in send to people who asked for it, not a cold list.

Set a real `Reply-To` that someone reads. Three thousand people are about to have
questions, and a bouncing reply address is the fastest way to earn complaints.

Four variables, read from `.env` or the environment by `campaign:send`. None of them
belong in a committed file:

| Variable | |
| --- | --- |
| `RESEND_API_KEY` | Required for `--send`. A dry run does not need it. |
| `BETA_ACCESS_CODE` | Must be **the value production is running**, or recipients get a code the gate rejects. |
| `CAMPAIGN_FROM` | Defaults to `Kaleido <official@kaleidofi.xyz>`. |
| `CAMPAIGN_REPLY_TO` | Defaults to `official@kaleidofi.xyz`. Also where opt-outs land. |

## 3. Announce the From address before you send

Post on X, **before the first batch**, naming the exact address the email will come
from and stating that Kaleido will never ask for a seed phrase or a private key.

Three thousand people expecting an email containing an access code is a phishing
opportunity, and it is a predictable one: the form was public, the promise was
public, and the timing is now known. The single cheapest defence is that the real
From address was published first, by you.

## 4. Warm-up, and the numbers that stop the send

The domain has no sending history. Three thousand messages in one burst from a cold
domain is the textbook spam signal, and the cost of getting it wrong is not a
bounced batch — it is the domain's reputation, which the app also uses.

Send over four days, largest batch last:

| Day | Batch |
| --- | --- |
| 1 | 200 |
| 2 | 500 |
| 3 | 1,000 |
| 4 | the rest |

After every batch, check the provider dashboard and **stop** if either threshold is
crossed:

- **Hard bounces above 5%** — the list is dirtier than step 1 caught. Stop and
  re-clean; continuing gets the domain blocked, not just throttled.
- **Spam complaints above 0.1%** — that is 1 in 1,000. Above it, providers begin
  filtering the domain rather than the message, and no later batch recovers.

**Both of these are checks you perform, not checks the script performs.** Bounces
and complaints arrive hours later by webhook, and there is no webhook here, so
`campaign:send` cannot see them — a clean exit is not evidence that a batch landed
well. What it does enforce is the failure rate the provider reports *at send time*,
which is essentially rejected recipients: above 5% of a batch it stops rather than
carrying on. Everything asynchronous is read off the dashboard between batches.

Every message carries a `List-Unsubscribe` header pointing at the reply-to mailbox,
so an opt-out arrives as a mail you can act on rather than as a complaint. It is
deliberately not the one-click `List-Unsubscribe-Post` variant: that requires an
HTTPS endpoint to POST to, no unsubscribe route exists to point at, and a header
promising one-click that then fails is worse than the mailto — it surfaces a button
in Gmail that does nothing. If these sends become routine, build the route and
upgrade the header.

## 5. The email

Short on purpose. The code and one link are the entire payload; everything a reader
might want after that is on the page the link goes to, which is ungated.

Subject:

```
Your Kaleido testnet access code
```

Body:

```
You registered for the Kaleido private testnet. Here is your access code.

    {{ACCESS_CODE}}

Open https://kaleidofi.xyz/trade/agent and enter it once. It is remembered
on that browser afterwards.

Start on Base Sepolia — it is the fastest of the five networks to get funded
on. The first ten minutes, step by step:
https://kaleidofi.xyz/docs/getting-started

The part worth trying first is Luca. Connect your wallet, then tell it what
you want in plain language — "swap 50 USDC for ETH", "lend 100 USDC at 8%" —
and it builds the transactions for you to sign. It needs a connected wallet
before it will do anything, so connect first.

— The Kaleido team
official@kaleidofi.xyz
```

Notes on the wording, each of which is load-bearing:

- **The copy that actually sends lives in `scripts/send_campaign.mts`**, in both a
  plain-text and an HTML part. The block above is a readable copy for review; if the
  two ever disagree, the script is what recipients get. Read it back with a dry run
  rather than trusting this page.
- **`{{ACCESS_CODE}}` is a placeholder here and stays one.** The real code is a
  production environment variable and this file is in a public repository. The
  sender substitutes it at runtime from `BETA_ACCESS_CODE`, through the gate's own
  `normaliseCode`, and refuses to run if the result is not `CODE_LENGTH` characters —
  so an unset or truncated variable stops the send instead of mailing 3,000 people a
  code the card cannot accept.
- **`/trade/agent`, not `/`.** The landing page is ungated, so a recipient who
  lands there has nowhere to type the code and no reason to think they need to.
  The gate is on the app routes.
- **"Connect your wallet, then"** — the agent returns a refusal without a
  connected wallet, because quota is metered per address. Someone who tries Luca
  first sees the flagship feature appear broken on first contact.
- **No "beta", "demo", "preview" or "coming soon".** It is live and it works.
- **The code is shown as text, not as a link.** A link containing the code trains
  people to click links in emails that contain access codes.

## 6. Send day

1. `npm run verify:faucet -- 3000` — expect the four campaign chains at 2,992+.
2. `curl` the keeper with `?dryRun=1` and confirm `wouldPush > 0`. If it 503s, the
   keeper is unarmed; stop here.
3. Confirm `/api/chat` still answers with a live provider.
4. Post the anti-phishing note on X.
5. `npm run campaign:send -- --list <path>` and read the counts. Nothing sends —
   dry run is the default. Read the copy it prints, including the code.
6. Add `--send --limit 200`. Wait. Check bounces and complaints on the dashboard.
7. Repeat for each batch, raising `--limit`. The state file sits beside the list and
   makes the run resumable, so no address is ever sent to twice — keep it.

## After the send

**The access code will be public within about a day** — 3,000 people will have it
and one will post it. That was a deliberate trade and it is the correct one for a
testnet, but it means the faucet is now the exposed surface rather than the gate.

Watch it, and treat the drip and the cooldown as the controls they are:

```bash
npm run verify:faucet -- 3000
```

If an asset drains faster than real users could account for, tighten the ratio
rather than refilling — `npm run faucet:cooldown -- 24h --send` or
`npm run faucet:drip -- <SYMBOL> <smaller> --send`. Refilling a faucet that is
being scripted just funds the script.
