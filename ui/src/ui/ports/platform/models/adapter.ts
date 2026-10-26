import type { PlatformPortReadModel } from "../semantic/platform-read-model.ts";
import type { ModelsVM as LegacyModelsVM } from "../view-models/types.ts";
import { suggestedEvidenceFromInferred } from "./capability-evidence.ts";
import { resolveExecutorPathLabel } from "./executor-path-labels.ts";
import { getModelAdmission } from "./model-admission-store.ts";
import { buildConnectionFingerprint } from "./model-connection-gate.ts";
import type { PlatformModelsManagementSnapshot } from "./snapshot-types.ts";
import type {
  GovernanceInsight,
  GovernanceRisk,
  ModelAsset,
  ModelIssueAction,
  ModelOverviewVM,
  ModelGovernanceIssue,
  ModelPlan,
  ModelUsageMetric,
  ModelUsageAnalyticsVM,
  PlanUsageMetric,
  PlatformModelsTabContext,
  PlatformModelsVM,
  RoutingDecisionExplanation,
  RoutingPolicy,
  TaskProfile,
  TaskUsageMetric,
} from "./view-model.ts";

export type PlatformModelsAdapterInput = {
  legacyModelsVM?: LegacyModelsVM | null;
  readModel?: PlatformPortReadModel | null;
  models?: ModelAsset[];
  providers?: Array<{ providerId: string; name?: string }>;
  usageByModel?: ModelUsageMetric[];
  usageByPolicy?: Array<{
    policyId: string;
    primaryHitRate?: number;
    fallbackRate?: number;
    manualOverrideRate?: number;
    avgLatencyMs?: number;
    avgCostPerRequest?: number;
  }>;
  usageByPlan?: PlanUsageMetric[];
  usage?: {
    byModel?: ModelUsageMetric[];
    byTask?: TaskUsageMetric[];
    byPlan?: PlanUsageMetric[];
  } | null;
  routingPolicies?: RoutingPolicy[];
  routingExplanations?: RoutingDecisionExplanation[];
  taskProfiles?: TaskProfile[];
  plans?: ModelPlan[];
  governanceIssues?: ModelGovernanceIssue[];
  governanceInsights?: GovernanceInsight[];
  governanceRisks?: GovernanceRisk[];
  allowlist?: unknown[];
  catalog?: unknown[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function clampPercentage(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Number(value.toFixed(1))));
}

function buildSeries7d(base: number, factor = 0.06, floor = 0) {
  return Array.from({ length: 7 }, (_, index) => {
    const wave = (index - 3) * factor;
    const next = base * (1 + wave);
    return Number(Math.max(floor, next).toFixed(2));
  });
}

const SUMMED_LATENCY_MIN_CALLS = 10;
const SUMMED_LATENCY_MIN_MS = 60_000;
const SUMMED_LATENCY_PER_CALL_MAX_MS = 30_000;

/**
 * Some usage rows store a window sum in `avgLatencyMs` (for example 258840.1
 * beside 1042 calls). Collapse that back to a per-call latency when the
 * quotient is a normal request time.
 */
function normalizeUsageAvgLatencyMs(
  raw: number | null | undefined,
  calls: number,
): number | undefined {
  if (raw == null || !Number.isFinite(raw) || raw <= 0) {
    return undefined;
  }
  if (
    calls >= SUMMED_LATENCY_MIN_CALLS &&
    raw >= SUMMED_LATENCY_MIN_MS &&
    raw / calls < SUMMED_LATENCY_PER_CALL_MAX_MS
  ) {
    return Number((raw / calls).toFixed(1));
  }
  return Number(raw.toFixed(1));
}

function weightedAvgLatencyMs(
  metrics: Array<{ avgLatencyMs?: number; calls7d: number }>,
): number | undefined {
  let weighted = 0;
  let calls = 0;
  for (const metric of metrics) {
    const latency = normalizeUsageAvgLatencyMs(metric.avgLatencyMs, metric.calls7d);
    if (latency == null || metric.calls7d <= 0) {
      continue;
    }
    weighted += latency * metric.calls7d;
    calls += metric.calls7d;
  }
  if (calls <= 0) {
    return undefined;
  }
  return Number((weighted / calls).toFixed(1));
}

function averageOf(values: Array<number | null | undefined>) {
  const filtered = values.filter(
    (value): value is number => value != null && Number.isFinite(value),
  );
  if (filtered.length === 0) {
    return undefined;
  }
  return Number((filtered.reduce((sum, value) => sum + value, 0) / filtered.length).toFixed(2));
}

function formatCurrency(value: number) {
  return `$${Number(value).toFixed(value >= 1 ? 2 : 4)}`;
}

function deriveRoutingHealthStatus(input: {
  routingHitRate: number;
  fallbackRate: number;
  manualOverrideRate?: number;
  abnormalTaskCount: number;
}): "healthy" | "warning" | "critical" {
  if (
    input.routingHitRate < 70 ||
    input.fallbackRate > 20 ||
    (input.manualOverrideRate ?? 0) > 15 ||
    input.abnormalTaskCount >= 5
  ) {
    return "critical";
  }
  if (
    input.routingHitRate < 85 ||
    input.fallbackRate > 10 ||
    (input.manualOverrideRate ?? 0) > 8 ||
    input.abnormalTaskCount > 0
  ) {
    return "warning";
  }
  return "healthy";
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean)),
  );
}

function costTierPrice(value: ModelAsset["costTier"]) {
  switch (value) {
    case "low":
      return { input: 0.001, output: 0.0025 };
    case "high":
      return { input: 0.012, output: 0.03 };
    case "medium":
      return { input: 0.004, output: 0.01 };
    default:
      return null;
  }
}

function findLiveProbe(
  providerId: string,
  modelId: string,
  readModel: PlatformPortReadModel | null,
): NonNullable<ModelAsset["liveProbe"]> | null {
  const match =
    readModel?.modelProbeDirectory?.find(
      (entry) => entry.providerId === providerId && entry.modelId === modelId,
    ) ?? null;
  if (!match) {
    return null;
  }
  return {
    status: match.status,
    source: match.source,
    label: match.label,
    ...(match.latencyMs != null ? { latencyMs: match.latencyMs } : {}),
    ...(match.error ? { error: match.error } : {}),
    ...(match.checkedAt != null ? { checkedAt: match.checkedAt } : {}),
  };
}

function inferModelHealthAssessment(
  providerId: string,
  modelId: string,
  readModel: PlatformPortReadModel | null,
): {
  health: ModelAsset["health"];
  basis: NonNullable<ModelAsset["healthBasis"]>;
  note: string;
  liveProbe?: NonNullable<ModelAsset["liveProbe"]>;
} {
  const liveProbe = findLiveProbe(providerId, modelId, readModel);
  if (liveProbe) {
    if (liveProbe.status === "ok") {
      return {
        health: "healthy",
        basis: "live_probe_ok",
        note: `最近一次真实探测成功${liveProbe.latencyMs != null ? `，延迟 ${liveProbe.latencyMs}ms` : ""}。`,
        liveProbe,
      };
    }
    const failedHealth =
      liveProbe.status === "auth" || liveProbe.status === "no_model" ? "unavailable" : "degraded";
    return {
      health: failedHealth,
      basis: "live_probe_failed",
      note:
        liveProbe.error ??
        `最近一次真实探测失败，状态 ${liveProbe.status}${liveProbe.latencyMs != null ? `，延迟 ${liveProbe.latencyMs}ms` : ""}。`,
      liveProbe,
    };
  }
  const provider =
    readModel?.providerHealthDirectory.find((entry) => entry.providerId === providerId) ?? null;
  if (!provider) {
    return {
      health: "healthy",
      basis: "config_inferred",
      note: "当前没有 provider 探测结果，按现有配置与引用关系推导。",
    };
  }
  if (provider.authStatus === "warn") {
    return {
      health: "unavailable",
      basis: "auth_missing",
      note: provider.issue || "缺少 provider 凭证，当前无法确认模型可调用。",
    };
  }
  const explicitlyConfigured = readModel?.modelDirectory.some(
    (entry) => entry.providerId === providerId && entry.modelId === modelId,
  );
  if (explicitlyConfigured) {
    return {
      health: provider.authStatus === "external" ? "degraded" : "healthy",
      basis: "config_inferred",
      note: "模型已在平台配置中显式声明，健康状态基于 provider 配置推导。",
    };
  }
  if (
    readModel &&
    readModel.gatewayCatalogCount > 0 &&
    !readModel.gatewayCatalogModels.some(
      (entry) => entry.providerId === providerId && entry.modelId === modelId,
    )
  ) {
    return {
      health: "degraded",
      basis: "catalog_missing",
      note: "网关已返回目录，但该模型不在目录结果中，当前只能视为降级可见。",
    };
  }
  if (readModel && readModel.gatewayCatalogCount > 0) {
    return {
      health: provider.authStatus === "external" ? "degraded" : "healthy",
      basis: "catalog_verified",
      note:
        provider.authStatus === "external"
          ? "网关目录已发现该模型，但凭证依赖外部链路，仍建议做真实调用校验。"
          : "网关目录已发现该模型，当前可见性正常。",
    };
  }
  return {
    health: provider.authStatus === "external" ? "degraded" : "healthy",
    basis: "config_inferred",
    note:
      provider.authStatus === "external"
        ? "当前未拿到模型目录，仅确认 provider 凭证走外部链路。"
        : "当前未拿到模型目录，健康状态基于 provider 配置推导。",
  };
}

function inferInputModalities(
  inputModes: string[],
  modelId: string,
): ModelAsset["inputModalities"] {
  const inferred = new Set<ModelAsset["inputModalities"][number]>();
  for (const mode of inputModes) {
    if (mode === "text" || mode === "image" || mode === "audio" || mode === "video") {
      inferred.add(mode);
    }
  }
  const normalizedModelId = modelId.toLowerCase();
  if (normalizedModelId.includes("vision") || normalizedModelId.includes("image")) {
    inferred.add("image");
  }
  if (normalizedModelId.includes("video")) {
    inferred.add("video");
  }
  if (normalizedModelId.includes("audio") || normalizedModelId.includes("voice")) {
    inferred.add("audio");
  }
  if (inferred.size === 0) {
    inferred.add("text");
  }
  if (inferred.size > 1) {
    inferred.add("multimodal");
  }
  return Array.from(inferred);
}

function inferOutputModalities(
  inputModalities: ModelAsset["inputModalities"],
  modelId: string,
): ModelAsset["outputModalities"] {
  const normalizedModelId = modelId.toLowerCase();
  if (normalizedModelId.includes("image")) {
    return ["image"];
  }
  if (normalizedModelId.includes("audio") || normalizedModelId.includes("voice")) {
    return ["audio"];
  }
  if (normalizedModelId.includes("video")) {
    return ["video"];
  }
  if (inputModalities.includes("image") && normalizedModelId.includes("vision")) {
    return ["text"];
  }
  return ["text"];
}

/**
 * Suggest capabilities from name / provider / metadata.
 * Results are NOT verified — callers must attach capabilityEvidence with status=suggested.
 */
function inferCapabilities(params: {
  modelId: string;
  providerId: string;
  inputModalities: ModelAsset["inputModalities"];
  contextWindow?: number;
  reasoning?: boolean | null;
  supportsTools?: boolean | null;
}): ModelAsset["capabilities"] {
  const capabilities = new Set<ModelAsset["capabilities"][number]>();
  const modelId = params.modelId.toLowerCase();
  if (params.reasoning || modelId.includes("reason")) {
    capabilities.add("reasoning");
  }
  if (params.supportsTools) {
    capabilities.add("tools");
  }
  if (params.inputModalities.includes("image") || modelId.includes("vision")) {
    capabilities.add("vision");
  }
  if (modelId.includes("code") || params.providerId.toLowerCase().includes("deepseek")) {
    capabilities.add("code");
  }
  if (modelId.includes("realtime") || modelId.includes("stream")) {
    capabilities.add("stream");
  }
  if ((params.contextWindow ?? 0) >= 128000) {
    capabilities.add("long_context");
  }
  return Array.from(capabilities);
}

function inferTaskTags(asset: ModelAsset) {
  const tags = new Set<string>();
  if (asset.capabilities.includes("code")) {
    tags.add("coding");
  }
  if (asset.capabilities.includes("reasoning")) {
    tags.add("high_quality_reasoning");
  }
  if (asset.capabilities.includes("long_context")) {
    tags.add("long_context");
  }
  if (asset.inputModalities.includes("image") && asset.outputModalities.includes("image")) {
    tags.add("image_generation");
  } else if (asset.inputModalities.includes("image")) {
    tags.add("image_understanding");
  }
  if (asset.inputModalities.includes("video")) {
    tags.add("video_processing");
  }
  if (asset.inputModalities.includes("audio")) {
    tags.add("realtime_voice");
  }
  if (tags.size === 0) {
    tags.add(asset.costTier === "low" ? "low_cost_batch" : "general_text");
  }
  return Array.from(tags);
}

type ModelAssetSourceEntry = {
  providerId: string;
  modelId: string;
  name: string | null;
  source: "configured" | "referenced" | "discovered";
  api?: string | null;
  providerApi?: string | null;
  baseUrl?: string | null;
  auth?: string | null;
  reasoning?: boolean | null;
  input: string[];
  contextWindow?: number | null;
  maxTokens?: number | null;
  costTier: "low" | "medium" | "high" | "unknown";
  supportsTools?: boolean | null;
  discoveredOnly?: boolean;
};

function parseModelRef(modelRef: string | null | undefined) {
  if (!modelRef || !modelRef.includes("/")) {
    return null;
  }
  const [providerId, ...rest] = modelRef.split("/");
  const modelId = rest.join("/").trim();
  if (!providerId.trim() || !modelId) {
    return null;
  }
  return {
    providerId: providerId.trim(),
    modelId,
  };
}

function buildSyntheticSourceEntries(
  readModel: PlatformPortReadModel,
  existingKeys: Set<string>,
): ModelAssetSourceEntry[] {
  const refs = uniqueStrings([
    readModel.defaultModelPrimary,
    ...readModel.defaultModelFallbacks,
    readModel.defaultImageModelPrimary,
    ...readModel.allowlistedModelRefs,
  ]);
  const syntheticEntries: ModelAssetSourceEntry[] = [];
  for (const modelRef of refs) {
    const parsed = parseModelRef(modelRef);
    if (!parsed) {
      continue;
    }
    const key = `${parsed.providerId}/${parsed.modelId}`;
    if (existingKeys.has(key)) {
      continue;
    }
    existingKeys.add(key);
    const gatewayEntry =
      readModel.gatewayCatalogModels.find(
        (entry) => entry.providerId === parsed.providerId && entry.modelId === parsed.modelId,
      ) ?? null;
    syntheticEntries.push({
      providerId: parsed.providerId,
      modelId: parsed.modelId,
      name: gatewayEntry?.name ?? parsed.modelId,
      source: "referenced",
      api: null,
      providerApi: null,
      baseUrl: null,
      auth: null,
      reasoning: null,
      input: [],
      contextWindow: gatewayEntry?.contextWindow ?? null,
      maxTokens: null,
      costTier: "unknown",
      supportsTools: null,
    });
  }
  return syntheticEntries;
}

/**
 * Gateway discovery catalog (often 700+ aggregated models) is NOT expanded into
 * platform「模型资产」. Assets are only configured model-directory rows and
 * explicit allowlist / default routing refs (see buildSyntheticSourceEntries).
 * Catalog is still used for health verification and display names.
 */
function buildGatewayCatalogSourceEntries(
  _readModel: PlatformPortReadModel,
  _existingKeys: Set<string>,
): ModelAssetSourceEntry[] {
  return [];
}

function modelDirectoryToSourceEntry(
  entry: PlatformPortReadModel["modelDirectory"][number],
): ModelAssetSourceEntry {
  return {
    providerId: entry.providerId,
    modelId: entry.modelId,
    name: entry.name,
    source: "configured",
    api: entry.api,
    providerApi: entry.providerApi,
    baseUrl: entry.baseUrl,
    auth: entry.auth,
    reasoning: entry.reasoning,
    input: entry.input,
    contextWindow: entry.contextWindow,
    maxTokens: entry.maxTokens,
    costTier: entry.costTier,
    supportsTools: entry.supportsTools,
    discoveredOnly: false,
  };
}

function snapshotAssetToSourceEntry(
  entry: NonNullable<PlatformModelsManagementSnapshot["assets"]>[number],
  readModel: PlatformPortReadModel | null,
): ModelAssetSourceEntry {
  const directoryEntry = readModel?.modelDirectory.find(
    (candidate) => candidate.providerId === entry.providerId && candidate.modelId === entry.modelId,
  );
  const catalogEntry = readModel?.gatewayCatalogModels.find(
    (candidate) => candidate.providerId === entry.providerId && candidate.modelId === entry.modelId,
  );
  if (directoryEntry) {
    return {
      ...modelDirectoryToSourceEntry(directoryEntry),
      name: entry.name ?? directoryEntry.name ?? catalogEntry?.name ?? entry.modelId,
      contextWindow: directoryEntry.contextWindow ?? catalogEntry?.contextWindow ?? null,
    };
  }
  const source: ModelAssetSourceEntry["source"] = entry.allowlisted
    ? entry.inCatalog
      ? "configured"
      : "referenced"
    : "discovered";
  return {
    providerId: entry.providerId,
    modelId: entry.modelId,
    name: entry.name ?? catalogEntry?.name ?? entry.modelId,
    source,
    api: null,
    providerApi: null,
    baseUrl: null,
    auth: null,
    reasoning: null,
    input: [],
    contextWindow: catalogEntry?.contextWindow ?? null,
    maxTokens: null,
    costTier: "unknown",
    supportsTools: null,
    discoveredOnly: source === "discovered",
  };
}

function modelAssetFromSourceEntry(
  entry: ModelAssetSourceEntry,
  readModel: PlatformPortReadModel | null,
  inRecommendationPool: boolean,
): ModelAsset {
  const inputModalities = inferInputModalities(entry.input, entry.modelId);
  const outputModalities = inferOutputModalities(inputModalities, entry.modelId);
  const costTier =
    entry.costTier === "low" || entry.costTier === "medium" || entry.costTier === "high"
      ? entry.costTier
      : "unknown";
  const healthAssessment = inferModelHealthAssessment(entry.providerId, entry.modelId, readModel);
  const health = healthAssessment.health;
  const capabilities = inferCapabilities({
    modelId: entry.modelId,
    providerId: entry.providerId,
    inputModalities,
    contextWindow: entry.contextWindow ?? undefined,
    reasoning: entry.reasoning,
    supportsTools: entry.supportsTools,
  });
  const prices = costTierPrice(costTier);
  const modelRef = `${entry.providerId}/${entry.modelId}`;
  const admission = getModelAdmission(modelRef);
  const suggested = suggestedEvidenceFromInferred(capabilities);
  // Formal evidence only — never merge demoCapabilityEvidence into verified display.
  const evidenceById = new Map(suggested.map((item) => [item.id, item]));
  for (const item of admission.capabilityEvidence) {
    evidenceById.set(item.id, item);
  }
  const capabilityEvidence = Array.from(evidenceById.values());
  const executor = resolveExecutorPathLabel({
    modelId: entry.modelId,
    providerId: entry.providerId,
    outputModalities,
    callType: admission.executorCallType,
  });
  const connectionFingerprint = buildConnectionFingerprint({
    modelId: modelRef,
    providerId: entry.providerId,
    baseUrl: entry.baseUrl ?? null,
    api: entry.api ?? null,
  });
  // Backend admission RPCs are not wired yet — do NOT surface localStorage drafts
  // as platform-effective "允许" / "可参与".
  const admissionControlsAvailable = false;
  const tenantSelectable = false;
  const asset: ModelAsset = {
    modelId: modelRef,
    providerId: entry.providerId,
    providerName: entry.providerId,
    displayName: entry.name ?? entry.modelId,
    source: entry.source,
    inputModalities,
    outputModalities,
    capabilities,
    capabilityEvidence,
    executorPathBadge: executor.badge,
    executorPathDetail: executor.detail,
    connectionFingerprint,
    ...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}),
    ...(entry.api ? { api: entry.api } : {}),
    ...(entry.contextWindow
      ? { contextWindow: entry.contextWindow, contextWindowSource: "catalog" as const }
      : { contextWindowSource: "unknown" as const }),
    ...(entry.maxTokens
      ? { maxOutputTokens: entry.maxTokens, maxOutputTokensSource: "catalog" as const }
      : { maxOutputTokensSource: "unknown" as const }),
    costTier,
    ...(prices ? { inputPrice: prices.input, outputPrice: prices.output } : {}),
    health,
    healthBasis: healthAssessment.basis,
    healthNote: healthAssessment.note,
    ...(healthAssessment.liveProbe ? { liveProbe: healthAssessment.liveProbe } : {}),
    ...(healthAssessment.liveProbe?.latencyMs != null
      ? { avgLatencyMs: healthAssessment.liveProbe.latencyMs }
      : {}),
    taskTags: [],
    inRecommendationPool,
    tenantSelectable,
    admissionControlsAvailable,
    autoRouting: "disabled",
    autoRoutingReason: "后端准入未接入",
    autoRoutingTaskCategories: [],
  };
  asset.taskTags = inferTaskTags(asset);
  return asset;
}

function mapSnapshotAssets(
  snapshot: PlatformModelsManagementSnapshot,
  readModel: PlatformPortReadModel | null,
): ModelAsset[] {
  // Managed-only: drop pure discovery rows that are neither allowlisted nor
  // present in the configured model directory / routing allowlist.
  // Snapshot field `inCatalog` alone is gateway discovery noise (~700+ models).
  const allowlistedRefs = new Set(readModel?.allowlistedModelRefs ?? []);
  const configuredKeys = new Set(
    (readModel?.modelDirectory ?? []).map((entry) => `${entry.providerId}/${entry.modelId}`),
  );
  const snapshotKeys = new Set<string>();
  const assets = (snapshot.assets ?? [])
    .filter((entry) => {
      const key = `${entry.providerId}/${entry.modelId}`;
      return entry.allowlisted || allowlistedRefs.has(key) || configuredKeys.has(key);
    })
    .map((entry) => {
      const key = `${entry.providerId}/${entry.modelId}`;
      snapshotKeys.add(key);
      return modelAssetFromSourceEntry(
        snapshotAssetToSourceEntry(entry, readModel),
        readModel,
        entry.allowlisted || allowlistedRefs.has(key),
      );
    });
  for (const directoryEntry of readModel?.modelDirectory ?? []) {
    const key = `${directoryEntry.providerId}/${directoryEntry.modelId}`;
    if (snapshotKeys.has(key)) {
      continue;
    }
    snapshotKeys.add(key);
    assets.push(
      modelAssetFromSourceEntry(
        modelDirectoryToSourceEntry(directoryEntry),
        readModel,
        allowlistedRefs.has(key),
      ),
    );
  }
  return assets;
}

function buildAssets(
  legacyModelsVM: LegacyModelsVM | null,
  readModel: PlatformPortReadModel | null,
): ModelAsset[] {
  const snapshot = readModel?.modelsManagementSnapshot;
  if (snapshot?.generatedAt && Array.isArray(snapshot.assets)) {
    return mapSnapshotAssets(snapshot, readModel);
  }
  const allowlistedRefs = new Set(readModel?.allowlistedModelRefs ?? []);
  const sourceEntries: ModelAssetSourceEntry[] = readModel
    ? (() => {
        const baseEntries = readModel.modelDirectory.map((entry) => ({
          providerId: entry.providerId,
          modelId: entry.modelId,
          name: entry.name,
          source: "configured" as const,
          api: entry.api,
          providerApi: entry.providerApi,
          baseUrl: entry.baseUrl,
          auth: entry.auth,
          reasoning: entry.reasoning,
          input: entry.input,
          contextWindow: entry.contextWindow,
          maxTokens: entry.maxTokens,
          costTier: entry.costTier,
          supportsTools: entry.supportsTools,
        }));
        const existingKeys = new Set(
          baseEntries.map((entry) => `${entry.providerId}/${entry.modelId}`),
        );
        return [
          ...baseEntries,
          ...buildSyntheticSourceEntries(readModel, existingKeys),
          ...buildGatewayCatalogSourceEntries(readModel, existingKeys),
        ];
      })()
    : (legacyModelsVM?.standardModels.map((entry) => ({
        providerId: entry.providerId,
        modelId: entry.modelId,
        name: entry.name,
        source: "configured" as const,
        input: entry.inputs,
        contextWindow: entry.contextWindowRaw ?? null,
        maxTokens: entry.maxTokensRaw ?? null,
        reasoning: entry.reasoning,
        costTier: entry.costTier,
        supportsTools: entry.supportsTools,
      })) ?? []);

  return sourceEntries.map((entry) =>
    modelAssetFromSourceEntry(
      entry,
      readModel,
      allowlistedRefs.has(`${entry.providerId}/${entry.modelId}`),
    ),
  );
}

function buildModelUsageMetrics(
  assets: ModelAsset[],
  readModel: PlatformPortReadModel | null,
): ModelUsageMetric[] {
  const snapshot = readModel?.modelsManagementSnapshot;
  if (snapshot?.usageByModel?.length) {
    return mapSnapshotUsageByModel(snapshot, assets);
  }
  if (snapshot?.generatedAt) {
    return [];
  }
  void assets;
  void readModel;
  return [];
}

function resolveAssetForModelRef(modelRef: string, assets: ModelAsset[]) {
  const normalized = modelRef.trim();
  const direct = assets.find((asset) => `${asset.providerId}/${asset.modelId}` === normalized);
  if (direct) {
    return direct;
  }
  const slash = normalized.lastIndexOf("/");
  const modelId = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const providerId = slash >= 0 ? normalized.slice(0, slash) : undefined;
  return assets.find(
    (asset) => asset.modelId === modelId && (!providerId || asset.providerId === providerId),
  );
}

function mapSnapshotUsageByModel(
  snapshot: PlatformModelsManagementSnapshot,
  assets: ModelAsset[],
): ModelUsageMetric[] {
  return (snapshot.usageByModel ?? []).map((entry) => {
    const asset = resolveAssetForModelRef(entry.modelRef, assets);
    const calls7d = entry.calls7d ?? entry.quantity ?? 0;
    const cost7d = entry.cost7d ?? 0;
    return {
      modelId: asset?.modelId ?? entry.modelId ?? entry.modelRef,
      providerId: asset?.providerId ?? entry.providerId,
      providerName: asset?.providerName,
      calls7d,
      cost7d,
      avgCostPerCall: calls7d > 0 ? Number((cost7d / calls7d).toFixed(4)) : 0,
      successRate: entry.successRate ?? 0,
      avgLatencyMs: normalizeUsageAvgLatencyMs(entry.avgLatencyMs, calls7d) ?? 0,
      fallbackRate: entry.fallbackRate ?? 0,
    };
  });
}

function mapSnapshotUsageByTask(
  snapshot: PlatformModelsManagementSnapshot,
  taskProfiles: TaskProfile[],
): TaskUsageMetric[] {
  return (snapshot.usageByTask ?? []).map((entry) => {
    const profile = taskProfiles.find((item) => item.taskProfileId === entry.taskProfileId);
    const topModelIds = entry.topModelRefs.map((ref) => {
      const slash = ref.lastIndexOf("/");
      return slash >= 0 ? ref.slice(slash + 1) : ref;
    });
    const failureRate = entry.failureRate ?? 0;
    const executionSuccessRate = clampPercentage(100 - failureRate);
    const flags: NonNullable<TaskUsageMetric["flags"]> = [];
    if (entry.cost7d >= 5) {
      flags.push("high_cost");
    }
    return {
      taskProfileId: entry.taskProfileId,
      name: entry.name ?? profile?.name,
      calls7d: entry.calls7d,
      cost7d: entry.cost7d,
      topModelIds,
      failureRate,
      executionSuccessRate,
      taskSuccessRate: clampPercentage(executionSuccessRate - 3),
      userAcceptedRate: clampPercentage(executionSuccessRate - 6),
      fallbackRecoveredRate: clampPercentage(Math.max(0, executionSuccessRate - failureRate)),
      hardFailureRate: failureRate,
      manualOverrideRate: entry.manualOverrideRate,
      ...(flags.length > 0 ? { flags } : {}),
    };
  });
}

function mapSnapshotUsageByPlan(
  snapshot: PlatformModelsManagementSnapshot,
  taskMetrics: TaskUsageMetric[],
): PlanUsageMetric[] {
  return (snapshot.usageByPlan ?? []).map((entry) => {
    const taskMetric = taskMetrics.find((item) => item.taskProfileId === entry.taskProfileId);
    const calls7d = entry.calls7d;
    const cost7d = entry.cost7d;
    const actualCostPerCall = calls7d > 0 ? Number((cost7d / calls7d).toFixed(4)) : undefined;
    return {
      planId: entry.planId,
      name: entry.name ?? entry.planId,
      taskProfileId: entry.taskProfileId,
      calls7d,
      cost7d,
      avgCostPerCall: actualCostPerCall,
      budgetStatus: "within_budget" as const,
      budget: {
        targetCostPerCall: actualCostPerCall,
        actualCostPerCall,
        deviationRatio: 0,
        source: "plan" as const,
      },
      modelDistribution: taskMetric?.modelDistribution ?? [],
      fallbackRate: entry.fallbackRate,
      manualOverrideRate: entry.manualOverrideRate ?? taskMetric?.manualOverrideRate,
    };
  });
}

function taskCategoryFromId(taskProfileId: string): TaskProfile["category"] {
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

function buildConfiguredPlans(readModel: PlatformPortReadModel | null): ModelPlan[] {
  return (readModel?.taskPlanDirectory ?? []).map((entry) => ({
    planId: entry.planId,
    name: entry.name ?? entry.planId,
    description: entry.description ?? "",
    taskProfileId: entry.taskProfileId ?? entry.planId,
    configSource: "dedicated" as const,
    audience: entry.audience ?? "platform",
    primaryModelIds: entry.primaryModelIds,
    fallbackModelIds: entry.fallbackModelIds,
    costTarget: entry.costTarget ?? "medium",
    qualityTarget: entry.qualityTarget ?? "standard",
    latencyTarget: entry.latencyTarget ?? "interactive",
    userSelectable: entry.userSelectable ?? false,
    tenantOverrideAllowed: entry.tenantOverrideAllowed ?? false,
    status: entry.status ?? "draft",
    ...(entry.updatedAt != null ? { updatedAt: entry.updatedAt } : {}),
  }));
}

function buildConfiguredTaskProfiles(plans: ModelPlan[]): TaskProfile[] {
  const seen = new Set<string>();
  const profiles: TaskProfile[] = [];
  for (const plan of plans) {
    if (seen.has(plan.taskProfileId)) {
      continue;
    }
    seen.add(plan.taskProfileId);
    profiles.push({
      taskProfileId: plan.taskProfileId,
      name: plan.name,
      description: plan.description,
      category: taskCategoryFromId(plan.taskProfileId),
      requiredCapabilities: [],
      inputModalities: [],
      outputModalities: [],
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

function buildConfiguredRoutingPolicies(readModel: PlatformPortReadModel | null): RoutingPolicy[] {
  return (readModel?.routingPolicyDirectory ?? []).map((entry) => ({
    policyId: entry.policyId,
    name: entry.name ?? `${entry.taskProfileId ?? entry.planId ?? entry.policyId} 路由策略`,
    taskProfileId: entry.taskProfileId ?? entry.planId ?? entry.policyId,
    ...(entry.planId ? { planId: entry.planId } : {}),
    configSource: "dedicated" as const,
    scope: {},
    constraints: {
      ...(entry.maxCostPerRequest != null ? { maxCostPerRequest: entry.maxCostPerRequest } : {}),
      ...(entry.maxLatencyMs != null ? { maxLatencyMs: entry.maxLatencyMs } : {}),
      ...(entry.requiredCapabilities.length > 0
        ? { requiredCapabilities: entry.requiredCapabilities }
        : {}),
      ...(entry.requiredHealth ? { requiredHealth: entry.requiredHealth } : {}),
    },
    ranking: {
      mode: entry.rankingMode ?? "balanced",
    },
    candidates: {
      primary: entry.primaryModelIds,
      fallback: entry.fallbackModelIds,
    },
    status: entry.status ?? "draft",
    ...(entry.updatedAt != null ? { updatedAt: entry.updatedAt } : {}),
  }));
}

function mapSnapshotPlans(snapshot: PlatformModelsManagementSnapshot): ModelPlan[] {
  return (snapshot.taskPlans ?? []).map((entry) => ({
    planId: entry.planId,
    name: entry.name ?? entry.planId,
    description: entry.description ?? "",
    taskProfileId: entry.taskProfileId ?? entry.planId,
    configSource: "dedicated" as const,
    audience: entry.audience ?? "platform",
    primaryModelIds: entry.primaryModelIds,
    fallbackModelIds: entry.fallbackModelIds,
    costTarget: entry.costTarget ?? "medium",
    qualityTarget: entry.qualityTarget ?? "standard",
    latencyTarget: entry.latencyTarget ?? "interactive",
    userSelectable: entry.userSelectable === true,
    tenantOverrideAllowed: entry.tenantOverrideAllowed === true,
    status: entry.status ?? "draft",
    ...(entry.updatedAt != null ? { updatedAt: entry.updatedAt } : {}),
    ...(entry.aorExecution ? { aorExecution: entry.aorExecution } : {}),
  }));
}

function mapSnapshotPolicies(snapshot: PlatformModelsManagementSnapshot): RoutingPolicy[] {
  return (snapshot.routingPolicies ?? []).map((entry) => ({
    policyId: entry.policyId,
    name: entry.name ?? entry.policyId,
    taskProfileId: entry.taskProfileId ?? entry.planId ?? entry.policyId,
    ...(entry.planId ? { planId: entry.planId } : {}),
    configSource: "dedicated" as const,
    scope: {
      ...(entry.scope?.tenantIds?.length ? { tenantIds: entry.scope.tenantIds } : {}),
      ...(entry.scope?.userSegments?.length ? { userSegments: entry.scope.userSegments } : {}),
      ...(entry.scope?.agentIds?.length ? { agentIds: entry.scope.agentIds } : {}),
    },
    constraints: {
      ...(entry.maxCostPerRequest != null ? { maxCostPerRequest: entry.maxCostPerRequest } : {}),
      ...(entry.maxLatencyMs != null ? { maxLatencyMs: entry.maxLatencyMs } : {}),
      ...(entry.requiredCapabilities?.length
        ? { requiredCapabilities: entry.requiredCapabilities }
        : {}),
      ...(entry.requiredHealth ? { requiredHealth: entry.requiredHealth } : {}),
    },
    ranking: {
      mode: entry.rankingMode ?? "balanced",
    },
    candidates: {
      primary: entry.primaryModelIds,
      fallback: entry.fallbackModelIds,
    },
    status: entry.status ?? "draft",
    ...(entry.updatedAt != null ? { updatedAt: entry.updatedAt } : {}),
  }));
}

function mapSnapshotTaskProfiles(snapshot: PlatformModelsManagementSnapshot): TaskProfile[] {
  return (snapshot.taskProfiles ?? []).map((entry) => ({
    taskProfileId: entry.taskProfileId,
    name: entry.name,
    description: entry.description ?? undefined,
    category: (entry.category as TaskProfile["category"]) ?? "general_text",
    requiredCapabilities: [],
    inputModalities: [],
    outputModalities: [],
    priorityMode: entry.priorityMode,
    status: entry.status,
  }));
}

function applySnapshotPolicyPerformance(
  policies: RoutingPolicy[],
  snapshot: PlatformModelsManagementSnapshot | null | undefined,
): RoutingPolicy[] {
  if (!snapshot?.usageByPolicy?.length) {
    return policies;
  }
  const usageMap = new Map(snapshot.usageByPolicy.map((entry) => [entry.policyId, entry]));
  return policies.map((policy) => {
    const usage = usageMap.get(policy.policyId);
    if (!usage) {
      return policy;
    }
    return {
      ...policy,
      performance: {
        primaryHitRate: usage.primaryHitRate,
        fallbackRate: usage.fallbackRate,
        manualOverrideRate: usage.manualOverrideRate,
        avgLatencyMs: usage.avgLatencyMs,
        avgCostPerRequest: usage.avgCostPerRequest,
      },
    };
  });
}

function mapAorRoutingExplanations(
  readModel: PlatformPortReadModel | null,
): RoutingDecisionExplanation[] {
  const source =
    readModel?.aor?.routingExplanations ??
    readModel?.modelsManagementSnapshot?.aor?.routingExplanations ??
    [];
  return source.map((entry) => ({
    requestId: entry.requestId,
    taskProfileId: entry.taskProfileId,
    ...(entry.planId ? { planId: entry.planId } : {}),
    selectedModelId: entry.selectedModelId,
    matchedRules: entry.matchedRules,
    rejectedModels: entry.rejectedModels,
    fallbackChain: entry.fallbackChain,
    decisionReason: entry.decisionReason,
    ...(entry.createdAt != null ? { createdAt: entry.createdAt } : {}),
    ...(entry.evaluatorScore != null ? { evaluatorScore: entry.evaluatorScore } : {}),
  }));
}

function mapSnapshotGovernanceIssueType(type: string): ModelGovernanceIssue["type"] {
  switch (type) {
    case "aor_execution_unmapped":
      return "aor_execution_unmapped";
    case "aor_no_policy_bindings":
      return "aor_no_policy_bindings";
    case "aor_sync_degraded":
      return "aor_sync_degraded";
    case "task_without_candidate":
      return "task_without_candidate";
    default:
      return "aor_sync_degraded";
  }
}

function mapSnapshotGovernanceIssues(
  snapshot: PlatformModelsManagementSnapshot | null | undefined,
): ModelGovernanceIssue[] {
  return (snapshot?.governanceIssues ?? []).map((issue) => ({
    issueId: issue.issueId,
    type: mapSnapshotGovernanceIssueType(issue.type),
    severity: issue.severity,
    title: issue.title,
    description: issue.description,
    ...(issue.relatedPlanIds ? { relatedPlanIds: issue.relatedPlanIds } : {}),
    ...(issue.relatedPolicyIds ? { relatedPolicyIds: issue.relatedPolicyIds } : {}),
    ...(issue.relatedModelRefs ? { relatedModelIds: issue.relatedModelRefs } : {}),
    suggestedAction: "review_policy",
  }));
}

function mergeGovernanceIssues(
  base: ModelGovernanceIssue[],
  extra: ModelGovernanceIssue[],
): ModelGovernanceIssue[] {
  const store = new Map(base.map((issue) => [issue.issueId, issue]));
  for (const issue of extra) {
    if (!store.has(issue.issueId)) {
      store.set(issue.issueId, issue);
    }
  }
  return [...store.values()];
}

function resolvePlansAndPolicies(readModel: PlatformPortReadModel | null): {
  plans: ModelPlan[];
  policies: RoutingPolicy[];
  snapshotLoaded: boolean;
} {
  const snapshot = readModel?.modelsManagementSnapshot;
  if (snapshot?.generatedAt) {
    return {
      plans: snapshot.taskPlans?.length
        ? mapSnapshotPlans(snapshot)
        : buildConfiguredPlans(readModel),
      policies: snapshot.routingPolicies?.length
        ? applySnapshotPolicyPerformance(mapSnapshotPolicies(snapshot), snapshot)
        : buildConfiguredRoutingPolicies(readModel),
      snapshotLoaded: true,
    };
  }
  return {
    plans: buildConfiguredPlans(readModel),
    policies: buildConfiguredRoutingPolicies(readModel),
    snapshotLoaded: false,
  };
}

function buildTaskUsageMetrics(
  taskProfiles: TaskProfile[],
  plans: ModelPlan[],
  modelMetrics: ModelUsageMetric[],
): TaskUsageMetric[] {
  if (modelMetrics.length === 0) {
    return [];
  }
  return taskProfiles.map((profile, index) => {
    const relatedPlan = plans.find((plan) => plan.taskProfileId === profile.taskProfileId) ?? null;
    const topModelIds = [
      ...(relatedPlan?.primaryModelIds ?? []),
      ...(relatedPlan?.fallbackModelIds ?? []),
    ].slice(0, 3);
    const relatedMetrics = modelMetrics.filter((metric) => topModelIds.includes(metric.modelId));
    const calls7d =
      relatedMetrics.reduce((sum, metric) => sum + metric.calls7d, 0) || Math.max(4, 10 - index);
    const cost7d = Number(
      (
        relatedMetrics.reduce((sum, metric) => sum + metric.cost7d, 0) ||
        calls7d * (profile.priorityMode === "quality" ? 0.06 : 0.025)
      ).toFixed(2),
    );
    const fallbackRate = relatedMetrics.length
      ? relatedMetrics.reduce((sum, metric) => sum + metric.fallbackRate, 0) / relatedMetrics.length
      : 14;
    const executionSuccessRate = clampPercentage(
      relatedMetrics.length
        ? relatedMetrics.reduce(
            (sum, metric) => sum + (metric.executionSuccessRate ?? metric.successRate),
            0,
          ) / relatedMetrics.length
        : profile.stabilityTarget === "critical"
          ? 96
          : 89 - index * 1.3,
    );
    const taskSuccessRate = clampPercentage(
      executionSuccessRate - (profile.priorityMode === "quality" ? 3 : 5),
    );
    const userAcceptedRate = clampPercentage(taskSuccessRate - 3);
    const hardFailureRate = clampPercentage(
      profile.stabilityTarget === "critical"
        ? 4.5
        : 100 - executionSuccessRate - fallbackRate * 0.2,
    );
    const fallbackRecoveredRate = clampPercentage(
      100 - hardFailureRate - (100 - executionSuccessRate),
    );
    const manualOverrideRate = clampPercentage(
      profile.priorityMode === "quality"
        ? 8
        : profile.priorityMode === "cost"
          ? 15
          : fallbackRate / 2,
    );
    const modelDistribution =
      topModelIds.length > 0
        ? topModelIds.map((modelId, metricIndex) => ({
            modelId,
            ratio: clampPercentage(
              metricIndex === 0
                ? 68 - index * 3
                : metricIndex === 1
                  ? 22 + index
                  : 10 + index * 0.6,
            ),
          }))
        : [];
    const flags: NonNullable<TaskUsageMetric["flags"]> = [];
    if (cost7d >= 5) {
      flags.push("high_cost");
    }
    if (taskSuccessRate < 84) {
      flags.push("low_success");
    }
    if (fallbackRate >= 16) {
      flags.push("high_fallback");
    }
    if (manualOverrideRate >= 12) {
      flags.push("high_override");
    }
    return {
      taskProfileId: profile.taskProfileId,
      name: profile.name,
      calls7d,
      cost7d,
      topModelIds,
      modelDistribution,
      failureRate: hardFailureRate,
      executionSuccessRate,
      taskSuccessRate,
      userAcceptedRate,
      fallbackRecoveredRate,
      hardFailureRate,
      manualOverrideRate,
      trends: {
        calls7d: buildSeries7d(calls7d, 0.08, 1),
        cost7d: buildSeries7d(cost7d, 0.1, 0.01),
        success7d: buildSeries7d(taskSuccessRate, 0.02, 0),
        fallback7d: buildSeries7d(fallbackRate, 0.12, 0),
        manualOverride7d: buildSeries7d(manualOverrideRate, 0.08, 0),
      },
      ...(flags.length > 0 ? { flags } : {}),
    };
  });
}

function buildPlanUsageMetrics(
  plans: ModelPlan[],
  taskMetrics: TaskUsageMetric[],
): PlanUsageMetric[] {
  if (taskMetrics.length === 0) {
    return [];
  }
  return plans.map((plan) => {
    const taskMetric = taskMetrics.find((entry) => entry.taskProfileId === plan.taskProfileId);
    const cost7d = taskMetric?.cost7d ?? 0;
    const calls7d = taskMetric?.calls7d ?? 0;
    const actualCostPerCall = calls7d > 0 ? Number((cost7d / calls7d).toFixed(4)) : undefined;
    const targetCostPerCall =
      plan.costTarget === "low" ? 0.02 : plan.costTarget === "medium" ? 0.05 : 0.09;
    const deviationRatio =
      actualCostPerCall != null
        ? Number(((actualCostPerCall - targetCostPerCall) / targetCostPerCall).toFixed(2))
        : undefined;
    const budgetStatus =
      actualCostPerCall != null && actualCostPerCall > targetCostPerCall * 1.2
        ? "over_budget"
        : actualCostPerCall != null && actualCostPerCall > targetCostPerCall * 0.95
          ? "near_limit"
          : "within_budget";
    const flags: NonNullable<PlanUsageMetric["flags"]> = [];
    if (budgetStatus !== "within_budget") {
      flags.push("high_cost");
    }
    if ((taskMetric?.manualOverrideRate ?? 0) >= 12) {
      flags.push("high_override");
    }
    const fallbackRate =
      taskMetric?.topModelIds.length && plan.fallbackModelIds.length > 0
        ? clampPercentage(
            8 + taskMetrics.findIndex((entry) => entry.taskProfileId === plan.taskProfileId) * 1.4,
          )
        : plan.fallbackModelIds.length === 0
          ? clampPercentage(19)
          : undefined;
    if ((fallbackRate ?? 0) >= 15) {
      flags.push("high_fallback");
    }
    return {
      planId: plan.planId,
      name: plan.name,
      taskProfileId: plan.taskProfileId,
      calls7d,
      cost7d,
      avgCostPerCall: actualCostPerCall,
      budgetStatus,
      budget: {
        targetCostPerCall,
        actualCostPerCall,
        deviationRatio,
        source: "plan",
      },
      modelDistribution: taskMetric?.modelDistribution ?? [],
      fallbackRate,
      manualOverrideRate: taskMetric?.manualOverrideRate,
      trends: {
        calls7d: buildSeries7d(calls7d, 0.08, 1),
        cost7d: buildSeries7d(cost7d, 0.1, 0.01),
        fallback7d: fallbackRate != null ? buildSeries7d(fallbackRate, 0.1, 0) : undefined,
        manualOverride7d:
          taskMetric?.manualOverrideRate != null
            ? buildSeries7d(taskMetric.manualOverrideRate, 0.08, 0)
            : undefined,
      },
      ...(flags.length > 0 ? { flags } : {}),
      recommendedAction:
        budgetStatus === "over_budget"
          ? "检查主模型是否应降级为经济候选或补齐低成本 fallback。"
          : budgetStatus === "near_limit"
            ? "关注后续 7 日成本趋势，必要时收紧任务预算。"
            : undefined,
    };
  });
}

export function buildModelUsageAnalyticsVM(input: PlatformModelsAdapterInput) {
  const now = Date.now();
  const models = input.models ?? [];
  const byModel = (input.usageByModel ?? input.usage?.byModel ?? []).map((metric) => ({
    ...metric,
    avgLatencyMs: normalizeUsageAvgLatencyMs(metric.avgLatencyMs, metric.calls7d) ?? 0,
  }));
  const byTask = input.usage?.byTask ?? [];
  const byPlan = input.usageByPlan ?? input.usage?.byPlan ?? [];
  const aorReadModel = input.readModel?.aor ?? input.readModel?.modelsManagementSnapshot?.aor;
  const platformModelsMode = input.readModel?.platformModelsMode ?? "native";
  const totalCalls7d = byModel.reduce((sum, metric) => sum + metric.calls7d, 0);
  const totalCost7d = Number(byModel.reduce((sum, metric) => sum + metric.cost7d, 0).toFixed(2));
  return {
    timeRange: {
      label: "最近 7 天",
      from: now - 7 * 24 * 60 * 60 * 1000,
      to: now,
    },
    summary: {
      totalCalls7d,
      totalCost7d,
      avgCostPerRequest: Number((totalCost7d / Math.max(totalCalls7d, 1)).toFixed(4)),
      avgExecutionSuccessRate: averageOf(
        byModel.map((metric) => metric.executionSuccessRate ?? metric.successRate),
      ),
      avgTaskSuccessRate: averageOf(byModel.map((metric) => metric.taskSuccessRate)),
      avgUserAcceptedRate: averageOf(byModel.map((metric) => metric.userAcceptedRate)),
      avgLatencyMs: weightedAvgLatencyMs(byModel),
      avgFallbackRate: averageOf(byModel.map((metric) => metric.fallbackRate)),
      avgManualOverrideRate: averageOf(byTask.map((metric) => metric.manualOverrideRate)),
      highestCostModelId: [...byModel].toSorted((left, right) => right.cost7d - left.cost7d)[0]
        ?.modelId,
      highestCostTaskProfileId: [...byTask].toSorted((left, right) => right.cost7d - left.cost7d)[0]
        ?.taskProfileId,
      overBudgetPlanCount: byPlan.filter((metric) => metric.budgetStatus === "over_budget").length,
      highCostModelCount: byModel.filter((metric) => metric.flags?.includes("high_cost")).length,
      highFailureTaskCount: byTask.filter(
        (metric) =>
          metric.flags?.includes("low_success") ||
          (metric.hardFailureRate ?? metric.failureRate) >= 14,
      ).length,
      highFallbackPlanCount: byPlan.filter(
        (metric) => metric.flags?.includes("high_fallback") || (metric.fallbackRate ?? 0) >= 15,
      ).length,
      trends: {
        calls7d:
          totalCalls7d > 0
            ? Array.from({ length: 7 }, (_, index) =>
                Math.max(
                  1,
                  Math.round(
                    byModel.reduce(
                      (sum, metric) => sum + (metric.trends?.calls7d?.[index] ?? 0),
                      0,
                    ),
                  ),
                ),
              )
            : undefined,
        cost7d:
          totalCost7d > 0
            ? Array.from({ length: 7 }, (_, index) =>
                Number(
                  byModel
                    .reduce((sum, metric) => sum + (metric.trends?.cost7d?.[index] ?? 0), 0)
                    .toFixed(2),
                ),
              )
            : undefined,
        success7d:
          byModel.length > 0
            ? Array.from({ length: 7 }, (_, index) =>
                Number(
                  (
                    byModel.reduce(
                      (sum, metric) => sum + (metric.trends?.success7d?.[index] ?? 0),
                      0,
                    ) / byModel.length
                  ).toFixed(2),
                ),
              )
            : undefined,
        fallback7d:
          byModel.length > 0
            ? Array.from({ length: 7 }, (_, index) =>
                Number(
                  (
                    byModel.reduce(
                      (sum, metric) => sum + (metric.trends?.fallback7d?.[index] ?? 0),
                      0,
                    ) / byModel.length
                  ).toFixed(2),
                ),
              )
            : undefined,
        manualOverride7d:
          byTask.length > 0
            ? Array.from({ length: 7 }, (_, index) =>
                Number(
                  (
                    byTask.reduce(
                      (sum, metric) => sum + (metric.trends?.manualOverride7d?.[index] ?? 0),
                      0,
                    ) / byTask.length
                  ).toFixed(2),
                ),
              )
            : undefined,
      },
    },
    byModel,
    byTask,
    byPlan,
    filters: {
      modelIds: uniqueStrings(byModel.map((metric) => metric.modelId)),
      taskProfileIds: uniqueStrings(byTask.map((metric) => metric.taskProfileId)),
      planIds: uniqueStrings(byPlan.map((metric) => metric.planId)),
      providerIds: uniqueStrings(byModel.map((metric) => metric.providerId)),
      capabilityTags: uniqueStrings(
        byModel.flatMap(
          (metric) => models.find((model) => model.modelId === metric.modelId)?.capabilities ?? [],
        ),
      ),
      budgetStatuses: uniqueStrings(byPlan.map((metric) => metric.budgetStatus)).filter(
        (value): value is PlanUsageMetric["budgetStatus"] =>
          value === "within_budget" || value === "near_limit" || value === "over_budget",
      ),
    },
    defaultView:
      totalCalls7d > 0 &&
      byPlan.reduce((sum, metric) => sum + metric.calls7d, 0) === 0 &&
      byModel.length > 0
        ? "byModel"
        : "byPlan",
    defaultSort: {
      field: byPlan.some((metric) => metric.budgetStatus === "over_budget")
        ? ("cost7d" as const)
        : ("calls7d" as const),
      direction: "desc" as const,
    },
    ...(byModel.length === 0 && byTask.length === 0 && byPlan.length === 0
      ? {
          emptyState: {
            title: "暂无模型使用数据",
            description:
              "模型调用、成本和效果数据接入后，这里会展示按模型、按任务、按方案的使用分析。",
            primaryActionLabel: "查看模型资产",
          },
        }
      : {}),
    ...(platformModelsMode === "aor_enhanced" && aorReadModel
      ? {
          aor: {
            enabled: aorReadModel.enabled,
            syncStatus: aorReadModel.syncStatus,
            banditArms: aorReadModel.learning?.arms ?? [],
            optimization: aorReadModel.optimization,
          },
        }
      : {}),
  };
}

function legacyIssuesToGovernance(legacyModelsVM: LegacyModelsVM | null): ModelGovernanceIssue[] {
  return (
    legacyModelsVM?.issueItems.map((item, index) => ({
      issueId: `legacy-issue-${index + 1}`,
      type: item.title.includes("成本")
        ? "cost_spike"
        : item.title.includes("fallback")
          ? "missing_fallback"
          : item.title.includes("目录")
            ? "unregistered_model_used"
            : "manual_override_high",
      severity:
        item.meta?.includes("高风险") || item.meta?.includes("critical")
          ? "critical"
          : item.meta?.includes("需要")
            ? "warning"
            : "info",
      title: item.title,
      description: item.subtitle,
      suggestedAction: item.title.includes("fallback")
        ? "add_fallback"
        : item.title.includes("目录")
          ? "review_policy"
          : item.title.includes("成本")
            ? "move_to_fallback"
            : "complete_metadata",
    })) ?? []
  );
}

function mergeGovernanceIssue(
  current: ModelGovernanceIssue,
  next: ModelGovernanceIssue,
): ModelGovernanceIssue {
  const severityPriority: Record<ModelGovernanceIssue["severity"], number> = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  return {
    ...current,
    ...(severityPriority[next.severity] < severityPriority[current.severity]
      ? { severity: next.severity, title: next.title, description: next.description }
      : {}),
    relatedModelIds: uniqueStrings([
      ...(current.relatedModelIds ?? []),
      ...(next.relatedModelIds ?? []),
    ]),
    relatedTaskProfileIds: uniqueStrings([
      ...(current.relatedTaskProfileIds ?? []),
      ...(next.relatedTaskProfileIds ?? []),
    ]),
    relatedPlanIds: uniqueStrings([
      ...(current.relatedPlanIds ?? []),
      ...(next.relatedPlanIds ?? []),
    ]),
    relatedPolicyIds: uniqueStrings([
      ...(current.relatedPolicyIds ?? []),
      ...(next.relatedPolicyIds ?? []),
    ]),
  };
}

function pushGovernanceIssue(
  store: Map<string, ModelGovernanceIssue>,
  issue: ModelGovernanceIssue,
) {
  const current = store.get(issue.issueId);
  store.set(issue.issueId, current ? mergeGovernanceIssue(current, issue) : issue);
}

function buildGovernanceIssues(params: {
  assets: ModelAsset[];
  plans: ModelPlan[];
  policies: RoutingPolicy[];
  analyticsByModel: ModelUsageMetric[];
  analyticsByTask: TaskUsageMetric[];
  analyticsByPlan: PlanUsageMetric[];
  readModel: PlatformPortReadModel | null;
  legacyModelsVM: LegacyModelsVM | null;
}) {
  const issueStore = new Map<string, ModelGovernanceIssue>();
  for (const asset of params.assets) {
    if (asset.inputPrice == null || asset.outputPrice == null) {
      pushGovernanceIssue(issueStore, {
        issueId: `issue-price-${asset.modelId}`,
        type: "missing_price",
        severity: "warning",
        title: `${asset.displayName} 缺少价格元数据`,
        description: "输入或输出价格为空，后续成本分析只能使用估算值。",
        relatedModelIds: [asset.modelId],
        suggestedAction: "complete_metadata",
      });
    }
    if (asset.capabilities.length === 0) {
      pushGovernanceIssue(issueStore, {
        issueId: `issue-capability-${asset.modelId}`,
        type: "missing_capability_tag",
        severity: "warning",
        title: `${asset.displayName} 缺少能力标签`,
        description: "该模型还没有形成标准化 capability 标签，任务画像难以稳定命中。",
        relatedModelIds: [asset.modelId],
        suggestedAction: "complete_metadata",
      });
    }
  }
  for (const policy of params.policies) {
    if (policy.candidates.primary.length === 0) {
      pushGovernanceIssue(issueStore, {
        issueId: `issue-task-without-candidate-${policy.policyId}`,
        type: "task_without_candidate",
        severity: "critical",
        title: `${policy.name} 没有主候选模型`,
        description: "当前任务画像没有可用主模型，系统无法稳定完成自动匹配。",
        relatedTaskProfileIds: [policy.taskProfileId],
        relatedPlanIds: policy.planId ? [policy.planId] : undefined,
        suggestedAction: "bind_to_task_profile",
      });
    }
    if (policy.candidates.fallback.length === 0) {
      pushGovernanceIssue(issueStore, {
        issueId: `issue-missing-fallback-${policy.policyId}`,
        type: "missing_fallback",
        severity: policy.status === "active" ? "warning" : "info",
        title: `${policy.name} 缺少 fallback`,
        description: "主模型不可用时缺少备用链路，容易导致高失败或人工改配。",
        relatedTaskProfileIds: [policy.taskProfileId],
        relatedPlanIds: policy.planId ? [policy.planId] : undefined,
        suggestedAction: "add_fallback",
      });
    }
  }
  for (const metric of params.analyticsByModel) {
    if (metric.flags?.includes("high_cost") && metric.calls7d <= 2) {
      pushGovernanceIssue(issueStore, {
        issueId: `issue-high-cost-low-usage-${metric.modelId}`,
        type: "high_cost_low_usage",
        severity: metric.avgCostPerCall >= 1 ? "warning" : "info",
        title: `${metric.modelId} 成本高但使用低`,
        description: "近 7 日有成本支出，但没有形成稳定使用，建议评估是否下沉为 fallback。",
        relatedModelIds: [metric.modelId],
        suggestedAction: "move_to_fallback",
      });
    }
    if (metric.flags?.includes("low_success") || metric.flags?.includes("high_fallback")) {
      pushGovernanceIssue(issueStore, {
        issueId: `issue-high-failure-${metric.modelId}`,
        type: "high_usage_high_failure",
        severity:
          (metric.hardFailureRate ?? 0) >= 18 ||
          (metric.flags?.includes("low_success") && metric.flags?.includes("high_fallback"))
            ? "critical"
            : "warning",
        title: `${metric.modelId} 成功率偏低`,
        description:
          "模型的任务成功、硬失败或 fallback 信号异常，说明当前路由或候选模型组合需要治理。",
        relatedModelIds: [metric.modelId],
        suggestedAction: "review_policy",
      });
    }
  }
  for (const taskMetric of params.analyticsByTask) {
    if (taskMetric.flags?.includes("high_override")) {
      pushGovernanceIssue(issueStore, {
        issueId: `issue-manual-override-${taskMetric.taskProfileId}`,
        type: "manual_override_high",
        severity: (taskMetric.manualOverrideRate ?? 0) >= 18 ? "critical" : "warning",
        title: `${taskMetric.taskProfileId} 人工改配率偏高`,
        description: "用户经常手工改选模型，说明标准方案或自动路由未满足预期。",
        relatedTaskProfileIds: [taskMetric.taskProfileId],
        suggestedAction: "review_policy",
      });
    }
  }
  for (const planMetric of params.analyticsByPlan) {
    if (planMetric.flags?.includes("high_cost") || planMetric.budgetStatus === "over_budget") {
      pushGovernanceIssue(issueStore, {
        issueId: `issue-plan-budget-${planMetric.planId}`,
        type: "cost_spike",
        severity:
          planMetric.budget?.deviationRatio != null && planMetric.budget.deviationRatio >= 0.4
            ? "critical"
            : planMetric.budgetStatus === "near_limit"
              ? "info"
              : "warning",
        title: `${planMetric.name ?? planMetric.planId} 超出目标预算`,
        description:
          "方案的实际单次成本已超过目标预算，建议检查主模型是否需要降级或补齐经济 fallback。",
        relatedPlanIds: [planMetric.planId],
        relatedTaskProfileIds: planMetric.taskProfileId ? [planMetric.taskProfileId] : undefined,
        suggestedAction: "review_policy",
      });
    }
    if (planMetric.flags?.includes("high_override")) {
      pushGovernanceIssue(issueStore, {
        issueId: `issue-plan-override-${planMetric.planId}`,
        type: "manual_override_high",
        severity: (planMetric.manualOverrideRate ?? 0) >= 18 ? "critical" : "warning",
        title: `${planMetric.name ?? planMetric.planId} 人工改配率偏高`,
        description: "该方案需要重新审视主模型、fallback 链和任务约束，降低人工改选频率。",
        relatedPlanIds: [planMetric.planId],
        relatedTaskProfileIds: planMetric.taskProfileId ? [planMetric.taskProfileId] : undefined,
        suggestedAction: "review_policy",
      });
    }
    if (
      planMetric.flags?.includes("high_fallback") &&
      !params.policies.some(
        (policy) => policy.planId === planMetric.planId && policy.candidates.fallback.length > 0,
      )
    ) {
      pushGovernanceIssue(issueStore, {
        issueId: `issue-plan-fallback-${planMetric.planId}`,
        type: "missing_fallback",
        severity: "warning",
        title: `${planMetric.name ?? planMetric.planId} 回退压力偏高`,
        description:
          "方案的 fallback 信号偏高，且当前策略缺少稳定备用链路，建议补齐 fallback 候选。",
        relatedPlanIds: [planMetric.planId],
        relatedTaskProfileIds: planMetric.taskProfileId ? [planMetric.taskProfileId] : undefined,
        suggestedAction: "add_fallback",
      });
    }
  }
  if ((params.readModel?.missingCostEntries ?? 0) > 0) {
    pushGovernanceIssue(issueStore, {
      issueId: "issue-cost-spike-missing-attribution",
      type: "cost_spike",
      severity: "warning",
      title: `${params.readModel?.missingCostEntries ?? 0} 条记录缺少成本归因`,
      description: "模型成本覆盖仍不完整，Overview 与 Usage Analytics 只能给出近似值。",
      suggestedAction: "complete_metadata",
    });
  }
  for (const legacyIssue of legacyIssuesToGovernance(params.legacyModelsVM)) {
    pushGovernanceIssue(issueStore, legacyIssue);
  }
  return [...issueStore.values()];
}

function buildRecommendations(
  issues: ModelGovernanceIssue[],
  plans: ModelPlan[],
  policies: RoutingPolicy[],
) {
  return issues.slice(0, 6).map((issue, index) => ({
    id: `recommendation-${index + 1}`,
    title: issue.title,
    action:
      issue.suggestedAction === "add_fallback"
        ? "补齐 fallback 候选"
        : issue.suggestedAction === "bind_to_task_profile"
          ? "绑定到任务画像"
          : issue.suggestedAction === "review_policy"
            ? "审查路由策略"
            : issue.suggestedAction === "move_to_fallback"
              ? "降级为 fallback"
              : issue.suggestedAction === "promote_to_primary"
                ? "提升为主模型"
                : "补齐元数据",
    targetType: issue.relatedPlanIds?.[0]
      ? ("plan" as const)
      : issue.relatedTaskProfileIds?.[0]
        ? ("taskProfile" as const)
        : issue.relatedModelIds?.[0]
          ? ("model" as const)
          : ("policy" as const),
    targetId:
      issue.relatedPlanIds?.[0] ??
      issue.relatedTaskProfileIds?.[0] ??
      issue.relatedModelIds?.[0] ??
      policies[0]?.policyId ??
      plans[0]?.planId ??
      "platform-models",
    targetTab: issueTargetTab(issue),
    severity: issue.severity,
  }));
}

function actionPayload(
  input: Partial<PlatformModelsVM["governance"]["issues"][number]["context"]> & {
    suggestedModelId?: string;
    actionHint?: "replace_model" | "add_fallback" | "adjust_policy";
  },
) {
  return {
    ...(input.modelId ? { modelId: input.modelId } : {}),
    ...(input.planId ? { planId: input.planId } : {}),
    ...(input.taskProfileId ? { taskProfileId: input.taskProfileId } : {}),
    ...(input.policyId ? { policyId: input.policyId } : {}),
    ...(input.suggestedModelId ? { suggestedModelId: input.suggestedModelId } : {}),
    ...(input.actionHint ? { actionHint: input.actionHint } : {}),
  };
}

function buildGovernanceInsights(params: {
  assets: ModelAsset[];
  byModel: ModelUsageMetric[];
  byTask: TaskUsageMetric[];
  byPlan: PlanUsageMetric[];
  policies: RoutingPolicy[];
}): GovernanceInsight[] {
  const insights: GovernanceInsight[] = [];
  const totalCalls = params.byModel.reduce((sum, metric) => sum + metric.calls7d, 0);
  const totalCost = params.byModel.reduce((sum, metric) => sum + metric.cost7d, 0);
  const sortedByCalls = [...params.byModel].toSorted((left, right) => right.calls7d - left.calls7d);
  const sortedByCost = [...params.byModel].toSorted((left, right) => right.cost7d - left.cost7d);
  const overusedModel = sortedByCalls[0];
  if (overusedModel && totalCalls > 0) {
    const ratio = clampPercentage((overusedModel.calls7d / totalCalls) * 100);
    if (ratio >= 55) {
      const suggestedModelId = suggestedReplacementModelId(params.assets, overusedModel.modelId);
      insights.push({
        insightId: `insight-overused-${overusedModel.modelId}`,
        type: "model_overused",
        severity: ratio >= 68 ? "high" : "medium",
        title: `${overusedModel.modelId} 使用占比过高`,
        description: `最近 7 天调用占比 ${ratio}% ，系统可能对单一模型依赖过高。`,
        impact: {
          costSavingPotential: Number((overusedModel.cost7d * 0.18).toFixed(2)),
        },
        suggestion: suggestedModelId
          ? `将部分通用任务迁移到 ${suggestedModelId}，降低单模型依赖和整体成本。`
          : "将部分通用任务迁移到更低成本或更稳定的候选模型。",
        actions: [
          {
            actionId: `insight-overused-${overusedModel.modelId}:usage`,
            label: "查看使用分析",
            type: "go_to_usage",
            payload: actionPayload({ modelId: overusedModel.modelId }),
          },
          {
            actionId: `insight-overused-${overusedModel.modelId}:routing`,
            label: "调整路由策略",
            type: "adjust_policy",
            payload: actionPayload({
              modelId: overusedModel.modelId,
              suggestedModelId,
              actionHint: "adjust_policy",
            }),
            isPrimary: true,
          },
        ],
        relatedObjects: {
          modelIds: [overusedModel.modelId],
        },
      });
    }
  }

  const costlyModel = sortedByCost[0];
  if (costlyModel && totalCost > 0 && costlyModel.flags?.includes("high_cost")) {
    const share = clampPercentage((costlyModel.cost7d / totalCost) * 100);
    const suggestedModelId = suggestedReplacementModelId(params.assets, costlyModel.modelId);
    insights.push({
      insightId: `insight-cost-${costlyModel.modelId}`,
      type: "high_cost_inefficiency",
      severity: share >= 35 ? "high" : "medium",
      title: `${costlyModel.modelId} 成本效率偏低`,
      description: `最近 7 天成本占比 ${share}% ，成本贡献显著高于平均水平。`,
      impact: {
        costSavingPotential: Number((costlyModel.cost7d * 0.22).toFixed(2)),
      },
      suggestion: suggestedModelId
        ? `将部分任务迁移到 ${suggestedModelId}，优先降低通用文本和低复杂度请求成本。`
        : "优先评估更低成本的替代模型，降低通用任务的成本档位。",
      actions: [
        {
          actionId: `insight-cost-${costlyModel.modelId}:usage`,
          label: "查看使用分析",
          type: "go_to_usage",
          payload: actionPayload({ modelId: costlyModel.modelId }),
        },
        {
          actionId: `insight-cost-${costlyModel.modelId}:replace`,
          label: "降级主模型",
          type: "replace_model",
          payload: actionPayload({
            modelId: costlyModel.modelId,
            suggestedModelId,
            actionHint: "replace_model",
          }),
          isPrimary: true,
        },
      ],
      relatedObjects: {
        modelIds: [costlyModel.modelId],
      },
    });
  }

  const underusedAsset = params.assets.find(
    (asset) => (asset.usage7d?.calls ?? 0) <= 2 && asset.source === "configured",
  );
  if (underusedAsset) {
    insights.push({
      insightId: `insight-underused-${underusedAsset.modelId}`,
      type: "model_underutilized",
      severity: "low",
      title: `${underusedAsset.displayName} 使用偏低`,
      description: "该模型已纳入平台模型池，但最近 7 天几乎没有有效调用。",
      impact: {
        costSavingPotential: 0,
      },
      suggestion: "评估是否应将其降级为 fallback、移出推荐池，或绑定到更明确的任务方案。",
      actions: [
        {
          actionId: `insight-underused-${underusedAsset.modelId}:asset`,
          label: "查看模型资产",
          type: "go_to_model_asset",
          payload: actionPayload({ modelId: underusedAsset.modelId }),
          isPrimary: true,
        },
      ],
      relatedObjects: {
        modelIds: [underusedAsset.modelId],
      },
    });
  }

  for (const planMetric of params.byPlan.filter(
    (metric) =>
      metric.budgetStatus === "over_budget" ||
      (metric.flags?.includes("high_override") ?? false) ||
      (metric.flags?.includes("high_fallback") ?? false),
  )) {
    const relatedPolicy = params.policies.find((policy) => policy.planId === planMetric.planId);
    const suggestedModelId = suggestedReplacementModelId(
      params.assets,
      planMetric.modelDistribution?.[0]?.modelId,
    );
    insights.push({
      insightId: `insight-plan-${planMetric.planId}`,
      type: "plan_inefficiency",
      severity:
        planMetric.budgetStatus === "over_budget" || (planMetric.manualOverrideRate ?? 0) >= 12
          ? "high"
          : "medium",
      title: `${planMetric.name ?? planMetric.planId} 效率偏低`,
      description: `方案存在超预算、回退偏高或人工改配偏高的问题，需要收敛模型选择逻辑。`,
      impact: {
        costSavingPotential:
          planMetric.budget?.actualCostPerCall != null &&
          planMetric.budget?.targetCostPerCall != null
            ? Number(
                (
                  Math.max(
                    0,
                    planMetric.budget.actualCostPerCall - planMetric.budget.targetCostPerCall,
                  ) * Math.max(planMetric.calls7d, 1)
                ).toFixed(2),
              )
            : undefined,
      },
      suggestion: suggestedModelId
        ? `优先评估 ${suggestedModelId} 作为新的主模型或 fallback，降低方案整体成本与改配率。`
        : "优先调整主模型、fallback 和预算约束，降低方案整体成本与改配率。",
      actions: [
        {
          actionId: `insight-plan-${planMetric.planId}:task-plan`,
          label: "查看任务方案",
          type: "go_to_task_plan",
          payload: actionPayload({
            planId: planMetric.planId,
            taskProfileId: planMetric.taskProfileId,
            suggestedModelId,
            actionHint:
              (planMetric.flags?.includes("high_fallback") ?? false)
                ? "add_fallback"
                : "replace_model",
          }),
        },
        {
          actionId: `insight-plan-${planMetric.planId}:routing`,
          label: "调整路由策略",
          type: "adjust_policy",
          payload: actionPayload({
            planId: planMetric.planId,
            taskProfileId: planMetric.taskProfileId,
            policyId: relatedPolicy?.policyId,
            suggestedModelId,
            actionHint: "adjust_policy",
          }),
          isPrimary: true,
        },
      ],
      relatedObjects: {
        planIds: [planMetric.planId],
        policyIds: relatedPolicy ? [relatedPolicy.policyId] : undefined,
      },
    });
  }

  const missingCapabilityPolicy = params.policies.find(
    (policy) => policy.candidates.primary.length === 0,
  );
  if (missingCapabilityPolicy) {
    insights.push({
      insightId: `insight-capability-${missingCapabilityPolicy.policyId}`,
      type: "missing_capability",
      severity: "high",
      title: `${missingCapabilityPolicy.name} 缺少能力候选`,
      description: "当前策略没有主候选模型，说明系统在该类任务上的能力供给仍不完整。",
      impact: {
        successRateImprovement: 8,
      },
      suggestion: "补齐匹配该任务画像的模型能力，或将现有候选绑定到对应任务方案。",
      actions: [
        {
          actionId: `insight-capability-${missingCapabilityPolicy.policyId}:routing`,
          label: "查看路由策略",
          type: "go_to_routing",
          payload: actionPayload({
            policyId: missingCapabilityPolicy.policyId,
            taskProfileId: missingCapabilityPolicy.taskProfileId,
            planId: missingCapabilityPolicy.planId,
          }),
          isPrimary: true,
        },
      ],
      relatedObjects: {
        policyIds: [missingCapabilityPolicy.policyId],
        planIds: missingCapabilityPolicy.planId ? [missingCapabilityPolicy.planId] : undefined,
      },
    });
  }

  const ineffectiveFallbackPolicy = params.policies.find(
    (policy) => (policy.performance?.fallbackRate ?? 0) >= 16,
  );
  if (ineffectiveFallbackPolicy) {
    const suggestedModelId = suggestedReplacementModelId(
      params.assets,
      ineffectiveFallbackPolicy.candidates.primary[0],
    );
    insights.push({
      insightId: `insight-fallback-${ineffectiveFallbackPolicy.policyId}`,
      type: "fallback_ineffective",
      severity: "medium",
      title: `${ineffectiveFallbackPolicy.name} fallback 压力偏高`,
      description: `当前回退率 ${ineffectiveFallbackPolicy.performance?.fallbackRate ?? 0}% ，主模型稳定性或 fallback 设计可能不合理。`,
      impact: {
        successRateImprovement: 5,
      },
      suggestion: suggestedModelId
        ? `优先补充或替换为 ${suggestedModelId}，降低 fallback 命中压力。`
        : "优先补充更稳定的 fallback，或重新评估主模型。",
      actions: [
        {
          actionId: `insight-fallback-${ineffectiveFallbackPolicy.policyId}:routing`,
          label: "优化 fallback",
          type: "add_fallback",
          payload: actionPayload({
            policyId: ineffectiveFallbackPolicy.policyId,
            taskProfileId: ineffectiveFallbackPolicy.taskProfileId,
            planId: ineffectiveFallbackPolicy.planId,
            suggestedModelId,
            actionHint: "add_fallback",
          }),
          isPrimary: true,
        },
      ],
      relatedObjects: {
        policyIds: [ineffectiveFallbackPolicy.policyId],
        planIds: ineffectiveFallbackPolicy.planId ? [ineffectiveFallbackPolicy.planId] : undefined,
      },
    });
  }

  return insights;
}

function buildGovernanceRisks(params: {
  byModel: ModelUsageMetric[];
  byPlan: PlanUsageMetric[];
  policies: RoutingPolicy[];
}): GovernanceRisk[] {
  const risks: GovernanceRisk[] = [];
  const totalCalls = params.byModel.reduce((sum, metric) => sum + metric.calls7d, 0);
  const sortedByCalls = [...params.byModel].toSorted((left, right) => right.calls7d - left.calls7d);
  const sortedByCost = [...params.byModel].toSorted((left, right) => right.cost7d - left.cost7d);
  if (sortedByCalls[0] && totalCalls > 0) {
    const ratio = clampPercentage((sortedByCalls[0].calls7d / totalCalls) * 100);
    if (ratio >= 70) {
      risks.push({
        riskId: `risk-single-model-${sortedByCalls[0].modelId}`,
        severity: "high",
        title: "单模型依赖风险",
        description: `${ratio}% 的调用集中在 ${sortedByCalls[0].modelId}，一旦波动将直接影响整体稳定性。`,
        targetTab: "usageAnalytics",
        targetContext: { modelId: sortedByCalls[0].modelId },
      });
    }
  }
  const noFallbackCount = params.policies.filter(
    (policy) => policy.candidates.fallback.length === 0,
  ).length;
  if (noFallbackCount > 0) {
    risks.push({
      riskId: "risk-missing-fallback",
      severity: noFallbackCount >= 3 ? "high" : "medium",
      title: "无 fallback 风险",
      description: `${noFallbackCount} 条策略没有 fallback，一旦主模型失败会直接中断请求。`,
      targetTab: "smartRouting",
      targetContext: {},
    });
  }
  if (sortedByCost.length >= 3) {
    const totalCost = sortedByCost.reduce((sum, metric) => sum + metric.cost7d, 0);
    const top3Cost = sortedByCost.slice(0, 3).reduce((sum, metric) => sum + metric.cost7d, 0);
    const ratio = totalCost > 0 ? clampPercentage((top3Cost / totalCost) * 100) : 0;
    if (ratio >= 85) {
      risks.push({
        riskId: "risk-cost-concentration",
        severity: "high",
        title: "成本结构风险",
        description: `前 3 个模型占 ${ratio}% 成本，当前成本结构过于集中。`,
        targetTab: "usageAnalytics",
        targetContext: {},
      });
    }
  }
  const highOverridePlans = params.byPlan.filter(
    (plan) => (plan.manualOverrideRate ?? 0) >= 12,
  ).length;
  if (highOverridePlans > 0) {
    risks.push({
      riskId: "risk-high-override",
      severity: highOverridePlans >= 3 ? "high" : "medium",
      title: "人工改配偏高",
      description: `${highOverridePlans} 个方案存在明显人工改配，说明默认决策逻辑与实际需求不匹配。`,
      targetTab: "governance",
      targetContext: {},
    });
  }
  return risks;
}

export function buildModelGovernanceVM(input: PlatformModelsAdapterInput) {
  const assets = input.models ?? [];
  const byModel = input.usage?.byModel ?? input.usageByModel ?? [];
  const byTask = input.usage?.byTask ?? [];
  const byPlan = input.usage?.byPlan ?? input.usageByPlan ?? [];
  const policies = input.routingPolicies ?? [];
  const modelMetricById = new Map(byModel.map((metric) => [metric.modelId, metric]));
  const taskMetricById = new Map(byTask.map((metric) => [metric.taskProfileId, metric]));
  const planMetricById = new Map(byPlan.map((metric) => [metric.planId, metric]));
  const policyByTaskProfileId = new Map(policies.map((policy) => [policy.taskProfileId, policy]));
  const issues = sortGovernanceIssues(input.governanceIssues ?? []).map((issue) => {
    const targetTab = issueTargetTab(issue);
    const baseContext = issueTargetContext(issue);
    const context = {
      ...baseContext,
      ...(!baseContext.policyId &&
      (issue.type === "missing_fallback" || issue.type === "task_without_candidate") &&
      issue.relatedTaskProfileIds?.[0]
        ? {
            policyId: policyByTaskProfileId.get(issue.relatedTaskProfileIds[0])?.policyId,
          }
        : {}),
    };
    const modelMetric = issue.relatedModelIds?.[0]
      ? modelMetricById.get(issue.relatedModelIds[0])
      : undefined;
    const taskMetric = issue.relatedTaskProfileIds?.[0]
      ? taskMetricById.get(issue.relatedTaskProfileIds[0])
      : undefined;
    const planMetric = issue.relatedPlanIds?.[0]
      ? planMetricById.get(issue.relatedPlanIds[0])
      : undefined;
    const policy = context.policyId
      ? policies.find((candidate) => candidate.policyId === context.policyId)
      : context.taskProfileId
        ? policyByTaskProfileId.get(context.taskProfileId)
        : undefined;
    const suggestedModelId = suggestedReplacementModelId(assets, issue.relatedModelIds?.[0]);
    return {
      ...issue,
      targetTab,
      targetIds: [
        ...(issue.relatedModelIds ?? []),
        ...(issue.relatedTaskProfileIds ?? []),
        ...(issue.relatedPlanIds ?? []),
        ...(issue.relatedPolicyIds ?? []),
      ],
      context,
      metrics: {
        cost7d: modelMetric?.cost7d ?? planMetric?.cost7d,
        fallbackRate: modelMetric?.fallbackRate ?? planMetric?.fallbackRate,
        successRate: modelMetric?.successRate,
        overrideRate: taskMetric?.manualOverrideRate ?? planMetric?.manualOverrideRate,
      },
      rootCause: issueRootCause(issue, {
        taskMetric,
        planMetric,
        modelMetric,
        policy,
      }),
      suggestedActions: issueActions(issue, targetTab).map((action) => ({
        ...action,
        payload: {
          ...action.payload,
          ...(action.type === "replace_model" || action.type === "add_fallback"
            ? { suggestedModelId }
            : {}),
          ...(action.type === "replace_model"
            ? { actionHint: "replace_model" }
            : action.type === "add_fallback"
              ? { actionHint: "add_fallback" }
              : action.type === "adjust_policy"
                ? { actionHint: "adjust_policy" }
                : {}),
        },
      })),
      createdAt: Date.now(),
    };
  });
  const recommendations = buildRecommendations(
    issues,
    input.plans ?? [],
    input.routingPolicies ?? [],
  );
  const insights = buildGovernanceInsights({
    assets,
    byModel,
    byTask,
    byPlan,
    policies,
  });
  const risks = buildGovernanceRisks({
    byModel,
    byPlan,
    policies,
  });
  return {
    summary: {
      totalIssues: issues.length,
      criticalIssues: issues.filter((issue) => issue.severity === "critical").length,
      warningIssues: issues.filter((issue) => issue.severity === "warning").length,
      infoIssues: issues.filter((issue) => issue.severity === "info").length,
      highCostProblems: issues.filter(
        (issue) => issue.type === "cost_spike" || issue.type === "high_cost_low_usage",
      ).length,
      routingFailures: issues.filter(
        (issue) => issue.type === "missing_fallback" || issue.type === "task_without_candidate",
      ).length,
      highOverrideProblems: issues.filter((issue) => issue.type === "manual_override_high").length,
      modelIssues: issues.filter((issue) => (issue.relatedModelIds?.length ?? 0) > 0).length,
      taskProfileIssues: issues.filter((issue) => (issue.relatedTaskProfileIds?.length ?? 0) > 0)
        .length,
      planIssues: issues.filter((issue) => (issue.relatedPlanIds?.length ?? 0) > 0).length,
      policyIssues: issues.filter((issue) => (issue.relatedPolicyIds?.length ?? 0) > 0).length,
      recommendedActions: recommendations.length,
      optimizationInsights: insights.length,
      structuralRisks: risks.length,
    },
    insights,
    risks,
    assetOptimizations: insights.filter(
      (insight) => (insight.relatedObjects.modelIds?.length ?? 0) > 0,
    ),
    planOptimizations: insights.filter(
      (insight) => (insight.relatedObjects.planIds?.length ?? 0) > 0,
    ),
    policyOptimizations: insights.filter(
      (insight) => (insight.relatedObjects.policyIds?.length ?? 0) > 0,
    ),
    issues,
    recommendations,
    filters: {
      severities: uniqueStrings(issues.map((issue) => issue.severity)).filter(
        (value): value is "critical" | "warning" | "info" =>
          value === "critical" || value === "warning" || value === "info",
      ),
      issueTypes: uniqueStrings(issues.map((issue) => issue.type)).filter(
        (value): value is ModelGovernanceIssue["type"] =>
          [
            "high_cost_low_usage",
            "high_usage_high_failure",
            "unregistered_model_used",
            "task_without_candidate",
            "missing_fallback",
            "fallback_never_used",
            "cost_spike",
            "manual_override_high",
            "underused_model",
            "missing_capability_tag",
            "missing_price",
          ].includes(value),
      ),
      targetTabs: uniqueStrings(issues.map((issue) => issue.targetTab)).filter(
        (
          value,
        ): value is
          | "modelAssets"
          | "taskPlans"
          | "smartRouting"
          | "usageAnalytics"
          | "governance" =>
          value === "modelAssets" ||
          value === "taskPlans" ||
          value === "smartRouting" ||
          value === "usageAnalytics" ||
          value === "governance",
      ),
    },
    defaultSort: {
      field: "severity" as const,
      direction: "asc" as const,
    },
    ...(issues.length === 0
      ? {
          emptyState: {
            title: "暂无治理告警",
            description: "当前没有检测到需要处理的模型、任务方案或路由治理问题。",
            primaryActionLabel: "查看使用分析",
          },
        }
      : {}),
  };
}

function aggregateModelGovernance(
  issues: ModelGovernanceIssue[],
): Map<string, ModelAsset["governance"]> {
  const severityPriority: Record<
    Exclude<NonNullable<ModelAsset["governance"]>["highestSeverity"], undefined>,
    number
  > = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  const entries = new Map<string, ModelAsset["governance"]>();
  for (const issue of issues) {
    for (const modelId of issue.relatedModelIds ?? []) {
      const current = entries.get(modelId) ?? { issueCount: 0 };
      const nextSeverity =
        current.highestSeverity == null
          ? issue.severity
          : severityPriority[issue.severity] < severityPriority[current.highestSeverity]
            ? issue.severity
            : current.highestSeverity;
      entries.set(modelId, {
        issueCount: current.issueCount + 1,
        highestSeverity: nextSeverity,
      });
    }
  }
  return entries;
}

function aggregatePlanGovernance(
  issues: ModelGovernanceIssue[],
): Map<string, NonNullable<ModelPlan["governance"]>> {
  const severityPriority: Record<
    Exclude<NonNullable<ModelPlan["governance"]>["highestSeverity"], undefined>,
    number
  > = {
    critical: 0,
    warning: 1,
    info: 2,
  };
  const entries = new Map<string, NonNullable<ModelPlan["governance"]>>();
  for (const issue of issues) {
    for (const planId of issue.relatedPlanIds ?? []) {
      const current = entries.get(planId) ?? { issueCount: 0 };
      const nextSeverity =
        current.highestSeverity == null
          ? issue.severity
          : severityPriority[issue.severity] < severityPriority[current.highestSeverity]
            ? issue.severity
            : current.highestSeverity;
      entries.set(planId, {
        issueCount: current.issueCount + 1,
        highestSeverity: nextSeverity,
      });
    }
  }
  return entries;
}

const GOVERNANCE_TYPE_PRIORITY: Record<ModelGovernanceIssue["type"], number> = {
  task_without_candidate: 0,
  missing_fallback: 1,
  high_usage_high_failure: 2,
  cost_spike: 3,
  manual_override_high: 4,
  high_cost_low_usage: 5,
  unregistered_model_used: 6,
  fallback_never_used: 7,
  underused_model: 8,
  missing_capability_tag: 9,
  missing_price: 10,
  aor_execution_unmapped: 11,
  aor_no_policy_bindings: 12,
  aor_sync_degraded: 13,
};

const GOVERNANCE_SEVERITY_PRIORITY: Record<ModelGovernanceIssue["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

function sortGovernanceIssues(issues: ModelGovernanceIssue[]) {
  return [...issues].toSorted((left, right) => {
    const severityDelta =
      GOVERNANCE_SEVERITY_PRIORITY[left.severity] - GOVERNANCE_SEVERITY_PRIORITY[right.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return GOVERNANCE_TYPE_PRIORITY[left.type] - GOVERNANCE_TYPE_PRIORITY[right.type];
  });
}

function issueTargetTab(
  issue: ModelGovernanceIssue,
): "modelAssets" | "taskPlans" | "smartRouting" | "usageAnalytics" | "governance" {
  switch (issue.type) {
    case "missing_fallback":
    case "fallback_never_used":
      return "smartRouting";
    case "task_without_candidate":
      return "taskPlans";
    case "cost_spike":
    case "high_cost_low_usage":
      return "usageAnalytics";
    case "missing_price":
    case "missing_capability_tag":
    case "unregistered_model_used":
    case "underused_model":
      return "modelAssets";
    default:
      return "governance";
  }
}

function issueTargetContext(issue: ModelGovernanceIssue) {
  return {
    ...(issue.relatedModelIds?.[0] ? { modelId: issue.relatedModelIds[0] } : {}),
    ...(issue.relatedTaskProfileIds?.[0] ? { taskProfileId: issue.relatedTaskProfileIds[0] } : {}),
    ...(issue.relatedPlanIds?.[0] ? { planId: issue.relatedPlanIds[0] } : {}),
    ...(issue.relatedPolicyIds?.[0] ? { policyId: issue.relatedPolicyIds[0] } : {}),
  };
}

function governanceActionTarget(
  action: ModelIssueAction,
): "modelAssets" | "taskPlans" | "smartRouting" | "usageAnalytics" | "governance" | null {
  switch (action.type) {
    case "go_to_model_asset":
    case "replace_model":
      return "modelAssets";
    case "go_to_task_plan":
      return "taskPlans";
    case "go_to_routing":
    case "add_fallback":
    case "adjust_policy":
      return "smartRouting";
    case "go_to_usage":
      return "usageAnalytics";
    default:
      return null;
  }
}

function governanceActionContext(action: ModelIssueAction) {
  const payload = (action.payload ?? {}) as Record<string, string | undefined>;
  return {
    ...(payload.modelId ? { modelId: String(payload.modelId) } : {}),
    ...(payload.planId ? { planId: String(payload.planId) } : {}),
    ...(payload.taskProfileId ? { taskProfileId: String(payload.taskProfileId) } : {}),
    ...(payload.policyId ? { policyId: String(payload.policyId) } : {}),
    ...(payload.suggestedModelId ? { suggestedModelId: String(payload.suggestedModelId) } : {}),
    ...(typeof action.payload?.actionHint === "string"
      ? {
          actionHint: action.payload.actionHint as PlatformModelsTabContext["actionHint"],
        }
      : {}),
  };
}

function issueRootCause(
  issue: ModelGovernanceIssue,
  refs: {
    taskMetric?: TaskUsageMetric;
    planMetric?: PlanUsageMetric;
    modelMetric?: ModelUsageMetric;
    policy?: RoutingPolicy;
  },
) {
  switch (issue.type) {
    case "missing_fallback":
      return "当前主模型链没有可用备用模型，一旦主模型失败会直接把问题暴露给任务层。";
    case "task_without_candidate":
      return "任务画像缺少稳定候选模型，导致系统无法为该任务建立可靠的主路由。";
    case "high_usage_high_failure":
      return refs.modelMetric?.fallbackRate && refs.modelMetric.fallbackRate > 15
        ? "主模型成功率偏低，系统频繁进入 fallback 或直接失败。"
        : "该模型被高频调用，但成功率或稳定性已经低于可接受范围。";
    case "cost_spike":
      return refs.planMetric?.budget?.deviationRatio
        ? "方案的实际单次成本已经明显偏离目标预算，当前候选模型过重。"
        : "调用成本集中在少数模型或方案上，成本曲线已经偏离稳定区间。";
    case "manual_override_high":
      return "用户频繁手动改配模型，说明默认任务方案或路由结果没有命中预期。";
    case "high_cost_low_usage":
      return "该模型成本较高，但使用频次和覆盖任务不足，继续保留会抬高供给成本。";
    case "missing_price":
      return "资产缺少价格元数据，系统无法做准确的成本分析和预算控制。";
    case "missing_capability_tag":
      return "资产缺少能力标签，任务方案和路由很难判断它是否适合进入候选池。";
    case "unregistered_model_used":
      return "模型已经被引用或探测到，但尚未进入显式模型池，治理边界不完整。";
    case "fallback_never_used":
      return "备用链长期不生效，说明当前 fallback 设计可能不合理或没有真实覆盖价值。";
    case "underused_model":
      return "模型已经纳管但长期几乎没有进入有效调用路径。";
    default:
      return undefined;
  }
}

function modelRefMatches(asset: ModelAsset, currentModelId: string): boolean {
  const current = currentModelId.trim().toLowerCase();
  if (!current) {
    return false;
  }
  const tail = current.includes("/") ? current.slice(current.lastIndexOf("/") + 1) : current;
  const refs = [asset.modelId, asset.displayName, `${asset.providerId}/${asset.modelId}`]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());
  return refs.some((ref) => ref === current || ref === tail || ref.endsWith(`/${tail}`));
}

function suggestedReplacementModelId(assets: ModelAsset[], currentModelId?: string) {
  const candidates = assets
    .filter((asset) => !currentModelId || !modelRefMatches(asset, currentModelId))
    .filter((asset) => asset.source === "configured")
    .filter((asset) => asset.health !== "unavailable")
    .toSorted((left, right) => {
      const costOrder = { low: 0, medium: 1, high: 2, unknown: 3 };
      const costDelta = costOrder[left.costTier] - costOrder[right.costTier];
      if (costDelta !== 0) {
        return costDelta;
      }
      return (right.usage7d?.successRate ?? 0) - (left.usage7d?.successRate ?? 0);
    });
  return candidates[0]?.modelId;
}

function issueActions(
  issue: ModelGovernanceIssue,
  targetTab: "modelAssets" | "taskPlans" | "smartRouting" | "usageAnalytics" | "governance",
): ModelIssueAction[] {
  const context = issueTargetContext(issue);
  switch (issue.type) {
    case "missing_fallback":
      return [
        {
          actionId: `${issue.issueId}:fallback`,
          label: "添加 fallback",
          type: "add_fallback",
          payload: context,
          isPrimary: true,
        },
        {
          actionId: `${issue.issueId}:routing`,
          label: "查看路由链",
          type: "go_to_routing",
          payload: context,
        },
        {
          actionId: `${issue.issueId}:ignore`,
          label: "忽略",
          type: "mark_ignored",
          payload: context,
        },
      ];
    case "task_without_candidate":
      return [
        {
          actionId: `${issue.issueId}:task`,
          label: "查看任务方案",
          type: "go_to_task_plan",
          payload: context,
          isPrimary: true,
        },
        {
          actionId: `${issue.issueId}:routing`,
          label: "调整路由策略",
          type: "adjust_policy",
          payload: context,
        },
        {
          actionId: `${issue.issueId}:ignore`,
          label: "忽略",
          type: "mark_ignored",
          payload: context,
        },
      ];
    case "high_usage_high_failure":
      return [
        {
          actionId: `${issue.issueId}:usage`,
          label: "查看使用分析",
          type: "go_to_usage",
          payload: context,
        },
        {
          actionId: `${issue.issueId}:replace`,
          label: "替换为更稳定模型",
          type: "replace_model",
          payload: context,
          isPrimary: true,
        },
        {
          actionId: `${issue.issueId}:routing`,
          label: "调整路由策略",
          type: "adjust_policy",
          payload: context,
        },
      ];
    case "cost_spike":
    case "high_cost_low_usage":
      return [
        {
          actionId: `${issue.issueId}:usage`,
          label: "查看使用分析",
          type: "go_to_usage",
          payload: context,
        },
        {
          actionId: `${issue.issueId}:replace`,
          label: "替换为更低成本模型",
          type: "replace_model",
          payload: context,
          isPrimary: true,
        },
        {
          actionId: `${issue.issueId}:routing`,
          label: "调整路由策略",
          type: "adjust_policy",
          payload: context,
        },
      ];
    case "manual_override_high":
      return [
        {
          actionId: `${issue.issueId}:task`,
          label: "查看任务方案",
          type: "go_to_task_plan",
          payload: context,
        },
        {
          actionId: `${issue.issueId}:routing`,
          label: "调整路由策略",
          type: "adjust_policy",
          payload: context,
          isPrimary: true,
        },
        {
          actionId: `${issue.issueId}:usage`,
          label: "查看使用趋势",
          type: "go_to_usage",
          payload: context,
        },
      ];
    default:
      return [
        {
          actionId: `${issue.issueId}:target`,
          label: "前往处理",
          type:
            targetTab === "modelAssets"
              ? "go_to_model_asset"
              : targetTab === "taskPlans"
                ? "go_to_task_plan"
                : targetTab === "smartRouting"
                  ? "go_to_routing"
                  : "go_to_usage",
          payload: context,
          isPrimary: true,
        },
        {
          actionId: `${issue.issueId}:ignore`,
          label: "忽略",
          type: "mark_ignored",
          payload: context,
        },
      ];
  }
}

export function buildModelOverviewVM(input: PlatformModelsAdapterInput): ModelOverviewVM {
  const assets = input.models ?? [];
  const byModel = input.usage?.byModel ?? [];
  const byTask = input.usage?.byTask ?? [];
  const byPlan = input.usage?.byPlan ?? [];
  const issues = sortGovernanceIssues(input.governanceIssues ?? []);
  const governanceInsights = (input.governanceInsights ?? []).slice(0, 3);
  const governanceRisks = (input.governanceRisks ?? []).slice(0, 3);
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const totalCost = Number(byModel.reduce((sum, metric) => sum + metric.cost7d, 0).toFixed(2));
  const totalCalls = byModel.reduce((sum, metric) => sum + metric.calls7d, 0);
  const hasModelUsage = byModel.length > 0;
  const hasTaskUsage = byTask.length > 0;
  const routingHitRate = hasTaskUsage
    ? clampPercentage(
        100 -
          byTask.reduce((sum, metric) => sum + metric.failureRate, 0) / Math.max(byTask.length, 1),
      )
    : 0;
  const fallbackRate = hasModelUsage
    ? clampPercentage(
        byModel.reduce((sum, metric) => sum + metric.fallbackRate, 0) / Math.max(byModel.length, 1),
      )
    : 0;
  const manualOverrideRate =
    byTask.length > 0
      ? clampPercentage(
          byTask.reduce((sum, metric) => sum + (metric.manualOverrideRate ?? 0), 0) /
            Math.max(byTask.length, 1),
        )
      : undefined;
  const abnormalTaskCount = byTask.filter(
    (metric) => metric.failureRate > 15 || (metric.manualOverrideRate ?? 0) > 8,
  ).length;
  const topUsedModels = [...byModel]
    .toSorted((left, right) => right.calls7d - left.calls7d)
    .map((metric) => {
      const asset = assets.find((entry) => entry.modelId === metric.modelId) ?? null;
      return {
        modelId: metric.modelId,
        name: asset?.displayName ?? metric.modelId,
        providerName: asset?.providerId,
        calls: metric.calls7d,
        cost: metric.cost7d,
        successRate: metric.successRate,
      };
    });
  const topCostModels = [...byModel]
    .toSorted((left, right) => right.cost7d - left.cost7d)
    .map((metric) => {
      const asset = assets.find((entry) => entry.modelId === metric.modelId) ?? null;
      return {
        modelId: metric.modelId,
        name: asset?.displayName ?? metric.modelId,
        providerName: asset?.providerId,
        cost: metric.cost7d,
        calls: metric.calls7d,
        avgCostPerCall: metric.avgCostPerCall,
      };
    });
  const routingHealthStatus = deriveRoutingHealthStatus({
    routingHitRate,
    fallbackRate,
    manualOverrideRate,
    abnormalTaskCount,
  });
  const routingNotes: ModelOverviewVM["routingHealth"]["notes"] = [];
  if (byModel.length === 0) {
    routingNotes.push({
      type: "info",
      message: "使用数据未接入，Top Models 与平均请求成本暂时不可用。",
      targetTab: "usageAnalytics",
    });
  }
  if (byTask.length === 0) {
    routingNotes.push({
      type: "info",
      message: "路由观测未接入，当前 Routing Health 仅展示基础推导结果。",
      targetTab: "smartRouting",
    });
  }
  if (routingHitRate < 85) {
    routingNotes.push({
      type: routingHitRate < 70 ? "critical" : "warning",
      message: `主路由命中率为 ${routingHitRate}% ，需要检查任务方案与候选模型绑定。`,
      targetTab: "smartRouting",
    });
  }
  if (fallbackRate > 10) {
    routingNotes.push({
      type: fallbackRate > 20 ? "critical" : "warning",
      message: `fallback rate 为 ${fallbackRate}% ，路由正在频繁降级到备用模型。`,
      targetTab: "smartRouting",
    });
  }
  if ((manualOverrideRate ?? 0) > 8) {
    routingNotes.push({
      type: (manualOverrideRate ?? 0) > 15 ? "critical" : "warning",
      message: `人工改配率为 ${manualOverrideRate}% ，说明标准方案或自动路由未满足预期。`,
      targetTab: "taskPlans",
      targetContext: byTask.find((metric) => (metric.manualOverrideRate ?? 0) > 8)?.taskProfileId
        ? {
            taskProfileId: byTask.find((metric) => (metric.manualOverrideRate ?? 0) > 8)
              ?.taskProfileId,
          }
        : undefined,
    });
  }
  if (abnormalTaskCount > 0) {
    routingNotes.push({
      type: abnormalTaskCount >= 5 ? "critical" : "warning",
      message: `${abnormalTaskCount} 个任务画像存在异常表现或候选不足。`,
      targetTab: "governance",
      targetContext: byTask.find((metric) => metric.failureRate > 15)?.taskProfileId
        ? { taskProfileId: byTask.find((metric) => metric.failureRate > 15)?.taskProfileId }
        : undefined,
    });
  }
  if (routingNotes.length === 0) {
    routingNotes.push({
      type: "info",
      message: "路由命中、fallback 和人工改配指标都处于稳定区间。",
      targetTab: "smartRouting",
    });
  }
  const governancePreview = issues.slice(0, 5).map((issue) => ({
    issueId: issue.issueId,
    severity: issue.severity,
    title: issue.title,
    description: issue.description,
    suggestedAction: issue.suggestedAction,
    targetTab: issueTargetTab(issue),
    targetContext: issueTargetContext(issue),
  }));
  const primaryInsightAction = governanceInsights
    .flatMap((insight) => insight.actions.filter((action) => action.isPrimary))
    .find((action) => governanceActionTarget(action));
  const costTrendBase = totalCost / 7;
  const hitRateTrendBase = routingHitRate;
  const assetById = new Map(assets.map((asset) => [asset.modelId, asset]));
  const profileById = new Map(
    (input.taskProfiles ?? []).map((profile) => [profile.taskProfileId, profile]),
  );
  const planUsageById = new Map(byPlan.map((metric) => [metric.planId, metric]));
  const selectedPlan =
    (input.plans ?? []).find((plan) => plan.status === "published") ?? input.plans?.[0] ?? null;
  const selectedPolicy =
    (selectedPlan &&
      (input.routingPolicies ?? []).find((policy) => policy.planId === selectedPlan.planId)) ??
    input.routingPolicies?.[0] ??
    null;
  const selectedUsage = selectedPlan ? (planUsageById.get(selectedPlan.planId) ?? null) : null;
  const selectedProfile =
    selectedPlan && selectedPlan.taskProfileId
      ? (profileById.get(selectedPlan.taskProfileId) ?? null)
      : null;
  const modelLabel = (modelId: string) => {
    const asset = assetById.get(modelId);
    return {
      modelId,
      name: asset?.displayName ?? modelId,
      ...(asset?.providerId ? { providerName: asset.providerId } : {}),
    };
  };
  const constraints = selectedPolicy
    ? [
        selectedPolicy.constraints.maxCostPerRequest != null
          ? `成本上限：${formatCurrency(selectedPolicy.constraints.maxCostPerRequest)} / 请求`
          : null,
        selectedPolicy.constraints.maxLatencyMs != null
          ? `延迟目标：< ${selectedPolicy.constraints.maxLatencyMs}ms`
          : null,
        selectedPolicy.constraints.requiredHealth
          ? `健康要求：${selectedPolicy.constraints.requiredHealth === "healthy" ? "仅健康模型" : "排除不可用"}`
          : null,
        (selectedPolicy.constraints.requiredCapabilities?.length ?? 0) > 0
          ? `必需能力：${selectedPolicy.constraints.requiredCapabilities?.join(", ")}`
          : null,
      ].filter((entry): entry is string => Boolean(entry))
    : [];
  const policyScope = selectedPolicy
    ? [
        "平台默认策略",
        selectedPlan?.tenantOverrideAllowed ? "允许租户覆盖" : "平台统一控制",
        `决策目标：${selectedPolicy.ranking.mode}`,
      ]
    : [];
  const primaryModelId =
    selectedPolicy?.candidates.primary[0] ??
    selectedPlan?.primaryModelIds[0] ??
    topUsedModels[0]?.modelId ??
    "";
  const candidateModelIds =
    selectedPolicy?.candidates.primary ?? selectedPlan?.primaryModelIds ?? [];
  const fallbackModelIds =
    selectedPolicy?.candidates.fallback ?? selectedPlan?.fallbackModelIds ?? [];
  const rejectedModels =
    governancePreview
      .flatMap((issue) =>
        issue.targetContext?.modelId
          ? [{ modelId: issue.targetContext.modelId, reason: issue.title }]
          : [],
      )
      .slice(0, 2) ?? [];
  return {
    timeRange: {
      label: "最近 7 天",
      from: now - sevenDaysMs,
      to: now,
    },
    summary: {
      totalProviders: uniqueStrings([
        ...(input.providers?.map((entry) => entry.providerId) ?? []),
        ...assets.map((asset) => asset.providerId),
      ]).length,
      totalModels: assets.length,
      healthyModels: assets.filter((asset) => asset.health === "healthy").length,
      recommendationPoolSize: assets.filter((asset) => asset.inRecommendationPool).length,
      totalCalls7d: totalCalls,
      activeModels7d: byModel.filter((metric) => metric.calls7d > 0).length,
      cost7d: totalCost,
      avgCostPerRequest: Number((totalCost / Math.max(totalCalls, 1)).toFixed(4)),
      routingHitRate,
      fallbackRate,
      ...(manualOverrideRate != null ? { manualOverrideRate } : {}),
      highCostModelCount: byModel.filter((metric) => metric.flags?.includes("high_cost")).length,
      highFailureTaskCount: byTask.filter(
        (metric) =>
          metric.flags?.includes("low_success") ||
          (metric.hardFailureRate ?? metric.failureRate) >= 14,
      ).length,
      highFallbackPlanCount: byPlan.filter(
        (metric) => metric.flags?.includes("high_fallback") || (metric.fallbackRate ?? 0) >= 15,
      ).length,
    },
    ...(totalCost > 0 || hasTaskUsage
      ? {
          trends: {
            ...(totalCost > 0
              ? {
                  cost7d: Array.from({ length: 7 }, (_, index) => ({
                    timestamp: now - (6 - index) * 24 * 60 * 60 * 1000,
                    cost: Number((costTrendBase * (0.82 + index * 0.05)).toFixed(2)),
                  })),
                }
              : {}),
            ...(hasTaskUsage
              ? {
                  routingHitRate7d: Array.from({ length: 7 }, (_, index) => ({
                    timestamp: now - (6 - index) * 24 * 60 * 60 * 1000,
                    rate: clampPercentage(hitRateTrendBase - 4 + index * 0.8),
                  })),
                }
              : {}),
          },
        }
      : {}),
    topUsedModels,
    topCostModels,
    routingHealth: {
      status: routingHealthStatus,
      primaryHitRate: routingHitRate,
      fallbackRate,
      ...(manualOverrideRate != null ? { manualOverrideRate } : {}),
      abnormalTaskCount,
      notes: routingNotes,
    },
    governancePreview,
    optimizationHighlights: governanceInsights,
    structuralRisks: governanceRisks,
    quickActions: [
      primaryInsightAction
        ? {
            label: primaryInsightAction.label,
            targetTab: governanceActionTarget(primaryInsightAction) ?? "governance",
            intent:
              primaryInsightAction.type === "replace_model"
                ? ("review_routing" as const)
                : primaryInsightAction.type === "add_fallback"
                  ? ("review_routing" as const)
                  : ("fix_governance" as const),
            targetContext: governanceActionContext(primaryInsightAction),
          }
        : { label: "查看模型资产", targetTab: "modelAssets", intent: "add_model" },
      { label: "查看使用分析", targetTab: "usageAnalytics", intent: "view_usage" },
      { label: "检查智能路由", targetTab: "smartRouting", intent: "review_routing" },
      { label: "查看模型资产", targetTab: "modelAssets", intent: "add_model" },
      { label: "查看治理优化", targetTab: "governance", intent: "fix_governance" },
      {
        label: "处理异常",
        targetTab: "governance",
        intent: "fix_governance",
        targetContext: issues[0] ? issueTargetContext(issues[0]) : undefined,
      },
    ],
    routingWorkbench: {
      plans: (input.plans ?? []).slice(0, 6).map((plan) => {
        const usage = planUsageById.get(plan.planId);
        const callsShare =
          totalCalls > 0 && usage
            ? clampPercentage((usage.calls7d / Math.max(totalCalls, 1)) * 100)
            : 0;
        return {
          planId: plan.planId,
          name: plan.name,
          description: plan.description,
          callsShare,
          status: plan.status,
        };
      }),
      ...(selectedPlan && primaryModelId
        ? {
            selectedPlan: {
              planId: selectedPlan.planId,
              name: selectedPlan.name,
              description: selectedPlan.description,
              primaryModel: {
                ...modelLabel(primaryModelId),
                ...(selectedPolicy?.performance?.primaryHitRate != null
                  ? { hitRate: selectedPolicy.performance.primaryHitRate }
                  : {}),
              },
              candidates: candidateModelIds.slice(0, 4).map((modelId, index) => ({
                ...modelLabel(modelId),
                ratio:
                  selectedUsage?.modelDistribution?.find((entry) => entry.modelId === modelId)
                    ?.ratio ??
                  (index === 0 ? selectedPolicy?.performance?.primaryHitRate : undefined),
              })),
              fallbackChain: fallbackModelIds.slice(0, 3).map(modelLabel),
              constraints: constraints.length > 0 ? constraints : ["当前方案未配置额外约束"],
              policyScope: policyScope.length > 0 ? policyScope : ["平台默认策略"],
              decision: {
                selectedModelName: modelLabel(primaryModelId).name,
                selectedProvider: modelLabel(primaryModelId).providerName,
                cost:
                  selectedPolicy?.performance?.avgCostPerRequest ?? selectedUsage?.avgCostPerCall,
                latencyMs: selectedPolicy?.performance?.avgLatencyMs,
                reasons: [
                  selectedProfile
                    ? `满足 ${selectedProfile.requiredCapabilities.join(", ") || "通用能力"} 能力要求`
                    : "满足当前任务画像要求",
                  selectedPolicy?.constraints.maxCostPerRequest != null
                    ? `成本处于 ${formatCurrency(selectedPolicy.constraints.maxCostPerRequest)} 预算内`
                    : "成本处于平台策略范围内",
                  selectedPlan.fallbackModelIds.length > 0
                    ? "已配置 fallback 链路"
                    : "需要补充 fallback 链路",
                ],
                rejectedModels:
                  rejectedModels.length > 0
                    ? rejectedModels
                    : fallbackModelIds.slice(0, 2).map((modelId) => ({
                        modelId,
                        reason: "当前排序低于主模型",
                      })),
              },
            },
          }
        : {}),
      performance: {
        byPlan: byPlan.slice(0, 5).map((metric) => ({
          name:
            (input.plans ?? []).find((plan) => plan.planId === metric.planId)?.name ??
            metric.name ??
            metric.planId,
          ...(metric.fallbackRate != null ? { fallbackRate: metric.fallbackRate } : {}),
          ...(metric.manualOverrideRate != null
            ? { manualOverrideRate: metric.manualOverrideRate }
            : {}),
          ...(metric.avgCostPerCall != null ? { avgCostPerCall: metric.avgCostPerCall } : {}),
          hitRate: clampPercentage(100 - (metric.fallbackRate ?? 0)),
        })),
        byModel: topUsedModels.slice(0, 5).map((metric) => ({
          name: metric.name,
          calls: metric.calls,
          ...(metric.successRate != null ? { successRate: metric.successRate } : {}),
          ...(metric.cost != null && metric.calls > 0
            ? { avgCostPerCall: Number((metric.cost / metric.calls).toFixed(4)) }
            : {}),
          ...(byModel.find((entry) => entry.modelId === metric.modelId)?.fallbackRate != null
            ? {
                fallbackRate: byModel.find((entry) => entry.modelId === metric.modelId)
                  ?.fallbackRate,
              }
            : {}),
        })),
      },
    },
  };
}

export function buildModelAssetsVM(input: PlatformModelsAdapterInput) {
  const governanceIssues = sortGovernanceIssues(input.governanceIssues ?? []);
  const usageByModel = input.usageByModel ?? input.usage?.byModel ?? [];
  const usageMap = new Map(usageByModel.map((metric) => [metric.modelId, metric]));
  const governanceMap = aggregateModelGovernance(governanceIssues);
  const providerNameMap = new Map(
    (input.providers ?? []).map((provider) => [
      provider.providerId,
      provider.name ?? provider.providerId,
    ]),
  );
  const models = (input.models ?? []).map((asset) => {
    const usage = usageMap.get(asset.modelId);
    const governance = governanceMap.get(asset.modelId);
    return {
      ...asset,
      providerName: asset.providerName ?? providerNameMap.get(asset.providerId) ?? asset.providerId,
      usage7d: usage
        ? {
            calls: usage.calls7d,
            cost: usage.cost7d,
            successRate: usage.successRate,
            fallbackRate: usage.fallbackRate,
          }
        : undefined,
      governance,
    };
  });
  const summary = {
    totalModels: models.length,
    activeModels7d: models.filter((asset) => (asset.usage7d?.calls ?? 0) > 0).length,
    healthyModels: models.filter((asset) => asset.health === "healthy").length,
    degradedModels: models.filter((asset) => asset.health === "degraded").length,
    unavailableModels: models.filter((asset) => asset.health === "unavailable").length,
    recommendationPoolSize: models.filter((asset) => asset.inRecommendationPool).length,
    tenantSelectableModels: models.filter((asset) => asset.tenantSelectable).length,
  };
  const filters = {
    providers: uniqueStrings(models.map((asset) => asset.providerId)),
    modalities: uniqueStrings(
      models.flatMap((asset) => [...asset.inputModalities, ...asset.outputModalities]),
    ),
    capabilities: uniqueStrings(models.flatMap((asset) => asset.capabilities)),
    costTiers: uniqueStrings(models.map((asset) => asset.costTier)).filter(
      (value): value is "low" | "medium" | "high" | "unknown" =>
        value === "low" || value === "medium" || value === "high" || value === "unknown",
    ),
    healthStates: uniqueStrings(models.map((asset) => asset.health)).filter(
      (value): value is "healthy" | "degraded" | "unavailable" =>
        value === "healthy" || value === "degraded" || value === "unavailable",
    ),
    taskTags: uniqueStrings(models.flatMap((asset) => asset.taskTags)),
  };
  const defaultSort =
    usageByModel.length > 0
      ? ({ field: "calls7d", direction: "desc" } as const)
      : ({ field: "displayName", direction: "asc" } as const);
  return {
    summary,
    filters,
    models,
    defaultSort,
    ...(models.length === 0
      ? {
          emptyState: {
            title: "暂无已纳管模型资产",
            description:
              "仅展示配置目录、allowlist 与默认路由中已引用的模型。网关发现目录不会自动进入资产清单。",
            primaryActionLabel: "打开模型管理",
          },
        }
      : {}),
  };
}

export function buildModelTaskPlansVM(input: PlatformModelsAdapterInput) {
  const models = input.models ?? [];
  const configuredPlans = input.plans ?? buildConfiguredPlans(input.readModel ?? null);
  const taskProfiles = (
    input.taskProfiles?.length ? input.taskProfiles : buildConfiguredTaskProfiles(configuredPlans)
  ).map((profile) => ({
    ...profile,
    status: profile.status ?? "active",
  }));
  const basePlans = configuredPlans;
  const usageByPlan = input.usageByPlan ?? input.usage?.byPlan ?? [];
  const usageMap = new Map(usageByPlan.map((metric) => [metric.planId, metric]));
  const governanceIssues = sortGovernanceIssues(input.governanceIssues ?? []);
  const governanceMap = aggregatePlanGovernance(governanceIssues);
  const modelIds = new Set(models.map((model) => model.modelId));
  const plans = basePlans.map((plan) => {
    const usage = usageMap.get(plan.planId);
    const missingModelIds = [
      ...plan.primaryModelIds.filter((modelId) => !modelIds.has(modelId)),
      ...plan.fallbackModelIds.filter((modelId) => !modelIds.has(modelId)),
    ];
    return {
      ...plan,
      missingModelIds,
      usage7d: usage
        ? {
            calls: usage.calls7d,
            cost: usage.cost7d,
            ...(usage.fallbackRate != null ? { fallbackRate: usage.fallbackRate } : {}),
            ...(usage.manualOverrideRate != null
              ? { manualOverrideRate: usage.manualOverrideRate }
              : {}),
          }
        : undefined,
      governance: governanceMap.get(plan.planId),
      updatedAt: plan.updatedAt,
    };
  });
  const filters = {
    categories: Array.from(new Set(taskProfiles.map((profile) => profile.category))),
    priorityModes: Array.from(new Set(taskProfiles.map((profile) => profile.priorityMode))),
    audiences: Array.from(new Set(plans.map((plan) => plan.audience))),
    statuses: Array.from(new Set(plans.map((plan) => plan.status))),
    costTargets: Array.from(new Set(plans.map((plan) => plan.costTarget))),
    qualityTargets: Array.from(new Set(plans.map((plan) => plan.qualityTarget))),
    latencyTargets: Array.from(new Set(plans.map((plan) => plan.latencyTarget))),
  };
  return {
    summary: {
      totalTaskProfiles: taskProfiles.length,
      totalPlans: plans.length,
      publishedPlans: plans.filter((plan) => plan.status === "published").length,
      draftPlans: plans.filter((plan) => plan.status === "draft").length,
      deprecatedPlans: plans.filter((plan) => plan.status === "deprecated").length,
      userSelectablePlans: plans.filter((plan) => plan.userSelectable).length,
      tenantOverrideAllowedPlans: plans.filter((plan) => plan.tenantOverrideAllowed).length,
      plansMissingFallback: plans.filter((plan) => plan.fallbackModelIds.length === 0).length,
    },
    taskProfiles,
    plans,
    filters,
    defaultSort: { field: "updatedAt" as const, direction: "desc" as const },
    ...(taskProfiles.length === 0 && plans.length === 0
      ? {
          emptyState: {
            title: "暂无任务方案",
            description:
              "任务方案用于把底层模型能力包装为用户可理解的文字、图片、编程、视频等标准能力方案。",
            primaryActionLabel: "新建任务方案",
          },
        }
      : {}),
  };
}

function hasPlatformScope(policy: RoutingPolicy) {
  return (
    (policy.scope.tenantIds?.length ?? 0) === 0 &&
    (policy.scope.userSegments?.length ?? 0) === 0 &&
    (policy.scope.agentIds?.length ?? 0) === 0
  );
}

function buildRoutingConflicts(
  policies: RoutingPolicy[],
  assets: ModelAsset[],
): PlatformModelsVM["routing"]["conflicts"] {
  const conflicts: PlatformModelsVM["routing"]["conflicts"] = [];
  const activeGroups = new Map<string, string[]>();
  for (const policy of policies) {
    const groupKey = [
      policy.taskProfileId,
      hasPlatformScope(policy) ? "platform" : `tenant:${(policy.scope.tenantIds ?? []).join(",")}`,
      `segment:${(policy.scope.userSegments ?? []).join(",")}`,
      `agent:${(policy.scope.agentIds ?? []).join(",")}`,
    ].join("|");
    if (policy.status === "active") {
      activeGroups.set(groupKey, [...(activeGroups.get(groupKey) ?? []), policy.policyId]);
    }
    if (policy.status === "active" && policy.candidates.primary.length === 0) {
      conflicts.push({
        conflictId: `conflict-primary-${policy.policyId}`,
        policyId: policy.policyId,
        reason: "活跃策略缺少主模型候选，无法稳定完成任务命中。",
        severity: "critical",
        suggestedAction: "补齐主模型候选",
      });
    }
    if (policy.status === "active" && policy.candidates.fallback.length === 0) {
      conflicts.push({
        conflictId: `conflict-fallback-${policy.policyId}`,
        policyId: policy.policyId,
        reason: "活跃策略缺少 fallback 链，主模型异常时没有降级路径。",
        severity: "warning",
        suggestedAction: "补齐 fallback 链",
      });
    }
    if (
      policy.constraints.requiredCapabilities?.length &&
      !assets.some(
        (asset) =>
          policy.candidates.primary.concat(policy.candidates.fallback).includes(asset.modelId) &&
          policy.constraints.requiredCapabilities?.every((capability) =>
            asset.capabilities.includes(capability as never),
          ),
      )
    ) {
      conflicts.push({
        conflictId: `conflict-capability-${policy.policyId}`,
        policyId: policy.policyId,
        reason: "当前候选模型无法满足策略要求的能力标签。",
        severity: "critical",
        suggestedAction: "回到任务方案补齐候选模型",
      });
    }
    if (policy.constraints.maxCostPerRequest != null) {
      const candidateAssets = assets.filter((asset) =>
        policy.candidates.primary.concat(policy.candidates.fallback).includes(asset.modelId),
      );
      const cheapestCandidate = candidateAssets.reduce<number | null>((current, asset) => {
        const candidatePrice = (asset.inputPrice ?? 0) + (asset.outputPrice ?? 0);
        return current == null || candidatePrice < current ? candidatePrice : current;
      }, null);
      if (cheapestCandidate != null && cheapestCandidate > policy.constraints.maxCostPerRequest) {
        conflicts.push({
          conflictId: `conflict-cost-${policy.policyId}`,
          policyId: policy.policyId,
          reason: "成本约束可能低于所有候选模型的价格档位。",
          severity: "warning",
          suggestedAction: "放宽预算或更换低成本候选",
        });
      }
    }
    if (policy.constraints.requiredHealth === "healthy") {
      const unhealthyPrimary = assets.find(
        (asset) => policy.candidates.primary.includes(asset.modelId) && asset.health !== "healthy",
      );
      if (unhealthyPrimary) {
        conflicts.push({
          conflictId: `conflict-health-${policy.policyId}`,
          policyId: policy.policyId,
          reason: `主模型 ${unhealthyPrimary.displayName} 健康状态为 ${unhealthyPrimary.health}，不满足 healthy 约束。`,
          severity: "critical",
          suggestedAction: "替换主模型或降低健康约束",
        });
      }
    }
  }
  for (const [groupKey, policyIds] of activeGroups.entries()) {
    if (policyIds.length > 1) {
      for (const policyId of policyIds) {
        conflicts.push({
          conflictId: `conflict-scope-${groupKey}-${policyId}`,
          policyId,
          reason: "同一任务画像与作用范围存在多个 active policy，可能导致策略冲突。",
          severity: "warning",
          relatedPolicyIds: policyIds.filter((id) => id !== policyId),
          suggestedAction: "收敛重复激活策略",
        });
      }
    }
  }
  return conflicts;
}

export function buildModelRoutingVM(input: PlatformModelsAdapterInput) {
  const models = input.models ?? [];
  const fallbackPolicies = input.routingPolicies?.length
    ? input.routingPolicies
    : buildConfiguredRoutingPolicies(input.readModel ?? null);
  const usageByPolicy = new Map(
    (input.usageByPolicy ?? []).map((metric) => [metric.policyId, metric]),
  );
  const policies = fallbackPolicies.map((policy) => ({
    ...policy,
    performance: {
      ...policy.performance,
      ...usageByPolicy.get(policy.policyId),
    },
  }));
  const explanations = input.routingExplanations?.length ? input.routingExplanations : [];
  const conflicts = buildRoutingConflicts(policies, models);
  const averagePrimaryHitRateValues = policies
    .map((policy) => policy.performance?.primaryHitRate)
    .filter((value): value is number => value != null);
  const averageFallbackRateValues = policies
    .map((policy) => policy.performance?.fallbackRate)
    .filter((value): value is number => value != null);
  const manualOverrideRateValues = policies
    .map((policy) => policy.performance?.manualOverrideRate)
    .filter((value): value is number => value != null);
  return {
    summary: {
      totalPolicies: policies.length,
      activePolicies: policies.filter((policy) => policy.status === "active").length,
      draftPolicies: policies.filter((policy) => policy.status === "draft").length,
      disabledPolicies: policies.filter((policy) => policy.status === "disabled").length,
      policiesMissingFallback: policies.filter((policy) => policy.candidates.fallback.length === 0)
        .length,
      conflictsCount: conflicts.length,
      ...(averagePrimaryHitRateValues.length
        ? {
            averagePrimaryHitRate: clampPercentage(
              averagePrimaryHitRateValues.reduce((sum, value) => sum + value, 0) /
                averagePrimaryHitRateValues.length,
            ),
          }
        : {}),
      ...(averageFallbackRateValues.length
        ? {
            averageFallbackRate: clampPercentage(
              averageFallbackRateValues.reduce((sum, value) => sum + value, 0) /
                averageFallbackRateValues.length,
            ),
          }
        : {}),
      ...(manualOverrideRateValues.length
        ? {
            manualOverrideRate: clampPercentage(
              manualOverrideRateValues.reduce((sum, value) => sum + value, 0) /
                manualOverrideRateValues.length,
            ),
          }
        : {}),
    },
    policies,
    explanations,
    conflicts,
    filters: {
      taskProfileIds: uniqueStrings(policies.map((policy) => policy.taskProfileId)),
      planIds: uniqueStrings(policies.map((policy) => policy.planId)),
      statuses: uniqueStrings(policies.map((policy) => policy.status)).filter(
        (value): value is RoutingPolicy["status"] =>
          value === "active" || value === "draft" || value === "disabled",
      ),
      rankingModes: uniqueStrings(policies.map((policy) => policy.ranking.mode)).filter(
        (value): value is RoutingPolicy["ranking"]["mode"] =>
          value === "quality" || value === "cost" || value === "speed" || value === "balanced",
      ),
      scopeTypes: uniqueStrings(
        policies.flatMap((policy) => [
          hasPlatformScope(policy) ? "platform" : null,
          (policy.scope.tenantIds?.length ?? 0) > 0 ? "tenant" : null,
          (policy.scope.userSegments?.length ?? 0) > 0 ? "userSegment" : null,
          (policy.scope.agentIds?.length ?? 0) > 0 ? "agent" : null,
        ]),
      ).filter(
        (value): value is "platform" | "tenant" | "userSegment" | "agent" =>
          value === "platform" ||
          value === "tenant" ||
          value === "userSegment" ||
          value === "agent",
      ),
    },
    defaultSort: {
      field:
        averagePrimaryHitRateValues.length > 0
          ? ("primaryHitRate" as const)
          : ("updatedAt" as const),
      direction: "desc" as const,
    },
    ...(policies.length === 0
      ? {
          emptyState: {
            title: "暂无智能路由策略",
            description: "可先从任务方案生成默认路由策略，用于定义主模型、候选模型与 fallback 链。",
            primaryActionLabel: "前往任务方案",
          },
        }
      : {}),
  };
}

function resolveInput(input: unknown): PlatformModelsAdapterInput {
  const record = asRecord(input);
  if (!record) {
    return {};
  }
  const legacyModelsVM =
    (asRecord(record.legacyModelsVM) as LegacyModelsVM | null) ??
    (asRecord(record.models) as LegacyModelsVM | null) ??
    (typeof record.summary === "object" && "modeLabel" in record
      ? (record as unknown as LegacyModelsVM)
      : null);
  const readModel =
    (asRecord(record.readModel) as PlatformPortReadModel | null) ??
    (Array.isArray(record.modelDirectory) && Array.isArray(record.providerIds)
      ? (record as unknown as PlatformPortReadModel)
      : null);
  return {
    legacyModelsVM,
    readModel,
  };
}

export function buildPlatformModelsVM(input: unknown): PlatformModelsVM {
  const { legacyModelsVM = null, readModel = null } = resolveInput(input);
  const assets = buildAssets(legacyModelsVM, readModel);
  const { plans, policies, snapshotLoaded } = resolvePlansAndPolicies(readModel);
  const snapshot = readModel?.modelsManagementSnapshot ?? null;
  const taskProfiles =
    snapshotLoaded && snapshot?.taskProfiles?.length
      ? mapSnapshotTaskProfiles(snapshot)
      : buildConfiguredTaskProfiles(plans);
  const analyticsByModel = buildModelUsageMetrics(assets, readModel);
  const explanations = mapAorRoutingExplanations(readModel);
  const analyticsByTask =
    snapshotLoaded && snapshot?.usageByTask?.length
      ? mapSnapshotUsageByTask(snapshot, taskProfiles)
      : buildTaskUsageMetrics(taskProfiles, plans, analyticsByModel);
  const analyticsByPlan =
    snapshotLoaded && snapshot?.usageByPlan?.length
      ? mapSnapshotUsageByPlan(snapshot, analyticsByTask)
      : buildPlanUsageMetrics(plans, analyticsByTask);
  const governanceIssues = snapshotLoaded
    ? mergeGovernanceIssues(
        buildGovernanceIssues({
          assets,
          plans,
          policies,
          analyticsByModel,
          analyticsByTask,
          analyticsByPlan,
          readModel,
          legacyModelsVM,
        }),
        mapSnapshotGovernanceIssues(snapshot),
      )
    : buildGovernanceIssues({
        assets,
        plans,
        policies,
        analyticsByModel,
        analyticsByTask,
        analyticsByPlan,
        readModel,
        legacyModelsVM,
      });
  const sortedGovernanceIssues = sortGovernanceIssues(
    snapshotLoaded
      ? governanceIssues
      : mergeGovernanceIssues(governanceIssues, mapSnapshotGovernanceIssues(snapshot)),
  );
  const aor = readModel?.aor ?? readModel?.modelsManagementSnapshot?.aor;
  const governance = buildModelGovernanceVM({
    legacyModelsVM,
    readModel,
    models: assets,
    usage: {
      byModel: analyticsByModel,
      byTask: analyticsByTask,
      byPlan: analyticsByPlan,
    },
    plans,
    routingPolicies: policies,
    governanceIssues: sortedGovernanceIssues,
  });
  return {
    overview: buildModelOverviewVM({
      legacyModelsVM,
      readModel,
      models: assets,
      providers: uniqueStrings(assets.map((asset) => asset.providerId)).map((providerId) => ({
        providerId,
      })),
      usage: {
        byModel: analyticsByModel,
        byTask: analyticsByTask,
        byPlan: analyticsByPlan,
      },
      routingPolicies: policies,
      taskProfiles,
      plans,
      governanceIssues: sortedGovernanceIssues,
      governanceInsights: governance.insights,
      governanceRisks: governance.risks,
    }),
    assets: buildModelAssetsVM({
      legacyModelsVM,
      readModel,
      models: assets,
      usageByModel: analyticsByModel,
      governanceIssues: sortedGovernanceIssues,
    }),
    taskPlans: buildModelTaskPlansVM({
      legacyModelsVM,
      readModel,
      models: assets,
      taskProfiles,
      plans,
      usageByPlan: analyticsByPlan,
      governanceIssues: sortedGovernanceIssues,
    }),
    routing: buildModelRoutingVM({
      legacyModelsVM,
      readModel,
      models: assets,
      taskProfiles,
      plans,
      routingPolicies: policies,
      routingExplanations: explanations,
      usageByPolicy: (snapshot?.usageByPolicy ?? []).map((entry) => ({
        policyId: entry.policyId,
        primaryHitRate: entry.primaryHitRate,
        fallbackRate: entry.fallbackRate,
        manualOverrideRate: entry.manualOverrideRate,
        avgLatencyMs: entry.avgLatencyMs,
        avgCostPerRequest: entry.avgCostPerRequest,
      })),
      governanceIssues: sortedGovernanceIssues,
    }),
    analytics: buildModelUsageAnalyticsVM({
      legacyModelsVM,
      readModel,
      models: assets,
      usageByModel: analyticsByModel,
      usage: {
        byModel: analyticsByModel,
        byTask: analyticsByTask,
        byPlan: analyticsByPlan,
      },
      usageByPlan: analyticsByPlan,
    }) as ModelUsageAnalyticsVM,
    governance,
    platformModelsMode: readModel?.platformModelsMode ?? "native",
    modelsManagementLoading: readModel?.modelsManagementLoading,
    modelsManagementError: readModel?.modelsManagementError ?? null,
    modelsManagementSnapshotAt: readModel?.modelsManagementSnapshotAt ?? null,
    ...(aor ? { aor } : {}),
    context: {},
    compat: {
      legacyModelsVM,
    },
  };
}
