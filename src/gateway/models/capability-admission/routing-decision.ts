/**
 * Gateway routing decision preview (dry-run).
 * Uses platform-effective admission records; does not call generation models.
 */

import { normalizeCapabilityIds, verifiedCapabilityIds } from "./capability-ids.js";
import { getModelAdmission } from "./store.js";
import type {
  RoutingDecisionPreview,
  RoutingPreviewCandidate,
  RoutingPreviewExclusion,
  RoutingPreviewRequest,
} from "./types.js";

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
      "编程",
    ])
  ) {
    return "coding";
  }
  if (matchesAny(corpus, ["reason", "推理", "分析", "思考"])) {
    return "reasoning";
  }
  if (allowModalityFromText && matchesAny(corpus, ["audio", "语音", "听写", "音频理解"])) {
    return "audio_understanding";
  }
  if (corpus.trim()) {
    return "general_text";
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
  return "general_text";
}

export function detectTaskCategory(req: RoutingPreviewRequest): string {
  if (req.outputType === "image") {
    return "image_generation";
  }
  if (req.outputType === "music") {
    return "music_generation";
  }
  if (req.outputType === "audio") {
    return "audio_understanding";
  }
  const allowModalityFromText = req.outputType !== "text";
  const fromText = classifyFromTextCorpus(
    (req.taskText ?? "").toLowerCase(),
    allowModalityFromText,
  );
  if (fromText) {
    return fromText;
  }
  return constrainProfileFallback(req.taskProfileId, req.outputType);
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

function requiredForCategory(category: string) {
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

export async function previewRoutingDecision(params: {
  request: RoutingPreviewRequest;
  candidates: RoutingPreviewCandidate[];
  storePath?: string;
}): Promise<RoutingDecisionPreview> {
  const category = detectTaskCategory(params.request);
  const required = normalizeCapabilityIds([
    ...(params.request.requiredCapabilities ?? []),
    ...requiredForCategory(category),
  ]);
  const excluded: RoutingPreviewExclusion[] = [];
  const eligible: RoutingPreviewCandidate[] = [];
  const minContext = params.request.minContextWindow;

  for (const asset of params.candidates) {
    const admission = await getModelAdmission(asset.modelId, params.storePath);
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
    if (!budgetAllows(asset.costTier, params.request.budget)) {
      excluded.push({
        modelId: asset.modelId,
        reason: `预算 ${params.request.budget} 不匹配成本档 ${asset.costTier ?? "unknown"}`,
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
    requestId: `gpreview_${Date.now().toString(36)}`,
    taskCategory: category,
    executorPath: executorPathForCategory(category),
    selectedExecutor: selected ? `${executorPathForCategory(category)} · ${selected}` : null,
    selectedModelId: selected,
    primary,
    fallback,
    excluded,
    decisionReason: selected
      ? `按任务类别 ${category} 选择已验证且允许自动路由的模型（后端决策预览，干跑）`
      : `没有满足已验证能力要求的可路由模型（类别 ${category}；后端决策预览，干跑）`,
    dryRun: true,
    uiDemo: false,
    backendStatus: "wired",
    requiredCapabilities: required,
    ...(params.request.budget ? { budget: params.request.budget } : {}),
    ...(params.request.outputType ? { outputType: params.request.outputType } : {}),
  };
}
