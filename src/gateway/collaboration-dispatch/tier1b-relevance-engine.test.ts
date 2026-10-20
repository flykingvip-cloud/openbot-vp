import { describe, expect, test } from "vitest";
import { projectRuntimeFacts } from "./runtime-authority.js";
import { scoreRelevanceBot, selectTier1Participants } from "./tier1b-relevance-engine.js";
import type { CollaborationBotTarget, CollaborationDispatchScope } from "./types.js";

function createBot(agentId: string, name: string): CollaborationBotTarget {
  return {
    agentId,
    name,
    sessionKey: `agent:${agentId}:main:space:alpha`,
    updatedAt: 10,
  };
}

function createScope(): CollaborationDispatchScope {
  return {
    groupId: "alpha",
    rawSessionKey: "space:alpha",
    title: "Alpha",
    operatingState: {
      groupId: "alpha",
      groupProfile: {
        displayName: "Alpha",
        expectedOutputs: [],
        successCriteria: [],
      },
      governance: { ownerUserId: "u1", adminUserIds: [], coordinatorBotId: "bot-c" },
      collaborationPolicy: {
        humanStartsNewRound: true,
        mentionBotMustRespond: true,
        mentionHumanNotifiesOnly: true,
        openDiscussionWithoutMention: true,
        maxVisibleBotRepliesPerRound: 3,
        botMaySelfAdvanceWithoutHuman: false,
        entersWaitingForHumanAfterVisibleTurnsExhausted: true,
      },
      memberRoleMap: [
        {
          memberId: "bot:bot-a",
          memberKind: "bot",
          label: "市场助手",
          governanceRole: "member",
          collaborationRole: "contributor",
          status: "active",
        },
        {
          memberId: "bot:bot-c",
          memberKind: "bot",
          label: "Bot C",
          governanceRole: "member",
          collaborationRole: "coordinator",
          status: "active",
        },
      ],
      activeContext: {
        currentOperatingPhase: "explore",
        waitingForHuman: false,
        summary: "团队介绍",
        updatedAtMs: 1,
      },
      onboardingStatus: { initialized: true },
      groupMemoryRefs: { latestCapsuleIds: [] },
      updatedAtMs: 1,
    },
    bots: [createBot("bot-a", "市场助手"), createBot("bot-c", "Bot C")],
  };
}

describe("tier1b relevance engine", () => {
  test("scores higher when bot display name appears in message", () => {
    const scope = createScope();
    const marketBot = scope.bots[0];
    const facts = projectRuntimeFacts(scope);
    const genericScore = scoreRelevanceBot({
      facts,
      bot: marketBot,
      message: "各位介绍一下",
    });
    const directScore = scoreRelevanceBot({
      facts,
      bot: marketBot,
      message: "请市场助手先介绍一下",
    });
    expect(directScore).toBeGreaterThan(genericScore);
  });

  test("duty-only mode returns single highest-duty bot", () => {
    const selected = selectTier1Participants({
      facts: projectRuntimeFacts(createScope()),
      message: "收到",
      bots: createScope().bots,
      visibleReplyLimit: 3,
      dutyOnly: true,
    });
    expect(selected).toHaveLength(1);
    expect(selected[0]?.tier).toBe("duty");
  });

  test("labels bot as relevance tier when message strongly matches bot", () => {
    const selected = selectTier1Participants({
      facts: projectRuntimeFacts(createScope()),
      message: "请市场助手介绍一下你的职责",
      bots: createScope().bots,
      visibleReplyLimit: 2,
      dutyOnly: false,
    });
    const market = selected.find((entry) => entry.bot.agentId === "bot-a");
    expect(market?.tier).toBe("relevance");
    expect(market?.reasonText).toContain("市场助手");
  });
});
