/**
 * Load platform scope and apply the pure capability decision to live candidates.
 * Personal BYOK and enterprise `ent/` models stay outside platform admission.
 * A model is platform-scoped only when it is in the resource catalog, an explicit
 * platform id list, or a stored admission row.
 */

import type { ModelCandidate } from "../../../agents/model-fallback.types.js";
import type { OpenBotConfig } from "../../../config/types.js";
import { listEnabledResourceCatalogModelIds } from "../../resource-catalog/list-enabled-model-ids.js";
import { isEnterpriseSuppliedModelId } from "../platform-model-connection.js";
import {
  decideRuntimeCapability,
  type RuntimeCapabilityDecision,
  type RuntimeDecisionCandidate,
  type RuntimeDecisionRequest,
  type RuntimeDecisionRole,
} from "./runtime-decision.js";
import { readStoredModelAdmissions } from "./store.js";
import { ensureExecutableAdmissionForAllowlistedConnections } from "./sync-pooled-admission.js";
import type { ModelAdmissionRecord } from "./types.js";

export type RuntimeAdmissionInput = RuntimeDecisionRequest & {
  role?: RuntimeDecisionRole;
  storePath?: string;
  catalogStorePath?: string;
  platformModelIds?: readonly string[];
  personalByokModelIds?: readonly string[];
  modelContextWindows?: Readonly<Record<string, number | null>>;
  healthByModelId?: Readonly<Record<string, string>>;
  costTierByModelId?: Readonly<Record<string, string>>;
  transientLimitedModelIds?: readonly string[];
  /**
   * When false, do not read the resource catalog. Explicit platform ids and
   * stored admission rows still count. Tests use this for a closed scope.
   */
  discoverPlatformScope?: boolean;
  /**
   * Config used to see which models are allowlisted (入池). When omitted, sync
   * loads the gateway config. Tests pass a closed config instead.
   */
  cfg?: OpenBotConfig;
  /** Probe store used to require status `ok` before writing a missing admission. */
  probeStorePath?: string;
  /**
   * When false, do not write an admission row for an allowlisted probe-ok model.
   * Default: sync when platform scope discovery is on, or when set true in tests.
   */
  syncPooledHealthyAdmission?: boolean;
};

export class PlatformAdmissionEmptyError extends Error {
  readonly code = "PLATFORM_ADMISSION_EMPTY" as const;
  readonly permanent: boolean;
  readonly decision: RuntimeCapabilityDecision;

  constructor(decision: RuntimeCapabilityDecision) {
    super(formatPlatformAdmissionEmptyMessage(decision));
    this.name = "PlatformAdmissionEmptyError";
    this.decision = decision;
    this.permanent = decision.degradation !== "transient_rate_limit";
  }
}

export function isPlatformAdmissionEmptyError(err: unknown): err is PlatformAdmissionEmptyError {
  if (err instanceof PlatformAdmissionEmptyError) {
    return true;
  }
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "PLATFORM_ADMISSION_EMPTY"
  );
}

export function formatPlatformAdmissionEmptyMessage(decision: RuntimeCapabilityDecision): string {
  const head =
    decision.degradation === "transient_rate_limit"
      ? "平台模型暂时限流，本次没有可调用候选。这不是永久失败。"
      : "平台准入没有可执行模型。不会改用已剔除或未授权的模型。";
  const details = decision.excluded
    .slice(0, 6)
    .map((item) => `${item.modelId}：${item.reason}（${item.code}）`)
    .join("；");
  return details ? `${head} ${details}` : head;
}

function candidateId(candidate: ModelCandidate): string {
  return `${candidate.provider}/${candidate.model}`;
}

function notEngaged(candidates: readonly ModelCandidate[]): {
  engaged: false;
  candidates: ModelCandidate[];
  decision: null;
} {
  return { engaged: false, candidates: [...candidates], decision: null };
}

/**
 * Allowlisted + probe-ok platform models with no admission row are not callable.
 * Write eligible once so the same turn can proceed. Existing rows stay as written.
 */
async function syncMissingAdmissionForPooledHealthyModels(params: {
  runtime: RuntimeAdmissionInput | undefined;
  records: Record<string, ModelAdmissionRecord>;
  platformScope: ReadonlySet<string>;
  candidates: readonly ModelCandidate[];
  personal: ReadonlySet<string>;
  storeUnreadable: boolean;
}): Promise<boolean> {
  const runtime = params.runtime;
  const shouldSync =
    runtime?.syncPooledHealthyAdmission === true ||
    (runtime?.syncPooledHealthyAdmission !== false && runtime?.discoverPlatformScope !== false);
  if (!shouldSync || params.storeUnreadable || params.platformScope.size === 0) {
    return false;
  }
  const missing = params.candidates.some((candidate) => {
    const modelId = candidateId(candidate);
    return (
      params.platformScope.has(modelId) && !params.personal.has(modelId) && !params.records[modelId]
    );
  });
  if (!missing) {
    return false;
  }
  try {
    const cfg = runtime?.cfg ?? (await import("../../../config/config.js")).loadConfig();
    await ensureExecutableAdmissionForAllowlistedConnections({
      cfg,
      storePath: runtime?.storePath,
      probeStorePath: runtime?.probeStorePath,
      limitToModelIds: params.platformScope,
      personalByokModelIds: runtime?.personalByokModelIds,
    });
    // Re-read even when this call inserted nothing: a concurrent writer may
    // have stored a pause that must win over the empty snapshot.
    return true;
  } catch {
    return false;
  }
}

export async function filterModelCandidatesByPlatformAdmission(params: {
  candidates: readonly ModelCandidate[];
  runtime?: RuntimeAdmissionInput;
}): Promise<{
  engaged: boolean;
  candidates: ModelCandidate[];
  decision: RuntimeCapabilityDecision | null;
}> {
  const runtime = params.runtime;
  const personal = new Set(
    (runtime?.personalByokModelIds ?? []).map((id) => id.trim()).filter(Boolean),
  );
  const explicitPlatform = (runtime?.platformModelIds ?? []).map((id) => id.trim()).filter(Boolean);
  let catalogIds: string[] = [];
  if (runtime?.discoverPlatformScope !== false) {
    try {
      const catalog = await listEnabledResourceCatalogModelIds(
        runtime?.catalogStorePath ? { storePath: runtime.catalogStorePath } : undefined,
      );
      catalogIds = catalog.modelIds;
    } catch {
      catalogIds = [];
    }
  }
  let records: Record<string, ModelAdmissionRecord> = {};
  let storeUnreadable = false;
  try {
    records = await readStoredModelAdmissions(runtime?.storePath);
  } catch {
    storeUnreadable = true;
    records = {};
  }
  const platformScope = new Set<string>();
  for (const id of [...explicitPlatform, ...catalogIds, ...Object.keys(records)]) {
    if (!id || isEnterpriseSuppliedModelId(id) || personal.has(id)) {
      continue;
    }
    platformScope.add(id);
  }
  const syncedAdmission = await syncMissingAdmissionForPooledHealthyModels({
    runtime,
    records,
    platformScope,
    candidates: params.candidates,
    personal,
    storeUnreadable,
  });
  if (syncedAdmission) {
    try {
      records = await readStoredModelAdmissions(runtime?.storePath);
    } catch {
      // Keep the rows already loaded. Losing them would fail the turn closed.
    }
  }
  if (platformScope.size === 0) {
    return notEngaged(params.candidates);
  }
  const transient = new Set(runtime?.transientLimitedModelIds ?? []);
  const decisionCandidates: RuntimeDecisionCandidate[] = [];
  for (const candidate of params.candidates) {
    const modelId = candidateId(candidate);
    const enterprise = isEnterpriseSuppliedModelId(modelId);
    const personalByok = personal.has(modelId);
    const platform = !enterprise && !personalByok && platformScope.has(modelId);
    decisionCandidates.push({
      modelId,
      scope: enterprise
        ? "enterprise_byok"
        : personalByok
          ? "personal_byok"
          : platform
            ? "platform"
            : "unscoped",
      health: runtime?.healthByModelId?.[modelId],
      costTier: runtime?.costTierByModelId?.[modelId],
      contextWindow: runtime?.modelContextWindows?.[modelId],
      transientLimited: transient.has(modelId),
      record: records[modelId] ?? null,
    });
  }
  const decision = decideRuntimeCapability({
    role: runtime?.role ?? "orchestrator",
    request: {
      taskText: runtime?.taskText,
      taskProfileId: runtime?.taskProfileId,
      outputType: runtime?.outputType,
      budget: runtime?.budget,
      requiredCapabilities: runtime?.requiredCapabilities,
      minContextWindow: runtime?.minContextWindow,
      configFingerprint: runtime?.configFingerprint,
      nowMs: runtime?.nowMs,
    },
    candidates: decisionCandidates,
    dryRun: false,
    storeUnreadable,
  });
  const allowed = new Set(decision.executableModelIds);
  return {
    engaged: true,
    candidates: params.candidates.filter((candidate) => allowed.has(candidateId(candidate))),
    decision,
  };
}

/**
 * Modality tool gate. Unscoped endpoints (no catalog row and no admission row)
 * are not platform-managed and are left to their own auth. In-scope models that
 * fail admission throw before any generation call.
 */
export async function assertExecutorModelAdmitted(params: {
  modelRef: string;
  outputType: "image" | "music";
  taskText?: string;
  storePath?: string;
  catalogStorePath?: string;
  platformModelIds?: readonly string[];
  configFingerprint?: string;
  nowMs?: number;
}): Promise<RuntimeCapabilityDecision | null> {
  const modelRef = params.modelRef.trim();
  const slash = modelRef.indexOf("/");
  if (
    !modelRef ||
    slash <= 0 ||
    slash === modelRef.length - 1 ||
    isEnterpriseSuppliedModelId(modelRef)
  ) {
    return null;
  }
  const filtered = await filterModelCandidatesByPlatformAdmission({
    candidates: [
      {
        provider: modelRef.slice(0, slash),
        model: modelRef.slice(slash + 1),
      },
    ],
    runtime: {
      role: "executor",
      outputType: params.outputType,
      taskText: params.taskText,
      storePath: params.storePath,
      catalogStorePath: params.catalogStorePath,
      platformModelIds: params.platformModelIds,
      configFingerprint: params.configFingerprint,
      nowMs: params.nowMs,
    },
  });
  if (!filtered.engaged || !filtered.decision) {
    return null;
  }
  if (!filtered.decision.executableModelIds.includes(modelRef)) {
    throw new PlatformAdmissionEmptyError(filtered.decision);
  }
  return filtered.decision;
}
