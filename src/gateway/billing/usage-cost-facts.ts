/**
 * 把现有 Usage Ledger 和 Credits 阶段机读成同一份请求事实。
 * 不新写账本。账本没有的缓存 token / 价格记为未知，而不是 0。
 */

import type { UsageLedgerEntry } from "../package-entitlement/types.js";
import type { CreditUsageStageRecord } from "./credit-usage-stage-store.js";
import { getCreditUsageStage, listCreditUsageStages } from "./credit-usage-stage-store.js";
import type { UsageRequestFact, UsageSettlementFact } from "./usage-cost-layer.js";
import {
  listAllUsageLedgerEntries,
  listUsageLedgerEntries,
  listUsageLedgerEntriesByTaskId,
} from "./usage-ledger-store.js";

export function describeProviderPrice(input: {
  source: "cost_version" | "catalog" | "none";
  inputCostPer1MCents: number;
  outputCostPer1MCents: number;
  /** undefined = 缓存读单价未配置（有缓存用量时不得伪装已知 0）。 */
  cacheReadCostPer1MCents?: number;
  /** undefined = 缓存写单价未配置。 */
  cacheWriteCostPer1MCents?: number;
  /** 有用量时，免费判定必须覆盖实际计费维（含缓存）。 */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}): { providerPriceState: "known" | "missing"; providerPriceFree: boolean } {
  const inputRate = Math.max(0, Math.floor(input.inputCostPer1MCents));
  const outputRate = Math.max(0, Math.floor(input.outputCostPer1MCents));
  // 目录种子把未定价写成 0/0。只有成本版本里的 0/0 才是确认过的免费模型。
  const unpriced =
    input.source === "none" || (input.source === "catalog" && inputRate === 0 && outputRate === 0);
  if (unpriced) {
    return { providerPriceState: "missing", providerPriceFree: false };
  }

  const cacheReadTokens = Math.max(0, Math.floor(input.usage?.cacheReadTokens ?? 0));
  const cacheWriteTokens = Math.max(0, Math.floor(input.usage?.cacheWriteTokens ?? 0));
  // 缺失缓存单价不得伪装已知 0 / 免费。
  if (cacheReadTokens > 0 && input.cacheReadCostPer1MCents === undefined) {
    return { providerPriceState: "missing", providerPriceFree: false };
  }
  if (cacheWriteTokens > 0 && input.cacheWriteCostPer1MCents === undefined) {
    return { providerPriceState: "missing", providerPriceFree: false };
  }

  const cacheReadRate =
    input.cacheReadCostPer1MCents === undefined
      ? null
      : Math.max(0, Math.floor(input.cacheReadCostPer1MCents));
  const cacheWriteRate =
    input.cacheWriteCostPer1MCents === undefined
      ? null
      : Math.max(0, Math.floor(input.cacheWriteCostPer1MCents));

  // 显式零价可标免费，但须覆盖实际计费维（含缓存）。
  const free =
    inputRate === 0 &&
    outputRate === 0 &&
    (cacheReadTokens <= 0 || cacheReadRate === 0) &&
    (cacheWriteTokens <= 0 || cacheWriteRate === 0);

  return {
    providerPriceState: "known",
    providerPriceFree: free,
  };
}

export type LedgerPriceKind = "known" | "free" | "missing";

export function ledgerPriceKind(
  entry: Pick<UsageLedgerEntry, "providerCostCents" | "providerPriceState" | "providerPriceFree">,
): LedgerPriceKind {
  if (entry.providerPriceState === "known") {
    return entry.providerPriceFree ? "free" : "known";
  }
  if (entry.providerPriceState === "missing") {
    return "missing";
  }
  return entry.providerCostCents > 0 ? "known" : "missing";
}

export const USAGE_COST_FACT_LIMIT = 200;

export type LoadUsageCostFactsInput = {
  enterpriseId?: string | null;
  allEnterprises?: boolean;
  startTime?: string;
  endTime?: string;
  ledgerStorePath?: string;
  stageStorePath?: string;
  /**
   * When set, load that taskId authoritatively (no global USAGE_COST_FACT_LIMIT window).
   * FT-TASKID-USAGE-LEDGER / B2.
   */
  taskId?: string | null;
};

/** Distinguishes unbooked / BYOK skip vs truly empty UI (B3). */
export type UsageTaskLedgerEmptyReason =
  | "none"
  | "no_ledger_entry"
  | "skipped_consumption"
  | "filtered_empty";

export type LoadUsageCostFactsResult = {
  facts: UsageRequestFact[];
  truncated: boolean;
  emptyReason: UsageTaskLedgerEmptyReason;
  /** Tip spend is a separate projection; never treat it as this ledger (B5). */
  ledgerBasis: "usage_ledger_not_tip_spend";
};

function measuredToken(value: number | undefined): number | null {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
}

function settlementFor(
  entry: UsageLedgerEntry,
  stage: CreditUsageStageRecord | undefined,
): UsageSettlementFact {
  const byok = entry.billingOwner === "enterprise" || entry.source === "enterprise";
  const price = ledgerPriceKind(entry);
  if (byok) {
    if (price === "missing") {
      return { kind: "unknown" };
    }
    return {
      kind: "byok_estimate",
      currency: "CNY",
      amountCents: entry.providerCostCents,
      basis:
        price === "free" ? "价格已确认的免费模型，不是结算扣费" : "已配置价格口径，不是结算扣费",
    };
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
  const price = ledgerPriceKind(entry);
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
    inputTokens: measuredToken(entry.inputTokens),
    outputTokens: measuredToken(entry.outputTokens),
    cacheReadTokens: measuredToken(entry.cacheReadTokens),
    cacheWriteTokens: measuredToken(entry.cacheWriteTokens),
    latencyMs: entry.durationMs ?? null,
    acceptance: null,
    anomaly: false,
    settlement: settlementFor(entry, stage),
    recordedCredits:
      entry.billingOwner === "enterprise" || entry.source === "enterprise"
        ? null
        : entry.creditsCharged,
    procurementCents: price === "missing" ? null : entry.providerCostCents,
    procurementCurrency: price === "missing" ? null : "CNY",
    procurementPrice: price,
    revenueCents: entry.tenantRevenueCents,
  };
}

export async function loadUsageCostFacts(
  input: LoadUsageCostFactsInput,
): Promise<LoadUsageCostFactsResult> {
  const taskId = input.taskId?.trim() || "";
  if (taskId) {
    return loadUsageCostFactsForTaskId({
      taskId,
      enterpriseId: input.enterpriseId,
      allEnterprises: input.allEnterprises,
      ledgerStorePath: input.ledgerStorePath,
      stageStorePath: input.stageStorePath,
    });
  }

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
  const facts = selected.map((entry) =>
    ledgerEntryToUsageFact(entry, stageByTask.get(`${entry.enterpriseId}|${entry.taskId}`)),
  );
  return {
    truncated,
    facts,
    emptyReason: facts.length === 0 ? "no_ledger_entry" : "none",
    ledgerBasis: "usage_ledger_not_tip_spend",
  };
}

/**
 * Authoritative per-taskId aggregation for the platform usage ledger (FT-TASKID-USAGE-LEDGER).
 * Bypasses USAGE_COST_FACT_LIMIT so a live task is not mis-emptied by the global last-200 window.
 */
export async function loadUsageCostFactsForTaskId(input: {
  taskId: string;
  enterpriseId?: string | null;
  allEnterprises?: boolean;
  ledgerStorePath?: string;
  stageStorePath?: string;
}): Promise<LoadUsageCostFactsResult> {
  const taskId = input.taskId.trim();
  const enterpriseId = input.enterpriseId?.trim() || "";
  const entries = await listUsageLedgerEntriesByTaskId(taskId, {
    enterpriseId: input.allEnterprises || !enterpriseId ? null : enterpriseId,
    storePath: input.ledgerStorePath,
  });

  const stages = await listCreditUsageStages(
    input.allEnterprises || !enterpriseId ? null : enterpriseId,
    input.stageStorePath,
  );
  const stageByTask = new Map<string, CreditUsageStageRecord>();
  for (const stage of stages) {
    stageByTask.set(`${stage.enterpriseId}|${stage.taskId}`, stage);
  }

  const facts = entries
    .toSorted((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .map((entry) =>
      ledgerEntryToUsageFact(entry, stageByTask.get(`${entry.enterpriseId}|${entry.taskId}`)),
    );

  if (facts.length > 0) {
    return {
      truncated: false,
      facts,
      emptyReason: "none",
      ledgerBasis: "usage_ledger_not_tip_spend",
    };
  }

  // No ledger row: distinguish skippedConsumption / unbooked from plain empty UI (B3).
  let skipped = false;
  if (enterpriseId) {
    const stage = await getCreditUsageStage(enterpriseId, taskId, input.stageStorePath);
    skipped = Boolean(stage?.skippedConsumption);
  } else {
    for (const stage of stages) {
      if (stage.taskId === taskId && stage.skippedConsumption) {
        skipped = true;
        break;
      }
    }
  }

  return {
    truncated: false,
    facts: [],
    emptyReason: skipped ? "skipped_consumption" : "no_ledger_entry",
    ledgerBasis: "usage_ledger_not_tip_spend",
  };
}
