/**
 * Per-task capability plan inside an already-authorized model set.
 *
 * Authorization stays at `resolveEmployeeModelGate`. This module only:
 * - classifies the current task text (heuristic; not the sole source of truth
 *   for entitlement)
 * - builds an executable subset (context-insufficient models removed)
 * - emits a consumable plan (category, executor, primary/fallback, reasons,
 *   explicit failure) for chat / followup / subagent / Routine
 *
 * Classification must never expand the authorized set.
 *
 * P1: task-driven category feeds AOR scoring; full context estimate
 * (history/system/tools/attachments/output reserve); parent quality inheritance
 * lives in `@openbot/aor-core` `qualityFor`; executor_unwired propagates to
 * outcome claims so chat replies cannot be recorded as image/music success.
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
  /** Token estimate used for executable filtering (input + output reserve). */
  contextEstimate?: ContextEstimateResult;
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

const DEFAULT_OUTPUT_RESERVE_TOKENS = 1024;

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

/** Context part whose tokens could not be observed at the call site. */
export type ContextEstimateUnknownPart = "history" | "systemPrompt" | "tools" | "attachments";

/** Parts that contribute to a full context / executable-capacity estimate (P1). */
export type ContextEstimateParts = {
  taskText?: string | null;
  historyText?: string | null;
  systemPromptText?: string | null;
  toolsText?: string | null;
  attachmentsText?: string | null;
  /** Reserved tokens for model output; default 1024. */
  outputReserveTokens?: number;
  /**
   * Parts that were not available when building the estimate. Presence marks the
   * estimate incomplete even when other parts yield a non-zero token total.
   */
  unknownParts?: readonly ContextEstimateUnknownPart[];
};

export type ContextEstimateResult = {
  estimatedInputTokens: number;
  outputReserveTokens: number;
  /** Input + output reserve — compared against model contextWindow. */
  totalRequiredTokens: number;
  breakdown: {
    taskText: number;
    history: number;
    systemPrompt: number;
    tools: number;
    attachments: number;
    outputReserve: number;
  };
  reasons: string[];
  /** Parts marked unavailable at the call site. */
  unknownParts: ContextEstimateUnknownPart[];
  /** True when one or more context parts could not be observed. */
  estimateIncomplete: boolean;
  /**
   * True when the estimate is not trustworthy for capacity decisions:
   * either no substantive input tokens, or incomplete/unknown parts.
   * Must not be reduced to "token total === 0" alone.
   */
  estimateInsufficient: boolean;
};

/**
 * Estimate tokens for history + system + tools + attachments + task + output reserve.
 */
export function estimateTaskContextTokens(parts: ContextEstimateParts = {}): ContextEstimateResult {
  const taskText = estimateInputTokensFromText(parts.taskText);
  const history = estimateInputTokensFromText(parts.historyText);
  const systemPrompt = estimateInputTokensFromText(parts.systemPromptText);
  const tools = estimateInputTokensFromText(parts.toolsText);
  const attachments = estimateInputTokensFromText(parts.attachmentsText);
  const outputReserve =
    parts.outputReserveTokens !== undefined
      ? Math.max(0, Math.floor(parts.outputReserveTokens))
      : DEFAULT_OUTPUT_RESERVE_TOKENS;
  const estimatedInputTokens = taskText + history + systemPrompt + tools + attachments;
  const unknownParts = [
    ...new Set(
      (parts.unknownParts ?? []).filter(
        (part): part is ContextEstimateUnknownPart =>
          part === "history" ||
          part === "systemPrompt" ||
          part === "tools" ||
          part === "attachments",
      ),
    ),
  ];
  const estimateIncomplete = unknownParts.length > 0;
  // Insufficient ≠ "token total is zero" alone: incomplete/unknown parts also
  // make the estimate untrustworthy for capacity claims.
  const estimateInsufficient = estimatedInputTokens === 0 || estimateIncomplete;
  const reasons: string[] = [];
  if (estimatedInputTokens === 0) {
    reasons.push(
      "estimate_insufficient: no history/system/tools/attachments/task tokens; output reserve still applied",
    );
  }
  if (estimateIncomplete) {
    reasons.push(`estimate_incomplete: unknownParts=${unknownParts.join(",")}`);
  }
  reasons.push(
    `context_breakdown task=${taskText} history=${history} system=${systemPrompt} tools=${tools} attachments=${attachments} outputReserve=${outputReserve}`,
  );
  return {
    estimatedInputTokens,
    outputReserveTokens: outputReserve,
    totalRequiredTokens: estimatedInputTokens + outputReserve,
    breakdown: {
      taskText,
      history,
      systemPrompt,
      tools,
      attachments,
      outputReserve,
    },
    reasons,
    unknownParts,
    estimateIncomplete,
    estimateInsufficient,
  };
}

export type UnknownContextWindowPolicy = "keep" | "exclude";

export function filterExecutableModelIds(params: {
  authorizedModelIds: readonly string[];
  modelContextWindows?: Readonly<Record<string, number>>;
  /** Compared to contextWindow; prefer totalRequiredTokens (input + output reserve). */
  estimatedInputTokens?: number;
  totalRequiredTokens?: number;
  /**
   * Strategy when a model has no known contextWindow.
   * - keep (default): retain with an explicit reason
   * - exclude: drop from executable set with reason
   */
  unknownContextWindowPolicy?: UnknownContextWindowPolicy;
}): {
  executableModelIds: string[];
  excluded: Array<{ modelId: string; reason: string }>;
  keptUnknownWindow: Array<{ modelId: string; reason: string }>;
} {
  const required = Math.max(
    0,
    Math.floor(
      params.totalRequiredTokens !== undefined
        ? params.totalRequiredTokens
        : (params.estimatedInputTokens ?? 0),
    ),
  );
  const windows = params.modelContextWindows ?? {};
  const unknownPolicy = params.unknownContextWindowPolicy ?? "keep";
  const executableModelIds: string[] = [];
  const excluded: Array<{ modelId: string; reason: string }> = [];
  const keptUnknownWindow: Array<{ modelId: string; reason: string }> = [];
  for (const modelId of params.authorizedModelIds) {
    const id = modelId.trim();
    if (!id) {
      continue;
    }
    const window = windows[id];
    const hasWindow = typeof window === "number" && Number.isFinite(window) && window > 0;
    if (!hasWindow) {
      const reason =
        unknownPolicy === "exclude"
          ? `unknown_context_window:excluded (requiredTokens=${required})`
          : `unknown_context_window:kept (requiredTokens=${required}; policy=keep)`;
      if (unknownPolicy === "exclude") {
        excluded.push({ modelId: id, reason });
        continue;
      }
      keptUnknownWindow.push({ modelId: id, reason });
      executableModelIds.push(id);
      continue;
    }
    if (required > 0 && window < required) {
      excluded.push({
        modelId: id,
        reason: `contextWindow ${window} < requiredTokens ${required}`,
      });
      continue;
    }
    executableModelIds.push(id);
  }
  return { executableModelIds, excluded, keptUnknownWindow };
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
  /** Legacy override for input-only estimate; prefer contextParts / contextEstimate. */
  estimatedInputTokens?: number;
  contextParts?: ContextEstimateParts;
  contextEstimate?: ContextEstimateResult;
  unknownContextWindowPolicy?: UnknownContextWindowPolicy;
}): TaskCapabilityPlan {
  const authorizedModelIds = [
    ...new Set(params.authorizedModelIds.map((id) => id.trim()).filter((id) => id.length > 0)),
  ];
  const classification = classifyTaskCapability(params.taskText);

  const contextEstimate =
    params.contextEstimate ??
    (params.contextParts
      ? estimateTaskContextTokens({
          ...params.contextParts,
          taskText: params.contextParts.taskText ?? params.taskText,
        })
      : params.estimatedInputTokens !== undefined
        ? {
            ...estimateTaskContextTokens({
              taskText: params.taskText,
              outputReserveTokens: 0,
            }),
            estimatedInputTokens: Math.max(0, Math.floor(params.estimatedInputTokens)),
            totalRequiredTokens: Math.max(0, Math.floor(params.estimatedInputTokens)),
            breakdown: {
              taskText: Math.max(0, Math.floor(params.estimatedInputTokens)),
              history: 0,
              systemPrompt: 0,
              tools: 0,
              attachments: 0,
              outputReserve: 0,
            },
            reasons: [
              `legacy_estimatedInputTokens=${Math.max(0, Math.floor(params.estimatedInputTokens))}`,
            ],
            unknownParts: [],
            estimateIncomplete: false,
            estimateInsufficient: Math.max(0, Math.floor(params.estimatedInputTokens)) === 0,
          }
        : estimateTaskContextTokens({ taskText: params.taskText }));

  const { executableModelIds, excluded, keptUnknownWindow } = filterExecutableModelIds({
    authorizedModelIds,
    modelContextWindows: params.modelContextWindows,
    totalRequiredTokens: contextEstimate.totalRequiredTokens,
    unknownContextWindowPolicy: params.unknownContextWindowPolicy,
  });

  const reasons = [...classification.reasons, ...contextEstimate.reasons];
  for (const row of excluded) {
    reasons.push(`excluded ${row.modelId}: ${row.reason}`);
  }
  for (const row of keptUnknownWindow) {
    reasons.push(`kept ${row.modelId}: ${row.reason}`);
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
      contextEstimate,
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
    contextEstimate,
  };
}

/**
 * Outcome claim derived from a capability plan. Chat replies must never be
 * recorded as image/music (or other unwired modality) generation success.
 */
export type CapabilityPlanOutcomeClaim = {
  /** Modality that may be claimed as the actual execution path. */
  allowedModality: ExecutorKind;
  /** Modalities that must NOT be recorded as success for this run. */
  forbiddenSuccessModalities: ExecutorKind[];
  planFailure: CapabilityPlanFailure;
};

export function resolveCapabilityPlanOutcomeClaim(
  plan: TaskCapabilityPlan,
): CapabilityPlanOutcomeClaim {
  if (plan.failure.kind === "executor_unwired") {
    return {
      allowedModality: "chat_model",
      forbiddenSuccessModalities: [plan.failure.executor],
      planFailure: plan.failure,
    };
  }
  if (plan.failure.kind === "no_executable_candidates" || plan.failure.kind === "unsupported") {
    return {
      allowedModality: plan.executor,
      forbiddenSuccessModalities: [
        "image_generation",
        "audio_music_generation",
        "audio_tts",
        "audio_understanding",
      ],
      planFailure: plan.failure,
    };
  }
  return {
    allowedModality: plan.executor,
    forbiddenSuccessModalities: [],
    planFailure: plan.failure,
  };
}

/**
 * Structured cross-entry surface for capability-plan outcomes.
 * Distinguishes "explanatory text may be returned" from "image/music
 * (or other unwired modality) generation completed".
 */
export type CapabilityExecutionSurface = {
  /** Whether a chat/text reply path is allowed for this plan. */
  textReturnedAllowed: boolean;
  /**
   * True only when the plan's target modality actually completed.
   * For executor_unwired image/music, this stays false even if text is returned.
   */
  targetModalityCompleted: boolean;
  allowedModality: ExecutorKind;
  incompleteModalities: ExecutorKind[];
  planFailureKind: CapabilityPlanFailure["kind"];
  /** Machine-readable status; not a free-form success claim. */
  status: "ok" | "executor_unwired" | "no_executable_candidates" | "unsupported";
  detail?: string;
};

export function resolveCapabilityExecutionSurface(
  claim: CapabilityPlanOutcomeClaim,
): CapabilityExecutionSurface {
  const kind = claim.planFailure.kind;
  if (kind === "executor_unwired") {
    return {
      textReturnedAllowed: true,
      targetModalityCompleted: false,
      allowedModality: claim.allowedModality,
      incompleteModalities: [...claim.forbiddenSuccessModalities],
      planFailureKind: kind,
      status: "executor_unwired",
      detail: claim.planFailure.message,
    };
  }
  if (kind === "no_executable_candidates" || kind === "unsupported") {
    return {
      textReturnedAllowed: false,
      targetModalityCompleted: false,
      allowedModality: claim.allowedModality,
      incompleteModalities: [...claim.forbiddenSuccessModalities],
      planFailureKind: kind,
      status: kind,
      detail: claim.planFailure.message,
    };
  }
  return {
    textReturnedAllowed: true,
    targetModalityCompleted: true,
    allowedModality: claim.allowedModality,
    incompleteModalities: [],
    planFailureKind: "none",
    status: "ok",
  };
}

/**
 * Maps a gate result (+ optional plan) onto runWithModelFallback inputs.
 * When a plan exists, the run allowlist becomes the executable set (not merely
 * a reorder of the full authorized set). Over-context models cannot re-enter
 * via preferredModelOrder.
 */
export function resolveExecutionRoutingFromCapabilityPlan(params: {
  allowlist?: readonly string[];
  preferredModelOrder?: readonly string[];
  capabilityPlan?: TaskCapabilityPlan;
}): {
  allowlist?: string[];
  preferredModelOrder?: string[];
  capabilityPlan?: TaskCapabilityPlan;
  planFailure: CapabilityPlanFailure;
  outcomeClaim?: CapabilityPlanOutcomeClaim;
  executionSurface?: CapabilityExecutionSurface;
} {
  const plan = params.capabilityPlan;
  if (!plan) {
    return {
      ...(params.allowlist !== undefined ? { allowlist: [...params.allowlist] } : {}),
      ...(params.preferredModelOrder !== undefined
        ? { preferredModelOrder: [...params.preferredModelOrder] }
        : {}),
      planFailure: { kind: "none" },
    };
  }
  const outcomeClaim = resolveCapabilityPlanOutcomeClaim(plan);
  const executionSurface = resolveCapabilityExecutionSurface(outcomeClaim);
  return {
    allowlist: [...plan.executableModelIds],
    ...(plan.preferredModelOrder.length > 0
      ? { preferredModelOrder: [...plan.preferredModelOrder] }
      : { preferredModelOrder: [] }),
    capabilityPlan: plan,
    planFailure: plan.failure,
    outcomeClaim,
    executionSurface,
  };
}
