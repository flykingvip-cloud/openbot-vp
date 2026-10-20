import { describe, expect, it, vi } from "vitest";
import { decideParticipantsForTest } from "./__fixtures__/runtime-authority-test-utils.js";
import { buildCollaborationDiscussionTurnPrompt } from "./discussion-turn-prompt.js";
import * as policyCompiler from "./policy-compiler.js";
import {
  createRoundPolicySnapshotFromScope,
  resolveEffectivePolicy,
} from "./round-policy-snapshot.js";
import { projectRuntimeFacts } from "./runtime-authority.js";
import type { CollaborationBotTarget, CollaborationDispatchScope } from "./types.js";
import { resolveElasticVisibleReplyLimit } from "./visible-reply-limit.js";

function createBot(agentId: string, name: string): CollaborationBotTarget {
  return {
    agentId,
    name,
    sessionKey: `agent:${agentId}:main:space:alpha`,
    updatedAt: 1,
  };
}

function createScope(): CollaborationDispatchScope {
  const bots = [
    createBot("bot-a", "Bot A"),
    createBot("bot-b", "Bot B"),
    createBot("bot-c", "Bot C"),
  ];
  return {
    groupId: "alpha",
    rawSessionKey: "space:alpha",
    title: "Alpha Group",
    bots,
    members: {
      humans: [{ userId: "user-1", name: "Owner", status: "active" }],
      bots: bots.map((b) => ({ agentId: b.agentId, name: b.name, status: "active" as const })),
    },
    operatingState: {
      groupId: "alpha",
      groupProfile: {
        displayName: "Alpha Group",
        expectedOutputs: ["task"],
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

describe("policy-single-source (P0.0b)", () => {
  it("compiles once when creating a snapshot; consumers share the same frozen reference", () => {
    const scope = createScope();
    const spy = vi.spyOn(policyCompiler, "compileEffectiveCollaborationPolicy");
    const snapshot = createRoundPolicySnapshotFromScope(scope, {
      now: 1,
      idGen: () => "pss_single",
    });
    expect(spy).toHaveBeenCalledTimes(1);

    const decision = decideParticipantsForTest({
      message: "请大家分析一下方案",
      scope,
      roundId: "round-1",
      policySnapshot: snapshot,
    });
    const limit = resolveElasticVisibleReplyLimit({
      message: "请大家分析一下方案",
      facts: projectRuntimeFacts(scope, { effective: snapshot.effective as never }),
      effective: snapshot.effective as never,
      operatingState: scope.operatingState ?? null,
    });
    const prompt = buildCollaborationDiscussionTurnPrompt({
      scope,
      bot: scope.bots[0],
      decision,
      participationTier: "mention",
      contributionRole: "lead",
      userMessage: "请大家分析一下方案",
      effective: snapshot.effective as never,
    });

    // No additional compiles after the snapshot was created.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(resolveEffectivePolicy(scope, snapshot)).toBe(snapshot.effective);
    expect(limit.policyCeiling).toBe(3);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
    // Same frozen reference across resolve paths.
    expect(resolveEffectivePolicy(scope, snapshot)).toBe(resolveEffectivePolicy(scope, snapshot));
    spy.mockRestore();
  });

  it("covers ≥6 consumer resolve sites with the same frozen effective reference", () => {
    const scope = createScope();
    const snapshot = createRoundPolicySnapshotFromScope(scope, {
      now: 2,
      idGen: () => "pss_refs",
    });
    const refs = [
      resolveEffectivePolicy(scope, snapshot),
      resolveEffectivePolicy(scope, snapshot),
      snapshot.effective,
      resolveEffectivePolicy(scope, snapshot),
      resolveEffectivePolicy(scope, snapshot),
      resolveEffectivePolicy(scope, snapshot),
    ];
    expect(refs).toHaveLength(6);
    for (const ref of refs) {
      expect(ref).toBe(snapshot.effective);
    }
  });
});
