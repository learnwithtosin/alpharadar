# AlphaRadar — Project Constitution

Version: 0.1
Status: Authoritative engineering rules

## 1. Mission

AlphaRadar is a Web3 opportunity-intelligence platform.

Its mission is:

> Detect opportunities early, understand them quickly, verify the evidence, and let the user decide.

AlphaRadar is not a custodial wallet, trading bot, copy-trading platform, or autonomous financial agent.

## 2. User control

AlphaRadar may detect, monitor, analyze, score, explain, notify, prepare information, and link to official participation pages.

AlphaRadar must not independently:
- spend money
- sign transactions
- mint
- trade
- transfer funds
- approve token spending
- copy trades

Any future transaction workflow must end with explicit user-controlled wallet confirmation.

## 3. Private keys

The MVP must never request, receive, store, transmit, log, or process:
- seed phrases
- private keys
- wallet passwords

The system is non-custodial.

## 4. Opportunity types

MVP opportunity types:

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

Do not add more types without a concrete MVP requirement.

## 5. Action profiles

Opportunity category and user action are separate.

Every opportunity has an action profile, for example:
- MINT
- QUALIFY
- TRADE_RESEARCH
- CHECK_ELIGIBILITY
- PARTICIPATE
- RESEARCH

Action profiles control the Telegram template, CTA, web layout, and external action.

## 6. NFT flow

For NFTs, WLs, free mints, and raffles:

Telegram → AlphaRadar → research/verification → official participation page → user decides.

AlphaRadar does not perform the mint.

## 7. Token flow

For token launches, memecoins, and utility tokens:

The Telegram alert must expose the full contract address.

The user may copy the CA into their preferred external trading tool.

AlphaRadar provides intelligence; it does not execute the trade.

## 8. Evidence

Important claims must be evidence-backed.

Distinguish:
- FACT
- INFERENCE
- AI_INTERPRETATION
- UNKNOWN

If information is unknown, keep it unknown.

Never fabricate missing data.

## 9. AI boundaries

AI may:
- summarize evidence
- assist classification
- synthesize evidence
- explain risks
- produce concise natural-language analysis

AI must not:
- invent contract addresses
- invent official links
- override blockchain facts
- guarantee profit
- execute transactions
- authorize financial actions
- fabricate social proof

Deterministic data wins over AI output.

## 10. Risk versus score

Score measures opportunity attractiveness.

Risk measures potential downside or uncertainty.

A high score can coexist with high risk.

Never imply that a high score means safety or profitability.

## 11. Smart wallets

Smart-wallet intelligence is a signal, not a trading instruction.

Do not use language such as:
- BUY NOW
- COPY THIS WALLET
- GUARANTEED WIN
- GUARANTEED PROFIT

Prefer:
- Smart-wallet signal detected
- Tracked wallet interacted
- Historical signal strength
- Early interaction detected

## 12. No manufactured FOMO

Urgency may be shown when factually supported by deadlines or timing.

Do not manufacture scarcity or pressure.

## 13. X/social automation

Do not bypass platform restrictions.

No browser automation, automated likes, mass follows, spam replies, or other prohibited engagement.

If an opportunity requires a restricted social action, AlphaRadar can explain/link to it; the user performs the action manually.

## 14. External links

External links are untrusted until verified.

Use:
- OFFICIAL
- LIKELY_OFFICIAL
- UNVERIFIED
- SUSPICIOUS

Cross-check websites, socials, documentation, and contracts before marking a link official.

## 15. Telegram

Telegram is the fast delivery/control layer.

The web app is the research/intelligence layer.

Telegram alerts should be concise. AlphaRadar pages should be comprehensive.

## 16. Alert quality

Optimize for useful alerts, not maximum alerts.

Every alert should answer:
- What happened?
- Why does it matter?
- How urgent is it?
- What is the risk?
- What should I open?

## 17. Chain architecture

Robinhood Chain is the first chain adapter.

Core architecture must allow future adapters without implementing them in MVP.

Conceptually:

AlphaRadar Core
- RobinhoodAdapter
- BaseAdapter
- ArbitrumAdapter
- EthereumAdapter
- SolanaAdapter

Do not build future adapters during MVP.

## 18. Deterministic first

Use deterministic systems for:
- blockchain facts
- contract addresses
- timestamps
- transaction hashes
- balances
- liquidity
- holders
- URLs
- duplicate detection
- opportunity state
- deadlines
- scoring
- alert thresholds

Use AI where synthesis or natural-language reasoning adds value.

## 19. Modular architecture

Keep clear boundaries between:
- Discovery
- Verification
- Classification
- AI Analysis
- Scoring
- Wallet Intelligence
- Alerting
- API
- Frontend

## 20. No gold-plating

Do not build during MVP:
- billing
- mobile app
- copy trading
- automated farming
- multi-wallet farming
- custodial wallet
- complex social network
- multi-chain ingestion
- advanced portfolio management

## 21. Speed

AlphaRadar is an early-detection system.

Optimize for:
- low ingestion latency
- fast normalization
- fast classification
- fast scoring
- fast notification

Do not sacrifice basic verification merely to shave off negligible latency.

## 22. Security

Security beats convenience.

Never weaken the security model for a shortcut.

## 23. Build order

Amended 2026-09-07 (see docs/decisions/0007-vertical-slice-build-order.md):
§23 lists the components of the system and their dependency order. It is not
a strict phase gate. Where a vertical slice ships a later-numbered component
before an earlier one, the ordering constraint that survives is dependency,
not numbering — nothing may be built on top of something that does not exist
yet. The AI analysis component may be built with its live invocation
deferred, as recorded in 09 §4.

1. Repository foundation
2. Database
3. Robinhood adapter
4. Ingestion
5. Opportunity model
6. Verification
7. Scoring
8. AI analysis
9. Telegram
10. Web dashboard
11. Opportunity detail pages
12. Wallet intelligence
13. End-to-end tests

## 24. North-star metric

The MVP succeeds when:

> AlphaRadar consistently surfaces useful opportunities early enough for the user to act on them.

Core loop:

DETECT → VERIFY → UNDERSTAND → SCORE → ALERT → USER DECIDES
