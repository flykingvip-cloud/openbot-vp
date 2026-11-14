import { expect, it } from "vitest";
import { createBudgetTracker } from "../../model/rule-adaptation/index.js";
import { runShadowRuleAdaptation } from "./run.js";
import {
  fixtureHost,
  fixtureRequest,
  messageStep,
  noChangeOutput,
  scriptedModel,
  toolStep,
} from "./test-support.js";

it("enforces the model-call limit before starting another call", async () => {
  const { host } = fixtureHost();
  const result = await runShadowRuleAdaptation(
    fixtureRequest({ budget: { maxModelCalls: 1, maxRevisions: 0 } }),
    {
      host,
      model: scriptedModel([
        toolStep("searchRules", { query: "context" }),
        messageStep(noChangeOutput()),
      ]),
    },
  );
  expect(result.outcomeCode).toBe("budget_exhausted");
  expect(result.usage.modelCalls).toBe(1);
  expect(result.limitProof.exhausted).toContain("modelCalls");
  expect(
    result.reasons.some(
      (entry) => entry.code === "budget_exhausted" && entry.path === "run.budget",
    ),
  ).toBe(true);
  expect(result.activationAllowed).toBe(false);
});

it("enforces token and cost limits", async () => {
  const { host } = fixtureHost();
  const result = await runShadowRuleAdaptation(
    fixtureRequest({
      budget: {
        maxInputTokens: 10,
        maxOutputTokens: 100,
        maxCost: 1,
        maxTotalCost: 1,
        maxModelCalls: 4,
      },
    }),
    {
      host,
      model: scriptedModel([
        toolStep(
          "searchRules",
          { query: "context" },
          { inputTokens: 10, outputTokens: 1, cost: 0.2 },
        ),
        messageStep(noChangeOutput(), { inputTokens: 10, outputTokens: 1, cost: 0.2 }),
      ]),
    },
  );
  expect(result.outcomeCode).toBe("budget_exhausted");
  expect(result.limitProof.exhausted).toContain("inputTokens");
  expect(result.commitment).toBe("none");
});

it("enforces the time limit with an injected clock", async () => {
  let current = 1_000;
  const { board } = fixtureHost();
  const host = {
    view: fixtureHost().host.view,
    controlBoard: board.snapshot(),
    now: () => current,
  };
  const result = await runShadowRuleAdaptation(
    fixtureRequest({ budget: { maxDurationMs: 5_000, maxModelCalls: 4 } }),
    {
      host,
      model: {
        async complete() {
          // Advance the injected clock past the logical duration cap after
          // this call. The real completion timeout still uses the remaining
          // 5000ms and must not fire for this synchronous fixture.
          current += 20_000;
          return {
            kind: "tool_calls",
            toolCalls: [{ id: "t1", name: "searchRules", arguments: { query: "x" } }],
            usage: { inputTokens: 1, outputTokens: 1, cost: 0 },
          };
        },
      },
    },
  );
  expect(result.outcomeCode).toBe("budget_exhausted");
  expect(result.limitProof.exhausted).toContain("durationMs");
  expect(result.controlUnchanged).toBe(true);
});

it("records cancellation on the usage ledger", () => {
  const signal = AbortSignal.abort("stop");
  const tracker = createBudgetTracker({ maxModelCalls: 2 }, () => 10, signal);
  expect(tracker.canStartModelCall()).toBe("cancelled");
  tracker.markCancelled("stop");
  expect(tracker.usage().cancelled).toBe(true);
  expect(tracker.usage().cancelReason).toBe("stop");
});

it("accounts total cost after the fact and then refuses the next call", () => {
  const tracker = createBudgetTracker(
    { maxCost: 10, maxTotalCost: 0.5, maxModelCalls: 10 },
    () => 0,
  );
  tracker.recordModelUsage({ inputTokens: 1, outputTokens: 1, cost: 0.5 });
  expect(tracker.canStartModelCall()).toBe("budget_exhausted");
  expect(tracker.exhausted()).toEqual(expect.arrayContaining(["cost", "totalCost"]));
});
