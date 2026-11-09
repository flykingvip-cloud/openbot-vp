import { describe, expect, test } from "vitest";
import { projectRuntimeFacts } from "./runtime-authority.js";
import type { CollaborationDispatchScope } from "./types.js";
import {
  classifyOpenDiscussionLimitMode,
  resolveElasticVisibleReplyLimit,
} from "./visible-reply-limit.js";

function createScope(botCount: number, policyMax = 3): CollaborationDispatchScope {
  const bots = Array.from({ length: botCount }, (_, index) => ({
    agentId: `bot-${index + 1}`,
    name: `Bot ${index + 1}`,
    sessionKey: `agent:bot-${index + 1}:main:space:alpha`,
    updatedAt: index,
  }));
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
      },
      governance: { ownerUserId: "u1", adminUserIds: [], coordinatorBotId: "bot-1" },
      collaborationPolicy: {
        humanStartsNewRound: true,
        mentionBotMustRespond: true,
        mentionHumanNotifiesOnly: true,
        openDiscussionWithoutMention: true,
        maxVisibleBotRepliesPerRound: policyMax,
        botMaySelfAdvanceWithoutHuman: false,
        entersWaitingForHumanAfterVisibleTurnsExhausted: true,
      },
      memberRoleMap: [],
      activeContext: {
        currentOperatingPhase: "explore",
        summary: "Alpha round",
        waitingForHuman: false,
        updatedAtMs: 1,
      },
      onboardingStatus: { initialized: true },
      groupMemoryRefs: { latestCapsuleIds: [] },
      updatedAtMs: 1,
    },
  };
}

function resolveLimit(message: string, scope: CollaborationDispatchScope) {
  return resolveElasticVisibleReplyLimit({
    message,
    facts: projectRuntimeFacts(scope),
    operatingState: scope.operatingState ?? null,
  });
}

describe("elastic visible reply limit", () => {
  test("classifies empty greetings as idle and introductions as broadcast", () => {
    expect(classifyOpenDiscussionLimitMode("大家好")).toBe("chitchat_idle");
    expect(classifyOpenDiscussionLimitMode("下午好")).toBe("chitchat_idle");
    expect(classifyOpenDiscussionLimitMode("各位介绍一下自己")).toBe("group_broadcast");
    expect(classifyOpenDiscussionLimitMode("其他人在吗")).toBe("group_broadcast");
    expect(classifyOpenDiscussionLimitMode("其它人在吗")).toBe("group_broadcast");
    expect(classifyOpenDiscussionLimitMode("都在吗")).toBe("group_broadcast");
    expect(classifyOpenDiscussionLimitMode("还有人吗")).toBe("group_broadcast");
    expect(classifyOpenDiscussionLimitMode("各位在吗")).toBe("group_broadcast");
    expect(classifyOpenDiscussionLimitMode("人都在吗")).toBe("group_broadcast");
    expect(classifyOpenDiscussionLimitMode("谁还在")).toBe("group_broadcast");
  });

  test("room greeting remains one even on an introduction mission", () => {
    const intro = createScope(4, 3);
    if (intro.operatingState) {
      intro.operatingState.activeContext.currentMission = "完成成员介绍并建立协作上下文";
    }
    expect(classifyOpenDiscussionLimitMode("大家好", projectRuntimeFacts(intro))).toBe(
      "chitchat_idle",
    );
    expect(classifyOpenDiscussionLimitMode("下午好", projectRuntimeFacts(intro))).toBe(
      "chitchat_idle",
    );
    const resolved = resolveLimit("大家好", intro);
    expect(resolved.mode).toBe("chitchat_idle");
    expect(resolved.limit).toBe(1);
  });

  test("classifies task directives as focused", () => {
    expect(classifyOpenDiscussionLimitMode("请分析现有方案并给出决策建议")).toBe("focused_task");
  });

  test("empty greetings keep a floor of one visible reply", () => {
    const resolved = resolveLimit("大家好", createScope(6, 3));
    expect(resolved.mode).toBe("chitchat_idle");
    expect(resolved.limit).toBeGreaterThanOrEqual(1);
    expect(resolved.limit).toBe(1);
  });

  test("afternoon greeting also keeps chitchat floor of one", () => {
    const resolved = resolveLimit("下午好", createScope(6, 3));
    expect(resolved.mode).toBe("chitchat_idle");
    expect(resolved.limit).toBeGreaterThanOrEqual(1);
  });

  test("broadcast expands introductions even when policy ceiling is 3", () => {
    const resolved = resolveLimit("各位介绍一下自己", createScope(6, 3));
    expect(resolved.mode).toBe("group_broadcast");
    expect(resolved.limit).toBe(6);
  });

  test("focused task respects policy ceiling", () => {
    const resolved = resolveLimit("请分析方案风险", createScope(6, 3));
    expect(resolved.mode).toBe("focused_task");
    expect(resolved.limit).toBe(3);
  });

  test("low signal stays at one", () => {
    const resolved = resolveLimit("收到，非常好", createScope(6, 5));
    expect(resolved.mode).toBe("low_signal");
    expect(resolved.limit).toBe(1);
  });

  test("knowledge-question classifier never exceeds the operating-state ceiling", () => {
    const resolved = resolveLimit("谁知道端午节的由来？", createScope(6, 1));
    expect(resolved.limit).toBe(1);
    expect(resolved.policyCeiling).toBe(1);
  });

  test("missing operating state uses compiled L1 policy default (3), not legacy scan constant", () => {
    const scope: CollaborationDispatchScope = {
      groupId: "alpha",
      rawSessionKey: "space:alpha",
      title: "Alpha",
      bots: Array.from({ length: 6 }, (_, index) => ({
        agentId: `bot-${index + 1}`,
        name: `Bot ${index + 1}`,
        sessionKey: `agent:bot-${index + 1}:main:space:alpha`,
        updatedAt: index,
      })),
    };
    const resolved = resolveLimit("请分析方案风险", scope);
    expect(resolved.policyCeiling).toBe(3);
    expect(resolved.limit).toBe(3);
  });
});
