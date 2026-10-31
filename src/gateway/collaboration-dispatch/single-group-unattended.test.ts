/**
 * Batch 5 — single-target unattended lane.
 *
 * Fixed scenario names are the it() titles below. Hard-stop drills cover
 * unauthorized accept/finalize, stale confirmation, and a repeated external
 * side effect. Each drill shows queued work cancelled and in-progress work held.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  acceptBoardItemSubmission,
  loadBoardClaimItem,
  markBoardItemInProgress,
  publishBoardItem,
  claimBoardItem,
  submitBoardItemForReview,
} from "./claim-contract.js";
import {
  confirmTodolist,
  loadExecutorTodolist,
  proposeTodolist,
  reviseTodolist,
} from "./executor-private-todolist.js";
import { evaluateGovernanceGate } from "./governance-gate.js";
import {
  resolveGroupTaskHeartbeatSchedulerEnabled,
  runGroupTaskHeartbeat,
} from "./group-task-heartbeat.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority, type RuntimeAuthority } from "./runtime-authority.js";
import {
  platformDefaultBotMaySelfAdvanceWithoutHuman,
  platformDefaultSelfAdvanceWriteMode,
  trySelfAdvance,
} from "./self-advance.js";
import {
  classifyMissionAction,
  guardUnattendedFinalize,
  isSingleGroupUnattendedTarget,
  readUnattendedLaneState,
  releaseUnattendedHardStop,
  singleGroupUnattendedDefaultsOff,
  stageUnattendedWork,
  summarizeUnattendedEffectiveProgress,
  type UnattendedLaneState,
} from "./single-group-unattended.js";
import { assertTaskMayComplete, asGovernedTask } from "./task-runtime.js";
import type { WakeRoundDispatcher } from "./wake-round-dispatch.js";

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;
const savedSecurityProfile = process.env.OPENBOT_SECURITY_PROFILE;
const savedLegacySecurityProfile = process.env.OPENCLAW_SECURITY_PROFILE;

const GROUP = "grp-batch5-lane";
const CONTROL = "grp-batch5-control";
const PUBLISHER = "bot:lead";
const CLAIMANT = "bot:exec";
const NOW = 1_700_000_000_000;

afterEach(async () => {
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
  if (savedSecurityProfile === undefined) {
    delete process.env.OPENBOT_SECURITY_PROFILE;
  } else {
    process.env.OPENBOT_SECURITY_PROFILE = savedSecurityProfile;
  }
  if (savedLegacySecurityProfile === undefined) {
    delete process.env.OPENCLAW_SECURITY_PROFILE;
  } else {
    process.env.OPENCLAW_SECURITY_PROFILE = savedLegacySecurityProfile;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function flagConfig(
  root: string,
  opts: {
    groupId?: string;
    selfAdvanceMode?: "dry_run" | "execute";
    executeAllowlist?: string[];
    singleAllowlist?: string[];
    heartbeatMode?: "observe" | "emit";
  },
): OpenBotConfig {
  const groupId = opts.groupId ?? GROUP;
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        claimContract: true,
        wakeContract: true,
        groupTaskHeartbeat: {
          mode: opts.heartbeatMode ?? "emit",
          emitGroupAllowlist: [groupId],
          schedulerEnabled: false,
          scanIntervalMs: 1_800_000,
        },
        selfAdvance: {
          mode: opts.selfAdvanceMode ?? "execute",
          executeGroupAllowlist: opts.executeAllowlist ?? [groupId],
        },
        singleGroupUnattended: {
          groupAllowlist: opts.singleAllowlist ?? [groupId],
        },
      },
    },
  } as OpenBotConfig;
}

async function useConfig(opts?: Parameters<typeof flagConfig>[1]): Promise<{
  root: string;
  cfg: OpenBotConfig;
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-b5-lane-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  const cfg = flagConfig(root, opts ?? {});
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
  groupId = GROUP,
  opts?: { botMaySelfAdvanceWithoutHuman?: boolean },
): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    {
      collaborationMode: "task_driven",
      finalDecisionMode: "human_required",
      botMaySelfAdvanceWithoutHuman: opts?.botMaySelfAdvanceWithoutHuman ?? false,
    },
    { now: 1, idGen: () => "pss_b5" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_b5",
    tenant: { tenantId: null, trust: "none" },
    groupId,
    profile: "personal_local",
    cfg,
  });
}

const confirmOpts = { authorizedConfirmerIds: [PUBLISHER] as const };

async function seedConfirmedTask(
  auth: RuntimeAuthority,
  cfg: OpenBotConfig,
  params: { taskId: string; itemId: string; steps: { title: string; stepId: string }[] },
) {
  const published = await publishBoardItem(
    auth,
    {
      groupId: auth.groupId,
      taskId: params.taskId,
      itemId: params.itemId,
      publishedBy: PUBLISHER,
      remainingWork: "完成已确认计划中的下一步",
      acceptanceCriteria: ["草案已落盘"],
      goal: "单目标群真实任务",
      intendedClaimantIds: [CLAIMANT],
      skipChallengeWindow: true,
    },
    { cfg, nowMs: NOW },
  );
  expect(published.ok, !published.ok ? published.message : "").toBe(true);
  const claimed = await claimBoardItem(
    auth,
    { taskId: params.taskId, itemId: params.itemId, claimantId: CLAIMANT },
    { cfg, nowMs: NOW },
  );
  expect(claimed.ok, !claimed.ok ? claimed.message : "").toBe(true);
  const proposed = await proposeTodolist(
    auth,
    {
      groupId: auth.groupId,
      taskId: params.taskId,
      boardItemId: params.itemId,
      ownerMemberId: CLAIMANT,
      proposedBy: CLAIMANT,
      todolistId: `td-${params.itemId}`,
      steps: params.steps,
    },
    { cfg, nowMs: NOW },
  );
  expect(proposed.ok, !proposed.ok ? proposed.message : "").toBe(true);
  if (!proposed.ok) {
    throw new Error(proposed.message);
  }
  const confirmed = await confirmTodolist(
    auth,
    {
      taskId: params.taskId,
      todolistId: proposed.value.todolistId,
      confirmerId: PUBLISHER,
      expectedVersion: proposed.value.version,
    },
    { ...confirmOpts, cfg, nowMs: NOW },
  );
  expect(confirmed.ok, !confirmed.ok ? confirmed.message : "").toBe(true);
  const marked = await markBoardItemInProgress(
    auth,
    { taskId: params.taskId, itemId: params.itemId, actorId: CLAIMANT },
    { cfg, nowMs: NOW },
  );
  expect(marked.ok, !marked.ok ? marked.message : "").toBe(true);
  return proposed.value;
}

function dispatchSpy(): { calls: unknown[]; dispatcher: WakeRoundDispatcher } {
  const calls: unknown[] = [];
  const dispatcher: WakeRoundDispatcher = async (request) => {
    calls.push(request);
    return { ok: true, roundId: `round-${calls.length}` };
  };
  return { calls, dispatcher };
}

function expectDrained(state: UnattendedLaneState) {
  expect(state.hardStop?.active).toBe(true);
  expect(state.work.some((item) => item.phase === "queued")).toBe(false);
  expect(state.work.some((item) => item.phase === "in_progress")).toBe(false);
  expect(state.work.some((item) => item.phase === "cancelled")).toBe(true);
  expect(state.work.some((item) => item.phase === "held")).toBe(true);
}

describe("batch 5 single-group unattended", () => {
  test("defaults stay off and a multi-group list authorizes nobody", () => {
    expect(singleGroupUnattendedDefaultsOff()).toBe(true);
    expect(platformDefaultBotMaySelfAdvanceWithoutHuman()).toBe(false);
    expect(platformDefaultSelfAdvanceWriteMode()).toBe("dry_run");
    expect(resolveGroupTaskHeartbeatSchedulerEnabled({})).toBe(false);
    expect(isSingleGroupUnattendedTarget(undefined, GROUP)).toBe(false);
    expect(
      isSingleGroupUnattendedTarget(
        {
          collaboration: { task: { singleGroupUnattended: { groupAllowlist: ["a", "b"] } } },
        } as OpenBotConfig,
        "a",
      ),
    ).toBe(false);
    expect(classifyMissionAction("起草会议提纲")).toBe("draft");
    expect(classifyMissionAction("创建日历")).toBe("create_calendar");
    expect(classifyMissionAction("发送会议邀请")).toBe("send_invite");
  });

  test("正常推进一步（已确认计划内）", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    await seedConfirmedTask(auth, cfg, {
      taskId: "task-step",
      itemId: "item-step",
      steps: [
        { stepId: "s1", title: "起草会议提纲" },
        { stepId: "s2", title: "补一版草稿说明" },
      ],
    });
    const spy = dispatchSpy();
    const tick = await runGroupTaskHeartbeat(
      auth,
      { groupId: GROUP },
      {
        cfg,
        nowMs: NOW,
        force: true,
        dryRun: false,
        coordinatorBotId: PUBLISHER,
        roundDispatcher: spy.dispatcher,
      },
    );
    expect(tick.ok).toBe(true);
    if (!tick.ok || tick.skipped) {
      throw new Error("tick did not run");
    }
    expect(spy.calls).toHaveLength(1);
    expect(tick.unattended?.reason).toBe("confirmed_step");
    expect(tick.unattended?.effectiveProgress).toEqual([
      expect.objectContaining({
        kind: "confirmed_step",
        taskId: "task-step",
        stepId: "s1",
        planVersion: 1,
      }),
    ]);
    expect(
      tick.unattended?.effectiveProgress.some((event) => event.kind === "confirmed_step"),
    ).toBe(true);
    expect(JSON.stringify(tick.unattended?.effectiveProgress)).not.toContain("recorded");
    const item = await loadBoardClaimItem(auth, { taskId: "task-step", itemId: "item-step" });
    expect(item?.status).toBe("in_progress");
    const plan = await loadExecutorTodolist(auth, {
      taskId: "task-step",
      todolistId: "td-item-step",
    });
    expect(plan?.status).toBe("confirmed");
    expect(plan?.version).toBe(1);
    const summary = summarizeUnattendedEffectiveProgress({
      windowStartMs: NOW - 1,
      windowEndMs: NOW + 1,
      confirmedStepsInWindow: 2,
      progress: tick.unattended?.effectiveProgress ?? [],
      recordedWakeCount: 4,
    });
    expect(summary.denominator).toBe(2);
    expect(summary.numerator).toBe(1);
    expect(summary.rate).toBe(0.5);
    expect(summary.recordedCountsAsProgress).toBe(false);
    expect(summary.callCountIsSufficient).toBe(false);
    const recordedOnly = summarizeUnattendedEffectiveProgress({
      windowStartMs: NOW - 1,
      windowEndMs: NOW + 1,
      confirmedStepsInWindow: 2,
      progress: [],
      recordedWakeCount: 4,
    });
    expect(recordedOnly.numerator).toBe(0);
    expect(recordedOnly.rate).toBe(0);
  });

  test("dry_run / 未开白名单时无外部副作用", async () => {
    const dry = await useConfig({ selfAdvanceMode: "dry_run", executeAllowlist: [GROUP] });
    const dryAuth = authority(dry.cfg);
    await seedConfirmedTask(dryAuth, dry.cfg, {
      taskId: "task-dry",
      itemId: "item-dry",
      steps: [{ stepId: "s1", title: "起草会议提纲" }],
    });
    const drySpy = dispatchSpy();
    const dryTick = await runGroupTaskHeartbeat(
      dryAuth,
      { groupId: GROUP },
      {
        cfg: dry.cfg,
        nowMs: NOW,
        force: true,
        coordinatorBotId: PUBLISHER,
        roundDispatcher: drySpy.dispatcher,
      },
    );
    expect(drySpy.calls).toHaveLength(0);
    if (!dryTick.ok || dryTick.skipped) {
      throw new Error("dry tick did not run");
    }
    expect(dryTick.unattended?.reason).toBe("dry_run");
    expect(dryTick.unattended?.externalSideEffectCount).toBe(0);
    expect(dryTick.unattended?.committedDispatchCount).toBe(0);
    expect(dryTick.wakeEvents).toHaveLength(0);

    const missed = await useConfig({
      selfAdvanceMode: "execute",
      executeAllowlist: [],
      singleAllowlist: [GROUP],
    });
    const missedAuth = authority(missed.cfg);
    await seedConfirmedTask(missedAuth, missed.cfg, {
      taskId: "task-miss",
      itemId: "item-miss",
      steps: [{ stepId: "s1", title: "起草会议提纲" }],
    });
    const missedSpy = dispatchSpy();
    const missedTick = await runGroupTaskHeartbeat(
      missedAuth,
      { groupId: GROUP },
      {
        cfg: missed.cfg,
        nowMs: NOW,
        force: true,
        coordinatorBotId: PUBLISHER,
        roundDispatcher: missedSpy.dispatcher,
      },
    );
    expect(missedSpy.calls).toHaveLength(0);
    if (!missedTick.ok || missedTick.skipped) {
      throw new Error("allowlist tick did not run");
    }
    expect(missedTick.unattended?.reason).toBe("dry_run");
    expect(missedTick.unattended?.externalSideEffectCount).toBe(0);
  });

  test("重复 heartbeat / wake 不重复副作用", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    await seedConfirmedTask(auth, cfg, {
      taskId: "task-dup",
      itemId: "item-dup",
      steps: [
        { stepId: "s1", title: "起草会议提纲" },
        { stepId: "s2", title: "补一版草稿说明" },
      ],
    });
    const spy = dispatchSpy();
    const first = await runGroupTaskHeartbeat(
      auth,
      { groupId: GROUP },
      {
        cfg,
        nowMs: NOW,
        force: true,
        coordinatorBotId: PUBLISHER,
        roundDispatcher: spy.dispatcher,
      },
    );
    const second = await runGroupTaskHeartbeat(
      auth,
      { groupId: GROUP },
      {
        cfg,
        nowMs: NOW + 1,
        force: true,
        coordinatorBotId: PUBLISHER,
        roundDispatcher: spy.dispatcher,
      },
    );
    expect(spy.calls).toHaveLength(1);
    if (!first.ok || first.skipped || !second.ok || second.skipped) {
      throw new Error("duplicate ticks did not run");
    }
    expect(first.unattended?.committedDispatchCount).toBe(1);
    expect(second.unattended?.reason).toBe("duplicate_side_effect");
    expect(second.unattended?.committedDispatchCount).toBe(0);
    expect(second.unattended?.inflightDispatchCount).toBe(0);
    const state = await readUnattendedLaneState(auth);
    expect(state.effects).toHaveLength(1);
    expect(state.progress).toHaveLength(1);
  });

  test("偏离动作被拒或升人闸", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg, GROUP, { botMaySelfAdvanceWithoutHuman: true });
    await seedConfirmedTask(auth, cfg, {
      taskId: "task-deviate",
      itemId: "item-deviate",
      steps: [{ stepId: "s1", title: "创建日历" }],
    });
    const spy = dispatchSpy();
    const result = await trySelfAdvance(auth, {
      cfg,
      actorId: CLAIMANT,
      nowMs: NOW,
      currentMission: "执行会议材料",
      roundDispatcher: spy.dispatcher,
      fromAgentId: "system:self_advance",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.advanced).toBe(false);
    if (result.advanced) {
      return;
    }
    expect(result.reason).toBe("mission_fence_human_gate");
    expect(spy.calls).toHaveLength(0);
    const state = await readUnattendedLaneState(auth);
    expect(state.humanGates).toEqual([
      expect.objectContaining({
        actionKind: "create_calendar",
        reason: "mission_fence_human_gate",
      }),
    ]);
    expect(state.hardStop).toBeNull();
    expect(state.effects.filter((effect) => effect.external)).toHaveLength(0);
    expect(state.progress).toHaveLength(0);
    expect(classifyMissionAction("发送会议邀请")).toBe("send_invite");
  });

  test("触发硬停止后排队与进行中任务被安全处理", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    await seedConfirmedTask(auth, cfg, {
      taskId: "task-stop",
      itemId: "item-stop",
      steps: [
        { stepId: "s1", title: "起草会议提纲" },
        { stepId: "s2", title: "补一版草稿说明" },
      ],
    });
    const calls: unknown[] = [];
    const tick = await runGroupTaskHeartbeat(
      auth,
      { groupId: GROUP },
      {
        cfg,
        nowMs: NOW,
        force: true,
        coordinatorBotId: PUBLISHER,
        roundDispatcher: async (request) => {
          calls.push(request);
          const refused = await acceptBoardItemSubmission(
            auth,
            {
              taskId: "task-stop",
              itemId: "item-stop",
              actorId: CLAIMANT,
              expectedSubmissionId: randomUUID(),
              reason: "executor tried to accept",
              checkedAcceptanceCriteria: ["草案已落盘"],
            },
            { cfg, nowMs: NOW, coordinatorBotId: PUBLISHER },
          );
          expect(refused.ok).toBe(false);
          if (!refused.ok) {
            expect(refused.reason).toBe("unauthorized_accept");
          }
          return { ok: true, roundId: "round-should-not-commit" };
        },
      },
    );
    expect(calls).toHaveLength(1);
    if (!tick.ok || tick.skipped) {
      throw new Error("stop tick did not run");
    }
    expect(tick.unattended?.committedDispatch).toBe(false);
    expect(tick.unattended?.effectiveProgress).toEqual([]);
    expect(tick.unattended?.reason).toBe("hard_stop");
    const item = await loadBoardClaimItem(auth, { taskId: "task-stop", itemId: "item-stop" });
    expect(item?.status).toBe("in_progress");
    const state = await readUnattendedLaneState(auth);
    expect(state.hardStop?.reason).toBe("unauthorized_accept");
    expectDrained(state);

    const later = dispatchSpy();
    const follow = await runGroupTaskHeartbeat(
      auth,
      { groupId: GROUP },
      {
        cfg,
        nowMs: NOW + 60_000,
        force: true,
        coordinatorBotId: PUBLISHER,
        roundDispatcher: later.dispatcher,
      },
    );
    expect(later.calls).toHaveLength(0);
    if (!follow.ok || follow.skipped) {
      throw new Error("follow-up tick did not run");
    }
    expect(follow.unattended?.reason).toBe("hard_stop");
    expect(follow.unattended?.committedDispatchCount).toBe(0);
  });

  test("硬停止演练：越权 accept", async () => {
    const { cfg } = await useConfig({ singleAllowlist: [GROUP] });
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: GROUP,
        taskId: "task-ok",
        itemId: "item-ok",
        publishedBy: PUBLISHER,
        remainingWork: "交卷后由授权人验收",
        acceptanceCriteria: ["草案已落盘"],
        goal: "授权人仍可验收",
        intendedClaimantIds: [CLAIMANT],
        skipChallengeWindow: true,
      },
      { cfg, nowMs: NOW },
    );
    expect(published.ok).toBe(true);
    expect(
      (
        await claimBoardItem(
          auth,
          { taskId: "task-ok", itemId: "item-ok", claimantId: CLAIMANT },
          { cfg, nowMs: NOW },
        )
      ).ok,
    ).toBe(true);
    const proposed = await proposeTodolist(
      auth,
      {
        groupId: GROUP,
        taskId: "task-ok",
        boardItemId: "item-ok",
        ownerMemberId: CLAIMANT,
        steps: [{ stepId: "s1", title: "起草会议提纲" }],
      },
      { cfg, nowMs: NOW },
    );
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) {
      throw new Error(proposed.message);
    }
    expect(
      (
        await confirmTodolist(
          auth,
          {
            taskId: "task-ok",
            todolistId: proposed.value.todolistId,
            confirmerId: PUBLISHER,
            expectedVersion: proposed.value.version,
          },
          { ...confirmOpts, cfg, nowMs: NOW },
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await markBoardItemInProgress(
          auth,
          { taskId: "task-ok", itemId: "item-ok", actorId: CLAIMANT },
          { cfg, nowMs: NOW },
        )
      ).ok,
    ).toBe(true);
    const submissionId = randomUUID();
    const submitted = await submitBoardItemForReview(
      auth,
      {
        taskId: "task-ok",
        itemId: "item-ok",
        actorId: CLAIMANT,
        submissionId,
        artifactVersion: "v1",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",

        submissionSummary: "提纲草案",
      },
      { cfg, nowMs: NOW },
    );
    expect(submitted.ok, !submitted.ok ? submitted.message : "").toBe(true);
    const accepted = await acceptBoardItemSubmission(
      auth,
      {
        taskId: "task-ok",
        itemId: "item-ok",
        actorId: PUBLISHER,
        expectedSubmissionId: submissionId,
        reason: "授权人验收",
        checkedAcceptanceCriteria: ["草案已落盘"],
      },
      { cfg, nowMs: NOW, coordinatorBotId: PUBLISHER },
    );
    expect(accepted.ok, !accepted.ok ? accepted.message : "").toBe(true);
    expect((await readUnattendedLaneState(auth)).hardStop).toBeNull();

    await seedConfirmedTask(auth, cfg, {
      taskId: "task-deny",
      itemId: "item-deny",
      steps: [
        { stepId: "s1", title: "起草会议提纲" },
        { stepId: "s2", title: "补一版草稿说明" },
      ],
    });
    await stageUnattendedWork(auth, {
      cfg,
      nowMs: NOW,
      taskId: "task-deny",
      itemId: "item-deny",
      planVersion: 1,
      steps: [
        { stepId: "s1", actionKind: "draft" },
        { stepId: "s2", actionKind: "draft" },
      ],
    });
    const refused = await acceptBoardItemSubmission(
      auth,
      {
        taskId: "task-deny",
        itemId: "item-deny",
        actorId: CLAIMANT,
        expectedSubmissionId: randomUUID(),
        reason: "越权",
        checkedAcceptanceCriteria: ["草案已落盘"],
      },
      { cfg, nowMs: NOW, coordinatorBotId: PUBLISHER },
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toBe("unauthorized_accept");
    }
    expect(
      (await loadBoardClaimItem(auth, { taskId: "task-deny", itemId: "item-deny" }))?.status,
    ).toBe("in_progress");
    expectDrained(await readUnattendedLaneState(auth));

    const control = authority(cfg, CONTROL);
    await seedConfirmedTask(control, cfg, {
      taskId: "task-ctl",
      itemId: "item-ctl",
      steps: [{ stepId: "s1", title: "起草会议提纲" }],
    });
    const controlSubmission = randomUUID();
    expect(
      (
        await submitBoardItemForReview(
          control,
          {
            taskId: "task-ctl",
            itemId: "item-ctl",
            actorId: CLAIMANT,
            submissionId: controlSubmission,
            artifactVersion: "v1",
            linkedDeliverableId: "del-p2-test",
            linkedDeliverableVersion: 1,
            linkedContentSha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",

            submissionSummary: "control",
          },
          { cfg, nowMs: NOW },
        )
      ).ok,
    ).toBe(true);
    const controlAccept = await acceptBoardItemSubmission(
      control,
      {
        taskId: "task-ctl",
        itemId: "item-ctl",
        actorId: CLAIMANT,
        expectedSubmissionId: controlSubmission,
        reason: "non-target keeps today's accept path",
        checkedAcceptanceCriteria: ["草案已落盘"],
      },
      { cfg, nowMs: NOW },
    );
    expect(controlAccept.ok, !controlAccept.ok ? controlAccept.message : "").toBe(true);
    expect((await readUnattendedLaneState(control)).hardStop).toBeNull();
  });

  test("硬停止演练：越权 finalize", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    await stageUnattendedWork(auth, {
      cfg,
      nowMs: NOW,
      taskId: "task-fin",
      itemId: "item-fin",
      planVersion: 1,
      steps: [
        { stepId: "s1", actionKind: "draft" },
        { stepId: "s2", actionKind: "draft" },
      ],
    });
    const gate = evaluateGovernanceGate({
      action: "finalize_decision",
      actor: { type: "bot", id: CLAIMANT },
      effective: auth.policy.effective,
    });
    expect(gate.allowed).toBe(false);
    expect(() =>
      assertTaskMayComplete({
        task: asGovernedTask({
          taskId: "task-fin",
          groupId: GROUP,
          title: "finalize",
          status: "in_progress",
          createdAtMs: NOW,
          updatedAtMs: NOW,
        }),
        effective: auth.policy.effective,
        actor: { type: "bot", id: CLAIMANT },
        deliverables: [{ taskId: "task-fin", status: "submitted" }],
      }),
    ).toThrow(/human confirmation/);
    const stopped = await guardUnattendedFinalize({
      authority: auth,
      groupId: GROUP,
      cfg,
      actorId: CLAIMANT,
      actorType: "bot",
      gateAllowed: gate.allowed,
      coordinatorBotId: PUBLISHER,
      publishedBy: PUBLISHER,
      nowMs: NOW,
    });
    expect(stopped.stopped).toBe(true);
    const state = await readUnattendedLaneState(auth);
    expect(state.hardStop?.reason).toBe("unauthorized_finalize");
    expectDrained(state);
    const released = await releaseUnattendedHardStop(auth, { cfg });
    expect(released).toBe(true);
    expect((await readUnattendedLaneState(auth)).hardStop).toBeNull();
  });

  test("硬停止演练：陈旧确认", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const proposed = await proposeTodolist(
      auth,
      {
        groupId: GROUP,
        taskId: "task-stale",
        boardItemId: "item-stale",
        ownerMemberId: CLAIMANT,
        todolistId: "td-stale",
        steps: [{ stepId: "s1", title: "起草会议提纲" }],
      },
      { cfg, nowMs: NOW },
    );
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) {
      throw new Error(proposed.message);
    }
    const revised = await reviseTodolist(
      auth,
      {
        taskId: "task-stale",
        todolistId: proposed.value.todolistId,
        reviserId: PUBLISHER,
        reason: "改步骤",
        expectedVersion: proposed.value.version,
        steps: [{ stepId: "s1", title: "起草修订提纲" }],
      },
      { ...confirmOpts, cfg, nowMs: NOW + 1 },
    );
    expect(revised.ok).toBe(true);
    if (!revised.ok) {
      throw new Error(revised.message);
    }
    expect(revised.value.version).toBe(proposed.value.version + 1);
    await stageUnattendedWork(auth, {
      cfg,
      nowMs: NOW,
      taskId: "task-stale",
      itemId: "item-stale",
      planVersion: revised.value.version,
      steps: [
        { stepId: "s1", actionKind: "draft" },
        { stepId: "s2", actionKind: "draft" },
      ],
    });
    const stale = await confirmTodolist(
      auth,
      {
        taskId: "task-stale",
        todolistId: proposed.value.todolistId,
        confirmerId: PUBLISHER,
        expectedVersion: proposed.value.version,
      },
      { ...confirmOpts, cfg, nowMs: NOW + 2 },
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.reason).toBe("stale_version");
    }
    const plan = await loadExecutorTodolist(auth, {
      taskId: "task-stale",
      todolistId: proposed.value.todolistId,
    });
    expect(plan?.status).toBe("revise_requested");
    expect(plan?.version).toBe(revised.value.version);
    const state = await readUnattendedLaneState(auth);
    expect(state.hardStop?.reason).toBe("stale_confirmation");
    expectDrained(state);
    const current = await confirmTodolist(
      auth,
      {
        taskId: "task-stale",
        todolistId: proposed.value.todolistId,
        confirmerId: PUBLISHER,
        expectedVersion: revised.value.version,
      },
      { ...confirmOpts, cfg, nowMs: NOW + 3 },
    );
    expect(current.ok, !current.ok ? current.message : "").toBe(true);
    expect((await readUnattendedLaneState(auth)).hardStop?.active).toBe(true);
  });

  test("硬停止演练：重复外部副作用", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg, GROUP, { botMaySelfAdvanceWithoutHuman: true });
    await seedConfirmedTask(auth, cfg, {
      taskId: "task-ext",
      itemId: "item-ext",
      steps: [
        { stepId: "s1", title: "发送会议邀请" },
        { stepId: "s2", title: "创建日历" },
      ],
    });
    await stageUnattendedWork(auth, {
      cfg,
      nowMs: NOW,
      taskId: "task-ext",
      itemId: "item-ext",
      planVersion: 1,
      steps: [
        { stepId: "queued-live", actionKind: "draft" },
        { stepId: "queued-next", actionKind: "draft" },
      ],
    });
    const spy = dispatchSpy();
    const first = await trySelfAdvance(auth, {
      cfg,
      actorId: CLAIMANT,
      nowMs: NOW,
      currentMission: "执行会议材料",
      roundDispatcher: spy.dispatcher,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error(first.message);
    }
    expect(first.advanced).toBe(false);
    if (first.advanced) {
      return;
    }
    expect(first.reason).toBe("mission_fence_human_gate");
    expect(spy.calls).toHaveLength(0);
    const second = await trySelfAdvance(auth, {
      cfg,
      actorId: CLAIMANT,
      nowMs: NOW + 1,
      currentMission: "执行会议材料",
      roundDispatcher: spy.dispatcher,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) {
      throw new Error(second.message);
    }
    expect(second.advanced).toBe(false);
    if (second.advanced) {
      return;
    }
    expect(second.reason).toBe("duplicate_external_side_effect");
    expect(spy.calls).toHaveLength(0);
    const state = await readUnattendedLaneState(auth);
    expect(state.hardStop?.reason).toBe("duplicate_external_side_effect");
    expect(state.effects.filter((effect) => effect.external)).toHaveLength(0);
    expectDrained(state);
  });
});
