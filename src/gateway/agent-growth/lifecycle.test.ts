import { describe, expect, it } from "vitest";
import { createInitialGrowthStatus, recomputeGrowthStatus } from "./factory.js";
import { applyActivationTransition, deriveLifecycleState } from "./lifecycle.js";
import { recordMilestone } from "./milestones.js";
import type { CapabilityReadinessSignals, GrowthStatus } from "./types.js";

const READY_SIGNALS: CapabilityReadinessSignals = {
  requiredSkillsInstalled: true,
  requiredPermissionsGranted: "unknown",
};

const THRESHOLD = 78;

describe("deriveLifecycleState", () => {
  it("birth → growing → mission_ready → activated → evolution", () => {
    // birth: 刚创建，未开会话
    let g = createInitialGrowthStatus({ kind: "robot", atMs: 1 });
    expect(deriveLifecycleState(g, THRESHOLD)).toBe("birth");

    // growing: 开了会话但分数不足
    g = { ...g, milestones: recordMilestone(g.milestones, "sessionOpenedAtMs", 2) };
    g = recomputeGrowthStatus(g, {
      dimensions: { identity: 80, capability: 20, knowledge: 20, habits: 20 },
      signals: READY_SIGNALS,
    });
    expect(g.lifecycleState).toBe("growing");

    // mission_ready: 分数达标 + capabilityReadiness
    g = recomputeGrowthStatus(g, {
      dimensions: { identity: 80, capability: 80, knowledge: 80, habits: 80 },
      signals: READY_SIGNALS,
    });
    expect(g.activationScore).toBeGreaterThanOrEqual(THRESHOLD);
    expect(g.capabilityReadiness).toBe(true);
    expect(g.lifecycleState).toBe("mission_ready");
    // R7.4：进入 mission_ready 自动记录 missionReadyAtMs。
    expect(g.milestones.missionReadyAtMs).toBeGreaterThan(0);

    // activated: 首个任务成功
    g = applyActivationTransition(g, { type: "first_mission_success", atMs: 100 });
    expect(g.isActivated).toBe(true);
    expect(g.activatedAtMs).toBe(100);
    expect(deriveLifecycleState(g, THRESHOLD)).toBe("activated");

    // evolution: 有成长报告
    const withReport: GrowthStatus = {
      ...g,
      growthReport: {
        periodDays: 30,
        generatedAtMs: 200,
        tasksCompleted: 5,
        learningMaterialsCount: 0,
        toolInvocations: 0,
        businessImpact: [],
      },
    };
    expect(deriveLifecycleState(withReport, THRESHOLD)).toBe("evolution");
  });

  it("group mission_ready requires alignmentComplete", () => {
    let g = createInitialGrowthStatus({ kind: "group", atMs: 1 });
    g = { ...g, milestones: recordMilestone(g.milestones, "sessionOpenedAtMs", 2) };
    // 分数达标、能力就绪，但 alignment 未完成 → 仍 growing
    g = recomputeGrowthStatus(g, {
      dimensions: { identity: 90, capability: 90, knowledge: 90, habits: 90, alignment: 0 },
      signals: READY_SIGNALS,
      alignmentComplete: false,
    });
    expect(g.lifecycleState).toBe("growing");

    g = recomputeGrowthStatus(g, {
      dimensions: { identity: 90, capability: 90, knowledge: 90, habits: 90, alignment: 100 },
      signals: READY_SIGNALS,
      alignmentComplete: true,
    });
    expect(g.lifecycleState).toBe("mission_ready");
  });
});

describe("applyActivationTransition", () => {
  it("is idempotent and first-write-wins on activatedAtMs", () => {
    let g = createInitialGrowthStatus({ kind: "robot", atMs: 1 });
    g = applyActivationTransition(g, { type: "first_mission_success", atMs: 50 });
    const again = applyActivationTransition(g, { type: "first_mission_success", atMs: 999 });
    expect(again.activatedAtMs).toBe(50);
    expect(again.milestones.firstMissionSuccessAtMs).toBe(50);
  });
});

describe("recordMilestone first-write-wins", () => {
  it("does not overwrite an earlier timestamp", () => {
    const m0 = { createdAtMs: 1 };
    const m1 = recordMilestone(m0, "sessionOpenedAtMs", 10);
    const m2 = recordMilestone(m1, "sessionOpenedAtMs", 20);
    expect(m2.sessionOpenedAtMs).toBe(10);
  });

  it("ignores non-positive timestamps", () => {
    const m = recordMilestone({ createdAtMs: 1 }, "missionReadyAtMs", 0);
    expect(m.missionReadyAtMs).toBeUndefined();
  });
});
