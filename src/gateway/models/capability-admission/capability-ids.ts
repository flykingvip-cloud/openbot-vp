import type { CanonicalCapabilityId } from "./types.js";

const LEGACY_TO_CANONICAL: Record<string, CanonicalCapabilityId> = {
  code: "coding",
  coding: "coding",
  tools: "tool_use",
  tool_use: "tool_use",
  reasoning: "reasoning",
  vision: "vision",
  stream: "stream",
  long_context: "long_context",
  image_generation: "image_generation",
  music_generation: "music_generation",
  text: "text_chat",
  text_chat: "text_chat",
};

export const CAPABILITY_LABEL_ZH: Record<CanonicalCapabilityId, string> = {
  reasoning: "推理",
  vision: "视觉理解",
  coding: "代码",
  tool_use: "工具调用",
  stream: "流式",
  long_context: "长上下文",
  image_generation: "图片生成",
  music_generation: "音乐生成",
  text_chat: "文本对话",
};

export function toCanonicalCapabilityId(raw: string): CanonicalCapabilityId | null {
  const key = raw.trim().toLowerCase();
  return LEGACY_TO_CANONICAL[key] ?? null;
}

export function normalizeCapabilityIds(raw: string[]): CanonicalCapabilityId[] {
  const out = new Set<CanonicalCapabilityId>();
  for (const entry of raw) {
    const id = toCanonicalCapabilityId(entry);
    if (id) {
      out.add(id);
    }
  }
  return Array.from(out);
}

export function capabilityLabel(id: string): string {
  const canonical = toCanonicalCapabilityId(id);
  if (canonical) {
    return CAPABILITY_LABEL_ZH[canonical];
  }
  return id;
}

export function verifiedCapabilityIds(
  items: Array<{ id: CanonicalCapabilityId; status: string }>,
): CanonicalCapabilityId[] {
  return items.filter((item) => item.status === "passed").map((item) => item.id);
}
