import { describe, expect, it } from "vitest";
import { decideParticipantsForTest } from "./__fixtures__/runtime-authority-test-utils.js";
import { buildPolicyDecisionRecord } from "./policy-decision-record.js";
import { compileEffectivePolicyFromScope } from "./resolve-effective-policy.js";
import { projectRuntimeFacts } from "./runtime-authority.js";
import type { CollaborationBotTarget, CollaborationDispatchScope } from "./types.js";

function createBot(params: {
  agentId: string;
  name: string;
  updatedAt: number;
}): CollaborationBotTarget {
  return {
    agentId: params.agentId,
    name: params.name,
    sessionKey: `agent:${params.agentId}:main:space:alpha`,
    updatedAt: params.updatedAt,
  };
}

function createScope(): CollaborationDispatchScope {
  return {
    groupId: "alpha",
    rawSessionKey: "space:alpha",
    title: "Alpha Group",
    operatingState: {
      groupId: "alpha",
      groupProfile: {
        displayName: "Alpha Group",
        expectedOutputs: [],
        successCriteria: [],
        collaborationMode: "discussion_driven",
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
          memberId: "bot:bot-a",
          memberKind: "bot",
          label: "Bot A",
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
        waitingForHuman: true,
        summary: "test",
        updatedAtMs: 1,
      },
      onboardingStatus: { initialized: true },
      groupMemoryRefs: { latestCapsuleIds: [] },
      updatedAtMs: 1,
    },
    bots: [
      createBot({ agentId: "bot-a", name: "Bot A", updatedAt: 10 }),
      createBot({ agentId: "bot-c", name: "Bot C", updatedAt: 30 }),
    ],
  };
}

describe("buildPolicyDecisionRecord", () => {
  it("records why the selected bots ran against the compiled policy hash", () => {
    const scope = createScope();
    const decision = decideParticipantsForTest({
      message: "@bot-a 请分析",
      scope,
      roundId: "round-pdr",
    });
    const effective = compileEffectivePolicyFromScope(scope);
    const record = buildPolicyDecisionRecord({
      decision,
      effective,
      facts: projectRuntimeFacts(scope),
    });

    expect(record.roundId).toBe("round-pdr");
    expect(record.protocolVersion).toBe("1.1");
    expect(record.mode).toBe("discussion_driven");
    expect(record.policyConstraints).toEqual([]);
    expect(record.effectivePolicyHash).toHaveLength(64);
    expect(record.participants[0]).toMatchObject({
      agentId: "bot-a",
      tier: "primary",
      reason: "Bot A 已被点名",
    });
  });
});
