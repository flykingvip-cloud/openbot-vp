/**
 * Task routing decision preview (frontend UI demo stub).
 * Interface demonstration only — NOT a backend routing decision.
 * Default does NOT call generation models.
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
  /** Required verified capabilities for this task. */
  requiredCapabilities?: string[];
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
    | "other";
};

export type RoutingDecisionPreview = {
  requestId: string;
  taskCategory: string;
  executorPath: string;
  selectedModelId: string | null;
  primary: string[];
  fallback: string[];
  excluded: RoutingPreviewExclusion[];
  decisionReason: string;
  /** Stub marker: UI must label as 界面演示，非后端决策. */
  dryRun: true;
  /** Explicit demo flag — never claim backend decision. */
  uiDemo: true;
};

function detectTaskCategory(req: RoutingPreviewRequest): string {
  const text =
    `${req.taskText ?? ""} ${req.taskProfileId ?? ""} ${req.outputType ?? ""}`.toLowerCase();
  if (req.outputType === "image" || text.includes("image") || text.includes("midjourney")) {
    return "image_generation";
  }
  if (req.outputType === "music" || text.includes("music") || text.includes("suno")) {
    return "music_generation";
  }
  if (text.includes("code") || text.includes("coding")) {
    return "coding";
  }
  if (text.includes("reason")) {
    return "high_quality_reasoning";
  }
  return req.taskProfileId?.trim() || "general_text";
}

function executorPathForCategory(category: string): string {
  if (category === "image_generation") {
    return "图片生成 · Stepfun";
  }
  if (category === "music_generation") {
    return "音乐生成 · Suno 兼容";
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

  return {
    requestId: `preview_${Date.now().toString(36)}`,
    taskCategory: category,
    executorPath: executorPathForCategory(category),
    selectedModelId: primary[0] ?? null,
    primary,
    fallback,
    excluded,
    decisionReason: primary[0]
      ? `按任务类别 ${category} 选择已验证且允许自动路由的模型（界面演示，非后端决策）`
      : `没有满足已验证能力要求的可路由模型（类别 ${category}；界面演示，非后端决策）`,
    dryRun: true,
    uiDemo: true,
  };
}

export type { AutoRoutingAdmission };
