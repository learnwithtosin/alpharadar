-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN "chain" TEXT,
ADD COLUMN "contractAddress" TEXT;

-- CreateIndex (plain, non-unique — query performance only)
CREATE INDEX "Opportunity_chain_contractAddress_idx" ON "Opportunity"("chain", "contractAddress");

-- CreateIndex (partial unique — the actual dedup constraint, 08 §4.5)
--
-- Prisma's schema DSL cannot express a WHERE clause on @@unique, so this is
-- hand-written rather than generated. Enforces: at most one OPEN
-- opportunity per (chain, contractAddress, type, actionProfile). A
-- COMPLETED or EXPIRED opportunity does not occupy this constraint, so a
-- new opportunity can be created on the same contract once the prior one
-- has concluded — e.g. a whitelist phase completing does not block a later
-- public-mint phase on the same contract.
--
-- Rows with a NULL chain or contractAddress (opportunities with no single
-- contract to anchor to, e.g. a manually-entered off-chain opportunity per
-- docs/decisions/0003) are excluded by the WHERE clause and are never
-- deduplicated by this constraint — Postgres would not collide NULLs
-- against each other anyway (NULL <> NULL for uniqueness purposes), but
-- the explicit IS NOT NULL guard keeps the intent legible.
CREATE UNIQUE INDEX "Opportunity_open_dedup_key" ON "Opportunity"("chain", "contractAddress", "type", "actionProfile")
WHERE "chain" IS NOT NULL AND "contractAddress" IS NOT NULL AND "status" NOT IN ('COMPLETED', 'EXPIRED');
