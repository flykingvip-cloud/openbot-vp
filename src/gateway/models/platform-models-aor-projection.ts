import { readFileSync, existsSync } from "node:fs";
import { readBanditPersistedState, BanditFeedbackStore } from "@openbot/aor-core";
import { listUsageRecords } from "../billing/usage-records-store.js";
import type { ResolvedPlatformModelsConfig } from "./platform-models-config.js";
import type {
  PlatformModelsAorProjection,
  PlatformModelsAorStatus,
  PlatformModelsAorSyncStatus,
  PlatformModelsLiveCodingEvidenceSnapshot,
  PlatformModelsManagementSnapshot,
  PlatformModelsPlanSnapshot,
  PlatformModelsPolicyBindingSnapshot,
  PlatformModelsRoutingExplanationSnapshot,
} from "./platform-models-types.js";

const AOR_SAVINGS_KEY = "aor_optimization_savings";
const AOR_REVENUE_KEY = "aor_optimization_revenue_share";

export function buildPolicyBindings(
  plans: PlatformModelsPlanSnapshot[],
): PlatformModelsPolicyBindingSnapshot[] {
  return plans.map((plan) => {
    const exec = plan.aorExecution;
    const taskProfileId = plan.taskProfileId ?? plan.planId;
    if (!exec) {
      return {
        planId: plan.planId,
        taskProfileId,
        taskTypeId: "",
        selectorStrategy: "balanced",
        evaluatorMode: "content",
        mapped: false,
      };
    }
    return {
      planId: plan.planId,
      taskProfileId,
      taskTypeId: exec.taskTypeId,
      selectorStrategy: exec.selectorStrategy,
      evaluatorMode: exec.evaluatorMode,
      mapped: true,
    };
  });
}

function loadBanditArms(banditStatePath: string | undefined): {
  arms: Array<{ arm: string; mean: number; trials: number }>;
  updatedAt?: number;
} {
  if (!banditStatePath) {
    return { arms: [] };
  }
  const state = readBanditPersistedState(banditStatePath);
  if (!state) {
    return { arms: [] };
  }
  const store = new BanditFeedbackStore();
  store.importPersistedState(state);
  return { arms: store.learningSnapshot(), updatedAt: Date.now() };
}

function loadLiveCodingEvidence(
  path: string | undefined,
): PlatformModelsLiveCodingEvidenceSnapshot[] {
  if (!path || !existsSync(path)) {
    return [];
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as {
      archivedAt?: string;
      workspace?: string;
      goal?: string;
      result?: {
        runId?: string;
        model?: string;
        evaluationScore?: number;
      };
    };
    if (!raw.result?.runId) {
      return [];
    }
    return [
      {
        archivedAt: raw.archivedAt ?? new Date().toISOString(),
        workspace: raw.workspace ?? "",
        goal: raw.goal ?? "",
        model: raw.result.model ?? "",
        evaluationScore: raw.result.evaluationScore,
        runId: raw.result.runId,
      },
    ];
  } catch {
    return [];
  }
}

function loadAuditExplanations(
  auditLogPath: string | undefined,
  limit: number,
): PlatformModelsRoutingExplanationSnapshot[] {
  if (!auditLogPath || !existsSync(auditLogPath)) {
    return [];
  }
  try {
    const lines = readFileSync(auditLogPath, "utf8").trim().split("\n").filter(Boolean);
    const tail = lines.slice(-limit);
    const out: PlatformModelsRoutingExplanationSnapshot[] = [];
    for (const line of tail) {
      const record = JSON.parse(line) as {
        runId?: string;
        taskType?: string;
        goal?: string;
        strategy?: string;
        selection?: { model?: string; reason?: string; score?: number };
        evaluationScore?: number;
        occurredAt?: string;
      };
      if (!record.runId || !record.selection?.model) {
        continue;
      }
      out.push({
        requestId: record.runId,
        taskProfileId: record.taskType ?? "unknown",
        selectedModelId: record.selection.model,
        matchedRules: [record.strategy ?? "balanced", record.selection.reason ?? ""].filter(
          Boolean,
        ),
        rejectedModels: [],
        fallbackChain: [],
        decisionReason: record.selection.reason ?? record.strategy ?? "AOR selection",
        evaluatorScore: record.evaluationScore ?? record.selection.score,
        createdAt: record.occurredAt ? Date.parse(record.occurredAt) : Date.now(),
      });
    }
    return out.toReversed();
  } catch {
    return [];
  }
}

async function loadOptimizationMetrics(enterpriseId: string | undefined): Promise<{
  savingsProxyQty: number;
  revenueShareProxyQty: number;
  savingsUsd?: number;
  revenueShareUsd?: number;
  updatedAt?: number;
}> {
  if (!enterpriseId) {
    return { savingsProxyQty: 0, revenueShareProxyQty: 0 };
  }
  try {
    const usage = await listUsageRecords(enterpriseId, {});
    let savingsProxyQty = 0;
    let revenueShareProxyQty = 0;
    for (const rec of usage) {
      if (rec.key === AOR_SAVINGS_KEY) {
        savingsProxyQty += rec.quantity;
      }
      if (rec.key === AOR_REVENUE_KEY) {
        revenueShareProxyQty += rec.quantity;
      }
    }
    return {
      savingsProxyQty,
      revenueShareProxyQty,
      savingsUsd: savingsProxyQty / 100,
      revenueShareUsd: revenueShareProxyQty / 100,
      updatedAt: Date.now(),
    };
  } catch {
    return { savingsProxyQty: 0, revenueShareProxyQty: 0 };
  }
}

function resolveSyncStatus(params: {
  enabled: boolean;
  arms: unknown[];
  explanations: unknown[];
  optimizationQty: number;
}): PlatformModelsAorSyncStatus {
  if (!params.enabled) {
    return "unavailable";
  }
  const hasData =
    params.arms.length > 0 || params.explanations.length > 0 || params.optimizationQty > 0;
  return hasData ? "ok" : "degraded";
}

export async function buildPlatformModelsAorProjection(params: {
  config: ResolvedPlatformModelsConfig;
  plans: PlatformModelsPlanSnapshot[];
  enterpriseId?: string;
  explanationLimit?: number;
}): Promise<PlatformModelsAorProjection | undefined> {
  if (params.config.mode !== "aor_enhanced") {
    return undefined;
  }
  const { aor } = params.config;
  const policyBindings = buildPolicyBindings(params.plans);
  const learning = aor.enableBandit ? loadBanditArms(aor.banditStatePath) : { arms: [] };
  const liveCodingEvidence = loadLiveCodingEvidence(aor.liveCodingArchivePath);
  const routingExplanations = aor.enableRoutingExplanations
    ? loadAuditExplanations(aor.auditLogPath, params.explanationLimit ?? 20)
    : [];
  const optimization = aor.enableOptimizationMetrics
    ? await loadOptimizationMetrics(params.enterpriseId)
    : { savingsProxyQty: 0, revenueShareProxyQty: 0 };

  const syncStatus = resolveSyncStatus({
    enabled: true,
    arms: learning.arms,
    explanations: routingExplanations,
    optimizationQty: optimization.savingsProxyQty + optimization.revenueShareProxyQty,
  });

  return {
    enabled: true,
    syncStatus,
    policyBindings,
    routingExplanations,
    learning,
    optimization,
    liveCodingEvidence,
  };
}

export function buildPlatformModelsAorStatus(params: {
  config: ResolvedPlatformModelsConfig;
  snapshot?: PlatformModelsManagementSnapshot;
}): PlatformModelsAorStatus {
  const enabled = params.config.mode === "aor_enhanced";
  return {
    mode: params.config.mode,
    enabled,
    syncStatus: enabled ? (params.snapshot?.aor?.syncStatus ?? "degraded") : "unavailable",
    banditStatePath: params.config.aor.banditStatePath,
    liveCodingArchivePath: params.config.aor.liveCodingArchivePath,
    lastSnapshotAt: params.snapshot?.generatedAt,
  };
}
