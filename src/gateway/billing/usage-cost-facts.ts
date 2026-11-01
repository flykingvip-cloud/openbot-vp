/**
 * 把现有 Usage Ledger 和 Credits 阶段机读成同一份请求事实。
 * 不新写账本。账本没有的缓存 token / 价格记为未知，而不是 0。
 */

import type { UsageLedgerEntry } from "../package-entitlement/types.js";
import type { CreditUsageStageRecord } from "./credit-usage-stage-store.js";
import { listCreditUsageStages } from "./credit-usage-stage-store.js";
import type { UsageRequestFact, UsageSettlementFact } from "./usage-cost-layer.js";
import { listAllUsageLedgerEntries, listUsageLedgerEntries } from "./usage-ledger-store.js";

export const USAGE_COST_FACT_LIMIT = 200;

export type LoadUsageCostFactsInput = {
  enterpriseId?: string | null;
  allEnterprises?: boolean;
  startTime?: string;
  endTime?: string;
  ledgerStorePath?: string;
  stageStorePath?: string;
};

function settlementFor(
  entry: UsageLedgerEntry,
  stage: CreditUsageStageRecord | undefined,
): UsageSettlementFact {
  const byok = entry.billingOwner === "enterprise" || entry.source === "enterprise";
  if (byok) {
    if (entry.providerCostCents > 0) {
      return {
        kind: "byok_estimate",
        currency: "CNY",
        amountCents: entry.providerCostCents,
        basis: "已配置价格口径，不是结算扣费",
      };
    }
    return { kind: "unknown" };
  }
  if (stage?.stage !== "done") {
    return { kind: "pending", credits: entry.creditsCharged };
  }
  if ((entry.overageAmountCents ?? 0) > 0) {
    return {
      kind: "invoice",
      currency: "CNY",
      amountCents: entry.overageAmountCents ?? 0,
      final: true,
    };
  }
  if (entry.tenantRevenueCents > 0) {
    return {
      kind: "invoice",
      currency: "CNY",
      amountCents: entry.tenantRevenueCents,
      final: true,
    };
  }
  if ((entry.includedCredits ?? 0) > 0) {
    return { kind: "quota", credits: entry.includedCredits ?? entry.creditsCharged, final: true };
  }
  return { kind: "credits", credits: entry.creditsCharged, final: true };
}

function statusFor(stage: CreditUsageStageRecord | undefined): UsageRequestFact["status"] {
  if (!stage) {
    return "unknown";
  }
  if (stage.stage === "done") {
    return "succeeded";
  }
  return "running";
}

export function ledgerEntryToUsageFact(
  entry: UsageLedgerEntry,
  stage: CreditUsageStageRecord | undefined,
): UsageRequestFact {
  const procurementKnown = entry.providerCostCents > 0;
  return {
    requestId: entry.id,
    taskId: entry.taskId,
    parentTaskId: null,
    role: "task_rollup",
    revision: 1,
    occurredAt: entry.occurredAt,
    enterpriseId: entry.enterpriseId,
    userId: entry.userId ?? null,
    assistantId: entry.botId ?? null,
    provider: null,
    model: entry.modelId || null,
    purpose: null,
    taskType: null,
    status: statusFor(stage),
    attempt: (entry.retryCount ?? 0) > 0 ? "retry" : "primary",
    inputTokens: entry.inputTokens ?? null,
    outputTokens: entry.outputTokens ?? null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    latencyMs: entry.durationMs ?? null,
    acceptance: null,
    anomaly: false,
    settlement: settlementFor(entry, stage),
    recordedCredits:
      entry.billingOwner === "enterprise" || entry.source === "enterprise"
        ? null
        : entry.creditsCharged,
    procurementCents: procurementKnown ? entry.providerCostCents : null,
    procurementCurrency: procurementKnown ? "CNY" : null,
    revenueCents: entry.tenantRevenueCents,
  };
}

export async function loadUsageCostFacts(
  input: LoadUsageCostFactsInput,
): Promise<{ facts: UsageRequestFact[]; truncated: boolean }> {
  const window = {
    ...(input.startTime ? { startTime: input.startTime } : {}),
    ...(input.endTime ? { endTime: input.endTime } : {}),
  };
  const entries = input.allEnterprises
    ? await listAllUsageLedgerEntries(window, input.ledgerStorePath)
    : await listUsageLedgerEntries(input.enterpriseId ?? "", window, input.ledgerStorePath);
  const stages = await listCreditUsageStages(
    input.allEnterprises ? null : (input.enterpriseId ?? ""),
    input.stageStorePath,
  );
  const stageByTask = new Map<string, CreditUsageStageRecord>();
  for (const stage of stages) {
    stageByTask.set(`${stage.enterpriseId}|${stage.taskId}`, stage);
  }
  const ordered = entries.toSorted((left, right) =>
    right.occurredAt.localeCompare(left.occurredAt),
  );
  const truncated = ordered.length > USAGE_COST_FACT_LIMIT;
  const selected = ordered.slice(0, USAGE_COST_FACT_LIMIT);
  return {
    truncated,
    facts: selected.map((entry) =>
      ledgerEntryToUsageFact(entry, stageByTask.get(`${entry.enterpriseId}|${entry.taskId}`)),
    ),
  };
}
