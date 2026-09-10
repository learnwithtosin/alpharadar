// Side effect: loads the repo-root .env into process.env before the
// DATABASE_URL check below runs. Every consumer of this module gets this
// for free — no per-app dotenv wiring required.
import "@alpharadar/config";
// Imported from the generated client's own path, not the "@prisma/client"
// package — see schema.prisma's generator comment and
// docs/decisions/0023-vercel-missing-engine-and-web-retry-budget.md. The
// default output location is hoisted into pnpm's virtual store, which
// Next.js's build-time file tracer does not reliably walk; this custom
// path is a real, fixed directory inside this package that
// outputFileTracingIncludes (apps/web/next.config.ts) can name explicitly.
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
 * Single shared Prisma client. apps/pipeline runs as a short-lived scheduled
 * process (docs/decisions/0002-scheduled-polling.md) — this global cache
 * only matters for apps/web, where Next.js dev-mode module reloading would
 * otherwise open a new connection pool on every hot reload.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "../generated/client/index.js";
export { withDbRetry } from "./db-retry.js";
