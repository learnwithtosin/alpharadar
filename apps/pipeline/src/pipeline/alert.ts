import type {
  Opportunity,
  Prisma,
  PrismaClient,
  Project,
  RiskAssessment,
} from "@alpharadar/database";
import {
  deriveNftMintAlertReasons,
  looksLikePubliclyReachableHttpsUrl,
  renderNftMintAlertMessage,
  renderTokenAlertMessage,
} from "@alpharadar/telegram";
import type { TelegramClient } from "@alpharadar/telegram";
import type { OpportunityType, RiskLevel } from "@alpharadar/types";
import { log } from "../logger.js";
import { evaluateGlobalGate, evaluateUserGate } from "./alert-rules.js";

type AlertPrisma = Pick<
  PrismaClient,
  "opportunity" | "riskAssessment" | "alert" | "telegramAccount"
>;

export interface AlertConfig {
  /** ALERT_MIN_SCORE — the global floor; a user's own minimumScore may only raise it, never a rule bypass. */
  alertMinScore: number;
  maxPerUserPerHour: number;
  dedupeWindowHours: number;
  webUrl: string;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

const NFT_ALERT_OPPORTUNITY_TYPES: readonly OpportunityType[] = ["NFT_MINT", "FREE_MINT"];
const TOKEN_ALERT_OPPORTUNITY_TYPES: readonly OpportunityType[] = [
  "TOKEN_LAUNCH",
  "MEMECOIN",
  "UTILITY_TOKEN",
];

type AlphaRadarAlertType = "NFT_MINT_ALERT" | "TOKEN_ALERT";

/**
 * Only NFT_MINT/FREE_MINT and TOKEN_LAUNCH are ever produced by resolve()
 * today (MEMECOIN/UTILITY_TOKEN are schema-ready, not yet emitted anywhere)
 * — an opportunity of any other type reaching alert() would mean a new
 * signal source was wired up without a template decision being made for
 * it, which should fail loudly here rather than silently pick one.
 */
function alertTypeFor(opportunityType: OpportunityType): AlphaRadarAlertType {
  if (NFT_ALERT_OPPORTUNITY_TYPES.includes(opportunityType)) return "NFT_MINT_ALERT";
  if (TOKEN_ALERT_OPPORTUNITY_TYPES.includes(opportunityType)) return "TOKEN_ALERT";
  throw new Error(
    `alert(): no Telegram template is defined for opportunity type ${opportunityType}`,
  );
}

function isFreeOpportunity(opportunity: Opportunity): boolean {
  // Mirrors score.ts's own isFree check exactly — same business rule, not re-derived.
  return (
    opportunity.type === "FREE_MINT" || !opportunity.entryCost || opportunity.entryCost.isZero()
  );
}

function renderMessageText(
  alertType: AlphaRadarAlertType,
  opportunity: Opportunity,
  project: Project,
  overallRisk: RiskLevel,
  riskAssessment: RiskAssessment | null,
): string {
  if (alertType === "NFT_MINT_ALERT") {
    const reasons = deriveNftMintAlertReasons({
      isFree: isFreeOpportunity(opportunity),
      contractRisk: riskAssessment?.contractRisk ?? "UNKNOWN",
      concentrationRisk: riskAssessment?.concentrationRisk ?? "UNKNOWN",
      ageMs: Date.now() - opportunity.detectedAt.getTime(),
    });
    return renderNftMintAlertMessage({
      projectName: project.name,
      score: opportunity.score as number,
      risk: overallRisk,
      urgency: opportunity.urgency ?? "LOW",
      reasons,
    });
  }

  return renderTokenAlertMessage({
    tokenName: project.name,
    ticker: project.symbol ?? project.name,
    // Always set for a TOKEN_ALERT-eligible type — resolve() only creates
    // these opportunities with a contract address (08 §4.5's dedup key).
    contractAddress: opportunity.contractAddress as string,
    score: opportunity.score as number,
    risk: overallRisk,
    // Always unknown/none in the MVP — no DEX integration (liquidityRisk)
    // and no WalletSignal rows are ever produced (docs/decisions/0006, 0005).
    liquidity: null,
    detectedAt: opportunity.detectedAt,
    smartWalletSignal: null,
  });
}

/**
 * 04 Phase 4 / 09 §6's "alert" stage (02 §14, 08 §4.4): renders the exact
 * NFT/token templates from 03-CLAUDE-BUILD-PROMPT.md and applies four
 * rules before sending — minimum score (ALERT_MIN_SCORE, and separately a
 * per-user minimumScore that may only raise that floor), a per-user hourly
 * cap, a dedupe window so the same project+actionProfile doesn't alert
 * twice, and the 08 §4.2 risk veto (isAlertVetoed). Every suppressed
 * decision is still persisted — Alert.suppressedReason set, never a
 * silently-dropped opportunity — "the only way to tune thresholds later"
 * (08 §4.4). Delivery status (SENT/FAILED/SUPPRESSED) lives on the Alert
 * row, one per (opportunity, recipient), except a globally-suppressed
 * opportunity (veto/dedupe/no recipients) which gets exactly one
 * broadcast-shaped row (userId null) — that decision was never
 * user-specific, so faking N per-user rows for it would misrepresent what
 * actually happened.
 *
 * Not implemented here, disclosed rather than silently included: 08 §4.4
 * also proposes shipping alerts off-by-default except CRITICAL urgency,
 * opt-in from /settings. That wasn't part of the four rules asked for this
 * pass and isn't built — every opportunity that clears the four rules
 * above is alerted regardless of urgency.
 */
export async function alert(
  opportunityId: string,
  prisma: AlertPrisma,
  telegramClient: TelegramClient | null,
  config: AlertConfig,
): Promise<void> {
  const opportunity = await prisma.opportunity.findUniqueOrThrow({
    where: { id: opportunityId },
    include: { project: true },
  });
  // Resolved once, up front: every code path below (suppressed or sent)
  // needs a valid alertType to write its Alert row, and an unsupported
  // opportunity type is a real configuration gap that must fail the whole
  // call loudly — not get swallowed into a per-recipient FAILED row by the
  // send try/catch further down.
  const alertType = alertTypeFor(opportunity.type);

  const riskAssessment = await prisma.riskAssessment.findFirst({
    where: { opportunityId },
    orderBy: { createdAt: "desc" },
  });
  const overallRisk: RiskLevel = riskAssessment?.overallRisk ?? "UNKNOWN";

  const dedupeCutoff = new Date(Date.now() - config.dedupeWindowHours * ONE_HOUR_MS);
  const priorAlert = await prisma.alert.findFirst({
    where: {
      deliveryStatus: "SENT",
      sentAt: { gte: dedupeCutoff },
      opportunity: {
        projectId: opportunity.projectId,
        actionProfile: opportunity.actionProfile,
      },
    },
  });

  const globalGate = evaluateGlobalGate({
    score: opportunity.score,
    overallRisk,
    alreadyAlertedRecently: priorAlert !== null,
    minScore: config.alertMinScore,
  });

  if (globalGate.suppressed) {
    await createAlertRow(prisma, {
      opportunityId,
      userId: null,
      alertType,
      deliveryStatus: "SUPPRESSED",
      suppressedReason: globalGate.reason,
    });
    log.info("alert.suppressed", { opportunityId, scope: "global", reason: globalGate.reason });
    return;
  }

  const recipients = await prisma.telegramAccount.findMany({
    where: { isActive: true },
    include: { user: { include: { settings: true } } },
  });

  if (recipients.length === 0) {
    const reason = "no active Telegram recipients";
    await createAlertRow(prisma, {
      opportunityId,
      userId: null,
      alertType,
      deliveryStatus: "SUPPRESSED",
      suppressedReason: reason,
    });
    log.info("alert.suppressed", { opportunityId, scope: "global", reason });
    return;
  }

  // Computed once, reused for every recipient — not per-recipient, so a
  // bad WEB_URL logs one warning per opportunity, not one per subscriber.
  // Telegram rejects a non-public URL on an inline button outright
  // ("Wrong HTTP URL", confirmed live against WEB_URL's own
  // http://localhost:3000 default) — that must not cost the whole
  // message. Degrade to no button rather than fail the send.
  const buttonUrl = `${config.webUrl}/opportunities/${opportunity.id}`;
  const buttonUrlIsUsable = looksLikePubliclyReachableHttpsUrl(buttonUrl);
  if (!buttonUrlIsUsable) {
    log.warn("alert.button.omitted", {
      opportunityId,
      webUrl: config.webUrl,
      reason: "WEB_URL is not a publicly reachable https URL — sending without the link button",
    });
  }

  const hourCutoff = new Date(Date.now() - ONE_HOUR_MS);

  for (const recipient of recipients) {
    const hourlyAlertCountForUser = await prisma.alert.count({
      where: { userId: recipient.userId, deliveryStatus: "SENT", sentAt: { gte: hourCutoff } },
    });

    const userGate = evaluateUserGate({
      score: opportunity.score as number,
      telegramActive: recipient.isActive,
      telegramEnabled: recipient.user.settings?.telegramEnabled ?? true,
      userMinimumScore: recipient.user.settings?.minimumScore ?? config.alertMinScore,
      hourlyAlertCountForUser,
      maxPerUserPerHour: config.maxPerUserPerHour,
    });

    if (userGate.suppressed) {
      await createAlertRow(prisma, {
        opportunityId,
        userId: recipient.userId,
        alertType,
        deliveryStatus: "SUPPRESSED",
        suppressedReason: userGate.reason,
      });
      continue;
    }

    if (telegramClient === null) {
      await createAlertRow(prisma, {
        opportunityId,
        userId: recipient.userId,
        alertType,
        deliveryStatus: "FAILED",
      });
      log.error("alert.send.failed", new Error("TELEGRAM_BOT_TOKEN is not configured"), {
        opportunityId,
        userId: recipient.userId,
      });
      continue;
    }

    try {
      const isNftAlert = alertType === "NFT_MINT_ALERT";
      const text = renderMessageText(
        alertType,
        opportunity,
        opportunity.project,
        overallRisk,
        riskAssessment,
      );
      await telegramClient.sendMessage({
        chatId: recipient.chatId,
        text,
        ...(buttonUrlIsUsable
          ? {
              inlineKeyboardRow: [
                {
                  text: isNftAlert ? "👉 Open on AlphaRadar" : "👉 Open AlphaRadar",
                  url: buttonUrl,
                },
              ],
            }
          : {}),
      });
      await createAlertRow(prisma, {
        opportunityId,
        userId: recipient.userId,
        alertType,
        deliveryStatus: "SENT",
        sentAt: new Date(),
      });
      log.info("alert.sent", { opportunityId, userId: recipient.userId });
    } catch (error) {
      await createAlertRow(prisma, {
        opportunityId,
        userId: recipient.userId,
        alertType,
        deliveryStatus: "FAILED",
      });
      log.error("alert.send.failed", error, { opportunityId, userId: recipient.userId });
    }
  }
}

interface AlertRowInput {
  opportunityId: string;
  userId: string | null;
  alertType: AlphaRadarAlertType;
  deliveryStatus: "SENT" | "FAILED" | "SUPPRESSED";
  sentAt?: Date;
  /** Only ever set alongside SUPPRESSED — schema comment: "SUPPRESSED pairs with Alert.suppressedReason". */
  suppressedReason?: string | null;
}

async function createAlertRow(prisma: AlertPrisma, input: AlertRowInput): Promise<void> {
  await prisma.alert.create({
    data: {
      opportunityId: input.opportunityId,
      userId: input.userId,
      channel: "TELEGRAM",
      alertType: input.alertType,
      deliveryStatus: input.deliveryStatus,
      sentAt: input.sentAt ?? null,
      suppressedReason: input.suppressedReason ?? null,
    } satisfies Prisma.AlertUncheckedCreateInput,
  });
}
