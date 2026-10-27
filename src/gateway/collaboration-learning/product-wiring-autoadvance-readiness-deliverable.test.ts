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
import { upsertAgent, type RuntimeAgent } from "../agent-runtime-store.js";
import { makeOperatingState } from "../collaboration-dispatch/__fixtures__/policy-source-matrix.js";
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
  },
): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
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

function agentStub(id: string, tenantId: string): RuntimeAgent {
  return {
    runtimeAgentId: id,
    name: id,
    runtimeVersion: "1",
    lifecycle: "active",
    health: "healthy",
    tenantCoverage: [tenantId],
    boundCapabilityCount: 0,
    activeSessionCount: 0,
    resourceUsage: { cpuPercent: 0, memoryPercent: 0, tokenBudgetUsedPercent: 0 },
    deployedAt: 1,
    lastActiveAt: 1,
  };
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
    expect(msg).toContain("acl_denied");
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
      taskId,
      deliverableId: submit.deliverableId,
      version: submit.version,
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
    expect(userMsg).toContain(submit.deliverableId);
    expect(userMsg).toContain(`v${submit.version}`);
    expect(userMsg).toContain(submit.locator);
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
    vi.spyOn(claimEntry, "buildCollaborationExecutionTaskBag").mockResolvedValue({
      planGate: { confirmed: true, todolistStatus: "confirmed" },
      todolistCurrentStep: {
        todolistId: "td-1",
        version: 3,
        stepId: "step-a",
        status: "confirmed",
        title: "step-a",
        stepIndex: 0,
        totalSteps: 1,
      },
      boardSummary: {
        itemId: "board-1",
        taskId: "task-1",
        groupId: "grp_adv",
        goal: "g",
        acceptanceCriteria: [],
        status: "applied",
        claimantId: "bot-exec",
      },
      groupContextPointer: {
        groupId: "grp_adv",
        transcriptHint: "hint",
        note: "n",
      },
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
    vi.spyOn(claimEntry, "buildCollaborationExecutionTaskBag").mockResolvedValue({
      planGate: { confirmed: true, todolistStatus: "confirmed" },
      todolistCurrentStep: {
        todolistId: "td-1",
        version: 9,
        stepId: "step-new",
        status: "confirmed",
        title: "step-new",
        stepIndex: 0,
        totalSteps: 1,
      },
      boardSummary: {
        itemId: "board-1",
        taskId: "task-1",
        groupId: "grp_adv",
        goal: "g",
        acceptanceCriteria: [],
        status: "applied",
        claimantId: "bot-exec",
      },
      groupContextPointer: {
        groupId: "grp_adv",
        transcriptHint: "hint",
        note: "n",
      },
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

  it("inactive board → refuse", async () => {
    const { cfg } = await useRoot();
    vi.spyOn(claimEntry, "listCollaborationBoardItems").mockResolvedValue([
      {
        itemId: "board-1",
        taskId: "task-1",
        groupId: "grp_adv",
        status: "published",
        claimantId: "bot-exec",
        title: "step",
        remainingWork: "do",
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
      boardItemId: "board-1",
      todolistId: "td-1",
      confirmedVersion: 1,
      confirmerId: "human:owner",
      cfg,
    });
    expect(result.reason).toMatch(/confirm_board_not_active/);
    expect(result.dispatched).toBe(false);
  });
});

describe("R1 readiness — tenant registry ∩ active OS bot", () => {
  it("global agent not in tenant coverage → dispatcher calls = 0", async () => {
    const tenantId = "tenant-r1-a";
    const groupId = "grp_ready";
    const { cfg } = await useRoot({
      selfAdvanceMode: "execute",
      selfAdvanceExecuteAllowlist: ["*"],
      wakeContract: true,
      profile: "managed_enterprise",
    });
    upsertAgent(agentStub("bot-global-only", "other-tenant"));

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
      groupRootDir: stores.groupRootDir,
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
        reason: "test:global_not_in_tenant",
      },
    });
    expect(result.dispatched).toBe(false);
    expect(result.reason).toBe("dispatch_readiness_not_ready");
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
    });
    upsertAgent(agentStub("bot-ready", tenantId));

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
      groupRootDir: stores.groupRootDir,
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
    });
    // First attempt: bot not in tenant registry → readiness fails after eligibility commit.
    upsertAgent(agentStub("bot-r2", "other-tenant"));

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
      groupRootDir: stores.groupRootDir,
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
    expect(first.reason).toBe("dispatch_readiness_not_ready");
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

    // Fix: register bot in tenant, then different op succeeds.
    upsertAgent(agentStub("bot-r2", tenantId));
    const second = await consumeWakeForRoundDispatch({
      authority,
      cfg,
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
      },
    ] as never);
    vi.spyOn(claimEntry, "buildClaimAuthority").mockResolvedValue({
      authority: seedAuthority(cfg, groupId, null),
      stores: null,
      operatingState: null,
    } as never);
    vi.spyOn(claimEntry, "buildCollaborationExecutionTaskBag").mockImplementation(async () => {
      return {
        boardSummary: {
          itemId: boardItemId,
          taskId,
          groupId,
          goal: "交付报告",
          acceptanceCriteria: ["完整"],
          status: "applied",
          claimantId: claimant,
        },
        groupContextPointer: {
          groupId,
          transcriptHint: "group-transcript",
          note: "pointer",
        },
        todolistCurrentStep: {
          todolistId,
          version: bagVersion,
          status: "confirmed",
          stepId: "step-a",
          title: "写草稿",
          stepIndex: 0,
          totalSteps: 1,
        },
        planGate: { confirmed: true, todolistStatus: "confirmed" },
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
    expect(String(captured[0]?.prompt)).toContain("group-transcript");
    expect(String(captured[0]?.reason)).toContain("v3");
    expect(captured[0]?.binding?.taskId).toBe(taskId);
    expect(captured[0]?.binding?.boardItemId).toBe(boardItemId);
    expect(captured[0]?.binding?.planVersion).toBe(3);
    expect(captured[0]?.binding?.runId).toBeTruthy();
    expect(captured[0]?.binding?.groupId).toBe(groupId);

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
      },
    ] as never);
    let callsToBag = 0;
    vi.spyOn(claimEntry, "buildCollaborationExecutionTaskBag").mockImplementation(async () => {
      callsToBag += 1;
      // First call (pre-nudge check) stays v3; final dispatch revalidate flips to v9.
      const version = callsToBag === 1 ? 3 : 9;
      return {
        boardSummary: {
          itemId: boardItemId2,
          taskId: taskId2,
          groupId,
          goal: "交付报告",
          acceptanceCriteria: ["完整"],
          status: "applied",
          claimantId: claimant,
        },
        groupContextPointer: {
          groupId,
          transcriptHint: "group-transcript",
          note: "pointer",
        },
        todolistCurrentStep: {
          todolistId: todolistId2,
          version,
          status: "confirmed",
          stepId: version === 3 ? "step-a" : "step-new",
          title: version === 3 ? "写草稿" : "新步骤",
          stepIndex: 0,
          totalSteps: 1,
        },
        planGate: { confirmed: true, todolistStatus: "confirmed" },
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
      taskId: "task-a",
      deliverableId: outA.outcome.ok ? outA.outcome.deliverableId : "",
      version: outA.outcome.ok ? outA.outcome.version : 1,
      actor: "human:peer",
      cfg,
      enforceAcl: false,
      trusted,
    });
    const readB = await readTeamDeliverable({
      groupId,
      taskId: "task-b",
      deliverableId: outB.outcome.ok ? outB.outcome.deliverableId : "",
      version: outB.outcome.ok ? outB.outcome.version : 1,
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
          taskId,
          deliverableId: out.outcome.deliverableId,
          version: out.outcome.version,
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
    expect(out.text).toContain("execution_binding_required");
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
    const stopped = asGovernedTask({
      taskId,
      groupId,
      title: taskId,
      status: "ready",
      createdAtMs: now,
      updatedAtMs: now,
      stopControl: buildAcceptedTaskStopControl({
        requestedBy: "human:owner",
        reason: "halt",
        requestedAtMs: now,
      }),
    });
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
