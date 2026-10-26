/**
 * WL2 (CAP-03/04) execution-evidence bindings for PR #80 work line 2 + U1 stop.
 *
 * PASS rows map to enforced behavior. U3 IDEMPOTENT/RESUME forced in this file.
 * Do not delete L3 stop/resume adapters.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, test } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { makeOperatingState } from "../collaboration-dispatch/__fixtures__/policy-source-matrix.js";
import { episodeIdForClientRun } from "../collaboration-dispatch/collaboration-event-key.js";
import { runDeliveryToolSideEffect } from "../collaboration-dispatch/delivery-tool-side-effect.js";
import { resolveGroupPolicyInput } from "../collaboration-dispatch/resolve-effective-policy.js";
import {
  createRoundPolicySnapshot,
  generatePolicySnapshotId,
} from "../collaboration-dispatch/round-policy-snapshot.js";
import { createRuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import { recheckCurrentDispatchAuthorization } from "../collaboration-dispatch/task-dispatch-auth-recheck.js";
import {
  claimWakeOpRunning,
  confirmWakeOpCompleted,
  markWakeOpUnknown,
  readWakeOpRecord,
  releaseWakeOpForRetry,
  wakeOpIdempotencyKey,
} from "../collaboration-dispatch/wake-op-ledger.js";
import { consumeWakeForRoundDispatch } from "../collaboration-dispatch/wake-round-dispatch.js";
import { resolveSecurityProfile } from "../security-profile.js";
import { markCollaborationBoardItemInProgress } from "./claim-contract-entry.js";
import { bindDeliveryActor, isMappedDeliveryIdentity } from "./delivery-actor-binding.js";
import {
  acceptCollaborationTaskHandoffContract,
  applyCollaborationTaskHandoffContract,
  approveCollaborationTaskHandoffContract,
  proposeCollaborationTaskHandoffContract,
} from "./handoff-contract-entry.js";
import { SELF_ADVANCE_ENTRY_DELEGATES_UNIFIED_GATE } from "./self-advance-entry.js";
import { createWorkspaceCollaborationStores, writeGroupOperatingState } from "./shared.js";
import { resolveCollaborationGroupTenantId } from "./shared.js";
import {
  canRequestTaskStop,
  requestCollaborationTaskStop,
  TaskStopEntryError,
  TaskStoppedError,
} from "./task-stop-entry.js";
import { resolveAuthorityTenantForEntry } from "./trusted-tenant.js";
import { WAKE_CONTRACT_ENTRY_READ_PATHS_DO_NOT_WRITE } from "./wake-contract-entry.js";

const tempDirs: string[] = [];
const savedEnv = {
  OPENBOT_STATE_DIR: process.env.OPENBOT_STATE_DIR,
  OPENBOT_CONFIG_PATH: process.env.OPENBOT_CONFIG_PATH,
  OPENCLAW_CONFIG_PATH: process.env.OPENCLAW_CONFIG_PATH,
  OPENBOT_SECURITY_PROFILE: process.env.OPENBOT_SECURITY_PROFILE,
  OPENCLAW_SECURITY_PROFILE: process.env.OPENCLAW_SECURITY_PROFILE,
  OPENBOT_TENANTS_ROOT: process.env.OPENBOT_TENANTS_ROOT,
};

afterEach(async () => {
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function useIsolationRoot(
  opts: {
    handoffContract?: boolean;
    claimContract?: boolean;
    wakeContract?: boolean;
  } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-wl2-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = root;
  process.env.OPENBOT_TENANTS_ROOT = path.join(root, "tenants");
  const configPath = path.join(root, "openbot.json");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  process.env.OPENBOT_SECURITY_PROFILE = "local";
  process.env.OPENCLAW_SECURITY_PROFILE = "local";
  const cfg = {
    collaboration: {
      task: {
        handoffContract: opts.handoffContract ?? true,
        claimContract: opts.claimContract ?? true,
        wakeContract: opts.wakeContract ?? false,
        selfAdvance: {
          mode: "execute",
          executeGroupAllowlist: [],
        },
      },
    },
  } as OpenBotConfig;
  await fs.writeFile(configPath, JSON.stringify(cfg, null, 2), "utf8");
  setRuntimeConfigSnapshot(cfg);
  clearConfigCache();
  return { root, cfg };
}

const tenant = {
  tenantId: "tenant-wl2-a",
  groupId: "grp-wl2-a",
  employees: [{ id: "tenant-wl2-a/emp-owner" }],
  bots: [{ id: "tenant-wl2-a/bot-coord" }, { id: "tenant-wl2-a/bot-exec" }],
};

async function seedTask(params: { cfg: OpenBotConfig; taskId: string; groupId?: string }): Promise<{
  objectStorage: ReturnType<typeof createWorkspaceCollaborationStores>["objectStorage"];
}> {
  const groupId = params.groupId ?? tenant.groupId;
  const { objectStorage, fileStore } = createWorkspaceCollaborationStores(params.cfg);
  const state = makeOperatingState({
    groupId,
    governance: { coordinatorBotId: tenant.bots[0].id, ownerUserId: tenant.employees[0].id },
  });
  state.memberRoleMap = [
    {
      memberId: tenant.employees[0].id,
      memberKind: "human",
      governanceRole: "owner",
      collaborationRole: null,
      status: "active",
    },
    {
      memberId: tenant.bots[0].id,
      memberKind: "bot",
      governanceRole: "member",
      collaborationRole: null,
      status: "active",
    },
    {
      memberId: tenant.bots[1].id,
      memberKind: "bot",
      governanceRole: "member",
      collaborationRole: null,
      status: "active",
    },
  ];
  state.activeContext = {
    ...state.activeContext,
    currentTaskId: params.taskId,
  };
  await writeGroupOperatingState({ fileStore, groupId, state });
  await objectStorage.writeObject(groupId, "task", params.taskId, {
    taskId: params.taskId,
    groupId,
    title: "wl2-stop",
    status: "in_progress",
    ownerMemberId: tenant.bots[0].id,
    assignedMemberIds: [tenant.bots[0].id],
    responsibility: {
      owner: tenant.bots[0].id,
      executors: [tenant.bots[0].id],
      reviewers: [],
      approvers: [tenant.employees[0].id],
    },
    createdAtMs: 1,
    updatedAtMs: 1,
  } as Task);
  return { objectStorage };
}

describe("WL2 CAP-03/04 evidence bindings", () => {
  test("WL2-REVOKE-ACTION-01: revoke-before-submit blocks privileged bind (T-E5(1))", () => {
    const active = {
      governance: { coordinatorBotId: tenant.bots[0].id },
      memberRoleMap: [{ memberId: tenant.employees[0].id }],
    };
    expect(isMappedDeliveryIdentity(active, tenant.employees[0].id)).toBe(true);

    const revoked = {
      governance: { coordinatorBotId: tenant.bots[0].id },
      memberRoleMap: [] as Array<{ memberId: string }>,
    };
    expect(isMappedDeliveryIdentity(revoked, tenant.employees[0].id)).toBe(false);
    const rebound = bindDeliveryActor({
      claimedId: tenant.employees[0].id,
      subjects: ["session-other"],
      privileged: false,
    });
    expect(rebound).toBe("session-other");
  });

  test("WL2-UNKNOWN-NO-RETRY-01: already-applied handoff must not blind-retry mutate (T-E5(2)/(3))", async () => {
    const { cfg } = await useIsolationRoot({ handoffContract: true });
    const groupId = tenant.groupId;
    const taskId = "task-wl2-unknown";
    await seedTask({ cfg, taskId, groupId });
    const { objectStorage } = createWorkspaceCollaborationStores(cfg);

    const proposed = await proposeCollaborationTaskHandoffContract({
      groupId,
      taskId,
      from: tenant.bots[0].id,
      to: tenant.bots[1].id,
      kind: "owner_transfer",
      remainingWork: "x",
      acceptanceCriteria: ["y"],
      completedArtifacts: [],
      actor: tenant.bots[0].id,
      cfg,
    });
    await acceptCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: proposed.handoffId,
      actor: tenant.bots[1].id,
      actorType: "bot",
      cfg,
    });
    await approveCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: proposed.handoffId,
      actor: tenant.employees[0].id,
      actorType: "human",
      cfg,
    });
    const applied = await applyCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: proposed.handoffId,
      actor: tenant.employees[0].id,
      cfg,
    });
    expect(applied.responsibility?.owner).toBe(tenant.bots[1].id);

    await expect(
      applyCollaborationTaskHandoffContract({
        groupId,
        taskId,
        handoffId: proposed.handoffId,
        actor: tenant.employees[0].id,
        cfg,
      }),
    ).rejects.toThrow();

    const persisted = await objectStorage.readObject<Task>(groupId, "task", taskId);
    expect(persisted?.responsibility?.owner).toBe(tenant.bots[1].id);
  });

  test("L3 adapters retained: self-advance/wake entry markers (do not delete stop/resume path)", () => {
    expect(SELF_ADVANCE_ENTRY_DELEGATES_UNIFIED_GATE).toBe(true);
    expect(WAKE_CONTRACT_ENTRY_READ_PATHS_DO_NOT_WRITE).toBe(true);
  });

  test("platform inventory: collaboration.task.stop RPC registered (U1)", async () => {
    const listPath = path.join(process.cwd(), "src/gateway/server-methods-list.ts");
    const text = await fs.readFile(listPath, "utf8");
    expect(text).toMatch(/"collaboration\.task\.stop"/);
    expect(text).not.toMatch(/"collaboration\.task\.pause"/);
    expect(text).not.toMatch(/"collaboration\.task\.resume"/);
  });

  test("WL2-STOP-RPC-01: after collaboration stop RPC, handoff writes refuse", async () => {
    const { cfg } = await useIsolationRoot({ handoffContract: true });
    const groupId = tenant.groupId;
    const taskId = "task-wl2-stop-rpc";
    const { objectStorage } = await seedTask({ cfg, taskId, groupId });

    const stopped = await requestCollaborationTaskStop({
      groupId,
      taskId,
      actor: tenant.employees[0].id,
      reason: "u1-stop-rpc",
      externalEffect: "none",
      cfg,
    });
    expect(stopped.stopControl.status).toBe("accepted");
    expect(stopped.alreadyStopped).toBe(false);

    const before = await objectStorage.readObject<Task & { stopControl?: unknown }>(
      groupId,
      "task",
      taskId,
    );
    expect(before?.stopControl).toBeTruthy();

    await expect(
      proposeCollaborationTaskHandoffContract({
        groupId,
        taskId,
        from: tenant.bots[0].id,
        to: tenant.bots[1].id,
        kind: "owner_transfer",
        remainingWork: "x",
        acceptanceCriteria: ["y"],
        actor: tenant.bots[0].id,
        cfg,
      }),
    ).rejects.toBeInstanceOf(TaskStoppedError);

    const after = await objectStorage.readObject<Task & { responsibility?: { owner?: string } }>(
      groupId,
      "task",
      taskId,
    );
    expect(after?.responsibility?.owner).toBe(tenant.bots[0].id);
  });

  test("WL2-STOP-TOOL-01: board write path refuses after stop; reads remain callable", async () => {
    const { cfg } = await useIsolationRoot({ claimContract: true });
    const groupId = tenant.groupId;
    const taskId = "task-wl2-stop-tool";
    await seedTask({ cfg, taskId, groupId });
    await requestCollaborationTaskStop({
      groupId,
      taskId,
      actor: tenant.employees[0].id,
      reason: "u1-stop-tool",
      externalEffect: "none",
      cfg,
    });

    await expect(
      markCollaborationBoardItemInProgress({
        groupId,
        taskId,
        itemId: "item-missing",
        actor: tenant.bots[0].id,
        cfg,
      }),
    ).rejects.toBeInstanceOf(TaskStoppedError);
  });

  test("WL2-STOP-QUEUE-01: queued side-effect schedule skips when task stopped", async () => {
    const { cfg, root } = await useIsolationRoot();
    const groupId = tenant.groupId;
    const taskId = "task-wl2-stop-queue";
    await seedTask({ cfg, taskId, groupId });
    await requestCollaborationTaskStop({
      groupId,
      taskId,
      actor: tenant.employees[0].id,
      reason: "u1-stop-queue",
      externalEffect: "none",
      cfg,
    });

    let ran = 0;
    const result = await runDeliveryToolSideEffect({
      schedule: {
        ledgerDir: path.join(root, "tool-side-effects"),
        taskId,
        boardItemId: "item-1",
        stepId: "step-1",
      },
      toolName: "message",
      groupId,
      cfg,
      run: async () => {
        ran += 1;
        return "ok";
      },
    });
    expect(result.skipped).toBe(true);
    expect(ran).toBe(0);
  });

  test("WL2-STOP-HB-01 / WL2-STOP-WAKE-01: wake consume after stop does not dispatch", async () => {
    const { cfg } = await useIsolationRoot();
    const groupId = tenant.groupId;
    const taskId = "task-wl2-stop-wake";
    await seedTask({ cfg, taskId, groupId });
    await requestCollaborationTaskStop({
      groupId,
      taskId,
      actor: tenant.employees[0].id,
      reason: "u1-stop-wake",
      externalEffect: "none",
      cfg,
    });

    const { fileStore } = createWorkspaceCollaborationStores(cfg);
    const operatingState = makeOperatingState({
      groupId,
      governance: { coordinatorBotId: tenant.bots[0].id, ownerUserId: tenant.employees[0].id },
    });
    const now = Date.now();
    const snapshot = createRoundPolicySnapshot(resolveGroupPolicyInput({ operatingState }), {
      now,
      idGen: () => generatePolicySnapshotId(now),
    });
    const authority = createRuntimeAuthority({
      snapshot,
      episodeId: episodeIdForClientRun(`task-wake:${groupId}:${taskId}`),
      tenant: resolveAuthorityTenantForEntry({
        preferred: null,
        groupTenantId: resolveCollaborationGroupTenantId(groupId),
      }),
      groupId,
      profile: resolveSecurityProfile(cfg).profile,
      cfg,
    });

    let dispatchedCalls = 0;
    const consume = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        dispatchedCalls += 1;
        return { ok: true, roundId: "round-should-not" };
      },
      request: {
        groupId,
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [tenant.bots[0].id],
        source: "nudge",
        taskId,
        itemId: "item-1",
        reason: "hb-after-stop",
      },
    });

    expect(consume.dispatched).toBe(false);
    expect(consume.reason).toBe("task_stopped");
    expect(consume.wakeEvent).toBeUndefined();
    expect(dispatchedCalls).toBe(0);
    void fileStore;
  });

  test("U1-BOUND-AUTH-01: owner may stop; same-tenant member and cross-tenant cannot; reject leaves stopControl unchanged", async () => {
    const { cfg } = await useIsolationRoot();
    const groupId = tenant.groupId;
    const taskId = "task-u1-bound-auth";
    const { objectStorage, fileStore } = createWorkspaceCollaborationStores(cfg);
    await seedTask({ cfg, taskId, groupId });

    // Seed an unauthorized same-tenant member (mapped, not owner/admin/coordinator).
    const state = makeOperatingState({
      groupId,
      governance: { coordinatorBotId: tenant.bots[0].id, ownerUserId: tenant.employees[0].id },
    });
    const memberEmp = "tenant-wl2-a/emp-member";
    const crossTenantEmp = "tenant-wl2-b/emp-owner";
    state.memberRoleMap = [
      {
        memberId: tenant.employees[0].id,
        memberKind: "human",
        governanceRole: "owner",
        collaborationRole: null,
        status: "active",
      },
      {
        memberId: memberEmp,
        memberKind: "human",
        governanceRole: "member",
        collaborationRole: null,
        status: "active",
      },
      {
        memberId: tenant.bots[0].id,
        memberKind: "bot",
        governanceRole: "member",
        collaborationRole: null,
        status: "active",
      },
    ];
    await writeGroupOperatingState({ fileStore, groupId, state });

    expect(canRequestTaskStop({ actorId: tenant.employees[0].id, operatingState: state })).toBe(
      true,
    );
    expect(canRequestTaskStop({ actorId: memberEmp, operatingState: state })).toBe(false);
    expect(canRequestTaskStop({ actorId: crossTenantEmp, operatingState: state })).toBe(false);

    const before = await objectStorage.readObject<Task & { stopControl?: unknown }>(
      groupId,
      "task",
      taskId,
    );
    expect(before?.stopControl).toBeFalsy();

    await expect(
      requestCollaborationTaskStop({
        groupId,
        taskId,
        actor: memberEmp,
        reason: "should-fail-member",
        cfg,
      }),
    ).rejects.toBeInstanceOf(TaskStopEntryError);

    await expect(
      requestCollaborationTaskStop({
        groupId,
        taskId,
        actor: crossTenantEmp,
        reason: "should-fail-cross-tenant",
        cfg,
      }),
    ).rejects.toBeInstanceOf(TaskStopEntryError);

    const afterDeny = await objectStorage.readObject<Task & { stopControl?: unknown }>(
      groupId,
      "task",
      taskId,
    );
    expect(afterDeny?.stopControl).toBeFalsy();

    const ok = await requestCollaborationTaskStop({
      groupId,
      taskId,
      actor: tenant.employees[0].id,
      reason: "owner-ok",
      externalEffect: "none",
      cfg,
    });
    expect(ok.stopControl.status).toBe("accepted");
    expect(ok.stopControl.requestedBy).toBe(tenant.employees[0].id);
  });

  test("U1-BOUND-PERSIST-01: restart readback + repeat stop + repeat wake remain stopped; no silent clear", async () => {
    const { cfg } = await useIsolationRoot();
    const groupId = tenant.groupId;
    const taskId = "task-u1-bound-persist";
    await seedTask({ cfg, taskId, groupId });

    const first = await requestCollaborationTaskStop({
      groupId,
      taskId,
      actor: tenant.employees[0].id,
      reason: "persist",
      externalEffect: "none",
      inFlightAbort: "best_effort",
      cfg,
      nowMs: 1_700_000_000_000,
    });
    expect(first.alreadyStopped).toBe(false);
    expect(first.stopControl.inFlightAbort).toBe("best_effort");

    // Simulate restart: new store handles, re-read task.
    const { objectStorage } = createWorkspaceCollaborationStores(cfg);
    const reloaded = await objectStorage.readObject<Task & { stopControl?: { status?: string } }>(
      groupId,
      "task",
      taskId,
    );
    expect(reloaded?.stopControl?.status).toBe("accepted");

    const repeat = await requestCollaborationTaskStop({
      groupId,
      taskId,
      actor: tenant.employees[0].id,
      reason: "repeat",
      cfg,
    });
    expect(repeat.alreadyStopped).toBe(true);
    expect(repeat.stopControl.requestedAtMs).toBe(first.stopControl.requestedAtMs);

    const { fileStore } = createWorkspaceCollaborationStores(cfg);
    const operatingState = makeOperatingState({
      groupId,
      governance: { coordinatorBotId: tenant.bots[0].id, ownerUserId: tenant.employees[0].id },
    });
    const now = Date.now();
    const snapshot = createRoundPolicySnapshot(resolveGroupPolicyInput({ operatingState }), {
      now,
      idGen: () => generatePolicySnapshotId(now),
    });
    const authority = createRuntimeAuthority({
      snapshot,
      episodeId: episodeIdForClientRun(`task-wake:${groupId}:${taskId}`),
      tenant: resolveAuthorityTenantForEntry({
        preferred: null,
        groupTenantId: resolveCollaborationGroupTenantId(groupId),
      }),
      groupId,
      profile: resolveSecurityProfile(cfg).profile,
      cfg,
    });

    for (let i = 0; i < 2; i += 1) {
      let dispatchedCalls = 0;
      const consume = await consumeWakeForRoundDispatch({
        authority,
        cfg,
        writeMode: "execute",
        roundDispatcher: async () => {
          dispatchedCalls += 1;
          return { ok: true, roundId: `round-${i}` };
        },
        request: {
          groupId,
          fromAgentId: "system:group_task_heartbeat",
          toAgentIds: [tenant.bots[0].id],
          source: "nudge",
          taskId,
          itemId: "item-persist",
          reason: `wake-repeat-${i}`,
        },
      });
      expect(consume.dispatched).toBe(false);
      expect(consume.reason).toBe("task_stopped");
      expect(consume.wakeEvent).toBeUndefined();
      expect(dispatchedCalls).toBe(0);
      // Honesty: dispatched=false proves this wake did not dispatch — not that prior in-flight ended.
      expect(!consume.dispatched && consume.reason === "task_stopped").toBe(true);
    }
    void fileStore;
  });

  test("U1-BOUND-RACE-01: stop after queue / before dispatch skips side-effect; in-flight fields are request-level", async () => {
    const { cfg, root } = await useIsolationRoot();
    const groupId = tenant.groupId;
    const taskId = "task-u1-bound-race";
    await seedTask({ cfg, taskId, groupId });

    // Queue-shaped schedule exists first; stop lands before runDeliveryToolSideEffect dispatch.
    const schedule = {
      ledgerDir: path.join(root, "tool-side-effects-race"),
      taskId,
      boardItemId: "item-race",
      stepId: "step-race",
    };
    const stopped = await requestCollaborationTaskStop({
      groupId,
      taskId,
      actor: tenant.employees[0].id,
      reason: "race-after-queue",
      // Default path: in-flight abort requested; external effect uncertain without receipt.
      cfg,
    });
    expect(stopped.stopControl.status).toBe("accepted");
    expect(stopped.stopControl.inFlightAbort).toBe("best_effort");
    expect(stopped.stopControl.externalEffect).toBe("unknown");

    let ran = 0;
    const result = await runDeliveryToolSideEffect({
      schedule,
      toolName: "message",
      groupId,
      cfg,
      run: async () => {
        ran += 1;
        return "should-not";
      },
    });
    expect(result.skipped).toBe(true);
    expect(ran).toBe(0);
  });

  test("U1-BOUND-ENTRIES-01: five real entry functions (not five assertTaskNotStopped-only calls)", async () => {
    // Inventory: each production entry names the shared guard / stop API.
    const files: Array<{ file: string; mustMatch: RegExp; entry: string }> = [
      {
        file: "src/gateway/server-methods/collaboration-learning.ts",
        mustMatch: /"collaboration\.task\.stop"[\s\S]*requestCollaborationTaskStop/,
        entry: "RPC handler → requestCollaborationTaskStop",
      },
      {
        file: "src/agents/tools/collaboration-board-tool.ts",
        mustMatch: /assertPersistedTaskNotStopped/,
        entry: "board tool write → assertPersistedTaskNotStopped",
      },
      {
        file: "src/gateway/collaboration-dispatch/delivery-tool-side-effect.ts",
        mustMatch: /isTaskStopAccepted/,
        entry: "queue side-effect → isTaskStopAccepted",
      },
      {
        file: "src/gateway/collaboration-dispatch/group-task-heartbeat.ts",
        mustMatch: /isPersistedTaskStopped|isTaskStopAccepted/,
        entry: "HB → isPersistedTaskStopped / isTaskStopAccepted",
      },
      {
        file: "src/gateway/collaboration-dispatch/wake-round-dispatch.ts",
        mustMatch: /isTaskStopAccepted[\s\S]*task_stopped/,
        entry: "WAKE consumeWakeForRoundDispatch → isTaskStopAccepted",
      },
    ];
    for (const row of files) {
      const textFile = await fs.readFile(path.join(process.cwd(), row.file), "utf8");
      expect(textFile, row.entry).toMatch(row.mustMatch);
    }

    // Behavioral: exercise four distinct production entry functions + stop entry (RPC production fn).
    const { cfg, root } = await useIsolationRoot({ handoffContract: true, claimContract: true });
    const groupId = tenant.groupId;
    const taskId = "task-u1-bound-entries";
    await seedTask({ cfg, taskId, groupId });
    await requestCollaborationTaskStop({
      groupId,
      taskId,
      actor: tenant.employees[0].id,
      reason: "entries",
      externalEffect: "none",
      cfg,
    });

    await expect(
      proposeCollaborationTaskHandoffContract({
        groupId,
        taskId,
        from: tenant.bots[0].id,
        to: tenant.bots[1].id,
        kind: "owner_transfer",
        remainingWork: "x",
        acceptanceCriteria: ["y"],
        actor: tenant.bots[0].id,
        cfg,
      }),
    ).rejects.toBeInstanceOf(TaskStoppedError);

    await expect(
      markCollaborationBoardItemInProgress({
        groupId,
        taskId,
        itemId: "item-missing",
        actor: tenant.bots[0].id,
        cfg,
      }),
    ).rejects.toBeInstanceOf(TaskStoppedError);

    let ran = 0;
    const queue = await runDeliveryToolSideEffect({
      schedule: {
        ledgerDir: path.join(root, "tool-side-effects-entries"),
        taskId,
        boardItemId: "item-e",
        stepId: "step-e",
      },
      toolName: "message",
      groupId,
      cfg,
      run: async () => {
        ran += 1;
        return "x";
      },
    });
    expect(queue.skipped).toBe(true);
    expect(ran).toBe(0);

    const operatingState = makeOperatingState({
      groupId,
      governance: { coordinatorBotId: tenant.bots[0].id, ownerUserId: tenant.employees[0].id },
    });
    const now = Date.now();
    const snapshot = createRoundPolicySnapshot(resolveGroupPolicyInput({ operatingState }), {
      now,
      idGen: () => generatePolicySnapshotId(now),
    });
    const authority = createRuntimeAuthority({
      snapshot,
      episodeId: episodeIdForClientRun(`task-wake:${groupId}:${taskId}`),
      tenant: resolveAuthorityTenantForEntry({
        preferred: null,
        groupTenantId: resolveCollaborationGroupTenantId(groupId),
      }),
      groupId,
      profile: resolveSecurityProfile(cfg).profile,
      cfg,
    });
    let dispatchedCalls = 0;
    const wake = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        dispatchedCalls += 1;
        return { ok: true, roundId: "nope" };
      },
      request: {
        groupId,
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [tenant.bots[0].id],
        source: "nudge",
        taskId,
        itemId: "item-e",
        reason: "entries-wake",
      },
    });
    expect(wake.reason).toBe("task_stopped");
    expect(wake.dispatched).toBe(false);
    expect(dispatchedCalls).toBe(0);
  });

  test("U1-BOUND-POSITIVE-01: without stop + valid auth, handoff propose and wake dispatch still advance", async () => {
    const { cfg } = await useIsolationRoot({ handoffContract: true, wakeContract: true });
    const groupId = tenant.groupId;
    const taskId = "task-u1-bound-positive";
    await seedTask({ cfg, taskId, groupId });

    const proposed = await proposeCollaborationTaskHandoffContract({
      groupId,
      taskId,
      from: tenant.bots[0].id,
      to: tenant.bots[1].id,
      kind: "owner_transfer",
      remainingWork: "x",
      acceptanceCriteria: ["y"],
      actor: tenant.bots[0].id,
      cfg,
    });
    expect(proposed.handoffId).toBeTruthy();

    const operatingState = makeOperatingState({
      groupId,
      governance: { coordinatorBotId: tenant.bots[0].id, ownerUserId: tenant.employees[0].id },
    });
    // Keep membership so U2 auth recheck passes.
    const { fileStore } = createWorkspaceCollaborationStores(cfg);
    operatingState.memberRoleMap = [
      {
        memberId: tenant.employees[0].id,
        memberKind: "human",
        governanceRole: "owner",
        collaborationRole: null,
        status: "active",
      },
      {
        memberId: tenant.bots[0].id,
        memberKind: "bot",
        governanceRole: "member",
        collaborationRole: null,
        status: "active",
      },
      {
        memberId: tenant.bots[1].id,
        memberKind: "bot",
        governanceRole: "member",
        collaborationRole: null,
        status: "active",
      },
    ];
    await writeGroupOperatingState({ fileStore, groupId, state: operatingState });

    const now = Date.now();
    const snapshot = createRoundPolicySnapshot(resolveGroupPolicyInput({ operatingState }), {
      now,
      idGen: () => generatePolicySnapshotId(now),
    });
    const authority = createRuntimeAuthority({
      snapshot,
      episodeId: episodeIdForClientRun(`task-wake:${groupId}:${taskId}`),
      tenant: resolveAuthorityTenantForEntry({
        preferred: null,
        groupTenantId: resolveCollaborationGroupTenantId(groupId),
      }),
      groupId,
      profile: resolveSecurityProfile(cfg).profile,
      cfg,
    });
    let dispatchedCalls = 0;
    const wake = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        dispatchedCalls += 1;
        return { ok: true, roundId: "round-positive" };
      },
      request: {
        groupId,
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [tenant.bots[0].id],
        source: "nudge",
        taskId,
        itemId: "item-pos",
        reason: "positive",
      },
    });
    expect(wake.reason).not.toBe("task_stopped");
    expect(wake.reason).not.toBe("auth_revoked");
    expect(dispatchedCalls).toBe(1);
    expect(wake.dispatched).toBe(true);
  });

  test("WL2-REVOKE-WAKE-01: revoke membership after accept/approve queue; wake consume refuses with 0 writes", async () => {
    const { cfg } = await useIsolationRoot({ handoffContract: true });
    const groupId = tenant.groupId;
    const taskId = "task-wl2-revoke-wake";
    const { objectStorage, fileStore } = createWorkspaceCollaborationStores(cfg);
    await seedTask({ cfg, taskId, groupId });

    const proposed = await proposeCollaborationTaskHandoffContract({
      groupId,
      taskId,
      from: tenant.bots[0].id,
      to: tenant.bots[1].id,
      kind: "owner_transfer",
      remainingWork: "x",
      acceptanceCriteria: ["y"],
      actor: tenant.bots[0].id,
      cfg,
    });
    await acceptCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: proposed.handoffId,
      actor: tenant.bots[1].id,
      actorType: "bot",
      cfg,
    });
    await approveCollaborationTaskHandoffContract({
      groupId,
      taskId,
      handoffId: proposed.handoffId,
      actor: tenant.employees[0].id,
      actorType: "human",
      cfg,
    });

    // Fail repro shape: queue-time authority was valid; revoke membership before wake consume.
    const revoked = makeOperatingState({
      groupId,
      governance: { coordinatorBotId: tenant.bots[0].id, ownerUserId: tenant.employees[0].id },
    });
    revoked.memberRoleMap = []; // strip all mapped members (coordinator still mapped via governance)
    // Also clear coordinator so bot-exec / bot-coord duty targets fail recheck.
    revoked.governance = { ownerUserId: tenant.employees[0].id, coordinatorBotId: "" };
    await writeGroupOperatingState({ fileStore, groupId, state: revoked });

    const auth = await recheckCurrentDispatchAuthorization({
      groupId,
      taskId,
      targetActorIds: [tenant.bots[0].id, tenant.bots[1].id],
      cfg,
    });
    expect(auth.ok).toBe(false);

    const now = Date.now();
    const snapshot = createRoundPolicySnapshot(
      resolveGroupPolicyInput({ operatingState: revoked }),
      {
        now,
        idGen: () => generatePolicySnapshotId(now),
      },
    );
    const authority = createRuntimeAuthority({
      snapshot,
      episodeId: episodeIdForClientRun(`task-wake:${groupId}:${taskId}`),
      tenant: resolveAuthorityTenantForEntry({
        preferred: null,
        groupTenantId: resolveCollaborationGroupTenantId(groupId),
      }),
      groupId,
      profile: resolveSecurityProfile(cfg).profile,
      cfg,
    });

    let dispatchedCalls = 0;
    let wakeWrites = 0;
    const consume = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        dispatchedCalls += 1;
        return { ok: true, roundId: "should-not-dispatch" };
      },
      request: {
        groupId,
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [tenant.bots[0].id],
        source: "nudge",
        taskId,
        itemId: "item-revoke",
        reason: "revoke-wake",
      },
    });
    if (consume.wakeEvent) {
      wakeWrites += 1;
    }
    expect(consume.dispatched).toBe(false);
    expect(consume.reason).toBe("auth_revoked");
    expect(consume.wakeEvent).toBeUndefined();
    expect(dispatchedCalls).toBe(0);
    expect(wakeWrites).toBe(0);

    // Task responsibility unchanged (no apply after revoke path).
    const task = await objectStorage.readObject<Task>(groupId, "task", taskId);
    expect(task?.responsibility?.owner).toBe(tenant.bots[0].id);
  });

  test("WL2-REVOKE-HB-01: heartbeat path revoke race same T-E5判定点 as wake", async () => {
    const { cfg } = await useIsolationRoot();
    const groupId = tenant.groupId;
    const taskId = "task-wl2-revoke-hb";
    const { fileStore } = createWorkspaceCollaborationStores(cfg);
    await seedTask({ cfg, taskId, groupId });

    // Revoke membership / coordinator so HB nudge targets fail the shared auth recheck.
    const revoked = makeOperatingState({
      groupId,
      governance: { ownerUserId: tenant.employees[0].id, coordinatorBotId: "" },
    });
    revoked.memberRoleMap = [];
    await writeGroupOperatingState({ fileStore, groupId, state: revoked });

    const auth = await recheckCurrentDispatchAuthorization({
      groupId,
      taskId,
      targetActorIds: [tenant.bots[0].id],
      cfg,
    });
    expect(auth.ok).toBe(false);

    const now = Date.now();
    const snapshot = createRoundPolicySnapshot(
      resolveGroupPolicyInput({ operatingState: revoked }),
      {
        now,
        idGen: () => generatePolicySnapshotId(now),
      },
    );
    const authority = createRuntimeAuthority({
      snapshot,
      episodeId: episodeIdForClientRun(`task-wake:${groupId}:${taskId}`),
      tenant: resolveAuthorityTenantForEntry({
        preferred: null,
        groupTenantId: resolveCollaborationGroupTenantId(groupId),
      }),
      groupId,
      profile: resolveSecurityProfile(cfg).profile,
      cfg,
    });

    // Same判定点 as WAKE: consumeWakeForRoundDispatch (HB nudge/escalate calls this).
    let dispatchedCalls = 0;
    const consume = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        dispatchedCalls += 1;
        return { ok: true, roundId: "hb-should-not" };
      },
      request: {
        groupId,
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [tenant.bots[0].id],
        source: "nudge",
        taskId,
        itemId: "item-hb-revoke",
        reason: "revoke-hb",
      },
    });
    expect(consume.dispatched).toBe(false);
    expect(consume.reason).toBe("auth_revoked");
    expect(consume.wakeEvent).toBeUndefined();
    expect(dispatchedCalls).toBe(0);
  });

  test("U2-BOUND-POSITIVE-01: legal membership still allows wake dispatch (auth recheck pass)", async () => {
    const { cfg } = await useIsolationRoot({ wakeContract: true });
    const groupId = tenant.groupId;
    const taskId = "task-u2-bound-positive";
    const { fileStore } = createWorkspaceCollaborationStores(cfg);
    await seedTask({ cfg, taskId, groupId });

    const state = makeOperatingState({
      groupId,
      governance: { coordinatorBotId: tenant.bots[0].id, ownerUserId: tenant.employees[0].id },
    });
    state.memberRoleMap = [
      {
        memberId: tenant.employees[0].id,
        memberKind: "human",
        governanceRole: "owner",
        collaborationRole: null,
        status: "active",
      },
      {
        memberId: tenant.bots[0].id,
        memberKind: "bot",
        governanceRole: "member",
        collaborationRole: null,
        status: "active",
      },
    ];
    await writeGroupOperatingState({ fileStore, groupId, state });

    const auth = await recheckCurrentDispatchAuthorization({
      groupId,
      taskId,
      targetActorIds: [tenant.bots[0].id],
      cfg,
    });
    expect(auth.ok).toBe(true);

    const now = Date.now();
    const snapshot = createRoundPolicySnapshot(resolveGroupPolicyInput({ operatingState: state }), {
      now,
      idGen: () => generatePolicySnapshotId(now),
    });
    const authority = createRuntimeAuthority({
      snapshot,
      episodeId: episodeIdForClientRun(`task-wake:${groupId}:${taskId}`),
      tenant: resolveAuthorityTenantForEntry({
        preferred: null,
        groupTenantId: resolveCollaborationGroupTenantId(groupId),
      }),
      groupId,
      profile: resolveSecurityProfile(cfg).profile,
      cfg,
    });
    let dispatchedCalls = 0;
    const consume = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        dispatchedCalls += 1;
        return { ok: true, roundId: "u2-pos" };
      },
      request: {
        groupId,
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: [tenant.bots[0].id],
        source: "nudge",
        taskId,
        itemId: "item-u2-pos",
        reason: "u2-positive",
      },
    });
    expect(consume.reason).not.toBe("auth_revoked");
    expect(dispatchedCalls).toBe(1);
    expect(consume.dispatched).toBe(true);
  });

  // Wake resume / payload idempotency — U3 (persistent op ledger; not memory-only).
  test("WL2-WAKE-IDEMPOTENT-01: duplicate/concurrent wake payload yields single side-effect", async () => {
    const { cfg } = await useIsolationRoot({ wakeContract: true });
    const groupId = tenant.groupId;
    const taskId = "task-wl2-wake-idempotent";
    const { fileStore } = createWorkspaceCollaborationStores(cfg);
    await seedTask({ cfg, taskId, groupId });

    const state = makeOperatingState({
      groupId,
      governance: { coordinatorBotId: tenant.bots[0].id, ownerUserId: tenant.employees[0].id },
    });
    state.memberRoleMap = [
      {
        memberId: tenant.employees[0].id,
        memberKind: "human",
        governanceRole: "owner",
        collaborationRole: null,
        status: "active",
      },
      {
        memberId: tenant.bots[0].id,
        memberKind: "bot",
        governanceRole: "member",
        collaborationRole: null,
        status: "active",
      },
    ];
    await writeGroupOperatingState({ fileStore, groupId, state });

    const now = Date.now();
    const snapshot = createRoundPolicySnapshot(resolveGroupPolicyInput({ operatingState: state }), {
      now,
      idGen: () => generatePolicySnapshotId(now),
    });
    const authority = createRuntimeAuthority({
      snapshot,
      episodeId: episodeIdForClientRun(`task-wake:${groupId}:${taskId}`),
      tenant: resolveAuthorityTenantForEntry({
        preferred: null,
        groupTenantId: resolveCollaborationGroupTenantId(groupId),
      }),
      groupId,
      profile: resolveSecurityProfile(cfg).profile,
      cfg,
    });

    const request = {
      groupId,
      fromAgentId: "system:group_task_heartbeat",
      toAgentIds: [tenant.bots[0].id],
      source: "nudge" as const,
      taskId,
      itemId: "item-idempotent",
      reason: "idempotent-a",
    };
    const opKey = wakeOpIdempotencyKey(request);
    expect(opKey.length).toBeGreaterThan(0);

    let dispatchedCalls = 0;
    const dispatcher = async () => {
      dispatchedCalls += 1;
      // Hold briefly so concurrent consumers race the claim.
      await new Promise((r) => setTimeout(r, 30));
      return { ok: true as const, roundId: "round-idempotent-1" };
    };

    const [a, b] = await Promise.all([
      consumeWakeForRoundDispatch({
        authority,
        cfg,
        writeMode: "execute",
        roundDispatcher: dispatcher,
        request,
      }),
      consumeWakeForRoundDispatch({
        authority,
        cfg,
        writeMode: "execute",
        roundDispatcher: dispatcher,
        request: { ...request, reason: "idempotent-b" },
      }),
    ]);

    expect(dispatchedCalls).toBe(1);
    const winners = [a, b].filter((r) => r.dispatched && !r.reused);
    const reused = [a, b].filter((r) => r.reused || r.reason === "wake_op_in_flight");
    expect(winners.length + reused.length).toBe(2);
    expect(winners.length).toBe(1);
    expect(winners[0]?.roundId).toBe("round-idempotent-1");

    // Sequential duplicate: must reuse completed, no second side effect.
    const again = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: dispatcher,
      request: { ...request, reason: "idempotent-c" },
    });
    expect(dispatchedCalls).toBe(1);
    expect(again.reused).toBe(true);
    expect(again.reason).toBe("idempotent_reuse");
    expect(again.roundId).toBe("round-idempotent-1");
    expect(again.opKey).toBe(opKey);

    const persisted = await readWakeOpRecord({ authority, opKey });
    expect(persisted?.status).toBe("completed");
    expect(persisted?.roundId).toBe("round-idempotent-1");
  });

  test("WL2-WAKE-RESUME-01: interrupt/resume rechecks stop+auth; unknown no blind re-run; failed recovers", async () => {
    const { cfg } = await useIsolationRoot({ wakeContract: true });
    const groupId = tenant.groupId;
    const taskId = "task-wl2-wake-resume";
    const { fileStore, objectStorage } = createWorkspaceCollaborationStores(cfg);
    await seedTask({ cfg, taskId, groupId });

    const state = makeOperatingState({
      groupId,
      governance: { coordinatorBotId: tenant.bots[0].id, ownerUserId: tenant.employees[0].id },
    });
    state.memberRoleMap = [
      {
        memberId: tenant.employees[0].id,
        memberKind: "human",
        governanceRole: "owner",
        collaborationRole: null,
        status: "active",
      },
      {
        memberId: tenant.bots[0].id,
        memberKind: "bot",
        governanceRole: "member",
        collaborationRole: null,
        status: "active",
      },
    ];
    await writeGroupOperatingState({ fileStore, groupId, state });

    const now = Date.now();
    const snapshot = createRoundPolicySnapshot(resolveGroupPolicyInput({ operatingState: state }), {
      now,
      idGen: () => generatePolicySnapshotId(now),
    });
    const authority = createRuntimeAuthority({
      snapshot,
      episodeId: episodeIdForClientRun(`task-wake:${groupId}:${taskId}`),
      tenant: resolveAuthorityTenantForEntry({
        preferred: null,
        groupTenantId: resolveCollaborationGroupTenantId(groupId),
      }),
      groupId,
      profile: resolveSecurityProfile(cfg).profile,
      cfg,
    });

    const request = {
      groupId,
      fromAgentId: "system:group_task_heartbeat",
      toAgentIds: [tenant.bots[0].id],
      source: "self_advance" as const,
      taskId,
      itemId: "item-resume",
      reason: "resume-1",
    };
    const opKey = wakeOpIdempotencyKey(request);

    // --- A: interrupt before consume (no durable state) → first consume still works ---
    let calls = 0;
    const first = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        calls += 1;
        return { ok: true, roundId: "round-resume-first" };
      },
      request,
    });
    expect(first.dispatched).toBe(true);
    expect(calls).toBe(1);

    // Reset ledger for remaining sub-scenarios via a distinct itemId.
    const reqB = { ...request, itemId: "item-resume-mid" };
    const opKeyB = wakeOpIdempotencyKey(reqB);

    // --- B: interrupt during execute (throw) → unknown; resume must not blind re-run ---
    const mid = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        calls += 1;
        throw new Error("simulated crash mid-dispatch");
      },
      request: reqB,
    });
    expect(mid.dispatched).toBe(false);
    expect(mid.reason).toContain("dispatch_threw");
    expect(mid.wakeOp?.status).toBe("unknown");
    const afterCrash = await readWakeOpRecord({ authority, opKey: opKeyB });
    expect(afterCrash?.status).toBe("unknown");

    let blindCalls = 0;
    const blind = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        blindCalls += 1;
        return { ok: true, roundId: "should-not" };
      },
      request: reqB,
    });
    expect(blindCalls).toBe(0);
    expect(blind.reason).toBe("wake_op_unknown");
    expect(blind.dispatched).toBe(false);

    // --- B2: release gates — refuse verbal-only / running dual-write; require verified none + audit ---
    const refuseNoActor = await releaseWakeOpForRetry({
      authority,
      opKey: opKeyB,
      cfg,
      detail: "verbal_only",
      externalEffectVerified: "none",
      releasedBy: "",
    });
    expect(refuseNoActor.ok).toBe(false);
    if (refuseNoActor.ok) {
      throw new Error("expected missing_released_by");
    }
    expect(refuseNoActor.reason).toBe("missing_released_by");

    const runningClaim = await claimWakeOpRunning({
      authority,
      keyInput: { ...reqB, itemId: "item-resume-running-gate" },
      cfg,
    });
    expect(runningClaim.action).toBe("proceed");
    const refuseRunning = await releaseWakeOpForRetry({
      authority,
      opKey: runningClaim.opKey,
      cfg,
      detail: "would_dual_write",
      externalEffectVerified: "none",
      releasedBy: tenant.employees[0].id,
    });
    expect(refuseRunning.ok).toBe(false);
    if (refuseRunning.ok) {
      throw new Error("expected running refused");
    }
    expect(refuseRunning.reason).toBe("status_running_keep_or_mark_unknown");

    // Resume recheck stop + auth (U1/U2 positions), then release for retry — work not permanently lost.
    const stopped = await requestCollaborationTaskStop({
      groupId,
      taskId,
      actor: tenant.employees[0].id,
      actorType: "human",
      reason: "resume-stop-gate",
      cfg,
    });
    expect(stopped.stopControl.status).toBe("accepted");

    // While stopped, even release-then-consume must refuse via stop preflight.
    // Release requires verified externalEffect none + releasedBy (not verbal clear-state).
    const releasedWhileStopped = await releaseWakeOpForRetry({
      authority,
      opKey: opKeyB,
      cfg,
      detail: "operator_verified_external_effect_none",
      externalEffectVerified: "none",
      releasedBy: tenant.employees[0].id,
    });
    expect(releasedWhileStopped.ok).toBe(true);
    if (!releasedWhileStopped.ok) {
      throw new Error("expected release ok");
    }
    expect(releasedWhileStopped.record.status).toBe("failed");
    expect(releasedWhileStopped.record.releasedBy).toBe(tenant.employees[0].id);
    expect(releasedWhileStopped.record.externalEffectVerified).toBe("none");

    const whileStopped = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        blindCalls += 1;
        return { ok: true, roundId: "stopped-no" };
      },
      request: reqB,
    });
    expect(whileStopped.reason).toBe("task_stopped");
    expect(blindCalls).toBe(0);

    // Clear stop for recovery path (drop stopControl from persisted task).
    const task = await objectStorage.readObject<Task>(groupId, "task", taskId);
    expect(task).toBeTruthy();
    const cleared = { ...(task as Record<string, unknown>) };
    delete cleared.stopControl;
    await objectStorage.writeObject(groupId, "task", taskId, cleared as Task);

    // Auth still mapped — failed status allows retry after recheck.
    const recovered = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        blindCalls += 1;
        return { ok: true, roundId: "round-resume-recovered" };
      },
      request: reqB,
    });
    expect(recovered.reason).not.toBe("task_stopped");
    expect(recovered.reason).not.toBe("auth_revoked");
    expect(recovered.reason).not.toBe("wake_op_unknown");
    expect(blindCalls).toBe(1);
    expect(recovered.dispatched).toBe(true);
    expect(recovered.roundId).toBe("round-resume-recovered");

    // --- C: execute happened but receipt not written (stuck running) → unknown path ---
    const reqC = { ...request, itemId: "item-resume-receipt" };
    const opKeyC = wakeOpIdempotencyKey(reqC);
    // Seed a running record as if crash after side effect before completed mark.
    const seeded = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        // Claim happens before dispatcher; mark unknown to model receipt-gap after effect.
        return { ok: true, roundId: "round-receipt-gap" };
      },
      request: reqC,
    });
    expect(seeded.dispatched).toBe(true);
    // Force unknown (receipt missing model): overwrite completed → unknown without clearing roundId proof path.
    await markWakeOpUnknown({
      authority,
      opKey: opKeyC,
      cfg,
      detail: "receipt_missing_after_effect",
    });

    // Verbal / mismatched roundId must not mint completed.
    const verbalConfirm = await confirmWakeOpCompleted({
      authority,
      opKey: opKeyC,
      roundId: "oral-claim-no-receipt",
      cfg,
      detail: "verbal",
      confirmedBy: tenant.employees[0].id,
    });
    expect(verbalConfirm.ok).toBe(false);
    if (verbalConfirm.ok) {
      throw new Error("expected round_id_mismatch");
    }
    expect(verbalConfirm.reason).toBe("round_id_mismatch");

    // Can confirm complete only against prior ledger receipt → reuse; must not dispatch again.
    let receiptCalls = 0;
    const confirmed = await confirmWakeOpCompleted({
      authority,
      opKey: opKeyC,
      roundId: "round-receipt-gap",
      cfg,
      detail: "receipt_recovered",
      confirmedBy: tenant.employees[0].id,
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) {
      throw new Error("expected confirm ok");
    }
    expect(confirmed.record.status).toBe("completed");
    expect(confirmed.record.confirmedBy).toBe(tenant.employees[0].id);
    const reuseAfterConfirm = await consumeWakeForRoundDispatch({
      authority,
      cfg,
      writeMode: "execute",
      roundDispatcher: async () => {
        receiptCalls += 1;
        return { ok: true, roundId: "dup" };
      },
      request: reqC,
    });
    expect(receiptCalls).toBe(0);
    expect(reuseAfterConfirm.reused).toBe(true);
    expect(reuseAfterConfirm.roundId).toBe("round-receipt-gap");

    // Key scope sanity: reason excluded from op key.
    expect(opKey).toBe(
      wakeOpIdempotencyKey({ ...request, reason: "different-reason-not-in-key" } as typeof request),
    );
  });
});
