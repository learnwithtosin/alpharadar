# 0012 — Telegram bot commands and the alert stage implemented

Status: Accepted
Date: 2026-09-09
Related: 0004-telegram-first-identity.md (/start's identity model), 0006-risk-and-token-page-unknowns.md (liquidityRisk/socialRisk always UNKNOWN, feeding this stage's "if known"/"if available" placeholders), docs/spec/08-ENGINEERING-REVIEW-AND-CORRECTIONS.md §4.4 (alert-quality rules), docs/spec/03-CLAUDE-BUILD-PROMPT.md (Telegram templates)

## What this implements

`packages/telegram` (previously a placeholder) and `apps/pipeline`'s
`alert()` stage (previously a stub), covering exactly what was asked:

- `/start`, `/settings`, `/stop` — pure request-in/reply-out command
  handlers, no framework, taking already-parsed input and a Prisma handle.
- The NFT and Token Telegram templates from 03, reproduced exactly —
  tested byte-for-byte against the literal spec text.
- Four alert rules from 08 §4.4 and this session's risk-veto work:
  minimum score (`ALERT_MIN_SCORE`), a per-user hourly cap
  (`ALERT_MAX_PER_USER_PER_HOUR`), a dedupe window
  (`ALERT_DEDUPE_WINDOW_HOURS`, new), and the risk veto
  (`isAlertVetoed`, from the earlier verify/score work).
- Every suppressed decision persists an `Alert` row with
  `suppressedReason` set — never a silently-dropped opportunity.
- Two development-tooling scripts: `pnpm seed-test-opportunity` and
  `pnpm send-alert <id>`.

## Global vs. per-user rules

The risk veto and dedupe window are properties of the *content* — if this
project already alerted for the same `actionProfile` recently, or the
veto fires, that's true regardless of any one recipient's preferences.
The minimum score and hourly cap are properties of a *recipient* — a
user's own `minimumScore` may raise the effective floor above
`ALERT_MIN_SCORE`, never lower it below it, and the hourly cap is
explicitly per-user in 08 §4.4's own wording. `alert-rules.ts` splits
these into `evaluateGlobalGate` (checked once) and `evaluateUserGate`
(checked once per active Telegram recipient), both pure functions over
already-fetched facts, both unit-tested without a database.

A globally-suppressed opportunity (veto, dedupe, or literally no active
Telegram recipients) writes exactly **one** `Alert` row with `userId:
null` — the broadcast-shaped column 08 §4.6 already added — rather than
one row per user, because that decision was never user-specific; faking
N identical per-user rows would misrepresent what actually happened.

## What was deliberately not built, disclosed rather than silently included

**08 §4.4 also proposes shipping alerts off-by-default except CRITICAL
urgency**, opt-in from `/settings`. That wasn't in the four rules asked
for this pass and isn't built — every opportunity that clears the four
rules above alerts regardless of urgency. `UserSettings.minimumScore` and
`.telegramEnabled` are respected (they already exist in the schema for
exactly this purpose and `/stop`/`/settings` need them to do something
real); `UserSettings.enabledOpportunityTypes` is not — its empty-array
default is ambiguous (no way to tell "no types selected" from "no
filter" without a decision on that default that nothing in the spec or
schema resolves), so gating on it risked delivering zero alerts by
default for the wrong reason. Left unused, not guessed at.

**`/settings` is read-only** — it reports current settings and points to
the web `/settings` page (02 §15) to change them. No bot-side mutation
syntax is invented; there's no spec text defining one, and building an
untested, undocumented command syntax risked drifting out of sync with
whatever the web page ends up doing.

**No live webhook or polling entry point existed for the bot commands at
first** — `handleStart`/`handleSettings`/`handleStop` were complete and
tested, but nothing wired an actual Telegram update to them, the same
kind of gap as the missing `.github/workflows` file found in 0011. Closed
in this same decision — see "Bot long-polling entry point" below — since
without it there was no way to actually register a real recipient, which
blocked the point of building the alert stage at all.

## Bot long-polling entry point (`pnpm bot`)

`apps/pipeline/src/dev/bot.ts` calls Telegram's `getUpdates` in a loop
and routes each update through a new `dispatchUpdate` (packages/telegram)
to the existing command handlers, replying with whatever they return.
Long-polling, not a webhook — a webhook needs a publicly reachable HTTPS
URL, and nothing in this project is a deployed listener; apps/pipeline is
a short-lived scheduled process (0002-scheduled-polling.md), not a
server. `dispatchUpdate` is transport-agnostic (a plain function over an
already-parsed update), so a future webhook could reuse it unchanged.

**Kept separate from the pipeline, on purpose**: `bot.ts` is never
imported by `run-pipeline.ts`, `polling-driver.ts`, or `index.ts` — it's
a manually-started, manually-stopped (Ctrl+C) interactive process, run
only when linking an account or exercising `/settings`/`/stop`, the same
category as the existing `seed-test-opportunity`/`send-alert` dev tools.
The cron never touches it.

**A real connectivity bug, found and fixed while verifying this end-to-
end**: `TelegramClient`'s calls to `api.telegram.org` failed with `fetch
failed` / `ETIMEDOUT` in this session's own testing environment. Root-
caused, not assumed: `curl` reached the host fine over IPv4; Node's
`fetch` (undici) was timing out trying that host's IPv6 address first,
which isn't reachable from here, and never fell back to IPv4 the way
`curl`'s Happy Eyeballs did.
`dns.setDefaultResultOrder('ipv4first')` called at runtime did **not**
fix it (undici doesn't consistently honor that API) — only the
`--dns-result-order=ipv4first` Node CLI flag did, confirmed live. Added
to the `start`/`dev`/`send-alert`/`bot` scripts in
`apps/pipeline/package.json` (not `seed-test-opportunity`, which makes no
network calls). This is a real, safe, low-risk fix — forcing IPv4-first
DNS resolution doesn't break IPv6-only networks in practice for a host
like Telegram's that's fully dual-stack, it only changes which address
family is tried first — but it's very likely fixing a quirk of the
sandboxed environment this was tested from rather than a problem on a
normal machine or GitHub Actions runner (both have ordinary working
IPv6). Left in regardless, since it costs nothing and directly protects
the exact call path this whole decision is about.

## Project.symbol — small additive schema change

The Token template needs `<token> / <ticker>` as two separate fields.
`resolve()` already receives `tokenSymbol` from `getTokenMetadata` but
only used it as a fallback for `name`, discarding it otherwise — the same
category of gap as `Contract.deployerAddress` earlier in this project.
Added `Project.symbol String?` (nullable — nothing fabricated when the
symbol read failed) and now persist it on both NFT and token project
creation. One nullable column, migrated live
(`20260909101541_add_project_symbol`).

## The "Open on AlphaRadar" link

03's literal templates show `👉 Open on AlphaRadar` / `👉 Open AlphaRadar`
as plain CTA text with no `<url>` placeholder, but 02 §14 lists an
"AlphaRadar link" as a required element and 03 says outright "NFT alerts
MUST send the user toward AlphaRadar." Resolved by keeping the renderer
pure text — exactly the template, nothing more, which is what gets
tested byte-for-byte — and attaching the actual link as a native Telegram
inline-keyboard button (`TelegramClient.sendMessage`'s
`inlineKeyboardRow`) pointing at `${WEB_URL}/opportunities/${id}`,
separately from the message text. The button repeats the same label as
the text line just above it, which reads as slightly redundant but
satisfies both constraints honestly rather than picking one at the
other's expense.

**Live testing found a real failure here**: Telegram rejects an inline-
button URL that isn't genuinely public — `sendMessage` came back "Wrong
HTTP URL" for `http://localhost:3000/opportunities/...`, WEB_URL's own
default value, and failed the *entire* send, button and message text
both. That's a real risk beyond local dev too — WEB_URL misconfigured in
a real deployment (still pointing at a default, a private/internal
address, plain http instead of https) would silently break every alert
the same way. Fixed with `looksLikePubliclyReachableHttpsUrl`
(packages/telegram) — a pattern check (localhost, loopback/private/
link-local IPv4 and IPv6 ranges, https-only), not a live reachability
probe, computed once per opportunity in `alert.ts` and reused for every
recipient. When it fails, `alert()` sends the message text with no
button rather than failing the whole delivery, and logs one
`alert.button.omitted` warning (not one per recipient). A missing button
degrades the alert; a missing alert defeats the product.

## Retry tuning — a real gap, not just a config number

Testing also surfaced ~15 `ETIMEDOUT` connection failures against
`api.telegram.org` over a few minutes from the same network used for
testing, all eventually recovering on retry. Checking why `sendMessage`'s
retry config should have absorbed that turned up a real bug, not just an
undersized number: `TelegramClient`'s retry predicate only ever matched
`TelegramApiError` (a parsed, well-formed Telegram response saying
429/5xx) — a raw connection failure throws before any response exists to
parse, surfacing as a plain `TypeError: fetch failed` (undici's actual
signature for `ETIMEDOUT`/DNS/connection-reset, confirmed against the
real stack traces this session produced). That error type never matched
the predicate, so it was **never retried at all** — `maxAttempts` and
backoff were irrelevant for exactly the failure mode observed, because
that class of error never reached them. Fixed: the predicate now also
matches `error instanceof TypeError && error.message === "fetch failed"`
— precise to that one documented signature, not a blanket
`instanceof TypeError` that could mask an unrelated bug.

With that closed, `maxAttempts`/backoff were re-sized to the stated
target — "enough to survive a minute of intermittent failure," since a
dropped alert is this product's one job, not a background task that can
shrug one off. New defaults: `maxAttempts: 8`, `baseDelayMs: 1000`,
`maxDelayMs: 15_000` — 1s doubling to a 15s cap sums to
1+2+4+8+15+15+15 = 60s of backoff across the 7 retries between 8
attempts (before jitter), against the previous 3 attempts / ~1.5s total,
which was sized for ordinary API errors, not sustained network
flakiness. Applies to every `TelegramClient` call (`sendMessage`,
`getUpdates`, `getMe` alike) — `getUpdates` already has its own outer
retry loop in `bot.ts`, so this is additive resilience there, not a
behavior change that could break anything.

**Telegram connectivity from at least one real network this project is
used from is intermittent** — repeated `ETIMEDOUT` against
`api.telegram.org`, always recovering within a few minutes, confirmed
live via `curl` succeeding where Node's `fetch` initially didn't (a
separate, already-documented IPv6-routing issue — see "Bot long-polling
entry point" above — plus this additional, less consistent pattern of
outright connection timeouts even with that fix applied). Recorded here
as an operating condition, not a bug to chase further: the retry budget
above is sized around it.

## NFT template has no contract address — that's the spec, not a bug

A live alert for the seeded (NFT_MINT) test opportunity showed no
contract address, which was flagged as a possible bug. Re-checked against
03's literal template text directly (not from memory): the NFT template
genuinely has no CA line at all — `Project`/`Chain`/`Mint`/`Status`/
`Score`/`Risk`/`Urgency`/`Why it matters` only. The Token template does
(`CA:` / `<full contract address>`), and `renderTokenAlertMessage`
renders `contractAddress` verbatim with no truncation — already covered
by an explicit "never shortens the contract address" test. Nothing
changed here; this section exists so the confirmation is on the record,
not just in the reply that gave it.

## "Why it matters" no longer restates the Score line

`deriveNftMintAlertReasons`' lowest-priority fallback used to be
`AlphaRadar score: ${score}/100` — live testing showed this firing
routinely (whenever none of isFree/LOW-contractRisk/LOW-concentration/
recently-detected applied) sitting directly under a `Why it matters:`
heading three lines below a `Score: 61/100` the message already shows.
A bullet that repeats a fact the reader just read isn't a reason to pay
attention, it's a wasted line in the one section whose whole job is
supplying reasons. Removed, and `score` dropped from
`NftMintAlertReasonInputs` entirely — it was only ever used to build that
one line, so keeping it as a parameter after removing its only use would
have left a misleading, dead field.

Removing it without a replacement would have broken the "always exactly
two, never fabricated" guarantee: the old always-true fallback was two
candidates deep (score restate, then the detection-method line) — with
the first one gone, an opportunity that fails every conditional check
would fall to a single guaranteed candidate, one short. Added a genuine
second structural fact instead of thinning the guarantee: "Newly
deployed contract — not a reopened or reused collection" — always true
of anything `getRecentContractCreations` finds (it only ever returns
fresh deployments), and not shown anywhere else in the message, unlike
the score line it replaces.

The Token template has no "Why it matters" section at all in 03's
literal text — no bullets, no equivalent function exists to have the
same problem. Nothing to change there.

## ALERT_DEDUPE_WINDOW_HOURS — a judgment call, not derived

08 §4.4 specifies a dedupe window without naming N hours. Defaulted to
24 (one alert per project+actionProfile per day) — a judgment call, not
tuned against outcome data (none exists yet, the same caveat 08 §4.2
flags for the scoring weights). Configurable via env.

## Dev tooling — all three entry points clearly marked, none production

`apps/pipeline/src/dev/seed-test-opportunity.ts` creates a Project,
Contract, Opportunity, and RiskAssessment for a real, live-verified
ERC-721 on Robinhood Chain ("Ponsino Pass" — found via a direct
`getRecentContractCreations` + `getTokenMetadata` scan against the
production RPC, the same code path discovery uses; two live searches
covering 6,500 blocks turned up no ERC-20 at all — see the base-rate note
in 0008 — so this uses the real ERC-721 instead, seeded as an `NFT_MINT`
opportunity to exercise the NFT template path), with a risk/score profile
computed by the real `@alpharadar/scoring` functions from plausible (not
independently audited against this specific contract) risk inputs — so
the resulting score/urgency are exactly what the real pipeline would
compute, not a hand-picked number.

Every row it creates is both prefixed `[DEV TEST]` in its name/title
*and* flagged `isTestData: true` — a real, indexed boolean column on
`Project` and `Opportunity` (migration
`20260909104552_add_is_test_data_flag`), not just a name-prefix
convention. `resolve()` never sets this column, so `WHERE "isTestData" =
true` reliably isolates every row this script has ever produced, in any
future dashboard or query, not only by eyeballing a title. Idempotent:
re-running it finds the existing test project by slug rather than
creating a duplicate.

`apps/pipeline/src/dev/send-alert.ts` runs the real `alert()` stage
against a given opportunity ID on demand and prints exactly which `Alert`
row(s) it wrote. None of the three scripts here (`seed-test-opportunity`,
`send-alert`, `bot`) is imported by `run-pipeline.ts`, `polling-driver.ts`,
or anything reachable from a real pipeline run — each is marked
`DEVELOPMENT` / `DEVELOPMENT / INTERACTIVE TOOLING` in its header comment.

## What does not change

The verify/score stages and the risk veto itself; the checkpoint's
accepted-gap semantics; `resolve()`'s dedup key
(`chain, contractAddress, type, actionProfile`).
