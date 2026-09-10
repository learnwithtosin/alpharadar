// Side effect: loads the repo-root .env into process.env before the
// DATABASE_URL check below runs. Every consumer of this module gets this
// for free — no per-app dotenv wiring required.
import "@alpharadar/config";
import { PrismaPg } from "@prisma/adapter-pg";
// Imported from the generated client's own path, not the "@prisma/client"
// package — see schema.prisma's generator comment and
// docs/decisions/0023-vercel-missing-engine-and-web-retry-budget.md.
import { PrismaClient } from "../generated/client/index.js";

/**
 * PrismaClient itself only reads DATABASE_URL lazily, at the first query —
 * so without this check, a missing variable surfaces as a raw Prisma error
 * deep inside whatever the app happened to be doing, not at startup. Fail
 * loudly and immediately instead, naming the variable.
 */
if (!process.env.DATABASE_URL) {
  throw new Error(
    "Missing required environment variable: DATABASE_URL. Set it in the " +
      "repo-root .env (copy .env.example if you haven't) before starting " +
      "anything that touches the database.",
  );
}

/**
 * `@prisma/adapter-pg` doesn't read `connection_limit`/`pool_timeout` off
 * the connection string the way Prisma's own native engine did — those
 * become plain `pg.Pool` options (`max`, `connectionTimeoutMillis`)
 * instead (confirmed against Prisma's own connection-pool mapping docs).
 * Parsed out of DATABASE_URL here, rather than switched to new
 * dedicated env vars, specifically so the per-deployment values already
 * set by decision 0023 — connection_limit=5 in apps/pipeline's GitHub
 * Actions secret, =1 in apps/web's Vercel dashboard var — keep working
 * unchanged; neither needs to be touched again for this migration.
 * `pgbouncer=true` stays in the string passed to the adapter unmodified
 * — Prisma's own current PgBouncer-with-driver-adapters documentation
 * keeps it there verbatim, so it isn't a dead leftover from the old
 * native-engine setup.
 */
const databaseUrl = new URL(process.env.DATABASE_URL);
const connectionLimit = databaseUrl.searchParams.get("connection_limit");
const poolTimeoutSeconds = databaseUrl.searchParams.get("pool_timeout");

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
  ...(connectionLimit ? { max: Number(connectionLimit) } : {}),
  ...(poolTimeoutSeconds ? { connectionTimeoutMillis: Number(poolTimeoutSeconds) * 1000 } : {}),
});

/**
 * Single shared Prisma client. apps/pipeline runs as a short-lived scheduled
 * process (docs/decisions/0002-scheduled-polling.md) — this global cache
 * only matters for apps/web, where Next.js dev-mode module reloading would
 * otherwise open a new connection pool on every hot reload.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "../generated/client/index.js";
export { withDbRetry } from "./db-retry.js";
