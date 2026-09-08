import { describe, expect, it, vi } from "vitest";
import { score } from "./score.js";

function makePrisma(overrides: {
  opportunity?: Record<string, unknown>;
  riskAssessment?: Record<string, unknown> | null;
}) {
  const updates: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];

  const opportunity = {
    id: "opp-1",
    type: "FREE_MINT",
    entryCost: null,
    detectedAt: new Date("2026-09-08T00:00:00Z"),
    startsAt: null,
    endsAt: null,
    ...overrides.opportunity,
  };
  const riskAssessment =
    overrides.riskAssessment === undefined
      ? { overallRisk: "LOW", contractRisk: "LOW", concentrationRisk: "LOW", deployerRisk: "LOW" }
      : overrides.riskAssessment;

  return {
    opportunity: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(opportunity),
      update: vi.fn().mockImplementation(async ({ data }) => {
        updates.push(data);
        return { ...opportunity, ...data };
      }),
    },
    riskAssessment: {
      findFirst: vi.fn().mockResolvedValue(riskAssessment),
    },
    opportunityEvent: {
      create: vi.fn().mockImplementation(async ({ data }) => {
        events.push(data);
        return { id: "evt-1", ...data };
      }),
    },
    _rows: { updates, events },
  };
}

describe("score", () => {
  it("persists score, urgency, scoreInputs, and scoringVersion on the Opportunity", async () => {
    const prisma = makePrisma({});

    await score("opp-1", prisma as never);

    expect(prisma._rows.updates).toHaveLength(1);
    const update = prisma._rows.updates[0]!;
    expect(typeof update.score).toBe("number");
    expect(update.urgency).toBeDefined();
    expect(update.scoreInputs).toBeDefined();
    expect(update.scoringVersion).toBeDefined();
  });

  it("writes a SCORED OpportunityEvent with score, components, and veto status", async () => {
    const prisma = makePrisma({});

    await score("opp-1", prisma as never);

    expect(prisma._rows.events).toHaveLength(1);
    expect(prisma._rows.events[0]).toMatchObject({ eventType: "SCORED" });
    const payload = prisma._rows.events[0]!.payload as Record<string, unknown>;
    expect(payload.components).toBeDefined();
    expect(typeof payload.alertVetoed).toBe("boolean");
  });

  it("defaults to overallRisk UNKNOWN when no RiskAssessment exists yet", async () => {
    const prisma = makePrisma({ riskAssessment: null });

    await score("opp-1", prisma as never);

    const payload = prisma._rows.events[0]!.payload as Record<string, unknown>;
    expect(payload.overallRisk).toBe("UNKNOWN");
    expect(prisma._rows.updates[0]!.riskScore).toBeNull();
  });

  it("sets riskScore from a known overallRisk, distinct from the 0-100 score itself", async () => {
    const prisma = makePrisma({
      riskAssessment: {
        overallRisk: "HIGH",
        contractRisk: "HIGH",
        concentrationRisk: "LOW",
        deployerRisk: "LOW",
      },
    });

    await score("opp-1", prisma as never);

    expect(prisma._rows.updates[0]!.riskScore).toBe(70);
  });

  it("marks alertVetoed true when overallRisk is HIGH or above", async () => {
    const highPrisma = makePrisma({
      riskAssessment: {
        overallRisk: "HIGH",
        contractRisk: "HIGH",
        concentrationRisk: "LOW",
        deployerRisk: "LOW",
      },
    });
    const lowPrisma = makePrisma({
      riskAssessment: {
        overallRisk: "LOW",
        contractRisk: "LOW",
        concentrationRisk: "LOW",
        deployerRisk: "LOW",
      },
    });

    await score("opp-1", highPrisma as never);
    await score("opp-1", lowPrisma as never);

    expect((highPrisma._rows.events[0]!.payload as Record<string, unknown>).alertVetoed).toBe(true);
    expect((lowPrisma._rows.events[0]!.payload as Record<string, unknown>).alertVetoed).toBe(false);
  });

  it("treats a zero entryCost as free even when type isn't FREE_MINT", async () => {
    const prisma = makePrisma({
      opportunity: { type: "TOKEN_LAUNCH", entryCost: { isZero: () => true } },
    });

    await score("opp-1", prisma as never);

    const inputs = prisma._rows.updates[0]!.scoreInputs as Record<string, unknown>;
    expect(inputs.isFree).toBe(true);
  });

  it("treats a nonzero entryCost on a non-FREE_MINT opportunity as not free", async () => {
    const prisma = makePrisma({
      opportunity: { type: "TOKEN_LAUNCH", entryCost: { isZero: () => false } },
    });

    await score("opp-1", prisma as never);

    const inputs = prisma._rows.updates[0]!.scoreInputs as Record<string, unknown>;
    expect(inputs.isFree).toBe(false);
  });

  it("derives hasDeadline from startsAt/endsAt — always false for Slice 1 opportunities", async () => {
    const prisma = makePrisma({});

    await score("opp-1", prisma as never);

    const inputs = prisma._rows.updates[0]!.scoreInputs as Record<string, unknown>;
    expect(inputs.hasDeadline).toBe(false);
  });

  it("uses only the most recent RiskAssessment when more than one exists", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      overallRisk: "CRITICAL",
      contractRisk: "CRITICAL",
      concentrationRisk: "LOW",
      deployerRisk: "LOW",
    });
    const prisma = makePrisma({});
    prisma.riskAssessment.findFirst = findFirst;

    await score("opp-1", prisma as never);

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { opportunityId: "opp-1" },
        orderBy: { createdAt: "desc" },
      }),
    );
  });
});
