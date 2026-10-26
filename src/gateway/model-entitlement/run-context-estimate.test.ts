// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildRunContextEstimateParts, peekEstimatedInputTokens } from "./run-context-estimate.js";
import {
  buildTaskCapabilityPlan,
  estimateTaskContextTokens,
  resolveExecutionRoutingFromCapabilityPlan,
} from "./task-capability-plan.js";

describe("buildRunContextEstimateParts (production entry helper)", () => {
  it("marks missing history/system/tools/attachments as unknown", () => {
    const built = buildRunContextEstimateParts({ taskText: "hi" });
    expect(built.unknownParts).toEqual(
      expect.arrayContaining(["history", "systemPrompt", "tools", "attachments"]),
    );
    const est = estimateTaskContextTokens(built.contextParts);
    expect(est.estimateIncomplete).toBe(true);
    expect(est.estimateInsufficient).toBe(true);
    // Incomplete alone makes insufficient even when taskText yields tokens.
    expect(est.estimatedInputTokens).toBeGreaterThan(0);
  });

  it("assembles session totals + systemPromptReport into context parts", () => {
    const built = buildRunContextEstimateParts({
      taskText: "short task",
      sessionEntry: {
        totalTokens: 50_000,
        totalTokensFresh: true,
        systemPromptReport: {
          source: "run",
          generatedAt: Date.now(),
          systemPrompt: { chars: 400, projectContextChars: 200, nonProjectContextChars: 200 },
          injectedWorkspaceFiles: [
            {
              name: "doc.md",
              path: "/tmp/doc.md",
              missing: false,
              rawChars: 800,
              injectedChars: 800,
              truncated: false,
            },
          ],
          skills: { promptChars: 0, entries: [] },
          tools: { listChars: 1200, schemaChars: 800, entries: [] },
        },
      },
    });
    expect(built.unknownParts).toEqual([]);
    expect(peekEstimatedInputTokens(built.contextParts)).toBeGreaterThan(10_000);
    const est = estimateTaskContextTokens(built.contextParts);
    expect(est.estimateIncomplete).toBe(false);
    expect(est.estimateInsufficient).toBe(false);
    expect(est.breakdown.history).toBeGreaterThan(0);
    expect(est.breakdown.systemPrompt).toBeGreaterThan(0);
    expect(est.breakdown.tools).toBeGreaterThan(0);
    expect(est.breakdown.attachments).toBeGreaterThan(0);
  });

  it("entry-level: short task + large history/tools/attachments excludes small window; fallback cannot re-enter", () => {
    const built = buildRunContextEstimateParts({
      taskText: "ok",
      sessionEntry: {
        totalTokens: 40_000,
        totalTokensFresh: true,
        systemPromptReport: {
          source: "estimate",
          generatedAt: Date.now(),
          systemPrompt: { chars: 2000, projectContextChars: 1000, nonProjectContextChars: 1000 },
          injectedWorkspaceFiles: [
            {
              name: "big.bin",
              path: "/tmp/big.bin",
              missing: false,
              rawChars: 20_000,
              injectedChars: 20_000,
              truncated: false,
            },
          ],
          skills: { promptChars: 0, entries: [] },
          tools: { listChars: 8000, schemaChars: 8000, entries: [] },
        },
      },
      outputReserveTokens: 2048,
    });
    const plan = buildTaskCapabilityPlan({
      taskText: "ok",
      authorizedModelIds: ["vendor/small", "vendor/large"],
      preferredModelOrderFromAuth: ["vendor/small", "vendor/large"],
      modelContextWindows: { "vendor/small": 8_000, "vendor/large": 200_000 },
      contextParts: built.contextParts,
    });
    expect(plan.contextEstimate?.totalRequiredTokens).toBeGreaterThan(8_000);
    expect(plan.executableModelIds).toEqual(["vendor/large"]);
    expect(plan.preferredModelOrder).toEqual(["vendor/large"]);
    expect(plan.preferredModelOrder).not.toContain("vendor/small");
    expect(plan.authorizedModelIds).toEqual(["vendor/small", "vendor/large"]);

    const routing = resolveExecutionRoutingFromCapabilityPlan({
      allowlist: plan.authorizedModelIds,
      preferredModelOrder: ["vendor/small", "vendor/large"],
      capabilityPlan: plan,
    });
    expect(routing.allowlist).toEqual(["vendor/large"]);
    expect(routing.preferredModelOrder).toEqual(["vendor/large"]);
    expect(routing.allowlist).not.toContain("vendor/small");
  });
});
