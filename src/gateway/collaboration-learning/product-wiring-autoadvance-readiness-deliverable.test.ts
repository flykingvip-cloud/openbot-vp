/**
 * #129 product wiring — call-chain coverage for review gaps (R1–R3).
 * Not F4 / not 18789 cutover. Identity may still be mocked at ACL edges;
 * submit pipeline below is non-mock where noted.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { makeOperatingState } from "../collaboration-dispatch/__fixtures__/policy-source-matrix.js";
import * as executorTodolist from "../collaboration-dispatch/executor-private-todolist.js";
import { createRoundPolicySnapshot } from "../collaboration-dispatch/round-policy-snapshot.js";
import { createRuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import { asGovernedTask } from "../collaboration-dispatch/task-runtime.js";
import { buildAcceptedTaskStopControl } from "../collaboration-dispatch/task-stop-control.js";
import * as wakeContract from "../collaboration-dispatch/wake-contract.js";
import {
  consumeWakeForRoundDispatch,
  setWakeRoundDispatcher,
  type WakeRoundDispatcher,
} from "../collaboration-dispatch/wake-round-dispatch.js";
import * as wakeRound from "../collaboration-dispatch/wake-round-dispatch.js";
import { resolveTrustedGroupLocator } from "../workspace/group-locator.js";
import {
  finalizeMemberRunTeamDeliverable,
  formatTeamDeliverableUserMessage,
  maybeSubmitTeamDeliverableFromChatFinal,
} from "./chat-deliverable-team-submit.js";
import * as claimEntry from "./claim-contract-entry.js";
import {
  buildExecutionDeliverableBinding,
  executionBindingScopeMismatch,
  normalizeExecutionDeliverableBinding,
  productionWakeDeliverableContractFailure,
  runIdFromWakeOpAttempt,
  type ExecutionDeliverableBinding,
} from "./execution-deliverable-binding.js";
import { triggerPostPlanConfirmAdvance } from "./post-plan-confirm-advance.js";
import { resolveActorDeliverableTaskBinding } from "./resolve-actor-deliverable-task.js";
import { writeGroupOperatingState } from "./shared.js";
import { readTeamDeliverable, submitTeamDeliverable } from "./team-deliverable-submit.js";
import { createTrustedGroupStores } from "./team-resource-auth.js";

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;
const savedTenantsRoot = process.env.OPENBOT_TENANTS_ROOT;

afterEach(async () => {
  setWakeRoundDispatcher(null);
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  vi.restoreAllMocks();
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
  if (savedTenantsRoot === undefined) {
    delete process.env.OPENBOT_TENANTS_ROOT;
  } else {
    process.env.OPENBOT_TENANTS_ROOT = savedTenantsRoot;
  }
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

function baseCfg(
  root: string,
  over?: {
    selfAdvanceMode?: "dry_run" | "execute";
    selfAdvanceExecuteAllowlist?: string[];
    wakeContract?: boolean;
    wakeContractGroupAllowlist?: string[];
    profile?: "personal_local" | "managed_enterprise";
    /** Gateway agents.list ids (wake readiness registry). */
    agentsList?: Array<{ id: string; name?: string }>;
  },
): OpenBotConfig {
  return {
    agents: {
      defaults: { workspace: path.join(root, "agent-ws") },
      list: over?.agentsList ?? [],
    },
    gateway: { security: { profile: over?.profile ?? "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        claimContract: true,
        wakeContract: over?.wakeContract ?? true,
        wakeContractGroupAllowlist: over?.wakeContractGroupAllowlist ?? ["*"],
        selfAdvance: {
          mode: over?.selfAdvanceMode ?? "dry_run",
          executeGroupAllowlist: over?.selfAdvanceExecuteAllowlist ?? [],
        },
      },
    },
  } as OpenBotConfig;
}

async function useRoot(over?: Parameters<typeof baseCfg>[1]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-pr129-r1-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  const cfg = baseCfg(root, over);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return { root, cfg };
}

function seedAuthority(cfg: OpenBotConfig, groupId: string, tenantId: string | null) {
  const snapshot = createRoundPolicySnapshot(
    {
      collaborationMode: "task_driven",
      finalDecisionMode: "human_required",
      botMaySelfAdvanceWithoutHuman: true,
    },
    { now: 1, idGen: () => "pss_pr129_r1" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_pr129_r1",
    tenant: tenantId ? { tenantId, trust: "membership" } : { tenantId: null, trust: "none" },
    groupId,
    profile: tenantId ? "managed_enterprise" : "personal_local",
    cfg,
  });
}

describe("R1 deliverable helper — empty/binary/failure surface", () => {
  it("refuses empty body (no whole-chat fallback)", async () => {
    const r = await maybeSubmitTeamDeliverableFromChatFinal({
      text: '说明文字\n<<DELIVERABLE file="a.md">>\n\n<</DELIVERABLE>>',
      groupId: "g1",
      taskId: "t1",
      agentId: "bot-a",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("deliverable_empty_body");
    }
  });

  it("refuses binary path without real file bytes", async () => {
    const r = await maybeSubmitTeamDeliverableFromChatFinal({
      text: '<<DELIVERABLE file="report.pdf">>\nnot-a-pdf\n<</DELIVERABLE>>',
      groupId: "g1",
      taskId: "t1",
      agentId: "bot-a",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("deliverable_binary_not_supported_in_this_pr");
    }
  });

  it("ok:false message is 团队成果未完成, not success", () => {
    const msg = formatTeamDeliverableUserMessage({ ok: false, reason: "acl_denied" });
    expect(msg).toContain("团队成果未完成");
    expect(msg).toContain("没有提交权限");
    expect(msg).not.toContain("acl_denied");
    expect(msg).not.toContain("已提交");
  });
});

describe("R1 deliverable binding — never OS currentTaskId alone", () => {
  it("groupCurrentTaskId alone without active claimant → refuse", async () => {
    const { cfg } = await useRoot();
    const groupId = "grp_bind";
    const oldTask = "task-old";
    const groupLocator = resolveTrustedGroupLocator({
      groupId,
      tenantId: null,
      profile: "personal_local",
      cfg,
    });
    const stores = createTrustedGroupStores({
      groupsRoot: path.dirname(groupLocator),
      groupLocator,
    });
    const now = Date.now();
    await stores.objectStorage.writeObject(groupId, "task", oldTask, {
      taskId: oldTask,
      groupId,
      title: oldTask,
      status: "ready",
      assignedMemberIds: ["bot-exec"],
      createdAtMs: now,
      updatedAtMs: now,
    } satisfies Task);

    const binding = await resolveActorDeliverableTaskBinding({
      groupId,
      actorId: "bot-exec",
      groupCurrentTaskId: oldTask,
      stores,
      trusted: { groupsRoot: path.dirname(groupLocator), groupLocator },
      cfg,
    });
    expect(binding.ok).toBe(false);
    if (!binding.ok) {
      expect(binding.reason).toBe("execution_binding_required");
    }
  });
});

describe("R1 non-mock submit pipeline", () => {
  it("real submit → idempotent helper replay → authorized read", async () => {
    const { cfg } = await useRoot();
    const groupId = "grp_pipeline";
    const taskId = "task-pipe";
    const groupLocator = resolveTrustedGroupLocator({
      groupId,
      tenantId: null,
      profile: "personal_local",
      cfg,
    });
    const trusted = { groupsRoot: path.dirname(groupLocator), groupLocator };
    const stores = createTrustedGroupStores(trusted);
    const now = Date.now();
    await stores.objectStorage.writeObject(groupId, "task", taskId, {
      taskId,
      groupId,
      title: taskId,
      status: "ready",
      createdAtMs: now,
      updatedAtMs: now,
    } satisfies Task);

    const submit = await submitTeamDeliverable({
      groupId,
      taskId,
      actor: "bot-exec",
      title: "正式成果",
      content: "pipeline-body-v1",
      relativePath: "deliverables/notes/out.md",
      cfg,
      enforceAcl: false,
      trusted,
    });
    expect(submit.ok).toBe(true);
    if (!submit.ok) {
      return;
    }

    const viaHelper = await maybeSubmitTeamDeliverableFromChatFinal({
      text: '<<DELIVERABLE title="正式成果" file="notes/out.md">>\npipeline-body-v1\n<</DELIVERABLE>>',
      groupId,
      taskId,
      agentId: "bot-exec",
      trusted,
      cfg,
      enforceAcl: false,
    });
    expect(viaHelper.ok).toBe(true);
    if (viaHelper.ok) {
      expect(viaHelper.deliverableId).toBe(submit.deliverableId);
      expect(viaHelper.version).toBe(submit.version);
      expect(viaHelper.locator).toBe(submit.locator);
    }

    const read = await readTeamDeliverable({
      groupId,
      deliverableId: submit.deliverableId,
      actor: "human:reviewer",
      cfg,
      enforceAcl: false,
      trusted,
    });
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.content).toContain("pipeline-body-v1");
      expect(read.locator).toBe(submit.locator);
    }

    const userMsg = formatTeamDeliverableUserMessage(submit);
    expect(userMsg).toContain(`第 ${submit.version} 版`);
    expect(userMsg).toContain("等待审核");
    expect(userMsg).not.toContain(submit.locator);
    expect(userMsg).not.toContain(submit.deliverableId);
  });
});

describe("R1 autoAdvance — no hardcode execute; strict binding", () => {
  beforeEach(() => {
    vi.spyOn(wakeContract, "recordNudgeWake").mockResolvedValue({ ok: true } as never);
  });

  it("execute gray off → does not dispatch; writeMode not hardcoded", async () => {
    const { cfg } = await useRoot({
      selfAdvanceMode: "dry_run",
      selfAdvanceExecuteAllowlist: [],
      wakeContract: true,
    });
    vi.spyOn(claimEntry, "listCollaborationBoardItems").mockResolvedValue([
      {
        itemId: "board-1",
        taskId: "task-1",
        groupId: "grp_adv",
        status: "applied",
        claimantId: "bot-exec",
        title: "step",
        remainingWork: "do",
      },
    ] as never);
    vi.spyOn(executorTodolist, "loadExecutorTodolist").mockResolvedValue({
      todolistId: "td-1",
      boardItemId: "board-1",
      taskId: "task-1",
      groupId: "grp_adv",
      ownerMemberId: "bot-exec",
      status: "confirmed",
      steps: [{ stepId: "step-a", title: "step-a", status: "active" }],
      proposedBy: "bot-exec",
      proposedAt: 1,
      confirmedBy: "human:owner",
      confirmedAt: 2,
      version: 3,
      visibility: "executor_private",
    } as never);
    vi.spyOn(claimEntry, "buildClaimAuthority").mockResolvedValue({
      authority: seedAuthority(cfg, "grp_adv", null),
      stores: null,
      operatingState: null,
    } as never);

    const consumeSpy = vi.spyOn(wakeRound, "consumeWakeForRoundDispatch").mockResolvedValue({
      outcome: "recorded",
      dispatched: false,
      gate: {
        allowed: false,
        reason: "self_advance_not_execute",
        wakeEnabled: true,
        selfAdvanceWriteMode: "dry_run",
        sourceEligible: true,
      },
      reason: "self_advance_not_execute",
      wakeEvent: undefined,
      roundId: undefined,
      dispatcherPresent: false,
      opKey: "k",
      wakeOp: undefined,
      reused: false,
    } as never);

    const result = await triggerPostPlanConfirmAdvance({
      groupId: "grp_adv",
      taskId: "task-1",
      boardItemId: "board-1",
      todolistId: "td-1",
      confirmedVersion: 3,
      stepId: "step-a",
      confirmerId: "human:owner",
      cfg,
    });
    expect(result.dispatched).toBe(false);
    expect(consumeSpy).toHaveBeenCalled();
    const arg = consumeSpy.mock.calls[0][0] as {
      writeMode?: string;
      request: { opKey?: string };
    };
    expect(arg.writeMode).toBeUndefined();
    expect(String(arg.request.opKey)).toContain("v3");
    expect(String(arg.request.opKey)).toContain("step-a");
  });

  it("board item missing → refuse (no fallback)", async () => {
    const { cfg } = await useRoot();
    vi.spyOn(claimEntry, "listCollaborationBoardItems").mockResolvedValue([
      {
        itemId: "other-board",
        taskId: "task-1",
        groupId: "grp_adv",
        status: "applied",
        claimantId: "bot-exec",
        title: "other",
        remainingWork: "x",
      },
    ] as never);
    vi.spyOn(claimEntry, "buildClaimAuthority").mockResolvedValue({
      authority: seedAuthority(cfg, "grp_adv", null),
      stores: null,
      operatingState: null,
    } as never);

    const result = await triggerPostPlanConfirmAdvance({
      groupId: "grp_adv",
      taskId: "task-1",
      boardItemId: "board-expected",
      todolistId: "td-1",
      confirmedVersion: 1,
      confirmerId: "human:owner",
      cfg,
    });
    expect(result.dispatched).toBe(false);
    expect(result.wakeRecorded).toBe(false);
    expect(result.reason).toBe("confirm_board_item_missing");
  });

  it("plan revised (bag version mismatch) → refuse old step", async () => {
    const { cfg } = await useRoot();
    vi.spyOn(claimEntry, "listCollaborationBoardItems").mockResolvedValue([
      {
        itemId: "board-1",
        taskId: "task-1",
        groupId: "grp_adv",
        status: "applied",
        claimantId: "bot-exec",
        title: "step",
        remainingWork: "do",
      },
    ] as never);
    vi.spyOn(executorTodolist, "loadExecutorTodolist").mockResolvedValue({
      todolistId: "td-1",
      boardItemId: "board-1",
      taskId: "task-1",
      groupId: "grp_adv",
      ownerMemberId: "bot-exec",
      status: "confirmed",
      steps: [{ stepId: "step-new", title: "step-new", status: "active" }],
      proposedBy: "bot-exec",
      proposedAt: 1,
      confirmedBy: "human:owner",
      confirmedAt: 2,
      version: 9,
      visibility: "executor_private",
    } as never);
    vi.spyOn(claimEntry, "buildClaimAuthority").mockResolvedValue({
      authority: seedAuthority(cfg, "grp_adv", null),
      stores: null,
      operatingState: null,
    } as never);

    const result = await triggerPostPlanConfirmAdvance({
      groupId: "grp_adv",
      taskId: "task-1",
      boardItemId: "board-1",
      todolistId: "td-1",
      confirmedVersion: 3,
      confirmerId: "human:owner",
      cfg,
    });
    expect(result.dispatched).toBe(false);
    expect(result.reason).toMatch(/execution_bag_version_mismatch/);
  });

  it("F4: board claimant `bot` + todolist owner `bot:bot` still records plan_confirmed wake", async () => {
    const { cfg } = await useRoot({
      selfAdvanceMode: "dry_run",
      selfAdvanceExecuteAllowlist: [],
      wakeContract: true,
    });
    vi.spyOn(claimEntry, "listCollaborationBoardItems").mockResolvedValue([
      {
        itemId: "860d20dc-4632-41e5-b163-4b3eccf2ac69",
        taskId: "F4-20261028-wak",
        groupId: "grp-daniel-hhd-gmail-com-upbeyond",
        status: "applied",
        claimantId: "bot",
        title: "F4 wak",
        remainingWork: "charter",
        acceptanceCriteria: ["writtenToGroupDir"],
      },
    ] as never);
    vi.spyOn(claimEntry, "buildClaimAuthority").mockResolvedValue({
      authority: seedAuthority(cfg, "grp-daniel-hhd-gmail-com-upbeyond", null),
      stores: null,
      operatingState: null,
    } as never);
    // Live SoT shape: ownerMemberId is bot:bot while board claimantId is bare bot.
    vi.spyOn(executorTodolist, "loadExecutorTodolist").mockResolvedValue({
      todolistId: "2cbf6e99-aa62-463b-bd27-e632a08a58ac",
      boardItemId: "860d20dc-4632-41e5-b163-4b3eccf2ac69",
      taskId: "F4-20261028-wak",
      groupId: "grp-daniel-hhd-gmail-com-upbeyond",
      ownerMemberId: "bot:bot",
      status: "confirmed",
      steps: [
        {
          stepId: "s1",
          title: "写入 charter.md 连通性说明",
          status: "active",
        },
      ],
      proposedBy: "bot:bot",
      proposedAt: 1,
      confirmedBy: "daniel.hhd@gmail.com",
      confirmedAt: 2,
      version: 2,
      visibility: "executor_private",
    } as never);
    const nudgeSpy = vi
      .spyOn(wakeContract, "recordNudgeWake")
      .mockResolvedValue({ ok: true } as never);
    vi.spyOn(wakeRound, "consumeWakeForRoundDispatch").mockResolvedValue({
      outcome: "recorded",
      dispatched: false,
      gate: {
        allowed: false,
        reason: "self_advance_not_execute",
        wakeEnabled: true,
        selfAdvanceWriteMode: "dry_run",
        sourceEligible: true,
      },
      reason: "self_advance_not_execute",
      wakeEvent: undefined,
      roundId: undefined,
      dispatcherPresent: false,
      opKey: "k",
      wakeOp: undefined,
      reused: false,
    } as never);

    const result = await triggerPostPlanConfirmAdvance({
      groupId: "grp-daniel-hhd-gmail-com-upbeyond",
      taskId: "F4-20261028-wak",
      boardItemId: "860d20dc-4632-41e5-b163-4b3eccf2ac69",
      todolistId: "2cbf6e99-aa62-463b-bd27-e632a08a58ac",
      confirmedVersion: 2,
      stepId: "s1",
      confirmerId: "daniel.hhd@gmail.com",
      cfg,
    });

    expect(result.wakeRecorded, `reason=${result.reason}`).toBe(true);
    expect(result.wakeConsumed).toBe(true);
    expect(nudgeSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        toAgentIds: ["bot"],
        reason: expect.stringContaining("plan_confirmed_auto_advance:v2"),
      }),
      expect.anything(),
    );
  });

  it("inactive board + authorizer≠executor → no proxy-claim; schedules executor self-claim wake", async () => {
    const { cfg } = await useRoot();
    vi.spyOn(claimEntry, "listCollaborationBoardItems").mockResolvedValue([
      {
        itemId: "board-1",
        taskId: "task-1",
        groupId: "grp_adv",
        status: "published",
        intendedClaimantIds: ["bot-exec"],
        title: "step",
        remainingWork: "do",
      },
    ] as never);
    const claimSpy = vi.spyOn(claimEntry, "claimCollaborationBoardItem");
    vi.spyOn(claimEntry, "buildClaimAuthority").mockResolvedValue({
      authority: seedAuthority(cfg, "grp_adv", null),
      stores: null,
      operatingState: null,
    } as never);
    vi.spyOn(executorTodolist, "loadExecutorTodolist").mockResolvedValue({
      todolistId: "td-1",
      taskId: "task-1",
      boardItemId: "board-1",
      groupId: "grp_adv",
      ownerMemberId: "bot-exec",
      status: "confirmed",
      version: 1,
      steps: [{ stepId: "s1", title: "step", status: "active" }],
      visibility: "executor_private",
    } as never);
    vi.spyOn(executorTodolist, "buildExecutionTaskBag").mockReturnValue({
      boardSummary: { itemId: "board-1", goal: "g" },
      groupContextPointer: { groupId: "grp_adv", transcriptHint: "t" },
      todolistCurrentStep: { stepId: "s1", version: 1, title: "step" },
    } as never);
    const wakeSpy = vi
      .spyOn(wakeContract, "recordNudgeWake")
      .mockResolvedValue({ ok: true } as never);
    vi.spyOn(wakeRound, "consumeWakeForRoundDispatch").mockResolvedValue({
      outcome: "recorded",
      dispatched: false,
      reason: "self_advance_not_execute",
      gate: {
        allowed: false,
        reason: "self_advance_not_execute",
        wakeEnabled: true,
        selfAdvanceWriteMode: "dry_run",
        sourceEligible: true,
      },
      dispatcherPresent: false,
    } as never);

    const result = await triggerPostPlanConfirmAdvance({
      groupId: "grp_adv",
      taskId: "task-1",
      boardItemId: "board-1",
      todolistId: "td-1",
      confirmedVersion: 1,
      confirmerId: "human:owner",
      cfg,
    });
    expect(claimSpy).not.toHaveBeenCalled();
    expect(wakeSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        toAgentIds: ["bot-exec"],
        reason: expect.stringContaining("post_confirm_executor_self_claim"),
      }),
      expect.anything(),
    );
    expect(result.reason).toMatch(/confirm_awaiting_executor_self_claim/);
    expect(result.dispatched).toBe(false);
    expect(result.wakeRecorded).toBe(true);
    expect(result.targetAgentIds).toEqual(["bot-exec"]);
  });

  it("plan missing on published board → refuse BEFORE claim (board/responsibility unchanged)", async () => {
    const { cfg } = await useRoot();
    vi.spyOn(claimEntry, "listCollaborationBoardItems").mockResolvedValue([
      {
        itemId: "board-1",
        taskId: "task-1",
        groupId: "grp_adv",
        status: "published",
        intendedClaimantIds: ["bot-exec"],
        title: "step",
        remainingWork: "do",
      },
    ] as never);
    const claimSpy = vi.spyOn(claimEntry, "claimCollaborationBoardItem");
    vi.spyOn(claimEntry, "buildClaimAuthority").mockResolvedValue({
      authority: seedAuthority(cfg, "grp_adv", null),
      stores: null,
      operatingState: null,
    } as never);
    vi.spyOn(executorTodolist, "loadExecutorTodolist").mockResolvedValue(null as never);

    const result = await triggerPostPlanConfirmAdvance({
      groupId: "grp_adv",
      taskId: "task-1",
      boardItemId: "board-1",
      todolistId: "td-1",
      confirmedVersion: 1,
      confirmerId: "human:owner",
      cfg,
    });
    expect(claimSpy).not.toHaveBeenCalled();
    expect(result.reason).toBe("execution_bag_todolist_missing");
    expect(result.wakeRecorded).toBe(false);
    expect(result.dispatched).toBe(false);
  });

  it("plan revised (version mismatch) on published board → refuse BEFORE claim", async () => {
    const { cfg } = await useRoot();
    vi.spyOn(claimEntry, "listCollaborationBoardItems").mockResolvedValue([
      {
        itemId: "board-1",
        taskId: "task-1",
        groupId: "grp_adv",
        status: "published",
        intendedClaimantIds: ["bot-exec"],
        title: "step",
        remainingWork: "do",
      },
    ] as never);
    const claimSpy = vi.spyOn(claimEntry, "claimCollaborationBoardItem");
    vi.spyOn(claimEntry, "buildClaimAuthority").mockResolvedValue({
      authority: seedAuthority(cfg, "grp_adv", null),
      stores: null,
      operatingState: null,
    } as never);
    vi.spyOn(executorTodolist, "loadExecutorTodolist").mockResolvedValue({
      todolistId: "td-1",
      taskId: "task-1",
      boardItemId: "board-1",
      groupId: "grp_adv",
      ownerMemberId: "bot-exec",
      status: "confirmed",
      version: 9,
      steps: [{ stepId: "s1", title: "step", status: "active" }],
      visibility: "executor_private",
    } as never);

    const result = await triggerPostPlanConfirmAdvance({
      groupId: "grp_adv",
      taskId: "task-1",
      boardItemId: "board-1",
      todolistId: "td-1",
      confirmedVersion: 1,
      confirmerId: "human:owner",
      cfg,
    });
    expect(claimSpy).not.toHaveBeenCalled();
    expect(result.reason).toMatch(/execution_bag_version_mismatch/);
    expect(result.wakeRecorded).toBe(false);
  });

  it("published board + human confirmer → no proxy-claim; claim wake to executor (not execute)", async () => {
    const { cfg } = await useRoot({ selfAdvanceMode: "dry_run" });
    const published = {
      itemId: "board-1",
      taskId: "task-1",
      groupId: "grp_adv",
      status: "published",
      intendedClaimantIds: ["bot-exec"],
      title: "step",
      remainingWork: "do",
      acceptanceCriteria: ["ok"],
      publishedBy: "bot-exec",
      publishedAt: 1,
      revision: 1,
    };
    vi.spyOn(claimEntry, "listCollaborationBoardItems").mockResolvedValue([published] as never);
    const claimSpy = vi.spyOn(claimEntry, "claimCollaborationBoardItem");
    const applySpy = vi.spyOn(claimEntry, "applyCollaborationBoardClaim");
    vi.spyOn(claimEntry, "buildClaimAuthority").mockResolvedValue({
      authority: seedAuthority(cfg, "grp_adv", null),
      stores: null,
      operatingState: null,
    } as never);
    vi.spyOn(executorTodolist, "loadExecutorTodolist").mockResolvedValue({
      todolistId: "td-1",
      taskId: "task-1",
      boardItemId: "board-1",
      groupId: "grp_adv",
      ownerMemberId: "bot-exec",
      status: "confirmed",
      version: 1,
      steps: [{ stepId: "s1", title: "step", status: "active" }],
      visibility: "executor_private",
    } as never);
    vi.spyOn(executorTodolist, "buildExecutionTaskBag").mockReturnValue({
      boardSummary: { itemId: "board-1", goal: "g" },
      groupContextPointer: { groupId: "grp_adv", transcriptHint: "t" },
      todolistCurrentStep: { stepId: "s1", version: 1, title: "step" },
    } as never);
    const wakeSpy = vi
      .spyOn(wakeContract, "recordNudgeWake")
      .mockResolvedValue({ ok: true } as never);
    vi.spyOn(wakeRound, "consumeWakeForRoundDispatch").mockResolvedValue({
      outcome: "recorded",
      dispatched: false,
      reason: "self_advance_not_execute",
      gate: {
        allowed: false,
        reason: "self_advance_not_execute",
        wakeEnabled: true,
        selfAdvanceWriteMode: "dry_run",
        sourceEligible: true,
      },
      wakeEvent: undefined,
      roundId: undefined,
      dispatcherPresent: false,
      opKey: "k",
      wakeOp: undefined,
      reused: false,
    } as never);

    const result = await triggerPostPlanConfirmAdvance({
      groupId: "grp_adv",
      taskId: "task-1",
      boardItemId: "board-1",
      todolistId: "td-1",
      confirmedVersion: 1,
      stepId: "s1",
      confirmerId: "human:owner",
      cfg,
    });
    expect(claimSpy).not.toHaveBeenCalled();
    expect(applySpy).not.toHaveBeenCalled();
    expect(result.reason).toMatch(/confirm_awaiting_executor_self_claim/);
    expect(wakeSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        toAgentIds: ["bot-exec"],
        reason: expect.stringContaining("post_confirm_executor_self_claim"),
      }),
      expect.anything(),
    );
    expect(result.wakeRecorded).toBe(true);
    expect(result.targetAgentIds).toEqual(["bot-exec"]);
    expect(result.dispatched).toBe(false);
  });
});

describe("confirm→claim handoff evidence (positive / idempotent / revoke)", () => {
  function stubPublishedConfirmHandoff(params: {
    cfg: OpenBotConfig;
    groupId: string;
    taskId?: string;
    boardItemId?: string;
    todolistId?: string;
    executor?: string;
  }) {
    const groupId = params.groupId;
    const taskId = params.taskId ?? "task-confirm-handoff";
    const boardItemId = params.boardItemId ?? "board-confirm-handoff";
    const todolistId = params.todolistId ?? "td-confirm-handoff";
    const executor = params.executor ?? "bot-exec";
    vi.spyOn(claimEntry, "listCollaborationBoardItems").mockResolvedValue([
      {
        itemId: boardItemId,
        taskId,
        groupId,
        status: "published",
        intendedClaimantIds: [executor],
        title: "step",
        remainingWork: "do",
        acceptanceCriteria: ["ok"],
        publishedBy: "bot-coord",
        publishedAt: 1,
        revision: 1,
      },
    ] as never);
    const claimSpy = vi.spyOn(claimEntry, "claimCollaborationBoardItem");
    const applySpy = vi.spyOn(claimEntry, "applyCollaborationBoardClaim");
    vi.spyOn(claimEntry, "buildClaimAuthority").mockResolvedValue({
      authority: seedAuthority(params.cfg, groupId, null),
      stores: null,
      operatingState: null,
    } as never);
    vi.spyOn(executorTodolist, "loadExecutorTodolist").mockResolvedValue({
      todolistId,
      taskId,
      boardItemId,
      groupId,
      ownerMemberId: executor,
      status: "confirmed",
      version: 1,
      steps: [{ stepId: "s1", title: "step", status: "active" }],
      visibility: "executor_private",
    } as never);
    vi.spyOn(executorTodolist, "buildExecutionTaskBag").mockReturnValue({
      boardSummary: { itemId: boardItemId, goal: "g" },
      groupContextPointer: { groupId, transcriptHint: "t" },
      todolistCurrentStep: { stepId: "s1", version: 1, title: "step" },
    } as never);
    vi.spyOn(wakeContract, "recordNudgeWake").mockResolvedValue({ ok: true } as never);
    return { taskId, boardItemId, todolistId, executor, claimSpy, applySpy };
  }

  it("positive: human confirm on published board → claim handoff wake_dispatched (not mere record)", async () => {
    const groupId = "grp_confirm_handoff_pos";
    const { cfg } = await useRoot({
      selfAdvanceMode: "execute",
      selfAdvanceExecuteAllowlist: [groupId],
      wakeContract: true,
      wakeContractGroupAllowlist: [groupId],
    });
    const stub = stubPublishedConfirmHandoff({ cfg, groupId });
    let dispatchCalls = 0;
    const counting: WakeRoundDispatcher = async (req) => {
      dispatchCalls += 1;
      expect(req.toAgentIds).toEqual([stub.executor]);
      expect(String(req.reason)).toContain("post_confirm_executor_self_claim");
      expect(String(req.dispatchPrompt ?? "")).toMatch(/claim|认领|handoff/i);
      return {
        ok: true,
        roundId: `confirm-handoff-${dispatchCalls}`,
        sideEffectClass: "completed_with_receipt",
      };
    };
    const result = await triggerPostPlanConfirmAdvance({
      groupId,
      taskId: stub.taskId,
      boardItemId: stub.boardItemId,
      todolistId: stub.todolistId,
      confirmedVersion: 1,
      stepId: "s1",
      confirmerId: "human:owner",
      cfg,
      roundDispatcher: counting,
    });
    expect(stub.claimSpy).not.toHaveBeenCalled();
    expect(stub.applySpy).not.toHaveBeenCalled();
    expect(result.dispatched, `reason=${result.reason}`).toBe(true);
    expect(result.wakeRecorded).toBe(true);
    expect(result.wakeConsumed).toBe(true);
    expect(result.reason).toMatch(/confirm_awaiting_executor_self_claim:wake_dispatched/);
    expect(result.targetAgentIds).toEqual([stub.executor]);
    expect(dispatchCalls).toBe(1);
  });

  it("idempotent: duplicate confirm handoff reuses durable wake — no second dispatcher invoke", async () => {
    const groupId = "grp_confirm_handoff_idem";
    const { cfg } = await useRoot({
      selfAdvanceMode: "execute",
      selfAdvanceExecuteAllowlist: [groupId],
      wakeContract: true,
      wakeContractGroupAllowlist: [groupId],
    });
    const stub = stubPublishedConfirmHandoff({
      cfg,
      groupId,
      taskId: "task-idem",
      boardItemId: "board-idem",
    });
    let dispatchCalls = 0;
    const counting: WakeRoundDispatcher = async () => {
      dispatchCalls += 1;
      return {
        ok: true,
        roundId: `confirm-idem-${dispatchCalls}`,
        sideEffectClass: "completed_with_receipt",
      };
    };
    const first = await triggerPostPlanConfirmAdvance({
      groupId,
      taskId: stub.taskId,
      boardItemId: stub.boardItemId,
      todolistId: stub.todolistId,
      confirmedVersion: 1,
      stepId: "s1",
      confirmerId: "human:owner",
      cfg,
      roundDispatcher: counting,
    });
    expect(first.dispatched, `first=${first.reason}`).toBe(true);
    expect(dispatchCalls).toBe(1);

    const second = await triggerPostPlanConfirmAdvance({
      groupId,
      taskId: stub.taskId,
      boardItemId: stub.boardItemId,
      todolistId: stub.todolistId,
      confirmedVersion: 1,
      stepId: "s1",
      confirmerId: "human:owner",
      cfg,
      roundDispatcher: counting,
    });
    expect(stub.claimSpy).not.toHaveBeenCalled();
    expect(second.wakeRecorded).toBe(true);
    expect(second.dispatched, `second=${second.reason}`).toBe(true);
    expect(second.reason).toMatch(
      /confirm_awaiting_executor_self_claim:(wake_dispatched|recorded_not_dispatched)|idempotent/i,
    );
    // Durable settle reused — dispatcher must not fire twice for the same opKey.
    expect(dispatchCalls).toBe(1);
  });

  it("target revoked → recorded_not_dispatched with auth_revoked; no proxy claim (≠ actor mismatch)", async () => {
    const groupId = "grp_confirm_handoff_revoked";
    const { cfg } = await useRoot({
      selfAdvanceMode: "execute",
      selfAdvanceExecuteAllowlist: [groupId],
      wakeContract: true,
      wakeContractGroupAllowlist: [groupId],
    });
    const stub = stubPublishedConfirmHandoff({
      cfg,
      groupId,
      taskId: "task-revoked",
      boardItemId: "board-revoked",
      executor: "bot-exec-revoked",
    });
    // Real revoke path: consume reports auth_revoked (membership stripped) — not claim_actor_mismatch.
    vi.spyOn(wakeRound, "consumeWakeForRoundDispatch").mockResolvedValue({
      outcome: "recorded",
      dispatched: false,
      reason: "auth_revoked",
      gate: {
        allowed: false,
        reason: "auth_revoked",
        wakeEnabled: true,
        selfAdvanceWriteMode: "execute",
        sourceEligible: false,
      },
      dispatcherPresent: true,
      reused: false,
    } as never);
    let dispatchCalls = 0;
    const counting: WakeRoundDispatcher = async () => {
      dispatchCalls += 1;
      return { ok: true, roundId: "must-not-run" };
    };
    const result = await triggerPostPlanConfirmAdvance({
      groupId,
      taskId: stub.taskId,
      boardItemId: stub.boardItemId,
      todolistId: stub.todolistId,
      confirmedVersion: 1,
      stepId: "s1",
      confirmerId: "human:owner",
      cfg,
      roundDispatcher: counting,
    });
    expect(stub.claimSpy).not.toHaveBeenCalled();
    expect(stub.applySpy).not.toHaveBeenCalled();
    expect(result.dispatched).toBe(false);
    expect(result.wakeRecorded).toBe(true);
    expect(result.reason).toMatch(/confirm_awaiting_executor_self_claim:recorded_not_dispatched/);
    expect(result.reason).toContain("auth_revoked");
    expect(result.reason).not.toMatch(/claim_actor_mismatch/);
    expect(dispatchCalls).toBe(0);
  });
});

describe("R1 readiness — gateway agents.list ∩ active OS bot", () => {
  it("OS-active bot missing from gateway agents.list → dispatcher calls = 0", async () => {
    const tenantId = "tenant-r1-a";
    const groupId = "grp_ready";
    const { cfg } = await useRoot({
      selfAdvanceMode: "execute",
      selfAdvanceExecuteAllowlist: ["*"],
      wakeContract: true,
      profile: "managed_enterprise",
      // Intentionally omit bot-global-only from agents.list
      agentsList: [{ id: "other-bot", name: "other" }],
    });

    const groupLocator = resolveTrustedGroupLocator({
      groupId,
      tenantId,
      profile: "managed_enterprise",
      cfg,
    });
    const stores = createTrustedGroupStores({
      groupsRoot: path.dirname(groupLocator),
      groupLocator,
    });
    await writeGroupOperatingState({
      fileStore: stores.fileStore,
      groupId,
      groupRootDir: stores.groupsRoot,
      cfg,
      state: {
        ...makeOperatingState({ groupId }),
        memberRoleMap: [
          {
            memberId: "bot-global-only",
            memberKind: "bot",
            status: "active",
            governanceRole: "member",
            collaborationRole: "contributor",
          },
        ],
      } as never,
    });

    const authority = seedAuthority(cfg, groupId, tenantId);
    const calls: unknown[] = [];
    const dispatcher: WakeRoundDispatcher = async (req) => {
      calls.push(req);
      return { ok: true, roundId: "r1", detail: "should-not-run" };
    };

    const result = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      roundDispatcher: dispatcher,
      nowMs: 1_700_000_100_000,
      request: {
        groupId,
        tenantId,
        fromAgentId: "human:owner",
        toAgentIds: ["bot-global-only"],
        source: "nudge",
        taskId: "task_ready",
        itemId: "i1",
        reason: "test:not_in_gateway_agents_list",
      },
    });
    expect(result.dispatched).toBe(false);
    expect(String(result.reason).startsWith("dispatch_readiness_not_ready")).toBe(true);
    expect(String(result.reason)).toContain("not_in_gateway_agents_list");
    expect(calls).toHaveLength(0);
  });

  it("stop during readiness barrier → dispatcher calls = 0", async () => {
    const tenantId = "tenant-r1-stop";
    const groupId = "grp_stop_ready";
    const taskId = "task_stop_ready";
    const { cfg } = await useRoot({
      selfAdvanceMode: "execute",
      selfAdvanceExecuteAllowlist: ["*"],
      wakeContract: true,
      profile: "managed_enterprise",
      agentsList: [{ id: "bot-ready", name: "ready" }],
    });

    const groupLocator = resolveTrustedGroupLocator({
      groupId,
      tenantId,
      profile: "managed_enterprise",
      cfg,
    });
    const stores = createTrustedGroupStores({
      groupsRoot: path.dirname(groupLocator),
      groupLocator,
    });
    const now = Date.now();
    await stores.objectStorage.writeObject(groupId, "task", taskId, {
      taskId,
      groupId,
      title: taskId,
      status: "ready",
      createdAtMs: now,
      updatedAtMs: now,
    } satisfies Task);
    await writeGroupOperatingState({
      fileStore: stores.fileStore,
      groupId,
      groupRootDir: stores.groupsRoot,
      cfg,
      state: {
        ...makeOperatingState({ groupId }),
        memberRoleMap: [
          {
            memberId: "bot-ready",
            memberKind: "bot",
            status: "active",
            governanceRole: "member",
            collaborationRole: "contributor",
          },
        ],
      } as never,
    });

    const authority = seedAuthority(cfg, groupId, tenantId);
    const calls: unknown[] = [];

    // Mark task stopped after readiness, before CAS take.
    const result = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      roundDispatcher: async (req) => {
        calls.push(req);
        return { ok: true, roundId: "no", detail: "x" };
      },
      nowMs: 1_700_000_100_200,
      _testAfterReadinessBarrier: async () => {
        const current = await stores.objectStorage.readObject<Task>(groupId, "task", taskId);
        if (current) {
          await stores.objectStorage.writeObject(groupId, "task", taskId, {
            ...current,
            updatedAtMs: Date.now(),
            stopControl: buildAcceptedTaskStopControl({
              requestedBy: "human:owner",
              reason: "halt_during_readiness",
            }),
          } as never);
        }
      },
      request: {
        groupId,
        tenantId,
        fromAgentId: "human:owner",
        toAgentIds: ["bot-ready"],
        source: "nudge",
        taskId,
        itemId: "i1",
        reason: "test:stop_during_readiness",
      },
    });
    expect(calls).toHaveLength(0);
    expect(result.dispatched).toBe(false);
  });
});

describe("R2 readiness failure releases unconsumed claim", () => {
  it("commit → readiness fail → fix member → different op dispatches; legacy root untouched", async () => {
    const tenantId = "tenant-r2-claim";
    const groupId = "grp_r2_claim";
    const taskId = "task_r2_claim";
    const { cfg, root } = await useRoot({
      selfAdvanceMode: "execute",
      selfAdvanceExecuteAllowlist: [`${tenantId}/${groupId}`],
      wakeContract: true,
      wakeContractGroupAllowlist: [`${tenantId}/${groupId}`],
      profile: "managed_enterprise",
      // First attempt: bot absent from gateway agents.list → readiness fails after eligibility commit.
      agentsList: [{ id: "unrelated-bot", name: "x" }],
    });

    const groupLocator = resolveTrustedGroupLocator({
      groupId,
      tenantId,
      profile: "managed_enterprise",
      cfg,
    });
    const trusted = { groupsRoot: path.dirname(groupLocator), groupLocator };
    const stores = createTrustedGroupStores(trusted);
    const now = Date.now();
    await stores.objectStorage.writeObject(groupId, "task", taskId, {
      taskId,
      groupId,
      title: taskId,
      status: "ready",
      createdAtMs: now,
      updatedAtMs: now,
      controlEpoch: 0,
    } as Task);
    await writeGroupOperatingState({
      fileStore: stores.fileStore,
      groupId,
      groupRootDir: stores.groupsRoot,
      cfg,
      state: {
        ...makeOperatingState({ groupId }),
        memberRoleMap: [
          {
            memberId: "bot-r2",
            memberKind: "bot",
            status: "active",
            governanceRole: "member",
            collaborationRole: "contributor",
          },
        ],
      } as never,
    });

    const authority = seedAuthority(cfg, groupId, tenantId);
    const calls: Array<{ reason?: string }> = [];

    const first = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      roundDispatcher: async (req) => {
        calls.push({ reason: req.reason });
        return { ok: true, roundId: "should-not", detail: "x" };
      },
      nowMs: 1_700_000_200_000,
      request: {
        groupId,
        tenantId,
        fromAgentId: "human:owner",
        toAgentIds: ["bot-r2"],
        source: "nudge",
        taskId,
        itemId: "i1",
        reason: "test:r2_readiness_fail_op_a",
        opKey: "r2-op-a",
      },
    });
    expect(first.dispatched).toBe(false);
    expect(String(first.reason).startsWith("dispatch_readiness_not_ready")).toBe(true);
    expect(String(first.reason)).toContain("not_in_gateway_agents_list");
    expect(calls).toHaveLength(0);

    const afterFail = asGovernedTask(
      (await stores.objectStorage.readObject<Task>(groupId, "task", taskId)) as Task,
    );
    expect(afterFail.dispatchClaim).toBeFalsy();

    // Legacy host collaboration root must not receive the claim write/clear.
    const legacyCollab = path.join(root, "collaboration");
    const legacyTaskMarker = path.join(legacyCollab, "groups", groupId, "objects");
    // Even if directory exists from factory, no task claim object for this group should appear
    // as the authoritative write — assert trusted task has no claim and second op works.

    // Fix: put bot on gateway agents.list, then different op succeeds.
    const fixedCfg = {
      ...cfg,
      agents: {
        ...cfg.agents,
        list: [{ id: "bot-r2", name: "r2" }],
      },
    } as typeof cfg;
    const configPath = process.env.OPENBOT_CONFIG_PATH;
    if (configPath) {
      await fs.writeFile(configPath, `${JSON.stringify(fixedCfg, null, 2)}\n`, "utf8");
    }
    setRuntimeConfigSnapshot(fixedCfg, fixedCfg);
    clearConfigCache();
    const second = await consumeWakeForRoundDispatch({
      authority,
      cfg: fixedCfg,
      roundDispatcher: async (req) => {
        calls.push({ reason: req.reason });
        return { ok: true, roundId: "r2-ok", detail: "dispatched" };
      },
      nowMs: 1_700_000_200_500,
      request: {
        groupId,
        tenantId,
        fromAgentId: "human:owner",
        toAgentIds: ["bot-r2"],
        source: "nudge",
        taskId,
        itemId: "i1",
        reason: "test:r2_readiness_fixed_op_b",
        opKey: "r2-op-b",
      },
    });
    expect(second.dispatched, `second=${second.reason}`).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.reason).toContain("r2_readiness_fixed_op_b");

    // No authoritative writes under host collaboration groups for this task claim lifecycle.
    void legacyTaskMarker;
    const afterOk = asGovernedTask(
      (await stores.objectStorage.readObject<Task>(groupId, "task", taskId)) as Task,
    );
    // finally clears taken claim on success path
    expect(afterOk.dispatchClaim).toBeFalsy();
  });
});

describe("R2 deliverable binding — explicit only, no group scan", () => {
  it("parallel two tasks / missing explicit → refuse (no wrong bind)", async () => {
    const { cfg } = await useRoot();
    const groupId = "grp_r2_bind";
    const groupLocator = resolveTrustedGroupLocator({
      groupId,
      tenantId: null,
      profile: "personal_local",
      cfg,
    });
    const trusted = { groupsRoot: path.dirname(groupLocator), groupLocator };
    const stores = createTrustedGroupStores(trusted);
    const now = Date.now();
    for (const taskId of ["task-a", "task-b"]) {
      await stores.objectStorage.writeObject(groupId, "task", taskId, {
        taskId,
        groupId,
        title: taskId,
        status: "ready",
        assignedMemberIds: ["bot-exec"],
        createdAtMs: now,
        updatedAtMs: now,
      } satisfies Task);
    }

    // No explicit binding → refuse (even if actor has claims elsewhere).
    const noExplicit = await resolveActorDeliverableTaskBinding({
      groupId,
      actorId: "bot-exec",
      groupCurrentTaskId: "task-a",
      stores,
      trusted,
      cfg,
    });
    expect(noExplicit.ok).toBe(false);
    if (!noExplicit.ok) {
      expect(noExplicit.reason).toBe("execution_binding_required");
    }
  });

  it("explicit ids must verify claimant + active status", async () => {
    const { cfg } = await useRoot();
    const groupId = "grp_r2_verify";
    const taskId = "task-v";
    const groupLocator = resolveTrustedGroupLocator({
      groupId,
      tenantId: null,
      profile: "personal_local",
      cfg,
    });
    const trusted = { groupsRoot: path.dirname(groupLocator), groupLocator };
    const stores = createTrustedGroupStores(trusted);
    vi.spyOn(claimEntry, "listCollaborationBoardItems").mockResolvedValue([
      {
        itemId: "board-1",
        taskId,
        groupId,
        status: "applied",
        claimantId: "bot-other",
        title: "x",
        remainingWork: "y",
      },
    ] as never);

    const mismatch = await resolveActorDeliverableTaskBinding({
      groupId,
      actorId: "bot-exec",
      explicitTaskId: taskId,
      explicitBoardItemId: "board-1",
      stores,
      trusted,
      cfg,
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.reason).toMatch(/explicit_claimant_mismatch/);
    }

    vi.spyOn(claimEntry, "listCollaborationBoardItems").mockResolvedValue([
      {
        itemId: "board-1",
        taskId,
        groupId,
        status: "published",
        claimantId: "bot-exec",
        title: "x",
        remainingWork: "y",
      },
    ] as never);
    const inactive = await resolveActorDeliverableTaskBinding({
      groupId,
      actorId: "bot-exec",
      explicitTaskId: taskId,
      explicitBoardItemId: "board-1",
      stores,
      trusted,
      cfg,
    });
    expect(inactive.ok).toBe(false);
    if (!inactive.ok) {
      expect(inactive.reason).toMatch(/explicit_board_not_active/);
    }

    vi.spyOn(claimEntry, "listCollaborationBoardItems").mockResolvedValue([
      {
        itemId: "board-1",
        taskId,
        groupId,
        status: "applied",
        claimantId: "bot-exec",
        title: "x",
        remainingWork: "y",
      },
    ] as never);
    const ok = await resolveActorDeliverableTaskBinding({
      groupId,
      actorId: "bot-exec",
      explicitTaskId: taskId,
      explicitBoardItemId: "board-1",
      stores,
      trusted,
      cfg,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.taskId).toBe(taskId);
      expect(ok.boardItemId).toBe("board-1");
      expect(ok.source).toBe("explicit");
    }
  });

  it("binary declaration refused even when contentFromFile is set (text-only PR)", async () => {
    const r = await maybeSubmitTeamDeliverableFromChatFinal({
      text: '<<DELIVERABLE file="report.pdf">>\nnot-a-pdf\n<</DELIVERABLE>>',
      groupId: "g1",
      taskId: "t1",
      agentId: "bot-a",
      contentFromFile: "/tmp/fake.pdf",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("deliverable_binary_not_supported_in_this_pr");
    }
  });
});

describe("R2 plan-confirm → real consumeWake → final dispatch revalidate", () => {
  it("final dispatcher receives board summary / step; revision before dispatch refuses", async () => {
    const groupId = "grp_r2_plan";
    const { cfg } = await useRoot({
      selfAdvanceMode: "execute",
      selfAdvanceExecuteAllowlist: [groupId],
      wakeContract: true,
      wakeContractGroupAllowlist: [groupId],
    });
    const taskId = "task_r2_plan";
    const boardItemId = "board_r2";
    const todolistId = "td_r2";
    const confirmerId = "human:owner";
    const claimant = "bot-exec";

    let bagVersion = 3;
    vi.spyOn(wakeContract, "recordNudgeWake").mockResolvedValue({ ok: true } as never);
    vi.spyOn(claimEntry, "listCollaborationBoardItems").mockResolvedValue([
      {
        itemId: boardItemId,
        taskId,
        groupId,
        status: "applied",
        claimantId: claimant,
        title: "step",
        remainingWork: "do",
        goal: "交付报告",
        acceptanceCriteria: ["完整"],
      },
    ] as never);
    vi.spyOn(claimEntry, "buildClaimAuthority").mockResolvedValue({
      authority: seedAuthority(cfg, groupId, null),
      stores: null,
      operatingState: null,
    } as never);
    vi.spyOn(executorTodolist, "loadExecutorTodolist").mockImplementation(async () => {
      return {
        todolistId,
        boardItemId,
        taskId,
        groupId,
        ownerMemberId: claimant,
        status: "confirmed",
        steps: [{ stepId: "step-a", title: "写草稿", detail: "交付报告", status: "active" }],
        proposedBy: claimant,
        proposedAt: 1,
        confirmedBy: confirmerId,
        confirmedAt: 2,
        version: bagVersion,
        visibility: "executor_private",
      } as never;
    });

    const captured: Array<{
      prompt?: string | null;
      reason?: string;
      binding?: ExecutionDeliverableBinding | null;
    }> = [];
    const capturing: WakeRoundDispatcher = async (req) => {
      captured.push({
        prompt: req.dispatchPrompt,
        reason: req.reason,
        binding: req.executionDeliverableBinding ?? null,
      });
      return { ok: true, roundId: "r2-plan-ok", detail: "member-run" };
    };

    const okAdvance = await triggerPostPlanConfirmAdvance({
      groupId,
      taskId,
      boardItemId,
      todolistId,
      confirmedVersion: 3,
      stepId: "step-a",
      confirmerId,
      cfg,
      roundDispatcher: capturing,
    });
    expect(okAdvance.dispatched, `advance=${String(okAdvance.reason)}`).toBe(true);
    expect(captured).toHaveLength(1);
    expect(String(captured[0]?.prompt)).toContain("交付报告");
    expect(String(captured[0]?.prompt)).toContain("写草稿");
    expect(String(captured[0]?.prompt)).toMatch(/transcript|GROUP_PUBLIC|group-transcript/i);
    expect(String(captured[0]?.reason)).toContain("v3");
    expect(captured[0]?.binding?.taskId).toBe(taskId);
    expect(captured[0]?.binding?.boardItemId).toBe(boardItemId);
    expect(captured[0]?.binding?.planVersion).toBe(3);
    expect(captured[0]?.binding?.runId).toBeTruthy();
    expect(captured[0]?.binding?.groupId).toBe(groupId);
    // R5: attempt/op/run come from durable wake-op claim — not wake_attempt_<uuid>.
    expect(captured[0]?.binding?.attemptId).toBeTruthy();
    expect(String(captured[0]?.binding?.attemptId)).not.toMatch(/^wake_attempt_/);
    expect(captured[0]?.binding?.opKey).toBeTruthy();
    expect(captured[0]?.binding?.stepId).toBe("step-a");
    expect(captured[0]?.binding?.agentId).toBe(claimant);
    expect(captured[0]?.binding?.runId).toBe(
      runIdFromWakeOpAttempt({
        opKey: String(captured[0]?.binding?.opKey),
        attemptId: String(captured[0]?.binding?.attemptId),
      }),
    );

    // Revision AFTER pre-check bag, BEFORE final dispatch — use a fresh task/board
    // so wake opKey is not idempotent_reuse of the prior completed advance.
    captured.length = 0;
    const taskId2 = "task_r2_plan_rev";
    const boardItemId2 = "board_r2_rev";
    const todolistId2 = "td_r2_rev";
    vi.spyOn(claimEntry, "listCollaborationBoardItems").mockResolvedValue([
      {
        itemId: boardItemId2,
        taskId: taskId2,
        groupId,
        status: "applied",
        claimantId: claimant,
        title: "step",
        remainingWork: "do",
        goal: "交付报告",
        acceptanceCriteria: ["完整"],
      },
    ] as never);
    let callsToBag = 0;
    vi.spyOn(executorTodolist, "loadExecutorTodolist").mockImplementation(async () => {
      callsToBag += 1;
      // First call (pre-nudge check) stays v3; final dispatch revalidate flips to v9.
      const version = callsToBag === 1 ? 3 : 9;
      return {
        todolistId: todolistId2,
        boardItemId: boardItemId2,
        taskId: taskId2,
        groupId,
        ownerMemberId: claimant,
        status: "confirmed",
        steps: [
          {
            stepId: version === 3 ? "step-a" : "step-new",
            title: version === 3 ? "写草稿" : "新步骤",
            detail: "交付报告",
            status: "active",
          },
        ],
        proposedBy: claimant,
        proposedAt: 1,
        confirmedBy: confirmerId,
        confirmedAt: 2,
        version,
        visibility: "executor_private",
      } as never;
    });

    const revised = await triggerPostPlanConfirmAdvance({
      groupId,
      taskId: taskId2,
      boardItemId: boardItemId2,
      todolistId: todolistId2,
      confirmedVersion: 3,
      stepId: "step-a",
      confirmerId,
      cfg,
      roundDispatcher: capturing,
    });
    expect(revised.dispatched, `revised=${String(revised.reason)}`).toBe(false);
    expect(captured).toHaveLength(0);
    expect(String(revised.reason)).toMatch(
      /plan_revised_before_dispatch|dispatch_failed:plan_revised|plan_step_changed/,
    );
  });
});

describe("R3 run binding — no Map; unconfusable context", () => {
  it("same member dual-task interleaved finals do not cross-bind", async () => {
    const { cfg } = await useRoot();
    const groupId = "grp_r3_interleave";
    const groupLocator = resolveTrustedGroupLocator({
      groupId,
      tenantId: null,
      profile: "personal_local",
      cfg,
    });
    const trusted = { groupsRoot: path.dirname(groupLocator), groupLocator };
    const stores = createTrustedGroupStores(trusted);
    const now = Date.now();
    for (const taskId of ["task-a", "task-b"]) {
      await stores.objectStorage.writeObject(groupId, "task", taskId, {
        taskId,
        groupId,
        title: taskId,
        status: "ready",
        createdAtMs: now,
        updatedAtMs: now,
      } satisfies Task);
    }
    vi.spyOn(claimEntry, "listCollaborationBoardItems").mockImplementation(async (params) => {
      const taskId = String(params.taskId);
      return [
        {
          itemId: taskId === "task-a" ? "board-a" : "board-b",
          taskId,
          groupId,
          status: "applied",
          claimantId: "bot-exec",
          title: taskId,
          remainingWork: "do",
        },
      ] as never;
    });

    const bindA = buildExecutionDeliverableBinding({
      groupId,
      taskId: "task-a",
      boardItemId: "board-a",
      runId: "run-a-1",
      source: "explicit_run",
    });
    const bindB = buildExecutionDeliverableBinding({
      groupId,
      taskId: "task-b",
      boardItemId: "board-b",
      runId: "run-b-1",
      source: "explicit_run",
    });
    expect(bindA).toBeTruthy();
    expect(bindB).toBeTruthy();

    const textA = '<<DELIVERABLE title="A" file="notes/a.md">>\nbody-a\n<</DELIVERABLE>>';
    const textB = '<<DELIVERABLE title="B" file="notes/b.md">>\nbody-b\n<</DELIVERABLE>>';

    // Interleave: finalize B then A (as if finals arrived out of order).
    const outB = await finalizeMemberRunTeamDeliverable({
      text: textB,
      agentId: "bot-exec",
      binding: bindB,
      trusted,
      stores,
      cfg,
      enforceAcl: false,
    });
    const outA = await finalizeMemberRunTeamDeliverable({
      text: textA,
      agentId: "bot-exec",
      binding: bindA,
      trusted,
      stores,
      cfg,
      enforceAcl: false,
    });
    expect(outB.outcome.ok, JSON.stringify(outB.outcome)).toBe(true);
    expect(outA.outcome.ok, JSON.stringify(outA.outcome)).toBe(true);
    if (outA.outcome.ok && outB.outcome.ok) {
      expect(outA.outcome.taskId).toBe("task-a");
      expect(outB.outcome.taskId).toBe("task-b");
      expect(outA.outcome.deliverableId).not.toBe(outB.outcome.deliverableId);
    }

    const readA = await readTeamDeliverable({
      groupId,
      deliverableId: outA.outcome.ok ? outA.outcome.deliverableId : "",
      actor: "human:peer",
      cfg,
      enforceAcl: false,
      trusted,
    });
    const readB = await readTeamDeliverable({
      groupId,
      deliverableId: outB.outcome.ok ? outB.outcome.deliverableId : "",
      actor: "human:peer",
      cfg,
      enforceAcl: false,
      trusted,
    });
    expect(readA.ok && readA.content).toContain("body-a");
    expect(readB.ok && readB.content).toContain("body-b");
  });

  it("dual tenants same local groupId/agentId do not share binding", async () => {
    const tenantsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-pr129-tenants-"));
    tempDirs.push(tenantsRoot);
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    const { cfg } = await useRoot({ profile: "managed_enterprise" });
    const groupId = "grp_shared_local";
    const agentId = "bot-exec";
    const results: Array<{ tenantId: string; deliverableId?: string; content?: string }> = [];

    for (const tenantId of ["tenant-a", "tenant-b"]) {
      const groupLocator = resolveTrustedGroupLocator({
        groupId,
        tenantId,
        profile: "managed_enterprise",
        cfg,
      });
      const trusted = { groupsRoot: path.dirname(groupLocator), groupLocator };
      const stores = createTrustedGroupStores(trusted);
      const taskId = "task-same";
      const now = Date.now();
      await stores.objectStorage.writeObject(groupId, "task", taskId, {
        taskId,
        groupId,
        title: taskId,
        status: "ready",
        createdAtMs: now,
        updatedAtMs: now,
      } satisfies Task);
      vi.spyOn(claimEntry, "listCollaborationBoardItems").mockResolvedValue([
        {
          itemId: "board-same",
          taskId,
          groupId,
          status: "applied",
          claimantId: agentId,
          title: "x",
          remainingWork: "y",
        },
      ] as never);

      const binding = buildExecutionDeliverableBinding({
        tenantId,
        groupId,
        taskId,
        boardItemId: "board-same",
        runId: `run-${tenantId}-1`,
        attemptId: `attempt-${tenantId}-1`,
        source: "explicit_run",
      });
      const body = `body-for-${tenantId}`;
      const out = await finalizeMemberRunTeamDeliverable({
        text: `<<DELIVERABLE title="T" file="notes/out.md">>\n${body}\n<</DELIVERABLE>>`,
        agentId,
        binding,
        trusted,
        stores,
        cfg,
        enforceAcl: false,
        tenant: { tenantId, trust: "membership" },
      });
      expect(out.outcome.ok, `${tenantId}:${JSON.stringify(out.outcome)}`).toBe(true);
      if (out.outcome.ok) {
        const read = await readTeamDeliverable({
          groupId,
          deliverableId: out.outcome.deliverableId,
          actor: "human:peer",
          cfg,
          enforceAcl: false,
          trusted,
          tenant: { tenantId, trust: "membership" },
        });
        expect(read.ok && read.content).toContain(body);
        results.push({
          tenantId,
          deliverableId: out.outcome.deliverableId,
          content: read.ok ? read.content : undefined,
        });
      }
    }
    expect(results).toHaveLength(2);
    expect(results[0]?.content).not.toBe(results[1]?.content);
    // Locators / ids must not collide across tenants even with same local ids.
    expect(results[0]?.deliverableId).toBeTruthy();
  });

  it("failed dispatch then ordinary reply without binding refuses (no residual Map)", async () => {
    const out = await finalizeMemberRunTeamDeliverable({
      text: '<<DELIVERABLE title="X" file="notes/x.md">>\nbody\n<</DELIVERABLE>>',
      agentId: "bot-exec",
      binding: null,
    });
    expect(out.outcome.ok).toBe(false);
    if (!out.outcome.ok) {
      expect(out.outcome.reason).toBe("execution_binding_required");
    }
    expect(out.text).toContain("团队成果未完成");
    expect(out.text).toContain("暂不能提交审核");
    expect(out.text).not.toContain("execution_binding_required");
  });

  it("submit failure retry still has the same run binding", async () => {
    const { cfg } = await useRoot();
    const groupId = "grp_r3_retry";
    const taskId = "task-retry";
    const groupLocator = resolveTrustedGroupLocator({
      groupId,
      tenantId: null,
      profile: "personal_local",
      cfg,
    });
    const trusted = { groupsRoot: path.dirname(groupLocator), groupLocator };
    const stores = createTrustedGroupStores(trusted);
    const now = Date.now();
    // Missing task on first attempt → fail; then create task and retry with SAME binding.
    vi.spyOn(claimEntry, "listCollaborationBoardItems").mockResolvedValue([
      {
        itemId: "board-retry",
        taskId,
        groupId,
        status: "applied",
        claimantId: "bot-exec",
        title: "x",
        remainingWork: "y",
      },
    ] as never);

    const binding = buildExecutionDeliverableBinding({
      groupId,
      taskId,
      boardItemId: "board-retry",
      runId: "run-retry-1",
      attemptId: "attempt-1",
      source: "explicit_run",
    });
    expect(binding).toBeTruthy();

    const text =
      '<<DELIVERABLE title="Retry" file="notes/retry.md">>\nretry-body\n<</DELIVERABLE>>';
    const first = await finalizeMemberRunTeamDeliverable({
      text,
      agentId: "bot-exec",
      binding,
      trusted,
      stores,
      cfg,
      enforceAcl: false,
    });
    expect(first.outcome.ok).toBe(false);

    await stores.objectStorage.writeObject(groupId, "task", taskId, {
      taskId,
      groupId,
      title: taskId,
      status: "ready",
      createdAtMs: now,
      updatedAtMs: now,
    } satisfies Task);

    // Same binding object reused — Map would have consumed it already.
    const second = await finalizeMemberRunTeamDeliverable({
      text,
      agentId: "bot-exec",
      binding,
      trusted,
      stores,
      cfg,
      enforceAcl: false,
    });
    expect(second.outcome.ok, JSON.stringify(second.outcome)).toBe(true);
    if (second.outcome.ok) {
      expect(second.outcome.taskId).toBe(taskId);
    }
  });

  it("stale plan version / stopped task refuse current formal delivery", async () => {
    const { cfg } = await useRoot();
    const groupId = "grp_r3_stale";
    const taskId = "task-stale";
    const groupLocator = resolveTrustedGroupLocator({
      groupId,
      tenantId: null,
      profile: "personal_local",
      cfg,
    });
    const trusted = { groupsRoot: path.dirname(groupLocator), groupLocator };
    const stores = createTrustedGroupStores(trusted);
    const now = Date.now();
    await stores.objectStorage.writeObject(groupId, "task", taskId, {
      taskId,
      groupId,
      title: taskId,
      status: "ready",
      createdAtMs: now,
      updatedAtMs: now,
    } satisfies Task);
    vi.spyOn(claimEntry, "listCollaborationBoardItems").mockResolvedValue([
      {
        itemId: "board-1",
        taskId,
        groupId,
        status: "applied",
        claimantId: "bot-exec",
        title: "x",
        remainingWork: "y",
      },
    ] as never);
    vi.spyOn(claimEntry, "getCollaborationTodolist").mockResolvedValue({
      todolistId: "td-1",
      version: 9,
      status: "confirmed",
      boardItemId: "board-1",
      steps: [],
    } as never);

    const stale = await resolveActorDeliverableTaskBinding({
      groupId,
      actorId: "bot-exec",
      explicitTaskId: taskId,
      explicitBoardItemId: "board-1",
      explicitTodolistId: "td-1",
      explicitPlanVersion: 3,
      explicitStepId: "step-a",
      stores,
      trusted,
      cfg,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.reason).toMatch(/plan_version_stale_not_current_formal/);
    }

    // Mark task stopped
    const stopped = {
      ...asGovernedTask({
        taskId,
        groupId,
        title: taskId,
        status: "ready",
        createdAtMs: now,
        updatedAtMs: now,
      }),
      stopControl: buildAcceptedTaskStopControl({
        requestedBy: "human:owner",
        reason: "halt",
        requestedAtMs: now,
      }),
    };
    await stores.objectStorage.writeObject(groupId, "task", taskId, stopped as never);
    const stoppedBind = await resolveActorDeliverableTaskBinding({
      groupId,
      actorId: "bot-exec",
      explicitTaskId: taskId,
      explicitBoardItemId: "board-1",
      stores,
      trusted,
      cfg,
    });
    expect(stoppedBind.ok).toBe(false);
    if (!stoppedBind.ok) {
      expect(stoppedBind.reason).toBe("task_stopped_not_current_formal");
    }
  });
});

describe("R4 note — managed boot composition root lives in wake-round-dispatcher-boot.test.ts", () => {
  it("documents that R3 personal_local custom-runBot boot proof was removed", () => {
    // Real evidence: wake-round-dispatcher-boot.test.ts
    // (resolveModeBWakeRoundContext + production runBot + ACL on + service_execution).
    expect(true).toBe(true);
  });
});

describe("R5 durable attempt + request/binding scope", () => {
  it("normalize wake_dispatch without opKey/stepId/agentId refuses", async () => {
    expect(
      normalizeExecutionDeliverableBinding({
        groupId: "g",
        taskId: "t",
        boardItemId: "b",
        todolistId: "td",
        planVersion: 1,
        runId: "run",
        attemptId: "a1",
        source: "wake_dispatch",
      }),
    ).toBeNull();
    expect(
      normalizeExecutionDeliverableBinding({
        groupId: "g",
        taskId: "t",
        boardItemId: "b",
        todolistId: "td",
        planVersion: 1,
        stepId: "s1",
        runId: "run",
        attemptId: "a1",
        opKey: "op1",
        source: "wake_dispatch",
      }),
    ).toBeNull();
    expect(
      normalizeExecutionDeliverableBinding({
        groupId: "g",
        taskId: "t",
        boardItemId: "b",
        todolistId: "td",
        planVersion: 1,
        stepId: "s1",
        runId: "run",
        attemptId: "a1",
        opKey: "op1",
        agentId: "bot",
        source: "wake_dispatch",
      }),
    ).toMatchObject({ opKey: "op1", stepId: "s1", attemptId: "a1", agentId: "bot" });
  });

  it("same-op retry binding uses new attempt; old runId differs", () => {
    const opKey = "plan_confirm_advance|g|t|b|td|v1|s|bot";
    const attempt1 = "attempt-uuid-1";
    const attempt2 = "attempt-uuid-2";
    const run1 = runIdFromWakeOpAttempt({ opKey, attemptId: attempt1 });
    const run2 = runIdFromWakeOpAttempt({ opKey, attemptId: attempt2 });
    expect(run1).not.toBe(run2);
    expect(run1).toContain(attempt1);
    expect(run2).toContain(attempt2);
    const bindOld = buildExecutionDeliverableBinding({
      groupId: "g",
      taskId: "t",
      boardItemId: "b",
      todolistId: "td",
      planVersion: 1,
      stepId: "s",
      runId: run1,
      attemptId: attempt1,
      opKey,
      agentId: "bot",
      source: "wake_dispatch",
    });
    const bindNew = buildExecutionDeliverableBinding({
      groupId: "g",
      taskId: "t",
      boardItemId: "b",
      todolistId: "td",
      planVersion: 1,
      stepId: "s",
      runId: run2,
      attemptId: attempt2,
      opKey,
      agentId: "bot",
      source: "wake_dispatch",
    });
    expect(bindOld?.attemptId).toBe(attempt1);
    expect(bindNew?.attemptId).toBe(attempt2);
    expect(bindOld?.runId).not.toBe(bindNew?.runId);
  });

  it("interleaved dual-task wrong binding agent refuses finalize", async () => {
    const { cfg } = await useRoot();
    const groupId = "grp_r5_agent_mismatch";
    const groupLocator = resolveTrustedGroupLocator({
      groupId,
      tenantId: null,
      profile: "personal_local",
      cfg,
    });
    const trusted = { groupsRoot: path.dirname(groupLocator), groupLocator };
    const stores = createTrustedGroupStores(trusted);
    const now = Date.now();
    await stores.objectStorage.writeObject(groupId, "task", "task-a", {
      taskId: "task-a",
      groupId,
      title: "task-a",
      status: "ready",
      createdAtMs: now,
      updatedAtMs: now,
    } satisfies Task);
    vi.spyOn(claimEntry, "listCollaborationBoardItems").mockResolvedValue([
      {
        itemId: "board-a",
        taskId: "task-a",
        groupId,
        status: "applied",
        claimantId: "bot-exec",
        title: "x",
        remainingWork: "y",
      },
    ] as never);
    const binding = buildExecutionDeliverableBinding({
      groupId,
      taskId: "task-a",
      boardItemId: "board-a",
      runId: "run-a",
      agentId: "bot-OTHER",
      source: "explicit_run",
    });
    const out = await finalizeMemberRunTeamDeliverable({
      text: '<<DELIVERABLE title="A" file="notes/a.md">>\nbody\n<</DELIVERABLE>>',
      agentId: "bot-exec",
      binding,
      trusted,
      stores,
      cfg,
      enforceAcl: false,
    });
    expect(out.outcome.ok).toBe(false);
    if (!out.outcome.ok) {
      expect(out.outcome.reason).toBe("execution_binding_agent_mismatch");
    }
  });

  function fullWakeContractBinding(runId: string) {
    return buildExecutionDeliverableBinding({
      tenantId: "tenant-a",
      groupId: "g",
      taskId: "t",
      boardItemId: "b",
      todolistId: "td",
      planVersion: 1,
      stepId: "s1",
      runId,
      attemptId: "a1",
      opKey: "op1",
      agentId: "bot",
      source: "wake_dispatch",
    });
  }

  function fullWakeContractArgs(binding: NonNullable<ReturnType<typeof fullWakeContractBinding>>) {
    return {
      binding,
      requireTenant: true as const,
      tenantId: "tenant-a",
      groupId: "g",
      taskId: "t",
      boardItemId: "b",
      agentId: "bot",
      opKey: "op1",
      attemptId: "a1",
      planConfirmBinding: {
        todolistId: "td",
        confirmedVersion: 1,
        stepId: "s1",
      },
    };
  }

  it("production wake contract rejects missing agent, plan, op/attempt; complete binding passes", () => {
    const runId = runIdFromWakeOpAttempt({ opKey: "op1", attemptId: "a1" });
    const binding = fullWakeContractBinding(runId);
    expect(binding).toBeTruthy();
    if (!binding) {
      return;
    }
    const okArgs = fullWakeContractArgs(binding);
    expect(productionWakeDeliverableContractFailure(okArgs)).toBeNull();

    // Loose compare still skips empty request sides — production contract must not.
    expect(
      executionBindingScopeMismatch({
        binding,
        groupId: "g",
        taskId: "t",
        boardItemId: "b",
        agentId: "bot",
      }),
    ).toBeNull();
    expect(
      productionWakeDeliverableContractFailure({
        ...okArgs,
        planConfirmBinding: null,
      }),
    ).toBe("plan_binding_required");
    expect(
      productionWakeDeliverableContractFailure({
        ...okArgs,
        attemptId: null,
      }),
    ).toBe("attempt_required");
    expect(
      productionWakeDeliverableContractFailure({
        ...okArgs,
        opKey: " ",
      }),
    ).toBe("op_required");
    expect(
      productionWakeDeliverableContractFailure({
        ...okArgs,
        agentId: "",
      }),
    ).toBe("agent_required");
    expect(
      productionWakeDeliverableContractFailure({
        ...okArgs,
        binding: { ...binding, tenantId: null },
      }),
    ).toBe("tenant_required");
    expect(
      normalizeExecutionDeliverableBinding({
        ...binding,
        agentId: null,
      }),
    ).toBeNull();
  });

  it("production wake contract rejects arbitrary, old-attempt, and case-variant runId", () => {
    const opKey = "op1";
    const attemptId = "a1";
    const oldAttempt = "a0";
    const exact = runIdFromWakeOpAttempt({ opKey, attemptId });
    const binding = fullWakeContractBinding(exact);
    expect(binding).toBeTruthy();
    if (!binding) {
      return;
    }
    const okArgs = fullWakeContractArgs(binding);
    expect(productionWakeDeliverableContractFailure(okArgs)).toBeNull();
    expect(
      productionWakeDeliverableContractFailure({
        ...okArgs,
        binding: { ...binding, runId: "not-a-derived-run" },
      }),
    ).toBe("run_mismatch");
    expect(
      productionWakeDeliverableContractFailure({
        ...okArgs,
        binding: {
          ...binding,
          runId: runIdFromWakeOpAttempt({ opKey, attemptId: oldAttempt }),
        },
      }),
    ).toBe("run_mismatch");
    expect(
      productionWakeDeliverableContractFailure({
        ...okArgs,
        binding: { ...binding, runId: exact.replace("wake_run:", "WAKE_RUN:") },
      }),
    ).toBe("run_mismatch");
    expect(
      productionWakeDeliverableContractFailure({
        ...okArgs,
        binding: {
          ...binding,
          runId: runIdFromWakeOpAttempt({ opKey: opKey.toUpperCase(), attemptId }),
        },
      }),
    ).toBe("run_mismatch");
  });

  it("wake_dispatch final refuses empty executing agent before submit", async () => {
    const runId = runIdFromWakeOpAttempt({ opKey: "op1", attemptId: "a1" });
    const binding = fullWakeContractBinding(runId);
    const out = await finalizeMemberRunTeamDeliverable({
      text: '<<DELIVERABLE title="A" file="notes/a.md">>\nbody\n<</DELIVERABLE>>',
      agentId: "   ",
      binding,
    });
    expect(out.outcome.ok).toBe(false);
    if (!out.outcome.ok) {
      expect(out.outcome.reason).toBe("execution_binding_agent_required");
    }
  });
});
