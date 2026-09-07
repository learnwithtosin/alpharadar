# AlphaRadar — Master Claude Build Prompt

You are the principal engineer responsible for implementing AlphaRadar.

Read these files before changing code:

1. `01-PROJECT-CONSTITUTION.md`
2. `02-MVP-TECHNICAL-SPECIFICATION.md`
3. `04-IMPLEMENTATION-PLAN.md`
4. `05-ENVIRONMENT-CONTRACT.md`

These documents are authoritative.

## Your role

Build a production-minded but lean MVP.

Do not redesign the product.

Do not add speculative features.

Do not replace the architecture unless you identify a concrete technical blocker.

If something is genuinely ambiguous, choose the simplest implementation consistent with the constitution and document the decision.

## Product definition

AlphaRadar is a Web3 opportunity-intelligence platform initially focused on Robinhood Chain.

Core loop:

DETECT → VERIFY → UNDERSTAND → SCORE → ALERT → USER DECIDES

There are different user flows.

NFT/WL/free mint/raffle:
Telegram alert → AlphaRadar research page → official participation/mint page → user decides.

Token/memecoin/utility token:
Telegram alert includes FULL contract address → user copies it into their preferred external trading tool → AlphaRadar provides intelligence.

AlphaRadar never stores private keys and never autonomously spends user funds.

## Engineering rules

1. TypeScript everywhere practical.
2. Keep frontend and backend separated.
3. Keep blockchain access behind an adapter.
4. Keep AI behind a provider interface.
5. Keep scoring deterministic.
6. Keep background processing in workers/queues.
7. Validate external inputs.
8. Validate AI outputs with schemas.
9. Store evidence for important claims.
10. Make jobs idempotent.
11. Never put secrets in source control.
12. Do not build future features merely because they are architecturally interesting.

## Before coding

Inspect the repository.

If the repository is empty, initialize the monorepo according to the specification.

If files already exist, preserve useful existing work and adapt it instead of destroying it.

First report:
- current repository state
- existing stack
- relevant existing files
- conflicts with the AlphaRadar specification
- exact implementation phase you will begin

Then implement Phase 1 only.

## Phase 1 implementation order

### Step 1 — Monorepo foundation

Create:
- pnpm workspace
- apps/web
- apps/api
- workers
- packages
- prisma
- docs

Add:
- TypeScript
- linting
- formatting
- basic test setup
- environment validation

The repository must run cleanly.

### Step 2 — Database

Implement the Prisma schema from the specification.

Include:
- enums
- relations
- indexes
- timestamps
- uniqueness constraints

Run:
- Prisma formatting
- validation
- migration generation/application as appropriate

Do not create unnecessary tables.

### Step 3 — Shared types

Create shared domain types for:
- OpportunityType
- ActionProfile
- OpportunityStatus
- Urgency
- RiskLevel
- VerificationStatus
- SourceType
- WalletSignalType

Avoid duplicated string literals across apps.

### Step 4 — Robinhood Chain adapter

Implement a chain abstraction.

Create Robinhood Chain adapter using viem.

Implement the minimum needed for:
- chain metadata
- blocks
- logs
- transactions
- receipts
- contract code

Keep provider configuration environment-driven.

Do not implement a full node.

Do not implement other chains.

### Step 5 — Ingestion

Implement a basic event ingestion worker.

It must:
- connect
- receive events
- normalize events
- persist relevant raw signal information
- deduplicate
- enqueue downstream work

Do not attempt to identify every possible NFT/token opportunity immediately.

Start with reliable signals that can be tested.

### Step 6 — Opportunity pipeline

Implement:
- signal normalization
- project resolution
- opportunity creation
- opportunity lifecycle
- deduplication

Create deterministic tests.

### Step 7 — Verification

Implement evidence/source models and basic verification.

Do not label random URLs official.

At minimum support:
- URL normalization
- source persistence
- contract association
- basic cross-reference structure

### Step 8 — Scoring

Implement deterministic scoring.

Score must be explainable.

Store score inputs or enough metadata to reproduce the score.

Risk must be separate from score.

### Step 9 — AI

Implement an AI provider interface.

Do not tightly couple domain logic to Claude/OpenAI.

Input:
structured evidence bundle.

Output:
validated structured analysis.

If AI is unavailable, the rest of the system must continue functioning. AI should enhance an opportunity, not make the database unusable.

### Step 10 — Telegram

Implement:
- bot connection/start flow
- account linking
- alert delivery
- NFT alert template
- token alert template
- alert persistence

Token alerts MUST expose the full contract address.

NFT alerts MUST send the user toward AlphaRadar.

### Step 11 — Web

Implement the minimum functional dashboard.

Prioritize:
- opportunities
- opportunity details
- token details
- NFT details
- alert history
- wallet connection/read-only address
- settings

Do not spend excessive time on visual polish before the data flow works.

### Step 12 — Smart wallets

Implement basic read-only wallet tracking and wallet signals.

Do not implement copy trading.

Use conservative terminology.

## AI contract

Use a schema such as:

{
  summary: string,
  classification: string,
  keyReasons: string[],
  risks: string[],
  confidence: number,
  recommendedActionProfile: string
}

The model must be told that it cannot invent facts.

Only include claims supported by the evidence bundle.

## Telegram templates

NFT:

🎨 NEW FREE MINT

Project: <name>
Chain: Robinhood Chain
Mint: FREE
Status: LIVE
Score: <score>/100
Risk: <risk>
Urgency: <urgency>

Why it matters:
• <reason>
• <reason>

👉 Open on AlphaRadar

Token:

🪙 NEW TOKEN SIGNAL

<token> / <ticker>
Chain: Robinhood Chain

CA:
<full contract address>

Score: <score>/100
Risk: <risk>
Liquidity: <value if known>
Detected: <time>

Smart-wallet signal:
<signal if available>

⚠️ NFA: Informational analysis only. No outcome or profit is guaranteed. DYOR.

👉 Open AlphaRadar

Never shorten the contract in the actual alert.

## Error handling

Do not swallow errors.

Use structured errors/logs.

For workers:
- retry transient failures
- avoid retrying permanent validation failures forever
- make jobs idempotent
- log job ID and relevant domain IDs

## Security review before completion

Confirm:
- no secret committed
- no private key field
- no seed phrase field
- no transaction signing
- no automatic spending
- no X browser automation
- user-scoped API authorization exists
- webhook/input validation exists
- AI output validation exists

## Testing

At minimum test:
- opportunity classification
- opportunity deduplication
- score calculation
- risk calculation
- action profile selection
- token alert rendering
- NFT alert rendering
- contract address validation
- wallet address validation
- AI schema validation
- unauthorized resource access

## Documentation

Update README with:
- what AlphaRadar is
- architecture
- local setup
- environment variables
- database setup
- running web/API/workers
- testing
- current MVP limitations

Also create/update:
- docs/architecture/overview.md
- docs/decisions/0001-mvp-architecture.md

## Completion report

When a phase is complete, report:

1. What was implemented.
2. Files created/changed.
3. Commands run.
4. Tests passed.
5. Known limitations.
6. Anything requiring a human credential/API key.
7. Recommended next phase.

Do not claim something works if it has not been tested.

## Important

Do not implement prohibited autonomous financial actions.

Do not implement prohibited X automation.

Do not add copy trading.

Do not request private keys.

Do not turn AlphaRadar into a generic crypto dashboard.

Build the opportunity-detection loop first.
