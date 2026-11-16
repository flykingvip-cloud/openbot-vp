import { expect, it } from "vitest";
import {
  createLegacyContextWindowDecisionProvider,
  selectComplexRuleProvider,
  consumeContextWindowDecision,
} from "./complex-rule-decision.js";
import { selectPersonalContextCap } from "./context-cap-selection.js";
it("preserves the exact legacy selection result", () => {
  const original = { tokens: 32000, source: "model" as const };
  const decision = createLegacyContextWindowDecisionProvider().decide({
    original,
    decisionId: "run:context",
  });
  expect(decision.selection).toEqual(selectPersonalContextCap({ original }));
  expect(decision.effectiveTokens).toBe(32000);
  expect(decision.mode).toBe("legacy");
});
it("defaults to legacy without evaluating a dynamic agent", () => {
  expect(selectComplexRuleProvider()).toBe("legacy");
});

it("consumes dynamic tokens without consulting legacy snapshot storage", () => {
  const decision = consumeContextWindowDecision({
    original: { tokens: 32000, source: "model" },
    decisionId: "run:model",
    port: { mode: "personal_activated_snapshot" },
    policy: {
      mode: "dynamic",
      revalidate: () => true,
      fallback: "block",
      snapshot: {
        domain: "context_window",
        ruleId: "model.context_window.guard",
        decisionId: "run:model",
        effectiveTokens: 24000,
        originalTokens: 32000,
        sourceVersion: "catalog:v1",
        policyHash: "hash",
      },
    },
  });
  expect(decision.mode).toBe("dynamic");
  expect(decision.effectiveTokens).toBe(24000);
});
it("blocks missing dynamic data unless fallback is explicit", () => {
  const input = { original: { tokens: 32000, source: "model" as const }, decisionId: "run:model" };
  expect(() =>
    consumeContextWindowDecision({ ...input, policy: { mode: "dynamic", fallback: "block" } }),
  ).toThrow();
  expect(
    consumeContextWindowDecision({ ...input, policy: { mode: "dynamic", fallback: "legacy" } })
      .source,
  ).toBe("explicit-dynamic-fallback");
});
it("dynamic selection retains its cap downstream", async () => {
  const { sameRunInheritedContextWindowTokens } = await import("./context-cap-selection.js");
  expect(
    sameRunInheritedContextWindowTokens({
      outcome: "applied",
      mode: "dynamic_run",
      source: "dynamic_run",
      originalTokens: 32000,
      tokens: 24000,
    }),
  ).toBe(24000);
});
it("rejects a dynamic view when the live binding fails revalidation", () => {
  expect(() =>
    consumeContextWindowDecision({
      original: { tokens: 32000, source: "model" },
      decisionId: "run",
      policy: {
        mode: "dynamic",
        fallback: "block",
        revalidate: () => false,
        snapshot: {
          domain: "context_window",
          ruleId: "model.context_window.guard",
          decisionId: "run",
          effectiveTokens: 24000,
          originalTokens: 32000,
          sourceVersion: "v1",
          policyHash: "hash",
        },
      },
    }),
  ).toThrow();
});
