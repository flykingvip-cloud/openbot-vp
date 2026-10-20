import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  loadGrowthStatus,
  listAgentTemplates,
  normalizeGrowthStatus,
  recomputeGrowth,
  recordGrowthMilestone,
  type AgentGrowthClientState,
} from "./agent-growth.ts";

function stateWith(request: ReturnType<typeof vi.fn>): AgentGrowthClientState {
  return {
    connected: true,
    client: { request } as unknown as GatewayBrowserClient,
  };
}

const SAMPLE = {
  growthStatus: {
    lifecycleState: "growing",
    dimensions: { identity: 80, capability: 40, knowledge: 0, habits: 0 },
    activationScore: 30,
    operationalScore: null,
    capabilityReadiness: false,
    isActivated: false,
    templateId: "generic_worker",
  },
};

describe("agent-growth controller", () => {
  it("normalizeGrowthStatus extracts milestones and prelude dismiss", () => {
    const view = normalizeGrowthStatus({
      growthStatus: {
        lifecycleState: "growing",
        dimensions: { identity: 80, capability: 40, knowledge: 0, habits: 0 },
        activationScore: 30,
        preludeDismissedAtMs: 42,
        milestones: {
          createdAtMs: 1,
          rolesAssignedAtMs: 10,
        },
      },
    });
    expect(view?.preludeDismissedAtMs).toBe(42);
    expect(view?.rolesAssigned).toBe(true);
    expect(view?.workflowDefined).toBe(false);
  });

  it("normalizeGrowthStatus extracts and defaults fields", () => {
    const view = normalizeGrowthStatus(SAMPLE);
    expect(view?.lifecycleState).toBe("growing");
    expect(view?.activationScore).toBe(30);
    expect(view?.dimensions.capability).toBe(40);
    expect(view?.operationalScore).toBeNull();
    expect(view?.isActivated).toBe(false);
    expect(view?.recommendation?.kind).toBe("none");
    expect(view?.capabilityGaps).toEqual([]);
    expect(view?.funnel?.preludeDismissed).toBe(false);
  });

  it("normalizeGrowthStatus parses recommendation and capabilityGaps from RPC payload", () => {
    const view = normalizeGrowthStatus({
      ...SAMPLE,
      capabilityGaps: [{ key: "crm", label: "CRM", kind: "skill", status: "missing" }],
      funnel: {
        hasSessionOpened: true,
        hasIdentityCompleted: false,
        hasFirstSkillInstalled: false,
        hasFirstMissionSent: false,
        hasFirstMissionSuccess: false,
        preludeDismissed: false,
      },
      recommendation: {
        kind: "start_work",
        reason: "growth.recommend.start_work",
        priority: 20,
        gaps: [],
        canSkip: true,
        target: { focusComposer: true },
      },
    });
    expect(view?.recommendation?.kind).toBe("start_work");
    expect(view?.capabilityGaps).toEqual([
      { key: "crm", label: "CRM", kind: "skill", status: "missing" },
    ]);
    expect(view?.funnel?.hasSessionOpened).toBe(true);
  });

  it("normalizeGrowthStatus parses pendingTaskContext and resumePendingTask target", () => {
    const view = normalizeGrowthStatus({
      ...SAMPLE,
      growthStatus: {
        ...SAMPLE.growthStatus,
        pendingTaskContext: {
          draftText: "继续市场分析",
          source: "sent_mission",
          suggestedSkillKeys: ["market_research"],
          taskGaps: [
            { key: "market_research", label: "市场调研", kind: "skill", status: "missing" },
          ],
          extractedAtMs: 9,
          extractStatus: "ready",
        },
      },
      recommendation: {
        kind: "verify_with_task",
        reason: "growth.recommend.verify_with_task",
        priority: 50,
        gaps: [],
        canSkip: true,
        target: { resumePendingTask: true },
      },
    });
    expect(view?.pendingTaskContext?.draftText).toBe("继续市场分析");
    expect(view?.pendingTaskContext?.extractStatus).toBe("ready");
    expect(view?.recommendation?.target.resumePendingTask).toBe(true);
  });

  it("normalizeGrowthStatus coerces invalid lifecycle to birth and rejects non-objects", () => {
    expect(normalizeGrowthStatus(null)).toBeNull();
    const view = normalizeGrowthStatus({ growthStatus: { lifecycleState: "bogus" } });
    expect(view?.lifecycleState).toBe("birth");
  });

  it("normalizeGrowthStatus extracts growthReport businessImpact", () => {
    const view = normalizeGrowthStatus({
      growthStatus: {
        lifecycleState: "evolution",
        dimensions: { identity: 1, capability: 1, knowledge: 0, habits: 0 },
        activationScore: 90,
        growthReport: {
          periodDays: 30,
          generatedAtMs: 100,
          tasksCompleted: 12,
          toolInvocations: 99,
          businessImpact: [{ key: "x", value: 3, description: "减少人工审核" }],
        },
      },
    });
    expect(view?.lifecycleState).toBe("evolution");
    expect(view?.growthReport?.businessImpact).toEqual([
      { key: "x", value: 3, description: "减少人工审核" },
    ]);
    expect(view?.growthReport?.toolInvocations).toBe(99);
  });

  it("listAgentTemplates calls agents.list-templates", async () => {
    const request = vi.fn(async () => ({
      templates: [
        {
          templateId: "generic_worker",
          displayName: "通用员工",
          roleBlueprint: "通用数字员工",
        },
      ],
    }));
    const templates = await listAgentTemplates(stateWith(request));
    expect(request).toHaveBeenCalledWith("agents.list-templates", {});
    expect(templates).toEqual([
      {
        templateId: "generic_worker",
        displayName: "通用员工",
        description: "通用数字员工",
      },
    ]);
  });

  it("loadGrowthStatus calls robot endpoint with agentId", async () => {
    const request = vi.fn(async () => SAMPLE);
    const view = await loadGrowthStatus(stateWith(request), { kind: "robot", entityId: "main" });
    expect(request).toHaveBeenCalledWith("agents.get-growth-status", { agentId: "main" });
    expect(view?.activationScore).toBe(30);
  });

  it("loadGrowthStatus calls group endpoint with groupId", async () => {
    const request = vi.fn(async () => SAMPLE);
    await loadGrowthStatus(stateWith(request), { kind: "group", entityId: "g1" });
    expect(request).toHaveBeenCalledWith("collaboration.spaces.get-growth-status", {
      groupId: "g1",
    });
  });

  it("recomputeGrowth and recordGrowthMilestone hit the right methods", async () => {
    const request = vi.fn(async () => SAMPLE);
    const state = stateWith(request);
    await recomputeGrowth(state, { kind: "robot", entityId: "main" });
    expect(request).toHaveBeenCalledWith("agents.recompute-growth", { agentId: "main" });
    await recordGrowthMilestone(
      state,
      { kind: "robot", entityId: "main" },
      "sessionOpenedAtMs",
      123,
    );
    expect(request).toHaveBeenCalledWith("agents.record-growth-milestone", {
      agentId: "main",
      key: "sessionOpenedAtMs",
      atMs: 123,
    });
  });

  it("returns null when disconnected", async () => {
    const request = vi.fn(async () => SAMPLE);
    const view = await loadGrowthStatus(
      { client: null, connected: false },
      { kind: "robot", entityId: "main" },
    );
    expect(view).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("swallows request errors and returns null", async () => {
    const request = vi.fn(async () => {
      throw new Error("boom");
    });
    const view = await recomputeGrowth(stateWith(request), { kind: "group", entityId: "g1" });
    expect(view).toBeNull();
  });
});
