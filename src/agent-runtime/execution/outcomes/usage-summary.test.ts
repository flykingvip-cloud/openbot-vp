import { expect, it } from "vitest";
import {
  createUsageAccumulator,
  mergeUsageIntoAccumulator,
  toNormalizedUsage,
  buildErrorAgentMeta,
} from "./usage-summary.js";
it("retains cumulative output but only the latest prompt cache footprint", () => {
  const usage = createUsageAccumulator();
  mergeUsageIntoAccumulator(usage, { input: 100, output: 10, cacheRead: 50, cacheWrite: 20 });
  mergeUsageIntoAccumulator(usage, { input: 80, output: 5, cacheRead: 60 });
  expect(usage.total).toBe(325);
  expect(toNormalizedUsage(usage)).toEqual({
    input: 80,
    output: 15,
    cacheRead: 60,
    cacheWrite: undefined,
    total: 155,
  });
  mergeUsageIntoAccumulator(usage, undefined);
  expect(usage.output).toBe(15);
});
it("preserves usage on error and honors final API context total", () => {
  const usage = createUsageAccumulator();
  expect(toNormalizedUsage(usage)).toBeUndefined();
  mergeUsageIntoAccumulator(usage, { input: 10, output: 4 });
  const meta = buildErrorAgentMeta({
    sessionId: "s",
    provider: "p",
    model: "m",
    usageAccumulator: usage,
    lastRunPromptUsage: { input: 10 },
    lastAssistant: { usage: { input_tokens: 2, output_tokens: 1 } },
    lastTurnTotal: 20,
  });
  expect(meta.usage?.total).toBe(20);
  expect(meta.lastCallUsage).toMatchObject({ input: 2, output: 1 });
  expect(meta.promptTokens).toBe(10);
});
