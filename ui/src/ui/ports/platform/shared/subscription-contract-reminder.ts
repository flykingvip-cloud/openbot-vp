/**
 * Paid-subscription contract reminder helpers (platform admin attention only).
 * Does not imply auto-suspend — stop/continue is an admin decision.
 */

export type SubscriptionContractReminderKind = "none" | "expiring" | "expired";

const DAY_MS = 86_400_000;
const EXPIRING_WINDOW_DAYS = 7;

export function daysUntilIso(dateLike?: string | null, nowMs: number = Date.now()): number | null {
  if (!dateLike) {
    return null;
  }
  const timestamp = Date.parse(dateLike);
  if (!Number.isFinite(timestamp)) {
    return null;
  }
  return Math.ceil((timestamp - nowMs) / DAY_MS);
}

export function resolveSubscriptionContractReminder(
  contractEnd?: string | null,
  nowMs: number = Date.now(),
): { kind: SubscriptionContractReminderKind; days: number | null } {
  const days = daysUntilIso(contractEnd, nowMs);
  if (days == null) {
    return { kind: "none", days: null };
  }
  if (days < 0) {
    return { kind: "expired", days };
  }
  if (days <= EXPIRING_WINDOW_DAYS) {
    return { kind: "expiring", days };
  }
  return { kind: "none", days };
}

export function subscriptionContractLifecycleLabel(params: {
  status: "trial" | "paid" | "suspended" | "expired";
  trialDays: number | null;
  contractDays: number | null;
  contractReminder: SubscriptionContractReminderKind;
}): string {
  if (params.status === "trial") {
    return params.trialDays != null ? `试用剩余 ${params.trialDays} 天` : "试用进行中";
  }
  if (params.status === "suspended") {
    return "等待恢复";
  }
  if (params.status === "expired") {
    return "待续期";
  }
  if (params.contractReminder === "expired") {
    const overdue = params.contractDays != null ? Math.abs(params.contractDays) : null;
    return overdue != null ? `合同已到期 ${overdue} 天` : "合同已到期";
  }
  if (params.contractReminder === "expiring" && params.contractDays != null) {
    return `合同剩余 ${params.contractDays} 天`;
  }
  return "正式租户";
}
