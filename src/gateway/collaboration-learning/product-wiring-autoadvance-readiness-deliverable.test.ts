/**
 * #129 R1 product wiring — call-chain coverage for review gaps.
 * Not F4 / not 18789 cutover. Identity may still be mocked at ACL edges;
 * submit pipeline below is non-mock.
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
  formatTeamDeliverableUserMessage,
  maybeSubmitTeamDeliverableFromChatFinal,
} from "./chat-deliverable-team-submit.js";
import * as claimEntry from "./claim-contract-entry.js";
import { triggerPostPlanConfirmAdvance } from "./post-plan-confirm-advance.js";
import { resolveActorDeliverableTaskBinding } from "./resolve-actor-deliverable-task.js";
import { writeGroupOperatingState } from "./shared.js";
import { readTeamDeliverable, submitTeamDeliverable } from "./team-deliverable-submit.js";
import { createTrustedGroupStores } from "./team-resource-auth.js";

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;

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
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

function baseCfg(
  root: string,
  over?: {
    selfAdvanceMode?: "dry_run" | "execute";
    selfAdvanceExecuteAllowlist?: string[];
    wakeContract?: boolean;
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
        wakeContractGroupAllowlist: ["*"],
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
      expect(r.reason).toBe("deliverable_binary_requires_file_bytes");
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
      expect(binding.reason).toMatch(/no_active_claim/);
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
      planGate: { confirmed: true },
      todolistCurrentStep: { todolistId: "td-1", version: 3, stepId: "step-a" },
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
      planGate: { confirmed: true },
      todolistCurrentStep: { todolistId: "td-1", version: 9, stepId: "step-new" },
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
