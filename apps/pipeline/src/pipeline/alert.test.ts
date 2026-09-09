import { describe, expect, it, vi } from "vitest";
import { alert, type AlertConfig } from "./alert.js";

const CONFIG: AlertConfig = {
  alertMinScore: 60,
  maxPerUserPerHour: 6,
  dedupeWindowHours: 24,
  webUrl: "https://alpharadar.test",
};

const DEFAULT_RECIPIENT = {
  userId: "user-1",
  chatId: "chat-1",
  isActive: true,
  user: { settings: { telegramEnabled: true, minimumScore: 60 } },
};

function makePrisma(overrides: {
  opportunity?: Record<string, unknown>;
  riskAssessment?: Record<string, unknown> | null;
  priorAlert?: unknown;
  recipients?: Record<string, unknown>[];
  hourlyCounts?: Record<string, number>;
}) {
  const createdAlerts: Record<string, unknown>[] = [];

  const opportunity = {
    id: "opp-1",
    projectId: "proj-1",
    actionProfile: "MINT",
    type: "FREE_MINT",
    score: 75,
    urgency: "MEDIUM",
    entryCost: null,
    contractAddress: "0xC0FFEE0000000000000000000000000000C0FFEE",
    chain: "robinhood",
    detectedAt: new Date("2026-09-09T00:00:00Z"),
    project: { id: "proj-1", name: "TestProj", symbol: "TST" },
    ...overrides.opportunity,
  };
  const riskAssessment =
    overrides.riskAssessment === undefined
      ? { overallRisk: "LOW", contractRisk: "LOW", concentrationRisk: "LOW" }
      : overrides.riskAssessment;

  return {
    opportunity: { findUniqueOrThrow: vi.fn().mockResolvedValue(opportunity) },
    riskAssessment: { findFirst: vi.fn().mockResolvedValue(riskAssessment) },
    alert: {
      findFirst: vi.fn().mockResolvedValue(overrides.priorAlert ?? null),
      count: vi
        .fn()
        .mockImplementation(
          async ({ where }: { where: { userId: string } }) =>
            overrides.hourlyCounts?.[where.userId] ?? 0,
        ),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        createdAlerts.push(data);
        return { id: `alert-${createdAlerts.length}`, ...data };
      }),
    },
    telegramAccount: {
      findMany: vi.fn().mockResolvedValue(overrides.recipients ?? [DEFAULT_RECIPIENT]),
    },
    _rows: { createdAlerts },
  };
}

function makeTelegramClient(overrides: { sendMessage?: ReturnType<typeof vi.fn> } = {}) {
  return {
    sendMessage: overrides.sendMessage ?? vi.fn().mockResolvedValue({ messageId: 1 }),
  };
}

describe("alert — global gate", () => {
  it("sends to an eligible recipient and records SENT with sentAt set", async () => {
    const prisma = makePrisma({});
    const telegramClient = makeTelegramClient();

    await alert("opp-1", prisma as never, telegramClient as never, CONFIG);

    expect(telegramClient.sendMessage).toHaveBeenCalledTimes(1);
    const [call] = telegramClient.sendMessage.mock.calls[0] as [{ chatId: string; text: string }];
    expect(call.chatId).toBe("chat-1");
    expect(call.text).toContain("TestProj");

    expect(prisma._rows.createdAlerts).toEqual([
      expect.objectContaining({
        userId: "user-1",
        deliveryStatus: "SENT",
        sentAt: expect.any(Date),
      }),
    ]);
  });

  it("suppresses globally (one broadcast-shaped row, userId null) when risk is HIGH", async () => {
    const prisma = makePrisma({ riskAssessment: { overallRisk: "HIGH" } });
    const telegramClient = makeTelegramClient();

    await alert("opp-1", prisma as never, telegramClient as never, CONFIG);

    expect(telegramClient.sendMessage).not.toHaveBeenCalled();
    expect(prisma._rows.createdAlerts).toHaveLength(1);
    expect(prisma._rows.createdAlerts[0]).toMatchObject({
      userId: null,
      deliveryStatus: "SUPPRESSED",
      suppressedReason: expect.stringContaining("risk veto"),
    });
  });

  it("does not veto UNKNOWN risk", async () => {
    const prisma = makePrisma({ riskAssessment: { overallRisk: "UNKNOWN" } });
    const telegramClient = makeTelegramClient();

    await alert("opp-1", prisma as never, telegramClient as never, CONFIG);

    expect(telegramClient.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("suppresses globally when the same project/actionProfile already alerted within the dedupe window", async () => {
    const prisma = makePrisma({ priorAlert: { id: "prior-alert" } });
    const telegramClient = makeTelegramClient();

    await alert("opp-1", prisma as never, telegramClient as never, CONFIG);

    expect(telegramClient.sendMessage).not.toHaveBeenCalled();
    expect(prisma._rows.createdAlerts[0]).toMatchObject({
      userId: null,
      deliveryStatus: "SUPPRESSED",
      suppressedReason: expect.stringContaining("duplicate"),
    });
  });

  it("suppresses globally when the opportunity has no score yet", async () => {
    const prisma = makePrisma({ opportunity: { score: null } });
    const telegramClient = makeTelegramClient();

    await alert("opp-1", prisma as never, telegramClient as never, CONFIG);

    expect(prisma._rows.createdAlerts[0]).toMatchObject({
      suppressedReason: expect.stringContaining("not been scored"),
    });
  });

  it("suppresses globally when score is below ALERT_MIN_SCORE", async () => {
    const prisma = makePrisma({ opportunity: { score: 50 } });
    const telegramClient = makeTelegramClient();

    await alert("opp-1", prisma as never, telegramClient as never, CONFIG);

    expect(prisma._rows.createdAlerts[0]).toMatchObject({
      suppressedReason: expect.stringContaining("below the minimum alert score"),
    });
  });

  it("suppresses with one row and a clear reason when there are no active Telegram recipients", async () => {
    const prisma = makePrisma({ recipients: [] });
    const telegramClient = makeTelegramClient();

    await alert("opp-1", prisma as never, telegramClient as never, CONFIG);

    expect(prisma._rows.createdAlerts).toEqual([
      expect.objectContaining({
        userId: null,
        deliveryStatus: "SUPPRESSED",
        suppressedReason: expect.stringContaining("no active Telegram recipients"),
      }),
    ]);
  });
});

describe("alert — per-user gate", () => {
  it("suppresses a recipient whose own minimum score is above the opportunity's score", async () => {
    const prisma = makePrisma({
      opportunity: { score: 65 },
      recipients: [
        { ...DEFAULT_RECIPIENT, user: { settings: { telegramEnabled: true, minimumScore: 90 } } },
      ],
    });
    const telegramClient = makeTelegramClient();

    await alert("opp-1", prisma as never, telegramClient as never, CONFIG);

    expect(telegramClient.sendMessage).not.toHaveBeenCalled();
    expect(prisma._rows.createdAlerts[0]).toMatchObject({
      userId: "user-1",
      deliveryStatus: "SUPPRESSED",
      suppressedReason: expect.stringContaining("below this user's minimum"),
    });
  });

  it("suppresses a recipient who has reached the hourly cap", async () => {
    const prisma = makePrisma({ hourlyCounts: { "user-1": 6 } });
    const telegramClient = makeTelegramClient();

    await alert("opp-1", prisma as never, telegramClient as never, CONFIG);

    expect(telegramClient.sendMessage).not.toHaveBeenCalled();
    expect(prisma._rows.createdAlerts[0]).toMatchObject({
      suppressedReason: expect.stringContaining("hourly alert cap"),
    });
  });

  it("suppresses a recipient who has disabled Telegram alerts", async () => {
    const prisma = makePrisma({
      recipients: [
        { ...DEFAULT_RECIPIENT, user: { settings: { telegramEnabled: false, minimumScore: 60 } } },
      ],
    });
    const telegramClient = makeTelegramClient();

    await alert("opp-1", prisma as never, telegramClient as never, CONFIG);

    expect(telegramClient.sendMessage).not.toHaveBeenCalled();
    expect(prisma._rows.createdAlerts[0]).toMatchObject({
      suppressedReason: expect.stringContaining("disabled Telegram alerts"),
    });
  });

  it("evaluates each recipient independently — one suppressed, one sent", async () => {
    const prisma = makePrisma({
      recipients: [
        {
          ...DEFAULT_RECIPIENT,
          userId: "user-low",
          user: { settings: { telegramEnabled: false, minimumScore: 60 } },
        },
        { ...DEFAULT_RECIPIENT, userId: "user-ok", chatId: "chat-ok" },
      ],
    });
    const telegramClient = makeTelegramClient();

    await alert("opp-1", prisma as never, telegramClient as never, CONFIG);

    expect(telegramClient.sendMessage).toHaveBeenCalledTimes(1);
    const statuses = prisma._rows.createdAlerts.map((a) => (a as { userId: string }).userId);
    expect(statuses.sort()).toEqual(["user-low", "user-ok"]);
  });
});

describe("alert — delivery failure handling", () => {
  it("records FAILED (not SUPPRESSED, no suppressedReason) and does not throw when the send itself fails", async () => {
    const prisma = makePrisma({});
    const telegramClient = makeTelegramClient({
      sendMessage: vi.fn().mockRejectedValue(new Error("Telegram is down")),
    });

    await expect(
      alert("opp-1", prisma as never, telegramClient as never, CONFIG),
    ).resolves.toBeUndefined();

    expect(prisma._rows.createdAlerts[0]).toMatchObject({
      deliveryStatus: "FAILED",
      suppressedReason: null,
    });
  });

  it("records FAILED when telegramClient is null (TELEGRAM_BOT_TOKEN not configured), without throwing", async () => {
    const prisma = makePrisma({});

    await expect(alert("opp-1", prisma as never, null, CONFIG)).resolves.toBeUndefined();

    expect(prisma._rows.createdAlerts[0]).toMatchObject({ deliveryStatus: "FAILED" });
  });
});

describe("alert — template selection", () => {
  it("renders the NFT template for a FREE_MINT opportunity", async () => {
    const prisma = makePrisma({ opportunity: { type: "FREE_MINT" } });
    const telegramClient = makeTelegramClient();

    await alert("opp-1", prisma as never, telegramClient as never, CONFIG);

    const [call] = telegramClient.sendMessage.mock.calls[0] as [
      { text: string; inlineKeyboardRow: { text: string; url: string }[] },
    ];
    expect(call.text).toContain("🎨 NEW FREE MINT");
    expect(call.inlineKeyboardRow[0]?.text).toBe("👉 Open on AlphaRadar");
    expect(call.inlineKeyboardRow[0]?.url).toBe("https://alpharadar.test/opportunities/opp-1");
  });

  it("renders the Token template for a TOKEN_LAUNCH opportunity, with the full contract address", async () => {
    const prisma = makePrisma({ opportunity: { type: "TOKEN_LAUNCH" } });
    const telegramClient = makeTelegramClient();

    await alert("opp-1", prisma as never, telegramClient as never, CONFIG);

    const [call] = telegramClient.sendMessage.mock.calls[0] as [
      { text: string; inlineKeyboardRow: { text: string; url: string }[] },
    ];
    expect(call.text).toContain("🪙 NEW TOKEN SIGNAL");
    expect(call.text).toContain("0xC0FFEE0000000000000000000000000000C0FFEE");
    expect(call.inlineKeyboardRow[0]?.text).toBe("👉 Open AlphaRadar");
  });

  it("throws for an opportunity type with no defined template — fails loudly, not silently", async () => {
    const prisma = makePrisma({ opportunity: { type: "AIRDROP" } });
    const telegramClient = makeTelegramClient();

    await expect(alert("opp-1", prisma as never, telegramClient as never, CONFIG)).rejects.toThrow(
      /no Telegram template/,
    );
  });
});

describe("alert — WEB_URL button guard", () => {
  it("sends the message text with no inlineKeyboardRow when WEB_URL is localhost — a bad button must not cost the whole alert", async () => {
    const prisma = makePrisma({});
    const telegramClient = makeTelegramClient();
    const localConfig: AlertConfig = { ...CONFIG, webUrl: "http://localhost:3000" };

    await alert("opp-1", prisma as never, telegramClient as never, localConfig);

    expect(telegramClient.sendMessage).toHaveBeenCalledTimes(1);
    const [call] = telegramClient.sendMessage.mock.calls[0] as [
      { text: string; inlineKeyboardRow?: unknown },
    ];
    expect(call.text).toContain("TestProj");
    expect(call.inlineKeyboardRow).toBeUndefined();
    expect(prisma._rows.createdAlerts[0]).toMatchObject({ deliveryStatus: "SENT" });
  });

  it("still attaches the button when WEB_URL is a real public https URL", async () => {
    const prisma = makePrisma({});
    const telegramClient = makeTelegramClient();

    await alert("opp-1", prisma as never, telegramClient as never, CONFIG);

    const [call] = telegramClient.sendMessage.mock.calls[0] as [
      { inlineKeyboardRow?: { url: string }[] },
    ];
    expect(call.inlineKeyboardRow?.[0]?.url).toBe("https://alpharadar.test/opportunities/opp-1");
  });
});
