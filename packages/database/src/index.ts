import { PrismaClient } from "@prisma/client";

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

export * from "@prisma/client";
