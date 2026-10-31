/**
 * P2 acceptance matrix (synthetic tenant, executor A, reviewer B, short MD).
 * R2: paired proofs for deliverable verify, pending lifecycle, trusted recovery,
 * return binding / supersede barriers.
 */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, test } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  acceptBoardItemSubmission,
  applyClaim,
  boardClaimLogPath,
  boardClaimsDir,
  claimBoardItem,
  invalidateBoardDispatchPermitAttempt,
  loadBoardClaimItem,
  markBoardDispatchInvokeStarted,
  markBoardItemInProgress,
  publishBoardItem,
  returnBoardItemSubmission,
  submitBoardItemForReview,
} from "../collaboration-dispatch/claim-contract.js";
import { createRoundPolicySnapshot } from "../collaboration-dispatch/round-policy-snapshot.js";
import {
  createRuntimeAuthority,
  type RuntimeAuthority,
} from "../collaboration-dispatch/runtime-authority.js";
import {
  claimWakeOpRunning,
  markWakeOpCompleted,
  markWakeOpFailed,
  markWakeOpUnknown,
  readWakeOpRecord,
  wakeOpRecordPath,
} from "../collaboration-dispatch/wake-op-ledger.js";
import type {
  WakeRoundDispatchRequest,
  WakeRoundDispatcher,
} from "../collaboration-dispatch/wake-round-dispatch.js";
import { classifyDispatchSideEffect } from "../collaboration-dispatch/wake-round-dispatch.js";
import { finalizeMemberRunTeamDeliverable } from "./chat-deliverable-team-submit.js";
import {
  acceptCollaborationBoardItemSubmission,
  returnCollaborationBoardItemSubmission,
  submitCollaborationBoardItemForReview,
} from "./claim-contract-entry.js";
import {
  normalizeExecutionDeliverableBinding,
  productionWakeDeliverableContractFailure,
  runIdFromWakeOpAttempt,
} from "./execution-deliverable-binding.js";
import {
  classifyConditionalWakeFailCasResult,
  classifyConsumePendingLifecycle,
  finishDeferredWakeFailBeforeRedispatch,
  invalidatePermitAttemptForProvenDeadExecutor,
  listPendingBoardEventRelays,
  listPermitAcquiredBoardEventRelays,
  reconcilePermitAcquiredBoardEventRelays,
  recoverPendingBoardEventRelays,
  triggerPostSubmissionEventAdvance,
} from "./post-submission-event-advance.js";
import { readTeamDeliverable } from "./team-deliverable-submit.js";
import {
  P2_LINKED_DELIVERABLE_FIXTURE_BODY,
  resolveTrustedStoresForAuthority,
  seedLinkedTeamDeliverableFixture,
  trustedLocatorFromAuthority,
} from "./verify-linked-team-deliverable.js";

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;
const savedOpenbotTenantsRoot = process.env.OPENBOT_TENANTS_ROOT;

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
  if (savedOpenbotTenantsRoot === undefined) {
    delete process.env.OPENBOT_TENANTS_ROOT;
  } else {
    process.env.OPENBOT_TENANTS_ROOT = savedOpenbotTenantsRoot;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function flagConfig(root: string): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        claimContract: true,
        wakeContract: true,
        selfAdvance: { mode: "execute", executeGroupAllowlist: ["grp_p2"] },
      },
    },
  } as OpenBotConfig;
}

async function useConfig(): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-p2-matrix-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  const cfg = flagConfig(root);
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
  groupId = "grp_p2",
  tenantId = "tenant-p2",
): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_p2_test" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_p2",
    tenant: { tenantId, trust: "none" },
    groupId,
    profile: "personal_local",
    cfg,
  });
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function seedLink(
  auth: RuntimeAuthority,
  taskId: string,
  opts?: { deliverableId?: string; version?: number; content?: string },
): Promise<{
  linkedDeliverableId: string;
  linkedDeliverableVersion: number;
  linkedContentSha256: string;
}> {
  const content = opts?.content ?? P2_LINKED_DELIVERABLE_FIXTURE_BODY;
  const seeded = await seedLinkedTeamDeliverableFixture({
    authority: auth,
    taskId,
    deliverableId: opts?.deliverableId ?? "del-short-md",
    version: opts?.version ?? 1,
    content,
  });
  if (!seeded.ok) {
    throw new Error(seeded.reason);
  }
  return {
    linkedDeliverableId: seeded.deliverableId,
    linkedDeliverableVersion: seeded.version,
    linkedContentSha256: seeded.contentSha256,
  };
}

function makeSeedTask(groupId: string, taskId: string): Task {
  return {
    taskId,
    groupId,
    title: "short markdown deliverable",
    status: "in_progress",
    ownerMemberId: "bot-b",
    assignedMemberIds: ["bot-b"],
    createdBy: "bot-b",
    updatedBy: "bot-b",
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

async function seedInProgress(params: {
  auth: RuntimeAuthority;
  cfg: OpenBotConfig;
  taskId: string;
  claimant: string;
  reviewer: string;
}) {
  const seedTask = makeSeedTask(params.auth.groupId, params.taskId);
  const published = await publishBoardItem(
    params.auth,
    {
      groupId: params.auth.groupId,
      taskId: params.taskId,
      remainingWork: "write short markdown",
      acceptanceCriteria: ["has title", "has body"],
      intendedClaimantIds: [params.claimant],
      publishedBy: params.reviewer,
    },
    { cfg: params.cfg },
  );
  expect(published.ok).toBe(true);
  if (!published.ok) {
    throw new Error(published.message);
  }
  const claimed = await claimBoardItem(
    params.auth,
    {
      taskId: params.taskId,
      itemId: published.value.itemId,
      claimantId: params.claimant,
    },
    { cfg: params.cfg },
  );
  expect(claimed.ok).toBe(true);
  if (!claimed.ok) {
    throw new Error(claimed.message);
  }
  const applied = await applyClaim(
    params.auth,
    { taskId: params.taskId, itemId: published.value.itemId },
    seedTask,
    params.auth.policy.effective,
    { cfg: params.cfg },
  );
  expect(applied.ok).toBe(true);
  if (!applied.ok) {
    throw new Error(applied.message);
  }
  const { proposeTodolist, confirmTodolist } =
    await import("../collaboration-dispatch/executor-private-todolist.js");
  const proposed = await proposeTodolist(
    params.auth,
    {
      boardItemId: published.value.itemId,
      taskId: params.taskId,
      groupId: params.auth.groupId,
      ownerMemberId: params.claimant,
      steps: [{ title: "draft short md" }, { title: "revise if returned" }],
    },
    { cfg: params.cfg },
  );
  expect(proposed.ok).toBe(true);
  if (!proposed.ok) {
    throw new Error(proposed.message);
  }
  const confirmed = await confirmTodolist(
    params.auth,
    {
      taskId: params.taskId,
      todolistId: proposed.value.todolistId,
      confirmerId: params.reviewer,
    },
    { cfg: params.cfg, authorizedConfirmerIds: [params.reviewer] },
  );
  expect(confirmed.ok).toBe(true);
  if (!confirmed.ok) {
    throw new Error(confirmed.message);
  }

  const started = await markBoardItemInProgress(
    params.auth,
    {
      taskId: params.taskId,
      itemId: published.value.itemId,
      actorId: params.claimant,
    },
    { cfg: params.cfg },
  );
  expect(started.ok).toBe(true);
  if (!started.ok) {
    throw new Error(`${started.reason}: ${started.message}`);
  }
  return {
    item: started.value,
    todolistId: proposed.value.todolistId,
    planVersion: confirmed.value.version,
  };
}

describe("P2 R2 — deliverable reference validation", () => {
  test("legitimate deliverable can submit + accept; forged / wrong-task cannot", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-deliv";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId, { deliverableId: "del-legit", version: 1 });

    const submissionId = randomUUID();
    const submitted = await submitBoardItemForReview(
      auth,
      {
        taskId,
        itemId: item.itemId,
        actorId: "bot-a",
        submissionId,
        artifactVersion: "art-v1",
        submissionSummary: "# Draft v1\nbody",
        ...link,
      },
      { cfg, coordinatorBotId: "bot-b" },
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) {
      throw new Error(submitted.message);
    }

    // Forged hash refused on a fresh item
    const other = await seedInProgress({
      auth,
      cfg,
      taskId: "task-p2-forge",
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const forged = await submitBoardItemForReview(
      auth,
      {
        taskId: "task-p2-forge",
        itemId: other.item.itemId,
        actorId: "bot-a",
        submissionId: randomUUID(),
        artifactVersion: "art-x",
        submissionSummary: "# forged",
        linkedDeliverableId: "del-missing",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      },
      { cfg, coordinatorBotId: "bot-b" },
    );
    expect(forged.ok).toBe(false);
    if (!forged.ok) {
      expect([
        "deliverable_not_found",
        "deliverable_hash_mismatch",
        "deliverable_file_missing",
      ]).toContain(forged.reason);
    }

    // Cross-task: seed deliverable under task A, try bind from task B
    const crossTask = "task-p2-cross";
    const cross = await seedInProgress({
      auth,
      cfg,
      taskId: crossTask,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const wrongTaskLink = await seedLink(auth, taskId, {
      deliverableId: "del-cross",
      version: 1,
      content: "# owned by task-p2-deliv\n",
    });
    const crossSubmit = await submitBoardItemForReview(
      auth,
      {
        taskId: crossTask,
        itemId: cross.item.itemId,
        actorId: "bot-a",
        submissionId: randomUUID(),
        artifactVersion: "art-cross",
        submissionSummary: "# cross",
        ...wrongTaskLink,
      },
      { cfg, coordinatorBotId: "bot-b" },
    );
    expect(crossSubmit.ok).toBe(false);
    if (!crossSubmit.ok) {
      expect(crossSubmit.reason).toBe("deliverable_task_mismatch");
    }

    const accepted = await acceptBoardItemSubmission(
      auth,
      {
        taskId,
        itemId: item.itemId,
        actorId: "bot-b",
        expectedSubmissionId: submissionId,
        reason: "looks good",
        checkedAcceptanceCriteria: ["has title", "has body"],
      },
      { cfg },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      throw new Error(accepted.message);
    }
    expect(accepted.value.status).toBe("accepted");
    expect(accepted.value.pendingEventRelay).toBeNull();
  });
});

describe("P2 R2 — pending lifecycle", () => {
  test("classify: flag-off / no_consumer / unknown retain; dispatched clears", () => {
    expect(
      classifyConsumePendingLifecycle({
        outcome: "dispatched",
        dispatched: true,
        reason: "dispatched:nudge",
      }),
    ).toBe("clear_completed");
    expect(
      classifyConsumePendingLifecycle({
        outcome: "recorded",
        dispatched: false,
        reason: "no_consumer",
      }),
    ).toBe("retain");
    expect(
      classifyConsumePendingLifecycle({
        outcome: "recorded",
        dispatched: false,
        reason: "self_advance_not_execute",
      }),
    ).toBe("retain");
    expect(
      classifyConsumePendingLifecycle({
        outcome: "recorded",
        dispatched: false,
        reason: "wake_contract_off",
      }),
    ).toBe("retain");
    expect(
      classifyConsumePendingLifecycle({
        outcome: "recorded",
        dispatched: false,
        reason: "dispatch_threw:boom",
      }),
    ).toBe("retain_unknown");
    expect(
      classifyConsumePendingLifecycle({
        outcome: "recorded",
        dispatched: false,
        reason: "dispatch_failed:execute_collaboration_round_failed:after write",
      }),
    ).toBe("retain_unknown");
    expect(
      classifyConsumePendingLifecycle({
        outcome: "recorded",
        dispatched: false,
        reason: "side_effect_started_or_unknown:mock_post_write_fail",
      }),
    ).toBe("retain_unknown");
    expect(classifyDispatchSideEffect({ ok: false, reason: "mode_b_dispatcher_unbound" })).toBe(
      "not_started",
    );
    expect(
      classifyDispatchSideEffect({
        ok: false,
        reason: "execute_collaboration_round_failed",
        sideEffectClass: "started_or_unknown",
      }),
    ).toBe("started_or_unknown");
    expect(
      classifyConsumePendingLifecycle({
        outcome: "recorded",
        dispatched: false,
        reason: "task_stopped",
      }),
    ).toBe("clear_terminal");
    expect(
      classifyConsumePendingLifecycle({
        outcome: "dispatched",
        dispatched: true,
        reason: "idempotent_reuse",
        reused: true,
      }),
    ).toBe("clear_completed");
  });

  test("dispatcher unavailable → pending retained → recovery dispatches exactly once", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-pending";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    const submissionId = randomUUID();
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      submissionId,
      artifactVersion: "art-v1",
      submissionSummary: "# Draft\nbody",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });

    let dispatchCount = 0;
    const unavailable: WakeRoundDispatcher = async () => {
      dispatchCount += 1;
      return { ok: false, reason: "mode_b_dispatcher_unbound" };
    };
    const first = await triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      actorId: "bot-b",
      cfg,
      roundDispatcher: unavailable,
      trusted: trustedLocatorFromAuthority(auth),
    });
    expect(first.dispatched).toBe(false);
    expect(first.pendingRelay).toBe(true);
    expect(first.pendingLifecycle).toBe("pending");

    const liveAfter = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(liveAfter?.pendingEventRelay?.status).toBe("pending");
    const opKey = liveAfter?.pendingEventRelay?.opKey;
    expect(opKey).toBeTruthy();

    let okCount = 0;
    const once: WakeRoundDispatcher = async (req) => {
      okCount += 1;
      expect(req.opKey).toBe(opKey);
      return { ok: true, roundId: `round-${okCount}` };
    };
    const recovered = await recoverPendingBoardEventRelays({
      groupId: auth.groupId,
      taskId,
      actorId: "bot-b",
      items: liveAfter ? [liveAfter] : [],
      cfg,
      roundDispatcher: once,
      trusted: trustedLocatorFromAuthority(auth),
    });
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.dispatched).toBe(true);
    expect(recovered[0]?.pendingRelay).toBe(false);
    expect(okCount).toBe(1);

    const afterClear = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(afterClear?.pendingEventRelay).toBeNull();
    const again = await recoverPendingBoardEventRelays({
      groupId: auth.groupId,
      taskId,
      actorId: "bot-b",
      items: afterClear ? [afterClear] : [],
      cfg,
      roundDispatcher: once,
      trusted: trustedLocatorFromAuthority(auth),
    });
    expect(again).toHaveLength(0);
    expect(okCount).toBe(1);
    void dispatchCount;
  });

  test("after accepted, old pending does not execute", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-accept-barrier";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    const submissionId = randomUUID();
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      submissionId,
      artifactVersion: "art-v1",
      submissionSummary: "# final",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });
    const before = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    const stalePending = before?.pendingEventRelay;
    expect(stalePending?.status).toBe("pending");

    const accepted = await acceptCollaborationBoardItemSubmission({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      expectedSubmissionId: submissionId,
      reason: "accepted",
      checkedAcceptanceCriteria: ["has title", "has body"],
      actor: "bot-b",
      cfg,
      relayAdvance: false,
    });
    expect(accepted.item.status).toBe("accepted");
    expect(accepted.item.pendingEventRelay).toBeNull();

    let calls = 0;
    const dispatcher: WakeRoundDispatcher = async () => {
      calls += 1;
      return { ok: true, roundId: "should-not-run" };
    };
    const advance = await triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      actorId: "bot-b",
      pending: stalePending,
      cfg,
      roundDispatcher: dispatcher,
      trusted: trustedLocatorFromAuthority(auth),
    });
    expect(advance.dispatched).toBe(false);
    expect(calls).toBe(0);
    expect(
      advance.reason === "accepted_no_further_exec_schedule" ||
        advance.reason === "pending_opkey_stale_or_superseded" ||
        advance.reason === "no_pending_event_relay",
    ).toBe(true);
  });
});

describe("P2 R2 — return binding + supersede barriers", () => {
  test("return binds claimant/todolist/version; duplicate return event does not double-dispatch", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-return-bind";
    const seeded = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    const submissionId = randomUUID();
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: seeded.item.itemId,
      submissionId,
      artifactVersion: "art-v1",
      submissionSummary: "# Draft\nbody",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });
    const ret = await returnCollaborationBoardItemSubmission({
      groupId: auth.groupId,
      taskId,
      itemId: seeded.item.itemId,
      expectedSubmissionId: submissionId,
      reason: "revise section 2",
      actor: "bot-b",
      cfg,
      relayAdvance: false,
    });
    expect(ret.item.status).toBe("returned");
    const pending = ret.item.pendingEventRelay;
    expect(pending?.businessEvent).toBe("returned");
    expect(pending?.claimantId).toBe("bot-a");
    expect(pending?.returnRevision).toBe(1);
    expect(pending?.linkedDeliverableId).toBe(link.linkedDeliverableId);
    // Exact todolist/version are resolved at dispatch from live confirmed plan.

    let calls = 0;
    const seenBindings: Array<{
      todolistId?: string;
      version?: number;
      hasExecutionBinding?: boolean;
      intent?: string;
    }> = [];
    const dispatcher: WakeRoundDispatcher = async (req) => {
      calls += 1;
      const exec = normalizeExecutionDeliverableBinding(req.executionDeliverableBinding);
      seenBindings.push({
        todolistId: req.planConfirmBinding?.todolistId,
        version: req.planConfirmBinding?.confirmedVersion,
        hasExecutionBinding: Boolean(exec),
        intent: req.dispatchPrompt?.includes("intent=return_revise")
          ? "return_revise"
          : req.reason?.includes("intent=return_revise")
            ? "return_revise"
            : undefined,
      });
      expect(req.toAgentIds).toContain("bot-a");
      expect(req.planConfirmBinding?.todolistId).toBe(seeded.todolistId);
      expect(req.planConfirmBinding?.confirmedVersion).toBe(seeded.planVersion);
      // P1-A: full wake_dispatch executionDeliverableBinding from durable op/attempt.
      expect(exec).toBeTruthy();
      expect(exec?.source).toBe("wake_dispatch");
      expect(exec?.todolistId).toBe(seeded.todolistId);
      expect(exec?.planVersion).toBe(seeded.planVersion);
      expect(exec?.agentId).toBe("bot-a");
      expect(compact(exec?.opKey)).toBeTruthy();
      expect(compact(exec?.attemptId)).toBeTruthy();
      expect(exec?.runId).toBe(
        runIdFromWakeOpAttempt({ opKey: exec!.opKey!, attemptId: exec!.attemptId! }),
      );
      expect(req.dispatchPrompt ?? "").toContain("intent=return_revise");
      return { ok: true, roundId: `ret-round-${calls}` };
    };
    function compact(value: string | null | undefined): string {
      return value?.trim() ?? "";
    }
    const first = await triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: seeded.item.itemId,
      actorId: "bot-b",
      cfg,
      roundDispatcher: dispatcher,
      trusted: trustedLocatorFromAuthority(auth),
    });
    expect(first.dispatched).toBe(true);
    expect(calls).toBe(1);

    // Duplicate / stale snapshot must not double-dispatch
    const second = await triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: seeded.item.itemId,
      actorId: "bot-b",
      pending,
      cfg,
      roundDispatcher: dispatcher,
      trusted: trustedLocatorFromAuthority(auth),
    });
    expect(second.dispatched).toBe(false);
    expect(calls).toBe(1);
  });

  test("return superseded by new submit / accept does not start old event", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-supersede";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    const submissionId = randomUUID();
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      submissionId,
      artifactVersion: "art-v1",
      submissionSummary: "# v1",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });
    const ret = await returnCollaborationBoardItemSubmission({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      expectedSubmissionId: submissionId,
      reason: "needs work",
      actor: "bot-b",
      cfg,
      relayAdvance: false,
    });
    const oldPending = ret.item.pendingEventRelay;
    expect(oldPending?.opKey).toBeTruthy();

    await markBoardItemInProgress(auth, { taskId, itemId: item.itemId, actorId: "bot-a" }, { cfg });
    const link2 = await seedLink(auth, taskId, {
      deliverableId: "del-short-md-v2",
      version: 2,
      content: "# revised body\n",
    });
    const submissionId2 = randomUUID();
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      submissionId: submissionId2,
      artifactVersion: "art-v2",
      submissionSummary: "# v2 revised",
      ...link2,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });

    let calls = 0;
    const dispatcher: WakeRoundDispatcher = async () => {
      calls += 1;
      return { ok: true, roundId: "nope" };
    };
    const stale = await triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      actorId: "bot-b",
      pending: oldPending,
      cfg,
      roundDispatcher: dispatcher,
      trusted: trustedLocatorFromAuthority(auth),
    });
    expect(stale.dispatched).toBe(false);
    expect(calls).toBe(0);
    expect(
      stale.reason === "pending_opkey_stale_or_superseded" ||
        stale.reason.startsWith("status_not_returned") ||
        stale.reason === "board_revision_superseded",
    ).toBe(true);

    // Accept new submission — clears relay; old still blocked
    await acceptCollaborationBoardItemSubmission({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      expectedSubmissionId: submissionId2,
      reason: "ok",
      checkedAcceptanceCriteria: ["has title", "has body"],
      actor: "bot-b",
      cfg,
      relayAdvance: false,
    });
    const afterAccept = await triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      actorId: "bot-b",
      pending: oldPending,
      cfg,
      roundDispatcher: dispatcher,
      trusted: trustedLocatorFromAuthority(auth),
    });
    expect(afterAccept.dispatched).toBe(false);
    expect(calls).toBe(0);
  });
});

describe("P2 R2 — heartbeat trusted scope", () => {
  test("requireTrustedScope refuses missing locator; dual-tenant same groupId stays isolated", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-p2-dual-"));
    tempDirs.push(root);
    process.env.OPENBOT_STATE_DIR = path.join(root, "state");
    process.env.OPENBOT_TENANTS_ROOT = path.join(root, "tenants");
    const cfg = {
      ...flagConfig(root),
      gateway: { security: { profile: "managed_enterprise" } },
    } as OpenBotConfig;
    // managed + runtimeNamespace keeps same groupId on distinct tenant roots.
    (cfg.collaboration as { runtimeNamespace?: boolean }).runtimeNamespace = true;
    const configPath = path.join(root, "openbot.json");
    await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
    process.env.OPENBOT_CONFIG_PATH = configPath;
    process.env.OPENCLAW_CONFIG_PATH = configPath;
    setRuntimeConfigSnapshot(cfg, cfg);
    clearConfigCache();

    const snapshot = createRoundPolicySnapshot(
      { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
      { now: 1, idGen: () => "pss_p2_dual" },
    );
    const authA = createRuntimeAuthority({
      snapshot,
      episodeId: "ep_p2_a",
      tenant: { tenantId: "tenant-a", trust: "membership" },
      groupId: "grp_p2",
      profile: "managed_enterprise",
      cfg,
    });
    const authB = createRuntimeAuthority({
      snapshot,
      episodeId: "ep_p2_b",
      tenant: { tenantId: "tenant-b", trust: "membership" },
      groupId: "grp_p2",
      profile: "managed_enterprise",
      cfg,
    });
    const locA = trustedLocatorFromAuthority(authA);
    const locB = trustedLocatorFromAuthority(authB);
    expect(locA?.groupLocator).toBeTruthy();
    expect(locB?.groupLocator).toBeTruthy();
    // Same groupId string under different tenants must not share store root.
    expect(locA!.groupLocator).not.toBe(locB!.groupLocator);
    expect(locA!.groupLocator).toContain(`${path.sep}tenant-a${path.sep}`);
    expect(locB!.groupLocator).toContain(`${path.sep}tenant-b${path.sep}`);

    const refused = await triggerPostSubmissionEventAdvance({
      groupId: "grp_p2",
      taskId: "task-x",
      itemId: "item-x",
      actorId: "bot-a",
      cfg,
      requireTrustedScope: true,
      // intentionally omit trusted/auth/stores
    });
    expect(refused.reason).toContain("trusted_group_locator_required");
    expect(refused.pendingRelay).toBe(true);

    // Seed under tenant A only (direct claim-contract on authA namespace)
    const taskId = "task-dual";
    const { item } = await seedInProgress({
      auth: authA,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(authA, taskId, { deliverableId: "del-tenant-a" });
    const submitted = await submitBoardItemForReview(
      authA,
      {
        taskId,
        itemId: item.itemId,
        actorId: "bot-a",
        submissionId: randomUUID(),
        artifactVersion: "art-v1",
        submissionSummary: "# a",
        ...link,
      },
      { cfg, coordinatorBotId: "bot-b" },
    );
    expect(submitted.ok).toBe(true);

    // Tenant B authority must not see tenant A board pending via wrong root
    const itemsB = await loadBoardClaimItem(authB, { taskId, itemId: item.itemId });
    expect(itemsB).toBeNull();

    const okA = await triggerPostSubmissionEventAdvance({
      groupId: authA.groupId,
      taskId,
      itemId: item.itemId,
      actorId: "bot-b",
      cfg,
      trusted: locA,
      tenant: { tenantId: "tenant-a", trust: "membership" },
      requireTrustedScope: true,
      roundDispatcher: async () => ({ ok: false, reason: "mode_b_dispatcher_unbound" }),
    });
    expect(okA.businessEvent).toBe("submitted_for_review");
    expect(okA.pendingRelay).toBe(true);
  });
});

describe("P2 matrix — direct-internal (claim-contract)", () => {
  test("items 1/3/4/5/7: link, return, late-accept refuse, accept clears relay", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-md";
    const executorA = "bot-a";
    const reviewerB = "bot-b";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: executorA,
      reviewer: reviewerB,
    });
    const LINK = await seedLink(auth, taskId);

    const submissionId = randomUUID();
    const submitted = await submitBoardItemForReview(
      auth,
      {
        taskId,
        itemId: item.itemId,
        actorId: executorA,
        submissionId,
        artifactVersion: "art-v1",
        submissionSummary: "# Draft v1\nbody",
        ...LINK,
      },
      { cfg, coordinatorBotId: reviewerB },
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) {
      throw new Error(submitted.message);
    }
    expect(submitted.value.linkedDeliverableId).toBe(LINK.linkedDeliverableId);
    expect(submitted.value.pendingEventRelay?.businessEvent).toBe("submitted_for_review");
    expect(submitted.value.pendingEventRelay?.sourceId).toBe(submissionId);
    expect(submitted.value.pendingEventRelay?.opKey).toContain("submitted_for_review");

    const returned = await returnBoardItemSubmission(
      auth,
      {
        taskId,
        itemId: item.itemId,
        actorId: reviewerB,
        expectedSubmissionId: submissionId,
        reason: "needs clearer title",
      },
      { cfg },
    );
    expect(returned.ok).toBe(true);
    if (!returned.ok) {
      throw new Error(returned.message);
    }
    expect(returned.value.pendingEventRelay?.businessEvent).toBe("returned");
    expect(returned.value.pendingEventRelay?.returnRevision).toBe(1);
    expect(returned.value.pendingEventRelay?.claimantId).toBe(executorA);

    const late = await acceptBoardItemSubmission(
      auth,
      {
        taskId,
        itemId: item.itemId,
        actorId: reviewerB,
        expectedSubmissionId: submissionId,
        reason: "late",
        checkedAcceptanceCriteria: ["has title", "has body"],
      },
      { cfg },
    );
    expect(late.ok).toBe(false);

    await markBoardItemInProgress(
      auth,
      { taskId, itemId: item.itemId, actorId: executorA },
      { cfg },
    );
    const LINK_V2 = await seedLink(auth, taskId, {
      deliverableId: "del-short-md-v2",
      version: 2,
      content: "# Draft v2\nrevised\n",
    });
    const submissionId2 = randomUUID();
    const submitted2 = await submitBoardItemForReview(
      auth,
      {
        taskId,
        itemId: item.itemId,
        actorId: executorA,
        submissionId: submissionId2,
        artifactVersion: "art-v2",
        submissionSummary: "# Draft v2\nrevised",
        ...LINK_V2,
      },
      { cfg, coordinatorBotId: reviewerB },
    );
    expect(submitted2.ok).toBe(true);

    const noLinkTask = "task-p2-nolink";
    const noLink = await seedInProgress({
      auth,
      cfg,
      taskId: noLinkTask,
      claimant: executorA,
      reviewer: reviewerB,
    });
    const subNoLink = randomUUID();
    await submitBoardItemForReview(
      auth,
      {
        taskId: noLinkTask,
        itemId: noLink.item.itemId,
        actorId: executorA,
        submissionId: subNoLink,
        artifactVersion: "art-x",
        submissionSummary: "# no link",
      },
      { cfg, coordinatorBotId: reviewerB },
    );
    const refuseNoLink = await acceptBoardItemSubmission(
      auth,
      {
        taskId: noLinkTask,
        itemId: noLink.item.itemId,
        actorId: reviewerB,
        expectedSubmissionId: subNoLink,
        reason: "ok",
        checkedAcceptanceCriteria: ["has title", "has body"],
      },
      { cfg },
    );
    expect(refuseNoLink.ok).toBe(false);
    if (!refuseNoLink.ok) {
      expect(refuseNoLink.reason).toBe("deliverable_link_required");
    }

    const accepted = await acceptBoardItemSubmission(
      auth,
      {
        taskId,
        itemId: item.itemId,
        actorId: reviewerB,
        expectedSubmissionId: submissionId2,
        reason: "looks good",
        checkedAcceptanceCriteria: ["has title", "has body"],
      },
      { cfg },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      throw new Error(accepted.message);
    }
    expect(accepted.value.status).toBe("accepted");
    expect(accepted.value.pendingEventRelay).toBeNull();
  });

  test("item 5: same submissionId+version idempotent — same relay opKey", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId: "task-p2-idemp",
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const LINK = await seedLink(auth, "task-p2-idemp");
    const submissionId = randomUUID();
    const first = await submitBoardItemForReview(
      auth,
      {
        taskId: "task-p2-idemp",
        itemId: item.itemId,
        actorId: "bot-a",
        submissionId,
        artifactVersion: "art-v1",
        submissionSummary: "# once",
        ...LINK,
      },
      { cfg, coordinatorBotId: "bot-b" },
    );
    const second = await submitBoardItemForReview(
      auth,
      {
        taskId: "task-p2-idemp",
        itemId: item.itemId,
        actorId: "bot-a",
        submissionId,
        artifactVersion: "art-v1",
        submissionSummary: "# once",
        ...LINK,
      },
      { cfg, coordinatorBotId: "bot-b" },
    );
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.pendingEventRelay?.opKey).toBe(first.value.pendingEventRelay?.opKey);
    }
  });
});

describe("P2 matrix — handler-integration (trusted write surface)", () => {
  test("item 8: submitForReview RPC refuses unauthenticated client (same trusted root)", async () => {
    const { collaborationLearningHandlers } =
      await import("../server-methods/collaboration-learning.js");
    const respond = viRespond();
    await collaborationLearningHandlers["collaboration.task.submitForReview"]({
      req: {} as never,
      params: {
        groupId: "grp_p2",
        taskId: "task-1",
        itemId: "item-1",
        submissionId: randomUUID(),
        artifactVersion: "v1",
        submissionSummary: "x",
      },
      respond: respond as never,
      context: {} as never,
      client: null as never,
      isWebchatConnect: () => false,
    });
    expect(respond.calls.length).toBe(1);
    expect(respond.calls[0]?.[0]).toBe(false);
  });
});

describe("P2 R3 — return executionDeliverableBinding + Mode B submit", () => {
  test("return-revise builds full binding from durable op/attempt; Mode B formal submit accepts revise", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-r3-return-bind-submit";
    const seeded = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    const submissionId = randomUUID();
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: seeded.item.itemId,
      submissionId,
      artifactVersion: "art-v1",
      submissionSummary: "# Draft v1\nbody",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });
    const ret = await returnCollaborationBoardItemSubmission({
      groupId: auth.groupId,
      taskId,
      itemId: seeded.item.itemId,
      expectedSubmissionId: submissionId,
      reason: "revise section 2 for clarity",
      actor: "bot-b",
      cfg,
      relayAdvance: false,
    });
    expect(ret.item.status).toBe("returned");

    let captured: WakeRoundDispatchRequest | null = null;
    const dispatcher: WakeRoundDispatcher = async (req) => {
      captured = req;
      return { ok: true, roundId: "r3-return-revise-round" };
    };
    const advance = await triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: seeded.item.itemId,
      actorId: "bot-b",
      cfg,
      roundDispatcher: dispatcher,
      trusted: trustedLocatorFromAuthority(auth),
    });
    expect(advance.dispatched).toBe(true);
    expect(captured).toBeTruthy();
    const binding = normalizeExecutionDeliverableBinding(captured!.executionDeliverableBinding);
    expect(binding).toBeTruthy();
    if (!binding) {
      throw new Error("expected executionDeliverableBinding on return dispatch");
    }
    expect(binding.source).toBe("wake_dispatch");
    expect(binding.todolistId).toBe(seeded.todolistId);
    expect(binding.planVersion).toBe(seeded.planVersion);
    expect(binding.agentId).toBe("bot-a");
    expect(binding.opKey).toBeTruthy();
    expect(binding.attemptId).toBeTruthy();
    expect(binding.runId).toBe(
      runIdFromWakeOpAttempt({ opKey: binding.opKey!, attemptId: binding.attemptId! }),
    );
    expect(captured!.planConfirmBinding?.todolistId).toBe(seeded.todolistId);
    expect(captured!.planConfirmBinding?.confirmedVersion).toBe(seeded.planVersion);
    expect(captured!.dispatchPrompt ?? "").toContain("intent=return_revise");
    expect(captured!.dispatchPrompt ?? "").toContain("退回修订");
    // Distinct from review intent
    expect(captured!.dispatchPrompt ?? "").not.toContain("intent=review_submission");

    // Production wake contract (same gate Mode B boot uses before formal write).
    expect(
      productionWakeDeliverableContractFailure({
        binding,
        requireTenant: false,
        tenantId: binding.tenantId,
        groupId: binding.groupId,
        taskId: binding.taskId,
        boardItemId: binding.boardItemId,
        agentId: binding.agentId,
        opKey: binding.opKey,
        attemptId: binding.attemptId,
        planConfirmBinding: captured!.planConfirmBinding,
      }),
    ).toBeNull();

    // Seed durable task SoT (formal submit asserts task belongs to group).
    const stores = resolveTrustedStoresForAuthority(auth);
    expect(stores).toBeTruthy();
    await stores!.objectStorage.writeObject(
      auth.groupId,
      "task",
      taskId,
      makeSeedTask(auth.groupId, taskId),
    );

    // Member resume after return-revise wake (Mode B run marks in_progress before DELIVERABLE).
    const resumed = await markBoardItemInProgress(
      auth,
      { taskId, itemId: seeded.item.itemId, actorId: "bot-a" },
      { cfg },
    );
    expect(resumed.ok).toBe(true);

    // Without binding, Mode B formal path refuses (execution_binding_required).
    const missing = await finalizeMemberRunTeamDeliverable({
      text: '<<DELIVERABLE title="Revise" file="revise-r3.md">>\nrevised body\n<</DELIVERABLE>>',
      agentId: "bot-a",
      binding: null,
      trusted: trustedLocatorFromAuthority(auth),
      cfg,
      enforceAcl: false,
    });
    expect(missing.outcome.ok).toBe(false);
    if (!missing.outcome.ok) {
      expect(missing.outcome.reason).toBe("execution_binding_required");
    }

    // Real deliverable submit path with the return-revise binding (model mocked as text).
    const submitted = await finalizeMemberRunTeamDeliverable({
      text: '<<DELIVERABLE title="ReviseR3" file="revise-r3.md">>\n# revised section 2\nbody after return\n<</DELIVERABLE>>',
      agentId: "bot-a",
      binding,
      trusted: trustedLocatorFromAuthority(auth),
      cfg,
      enforceAcl: false,
    });
    if (!submitted.outcome.ok) {
      throw new Error(
        `formal submit failed: ${submitted.outcome.reason}${
          "detail" in submitted.outcome && submitted.outcome.detail
            ? ` detail=${submitted.outcome.detail}`
            : ""
        } text=${submitted.text.slice(0, 240)}`,
      );
    }
    expect(submitted.outcome.ok).toBe(true);
    const deliverableId =
      "deliverableId" in submitted.outcome ? submitted.outcome.deliverableId : null;
    const version = "version" in submitted.outcome ? submitted.outcome.version : null;
    expect(deliverableId).toBeTruthy();
    expect(typeof version).toBe("number");
    const readBack = await readTeamDeliverable({
      groupId: auth.groupId,
      deliverableId: String(deliverableId),
      actor: "bot-a",
      trusted: trustedLocatorFromAuthority(auth),
      cfg,
      enforceAcl: false,
    });
    expect(readBack.ok).toBe(true);
    if (readBack.ok) {
      expect(readBack.content).toContain("revised section 2");
      expect(readBack.taskId).toBe(taskId);
      expect(readBack.version).toBe(Number(version));
    }
  });
});

describe("P2 R4 — post-adjudication / pre-permit-commit adversarial races", () => {
  test("accept AFTER adjudication read BEFORE permit commit blocks stale return", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-r4-race-accept";
    const seeded = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    const submissionId = randomUUID();
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: seeded.item.itemId,
      submissionId,
      artifactVersion: "art-v1",
      submissionSummary: "# race accept",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });
    // Force returned pending, then we will accept a re-submit inside the barrier.
    // Simpler: return, mark in progress, re-submit, then start advance with barrier
    // that accepts AFTER check. Here: return first; barrier accepts by mutating via
    // accept on a fresh submit path is awkward mid-flight. Instead: return, then in
    // barrier call acceptCollaboration after a new submit? Board is returned — accept
    // needs submitted_for_review. Flow: return → barrier does mark+submit+accept.
    const ret = await returnCollaborationBoardItemSubmission({
      groupId: auth.groupId,
      taskId,
      itemId: seeded.item.itemId,
      expectedSubmissionId: submissionId,
      reason: "race",
      actor: "bot-b",
      cfg,
      relayAdvance: false,
    });
    const oldPending = ret.item.pendingEventRelay;
    expect(oldPending?.opKey).toBeTruthy();
    const oldOpKey = oldPending!.opKey;

    let dispatcherCalls = 0;
    const dispatcher: WakeRoundDispatcher = async () => {
      dispatcherCalls += 1;
      return { ok: true, roundId: "should-not-fire" };
    };

    const advance = await triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: seeded.item.itemId,
      actorId: "bot-b",
      pending: oldPending,
      cfg,
      roundDispatcher: dispatcher,
      trusted: trustedLocatorFromAuthority(auth),
      _testAfterAdjudicationReadBeforePermitCommit: async () => {
        // Post-check race: member revises and reviewer accepts before dispatch.
        await markBoardItemInProgress(
          auth,
          { taskId, itemId: seeded.item.itemId, actorId: "bot-a" },
          { cfg },
        );
        const link2 = await seedLink(auth, taskId, {
          deliverableId: "del-race-accept",
          version: 2,
          content: "# accepted mid-flight\n",
        });
        const submissionId2 = randomUUID();
        await submitCollaborationBoardItemForReview({
          groupId: auth.groupId,
          taskId,
          itemId: seeded.item.itemId,
          submissionId: submissionId2,
          artifactVersion: "art-v2",
          submissionSummary: "# v2",
          ...link2,
          actor: "bot-a",
          cfg,
          relayAdvance: false,
        });
        await acceptCollaborationBoardItemSubmission({
          groupId: auth.groupId,
          taskId,
          itemId: seeded.item.itemId,
          expectedSubmissionId: submissionId2,
          reason: "ok mid-flight",
          checkedAcceptanceCriteria: ["has title", "has body"],
          actor: "bot-b",
          cfg,
          relayAdvance: false,
        });
      },
    });

    expect(advance.dispatched).toBe(false);
    expect(dispatcherCalls).toBe(0);
    expect(
      advance.reason.includes("commit_") ||
        advance.reason.includes("accepted") ||
        advance.reason.includes("superseded") ||
        advance.reason.includes("status_not_returned") ||
        advance.reason.startsWith("dispatch_failed:"),
    ).toBe(true);

    const live = await loadBoardClaimItem(auth, { taskId, itemId: seeded.item.itemId });
    expect(live?.status).toBe("accepted");
    // Durable: old return pending must not remain actionable.
    const pending = live?.pendingEventRelay;
    if (pending && pending.opKey === oldOpKey) {
      expect(["blocked", "unknown"].includes(pending.status) || pending.status !== "pending").toBe(
        true,
      );
    }
  });

  test("new submit AFTER adjudication read BEFORE permit commit blocks stale return", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-r4-race-submit";
    const seeded = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    const submissionId = randomUUID();
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: seeded.item.itemId,
      submissionId,
      artifactVersion: "art-v1",
      submissionSummary: "# race submit",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });
    const ret = await returnCollaborationBoardItemSubmission({
      groupId: auth.groupId,
      taskId,
      itemId: seeded.item.itemId,
      expectedSubmissionId: submissionId,
      reason: "needs revise",
      actor: "bot-b",
      cfg,
      relayAdvance: false,
    });
    const oldPending = ret.item.pendingEventRelay!;
    const oldOpKey = oldPending.opKey;
    const oldBoardRevision = oldPending.boardRevision;

    let dispatcherCalls = 0;
    let sawCommitReject = false;
    const dispatcher: WakeRoundDispatcher = async () => {
      dispatcherCalls += 1;
      return { ok: true, roundId: "stale-should-not" };
    };

    const advance = await triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: seeded.item.itemId,
      actorId: "bot-b",
      pending: oldPending,
      cfg,
      roundDispatcher: dispatcher,
      trusted: trustedLocatorFromAuthority(auth),
      _testAfterAdjudicationReadBeforePermitCommit: async () => {
        await markBoardItemInProgress(
          auth,
          { taskId, itemId: seeded.item.itemId, actorId: "bot-a" },
          { cfg },
        );
        const link2 = await seedLink(auth, taskId, {
          deliverableId: "del-race-submit",
          version: 2,
          content: "# new submit mid-flight\n",
        });
        await submitCollaborationBoardItemForReview({
          groupId: auth.groupId,
          taskId,
          itemId: seeded.item.itemId,
          submissionId: randomUUID(),
          artifactVersion: "art-v2",
          submissionSummary: "# superseding submit",
          ...link2,
          actor: "bot-a",
          cfg,
          relayAdvance: false,
        });
      },
    });

    expect(advance.dispatched).toBe(false);
    // Either refused before consume completed, or dispatcher wrapper rejected at commit.
    expect(dispatcherCalls).toBe(0);
    const reason = advance.reason;
    if (reason.includes("commit_") || reason.startsWith("dispatch_failed:commit_")) {
      sawCommitReject = true;
    }
    expect(
      sawCommitReject ||
        reason.includes("superseded") ||
        reason.includes("status_not_returned") ||
        reason.includes("pending_opkey"),
    ).toBe(true);

    const live = await loadBoardClaimItem(auth, { taskId, itemId: seeded.item.itemId });
    expect(live?.status).toBe("submitted_for_review");
    // New submit owns a different pending opKey / higher board revision.
    const livePending = live?.pendingEventRelay;
    expect(livePending?.opKey === oldOpKey).toBe(false);
    if (typeof oldBoardRevision === "number" && typeof live?.revision === "number") {
      expect(live.revision).toBeGreaterThan(oldBoardRevision);
    }
  });

  test("reassign claimant AFTER adjudication read BEFORE permit commit blocks", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-r4-race-reassign";
    const seeded = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    const submissionId = randomUUID();
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: seeded.item.itemId,
      submissionId,
      artifactVersion: "art-v1",
      submissionSummary: "# race reassign",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });
    const ret = await returnCollaborationBoardItemSubmission({
      groupId: auth.groupId,
      taskId,
      itemId: seeded.item.itemId,
      expectedSubmissionId: submissionId,
      reason: "reassign race",
      actor: "bot-b",
      cfg,
      relayAdvance: false,
    });
    const oldPending = ret.item.pendingEventRelay!;
    expect(oldPending.claimantId).toBe("bot-a");

    let dispatcherCalls = 0;
    const dispatcher: WakeRoundDispatcher = async () => {
      dispatcherCalls += 1;
      return { ok: true, roundId: "reassign-should-not" };
    };

    const advance = await triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: seeded.item.itemId,
      actorId: "bot-b",
      pending: oldPending,
      cfg,
      roundDispatcher: dispatcher,
      trusted: trustedLocatorFromAuthority(auth),
      _testAfterAdjudicationReadBeforePermitCommit: async () => {
        // Durable reassign after check: same pending opKey, claimant moved to bot-c.
        const live = await loadBoardClaimItem(auth, {
          taskId,
          itemId: seeded.item.itemId,
        });
        if (!live?.pendingEventRelay) {
          throw new Error("expected pending before reassign append");
        }
        const claimsDir = boardClaimsDir(auth);
        const logPath = boardClaimLogPath(claimsDir, taskId);
        const nextRevision = (typeof live.revision === "number" ? live.revision : 0) + 1;
        const reassigned = {
          ...live,
          claimantId: "bot-c",
          revision: nextRevision,
          pendingEventRelay: {
            ...live.pendingEventRelay,
            claimantId: "bot-c",
            // Keep opKey so this is a true post-check race on the same event.
            targetAgentIds: ["bot-c"],
          },
        };
        await fs.mkdir(claimsDir, { recursive: true });
        await fs.appendFile(
          logPath,
          `${JSON.stringify({ kind: "board_claim", at: Date.now(), item: reassigned })}\n`,
          "utf8",
        );
      },
    });

    expect(advance.dispatched).toBe(false);
    expect(dispatcherCalls).toBe(0);
    expect(
      advance.reason.includes("commit_claimant") ||
        advance.reason.includes("commit_target_claimant") ||
        advance.reason.includes("commit_") ||
        advance.reason.startsWith("dispatch_failed:"),
    ).toBe(true);

    const live = await loadBoardClaimItem(auth, { taskId, itemId: seeded.item.itemId });
    expect(live?.claimantId).toBe("bot-c");
    // Same opKey still present or blocked — stale return must not have dispatched.
    if (live?.pendingEventRelay?.opKey === oldPending.opKey) {
      if (live.pendingEventRelay.status === "pending") {
        expect(advance.dispatched).toBe(false);
      } else {
        expect(["blocked", "unknown"]).toContain(live.pendingEventRelay.status);
      }
    }
  });
});

describe("P2 R5 — ok:false side-effect class (no double effect)", () => {
  test("post-write ok:false keeps unknown; recovery does not produce second side effect", async () => {
    const { cfg, root } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-r5-post-write";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    const submissionId = randomUUID();
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      submissionId,
      artifactVersion: "art-v1",
      submissionSummary: "# Draft\nbody",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });

    const counterPath = path.join(root, "side-effect-count.txt");
    await fs.writeFile(counterPath, "0\n", "utf8");
    const postWriteFail: WakeRoundDispatcher = async () => {
      const n = Number((await fs.readFile(counterPath, "utf8")).trim() || "0") + 1;
      await fs.writeFile(counterPath, `${n}\n`, "utf8");
      return {
        ok: false,
        reason: "execute_collaboration_round_failed",
        message: "simulated after countable write",
        sideEffectClass: "started_or_unknown",
      };
    };

    const first = await triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      actorId: "bot-b",
      cfg,
      roundDispatcher: postWriteFail,
      trusted: trustedLocatorFromAuthority(auth),
    });
    expect(first.dispatched).toBe(false);
    expect(first.pendingRelay).toBe(true);
    expect(first.pendingLifecycle).toBe("unknown");
    expect(Number((await fs.readFile(counterPath, "utf8")).trim())).toBe(1);

    const liveAfter = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(liveAfter?.pendingEventRelay?.status).toBe("unknown");
    expect(liveAfter?.pendingEventRelay?.pendingVerification).toBe(true);
    expect(liveAfter?.pendingEventRelay?.dispatchInvokeStarted).toBe(true);

    // Recovery scan must NOT auto-retry unknown / started-or-unknown.
    const recovered = await recoverPendingBoardEventRelays({
      groupId: auth.groupId,
      taskId,
      actorId: "bot-b",
      items: liveAfter ? [liveAfter] : [],
      cfg,
      roundDispatcher: postWriteFail,
      trusted: trustedLocatorFromAuthority(auth),
      authority: auth,
    });
    expect(recovered).toHaveLength(0);
    expect(Number((await fs.readFile(counterPath, "utf8")).trim())).toBe(1);
  });
});

describe("P2 R5/R6 — permit vs dispatch + subprocess (preinstalled runtime)", () => {
  test("subprocess: permit commit then exit → invalidate then recover; no duplicate; no Corepack download", async () => {
    const { spawnSync } = await import("node:child_process");
    const { cfg, root } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-r6-crash-permit";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    const submissionId = randomUUID();
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      submissionId,
      artifactVersion: "art-v1",
      submissionSummary: "# Draft\nbody",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });

    const counterPath = path.join(root, "crash-side-effect-count.txt");
    const markerPath = path.join(root, "permit-committed.marker");
    const errPath = path.join(root, "child-stderr.txt");
    await fs.writeFile(counterPath, "0\n", "utf8");

    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const childScript = path.join(root, "r6-permit-crash-child.ts");
    const trusted = trustedLocatorFromAuthority(auth);
    const configPath = process.env.OPENBOT_CONFIG_PATH!;
    // Preinstalled runtime only — never `pnpm exec` / Corepack (network download forbidden mid-test).
    const tsxCli = path.join(repoRoot, "node_modules/tsx/dist/cli.mjs");

    await fs.writeFile(
      childScript,
      `
import fs from "node:fs/promises";
import path from "node:path";
import {
  clearConfigCache,
  setRuntimeConfigSnapshot,
} from ${JSON.stringify(path.join(repoRoot, "src/config/config.ts"))};
import { triggerPostSubmissionEventAdvance } from ${JSON.stringify(
        path.join(repoRoot, "src/gateway/collaboration-learning/post-submission-event-advance.ts"),
      )};

const root = process.argv[2];
const groupId = process.argv[3];
const taskId = process.argv[4];
const itemId = process.argv[5];
const counterPath = process.argv[6];
const markerPath = process.argv[7];
const configPath = process.argv[8];
const trustedJson = process.argv[9];

process.env.OPENBOT_STATE_DIR = path.join(root, "state");
process.env.OPENBOT_CONFIG_PATH = configPath;
process.env.OPENCLAW_CONFIG_PATH = configPath;
process.env.OPENBOT_TENANTS_ROOT = path.join(root, "tenants");

async function main() {
  const cfg = JSON.parse(await fs.readFile(configPath, "utf8"));
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  const trusted = trustedJson && trustedJson !== "null" ? JSON.parse(trustedJson) : null;
  await triggerPostSubmissionEventAdvance({
    groupId,
    taskId,
    itemId,
    actorId: "bot-b",
    cfg,
    trusted,
    roundDispatcher: async () => {
      const n = Number((await fs.readFile(counterPath, "utf8")).trim() || "0") + 1;
      await fs.writeFile(counterPath, String(n) + "\\n", "utf8");
      return { ok: true, roundId: "should-not-run-in-crash-child" };
    },
    _testAfterPermitCommitBeforeDispatcher: async () => {
      await fs.writeFile(markerPath, "permit_committed\\n", "utf8");
      process.exit(42);
    },
  });
  process.exit(0);
}

main().catch(async (err) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  await fs.writeFile(path.join(root, "child-stderr.txt"), msg + "\\n", "utf8");
  console.error(msg);
  process.exit(1);
});
`,
      "utf8",
    );

    const child = spawnSync(
      process.execPath,
      [
        tsxCli,
        childScript,
        root,
        auth.groupId,
        taskId,
        item.itemId,
        counterPath,
        markerPath,
        configPath,
        trusted ? JSON.stringify(trusted) : "null",
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          // Forbid Corepack/pnpm network resolution in the child.
          COREPACK_ENABLE_NETWORK: "0",
          COREPACK_ENABLE_AUTO_PIN: "0",
          OPENBOT_STATE_DIR: path.join(root, "state"),
          OPENBOT_CONFIG_PATH: configPath,
          OPENCLAW_CONFIG_PATH: configPath,
          OPENBOT_TENANTS_ROOT: path.join(root, "tenants"),
        },
        cwd: repoRoot,
      },
    );
    if (child.status !== 42) {
      let childErr = child.stderr || "";
      try {
        childErr += `\n${await fs.readFile(errPath, "utf8")}`;
      } catch {
        // ignore
      }
      throw new Error(
        `child exit ${String(child.status)} stdout=${child.stdout?.slice(0, 500)} stderr=${childErr.slice(0, 2000)}`,
      );
    }
    expect((await fs.readFile(markerPath, "utf8")).trim()).toBe("permit_committed");
    expect(Number((await fs.readFile(counterPath, "utf8")).trim())).toBe(0);

    clearConfigCache();
    setRuntimeConfigSnapshot(cfg, cfg);
    const live = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(live?.pendingEventRelay?.status).toBe("dispatched");
    expect(live?.pendingEventRelay?.dispatchInvokeStarted).not.toBe(true);
    const attemptId = live?.pendingEventRelay?.dispatchAttemptId;
    expect(attemptId).toBeTruthy();
    expect(listPermitAcquiredBoardEventRelays(live ? [live] : [])).toHaveLength(1);

    // Heartbeat alone must NOT auto-release / re-dispatch (executor liveness unproven to heartbeat).
    let heartbeatDispatch = 0;
    const heartbeatRecovered = await recoverPendingBoardEventRelays({
      groupId: auth.groupId,
      taskId,
      actorId: "bot-b",
      items: live ? [live] : [],
      cfg,
      roundDispatcher: async () => {
        heartbeatDispatch += 1;
        return { ok: true, roundId: "heartbeat-should-not-run" };
      },
      trusted: trustedLocatorFromAuthority(auth),
      authority: auth,
    });
    expect(heartbeatDispatch).toBe(0);
    expect(heartbeatRecovered.every((r) => !r.dispatched)).toBe(true);
    const afterHb = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(afterHb?.pendingEventRelay?.status).toBe("dispatched");
    expect(afterHb?.pendingEventRelay?.pendingVerification).toBe(true);

    // Proven-dead path (parent observed exit 42): invalidate attempt, then recover.
    const inv = await invalidatePermitAttemptForProvenDeadExecutor({
      authority: auth,
      taskId,
      itemId: item.itemId,
      expectedOpKey: afterHb!.pendingEventRelay!.opKey,
      expectedAttemptId: attemptId!,
      cfg,
    });
    expect(inv.ok).toBe(true);

    let dispatchCount = 0;
    const once: WakeRoundDispatcher = async () => {
      dispatchCount += 1;
      const n = Number((await fs.readFile(counterPath, "utf8")).trim() || "0") + 1;
      await fs.writeFile(counterPath, `${n}\n`, "utf8");
      return { ok: true, roundId: `round-r6-${dispatchCount}` };
    };

    const livePending = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(livePending?.pendingEventRelay?.status).toBe("pending");

    const recovered = await recoverPendingBoardEventRelays({
      groupId: auth.groupId,
      taskId,
      actorId: "bot-b",
      items: livePending ? [livePending] : [],
      cfg,
      roundDispatcher: once,
      trusted: trustedLocatorFromAuthority(auth),
      authority: auth,
    });
    expect(recovered.length).toBeGreaterThanOrEqual(1);
    expect(recovered.some((r) => r.dispatched)).toBe(true);
    expect(dispatchCount).toBe(1);
    expect(Number((await fs.readFile(counterPath, "utf8")).trim())).toBe(1);

    const after = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(after?.pendingEventRelay).toBeNull();

    const again = await recoverPendingBoardEventRelays({
      groupId: auth.groupId,
      taskId,
      actorId: "bot-b",
      items: after ? [after] : [],
      cfg,
      roundDispatcher: once,
      trusted: trustedLocatorFromAuthority(auth),
      authority: auth,
    });
    expect(again).toHaveLength(0);
    expect(dispatchCount).toBe(1);
    expect(Number((await fs.readFile(counterPath, "utf8")).trim())).toBe(1);
    void readWakeOpRecord;
    void reconcilePermitAcquiredBoardEventRelays;
  });
});

describe("P2 R6 — mark-success gate + attempt validity races", () => {
  test("mark write reject → dispatcher not called (dispatcher=0)", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-r6-mark-reject";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      submissionId: randomUUID(),
      artifactVersion: "art-v1",
      submissionSummary: "# Draft\nbody",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });

    let dispatchCount = 0;
    const advance = await triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      actorId: "bot-b",
      cfg,
      trusted: trustedLocatorFromAuthority(auth),
      roundDispatcher: async () => {
        dispatchCount += 1;
        return { ok: true, roundId: "must-not-run" };
      },
      _testMarkInvokeStartedFault: "reject",
    });
    expect(dispatchCount).toBe(0);
    expect(advance.dispatched).toBe(false);
    expect(advance.pendingLifecycle).toBe("unknown");
    const live = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(live?.pendingEventRelay?.pendingVerification).toBe(true);
  });

  test("mark throw → dispatcher not called (dispatcher=0)", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-r6-mark-throw";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      submissionId: randomUUID(),
      artifactVersion: "art-v1",
      submissionSummary: "# Draft\nbody",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });

    let dispatchCount = 0;
    const advance = await triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      actorId: "bot-b",
      cfg,
      trusted: trustedLocatorFromAuthority(auth),
      roundDispatcher: async () => {
        dispatchCount += 1;
        return { ok: true, roundId: "must-not-run" };
      },
      _testMarkInvokeStartedFault: "throw",
    });
    expect(dispatchCount).toBe(0);
    expect(advance.dispatched).toBe(false);
    const live = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(live?.pendingEventRelay?.pendingVerification).toBe(true);
  });

  test("live pause between permit and invoke → heartbeat does not release or re-dispatch", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-r6-live-pause";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      submissionId: randomUUID(),
      artifactVersion: "art-v1",
      submissionSummary: "# Draft\nbody",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });

    let releasePause!: () => void;
    const pause = new Promise<void>((resolve) => {
      releasePause = resolve;
    });
    let reachedPause = false;
    let dispatchCount = 0;

    const liveRun = triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      actorId: "bot-b",
      cfg,
      trusted: trustedLocatorFromAuthority(auth),
      roundDispatcher: async () => {
        dispatchCount += 1;
        return { ok: true, roundId: "live-run" };
      },
      _testAfterPermitCommitBeforeDispatcher: async () => {
        reachedPause = true;
        await pause;
      },
    });

    // Wait until live executor holds permit and is paused before mark/invoke.
    for (let i = 0; i < 200 && !reachedPause; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(reachedPause).toBe(true);
    const mid = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(mid?.pendingEventRelay?.status).toBe("dispatched");
    expect(mid?.pendingEventRelay?.dispatchInvokeStarted).not.toBe(true);
    const attemptId = mid?.pendingEventRelay?.dispatchAttemptId;
    expect(attemptId).toBeTruthy();

    let hbDispatch = 0;
    const hb = await recoverPendingBoardEventRelays({
      groupId: auth.groupId,
      taskId,
      actorId: "bot-b",
      items: mid ? [mid] : [],
      cfg,
      roundDispatcher: async () => {
        hbDispatch += 1;
        return { ok: true, roundId: "hb-must-not" };
      },
      trusted: trustedLocatorFromAuthority(auth),
      authority: auth,
    });
    expect(hbDispatch).toBe(0);
    expect(hb.every((r) => !r.dispatched)).toBe(true);

    const afterHb = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    // Must NOT release to pending (would allow re-dispatch while live run continues).
    expect(afterHb?.pendingEventRelay?.status).toBe("dispatched");
    expect(afterHb?.pendingEventRelay?.dispatchAttemptId).toBe(attemptId);
    expect(afterHb?.pendingEventRelay?.pendingVerification).toBe(true);

    releasePause();
    const finished = await liveRun;
    expect(finished.dispatched).toBe(true);
    expect(dispatchCount).toBe(1);
  });

  test("after invalidate: recovery vs old executor — at most one obtains execution", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-r6-invalidate-race";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      submissionId: randomUUID(),
      artifactVersion: "art-v1",
      submissionSummary: "# Draft\nbody",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });

    let releasePause!: () => void;
    const pause = new Promise<void>((resolve) => {
      releasePause = resolve;
    });
    let reachedPause = false;
    let totalDispatch = 0;

    const countingDispatcher: WakeRoundDispatcher = async () => {
      totalDispatch += 1;
      return { ok: true, roundId: `race-${totalDispatch}` };
    };

    const oldExecutor = triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      actorId: "bot-b",
      cfg,
      trusted: trustedLocatorFromAuthority(auth),
      roundDispatcher: countingDispatcher,
      _testAfterPermitCommitBeforeDispatcher: async () => {
        reachedPause = true;
        await pause;
      },
    });

    for (let i = 0; i < 200 && !reachedPause; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(reachedPause).toBe(true);
    const mid = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    const attemptId = mid?.pendingEventRelay?.dispatchAttemptId;
    const opKey = mid?.pendingEventRelay?.opKey;
    expect(attemptId).toBeTruthy();
    expect(opKey).toBeTruthy();

    const inv = await invalidatePermitAttemptForProvenDeadExecutor({
      authority: auth,
      taskId,
      itemId: item.itemId,
      expectedOpKey: opKey!,
      expectedAttemptId: attemptId!,
      cfg,
    });
    expect(inv.ok).toBe(true);

    const afterInv = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(afterInv?.pendingEventRelay?.status).toBe("pending");

    // Resume old executor (should fail mark / not dispatch) while recovery competes.
    // Recovery retries briefly: old consume may still hold the wake claim until it unwinds.
    releasePause();
    const recovery = (async () => {
      let last: Awaited<ReturnType<typeof recoverPendingBoardEventRelays>> = [];
      for (let i = 0; i < 40; i += 1) {
        const live = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
        if (!live?.pendingEventRelay) {
          return last;
        }
        if (live.pendingEventRelay.status === "pending") {
          last = await recoverPendingBoardEventRelays({
            groupId: auth.groupId,
            taskId,
            actorId: "bot-b",
            items: [live],
            cfg,
            roundDispatcher: countingDispatcher,
            trusted: trustedLocatorFromAuthority(auth),
            authority: auth,
          });
          if (last.some((r) => r.dispatched) || totalDispatch > 0) {
            return last;
          }
        }
        await new Promise((r) => setTimeout(r, 25));
      }
      return last;
    })();

    const [oldResult, recovered] = await Promise.all([oldExecutor, recovery]);
    expect(oldResult.dispatched).toBe(false);
    expect(totalDispatch).toBeLessThanOrEqual(1);
    expect(totalDispatch).toBe(1);
    const recoveryDispatched = recovered.some((r) => r.dispatched);
    expect(recoveryDispatched).toBe(true);
  });
});

describe("P2 R7 — invalidate order: board first, wake attempt-scoped", () => {
  test("counterexample: mark wins first → invalidate reject → wake+board unchanged", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-r7-mark-wins";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      submissionId: randomUUID(),
      artifactVersion: "art-v1",
      submissionSummary: "# Draft\nbody",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });

    let releasePause!: () => void;
    const pause = new Promise<void>((resolve) => {
      releasePause = resolve;
    });
    let reachedPause = false;

    const liveRun = triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      actorId: "bot-b",
      cfg,
      trusted: trustedLocatorFromAuthority(auth),
      roundDispatcher: async () => ({ ok: true, roundId: "r7-mark-wins" }),
      _testAfterPermitCommitBeforeDispatcher: async () => {
        reachedPause = true;
        await pause;
      },
    });

    for (let i = 0; i < 200 && !reachedPause; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(reachedPause).toBe(true);

    const mid = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    const attemptId = mid?.pendingEventRelay?.dispatchAttemptId;
    const opKey = mid?.pendingEventRelay?.opKey;
    expect(attemptId).toBeTruthy();
    expect(opKey).toBeTruthy();

    const wakeBefore = await readWakeOpRecord({ authority: auth, opKey: opKey! });
    expect(wakeBefore?.status).toBe("running");
    const wakeAttemptBefore = wakeBefore?.executionAttemptId;

    // Mark wins first (invoke started) — durable store.
    const marked = await markBoardDispatchInvokeStarted(
      auth,
      {
        taskId,
        itemId: item.itemId,
        expectedOpKey: opKey!,
        expectedAttemptId: attemptId!,
      },
      { cfg },
    );
    expect(marked.ok).toBe(true);

    const beforeInv = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(beforeInv?.pendingEventRelay?.dispatchInvokeStarted).toBe(true);
    expect(beforeInv?.pendingEventRelay?.status).toBe("dispatched");
    expect(beforeInv?.pendingEventRelay?.dispatchAttemptId).toBe(attemptId);

    const inv = await invalidatePermitAttemptForProvenDeadExecutor({
      authority: auth,
      taskId,
      itemId: item.itemId,
      expectedOpKey: opKey!,
      expectedAttemptId: attemptId!,
      cfg,
    });
    expect(inv.ok).toBe(false);
    if (inv.ok) {
      throw new Error("expected invalidate reject after mark won");
    }
    expect(inv.reason).toBe("invalidate_invoke_already_started");

    const afterBoard = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(afterBoard?.pendingEventRelay?.status).toBe("dispatched");
    expect(afterBoard?.pendingEventRelay?.dispatchInvokeStarted).toBe(true);
    expect(afterBoard?.pendingEventRelay?.dispatchAttemptId).toBe(attemptId);

    const wakeAfter = await readWakeOpRecord({ authority: auth, opKey: opKey! });
    expect(wakeAfter?.status).toBe("running");
    expect(wakeAfter?.executionAttemptId).toBe(wakeAttemptBefore);

    releasePause();
    await liveRun;
  });

  test("counterexample: stale/old attempt cleanup late → reject → unchanged", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-r7-stale-attempt";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      submissionId: randomUUID(),
      artifactVersion: "art-v1",
      submissionSummary: "# Draft\nbody",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });

    // Attempt A: permit then proven-dead invalidate (positive not-started path).
    let releaseA!: () => void;
    const pauseA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    let reachedA = false;
    const runA = triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      actorId: "bot-b",
      cfg,
      trusted: trustedLocatorFromAuthority(auth),
      roundDispatcher: async () => ({ ok: true, roundId: "r7-stale-a" }),
      _testAfterPermitCommitBeforeDispatcher: async () => {
        reachedA = true;
        await pauseA;
      },
    });
    for (let i = 0; i < 200 && !reachedA; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(reachedA).toBe(true);
    const midA = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    const attemptA = midA?.pendingEventRelay?.dispatchAttemptId;
    const opKey = midA?.pendingEventRelay?.opKey;
    expect(attemptA).toBeTruthy();
    expect(opKey).toBeTruthy();

    const invA = await invalidatePermitAttemptForProvenDeadExecutor({
      authority: auth,
      taskId,
      itemId: item.itemId,
      expectedOpKey: opKey!,
      expectedAttemptId: attemptA!,
      cfg,
    });
    expect(invA.ok).toBe(true);
    releaseA();
    await runA;

    const afterA = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(afterA?.pendingEventRelay?.status).toBe("pending");

    // Attempt B: new permit on same opKey.
    let releaseB!: () => void;
    const pauseB = new Promise<void>((resolve) => {
      releaseB = resolve;
    });
    let reachedB = false;
    let dispatchB = 0;
    const runB = triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      actorId: "bot-b",
      cfg,
      trusted: trustedLocatorFromAuthority(auth),
      roundDispatcher: async () => {
        dispatchB += 1;
        return { ok: true, roundId: "r7-stale-b" };
      },
      _testAfterPermitCommitBeforeDispatcher: async () => {
        reachedB = true;
        await pauseB;
      },
    });
    for (let i = 0; i < 200 && !reachedB; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(reachedB).toBe(true);

    const midB = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    const attemptB = midB?.pendingEventRelay?.dispatchAttemptId;
    expect(attemptB).toBeTruthy();
    expect(attemptB).not.toBe(attemptA);
    expect(midB?.pendingEventRelay?.status).toBe("dispatched");

    const wakeBefore = await readWakeOpRecord({ authority: auth, opKey: opKey! });
    expect(wakeBefore?.status).toBe("running");
    const wakeAttemptB = wakeBefore?.executionAttemptId;
    expect(wakeAttemptB).toBeTruthy();

    // Late cleanup for OLD attempt A must reject; persistent state unchanged.
    const late = await invalidatePermitAttemptForProvenDeadExecutor({
      authority: auth,
      taskId,
      itemId: item.itemId,
      expectedOpKey: opKey!,
      expectedAttemptId: attemptA!,
      cfg,
    });
    expect(late.ok).toBe(false);
    if (late.ok) {
      throw new Error("expected stale attempt invalidate reject");
    }
    expect(late.reason).toBe("invalidate_attempt_mismatch");

    const afterLate = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(afterLate?.pendingEventRelay?.status).toBe("dispatched");
    expect(afterLate?.pendingEventRelay?.dispatchAttemptId).toBe(attemptB);
    expect(afterLate?.pendingEventRelay?.dispatchInvokeStarted).not.toBe(true);

    const wakeAfter = await readWakeOpRecord({ authority: auth, opKey: opKey! });
    expect(wakeAfter?.status).toBe("running");
    expect(wakeAfter?.executionAttemptId).toBe(wakeAttemptB);

    releaseB();
    const finishedB = await runB;
    expect(finishedB.dispatched).toBe(true);
    expect(dispatchB).toBe(1);
  });

  test("counterexample: unknown wake → reject → unchanged pending-verification", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-r7-unknown-wake";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      submissionId: randomUUID(),
      artifactVersion: "art-v1",
      submissionSummary: "# Draft\nbody",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });

    let releasePause!: () => void;
    const pause = new Promise<void>((resolve) => {
      releasePause = resolve;
    });
    let reachedPause = false;
    const liveRun = triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      actorId: "bot-b",
      cfg,
      trusted: trustedLocatorFromAuthority(auth),
      roundDispatcher: async () => ({ ok: true, roundId: "r7-unknown" }),
      _testAfterPermitCommitBeforeDispatcher: async () => {
        reachedPause = true;
        await pause;
      },
    });
    for (let i = 0; i < 200 && !reachedPause; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(reachedPause).toBe(true);

    const mid = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    const attemptId = mid?.pendingEventRelay?.dispatchAttemptId;
    const opKey = mid?.pendingEventRelay?.opKey;
    expect(attemptId).toBeTruthy();
    expect(opKey).toBeTruthy();

    const unknowned = await markWakeOpUnknown({
      authority: auth,
      opKey: opKey!,
      cfg,
      detail: "r7_manual_unknown_pending_verification",
    });
    expect(unknowned?.status).toBe("unknown");
    const wakeAttempt = unknowned?.executionAttemptId;

    // Ensure board shows pendingVerification (heartbeat-style) without release.
    const reconciled = await reconcilePermitAcquiredBoardEventRelays({
      authority: auth,
      items: mid ? [mid] : [],
      cfg,
    });
    expect(reconciled.some((r) => r.pendingVerification)).toBe(true);

    const beforeInv = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(beforeInv?.pendingEventRelay?.status).toBe("dispatched");
    expect(beforeInv?.pendingEventRelay?.pendingVerification).toBe(true);
    expect(beforeInv?.pendingEventRelay?.dispatchAttemptId).toBe(attemptId);

    const inv = await invalidatePermitAttemptForProvenDeadExecutor({
      authority: auth,
      taskId,
      itemId: item.itemId,
      expectedOpKey: opKey!,
      expectedAttemptId: attemptId!,
      cfg,
    });
    expect(inv.ok).toBe(false);
    if (inv.ok) {
      throw new Error("expected unknown-wake invalidate reject");
    }
    expect(inv.reason).toBe("invalidate_wake_unknown_pending_verification");

    const afterBoard = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(afterBoard?.pendingEventRelay?.status).toBe("dispatched");
    expect(afterBoard?.pendingEventRelay?.pendingVerification).toBe(true);
    expect(afterBoard?.pendingEventRelay?.dispatchAttemptId).toBe(attemptId);

    const wakeAfter = await readWakeOpRecord({ authority: auth, opKey: opKey! });
    expect(wakeAfter?.status).toBe("unknown");
    expect(wakeAfter?.executionAttemptId).toBe(wakeAttempt);

    releasePause();
    await liveRun;
  });

  test("positive: permit not-started + proven-dead invalidate → recover once", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-r7-positive-recover";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      submissionId: randomUUID(),
      artifactVersion: "art-v1",
      submissionSummary: "# Draft\nbody",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });

    let releasePause!: () => void;
    const pause = new Promise<void>((resolve) => {
      releasePause = resolve;
    });
    let reachedPause = false;
    const oldRun = triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      actorId: "bot-b",
      cfg,
      trusted: trustedLocatorFromAuthority(auth),
      roundDispatcher: async () => ({ ok: true, roundId: "r7-old-must-not" }),
      _testAfterPermitCommitBeforeDispatcher: async () => {
        reachedPause = true;
        await pause;
      },
    });
    for (let i = 0; i < 200 && !reachedPause; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(reachedPause).toBe(true);

    const mid = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    const attemptId = mid?.pendingEventRelay?.dispatchAttemptId;
    const opKey = mid?.pendingEventRelay?.opKey;
    expect(attemptId).toBeTruthy();
    expect(opKey).toBeTruthy();
    expect(mid?.pendingEventRelay?.dispatchInvokeStarted).not.toBe(true);

    const inv = await invalidatePermitAttemptForProvenDeadExecutor({
      authority: auth,
      taskId,
      itemId: item.itemId,
      expectedOpKey: opKey!,
      expectedAttemptId: attemptId!,
      cfg,
    });
    expect(inv.ok).toBe(true);

    const wakeAfterInv = await readWakeOpRecord({ authority: auth, opKey: opKey! });
    expect(wakeAfterInv?.status).toBe("failed");

    const pending = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(pending?.pendingEventRelay?.status).toBe("pending");

    releasePause();
    const oldResult = await oldRun;
    expect(oldResult.dispatched).toBe(false);

    let dispatchCount = 0;
    const recovered = await recoverPendingBoardEventRelays({
      groupId: auth.groupId,
      taskId,
      actorId: "bot-b",
      items: pending ? [pending] : [],
      cfg,
      roundDispatcher: async () => {
        dispatchCount += 1;
        return { ok: true, roundId: `r7-recover-${dispatchCount}` };
      },
      trusted: trustedLocatorFromAuthority(auth),
      authority: auth,
    });
    expect(recovered.some((r) => r.dispatched)).toBe(true);
    expect(dispatchCount).toBe(1);
  });
});

describe("P2 R8 — wake conditional-commit: original binding + running CAS", () => {
  async function pauseAtPermit(params: {
    auth: RuntimeAuthority;
    cfg: OpenBotConfig;
    taskId: string;
    itemId: string;
    roundId: string;
  }) {
    let releasePause!: () => void;
    const pause = new Promise<void>((resolve) => {
      releasePause = resolve;
    });
    let reachedPause = false;
    const liveRun = triggerPostSubmissionEventAdvance({
      groupId: params.auth.groupId,
      taskId: params.taskId,
      itemId: params.itemId,
      actorId: "bot-b",
      cfg: params.cfg,
      trusted: trustedLocatorFromAuthority(params.auth),
      roundDispatcher: async () => ({ ok: true, roundId: params.roundId }),
      _testAfterPermitCommitBeforeDispatcher: async () => {
        reachedPause = true;
        await pause;
      },
    });
    for (let i = 0; i < 200 && !reachedPause; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(reachedPause).toBe(true);
    const mid = await loadBoardClaimItem(params.auth, {
      taskId: params.taskId,
      itemId: params.itemId,
    });
    const attemptId = mid?.pendingEventRelay?.dispatchAttemptId;
    const opKey = mid?.pendingEventRelay?.opKey;
    const boundWake = mid?.pendingEventRelay?.boundWakeExecutionAttemptId;
    expect(attemptId).toBeTruthy();
    expect(opKey).toBeTruthy();
    expect(boundWake).toBeTruthy();
    const wake = await readWakeOpRecord({ authority: params.auth, opKey: opKey! });
    expect(wake?.status).toBe("running");
    expect(wake?.executionAttemptId).toBe(boundWake);
    return {
      releasePause,
      liveRun,
      mid,
      attemptId: attemptId!,
      opKey: opKey!,
      boundWake: boundWake!,
    };
  }

  test("mid-cleanup: new wake attempt must not be failed by old cleanup", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-r8-mid-new-attempt";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      submissionId: randomUUID(),
      artifactVersion: "art-v1",
      submissionSummary: "# Draft\nbody",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });

    const paused = await pauseAtPermit({
      auth,
      cfg,
      taskId,
      itemId: item.itemId,
      roundId: "r8-mid-new",
    });
    const boundA = paused.boundWake;

    let injectedAttemptB: string | undefined;
    const inv = await invalidatePermitAttemptForProvenDeadExecutor({
      authority: auth,
      taskId,
      itemId: item.itemId,
      expectedOpKey: paused.opKey,
      expectedAttemptId: paused.attemptId,
      cfg,
      _testAfterBoardInvalidateBeforeWakeFail: async () => {
        // Simulate concurrent reclaim creating a new wake attempt mid-cleanup.
        await markWakeOpFailed({
          authority: auth,
          opKey: paused.opKey,
          cfg,
          detail: "r8_inject_fail_before_reclaim",
        });
        const claimed = await claimWakeOpRunning({
          authority: auth,
          keyInput: {
            groupId: auth.groupId,
            source: "nudge",
            fromAgentId: "bot-a",
            toAgentIds: ["bot-b"],
            taskId,
            itemId: item.itemId,
            opKey: paused.opKey,
          },
          cfg,
        });
        expect(claimed.action).toBe("proceed");
        injectedAttemptB = claimed.record?.executionAttemptId;
        expect(injectedAttemptB).toBeTruthy();
        expect(injectedAttemptB).not.toBe(boundA);
      },
    });
    expect(inv.ok).toBe(true);

    const wakeAfter = await readWakeOpRecord({ authority: auth, opKey: paused.opKey });
    expect(wakeAfter?.executionAttemptId).toBe(injectedAttemptB);
    // Old cleanup must NOT have failed the new attempt.
    expect(wakeAfter?.status).toBe("running");
    expect(wakeAfter?.executionAttemptId).not.toBe(boundA);

    const boardAfter = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(boardAfter?.pendingEventRelay?.status).toBe("pending");
    // Binding cleared after conditional wake CAS (safe reject on attempt mismatch).
    expect(boardAfter?.pendingEventRelay?.boundWakeExecutionAttemptId).toBeFalsy();

    paused.releasePause();
    await paused.liveRun;
  });

  test("mid-cleanup: same attempt → unknown must not become failed", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-r8-mid-unknown";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      submissionId: randomUUID(),
      artifactVersion: "art-v1",
      submissionSummary: "# Draft\nbody",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });

    const paused = await pauseAtPermit({
      auth,
      cfg,
      taskId,
      itemId: item.itemId,
      roundId: "r8-mid-unknown",
    });

    const inv = await invalidatePermitAttemptForProvenDeadExecutor({
      authority: auth,
      taskId,
      itemId: item.itemId,
      expectedOpKey: paused.opKey,
      expectedAttemptId: paused.attemptId,
      cfg,
      _testAfterBoardInvalidateBeforeWakeFail: async () => {
        const unknowned = await markWakeOpUnknown({
          authority: auth,
          opKey: paused.opKey,
          cfg,
          detail: "r8_mid_cleanup_unknown",
        });
        expect(unknowned?.status).toBe("unknown");
        expect(unknowned?.executionAttemptId).toBe(paused.boundWake);
      },
    });
    expect(inv.ok).toBe(true);

    const wakeAfter = await readWakeOpRecord({ authority: auth, opKey: paused.opKey });
    expect(wakeAfter?.status).toBe("unknown");
    expect(wakeAfter?.executionAttemptId).toBe(paused.boundWake);

    const boardAfter = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(boardAfter?.pendingEventRelay?.status).toBe("pending");
    expect(boardAfter?.pendingEventRelay?.boundWakeExecutionAttemptId).toBeFalsy();

    paused.releasePause();
    await paused.liveRun;
  });

  test("mid-cleanup: same attempt → completed must not become failed", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-r8-mid-completed";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      submissionId: randomUUID(),
      artifactVersion: "art-v1",
      submissionSummary: "# Draft\nbody",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });

    const paused = await pauseAtPermit({
      auth,
      cfg,
      taskId,
      itemId: item.itemId,
      roundId: "r8-mid-completed",
    });

    const inv = await invalidatePermitAttemptForProvenDeadExecutor({
      authority: auth,
      taskId,
      itemId: item.itemId,
      expectedOpKey: paused.opKey,
      expectedAttemptId: paused.attemptId,
      cfg,
      _testAfterBoardInvalidateBeforeWakeFail: async () => {
        const completed = await markWakeOpCompleted({
          authority: auth,
          opKey: paused.opKey,
          roundId: "r8-mid-completed-receipt",
          cfg,
          detail: "r8_mid_cleanup_completed",
        });
        expect(completed?.status).toBe("completed");
        expect(completed?.executionAttemptId).toBe(paused.boundWake);
      },
    });
    expect(inv.ok).toBe(true);

    const wakeAfter = await readWakeOpRecord({ authority: auth, opKey: paused.opKey });
    expect(wakeAfter?.status).toBe("completed");
    expect(wakeAfter?.executionAttemptId).toBe(paused.boundWake);
    expect(wakeAfter?.roundId).toBe("r8-mid-completed-receipt");

    const boardAfter = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(boardAfter?.pendingEventRelay?.status).toBe("pending");
    expect(boardAfter?.pendingEventRelay?.boundWakeExecutionAttemptId).toBeFalsy();

    paused.releasePause();
    await paused.liveRun;
  });

  test("positive: permit binds wake attempt; invalidate → failed → recover once", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-r8-positive-bind-recover";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      submissionId: randomUUID(),
      artifactVersion: "art-v1",
      submissionSummary: "# Draft\nbody",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });

    const paused = await pauseAtPermit({
      auth,
      cfg,
      taskId,
      itemId: item.itemId,
      roundId: "r8-pos-old",
    });

    const inv = await invalidatePermitAttemptForProvenDeadExecutor({
      authority: auth,
      taskId,
      itemId: item.itemId,
      expectedOpKey: paused.opKey,
      expectedAttemptId: paused.attemptId,
      cfg,
    });
    expect(inv.ok).toBe(true);

    const wakeAfterInv = await readWakeOpRecord({ authority: auth, opKey: paused.opKey });
    expect(wakeAfterInv?.status).toBe("failed");
    expect(wakeAfterInv?.executionAttemptId).toBe(paused.boundWake);

    const pending = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(pending?.pendingEventRelay?.status).toBe("pending");
    expect(pending?.pendingEventRelay?.boundWakeExecutionAttemptId).toBeFalsy();

    paused.releasePause();
    const oldResult = await paused.liveRun;
    expect(oldResult.dispatched).toBe(false);

    let dispatchCount = 0;
    const recovered = await recoverPendingBoardEventRelays({
      groupId: auth.groupId,
      taskId,
      actorId: "bot-b",
      items: pending ? [pending] : [],
      cfg,
      roundDispatcher: async () => {
        dispatchCount += 1;
        return { ok: true, roundId: `r8-recover-${dispatchCount}` };
      },
      trusted: trustedLocatorFromAuthority(auth),
      authority: auth,
    });
    expect(recovered.some((r) => r.dispatched)).toBe(true);
    expect(dispatchCount).toBe(1);
  });
});

describe("P2 R9 — deferred cleanup unverifiable must retain binding + stop advance", () => {
  async function seedPausedWithBinding(params: { taskId: string; roundId: string }) {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId: params.taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, params.taskId);
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId: params.taskId,
      itemId: item.itemId,
      submissionId: randomUUID(),
      artifactVersion: "art-v1",
      submissionSummary: "# Draft\nbody",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });

    let releasePause!: () => void;
    const pause = new Promise<void>((resolve) => {
      releasePause = resolve;
    });
    let reachedPause = false;
    const liveRun = triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId: params.taskId,
      itemId: item.itemId,
      actorId: "bot-b",
      cfg,
      trusted: trustedLocatorFromAuthority(auth),
      roundDispatcher: async () => ({ ok: true, roundId: params.roundId }),
      _testAfterPermitCommitBeforeDispatcher: async () => {
        reachedPause = true;
        await pause;
      },
    });
    for (let i = 0; i < 200 && !reachedPause; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(reachedPause).toBe(true);

    const mid = await loadBoardClaimItem(auth, {
      taskId: params.taskId,
      itemId: item.itemId,
    });
    const attemptId = mid?.pendingEventRelay?.dispatchAttemptId;
    const opKey = mid?.pendingEventRelay?.opKey;
    const boundWake = mid?.pendingEventRelay?.boundWakeExecutionAttemptId;
    expect(attemptId).toBeTruthy();
    expect(opKey).toBeTruthy();
    expect(boundWake).toBeTruthy();

    // Board invalidate only — leave two-write crash window (binding retained, wake running).
    const inv = await invalidateBoardDispatchPermitAttempt(
      auth,
      {
        taskId: params.taskId,
        itemId: item.itemId,
        expectedOpKey: opKey!,
        expectedAttemptId: attemptId!,
      },
      { cfg },
    );
    expect(inv.ok).toBe(true);

    const pending = await loadBoardClaimItem(auth, {
      taskId: params.taskId,
      itemId: item.itemId,
    });
    expect(pending?.pendingEventRelay?.status).toBe("pending");
    expect(pending?.pendingEventRelay?.boundWakeExecutionAttemptId).toBe(boundWake);
    expect(pending?.pendingEventRelay?.dispatchAttemptId).toBeFalsy();

    const wake = await readWakeOpRecord({ authority: auth, opKey: opKey! });
    expect(wake?.status).toBe("running");
    expect(wake?.executionAttemptId).toBe(boundWake);

    return {
      cfg,
      auth,
      taskId: params.taskId,
      itemId: item.itemId,
      opKey: opKey!,
      boundWake: boundWake!,
      pending: pending!,
      releasePause,
      liveRun,
    };
  }

  async function assertFaultStopsRedispatch(
    fault: "wake_read_throw" | "wake_cas_throw" | "clear_binding_throw",
  ) {
    const seeded = await seedPausedWithBinding({
      taskId: `task-p2-r9-${fault}`,
      roundId: `r9-${fault}-old`,
    });

    let dispatchCount = 0;
    const blocked = await recoverPendingBoardEventRelays({
      groupId: seeded.auth.groupId,
      taskId: seeded.taskId,
      actorId: "bot-b",
      items: [seeded.pending],
      cfg: seeded.cfg,
      roundDispatcher: async () => {
        dispatchCount += 1;
        return { ok: true, roundId: "must-not-run" };
      },
      trusted: trustedLocatorFromAuthority(seeded.auth),
      authority: seeded.auth,
      _testDeferredCleanupFault: fault,
    });
    expect(dispatchCount).toBe(0);
    expect(blocked.every((r) => !r.dispatched)).toBe(true);
    expect(blocked.some((r) => r.reason.startsWith("deferred_wake_cleanup_unverifiable:"))).toBe(
      true,
    );
    expect(blocked.some((r) => r.pendingLifecycle === "unknown")).toBe(true);

    const midBoard = await loadBoardClaimItem(seeded.auth, {
      taskId: seeded.taskId,
      itemId: seeded.itemId,
    });
    expect(midBoard?.pendingEventRelay?.boundWakeExecutionAttemptId).toBe(seeded.boundWake);

    // Direct cleanup under same fault must also refuse to clear.
    const direct = await finishDeferredWakeFailBeforeRedispatch({
      authority: seeded.auth,
      item: midBoard!,
      cfg: seeded.cfg,
      _testDeferredCleanupFault: fault,
    });
    expect(direct.outcome).toBe("unverifiable");
    expect(direct.clearedBinding).toBe(false);

    // After fault cleared, recovery may proceed safely.
    let recoverCount = 0;
    const recovered = await recoverPendingBoardEventRelays({
      groupId: seeded.auth.groupId,
      taskId: seeded.taskId,
      actorId: "bot-b",
      items: midBoard ? [midBoard] : [],
      cfg: seeded.cfg,
      roundDispatcher: async () => {
        recoverCount += 1;
        return { ok: true, roundId: `r9-recover-${fault}-${recoverCount}` };
      },
      trusted: trustedLocatorFromAuthority(seeded.auth),
      authority: seeded.auth,
    });
    expect(recovered.some((r) => r.dispatched)).toBe(true);
    expect(recoverCount).toBe(1);

    const after = await loadBoardClaimItem(seeded.auth, {
      taskId: seeded.taskId,
      itemId: seeded.itemId,
    });
    expect(after?.pendingEventRelay?.boundWakeExecutionAttemptId).toBeFalsy();

    seeded.releasePause();
    await seeded.liveRun;
  }

  test("wake read throws → binding retained, dispatcher=0; then recover", async () => {
    await assertFaultStopsRedispatch("wake_read_throw");
  });

  test("CAS write throws → binding retained, dispatcher=0; then recover", async () => {
    await assertFaultStopsRedispatch("wake_cas_throw");
  });

  test("binding clear fails → binding retained, dispatcher=0; then recover", async () => {
    await assertFaultStopsRedispatch("clear_binding_throw");
  });
});

describe("P2 R10 — CAS null/corrupt must not be safe reject (shared判定)", () => {
  test("classifyConditionalWakeFailCasResult: null → unverifiable; failed → completed; other → determined", () => {
    expect(
      classifyConditionalWakeFailCasResult({ after: null, expectedAttemptId: "att-a" }).outcome,
    ).toBe("unverifiable");
    expect(
      classifyConditionalWakeFailCasResult({
        after: {
          opKey: "k",
          groupId: "g",
          source: "nudge",
          fromAgentId: "a",
          toAgentIds: ["b"],
          status: "failed",
          executionAttemptId: "att-a",
          createdAtMs: 1,
          updatedAtMs: 1,
        },
        expectedAttemptId: "att-a",
      }).outcome,
    ).toBe("completed");
    expect(
      classifyConditionalWakeFailCasResult({
        after: {
          opKey: "k",
          groupId: "g",
          source: "nudge",
          fromAgentId: "a",
          toAgentIds: ["b"],
          status: "unknown",
          executionAttemptId: "att-a",
          createdAtMs: 1,
          updatedAtMs: 1,
        },
        expectedAttemptId: "att-a",
      }).outcome,
    ).toBe("determined_no_change_needed");
    expect(
      classifyConditionalWakeFailCasResult({
        after: {
          opKey: "k",
          groupId: "g",
          source: "nudge",
          fromAgentId: "a",
          toAgentIds: ["b"],
          status: "running",
          executionAttemptId: "att-b",
          createdAtMs: 1,
          updatedAtMs: 1,
        },
        expectedAttemptId: "att-a",
      }).outcome,
    ).toBe("determined_no_change_needed");
  });

  async function seedR10CrashWindow(params: { taskId: string; roundId: string }) {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId: params.taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, params.taskId);
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId: params.taskId,
      itemId: item.itemId,
      submissionId: randomUUID(),
      artifactVersion: "art-v1",
      submissionSummary: "# Draft\nbody",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });

    let releasePause!: () => void;
    const pause = new Promise<void>((resolve) => {
      releasePause = resolve;
    });
    let reachedPause = false;
    const liveRun = triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId: params.taskId,
      itemId: item.itemId,
      actorId: "bot-b",
      cfg,
      trusted: trustedLocatorFromAuthority(auth),
      roundDispatcher: async () => ({ ok: true, roundId: params.roundId }),
      _testAfterPermitCommitBeforeDispatcher: async () => {
        reachedPause = true;
        await pause;
      },
    });
    for (let i = 0; i < 200 && !reachedPause; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(reachedPause).toBe(true);

    const mid = await loadBoardClaimItem(auth, {
      taskId: params.taskId,
      itemId: item.itemId,
    });
    const attemptId = mid?.pendingEventRelay?.dispatchAttemptId;
    const opKey = mid?.pendingEventRelay?.opKey;
    const boundWake = mid?.pendingEventRelay?.boundWakeExecutionAttemptId;
    expect(attemptId).toBeTruthy();
    expect(opKey).toBeTruthy();
    expect(boundWake).toBeTruthy();

    const inv = await invalidateBoardDispatchPermitAttempt(
      auth,
      {
        taskId: params.taskId,
        itemId: item.itemId,
        expectedOpKey: opKey!,
        expectedAttemptId: attemptId!,
      },
      { cfg },
    );
    expect(inv.ok).toBe(true);

    const pending = await loadBoardClaimItem(auth, {
      taskId: params.taskId,
      itemId: item.itemId,
    });
    expect(pending?.pendingEventRelay?.status).toBe("pending");
    expect(pending?.pendingEventRelay?.boundWakeExecutionAttemptId).toBe(boundWake);
    expect(pending?.pendingEventRelay?.dispatchAttemptId).toBeFalsy();

    const wake = await readWakeOpRecord({ authority: auth, opKey: opKey! });
    expect(wake?.status).toBe("running");
    expect(wake?.executionAttemptId).toBe(boundWake);

    return {
      cfg,
      auth,
      taskId: params.taskId,
      itemId: item.itemId,
      opKey: opKey!,
      boundWake: boundWake!,
      pending: pending!,
      releasePause,
      liveRun,
    };
  }

  test("deferred: read ok then wake file deleted before CAS → unverifiable, binding retained, dispatcher=0", async () => {
    const seeded = await seedR10CrashWindow({
      taskId: "task-p2-r10-cas-null-deleted",
      roundId: "r10-deleted-old",
    });

    const direct = await finishDeferredWakeFailBeforeRedispatch({
      authority: seeded.auth,
      item: seeded.pending,
      cfg: seeded.cfg,
      _testAfterWakeReadBeforeCas: async () => {
        await fs.unlink(wakeOpRecordPath(seeded.auth, seeded.opKey));
      },
    });
    expect(direct.outcome).toBe("unverifiable");
    expect(direct.clearedBinding).toBe(false);
    expect(direct.reason).toBe("wake_cas_null_corrupt_or_missing");

    const midBoard = await loadBoardClaimItem(seeded.auth, {
      taskId: seeded.taskId,
      itemId: seeded.itemId,
    });
    expect(midBoard?.pendingEventRelay?.boundWakeExecutionAttemptId).toBe(seeded.boundWake);

    let dispatchCount = 0;
    const blocked = await recoverPendingBoardEventRelays({
      groupId: seeded.auth.groupId,
      taskId: seeded.taskId,
      actorId: "bot-b",
      items: midBoard ? [midBoard] : [],
      cfg: seeded.cfg,
      roundDispatcher: async () => {
        dispatchCount += 1;
        return { ok: true, roundId: "must-not-run-r10-deleted" };
      },
      trusted: trustedLocatorFromAuthority(seeded.auth),
      authority: seeded.auth,
      // recover's finishDeferred will also see missing on pre-read → unverifiable
    });
    expect(dispatchCount).toBe(0);
    expect(blocked.every((r) => !r.dispatched)).toBe(true);
    expect(blocked.some((r) => r.reason.startsWith("deferred_wake_cleanup_unverifiable:"))).toBe(
      true,
    );

    const after = await loadBoardClaimItem(seeded.auth, {
      taskId: seeded.taskId,
      itemId: seeded.itemId,
    });
    expect(after?.pendingEventRelay?.boundWakeExecutionAttemptId).toBe(seeded.boundWake);

    seeded.releasePause();
    await seeded.liveRun;
  });

  test("deferred: read ok then wake file corrupt before CAS → unverifiable, binding retained, dispatcher=0", async () => {
    const seeded = await seedR10CrashWindow({
      taskId: "task-p2-r10-cas-null-corrupt",
      roundId: "r10-corrupt-old",
    });

    const direct = await finishDeferredWakeFailBeforeRedispatch({
      authority: seeded.auth,
      item: seeded.pending,
      cfg: seeded.cfg,
      _testAfterWakeReadBeforeCas: async () => {
        await fs.writeFile(wakeOpRecordPath(seeded.auth, seeded.opKey), "{not-json", "utf8");
      },
    });
    expect(direct.outcome).toBe("unverifiable");
    expect(direct.clearedBinding).toBe(false);
    expect(direct.reason).toBe("wake_cas_null_corrupt_or_missing");

    const midBoard = await loadBoardClaimItem(seeded.auth, {
      taskId: seeded.taskId,
      itemId: seeded.itemId,
    });
    expect(midBoard?.pendingEventRelay?.boundWakeExecutionAttemptId).toBe(seeded.boundWake);

    let dispatchCount = 0;
    const blocked = await recoverPendingBoardEventRelays({
      groupId: seeded.auth.groupId,
      taskId: seeded.taskId,
      actorId: "bot-b",
      items: midBoard ? [midBoard] : [],
      cfg: seeded.cfg,
      roundDispatcher: async () => {
        dispatchCount += 1;
        return { ok: true, roundId: "must-not-run-r10-corrupt" };
      },
      trusted: trustedLocatorFromAuthority(seeded.auth),
      authority: seeded.auth,
    });
    expect(dispatchCount).toBe(0);
    expect(blocked.every((r) => !r.dispatched)).toBe(true);
    expect(blocked.some((r) => r.reason.startsWith("deferred_wake_cleanup_unverifiable:"))).toBe(
      true,
    );
    expect(midBoard?.pendingEventRelay?.boundWakeExecutionAttemptId).toBe(seeded.boundWake);

    seeded.releasePause();
    await seeded.liveRun;
  });

  test("immediate invalidate: wake deleted after board CAS → binding retained (shared判定)", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p2-r10-imm-cas-null";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    const link = await seedLink(auth, taskId);
    await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      submissionId: randomUUID(),
      artifactVersion: "art-v1",
      submissionSummary: "# Draft\nbody",
      ...link,
      actor: "bot-a",
      cfg,
      relayAdvance: false,
    });

    let releasePause!: () => void;
    const pause = new Promise<void>((resolve) => {
      releasePause = resolve;
    });
    let reachedPause = false;
    const liveRun = triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      actorId: "bot-b",
      cfg,
      trusted: trustedLocatorFromAuthority(auth),
      roundDispatcher: async () => ({ ok: true, roundId: "r10-imm-old" }),
      _testAfterPermitCommitBeforeDispatcher: async () => {
        reachedPause = true;
        await pause;
      },
    });
    for (let i = 0; i < 200 && !reachedPause; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(reachedPause).toBe(true);

    const mid = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    const attemptId = mid?.pendingEventRelay?.dispatchAttemptId;
    const opKey = mid?.pendingEventRelay?.opKey;
    const boundWake = mid?.pendingEventRelay?.boundWakeExecutionAttemptId;
    expect(attemptId && opKey && boundWake).toBeTruthy();

    const inv = await invalidatePermitAttemptForProvenDeadExecutor({
      authority: auth,
      taskId,
      itemId: item.itemId,
      expectedOpKey: opKey!,
      expectedAttemptId: attemptId!,
      cfg,
      _testAfterBoardInvalidateBeforeWakeFail: async () => {
        await fs.unlink(wakeOpRecordPath(auth, opKey!));
      },
    });
    expect(inv.ok).toBe(true);

    const boardAfter = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(boardAfter?.pendingEventRelay?.status).toBe("pending");
    // CAS null → unverifiable → binding retained (same判定 as deferred).
    expect(boardAfter?.pendingEventRelay?.boundWakeExecutionAttemptId).toBe(boundWake);

    releasePause();
    await liveRun;
  });
});

function viRespond() {
  const calls: unknown[][] = [];
  const fn = (...args: unknown[]) => {
    calls.push(args);
  };
  return Object.assign(fn, { calls });
}

// silence unused in case tree-shaking
void listPendingBoardEventRelays;
void listPermitAcquiredBoardEventRelays;
void sha256;
