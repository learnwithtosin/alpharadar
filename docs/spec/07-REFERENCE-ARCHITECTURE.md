# AlphaRadar — Reference Architecture

                         ALPHARADAR WEB
       Dashboard / Opportunities / Projects / Wallets
                              |
                              v
                         API / AUTH
                              |
          +-------------------+-------------------+
          |                   |                   |
          v                   v                   v
   Opportunity Engine   Wallet Intelligence   Project Intelligence
          |                   |                   |
          +-------------------+-------------------+
                              |
                       Evidence Store
                              |
                    +---------+---------+
                    |                   |
                    v                   v
              Risk + Scoring       AI Analysis
                    |                   |
                    +---------+---------+
                              |
                         Alert Engine
                              |
                           Telegram
                              |
                             USER
                    +---------+---------+
                    |                   |
                    v                   v
              Official Web/Mint    External Trading Tool
                    |                   |
                    +---------+---------+
                              |
                        User-controlled
                           wallet

## Core rule

The system can observe and analyze.

The user controls financial action.

## Worker pipeline

Discovery
→ normalization
→ deduplication
→ project resolution
→ classification
→ verification
→ evidence
→ AI analysis
→ deterministic scoring
→ alert decision
→ Telegram

## Adapter boundary

AlphaRadar Core
    |
    +-- RobinhoodAdapter (MVP)
    +-- future adapters

Do not leak chain-specific implementation into domain logic.
