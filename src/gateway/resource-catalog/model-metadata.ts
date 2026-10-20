import type { ResourceModelCapability, ResourceModelCatalogEntry } from "./types.js";

export const DEFAULT_MODEL_BENCHMARK_TOKENS = {
  inputTokens: 1_500,
  outputTokens: 500,
} as const;

const CAPABILITY_ORDER: ResourceModelCapability[] = [
  "coding",
  "reasoning",
  "tool_use",
  "vision",
  "long_context",
];

export function inferModelCapabilities(params: {
  modelId: string;
  displayName: string;
  contextWindow?: number;
}): ResourceModelCapability[] {
  const haystack = `${params.displayName} ${params.modelId}`.toLowerCase();
  const tags = new Set<ResourceModelCapability>();
  if (/(code|codex|dev|program)/.test(haystack)) {
    tags.add("coding");
  }
  if (/(reason|think|o1|o3|opus|deepseek-r1|r1-)/.test(haystack)) {
    tags.add("reasoning");
  }
  if (/(tool|function|agent)/.test(haystack)) {
    tags.add("tool_use");
  }
  if (/(vision|image|multimodal|4o-mini|gemini.*flash)/.test(haystack)) {
    tags.add("vision");
  }
  if ((params.contextWindow ?? 0) >= 200_000) {
    tags.add("long_context");
  }
  return CAPABILITY_ORDER.filter((tag) => tags.has(tag));
}

export function normalizeModelCapabilities(value: unknown): ResourceModelCapability[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const allowed = new Set<ResourceModelCapability>(CAPABILITY_ORDER);
  const normalized = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry): entry is ResourceModelCapability =>
      allowed.has(entry as ResourceModelCapability),
    );
  return normalized.length > 0 ? normalized : undefined;
}

export function resolveModelCapabilities(
  entry: ResourceModelCatalogEntry,
): ResourceModelCapability[] {
  if (entry.capabilities && entry.capabilities.length > 0) {
    return entry.capabilities;
  }
  return inferModelCapabilities({
    modelId: entry.modelId,
    displayName: entry.displayName,
    contextWindow: entry.contextWindow,
  });
}

export function resolveModelAvgTokensPerTask(entry: ResourceModelCatalogEntry): {
  inputTokens: number;
  outputTokens: number;
} {
  const total = entry.avgTokensPerTask;
  if (total !== undefined && total > 0) {
    const inputTokens = Math.max(1, Math.round(total * 0.75));
    const outputTokens = Math.max(1, total - inputTokens);
    return { inputTokens, outputTokens };
  }
  return { ...DEFAULT_MODEL_BENCHMARK_TOKENS };
}

export function estimateProviderCostPerTaskCents(entry: ResourceModelCatalogEntry): number {
  const usage = resolveModelAvgTokensPerTask(entry);
  const inputCost = (entry.inputCostPer1MCents * usage.inputTokens) / 1_000_000;
  const outputCost = (entry.outputCostPer1MCents * usage.outputTokens) / 1_000_000;
  return Math.round(inputCost + outputCost);
}
