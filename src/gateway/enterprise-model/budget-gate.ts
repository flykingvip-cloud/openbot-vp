/**
 * Per-model monthly spend cap for enterprise BYOK assets.
 * Spec: `.kiro/specs/enterprise-ai-model-governance/`
 */

import { resolveCycleWindow } from "../billing/runtime.js";
import { listUsageLedgerEntries } from "../billing/usage-ledger-store.js";
import { recordEnterpriseModelAuditEvent } from "./audit.js";
import { EnterpriseModelError } from "./errors.js";
import type { EnterpriseModelAsset } from "./types.js";

/** Pure: whether spend has reached/exceeded the configured monthly cap. */
export function isEnterpriseModelBudgetExceeded(params: {
  monthlySpendCapCents?: number;
  spendCentsInCycle: number;
}): boolean {
  const cap = params.monthlySpendCapCents;
  if (cap == null || !Number.isFinite(cap) || cap < 0) {
    return false;
  }
  return params.spendCentsInCycle >= Math.floor(cap);
}

export async function sumEnterpriseModelSpendCentsInCycle(params: {
  tenantId: string;
  runtimeModelId: string;
  now?: Date;
  usageLedgerPath?: string;
}): Promise<number> {
  const { cycleStart, cycleEnd } = resolveCycleWindow(params.now ?? new Date());
  const entries = await listUsageLedgerEntries(
    params.tenantId,
    { startTime: cycleStart, endTime: cycleEnd },
    params.usageLedgerPath,
  );
  let spend = 0;
  for (const entry of entries) {
    if (entry.modelId?.trim() !== params.runtimeModelId.trim()) {
      continue;
    }
    spend += Math.max(0, Math.floor(entry.providerCostCents ?? 0));
  }
  return spend;
}

/**
 * Fail-closed when the asset declares a monthlySpendCapCents and cycle spend is exhausted.
 * No cap configured → allow (unit cost metadata alone does not enforce).
 */
export async function assertEnterpriseModelBudgetAllows(params: {
  tenantId: string;
  asset: EnterpriseModelAsset;
  now?: Date;
  usageLedgerPath?: string;
}): Promise<void> {
  const cap = params.asset.budget?.monthlySpendCapCents;
  if (cap == null) {
    return;
  }
  const spendCentsInCycle = await sumEnterpriseModelSpendCentsInCycle({
    tenantId: params.tenantId,
    runtimeModelId: params.asset.runtimeModelId,
    ...(params.now ? { now: params.now } : {}),
    ...(params.usageLedgerPath ? { usageLedgerPath: params.usageLedgerPath } : {}),
  });
  if (
    isEnterpriseModelBudgetExceeded({
      monthlySpendCapCents: cap,
      spendCentsInCycle,
    })
  ) {
    // Best-effort audit before fail-closed throw (never includes secrets).
    try {
      await recordEnterpriseModelAuditEvent({
        tenantId: params.tenantId,
        action: "runtime.budget_blocked",
        targetType: "asset",
        targetId: params.asset.assetId,
        result: "failure",
        code: "ENTERPRISE_MODEL_FORBIDDEN",
        details: {
          runtimeModelId: params.asset.runtimeModelId,
          spendCentsInCycle,
          monthlySpendCapCents: Math.floor(cap),
        },
      });
    } catch {
      // Audit must not mask the budget gate.
    }
    throw new EnterpriseModelError(
      "ENTERPRISE_MODEL_FORBIDDEN",
      `enterprise model monthly budget exceeded (spend=${spendCentsInCycle}¢, cap=${Math.floor(cap)}¢)`,
    );
  }
}
