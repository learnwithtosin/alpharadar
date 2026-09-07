# AlphaRadar — Engineering Review & Proposed Corrections

Version: 0.1
Status: Draft for review — NOT yet authoritative
Reviewer: Claude (build-side)
Reviewing: files 01–07 of the AlphaRadar MVP Pack
Date: 7 September 2026

---

## 0. How to use this document

The spec pack (files 01–07) is sound. The architecture is coherent, the safety
constitution is genuinely good, and the separation of deterministic logic from AI
is the right call. Nothing below asks to redesign the product.

What follows is a list of places where the spec either (a) assumes a data source
that does not exist, (b) specifies an output without specifying its input, or
(c) sequences the work so that nothing is testable for six weeks.

Each item states: **the problem**, **why it matters**, **the proposed fix**, and
**which spec sections it touches**.

Section 6 is a list of decisions that need an explicit ruling before the Prisma
schema is written, because they change table shape and are expensive to reverse.

If a fix is approved, it should be folded back into files 01/02/04/05 so those
stay the single source of truth. This document should then be discarded, not
kept as a parallel spec.

---

## 1. Verified premise (grounding)

These were checked against live sources before writing this review, because the
whole product depends on them:

- Robinhood Chain public mainnet launched **1 July 2026**. Chain ID **4663**;
  testnet chain ID **46630**.
- Arbitrum Orbit / Nitro stack, settles to Ethereum, gas paid in **ETH**.
- **Contract deployment is permissionless.** No allowlist, no partnership, no
  Robinhood account. The sequencer does screen transactions associated with
  sanctioned addresses.
- Public RPC: `rpc.mainnet.chain.robinhood.com` — free, **rate limited**, and
  documented by Robinhood for wallet connectivity and prototyping, not
  production traffic. Dedicated providers (Alchemy, QuickNode) are the
  documented path for production.
- Blockscout explorer available at `robinhoodchain.blockscout.com`.
- OpenSea indexes the chain natively.
- Meme coins appeared on the chain almost immediately after mainnet launch,
  including fake and deliberately unsellable tokens.

**Implication:** the product premise holds. There is real permissionless
activity to detect, and there is a real scam problem to score against. The
second point matters more than it looks — see item 4.1.

---

## 2. Blockers — resolve before writing code

### 2.1 Half the MVP priority list has no data source

**Problem.** File 02 §2 ranks opportunity priorities as: (1) NFT
whitelist/allowlist, (2) free mints, (3) giveaways/raffles, (4) airdrops,
(5) testnets/points, (6) DeFi, (7) token launches, (8) early-user rewards.

File 02 §9 defines ingestion as "Robinhood Chain on-chain events" plus
"permitted public/social/web signals." The second half is never specified —
no source, no adapter, no env var, no worker.

Whitelists, raffles, giveaways, airdrop announcements and points campaigns do
not exist in chain state. They exist in X posts, Discord announcements and
project websites. File 01 §13 correctly forbids browser automation of X, and
the X API's usable tier is a paid subscription that is not in the environment
contract or the plan.

So priorities 1, 3, 4 and 5 — the *top* of the list — currently have no
implementable path. Priorities 2 and 7 (free mints, token launches) are the
only ones fully served by on-chain ingestion.

**Why it matters.** This is not a detail. It inverts the build. If Phase 3–4
ships on-chain ingestion as written, the first thing the system detects is a
token launch, which the spec ranks seventh.

**Proposed fix.**

1. Split the opportunity catalogue explicitly into **on-chain-detectable** and
   **off-chain-only**, and say so in file 02:

   | Detectable from chain state alone | Requires an off-chain source |
   |---|---|
   | TOKEN_LAUNCH, MEMECOIN, UTILITY_TOKEN | NFT_WHITELIST |
   | NFT_MINT, FREE_MINT (contract deploy + mint activity) | RAFFLE |
   | DEFI (pool/market creation) | AIRDROP (pre-announcement) |
   | | TESTNET / points campaigns |

2. **MVP ingests on-chain only.** Reorder file 02 §2 priorities to match what
   is actually buildable: free mints and NFT mints first, token launches
   second, DeFi third.

3. Keep the data model exactly as specced — it already represents all ten
   types. Add a single authenticated **manual ingestion endpoint**
   (`POST /admin/opportunities`) so off-chain opportunities can be entered by
   hand. This exercises the full pipeline (verification → scoring → AI →
   alert) for WL/raffle/airdrop without building a scraper, and it is how the
   product gets its first useful alerts while automated coverage is thin.

4. Defer automated off-chain discovery to a named post-MVP phase, with two
   candidate sources documented and neither built: paid X API, or a Telegram
   ingestion bot reading public announcement channels (permitted, unlike X
   scraping).

**Touches:** 01 §4, 02 §2, 02 §9, 04 Phase 3–4.

---

### 2.2 There is no indexer, and the spec needs one

**Problem.** File 02 §5 lists viem plus an RPC/WebSocket provider as the entire
blockchain layer. That is enough to *watch* new blocks. It is not enough for
anything the spec asks for downstream:

- Wallet Intelligence (02 §18, 04 Phase 10) needs the full historical activity
  of an arbitrary address. Over JSON-RPC that means scanning every block since
  genesis. On an Orbit chain with sub-second blocks that is not viable on a
  rate-limited endpoint, and archive access is a paid tier.
- Token detail pages (02 §17) need holder count and holder concentration.
  Neither is an RPC call. Both require an indexed `Transfer` log history.
- Liquidity and volume (02 §17) require decoded DEX swap and mint events from
  whichever DEX is dominant on the chain, plus a reference price.

**Why it matters.** Three of the spec's headline features silently depend on a
component that appears nowhere in the stack, the repo layout, the env contract
or the plan.

**Proposed fix.**

1. Name the indexer as a first-class dependency. Two workable options:
   - **Blockscout REST API** for holders, token metadata, address transaction
     history and contract verification status. Zero infrastructure, already
     live for this chain, rate-limited.
   - **Ponder** (or an equivalent indexing framework) writing into the same
     Postgres, for decoded event history the API does not expose.

   Recommendation: start with Blockscout for reads, add Ponder only when a
   specific query proves impossible via the API.

2. Add `packages/indexer` to the repo layout, behind an interface in the same
   style as `ChainAdapter` — so the choice above is reversible.

3. Extend the `ChainAdapter` interface with the reads that are actually needed
   and currently missing: `getTokenHolders()`, `getTokenMetadata()`,
   `getAddressTransactions()`, `getContractVerification()`.

**Touches:** 02 §5, 02 §6, 02 §8, 02 §17, 02 §18, 04 Phase 3 & 10, 05.

---

### 2.3 Environment contract is incomplete

**Problem.** File 05 omits values the system cannot run without.

**Proposed fix.** Add:

```
# Chain
ROBINHOOD_CHAIN_ID=4663
ROBINHOOD_CHAIN_ID_TESTNET=46630
ROBINHOOD_EXPLORER_API_URL=https://robinhoodchain.blockscout.com/api
ROBINHOOD_EXPLORER_URL=https://robinhoodchain.blockscout.com

# Watched contracts (chain-specific, resolved during Phase 3)
DEX_FACTORY_ADDRESSES=
DEX_ROUTER_ADDRESSES=

# Alerting controls (see 4.4)
ALERT_MIN_SCORE=
ALERT_MAX_PER_USER_PER_HOUR=
AI_MIN_SCORE_TO_ANALYZE=
```

Also record in file 05, as a comment, that the public RPC is rate limited and
that a dedicated provider key is required before persistent log subscriptions
are enabled. This is a real credential the human has to obtain — it belongs in
the completion report's "requires a human credential" section from day one, not
at the end.

**Touches:** 05, 03 (completion report).

---

### 2.4 Testnet vs mainnet is never decided

**Problem.** The spec never says which network the MVP ingests from. Testnet
(46630) has a faucet and no real opportunities. Mainnet (4663) has real
activity and costs nothing to *read*.

**Proposed fix.** Ingest **mainnet, read-only, from day one** — the product is
worthless against synthetic data, and reading is free and carries no financial
risk given the constitution forbids signing anything. Use **testnet** solely
for deploying fixture contracts in integration tests. Make the network an env
var, not a build-time constant.

**Touches:** 02 §23, 04 Phase 3, 05.

---

## 3. Wallet intelligence cannot be built as written

**Problem.** File 02 §18 specifies wallet reputation from: early-entry
consistency, historical performance, risk-adjusted performance, wallet age,
holding behaviour, cross-project consistency, and sybil indicators.

On a chain that went live on 1 July 2026, there is roughly two months of
history. "Wallet age" tops out at two months for everyone. "Historical
performance" and "risk-adjusted performance" require realised PnL per wallet,
which requires decoding every swap and pricing each leg against a reference
price — and for a two-day-old memecoin no reliable reference price exists.
Computing this is a larger project than the rest of AlphaRadar combined.

**Why it matters.** File 04 Phase 10 reads as a normal phase. It is not. If it
is attempted as specified it will consume the remaining schedule and produce a
number nobody can validate.

**Proposed fix.** Narrow to what is factual and cheap, which file 01 §11
already authorises ("a signal, not a trading instruction"):

- **MVP ships:** a manually curated seed list of watched addresses, and a
  single factual signal — *this watched address interacted with this contract
  at this time*. That is a `WalletSignal` row with `signalType =
  EARLY_INTERACTION` and evidence pointing at a transaction hash. No score.
- **Keep** the `Wallet`, `WalletActivity`, `WalletSignal` tables exactly as
  specced so nothing needs migrating later.
- **Defer** all reputation scoring to post-MVP, and record why in
  `docs/decisions/0002-wallet-reputation-deferred.md`.
- File 02 §18's line "a single profitable trade is insufficient to label a
  wallet smart" becomes, for the MVP, "no wallet is labelled smart at all — the
  UI says *tracked wallet*, never *smart wallet*."

**Touches:** 02 §18, 04 Phase 10, and the dashboard section name in 02 §15
("Smart Wallet Signals" → "Tracked Wallet Activity").

---

## 4. Design flaws — resolve during the build

### 4.1 Risk has six dimensions and no defined inputs

**Problem.** `RiskAssessment` (02 §7) has `contractRisk`, `liquidityRisk`,
`socialRisk`, `linkRisk`, `deployerRisk`, `concentrationRisk`. The spec never
says how any of them is computed.

Given that scam tokens appeared on this chain immediately after launch, the
risk engine is arguably the more valuable half of the product — the honest
pitch is "this will stop you losing money," not "this will make you money."

**Proposed fix.** Implement three from data that is actually reachable, and
leave the rest explicitly `UNKNOWN` — file 01 §8 already mandates that
unknowns stay unknown:

| Dimension | MVP source | Status |
|---|---|---|
| `contractRisk` | bytecode analysis: mint function present, blacklist/pause function present, ownership renounced, proxy/upgradeable, source verified via Blockscout | **build** |
| `concentrationRisk` | top-10 holder share from indexer | **build** |
| `deployerRisk` | deployer address age, prior deployments, prior rugs among them | **build** |
| `liquidityRisk` | needs DEX integration | UNKNOWN in MVP |
| `socialRisk` | needs off-chain sources (see 2.1) | UNKNOWN in MVP |
| `linkRisk` | partial — URL normalisation + domain age only | partial |

Also worth evaluating (not committing to): a third-party token-security API
such as GoPlus. **Verify Robinhood Chain support before depending on it** — it
is a new chain and coverage is not guaranteed.

**Touches:** 02 §7, 02 §11, 04 Phase 5–6.

### 4.2 Scoring weights are unvalidatable and freshness is dangerous

**Problem.** File 02 §12 fixes the weights at legitimacy 25 / value 20 /
freshness 20 / on-chain 15 / smart-wallet 10 / urgency 10. There is no data to
calibrate these against on day one. Worse, freshness at 20 points means *every
brand-new contract scores well by default* — on a chain where new contracts are
disproportionately scams, that weight actively works against the user.

**Proposed fix.** Keep the deterministic engine and the component breakdown
exactly as specced. Add three things:

1. Persist a `scoreInputs` JSONB column and a `scoringVersion` string on
   `Opportunity`, so every score is reproducible and historical opportunities
   can be re-scored when weights change.
2. Add `scripts/backtest-scoring.ts` that re-runs the current weights over
   stored opportunities and prints the distribution. This is how weights get
   fixed later, and it costs an hour now.
3. **Risk must be able to veto an alert independently of score.** As written, a
   90-score honeypot gets pushed to Telegram. Add an explicit rule: if
   `overallRisk >= HIGH`, the opportunity is never alerted regardless of score,
   only shown on the web with the risk surfaced.

**Touches:** 02 §7, 02 §12, 04 Phase 6.

### 4.3 AI cost is uncapped and ungated

**Problem.** File 02 §13 and 04 Phase 7 run AI analysis per opportunity. On a
permissionless chain, hundreds of contracts can deploy in a day. Every one
would trigger a model call with no threshold, no cache and no budget.

**Proposed fix.** Gate AI behind the deterministic score, which is also more
faithful to file 01 §18 ("deterministic first"):

- Only opportunities scoring above `AI_MIN_SCORE_TO_ANALYZE` get an analysis.
- Cache by a hash of the evidence bundle — re-analysing an unchanged
  opportunity is wasted spend.
- Keep the existing graceful-degradation rule from 04 Phase 7. It is correct.

**Touches:** 02 §13, 04 Phase 7, 05.

### 4.4 "Alert quality" is stated as a goal with no mechanism

**Problem.** File 01 §16 says optimise for useful alerts, not maximum alerts.
Nothing in the spec implements this. The alert worker (02 §19) checks
thresholds and user preferences, and that is all.

The realistic failure mode for this product is not a crash. It is that the bot
sends forty alerts on day one, the user mutes it, and it is never opened again.

**Proposed fix.**

- Per-user hourly alert cap (`ALERT_MAX_PER_USER_PER_HOUR`), with overflow
  rolled into a digest rather than dropped.
- A dedupe window so the same project cannot alert twice within N hours for the
  same `actionProfile`.
- Ship with alerts **off by default except `CRITICAL` urgency**; the user opts
  in to more from `/settings`.
- The `Alert` table already exists — add `suppressedReason` so it is possible to
  see what was *not* sent and why. This is the only way to tune thresholds
  later.

**Touches:** 01 §16, 02 §7, 02 §19, 05.

### 4.5 Deduplication key is under-specified

**Problem.** File 02 §7 says "prevent duplicate chain+contract combinations
where appropriate." That is not sufficient. One project deploys several
contracts. One contract legitimately produces several distinct opportunities
over its life — a whitelist phase, then a public mint. Keying on
`(chain, contract)` merges opportunities that should be separate. Keying on
nothing spams.

**Proposed fix.** Unique constraint on
`(chain, contractAddress, opportunityType, actionProfile)` for open
opportunities, with an explicit rule that a `COMPLETED` or `EXPIRED`
opportunity does not block a new one on the same contract. Document it, and
make it the first deterministic test written (04 Phase 4 acceptance already
demands "exactly once").

**Touches:** 02 §7, 02 §10, 04 Phase 4.

### 4.6 Alerts are user-scoped only, which closes off the obvious distribution route

**Problem.** `Alert` is keyed to `userId`. Every alert is a DM to a registered
user. That is a correct model for the product as specced — and it means the
system structurally cannot post to a public Telegram channel.

A public channel is the cheapest possible distribution and the standard growth
path for this category: free channel builds the audience, private tier is the
product. File 01 §20 correctly excludes billing from the MVP, and this proposal
does not add billing. It only asks that the alert layer not be built in a way
that forecloses it.

**Proposed fix.** Make `Alert.userId` nullable and add a nullable
`targetChatId` plus an `AlertTarget` enum (`USER_DM` / `BROADCAST_CHANNEL`).
One column, no billing, no new feature — it just means the option exists later
without a migration through live data.

**Touches:** 02 §7, 02 §14, 02 §19.

---

## 5. Scope and sequencing

### 5.1 Nothing is testable end-to-end until Phase 11

**Problem.** File 04 builds twelve horizontal layers. The first user-visible
output arrives at Phase 8 (Telegram) and the first end-to-end path at Phase 11.
For a solo developer that is two to three months before anything can be shown
to a user or judged as a product.

The risk is not technical. It is that the first real feedback — *are these
alerts any good?* — arrives after all the work is done.

**Proposed fix.** Same architecture, same twelve phases, reordered so a thin
vertical slice runs end-to-end first. Everything below is already in the spec;
nothing is added.

**Slice 1 — one opportunity type, end to end (target: ~2 weeks)**

1. Monorepo foundation (04 Phase 1, unchanged)
2. Prisma schema — **complete**, all tables, as specced (04 Phase 2, unchanged)
3. `ChainAdapter` + `RobinhoodAdapter`, mainnet read-only (04 Phase 3)
4. **One detector only:** new ERC-721 contract deployment + first mint activity
5. Minimal verification: contract verified via Blockscout, deployer age
6. Deterministic scoring, `FREE_MINT` path only
7. Telegram: `/start`, account link, NFT template, send
8. Web: `/opportunities` list + `/opportunities/[id]` detail

At the end of Slice 1 the loop DETECT → SCORE → ALERT → PAGE works against
live mainnet data for one opportunity type. That is the point at which the
product can be judged.

**Slice 2 — breadth**

9. Token detector (deploy + first liquidity), token template, token detail page
10. Risk engine (the three buildable dimensions from 4.1)
11. AI analysis layer, gated per 4.3
12. Manual ingestion endpoint per 2.1, unlocking WL/raffle/airdrop by hand

**Slice 3 — depth**

13. Tracked wallet signals (narrowed per section 3)
14. Auth, settings, alert history, remaining pages
15. Hardening: logging, health, retries, rate limits, docs (04 Phase 12,
    unchanged)

### 5.2 Seven worker processes is premature for one developer

**Problem.** File 02 §6 and §19 define seven worker applications. Seven deploy
targets, seven crash loops, seven log streams, one developer.

**Proposed fix.** Keep all seven **queues** exactly as named in 02 §20 — the
logical separation is correct and worth preserving. Run them as **one worker
process** that registers multiple BullMQ consumers, selected by a `QUEUES=`
env var. Splitting into separate processes later is a deployment change, not a
code change. This preserves 01 §19 (modular architecture) while cutting
operational surface by 6/7.

**Touches:** 02 §6, 02 §19, 04 Phase 12.

---

## 6. Decisions required before the schema is written

These change table shape. They need an explicit ruling, not a default.

1. **Identity model.** The spec makes login the first acceptance criterion
   (02 §24) and hangs every relation off `User`. The stated product intent was
   that people could use it like a Telegram bot with no signup.
   **Proposal:** Telegram-first. `/start` creates the `User` row with
   `telegramUserId` as identity; `email` and `passwordHash` become nullable and
   are an optional later upgrade for web login. One nullable column now versus
   a migration through live user data later.
   **Ruling needed: Telegram-first, or login-first as specced?**

2. **Network.** Mainnet read-only from day one, testnet for test fixtures only
   (per 2.4). **Confirm?**

3. **Scope of automated discovery in MVP.** On-chain only, with a manual
   ingestion endpoint covering the rest (per 2.1). **Confirm, or fund a paid
   off-chain source now?**

4. **Wallet reputation.** Deferred entirely; MVP ships factual interaction
   signals from a curated address list (per section 3). **Confirm?**

5. **Build order.** Vertical slices (per 5.1) or the original horizontal
   phase order in file 04? **Ruling needed** — this one determines what gets
   written first, so it blocks the start.

6. **Product naming.** "AlphaRadar" is fine. But marketing that leans on
   Robinhood's name or marks, for a tool that surfaces memecoins on their
   chain, is a trademark question worth a minute of thought before any public
   launch. No engineering impact; flagging once.

---

## 7. What does not change

Recording this explicitly so the review does not read as a redesign. The
following stand exactly as written and should not be reopened:

- The entire Project Constitution (file 01) — every safety rule, the
  non-custodial stance, the ban on autonomous financial action, the ban on X
  automation, the FACT/INFERENCE/UNKNOWN discipline, the score-versus-risk
  separation, and the prohibited-language list.
- Deterministic-first (01 §18). Several fixes above lean on it harder.
- The adapter boundary and the ban on leaking chain-specific calls into domain
  logic (01 §17, 02 §8).
- The full Prisma schema as specced (02 §7). Proposed changes are additive:
  `scoreInputs`, `scoringVersion`, `suppressedReason`, `targetChatId`,
  nullable `Alert.userId`, nullable `email`/`passwordHash`.
- Every non-goal in 01 §20 and 02 §25.
- The stack: Next.js / Fastify / Postgres / Prisma / Redis / BullMQ / viem /
  pnpm workspaces.
- Telegram templates and the rule that contract addresses are never shortened
  (03).
- The AI output schema and the requirement to validate it before persistence
  (02 §13).

---

## 8. Summary of proposed changes

| # | Item | Severity | Change type |
|---|---|---|---|
| 2.1 | Off-chain discovery has no source | Blocker | Narrow scope + manual ingestion endpoint |
| 2.2 | No indexer in the stack | Blocker | Add `packages/indexer`, extend `ChainAdapter` |
| 2.3 | Env contract incomplete | Blocker | Add vars |
| 2.4 | Network undecided | Blocker | Mainnet read-only |
| 3 | Wallet reputation unbuildable | High | Narrow to factual signals, defer scoring |
| 4.1 | Risk dimensions have no inputs | High | Build 3 of 6, rest UNKNOWN |
| 4.2 | Weights unvalidatable; freshness harmful | High | Version + persist inputs; risk veto |
| 4.3 | AI cost uncapped | Medium | Score gate + cache |
| 4.4 | Alert quality has no mechanism | High | Caps, dedupe, off-by-default |
| 4.5 | Dedup key under-specified | Medium | Composite constraint |
| 4.6 | Alerts cannot broadcast | Low | Two nullable columns |
| 5.1 | No end-to-end path until Phase 11 | High | Reorder into vertical slices |
| 5.2 | Seven worker processes | Medium | One process, seven queues |

---

## 9. Next step

On approval, fold the accepted items into files 01/02/04/05, then hand the
updated pack to Claude Code with file 03 as the build prompt. First commit
should be Slice 1, step 1–2: monorepo foundation and the complete Prisma
schema.
