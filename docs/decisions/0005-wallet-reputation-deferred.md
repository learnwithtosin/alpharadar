# 0005 — Wallet reputation scoring deferred; MVP ships one factual signal

Status: Accepted
Date: 2026-09-07
Supersedes: 02 §18's full wallet reputation model, for the MVP only
Authoritative source: 08-ENGINEERING-REVIEW-AND-CORRECTIONS.md §3, confirmed 2026-09-07

## Decision

Wallet reputation scoring, as described in 02 §18 (early-entry consistency,
historical performance, risk-adjusted performance, wallet age, holding
behaviour, cross-project consistency, sybil indicators), will not exist in
the MVP. This is a permanent MVP boundary, not a temporary gap.

The MVP instead ships:

- A manually curated seed list of watched addresses.
- One factual signal per interaction: a `WalletSignal` row with
  `signalType = EARLY_INTERACTION`, evidence pointing at a transaction hash.
  No score, no reputation label.
- No wallet is ever called "smart." The UI says **tracked wallet**, never
  **smart wallet** — stricter than but consistent with 01 §11's existing ban
  on language like "COPY THIS WALLET" or "GUARANTEED WIN." The dashboard
  section named "Smart Wallet Signals" in 02 §15 is renamed **"Tracked
  Wallet Activity."**

The `Wallet`, `WalletActivity`, and `WalletSignal` tables are kept exactly as
specced in 02 §7 — nothing needs to be migrated later when reputation
scoring is eventually built.

## Why

Robinhood Chain has ~2 months of history at MVP build time. "Wallet age"
tops out at two months for every address. Realized/risk-adjusted PnL
requires decoding every swap and pricing each leg against a reference price
— and for a two-day-old memecoin, no reliable reference price exists.
Building this is a larger project than the rest of AlphaRadar combined, and
a number nobody can validate is worse than no number.

01 §11 already frames smart-wallet intelligence as "a signal, not a trading
instruction" and already states "a single profitable trade is insufficient
to label a wallet smart" — for the MVP this becomes: no wallet is labelled
smart at all.

## What does not change

The schema. The read-only nature of wallet tracking. The prohibition on copy
trading (01 §2, §20).
