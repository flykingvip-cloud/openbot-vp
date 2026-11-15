/**
 * Cooperative yields so a long knowledge-index projection or pairwise graph
 * build cannot pin the event loop long enough for shallow /healthz probes to
 * stall for seconds (t316 / t317 §5.8).
 *
 * Time-budgeted: callers tick `yieldIfDue()` at safe points (end of a query
 * page, every N pair iterations). When the budget has elapsed, we park on
 * `setImmediate` so HTTP /healthz can run, then continue with the same
 * computation. Graph and projection semantics are unchanged.
 */

export const EVENT_LOOP_YIELD_BUDGET_MS = 8;

export function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

export type EventLoopYielder = () => Promise<void>;

export function createBudgetedEventLoopYielder(
  budgetMs: number = EVENT_LOOP_YIELD_BUDGET_MS,
): EventLoopYielder {
  const budget = Math.max(0, budgetMs);
  let last = performance.now();
  return async () => {
    if (budget === 0) {
      await yieldEventLoop();
      last = performance.now();
      return;
    }
    if (performance.now() - last >= budget) {
      await yieldEventLoop();
      last = performance.now();
    }
  };
}
