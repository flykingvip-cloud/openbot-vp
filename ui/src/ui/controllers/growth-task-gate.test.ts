import { describe, expect, it, vi } from "vitest";
import {
  applyGrowthGateBlocked,
  authorizeGrowthGateProceed,
  isGrowthGateBlockedResult,
  type GrowthGateUiHost,
} from "./growth-task-gate.ts";

function host(partial: Partial<GrowthGateUiHost> = {}): GrowthGateUiHost {
  return {
    chatMessage: "",
    chatMessages: [
      { id: "local-run-1", role: "user", content: [{ type: "text", text: "做市场分析" }] },
      { id: "keep-me", role: "assistant", content: [] },
    ],
    chatRunId: "run-1",
    chatStream: "x",
    chatStreamStartedAt: 1,
    chatSending: true,
    workbenchGrowthContinueBannerVisible: false,
    workbenchGrowthGateProceedAuthorized: false,
    requestUpdate: vi.fn(),
    ...partial,
  };
}

describe("growth-task-gate UI", () => {
  it("detects blocked chat.send payload", () => {
    expect(isGrowthGateBlockedResult({ status: "growth_gate_blocked" })).toBe(true);
    expect(isGrowthGateBlockedResult({ status: "started" })).toBe(false);
  });

  it("rolls back optimistic message and shows gate banner with pending draft", () => {
    const h = host();
    applyGrowthGateBlocked(
      h,
      {
        status: "growth_gate_blocked",
        runId: "run-1",
        growthGate: {
          blocked: true,
          growthStatus: {
            lifecycleState: "growing",
            dimensions: { identity: 10, capability: 0, knowledge: 0, habits: 0 },
            activationScore: 5,
            operationalScore: null,
            capabilityReadiness: false,
            isActivated: false,
            templateId: "sales_assistant",
            pendingTaskContext: {
              draftText: "做市场分析",
              source: "composer",
              suggestedSkillKeys: ["market_research"],
              taskGaps: [
                {
                  key: "market_research",
                  label: "市场调研",
                  kind: "skill",
                  status: "missing",
                },
              ],
              extractedAtMs: 1,
              extractStatus: "ready",
            },
            milestones: {},
          },
          recommendation: {
            kind: "install_capabilities",
            reason: "growth.recommend.install_for_task",
            priority: 30,
            gaps: [
              {
                key: "market_research",
                label: "市场调研",
                kind: "skill",
                status: "missing",
              },
            ],
            canSkip: true,
            target: { recommendedSkillKeys: ["market_research"] },
          },
        },
      },
      "做市场分析",
    );
    expect(h.chatMessages).toHaveLength(1);
    expect((h.chatMessages[0] as { id: string }).id).toBe("keep-me");
    expect(h.chatMessage).toBe("做市场分析");
    expect(h.chatRunId).toBeNull();
    expect(h.workbenchGrowthContinueBannerVisible).toBe(true);
    expect(h.workbenchGrowthGateProceedAuthorized).toBe(false);
    expect(h.workbenchGrowthPendingTask?.draftText).toBe("做市场分析");
    expect(h.workbenchRecommendedSkillKeys).toEqual(["market_research"]);
  });

  it("authorizeGrowthGateProceed enables next send", () => {
    const h = host({
      workbenchGrowthPendingTask: {
        draftText: "原任务",
        source: "composer",
        suggestedSkillKeys: [],
        taskGaps: [],
        extractedAtMs: 1,
        extractStatus: "failed_fallback",
      },
      workbenchGrowthContinueBannerVisible: true,
    });
    authorizeGrowthGateProceed(h);
    expect(h.workbenchGrowthGateProceedAuthorized).toBe(true);
    expect(h.workbenchGrowthContinueBannerVisible).toBe(false);
    expect(h.chatMessage).toBe("原任务");
  });
});
