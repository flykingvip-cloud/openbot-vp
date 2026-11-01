/**
 * Local UI demo for routing preview.
 * The live decision and the wired preview both come from the gateway.
 * This module does not call generation models. Demo results must stay labeled
 * as 界面演示，非后端决策.
 */

import { verifiedCapabilityIds } from "./capability-evidence.ts";
import { normalizeCapabilityIds, type CanonicalCapabilityId } from "./capability-ids.ts";
import { getModelAdmission, type AutoRoutingAdmission } from "./model-admission-store.ts";
import type { ModelAsset } from "./view-model.ts";

export type RoutingPreviewRequest = {
  taskText?: string;
  taskProfileId?: string;
  planId?: string;
  outputType?: "text" | "image" | "music" | "audio";
  budget?: "low" | "medium" | "high";
  /** Required verified capabilities for this task (legacy code/tools accepted). */
  requiredCapabilities?: string[];
  /** Optional minimum context window for the task. */
  minContextWindow?: number;
};

export type RoutingPreviewExclusion = {
  modelId: string;
  reason: string;
  code:
    | "capability_unverified"
    | "auto_routing_disabled"
    | "no_permission"
    | "context_insufficient"
    | "verification_expired"
    | "health"
    | "budget"
    | "other";
};

export type RoutingDecisionPreview = {
  requestId: string;
  taskCategory: string;
  executorPath: string;
  /** Actual selected executor model identity when available. */
  selectedExecutor?: string | null;
  selectedModelId: string | null;
  primary: string[];
  fallback: string[];
  excluded: RoutingPreviewExclusion[];
  decisionReason: string;
  /** Always dry-run: must not call generation models. */
  dryRun: true;
  /** True for local UI demo; false when produced via gateway admission RPC. */
  uiDemo: boolean;
  /** Optional backend wiring status when produced via service wrapper. */
  backendStatus?: "not_wired" | "ui_demo" | "wired";
  /** Normalized required capabilities used for this preview. */
  requiredCapabilities: CanonicalCapabilityId[];
  budget?: "low" | "medium" | "high";
  outputType?: "text" | "image" | "music" | "audio";
};

/**
 * Priority (UI demo only):
 * 1. Explicit modality outputType (image / music / audio) wins.
 * 2. Task text ONLY (CN + EN + mixed). Never mix taskProfileId into this corpus.
 *    When outputType === "text", do NOT promote image/music keywords from the text.
 * 3. Only if task text cannot be recognized, fall back to taskProfileId, else general_text.
 *    Profile fallback is still constrained by outputType: explicit text may keep
 *    coding / reasoning / general_text profiles, but image / music / audio profiles
 *    fall back to general_text (do not rewrite a text task into a modality category).
 */
function matchesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

const MODALITY_TASK_CATEGORIES = new Set([
  "image_generation",
  "music_generation",
  "audio_understanding",
]);

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
    ])
  ) {
    return "coding";
  }
  if (matchesAny(corpus, ["reason", "reasoning", "推理", "深度思考"])) {
    return "high_quality_reasoning";
  }
  return null;
}

/** Apply outputType constraints when falling back to a strategy profile. */
function constrainProfileFallback(
  profileId: string | undefined,
  outputType: RoutingPreviewRequest["outputType"],
): string {
  const profile = profileId?.trim() || "general_text";
  // Explicit text: keep text-compatible profiles (coding / reasoning / general_text…);
  // refuse modality profiles that would rewrite the task category.
  if (outputType === "text" && MODALITY_TASK_CATEGORIES.has(profile)) {
    return "general_text";
  }
  return profile;
}

function detectTaskCategory(req: RoutingPreviewRequest): string {
  // Priority 1: explicit modality output type.
  if (req.outputType === "image") {
    return "image_generation";
  }
  if (req.outputType === "music") {
    return "music_generation";
  }
  if (req.outputType === "audio") {
    return "audio_understanding";
  }

  // Priority 2: task text only — never concatenate taskProfileId here.
  const rawText = req.taskText ?? "";
  const textCorpus = `${rawText} ${rawText.toLowerCase()}`;
  const allowModalityFromText = req.outputType !== "text";
  const fromText = classifyFromTextCorpus(textCorpus, allowModalityFromText);
  if (fromText) {
    return fromText;
  }

  // Priority 3: strategy profile only when task text cannot be recognized.
  // Non-empty plain text must not be rewritten into image/music by a profile.
  const profileConstraint = (req.taskText ?? "").trim()
    ? (req.outputType ?? "text")
    : req.outputType;
  return constrainProfileFallback(req.taskProfileId, profileConstraint);
}

/** Exported for unit tests of Chinese / mixed classification. */
export function detectTaskCategoryForPreview(req: RoutingPreviewRequest): string {
  return detectTaskCategory(req);
}

function executorPathForCategory(category: string): string {
  if (category === "image_generation") {
    return "图片生成 · Stepfun";
  }
  if (category === "music_generation") {
    return "音乐生成 · Suno 兼容";
  }
  if (category === "audio_understanding") {
    return "音频理解（尚未接入）";
  }
  return "文本对话";
}

function requiredForCategory(category: string): CanonicalCapabilityId[] {
  if (category === "image_generation") {
    return ["image_generation"];
  }
  if (category === "music_generation") {
    return ["music_generation"];
  }
  if (category === "coding") {
    return ["coding"];
  }
  return normalizeCapabilityIds([]);
}

function budgetAllows(asset: ModelAsset, budget?: "low" | "medium" | "high"): boolean {
  if (!budget) {
    return true;
  }
  if (asset.costTier === "unknown") {
    return true;
  }
  if (budget === "low") {
    return asset.costTier === "low";
  }
  if (budget === "medium") {
    return asset.costTier === "low" || asset.costTier === "medium";
  }
  return true;
}

export function previewRoutingDecision(params: {
  request: RoutingPreviewRequest;
  candidates: ModelAsset[];
}): RoutingDecisionPreview {
  const category = detectTaskCategory(params.request);
  const required = normalizeCapabilityIds([
    ...(params.request.requiredCapabilities ?? []),
    ...requiredForCategory(category),
  ]);
  const excluded: RoutingPreviewExclusion[] = [];
  const eligible: ModelAsset[] = [];
  const minContext = params.request.minContextWindow;

  for (const asset of params.candidates) {
    const admission = getModelAdmission(asset.modelId);
    if (admission.autoRouting === "disabled" || admission.autoRouting === "paused") {
      excluded.push({
        modelId: asset.modelId,
        reason:
          admission.autoRoutingReason ??
          `自动路由${admission.autoRouting === "paused" ? "已暂停" : "未启用"}`,
        code: "auto_routing_disabled",
      });
      continue;
    }
    if (asset.health === "unavailable") {
      excluded.push({
        modelId: asset.modelId,
        reason: "运行健康不可用",
        code: "health",
      });
      continue;
    }
    if (!budgetAllows(asset, params.request.budget)) {
      excluded.push({
        modelId: asset.modelId,
        reason: `预算 ${params.request.budget} 不匹配成本档 ${asset.costTier}`,
        code: "budget",
      });
      continue;
    }
    if (
      minContext != null &&
      minContext > 0 &&
      (asset.contextWindow == null || asset.contextWindow < minContext)
    ) {
      excluded.push({
        modelId: asset.modelId,
        reason: `上下文不足：需要 ≥${minContext}，当前 ${asset.contextWindow ?? "未知"}`,
        code: "context_insufficient",
      });
      continue;
    }
    const verified = new Set(verifiedCapabilityIds(admission.capabilityEvidence));
    const expired = admission.capabilityEvidence.some((item) => item.status === "expired");
    if (expired && required.length > 0) {
      excluded.push({
        modelId: asset.modelId,
        reason: "能力验证已过期，需重新验证",
        code: "verification_expired",
      });
      continue;
    }
    const missing = required.filter((id) => !verified.has(id));
    if (missing.length > 0) {
      excluded.push({
        modelId: asset.modelId,
        reason: `能力未验证：${missing.join(", ")}`,
        code: "capability_unverified",
      });
      continue;
    }
    if (admission.autoRouting === "restricted") {
      excluded.push({
        modelId: asset.modelId,
        reason: admission.autoRoutingReason ?? "路由受限",
        code: "other",
      });
      continue;
    }
    eligible.push(asset);
  }

  const primary = eligible.slice(0, 1).map((a) => a.modelId);
  const fallback = eligible.slice(1, 4).map((a) => a.modelId);
  const selected = primary[0] ?? null;

  return {
    requestId: `preview_${Date.now().toString(36)}`,
    taskCategory: category,
    executorPath: executorPathForCategory(category),
    selectedExecutor: selected ? `${executorPathForCategory(category)} · ${selected}` : null,
    selectedModelId: selected,
    primary,
    fallback,
    excluded,
    decisionReason: selected
      ? `按任务类别 ${category} 选择已验证且允许自动路由的模型（界面演示，非后端决策）`
      : `没有满足已验证能力要求的可路由模型（类别 ${category}；界面演示，非后端决策）`,
    dryRun: true,
    uiDemo: true,
    requiredCapabilities: required,
    ...(params.request.budget ? { budget: params.request.budget } : {}),
    ...(params.request.outputType ? { outputType: params.request.outputType } : {}),
  };
}

export type { AutoRoutingAdmission };
