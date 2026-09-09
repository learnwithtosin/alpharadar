import { describe, expect, it, vi } from "vitest";
import { handleSettings } from "./settings.js";

function makePrisma(account: unknown) {
  return {
    telegramAccount: { findUnique: vi.fn().mockResolvedValue(account) },
  };
}

const INPUT = { telegramUserId: "tg-1" };
const WEB_URL = "https://alpharadar.example";

describe("handleSettings", () => {
  it("tells an unknown telegramUserId to /start first", async () => {
    const prisma = makePrisma(null);

    const result = await handleSettings(prisma as never, INPUT, WEB_URL);

    expect(result.replyText).toContain("/start");
  });

  it("reports current settings and points to the web settings page", async () => {
    const prisma = makePrisma({
      isActive: true,
      user: {
        settings: { telegramEnabled: true, minimumScore: 70, enabledOpportunityTypes: [] },
      },
    });

    const result = await handleSettings(prisma as never, INPUT, WEB_URL);

    expect(result.replyText).toBe(
      [
        "Your settings:",
        "Alerts: on",
        "Minimum score: 70/100",
        "Opportunity types: all types",
        "",
        `Change these at ${WEB_URL}/settings`,
      ].join("\n"),
    );
  });

  it("reports alerts as off when the account is deactivated, even if telegramEnabled is true", async () => {
    const prisma = makePrisma({
      isActive: false,
      user: {
        settings: { telegramEnabled: true, minimumScore: 60, enabledOpportunityTypes: [] },
      },
    });

    const result = await handleSettings(prisma as never, INPUT, WEB_URL);

    expect(result.replyText).toContain("Alerts: off");
  });

  it("lists enabled opportunity types when the user has narrowed them", async () => {
    const prisma = makePrisma({
      isActive: true,
      user: {
        settings: {
          telegramEnabled: true,
          minimumScore: 60,
          enabledOpportunityTypes: ["TOKEN_LAUNCH", "FREE_MINT"],
        },
      },
    });

    const result = await handleSettings(prisma as never, INPUT, WEB_URL);

    expect(result.replyText).toContain("Opportunity types: TOKEN_LAUNCH, FREE_MINT");
  });
});
