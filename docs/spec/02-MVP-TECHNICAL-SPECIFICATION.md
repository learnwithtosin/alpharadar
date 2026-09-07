# AlphaRadar — MVP Technical Specification

Version: 0.1
Primary chain: Robinhood Chain
Primary notification channel: Telegram
Primary interface: Web

## 1. Product

AlphaRadar detects, verifies, classifies, scores, and explains Web3 opportunities as early as possible.

Core pipeline:

DISCOVER
→ VERIFY
→ CLASSIFY
→ ANALYZE
→ SCORE
→ ALERT
→ USER DECIDES

## 2. MVP opportunity priorities

Priority order:
1. NFT whitelist/allowlist
2. Free mints
3. Giveaways/raffles
4. Token airdrops
5. Testnets/points campaigns
6. DeFi
7. New token launches
8. Early-user rewards

Initial implementation should prioritize the highest-value categories first, while keeping the data model capable of representing all MVP categories.

## 3. Required opportunity types

- NFT_MINT
- NFT_WHITELIST
- FREE_MINT
- RAFFLE
- TOKEN_LAUNCH
- MEMECOIN
- UTILITY_TOKEN
- AIRDROP
- TESTNET
- DEFI

## 4. Action profiles

- MINT
- QUALIFY
- TRADE_RESEARCH
- CHECK_ELIGIBILITY
- PARTICIPATE
- RESEARCH

NFT/WL/free mint/raffle:
Telegram → AlphaRadar → analysis → official action page.

Token:
Telegram → full CA → user's external trading tool; AlphaRadar provides research.

## 5. Recommended stack

Frontend:
- Next.js
- React
- TypeScript
- Tailwind CSS

Backend:
- Node.js
- TypeScript
- Fastify

Database:
- PostgreSQL
- Prisma

Jobs:
- Redis
- BullMQ

Blockchain:
- viem
- Robinhood Chain RPC/WebSocket/provider

Notifications:
- Telegram Bot API

AI:
- provider abstraction supporting Claude and/or OpenAI

Monorepo:
- pnpm workspaces
- Turborepo optional

Do not hard-pin package versions in this document. Use current compatible stable versions during implementation and record the selected versions in package.json/lockfile.

## 6. Repository

alpharadar/
- apps/web
- apps/api
- workers/ingestion
- workers/analysis
- workers/scoring
- workers/alerts
- workers/wallet-intelligence
- packages/database
- packages/blockchain
- packages/ai
- packages/scoring
- packages/telegram
- packages/types
- packages/config
- prisma
- docs
- scripts
- docker-compose.yml
- package.json
- pnpm-workspace.yaml
- turbo.json
- .env.example
- README.md

## 7. Database

### User
id, email, passwordHash/authProvider, createdAt, updatedAt

### UserSettings
id, userId, telegramEnabled, minimumScore, enabledOpportunityTypes, createdAt, updatedAt

### TelegramAccount
id, userId, telegramUserId, chatId, username, isActive, createdAt, updatedAt

### Wallet
id, userId, address, chain, label, isPrimary, createdAt

### Project
id, name, slug, description, chain, projectType, status, websiteUrl, logoUrl, createdAt, updatedAt

### ProjectSocial
id, projectId, platform, url, verificationStatus, verificationConfidence

### Contract
id, projectId, address, chain, contractType, verified, deployerAddress, deployedAt, metadata, createdAt

### Opportunity
id, projectId, type, actionProfile, title, description, status, score, riskScore, urgency, detectedAt, startsAt, endsAt, entryCost, currency, officialActionUrl, createdAt, updatedAt

### OpportunityRequirement
id, opportunityId, description, requirementType, required, sourceUrl

### OpportunityEvent
id, opportunityId, eventType, payload, detectedAt

### Source
id, type, url, title, publisher, retrievedAt, reliabilityScore

### Evidence
id, opportunityId, sourceId, claim, evidenceType, confidence, createdAt

### RiskAssessment
id, opportunityId, overallRisk, contractRisk, liquidityRisk, socialRisk, linkRisk, deployerRisk, concentrationRisk, reasons, createdAt

### AIAnalysis
id, opportunityId, model, summary, classification, reasoning, risks, confidence, generatedAt

### WalletActivity
id, walletId, chain, transactionHash, timestamp, activityType, contractAddress, tokenAddress, value, metadata

### WalletSignal
id, walletId, opportunityId, signalType, strength, evidence, detectedAt

### Alert
id, opportunityId, userId, channel, alertType, sentAt, deliveryStatus

### Participation
id, userId, opportunityId, status, notes, createdAt, updatedAt

Use enums where appropriate. Use JSON/JSONB only for genuinely variable metadata.

Add indexes for:
- opportunity status/type/detectedAt
- contract chain/address
- wallet chain/address
- wallet activity timestamp
- alert userId/sentAt
- source URL
- evidence opportunityId
- opportunity projectId

Prevent duplicate chain+contract combinations where appropriate.

## 8. Blockchain adapter

Create a chain-agnostic interface such as:

ChainAdapter:
- getChainMetadata()
- subscribeToBlocks()
- subscribeToLogs()
- getTransaction()
- getReceipt()
- getContractCode()
- getBlock()
- getAddressBalance()

RobinhoodAdapter implements it.

Do not scatter Robinhood-specific RPC calls throughout application modules.

## 9. Ingestion

Initial sources:
1. Robinhood Chain on-chain events
2. permitted public/social/web signals

Ingestion should:
- capture raw signal
- normalize it
- deduplicate it
- resolve project/contract where possible
- enqueue downstream work

Never perform AI analysis directly inside the ingestion process.

## 10. Opportunity lifecycle

- DETECTED
- VERIFYING
- ACTIVE
- UPCOMING
- EXPIRED
- REJECTED
- COMPLETED

Use explicit lifecycle state rather than scattered booleans.

## 11. Verification

Cross-check:
- website
- X/social
- docs
- Discord/Telegram
- contract
- deployer
- blockchain activity

Link states:
- OFFICIAL
- LIKELY_OFFICIAL
- UNVERIFIED
- SUSPICIOUS

Store evidence.

## 12. Scoring

MVP score: 0–100.

Suggested deterministic components:
- legitimacy: 0–25
- opportunity value: 0–20
- freshness: 0–20
- on-chain signal: 0–15
- smart-wallet signal: 0–10
- urgency: 0–10

Risk is separate.

Suggested urgency:
- CRITICAL
- HIGH
- MEDIUM
- LOW

The scoring implementation must be deterministic, testable, and documented.

## 13. AI

AI receives a structured evidence bundle.

Example input concept:

{
  opportunity,
  project,
  contracts,
  evidence[],
  riskAssessment,
  walletSignals[]
}

AI returns structured data, not arbitrary prose only.

Suggested output:
- summary
- classification
- keyReasons[]
- risks[]
- confidence
- recommendedActionProfile

AI cannot create unsupported facts.

Validate AI output against a schema before storing it.

## 14. Telegram

User flow:
1. User opens bot.
2. User starts bot.
3. Backend associates Telegram chat/user with AlphaRadar account.
4. Alerts are sent according to settings.

NFT/free mint alert:
- project
- chain
- status
- cost
- score
- risk
- urgency
- deadline
- key reasons
- AlphaRadar link

Token alert:
- token/ticker
- chain
- FULL contract address
- score
- risk
- liquidity when known
- detection time
- smart-wallet signal when known
- AlphaRadar link
- concise NFA notice

Do not rely on Telegram's UI to provide a clipboard action that may not exist. Always expose the actual address in the message and provide a copy button on the web page.

## 15. Web pages

Required:
- /
- /login
- /dashboard
- /opportunities
- /opportunities/[id]
- /projects/[id]
- /wallets
- /wallets/[address]
- /alerts
- /settings

Dashboard sections:
- Critical Opportunities
- Latest Opportunities
- Smart Wallet Signals
- NFT/Mint Opportunities
- Token Signals
- WL/Raffles
- Airdrops
- Testnets

## 16. NFT detail page

Show:
- project
- mint status
- price
- supply
- minted/remaining when available
- WL/public status
- deadline
- requirements
- contract
- official links and verification status
- smart-wallet signals
- risk
- score
- AI analysis
- official mint/participation button

## 17. Token detail page

Show:
- token name/ticker
- full contract
- chain
- liquidity
- volume
- holder count
- holder concentration
- deployer
- contract verification
- deployer history when available
- official links
- smart-wallet activity
- risk
- score
- AI analysis
- copy contract button

## 18. Smart wallet intelligence

Read-only tracking.

Do not copy trades.

Wallet reputation can use:
- early-entry consistency
- historical performance
- risk-adjusted performance
- transaction count
- wallet age
- holding behavior
- cross-project consistency
- manipulation/sybil indicators

A single profitable trade is insufficient to label a wallet smart.

## 19. Workers

Ingestion worker:
- chain/social signals
- raw storage
- normalization

Opportunity worker:
- classification
- deduplication
- project resolution

Verification worker:
- source verification
- link checks
- contract/deployer checks

Analysis worker:
- evidence bundle
- AI analysis
- schema validation

Scoring worker:
- deterministic score
- risk
- urgency

Wallet worker:
- activity ingestion
- interaction resolution
- reputation
- wallet signals

Alert worker:
- thresholds
- user preferences
- Telegram rendering
- delivery tracking

## 20. Queues

Suggested queue names:
- ingestion
- opportunity-resolution
- verification
- ai-analysis
- scoring
- wallet-intelligence
- alerts

Jobs must be idempotent where possible and retryable.

## 21. Security

Never store:
- private keys
- seed phrases
- wallet passwords

Never:
- sign transactions
- spend funds
- mint automatically
- trade automatically
- copy trade
- automate prohibited social activity

Validate:
- URLs
- contract addresses
- Telegram input
- API payloads
- AI output

Use server-side authorization on all user-scoped endpoints.

## 22. Observability

Required:
- structured logs
- worker failure logs
- retry tracking
- Telegram delivery status
- RPC health
- database health
- Redis health
- /health endpoint

## 23. Environment variables

Minimum expected:
DATABASE_URL
REDIS_URL
ROBINHOOD_RPC_URL
ROBINHOOD_WS_URL
TELEGRAM_BOT_TOKEN
AI_PROVIDER
AI_API_KEY
AUTH_SECRET

Add provider-specific variables only if required.

Never commit secrets.

## 24. Phase 1 acceptance

The user can:
1. create/login
2. connect Telegram
3. add a public wallet
4. see opportunities
5. open an opportunity
6. see evidence
7. see score/risk
8. receive Telegram alert
9. follow NFT flow to official page
10. copy token CA and research it externally
11. see smart-wallet signal when available
12. make the final decision themselves

## 25. Explicit non-goals

No:
- automated X engagement
- automated raffle entry
- automated likes/follows/replies
- automated minting
- automated trading
- copy trading
- multi-wallet farming
- custodial wallet
- billing
- mobile app
- multi-chain ingestion
- complex portfolio management
