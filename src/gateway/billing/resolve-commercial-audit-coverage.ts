/**
 * Commercial Runtime 审计覆盖率：Usage Ledger 是否带 authorizationDecisionId。
 */

import { resolveCycleWindow } from "./runtime.js";
import { listUsageLedgerEntries } from "./usage-ledger-store.js";

export type CommercialAuditCoverage = {
  enterpriseId: string;
  cycleStart: string;
  cycleEnd: string;
  ledgerEntryCount: number;
  withAuthorizationDecision: number;
  coverageRatio: number | null;
  auditLogEnabled: boolean;
};

export async function resolveCommercialAuditCoverage(
  enterpriseId: string,
  opts?: {
    now?: Date;
    auditLogEnabled?: boolean;
    usageLedger?: string;
  },
): Promise<CommercialAuditCoverage> {
  const now = opts?.now ?? new Date();
  const { cycleStart, cycleEnd } = resolveCycleWindow(now);
  const entries = await listUsageLedgerEntries(
    enterpriseId,
    { startTime: cycleStart, endTime: cycleEnd },
    opts?.usageLedger,
  );
  const withAuthorizationDecision = entries.filter((entry) =>
    Boolean(entry.authorizationDecisionId?.trim()),
  ).length;
  return {
    enterpriseId,
    cycleStart,
    cycleEnd,
    ledgerEntryCount: entries.length,
    withAuthorizationDecision,
    coverageRatio: entries.length > 0 ? withAuthorizationDecision / entries.length : null,
    auditLogEnabled: opts?.auditLogEnabled === true,
  };
}
