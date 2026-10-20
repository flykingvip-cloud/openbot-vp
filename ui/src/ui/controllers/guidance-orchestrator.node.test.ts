import { describe, expect, it, vi } from "vitest";
import type { UiGuidanceSnapshot } from "../ports/employee/guidance/orchestrate-surface.ts";
import {
  GUIDANCE_CONTENT_VERSION,
  recordGuidanceMetricClient,
  resetGuidanceUiControlStateForTests,
  acknowledgeGuidanceSnapshot,
  getGuidanceUiControlState,
  type GuidanceOrchestratorClient,
} from "./guidance-orchestrator.ts";

function snap(): UiGuidanceSnapshot {
  return {
    scope: "robot",
    scenario: "robot.birth",
    confidence: "high",
    currentStage: "birth",
    nextAction: {
      kind: "start_work",
      label: "开始",
      reason: "r",
      canSkip: true,
      risk: "low",
    },
    optionalActions: [],
    blockers: [],
    degrade: "none",
    tenantId: "t1",
    userId: "u1",
    entityId: "bot-1",
    source: "growth",
    generatedAt: 1,
    contentVersion: GUIDANCE_CONTENT_VERSION,
  };
}

describe("guidance-orchestrator client P3.3", () => {
  it("records metrics without task body or secrets and fail-softs", async () => {
    resetGuidanceUiControlStateForTests();
    const request = vi.fn(async (_method: string, _params?: Record<string, unknown>) => ({
      ok: true,
    })) as GuidanceOrchestratorClient["request"];
    await recordGuidanceMetricClient({ request }, snap(), "guidance_primary_clicked", {
      metadata: { note: "safe" },
    });
    expect(request).toHaveBeenCalledWith(
      "guidance.metrics.record",
      expect.objectContaining({
        event: "guidance_primary_clicked",
        tenantId: "t1",
        userId: "u1",
        scope: "robot",
        entityId: "bot-1",
        actionKind: "start_work",
        contentVersion: GUIDANCE_CONTENT_VERSION,
      }),
    );

    const failing = vi.fn(async (_method: string, _params?: Record<string, unknown>) => {
      throw new Error("offline");
    }) as GuidanceOrchestratorClient["request"];
    await expect(
      recordGuidanceMetricClient({ request: failing }, snap(), "guidance_deferred"),
    ).resolves.toBeUndefined();
  });

  it("ack is scoped and does not leak across entities", () => {
    resetGuidanceUiControlStateForTests();
    acknowledgeGuidanceSnapshot(snap());
    const state = getGuidanceUiControlState();
    expect(state.acknowledgedKeys.has("robot::bot-1")).toBe(true);
    expect(state.acknowledgedKeys.has("user::bot-1")).toBe(false);
  });
});
