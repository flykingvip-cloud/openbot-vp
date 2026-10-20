import type { ModelProfile } from "./types.js";

/**
 * Seed model catalog for Stage 1 (3 models: OpenAI / Anthropic / a cheap one).
 *
 * Cost values mirror OpenBot `ModelDefinitionConfig.cost` (USD per 1M tokens);
 * latency and taskTypeScores are *seeds* that the Evaluator/Feedback loop
 * refines at runtime. Real deployments should load cost from OpenBot config
 * via the SDK rather than relying on these defaults.
 */
export const SEED_MODEL_CATALOG: readonly ModelProfile[] = [
  {
    ref: { provider: "anthropic", id: "claude-opus-4-6" },
    cost: { inputPerMtok: 15, outputPerMtok: 75 },
    p50LatencyMs: 4000,
    p95LatencyMs: 9000,
    taskTypeScores: { "coding.review": 0.9, summarization: 0.85 },
  },
  {
    ref: { provider: "openai", id: "gpt-5.4" },
    cost: { inputPerMtok: 5, outputPerMtok: 15 },
    p50LatencyMs: 3000,
    p95LatencyMs: 7000,
    taskTypeScores: { "coding.review": 0.85, summarization: 0.82 },
  },
  {
    ref: { provider: "openai", id: "gpt-5.4-mini" },
    cost: { inputPerMtok: 0.4, outputPerMtok: 1.6 },
    p50LatencyMs: 1500,
    p95LatencyMs: 3500,
    taskTypeScores: { "coding.review": 0.62, summarization: 0.78 },
  },
];

export function defaultModelCatalog(): ModelProfile[] {
  return SEED_MODEL_CATALOG.map((profile) => ({
    ...profile,
    taskTypeScores: { ...profile.taskTypeScores },
  }));
}
