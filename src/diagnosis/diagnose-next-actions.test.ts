import { describe, expect, it } from "vitest";
import type { DiagnoseGrowthAssessment } from "./diagnose-growth-assessment.js";
import { buildDiagnoseConversationActions } from "./diagnose-next-actions.js";

function base(over: Partial<DiagnoseGrowthAssessment> = {}): DiagnoseGrowthAssessment {
  return {
    agentId: "bot-skill",
    tenantId: "001",
    agentAssetId: "asset-1",
    targetOwnerId: "owner-1",
    groupId: null,
    objectLabel: "Skill孵化",
    displayName: "Skill孵化",
    identity: {
      readable: true,
      bootstrapPending: false,
      identityInitialized: true,
      userInitialized: true,
    },
    memory: { present: true, fresh: true },
    hadTaskActivity: true,
    memoryJudgedMissing: false,
    capable: [],
    unstable: [],
    unused: ["data-analysis"],
    baselineGapCandidates: [],
    existingJobNames: [],
    identityMissingFields: [],
    userMissingFields: [],
    installedSkillIds: ["data-analysis"],
    memoryFileCount: 6,
    reportFileCount: 0,
    freshArtifactCount: 6,
    sessionRoster: { main: 3, cron: 0, other: 0, freshCron: 0, freshMain: 1 },
    activitySources: ["memory_file"],
    roleBaselineInjected: false,
    skillLastSeenMs: {},
    ...over,
  };
}

describe("diagnose conversation next actions", () => {
  it("offers a practice prompt for unused skills and does not treat completed bootstrap as a defect", () => {
    const actions = buildDiagnoseConversationActions([base()]);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.title).toBe("练未观察技能");
    expect(actions[0]?.actor).toBe("diagnosed_agent");
    expect(actions[0]?.handoffChannel).toBe("diagnosed_agent_session");
    expect(actions[0]?.targetSessionKey).toBe("agent:bot-skill:main");
    expect(actions[0]?.agentPrompt).toContain("请用已安装技能");
    expect(actions[0]?.prompt).toContain("data-analysis");
    expect(actions[0]?.prompt).toContain("Skill孵化");
    expect(JSON.stringify(actions)).not.toContain("user.daibai.ask");
    expect(JSON.stringify(actions)).not.toContain("cron.add");
  });

  it("does not invent a repair when identity is confirmed and nothing is unused", () => {
    const actions = buildDiagnoseConversationActions([
      base({ unused: [], installedSkillIds: ["data-analysis"] }),
    ]);
    expect(actions).toEqual([]);
  });

  it("keeps collaboration-group targets on the steward channel", () => {
    const actions = buildDiagnoseConversationActions([base({ groupId: "aegis", agentId: "main" })]);
    expect(actions[0]?.handoffChannel).toBe("steward");
    expect(actions[0]?.targetSessionKey).toBeNull();
  });
});
