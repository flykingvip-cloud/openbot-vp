/**
 * P0 — per-task capability plan inside an already-authorized model set.
 *
 * Authorization stays at `resolveEmployeeModelGate`. This module only:
 * - classifies the current task text (heuristic; not the sole source of truth
 *   for entitlement)
 * - builds an executable subset (context-insufficient models removed)
 * - emits a consumable plan (category, executor, primary/fallback, reasons,
 *   explicit failure) for chat / followup / subagent / Routine
 *
 * Classification must never expand the authorized set.
 */

export type TaskCategoryId =
  | "default"
  | "coding"
  | "coding.review"
  | "coding.refactor"
  | "summarization"
  | "reasoning"
  | "design.image"
  | "design.ui"
  | "design.interaction"
  | "design.review"
  | "audio.music_gen"
  | "audio.tts"
  | "audio.understanding"
  | "tool_use";

export type ExecutorKind =
  | "chat_model"
  | "image_generation"
  | "audio_music_generation"
  | "audio_tts"
  | "audio_understanding"
  | "composite";

export type CapabilityPlanFailure =
  | { kind: "none" }
  | { kind: "no_executable_candidates"; message: string }
  | { kind: "executor_unwired"; executor: ExecutorKind; message: string }
  | { kind: "unsupported"; message: string };

export type TaskCapabilityPlan = {
  categoryId: TaskCategoryId;
  executor: ExecutorKind;
  /** Copy of the authorized allowlist; never enlarged by classification. */
  authorizedModelIds: string[];
  /** Authorized models that can actually run this task (context + wiring). */
  executableModelIds: string[];
  primaryModelId?: string;
  fallbackModelIds: string[];
  /** Primary + fallbacks, all ⊆ executable ⊆ authorized. */
  preferredModelOrder: string[];
  reasons: string[];
  failure: CapabilityPlanFailure;
  classificationSource: "task_text" | "heuristic_default";
};

export type ClassifyTaskCapabilityResult = {
  categoryId: TaskCategoryId;
  executor: ExecutorKind;
  reasons: string[];
  classificationSource: TaskCapabilityPlan["classificationSource"];
};

const IMAGE_EXECUTOR_WIRED = false;
const AUDIO_MUSIC_WIRED = false;
const AUDIO_TTS_WIRED = false;
const AUDIO_UNDERSTANDING_WIRED = false;

type Rule = {
  categoryId: TaskCategoryId;
  executor: ExecutorKind;
  reason: string;
  pattern: RegExp;
};

/** Order matters: more specific rules first. */
const CLASSIFICATION_RULES: readonly Rule[] = [
  {
    categoryId: "design.review",
    executor: "chat_model",
    reason: "matched design review keywords",
    pattern: /设计评审|design\s*review|critique\s+(the\s+)?(ui|ux|design)|评审.*(交互|页面|设计)/i,
  },
  {
    categoryId: "design.interaction",
    executor: "composite",
    reason: "matched interaction-design keywords",
    pattern: /交互设计|interaction\s*design|user\s*flow|信息架构|prototype\s*flow/i,
  },
  {
    categoryId: "design.ui",
    executor: "composite",
    reason: "matched UI/page-design keywords",
    pattern:
      /页面设计|ui\s*design|ux\s*design|wireframe|网页设计|界面设计|landing\s*page\s*layout/i,
  },
  {
    categoryId: "design.image",
    executor: "image_generation",
    reason: "matched image/poster/illustration keywords",
    pattern:
      /海报|插画|画一(张|个)|生成(一张)?(图|海报|插画)|midjourney|dall-?e|stable\s*diffusion|generate\s+(an?\s+)?(image|poster|illustration)|draw\s+(an?\s+)?(image|poster)/i,
  },
  {
    categoryId: "audio.music_gen",
    executor: "audio_music_generation",
    reason: "matched music-generation keywords",
    pattern: /配乐|写(一段)?(音乐|配乐)|suno|soundtrack|generate\s+(a\s+)?(track|music|song)|作曲/i,
  },
  {
    categoryId: "audio.tts",
    executor: "audio_tts",
    reason: "matched speech-synthesis keywords",
    pattern:
      /念出来|朗读|语音合成|\btts\b|text[\s-]*to[\s-]*speech|read\s+(this|it)\s+(aloud|out)/i,
  },
  {
    categoryId: "audio.understanding",
    executor: "audio_understanding",
    reason: "matched audio-understanding keywords",
    pattern: /转写|听写|语音识别|transcribe|speech[\s-]*to[\s-]*text|audio\s*understand/i,
  },
  {
    categoryId: "coding.refactor",
    executor: "chat_model",
    reason: "matched coding.refactor keywords",
    pattern: /重构|refactor/i,
  },
  {
    categoryId: "coding.review",
    executor: "chat_model",
    reason: "matched coding.review keywords",
    pattern: /代码评审|code\s*review|review\s+(this\s+)?(pr|pull\s*request|diff|code)/i,
  },
  {
    categoryId: "coding",
    executor: "chat_model",
    reason: "matched coding keywords",
    pattern: /写代码|实现|编程|bug\b|fix\b|implement|coding|typescript|python|函数|接口/i,
  },
  {
    categoryId: "summarization",
    executor: "chat_model",
    reason: "matched summarization / long-text keywords",
    pattern: /总结|摘要|summariz|长文本|long\s*(context|text|document)|tl;?dr/i,
  },
  {
    categoryId: "reasoning",
    executor: "chat_model",
    reason: "matched reasoning keywords",
    pattern: /推理|分析一下|reason\s*step|chain[\s-]*of[\s-]*thought|\bcot\b/i,
  },
];

export function classifyTaskCapability(
  taskText: string | undefined | null,
): ClassifyTaskCapabilityResult {
  const text = typeof taskText === "string" ? taskText.trim() : "";
  if (!text) {
    return {
      categoryId: "default",
      executor: "chat_model",
      reasons: ["empty task text; heuristic_default"],
      classificationSource: "heuristic_default",
    };
  }
  for (const rule of CLASSIFICATION_RULES) {
    if (rule.pattern.test(text)) {
      return {
        categoryId: rule.categoryId,
        executor: rule.executor,
        reasons: [rule.reason],
        classificationSource: "task_text",
      };
    }
  }
  return {
    categoryId: "default",
    executor: "chat_model",
    reasons: ["no keyword match; heuristic_default"],
    classificationSource: "heuristic_default",
  };
}

export function estimateInputTokensFromText(taskText: string | undefined | null): number {
  const text = typeof taskText === "string" ? taskText : "";
  if (!text) {
    return 0;
  }
  // Rough mixed-language estimate: ~4 chars/token for ASCII-heavy, ~2 for CJK-heavy.
  const cjk = (text.match(/[\u3400-\u9fff]/g) ?? []).length;
  const other = Math.max(0, text.length - cjk);
  return Math.max(1, Math.ceil(cjk / 2 + other / 4));
}

export function filterExecutableModelIds(params: {
  authorizedModelIds: readonly string[];
  modelContextWindows?: Readonly<Record<string, number>>;
  estimatedInputTokens?: number;
}): { executableModelIds: string[]; excluded: Array<{ modelId: string; reason: string }> } {
  const estimated = Math.max(0, Math.floor(params.estimatedInputTokens ?? 0));
  const windows = params.modelContextWindows ?? {};
  const executableModelIds: string[] = [];
  const excluded: Array<{ modelId: string; reason: string }> = [];
  for (const modelId of params.authorizedModelIds) {
    const id = modelId.trim();
    if (!id) {
      continue;
    }
    const window = windows[id];
    if (
      estimated > 0 &&
      typeof window === "number" &&
      Number.isFinite(window) &&
      window > 0 &&
      window < estimated
    ) {
      excluded.push({
        modelId: id,
        reason: `contextWindow ${window} < estimatedInputTokens ${estimated}`,
      });
      continue;
    }
    executableModelIds.push(id);
  }
  return { executableModelIds, excluded };
}

function isExecutorWired(executor: ExecutorKind): boolean {
  switch (executor) {
    case "chat_model":
    case "composite":
      return true;
    case "image_generation":
      return IMAGE_EXECUTOR_WIRED;
    case "audio_music_generation":
      return AUDIO_MUSIC_WIRED;
    case "audio_tts":
      return AUDIO_TTS_WIRED;
    case "audio_understanding":
      return AUDIO_UNDERSTANDING_WIRED;
    default:
      return false;
  }
}

function orderWithinExecutable(
  preferredFromAor: readonly string[] | undefined,
  executableModelIds: readonly string[],
): string[] {
  const executableSet = new Set(executableModelIds);
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const id of preferredFromAor ?? []) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed) || !executableSet.has(trimmed)) {
      continue;
    }
    ordered.push(trimmed);
    seen.add(trimmed);
  }
  for (const id of executableModelIds) {
    if (seen.has(id)) {
      continue;
    }
    ordered.push(id);
    seen.add(id);
  }
  return ordered;
}

export function buildTaskCapabilityPlan(params: {
  taskText?: string | null;
  authorizedModelIds: readonly string[];
  /** AOR / gate order over the authorized set; filtered down to executable. */
  preferredModelOrderFromAuth?: readonly string[];
  modelContextWindows?: Readonly<Record<string, number>>;
  estimatedInputTokens?: number;
}): TaskCapabilityPlan {
  const authorizedModelIds = [
    ...new Set(params.authorizedModelIds.map((id) => id.trim()).filter((id) => id.length > 0)),
  ];
  const classification = classifyTaskCapability(params.taskText);
  const estimatedInputTokens =
    params.estimatedInputTokens !== undefined
      ? Math.max(0, Math.floor(params.estimatedInputTokens))
      : estimateInputTokensFromText(params.taskText);

  const { executableModelIds, excluded } = filterExecutableModelIds({
    authorizedModelIds,
    modelContextWindows: params.modelContextWindows,
    estimatedInputTokens,
  });

  const reasons = [...classification.reasons];
  if (estimatedInputTokens > 0) {
    reasons.push(`estimatedInputTokens=${estimatedInputTokens}`);
  }
  for (const row of excluded) {
    reasons.push(`excluded ${row.modelId}: ${row.reason}`);
  }

  let executor = classification.executor;
  let failure: CapabilityPlanFailure = { kind: "none" };

  if (!isExecutorWired(executor)) {
    failure = {
      kind: "executor_unwired",
      executor,
      message: `Executor ${executor} is not wired; degrading to chat_model within authorized set.`,
    };
    reasons.push(failure.message);
    executor = "chat_model";
  }

  if (executableModelIds.length === 0) {
    failure = {
      kind: "no_executable_candidates",
      message:
        authorizedModelIds.length === 0
          ? "Authorized model set is empty."
          : "No authorized model fits this task's context constraints.",
    };
    reasons.push(failure.message);
    return {
      categoryId: classification.categoryId,
      executor,
      authorizedModelIds,
      executableModelIds: [],
      fallbackModelIds: [],
      preferredModelOrder: [],
      reasons,
      failure,
      classificationSource: classification.classificationSource,
    };
  }

  const preferredModelOrder = orderWithinExecutable(
    params.preferredModelOrderFromAuth,
    executableModelIds,
  );
  const primaryModelId = preferredModelOrder[0];
  const fallbackModelIds = preferredModelOrder.slice(1);
  reasons.push(
    `primary=${primaryModelId}; fallbacks=${fallbackModelIds.length}; executable=${executableModelIds.length}/${authorizedModelIds.length}`,
  );

  return {
    categoryId: classification.categoryId,
    executor,
    authorizedModelIds,
    executableModelIds: [...executableModelIds],
    ...(primaryModelId ? { primaryModelId } : {}),
    fallbackModelIds,
    preferredModelOrder,
    reasons,
    failure,
    classificationSource: classification.classificationSource,
  };
}

/**
 * Maps a gate result (+ optional plan) onto runWithModelFallback inputs.
 * When a plan exists, the run allowlist becomes the executable set (not merely
 * a reorder of the full authorized set).
 */
export function resolveExecutionRoutingFromCapabilityPlan(params: {
  allowlist?: readonly string[];
  preferredModelOrder?: readonly string[];
  capabilityPlan?: TaskCapabilityPlan;
}): {
  allowlist?: string[];
  preferredModelOrder?: string[];
  capabilityPlan?: TaskCapabilityPlan;
} {
  const plan = params.capabilityPlan;
  if (!plan) {
    return {
      ...(params.allowlist !== undefined ? { allowlist: [...params.allowlist] } : {}),
      ...(params.preferredModelOrder !== undefined
        ? { preferredModelOrder: [...params.preferredModelOrder] }
        : {}),
    };
  }
  return {
    allowlist: [...plan.executableModelIds],
    ...(plan.preferredModelOrder.length > 0
      ? { preferredModelOrder: [...plan.preferredModelOrder] }
      : {}),
    capabilityPlan: plan,
  };
}
