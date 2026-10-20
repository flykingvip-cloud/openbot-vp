import { describe, expect, it } from "vitest";
import {
  deriveGrowthFunnelFlags,
  resolveNextGrowthAction,
  type GrowthCapabilityGapView,
  type GrowthFunnelFlags,
} from "./next-action.js";

const skillGap: GrowthCapabilityGapView = {
  key: "crm",
  label: "CRM 技能",
  kind: "skill",
  status: "missing",
};

function funnel(overrides: Partial<GrowthFunnelFlags> = {}): GrowthFunnelFlags {
  return {
    hasSessionOpened: true,
    hasIdentityCompleted: false,
    hasFirstSkillInstalled: false,
    hasFirstMissionSent: false,
    hasFirstMissionSuccess: false,
    preludeDismissed: false,
    ...overrides,
  };
}

describe("resolveNextGrowthAction", () => {
  it("prefers start_work for new robots with unmet skills (task-first)", () => {
    const action = resolveNextGrowthAction({
      lifecycleState: "birth",
      funnel: funnel(),
      gaps: [skillGap],
    });
    expect(action.kind).toBe("start_work");
    expect(action.canSkip).toBe(true);
    expect(action.gaps).toEqual([skillGap]);
  });

  it("preferCultivate elevates confirm_identity before start_work", () => {
    const action = resolveNextGrowthAction({
      lifecycleState: "birth",
      funnel: funnel(),
      gaps: [skillGap],
      preferCultivate: true,
    });
    expect(action.kind).toBe("confirm_identity");
  });

  it("recommends install_capabilities after first mission when skills missing", () => {
    const action = resolveNextGrowthAction({
      lifecycleState: "growing",
      funnel: funnel({ hasFirstMissionSent: true }),
      gaps: [skillGap],
    });
    expect(action.kind).toBe("install_capabilities");
    expect(action.target.recommendedSkillKeys).toEqual(["crm"]);
  });

  it("prefers taskGaps for install recommendedSkillKeys and reason", () => {
    const taskGap: GrowthCapabilityGapView = {
      key: "market_research",
      label: "市场调研",
      kind: "skill",
      status: "missing",
    };
    const action = resolveNextGrowthAction({
      lifecycleState: "growing",
      funnel: funnel({ hasFirstMissionSent: true }),
      gaps: [skillGap],
      taskGaps: [taskGap],
    });
    expect(action.kind).toBe("install_capabilities");
    expect(action.reason).toBe("growth.recommend.install_for_task");
    expect(action.target.recommendedSkillKeys).toEqual(["market_research"]);
    expect(action.gaps).toEqual([taskGap]);
  });

  it("verify_with_task resumes pending draft via banner flag", () => {
    const action = resolveNextGrowthAction({
      lifecycleState: "growing",
      funnel: funnel({
        hasFirstMissionSent: true,
        hasIdentityCompleted: true,
      }),
      gaps: [],
      pendingDraftText: "继续做市场分析",
    });
    expect(action.kind).toBe("verify_with_task");
    expect(action.target).toEqual({ resumePendingTask: true });
  });

  it("recommends confirm_identity when mission sent and skills satisfied", () => {
    const action = resolveNextGrowthAction({
      lifecycleState: "growing",
      funnel: funnel({ hasFirstMissionSent: true }),
      gaps: [{ ...skillGap, status: "satisfied" }],
    });
    expect(action.kind).toBe("confirm_identity");
  });

  it("recommends verify_with_task when ready but no success", () => {
    const action = resolveNextGrowthAction({
      lifecycleState: "growing",
      funnel: funnel({
        hasFirstMissionSent: true,
        hasIdentityCompleted: true,
      }),
      gaps: [],
    });
    expect(action.kind).toBe("verify_with_task");
  });

  it("returns none when prelude dismissed", () => {
    const action = resolveNextGrowthAction({
      lifecycleState: "birth",
      funnel: funnel({ preludeDismissed: true }),
      gaps: [skillGap],
    });
    expect(action.kind).toBe("none");
  });

  it("returns none when activated", () => {
    const action = resolveNextGrowthAction({
      lifecycleState: "activated",
      funnel: funnel({
        hasFirstMissionSent: true,
        hasFirstMissionSuccess: true,
        hasIdentityCompleted: true,
      }),
      gaps: [],
    });
    expect(action.kind).toBe("none");
  });
});

describe("deriveGrowthFunnelFlags", () => {
  it("maps milestones and activation to funnel flags", () => {
    const flags = deriveGrowthFunnelFlags({
      lifecycleState: "growing",
      preludeDismissedAtMs: null,
      isActivated: true,
      milestones: {
        sessionOpenedAtMs: 1,
        identityCompletedAtMs: 2,
        firstSkillInstalledAtMs: 3,
        firstMissionSentAtMs: 4,
        firstMissionSuccessAtMs: null,
      },
    });
    expect(flags).toEqual({
      hasSessionOpened: true,
      hasIdentityCompleted: true,
      hasFirstSkillInstalled: true,
      hasFirstMissionSent: true,
      hasFirstMissionSuccess: true,
      preludeDismissed: false,
    });
  });
});
