-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OpportunityType" AS ENUM ('NFT_MINT', 'NFT_WHITELIST', 'FREE_MINT', 'RAFFLE', 'TOKEN_LAUNCH', 'MEMECOIN', 'UTILITY_TOKEN', 'AIRDROP', 'TESTNET', 'DEFI');

-- CreateEnum
CREATE TYPE "ActionProfile" AS ENUM ('MINT', 'QUALIFY', 'TRADE_RESEARCH', 'CHECK_ELIGIBILITY', 'PARTICIPATE', 'RESEARCH');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('DETECTED', 'VERIFYING', 'ACTIVE', 'UPCOMING', 'EXPIRED', 'REJECTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('OFFICIAL', 'LIKELY_OFFICIAL', 'UNVERIFIED', 'SUSPICIOUS');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('FACT', 'INFERENCE', 'AI_INTERPRETATION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('WEBSITE', 'TWITTER', 'DISCORD', 'TELEGRAM', 'DOCUMENTATION', 'BLOCKCHAIN_EXPLORER', 'ON_CHAIN', 'MANUAL_ENTRY', 'OTHER');

-- CreateEnum
CREATE TYPE "WalletSignalType" AS ENUM ('EARLY_INTERACTION');

-- CreateEnum
CREATE TYPE "ProjectType" AS ENUM ('NFT_COLLECTION', 'TOKEN', 'DEFI_PROTOCOL', 'OTHER');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('ERC20', 'ERC721', 'ERC1155', 'OTHER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('MINT', 'TRANSFER', 'SWAP', 'CONTRACT_DEPLOYMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "RequirementType" AS ENUM ('SOCIAL_FOLLOW', 'DISCORD_JOIN', 'WALLET_CONNECT', 'MIN_BALANCE', 'WHITELIST_PROOF', 'EMAIL_SIGNUP', 'OTHER');

-- CreateEnum
CREATE TYPE "OpportunityEventType" AS ENUM ('DETECTED', 'VERIFIED', 'SCORED', 'AI_ANALYZED', 'ALERT_SENT', 'STATUS_CHANGED', 'MANUAL_UPDATE', 'OTHER');

-- CreateEnum
CREATE TYPE "ParticipationStatus" AS ENUM ('INTERESTED', 'PARTICIPATING', 'COMPLETED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "AlertChannel" AS ENUM ('TELEGRAM');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('NFT_MINT_ALERT', 'TOKEN_ALERT');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "IngestionRunStatus" AS ENUM ('SUCCESS', 'FAILED', 'PARTIAL');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "telegramEnabled" BOOLEAN NOT NULL DEFAULT true,
    "minimumScore" INTEGER NOT NULL DEFAULT 60,
    "enabledOpportunityTypes" "OpportunityType"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "username" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "label" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "chain" TEXT NOT NULL,
    "projectType" "ProjectType" NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'ACTIVE',
    "websiteUrl" TEXT,
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectSocial" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verificationConfidence" DOUBLE PRECISION,

    CONSTRAINT "ProjectSocial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "contractType" "ContractType" NOT NULL DEFAULT 'UNKNOWN',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "deployerAddress" TEXT,
    "deployedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "OpportunityType" NOT NULL,
    "actionProfile" "ActionProfile" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "OpportunityStatus" NOT NULL DEFAULT 'DETECTED',
    "score" INTEGER,
    "riskScore" INTEGER,
    "urgency" "Urgency",
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "entryCost" DECIMAL(38,18),
    "currency" TEXT,
    "officialActionUrl" TEXT,
    "scoreInputs" JSONB,
    "scoringVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityRequirement" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requirementType" "RequirementType" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sourceUrl" TEXT,

    CONSTRAINT "OpportunityRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityEvent" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "eventType" "OpportunityEventType" NOT NULL,
    "payload" JSONB,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Source" (
    "id" TEXT NOT NULL,
    "type" "SourceType" NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "publisher" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reliabilityScore" DOUBLE PRECISION,

    CONSTRAINT "Source_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "evidenceType" "EvidenceType" NOT NULL,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskAssessment" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "overallRisk" "RiskLevel" NOT NULL DEFAULT 'UNKNOWN',
    "contractRisk" "RiskLevel" NOT NULL DEFAULT 'UNKNOWN',
    "liquidityRisk" "RiskLevel" NOT NULL DEFAULT 'UNKNOWN',
    "socialRisk" "RiskLevel" NOT NULL DEFAULT 'UNKNOWN',
    "linkRisk" "RiskLevel" NOT NULL DEFAULT 'UNKNOWN',
    "deployerRisk" "RiskLevel" NOT NULL DEFAULT 'UNKNOWN',
    "concentrationRisk" "RiskLevel" NOT NULL DEFAULT 'UNKNOWN',
    "reasons" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIAnalysis" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "reasoning" TEXT,
    "risks" TEXT[],
    "confidence" DOUBLE PRECISION,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletActivity" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "activityType" "ActivityType" NOT NULL,
    "contractAddress" TEXT,
    "tokenAddress" TEXT,
    "value" DECIMAL(38,18),
    "metadata" JSONB,

    CONSTRAINT "WalletActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletSignal" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "signalType" "WalletSignalType" NOT NULL,
    "strength" DOUBLE PRECISION,
    "evidence" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "userId" TEXT,
    "targetChatId" TEXT,
    "channel" "AlertChannel" NOT NULL,
    "alertType" "AlertType" NOT NULL,
    "sentAt" TIMESTAMP(3),
    "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "suppressedReason" TEXT,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Participation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "status" "ParticipationStatus" NOT NULL DEFAULT 'INTERESTED',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Participation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestionCheckpoint" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "lastBlockNumber" BIGINT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastRunStatus" "IngestionRunStatus",
    "lastRunError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestionCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramAccount_userId_key" ON "TelegramAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramAccount_telegramUserId_key" ON "TelegramAccount"("telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramAccount_chatId_key" ON "TelegramAccount"("chatId");

-- CreateIndex
CREATE INDEX "Wallet_chain_address_idx" ON "Wallet"("chain", "address");

-- CreateIndex
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");

-- CreateIndex
CREATE INDEX "Project_chain_idx" ON "Project"("chain");

-- CreateIndex
CREATE INDEX "ProjectSocial_projectId_idx" ON "ProjectSocial"("projectId");

-- CreateIndex
CREATE INDEX "Contract_projectId_idx" ON "Contract"("projectId");

-- CreateIndex
CREATE INDEX "Contract_deployerAddress_idx" ON "Contract"("deployerAddress");

-- CreateIndex
CREATE UNIQUE INDEX "Contract_chain_address_key" ON "Contract"("chain", "address");

-- CreateIndex
CREATE INDEX "Opportunity_status_type_detectedAt_idx" ON "Opportunity"("status", "type", "detectedAt");

-- CreateIndex
CREATE INDEX "Opportunity_projectId_idx" ON "Opportunity"("projectId");

-- CreateIndex
CREATE INDEX "OpportunityRequirement_opportunityId_idx" ON "OpportunityRequirement"("opportunityId");

-- CreateIndex
CREATE INDEX "OpportunityEvent_opportunityId_idx" ON "OpportunityEvent"("opportunityId");

-- CreateIndex
CREATE INDEX "OpportunityEvent_detectedAt_idx" ON "OpportunityEvent"("detectedAt");

-- CreateIndex
CREATE INDEX "Source_url_idx" ON "Source"("url");

-- CreateIndex
CREATE INDEX "Evidence_opportunityId_idx" ON "Evidence"("opportunityId");

-- CreateIndex
CREATE INDEX "Evidence_sourceId_idx" ON "Evidence"("sourceId");

-- CreateIndex
CREATE INDEX "RiskAssessment_opportunityId_idx" ON "RiskAssessment"("opportunityId");

-- CreateIndex
CREATE INDEX "AIAnalysis_opportunityId_idx" ON "AIAnalysis"("opportunityId");

-- CreateIndex
CREATE INDEX "WalletActivity_walletId_timestamp_idx" ON "WalletActivity"("walletId", "timestamp");

-- CreateIndex
CREATE INDEX "WalletActivity_transactionHash_idx" ON "WalletActivity"("transactionHash");

-- CreateIndex
CREATE INDEX "WalletSignal_walletId_idx" ON "WalletSignal"("walletId");

-- CreateIndex
CREATE INDEX "WalletSignal_opportunityId_idx" ON "WalletSignal"("opportunityId");

-- CreateIndex
CREATE INDEX "Alert_userId_sentAt_idx" ON "Alert"("userId", "sentAt");

-- CreateIndex
CREATE INDEX "Alert_opportunityId_idx" ON "Alert"("opportunityId");

-- CreateIndex
CREATE INDEX "Participation_userId_idx" ON "Participation"("userId");

-- CreateIndex
CREATE INDEX "Participation_opportunityId_idx" ON "Participation"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "IngestionCheckpoint_chain_key" ON "IngestionCheckpoint"("chain");

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramAccount" ADD CONSTRAINT "TelegramAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSocial" ADD CONSTRAINT "ProjectSocial_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityRequirement" ADD CONSTRAINT "OpportunityRequirement_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityEvent" ADD CONSTRAINT "OpportunityEvent_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Source"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIAnalysis" ADD CONSTRAINT "AIAnalysis_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletActivity" ADD CONSTRAINT "WalletActivity_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletSignal" ADD CONSTRAINT "WalletSignal_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletSignal" ADD CONSTRAINT "WalletSignal_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

