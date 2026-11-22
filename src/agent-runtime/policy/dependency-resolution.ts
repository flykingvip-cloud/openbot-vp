/** Decisions for a private, task-bound delegation; never grants new authority. */
export type DependencyBlockReason =
  | "timeout"
  | "child_failed"
  | "partial"
  | "permission"
  | "payment"
  | "missing_user_fact";
export type DependencyFallback = {
  id: string;
  authorized: boolean;
  reversible: boolean;
  attempted: boolean;
};
export type DependencyResolution =
  | { kind: "fallback"; fallbackId: string }
  | { kind: "needs_user"; reason: DependencyBlockReason | "retry_budget_exhausted" };

/** Hard human gates win; automatic alternatives must already be authorized and safe. */
export function resolveDependencyBlock(input: {
  reason: DependencyBlockReason;
  fallbacks: readonly DependencyFallback[];
  retryCount: number;
  maxRetries: number;
}): DependencyResolution {
  if (["permission", "payment", "missing_user_fact"].includes(input.reason)) {
    return { kind: "needs_user", reason: input.reason };
  }
  if (
    !Number.isInteger(input.retryCount) ||
    !Number.isInteger(input.maxRetries) ||
    input.retryCount < 0 ||
    input.maxRetries < 0 ||
    input.retryCount >= input.maxRetries
  ) {
    return { kind: "needs_user", reason: "retry_budget_exhausted" };
  }
  const fallback = input.fallbacks.find(
    (item) => item.id.trim() && item.authorized && item.reversible && !item.attempted,
  );
  return fallback
    ? { kind: "fallback", fallbackId: fallback.id }
    : { kind: "needs_user", reason: input.reason };
}
