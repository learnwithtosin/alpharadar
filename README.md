# AlphaRadar

Web3 opportunity-intelligence platform. From the project constitution
(`docs/spec/01-PROJECT-CONSTITUTION.md`):

> Detect opportunities early, understand them quickly, verify the
> evidence, and let the user decide.

AlphaRadar watches a chain for new contract deployments (NFT mints, ERC-20
launches), scores them deterministically, classifies their risk from what's
actually verifiable on-chain, and alerts a Telegram subscriber — before the
crowd notices. It is **not** a custodial wallet, trading bot, copy-trading
platform, or autonomous financial agent, and never becomes one: it never
spends money, signs a transaction, mints, trades, transfers funds, approves
token spending, or copies a trade. It never requests, receives, stores,
transmits, or logs a seed phrase, private key, or wallet password. Every
signal is informational — not financial advice.

## Architecture

A pnpm monorepo, four workspaces:

```
apps/pipeline   scheduled poller — detect, verify, score, classify, alert
apps/web        read-only Next.js app — landing page, opportunity list, detail pages
packages/chain      chain adapter (RPC + block explorer), currently Robinhood Chain only
packages/database   Prisma schema + client, shared by pipeline and web
packages/scoring    the deterministic 0–100 scoring function
packages/telegram   Telegram Bot API client + alert templates
packages/types      shared enums/types, hand-kept in sync with the Prisma schema
packages/config     env var loading + validation (zod), shared by every app
```

**The pipeline is a scheduled job, not a persistent worker.** Each run
reads a durable `IngestionCheckpoint`, scans the most recent
`MAX_BLOCKS_PER_RUN` blocks for new contract creations, runs them through
ingest → resolve → verify → score → classify → alert, advances the
checkpoint only after every write for that range has committed, and
exits. GitHub Actions cron (every 5 minutes) is the entire "always-on"
story — see `docs/decisions/0002-scheduled-polling.md` for why, and
`docs/spec/09-INFRASTRUCTURE-DECISION.md` §11 for the upgrade path to a
persistent worker when detection lag actually becomes the limiting
factor (a one-line `RUN_MODE` change plus implementing
`StreamingDriver`, not a rewrite).

**apps/web is read-only.** It queries the same Postgres database directly
(no separate API layer) and renders three pages: a landing page with real
capability stats, an opportunities list, and a per-opportunity detail
page with the full evidence trail. It never writes to the database and
never talks to the chain directly.

**Delivery is Telegram-only.** A user runs `/start` with the bot, which
creates their identity from their Telegram user ID (no email/password
required — see `docs/decisions/0004-telegram-first-identity.md`); alerts
then arrive as Telegram messages, gated by a minimum score, a per-user
hourly cap, a dedupe window, and an outright risk veto.

## Local setup

Requires Node ≥20 and pnpm (pinned to `9.15.9` via the root
`package.json`'s `packageManager` field — `corepack enable` will pick
this up automatically).

```bash
git clone git@github.com:learnwithtosin/alpharadar.git
cd alpharadar
pnpm install
cp .env.example .env        # then fill in real values — see below
pnpm db:generate
pnpm db:migrate              # applies the schema to your database
```

## Environment variables

Authoritative source: `docs/spec/09-INFRASTRUCTURE-DECISION.md` §9,
mirrored in `.env.example`. Everything is optional at the schema level in
development (so `typecheck`/`test`/`prisma generate` run without a real
credential) and becomes required once `NODE_ENV=production`.

| Variable                                                                      | Purpose                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                | Pooled Postgres connection (Supabase, port 6543, `pgbouncer=true`). Required at runtime by every app.                                                                                                                             |
| `DIRECT_URL`                                                                  | Direct Postgres connection (port 5432), used only by `prisma migrate`.                                                                                                                                                            |
| `RUN_MODE`                                                                    | `poll` (only implemented mode) or `stream` (the future upgrade — throws `NotImplementedError` today).                                                                                                                             |
| `ROBINHOOD_RPC_URL`                                                           | Chain RPC endpoint. **Treat as a secret if it embeds a provider API key in the URL** (e.g. an Alchemy key) — it isn't a separate credential field, it's part of the URL itself.                                                   |
| `ROBINHOOD_WS_URL`                                                            | Unused while `RUN_MODE=poll`.                                                                                                                                                                                                     |
| `ROBINHOOD_CHAIN_ID`, `ROBINHOOD_EXPLORER_API_URL`, `ROBINHOOD_EXPLORER_URL`  | Chain identity + block-explorer endpoints. Safe defaults ship in `.env.example`.                                                                                                                                                  |
| `TELEGRAM_BOT_TOKEN`                                                          | From `@BotFather`. Required for alerts to actually send — the pipeline still runs and completes without it, recording every would-be delivery as `FAILED` rather than crashing.                                                   |
| `WEB_URL`                                                                     | The deployed web app's real `https://` URL. Telegram won't accept a `localhost` link, so the alert's "view detail page" button is correctly omitted, not broken, until this is set to a real public URL.                          |
| `POLL_BLOCK_CHUNK_SIZE`, `MAX_BLOCKS_PER_RUN`                                 | Discovery tuning. `MAX_BLOCKS_PER_RUN=500` is sized against a 5-minute cron and a real measured RPC throughput rate — see `docs/decisions/0011-discovery-method-switch.md` before changing either.                                |
| `ALERT_MIN_SCORE`, `ALERT_MAX_PER_USER_PER_HOUR`, `ALERT_DEDUPE_WINDOW_HOURS` | Alert-rule thresholds.                                                                                                                                                                                                            |
| `AI_ENABLED`, `AI_PROVIDER`, `AI_API_KEY`, `AI_MIN_SCORE_TO_ANALYZE`          | AI analysis stage — **off by default**; the interface exists, the flag doesn't run it (`docs/spec/09` §4).                                                                                                                        |
| `AUTH_SECRET`                                                                 | Not currently read anywhere in the app (web login doesn't exist yet — Telegram is the only identity, per decision 0004). Required to be non-empty only when `NODE_ENV=production`, provisioned for the eventual web-auth upgrade. |
| `LOG_LEVEL`                                                                   | `debug` \| `info` \| `warn` \| `error`.                                                                                                                                                                                           |

## Running it

```bash
pnpm dev                        # apps/web dev server, http://localhost:3000
pnpm pipeline                   # one pipeline run, end to end, then exits
pnpm typecheck && pnpm test && pnpm lint   # from repo root, covers every workspace
pnpm format                     # prettier --write
```

Dev-only tooling (never invoked by the real pipeline or any deployment):

```bash
pnpm seed-test-opportunity      # creates one isTestData:true opportunity for local UI/alert testing
pnpm send-alert <opportunityId> # runs the real alert() stage against any opportunity id on demand
pnpm bot                        # long-polls Telegram locally for /start, /settings, /stop
```

## Deployment

- **apps/web** deploys to Vercel — see the exact env-var list above; set
  every one of them in the Vercel project's Environment Variables (a few,
  like `TELEGRAM_BOT_TOKEN`/`AUTH_SECRET`, aren't read by the web app
  itself but are harmless to set for parity with `.env`).
- **apps/pipeline** runs as a scheduled GitHub Actions workflow
  (`.github/workflows/pipeline.yml`), cron `*/5 * * * *` plus
  `workflow_dispatch` for a manual trigger. Secrets
  (`DATABASE_URL`, `DIRECT_URL`, `ROBINHOOD_RPC_URL`, `TELEGRAM_BOT_TOKEN`,
  `AUTH_SECRET`) live in the repo's GitHub Actions secrets — **never** in
  the workflow file itself, since this repository is public. A failed run
  fails the whole job (non-zero exit, no swallowed errors) — visible as a
  red run in the Actions tab, and GitHub's own default behavior emails
  the triggering account on a failed scheduled workflow. That's the
  entire alerting mechanism for "the poller died," deliberately: the
  stack is $0/month, and a second notification channel isn't free.

## Current MVP limitations

Disclosed here rather than discovered later:

- **Detection lag is 0–15 minutes, not real-time.** A 5-minute poll, best-effort
  under GitHub Actions platform load. See `docs/decisions/0002-scheduled-polling.md`
  for the accepted trade-off (zero cost vs. a persistent worker).
- **Detection is sampled, not exhaustive.** Each run scans only the most
  recent `MAX_BLOCKS_PER_RUN` blocks; if the pipeline falls behind by more
  than that window, the gap is **permanently skipped**, not backfilled —
  see `apps/pipeline/src/checkpoint.ts`'s `getNextRange`.
- **Opportunity status never transitions.** Every real opportunity is
  created with `status: DETECTED` and nothing currently moves it to
  `ACTIVE`, `COMPLETED`, `EXPIRED`, or `REJECTED` — see
  `docs/decisions/0021-opportunity-status-inert.md`. The web app's
  live/closed split (`docs/decisions/0019`) is wired correctly but is a
  no-op against today's data until a re-check mechanism exists.
- **Only 3 of 6 risk dimensions are actually computed.** `contractRisk`,
  `deployerRisk`, and `concentrationRisk` are real; `liquidityRisk` and
  `socialRisk` are permanently `UNKNOWN` by design, `linkRisk` is
  partial — see `docs/decisions/0006-risk-and-token-page-unknowns.md`.
  The app never guesses a value it hasn't verified.
- **AI analysis is built but disabled by default** (`AI_ENABLED=false`).
  The interface and prompt scaffolding exist; nothing calls it in the
  MVP.
- **Single chain.** Robinhood Chain only — `ChainAdapter` is an interface
  specifically so a second chain is an additive implementation, not a
  rewrite.
- **Telegram is the only delivery channel and the only identity.** No
  email/password login, no other notification channel.
- **No automated re-verification.** Contract verification, deployer
  history, and holder concentration are all snapshotted once, at
  detection time — nothing re-checks them later.
