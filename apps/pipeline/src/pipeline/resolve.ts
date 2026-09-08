import type { Contract, PrismaClient, Project } from "@alpharadar/database";
import { findOrCreateOpportunity } from "./opportunity-dedup.js";
import type { IngestResult, NftMintSignal } from "./ingest.js";

type ResolvePrisma = Pick<
  PrismaClient,
  "project" | "contract" | "opportunity" | "opportunityEvent"
>;

export interface ResolveParams {
  chain: string;
}

export interface ResolveResult {
  /** Opportunities newly created this run — the only ones downstream stages should touch. */
  createdOpportunityIds: string[];
  /** Signals that matched an already-open Opportunity via the 08 §4.5 dedup key. */
  deduplicatedCount: number;
}

/**
 * Slug is the lowercased contract address — always unique, always
 * deterministic, no collision handling needed. Not pretty for a URL, but
 * correct; can be improved once the web app actually renders it.
 */
function projectSlugFor(contractAddress: string): string {
  return contractAddress.toLowerCase();
}

async function findOrCreateProject(
  prisma: ResolvePrisma,
  chain: string,
  signal: NftMintSignal,
): Promise<Project> {
  const slug = projectSlugFor(signal.contractAddress);
  const existing = await prisma.project.findUnique({ where: { slug } });
  if (existing) return existing;

  return prisma.project.create({
    data: {
      name: signal.tokenName ?? signal.tokenSymbol ?? signal.contractAddress,
      slug,
      chain,
      projectType: "NFT_COLLECTION",
      status: "ACTIVE",
    },
  });
}

async function findOrCreateContract(
  prisma: ResolvePrisma,
  projectId: string,
  chain: string,
  signal: NftMintSignal,
): Promise<Contract> {
  const existing = await prisma.contract.findUnique({
    where: { chain_address: { chain, address: signal.contractAddress } },
  });
  if (existing) return existing;

  return prisma.contract.create({
    data: {
      projectId,
      chain,
      address: signal.contractAddress,
      contractType: "ERC721",
    },
  });
}

function titleFor(signal: NftMintSignal): string {
  const name = signal.tokenName ?? signal.tokenSymbol ?? signal.contractAddress;
  return signal.mintValue > 0n ? `${name} mint detected` : `${name} free mint detected`;
}

/**
 * 04 Phase 4 / 09 §6's "opportunity-resolution" stage: project resolution,
 * contract resolution, opportunity creation, deduplication. Every write
 * here is idempotent — reprocessing the same ingest() output (e.g. after a
 * crash mid-run, per 09 §11 point 4) finds the same Project/Contract via
 * their unique constraints and the same Opportunity via
 * findOrCreateOpportunity, rather than duplicating any of them.
 */
export async function resolve(
  prisma: ResolvePrisma,
  ingestResult: IngestResult,
  params: ResolveParams,
): Promise<ResolveResult> {
  const createdOpportunityIds: string[] = [];
  let deduplicatedCount = 0;

  for (const signal of ingestResult.nftMintSignals) {
    const project = await findOrCreateProject(prisma, params.chain, signal);
    await findOrCreateContract(prisma, project.id, params.chain, signal);

    const { opportunity, created } = await findOrCreateOpportunity(prisma, {
      chain: params.chain,
      contractAddress: signal.contractAddress,
      type: signal.mintValue > 0n ? "NFT_MINT" : "FREE_MINT",
      actionProfile: "MINT",
      projectId: project.id,
      title: titleFor(signal),
      detectedAt: new Date(),
    });

    if (created) {
      await prisma.opportunityEvent.create({
        data: {
          opportunityId: opportunity.id,
          eventType: "DETECTED",
          payload: {
            mintTransactionHash: signal.mintTransactionHash,
            mintBlockNumber: signal.mintBlockNumber.toString(),
            mintValue: signal.mintValue.toString(),
          },
        },
      });
      createdOpportunityIds.push(opportunity.id);
    } else {
      deduplicatedCount++;
    }
  }

  return { createdOpportunityIds, deduplicatedCount };
}
