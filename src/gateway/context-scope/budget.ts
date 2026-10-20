import type { ContextBudget, ContextMode, ContextPolicyV1 } from "./types.js";
import { DEFAULT_CONTEXT_POLICY } from "./types.js";

const MODE_BUDGETS: Record<ContextMode, ContextBudget> = {
  minimal: {
    maxTokens: 8_000,
    maxSources: 2,
    maxFiles: 0,
    maxRetrievalDepth: 0,
    maxToolCalls: 0,
  },
  auto: {
    maxTokens: 24_000,
    maxSources: 8,
    maxFiles: 20,
    maxRetrievalDepth: 1,
    maxToolCalls: 4,
  },
  focused: {
    maxTokens: 24_000,
    maxSources: 8,
    maxFiles: 20,
    maxRetrievalDepth: 1,
    maxToolCalls: 4,
  },
  deep: {
    maxTokens: 64_000,
    maxSources: 16,
    maxFiles: 40,
    maxRetrievalDepth: 3,
    maxToolCalls: 12,
  },
};

export function resolveContextBudget(params: {
  mode: ContextMode;
  contextPolicy?: ContextPolicyV1;
}): ContextBudget {
  const policy = params.contextPolicy ?? DEFAULT_CONTEXT_POLICY;
  const base = MODE_BUDGETS[params.mode];
  return {
    ...base,
    maxTokens: Math.min(base.maxTokens, policy.maxContextTokens),
    maxFiles: Math.min(base.maxFiles, policy.maxFilesPerRound),
  };
}

export function estimateEvidenceTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Hard-cap retrieved evidence by plan budget. maxFiles=0 yields nothing. */
export function applyContextBudgetToEvidence<T extends { chunkText?: string }>(params: {
  evidence: T[];
  budget: ContextBudget;
}): T[] {
  const cappedFiles = params.evidence.slice(0, Math.max(0, params.budget.maxFiles));
  const kept: T[] = [];
  let tokens = 0;
  for (const item of cappedFiles) {
    const cost = estimateEvidenceTokens(item.chunkText ?? "");
    if (kept.length > 0 && tokens + cost > params.budget.maxTokens) {
      break;
    }
    kept.push(item);
    tokens += cost;
  }
  return kept;
}
