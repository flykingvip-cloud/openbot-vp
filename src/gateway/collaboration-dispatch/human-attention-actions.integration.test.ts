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
  runGroupTaskHeartbeat,
} from "./group-task-heartbeat.js";
import { actHumanAttentionCard } from "./human-attention-actions.js";
import { buildHumanAttentionAuthority } from "./human-attention-business.js";
import {
  clearHeartbeatHumanAttention,
  getHumanAttentionTodo,
  resetHumanAttentionInboxForTests,
  upsertHumanAttentionTodo,
} from "./human-attention-inbox.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { withRoundLock, writeJsonDurable } from "./round-store-io.js";
import { createRuntimeAuthority, type RuntimeAuthority } from "./runtime-authority.js";
import {
  claimWakeOpRunning,
  markWakeOpCompleted,
  markWakeOpUnknown,
  readWakeOpRecord,
} from "./wake-op-ledger.js";
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
  delete process.env.OPENBOT_TENANTS_ROOT;
  delete process.env.OPENBOT_SECURITY_PROFILE;
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
  groupId?: string;
}) {
  const groupId = params.groupId ?? GROUP;
  const dir = groupTaskHeartbeatDir(params.auth);
  await fs.mkdir(dir, { recursive: true });
  const statePath = groupTaskHeartbeatStatePath(dir, groupId);
  const state = {
    groupId,
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

describe("human-attention actions — return_submission / confirm_completed", () => {
  it("return_submission transitions board to returned and recovers todo", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    await seedOwnerOs(cfg);
    const taskId = "task_return";
    const seedTask = {
      taskId,
      groupId: GROUP,
      title: "return",
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
        submissionId: "33333333-3333-4333-8333-333333333333",
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
    const fp = progressFingerprint(submitted.value);
    await seedHeartbeatGate({ auth, itemId, fingerprint: fp, nowMs: 600 });
    const { todo } = upsertHumanAttentionTodo({
      groupId: GROUP,
      itemId,
      taskId,
      fingerprint: fp,
      reason: "awaiting review",
      ownerIds: [OWNER],
      recoveryHint: "return",
      source: "manual",
      sideEffectClass: "completed_with_receipt",
      boardStatus: submitted.value.status,
      nowMs: 600,
    });
    expect(todo.failureKind).toBe("awaiting_review");

    const returned = await actHumanAttentionCard({
      todoId: todo.id,
      action: "return_submission",
      actorId: OWNER,
      expectedVersion: todo.version,
      expectedFingerprint: todo.fingerprint,
      authority: auth,
      cfg,
      nowMs: 700,
    });
    expect(returned.ok).toBe(true);
    if (!returned.ok) {
      return;
    }
    expect(returned.todo.status).toBe("recovered");
    expect(returned.heartbeatCleared).toBe(true);
    const live = await loadBoardClaimItem(auth, { taskId, itemId });
    expect(live?.status).toBe("returned");
  });

  it("confirm_completed marks wake-op completed, clears gate, recovers todo", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    await seedOwnerOs(cfg);
    const taskId = "task_confirm";
    const stores = createWorkspaceCollaborationStores(cfg);
    await stores.objectStorage.writeObject(GROUP, "task", taskId, {
      taskId,
      groupId: GROUP,
      title: "confirm",
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
    await markWakeOpCompleted({
      authority: auth,
      opKey: claimed.opKey,
      cfg,
      roundId: "round_confirm_1",
      detail: "prior_receipt",
    });
    // Re-open unknown then confirm_completed from human attention (ledger has roundId).
    await markWakeOpUnknown({
      authority: auth,
      opKey: claimed.opKey,
      cfg,
      detail: "needs_human_confirm",
    });
    const before = await readWakeOpRecord({ authority: auth, opKey: claimed.opKey });
    expect(before?.status).toBe("unknown");
    expect(before?.roundId).toBe("round_confirm_1");

    await seedHeartbeatGate({ auth, itemId, fingerprint: fp, nowMs: 1_000 });
    const { todo } = upsertHumanAttentionTodo({
      groupId: GROUP,
      itemId,
      taskId,
      fingerprint: fp,
      reason: "side_effect_unknown",
      ownerIds: [OWNER],
      recoveryHint: "confirm",
      source: "side_effect_unknown",
      sideEffectClass: "started_or_unknown",
      boardStatus: published.value.status,
      wakeOpKey: claimed.opKey,
      nowMs: 1_000,
    });

    const confirmed = await actHumanAttentionCard({
      todoId: todo.id,
      action: "confirm_completed",
      actorId: OWNER,
      expectedVersion: todo.version,
      expectedFingerprint: todo.fingerprint,
      authority: auth,
      cfg,
      nowMs: 2_000,
    });
    expect(confirmed.ok).toBe(true);
    if (!confirmed.ok) {
      return;
    }
    expect(confirmed.todo.status).toBe("recovered");
    expect(confirmed.heartbeatCleared).toBe(true);
    const after = await readWakeOpRecord({ authority: auth, opKey: claimed.opKey });
    expect(after?.status).toBe("completed");
  });

  it("missing authoritative board item refuses mutating action", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const { todo } = upsertHumanAttentionTodo({
      groupId: GROUP,
      itemId: "item_gone",
      taskId: "task_gone",
      fingerprint: "fp_gone",
      reason: "stall",
      ownerIds: [OWNER],
      recoveryHint: "cancel",
      source: "manual",
      sideEffectClass: "not_started",
      boardStatus: "unclaimed",
      nowMs: 10,
    });
    const refused = await actHumanAttentionCard({
      todoId: todo.id,
      action: "cancel_task",
      actorId: OWNER,
      expectedVersion: todo.version,
      expectedFingerprint: todo.fingerprint,
      authority: auth,
      cfg,
      nowMs: 20,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toBe("missing_board_item");
    }
    expect(getHumanAttentionTodo(todo.id)?.status).toBe("open");
  });
});

describe("human-attention authority — enterprise namespace via real builder", () => {
  it("buildHumanAttentionAuthority scopes RPC reads under managed tenant namespace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-ha-ent-"));
    tempDirs.push(root);
    const tenantsRoot = path.join(root, "tenants");
    process.env.OPENBOT_STATE_DIR = path.join(root, "state");
    process.env.OPENBOT_TENANTS_ROOT = tenantsRoot;
    delete process.env.OPENBOT_SECURITY_PROFILE;
    const groupId = "grp_ha_enterprise";
    const tenantId = "tenant_acme";
    const cfg = {
      agents: { defaults: { workspace: path.join(root, "agent-ws") } },
      gateway: { security: { profile: "managed_enterprise" } },
      collaboration: {
        defaults: { workspace: path.join(root, "collaboration") },
        runtimeNamespace: true,
        task: {
          wakeContract: true,
          wakeContractGroupAllowlist: [`${tenantId}/${groupId}`],
          claimContract: true,
          claimContractGroupAllowlist: [`${tenantId}/${groupId}`],
          selfAdvance: {
            mode: "execute",
            executeGroupAllowlist: [`${tenantId}/${groupId}`],
          },
          groupTaskHeartbeat: {
            mode: "observe",
            emitGroupAllowlist: [`${tenantId}/${groupId}`],
            scanIntervalMs: 1_000,
            escalateAfterConsecutiveNoResponse: 2,
          },
        },
      },
    } as OpenBotConfig;
    const configPath = path.join(root, "openbot.json");
    await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
    process.env.OPENBOT_CONFIG_PATH = configPath;
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    setRuntimeConfigSnapshot(cfg, cfg);
    clearConfigCache();

    // Real composition helper (same as RPC) — not a hard-coded personal_local inject.
    const { authority: auth } = buildHumanAttentionAuthority({
      groupId,
      taskId: "task_ent",
      cfg,
      tenant: { tenantId, trust: "membership" },
    });
    expect(auth.tenantId).toBe(tenantId);
    expect(auth.namespace.root.startsWith(path.join(tenantsRoot, tenantId))).toBe(true);
    expect(auth.namespace.root.includes(`${path.sep}tenants${path.sep}`)).toBe(true);

    const stores = createWorkspaceCollaborationStores(cfg);
    // Operating state for ACL; board/heartbeat writes go through authority.namespace.
    const state = makeOperatingState({
      groupId,
      governance: { ownerUserId: OWNER, adminUserIds: [], coordinatorBotId: "bot:coord" },
    });
    state.memberRoleMap = [
      {
        memberId: OWNER,
        memberKind: "human",
        governanceRole: "owner",
        collaborationRole: null,
        status: "active",
      },
    ];
    await writeGroupOperatingState({ fileStore: stores.fileStore, groupId, state });

    const published = await publishBoardItem(
      auth,
      {
        groupId,
        taskId: "task_ent",
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
      groupId,
    });
    // Gate must land under tenant namespace, not host collaboration root.
    const statePath = groupTaskHeartbeatStatePath(groupTaskHeartbeatDir(auth), groupId);
    expect(statePath.startsWith(path.join(tenantsRoot, tenantId))).toBe(true);
    expect(
      await fs
        .stat(statePath)
        .then(() => true)
        .catch(() => false),
    ).toBe(true);

    const { todo } = upsertHumanAttentionTodo({
      groupId,
      itemId: published.value.itemId,
      taskId: "task_ent",
      fingerprint: fp,
      reason: "not started",
      ownerIds: [OWNER],
      recoveryHint: "cancel",
      source: "manual",
      sideEffectClass: "not_started",
      boardStatus: published.value.status,
      tenantId,
      nowMs: 200,
    });

    // Act without injecting authority — rebuild via composition helper + stamped todo tenant.
    const rebuilt = buildHumanAttentionAuthority({
      groupId: todo.groupId,
      taskId: todo.taskId,
      cfg,
      todoTenantId: todo.tenantId,
    }).authority;
    expect(rebuilt.namespace.root).toBe(auth.namespace.root);

    const result = await actHumanAttentionCard({
      todoId: todo.id,
      action: "cancel_task",
      actorId: OWNER,
      expectedVersion: todo.version,
      expectedFingerprint: todo.fingerprint,
      // Omit authority: force rebuild path used by actions when RPC-built auth not passed.
      // Pass rebuilt explicitly as the RPC-equivalent composition result.
      authority: rebuilt,
      cfg,
      nowMs: 300,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.todo.status).toBe("recovered");
    const live = await loadBoardClaimItem(auth, {
      taskId: "task_ent",
      itemId: published.value.itemId,
    });
    expect(live?.status).toBe("cancelled");
    // Wrong-tenant authority must not see the board row.
    const wrong = buildHumanAttentionAuthority({
      groupId,
      taskId: "task_ent",
      cfg,
      tenant: { tenantId: "tenant_other", trust: "membership" },
    }).authority;
    expect(wrong.namespace.root).not.toBe(auth.namespace.root);
    const missing = await loadBoardClaimItem(wrong, {
      taskId: "task_ent",
      itemId: published.value.itemId,
    });
    expect(missing).toBeNull();
  });
});

describe("human-attention inbox — heartbeat clear lock interleaving", () => {
  it("preserves concurrent heartbeat item update and clear under shared lock", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const dir = groupTaskHeartbeatDir(auth);
    await fs.mkdir(dir, { recursive: true });
    const stem = encodeURIComponent(GROUP);
    const statePath = groupTaskHeartbeatStatePath(dir, GROUP);
    const fp = "fp_interleave";
    const initial = {
      groupId: GROUP,
      lastScanAt: 1,
      revision: 1,
      items: {
        item_clear: {
          consecutiveNoResponse: 3,
          lastFingerprint: fp,
          lastStatus: "in_progress",
          humanAttention: {
            status: "needs_human",
            fingerprint: fp,
            ownerIds: [OWNER],
            reason: "test",
            recoveryHint: "verify",
            openedAt: 1,
            source: "side_effect_unknown",
          },
          nudgeFailCount: 3,
          escalateFailCount: 3,
        },
        item_keep: {
          consecutiveNoResponse: 1,
          lastFingerprint: "fp_keep",
          lastStatus: "in_progress",
          nudgeFailCount: 1,
          escalateFailCount: 0,
          note: "heartbeat-owned",
        },
      },
    };
    await writeJsonDurable(statePath, initial);

    const clearPromise = clearHeartbeatHumanAttention({
      authority: auth,
      groupId: GROUP,
      itemId: "item_clear",
      fingerprint: fp,
      nowMs: 5_000,
    });

    const heartbeatPromise = withRoundLock(dir, stem, async () => {
      const raw = await fs.readFile(statePath, "utf8");
      const state = JSON.parse(raw) as typeof initial;
      const item = { ...state.items.item_keep, consecutiveNoResponse: 42, nudgeFailCount: 7 };
      const next = {
        ...state,
        lastScanAt: 4_000,
        revision: (typeof state.revision === "number" ? state.revision : 0) + 1,
        items: {
          ...state.items,
          item_keep: item,
        },
      };
      await writeJsonDurable(statePath, next);
      return true;
    });

    const [cleared, hb] = await Promise.all([clearPromise, heartbeatPromise]);
    expect(cleared).toBe(true);
    expect(hb).toBe(true);

    const finalRaw = await fs.readFile(statePath, "utf8");
    // Must be complete JSON (no torn write).
    const finalState = JSON.parse(finalRaw) as typeof initial;
    expect(finalState.items.item_clear.humanAttention).toBeUndefined();
    expect(finalState.items.item_clear.nudgeFailCount).toBe(0);
    expect(finalState.items.item_keep.consecutiveNoResponse).toBe(42);
    expect(finalState.items.item_keep.nudgeFailCount).toBe(7);
    expect(finalState.items.item_keep.note).toBe("heartbeat-owned");
  });
});

describe("human-attention — real runGroupTaskHeartbeat stale snapshot race", () => {
  async function publishTwoItems(auth: RuntimeAuthority, cfg: OpenBotConfig) {
    await seedOwnerOs(cfg);
    const stores = createWorkspaceCollaborationStores(cfg);
    for (const taskId of ["task_protect", "task_other"] as const) {
      await stores.objectStorage.writeObject(GROUP, "task", taskId, {
        taskId,
        groupId: GROUP,
        title: taskId,
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
    }
    const protectPub = await publishBoardItem(
      auth,
      {
        groupId: GROUP,
        taskId: "task_protect",
        remainingWork: "保护项",
        acceptanceCriteria: ["ok"],
        intendedClaimantIds: ["bot:analyst"],
        publishedBy: OWNER,
      },
      { cfg, nowMs: 100 },
    );
    const otherPub = await publishBoardItem(
      auth,
      {
        groupId: GROUP,
        taskId: "task_other",
        remainingWork: "其他项",
        acceptanceCriteria: ["ok"],
        intendedClaimantIds: ["bot:executor"],
        publishedBy: OWNER,
      },
      { cfg, nowMs: 110 },
    );
    expect(protectPub.ok).toBe(true);
    expect(otherPub.ok).toBe(true);
    if (!protectPub.ok || !otherPub.ok) {
      throw new Error("publish failed");
    }
    return { protect: protectPub.value, other: otherPub.value };
  }

  it("pauses after old read before save: human clear wins; other item heartbeat updates kept", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const { protect, other } = await publishTwoItems(auth, cfg);
    const fpProtect = progressFingerprint(protect);
    const fpOther = progressFingerprint(other);
    const dir = groupTaskHeartbeatDir(auth);
    await fs.mkdir(dir, { recursive: true });
    const statePath = groupTaskHeartbeatStatePath(dir, GROUP);
    await writeJsonDurable(statePath, {
      groupId: GROUP,
      lastScanAt: 1,
      revision: 1,
      items: {
        [protect.itemId]: {
          consecutiveNoResponse: 3,
          lastFingerprint: fpProtect,
          lastStatus: protect.status,
          humanAttention: {
            status: "needs_human",
            fingerprint: fpProtect,
            ownerIds: [OWNER],
            reason: "stale_gate",
            recoveryHint: "verify",
            openedAt: 1,
            source: "side_effect_unknown",
          },
          nudgeFailCount: 3,
          escalateFailCount: 3,
        },
        [other.itemId]: {
          consecutiveNoResponse: 0,
          lastFingerprint: fpOther,
          lastStatus: other.status,
          nudgeFailCount: 0,
          escalateFailCount: 0,
        },
      },
    });

    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    let barrierReached = false;

    const hbPromise = runGroupTaskHeartbeat(
      auth,
      { groupId: GROUP },
      {
        cfg,
        force: true,
        nowMs: 50_000,
        dryRun: true,
        groupOwnerId: OWNER,
        _testAfterPriorReadBeforeWriteBarrier: async () => {
          barrierReached = true;
          const cleared = await clearHeartbeatHumanAttention({
            authority: auth,
            groupId: GROUP,
            itemId: protect.itemId,
            fingerprint: fpProtect,
            nowMs: 40_000,
          });
          expect(cleared).toBe(true);
          const mid = JSON.parse(await fs.readFile(statePath, "utf8")) as {
            items: Record<string, { humanAttention?: unknown; nudgeFailCount?: number }>;
            revision?: number;
          };
          expect(mid.items[protect.itemId]?.humanAttention).toBeUndefined();
          expect(mid.items[protect.itemId]?.nudgeFailCount).toBe(0);
          expect((mid.revision ?? 0) >= 2).toBe(true);
          await barrier;
        },
      },
    );

    // Wait until heartbeat has read old state, scanned, and is paused before save.
    for (let i = 0; i < 200 && !barrierReached; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(barrierReached).toBe(true);
    releaseBarrier();
    const result = await hbPromise;
    expect(result.ok).toBe(true);
    if (!result.ok || result.skipped) {
      return;
    }

    const finalState = JSON.parse(await fs.readFile(statePath, "utf8")) as {
      items: Record<
        string,
        {
          humanAttention?: unknown;
          nudgeFailCount?: number;
          escalateFailCount?: number;
          consecutiveNoResponse?: number;
          lastNudgeAt?: number;
        }
      >;
      revision?: number;
    };
    // Protected item: human recovery must not be resurrected by stale scan snapshot.
    expect(finalState.items[protect.itemId]?.humanAttention).toBeUndefined();
    expect(finalState.items[protect.itemId]?.nudgeFailCount).toBe(0);
    expect(finalState.items[protect.itemId]?.escalateFailCount).toBe(0);
    // Other item: observe nudge updates from this heartbeat tick must remain.
    expect(finalState.items[other.itemId]?.lastNudgeAt).toBe(50_000);
    expect(finalState.items[other.itemId]?.consecutiveNoResponse).toBeGreaterThan(0);
    expect(result.state.items[protect.itemId]?.humanAttention).toBeUndefined();
    expect((finalState.revision ?? 0) >= 3).toBe(true);
  });

  it("reverse interleave: heartbeat save then clear clears; clear then heartbeat keeps clear", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const { protect, other } = await publishTwoItems(auth, cfg);
    const fpProtect = progressFingerprint(protect);
    const fpOther = progressFingerprint(other);
    const dir = groupTaskHeartbeatDir(auth);
    await fs.mkdir(dir, { recursive: true });
    const statePath = groupTaskHeartbeatStatePath(dir, GROUP);

    const seed = {
      groupId: GROUP,
      lastScanAt: 1,
      revision: 1,
      items: {
        [protect.itemId]: {
          consecutiveNoResponse: 3,
          lastFingerprint: fpProtect,
          lastStatus: protect.status,
          humanAttention: {
            status: "needs_human",
            fingerprint: fpProtect,
            ownerIds: [OWNER],
            reason: "stale_gate",
            recoveryHint: "verify",
            openedAt: 1,
            source: "side_effect_unknown" as const,
          },
          nudgeFailCount: 3,
          escalateFailCount: 3,
        },
        [other.itemId]: {
          consecutiveNoResponse: 0,
          lastFingerprint: fpOther,
          lastStatus: other.status,
          nudgeFailCount: 0,
          escalateFailCount: 0,
        },
      },
    };

    // Order A (reverse of the bug window): heartbeat persists first, then human clear.
    await writeJsonDurable(statePath, seed);
    const hbFirst = await runGroupTaskHeartbeat(
      auth,
      { groupId: GROUP },
      {
        cfg,
        force: true,
        nowMs: 60_000,
        dryRun: true,
        groupOwnerId: OWNER,
      },
    );
    expect(hbFirst.ok).toBe(true);
    if (!hbFirst.ok || hbFirst.skipped) {
      return;
    }
    // Without concurrent clear, human_todo carry may still be present after save.
    expect(hbFirst.state.items[protect.itemId]?.humanAttention?.fingerprint).toBe(fpProtect);
    const clearedAfterHb = await clearHeartbeatHumanAttention({
      authority: auth,
      groupId: GROUP,
      itemId: protect.itemId,
      fingerprint: fpProtect,
      nowMs: 61_000,
    });
    expect(clearedAfterHb).toBe(true);
    const afterClear = JSON.parse(await fs.readFile(statePath, "utf8")) as {
      items: Record<string, { humanAttention?: unknown; lastNudgeAt?: number }>;
    };
    expect(afterClear.items[protect.itemId]?.humanAttention).toBeUndefined();
    expect(afterClear.items[other.itemId]?.lastNudgeAt).toBe(60_000);

    // Order B: human clear first, then heartbeat reads already-cleared state and must not reopen.
    await writeJsonDurable(statePath, seed);
    const clearedFirst = await clearHeartbeatHumanAttention({
      authority: auth,
      groupId: GROUP,
      itemId: protect.itemId,
      fingerprint: fpProtect,
      nowMs: 70_000,
    });
    expect(clearedFirst).toBe(true);
    const hbSecond = await runGroupTaskHeartbeat(
      auth,
      { groupId: GROUP },
      {
        cfg,
        force: true,
        nowMs: 80_000,
        dryRun: true,
        groupOwnerId: OWNER,
      },
    );
    expect(hbSecond.ok).toBe(true);
    if (!hbSecond.ok || hbSecond.skipped) {
      return;
    }
    expect(hbSecond.state.items[protect.itemId]?.humanAttention).toBeUndefined();
    const finalB = JSON.parse(await fs.readFile(statePath, "utf8")) as {
      items: Record<string, { humanAttention?: unknown; lastNudgeAt?: number }>;
    };
    expect(finalB.items[protect.itemId]?.humanAttention).toBeUndefined();
    expect(finalB.items[other.itemId]?.lastNudgeAt).toBe(80_000);
  });
});
