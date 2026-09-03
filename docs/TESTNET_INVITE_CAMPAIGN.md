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
| Faucet capacity | **12h cooldown on all five chains, and ~80 users short of the real list.** Re-measured 2026-09-03 against the true deliverable count rather than a round 3,000: BSC serves 3,000 (bound by mock USDC), Base Sepolia 2,998 (ETH), Robinhood 2,996 (WETH), Sepolia 2,992 (WETH) — against **3,077 deliverable**. Not a send blocker at realistic claim rates, but the shortfall lands on whoever claims last, which is the day-4 batch. Fix by minting where the bound asset is a mock we issue and by trimming the drip where it is real (WETH 0.005 → 0.004, Base ETH 0.01 → 0.009 clear it without funding). Re-check with `npm run verify:faucet -- 3077`. |
| Agent | **Verified working** end to end in production through the Cloudflare relay. Quota is 25 requests/day per wallet, and it refuses entirely without a connected wallet. |
| Keeper | **Done.** The Cloudflare Worker is now firing `*/15` on its own — measured 2026-09-02 23:39 UTC as two pushes 15m15s apart with no GitHub Actions run in that window — and Robinhood ETH sits at 640s against its 3,600s bound. The fires land ~13 minutes past the quarter hour, so judge it by the feed's age and not by watching a boundary. See `KEEPER_SCHEDULING.md`. |
| Email | **DNS complete, credential outstanding.** All four records verified 2026-09-03 from a public resolver, not the dashboard: DKIM `TXT` at `resend._domainkey`, `CNAME`s at `send` and `rsend`, and `_dmarc` now answering `v=DMARC1; p=none; rua=mailto:dmarc@kaleidofi.xyz`. The root SPF and the Zoho MX survived the edit, so replies still land. A dry run reproduces 3,077 deliverable exactly. Left: `RESEND_API_KEY` in `.env`, and the account is on Free (100/day, below the 200 batch floor). |
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

Every one of those rules lives in `src/lib/campaign/recipients.ts` rather than in the
script, with `npm run test:campaign` over it, because this is the code that decides
who receives the code and who silently does not — a rule that drops the wrong people
does not fail, it just reports a smaller number. The test carries the cases that
matter, including the 32 registrations an earlier version discarded.

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

- **98.1% of the list is `gmail.com`** — 3,017 of 3,077, across 26 distinct domains in
  total. Deliverability here is not a general question, it is a question about one
  provider. Gmail is the strictest of them about authentication and about volume from
  a domain with no history, so DKIM alignment and the warm-up below are the campaign,
  not precautions around it.
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

**Self-hosting an SMTP server was considered and rejected, and not because it is hard
to install.** Postfix plus OpenDKIM is an afternoon. The problem is that what a sending
service actually sells is **IP reputation**, and a brand-new IP has none — so a first
act of 3,000 near-identical messages carrying a code and a link is the exact shape
Gmail and Microsoft filter hardest. Three specifics make it worse than a general
warm-up problem:

- **We have nowhere to host it.** Vercel is serverless — no persistent daemon, no port
  25. Cloudflare Workers cannot do it either: outbound mail there goes through a
  `send_email` binding that requires the domain onboarded to Cloudflare's Email Service
  and caps a message at **50 recipients**, and this zone's DNS is at Namecheap anyway.
  Self-hosting therefore means provisioning, securing and monitoring a new VPS.
- **Most providers block outbound port 25 by default** — permanently on Google Cloud,
  by request form on AWS, off by default on DigitalOcean and Hetzner. That is the same
  approval-queue-before-a-committed-send risk that ruled out the SES sandbox, with the
  added need for a PTR/rDNS record matching the HELO name.
- **It does not remove any of the DNS work below**, it adds to it: SPF, DKIM and DMARC
  are still required, except now generating and rotating the DKIM key is ours to get
  wrong, and bounce and complaint handling becomes an MTA queue to read rather than a
  per-message error in a JSON response.

It would also mean rewriting the transport in `scripts/send_campaign.mts` — which posts
to a batch HTTP endpoint with a per-chunk idempotency key — into SMTP, discarding the
"never sends twice" guarantee on the one operation with no undo. Against $20 once,
cancellable after, on a domain whose reputation the app itself depends on, that is the
wrong trade. Revisit it only if these sends become routine, and warm a new IP over weeks
on a subdomain rather than on `kaleidofi.xyz`.

**The free tier cannot run this campaign, and the reason is the daily cap rather than
the monthly one.** Free allows 3,000 emails a month, which would just cover the list —
but it also allows **100 a day**, and the smallest batch in §4 is 200. Pro removes the
daily limit and raises the month to 50,000. Signing up is free, though, so the order
below defers the $20 to the last possible moment.

Nothing needs installing. `campaign:send` calls `https://api.resend.com/emails/batch`
with `fetch` and a bearer token — there is no SDK dependency to add.

1. **Sign up** at `resend.com`. No card at this stage.
2. **Domains → Add Domain → `kaleidofi.xyz`.** Not `send.kaleidofi.xyz`, for the reason
   under the record table below. Pick a **region** here: it is baked into the MX value,
   so changing it afterwards means editing DNS again.
3. Resend now shows three records. Add them, plus DMARC, per the table and the Namecheap
   notes below.
4. **Verify DNS Records** in Resend.
5. **API Keys → Create.** Give it **sending access only**, not full access, and scope it
   to this domain if offered — it is a credential that will sit in a `.env` on a laptop.
   The `re_…` value is shown once. It goes in `.env` as `RESEND_API_KEY`.
6. **Smoke test to your own address.** Only meaningful after step 4: until the domain
   verifies, Resend will send from `onboarding@resend.dev` to your own account address
   and nothing else.
7. **Upgrade to Pro** — before batch 1, not before step 6.
8. Dry run, then `--send --limit 200`.

**The zone is at Namecheap** (`dns1.registrar-servers.com` / `dns2.registrar-servers.com`),
not Cloudflare. Cloudflare hosts the Workers, not this domain — do not go looking for
the records there.

Resend's records went in on **2026-09-03** and all three verify. Measured from
Cloudflare's public resolver rather than read off the dashboard, because the dashboard
reports what it last checked and the resolver reports what a receiver will see:

| Record | Live value, measured 2026-09-03 | State |
| --- | --- | --- |
| root `TXT` (SPF) | `v=spf1 include:zohomail.com include:spf.privateemail.com ~all` | untouched, as intended |
| root `MX` | `mx.zoho.com` / `mx2` / `mx3` | intact — that is the reply mailbox |
| `resend._domainkey` `TXT` | `p=MIGfMA0GCSqGSIb3DQEB…` | **verified** — DKIM |
| `send` `CNAME` | `send.forge.rmta.net` | **verified** — sending |
| `rsend` `CNAME` | `rsend.forge.rmta.net` | **verified** — sending |
| `_dmarc` `TXT` | `v=DMARC1; p=none; rua=mailto:dmarc@kaleidofi.xyz` | **verified 2026-09-03** — parses as valid DMARC1 |

**Resend's sending records are two `CNAME`s, not the SPF `TXT` plus feedback `MX` that
an older version of this section predicted.** They delegate both halves into Resend's own
zone, which is why there are two of them and why the values contain no region:

- `send.kaleidofi.xyz` resolves through to `v=spf1 ip4:52.3.252.119 ip4:44.222.39.36
  ip4:199.249.231.0/24 ~all` and `MX 10 feedback.forge.rmta.net` — Resend's own MTA pool
  plus its bounce path.
- `rsend.kaleidofi.xyz` resolves through to `v=spf1 include:amazonses.com ~all` — the SES
  pool, kept as a second path.

Delegating by CNAME means Resend can rotate pool IPs without anyone editing this zone
again. It also means **nothing else may share those two names**: a CNAME cannot coexist
with a `TXT` or `MX` at the same owner name, so if a hand-written SPF `TXT` was ever added
at `send`, it has to be deleted before the CNAME will resolve.

Two things held from the earlier measurement and are worth keeping. **The root SPF must
not be touched**: it already carries two `include:` lookups for Zoho, SPF permits ten
before it `PermError`s, and Resend needs none there — its SPF lives on the `send.`
envelope domain while the visible `From:` stays on the root. Both still align under DMARC's
default relaxed rules, because envelope and header share the organizational domain. And
**DKIM here is a `TXT` at `resend._domainkey`, not a `CNAME`** — CNAME-style DKIM is what
SES and Postmark hand out, so a Namecheap form filled in as a CNAME silently fails.

`_dmarc` was the last row to land and it now answers. It is the record that lets a
receiver tell a forged `official@kaleidofi.xyz` from the real one, on the domain that is
about to mail 3,000 people an access code — the technical half of §3. Resend labels it
Optional, which it is for Resend and is not for this campaign.

**A sending-scoped Resend API key is the ability to send as `official@kaleidofi.xyz`**,
which is precisely the impersonation §3 warns recipients about. Treat it accordingly: it
belongs in `.env` and nowhere else — not in a shell command, where it lands in history,
and not pasted into a chat or an issue. If it is ever exposed, deleting the key in the
dashboard is instant and free, so rotate rather than reason about how bad the exposure was.

### Entering them in Namecheap

**In Resend, add the domain as `kaleidofi.xyz` — not `send.kaleidofi.xyz`.** Resend then
generates records *on* the `send.` subdomain, which is the Return-Path (envelope sender),
not the From address. Adding the subdomain as the domain instead forces every message to
come from `@send.kaleidofi.xyz`, which breaks the whole premise of §3: recipients were
told to expect the address they already know from the site.

Namecheap → Domain List → **Manage** → **Advanced DNS**. Four rows, three of them copied
from the dashboard:

| Type | Host | Value | Priority |
| --- | --- | --- | --- |
| CNAME Record | `send` | `send.forge.rmta.net` | — |
| CNAME Record | `rsend` | `rsend.forge.rmta.net` | — |
| TXT Record | `resend._domainkey` | the `p=…` value, copied from Resend | — |
| TXT Record | `_dmarc` | `v=DMARC1; p=none; rua=mailto:dmarc@kaleidofi.xyz` | — |

TTL `Automatic` on all four. Only the last one is ours. Note there is **no MX row to add**
and **no region in any value** — Resend delegates its SPF and bounce MX through the two
CNAMEs, so both live in `forge.rmta.net` rather than in this zone.

Two hazards, in order of how much they cost:

1. **Do not touch the Mail Settings dropdown.** Namecheap only accepts MX rows when it is
   set to `Custom MX`, and it already is — the Zoho rows in the live zone prove it.
   Switching that dropdown rewrites the MX set, and the MX set is what delivers mail to
   `official@kaleidofi.xyz`, which is the campaign's own `Reply-To`. Breaking it means
   3,000 people replying into a void. Add rows; change nothing else.
2. **The Host field is relative.** Namecheap appends the domain itself, so `send` becomes
   `send.kaleidofi.xyz`. Pasting the FQDN produces `send.kaleidofi.xyz.kaleidofi.xyz`,
   which resolves to nothing and fails verification with no useful error. Same for
   `resend._domainkey` and `_dmarc`.

One smaller one: the DKIM `p=` value must be pasted verbatim, with no added quotes and
nothing prepended. It is longer than 255 characters; Namecheap splits it correctly on its
own. (The unlabelled box after `Value` is the MX priority column — irrelevant here, since
none of the four rows is an MX.)

`rua=mailto:dmarc@kaleidofi.xyz` needs that address to exist, so **create `dmarc@` as a
Zoho alias** rather than pointing `rua` at `official@`. DMARC aggregate reports arrive
daily as XML attachments from every large receiver, and `official@` is the mailbox someone
has to be reading 3,000 human replies in that same week.

Then **Verify DNS Records** in Resend. Usually minutes; the documented ceiling is 72 hours.

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

**None of these belong in Vercel.** `campaign:send` runs on your machine and the app
sends no mail at all — `RESEND_API_KEY` appears in exactly one file in this repository,
this script. Putting it in the deployment would add a live sending credential to a
surface that has no use for it. `.env` is enough, and the script walks up from the cwd to
find it, so it works from a git worktree too (where `.env`, being gitignored, is absent).

## 3. Announce the From address before you send

Post on X, **before the first batch**, naming the exact address the email will come
from and stating that Kaleido will never ask for a seed phrase or a private key.

Three thousand people expecting an email containing an access code is a phishing
opportunity, and it is a predictable one: the form was public, the promise was
public, and the timing is now known. The single cheapest defence is that the real
From address was published first, by you.

A draft that says all of it, at **276 characters** so it fits without Premium:

> 3,000+ registered for the Kaleido private testnet. Access codes go out by email this
> week, from official@kaleidofi.xyz — that address and no other.
>
> We send in batches over four days, so yours may not be first. That's normal.
>
> We never ask for your seed phrase or private key.

And as the first reply in the same thread, **233 characters**:

> Nobody from Kaleido will DM you a code, a link to "verify" your wallet, or a form
> asking for a seed phrase. If it didn't come from official@kaleidofi.xyz, it isn't us —
> and a DM offering to move you up the queue is the one to report.

Two deliberate choices in that copy. **The batching is stated up front**, because §4
sends over four days and a registrant who sees other people posting their code on day one
concludes theirs was lost — which is exactly the person a "having trouble? DM me" reply is
waiting for. Saying "yours may not be first" in advance removes the opening. And **it sells
nothing.** Luca is the reason to use the product and belongs in every other post, but a
security notice that also markets reads as marketing, and this one has to be believed.

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
