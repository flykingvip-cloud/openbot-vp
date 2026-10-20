import { describe, expect, test } from "vitest";
import { pickDutyDifferentiatedSupplement } from "./auto-supplement.js";
import { projectRuntimeFacts } from "./runtime-authority.js";
import type { CollaborationBotTarget, CollaborationDispatchScope } from "./types.js";

function bot(agentId: string, name: string): CollaborationBotTarget {
  return {
    agentId,
    name,
    sessionKey: `agent:${agentId}:main:space:alpha`,
    updatedAt: 1,
  };
}

function scope(): CollaborationDispatchScope {
  return {
    groupId: "alpha",
    rawSessionKey: "space:alpha",
    title: "Alpha",
    bots: [bot("bot-a", "Bot A"), bot("bot-b", "Bot B"), bot("bot-c", "Bot C")],
    operatingState: {
      groupId: "alpha",
      groupProfile: { displayName: "Alpha", expectedOutputs: [], successCriteria: [] },
      governance: { adminUserIds: [], coordinatorBotId: "bot-c" },
      collaborationPolicy: {
        humanStartsNewRound: true,
        mentionBotMustRespond: false,
        mentionHumanNotifiesOnly: true,
        openDiscussionWithoutMention: false,
        maxVisibleBotRepliesPerRound: 5,
        botMaySelfAdvanceWithoutHuman: false,
        entersWaitingForHumanAfterVisibleTurnsExhausted: true,
      },
      memberRoleMap: [
        {
          memberId: "bot:bot-a",
          memberKind: "bot",
          governanceRole: "member",
          collaborationRole: "contributor",
          status: "active",
        },
        {
          memberId: "bot:bot-b",
          memberKind: "bot",
          governanceRole: "member",
          collaborationRole: "contributor",
          status: "active",
        },
        {
          memberId: "bot:bot-c",
          memberKind: "bot",
          governanceRole: "member",
          collaborationRole: "coordinator",
          status: "active",
        },
      ],
      activeContext: {
        currentOperatingPhase: "explore",
        waitingForHuman: false,
        summary: "test",
        updatedAtMs: 1,
      },
      onboardingStatus: { initialized: true },
      groupMemoryRefs: { latestCapsuleIds: [] },
      updatedAtMs: 1,
    },
  };
}

describe("pickDutyDifferentiatedSupplement", () => {
  test("skips the lead and standing coordinator", () => {
    const picked = pickDutyDifferentiatedSupplement({
      facts: projectRuntimeFacts(scope()),
      message: "请分析记忆系统的主要特征",
      leadBots: [bot("bot-a", "Bot A")],
      bots: [bot("bot-a", "Bot A"), bot("bot-b", "Bot B"), bot("bot-c", "Bot C")],
      responseMode: "lead_plus_supplement",
    });
    expect(picked?.agentId).toBe("bot-b");
  });

  test("returns undefined when nobody remains", () => {
    const picked = pickDutyDifferentiatedSupplement({
      facts: projectRuntimeFacts(scope()),
      message: "请分析",
      leadBots: [bot("bot-a", "Bot A"), bot("bot-b", "Bot B")],
      bots: [bot("bot-a", "Bot A"), bot("bot-b", "Bot B"), bot("bot-c", "Bot C")],
      responseMode: "lead_plus_supplement",
    });
    expect(picked).toBeUndefined();
  });
});
