-- AlterTable
ALTER TABLE "IngestionCheckpoint" ADD COLUMN     "totalBlocksScanned" BIGINT NOT NULL DEFAULT 0;
