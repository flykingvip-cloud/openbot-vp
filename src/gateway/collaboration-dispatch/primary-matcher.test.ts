import { describe, expect, it } from "vitest";
import { BUILTIN_STEWARD_AGENT_ID } from "../../agents/builtin-steward/identity.js";
import { nominatePrimarySpeaker } from "./primary-matcher.js";
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

function scope(bots: CollaborationBotTarget[]): CollaborationDispatchScope {
  return {
    groupId: "alpha",
    rawSessionKey: "space:alpha",
    title: "Alpha",
    bots,
    operatingState: {
      groupId: "alpha",
      groupProfile: {
        displayName: "Alpha",
        expectedOutputs: [],
        successCriteria: [],
        currentMission: "分析记忆系统",
      },
      governance: { adminUserIds: [] },
      collaborationPolicy: {
        humanStartsNewRound: true,
        mentionBotMustRespond: false,
        mentionHumanNotifiesOnly: true,
        openDiscussionWithoutMention: false,
        maxVisibleBotRepliesPerRound: 5,
        botMaySelfAdvanceWithoutHuman: false,
        entersWaitingForHumanAfterVisibleTurnsExhausted: true,
      },
      memberRoleMap: bots.map((entry) => ({
        memberId: `bot:${entry.agentId}`,
        memberKind: "bot" as const,
        label: entry.name,
        governanceRole: "member" as const,
        collaborationRole:
          entry.agentId === "bot-memory" ? ("contributor" as const) : ("reviewer" as const),
        status: "active" as const,
      })),
      activeContext: {
        currentOperatingPhase: "deliver",
        currentMission: "分析记忆系统",
        waitingForHuman: false,
        summary: "分析记忆系统",
        updatedAtMs: 1,
      },
      onboardingStatus: { initialized: true },
      groupMemoryRefs: { latestCapsuleIds: [] },
      updatedAtMs: 1,
    },
  };
}

describe("nominatePrimarySpeaker", () => {
  it("never nominates the builtin steward", () => {
    const nomination = nominatePrimarySpeaker({
      facts: projectRuntimeFacts(
        scope([bot(BUILTIN_STEWARD_AGENT_ID, "大白管家"), bot("bot-memory", "记忆分析")]),
      ),
      message: "请分析记忆系统",
      bots: [bot(BUILTIN_STEWARD_AGENT_ID, "大白管家"), bot("bot-memory", "记忆分析")],
    });
    expect(nomination?.bot.agentId).toBe("bot-memory");
  });

  it("returns null when confidence is too low", () => {
    const nomination = nominatePrimarySpeaker({
      facts: projectRuntimeFacts(scope([bot("bot-a", "AAA")])),
      message: "??",
      bots: [bot("bot-a", "AAA")],
    });
    expect(nomination).toBeNull();
  });
});
