import { describe, expect, it } from "vitest";
import { buildAuditRecord, resolveRunSessionKey, tenantSessionKey } from "./audit.js";
import type { AorRunResult } from "./orchestrator.js";

describe("audit", () => {
  it("builds a traceable audit record", () => {
    const result = {
      runId: "run-1",
      taskType: "coding.review",
      plan: { taskType: "coding.review", steps: [], edges: [] },
      output: { text: "ok" },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, costUsd: 0.01 },
      selection: {
        model: { provider: "openai", id: "gpt-5.4" },
        estimatedCostUsd: 0.01,
        qualityScore: 0.8,
        score: 0.8,
        reason: "balanced",
      },
      latencyMs: 100,
      trace: [
        {
          nodeId: "n0",
          taskType: "coding.review",
          skillId: "coding.review",
          model: "openai/gpt-5.4",
          estimatedCostUsd: 0.01,
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          latencyMs: 100,
        },
      ],
    } satisfies AorRunResult;

    const audit = buildAuditRecord({
      runId: "run-1",
      task: { goal: "review repo" },
      result,
      strategy: "balanced",
      tenant: { tenantId: "acme", userId: "user-42" },
    });

    expect(audit.runId).toBe("run-1");
    expect(audit.tenantId).toBe("acme");
    expect(audit.userId).toBe("user-42");
    expect(audit.stepCount).toBe(1);
  });

  it("prefixes session keys with tenant id", () => {
    expect(tenantSessionKey("acme", "main")).toBe("acme:main");
    expect(tenantSessionKey("acme", "acme:main")).toBe("acme:main");
  });

  it("resolveRunSessionKey materializes aor:<runId> under tenant when sessionKey omitted", () => {
    expect(
      resolveRunSessionKey({
        tenant: { tenantId: "acme" },
        runId: "run-42",
      }),
    ).toBe("acme:aor:run-42");
  });

  it("resolveRunSessionKey leaves sessionKey undefined without tenant", () => {
    expect(resolveRunSessionKey({ runId: "run-42" })).toBeUndefined();
    expect(resolveRunSessionKey({ sessionKey: "main", runId: "run-42" })).toBe("main");
  });
});
