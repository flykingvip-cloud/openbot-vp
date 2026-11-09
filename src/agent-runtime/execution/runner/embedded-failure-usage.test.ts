import { expect, it } from "vitest";
import { retainEmbeddedFailureUsage, readEmbeddedFailureUsage } from "./embedded-failure-usage.js";
it("rejects arbitrary self-reported error usage and cross-candidate identity", () => {
  const identity = { runId: "r", provider: "p", model: "a" };
  const error = Object.assign(new Error("fake"), { usage: { input: 999 } });
  expect(readEmbeddedFailureUsage(error, identity)).toBeUndefined();
  retainEmbeddedFailureUsage(error, identity, { input: 7, output: 3 });
  expect(readEmbeddedFailureUsage(error, { ...identity, model: "b" })).toBeUndefined();
  expect(readEmbeddedFailureUsage(error, { ...identity, runId: "other" })).toBeUndefined();
  expect(readEmbeddedFailureUsage(error, identity)).toMatchObject({
    aggregation: "provider_aggregate_internal_retries_unknown",
    usage: { input: 7, output: 3 },
  });
});
