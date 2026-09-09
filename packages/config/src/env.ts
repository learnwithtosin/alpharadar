import { z } from "zod";

/**
 * The root .env.example ships every key present but blank (e.g.
 * `AUTH_SECRET=`), and dotenv loads that as an empty string, not as an
 * absent key. An unset-but-present env var must still count as "not
 * configured" for an optional field — otherwise filling in .env.example's
 * scaffolding without a real value turns every optional secret into a
 * hard validation failure. Wrap optional string fields in this so an
 * empty string is treated the same as the key being absent entirely.
 */
function optional(schema: z.ZodString) {
  return z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
}

/**
 * Authoritative source: docs/spec/09-INFRASTRUCTURE-DECISION.md §9.
 * This supersedes docs/spec/05-ENVIRONMENT-CONTRACT.md — REDIS_URL and
 * API_URL are deliberately absent; there is no Redis and no separate API
 * process in this MVP (see docs/decisions/0002-scheduled-polling.md).
 *
 * Most variables are optional at the schema level so that Phase 1 tooling
 * (typecheck, vitest, `prisma generate`) can run in development against an
 * empty or partial .env, without a real Supabase/Telegram/AI credential.
 * They become mandatory only when NODE_ENV=production — see the
 * requireInProduction check below.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  WEB_URL: z.string().url().default("http://localhost:3000"),
  AUTH_SECRET: optional(z.string().min(1)),

  // Supabase Postgres — pooled connection for the app, direct connection
  // for migrations. See packages/database/prisma/schema.prisma.
  DATABASE_URL: optional(z.string().min(1)),
  DIRECT_URL: optional(z.string().min(1)),

  // Pipeline driver — see docs/spec/09-INFRASTRUCTURE-DECISION.md §11.
  RUN_MODE: z.enum(["poll", "stream"]).default("poll"),

  // Robinhood Chain
  ROBINHOOD_RPC_URL: z.string().url().default("https://rpc.mainnet.chain.robinhood.com"),
  ROBINHOOD_WS_URL: optional(z.string().url()),
  ROBINHOOD_CHAIN_ID: z.coerce.number().int().positive().default(4663),
  ROBINHOOD_EXPLORER_API_URL: z.string().url().default("https://robinhoodchain.blockscout.com/api"),
  ROBINHOOD_EXPLORER_URL: z.string().url().default("https://robinhoodchain.blockscout.com"),

  // Telegram
  TELEGRAM_BOT_TOKEN: optional(z.string().min(1)),

  // Pipeline controls
  POLL_BLOCK_CHUNK_SIZE: z.coerce.number().int().positive().default(1000),
  // Discovery scans one block per unbatched eth_getBlockByNumber RPC call,
  // plus one eth_getTransactionReceipt call per contract-creation
  // candidate found (not per transaction) — batching was proven live not
  // to hold up under sustained load (see
  // ChainAdapter.getRecentContractCreations).
  //
  // Sized by budgeting the *whole* run (startup + scan + post-scan),
  // not just the scan, after a 950-block run at total_time/blocks =
  // 246ms/block overran the 300s cron (364s actual) — that figure folded
  // post-scan (verify/score) cost into a per-block rate, which only looks
  // right when candidate count is low; it silently breaks whenever a run
  // finds more candidates. A later 950-block run reported its scan rate
  // directly (305ms/block, from discovery.scan.complete) and its
  // post-scan cost separately (70s for 10 candidates = 7s/candidate),
  // decomposing 364s total as: startup 364s - (950*0.305s = 289.75s
  // scan) - 70s post-scan = 4.25s, rounded up to 5s. Candidate count is
  // bursty (2 vs. 10 across two real runs) so the post-scan term uses the
  // higher observed count (10), not the average (6), as a pessimistic
  // input. Targeting a 240s total (60s/20% margin under the 300s cron,
  // on top of the pessimism already in the 10-candidate assumption):
  //   5s + B*0.305s + 10*7s <= 240s  =>  B <= (240-5-70)/0.305 ~= 541
  // Rounded down to 500 given two consecutive misses on this sizing —
  // worst case at 500 blocks / 10 candidates: 5 + 500*0.305 + 70 = 227.5s
  // (72.5s / 24% margin). A burst past 10 candidates could still overrun;
  // that's bounded by the GitHub Actions concurrency guard (a slow run
  // cancels the next scheduled one rather than racing the checkpoint),
  // not eliminated by sizing. See
  // docs/decisions/0011-discovery-method-switch.md. Cron cadence stays
  // every 5 minutes (docs/spec/09-INFRASTRUCTURE-DECISION.md §8) — this
  // changes how much of that fixed window is used per run, not how often
  // it runs. A run scans only the most recent MAX_BLOCKS_PER_RUN blocks
  // and does not backfill beyond that — see checkpoint.ts's getNextRange.
  MAX_BLOCKS_PER_RUN: z.coerce.number().int().positive().default(500),
  ALERT_MIN_SCORE: z.coerce.number().int().min(0).max(100).default(60),
  ALERT_MAX_PER_USER_PER_HOUR: z.coerce.number().int().positive().default(6),
  // 08 §4.4's dedupe window: "the same project cannot alert twice within N
  // hours for the same actionProfile." N isn't prescribed by the spec —
  // 24h (one alert per project+actionProfile per day) is a judgment call,
  // not derived from data (there's no outcome data to tune it against yet,
  // same caveat as the scoring weights in 08 §4.2). Global, not per-user —
  // it gates whether this content gets sent to anyone again this soon, a
  // separate concern from ALERT_MAX_PER_USER_PER_HOUR's per-recipient cap.
  ALERT_DEDUPE_WINDOW_HOURS: z.coerce.number().int().positive().default(24),

  // AI — off by default per 09 §4 ("Interface built, flag off").
  AI_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  AI_PROVIDER: z.enum(["claude", "openai"]).default("claude"),
  AI_API_KEY: optional(z.string().min(1)),
  AI_MIN_SCORE_TO_ANALYZE: z.coerce.number().int().min(0).max(100).default(70),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Env = z.infer<typeof envSchema>;

function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const env = result.data;

  if (env.NODE_ENV === "production") {
    const missing: string[] = [];
    if (!env.AUTH_SECRET) missing.push("AUTH_SECRET");
    if (!env.DATABASE_URL) missing.push("DATABASE_URL");
    if (!env.DIRECT_URL) missing.push("DIRECT_URL");
    if (!env.TELEGRAM_BOT_TOKEN) missing.push("TELEGRAM_BOT_TOKEN");
    if (env.AI_ENABLED && !env.AI_API_KEY) {
      missing.push("AI_API_KEY (required because AI_ENABLED=true)");
    }
    if (missing.length > 0) {
      throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
    }
  }

  return env;
}

let cachedEnv: Env | undefined;

/**
 * Parses and validates process.env on first call, then caches the result.
 * Deliberately lazy rather than parsed at module load time, so importing
 * this package never throws before an application actually needs the
 * config (e.g. during a type-check or test run with no .env present).
 */
export function getEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (source !== process.env) {
    return parseEnv(source);
  }
  if (!cachedEnv) {
    cachedEnv = parseEnv(source);
  }
  return cachedEnv;
}

/** Clears the cached environment. Test-only. */
export function resetEnvCache(): void {
  cachedEnv = undefined;
}
