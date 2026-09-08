import { Prisma, type Opportunity, type PrismaClient } from "@alpharadar/database";
import type { ActionProfile, OpportunityType } from "@alpharadar/types";

/**
 * 08-ENGINEERING-REVIEW-AND-CORRECTIONS.md §4.5 — every status except
 * COMPLETED and EXPIRED counts as "open" for dedup purposes. A COMPLETED
 * or EXPIRED opportunity does not block a new one on the same contract
 * (e.g. a whitelist phase completing doesn't block a later public-mint
 * phase). This must match the migration's partial unique index exactly —
 * see packages/database/prisma/migrations/20260907162851_opportunity_contract_dedup.
 */
const OPEN_STATUSES = ["DETECTED", "VERIFYING", "ACTIVE", "UPCOMING", "REJECTED"] as const;

export interface OpportunityDedupKey {
  chain: string;
  contractAddress: string;
  type: OpportunityType;
  actionProfile: ActionProfile;
}

export interface FindOrCreateOpportunityInput extends OpportunityDedupKey {
  projectId: string;
  title: string;
  description?: string;
  detectedAt?: Date;
}

type DedupPrisma = Pick<PrismaClient, "opportunity">;

function isUniqueConstraintViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function findOpenMatch(prisma: DedupPrisma, key: OpportunityDedupKey) {
  return prisma.opportunity.findFirst({
    where: {
      chain: key.chain,
      contractAddress: key.contractAddress,
      type: key.type,
      actionProfile: key.actionProfile,
      status: { in: [...OPEN_STATUSES] },
    },
  });
}

/**
 * Idempotent create: at most one open opportunity ever exists per (chain,
 * contractAddress, type, actionProfile). This is what makes reprocessing a
 * block range after a crash safe (09 §11 point 4) — resolve() can run
 * ingest's output through this again and it will find, not duplicate, the
 * opportunity a partially-completed prior attempt already created.
 *
 * Check-then-create has a race window between the read and the write; the
 * database's partial unique index is the real guarantee, not this
 * function's own check. If a concurrent write wins that race, the create
 * fails with P2002 and this refetches and returns whatever won, rather
 * than surfacing the constraint violation as an error — from the caller's
 * perspective this is still "found or created", not a failure.
 */
export async function findOrCreateOpportunity(
  prisma: DedupPrisma,
  input: FindOrCreateOpportunityInput,
): Promise<{ opportunity: Opportunity; created: boolean }> {
  const existing = await findOpenMatch(prisma, input);
  if (existing) {
    return { opportunity: existing, created: false };
  }

  try {
    const created = await prisma.opportunity.create({
      data: {
        projectId: input.projectId,
        chain: input.chain,
        contractAddress: input.contractAddress,
        type: input.type,
        actionProfile: input.actionProfile,
        title: input.title,
        description: input.description,
        detectedAt: input.detectedAt ?? new Date(),
        status: "DETECTED",
      },
    });
    return { opportunity: created, created: true };
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      const winner = await findOpenMatch(prisma, input);
      if (winner) {
        return { opportunity: winner, created: false };
      }
    }
    throw error;
  }
}
