/**
 * Pure platform capability decision shared by admin preview and live execution.
 * Does not call generation models and does not write admission or success records.
 * Does not enable AOR. Authorization is an input: this function never adds a model.
 */

import { normalizeCapabilityIds } from "./capability-ids.js";
import type {
  CanonicalCapabilityId,
  CapabilityEvidenceItem,
  ModelAdmissionRecord,
  RoutingExclusionCode,
  RoutingPreviewRequest,
} from "./types.js";

export type TaskCategorySource = "output_type" | "task_text" | "profile_fallback" | "default";

export type ModelOwnershipScope = "platform" | "enterprise_byok" | "personal_byok" | "unscoped";

/** Chat orchestrator vs the modality executor (Stepfun / Suno-compatible tool). */
export type RuntimeDecisionRole = "orchestrator" | "executor";

export type RuntimeDegradation =
  | "none"
  | "transient_rate_limit"
  | "no_candidates"
  | "checker_unavailable"
  | "scope_not_engaged";

export type RuntimeDecisionCandidate = {
  modelId: string;
  scope: ModelOwnershipScope;
  health?: string;
  costTier?: string;
  contextWindow?: number | null;
  transientLimited?: boolean;
  /** Null means no stored row. A missing row is not verified evidence. */
  record: ModelAdmissionRecord | null;
};

export type RuntimeDecisionRequest = RoutingPreviewRequest & {
  configFingerprint?: string;
  nowMs?: number;
};

export type RuntimeExclusion = {
  modelId: string;
  reason: string;
  code: RoutingExclusionCode;
};

export type RuntimeCapabilityDecision = {
  role: RuntimeDecisionRole;
  taskCategory: string;
  taskCategorySource: TaskCategorySource;
  executorIdentity: string;
  executorPath: string;
  nativeMidjourneyClaimed: false;
  officialSunoCertified: false;
  aorInvoked: false;
  authorizedModelIds: string[];
  executableModelIds: string[];
  outOfScopeModelIds: string[];
  primary: string[];
  fallback: string[];
  excluded: RuntimeExclusion[];
  configVersion: string | null;
  evidenceVersion: string | null;
  degradation: RuntimeDegradation;
  dryRun: boolean;
  admissionEngaged: boolean;
  requiredCapabilities: CanonicalCapabilityId[];
  decisionReason: string;
};

const MODALITY_TASK_CATEGORIES = new Set([
  "image_generation",
  "music_generation",
  "audio_understanding",
]);

const TEXT_ORCHESTRATOR_CATEGORIES = new Set([
  "general_text",
  "text_chat",
  "coding",
  "reasoning",
  "high_quality_reasoning",
]);

function matchesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function classifyFromTextCorpus(corpus: string, allowModalityFromText: boolean): string | null {
  if (
    allowModalityFromText &&
    matchesAny(corpus, ["image", "midjourney", "海报", "配图", "图片", "画一张", "生成图"])
  ) {
    return "image_generation";
  }
  if (
    allowModalityFromText &&
    matchesAny(corpus, ["music", "suno", "配乐", "作曲", "歌曲", "音乐", "写首歌"])
  ) {
    return "music_generation";
  }
  if (
    matchesAny(corpus, [
      "code",
      "coding",
      "refactor",
      "unit test",
      "重构",
      "代码",
      "单元测试",
      "补充测试",
      "写测试",
      "编程",
    ])
  ) {
    return "coding";
  }
  if (matchesAny(corpus, ["reason", "reasoning", "推理", "深度思考", "分析", "思考"])) {
    return "reasoning";
  }
  if (allowModalityFromText && matchesAny(corpus, ["audio", "语音", "听写", "音频理解"])) {
    return "audio_understanding";
  }
  return null;
}

function constrainProfileFallback(
  taskProfileId: string | undefined,
  outputType: RoutingPreviewRequest["outputType"],
): string {
  const profile = (taskProfileId ?? "").trim().toLowerCase();
  if (!profile) {
    return "general_text";
  }
  if (outputType === "text" && MODALITY_TASK_CATEGORIES.has(profile)) {
    return "general_text";
  }
  if (profile.includes("image")) {
    return "image_generation";
  }
  if (profile.includes("music")) {
    return "music_generation";
  }
  if (profile.includes("audio")) {
    return "audio_understanding";
  }
  if (profile.includes("code") || profile.includes("coding")) {
    return "coding";
  }
  if (profile.includes("reason")) {
    return "reasoning";
  }
  return profile || "general_text";
}

export function resolveTaskCategory(req: RoutingPreviewRequest): {
  category: string;
  source: TaskCategorySource;
} {
  if (req.outputType === "image") {
    return { category: "image_generation", source: "output_type" };
  }
  if (req.outputType === "music") {
    return { category: "music_generation", source: "output_type" };
  }
  if (req.outputType === "audio") {
    return { category: "audio_understanding", source: "output_type" };
  }
  const fromText = classifyFromTextCorpus(
    (req.taskText ?? "").toLowerCase(),
    req.outputType !== "text",
  );
  if (fromText) {
    return { category: fromText, source: "task_text" };
  }
  const text = (req.taskText ?? "").trim();
  // Non-empty plain text must not be rewritten into image/music by a profile.
  const profileConstraint = text ? (req.outputType ?? "text") : req.outputType;
  const category = constrainProfileFallback(req.taskProfileId, profileConstraint);
  if ((req.taskProfileId ?? "").trim()) {
    return { category, source: "profile_fallback" };
  }
  return { category, source: "default" };
}

export function detectTaskCategory(req: RoutingPreviewRequest): string {
  return resolveTaskCategory(req).category;
}

function executorForCategory(category: string): { identity: string; path: string } {
  if (category === "image_generation") {
    return { identity: "stepfun_image", path: "图片生成 · Stepfun" };
  }
  if (category === "music_generation") {
    return { identity: "suno_compatible", path: "音乐生成 · Suno 兼容" };
  }
  if (category === "audio_understanding") {
    return { identity: "audio_understanding_unwired", path: "音频理解（尚未接入）" };
  }
  return { identity: "text_chat", path: "文本对话" };
}

function requiredForCategory(category: string, role: RuntimeDecisionRole): CanonicalCapabilityId[] {
  if (role === "orchestrator") {
    // Image/music artifacts are produced by the modality tool, not the chat model.
    // Coding stays a task category for routing labels, but the default protocol
    // runner never marks coding passed (specialized eval is not wired). Requiring
    // it here forever fail-closes every pooled + probe-ok chat model on coding
    // prompts. Treat coding like other text categories until a real checker lands.
    // Explicit request.requiredCapabilities: ["coding"] still enforces evidence.
    return normalizeCapabilityIds([]);
  }
  if (category === "image_generation") {
    return normalizeCapabilityIds(["image_generation"]);
  }
  if (category === "music_generation") {
    return normalizeCapabilityIds(["music_generation"]);
  }
  if (category === "coding") {
    return normalizeCapabilityIds(["coding"]);
  }
  return normalizeCapabilityIds([]);
}

function budgetAllows(costTier: string | undefined, budget?: "low" | "medium" | "high"): boolean {
  if (!budget) {
    return true;
  }
  const tier = costTier ?? "unknown";
  if (tier === "unknown") {
    return true;
  }
  if (budget === "low") {
    return tier === "low";
  }
  if (budget === "medium") {
    return tier === "low" || tier === "medium";
  }
  return true;
}

function legalQualityScore(score: number | undefined): boolean {
  return (
    score == null ||
    (typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 1)
  );
}

type EvidenceVerdict = "verified" | "expired" | "failed" | "checker_unavailable" | "unverified";

function verdictForEvidence(item: CapabilityEvidenceItem, nowMs: number): EvidenceVerdict {
  if (item.status === "failed") {
    return "failed";
  }
  if (item.status === "expired") {
    return "expired";
  }
  if (item.status === "checker_unavailable") {
    return "checker_unavailable";
  }
  if (item.status === "passed") {
    if (item.expiresAt != null && item.expiresAt <= nowMs) {
      return "expired";
    }
    if (item.source === "specialized_eval" && !legalQualityScore(item.qualityScore)) {
      return "unverified";
    }
    return "verified";
  }
  return "unverified";
}

function categoryAdmitted(
  record: ModelAdmissionRecord,
  category: string,
  role: RuntimeDecisionRole,
): boolean {
  const categories = record.autoRoutingTaskCategories ?? [];
  if (categories.length === 0) {
    return true;
  }
  if (categories.includes(category)) {
    return true;
  }
  if (
    role === "orchestrator" &&
    (category === "image_generation" || category === "music_generation")
  ) {
    return categories.some((entry) => TEXT_ORCHESTRATOR_CATEGORIES.has(entry));
  }
  return false;
}

function exclude(modelId: string, code: RoutingExclusionCode, reason: string): RuntimeExclusion {
  return { modelId, code, reason };
}

function evaluatePlatformCandidate(params: {
  candidate: RuntimeDecisionCandidate;
  category: string;
  role: RuntimeDecisionRole;
  required: CanonicalCapabilityId[];
  request: RuntimeDecisionRequest;
  nowMs: number;
}): RuntimeExclusion | null {
  const { candidate } = params;
  const record = candidate.record;
  if (!record) {
    return exclude(
      candidate.modelId,
      "no_admission_record",
      "没有平台准入记录，不能当作已验证或已允许自动路由",
    );
  }
  if (record.autoRouting === "disabled" || record.autoRouting === "paused") {
    return exclude(
      candidate.modelId,
      "auto_routing_disabled",
      record.autoRoutingReason ??
        `自动路由${record.autoRouting === "paused" ? "已暂停" : "未启用"}`,
    );
  }
  if (
    params.request.configFingerprint &&
    record.connectionFingerprint &&
    params.request.configFingerprint !== record.connectionFingerprint
  ) {
    return exclude(
      candidate.modelId,
      "evidence_fingerprint_mismatch",
      "配置指纹与准入证据不一致，旧证据只保留为历史",
    );
  }
  if (candidate.transientLimited) {
    return exclude(candidate.modelId, "transient_rate_limit", "临时限流，本次跳过，不是永久失败");
  }
  const health = (candidate.health ?? "").trim().toLowerCase();
  if (health === "unavailable" || health === "down" || health === "unhealthy") {
    return exclude(candidate.modelId, "health", "运行健康不可用");
  }
  if (!budgetAllows(candidate.costTier, params.request.budget)) {
    return exclude(
      candidate.modelId,
      "budget",
      `预算 ${params.request.budget} 不匹配成本档 ${candidate.costTier ?? "unknown"}`,
    );
  }
  const minContext = params.request.minContextWindow;
  if (
    minContext != null &&
    minContext > 0 &&
    (candidate.contextWindow == null || candidate.contextWindow < minContext)
  ) {
    return exclude(
      candidate.modelId,
      "context_insufficient",
      `上下文不足：需要 ≥${minContext}，当前 ${candidate.contextWindow ?? "未知"}`,
    );
  }
  if (!categoryAdmitted(record, params.category, params.role)) {
    return exclude(
      candidate.modelId,
      "category_not_admitted",
      `自动路由未开放任务类别 ${params.category}`,
    );
  }
  if (record.autoRouting === "restricted") {
    return exclude(
      candidate.modelId,
      "auto_routing_restricted",
      record.autoRoutingReason ?? "路由受限",
    );
  }
  if (params.required.length === 0) {
    return null;
  }
  const verdicts = new Map<CanonicalCapabilityId, EvidenceVerdict>();
  for (const item of record.capabilityEvidence) {
    verdicts.set(item.id, verdictForEvidence(item, params.nowMs));
  }
  for (const id of params.required) {
    const verdict = verdicts.get(id) ?? "unverified";
    if (verdict === "verified") {
      continue;
    }
    if (verdict === "expired") {
      return exclude(candidate.modelId, "verification_expired", "能力验证已过期，需重新验证");
    }
    if (verdict === "failed") {
      return exclude(candidate.modelId, "capability_failed", `能力验证失败：${id}`);
    }
    if (verdict === "checker_unavailable") {
      return exclude(
        candidate.modelId,
        "checker_unavailable",
        `能力检查器不可用：${id}（不是验证成功）`,
      );
    }
    return exclude(candidate.modelId, "capability_unverified", `能力未验证：${id}`);
  }
  const anyExpired = record.capabilityEvidence.some(
    (item) => verdictForEvidence(item, params.nowMs) === "expired",
  );
  if (anyExpired) {
    return exclude(candidate.modelId, "verification_expired", "能力验证已过期，需重新验证");
  }
  return null;
}

function versionsFrom(records: ModelAdmissionRecord[]): {
  configVersion: string | null;
  evidenceVersion: string | null;
} {
  const fingerprints = [
    ...new Set(
      records
        .map((record) => record.connectionFingerprint)
        .filter((value): value is string => Boolean(value)),
    ),
  ].toSorted((a, b) => a.localeCompare(b));
  const evidence = [
    ...new Set(
      records.flatMap((record) =>
        record.capabilityEvidence
          .map((item) => item.testVersion)
          .filter((value): value is string => Boolean(value)),
      ),
    ),
  ].toSorted((a, b) => a.localeCompare(b));
  const updated = records.reduce((max, record) => Math.max(max, record.updatedAt || 0), 0);
  return {
    configVersion: fingerprints.length > 0 ? fingerprints.join(",") : null,
    evidenceVersion:
      evidence.length > 0 ? evidence.join(",") : updated > 0 ? `updatedAt:${updated}` : null,
  };
}

export function decideRuntimeCapability(params: {
  role: RuntimeDecisionRole;
  request: RuntimeDecisionRequest;
  candidates: readonly RuntimeDecisionCandidate[];
  dryRun: boolean;
  /** When the store cannot be read, platform-scoped ids fail closed. */
  storeUnreadable?: boolean;
}): RuntimeCapabilityDecision {
  const resolved = resolveTaskCategory(params.request);
  const required = normalizeCapabilityIds([
    ...(params.request.requiredCapabilities ?? []),
    ...requiredForCategory(resolved.category, params.role),
  ]);
  const executor = executorForCategory(resolved.category);
  const nowMs = params.request.nowMs ?? Date.now();
  const excluded: RuntimeExclusion[] = [];
  const executable: string[] = [];
  const outOfScope: string[] = [];
  const usedRecords: ModelAdmissionRecord[] = [];
  const seen = new Set<string>();

  for (const candidate of params.candidates) {
    const modelId = candidate.modelId.trim();
    if (!modelId || seen.has(modelId)) {
      continue;
    }
    seen.add(modelId);
    if (candidate.scope !== "platform") {
      outOfScope.push(modelId);
      executable.push(modelId);
      continue;
    }
    if (params.storeUnreadable) {
      excluded.push(
        exclude(modelId, "admission_store_unreadable", "平台准入存储不可读，拒绝调用该平台模型"),
      );
      continue;
    }
    if (candidate.record) {
      usedRecords.push(candidate.record);
    }
    const rejection = evaluatePlatformCandidate({
      candidate: { ...candidate, modelId },
      category: resolved.category,
      role: params.role,
      required,
      request: params.request,
      nowMs,
    });
    if (rejection) {
      excluded.push(rejection);
      continue;
    }
    executable.push(modelId);
  }

  const primary = executable.slice(0, 1);
  const fallback = executable.slice(1, 4);
  const versions = versionsFrom(usedRecords);
  const onlyTransient =
    executable.length === 0 &&
    excluded.length > 0 &&
    excluded.every((item) => item.code === "transient_rate_limit");
  const checkerBlocked =
    executable.length === 0 && excluded.some((item) => item.code === "checker_unavailable");
  const degradation: RuntimeDegradation =
    executable.length === 0
      ? onlyTransient
        ? "transient_rate_limit"
        : checkerBlocked
          ? "checker_unavailable"
          : "no_candidates"
      : "none";
  const selected = primary[0] ?? null;
  const decisionReason = selected
    ? `按任务类别 ${resolved.category}（来源 ${resolved.source}）选择可执行模型；执行器 ${executor.path}`
    : `没有可执行候选（类别 ${resolved.category}；来源 ${resolved.source}；执行器 ${executor.path}）`;

  return {
    role: params.role,
    taskCategory: resolved.category,
    taskCategorySource: resolved.source,
    executorIdentity: executor.identity,
    executorPath: executor.path,
    nativeMidjourneyClaimed: false,
    officialSunoCertified: false,
    aorInvoked: false,
    authorizedModelIds: params.candidates
      .map((candidate) => candidate.modelId.trim())
      .filter(Boolean),
    executableModelIds: executable,
    outOfScopeModelIds: outOfScope,
    primary,
    fallback,
    excluded,
    configVersion: versions.configVersion,
    evidenceVersion: versions.evidenceVersion,
    degradation,
    dryRun: params.dryRun,
    admissionEngaged: true,
    requiredCapabilities: required,
    decisionReason,
  };
}

export function isExcludedModel(decision: RuntimeCapabilityDecision, modelId: string): boolean {
  return decision.excluded.some((item) => item.modelId === modelId);
}
