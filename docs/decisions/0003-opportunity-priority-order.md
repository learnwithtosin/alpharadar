# 0003 — Opportunity priority order and off-chain discovery scope

Status: Accepted
Date: 2026-09-07
Supersedes: 02 §2 (MVP opportunity priorities)
Authoritative source: 08-ENGINEERING-REVIEW-AND-CORRECTIONS.md §2.1, confirmed 2026-09-07

## Decision

02 §2's priority ranking is superseded. Automated on-chain detection covers,
in order:

1. Free mints and NFT mints (contract deploy + mint activity)
2. Token launches (memecoins, utility tokens)
3. DeFi (pool/market creation)

NFT_WHITELIST, RAFFLE, AIRDROP (pre-announcement), and TESTNET/points
campaigns do not exist in chain state — they live on X, Discord, and project
websites, and the MVP has no legal, budgeted way to read those sources
automatically (X's usable API tier is paid and out of scope; browser
automation of X is forbidden by 01 §13). These types enter the system only
through a manually authenticated admin-entry endpoint
(`POST /admin/opportunities`), which exercises the full downstream pipeline
(verification → scoring → AI → alert) exactly like an auto-detected
opportunity.

## Why

02 §2 ranked whitelist/allowlist, raffles/giveaways, and airdrops above free
mints and token launches — but those are exactly the categories with no
implementable automated data source in the MVP. Building ingestion in the
original priority order would mean the first thing the system detects is a
token launch, which the spec ranked seventh. The data model already
represents all ten MVP types (02 §7) and needs no change — only the
detection *order* and the *mechanism* for the off-chain types are corrected.

## What does not change

The full MVP opportunity type list (01 §4). The data model. Automated
off-chain discovery (a paid X API, or a Telegram bot reading public
announcement channels) is deferred to a named post-MVP phase — neither is
built now.
