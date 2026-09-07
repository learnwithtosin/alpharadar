# 0004 — Telegram-first identity

Status: Accepted
Date: 2026-09-07
Supersedes: 02 §24's "create/login" step ordered before "connect Telegram"
Authoritative source: 08-ENGINEERING-REVIEW-AND-CORRECTIONS.md §6 item 1, confirmed 2026-09-07; schema groundwork already present in 09-INFRASTRUCTURE-DECISION.md §7

## Decision

Identity is Telegram-first. `/start` creates the `User` row with
`telegramUserId` as the primary identity. `User.email` and
`User.passwordHash` are nullable and represent an optional later upgrade to
web login — not a requirement to use the product.

02 §24's Phase 1 acceptance list, which orders "create/login" (step 1) before
"connect Telegram" (step 2), is superseded in sequencing: connecting Telegram
*is* account creation in the MVP. Web login is an optional path onto an
account that already exists.

## Why

The product's actual intended usage is Telegram-first, closer to using a
Telegram bot than signing up for a SaaS product. Requiring email/password
signup before a user can receive their first alert adds friction the product
doesn't need and the constitution doesn't require. This is a single nullable
column now versus a migration through live user data later if decided the
other way after launch.

## What does not change

`User.email`/`passwordHash` remain in the schema as an optional upgrade path
for web login. No auth mechanism is removed — only the requirement that it
happen first.
