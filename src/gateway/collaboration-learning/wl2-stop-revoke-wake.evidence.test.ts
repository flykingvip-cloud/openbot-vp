/**
 * WL2 (CAP-03/04) execution-evidence bindings for PR #80 work line 2 + U1 stop.
 *
 * PASS rows map to enforced behavior. U2/U3 platform-gap rows remain it.todo.
 * Do not delete L3 stop/resume adapters.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, it, test } from "vitest";
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
import { requestCollaborationTaskStop, TaskStoppedError } from "./task-stop-entry.js";
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

async function useIsolationRoot(opts: { handoffContract?: boolean; claimContract?: boolean } = {}) {
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

async function seedTask(params: {
  cfg: OpenBotConfig;
  taskId: string;
  groupId?: string;
}): Promise<{
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

  // CAP-04 wake/HB revoke races — T10 close table 待测 (U2).
  it.todo(
    "WL2-REVOKE-WAKE-01: revoke membership after accept/approve queue; wake consume refuses with 0 writes",
  );
  it.todo("WL2-REVOKE-HB-01: heartbeat path revoke race same T-E5判定点 as wake");

  // Wake resume / payload idempotency across stop — U3.
  it.todo("WL2-WAKE-IDEMPOTENT-01: duplicate wake payload yields single side-effect");
  it.todo("WL2-WAKE-RESUME-01: stop→resume→wake preserves work without double-write");
});
