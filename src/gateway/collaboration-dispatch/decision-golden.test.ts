import { describe, expect, it } from "vitest";
import { decideParticipantsForTest } from "./__fixtures__/runtime-authority-test-utils.js";
import { decideParticipants } from "./decision-engine.js";
import { createRoundPolicySnapshotFromScope } from "./round-policy-snapshot.js";
import type { CollaborationBotTarget, CollaborationDispatchScope } from "./types.js";

function createBot(agentId: string, name: string): CollaborationBotTarget {
  return {
    agentId,
    name,
    sessionKey: `agent:${agentId}:main:space:gold`,
    updatedAt: 1,
  };
}

function createScope(overrides?: {
  maxVisible?: number;
  openDiscussion?: boolean;
}): CollaborationDispatchScope {
  const bots = [
    createBot("bot-a", "Bot A"),
    createBot("bot-b", "Bot B"),
    createBot("bot-c", "Bot C"),
  ];
  return {
    groupId: "gold",
    rawSessionKey: "space:gold",
    title: "Gold Group",
    bots,
    members: {
      humans: [{ userId: "user-1", name: "Owner", status: "active" }],
      bots: bots.map((b) => ({ agentId: b.agentId, name: b.name, status: "active" as const })),
    },
    operatingState: {
      groupId: "gold",
      groupProfile: {
        displayName: "Gold Group",
        expectedOutputs: ["task"],
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
        mentionBotMustRespond: false,
        mentionHumanNotifiesOnly: true,
        openDiscussionWithoutMention: overrides?.openDiscussion ?? true,
        maxVisibleBotRepliesPerRound: overrides?.maxVisible ?? 3,
        botMaySelfAdvanceWithoutHuman: false,
        entersWaitingForHumanAfterVisibleTurnsExhausted: true,
      },
      memberRoleMap: [],
      activeContext: {
        currentOperatingPhase: "deliver",
        currentMission: "ship",
        waitingForHuman: false,
        summary: "test",
        updatedAtMs: 1,
      },
      onboardingStatus: { initialized: true },
      groupMemoryRefs: { latestCapsuleIds: [] },
      updatedAtMs: 1,
    } as CollaborationDispatchScope["operatingState"],
  };
}

function stableDecisionBytes(decision: ReturnType<typeof decideParticipants>): string {
  const stable = {
    responseMode: decision.responseMode,
    primaryMode: decision.primaryMode,
    mentionMode: decision.mentionMode,
    primaryQueue: decision.primaryQueue,
    mentionUnmatched: decision.mentionUnmatched,
    participantAgentIds: decision.executionBots.map((b) => b.agentId),
    planParticipants: decision.roundPlan.participants.map((p) => ({
      agentId: p.agentId,
      tier: p.tier,
      contributionRole: p.contributionRole,
    })),
  };
  return JSON.stringify(stable);
}

describe("decision-golden (P0.0b)", () => {
  const messages = ["请分析一下这个方案", "大家好", "@Bot A 你怎么看", "都在吗"];
  const matrix = [
    { maxVisible: 3, openDiscussion: true },
    { maxVisible: 5, openDiscussion: false },
    { maxVisible: 1, openDiscussion: true },
  ];

  it("flag-off path (no snapshot) vs injected snapshot: decision bytes identical", () => {
    for (const cfg of matrix) {
      const scope = createScope(cfg);
      const snapshot = createRoundPolicySnapshotFromScope(scope, {
        now: 100,
        idGen: () => `pss_gold_${cfg.maxVisible}_${cfg.openDiscussion}`,
      });
      for (const message of messages) {
        const without = decideParticipantsForTest({
          message,
          scope,
          roundId: "gold-round",
        });
        const withSnap = decideParticipantsForTest({
          message,
          scope,
          roundId: "gold-round",
          policySnapshot: snapshot,
        });
        expect(stableDecisionBytes(withSnap)).toBe(stableDecisionBytes(without));
      }
    }
  });
});
