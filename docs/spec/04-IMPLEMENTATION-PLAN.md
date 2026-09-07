# AlphaRadar — Implementation Plan

This is the execution roadmap for Claude.

## Phase 0 — Repository reconnaissance

Goal:
Understand what exists before changing anything.

Tasks:
- inspect repository
- inspect package manager
- inspect existing apps
- inspect git status
- inspect environment files without exposing secrets
- identify reusable code

Deliverable:
Short architecture/repository report.

## Phase 1 — Foundation

Tasks:
- monorepo
- TypeScript
- pnpm
- lint/format/test
- env validation
- shared config

Acceptance:
All packages install and basic checks pass.

## Phase 2 — Database

Tasks:
- Prisma
- PostgreSQL
- complete MVP schema
- migrations
- seed/demo data script

Acceptance:
Migration succeeds and a test query works.

## Phase 3 — Blockchain

Tasks:
- ChainAdapter
- RobinhoodAdapter
- RPC connection
- WebSocket/log subscription
- basic event normalization

Acceptance:
Application can receive and persist a controlled test event.

## Phase 4 — Opportunity engine

Tasks:
- project resolution
- contract resolution
- opportunity creation
- opportunity status
- deduplication

Acceptance:
A raw signal can become a stored opportunity exactly once.

## Phase 5 — Verification

Tasks:
- source model
- evidence model
- URL normalization
- contract verification metadata
- official-link confidence

Acceptance:
An opportunity can show evidence and link verification status.

## Phase 6 — Scoring/risk

Tasks:
- deterministic score
- risk dimensions
- urgency
- score explanation

Acceptance:
Same inputs always produce same score.

## Phase 7 — AI

Tasks:
- AIProvider
- structured prompt
- structured output schema
- validation
- persistence
- graceful fallback

Acceptance:
An opportunity can receive a validated AI analysis without AI becoming a single point of failure.

## Phase 8 — Telegram

Tasks:
- bot
- user linking
- settings
- alert worker
- NFT template
- token template
- delivery tracking

Acceptance:
A test user receives both alert types correctly.

## Phase 9 — Web

Tasks:
- auth
- dashboard
- opportunity list
- opportunity details
- token details
- NFT details
- alert history
- settings

Acceptance:
User can go from alert → AlphaRadar → relevant action.

## Phase 10 — Wallet intelligence

Tasks:
- public wallet registration
- activity ingestion
- basic reputation
- wallet signals
- opportunity/wallet relationship

Acceptance:
A tracked wallet interaction can appear on the corresponding opportunity.

## Phase 11 — End-to-end validation

Test:

Discovery
→ Opportunity
→ Verification
→ Score
→ AI
→ Alert
→ Web
→ User action

Test both:
- NFT/free mint path
- token path

## Phase 12 — MVP hardening

Tasks:
- logging
- health checks
- retries
- rate limits
- validation
- authorization
- docs
- deployment preparation

Do not add commercial features yet.
