# 0007 — Vertical-slice build order; amends 01 §23

Status: Accepted
Date: 2026-09-07
Amends: 01-PROJECT-CONSTITUTION.md §23
Authoritative source: 08-ENGINEERING-REVIEW-AND-CORRECTIONS.md §5.1, confirmed 2026-09-07

## Decision

Build order is vertical slices, not the horizontal twelve-layer sequence
originally implied by 01 §23's numbered list.

**Slice 1 — one opportunity type, end to end (~2 weeks target):**
monorepo foundation → complete Prisma schema (all tables) → `ChainAdapter` +
`RobinhoodAdapter` (mainnet, read-only, polling) → one detector (ERC-721
deploy + first mint) → minimal verification (Blockscout contract
verification, deployer age) → deterministic scoring for the `FREE_MINT` path
→ Telegram (`/start`, account link, NFT template, send) → web
`/opportunities` list + `/opportunities/[id]` detail.

**Slice 2 — breadth:** token detector + template + detail page → risk engine
(the three buildable dimensions, 0006) → AI analysis layer (flag-gated,
score-gated) → manual ingestion endpoint (0003).

**Slice 3 — depth:** tracked wallet signals (0005) → auth, settings, alert
history, remaining pages → hardening (logging, health, retries, rate limits,
docs).

## Why

01 §23's original twelve-layer order means the first user-visible output
arrives at step 9 (Telegram) and the first end-to-end path at step 13 — two
to three months before anything can be shown to a user or judged as a
product, for a solo developer. The risk isn't technical, it's that the first
real feedback — are these alerts any good? — arrives after all the work is
done. Vertical slices reach the same architecture and the same twelve
conceptual layers; they only reorder *when* each is exercised end-to-end so
that DETECT → SCORE → ALERT → PAGE is running against live mainnet data
after Slice 1, for one opportunity type.

## Amendment to 01 §23

This build order places Telegram (step 9) and the web dashboard/detail pages
(steps 10–11) in Slice 1, ahead of AI analysis (step 8) going live in
Slice 2 — the reverse of §23's literal numbering. Per explicit ruling, §23 is
amended (not overridden by a lower document) with the following note, added
directly to `01-PROJECT-CONSTITUTION.md` §23, dated 2026-09-07:

> §23 lists the components of the system and their dependency order. It is
> not a strict phase gate. Where a vertical slice ships a later-numbered
> component before an earlier one, the ordering constraint that survives is
> dependency, not numbering — nothing may be built on top of something that
> does not exist yet. The AI analysis component may be built with its live
> invocation deferred, as recorded in 09 §4.

Concretely: AI analysis (step 8) is built in Slice 1 as an interface + schema
+ validation, flag-gated off (09 §4) — it does not depend on Telegram or the
web app, so nothing here is built on top of something that doesn't exist.
Telegram (step 9) and the web app (steps 10–11) do not depend on AI analysis
being live, so shipping them first violates no dependency. What §23 no
longer requires is that step 8 be *live* before steps 9–11 ship — only that
nothing later-numbered be load-bearing on something earlier-numbered that
hasn't been built yet.

### Scope of the amendment

This is the only part of 01 that is amended, and §23 is amendable only
because it is a build-order list, not a safety rule. Every safety rule, the
non-custodial stance (01 §2–3), the AI boundaries (01 §9), the
deterministic-first rule (01 §18), and the prohibited-language list (01 §11)
are unchanged and remain non-negotiable.

## What does not change

Every layer in the original twelve still gets built, in the same modular
shape (01 §19). Nothing is skipped — only the order in which each becomes
user-visible.
