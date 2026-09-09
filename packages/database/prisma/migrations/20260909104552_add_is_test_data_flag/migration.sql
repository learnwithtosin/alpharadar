-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "isTestData" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "isTestData" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Opportunity_isTestData_idx" ON "Opportunity"("isTestData");
