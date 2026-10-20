import type { ContextLane } from "./types.js";

/**
 * Lane-specific *target* provider-token budgets.
 * Compiler admits against a conservative fraction of the target so tokenizer
 * variance cannot silently exceed the provider request.
 */
export const LANE_CONTEXT_BUDGETS: Record<
  ContextLane,
  { targetTokens: number; admissionRatio: number; maxRecentTurns: number }
> = {
  chat: { targetTokens: 6_000, admissionRatio: 0.8, maxRecentTurns: 10 },
  retrieve: { targetTokens: 10_000, admissionRatio: 0.8, maxRecentTurns: 12 },
  act: { targetTokens: 16_000, admissionRatio: 0.8, maxRecentTurns: 12 },
};

/** Applied to estimated tokens before comparing to admission budget. */
export const TOKEN_ESTIMATE_SAFETY_MARGIN = 1.2;

export const DEFAULT_CONTEXT_LANE: ContextLane = "act";

/**
 * Act target is min(25% of the model context window, 48k), never below the
 * lane floor. Chat and retrieve use the same share and cap scaled by their
 * floor relative to act (6k/16k and 10k/16k).
 */
const ACT_WINDOW_SHARE_NUMERATOR = 1;
const ACT_WINDOW_SHARE_DENOMINATOR = 4;
const ACT_WINDOW_CAP_TOKENS = 48_000;

function scaleTargetTokens(floorTokens: number, contextWindowTokens?: number): number {
  if (
    typeof contextWindowTokens !== "number" ||
    !Number.isFinite(contextWindowTokens) ||
    contextWindowTokens <= 0
  ) {
    return floorTokens;
  }
  const reference = LANE_CONTEXT_BUDGETS.act.targetTokens;
  const capTokens = Math.floor((ACT_WINDOW_CAP_TOKENS * floorTokens) / reference);
  const scaledTokens = Math.floor(
    (contextWindowTokens * ACT_WINDOW_SHARE_NUMERATOR * floorTokens) /
      (ACT_WINDOW_SHARE_DENOMINATOR * reference),
  );
  return Math.max(floorTokens, Math.min(capTokens, scaledTokens));
}

export function resolveLaneBudget(
  lane: ContextLane,
  contextWindowTokens?: number,
): {
  targetTokens: number;
  admissionBudgetTokens: number;
  maxRecentTurns: number;
} {
  const spec = LANE_CONTEXT_BUDGETS[lane] ?? LANE_CONTEXT_BUDGETS.act;
  const targetTokens = scaleTargetTokens(spec.targetTokens, contextWindowTokens);
  return {
    targetTokens,
    admissionBudgetTokens: Math.floor(targetTokens * spec.admissionRatio),
    maxRecentTurns: spec.maxRecentTurns,
  };
}

export function resolveContextLane(params: {
  depth?: ContextLane;
  applyChatLane?: boolean;
}): ContextLane {
  if (params.applyChatLane) {
    return "chat";
  }
  if (params.depth === "chat" || params.depth === "retrieve" || params.depth === "act") {
    return params.depth;
  }
  // Unknown lane keeps the largest budget so execution is not starved.
  return DEFAULT_CONTEXT_LANE;
}
