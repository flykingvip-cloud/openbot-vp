import {
  hasConfiguredSecretInput,
  resolveSecretInputRef,
} from "../../../../../../src/config/types.secrets.js";
import type { RuntimeKpiData } from "../../../capability/agent-runtime/index.ts";
import type {
  RuntimeAgent,
  RuntimeCapabilityBinding,
  RuntimeGovernanceIssue,
  RuntimeTelemetry,
} from "../../../capability/runtime-canonical/index.ts";
import { resolveTenantGrant } from "../../../observation/access-state.ts";
import type {
  PlatformAorReadModel,
  PlatformModelsManagementSnapshot,
  PlatformModelsMode,
} from "../models/snapshot-types.ts";
import type { PlatformPortState } from "../port-state.ts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

export type PlatformPortReadModel = {
  currentTenantId: string | null;
  currentTenantLabel: string | null;
  knownTenantIds: string[];
  tenantDirectory: Array<{
    tenantId: string;
    label: string;
  }>;
  enterpriseDirectory: Array<{
    tenantId: string;
    label: string;
    tenantGrant?: "granted" | "none" | "unknown";
    status: "trial" | "paid" | "suspended" | "expired";
    plan: string;
    billingStatus: string;
    createdSource: "self-service" | "platform-created";
    creationMode?: "quick-trial" | "formal" | "advanced";
    lifecycleStage?:
      | "trial_onboarding"
      | "active_onboarding"
      | "governance_review"
      | "active"
      | "risk";
    approvalStatus?: "not_required" | "pending" | "approved" | "rejected";
    defaultPolicyName?: string;
    trialDaysSnapshot?: number;
    seatQuota: number;
    seatUsed: number;
    seatsRemaining: number;
    trialEndsAt?: string;
    upgradeUrl?: string;
    contactAdvisorUrl?: string;
    allowReadOnlyAfterExpiry?: boolean;
    expiryHandling?: "auto_stop" | "read_only" | "grace_period";
    graceEndsAt?: string;
    contact?: {
      contactName?: string;
      contactEmail?: string;
      contactPhone?: string;
      companySize?: string;
      industry?: string;
      source?: "trial-application" | "admin-provision" | "platform-created" | "manual";
      status?: "pending_activation" | "activated";
      updatedAt?: string;
    };
    usageSummary?: {
      calls7d?: number;
      cost7d?: number;
      topModelLabel?: string;
      topAgentLabel?: string;
      activeAgentCount?: number;
      activeChannelCount?: number;
      activeRuntimeCount?: number;
      dailyCalls?: number[];
      dailyCost?: number[];
      updatedAt?: number;
    };
    adoptionSummary?: {
      label?: string;
      tone?: "ok" | "warn" | "danger" | "neutral";
      aiActiveUsers?: number;
      automationTaskCount?: number;
      note?: string;
      updatedAt?: number;
    };
    contributionSummary?: {
      submittedAssetPackages?: number;
      approvedAssets?: number;
      incubationCandidates?: number;
      platformCandidates?: number;
      crossTenantReuseCount?: number;
      publishedSharedAssets?: number;
      updatedAt?: number;
    };
    healthSummary?: {
      label?: string;
      tone?: "ok" | "warn" | "danger" | "neutral";
      incidentLabel?: string;
      errorRate?: number;
      successRate?: number;
      fallbackRate?: number;
      avgLatencyMs?: number;
      updatedAt?: number;
    };
  }>;
  agentDirectory: Array<{
    agentId: string;
    label: string;
    isDefault: boolean;
  }>;
  modelDirectory: Array<{
    providerId: string;
    modelId: string;
    name: string | null;
    api: string | null;
    providerApi: string | null;
    baseUrl: string | null;
    auth: string | null;
    reasoning: boolean | null;
    input: string[];
    contextWindow: number | null;
    maxTokens: number | null;
    costTier: "low" | "medium" | "high" | "unknown";
    supportsTools: boolean | null;
  }>;
  gatewayCatalogModels: Array<{
    providerId: string;
    modelId: string;
    name: string;
    contextWindow: number | null;
  }>;
  taskPlanDirectory: Array<{
    planId: string;
    taskProfileId: string | null;
    name: string | null;
    description: string | null;
    audience: "platform" | "tenant" | "user" | null;
    primaryModelIds: string[];
    fallbackModelIds: string[];
    costTarget: "low" | "medium" | "high" | null;
    qualityTarget: "standard" | "high" | "premium" | null;
    latencyTarget: "realtime" | "interactive" | "batch" | null;
    userSelectable: boolean | null;
    tenantOverrideAllowed: boolean | null;
    status: "draft" | "published" | "deprecated" | null;
    updatedAt: number | null;
  }>;
  routingPolicyDirectory: Array<{
    policyId: string;
    name: string | null;
    sourcePolicyId: string | null;
    taskProfileId: string | null;
    planId: string | null;
    primaryModelIds: string[];
    fallbackModelIds: string[];
    status: "active" | "draft" | "disabled" | null;
    rankingMode: "quality" | "cost" | "speed" | "balanced" | null;
    maxCostPerRequest: number | null;
    maxLatencyMs: number | null;
    requiredCapabilities: string[];
    requiredHealth: "healthy" | "not_unavailable" | null;
    updatedAt: number | null;
  }>;
  gatewayCatalogCount: number;
  modelProbeDirectory?: Array<{
    providerId: string;
    modelId: string | null;
    status:
      | "ok"
      | "auth"
      | "rate_limit"
      | "billing"
      | "timeout"
      | "format"
      | "unknown"
      | "no_model";
    source: "profile" | "env" | "models.json";
    label: string;
    mode?: string;
    profileId?: string;
    latencyMs: number | null;
    error: string | null;
    checkedAt: number | null;
  }>;
  defaultModelPrimary: string | null;
  defaultModelFallbacks: string[];
  defaultImageModelPrimary: string | null;
  allowlistedModelRefs: string[];
  allowlistEntries: Array<{
    modelRef: string;
    alias: string | null;
  }>;
  aliasCount: number;
  providerHealthDirectory: Array<{
    providerId: string;
    authMode: string;
    authStatus: "ok" | "warn" | "external";
    authLabel: string;
    modelCount: number;
    catalogCount: number;
    issue: string;
  }>;
  agentCount: number;
  featureMethodCount: number;
  channelCount: number;
  channelIds: string[];
  accountCount: number;
  connectedAccountCount: number;
  nodeCount: number;
  /** Platform-policy config issues surfaced in system settings; optional until wired by the builder. */
  configIssueCount?: number;
  /** Pending platform offers surfaced in system settings; optional until wired by the builder. */
  pendingOfferCount?: number;
  presenceCount: number;
  runtimeHosts: string[];
  sessionsCount: number;
  totalTokens: number;
  totalCost: number;
  missingCostEntries: number;
  currentUsageOverview: {
    sessionCount: number;
    totalTokens: number;
    totalCost: number;
    totalMessages: number;
    errorCount: number;
    errorRate: number;
    avgLatencyMs: number | null;
    peakErrorDayLabel: string | null;
    topModelLabel: string | null;
    topAgentId: string | null;
    activeAgentCount: number;
    activeChannelCount: number;
    dailyCalls: number[];
    dailyCost: number[];
    updatedAt: number | null;
  };
  modelMode: string | null;
  configuredProviderCount: number;
  providerIds: string[];
  configuredModelCount: number;
  configuredModelIds: string[];
  installedCapabilityCount: number;
  attentionItems: string[];
  currentVersion: string | null;
  latestVersion: string | null;
  hasUpdateAvailable: boolean;
  cronEnabled: boolean | null;
  cronNextAt: number | null;
  operatorUser: string | null;
  operatorRole: string | null;
  latestInvite: {
    code: string;
    expiresAt: string;
    tenantId?: string;
    tenantName?: string;
  } | null;
  /**
   * Agent Runtime Center 数据快照（可选，由专门的运维侧请求填充；
   * 默认 buildPlatformPortReadModel 不主动加载，避免阻塞平台总览渲染）。
   *
   * 这些字段是 Platform Runtime Layer 的 Canonical 数据；下游层（员工端 /
   * 企业端）只能通过 `runtime-canonical/projection.ts` 中的纯函数消费。
   */
  runtimeAgents?: RuntimeAgent[];
  runtimeBindings?: RuntimeCapabilityBinding[];
  runtimeTelemetry?: RuntimeTelemetry[];
  runtimeGovernanceIssues?: RuntimeGovernanceIssue[];
  runtimeKpi?: RuntimeKpiData;
  /**
   * 运行时概览的加载状态。`buildPlatformPortReadModel` 透传 `state.runtimeOverviewLoading`
   * 和 `state.runtimeOverviewError`，供平台端 surface 层在工具条 / 错误条上呈现加载中或失败提示。
   */
  runtimeOverviewLoading?: boolean;
  runtimeOverviewError?: string | null;
  /**
   * False until the first sessions, usage, or channels payload arrives.
   * Surfaces must not paint zeros or empty-state warnings while this is false.
   */
  shellSnapshotReady?: boolean;
  /** Platform model management integration mode (`native` | `aor_enhanced`). */
  platformModelsMode?: PlatformModelsMode;
  modelsManagementLoading?: boolean;
  modelsManagementError?: string | null;
  modelsManagementSnapshotAt?: string | null;
  /** Canonical server-side models management snapshot (when loaded). */
  modelsManagementSnapshot?: PlatformModelsManagementSnapshot | null;
  /** AOR enhanced projection for model management UI (optional). */
  aor?: PlatformAorReadModel;
};

function normalizePositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean)
    : [];
}

function resolveModelPrimary(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  const record = asRecord(value);
  return normalizeString(record?.primary);
}

function resolveModelFallbacks(value: unknown): string[] {
  const record = asRecord(value);
  const raw = Array.isArray(record?.fallbacks) ? record?.fallbacks : [];
  return raw.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
}

function parseTaskPlanDirectory(value: unknown): PlatformPortReadModel["taskPlanDirectory"] {
  const record = asRecord(value);
  return Object.entries(record ?? {})
    .map(([planId, raw]): PlatformPortReadModel["taskPlanDirectory"][number] | null => {
      const entry = asRecord(raw);
      if (!planId.trim() || !entry) {
        return null;
      }
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
        taskProfileId: normalizeString(entry.taskProfileId),
        name: normalizeString(entry.name),
        description: normalizeString(entry.description),
        audience,
        primaryModelIds: stringArray(entry.primaryModelIds),
        fallbackModelIds: stringArray(entry.fallbackModelIds),
        costTarget,
        qualityTarget,
        latencyTarget,
        userSelectable: typeof entry.userSelectable === "boolean" ? entry.userSelectable : null,
        tenantOverrideAllowed:
          typeof entry.tenantOverrideAllowed === "boolean" ? entry.tenantOverrideAllowed : null,
        status,
        updatedAt:
          typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)
            ? entry.updatedAt
            : null,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function parseRoutingPolicyDirectory(
  value: unknown,
): PlatformPortReadModel["routingPolicyDirectory"] {
  const record = asRecord(value);
  return Object.entries(record ?? {})
    .map(([policyId, raw]): PlatformPortReadModel["routingPolicyDirectory"][number] | null => {
      const entry = asRecord(raw);
      if (!policyId.trim() || !entry) {
        return null;
      }
      const status =
        entry.status === "active" || entry.status === "draft" || entry.status === "disabled"
          ? entry.status
          : null;
      const rankingMode =
        entry.rankingMode === "quality" ||
        entry.rankingMode === "cost" ||
        entry.rankingMode === "speed" ||
        entry.rankingMode === "balanced"
          ? entry.rankingMode
          : null;
      const requiredHealth =
        entry.requiredHealth === "healthy" || entry.requiredHealth === "not_unavailable"
          ? entry.requiredHealth
          : null;
      return {
        policyId: policyId.trim(),
        name: normalizeString(entry.name),
        sourcePolicyId: normalizeString(entry.sourcePolicyId),
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
        updatedAt:
          typeof entry.updatedAt === "number" && Number.isFinite(entry.updatedAt)
            ? entry.updatedAt
            : null,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function mergeModelProbeSummaries(persisted: unknown, session: unknown): unknown {
  const persistedRecord = asRecord(persisted);
  const sessionRecord = asRecord(session);
  if (!persistedRecord && !sessionRecord) {
    return null;
  }
  const byKey = new Map<string, unknown>();
  const ingest = (results: unknown, overwrite: boolean) => {
    if (!Array.isArray(results)) {
      return;
    }
    for (const entry of results) {
      const item = asRecord(entry);
      const provider = normalizeString(item?.provider) ?? "";
      const model = normalizeString(item?.model) ?? "";
      const key = model.includes("/") ? model : provider && model ? `${provider}/${model}` : model;
      if (!key) {
        continue;
      }
      if (!overwrite && byKey.has(key)) {
        continue;
      }
      byKey.set(key, entry);
    }
  };
  ingest(persistedRecord?.results, false);
  ingest(sessionRecord?.results, true);
  return {
    finishedAt: sessionRecord?.finishedAt ?? persistedRecord?.finishedAt ?? null,
    results: [...byKey.values()],
  };
}

function parseModelProbeDirectory(value: unknown): PlatformPortReadModel["modelProbeDirectory"] {
  const record = asRecord(value);
  const checkedAt =
    typeof record?.finishedAt === "number" && Number.isFinite(record.finishedAt)
      ? record.finishedAt
      : null;
  const results = Array.isArray(record?.results) ? record.results : [];
  return results
    .map((entry) => {
      const item = asRecord(entry);
      const providerId = normalizeString(item?.provider);
      const label = normalizeString(item?.label);
      const source:
        | NonNullable<PlatformPortReadModel["modelProbeDirectory"]>[number]["source"]
        | null =
        item?.source === "profile" || item?.source === "env" || item?.source === "models.json"
          ? item.source
          : null;
      const status:
        | NonNullable<PlatformPortReadModel["modelProbeDirectory"]>[number]["status"]
        | null =
        item?.status === "ok" ||
        item?.status === "auth" ||
        item?.status === "rate_limit" ||
        item?.status === "billing" ||
        item?.status === "timeout" ||
        item?.status === "format" ||
        item?.status === "unknown" ||
        item?.status === "no_model"
          ? item.status
          : null;
      if (!providerId || !label || !source || !status) {
        return null;
      }
      const modelRef = normalizeString(item?.model);
      const parsedModel =
        modelRef && modelRef.includes("/")
          ? (() => {
              const [provider, ...rest] = modelRef.split("/");
              return provider.trim() === providerId && rest.length > 0
                ? rest.join("/").trim()
                : null;
            })()
          : modelRef;
      return {
        providerId,
        modelId: parsedModel || null,
        status,
        source,
        label,
        mode: normalizeString(item?.mode) ?? undefined,
        profileId: normalizeString(item?.profileId) ?? undefined,
        latencyMs: normalizePositiveNumber(item?.latencyMs),
        error: normalizeString(item?.error),
        checkedAt,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function toCostTier(
  modelConfig: Record<string, unknown> | null,
): "low" | "medium" | "high" | "unknown" {
  const cost = asRecord(modelConfig?.cost);
  if (!cost) {
    return "unknown";
  }
  const input = typeof cost.input === "number" ? cost.input : 0;
  const output = typeof cost.output === "number" ? cost.output : 0;
  const score = Math.max(input, output);
  if (score <= 0) {
    return "unknown";
  }
  if (score < 0.002) {
    return "low";
  }
  if (score < 0.01) {
    return "medium";
  }
  return "high";
}

function parseCurrentUsageOverview(
  state: PlatformPortState,
): PlatformPortReadModel["currentUsageOverview"] {
  const usageResult = state.usageResult;
  const byModel = Array.isArray(usageResult?.aggregates?.byModel)
    ? usageResult.aggregates.byModel
    : [];
  const byAgent = Array.isArray(usageResult?.aggregates?.byAgent)
    ? usageResult.aggregates.byAgent
    : [];
  const byChannel = Array.isArray(usageResult?.aggregates?.byChannel)
    ? usageResult.aggregates.byChannel
    : [];
  const topModel = byModel
    .map((entry) => ({
      provider: normalizeString((entry as Record<string, unknown>)?.provider),
      model: normalizeString((entry as Record<string, unknown>)?.model),
      count:
        typeof (entry as Record<string, unknown>)?.count === "number" &&
        Number.isFinite((entry as Record<string, unknown>).count)
          ? ((entry as Record<string, unknown>).count as number)
          : 0,
      totalCost:
        typeof ((entry as Record<string, unknown>)?.totals as Record<string, unknown> | undefined)
          ?.totalCost === "number" &&
        Number.isFinite(
          ((entry as Record<string, unknown>)?.totals as Record<string, unknown> | undefined)
            ?.totalCost,
        )
          ? (((entry as Record<string, unknown>)?.totals as Record<string, unknown> | undefined)
              ?.totalCost as number)
          : 0,
    }))
    .toSorted((left, right) => right.totalCost - left.totalCost || right.count - left.count)[0];
  const topAgent = byAgent
    .map((entry) => {
      const record = entry as Record<string, unknown>;
      const totals = asRecord(record.totals);
      return {
        agentId: normalizeString(record.agentId),
        totalTokens:
          typeof totals?.totalTokens === "number" && Number.isFinite(totals.totalTokens)
            ? totals.totalTokens
            : 0,
        totalCost:
          typeof totals?.totalCost === "number" && Number.isFinite(totals.totalCost)
            ? totals.totalCost
            : 0,
      };
    })
    .filter((entry): entry is { agentId: string; totalTokens: number; totalCost: number } =>
      Boolean(entry.agentId),
    )
    .toSorted(
      (left, right) => right.totalCost - left.totalCost || right.totalTokens - left.totalTokens,
    )[0];
  const daily = Array.isArray(usageResult?.aggregates?.daily) ? usageResult.aggregates.daily : [];
  const sessions = Array.isArray(usageResult?.sessions) ? usageResult.sessions : [];
  const totalMessages =
    usageResult?.aggregates?.messages && typeof usageResult.aggregates.messages.total === "number"
      ? usageResult.aggregates.messages.total
      : 0;
  const errorCount = sessions.reduce((sum, entry) => {
    const usage = asRecord(asRecord(entry)?.usage);
    const messageCounts = asRecord(usage?.messageCounts);
    const errors =
      typeof messageCounts?.errors === "number" && Number.isFinite(messageCounts.errors)
        ? messageCounts.errors
        : 0;
    return sum + errors;
  }, 0);
  const avgLatencyMs =
    usageResult?.aggregates?.latency && typeof usageResult.aggregates.latency.avgMs === "number"
      ? usageResult.aggregates.latency.avgMs
      : null;
  const peakErrorDay = [...daily]
    .filter((entry) => entry.messages > 0 && entry.errors > 0)
    .toSorted((left, right) => {
      const leftRate = left.messages > 0 ? left.errors / left.messages : 0;
      const rightRate = right.messages > 0 ? right.errors / right.messages : 0;
      return rightRate - leftRate || right.errors - left.errors;
    })[0];
  return {
    sessionCount: sessions.length,
    totalTokens: usageResult?.totals?.totalTokens ?? 0,
    totalCost: usageResult?.totals?.totalCost ?? 0,
    totalMessages,
    errorCount,
    errorRate: totalMessages > 0 ? errorCount / totalMessages : 0,
    avgLatencyMs,
    peakErrorDayLabel: peakErrorDay ? `${peakErrorDay.date} · ${peakErrorDay.errors} 错误` : null,
    topModelLabel:
      topModel?.provider && topModel?.model
        ? `${topModel.provider}/${topModel.model}`
        : (topModel?.model ?? null),
    topAgentId: topAgent?.agentId ?? null,
    activeAgentCount: byAgent.filter((entry) => {
      const totals = asRecord((entry as Record<string, unknown>)?.totals);
      return (
        (typeof totals?.totalTokens === "number" && totals.totalTokens > 0) ||
        (typeof totals?.totalCost === "number" && totals.totalCost > 0)
      );
    }).length,
    activeChannelCount: byChannel.filter((entry) => {
      const totals = asRecord((entry as Record<string, unknown>)?.totals);
      return (
        (typeof totals?.totalTokens === "number" && totals.totalTokens > 0) ||
        (typeof totals?.totalCost === "number" && totals.totalCost > 0)
      );
    }).length,
    dailyCalls: daily.map((entry) =>
      entry.messages > 0 ? entry.messages : Math.max(1, Math.round(entry.tokens / 120)),
    ),
    dailyCost: daily.map((entry) => entry.cost),
    updatedAt:
      typeof usageResult?.updatedAt === "number" && Number.isFinite(usageResult.updatedAt)
        ? usageResult.updatedAt
        : null,
  };
}

export function buildPlatformPortReadModel(
  state: PlatformPortState,
  configValue: Record<string, unknown> | null,
): PlatformPortReadModel {
  const currentTenantId =
    state.hello?.auth?.tenantId?.trim() ??
    state.platformAuthState?.session?.tenantId?.trim() ??
    state.bootstrapAuthSession?.tenantId?.trim() ??
    null;
  // Strip the 8-char hex suffix (e.g. "upbeyond-91aeea3c" -> "upbeyond")
  // when no explicit tenantName is provided, so the UI shows the friendly slug.
  const stripIdSuffix = (id: string | null) => (id ? id.replace(/-[0-9a-f]{8}$/i, "") : id);
  const currentTenantLabel =
    state.platformAuthState?.tenantName?.trim() || stripIdSuffix(currentTenantId);
  const knownTenantIds = unique([
    currentTenantId,
    ...(state.settings.recentEnterpriseTenantIds ?? []),
    state.platformAuthState?.latestInvite?.tenantId,
  ]);
  const accountEntries = Object.values(state.channelsSnapshot?.channelAccounts ?? {}).flat();
  const modelsConfig = asRecord(configValue?.models);
  const providers = asRecord(modelsConfig?.providers);
  const providerIds = Object.keys(providers ?? {}).toSorted();
  const configuredModelIds: string[] = [];
  const modelDirectory: PlatformPortReadModel["modelDirectory"] = [];
  let configuredModelCount = 0;
  for (const [providerId, provider] of Object.entries(providers ?? {})) {
    const providerConfig = asRecord(provider);
    const providerApi = typeof providerConfig?.api === "string" ? providerConfig.api : null;
    const providerBaseUrl =
      typeof providerConfig?.baseUrl === "string" && providerConfig.baseUrl.trim()
        ? providerConfig.baseUrl.trim()
        : null;
    const providerAuth = typeof providerConfig?.auth === "string" ? providerConfig.auth : null;
    const providerModels = Array.isArray(providerConfig?.models) ? providerConfig.models : [];
    configuredModelCount += providerModels.length;
    for (const model of providerModels) {
      if (typeof model === "string" && model.trim()) {
        const modelId = model.trim();
        configuredModelIds.push(modelId);
        modelDirectory.push({
          providerId,
          modelId,
          name: null,
          api: providerApi,
          providerApi,
          baseUrl: providerBaseUrl,
          auth: providerAuth,
          reasoning: null,
          input: [],
          contextWindow: null,
          maxTokens: null,
          costTier: "unknown",
          supportsTools: null,
        });
        continue;
      }
      const modelConfig = asRecord(model);
      if (!modelConfig) {
        continue;
      }
      const modelId =
        typeof modelConfig?.id === "string" && modelConfig.id.trim() ? modelConfig.id.trim() : null;
      if (!modelId) {
        continue;
      }
      configuredModelIds.push(modelId);
      const compat = asRecord(modelConfig.compat);
      modelDirectory.push({
        providerId,
        modelId,
        name:
          typeof modelConfig.name === "string" && modelConfig.name.trim()
            ? modelConfig.name.trim()
            : null,
        api: (typeof modelConfig.api === "string" && modelConfig.api) || providerApi || null,
        providerApi,
        baseUrl: providerBaseUrl,
        auth: providerAuth,
        reasoning: typeof modelConfig.reasoning === "boolean" ? modelConfig.reasoning : null,
        input: Array.isArray(modelConfig.input)
          ? modelConfig.input.filter((item): item is string => typeof item === "string")
          : [],
        contextWindow: normalizePositiveNumber(modelConfig.contextWindow),
        maxTokens: normalizePositiveNumber(modelConfig.maxTokens),
        costTier: toCostTier(modelConfig),
        supportsTools: typeof compat?.supportsTools === "boolean" ? compat.supportsTools : null,
      });
    }
  }
  const channelIds =
    state.channelsSnapshot?.channelMeta?.map((entry) => entry.id) ??
    state.channelsSnapshot?.channelOrder ??
    [];
  const defaults = asRecord(asRecord(configValue?.agents)?.defaults);
  const allowlistedModelsRecord = asRecord(defaults?.models);
  const allowlistedModelRefs = Object.keys(allowlistedModelsRecord ?? {}).toSorted();
  const allowlistEntries = allowlistedModelRefs.map((modelRef) => {
    const entry = asRecord(allowlistedModelsRecord?.[modelRef]);
    return {
      modelRef,
      alias: typeof entry?.alias === "string" && entry.alias.trim() ? entry.alias.trim() : null,
    };
  });
  const aliasCount = Object.values(allowlistedModelsRecord ?? {}).reduce<number>((count, entry) => {
    const record = asRecord(entry);
    const alias = record?.alias;
    if (typeof alias === "string" && alias.trim()) {
      return count + 1;
    }
    if (Array.isArray(alias)) {
      return count + alias.filter((item) => typeof item === "string" && item.trim()).length;
    }
    return count;
  }, 0);
  const gatewayCatalogModels = Array.isArray(state.debugModels)
    ? state.debugModels
        .map((entry) => {
          const record = asRecord(entry);
          const providerId = normalizeString(record?.provider);
          const modelId = normalizeString(record?.id);
          if (!providerId || !modelId) {
            return null;
          }
          return {
            providerId,
            modelId,
            name: normalizeString(record?.name) ?? modelId,
            contextWindow: normalizePositiveNumber(record?.contextWindow),
          };
        })
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    : [];
  const taskPlanDirectory = parseTaskPlanDirectory(modelsConfig?.taskPlans);
  const routingPolicyDirectory = parseRoutingPolicyDirectory(modelsConfig?.routingPolicies);
  const modelProbeDirectory = parseModelProbeDirectory(
    mergeModelProbeSummaries(
      state.modelsManagementSnapshot?.lastModelProbe,
      state.debugModelProbeSummary,
    ),
  );
  const providerHealthDirectory = providerIds.map((providerId) => {
    const providerConfig = asRecord(providers?.[providerId]);
    const authMode =
      typeof providerConfig?.auth === "string" && providerConfig.auth.trim()
        ? providerConfig.auth.trim()
        : "api-key";
    const hasApiKey = hasConfiguredSecretInput(providerConfig?.apiKey);
    const secretRef = resolveSecretInputRef({ value: providerConfig?.apiKey }).ref;
    const modelCount = modelDirectory.filter((entry) => entry.providerId === providerId).length;
    const catalogCount = gatewayCatalogModels.filter(
      (entry) => entry.providerId === providerId,
    ).length;
    const authStatus = (() => {
      if (authMode === "oauth" || authMode === "aws-sdk") {
        return hasApiKey ? ("ok" as const) : ("external" as const);
      }
      return hasApiKey ? ("ok" as const) : ("warn" as const);
    })();
    const authLabel = (() => {
      if (hasApiKey && secretRef) {
        return `${secretRef.source}:${secretRef.id}`;
      }
      if (hasApiKey) {
        return "已配置";
      }
      if (authMode === "oauth") {
        return "依赖 OAuth / profile";
      }
      if (authMode === "aws-sdk") {
        return "依赖 AWS SDK 链";
      }
      return "未配置";
    })();
    const issue = (() => {
      if (modelCount === 0) {
        return "Provider 已声明但未配置任何模型";
      }
      if (authStatus === "warn") {
        return authMode === "token" ? "缺少 token 配置" : "缺少 API key 配置";
      }
      if (gatewayCatalogModels.length > 0 && catalogCount === 0) {
        return "网关目录未返回该 provider 模型";
      }
      if (authStatus === "external") {
        return authMode === "oauth" ? "凭证托管在 OAuth / profile 外部链路" : "凭证走外部运行时链";
      }
      return "配置与目录状态正常";
    })();
    return {
      providerId,
      authMode,
      authStatus,
      authLabel,
      modelCount,
      catalogCount,
      issue,
    };
  });
  const runtimeHosts = unique(state.presenceEntries.map((entry) => entry.host));
  const currentVersion =
    (typeof state.hello?.server?.version === "string" && state.hello.server.version.trim()) ||
    state.updateAvailable?.currentVersion ||
    null;
  const latestVersion = state.updateAvailable?.latestVersion ?? null;
  const operatorSession =
    state.hello?.auth?.provider === "trusted-proxy"
      ? state.hello.auth
      : (state.platformAuthState?.session ?? state.bootstrapAuthSession ?? null);
  const installedCapabilityCount = providerIds.length + channelIds.length;
  const attentionItems = [
    latestVersion && currentVersion && latestVersion !== currentVersion
      ? `Runtime update available: ${currentVersion} -> ${latestVersion}`
      : null,
    state.usageResult?.totals?.missingCostEntries
      ? `${state.usageResult.totals.missingCostEntries} usage entries need cost attribution`
      : null,
    providerIds.length === 0 ? "No model providers configured" : null,
    channelIds.length === 0 ? "No channels configured for cross-tenant distribution" : null,
    accountEntries.length > 0 &&
    accountEntries.every((account) => !account.connected && !account.running && !account.linked)
      ? "Accounts exist but none are connected"
      : null,
  ].filter((entry): entry is string => Boolean(entry));
  const enterpriseDirectory =
    state.platformAuthState?.platformEnterprises?.map((enterprise) => ({
      tenantId: enterprise.id,
      label: enterprise.name,
      tenantGrant: resolveTenantGrant(enterprise.tenantGrant),
      status: enterprise.status,
      plan: enterprise.plan,
      billingStatus: enterprise.billingStatus,
      createdSource: enterprise.createdSource,
      ...(enterprise.creationMode ? { creationMode: enterprise.creationMode } : {}),
      ...(enterprise.lifecycleStage ? { lifecycleStage: enterprise.lifecycleStage } : {}),
      ...(enterprise.approvalStatus ? { approvalStatus: enterprise.approvalStatus } : {}),
      ...(enterprise.defaultPolicyName ? { defaultPolicyName: enterprise.defaultPolicyName } : {}),
      ...(typeof enterprise.trialDaysSnapshot === "number"
        ? { trialDaysSnapshot: enterprise.trialDaysSnapshot }
        : {}),
      seatQuota: enterprise.seatQuota,
      seatUsed: enterprise.seatUsed,
      seatsRemaining: enterprise.seatsRemaining,
      ...(enterprise.trialEndsAt ? { trialEndsAt: enterprise.trialEndsAt } : {}),
      ...(enterprise.upgradeUrl ? { upgradeUrl: enterprise.upgradeUrl } : {}),
      ...(enterprise.contactAdvisorUrl ? { contactAdvisorUrl: enterprise.contactAdvisorUrl } : {}),
      ...(typeof enterprise.allowReadOnlyAfterExpiry === "boolean"
        ? { allowReadOnlyAfterExpiry: enterprise.allowReadOnlyAfterExpiry }
        : {}),
      ...(enterprise.expiryHandling ? { expiryHandling: enterprise.expiryHandling } : {}),
      ...(enterprise.graceEndsAt ? { graceEndsAt: enterprise.graceEndsAt } : {}),
      ...(enterprise.contact ? { contact: enterprise.contact } : {}),
      ...(enterprise.usageSummary ? { usageSummary: enterprise.usageSummary } : {}),
      ...(enterprise.adoptionSummary ? { adoptionSummary: enterprise.adoptionSummary } : {}),
      ...(enterprise.contributionSummary
        ? { contributionSummary: enterprise.contributionSummary }
        : {}),
      ...(enterprise.healthSummary ? { healthSummary: enterprise.healthSummary } : {}),
    })) ?? [];

  return {
    currentTenantId,
    currentTenantLabel,
    knownTenantIds,
    tenantDirectory: knownTenantIds.map((tenantId) => ({
      tenantId,
      label:
        tenantId === currentTenantId && currentTenantLabel
          ? currentTenantLabel
          : (stripIdSuffix(tenantId) ?? tenantId),
    })),
    enterpriseDirectory,
    agentDirectory:
      state.agentsList?.agents?.map((agent) => ({
        agentId: agent.id,
        label:
          (typeof agent.name === "string" && agent.name.trim()) ||
          (typeof agent.identity?.name === "string" && agent.identity.name.trim()) ||
          agent.id,
        isDefault: agent.id === state.agentsList?.defaultId,
      })) ?? [],
    modelDirectory,
    gatewayCatalogModels,
    taskPlanDirectory,
    routingPolicyDirectory,
    gatewayCatalogCount: gatewayCatalogModels.length,
    modelProbeDirectory,
    defaultModelPrimary: resolveModelPrimary(defaults?.model),
    defaultModelFallbacks: resolveModelFallbacks(defaults?.model),
    defaultImageModelPrimary: resolveModelPrimary(defaults?.imageModel),
    allowlistedModelRefs,
    allowlistEntries,
    aliasCount,
    providerHealthDirectory,
    agentCount: state.agentsList?.agents?.length ?? 0,
    featureMethodCount: state.hello?.features?.methods?.length ?? 0,
    channelCount:
      state.channelsSnapshot?.channelMeta?.length ??
      state.channelsSnapshot?.channelOrder?.length ??
      0,
    channelIds,
    accountCount: accountEntries.length,
    connectedAccountCount: accountEntries.filter(
      (account) => account.connected || account.running || account.linked,
    ).length,
    nodeCount: runtimeHosts.length,
    presenceCount: state.presenceEntries.length,
    runtimeHosts,
    sessionsCount: state.sessionsResult?.count ?? 0,
    totalTokens: state.usageResult?.totals?.totalTokens ?? 0,
    totalCost: state.usageResult?.totals?.totalCost ?? 0,
    missingCostEntries: state.usageResult?.totals?.missingCostEntries ?? 0,
    currentUsageOverview: parseCurrentUsageOverview(state),
    modelMode: typeof modelsConfig?.mode === "string" ? modelsConfig.mode : null,
    configuredProviderCount: providerIds.length,
    providerIds,
    configuredModelCount,
    configuredModelIds: unique(configuredModelIds),
    installedCapabilityCount,
    attentionItems,
    currentVersion,
    latestVersion,
    hasUpdateAvailable: Boolean(
      latestVersion && currentVersion && latestVersion !== currentVersion,
    ),
    cronEnabled: state.cronStatus?.enabled ?? null,
    cronNextAt: state.cronStatus?.nextWakeAtMs ?? null,
    operatorUser: operatorSession?.displayName?.trim() || operatorSession?.user?.trim() || null,
    operatorRole: operatorSession?.role?.trim() || null,
    latestInvite: state.platformAuthState?.latestInvite ?? null,
    runtimeAgents: state.runtimeAgents,
    runtimeBindings: state.runtimeBindings,
    runtimeTelemetry: state.runtimeTelemetry,
    runtimeGovernanceIssues: state.runtimeGovernanceIssues,
    runtimeKpi: state.runtimeKpi ?? undefined,
    runtimeOverviewLoading: state.runtimeOverviewLoading,
    runtimeOverviewError: state.runtimeOverviewError,
    shellSnapshotReady:
      state.sessionsResult != null || state.usageResult != null || state.channelsSnapshot != null,
    platformModelsMode:
      state.modelsManagementSnapshot?.mode ?? state.platformModelsMode ?? "native",
    modelsManagementLoading: state.modelsManagementLoading,
    modelsManagementError: state.modelsManagementError,
    modelsManagementSnapshotAt: state.modelsManagementSnapshot?.generatedAt ?? null,
    modelsManagementSnapshot: state.modelsManagementSnapshot ?? null,
    aor: state.modelsManagementSnapshot?.aor,
  };
}
