import type { RoutingPolicy } from "../../../capability/policy-engine/index.ts";
import type {
  CreditWeight,
  ResourceModelCatalogEntry,
  ResourceTier,
} from "../../../capability/resource-catalog/index.ts";

export type ModelCapabilityTag = "coding" | "reasoning" | "toolUse" | "vision" | "longContext";

const DEFAULT_BENCHMARK = { inputTokens: 1500, outputTokens: 500 };

function mapStoredCapability(tag: string): ModelCapabilityTag | null {
  switch (tag) {
    case "coding":
      return "coding";
    case "reasoning":
      return "reasoning";
    case "tool_use":
      return "toolUse";
    case "vision":
      return "vision";
    case "long_context":
      return "longContext";
    default:
      return null;
  }
}

export function resolveModelCapabilityTags(model: ResourceModelCatalogEntry): ModelCapabilityTag[] {
  if (model.capabilities && model.capabilities.length > 0) {
    return model.capabilities
      .map((tag) => mapStoredCapability(tag))
      .filter((tag): tag is ModelCapabilityTag => tag !== null);
  }
  return inferModelCapabilityTags(model);
}

export function estimateProviderCostPerTaskCents(model: ResourceModelCatalogEntry): number | null {
  if (model.inputCostPer1MCents <= 0 && model.outputCostPer1MCents <= 0) {
    return null;
  }
  const totalTokens = model.avgTokensPerTask;
  const usage =
    totalTokens !== undefined && totalTokens > 0
      ? {
          inputTokens: Math.max(1, Math.round(totalTokens * 0.75)),
          outputTokens: Math.max(1, totalTokens - Math.max(1, Math.round(totalTokens * 0.75))),
        }
      : DEFAULT_BENCHMARK;
  const cost =
    (model.inputCostPer1MCents * usage.inputTokens) / 1_000_000 +
    (model.outputCostPer1MCents * usage.outputTokens) / 1_000_000;
  return Math.max(0, Math.round(cost));
}

export function formatAvgCostPerTask(cents: number | null): string {
  if (cents === null || cents <= 0) {
    return "—";
  }
  return `$${(cents / 100).toFixed(cents >= 100 ? 2 : 3)}`;
}

export type TierModelGroup = {
  tier: ResourceTier;
  creditCost: number | null;
  models: ResourceModelCatalogEntry[];
};

export function sortTiers(tiers: ResourceTier[]): ResourceTier[] {
  return tiers.toSorted(
    (left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
  );
}

export function creditWeightByTier(creditWeights: CreditWeight[]): Map<string, number> {
  return new Map(creditWeights.map((entry) => [entry.tier, entry.creditCost]));
}

export function groupModelsByTier(params: {
  tiers: ResourceTier[];
  models: ResourceModelCatalogEntry[];
  creditWeights: CreditWeight[];
}): TierModelGroup[] {
  const weights = creditWeightByTier(params.creditWeights);
  const sortedTiers = sortTiers(params.tiers);
  const modelsByTier = new Map<string, ResourceModelCatalogEntry[]>();
  for (const tier of sortedTiers) {
    modelsByTier.set(tier.id, []);
  }
  for (const model of params.models) {
    const bucket = modelsByTier.get(model.tier) ?? [];
    bucket.push(model);
    modelsByTier.set(model.tier, bucket);
  }
  return sortedTiers.map((tier) => ({
    tier,
    creditCost: weights.get(tier.id) ?? null,
    models: (modelsByTier.get(tier.id) ?? []).toSorted((left, right) =>
      compareModelsByProviderCost(left, right),
    ),
  }));
}

export function compareModelsByProviderCost(
  left: ResourceModelCatalogEntry,
  right: ResourceModelCatalogEntry,
): number {
  const leftCost = modelProviderCostScore(left);
  const rightCost = modelProviderCostScore(right);
  if (leftCost !== rightCost) {
    return leftCost - rightCost;
  }
  return left.displayName.localeCompare(right.displayName);
}

export function modelProviderCostScore(model: ResourceModelCatalogEntry): number {
  return model.inputCostPer1MCents + model.outputCostPer1MCents;
}

export function formatProviderCostPer1M(cents: number): string {
  if (cents <= 0) {
    return "—";
  }
  const dollars = cents / 100;
  if (dollars >= 1) {
    return `$${dollars.toFixed(dollars >= 10 ? 0 : 2)}`;
  }
  return `$${dollars.toFixed(3)}`;
}

export function formatContextWindow(contextWindow: number | undefined): string | null {
  if (!contextWindow || contextWindow <= 0) {
    return null;
  }
  if (contextWindow >= 1_000_000) {
    return `${(contextWindow / 1_000_000).toFixed(contextWindow % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (contextWindow >= 1_000) {
    return `${Math.round(contextWindow / 1_000)}k`;
  }
  return String(contextWindow);
}

export function inferModelCapabilityTags(model: ResourceModelCatalogEntry): ModelCapabilityTag[] {
  const haystack = `${model.displayName} ${model.modelId}`.toLowerCase();
  const tags: ModelCapabilityTag[] = [];
  if (/(code|codex|dev|program)/.test(haystack)) {
    tags.push("coding");
  }
  if (/(reason|think|o1|o3|opus|deepseek-r1)/.test(haystack)) {
    tags.push("reasoning");
  }
  if (/(tool|function|agent)/.test(haystack)) {
    tags.push("toolUse");
  }
  if (/(vision|image|multimodal|4o-mini|gemini.*flash)/.test(haystack)) {
    tags.push("vision");
  }
  if ((model.contextWindow ?? 0) >= 200_000) {
    tags.push("longContext");
  }
  return tags;
}

export function policyQualityBarPercent(strategy: RoutingPolicy["selectorStrategy"]): number {
  switch (strategy) {
    case "cheapest":
      return 28;
    case "balanced":
      return 58;
    case "best_quality":
      return 88;
    case "bandit":
      return 72;
    default:
      return 50;
  }
}

export function buildPolicyRoutingPreview(
  policy: RoutingPolicy,
  models: ResourceModelCatalogEntry[],
  tiers: ResourceTier[],
  limit = 4,
): ResourceModelCatalogEntry[] {
  const enabled = models.filter((model) => model.enabled);
  const tierRank = new Map(sortTiers(tiers).map((tier, index) => [tier.id, index]));
  const sorted = enabled.toSorted((left, right) => {
    const leftTier = tierRank.get(left.tier) ?? 99;
    const rightTier = tierRank.get(right.tier) ?? 99;
    const leftCost = modelProviderCostScore(left);
    const rightCost = modelProviderCostScore(right);
    switch (policy.selectorStrategy) {
      case "cheapest":
        return leftCost - rightCost || left.displayName.localeCompare(right.displayName);
      case "best_quality":
        return (
          rightCost - leftCost ||
          rightTier - leftTier ||
          right.displayName.localeCompare(left.displayName)
        );
      case "balanced":
        return (
          leftTier - rightTier ||
          leftCost - rightCost ||
          left.displayName.localeCompare(right.displayName)
        );
      case "bandit":
        return (
          leftTier - rightTier ||
          rightCost - leftCost ||
          left.displayName.localeCompare(right.displayName)
        );
      default:
        return left.displayName.localeCompare(right.displayName);
    }
  });
  const seen = new Set<string>();
  const preview: ResourceModelCatalogEntry[] = [];
  for (const model of sorted) {
    if (seen.has(model.modelId)) {
      continue;
    }
    seen.add(model.modelId);
    preview.push(model);
    if (preview.length >= limit) {
      break;
    }
  }
  return preview;
}

export function parseCreditWeightDraft(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const value = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

export function creditWeightDraftChanges(params: {
  creditWeights: CreditWeight[];
  drafts: Record<string, string>;
}): Array<{ tier: string; creditCost: number; previous: number }> {
  const changes: Array<{ tier: string; creditCost: number; previous: number }> = [];
  for (const weight of params.creditWeights) {
    const parsed = parseCreditWeightDraft(params.drafts[weight.tier] ?? String(weight.creditCost));
    if (parsed === null || parsed === weight.creditCost) {
      continue;
    }
    changes.push({ tier: weight.tier, creditCost: parsed, previous: weight.creditCost });
  }
  return changes;
}

export function estimateTasksForCredits(credits: number, creditCost: number): number {
  if (creditCost <= 0) {
    return 0;
  }
  return Math.floor(credits / creditCost);
}

export const ECONOMICS_PREVIEW_EXAMPLE_CREDITS = 10_000;
