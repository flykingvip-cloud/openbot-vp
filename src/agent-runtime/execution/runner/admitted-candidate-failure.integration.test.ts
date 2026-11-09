import "../../../agents/pi-embedded-runner/run.overflow-compaction.mocks.shared.js";
import { expect, it, vi } from "vitest";
import { makeAttemptResult } from "../../../agents/pi-embedded-runner/run.overflow-compaction.fixture.js";
import {
  mockedRunEmbeddedAttempt,
  overflowBaseRunParams,
} from "../../../agents/pi-embedded-runner/run.overflow-compaction.shared-test.js";
import { readEmbeddedFailureUsage } from "./embedded-failure-usage.js";
import { runEmbeddedPiAgent } from "./embedded-run.js";
vi.mock("../../../agents/runtime-plugins.js", () => ({ ensureRuntimePluginsLoaded: vi.fn() }));
it("real prompt-error exit retains candidate aggregate usage before outer fallback", async () => {
  mockedRunEmbeddedAttempt.mockResolvedValueOnce(
    makeAttemptResult({
      promptError: new Error("provider failed"),
      attemptUsage: { input: 7, output: 3 },
    }),
  );
  let error: unknown;
  try {
    await runEmbeddedPiAgent({
      ...overflowBaseRunParams,
      provider: "anthropic",
      model: "test-model",
    });
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(Error);
  expect(
    readEmbeddedFailureUsage(error, {
      runId: overflowBaseRunParams.runId,
      provider: "anthropic",
      model: "test-model",
    }),
  ).toMatchObject({
    usage: { input: 7, output: 3 },
    aggregation: "provider_aggregate_internal_retries_unknown",
  });
});
