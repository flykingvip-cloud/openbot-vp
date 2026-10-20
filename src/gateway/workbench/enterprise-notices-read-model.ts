import type { BudgetCheckLevel, CommercialGovernanceStatus } from "../billing/types.js";

export type EnterpriseNoticeKind = "budget" | "over-allocation" | "credits" | "channel-offline";

export type EnterpriseNoticeSeverity = "info" | "warning" | "critical";

export type EnterpriseNoticeItem = {
  id: string;
  kind: EnterpriseNoticeKind;
  severity: EnterpriseNoticeSeverity;
  /**
   * Machine-stable code the UI localizes (e.g. "budget-exceeded",
   * "channel-offline"). Keeps the read-model free of display strings / i18n.
   */
  code: string;
  /** Best-effort count (e.g. over-allocation overage, offline channel index). */
  count?: number;
  /** Best-effort origin (e.g. "telegram:default" for an offline channel). */
  source?: string;
};

export type EnterpriseNoticesResult = {
  totalCount: number;
  /** Budget + over-allocation + credits alerts (financial). */
  billingCount: number;
  /** Tenant channel accounts that are configured but offline. */
  channelOfflineCount: number;
  items: EnterpriseNoticeItem[];
};

export type EnterpriseNoticesOfflineChannel = {
  channelId: string;
  accountId: string;
  /** evaluateChannelHealth reason (not-running / disconnected / stuck / stale-socket). */
  reason: string;
};

export type EnterpriseNoticesInput = {
  /** Tenant budget status; alert when level !== "ok". */
  budget?: { level: BudgetCheckLevel } | null;
  /** Commercial governance; alert when status === "over_allocated". */
  overAllocation?: { status: CommercialGovernanceStatus } | null;
  /** Tenant credits; low/exhausted derived from remaining vs monthly. */
  credits?: { monthlyCredits: number; creditsRemaining: number } | null;
  /** Pre-resolved offline channel accounts (already tenant-scoped by the caller). */
  offlineChannels?: EnterpriseNoticesOfflineChannel[];
  /** remaining/monthly below this ratio → low-credits warning. Default 0.1 (10%). */
  creditsLowThreshold?: number;
};

const DEFAULT_CREDITS_LOW_THRESHOLD = 0.1;

/**
 * Deterministic "system notices" projection for the ENTERPRISE ADMIN overview
 * (not the employee home). Aggregates the install/admin-scoped signals that are
 * intentionally excluded from the per-employee 重要通知 card — financial
 * (budget / over-allocation / credits) and channel connectivity — into flat
 * counts + machine-stable items. Pure shaping over already-resolved inputs so it
 * is trivially unit-testable; no LLM, no I/O.
 *
 * Caller responsibilities (enforced in the RPC handler, not here):
 *   - gate on enterprise-admin scope (employees must never see this),
 *   - resolve budget/over-allocation/credits for the caller's tenant only,
 *   - resolve `offlineChannels` from the tenant's CONFIGURED channel accounts.
 */
export function buildEnterpriseNotices(input: EnterpriseNoticesInput): EnterpriseNoticesResult {
  const items: EnterpriseNoticeItem[] = [];

  // (1) Budget threshold / overrun.
  const budgetLevel = input.budget?.level;
  if (budgetLevel === "exceeded") {
    items.push({ id: "budget", kind: "budget", severity: "critical", code: "budget-exceeded" });
  } else if (budgetLevel === "alert") {
    items.push({ id: "budget", kind: "budget", severity: "warning", code: "budget-alert" });
  }

  // (2) Over-allocation (seats / bots / models beyond the subscription).
  if (input.overAllocation?.status === "over_allocated") {
    items.push({
      id: "over-allocation",
      kind: "over-allocation",
      severity: "warning",
      code: "over-allocated",
    });
  }

  // (3) Credits exhausted / running low (only meaningful when a monthly grant exists).
  const credits = input.credits;
  if (credits && credits.monthlyCredits > 0) {
    const threshold = input.creditsLowThreshold ?? DEFAULT_CREDITS_LOW_THRESHOLD;
    if (credits.creditsRemaining <= 0) {
      items.push({
        id: "credits",
        kind: "credits",
        severity: "critical",
        code: "credits-exhausted",
      });
    } else if (credits.creditsRemaining / credits.monthlyCredits < threshold) {
      items.push({ id: "credits", kind: "credits", severity: "warning", code: "credits-low" });
    }
  }

  const billingCount = items.length;

  // (4) Offline tenant channels (caller already scoped to tenant-configured accounts).
  const offline = input.offlineChannels ?? [];
  for (const channel of offline) {
    items.push({
      id: `channel-offline:${channel.channelId}:${channel.accountId}`,
      kind: "channel-offline",
      severity: "warning",
      code: "channel-offline",
      source: `${channel.channelId}:${channel.accountId}`,
    });
  }

  return {
    totalCount: items.length,
    billingCount,
    channelOfflineCount: offline.length,
    items,
  };
}
