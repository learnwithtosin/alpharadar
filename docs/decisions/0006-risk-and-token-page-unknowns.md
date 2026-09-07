# 0006 — socialRisk, liquidityRisk, and token-page liquidity/volume stay UNKNOWN for the whole MVP

Status: Accepted
Date: 2026-09-07
Supersedes: the implication in 02 §7 and 02 §17 that all risk dimensions and all token-page metrics are populated
Authoritative source: 08-ENGINEERING-REVIEW-AND-CORRECTIONS.md §4.1, confirmed 2026-09-07

## Decision

Of `RiskAssessment`'s six dimensions (02 §7):

| Dimension | MVP source | Status |
|---|---|---|
| `contractRisk` | bytecode analysis via Blockscout (mint fn, blacklist/pause fn, ownership renounced, proxy/upgradeable, source verified) | Built |
| `concentrationRisk` | top-10 holder share from Blockscout | Built |
| `deployerRisk` | deployer address age, prior deployments, prior rugs among them | Built |
| `liquidityRisk` | requires DEX integration, not in the MVP stack | **UNKNOWN, permanently for MVP** |
| `socialRisk` | requires off-chain sources (see 0003), not in the MVP stack | **UNKNOWN, permanently for MVP** |
| `linkRisk` | URL normalisation + domain age only | Partial |

Correspondingly, the token detail page (02 §17) shows **liquidity and
volume as UNKNOWN** for the entire MVP — not just until Slice 2. No DEX
integration (decoded swap/liquidity events) is scheduled in the current
infrastructure plan (09's chosen indexer, Blockscout REST, covers holders,
token metadata, and address transaction history — not decoded DEX events).
Adding this is a future decision, not a Slice 2 task already in motion.

## Why

This is not a gap to paper over. 01 §8 requires that unknown information
stay unknown rather than be fabricated or inferred. `socialRisk` needs
off-chain sources that don't exist in the MVP (see 0003). `liquidityRisk`
and token volume/liquidity need a DEX-aware indexer that was evaluated
(Ponder, in 08 §2.2) but not adopted — 09's stack table has no DEX
integration at all. Given scam tokens appeared on this chain almost
immediately after mainnet launch, the risk engine that *is* buildable
(contract, concentration, deployer) is arguably the more valuable half of
the product, and showing an honest UNKNOWN for the rest is preferable to a
number that looks complete but isn't.

## What does not change

The `RiskAssessment` schema (02 §7) — all six columns exist, three are
populated, three are honestly UNKNOWN/partial. The rule that risk can veto
an alert independently of score (01 §10; if `overallRisk >= HIGH`, the
opportunity is never sent to Telegram regardless of score) still applies
using only the dimensions that are actually computed.
