/**
 * Floor Runtime v2.1 §5.4 P0.2 — 15:13 v1-only roll-call hotfix.
 *
 * H1–H4 below are derived from §5.4 gate text + v1 §B.19 T1 (v2 §B.25.1 source
 * doc was not present in the workspace; exact wording is an open question).
 */
import { afterEach, describe, expect, it } from "vitest";
import { clearRuntimeConfigSnapshot, setRuntimeConfigSnapshot } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import type { CollaborationExecutionRecord } from "../collaboration-ledger/types.js";
import {
  createDigitalTeamScope,
  DIGITAL_TEAM_BOT_LIST,
  DIGITAL_TEAM_BOTS,
} from "./__fixtures__/digital-team-real-rounds.js";
import { decideParticipantsForTest } from "./__fixtures__/runtime-authority-test-utils.js";
import { SYSTEM_INVARIANTS } from "./effective-policy.js";
import {
  buildV1RollCallRosterFromExecutions,
  buildV1RollCallRosterPromptLines,
  buildV1RollCallRosterUnavailable,
  expandV1RollCallInvitedAgentIds,
  isV1RollCallHotfixGroup,
  isV1RollCallStopMessage,
  isV1RollCallTriggerMessage,
} from "./hotfix-rollcall-v1.js";
import type { CollaborationDispatchScope, ParticipationDecision } from "./types.js";

const AFFECTED_GROUP = "grp-daniel-hhd-gmail-com-upbeyond";
const AFFECTED_KEY = `001/${AFFECTED_GROUP}`;
const OUTSIDER_GROUP = "grp-unrelated-gold";

function useHotfixList(entries: string[]) {
  const cfg = {
    collaboration: {
      hotfix: { v1RollCallGroups: entries },
    },
  } as OpenBotConfig;
  setRuntimeConfigSnapshot(cfg, cfg);
  return cfg;
}

/** Field config from v1 §A.13.1 (15:13 replay). */
function createFieldScope(
  overrides: Partial<CollaborationDispatchScope> = {},
): CollaborationDispatchScope {
  const base = createDigitalTeamScope({
    coordinatorBotId: "bot",
    ...overrides,
  });
  const operatingState = {
    ...base.operatingState!,
    groupProfile: {
      ...base.operatingState!.groupProfile,
      collaborationMode: "task_driven" as const,
      currentMission: "推进本周交付",
    },
    governance: {
      ...base.operatingState!.governance,
      coordinatorBotId: "bot",
    },
    collaborationPolicy: {
      ...base.operatingState!.collaborationPolicy,
      openDiscussionWithoutMention: false,
      maxVisibleBotRepliesPerRound: 3,
      allowSupplementAfterPrimary: true,
    },
    activeContext: {
      ...base.operatingState!.activeContext,
      currentMission: "推进本周交付",
      currentOperatingPhase: "explore",
    },
  };
  return {
    ...base,
    tenantId: "001",
    coordinatorBotId: "bot",
    ...overrides,
    operatingState: overrides.operatingState ?? operatingState,
  } as CollaborationDispatchScope;
}

function stableDecisionBytes(decision: ParticipationDecision): string {
  const stable = {
    responseMode: decision.responseMode,
    primaryMode: decision.primaryMode,
    mentionMode: decision.mentionMode,
    primaryQueue: [...decision.primaryQueue].toSorted(),
    participantAgentIds: decision.executionBots.map((b) => b.agentId).toSorted(),
    planParticipants: decision.roundPlan.participants
      .map((p) => ({
        agentId: p.agentId,
        tier: p.tier,
        contributionRole: p.contributionRole,
      }))
      .toSorted((a, b) => a.agentId.localeCompare(b.agentId)),
  };
  return JSON.stringify(stable);
}

afterEach(() => {
  clearRuntimeConfigSnapshot();
});

describe("P0.2 allow-list gate", () => {
  it("empty list / unset = off", () => {
    expect(isV1RollCallHotfixGroup({ tenantId: "001", groupId: AFFECTED_GROUP })).toBe(false);
    useHotfixList([]);
    expect(isV1RollCallHotfixGroup({ tenantId: "001", groupId: AFFECTED_GROUP })).toBe(false);
  });

  it("matches tenantId/groupId and * wildcard", () => {
    useHotfixList([AFFECTED_KEY]);
    expect(isV1RollCallHotfixGroup({ tenantId: "001", groupId: AFFECTED_GROUP })).toBe(true);
    expect(isV1RollCallHotfixGroup({ tenantId: "001", groupId: OUTSIDER_GROUP })).toBe(false);
    useHotfixList([`*/${AFFECTED_GROUP}`]);
    expect(isV1RollCallHotfixGroup({ tenantId: "002", groupId: AFFECTED_GROUP })).toBe(true);
  });
});

describe("H1: broadcast / @所有人 → explicit_multi multi-primary", () => {
  it("field 分别介绍一下自己: primaryMode explicit_multi, queue size = eligible count", () => {
    useHotfixList([AFFECTED_KEY]);
    const scope = createFieldScope();
    const decision = decideParticipantsForTest({
      message: "其他人员在吗，我需要你们分别介绍一下自己",
      scope,
      roundId: "h1-intro",
    });
    expect(decision.primaryMode).toBe("explicit_multi");
    expect(decision.primaryQueue.length).toBeGreaterThan(1);
    expect(decision.primaryQueue.length).toBe(decision.executionBots.length);
    expect(decision.primaryQueue.length).toBeLessThanOrEqual(
      SYSTEM_INVARIANTS.maxVisibleRepliesCeiling,
    );
    // All participants are lead (mention tier), not supplement.
    for (const p of decision.roundPlan.participants) {
      expect(p.tier).toBe("mention");
      expect(p.contributionRole).toBe("lead");
    }
  });

  it("@所有人 fans out to eligible members as explicit_multi", () => {
    useHotfixList([AFFECTED_KEY]);
    const scope = createFieldScope();
    const decision = decideParticipantsForTest({
      message: "@所有人 说下本周计划",
      scope,
      roundId: "h1-all",
      explicitMentions: ["所有人"],
    });
    expect(decision.primaryMode).toBe("explicit_multi");
    expect(decision.primaryQueue.length).toBeGreaterThan(1);
  });
});

describe("H2: all not-yet-introduced members each get one primary slot (Coverage 100%)", () => {
  it("follow-up after one intro skips that member and keeps the rest", () => {
    useHotfixList([AFFECTED_KEY]);
    const scope = createFieldScope();
    const recent = [
      {
        role: "user",
        content: [{ type: "text", text: "大家好" }],
        timestamp: 1,
        senderLabel: "CEO",
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "我是高级秘书，负责协调。" }],
        timestamp: 2,
        senderLabel: "高级秘书",
        agentId: "bot",
      },
    ];
    const decision = decideParticipantsForTest({
      message: "其他人员在吗，我需要你们分别介绍一下自己",
      scope,
      roundId: "h2-follow",
      recentGroupMessages: recent,
    });
    expect(decision.primaryMode).toBe("explicit_multi");
    const queue = new Set(decision.primaryQueue);
    // Secretary already introduced → should be skipped on intro follow-up.
    expect(queue.has("bot")).toBe(false);
    // Remaining peers each get a slot.
    for (const bot of DIGITAL_TEAM_BOT_LIST) {
      if (bot.agentId === "bot") {
        continue;
      }
      expect(queue.has(bot.agentId)).toBe(true);
    }
    expect(decision.primaryQueue.length).toBe(DIGITAL_TEAM_BOT_LIST.length - 1);
  });
});

describe("H3: roll-call vocabulary beats ≤4 chitchat; continuation", () => {
  it("「点名」 is a trigger, not chitchat_idle single", () => {
    expect(isV1RollCallTriggerMessage("点名")).toBe(true);
    useHotfixList([AFFECTED_KEY]);
    const scope = createFieldScope();
    const decision = decideParticipantsForTest({
      message: "点名",
      scope,
      roundId: "h3-dianming",
    });
    expect(decision.primaryMode).toBe("explicit_multi");
    expect(decision.primaryQueue.length).toBeGreaterThan(1);
  });

  it("「其他成员呢」 triggers roll-call", () => {
    useHotfixList([AFFECTED_KEY]);
    const scope = createFieldScope();
    const decision = decideParticipantsForTest({
      message: "其他成员呢",
      scope,
      roundId: "h3-others",
    });
    expect(decision.primaryMode).toBe("explicit_multi");
    expect(decision.primaryQueue.length).toBeGreaterThan(1);
  });
});

describe("H4: stop words + ledger roster fail-closed", () => {
  it("recognizes stop words", () => {
    expect(isV1RollCallStopMessage("停")).toBe(true);
    expect(isV1RollCallStopMessage("够了")).toBe(true);
    expect(isV1RollCallStopMessage("别说了")).toBe(true);
    expect(isV1RollCallStopMessage("/stop")).toBe(true);
    expect(isV1RollCallStopMessage("请继续")).toBe(false);
  });

  it("roster from execution completed; unavailable forbids 已到齐", () => {
    const executions: CollaborationExecutionRecord[] = [
      {
        kind: "execution",
        roundId: "r1",
        groupId: AFFECTED_GROUP,
        sessionKey: `space:${AFFECTED_GROUP}`,
        agentId: "bot-2",
        agentName: "市场助手",
        tier: "mention",
        status: "completed",
        recordedAtMs: 1,
      },
    ];
    const roster = buildV1RollCallRosterFromExecutions({
      bots: DIGITAL_TEAM_BOT_LIST,
      executions,
    });
    expect(roster.ok).toBe(true);
    expect(roster.answeredAgentIds).toContain("bot-2");
    expect(roster.unansweredAgentIds).toContain("panda");
    const lines = buildV1RollCallRosterPromptLines(roster);
    expect(lines.join("\n")).toContain("未应答");
    expect(lines.join("\n")).toContain("禁止声称「已到齐」");

    const bad = buildV1RollCallRosterUnavailable("EIO");
    const badLines = buildV1RollCallRosterPromptLines(bad);
    expect(badLines.join("\n")).toContain("读取失败");
    expect(badLines.join("\n")).toContain("禁止声称");
  });
});

describe("P0-2 invited expansion", () => {
  it("expands duty/relevance participants to invited when allow-listed", () => {
    useHotfixList([AFFECTED_KEY]);
    const scope = createFieldScope();
    const baseline = decideParticipantsForTest({
      message: "普通任务请分析一下",
      scope,
      roundId: "inv-base",
    });
    // Force a synthetic decision with duty tiers to assert expansion.
    const synthetic: ParticipationDecision = {
      ...baseline,
      primaryMode: "single",
      mentionMode: "none",
      roundPlan: {
        ...baseline.roundPlan,
        participants: DIGITAL_TEAM_BOT_LIST.slice(0, 3).map((bot, i) => ({
          agentId: bot.agentId,
          displayName: bot.name,
          tier: i === 0 ? ("mention" as const) : ("duty" as const),
          contributionRole: i === 0 ? ("lead" as const) : ("supplement" as const),
          reasonText: "test",
        })),
      },
    };
    const invited = expandV1RollCallInvitedAgentIds({
      scope,
      decision: synthetic,
      invitedAgentIds: new Set(["bot"]),
    });
    expect(invited.has("bot")).toBe(true);
    expect(invited.has(DIGITAL_TEAM_BOTS.analyst.agentId)).toBe(true);
  });
});

describe("characterization: @ / observer / blocked", () => {
  it("named @ still dispatches even when agent is blocked", () => {
    useHotfixList([AFFECTED_KEY]);
    const scope = createFieldScope({
      blockedAgentIds: ["panda"],
    });
    const decision = decideParticipantsForTest({
      message: "@熊猫学习 你在吗",
      scope,
      roundId: "char-mention",
      explicitMentions: ["熊猫学习"],
    });
    expect(decision.primaryQueue).toContain("panda");
  });

  it("observer never enters un-@ roll-call fan-out", () => {
    useHotfixList([AFFECTED_KEY]);
    const scope = createFieldScope();
    const operatingState = {
      ...scope.operatingState!,
      memberRoleMap: [
        ...(scope.operatingState!.memberRoleMap ?? []),
        {
          memberId: "panda",
          memberKind: "bot" as const,
          label: "熊猫学习",
          governanceRole: "observer" as const,
          collaborationRole: "contributor" as const,
          status: "active" as const,
        },
      ],
    };
    const withObserver = { ...scope, operatingState } as CollaborationDispatchScope;
    const decision = decideParticipantsForTest({
      message: "点名",
      scope: withObserver,
      roundId: "char-obs",
    });
    expect(decision.primaryQueue).not.toContain("panda");
  });

  it("blocked members stay out of un-@ fan-out", () => {
    useHotfixList([AFFECTED_KEY]);
    const scope = createFieldScope({ blockedAgentIds: ["bot-2"] });
    const decision = decideParticipantsForTest({
      message: "点名",
      scope,
      roundId: "char-blocked",
    });
    expect(decision.primaryQueue).not.toContain("bot-2");
  });
});

describe("golden: groups outside allow-list are byte-identical to baseline", () => {
  it("outsider group matches empty-list decision bytes", () => {
    const scope = createFieldScope({
      groupId: OUTSIDER_GROUP,
      tenantId: "001",
    });
    // Ensure operatingState groupId matches for consistency.
    scope.operatingState = {
      ...scope.operatingState!,
      groupId: OUTSIDER_GROUP,
    };

    clearRuntimeConfigSnapshot();
    const off = decideParticipantsForTest({
      message: "其他人员在吗，我需要你们分别介绍一下自己",
      scope,
      roundId: "gold-off",
    });

    useHotfixList([AFFECTED_KEY]); // list does not include outsider
    const on = decideParticipantsForTest({
      message: "其他人员在吗，我需要你们分别介绍一下自己",
      scope,
      roundId: "gold-off",
    });
    expect(stableDecisionBytes(on)).toBe(stableDecisionBytes(off));
  });

  it("empty allow-list equals baseline on affected group", () => {
    const scope = createFieldScope();
    clearRuntimeConfigSnapshot();
    const off = decideParticipantsForTest({
      message: "其他人员在吗，我需要你们分别介绍一下自己",
      scope,
      roundId: "gold-empty",
    });
    useHotfixList([]);
    const empty = decideParticipantsForTest({
      message: "其他人员在吗，我需要你们分别介绍一下自己",
      scope,
      roundId: "gold-empty",
    });
    expect(stableDecisionBytes(empty)).toBe(stableDecisionBytes(off));
    // And empty-list must NOT be explicit_multi for this path (baseline bug still present).
    expect(off.primaryMode).toBe("single");
    expect(off.primaryQueue.length).toBe(1);
  });
});
