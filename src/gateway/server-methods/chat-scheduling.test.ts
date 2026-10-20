import { describe, expect, test } from "vitest";
import { selectGroupDiscussionBotsForScope } from "../collaboration-dispatch/decision-engine.js";
import type {
  CollaborationBotTarget as GroupDiscussionBotTarget,
  CollaborationDispatchScope as GroupDiscussionScope,
} from "../collaboration-dispatch/types.js";

function createBot(params: {
  agentId: string;
  name: string;
  updatedAt: number;
}): GroupDiscussionBotTarget {
  return {
    agentId: params.agentId,
    name: params.name,
    sessionKey: `agent:${params.agentId}:main:space:alpha`,
    updatedAt: params.updatedAt,
  };
}

function createScope(
  phase: NonNullable<
    GroupDiscussionScope["operatingState"]
  >["activeContext"]["currentOperatingPhase"],
): GroupDiscussionScope {
  return {
    groupId: "alpha",
    rawSessionKey: "space:alpha",
    title: "Alpha Group",
    members: {
      humans: [{ userId: "user-1", name: "UPBEYOND", status: "active" }],
      bots: [
        { agentId: "bot-a", name: "Bot A", status: "active" },
        { agentId: "bot-b", name: "Bot B", status: "active" },
        { agentId: "bot-c", name: "Bot C", status: "active" },
        { agentId: "bot-d", name: "Bot D", status: "active" },
      ],
    },
    operatingState: {
      groupId: "alpha",
      groupProfile: {
        displayName: "Alpha Group",
        expectedOutputs: ["task", "review", "decision", "deliverable", "capsule"],
        successCriteria: [],
      },
      governance: {
        ownerUserId: "user-1",
        adminUserIds: [],
        coordinatorBotId: "bot-c",
      },
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
          memberId: "human:user-1",
          memberKind: "human",
          label: "UPBEYOND",
          governanceRole: "owner",
          status: "active",
        },
        {
          memberId: "bot:bot-a",
          memberKind: "bot",
          label: "Bot A",
          governanceRole: "member",
          collaborationRole: "final_decider",
          status: "active",
        },
        {
          memberId: "bot:bot-b",
          memberKind: "bot",
          label: "Bot B",
          governanceRole: "member",
          collaborationRole: "reviewer",
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
        {
          memberId: "bot:bot-d",
          memberKind: "bot",
          label: "Bot D",
          governanceRole: "member",
          collaborationRole: "contributor",
          status: "active",
        },
      ],
      activeContext: {
        currentOperatingPhase: phase,
        waitingForHuman: true,
        summary: "test",
        updatedAtMs: 1,
      },
      onboardingStatus: {
        initialized: true,
      },
      groupMemoryRefs: {
        latestCapsuleIds: [],
      },
      updatedAtMs: 1,
    },
    bots: [
      createBot({ agentId: "bot-a", name: "Bot A", updatedAt: 10 }),
      createBot({ agentId: "bot-b", name: "Bot B", updatedAt: 20 }),
      createBot({ agentId: "bot-c", name: "Bot C", updatedAt: 30 }),
      createBot({ agentId: "bot-d", name: "Bot D", updatedAt: 40 }),
    ],
  };
}

describe("group chat scheduling", () => {
  test("decide phase reserves visible slots for coordinator, final decider, and reviewer", () => {
    const selected = selectGroupDiscussionBotsForScope({
      message: "请大家收敛一下决策建议",
      scope: createScope("decide"),
    });

    expect(selected.map((bot) => bot.agentId)).toEqual(["bot-a", "bot-b"]);
  });

  test("debate phase reserves visible slots for reviewer, decision advisor, and coordinator", () => {
    const scope = createScope("debate");
    scope.operatingState?.memberRoleMap.splice(3, 0, {
      memberId: "bot:bot-e",
      memberKind: "bot",
      label: "Bot E",
      governanceRole: "member",
      collaborationRole: "decision_advisor",
      status: "active",
    });
    scope.members?.bots.push({ agentId: "bot-e", name: "Bot E", status: "active" });
    scope.bots.unshift(createBot({ agentId: "bot-e", name: "Bot E", updatedAt: 5 }));

    const selected = selectGroupDiscussionBotsForScope({
      message: "请大家批判一下现有方案",
      scope,
    });

    expect(selected.map((bot) => bot.agentId)).toEqual(["bot-b", "bot-e", "bot-c"]);
  });

  test("@human suppresses bot replies even when operating state exists", () => {
    const selected = selectGroupDiscussionBotsForScope({
      message: "@UPBEYOND 你来拍板",
      scope: createScope("decide"),
    });

    expect(selected).toEqual([]);
  });

  test("open discussion deprioritizes bots that replied most recently", () => {
    const scope = createScope("explore");
    if (scope.operatingState) {
      scope.operatingState.governance.coordinatorBotId = null;
      scope.operatingState.memberRoleMap = scope.operatingState.memberRoleMap.filter(
        (entry) => entry.memberKind !== "bot",
      );
    }
    scope.recentAssistantBotIds = ["bot-d", "bot-c"];

    const selected = selectGroupDiscussionBotsForScope({
      message: "继续开放讨论",
      scope,
    });

    expect(selected.map((bot) => bot.agentId)).toEqual(["bot-b", "bot-a"]);
  });

  test("low-signal acknowledgement rounds only schedule one visible bot reply", () => {
    const selected = selectGroupDiscussionBotsForScope({
      message: "OK，非常好。现在大家都彼此算是认识了。",
      scope: createScope("explore"),
    });

    expect(selected.map((bot) => bot.agentId)).toEqual(["bot-c"]);
  });
});
