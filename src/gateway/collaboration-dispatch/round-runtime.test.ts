import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  executeCollaborationRoundForTest,
  decideParticipantsForTest,
} from "./__fixtures__/runtime-authority-test-utils.js";
import * as completionContract from "./completion-contract.js";
import * as memberAdmission from "./member-admission.js";
import { DEFAULT_COLLABORATION_POLICY } from "./policy.js";
import * as roundOrchestrator from "./round-orchestrator.js";
import {
  abortPersistedRound,
  applyRoundRecovery,
  decideRoundRecovery,
  recoverIncompleteRounds,
} from "./round-runtime.js";
import { occupancyForRoundState, type PersistedRound } from "./round-state.js";
import {
  applyRoundTransition,
  createPersistedRound,
  readPersistedRound,
  writePersistedRound,
} from "./round-store.js";
import type { CollaborationDispatchScope, ParticipationDecision } from "./types.js";

const botA = {
  agentId: "bot-a",
  name: "Bot A",
  sessionKey: "agent:bot-a:main:space:alpha",
  updatedAt: 1,
};
const botB = {
  agentId: "bot-b",
  name: "Bot B",
  sessionKey: "agent:bot-b:main:space:alpha",
  updatedAt: 2,
};
const botC = {
  agentId: "bot-c",
  name: "Bot C",
  sessionKey: "agent:bot-c:main:space:alpha",
  updatedAt: 3,
};

function policyWithoutWrap() {
  return {
    ...DEFAULT_COLLABORATION_POLICY,
    supplement: { ...DEFAULT_COLLABORATION_POLICY.supplement, enabled: false },
    coordinator: { ...DEFAULT_COLLABORATION_POLICY.coordinator, enabled: false },
  };
}

function createDecision(overrides: Partial<ParticipationDecision> = {}): ParticipationDecision {
  return {
    roundId: "round-live",
    responseMode: "lead_plus_supplement",
    tier0: [],
    tier1: [botA, botB],
    tier2: [],
    executionBots: [botA],
    roundPlan: {
      roundId: "round-live",
      sessionKey: "space:alpha",
      responseMode: "lead_plus_supplement",
      summaryText: "test",
      participants: [
        {
          agentId: "bot-a",
          displayName: "Bot A",
          tier: "duty",
          contributionRole: "lead",
          reasonText: "lead",
        },
      ],
    },
    lowSignalLimited: false,
    mentionUnmatched: false,
    primaryMode: "single",
    mentionMode: "none",
    primaryQueue: ["bot-a"],
    ...overrides,
  };
}

function createScope(): CollaborationDispatchScope {
  return {
    groupId: "alpha",
    rawSessionKey: "space:alpha",
    title: "Alpha",
    bots: [botA, botB],
  };
}

function createCoordinatorScope(): CollaborationDispatchScope {
  return {
    ...createScope(),
    bots: [botA, botB, botC],
    coordinatorBotId: "bot-c",
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
  };
}

function createRespondingRound(roundId: string): PersistedRound {
  return createPersistedRound({
    roundId,
    groupId: "alpha",
    sessionKey: "space:alpha",
    userMessageId: roundId,
    collaborationMode: "lead_plus_supplement",
    policyVersion: "1.0",
    policyHash: "abc",
    policySnapshot: {},
    state: "PRIMARY_RESPONDING",
    primaryMode: "single",
    mentionMode: "none",
    primaryQueue: ["bot-a"],
    primaryCursor: 0,
    currentDispatchId: `${roundId}:primary:bot-a`,
    dispatches: [
      {
        dispatchId: `${roundId}:primary:bot-a`,
        agentId: "bot-a",
        role: "primary",
        attempt: 0,
        status: "running",
        createdAt: Date.now(),
      },
    ],
  });
}

describe("collaboration round runtime contract", () => {
  test("R1: restart at PRIMARY_RESPONDING does not re-run the primary LLM", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-r1-"));
    const persisted = createRespondingRound("round-restart");
    await writePersistedRound({ round: persisted, roundsDir });

    const recovered = await recoverIncompleteRounds({
      groupId: "alpha",
      roundsDir,
    });
    expect(recovered.recovered).toBe(1);

    const loaded = await readPersistedRound({
      groupId: "alpha",
      roundId: "round-restart",
      roundsDir,
    });
    expect(loaded?.state).toBe("ROUND_ABORTED");
    expect(loaded?.occupancy).toBe("none");
    expect(occupancyForRoundState("PRIMARY_RESPONDING")).toBe("executing");

    const calls: string[] = [];
    const replayed = await executeCollaborationRoundForTest({
      decision: createDecision({ roundId: "round-restart" }),
      policy: policyWithoutWrap(),
      scope: createScope(),
      message: "继续这个分析任务",
      sessionKey: "space:alpha",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ dispatchId }) => {
        calls.push(dispatchId);
        return { text: "这是一条完整结论，足够通过完成合同。" };
      },
    });
    expect(calls).toEqual([]);
    expect(replayed.state).toBe("ROUND_ABORTED");
  });

  test("R2: duplicate eventId is skipped and does not advance stateVersion", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-r2-"));
    const round = createPersistedRound({
      roundId: "round-event",
      groupId: "alpha",
      sessionKey: "space:alpha",
      userMessageId: "round-event",
      collaborationMode: "lead_plus_supplement",
      policyVersion: "1.0",
      policyHash: "abc",
      policySnapshot: {},
      state: "ROUND_CREATED",
      primaryMode: "single",
      mentionMode: "none",
      primaryQueue: ["bot-a"],
      primaryCursor: 0,
    });
    const first = await applyRoundTransition({
      round,
      event: "message_received",
      eventType: "ROUND_CREATED",
      eventId: "evt-dup",
      roundsDir,
    });
    const replay = await applyRoundTransition({
      round: first.round,
      event: "message_received",
      eventType: "ROUND_CREATED",
      eventId: "evt-dup",
      roundsDir,
    });
    expect(replay.skipped).toBe(true);
    expect(replay.round.stateVersion).toBe(first.round.stateVersion);
  });

  test("R3: duplicate dispatchId does not start a second primary run", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-r3-"));
    const calls: string[] = [];
    const first = await executeCollaborationRoundForTest({
      decision: createDecision({ roundId: "round-dispatch" }),
      policy: policyWithoutWrap(),
      scope: createScope(),
      message: "请给出明确结论和建议下一步",
      sessionKey: "space:alpha",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ dispatchId }) => {
        calls.push(dispatchId);
        return { text: "结论：应当继续推进，并给出明确下一步。" };
      },
    });
    expect(first.state).toBe("ROUND_COMPLETE");
    expect(calls).toEqual(["round-dispatch:primary:bot-a"]);

    const second = await executeCollaborationRoundForTest({
      decision: createDecision({ roundId: "round-dispatch" }),
      policy: policyWithoutWrap(),
      scope: createScope(),
      message: "请给出明确结论和建议下一步",
      sessionKey: "space:alpha",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ dispatchId }) => {
        calls.push(dispatchId);
        return { text: "重复结论不应当再次生成。" };
      },
    });
    expect(second.state).toBe("ROUND_COMPLETE");
    expect(calls).toEqual(["round-dispatch:primary:bot-a"]);
  });

  test("R4: user Stop persists ROUND_ABORTED with abortRequested", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-r4-"));
    let abortNow = false;
    const round = await executeCollaborationRoundForTest({
      decision: createDecision({ roundId: "round-stop" }),
      policy: policyWithoutWrap(),
      scope: createScope(),
      message: "请给出明确结论和建议下一步",
      sessionKey: "space:alpha",
      roundsDir,
      isAborted: () => abortNow,
      runBot: async () => {
        abortNow = true;
        return { text: "结论：还没说完就被停止。" };
      },
    });
    expect(round.state).toBe("ROUND_ABORTED");
    expect(round.abortRequested).toBe(true);
    expect(round.abortReason).toBe("user_stop");
    expect(round.occupancy).toBe("none");

    const aborted = await abortPersistedRound({
      groupId: "alpha",
      roundId: "round-stop",
      roundsDir,
    });
    expect(aborted?.state).toBe("ROUND_ABORTED");
  });

  test("empty primaryQueue does not hang in PRIMARY_QUEUE", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-empty-q-"));
    const round = await executeCollaborationRoundForTest({
      decision: createDecision({
        roundId: "round-empty-queue",
        mentionUnmatched: false,
        mentionMode: "none",
        primaryQueue: [],
        executionBots: [],
        tier0: [],
        tier1: [],
        tier2: [],
      }),
      policy: policyWithoutWrap(),
      scope: createScope(),
      message: "大家好",
      sessionKey: "space:alpha",
      roundsDir,
      isAborted: () => false,
      runBot: async () => {
        throw new Error("empty queue must not run a bot");
      },
    });
    expect(round.state).toBe("ROUND_ABORTED");
    expect(round.abortReason).toBe("fatal");
  });

  test("unmatched mention stays occupancy none and is superseded by the next message", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-unmatched-"));
    const unmatched = await executeCollaborationRoundForTest({
      decision: createDecision({
        roundId: "round-unmatched",
        mentionUnmatched: true,
        mentionMode: "none",
        primaryQueue: [],
        executionBots: [],
      }),
      policy: policyWithoutWrap(),
      scope: createScope(),
      message: "@nobody 你好",
      sessionKey: "space:alpha",
      roundsDir,
      isAborted: () => false,
      runBot: async () => {
        throw new Error("unmatched must not run a bot");
      },
    });
    expect(unmatched.state).toBe("MENTION_UNMATCHED");
    expect(unmatched.occupancy).toBe("none");

    const next = await executeCollaborationRoundForTest({
      decision: createDecision({ roundId: "round-next" }),
      policy: policyWithoutWrap(),
      scope: createScope(),
      message: "请给出明确结论和建议下一步",
      sessionKey: "space:alpha",
      roundsDir,
      isAborted: () => false,
      runBot: async () => ({ text: "结论：下一轮正常开始并给出建议。" }),
    });
    expect(next.state).toBe("ROUND_COMPLETE");
    const previous = await readPersistedRound({
      groupId: "alpha",
      roundId: "round-unmatched",
      roundsDir,
    });
    expect(previous?.state).toBe("ROUND_ABORTED");
    expect(previous?.abortReason).toBe("superseded");
  });

  test("PRIMARY_RESPONDING recovery table maps to timeout then abort", () => {
    const round = createRespondingRound("round-table");
    const decision = decideRoundRecovery(round, Date.now());
    expect(decision.action).toBe("timeout");
    expect(decision.reason).toBe("restart_no_rerun");
  });

  test("applyRoundRecovery does not invent a second primary dispatch", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-recover-"));
    const round = createRespondingRound("round-recover");
    await writePersistedRound({ round, roundsDir });
    const recovered = await applyRoundRecovery(round, decideRoundRecovery(round, Date.now()), {
      roundsDir,
    });
    expect(recovered.state).toBe("ROUND_ABORTED");
    expect(recovered.dispatches).toHaveLength(1);
  });

  test("R5: live policy mutation after snapshot does not open wrap", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-r5-"));
    const policy = policyWithoutWrap();
    const calls: string[] = [];
    const round = await executeCollaborationRoundForTest({
      decision: createDecision({
        roundId: "round-snapshot",
        tier2: [botC],
        roundPlan: {
          ...createDecision().roundPlan,
          roundId: "round-snapshot",
          participants: [
            ...createDecision().roundPlan.participants,
            {
              agentId: "bot-c",
              displayName: "Bot C",
              tier: "wrap",
              contributionRole: "wrap",
              reasonText: "wrap",
            },
          ],
        },
      }),
      policy,
      scope: createScope(),
      message: "请给出明确结论和建议下一步",
      sessionKey: "space:alpha",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ dispatchId }) => {
        calls.push(dispatchId);
        policy.coordinator.enabled = true;
        policy.supplement.enabled = true;
        return { text: "结论：应当继续推进，并给出明确下一步。" };
      },
    });
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(calls).toEqual(["round-snapshot:primary:bot-a"]);
    expect(round.policyHash).toBeTruthy();
  });

  test("R6: research deadline is at least 60s and does not 15s-takeover", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-r6-"));
    let budgetMs = 0;
    let deadlineFired = false;
    const round = await executeCollaborationRoundForTest({
      decision: createDecision({ roundId: "round-research" }),
      policy: policyWithoutWrap(),
      scope: createScope(),
      message: "请研究这份资料并给出调研结论",
      sessionKey: "space:alpha",
      roundsDir,
      isAborted: () => false,
      onPrimaryDeadline: () => {
        deadlineFired = true;
      },
      runBot: async () => {
        const live = await readPersistedRound({
          groupId: "alpha",
          roundId: "round-research",
          roundsDir,
        });
        budgetMs = (live?.deadlineAt ?? 0) - Date.now();
        return { text: "调研结论：应当继续收集证据并给出下一步。" };
      },
    });
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(budgetMs).toBeGreaterThanOrEqual(59_000);
    expect(deadlineFired).toBe(false);
  });

  test("R7: placeholder 我先看看 does not enter PRIMARY_COMPLETED", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-r7-"));
    const round = await executeCollaborationRoundForTest({
      decision: createDecision({ roundId: "round-placeholder" }),
      policy: policyWithoutWrap(),
      scope: createScope(),
      message: "请给出明确结论和建议下一步",
      sessionKey: "space:alpha",
      roundsDir,
      isAborted: () => false,
      runBot: async () => ({ text: "我先看看" }),
    });
    expect(round.state).toBe("ROUND_ABORTED");
    expect(round.completion?.hasConclusion).toBe(false);
    const events = await fs.readFile(
      path.join(roundsDir, "round-placeholder.events.jsonl"),
      "utf8",
    );
    expect(events).not.toContain('"type":"PRIMARY_COMPLETED"');
  });

  test("R11: chitchat completes without supplement dispatch", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-r11-"));
    const calls: string[] = [];
    const policy = {
      ...DEFAULT_COLLABORATION_POLICY,
      coordinator: { ...DEFAULT_COLLABORATION_POLICY.coordinator, enabled: false },
    };
    const round = await executeCollaborationRoundForTest({
      decision: createDecision({
        roundId: "round-chitchat",
        executionBots: [botA, botB],
        primaryQueue: ["bot-a"],
        roundPlan: {
          ...createDecision().roundPlan,
          roundId: "round-chitchat",
          participants: [
            {
              agentId: "bot-a",
              displayName: "Bot A",
              tier: "duty",
              contributionRole: "lead",
              reasonText: "lead",
            },
            {
              agentId: "bot-b",
              displayName: "Bot B",
              tier: "duty",
              contributionRole: "supplement",
              reasonText: "supplement",
            },
          ],
        },
      }),
      policy,
      scope: createScope(),
      message: "你好",
      sessionKey: "space:alpha",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ dispatchId, role }) => {
        calls.push(`${role}:${dispatchId}`);
        return { text: "你好！在的" };
      },
    });
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(round.abortReason).toBeUndefined();
    expect(calls.some((entry) => entry.startsWith("supplement:"))).toBe(false);
  });

  test("R11b: chitchat primary timeout soft-completes instead of aborting", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-r11b-"));
    const policy = {
      ...DEFAULT_COLLABORATION_POLICY,
      supplement: { ...DEFAULT_COLLABORATION_POLICY.supplement, enabled: false },
      coordinator: { ...DEFAULT_COLLABORATION_POLICY.coordinator, enabled: false },
      fallback: {
        ...DEFAULT_COLLABORATION_POLICY.fallback,
        timeoutPolicy: {
          ...DEFAULT_COLLABORATION_POLICY.fallback.timeoutPolicy,
          byTaskType: {
            ...DEFAULT_COLLABORATION_POLICY.fallback.timeoutPolicy.byTaskType,
            chitchat: 50,
          },
        },
      },
    };
    const round = await executeCollaborationRoundForTest({
      decision: createDecision({ roundId: "round-chitchat-timeout" }),
      policy,
      scope: createScope(),
      message: "你好",
      sessionKey: "space:alpha",
      roundsDir,
      isAborted: () => false,
      runBot: async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return { text: "late reply" };
      },
    });
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(round.abortReason).toBeUndefined();
  });

  test("R8: Cheap Gate DROP writes CANDIDATE_DROPPED and skips LLM", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-r8-"));
    const calls: string[] = [];
    const policy = {
      ...DEFAULT_COLLABORATION_POLICY,
      coordinator: { ...DEFAULT_COLLABORATION_POLICY.coordinator, enabled: false },
    };
    const round = await executeCollaborationRoundForTest({
      decision: createDecision({
        roundId: "round-drop",
        executionBots: [botA, botC],
        roundPlan: {
          ...createDecision().roundPlan,
          roundId: "round-drop",
          participants: [
            {
              agentId: "bot-a",
              displayName: "Bot A",
              tier: "duty",
              contributionRole: "lead",
              reasonText: "lead",
            },
            {
              agentId: "bot-c",
              displayName: "Bot C",
              tier: "relevance",
              contributionRole: "supplement",
              reasonText: "supplement",
            },
          ],
        },
      }),
      policy,
      scope: createCoordinatorScope(),
      message: "请分析一下这个方案的风险并给出结论",
      sessionKey: "space:alpha",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ dispatchId }) => {
        calls.push(dispatchId);
        return { text: "结论：主答已覆盖风险，建议先做小范围验证。" };
      },
    });
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(calls).toEqual(["round-drop:primary:bot-a"]);
    expect(calls.some((id) => id.includes("supplement"))).toBe(false);
    const events = await fs.readFile(path.join(roundsDir, "round-drop.events.jsonl"), "utf8");
    expect(events).toContain("CANDIDATE_DROPPED");
    expect(round.lastEventSeq).toBe(round.stateVersion);
    expect(round.seenEventIds.length).toBe(round.stateVersion);
    const loaded = await readPersistedRound({
      groupId: "alpha",
      roundId: "round-drop",
      roundsDir,
    });
    expect(loaded?.lastEventSeq).toBe(round.lastEventSeq);
    expect(loaded?.stateVersion).toBe(round.stateVersion);
  });

  test("R9: explicit_multi answers A then B once each", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-r9-"));
    const calls: string[] = [];
    const round = await executeCollaborationRoundForTest({
      decision: createDecision({
        roundId: "round-multi",
        primaryMode: "explicit_multi",
        mentionMode: "explicit_multi",
        primaryQueue: ["bot-a", "bot-b"],
        executionBots: [botA, botB],
        roundPlan: {
          ...createDecision().roundPlan,
          roundId: "round-multi",
          responseMode: "lead_plus_supplement",
          participants: [
            {
              agentId: "bot-a",
              displayName: "Bot A",
              tier: "mention",
              contributionRole: "lead",
              reasonText: "mentioned",
            },
            {
              agentId: "bot-b",
              displayName: "Bot B",
              tier: "mention",
              contributionRole: "lead",
              reasonText: "mentioned",
            },
          ],
        },
      }),
      policy: policyWithoutWrap(),
      scope: createScope(),
      message: "@bot-a @bot-b 请各自给出结论",
      sessionKey: "space:alpha",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ dispatchId }) => {
        calls.push(dispatchId);
        return { text: "结论：这是我的独立回答，并给出下一步。" };
      },
    });
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(round.primaryMode).toBe("explicit_multi");
    expect(calls).toEqual(["round-multi:primary:bot-a", "round-multi:primary:bot-b"]);
  });

  test("typo confirm asks in the round and does not expire into an abort", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-confirm-"));
    const question = "【点名确认】你是想叫「市场助手」吗？回复确认即可。";
    const round = await executeCollaborationRoundForTest({
      decision: createDecision({
        roundId: "round-confirm",
        mentionUnmatched: false,
        mentionConfirm: {
          ambiguous: false,
          token: "市场助手",
          question,
          candidates: [{ agentId: "bot-a", name: "市场助手" }],
        },
        mentionMode: "none",
        primaryQueue: [],
        executionBots: [],
        tier0: [],
        tier1: [],
      }),
      policy: policyWithoutWrap(),
      scope: createScope(),
      message: "@市场助手 看一下",
      sessionKey: "space:alpha",
      roundsDir,
      isAborted: () => false,
      runBot: async () => {
        throw new Error("confirm must not run a bot");
      },
    });
    expect(round.state).toBe("MENTION_CONFIRM");
    expect(round.occupancy).toBe("none");
    expect(round.dispatches).toEqual([]);
    expect(round.deadlineAt).toBeUndefined();
    expect(round.mentionConfirm?.question).toBe(question);
    expect(decideRoundRecovery(round, Date.now() + 120_000)).toEqual({
      action: "noop",
      reason: "awaiting_mention_confirm",
    });
  });

  test("R10: unmatched mention stays occupancy none with no dispatch", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-r10-"));
    const round = await executeCollaborationRoundForTest({
      decision: createDecision({
        roundId: "round-r10",
        mentionUnmatched: true,
        mentionMode: "none",
        primaryQueue: [],
        executionBots: [],
      }),
      policy: policyWithoutWrap(),
      scope: createScope(),
      message: "@nobody 你好",
      sessionKey: "space:alpha",
      roundsDir,
      isAborted: () => false,
      runBot: async () => {
        throw new Error("unmatched must not run a bot");
      },
    });
    expect(round.state).toBe("MENTION_UNMATCHED");
    expect(round.occupancy).toBe("none");
    expect(round.dispatches).toEqual([]);
  });

  test("CSC: chat inbound depth freezes a minimal scope plan with mandatory group", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-csc-"));
    const round = await executeCollaborationRoundForTest({
      decision: createDecision({ roundId: "round-csc" }),
      policy: policyWithoutWrap(),
      scope: createScope(),
      message: "帮我把这句话改一下",
      sessionKey: "space:alpha",
      inboundDepth: "chat",
      roundsDir,
      isAborted: () => false,
      runBot: async () => ({ text: "已改好。" }),
    });
    const plan = round.contextScopePlan as {
      mode: string;
      retrievalStrategy: { allowKnowledgePrefetch: boolean; recursiveFolderScan: boolean };
      fullContextDumpAllowed: boolean;
      mandatorySources: Array<{ type: string }>;
    };
    expect(plan.mode).toBe("minimal");
    expect(plan.retrievalStrategy.allowKnowledgePrefetch).toBe(false);
    expect(plan.retrievalStrategy.recursiveFolderScan).toBe(false);
    expect(plan.fullContextDumpAllowed).toBe(false);
    expect(plan.mandatorySources.some((source) => source.type === "group")).toBe(true);
  });

  test("CSC: focused request freezes selected sources on the round", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-csc-focus-"));
    const round = await executeCollaborationRoundForTest({
      decision: createDecision({ roundId: "round-csc-focus" }),
      policy: policyWithoutWrap(),
      scope: createScope(),
      message: "只看这份路线图",
      sessionKey: "space:alpha",
      contextScopeRequest: {
        mode: "focused",
        sources: [{ type: "file", fileId: "doc-roadmap" }],
      },
      roundsDir,
      isAborted: () => false,
      runBot: async () => ({ text: "已按指定文件作答。" }),
    });
    const plan = round.contextScopePlan as {
      mode: string;
      sources: Array<{ type: string; fileId?: string }>;
      retrievalStrategy: { recursiveFolderScan: boolean };
      fullContextDumpAllowed: boolean;
    };
    expect(plan.mode).toBe("focused");
    expect(plan.sources.some((source) => source.fileId === "doc-roadmap")).toBe(true);
    expect(plan.retrievalStrategy.recursiveFolderScan).toBe(false);
    expect(plan.fullContextDumpAllowed).toBe(false);
  });

  test("empty supplement queue auto-picks one differentiated bot after a concluded primary", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-auto-sup-"));
    const policy = {
      ...DEFAULT_COLLABORATION_POLICY,
      supplement: { ...DEFAULT_COLLABORATION_POLICY.supplement, enabled: true },
      coordinator: { ...DEFAULT_COLLABORATION_POLICY.coordinator, enabled: false },
    };
    const calls: string[] = [];
    const round = await executeCollaborationRoundForTest({
      decision: createDecision({
        roundId: "round-auto-sup",
        executionBots: [botA],
        primaryQueue: ["bot-a"],
      }),
      policy,
      scope: createScope(),
      message: "请分析记忆系统并给出结论",
      sessionKey: "space:alpha",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ bot, dispatchId }) => {
        calls.push(dispatchId);
        return {
          text:
            bot.agentId === "bot-a"
              ? "结论：记忆系统应先收敛写入路径。建议下一步：补验收。"
              : "补充：从检索侧核对同一条写入路径。",
        };
      },
    });
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(calls.some((id) => id.includes("primary:bot-a"))).toBe(true);
    expect(calls.some((id) => id.includes("supplement:bot-b"))).toBe(true);
  });

  test("auto-picked supplement is dropped with budget_limit when maxSupplementBots is 0", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-auto-sup-budget-"));
    const policy = {
      ...DEFAULT_COLLABORATION_POLICY,
      supplement: {
        ...DEFAULT_COLLABORATION_POLICY.supplement,
        enabled: true,
        maxSupplementBots: 0,
      },
      coordinator: { ...DEFAULT_COLLABORATION_POLICY.coordinator, enabled: false },
    };
    const calls: string[] = [];
    const round = await executeCollaborationRoundForTest({
      decision: createDecision({
        roundId: "round-auto-sup-budget",
        executionBots: [botA],
        primaryQueue: ["bot-a"],
      }),
      policy,
      scope: createScope(),
      message: "请分析记忆系统并给出结论",
      sessionKey: "space:alpha",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ dispatchId }) => {
        calls.push(dispatchId);
        return { text: "结论：记忆系统应先收敛写入路径。建议下一步：补验收。" };
      },
    });
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(calls).toEqual(["round-auto-sup-budget:primary:bot-a"]);
    const events = (
      await fs.readFile(path.join(roundsDir, "round-auto-sup-budget.events.jsonl"), "utf8")
    )
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const dropped = events.filter((event) => JSON.stringify(event).includes("CANDIDATE_DROPPED"));
    expect(dropped).toHaveLength(1);
    expect(JSON.stringify(dropped[0])).toContain('"budget_limit"');
    expect(JSON.stringify(dropped[0])).toContain('"bot-b"');
  });

  test("collab edge on empty planned queue dispatches the edge target without extra auto-pick", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-edge-no-auto-"));
    const policy = {
      ...DEFAULT_COLLABORATION_POLICY,
      supplement: { ...DEFAULT_COLLABORATION_POLICY.supplement, enabled: true },
      coordinator: { ...DEFAULT_COLLABORATION_POLICY.coordinator, enabled: false },
    };
    const calls: string[] = [];
    const round = await executeCollaborationRoundForTest({
      decision: createDecision({
        roundId: "round-edge-no-auto",
        executionBots: [botA],
        primaryQueue: ["bot-a"],
      }),
      policy,
      scope: { ...createScope(), bots: [botA, botB, botC] },
      message: "请分析记忆系统并给出结论",
      sessionKey: "space:alpha",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ bot, dispatchId }) => {
        calls.push(dispatchId);
        if (bot.agentId === "bot-a") {
          return {
            text: "结论：方案可行。建议下一步：补验收。\n[[collab_edge:peer_ask|to=bot-b|reason=补数据口径]]",
          };
        }
        return { text: "补充：口径已对齐。" };
      },
    });
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(round.edges?.map((edge) => edge.toAgentId)).toEqual(["bot-b"]);
    expect(calls.some((id) => id.includes("primary:bot-a"))).toBe(true);
    expect(calls.some((id) => id.includes("supplement:bot-c"))).toBe(false);
    expect(calls.filter((id) => id.includes("supplement:")).length).toBeLessThanOrEqual(1);
  });

  test("primary bot soft-failure still allows supplement without faking primary success", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-primary-fail-"));
    const policy = {
      ...DEFAULT_COLLABORATION_POLICY,
      supplement: { ...DEFAULT_COLLABORATION_POLICY.supplement, enabled: true },
      coordinator: { ...DEFAULT_COLLABORATION_POLICY.coordinator, enabled: false },
    };
    const round = await executeCollaborationRoundForTest({
      decision: createDecision({
        roundId: "round-primary-fail",
        tier0: [botA],
        tier1: [botB],
        executionBots: [botA, botB],
        primaryQueue: ["bot-a"],
        roundPlan: {
          roundId: "round-primary-fail",
          sessionKey: "space:alpha",
          responseMode: "lead_plus_supplement",
          summaryText: "test",
          participants: [
            {
              agentId: "bot-a",
              displayName: "Bot A",
              tier: "duty",
              contributionRole: "lead",
              reasonText: "lead",
            },
            {
              agentId: "bot-b",
              displayName: "Bot B",
              tier: "relevance",
              contributionRole: "supplement",
              reasonText: "supplement",
            },
          ],
        },
      }),
      policy,
      scope: createScope(),
      message: "请给出明确结论和建议下一步",
      sessionKey: "space:alpha",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ bot }) => {
        if (bot.agentId === "bot-a") {
          return undefined;
        }
        return { text: "结论：基于现有信息继续推进。建议下一步：补充验证。" };
      },
    });
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(round.dispatches.some((entry) => entry.agentId === "bot-a")).toBe(true);
    expect(round.dispatches.some((entry) => entry.agentId === "bot-b")).toBe(true);
    const primaryDispatch = round.dispatches.find((entry) => entry.agentId === "bot-a");
    expect(primaryDispatch?.status).not.toBe("completed");
  });

  test("PRIMARY_TIMEOUT takeovers an already-selected secondary instead of aborting", async () => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-round-takeover-"));
    const policy = {
      ...policyWithoutWrap(),
      fallback: {
        ...DEFAULT_COLLABORATION_POLICY.fallback,
        timeoutPolicy: {
          ...DEFAULT_COLLABORATION_POLICY.fallback.timeoutPolicy,
          byTaskType: {
            ...DEFAULT_COLLABORATION_POLICY.fallback.timeoutPolicy.byTaskType,
            analysis: 40,
          },
        },
      },
    };
    const calls: string[] = [];
    const round = await executeCollaborationRoundForTest({
      decision: createDecision({
        roundId: "round-takeover",
        executionBots: [botA, botB],
        primaryQueue: ["bot-a"],
        roundPlan: {
          ...createDecision().roundPlan,
          roundId: "round-takeover",
          participants: [
            {
              agentId: "bot-a",
              displayName: "Bot A",
              tier: "duty",
              contributionRole: "lead",
              reasonText: "lead",
            },
            {
              agentId: "bot-b",
              displayName: "Bot B",
              tier: "relevance",
              contributionRole: "supplement",
              reasonText: "selected",
            },
          ],
        },
      }),
      policy,
      scope: createScope(),
      message: "请分析一下这个方案并给出结论",
      sessionKey: "space:alpha",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ dispatchId, role }) => {
        calls.push(`${role}:${dispatchId}`);
        if (role === "primary") {
          // Analysis budget floors at 5s, so this exercises the placeholder →
          // PRIMARY_TIMEOUT path. A real visible body (even without 结论) now
          // completes the primary instead of triggering a takeover.
          await new Promise((resolve) => setTimeout(resolve, 250));
          return { text: "我先看看" };
        }
        return { text: "结论：由候补接管并给出下一步。" };
      },
    });
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(calls.some((entry) => entry.startsWith("fallback:"))).toBe(true);
  });
});

describe("invited member continuation after a settled primary deadline", () => {
  test.each(["continue", "abort", "abort_supplement", "visible_limit", "optional"] as const)(
    "%s retains admission and stop boundaries",
    async (scenario) => {
      const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-invited-"));
      const calls: string[] = [];
      let aborted = false;
      const deadline = vi
        .spyOn(completionContract, "resolvePrimaryDeadlineMs")
        .mockImplementation(({ startedAtMs }) => startedAtMs + 5);
      try {
        const decision = createDecision({
          roundId: "invited-late",
          executionBots: [botA, botB],
          roundPlan: {
            ...createDecision().roundPlan,
            participants: [
              ...createDecision().roundPlan.participants,
              {
                agentId: "bot-b",
                displayName: "Bot B",
                tier: scenario === "optional" ? "duty" : "mention",
                contributionRole: "supplement",
                reasonText: "requested member",
              },
            ],
          },
        });
        const scope = createCoordinatorScope();
        if (scenario === "visible_limit" && scope.operatingState) {
          scope.operatingState.collaborationPolicy.maxVisibleBotRepliesPerRound = 1;
        }
        const round = await executeCollaborationRoundForTest({
          decision,
          scope,
          roundsDir,
          sessionKey: "space:alpha",
          message: "请分别给出建议",
          isAborted: () => aborted,
          policy: {
            ...policyWithoutWrap(),
            supplement: {
              ...DEFAULT_COLLABORATION_POLICY.supplement,
              enabled: true,
            },
          },
          runBot: async ({ bot }) => {
            calls.push(bot.agentId);
            if (bot.agentId === "bot-a") {
              await new Promise((resolve) => setTimeout(resolve, 20));
              aborted = scenario === "abort";
            } else if (scenario === "abort_supplement") {
              aborted = true;
            }
            return { text: "结论：给出可验证的独立建议。下一步：核实证据。" };
          },
        });
        expect(calls).toEqual(
          scenario === "continue" || scenario === "abort_supplement"
            ? ["bot-a", "bot-b"]
            : ["bot-a"],
        );
        expect(round.state).toBe(
          scenario === "abort" || scenario === "abort_supplement"
            ? "ROUND_ABORTED"
            : "ROUND_COMPLETE",
        );
        if (scenario === "continue") {
          expect(round.policyDecision?.supplementDenialDiagnosis?.structuralGate).toMatchObject({
            primaryBudgetClosed: true,
            invitedContinuation: true,
          });
        }
      } finally {
        deadline.mockRestore();
        await fs.rm(roundsDir, { recursive: true, force: true });
      }
    },
  );
});

describe("explicit member queue budgets and coordination", () => {
  test.each(["late", "stop_between", "signal_between"] as const)("%s", async (scenario) => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-multi-"));
    const calls: string[] = [];
    let stopped = false;
    const controller = new AbortController();
    const deadline = vi
      .spyOn(completionContract, "resolvePrimaryDeadlineMs")
      .mockImplementation(({ startedAtMs }) => startedAtMs + (scenario === "late" ? 5 : 1000));
    const wait = vi.spyOn(roundOrchestrator, "sleepMs").mockImplementation(async () => {
      if (scenario === "stop_between" && calls.length === 1) {
        stopped = true;
      }
      if (scenario === "signal_between" && calls.length === 1) {
        controller.abort();
      }
    });
    try {
      const round = await executeCollaborationRoundForTest({
        decision: createDecision({
          roundId: "multi-continuation",
          primaryMode: "explicit_multi",
          mentionMode: "explicit_multi",
          responseMode: "debate_or_brainstorm",
          primaryQueue: ["bot-a", "bot-b"],
          executionBots: [botA, botB],
        }),
        policy: policyWithoutWrap(),
        scope: createScope(),
        roundsDir,
        message: "@bot-a @bot-b 分别给出建议",
        sessionKey: "space:alpha",
        isAborted: () => stopped,
        signal: controller.signal,
        runBot: async ({ bot }) => {
          calls.push(bot.agentId);
          if (scenario === "late") {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          return { text: "结论：给出独立建议。下一步：核对证据。" };
        },
      });
      expect(calls).toEqual(scenario === "late" ? ["bot-a", "bot-b"] : ["bot-a"]);
      expect(round.state).toBe(scenario === "late" ? "ROUND_COMPLETE" : "ROUND_ABORTED");
      expect(wait).toHaveBeenCalledWith(2500, controller.signal);
    } finally {
      wait.mockRestore();
      deadline.mockRestore();
      await fs.rm(roundsDir, { recursive: true, force: true });
    }
  });
});

describe("restart during a pending collaboration sequence", () => {
  test.each(["PRIMARY_COMPLETED", "SUPPLEMENT_WINDOW"] as const)(
    "%s records an interruption rather than successful queue completion",
    async (state) => {
      const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-pending-recovery-"));
      try {
        const round = {
          ...createRespondingRound("pending-recovery"),
          state,
          primaryQueue: ["bot-a", "bot-b"],
          primaryCursor: 0,
        };
        await writePersistedRound({ round, roundsDir });
        const decision = decideRoundRecovery(round, Date.now());
        expect(decision.action).toBe("abort");
        expect(decision.reason).toBe("restart_pending_dispatch");
        const recovered = await applyRoundRecovery(round, decision, { roundsDir });
        expect(recovered.state).toBe("ROUND_ABORTED");
        expect(recovered.dispatches).toEqual(round.dispatches);
        expect(decideRoundRecovery(recovered, Date.now()).action).toBe("noop");
        const events = await fs.readFile(
          path.join(roundsDir, "pending-recovery.events.jsonl"),
          "utf8",
        );
        expect(events).toContain("restart_pending_dispatch");
        expect(events).toContain("bot-b");
      } finally {
        await fs.rm(roundsDir, { recursive: true, force: true });
      }
    },
  );
});

test.each([undefined, 4])(
  "explicit introduction honors broad ceiling %s beyond ordinary budget",
  async (broadCeiling) => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-intro-contract-"));
    const bots = Array.from({ length: 8 }, (_, index) => ({
      ...botA,
      agentId: `member-${index}`,
      name: `成员${index}`,
      sessionKey: `agent:member-${index}:space:alpha`,
    }));
    const scope: CollaborationDispatchScope = { ...createScope(), bots };
    if (broadCeiling !== undefined) {
      const operating = createCoordinatorScope().operatingState!;
      scope.operatingState = {
        ...operating,
        collaborationPolicy: {
          ...operating.collaborationPolicy,
          maxVisibleBotRepliesPerRound: 3,
          maxVisibleBotRepliesPerRoundBroad: broadCeiling,
        },
      };
    }
    const expectedCount = broadCeiling ?? 8;
    const decision = decideParticipantsForTest({
      scope,
      message: "请你们分别介绍一下自己",
      roundId: "intro-contract",
    });
    expect(decision.executionBots).toHaveLength(expectedCount);
    expect(decision.visibleReplyBudget).toEqual({ kind: "broadcast", limit: expectedCount });
    const calls: string[] = [];
    const wait = vi.spyOn(roundOrchestrator, "sleepMs").mockResolvedValue();
    try {
      const round = await executeCollaborationRoundForTest({
        decision,
        scope,
        roundsDir,
        message: "请你们分别介绍一下自己",
        sessionKey: "space:alpha",
        policy: {
          ...policyWithoutWrap(),
          supplement: { ...DEFAULT_COLLABORATION_POLICY.supplement, enabled: true },
        },
        runBot: async ({ bot }) => {
          calls.push(bot.agentId);
          return { text: `我是${bot.name}，负责提供自己专业领域的独立意见。` };
        },
      });
      expect(round.state).toBe("ROUND_COMPLETE");
      expect(calls).toHaveLength(expectedCount);
      expect(new Set(calls)).toEqual(new Set(decision.executionBots.map((bot) => bot.agentId)));
      expect(round.policyDecision?.visibleReplyBudget).toEqual(decision.visibleReplyBudget);
    } finally {
      wait.mockRestore();
      await fs.rm(roundsDir, { recursive: true, force: true });
    }
  },
);

test.each(["closed", "open", "late"] as const)(
  "open discussion %s does not require conclusion formatting for selected members",
  async (scenario) => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-policy-window-"));
    const open = scenario !== "closed";
    const deadline = vi
      .spyOn(completionContract, "resolvePrimaryDeadlineMs")
      .mockImplementation(({ startedAtMs }) => startedAtMs + (scenario === "late" ? 5 : 1000));
    const scope = createCoordinatorScope();
    scope.operatingState!.collaborationPolicy.openDiscussionWithoutMention = open;
    scope.operatingState!.activeContext.currentOperatingPhase = "debate";
    const calls: string[] = [];
    try {
      const round = await executeCollaborationRoundForTest({
        scope,
        roundsDir,
        sessionKey: "space:alpha",
        message: "请分析方案风险",
        decision: createDecision({ roundId: "policy-window", executionBots: [botA, botB] }),
        policy: {
          ...policyWithoutWrap(),
          supplement: { ...DEFAULT_COLLABORATION_POLICY.supplement, enabled: true },
        },
        runBot: async ({ bot }) => {
          calls.push(bot.agentId);
          if (scenario === "late" && bot.agentId === "bot-a") {
            await new Promise((resolve) => setTimeout(resolve, 20));
          }
          return { text: "当前实现存在多个需要核查的边界，可以对照已有记录逐项验证。" };
        },
      });
      expect(calls).toEqual(open ? ["bot-a", "bot-b"] : ["bot-a"]);
      expect(round.state).toBe("ROUND_COMPLETE");
      if (open) {
        expect(round.policyDecision?.supplementWindow?.reason).toBe("policy");
      }
    } finally {
      deadline.mockRestore();
      await fs.rm(roundsDir, { recursive: true, force: true });
    }
  },
);

test("formal admitted executor is independent of speaking limit and supplement switch", async () => {
  const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-formal-admission-"));
  const scope = createCoordinatorScope();
  scope.operatingState!.collaborationPolicy.maxVisibleBotRepliesPerRound = 1;
  const admission = vi.spyOn(memberAdmission, "resolveMemberAdmission").mockResolvedValue({
    purpose: "formal_execution",
    binding: {
      groupId: "alpha",
      taskId: "t",
      boardItemId: "b",
      runId: "formal:bot-b",
      source: "explicit_run",
    },
    taskBag: {
      planGate: { confirmed: true, todolistStatus: "confirmed" },
    } as import("./executor-private-todolist.js").ExecutionTaskBag,
  });
  const calls: string[] = [];
  try {
    const round = await executeCollaborationRoundForTest({
      scope,
      roundsDir,
      decision: createDecision({
        roundId: "formal",
        responseMode: "decision_to_executor",
        executionBots: [botA, botB],
        roundPlan: {
          ...createDecision().roundPlan,
          participants: [
            {
              agentId: "bot-a",
              displayName: "A",
              tier: "mention",
              contributionRole: "confirm",
              reasonText: "confirm",
            },
            {
              agentId: "bot-b",
              displayName: "B",
              tier: "duty",
              contributionRole: "executor",
              reasonText: "execute",
            },
          ],
        },
      }),
      policy: policyWithoutWrap(),
      message: "执行已确认任务",
      sessionKey: "space:alpha",
      runBot: async ({ bot }) => {
        calls.push(bot.agentId);
        return { text: "结论：已完成本次回合。" };
      },
    });
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(calls).toEqual(["bot-a", "bot-b"]);
    expect(admission).toHaveBeenCalledTimes(2);
  } finally {
    admission.mockRestore();
    await fs.rm(roundsDir, { recursive: true, force: true });
  }
});

test.each([false, true])(
  "public receipt %s determines speaking consumption, not dispatch count",
  async (committed) => {
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-public-receipt-"));
    const scope = createCoordinatorScope();
    scope.operatingState!.collaborationPolicy.maxVisibleBotRepliesPerRound = 2;
    const calls: string[] = [];
    try {
      await executeCollaborationRoundForTest({
        scope,
        roundsDir,
        sessionKey: "space:alpha",
        message: "请分析方案风险",
        decision: createDecision({
          roundId: "receipt",
          executionBots: [botA, botB, botC],
          roundPlan: {
            ...createDecision().roundPlan,
            participants: [
              ...createDecision().roundPlan.participants,
              {
                agentId: "bot-b",
                displayName: "B",
                tier: "mention",
                contributionRole: "supplement",
                reasonText: "invited",
              },
              {
                agentId: "bot-c",
                displayName: "C",
                tier: "mention",
                contributionRole: "supplement",
                reasonText: "invited",
              },
            ],
          },
        }),
        policy: {
          ...policyWithoutWrap(),
          supplement: { ...DEFAULT_COLLABORATION_POLICY.supplement, enabled: true },
        },
        runBot: async ({ bot }) => {
          calls.push(bot.agentId);
          return {
            text: "结论：本成员已经给出独立意见。",
            publicReplyCommitted: bot.agentId === "bot-b" ? committed : true,
          };
        },
      });
      expect(calls).toEqual(committed ? ["bot-a", "bot-b"] : ["bot-a", "bot-b", "bot-c"]);
    } finally {
      await fs.rm(roundsDir, { recursive: true, force: true });
    }
  },
);
