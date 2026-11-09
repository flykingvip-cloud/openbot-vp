import { expect, it } from "vitest";
import {
  resolveMaxRunRetryIterations,
  MAX_OVERFLOW_COMPACTION_ATTEMPTS,
  OVERLOAD_FAILOVER_BACKOFF_POLICY,
} from "./run-limits.js";
it("preserves the minimum, scaled and maximum attempt budgets", () => {
  expect([0, 1, 2, 10, 100].map(resolveMaxRunRetryIterations)).toEqual([32, 32, 40, 104, 160]);
  expect(MAX_OVERFLOW_COMPACTION_ATTEMPTS).toBe(3);
  expect(OVERLOAD_FAILOVER_BACKOFF_POLICY).toEqual({
    initialMs: 250,
    maxMs: 1500,
    factor: 2,
    jitter: 0.2,
  });
});
