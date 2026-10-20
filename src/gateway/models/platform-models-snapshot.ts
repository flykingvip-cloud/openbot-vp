import type { ModelCatalogEntry } from "../../agents/model-catalog.js";
import type { OpenBotConfig } from "../../config/types.js";
import { recordOrNull as asRecord, stringValue } from "../records.js";
import { loadModelProbeSummary } from "./model-probe-store.js";
import {
  buildPlatformModelsAorProjection,
  buildPolicyBindings,
} from "./platform-models-aor-projection.js";
import { resolvePlatformModelsConfig } from "./platform-models-config.js";
import type {
  PlatformModelsAorExecution,
  PlatformModelsAssetSnapshot,
  PlatformModelsGovernanceIssueSnapshot,
  PlatformModelsManagementSnapshot,
  PlatformModelsPlanSnapshot,
  PlatformModelsRoutingExplanationSnapshot,
  PlatformModelsRoutingPolicySnapshot,
  PlatformModelsSelectorStrategy,
  PlatformModelsTaskProfileSnapshot,
} from "./platform-models-types.js";
import { buildPlatformModelsUsageProjection } from "./platform-models-usage-projection.js";

function normalizeString(value: unknown): string | null {
  return stringValue(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean)
    : [];
}

function parseAorExecution(raw: unknown): PlatformModelsAorExecution | undefined {
  const entry = asRecord(raw);
  if (!entry) {
    return undefined;
  }
  const taskTypeId = normalizeString(entry.taskTypeId) ?? normalizeString(entry.aorTaskTypeId);
  if (!taskTypeId) {
    return undefined;
  }
  const strategyRaw = normalizeString(entry.selectorStrategy);
  const selectorStrategy: PlatformModelsSelectorStrategy =
    strategyRaw === "cheapest" ||
    strategyRaw === "best_quality" ||
    strategyRaw === "balanced" ||
    strategyRaw === "bandit"
      ? strategyRaw
      : "balanced";
  const evalRaw =
    normalizeString(entry.evaluatorMode) ?? normalizeString(entry.objectiveEvaluatorMode);
  const evaluatorMode = evalRaw === "workspace" || evalRaw === "content" ? evalRaw : "content";
  const skillId = normalizeString(entry.skillId) ?? normalizeString(entry.aorSkillId);
  return {
    taskTypeId,
    ...(skillId ? { skillId } : {}),
    selectorStrategy,
    evaluatorMode,
  };
}

function inferDefaultAorExecution(
  planId: string,
  taskProfileId: string | null,
): PlatformModelsAorExecution | undefined {
  const key = `${planId} ${taskProfileId ?? ""}`.toLowerCase();
  if (key.includes("coding") || key.includes("review") || key.includes("code")) {
    return {
      taskTypeId: "coding.review",
      selectorStrategy: "bandit",
      evaluatorMode: "workspace",
    };
  }
  if (key.includes("summar") || key.includes("summary")) {
    return {
      taskTypeId: "summarization",
      selectorStrategy: "balanced",
      evaluatorMode: "content",
    };
  }
  return undefined;
}

function parseTaskPlans(cfg: OpenBotConfig): PlatformModelsPlanSnapshot[] {
  const models = asRecord(cfg.models);
  const record = asRecord(models?.taskPlans);
  return Object.entries(record ?? {})
    .map(([planId, raw]): PlatformModelsPlanSnapshot | null => {
      const entry = asRecord(raw);
      if (!planId.trim() || !entry) {
        return null;
      }
      const taskProfileId = normalizeString(entry.taskProfileId);
      const explicit = parseAorExecution(entry.aorExecution ?? entry.aor);
      const aorExecution = explicit ?? inferDefaultAorExecution(planId, taskProfileId);
      const audience =
        entry.audience === "platform" || entry.audience === "tenant" || entry.audience === "user"
          ? entry.audience
          : null;
      const costTarget =
        entry.costTarget === "low" || entry.costTarget === "medium" || entry.costTarget === "high"
          ? entry.costTarget
          : null;
      const qualityTarget =
        entry.qualityTarget === "standard" ||
        entry.qualityTarget === "high" ||
        entry.qualityTarget === "premium"
          ? entry.qualityTarget
          : null;
      const latencyTarget =
        entry.latencyTarget === "realtime" ||
        entry.latencyTarget === "interactive" ||
        entry.latencyTarget === "batch"
          ? entry.latencyTarget
          : null;
      const status =
        entry.status === "draft" || entry.status === "published" || entry.status === "deprecated"
          ? entry.status
          : null;
      return {
        planId: planId.trim(),
        taskProfileId,
        name: normalizeString(entry.name),
        description: normalizeString(entry.description),
        audience,
        primaryModelIds: stringArray(entry.primaryModelIds),
        fallbackModelIds: stringArray(entry.fallbackModelIds),
        costTarget,
        qualityTarget,
        latencyTarget,
        status,
        userSelectable: entry.userSelectable === true,
        tenantOverrideAllowed: entry.tenantOverrideAllowed === true,
        updatedAt:
          typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)
            ? entry.updatedAt
            : null,
        ...(aorExecution ? { aorExecution } : {}),
      };
    })
    .filter((entry): entry is PlatformModelsPlanSnapshot => Boolean(entry));
}

function parsePolicyScope(raw: unknown): PlatformModelsRoutingPolicySnapshot["scope"] {
  const scope = asRecord(raw);
  return {
    tenantIds: stringArray(scope?.tenantIds),
    userSegments: stringArray(scope?.userSegments),
    agentIds: stringArray(scope?.agentIds),
  };
}

function parseRoutingPolicies(cfg: OpenBotConfig): PlatformModelsRoutingPolicySnapshot[] {
  const models = asRecord(cfg.models);
  const record = asRecord(models?.routingPolicies);
  return Object.entries(record ?? {})
    .map(([policyId, raw]): PlatformModelsRoutingPolicySnapshot | null => {
      const entry = asRecord(raw);
      if (!policyId.trim() || !entry) {
        return null;
      }
      const rankingModeRaw = normalizeString(entry.rankingMode);
      const rankingMode =
        rankingModeRaw === "quality" ||
        rankingModeRaw === "cost" ||
        rankingModeRaw === "speed" ||
        rankingModeRaw === "balanced" ||
        rankingModeRaw === "bandit"
          ? rankingModeRaw
          : null;
      const selectorRaw = normalizeString(entry.selectorStrategy);
      const selectorStrategy: PlatformModelsSelectorStrategy | undefined =
        selectorRaw === "cheapest" ||
        selectorRaw === "best_quality" ||
        selectorRaw === "balanced" ||
        selectorRaw === "bandit"
          ? selectorRaw
          : rankingMode === "bandit"
            ? "bandit"
            : undefined;
      const status =
        entry.status === "active" || entry.status === "draft" || entry.status === "disabled"
          ? entry.status
          : null;
      const requiredHealth =
        entry.requiredHealth === "healthy" || entry.requiredHealth === "not_unavailable"
          ? entry.requiredHealth
          : null;
      return {
        policyId: policyId.trim(),
        name: normalizeString(entry.name),
        taskProfileId: normalizeString(entry.taskProfileId),
        planId: normalizeString(entry.planId),
        primaryModelIds: stringArray(entry.primaryModelIds),
        fallbackModelIds: stringArray(entry.fallbackModelIds),
        status,
        rankingMode,
        maxCostPerRequest:
          typeof entry.maxCostPerRequest === "number" && Number.isFinite(entry.maxCostPerRequest)
            ? entry.maxCostPerRequest
            : null,
        maxLatencyMs:
          typeof entry.maxLatencyMs === "number" && Number.isFinite(entry.maxLatencyMs)
            ? entry.maxLatencyMs
            : null,
        requiredCapabilities: stringArray(entry.requiredCapabilities),
        requiredHealth,
        scope: parsePolicyScope(entry.scope),
        updatedAt:
          typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)
            ? entry.updatedAt
            : null,
        ...(selectorStrategy ? { selectorStrategy } : {}),
      };
    })
    .filter((entry): entry is PlatformModelsRoutingPolicySnapshot => Boolean(entry));
}

function inferTaskCategory(taskProfileId: string): string {
  const normalized = taskProfileId.toLowerCase();
  if (normalized.includes("long")) {
    return "long_context";
  }
  if (normalized.includes("code") || normalized.includes("coding")) {
    return "coding";
  }
  if (normalized.includes("image_generation")) {
    return "image_generation";
  }
  if (normalized.includes("image") || normalized.includes("vision")) {
    return "image_understanding";
  }
  if (normalized.includes("video")) {
    return "video_processing";
  }
  if (normalized.includes("voice") || normalized.includes("audio")) {
    return "realtime_voice";
  }
  if (normalized.includes("reason")) {
    return "high_quality_reasoning";
  }
  if (normalized.includes("cost") || normalized.includes("batch")) {
    return "low_cost_batch";
  }
  return "general_text";
}

function buildTaskProfilesFromPlans(
  plans: PlatformModelsPlanSnapshot[],
): PlatformModelsTaskProfileSnapshot[] {
  const seen = new Set<string>();
  const profiles: PlatformModelsTaskProfileSnapshot[] = [];
  for (const plan of plans) {
    const taskProfileId = plan.taskProfileId ?? plan.planId;
    if (seen.has(taskProfileId)) {
      continue;
    }
    seen.add(taskProfileId);
    profiles.push({
      taskProfileId,
      name: plan.name ?? taskProfileId,
      description: plan.description,
      category: inferTaskCategory(taskProfileId),
      priorityMode:
        plan.costTarget === "low"
          ? "cost"
          : plan.qualityTarget === "premium"
            ? "quality"
            : "balanced",
      status:
        plan.status === "deprecated" ? "deprecated" : plan.status === "draft" ? "draft" : "active",
    });
  }
  return profiles;
}

function buildAssets(
  cfg: OpenBotConfig,
  catalog: ModelCatalogEntry[],
): PlatformModelsAssetSnapshot[] {
  const allowlist = new Set(Object.keys(cfg.agents?.defaults?.models ?? {}));
  const catalogRefs = new Set(catalog.map((entry) => `${entry.provider}/${entry.id}`));
  const assets = new Map<string, PlatformModelsAssetSnapshot>();

  for (const entry of catalog) {
    const modelRef = `${entry.provider}/${entry.id}`;
    assets.set(modelRef, {
      modelRef,
      providerId: entry.provider,
      modelId: entry.id,
      name: entry.name ?? null,
      allowlisted: allowlist.has(modelRef),
      inCatalog: true,
    });
  }

  for (const modelRef of allowlist) {
    if (assets.has(modelRef)) {
      continue;
    }
    const [providerId, ...rest] = modelRef.split("/");
    const modelId = rest.join("/");
    if (!providerId || !modelId) {
      continue;
    }
    assets.set(modelRef, {
      modelRef,
      providerId,
      modelId,
      name: null,
      allowlisted: true,
      inCatalog: catalogRefs.has(modelRef),
    });
  }

  const providers = cfg.models?.providers;
  if (providers && typeof providers === "object") {
    for (const [providerId, providerRaw] of Object.entries(providers)) {
      const provider = asRecord(providerRaw);
      const models = Array.isArray(provider?.models) ? provider.models : [];
      for (const modelRaw of models) {
        const model = asRecord(modelRaw);
        const modelId =
          typeof model?.id === "string" && model.id.trim()
            ? model.id.trim()
            : typeof modelRaw === "string" && modelRaw.trim()
              ? modelRaw.trim()
              : null;
        if (!modelId) {
          continue;
        }
        const modelRef = `${providerId}/${modelId}`;
        if (assets.has(modelRef)) {
          continue;
        }
        const name =
          typeof model?.name === "string" && model.name.trim() ? model.name.trim() : null;
        assets.set(modelRef, {
          modelRef,
          providerId,
          modelId,
          name,
          allowlisted: allowlist.has(modelRef),
          inCatalog: catalogRefs.has(modelRef),
        });
      }
    }
  }

  return [...assets.values()].toSorted((a, b) => a.modelRef.localeCompare(b.modelRef));
}

function buildGovernanceIssues(params: {
  plans: PlatformModelsPlanSnapshot[];
  policies: PlatformModelsRoutingPolicySnapshot[];
  mode: "native" | "aor_enhanced";
}): PlatformModelsGovernanceIssueSnapshot[] {
  const issues: PlatformModelsGovernanceIssueSnapshot[] = [];
  if (params.mode === "aor_enhanced") {
    for (const plan of params.plans) {
      if (!plan.aorExecution) {
        issues.push({
          issueId: `aor-unmapped-plan:${plan.planId}`,
          type: "aor_execution_unmapped",
          severity: "warning",
          title: `任务方案未映射到 AOR 执行语义`,
          description: `方案 ${plan.planId} 缺少 aorExecution 绑定，增强模式下无法回填 routing / bandit 证据。`,
          relatedPlanIds: [plan.planId],
        });
      }
    }
    const bindings = buildPolicyBindings(params.plans);
    const unmapped = bindings.filter((b) => !b.mapped);
    if (unmapped.length > 0 && unmapped.length === bindings.length && bindings.length > 0) {
      issues.push({
        issueId: "aor-no-bindings",
        type: "aor_no_policy_bindings",
        severity: "critical",
        title: "无可用 AOR 策略绑定",
        description: "所有任务方案均未配置 aorExecution；请在 models.taskPlans 中补充映射。",
        relatedPlanIds: unmapped.map((b) => b.planId),
      });
    }
  }

  for (const policy of params.policies) {
    if (policy.primaryModelIds.length === 0) {
      issues.push({
        issueId: `missing-primary:${policy.policyId}`,
        type: "task_without_candidate",
        severity: "warning",
        title: `路由策略缺少主模型`,
        description: `策略 ${policy.policyId} 未配置 primaryModelIds。`,
        relatedPolicyIds: [policy.policyId],
      });
    }
  }

  return issues;
}

export async function loadPlatformModelsManagementSnapshot(params: {
  cfg: OpenBotConfig;
  catalog: ModelCatalogEntry[];
  enterpriseId?: string;
}): Promise<PlatformModelsManagementSnapshot> {
  const config = resolvePlatformModelsConfig(params.cfg);
  const taskPlans = parseTaskPlans(params.cfg);
  const routingPolicies = parseRoutingPolicies(params.cfg);
  const taskProfiles = buildTaskProfilesFromPlans(taskPlans);
  const assets = buildAssets(params.cfg, params.catalog);
  const governanceIssues = buildGovernanceIssues({
    plans: taskPlans,
    policies: routingPolicies,
    mode: config.mode,
  });

  const aor =
    config.mode === "aor_enhanced"
      ? await buildPlatformModelsAorProjection({
          config,
          plans: taskPlans,
          enterpriseId: params.enterpriseId,
        })
      : undefined;

  const usage = await buildPlatformModelsUsageProjection({
    cfg: params.cfg,
    enterpriseId: params.enterpriseId,
    plans: taskPlans,
    routingPolicies,
    routingExplanations: aor?.routingExplanations,
  });
  const lastModelProbe = await loadModelProbeSummary();

  return {
    mode: config.mode,
    generatedAt: new Date().toISOString(),
    assets,
    taskPlans,
    taskProfiles,
    routingPolicies,
    governanceIssues,
    usageByModel: usage.usageByModel,
    usageByPolicy: usage.usageByPolicy,
    usageByTask: usage.usageByTask,
    usageByPlan: usage.usageByPlan,
    ...(lastModelProbe ? { lastModelProbe } : {}),
    ...(aor ? { aor } : {}),
  };
}

export async function loadPlatformModelsRoutingExplanations(params: {
  cfg: OpenBotConfig;
  limit?: number;
  enterpriseId?: string;
}): Promise<PlatformModelsRoutingExplanationSnapshot[]> {
  const config = resolvePlatformModelsConfig(params.cfg);
  if (config.mode !== "aor_enhanced") {
    return [];
  }
  const plans = parseTaskPlans(params.cfg);
  const projection = await buildPlatformModelsAorProjection({
    config,
    plans,
    enterpriseId: params.enterpriseId,
    explanationLimit: params.limit ?? 50,
  });
  return projection?.routingExplanations ?? [];
}
