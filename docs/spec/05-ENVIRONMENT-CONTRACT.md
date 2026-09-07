# AlphaRadar — Environment Contract

> SUPERSEDED BY 09-INFRASTRUCTURE-DECISION.md §9. Kept for history only — do
> not use this file's variable list. See 09 for the authoritative env
> contract.

Copy this file to `.env.example`.

Never commit a real `.env`.

## Application

NODE_ENV=development

WEB_URL=http://localhost:3000
API_URL=http://localhost:4000

AUTH_SECRET=

## Database

DATABASE_URL=postgresql://postgres:postgres@localhost:5432/alpharadar

## Redis

REDIS_URL=redis://localhost:6379

## Robinhood Chain

ROBINHOOD_RPC_URL=
ROBINHOOD_WS_URL=

# Keep provider credentials separate if using a managed RPC provider.
# Do not hard-code them in source.

## Telegram

TELEGRAM_BOT_TOKEN=

## AI

AI_PROVIDER=claude
AI_API_KEY=

# Provider-specific variables may be added later if required.

## Logging

LOG_LEVEL=info
