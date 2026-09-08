import type { Prisma, PrismaClient } from "@alpharadar/database";
import { computeScore, isAlertVetoed, type ScoreInputs } from "@alpharadar/scoring";
import { log } from "../logger.js";

type ScorePrisma = Pick<PrismaClient, "opportunity" | "riskAssessment" | "opportunityEvent">;

/**
 * 04 Phase 4 / 09 §6's "score" stage (02 §12, 08 §4.2): reads the
 * RiskAssessment verify() just wrote plus the opportunity's own facts,
 * runs the deterministic scorer, and persists score/riskScore/urgency
 * alongside scoreInputs (the exact inputs, JSONB) and scoringVersion — so
 * any score can be explained and reproduced later, even after the
 * weights change (08 §4.2's fix #1).
 *
 * Does not decide whether to alert — that's alert()'s job once built. What
 * this stage guarantees is that the data the veto needs (overallRisk) is
 * always computed before score is, and that isAlertVetoed's result is
 * knowable from what's persisted here.
 */
export async function score(opportunityId: string, prisma: ScorePrisma): Promise<void> {
  const opportunity = await prisma.opportunity.findUniqueOrThrow({ where: { id: opportunityId } });

  const riskAssessment = await prisma.riskAssessment.findFirst({
    where: { opportunityId },
    orderBy: { createdAt: "desc" },
  });
  const overallRisk = riskAssessment?.overallRisk ?? "UNKNOWN";

  const inputs: ScoreInputs = {
    contractRiskLevel: riskAssessment?.contractRisk ?? "UNKNOWN",
    concentrationRiskLevel: riskAssessment?.concentrationRisk ?? "UNKNOWN",
    isFree:
      opportunity.type === "FREE_MINT" || !opportunity.entryCost || opportunity.entryCost.isZero(),
    detectedAt: opportunity.detectedAt,
    now: new Date(),
    // Always 0 — no WalletSignal rows are produced anywhere in this slice
    // (docs/decisions/0005: wallet-reputation tracking isn't built).
    smartWalletSignalCount: 0,
    // Slice 1 never sets startsAt/endsAt.
    hasDeadline: Boolean(opportunity.startsAt ?? opportunity.endsAt),
  };

  const result = computeScore(inputs);

  await prisma.opportunity.update({
    where: { id: opportunityId },
    data: {
      score: result.score,
      riskScore: overallRisk === "UNKNOWN" ? null : riskLevelToScore(overallRisk),
      urgency: result.urgency,
      scoreInputs: serializeInputs(inputs) as Prisma.InputJsonValue,
      scoringVersion: result.scoringVersion,
    },
  });

  await prisma.opportunityEvent.create({
    data: {
      opportunityId,
      eventType: "SCORED",
      payload: {
        score: result.score,
        components: { ...result.components },
        overallRisk,
        alertVetoed: isAlertVetoed(overallRisk),
      } as Prisma.InputJsonValue,
    },
  });

  log.info("score.complete", {
    opportunityId,
    score: result.score,
    overallRisk,
    alertVetoed: isAlertVetoed(overallRisk),
  });
}

/** A 0-100 display figure for the honest-severity RiskLevel enum — not used for the veto itself, which always compares the enum directly. */
function riskLevelToScore(level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"): number {
  return { LOW: 20, MEDIUM: 45, HIGH: 70, CRITICAL: 95 }[level];
}

/** JSONB can't store bigint/Date directly — a plain, re-readable snapshot of exactly what computeScore saw. */
function serializeInputs(inputs: ScoreInputs): Record<string, unknown> {
  return {
    contractRiskLevel: inputs.contractRiskLevel,
    concentrationRiskLevel: inputs.concentrationRiskLevel,
    isFree: inputs.isFree,
    detectedAt: inputs.detectedAt.toISOString(),
    now: inputs.now.toISOString(),
    smartWalletSignalCount: inputs.smartWalletSignalCount,
    hasDeadline: inputs.hasDeadline,
    msUntilDeadline: inputs.msUntilDeadline ?? null,
  };
}
