/**
 * Human-attention card actions — real board / wake-op / inbox integration.
 * Proves buttons fulfill business contracts (not inbox-only flips).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, it } from "vitest";
import { clearConfigCache, setRuntimeConfigSnapshot } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  createWorkspaceCollaborationStores,
  writeGroupOperatingState,
} from "../collaboration-learning/shared.js";
import { makeOperatingState } from "./__fixtures__/policy-source-matrix.js";
import {
  applyClaim,
  claimBoardItem,
  loadBoardClaimItem,
  markBoardItemInProgress,
  publishBoardItem,
  submitBoardItemForReview,
} from "./claim-contract.js";
import { confirmTodolist, proposeTodolist } from "./executor-private-todolist.js";
import {
  groupTaskHeartbeatDir,
  groupTaskHeartbeatStatePath,
  progressFingerprint,
} from "./group-task-heartbeat.js";
import { actHumanAttentionCard } from "./human-attention-actions.js";
import {
  getHumanAttentionTodo,
  resetHumanAttentionInboxForTests,
  upsertHumanAttentionTodo,
} from "./human-attention-inbox.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority, type RuntimeAuthority } from "./runtime-authority.js";
import { claimWakeOpRunning, markWakeOpUnknown, readWakeOpRecord } from "./wake-op-ledger.js";
import { consumeWakeForRoundDispatch, setWakeRoundDispatcher } from "./wake-round-dispatch.js";

const GROUP = "grp_ha_actions";
const OWNER = "human:amy";
const tempDirs: string[] = [];

afterEach(async () => {
  setWakeRoundDispatcher(null);
  resetHumanAttentionInboxForTests();
  clearConfigCache();
  delete process.env.OPENBOT_STATE_DIR;
  delete process.env.OPENBOT_CONFIG_PATH;
  delete process.env.OPENCLAW_CONFIG_PATH;
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

function flagConfig(root: string): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        wakeContract: true,
        wakeContractGroupAllowlist: [GROUP],
        claimContract: true,
        selfAdvance: {
          mode: "execute",
          executeGroupAllowlist: [GROUP],
        },
        groupTaskHeartbeat: {
          mode: "observe",
          emitGroupAllowlist: [GROUP],
          scanIntervalMs: 1_000,
          escalateAfterConsecutiveNoResponse: 2,
        },
      },
    },
  } as OpenBotConfig;
}

async function useConfig(): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-ha-act-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  const cfg = flagConfig(root);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return { root, cfg };
}

function authority(cfg: OpenBotConfig): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_ha_act" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_ha_act",
    tenant: { tenantId: null, trust: "none" },
    groupId: GROUP,
    profile: "personal_local",
    cfg,
  });
}

async function seedOwnerOs(cfg: OpenBotConfig, ownerId = OWNER) {
  const stores = createWorkspaceCollaborationStores(cfg);
  const state = makeOperatingState({
    groupId: GROUP,
    governance: { ownerUserId: ownerId, adminUserIds: [], coordinatorBotId: "bot:coord" },
  });
  state.memberRoleMap = [
    {
      memberId: ownerId,
      memberKind: "human",
      governanceRole: "owner",
      collaborationRole: null,
      status: "active",
    },
    {
      memberId: "bot:coord",
      memberKind: "bot",
      governanceRole: "member",
      collaborationRole: null,
      status: "active",
    },
    {
      memberId: "bot:analyst",
      memberKind: "bot",
      governanceRole: "member",
      collaborationRole: null,
      status: "active",
    },
    {
      memberId: "bot:executor",
      memberKind: "bot",
      governanceRole: "member",
      collaborationRole: null,
      status: "active",
    },
  ];
  await writeGroupOperatingState({ fileStore: stores.fileStore, groupId: GROUP, state });
  return stores;
}

async function seedHeartbeatGate(params: {
  auth: RuntimeAuthority;
  itemId: string;
  fingerprint: string;
  nowMs: number;
}) {
  const dir = groupTaskHeartbeatDir(params.auth);
  await fs.mkdir(dir, { recursive: true });
  const statePath = groupTaskHeartbeatStatePath(dir, GROUP);
  const state = {
    groupId: GROUP,
    lastScanAt: params.nowMs,
    items: {
      [params.itemId]: {
        consecutiveNoResponse: 3,
        lastFingerprint: params.fingerprint,
        lastStatus: "in_progress",
        humanAttention: {
          status: "needs_human",
          fingerprint: params.fingerprint,
          ownerIds: [OWNER],
          reason: "test",
          recoveryHint: "verify",
          openedAt: params.nowMs,
          source: "side_effect_unknown",
        },
        nudgeFailCount: 3,
        escalateFailCount: 3,
      },
    },
  };
  await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

describe("human-attention actions — release / recover", () => {
  it("release_after_verify releases wake-op unknown→failed, clears gate, closes todo; next scan runs once", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    await seedOwnerOs(cfg);

    const taskId = "task_release";
    const stores = createWorkspaceCollaborationStores(cfg);
    await stores.objectStorage.writeObject(GROUP, "task", taskId, {
      taskId,
      groupId: GROUP,
      title: "release",
      status: "in_progress",
      ownerMemberId: OWNER,
      assignedMemberIds: [OWNER],
      responsibility: {
        owner: OWNER,
        executors: [OWNER],
        reviewers: [],
        approvers: [OWNER],
      },
      createdAtMs: 1,
      updatedAtMs: 1,
    } as Task);

    const published = await publishBoardItem(
      auth,
      {
        groupId: GROUP,
        taskId,
        remainingWork: "推进",
        acceptanceCriteria: ["有结果"],
        intendedClaimantIds: ["bot:analyst"],
        publishedBy: OWNER,
      },
      { cfg, nowMs: 100 },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const itemId = published.value.itemId;
    const fp = progressFingerprint(published.value);

    const claimed = await claimWakeOpRunning({
      authority: auth,
      cfg,
      keyInput: {
        groupId: GROUP,
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: ["bot:analyst"],
        source: "nudge",
        taskId,
        itemId,
      },
    });
    expect(claimed.action).toBe("proceed");
    await markWakeOpUnknown({
      authority: auth,
      opKey: claimed.opKey,
      cfg,
      detail: "side_effect_uncertain",
    });
    const before = await readWakeOpRecord({ authority: auth, opKey: claimed.opKey });
    expect(before?.status).toBe("unknown");

    await seedHeartbeatGate({ auth, itemId, fingerprint: fp, nowMs: 1_000 });

    const { todo } = upsertHumanAttentionTodo({
      groupId: GROUP,
      itemId,
      taskId,
      fingerprint: fp,
      reason: "side_effect_unknown",
      ownerIds: [OWNER],
      recoveryHint: "verify then release",
      source: "side_effect_unknown",
      sideEffectClass: "started_or_unknown",
      boardStatus: published.value.status,
      wakeOpKey: claimed.opKey,
      nowMs: 1_000,
    });

    const released = await actHumanAttentionCard({
      todoId: todo.id,
      action: "release_after_verify",
      actorId: OWNER,
      expectedVersion: todo.version,
      expectedFingerprint: todo.fingerprint,
      note: "checked receipts; no external write occurred",
      authority: auth,
      cfg,
      nowMs: 2_000,
    });
    expect(released.ok).toBe(true);
    if (!released.ok) {
      return;
    }
    expect(released.todo.status).toBe("recovered");
    expect(released.heartbeatCleared).toBe(true);

    const after = await readWakeOpRecord({ authority: auth, opKey: claimed.opKey });
    expect(after?.status).toBe("failed");

    let runs = 0;
    setWakeRoundDispatcher(async () => {
      runs += 1;
      return { ok: true, roundId: `round_${runs}`, sideEffectClass: "completed_with_receipt" };
    });
    const consume = await consumeWakeForRoundDispatch({
      authority: auth,
      cfg,
      writeMode: "execute",
      nowMs: 3_000,
      request: {
        groupId: GROUP,
        fromAgentId: "system:group_task_heartbeat",
        toAgentIds: ["bot:analyst"],
        source: "nudge",
        taskId,
        itemId,
        reason: "retry_after_release",
      },
    });
    expect(consume.dispatched).toBe(true);
    expect(runs).toBe(1);
    expect(consume.opKey).toBe(claimed.opKey);
    const afterConsume = await readWakeOpRecord({ authority: auth, opKey: claimed.opKey });
    // Post-release scan executed exactly once and left the unknown protection state.
    expect(afterConsume?.status).not.toBe("unknown");
  });

  it("release_after_verify failure keeps todo open (no false recovered)", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    // Deliberately do NOT seed OS owner — recovery identity must fail.
    const { todo } = upsertHumanAttentionTodo({
      groupId: GROUP,
      itemId: "item_x",
      taskId: "task_x",
      fingerprint: "fp_x",
      reason: "side_effect_unknown",
      ownerIds: [OWNER],
      recoveryHint: "verify",
      source: "side_effect_unknown",
      sideEffectClass: "started_or_unknown",
      wakeOpKey: "nonexistent-op-key",
      nowMs: 10,
    });
    const failed = await actHumanAttentionCard({
      todoId: todo.id,
      action: "release_after_verify",
      actorId: OWNER,
      expectedVersion: todo.version,
      expectedFingerprint: todo.fingerprint,
      note: "I verified nothing happened",
      authority: auth,
      cfg,
      nowMs: 20,
    });
    expect(failed.ok).toBe(false);
    const still = getHumanAttentionTodo(todo.id);
    expect(still?.status).toBe("open");
    expect(still?.resolution).toBeUndefined();
  });
});

describe("human-attention actions — cancel / accept / stale / transfer", () => {
  it("cancel_task actually cancels the board item", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    await seedOwnerOs(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: GROUP,
        taskId: "task_cancel",
        remainingWork: "x",
        acceptanceCriteria: ["y"],
        intendedClaimantIds: ["bot:analyst"],
        publishedBy: OWNER,
      },
      { cfg, nowMs: 100 },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const fp = progressFingerprint(published.value);
    await seedHeartbeatGate({
      auth,
      itemId: published.value.itemId,
      fingerprint: fp,
      nowMs: 200,
    });
    const { todo } = upsertHumanAttentionTodo({
      groupId: GROUP,
      itemId: published.value.itemId,
      taskId: "task_cancel",
      fingerprint: fp,
      reason: "not started",
      ownerIds: [OWNER],
      recoveryHint: "cancel",
      source: "manual",
      sideEffectClass: "not_started",
      boardStatus: published.value.status,
      nowMs: 200,
    });
    expect(todo.failureKind).toBe("not_started");
    const result = await actHumanAttentionCard({
      todoId: todo.id,
      action: "cancel_task",
      actorId: OWNER,
      expectedVersion: todo.version,
      expectedFingerprint: todo.fingerprint,
      authority: auth,
      cfg,
      nowMs: 300,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.todo.status).toBe("recovered");
    const live = await loadBoardClaimItem(auth, {
      taskId: "task_cancel",
      itemId: published.value.itemId,
    });
    expect(live?.status).toBe("cancelled");
  });

  it("accept_submission transitions board out of submitted_for_review", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    await seedOwnerOs(cfg);
    const taskId = "task_accept";
    const seedTask = {
      taskId,
      groupId: GROUP,
      title: "accept",
      goal: "g",
      status: "OPEN",
      createdAt: 1,
      updatedAt: 1,
    } as unknown as Task;

    const published = await publishBoardItem(
      auth,
      {
        groupId: GROUP,
        taskId,
        remainingWork: "交卷",
        acceptanceCriteria: ["有证据"],
        intendedClaimantIds: ["bot:executor"],
        publishedBy: OWNER,
      },
      { cfg, nowMs: 100 },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const itemId = published.value.itemId;

    expect(
      (
        await claimBoardItem(
          auth,
          { taskId, itemId, claimantId: "bot:executor" },
          { cfg, nowMs: 200 },
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await applyClaim(auth, { taskId, itemId }, seedTask, auth.policy.effective, {
          cfg,
          nowMs: 300,
        })
      ).ok,
    ).toBe(true);
    const proposed = await proposeTodolist(
      auth,
      {
        boardItemId: itemId,
        taskId,
        groupId: GROUP,
        ownerMemberId: "bot:executor",
        steps: [{ title: "交卷准备" }],
      },
      { cfg },
    );
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) {
      return;
    }
    expect(
      (
        await confirmTodolist(
          auth,
          { taskId, todolistId: proposed.value.todolistId, confirmerId: OWNER },
          { cfg, authorizedConfirmerIds: [OWNER] },
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await markBoardItemInProgress(
          auth,
          { taskId, itemId, actorId: "bot:executor" },
          { cfg, nowMs: 400 },
        )
      ).ok,
    ).toBe(true);

    const { seedLinkedTeamDeliverableFixture, P2_LINKED_DELIVERABLE_FIXTURE } =
      await import("../collaboration-learning/verify-linked-team-deliverable.js");
    const seeded = await seedLinkedTeamDeliverableFixture({
      authority: auth,
      taskId,
      deliverableId: P2_LINKED_DELIVERABLE_FIXTURE.linkedDeliverableId,
      version: P2_LINKED_DELIVERABLE_FIXTURE.linkedDeliverableVersion,
    });
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) {
      return;
    }

    const submitted = await submitBoardItemForReview(
      auth,
      {
        taskId,
        itemId,
        actorId: "bot:executor",
        submissionId: "22222222-2222-4222-8222-222222222222",
        artifactVersion: "v1",
        submissionSummary: "ready",
        linkedDeliverableId: P2_LINKED_DELIVERABLE_FIXTURE.linkedDeliverableId,
        linkedDeliverableVersion: P2_LINKED_DELIVERABLE_FIXTURE.linkedDeliverableVersion,
        linkedContentSha256: seeded.contentSha256,
      },
      { cfg, nowMs: 500 },
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) {
      return;
    }

    const live = await loadBoardClaimItem(auth, { taskId, itemId });
    expect(live?.status).toBe("submitted_for_review");
    const fp = progressFingerprint(live!);
    await seedHeartbeatGate({ auth, itemId, fingerprint: fp, nowMs: 600 });
    const { todo } = upsertHumanAttentionTodo({
      groupId: GROUP,
      itemId,
      taskId,
      fingerprint: fp,
      reason: "awaiting review",
      ownerIds: [OWNER],
      recoveryHint: "review",
      source: "awaiting_review",
      boardStatus: "submitted_for_review",
      nowMs: 600,
    });
    expect(todo.failureKind).toBe("awaiting_review");

    const accepted = await actHumanAttentionCard({
      todoId: todo.id,
      action: "accept_submission",
      actorId: OWNER,
      expectedVersion: todo.version,
      expectedFingerprint: todo.fingerprint,
      authority: auth,
      cfg,
      nowMs: 700,
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      return;
    }
    const after = await loadBoardClaimItem(auth, { taskId, itemId });
    expect(after?.status).toBe("accepted");
    expect(accepted.todo.status).toBe("recovered");
  });

  it("rejects old card after live board progress changes", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    await seedOwnerOs(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: GROUP,
        taskId: "task_stale",
        remainingWork: "x",
        acceptanceCriteria: ["y"],
        intendedClaimantIds: ["bot:analyst"],
        publishedBy: OWNER,
      },
      { cfg, nowMs: 100 },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const oldFp = progressFingerprint(published.value);
    const { todo } = upsertHumanAttentionTodo({
      groupId: GROUP,
      itemId: published.value.itemId,
      taskId: "task_stale",
      fingerprint: oldFp,
      reason: "stall",
      ownerIds: [OWNER],
      recoveryHint: "retry",
      source: "manual",
      sideEffectClass: "not_started",
      boardStatus: published.value.status,
      nowMs: 200,
    });
    // Mutate board → fingerprint changes
    const claimed = await claimBoardItem(
      auth,
      {
        taskId: "task_stale",
        itemId: published.value.itemId,
        claimantId: "bot:analyst",
      },
      { cfg, nowMs: 300 },
    );
    expect(claimed.ok).toBe(true);
    const refused = await actHumanAttentionCard({
      todoId: todo.id,
      action: "cancel_task",
      actorId: OWNER,
      expectedVersion: todo.version,
      expectedFingerprint: oldFp,
      authority: auth,
      cfg,
      nowMs: 400,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toBe("stale_progress");
    }
    expect(getHumanAttentionTodo(todo.id)?.status).toBe("open");
  });

  it("transfer keeps card actionable; heartbeat upsert preserves transferred owner", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    await seedOwnerOs(cfg);
    const stores = createWorkspaceCollaborationStores(cfg);
    await stores.objectStorage.writeObject(GROUP, "task", "task_xfer", {
      taskId: "task_xfer",
      groupId: GROUP,
      title: "xfer",
      status: "in_progress",
      responsibility: {
        owner: OWNER,
        executors: [OWNER],
        reviewer: OWNER,
      },
      createdAtMs: 1,
      updatedAtMs: 1,
    } as Task);

    const published = await publishBoardItem(
      auth,
      {
        groupId: GROUP,
        taskId: "task_xfer",
        remainingWork: "x",
        acceptanceCriteria: ["y"],
        intendedClaimantIds: ["bot:analyst"],
        publishedBy: OWNER,
      },
      { cfg, nowMs: 100 },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const fp = progressFingerprint(published.value);
    const { todo } = upsertHumanAttentionTodo({
      groupId: GROUP,
      itemId: published.value.itemId,
      taskId: "task_xfer",
      fingerprint: fp,
      reason: "stall",
      ownerIds: [OWNER],
      recoveryHint: "transfer",
      source: "nudge_failures_exhausted",
      boardStatus: published.value.status,
      nowMs: 200,
    });
    expect(todo.failureKind).toBe("retries_exhausted");

    const transferred = await actHumanAttentionCard({
      todoId: todo.id,
      action: "transfer",
      actorId: OWNER,
      expectedVersion: todo.version,
      expectedFingerprint: todo.fingerprint,
      transferOwnerId: "human:bob",
      authority: auth,
      cfg,
      nowMs: 300,
    });
    expect(transferred.ok).toBe(true);
    if (!transferred.ok) {
      return;
    }
    expect(transferred.todo.status).toBe("open");
    expect(transferred.todo.ownerIds).toEqual(["human:bob"]);
    expect(transferred.todo.ownerOverride).toBe(true);
    expect(transferred.todo.resolution).toBeUndefined();
    expect(transferred.todo.version).toBe(todo.version + 1);

    // Heartbeat-like upsert with original owner must NOT overwrite override.
    const again = upsertHumanAttentionTodo({
      groupId: GROUP,
      itemId: published.value.itemId,
      taskId: "task_xfer",
      fingerprint: fp,
      reason: "stall",
      ownerIds: [OWNER, "bot:coord"],
      recoveryHint: "transfer",
      source: "nudge_failures_exhausted",
      boardStatus: published.value.status,
      nowMs: 400,
    });
    expect(again.todo.ownerIds).toEqual(["human:bob"]);
    expect(again.todo.status).toBe("open");

    const task = await stores.objectStorage.readObject<Task>(GROUP, "task", "task_xfer");
    expect((task as { responsibility?: { owner?: string } })?.responsibility?.owner).toBe(
      "human:bob",
    );
  });
});
