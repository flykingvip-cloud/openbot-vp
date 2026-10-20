import type { OpenBotConfig } from "../../config/types.js";
import { discoverAllSessions, loadSessionCostSummary } from "../../infra/session-cost-usage.js";
import { listUsageRecords } from "../billing/usage-records-store.js";
import { listAgentsForGateway } from "../session-utils.js";
import type {
  PlatformModelsPlanSnapshot,
  PlatformModelsRoutingExplanationSnapshot,
  PlatformModelsRoutingPolicySnapshot,
  PlatformModelsUsageModelSnapshot,
  PlatformModelsUsagePlanSnapshot,
  PlatformModelsUsagePolicySnapshot,
  PlatformModelsUsageTaskSnapshot,
} from "./platform-models-types.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 7;
const MAX_SESSIONS_SCAN = 160;

type ModelAgg = {
  modelRef: string;
  providerId: string;
  modelId: string;
  calls7d: number;
  cost7d: number;
  totalTokens: number;
  errorCount: number;
  latencySum: number;
  latencyCount: number;
};

function normalizeModelRef(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.includes("/")) {
    return trimmed;
  }
  return trimmed;
}

function splitModelRef(modelRef: string): { providerId: string; modelId: string } {
  const normalized = normalizeModelRef(modelRef);
  const slash = normalized.indexOf("/");
  if (slash <= 0) {
    return { providerId: "unknown", modelId: normalized };
  }
  return {
    providerId: normalized.slice(0, slash),
    modelId: normalized.slice(slash + 1),
  };
}

function mergeModelAgg(
  store: Map<string, ModelAgg>,
  modelRef: string,
  delta: Omit<ModelAgg, "modelRef" | "providerId" | "modelId">,
) {
  const normalized = normalizeModelRef(modelRef);
  if (!normalized) {
    return;
  }
  const { providerId, modelId } = splitModelRef(normalized);
  const existing =
    store.get(normalized) ??
    ({
      modelRef: normalized,
      providerId,
      modelId,
      calls7d: 0,
      cost7d: 0,
      totalTokens: 0,
      errorCount: 0,
      latencySum: 0,
      latencyCount: 0,
    } satisfies ModelAgg);
  existing.calls7d += delta.calls7d;
  existing.cost7d = Number((existing.cost7d + delta.cost7d).toFixed(4));
  existing.totalTokens += delta.totalTokens;
  existing.errorCount += delta.errorCount;
  existing.latencySum += delta.latencySum;
  existing.latencyCount += delta.latencyCount;
  store.set(normalized, existing);
}

function parseBillingUsageKey(
  key: string,
): { kind: "model" | "policy" | "task" | "plan"; id: string } | null {
  const trimmed = key.trim();
  const prefixes = ["model/", "policy/", "task/", "plan/"] as const;
  for (const prefix of prefixes) {
    if (trimmed.startsWith(prefix)) {
      const id = trimmed.slice(prefix.length).trim();
      if (!id) {
        return null;
      }
      return {
        kind: prefix.slice(0, -1) as "model" | "policy" | "task" | "plan",
        id,
      };
    }
  }
  return null;
}

async function aggregateSessionModelUsage(params: {
  cfg: OpenBotConfig;
  startMs: number;
  endMs: number;
}): Promise<Map<string, ModelAgg>> {
  const store = new Map<string, ModelAgg>();
  const agents = listAgentsForGateway(params.cfg).agents;
  const discovered = (
    await Promise.all(
      agents.map(async (agent) => {
        const sessions = await discoverAllSessions({
          agentId: agent.id,
          startMs: params.startMs,
          endMs: params.endMs,
        });
        return sessions.map((session) => ({ ...session, agentId: agent.id }));
      }),
    )
  )
    .flat()
    .toSorted((left, right) => right.mtime - left.mtime)
    .slice(0, MAX_SESSIONS_SCAN);

  for (const session of discovered) {
    const summary = await loadSessionCostSummary({
      sessionFile: session.sessionFile,
      config: params.cfg,
      agentId: session.agentId,
      startMs: params.startMs,
      endMs: params.endMs,
    });
    if (!summary) {
      continue;
    }
    const errors = summary.messageCounts?.errors ?? 0;
    const totalMessages = summary.messageCounts?.total ?? 0;
    const sessionErrorRate = totalMessages > 0 ? errors / totalMessages : 0;
    const avgLatency = summary.latency && summary.latency.count > 0 ? summary.latency.avgMs : 0;

    if (summary.modelUsage?.length) {
      for (const entry of summary.modelUsage) {
        const modelRef = normalizeModelRef(
          `${entry.provider ?? "unknown"}/${entry.model ?? "unknown"}`,
        );
        const calls = entry.count ?? 0;
        const cost = entry.totals?.totalCost ?? 0;
        const tokens = entry.totals?.totalTokens ?? 0;
        mergeModelAgg(store, modelRef, {
          calls7d: calls,
          cost7d: cost,
          totalTokens: tokens,
          errorCount: Math.round(calls * sessionErrorRate),
          latencySum: avgLatency * calls,
          latencyCount: calls,
        });
      }
    }
  }

  return store;
}

async function mergeBillingUsage(params: {
  enterpriseId?: string;
  startMs: number;
  endMs: number;
  store: Map<string, ModelAgg>;
  policyQuantities: Map<string, number>;
}) {
  if (!params.enterpriseId?.trim()) {
    return;
  }
  try {
    const records = await listUsageRecords(params.enterpriseId, {
      startTime: new Date(params.startMs).toISOString(),
      endTime: new Date(params.endMs).toISOString(),
    });
    for (const record of records) {
      const parsed = parseBillingUsageKey(record.key);
      if (!parsed) {
        continue;
      }
      if (parsed.kind === "model") {
        mergeModelAgg(params.store, parsed.id, {
          calls7d: record.quantity,
          cost7d: 0,
          totalTokens: 0,
          errorCount: 0,
          latencySum: 0,
          latencyCount: 0,
        });
      }
      if (parsed.kind === "policy") {
        params.policyQuantities.set(
          parsed.id,
          (params.policyQuantities.get(parsed.id) ?? 0) + record.quantity,
        );
      }
    }
  } catch {
    // Billing store unavailable — session aggregation still applies.
  }
}

function modelRefsForPlan(plan: PlatformModelsPlanSnapshot): string[] {
  return [...plan.primaryModelIds, ...plan.fallbackModelIds].map(normalizeModelRef).filter(Boolean);
}

function modelRefsForPolicy(policy: PlatformModelsRoutingPolicySnapshot): string[] {
  return [...policy.primaryModelIds, ...policy.fallbackModelIds]
    .map(normalizeModelRef)
    .filter(Boolean);
}

function sumModelUsage(
  modelRefs: string[],
  store: Map<string, ModelAgg>,
): {
  calls7d: number;
  cost7d: number;
  avgLatencyMs?: number;
  successRate?: number;
  fallbackRate?: number;
} {
  let calls7d = 0;
  let cost7d = 0;
  let latencySum = 0;
  let latencyCount = 0;
  let errorCount = 0;
  for (const ref of modelRefs) {
    const entry = store.get(ref);
    if (!entry) {
      continue;
    }
    calls7d += entry.calls7d;
    cost7d += entry.cost7d;
    latencySum += entry.latencySum;
    latencyCount += entry.latencyCount;
    errorCount += entry.errorCount;
  }
  const successRate =
    calls7d > 0 ? Number(Math.max(0, 100 - (errorCount / calls7d) * 100).toFixed(1)) : undefined;
  return {
    calls7d,
    cost7d: Number(cost7d.toFixed(4)),
    avgLatencyMs: latencyCount > 0 ? Number((latencySum / latencyCount).toFixed(1)) : undefined,
    successRate,
  };
}

function derivePolicyPerformance(params: {
  policy: PlatformModelsRoutingPolicySnapshot;
  explanations: PlatformModelsRoutingExplanationSnapshot[];
}): Pick<
  PlatformModelsUsagePolicySnapshot,
  "primaryHitRate" | "fallbackRate" | "manualOverrideRate" | "avgLatencyMs" | "avgCostPerRequest"
> {
  const relevant = params.explanations.filter((entry) => {
    if (entry.planId && params.policy.planId) {
      return entry.planId === params.policy.planId;
    }
    if (entry.taskProfileId && params.policy.taskProfileId) {
      return entry.taskProfileId === params.policy.taskProfileId;
    }
    return false;
  });
  if (relevant.length === 0) {
    return {};
  }
  const primarySet = new Set(params.policy.primaryModelIds.map(normalizeModelRef));
  const fallbackSet = new Set(params.policy.fallbackModelIds.map(normalizeModelRef));
  let primaryHits = 0;
  let fallbackHits = 0;
  let scoreSum = 0;
  let scoreCount = 0;
  for (const entry of relevant) {
    const selected = normalizeModelRef(entry.selectedModelId);
    if (primarySet.has(selected)) {
      primaryHits += 1;
    } else if (fallbackSet.has(selected)) {
      fallbackHits += 1;
    }
    if (entry.evaluatorScore != null) {
      scoreSum += entry.evaluatorScore;
      scoreCount += 1;
    }
  }
  const total = relevant.length;
  return {
    primaryHitRate: Number(((primaryHits / total) * 100).toFixed(1)),
    fallbackRate: Number(((fallbackHits / total) * 100).toFixed(1)),
    manualOverrideRate: undefined,
    avgLatencyMs: undefined,
    avgCostPerRequest: scoreCount > 0 ? Number((scoreSum / scoreCount).toFixed(4)) : undefined,
  };
}

export async function buildPlatformModelsUsageProjection(params: {
  cfg: OpenBotConfig;
  enterpriseId?: string;
  plans: PlatformModelsPlanSnapshot[];
  routingPolicies: PlatformModelsRoutingPolicySnapshot[];
  routingExplanations?: PlatformModelsRoutingExplanationSnapshot[];
}): Promise<{
  usageByModel: PlatformModelsUsageModelSnapshot[];
  usageByPolicy: PlatformModelsUsagePolicySnapshot[];
  usageByTask: PlatformModelsUsageTaskSnapshot[];
  usageByPlan: PlatformModelsUsagePlanSnapshot[];
}> {
  const endMs = Date.now();
  const startMs = endMs - WINDOW_DAYS * DAY_MS;
  const modelStore = await aggregateSessionModelUsage({
    cfg: params.cfg,
    startMs,
    endMs,
  });
  const policyQuantities = new Map<string, number>();
  await mergeBillingUsage({
    enterpriseId: params.enterpriseId,
    startMs,
    endMs,
    store: modelStore,
    policyQuantities,
  });

  const usageByModel = [...modelStore.values()]
    .map((entry) => ({
      modelRef: entry.modelRef,
      providerId: entry.providerId,
      modelId: entry.modelId,
      calls7d: entry.calls7d,
      cost7d: entry.cost7d,
      totalTokens: entry.totalTokens,
      successRate:
        entry.calls7d > 0
          ? Number(Math.max(0, 100 - (entry.errorCount / entry.calls7d) * 100).toFixed(1))
          : undefined,
      avgLatencyMs:
        entry.latencyCount > 0
          ? Number((entry.latencySum / entry.latencyCount).toFixed(1))
          : undefined,
      quantity: entry.calls7d,
    }))
    .toSorted((left, right) => right.calls7d - left.calls7d);

  const usageByPlan: PlatformModelsUsagePlanSnapshot[] = params.plans.map((plan) => {
    const refs = modelRefsForPlan(plan);
    const summed = sumModelUsage(refs, modelStore);
    return {
      planId: plan.planId,
      taskProfileId: plan.taskProfileId ?? plan.planId,
      name: plan.name ?? plan.planId,
      calls7d: summed.calls7d,
      cost7d: summed.cost7d,
      fallbackRate: summed.fallbackRate,
    };
  });

  const taskGroups = new Map<string, PlatformModelsPlanSnapshot[]>();
  for (const plan of params.plans) {
    const taskProfileId = plan.taskProfileId ?? plan.planId;
    const bucket = taskGroups.get(taskProfileId) ?? [];
    bucket.push(plan);
    taskGroups.set(taskProfileId, bucket);
  }

  const usageByTask: PlatformModelsUsageTaskSnapshot[] = [...taskGroups.entries()].map(
    ([taskProfileId, relatedPlans]) => {
      const refs = [...new Set(relatedPlans.flatMap((plan) => modelRefsForPlan(plan)))];
      const summed = sumModelUsage(refs, modelStore);
      const topModelRefs = refs
        .map((ref) => ({ ref, calls: modelStore.get(ref)?.calls7d ?? 0 }))
        .toSorted((left, right) => right.calls - left.calls)
        .slice(0, 3)
        .map((entry) => entry.ref);
      return {
        taskProfileId,
        name: relatedPlans[0]?.name ?? taskProfileId,
        calls7d: summed.calls7d,
        cost7d: summed.cost7d,
        topModelRefs,
        failureRate:
          summed.successRate != null ? Number((100 - summed.successRate).toFixed(1)) : undefined,
      };
    },
  );

  const explanations = params.routingExplanations ?? [];
  const usageByPolicy: PlatformModelsUsagePolicySnapshot[] = params.routingPolicies.map(
    (policy) => {
      const refs = modelRefsForPolicy(policy);
      const summed = sumModelUsage(refs, modelStore);
      const billingQty = policyQuantities.get(policy.policyId) ?? 0;
      const calls7d = Math.max(summed.calls7d, billingQty);
      const perf = derivePolicyPerformance({ policy, explanations });
      return {
        policyId: policy.policyId,
        calls7d,
        quantity: calls7d,
        avgCostPerRequest:
          calls7d > 0 && summed.cost7d > 0
            ? Number((summed.cost7d / calls7d).toFixed(4))
            : perf.avgCostPerRequest,
        avgLatencyMs: summed.avgLatencyMs ?? perf.avgLatencyMs,
        primaryHitRate: perf.primaryHitRate,
        fallbackRate: perf.fallbackRate ?? summed.fallbackRate,
        manualOverrideRate: perf.manualOverrideRate,
      };
    },
  );

  return {
    usageByModel,
    usageByPolicy,
    usageByTask,
    usageByPlan,
  };
}
