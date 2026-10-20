import { describe, expect, test } from "vitest";
import {
  evaluateCheapGate,
  primaryInvitesSupplementInput,
  shouldDispatchCheapGate,
} from "./cheap-gate.js";
import { DEFAULT_COLLABORATION_POLICY } from "./policy.js";
import { projectRuntimeFacts } from "./runtime-authority.js";
import type { CollaborationBotTarget, CollaborationDispatchScope } from "./types.js";

function bot(agentId: string, name: string): CollaborationBotTarget {
  return {
    agentId,
    name,
    sessionKey: `agent:${agentId}:main`,
    updatedAt: 1,
  };
}

function scope(): CollaborationDispatchScope {
  return {
    groupId: "alpha",
    rawSessionKey: "space:alpha",
    title: "Alpha",
    operatingState: {
      groupId: "alpha",
      groupProfile: { displayName: "Alpha", expectedOutputs: [], successCriteria: [] },
      governance: { adminUserIds: [], coordinatorBotId: "bot-c" },
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
          memberId: "bot:bot-c",
          memberKind: "bot",
          governanceRole: "member",
          collaborationRole: "coordinator",
          status: "active",
        },
        {
          memberId: "bot:bot-a",
          memberKind: "bot",
          governanceRole: "member",
          collaborationRole: "contributor",
          status: "active",
        },
        {
          memberId: "bot:bot-r",
          memberKind: "bot",
          governanceRole: "member",
          collaborationRole: "reviewer",
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
    bots: [bot("bot-a", "Bot A"), bot("bot-c", "Bot C")],
  };
}

describe("cheap gate", () => {
  test("drops supplements in single_owner mode without creating a keep", () => {
    const result = evaluateCheapGate({
      facts: projectRuntimeFacts(scope()),
      bot: bot("bot-a", "Bot A"),
      message: "谁知道端午节的由来？",
      policy: DEFAULT_COLLABORATION_POLICY,
      responseMode: "single_owner",
      keptCount: 0,
    });
    expect(result.decision).toBe("DROP");
    expect(result.reason).toBe("policy_disabled");
    expect(shouldDispatchCheapGate(result)).toBe(false);
  });

  test("drops unmentioned coordinator supplements", () => {
    const result = evaluateCheapGate({
      facts: projectRuntimeFacts(scope()),
      bot: bot("bot-c", "Bot C"),
      message: "请分析一下这个方案的风险",
      policy: DEFAULT_COLLABORATION_POLICY,
      responseMode: "lead_plus_supplement",
      keptCount: 0,
    });
    expect(result.decision).toBe("DROP");
    expect(result.reason).toBe("role_mismatch");
  });

  test("keeps reviewers only for debate/review rounds", () => {
    const reviewDrop = evaluateCheapGate({
      facts: projectRuntimeFacts(scope()),
      bot: bot("bot-r", "Bot R"),
      message: "请分析一下这个方案的风险",
      policy: DEFAULT_COLLABORATION_POLICY,
      responseMode: "lead_plus_supplement",
      keptCount: 0,
    });
    expect(reviewDrop).toEqual({ decision: "DROP", reason: "role_mismatch" });

    const reviewKeep = evaluateCheapGate({
      facts: projectRuntimeFacts(scope()),
      bot: bot("bot-r", "Bot R"),
      message: "请批判一下现有方案",
      policy: DEFAULT_COLLABORATION_POLICY,
      responseMode: "debate_or_brainstorm",
      keptCount: 0,
    });
    expect(reviewKeep.reason).not.toBe("role_mismatch");

    const preserveConflictKeep = evaluateCheapGate({
      facts: projectRuntimeFacts(scope()),
      bot: bot("bot-r", "Bot R"),
      message: "请分析一下这个方案的风险",
      policy: DEFAULT_COLLABORATION_POLICY,
      responseMode: "lead_plus_supplement",
      keptCount: 0,
      preserveConflict: true,
    });
    expect(preserveConflictKeep.reason).not.toBe("role_mismatch");

    const edgeChallengeKeep = evaluateCheapGate({
      facts: projectRuntimeFacts(scope()),
      bot: bot("bot-r", "Bot R"),
      message: "请分析一下这个方案的风险",
      policy: DEFAULT_COLLABORATION_POLICY,
      responseMode: "lead_plus_supplement",
      keptCount: 0,
      edgeKinds: ["challenge"],
    });
    expect(edgeChallengeKeep.reason).not.toBe("role_mismatch");
  });

  test("explicitly invited (@mention / broadcast) bots are never dropped for low_relevance", () => {
    const base = {
      facts: projectRuntimeFacts(scope()),
      bot: bot("bot-a", "Bot A"),
      message: "其他人呢",
      policy: DEFAULT_COLLABORATION_POLICY,
      responseMode: "lead_plus_supplement",
    };
    const uninvited = evaluateCheapGate({ ...base, keptCount: 0 });
    expect(uninvited.decision).toBe("DROP");
    expect(uninvited.reason).toBe("low_relevance");
    expect(typeof uninvited.relevance).toBe("number");

    const invited = evaluateCheapGate({ ...base, keptCount: 0, invited: true });
    expect(invited).toMatchObject({ decision: "KEEP", reason: "explicitly_invited" });

    // Supplement budget does not cut invited bots (runtime bounds them by visible cap).
    const overBudget = evaluateCheapGate({ ...base, keptCount: 99, invited: true });
    expect(overBudget.decision).toBe("KEEP");

    // Invited coordinator is not role-dropped.
    const invitedCoordinator = evaluateCheapGate({
      ...base,
      bot: bot("bot-c", "Bot C"),
      keptCount: 0,
      invited: true,
    });
    expect(invitedCoordinator.decision).toBe("KEEP");
  });

  test("edge targets are never dropped for low_relevance, including single_owner rounds", () => {
    for (const responseMode of ["lead_plus_supplement", "single_owner"]) {
      const result = evaluateCheapGate({
        facts: projectRuntimeFacts(scope()),
        bot: bot("bot-a", "Bot A"),
        message: "其他人呢",
        policy: DEFAULT_COLLABORATION_POLICY,
        responseMode,
        keptCount: 0,
        edgeKinds: ["handoff"],
      });
      expect(result).toMatchObject({ decision: "KEEP", reason: "edge_invited" });
    }
  });

  test("disabled supplements still drop invited and edge candidates (group policy wins)", () => {
    const result = evaluateCheapGate({
      facts: projectRuntimeFacts(scope()),
      bot: bot("bot-a", "Bot A"),
      message: "其他人呢",
      policy: {
        ...DEFAULT_COLLABORATION_POLICY,
        supplement: { ...DEFAULT_COLLABORATION_POLICY.supplement, enabled: false },
      },
      responseMode: "lead_plus_supplement",
      keptCount: 0,
      invited: true,
      edgeKinds: ["peer_ask"],
    });
    expect(result).toEqual({ decision: "DROP", reason: "policy_disabled" });
  });

  test("detects when a primary reply invites other members' input", () => {
    const bots = [bot("bot-a", "市场助手"), bot("bot-b", "高密度分析")];
    expect(primaryInvitesSupplementInput({ text: "结论如上，请其他成员补充。", bots })).toBe(true);
    expect(primaryInvitesSupplementInput({ text: "结论如上，高密度分析可再看风险。", bots })).toBe(
      true,
    );
    expect(
      primaryInvitesSupplementInput({
        text: "我是市场助手，结论如上。",
        bots,
        excludeAgentIds: new Set(["bot-a"]),
      }),
    ).toBe(false);
    expect(primaryInvitesSupplementInput({ text: "结论：按计划推进。", bots })).toBe(false);
  });
});
