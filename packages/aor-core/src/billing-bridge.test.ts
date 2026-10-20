import { describe, expect, it } from "vitest";
import { AOR_METERING_KEYS, traceToUsageIngest } from "./billing-bridge.js";
import type { StepTrace } from "./orchestrator.js";

function step(overrides: Partial<StepTrace> = {}): StepTrace {
  return {
    nodeId: "scan",
    taskType: "coding.review",
    skillId: "coding.review",
    model: "anthropic/claude-opus-4-6",
    estimatedCostUsd: 0.012,
    usage: { inputTokens: 1000, outputTokens: 480, totalTokens: 1480, costUsd: 0.012 },
    latencyMs: 50,
    ...overrides,
  };
}

describe("traceToUsageIngest", () => {
  it("emits ai_token, aor_task, and aor_orchestration per step", () => {
    const payloads = traceToUsageIngest({
      runId: "run-1",
      trace: [step()],
      occurredAt: "2026-06-05T00:00:00.000Z",
    });

    expect(payloads).toHaveLength(3);
    expect(payloads[0]).toMatchObject({
      eventId: "aor:run-1:scan:tokens",
      key: AOR_METERING_KEYS.aiToken,
      quantity: 1480,
      occurredAt: "2026-06-05T00:00:00.000Z",
    });
    expect(payloads[1]).toMatchObject({
      key: AOR_METERING_KEYS.aorTask,
      quantity: 1,
    });
    expect(payloads[2]).toMatchObject({
      key: AOR_METERING_KEYS.aorOrchestration,
      quantity: 1, // max(1, round(0.012 * 100))
    });
  });

  it("skips token record when totalTokens is zero", () => {
    const payloads = traceToUsageIngest({
      runId: "r2",
      trace: [step({ usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } })],
    });
    expect(payloads.map((p) => p.key)).toEqual([
      AOR_METERING_KEYS.aorTask,
      AOR_METERING_KEYS.aorOrchestration,
    ]);
  });

  it("emits optimization savings and revenue share with distinct quantities", () => {
    const payloads = traceToUsageIngest({
      runId: "run-opt",
      trace: [step()],
      optimization: {
        costSavingsUsd: 0.5,
        costSavingsPct: 0.5,
        completionDelta: 0,
        revenueShareUsd: 0.1,
        revenueSharePct: 0.2,
      },
    });
    const savings = payloads.find((p) => p.key === AOR_METERING_KEYS.aorOptimizationSavings);
    const share = payloads.find((p) => p.key === AOR_METERING_KEYS.aorOptimizationRevenueShare);
    expect(savings?.quantity).toBe(50);
    expect(share?.quantity).toBe(10);
  });

  it("forwards userId on ingest payloads", () => {
    const payloads = traceToUsageIngest({
      runId: "run-u",
      trace: [step()],
      tenant: { userId: "user-42", tenantId: "tenant-a" },
    });
    expect(payloads.every((p) => p.userId === "user-42")).toBe(true);
  });

  it("forwards agentId and orgSeatId on ingest payloads", () => {
    const payloads = traceToUsageIngest({
      runId: "run-tags",
      trace: [step()],
      tenant: {
        userId: "user-42",
        tenantId: "tenant-a",
        agentId: "bot-1",
        orgSeatId: "seat-1",
      },
    });
    expect(payloads.every((p) => p.agentId === "bot-1" && p.orgSeatId === "seat-1")).toBe(true);
  });
});
