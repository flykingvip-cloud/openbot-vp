/**
 * Regressions for collaboration-group dialogue failures seen in real 数字人战队 logs.
 * Fixtures: ./__fixtures__/digital-team-real-rounds.ts (verbatim texts / timestamps).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  BROADCAST_ROUND,
  createDigitalTeamScope,
  DIGITAL_TEAM_BOTS,
  EXECUTION_RESULT_ROUNDS,
  FOLLOW_UP_ROUND,
  ORCHESTRATION_ROUND,
} from "./__fixtures__/digital-team-real-rounds.js";
import {
  decideParticipantsForTest,
  executeCollaborationRoundForTest,
} from "./__fixtures__/runtime-authority-test-utils.js";
import type { CollabEdge } from "./collab-edge.js";
import { classifyPrimaryCompletion, resolveTimeoutTaskType } from "./completion-contract.js";
import { DEFAULT_COLLABORATION_POLICY } from "./policy.js";
import { type RoundDispatchRunner } from "./round-runtime.js";
import type {
  CollaborationBotTarget,
  CollaborationDispatchScope,
  ParticipationDecision,
  RoundPlanParticipant,
} from "./types.js";

function supplementPolicy() {
  return {
    ...DEFAULT_COLLABORATION_POLICY,
    supplement: { ...DEFAULT_COLLABORATION_POLICY.supplement, enabled: true },
    coordinator: { ...DEFAULT_COLLABORATION_POLICY.coordinator, enabled: false },
  };
}

function participant(
  bot: CollaborationBotTarget,
  tier: RoundPlanParticipant["tier"],
  contributionRole: RoundPlanParticipant["contributionRole"],
): RoundPlanParticipant {
  return {
    agentId: bot.agentId,
    displayName: bot.name,
    tier,
    contributionRole,
    reasonText: `${bot.name} ${tier}`,
  };
}

function manualDecision(params: {
  roundId: string;
  responseMode: ParticipationDecision["responseMode"];
  lead: CollaborationBotTarget;
  leadTier?: RoundPlanParticipant["tier"];
  supplements?: Array<{ bot: CollaborationBotTarget; tier?: RoundPlanParticipant["tier"] }>;
  mentionMode?: ParticipationDecision["mentionMode"];
}): ParticipationDecision {
  const supplements = params.supplements ?? [];
  const leadTier = params.leadTier ?? "duty";
  return {
    roundId: params.roundId,
    responseMode: params.responseMode,
    tier0: leadTier === "mention" ? [params.lead] : [],
    tier1: [
      ...(leadTier === "mention" ? [] : [params.lead]),
      ...supplements.map((entry) => entry.bot),
    ],
    tier2: [],
    executionBots: [params.lead, ...supplements.map((entry) => entry.bot)],
    roundPlan: {
      roundId: params.roundId,
      sessionKey: "space:grp-daniel-hhd-gmail-com-upbeyond",
      responseMode: params.responseMode,
      summaryText: "fixture",
      participants: [
        participant(params.lead, leadTier, "lead"),
        ...supplements.map((entry) => participant(entry.bot, entry.tier ?? "duty", "supplement")),
      ],
    },
    lowSignalLimited: false,
    mentionUnmatched: false,
    primaryMode: "single",
    mentionMode: params.mentionMode ?? (leadTier === "mention" ? "single_primary" : "none"),
    primaryQueue: [params.lead.agentId],
  };
}

async function readEvents(roundsDir: string, roundId: string) {
  const raw = await fs.readFile(path.join(roundsDir, `${roundId}.events.jsonl`), "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; agentId?: string; payload?: unknown });
}

async function tempRoundsDir(label: string) {
  return await fs.mkdtemp(path.join(os.tmpdir(), `openbot-collab-regress-${label}-`));
}

describe("P0-1: visible primary reply is PRIMARY_COMPLETED, never PRIMARY_TIMEOUT", () => {
  test.each(EXECUTION_RESULT_ROUNDS)(
    "$roundId: real execution reply classifies as complete without structural conclusion",
    (fixture) => {
      const taskType = resolveTimeoutTaskType({
        responseMode: fixture.responseMode,
        inboundDepth: "act",
        message: fixture.userMessage,
      });
      const completion = classifyPrimaryCompletion(fixture.primaryReply, taskType, {
        mentionBotMustRespond: true,
      });
      expect(completion.responseStatus).toBe("complete");
      expect(completion.visibleReply).toBe(true);
    },
  );

  test("placeholder / empty detection is unchanged", () => {
    for (const text of ["", "   ", "我先看看", "收到，已记录", "已认领：记忆盘点", "稍等"]) {
      const completion = classifyPrimaryCompletion(text, "execution");
      expect(completion.responseStatus).toBe("placeholder");
      expect(completion.visibleReply).toBe(false);
    }
  });

  test.each(EXECUTION_RESULT_ROUNDS)(
    "$roundId: round completes with the primary only — no timeout, fallback re-run, or abort",
    async (fixture) => {
      const roundsDir = await tempRoundsDir("exec");
      const calls: string[] = [];
      const decision = manualDecision({
        roundId: fixture.roundId,
        responseMode: fixture.responseMode,
        lead: fixture.primary,
        supplements: fixture.supplement ? [{ bot: fixture.supplement }] : [],
      });
      const round = await executeCollaborationRoundForTest({
        decision,
        policy: supplementPolicy(),
        scope: createDigitalTeamScope(),
        message: fixture.userMessage,
        sessionKey: "space:grp-daniel-hhd-gmail-com-upbeyond",
        roundsDir,
        inboundDepth: "act",
        isAborted: () => false,
        runBot: async ({ bot, role, dispatchId }) => {
          calls.push(`${role}:${dispatchId}`);
          if (bot.agentId === fixture.primary.agentId) {
            return { text: fixture.primaryReply };
          }
          return {
            text:
              "duplicateFallbackReply" in fixture ? fixture.duplicateFallbackReply : "重复执行结果",
          };
        },
      });
      expect(round.state).toBe("ROUND_COMPLETE");
      expect(round.abortReason).toBeUndefined();
      expect(round.completion).toMatchObject({ responseStatus: "complete", visibleReply: true });
      // Exactly one visible post: no fallback / supplement re-run of the same command.
      expect(calls).toEqual([`primary:${fixture.roundId}:primary:${fixture.primary.agentId}`]);
      const types = (await readEvents(roundsDir, fixture.roundId)).map((event) => event.type);
      expect(types).toContain("PRIMARY_COMPLETED");
      expect(types).not.toContain("PRIMARY_TIMEOUT");
      expect(types).not.toContain("FALLBACK_STARTED");
      expect(types).not.toContain("ROUND_ABORTED");
      expect(round.policyDecision?.supplementWindow?.opened).toBe(false);
    },
  );

  test("structural conclusion still opens the supplement window for the same round shape", async () => {
    const roundsDir = await tempRoundsDir("exec-conclusion");
    const fixture = EXECUTION_RESULT_ROUNDS[0];
    const calls: string[] = [];
    const round = await executeCollaborationRoundForTest({
      decision: manualDecision({
        roundId: `${fixture.roundId}-conclusion`,
        responseMode: "lead_plus_supplement",
        lead: fixture.primary,
        supplements: [{ bot: DIGITAL_TEAM_BOTS.analyst }],
      }),
      policy: supplementPolicy(),
      scope: createDigitalTeamScope(),
      message: "请分析这次命令执行结果并给出结论",
      sessionKey: "space:grp-daniel-hhd-gmail-com-upbeyond",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ role, dispatchId }) => {
        calls.push(`${role}:${dispatchId}`);
        return { text: "结论：命令执行成功，退出码 0。建议下一步：按用途归并 /tmp 产物。" };
      },
    });
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(round.policyDecision?.supplementWindow).toEqual({ opened: true, reason: "conclusion" });
  });

  test("a real timeout (no visible reply) still takes the PRIMARY_TIMEOUT → fallback path", async () => {
    const roundsDir = await tempRoundsDir("exec-silent");
    const fixture = EXECUTION_RESULT_ROUNDS[0];
    const calls: string[] = [];
    const round = await executeCollaborationRoundForTest({
      decision: manualDecision({
        roundId: `${fixture.roundId}-silent`,
        responseMode: "lead_plus_supplement",
        lead: fixture.primary,
        supplements: [{ bot: DIGITAL_TEAM_BOTS.analyst }],
      }),
      policy: supplementPolicy(),
      scope: createDigitalTeamScope(),
      message: fixture.userMessage,
      sessionKey: "space:grp-daniel-hhd-gmail-com-upbeyond",
      roundsDir,
      inboundDepth: "act",
      isAborted: () => false,
      runBot: async ({ bot, role }) => {
        calls.push(`${role}:${bot.agentId}`);
        return bot.agentId === fixture.primary.agentId ? undefined : { text: fixture.primaryReply };
      },
    });
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(calls).toEqual(["primary:bot-2", "fallback:bot--agent"]);
    const types = (await readEvents(roundsDir, `${fixture.roundId}-silent`)).map(
      (event) => event.type,
    );
    expect(types).toContain("PRIMARY_TIMEOUT");
    expect(types).toContain("FALLBACK_COMPLETED");
  });
});

describe("P0-2: no-coordinator orchestration through same-round CollabEdges", () => {
  function orchestrationDecision(
    responseMode: ParticipationDecision["responseMode"] = "lead_plus_supplement",
  ) {
    return manualDecision({
      roundId: ORCHESTRATION_ROUND.roundId,
      responseMode,
      lead: DIGITAL_TEAM_BOTS.panda,
      leadTier: "mention",
    });
  }

  test("@mentioned primary's handoff edges (by display name or agentId) dispatch in the same round", async () => {
    const roundsDir = await tempRoundsDir("orchestrate");
    const runs: Array<{ agentId: string; role: string; edge?: CollabEdge }> = [];
    const runBot: RoundDispatchRunner = async ({ bot, role, edge }) => {
      runs.push({ agentId: bot.agentId, role, ...(edge ? { edge } : {}) });
      if (bot.agentId === "panda") {
        return {
          // chat.ts posts the stripped body and hands the raw text over for parsing.
          text: "收到 CEO。我来做整体编排。",
          rawText: ORCHESTRATION_ROUND.edgeReply,
        };
      }
      return { text: `${bot.name}：已完成分配的子任务，结论见正文。` };
    };
    const round = await executeCollaborationRoundForTest({
      decision: orchestrationDecision(),
      policy: supplementPolicy(),
      scope: createDigitalTeamScope(),
      message: ORCHESTRATION_ROUND.userMessage,
      sessionKey: "space:grp-daniel-hhd-gmail-com-upbeyond",
      roundsDir,
      isAborted: () => false,
      runBot,
    });
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(round.edges?.map((edge) => [edge.kind, edge.toAgentId])).toEqual([
      ["handoff", "bot-2"],
      ["handoff", "bot--agent"],
    ]);
    expect(runs.map((run) => `${run.role}:${run.agentId}`)).toEqual([
      "primary:panda",
      "supplement:bot-2",
      "supplement:bot--agent",
    ]);
    expect(runs[1]?.edge?.handoff?.remainingWork).toContain("市场规模");
    expect(runs[2]?.edge?.kind).toBe("handoff");
    expect(round.edges?.every((edge) => edge.depth === 1)).toBe(true);
    expect(round.policyDecision?.supplementGate?.map((entry) => entry.reason)).toEqual([
      "edge_invited",
      "edge_invited",
    ]);
  });

  test("edges dispatch even when the primary reply has no structural conclusion", async () => {
    const roundsDir = await tempRoundsDir("orchestrate-no-conclusion");
    const runs: string[] = [];
    const round = await executeCollaborationRoundForTest({
      decision: orchestrationDecision(),
      policy: supplementPolicy(),
      scope: createDigitalTeamScope(),
      message: ORCHESTRATION_ROUND.userMessage,
      sessionKey: "space:grp-daniel-hhd-gmail-com-upbeyond",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ bot, role }) => {
        runs.push(`${role}:${bot.agentId}`);
        return bot.agentId === "panda"
          ? {
              text: "市场助手看市场，高密度分析看能力矩阵，我来汇总。",
              rawText:
                "市场助手看市场，高密度分析看能力矩阵，我来汇总。\n[[collab_edge:peer_ask|to=市场助手|reason=市场规模与竞品]]",
            }
          : { text: "市场规模与竞品格局如下。" };
      },
    });
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(runs).toEqual(["primary:panda", "supplement:bot-2"]);
    expect(round.policyDecision?.supplementWindow).toEqual({ opened: true, reason: "invited" });
  });

  test("single_owner rounds still honor an explicit primary edge", async () => {
    const roundsDir = await tempRoundsDir("orchestrate-single-owner");
    const runs: string[] = [];
    await executeCollaborationRoundForTest({
      decision: orchestrationDecision("single_owner"),
      policy: supplementPolicy(),
      scope: createDigitalTeamScope(),
      message: ORCHESTRATION_ROUND.userMessage,
      sessionKey: "space:grp-daniel-hhd-gmail-com-upbeyond",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ bot, role }) => {
        runs.push(`${role}:${bot.agentId}`);
        return bot.agentId === "panda"
          ? { text: "分工如下。", rawText: ORCHESTRATION_ROUND.edgeReply }
          : { text: "子任务结果。" };
      },
    });
    expect(runs).toEqual(["primary:panda", "supplement:bot-2", "supplement:bot--agent"]);
  });

  test("edges to non-members (大白管家) or self are dropped; at most 2 edges", async () => {
    const roundsDir = await tempRoundsDir("orchestrate-outsider");
    const runs: string[] = [];
    const round = await executeCollaborationRoundForTest({
      decision: orchestrationDecision(),
      policy: supplementPolicy(),
      scope: createDigitalTeamScope(),
      message: ORCHESTRATION_ROUND.userMessage,
      sessionKey: "space:grp-daniel-hhd-gmail-com-upbeyond",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ bot, role }) => {
        runs.push(`${role}:${bot.agentId}`);
        return bot.agentId === "panda"
          ? {
              text: "结论：按三路分工推进。",
              rawText: [
                "结论：按三路分工推进。",
                "[[collab_edge:handoff|to=大白管家|reason=统筹]]",
                "[[collab_edge:peer_ask|to=熊猫学习|reason=自问]]",
                "[[collab_edge:peer_ask|to=@高级秘书|reason=排期]]",
                "[[collab_edge:peer_ask|to=Skill孵化|reason=技能]]",
                "[[collab_edge:peer_ask|to=市场助手|reason=第三条超预算]]",
              ].join("\n"),
            }
          : { text: "补充结果。" };
      },
    });
    expect(round.edges?.map((edge) => edge.toAgentId)).toEqual(["bot", "bot-skill"]);
    expect(runs).toEqual(["primary:panda", "supplement:bot", "supplement:bot-skill"]);
  });
});

describe("P1-1: @所有人 fans out to every group bot", () => {
  test("37c318ed: 「@所有人 其他人呢」 is a broadcast with all bots invited (bounded by maxVisible)", () => {
    const decision = decideParticipantsForTest({
      message: BROADCAST_ROUND.userMessage,
      scope: createDigitalTeamScope(),
      roundId: BROADCAST_ROUND.roundId,
    });
    expect(decision.mentionMode).toBe("broadcast");
    expect(decision.roundPlan.mentionAll).toBe(true);
    expect(decision.primaryMode).toBe("single");
    expect(decision.primaryQueue).toHaveLength(1);
    expect(decision.executionBots).toHaveLength(5);
    expect(decision.roundPlan.participants.every((entry) => entry.tier === "mention")).toBe(true);
    expect(decision.roundPlan.alerts?.some((alert) => alert.kind === "broadcast_mention")).toBe(
      true,
    );
  });

  test("broadcast respects a lower maxVisibleBotRepliesPerRound", () => {
    const base = createDigitalTeamScope();
    const scope: CollaborationDispatchScope = {
      ...base,
      operatingState: {
        ...base.operatingState!,
        collaborationPolicy: {
          ...base.operatingState!.collaborationPolicy,
          maxVisibleBotRepliesPerRound: 3,
        },
      },
    };
    const decision = decideParticipantsForTest({
      message: BROADCAST_ROUND.userMessage,
      scope,
      roundId: `${BROADCAST_ROUND.roundId}-cap`,
    });
    expect(decision.executionBots).toHaveLength(3);
  });

  test("broadcast round dispatches every invited bot — none dropped for low_relevance", async () => {
    const roundsDir = await tempRoundsDir("broadcast");
    const scope = createDigitalTeamScope();
    const decision = decideParticipantsForTest({
      message: BROADCAST_ROUND.userMessage,
      scope,
      roundId: BROADCAST_ROUND.roundId,
    });
    const runs: string[] = [];
    const round = await executeCollaborationRoundForTest({
      decision,
      policy: supplementPolicy(),
      scope,
      message: BROADCAST_ROUND.userMessage,
      sessionKey: "space:grp-daniel-hhd-gmail-com-upbeyond",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ bot, role }) => {
        runs.push(`${role}:${bot.agentId}`);
        // Presence replies carry no 结论 — the invited window must still open.
        return { text: role === "primary" ? BROADCAST_ROUND.primaryReply : `${bot.name}在。` };
      },
    });
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(runs).toHaveLength(5);
    expect(runs.filter((entry) => entry.startsWith("supplement:"))).toHaveLength(4);
    const events = await readEvents(roundsDir, BROADCAST_ROUND.roundId);
    expect(events.some((event) => event.type === "CANDIDATE_DROPPED")).toBe(false);
    expect(round.policyDecision?.supplementWindow).toEqual({ opened: true, reason: "invited" });
  });
});

describe("P1-2: short correction sticks to the previous round's primary", () => {
  test("6f230125: correction to panda goes back to panda, not a duty-ranked bot", () => {
    const decision = decideParticipantsForTest({
      message: FOLLOW_UP_ROUND.userMessage,
      scope: createDigitalTeamScope(),
      roundId: FOLLOW_UP_ROUND.roundId,
      recentGroupMessages: FOLLOW_UP_ROUND.recentGroupMessages,
      senderLabel: "CEO",
      nowMs: FOLLOW_UP_ROUND.userAtMs,
    });
    expect(decision.primaryQueue).toEqual(["panda"]);
    expect(decision.executionBots.map((bot) => bot.agentId)).toEqual(["panda"]);
    expect(
      decision.roundPlan.alerts?.some((alert) => alert.kind === "last_speaker_follow_up"),
    ).toBe(true);
  });

  test("stale previous answer (> window) does not force the last speaker", () => {
    const decision = decideParticipantsForTest({
      message: FOLLOW_UP_ROUND.userMessage,
      scope: createDigitalTeamScope(),
      roundId: `${FOLLOW_UP_ROUND.roundId}-stale`,
      recentGroupMessages: FOLLOW_UP_ROUND.recentGroupMessages,
      senderLabel: "CEO",
      nowMs: FOLLOW_UP_ROUND.userAtMs + 60 * 60_000,
    });
    expect(
      decision.roundPlan.alerts?.some((alert) => alert.kind === "last_speaker_follow_up"),
    ).toBeFalsy();
  });

  test("a different human correcting does not inherit the previous speaker", () => {
    const decision = decideParticipantsForTest({
      message: FOLLOW_UP_ROUND.userMessage,
      scope: createDigitalTeamScope(),
      roundId: `${FOLLOW_UP_ROUND.roundId}-other-human`,
      recentGroupMessages: FOLLOW_UP_ROUND.recentGroupMessages,
      senderLabel: "elle",
      nowMs: FOLLOW_UP_ROUND.userAtMs,
    });
    expect(
      decision.roundPlan.alerts?.some((alert) => alert.kind === "last_speaker_follow_up"),
    ).toBeFalsy();
  });

  test("a new task (not a correction) is not treated as a follow-up", () => {
    const decision = decideParticipantsForTest({
      message: "请分析一下AI办公软件的定价策略",
      scope: createDigitalTeamScope(),
      roundId: `${FOLLOW_UP_ROUND.roundId}-new-task`,
      recentGroupMessages: FOLLOW_UP_ROUND.recentGroupMessages,
      senderLabel: "CEO",
      nowMs: FOLLOW_UP_ROUND.userAtMs,
    });
    expect(
      decision.roundPlan.alerts?.some((alert) => alert.kind === "last_speaker_follow_up"),
    ).toBeFalsy();
  });

  test("a correction that names another bot follows the named bot", () => {
    const decision = decideParticipantsForTest({
      message: "我并没有让市场助手做定价",
      scope: createDigitalTeamScope(),
      roundId: `${FOLLOW_UP_ROUND.roundId}-named`,
      recentGroupMessages: FOLLOW_UP_ROUND.recentGroupMessages,
      senderLabel: "CEO",
      nowMs: FOLLOW_UP_ROUND.userAtMs,
    });
    expect(decision.primaryQueue).toEqual(["bot-2"]);
  });
});

describe("P1-3: supplement window calibration", () => {
  function plannedOpenDecision(roundId: string) {
    return manualDecision({
      roundId,
      responseMode: "lead_plus_supplement",
      lead: DIGITAL_TEAM_BOTS.secretary,
      supplements: [
        { bot: DIGITAL_TEAM_BOTS.analyst, tier: "relevance" },
        { bot: DIGITAL_TEAM_BOTS.market, tier: "relevance" },
        { bot: DIGITAL_TEAM_BOTS.skill, tier: "relevance" },
      ],
    });
  }

  test("all low_relevance + primary invites input → top candidate rescued, rest recorded as dropped", async () => {
    const roundsDir = await tempRoundsDir("rescue");
    const runs: string[] = [];
    const round = await executeCollaborationRoundForTest({
      decision: plannedOpenDecision("rescue-round"),
      policy: supplementPolicy(),
      scope: createDigitalTeamScope(),
      message: "这周的节奏怎么安排",
      sessionKey: "space:grp-daniel-hhd-gmail-com-upbeyond",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ bot, role }) => {
        runs.push(`${role}:${bot.agentId}`);
        return role === "primary"
          ? { text: "结论：本周先收敛议题。建议下一步：请其他成员补充各自视角。" }
          : { text: "补充：从数据侧先核对口径。" };
      },
    });
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(runs.filter((entry) => entry.startsWith("supplement:"))).toHaveLength(1);
    const gate = round.policyDecision?.supplementGate ?? [];
    expect(gate.filter((entry) => entry.reason === "low_relevance")).toHaveLength(3);
    expect(gate.filter((entry) => entry.reason === "rescued_top_candidate")).toHaveLength(1);
    const events = await readEvents(roundsDir, "rescue-round");
    expect(events.filter((event) => event.type === "CANDIDATE_DROPPED")).toHaveLength(2);
  });

  test("without an invitation from the primary, low_relevance candidates stay dropped", async () => {
    const roundsDir = await tempRoundsDir("no-rescue");
    const runs: string[] = [];
    const round = await executeCollaborationRoundForTest({
      decision: plannedOpenDecision("no-rescue-round"),
      policy: supplementPolicy(),
      scope: createDigitalTeamScope(),
      message: "这周的节奏怎么安排",
      sessionKey: "space:grp-daniel-hhd-gmail-com-upbeyond",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ bot, role }) => {
        runs.push(`${role}:${bot.agentId}`);
        return { text: "结论：本周先收敛议题。建议下一步：周三前给出排期。" };
      },
    });
    expect(round.state).toBe("ROUND_COMPLETE");
    expect(runs).toEqual(["primary:bot"]);
    expect(
      round.policyDecision?.supplementGate?.every((entry) => entry.reason === "low_relevance"),
    ).toBe(true);
  });

  test("explicitly @mentioned supplements are never dropped for low_relevance", async () => {
    const roundsDir = await tempRoundsDir("invited");
    const runs: string[] = [];
    await executeCollaborationRoundForTest({
      decision: manualDecision({
        roundId: "invited-round",
        responseMode: "lead_plus_supplement",
        lead: DIGITAL_TEAM_BOTS.secretary,
        leadTier: "mention",
        supplements: [{ bot: DIGITAL_TEAM_BOTS.skill, tier: "mention" }],
      }),
      policy: supplementPolicy(),
      scope: createDigitalTeamScope(),
      message: "这周的节奏怎么安排",
      sessionKey: "space:grp-daniel-hhd-gmail-com-upbeyond",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ bot, role }) => {
        runs.push(`${role}:${bot.agentId}`);
        return { text: "本周节奏：周一对齐，周三评审。" };
      },
    });
    expect(runs).toEqual(["primary:bot", "supplement:bot-skill"]);
  });
});

describe("decision_to_executor keeps its executor stage", () => {
  test("confirm reply without 结论 still hands over to the planned executor", async () => {
    const roundsDir = await tempRoundsDir("d2e");
    const runs: string[] = [];
    const decision: ParticipationDecision = {
      ...manualDecision({
        roundId: "d2e-round",
        responseMode: "decision_to_executor",
        lead: DIGITAL_TEAM_BOTS.secretary,
        leadTier: "mention",
        supplements: [{ bot: DIGITAL_TEAM_BOTS.market, tier: "duty" }],
      }),
    };
    decision.roundPlan.participants = [
      participant(DIGITAL_TEAM_BOTS.secretary, "mention", "confirm"),
      participant(DIGITAL_TEAM_BOTS.market, "duty", "executor"),
    ];
    await executeCollaborationRoundForTest({
      decision,
      policy: supplementPolicy(),
      scope: createDigitalTeamScope(),
      message: "1. 名字叫增长周报 2. 范围只看国内",
      sessionKey: "space:grp-daniel-hhd-gmail-com-upbeyond",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ bot, role }) => {
        runs.push(`${role}:${bot.agentId}`);
        return {
          text: role === "primary" ? "已写入任务卡：增长周报，国内范围。" : "交付：初稿已生成。",
        };
      },
    });
    expect(runs).toEqual(["primary:bot", "supplement:bot-2"]);
  });
});
