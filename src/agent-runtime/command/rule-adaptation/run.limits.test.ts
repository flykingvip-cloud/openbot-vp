import { expect, it } from "vitest";
import { runShadowRuleAdaptation } from "./run.js";
import {
  fixtureHost,
  fixtureRequest,
  hangingModel,
  noChangeOutput,
  proposalOutput,
  scriptedModel,
  tightenProposal,
} from "./test-support.js";

it("cancels a never-returning model call when maxDurationMs elapses", async () => {
  const { host, board } = fixtureHost();
  const model = hangingModel({ inputTokens: 2, outputTokens: 0, cost: 0.01 });
  const started = Date.now();
  const result = await runShadowRuleAdaptation(
    fixtureRequest({ budget: { maxDurationMs: 40, maxModelCalls: 4 } }),
    { host, model },
  );
  const elapsed = Date.now() - started;
  expect(result.outcomeCode).toBe("cancelled");
  expect(result.cancelled).toBe(true);
  expect(result.usage.cancelled).toBe(true);
  expect(result.usage.inputTokens).toBe(2);
  expect(result.limitProof.threwToCaller).toBe(false);
  expect(result.limitProof.costAccounting).toBe("estimated_post_hoc");
  expect(result.commitment).toBe("none");
  expect(board.mutations()).toEqual([]);
  expect(elapsed).toBeGreaterThanOrEqual(30);
  expect(elapsed).toBeLessThan(2000);
  expect(model.lastInput?.timeoutMs).toBeGreaterThan(0);
  expect(model.lastInput?.timeoutMs).toBeLessThanOrEqual(40);
});

it("passes remaining output tokens as maxTokens and treats an overflow as post-hoc exhaustion", async () => {
  const { host, board } = fixtureHost();
  const model = scriptedModel([
    (input) => {
      expect(input.maxTokens).toBe(10);
      expect(input.timeoutMs).toBeGreaterThan(0);
      return {
        kind: "message",
        text: noChangeOutput(),
        usage: { inputTokens: 1, outputTokens: 50, cost: 0.01 },
      };
    },
  ]);
  const result = await runShadowRuleAdaptation(
    fixtureRequest({ budget: { maxOutputTokens: 10, maxModelCalls: 4 } }),
    { host, model },
  );
  expect(result.outcomeCode).toBe("budget_exhausted");
  expect(result.usage.outputTokens).toBe(50);
  expect(result.limitProof.exhausted).toContain("outputTokens");
  expect(result.limitProof.postAccountedExhausted).toContain("outputTokens");
  expect(result.limitProof.costAccounting).toBe("estimated_post_hoc");
  expect(result.limitProof.threwToCaller).toBe(false);
  expect(board.mutations()).toEqual([]);
  expect(model.lastInput?.maxTokens).toBe(10);
});

it("keeps usage when a mid-run cancellation already produced tokens", async () => {
  const { host } = fixtureHost();
  const result = await runShadowRuleAdaptation(fixtureRequest(), {
    host,
    model: scriptedModel([
      {
        kind: "cancelled",
        usage: { inputTokens: 8, outputTokens: 2, cost: 0.04 },
        reason: "owner_cancel",
      },
    ]),
  });
  expect(result.outcomeCode).toBe("cancelled");
  expect(result.usage.inputTokens).toBe(8);
  expect(result.usage.outputTokens).toBe(2);
  expect(result.usage.cost).toBe(0.04);
  expect(result.usage.cancelled).toBe(true);
  expect(result.limitProof.costAccounting).toBe("estimated_post_hoc");
});

it("ends the runner wait promptly when a signal-ignoring completion is cancelled early", async () => {
  const { host, board } = fixtureHost();
  const model = scriptedModel([() => new Promise(() => {})]);
  const controller = new AbortController();
  const started = Date.now();
  const timer = setTimeout(() => controller.abort("owner_cancel"), 40);
  const result = await runShadowRuleAdaptation(
    fixtureRequest({
      budget: { maxDurationMs: 8_000, maxModelCalls: 4 },
      signal: controller.signal,
    }),
    { host, model },
  );
  clearTimeout(timer);
  const elapsed = Date.now() - started;
  expect(result.outcomeCode).toBe("cancelled");
  expect(result.cancelled).toBe(true);
  expect(result.limitProof.usageKnown).toBe(false);
  expect(result.limitProof.underlyingRequestStopped).toBe(false);
  expect(result.usage.inputTokens).toBe(0);
  expect(result.usage.outputTokens).toBe(0);
  expect(result.usage.cost).toBe(0);
  expect(result.limitProof.threwToCaller).toBe(false);
  expect(result.commitment).toBe("none");
  expect(board.mutations()).toEqual([]);
  expect(elapsed).toBeGreaterThanOrEqual(20);
  expect(elapsed).toBeLessThan(1_500);
});

it("does not advance the shadow task when a timed-out completion later returns a proposal", async () => {
  const { host, board } = fixtureHost();
  let release!: (completion: {
    kind: "message";
    text: string;
    usage: { inputTokens: number; outputTokens: number; cost: number };
  }) => void;
  const pending = new Promise<{
    kind: "message";
    text: string;
    usage: { inputTokens: number; outputTokens: number; cost: number };
  }>((resolve) => {
    release = resolve;
  });
  const model = scriptedModel([() => pending]);
  const started = Date.now();
  const result = await runShadowRuleAdaptation(
    fixtureRequest({ budget: { maxDurationMs: 40, maxModelCalls: 4 } }),
    { host, model },
  );
  const elapsed = Date.now() - started;
  expect(result.outcomeCode).toBe("cancelled");
  expect(result.limitProof.usageKnown).toBe(false);
  expect(result.validation).toBeUndefined();
  expect(result.proposal).toBeUndefined();
  expect(result.shadowDiff).toEqual([]);
  expect(board.mutations()).toEqual([]);
  expect(elapsed).toBeLessThan(2_000);
  release({
    kind: "message",
    text: proposalOutput(tightenProposal()),
    usage: { inputTokens: 20, outputTokens: 8, cost: 0.1 },
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(result.outcomeCode).toBe("cancelled");
  expect(result.validation).toBeUndefined();
  expect(result.proposal).toBeUndefined();
  expect(result.shadowDiff).toEqual([]);
  expect(result.candidatePersisted).toBe(false);
  expect(result.candidateActivated).toBe(false);
  expect(board.mutations()).toEqual([]);
  expect(model.calls).toBe(1);
});
