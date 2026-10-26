/**
 * Real executor paths for modality generation (PR #90 surface).
 * Never claim native Midjourney; image goes through Stepfun, music through Suno-compatible.
 */

export type ExecutorCallType =
  | "text_chat"
  | "image_generation"
  | "music_generation"
  | "audio_understanding"
  | "tts"
  | "unknown";

export type ExecutorPathLabel = {
  callType: ExecutorCallType;
  /** Short badge for lists / forms. */
  badge: string;
  /** Longer explanation for drawers / wizards. */
  detail: string;
  /** True when this path is actually wired behind config (not a marketing name). */
  wiredHint: boolean;
};

const IMAGE_STEPFUN: ExecutorPathLabel = {
  callType: "image_generation",
  badge: "图片生成 · Stepfun",
  detail: "图片任务走 Stepfun image_gen；Midjourney 关键词仅用于归类，不是原生 Midjourney API。",
  wiredHint: true,
};

const MUSIC_SUNO: ExecutorPathLabel = {
  callType: "music_generation",
  badge: "音乐生成 · Suno 兼容",
  detail: "音乐任务走 Suno 兼容 endpoint（music_gen）；需配置端点后才会启用 wiring。",
  wiredHint: true,
};

const TEXT_CHAT: ExecutorPathLabel = {
  callType: "text_chat",
  badge: "文本对话",
  detail: "标准文本对话协议探测与生成。",
  wiredHint: true,
};

const UNKNOWN: ExecutorPathLabel = {
  callType: "unknown",
  badge: "调用类型待确认",
  detail: "尚未指定执行器调用类型。",
  wiredHint: false,
};

export function resolveExecutorPathLabel(params: {
  callType?: string | null;
  modelId?: string | null;
  providerId?: string | null;
  taskTags?: string[];
  outputModalities?: string[];
}): ExecutorPathLabel {
  const callType = (params.callType ?? "").trim().toLowerCase();
  if (callType === "image_generation" || callType === "image") {
    return IMAGE_STEPFUN;
  }
  if (callType === "music_generation" || callType === "music") {
    return MUSIC_SUNO;
  }
  if (callType === "text_chat" || callType === "text") {
    return TEXT_CHAT;
  }

  const haystack = [
    params.modelId ?? "",
    params.providerId ?? "",
    ...(params.taskTags ?? []),
    ...(params.outputModalities ?? []),
  ]
    .join(" ")
    .toLowerCase();

  // Midjourney / image keywords → Stepfun path label (never "native Midjourney").
  if (
    haystack.includes("midjourney") ||
    haystack.includes("image_generation") ||
    haystack.includes("image-gen") ||
    (params.outputModalities ?? []).includes("image")
  ) {
    return IMAGE_STEPFUN;
  }
  if (
    haystack.includes("suno") ||
    haystack.includes("music_generation") ||
    haystack.includes("music-gen") ||
    ((params.outputModalities ?? []).includes("audio") && haystack.includes("music"))
  ) {
    return MUSIC_SUNO;
  }
  if (callType || haystack) {
    // default text when we have some identity but no modality cue
    if (!callType && !(params.outputModalities ?? []).some((m) => m !== "text")) {
      return TEXT_CHAT;
    }
  }
  return callType ? TEXT_CHAT : UNKNOWN;
}

export function assertNoNativeMidjourneyClaim(text: string): boolean {
  const lowered = text.toLowerCase();
  if (!lowered.includes("midjourney")) {
    return true;
  }
  // Allowed only when clarifying it is NOT native.
  return (
    lowered.includes("不是原生") ||
    lowered.includes("非原生") ||
    lowered.includes("not native") ||
    lowered.includes("stepfun")
  );
}
