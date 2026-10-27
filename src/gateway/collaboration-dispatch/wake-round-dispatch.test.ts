import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { testAuthorityFromScope } from "./__fixtures__/runtime-authority-test-utils.js";
import type { GroupBoardClaimItem } from "./claim-contract.js";
import { confirmTodolist, proposeTodolist } from "./executor-private-todolist.js";
import { createModeBWakeRoundDispatcher } from "./mode-b-wake-round-dispatcher.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority, type RuntimeAuthority } from "./runtime-authority.js";
import { trySelfAdvance } from "./self-advance.js";
import type { CollaborationBotTarget } from "./types.js";
import { listWakeEvents, whoWokeWhom } from "./wake-contract.js";
import { readWakeOpDurableEffectReceipt } from "./wake-op-effect-verify.js";
import {
  consumeWakeForRoundDispatch,
  evaluateWakeRoundDispatchGate,
  setWakeRoundDispatcher,
  wakeRoundDispatchDefaultsToRecorded,
  type WakeRoundDispatcher,
} from "./wake-round-dispatch.js";

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;

afterEach(async () => {
  setWakeRoundDispatcher(null);
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  if (savedStateDir === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = savedStateDir;
  }
  if (savedOpenbotConfigPath === undefined) {
    delete process.env.OPENBOT_CONFIG_PATH;
  } else {
    process.env.OPENBOT_CONFIG_PATH = savedOpenbotConfigPath;
  }
  if (savedOpenclawConfigPath === undefined) {
    delete process.env.OPENCLAW_CONFIG_PATH;
  } else {
    process.env.OPENCLAW_CONFIG_PATH = savedOpenclawConfigPath;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function flagConfig(
  root: string,
  over?: {
    wakeContract?: boolean;
    wakeAllowlist?: string[];
    selfAdvanceMode?: "dry_run" | "execute";
    selfAdvanceExecuteAllowlist?: string[];
    claimContract?: boolean;
  },
): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        claimContract: over?.claimContract ?? true,
        wakeContract: over?.wakeContract ?? false,
        wakeContractGroupAllowlist: over?.wakeAllowlist ?? [],
        selfAdvance: {
          mode: over?.selfAdvanceMode ?? "dry_run",
          executeGroupAllowlist: over?.selfAdvanceExecuteAllowlist ?? [],
        },
      },
    },
  } as OpenBotConfig;
}

async function useConfig(over?: Parameters<typeof flagConfig>[1]): Promise<{
  root: string;
  cfg: OpenBotConfig;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-wake-dispatch-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  const cfg = flagConfig(root, over);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return { root, cfg };
}

function authority(
  cfg: OpenBotConfig,
  groupId = "grp_wd",
  opts?: { botMaySelfAdvanceWithoutHuman?: boolean },
): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    {
      collaborationMode: "task_driven",
      finalDecisionMode: "human_required",
      botMaySelfAdvanceWithoutHuman: opts?.botMaySelfAdvanceWithoutHuman ?? true,
    },
    { now: 1, idGen: () => "pss_wake_dispatch" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_wake_dispatch",
    tenant: { tenantId: null, trust: "none" },
    groupId,
    profile: "personal_local",
    cfg,
  });
}

function boardItem(
  partial: Partial<GroupBoardClaimItem> & { itemId: string },
): GroupBoardClaimItem {
  return {
    groupId: "grp_wd",
    taskId: "task_wd",
    title: "P0-2 wake dispatch",
    remainingWork: "rw",
    acceptanceCriteria: ["a"],
    intendedClaimantIds: ["bot:analyst"],
    publishedBy: "bot:lead",
    publishedAt: 1,
    status: "in_progress",
    claimantId: "bot:analyst",
    claimedAt: 2,
    appliedAt: 3,
    inProgressAt: 4,
    ...partial,
  };
}

async function confirmPlan(
  auth: RuntimeAuthority,
  cfg: OpenBotConfig,
  item: GroupBoardClaimItem,
): Promise<void> {
  const proposed = await proposeTodolist(
    auth,
    {
      boardItemId: item.itemId,
      taskId: item.taskId,
      groupId: item.groupId,
      ownerMemberId: item.claimantId ?? "bot:analyst",
      steps: [{ title: "下一步" }],
    },
    { cfg },
  );
  expect(proposed.ok).toBe(true);
  if (!proposed.ok) {
    return;
  }
  await confirmTodolist(
    auth,
    {
      taskId: item.taskId,
      todolistId: proposed.value.todolistId,
      confirmerId: "bot:lead",
    },
    { cfg, authorizedConfirmerIds: ["bot:lead"] },
  );
}

describe("P0-2 wake→round dispatch consumer", () => {
  it("defaults to recorded (contract)", () => {
    expect(wakeRoundDispatchDefaultsToRecorded()).toBe(true);
  });

  it("gate: allowlist外 / dry_run → not allowed (recorded path)", async () => {
    const { cfg } = await useConfig({
      wakeContract: true,
      selfAdvanceMode: "execute",
      selfAdvanceExecuteAllowlist: ["grp_other"],
    });
    const gate = evaluateWakeRoundDispatchGate({
      source: "self_advance",
      groupId: "grp_wd",
      cfg,
    });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("self_advance_not_execute");
    expect(gate.selfAdvanceWriteMode).toBe("dry_run");
  });

  it("gate: wake off → not allowed", async () => {
    const { cfg } = await useConfig({
      wakeContract: false,
      selfAdvanceMode: "execute",
      selfAdvanceExecuteAllowlist: ["grp_wd"],
    });
    const gate = evaluateWakeRoundDispatchGate({
      source: "nudge",
      groupId: "grp_wd",
      cfg,
      writeMode: "execute",
    });
    expect(gate.allowed).toBe(false);
    expect(gate.reason).toBe("wake_contract_off");
  });

  it("gate: execute + wake allowlist → allowed", async () => {
    const { cfg } = await useConfig({
      wakeContract: true,
      selfAdvanceMode: "execute",
      selfAdvanceExecuteAllowlist: ["grp_wd"],
    });
    const gate = evaluateWakeRoundDispatchGate({
      source: "escalate",
      groupId: "grp_wd",
      cfg,
    });
    expect(gate.allowed).toBe(true);
    expect(gate.reason).toBe("wake_round_dispatch_eligible");
  });

  it("consume: 无消费 → recorded even when gated", async () => {
    const { cfg } = await useConfig({
      wakeContract: true,
      selfAdvanceMode: "execute",
      selfAdvanceExecuteAllowlist: ["grp_wd"],
    });
    const auth = authority(cfg);
    setWakeRoundDispatcher(null);
    const result = await consumeWakeForRoundDispatch({
      authority: auth,
      cfg,
      writeMode: "execute",
      roundDispatcher: null,
      nowMs: 1_700_000_000_000,
      request: {
        groupId: "grp_wd",
        fromAgentId: "system:self_advance",
        toAgentIds: ["bot:analyst"],
        source: "self_advance",
        taskId: "task_wd",
        itemId: "i1",
        reason: "test:no_consumer",
      },
    });
    expect(result.dispatched).toBe(false);
    expect(result.outcome).toBe("recorded");
    expect(result.reason).toBe("no_consumer");
    expect(result.wakeEvent?.outcome).toBe("recorded");
    const timeline = whoWokeWhom(await listWakeEvents(auth, { groupId: "grp_wd" }));
    expect(
      timeline.some((row) => row.source === "self_advance" && row.outcome === "recorded"),
    ).toBe(true);
  });

  it("W3-prod: nudge + no_consumer writes durable none receipt; missing≠none after throw", async () => {
    const { cfg } = await useConfig({
      wakeContract: true,
      selfAdvanceMode: "execute",
      selfAdvanceExecuteAllowlist: ["grp_wd"],
    });
    const auth = authority(cfg);

    const noneResult = await consumeWakeForRoundDispatch({
      authority: auth,
      cfg,
      writeMode: "execute",
      roundDispatcher: null,
      nowMs: 1_700_000_000_100,
      request: {
        groupId: "grp_wd",
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: ["bot:analyst"],
        source: "nudge",
        taskId: "task_nudge_none",
        itemId: "nudge-none-1",
        reason: "test:nudge_no_consumer",
      },
    });
    expect(noneResult.dispatched).toBe(false);
    expect(noneResult.reason).toBe("no_consumer");
    expect(noneResult.opKey).toBeTruthy();
    const attemptId = noneResult.wakeOp?.executionAttemptId;
    expect(attemptId).toBeTruthy();
    const receipt = await readWakeOpDurableEffectReceipt({
      authority: auth,
      opKey: noneResult.opKey!,
      attemptId: attemptId!,
    });
    expect(receipt).not.toBeNull();
    expect(receipt?.outcome).toBe("none");
    expect(receipt?.operationType).toBe("nudge");
    expect(receipt?.source).toBe("executor:nudge:no_external_call:no_consumer");

    const throwResult = await consumeWakeForRoundDispatch({
      authority: auth,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        throw new Error("boom_after_invoke");
      },
      nowMs: 1_700_000_000_110,
      request: {
        groupId: "grp_wd",
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: ["bot:analyst"],
        source: "nudge",
        taskId: "task_nudge_throw",
        itemId: "nudge-throw-1",
        reason: "test:nudge_throw",
      },
    });
    expect(throwResult.dispatched).toBe(false);
    expect(throwResult.wakeOp?.status).toBe("unknown");
    const throwAttempt = throwResult.wakeOp?.executionAttemptId;
    expect(throwAttempt).toBeTruthy();
    const missing = await readWakeOpDurableEffectReceipt({
      authority: auth,
      opKey: throwResult.opKey!,
      attemptId: throwAttempt!,
    });
    // Absence of receipt must not be treated as none — verify path stays fail-closed.
    expect(missing).toBeNull();
  });

  it("consume: mock dispatcher success → dispatched; whoWokeWhom answers", async () => {
    const { cfg } = await useConfig({
      wakeContract: true,
      selfAdvanceMode: "execute",
      selfAdvanceExecuteAllowlist: ["grp_wd"],
    });
    const auth = authority(cfg);
    const mock: WakeRoundDispatcher = async () => ({
      ok: true,
      roundId: "round_mock_1",
      detail: "mock",
    });
    const result = await consumeWakeForRoundDispatch({
      authority: auth,
      cfg,
      writeMode: "execute",
      roundDispatcher: mock,
      nowMs: 1_700_000_000_010,
      request: {
        groupId: "grp_wd",
        fromAgentId: "system:self_advance",
        toAgentIds: ["bot:analyst"],
        source: "self_advance",
        taskId: "task_wd",
        itemId: "i2",
        reason: "test:dispatch",
      },
    });
    expect(result.dispatched).toBe(true);
    expect(result.outcome).toBe("dispatched");
    expect(result.roundId).toBe("round_mock_1");
    expect(result.wakeEvent?.outcome).toBe("dispatched");
    const timeline = whoWokeWhom(await listWakeEvents(auth, { groupId: "grp_wd" }));
    expect(
      timeline.some(
        (row) =>
          row.from === "system:self_advance" &&
          row.to === "bot:analyst" &&
          row.source === "self_advance" &&
          row.outcome === "dispatched",
      ),
    ).toBe(true);
  });

  it("consume: dry_run writeMode → recorded (no dispatch call)", async () => {
    const { cfg } = await useConfig({
      wakeContract: true,
      selfAdvanceMode: "execute",
      selfAdvanceExecuteAllowlist: ["grp_wd"],
    });
    const auth = authority(cfg);
    let called = 0;
    const mock: WakeRoundDispatcher = async () => {
      called += 1;
      return { ok: true, roundId: "should_not_run" };
    };
    const result = await consumeWakeForRoundDispatch({
      authority: auth,
      cfg,
      writeMode: "dry_run",
      roundDispatcher: mock,
      request: {
        groupId: "grp_wd",
        fromAgentId: "system:self_advance",
        toAgentIds: ["bot:analyst"],
        source: "self_advance",
        reason: "test:dry",
      },
    });
    expect(called).toBe(0);
    expect(result.dispatched).toBe(false);
    expect(result.outcome).toBe("recorded");
    expect(result.reason).toBe("self_advance_not_execute");
  });

  it("Mode B dispatcher + mock runBot → executeCollaborationRound dispatched", async () => {
    const { cfg } = await useConfig({
      wakeContract: true,
      selfAdvanceMode: "execute",
      selfAdvanceExecuteAllowlist: ["grp_wd"],
    });
    const lead: CollaborationBotTarget = {
      agentId: "bot:analyst",
      name: "分析助手",
      sessionKey: "agent:bot:analyst:main",
      updatedAt: 1,
    };
    const { authority: auth, facts } = testAuthorityFromScope({
      groupId: "grp_wd",
      rawSessionKey: "space:grp_wd",
      title: "WD",
      bots: [lead],
    });
    let ran = 0;
    const dispatcher = createModeBWakeRoundDispatcher(async () => ({
      authority: auth,
      facts: facts,
      sessionKey: "space:grp_wd",
      leadBot: lead,
      cfg,
      runBot: async () => {
        ran += 1;
        return { text: "继续推进" };
      },
    }));
    const result = await consumeWakeForRoundDispatch({
      authority: auth,
      cfg,
      writeMode: "execute",
      roundDispatcher: dispatcher,
      nowMs: 1_700_000_000_020,
      request: {
        groupId: "grp_wd",
        fromAgentId: "system:self_advance",
        toAgentIds: ["bot:analyst"],
        source: "self_advance",
        taskId: "task_wd",
        itemId: "i3",
        reason: "test:mode_b",
      },
    });
    expect(ran).toBeGreaterThan(0);
    expect(result.dispatched).toBe(true);
    expect(result.outcome).toBe("dispatched");
    expect(result.roundId).toBeTruthy();
  });

  it("trySelfAdvance execute: no dispatcher → recorded; with mock → dispatched", async () => {
    const { cfg } = await useConfig({
      claimContract: true,
      wakeContract: true,
      selfAdvanceMode: "execute",
      selfAdvanceExecuteAllowlist: ["grp_wd"],
    });
    const auth = authority(cfg);
    const item = boardItem({ itemId: "i-sa", status: "in_progress", claimantId: "bot:analyst" });
    await confirmPlan(auth, cfg, item);

    const recorded = await trySelfAdvance(auth, {
      cfg,
      actorId: "bot:analyst",
      currentMission: "AI×能源研究与交付",
      boardItems: [item],
      roundDispatcher: null,
      nowMs: 1_700_000_000_030,
      triggerSource: "test:sa_recorded",
    });
    expect(recorded.ok && recorded.advanced).toBe(true);
    if (recorded.ok && recorded.advanced) {
      expect(recorded.roundDispatched).toBe(false);
      expect(recorded.wakeEvent?.outcome).toBe("recorded");
    }

    const item2 = boardItem({ itemId: "i-sa2", status: "in_progress", claimantId: "bot:analyst" });
    await confirmPlan(auth, cfg, item2);
    const dispatched = await trySelfAdvance(auth, {
      cfg,
      actorId: "bot:analyst",
      currentMission: "AI×能源研究与交付",
      boardItems: [item2],
      roundDispatcher: async () => ({ ok: true, roundId: "round_sa_1" }),
      nowMs: 1_700_000_000_040,
      triggerSource: "test:sa_dispatched",
    });
    expect(dispatched.ok && dispatched.advanced).toBe(true);
    if (dispatched.ok && dispatched.advanced) {
      expect(dispatched.roundDispatched).toBe(true);
      expect(dispatched.roundId).toBe("round_sa_1");
      expect(dispatched.wakeEvent?.outcome).toBe("dispatched");
    }
  });
});

describe("Mode B wake single-lead mentionMode (consumption path)", () => {
  const lead: CollaborationBotTarget = {
    agentId: "bot:analyst",
    name: "分析助手",
    sessionKey: "agent:bot:analyst:main",
    updatedAt: 1,
  };
  const other: CollaborationBotTarget = {
    agentId: "bot:peer",
    name: "同伴",
    sessionKey: "agent:bot:peer:main",
    updatedAt: 2,
  };

  it("buildModeBWakeParticipationDecision uses single_primary on top-level and roundPlan", async () => {
    const { buildModeBWakeParticipationDecision } =
      await import("./mode-b-wake-round-dispatcher.js");
    const decision = buildModeBWakeParticipationDecision({
      roundId: "wake_test_1",
      sessionKey: "space:grp_mode_b_wake",
      leadBot: lead,
      reason: "test",
      source: "self_advance",
    });
    expect(decision.responseMode).toBe("single_owner");
    expect(decision.primaryMode).toBe("single");
    expect(decision.mentionMode).toBe("single_primary");
    expect(decision.roundPlan.mentionMode).toBe("single_primary");
    expect(decision.primaryQueue).toEqual([lead.agentId]);
    expect(decision.executionBots).toHaveLength(1);
  });

  it("executeCollaborationRound keeps single owner / single primaryQueue (no multi-mention fan-out)", async () => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const { executeCollaborationRoundForTest } =
      await import("./__fixtures__/runtime-authority-test-utils.js");
    const { buildModeBWakeParticipationDecision } =
      await import("./mode-b-wake-round-dispatcher.js");
    const { DEFAULT_COLLABORATION_POLICY } = await import("./policy.js");
    const roundsDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-mode-b-wake-"));
    const decision = buildModeBWakeParticipationDecision({
      roundId: "wake_consume_1",
      sessionKey: "space:grp_mode_b_wake",
      leadBot: lead,
      reason: "consume-path",
      source: "self_advance",
    });
    const calls: string[] = [];
    const round = await executeCollaborationRoundForTest({
      decision,
      policy: {
        ...DEFAULT_COLLABORATION_POLICY,
        supplement: { ...DEFAULT_COLLABORATION_POLICY.supplement, enabled: false },
        coordinator: { ...DEFAULT_COLLABORATION_POLICY.coordinator, enabled: false },
      },
      scope: {
        groupId: "grp_mode_b_wake",
        rawSessionKey: "space:grp_mode_b_wake",
        title: "Mode B Wake",
        bots: [lead, other],
      },
      message: "【Mode B 自推进】请继续推进",
      sessionKey: "space:grp_mode_b_wake",
      roundsDir,
      isAborted: () => false,
      runBot: async ({ dispatchId, bot }) => {
        calls.push(`${dispatchId}|${bot.agentId}`);
        return { text: "继续推进认领项，结论已给出。" };
      },
    });
    expect(round.mentionMode).toBe("single_primary");
    expect(round.primaryMode).toBe("single");
    expect(round.primaryQueue).toEqual([lead.agentId]);
    expect(round.collaborationMode).toBe("single_owner");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain(lead.agentId);
    expect(calls.some((c) => c.includes(other.agentId))).toBe(false);
    expect(round.state).toBe("ROUND_COMPLETE");
  });

  it("default board-kickoff expand does not rewrite Mode B single-lead into explicit_multi", async () => {
    const { buildModeBWakeParticipationDecision } =
      await import("./mode-b-wake-round-dispatcher.js");
    const { applyBoardKickoffMultiParticipant } = await import("./claim-contract.js");
    const decision = buildModeBWakeParticipationDecision({
      roundId: "wake_kickoff_1",
      sessionKey: "space:grp_mode_b_wake",
      leadBot: lead,
      reason: "kickoff-guard",
      source: "self_advance",
    });
    const next = applyBoardKickoffMultiParticipant({
      decision,
      groupId: "grp_mode_b_wake",
      groupBots: [lead, other],
      intendedClaimantIds: [lead.agentId, other.agentId],
    });
    expect(next.mentionMode).toBe("single_primary");
    expect(next.primaryMode).toBe("single");
    expect(next.primaryQueue).toEqual([lead.agentId]);
    expect(next).toBe(decision);
  });
});
