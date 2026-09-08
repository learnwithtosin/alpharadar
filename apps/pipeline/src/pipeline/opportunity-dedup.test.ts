import { Prisma } from "@alpharadar/database";
import { describe, expect, it, vi } from "vitest";
import { findOrCreateOpportunity, type FindOrCreateOpportunityInput } from "./opportunity-dedup.js";

const KEY: FindOrCreateOpportunityInput = {
  chain: "robinhood",
  contractAddress: "0xabc",
  type: "FREE_MINT",
  actionProfile: "MINT",
  projectId: "project-1",
  title: "Some Collection mint detected",
};

function makePrisma(overrides: {
  findFirst?: ReturnType<typeof vi.fn>;
  create?: ReturnType<typeof vi.fn>;
}) {
  return {
    opportunity: {
      findFirst: overrides.findFirst ?? vi.fn(),
      create: overrides.create ?? vi.fn(),
    },
  } as unknown as Parameters<typeof findOrCreateOpportunity>[0];
}

describe("findOrCreateOpportunity", () => {
  it("creates a new opportunity when no open match exists", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({ id: "opp-1", status: "DETECTED" });
    const prisma = makePrisma({ findFirst, create });

    const result = await findOrCreateOpportunity(prisma, KEY);

    expect(result).toEqual({ opportunity: { id: "opp-1", status: "DETECTED" }, created: true });
    expect(create).toHaveBeenCalledTimes(1);
    const createArgs = create.mock.calls[0]?.[0];
    expect(createArgs.data).toMatchObject({
      chain: "robinhood",
      contractAddress: "0xabc",
      type: "FREE_MINT",
      actionProfile: "MINT",
      status: "DETECTED",
    });
  });

  it("returns the existing opportunity instead of creating a duplicate — same key, DETECTED status", async () => {
    const existing = { id: "opp-existing", status: "DETECTED" };
    const findFirst = vi.fn().mockResolvedValue(existing);
    const create = vi.fn();
    const prisma = makePrisma({ findFirst, create });

    const result = await findOrCreateOpportunity(prisma, KEY);

    expect(result).toEqual({ opportunity: existing, created: false });
    expect(create).not.toHaveBeenCalled();
  });

  it("only searches OPEN statuses — 08 §4.5: COMPLETED/EXPIRED never match", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({ id: "opp-new" });
    const prisma = makePrisma({ findFirst, create });

    await findOrCreateOpportunity(prisma, KEY);

    const whereClause = findFirst.mock.calls[0]?.[0].where;
    expect(whereClause.status.in).toEqual(
      expect.arrayContaining(["DETECTED", "VERIFYING", "ACTIVE", "UPCOMING", "REJECTED"]),
    );
    expect(whereClause.status.in).not.toContain("COMPLETED");
    expect(whereClause.status.in).not.toContain("EXPIRED");
  });

  it("a COMPLETED opportunity on the same key does not block a new one — creates a new opportunity", async () => {
    // findOpenMatch is scoped to OPEN_STATUSES, so a COMPLETED row for this
    // exact key is invisible to it and findFirst legitimately returns null.
    const findFirst = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({ id: "opp-second-phase" });
    const prisma = makePrisma({ findFirst, create });

    const result = await findOrCreateOpportunity(prisma, KEY);

    expect(result.created).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("different actionProfile is a different key — creates rather than matching", async () => {
    const findFirst = vi.fn().mockImplementation(async ({ where }) => {
      // Simulate a real unique-key search: only matches the exact tuple.
      return where.actionProfile === "MINT" && where.chain === "robinhood" ? null : null;
    });
    const create = vi.fn().mockResolvedValue({ id: "opp-different-profile" });
    const prisma = makePrisma({ findFirst, create });

    await findOrCreateOpportunity(prisma, { ...KEY, actionProfile: "RESEARCH" });

    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ actionProfile: "RESEARCH" }) }),
    );
  });

  it("on a P2002 race (concurrent create won), refetches and returns the winner instead of throwing", async () => {
    const winner = { id: "opp-winner", status: "DETECTED" };
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(null) // initial check: nothing yet
      .mockResolvedValueOnce(winner); // refetch after the race: found it
    const raceError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    });
    const create = vi.fn().mockRejectedValue(raceError);
    const prisma = makePrisma({ findFirst, create });

    const result = await findOrCreateOpportunity(prisma, KEY);

    expect(result).toEqual({ opportunity: winner, created: false });
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it("rethrows a create error that isn't a unique constraint violation", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const dbDown = new Error("connection refused");
    const create = vi.fn().mockRejectedValue(dbDown);
    const prisma = makePrisma({ findFirst, create });

    await expect(findOrCreateOpportunity(prisma, KEY)).rejects.toBe(dbDown);
  });

  it("rethrows if the race refetch (after a P2002) still finds nothing — should not happen, but must not swallow the error", async () => {
    const findFirst = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const raceError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    });
    const create = vi.fn().mockRejectedValue(raceError);
    const prisma = makePrisma({ findFirst, create });

    await expect(findOrCreateOpportunity(prisma, KEY)).rejects.toBe(raceError);
  });
});
