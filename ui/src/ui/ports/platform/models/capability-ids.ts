/** Canonical capability IDs shared by UI labels and routing constraints. */

export type CanonicalCapabilityId =
  | "reasoning"
  | "vision"
  | "coding"
  | "tool_use"
  | "stream"
  | "long_context"
  | "image_generation"
  | "music_generation"
  | "text_chat";

/** Legacy / inferred frontend tags → canonical IDs. */
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

/** Display labels (zh) for canonical IDs. */
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

/** True when the asset capability list covers `required` after legacy→canonical mapping. */
export function assetHasCapability(
  assetCapabilities: readonly string[],
  required: string,
): boolean {
  const want = toCanonicalCapabilityId(required);
  if (!want) {
    return assetCapabilities.some((c) => c.trim().toLowerCase() === required.trim().toLowerCase());
  }
  const have = new Set(normalizeCapabilityIds([...assetCapabilities]));
  return have.has(want);
}

/** Every required tag must be present on the asset (both sides normalized). */
export function assetMatchesRequiredCapabilities(
  assetCapabilities: readonly string[],
  required: readonly string[],
): boolean {
  if (!required.length) {
    return true;
  }
  return required.every((cap) => assetHasCapability(assetCapabilities, cap));
}
