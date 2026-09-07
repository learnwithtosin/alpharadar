import { z } from "zod";

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
  AUTH_SECRET: z.string().min(1).optional(),

  // Supabase Postgres — pooled connection for the app, direct connection
  // for migrations. See packages/database/prisma/schema.prisma.
  DATABASE_URL: z.string().min(1).optional(),
  DIRECT_URL: z.string().min(1).optional(),

  // Pipeline driver — see docs/spec/09-INFRASTRUCTURE-DECISION.md §11.
  RUN_MODE: z.enum(["poll", "stream"]).default("poll"),

  // Robinhood Chain
  ROBINHOOD_RPC_URL: z.string().url().default("https://rpc.mainnet.chain.robinhood.com"),
  ROBINHOOD_WS_URL: z.union([z.string().url(), z.literal("")]).optional(),
  ROBINHOOD_CHAIN_ID: z.coerce.number().int().positive().default(4663),
  ROBINHOOD_EXPLORER_API_URL: z.string().url().default("https://robinhoodchain.blockscout.com/api"),
  ROBINHOOD_EXPLORER_URL: z.string().url().default("https://robinhoodchain.blockscout.com"),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1).optional(),

  // Pipeline controls
  POLL_BLOCK_CHUNK_SIZE: z.coerce.number().int().positive().default(1000),
  ALERT_MIN_SCORE: z.coerce.number().int().min(0).max(100).default(60),
  ALERT_MAX_PER_USER_PER_HOUR: z.coerce.number().int().positive().default(6),

  // AI — off by default per 09 §4 ("Interface built, flag off").
  AI_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  AI_PROVIDER: z.enum(["claude", "openai"]).default("claude"),
  AI_API_KEY: z.string().min(1).optional(),
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
