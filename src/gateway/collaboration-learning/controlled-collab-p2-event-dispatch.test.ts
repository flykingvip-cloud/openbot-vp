/**
 * P2 acceptance matrix (synthetic tenant, executor A, reviewer B, short MD).
 * R2: paired proofs for deliverable verify, pending lifecycle, trusted recovery,
 * return binding / supersede barriers.
 */
import { createHash, randomUUID } from "node:crypto";
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
import {
  acceptBoardItemSubmission,
  applyClaim,
  claimBoardItem,
  loadBoardClaimItem,
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
import type { WakeRoundDispatcher } from "../collaboration-dispatch/wake-round-dispatch.js";
import {
  acceptCollaborationBoardItemSubmission,
  returnCollaborationBoardItemSubmission,
  submitCollaborationBoardItemForReview,
} from "./claim-contract-entry.js";
import {
  classifyConsumePendingLifecycle,
  listPendingBoardEventRelays,
  recoverPendingBoardEventRelays,
  triggerPostSubmissionEventAdvance,
} from "./post-submission-event-advance.js";
import {
  P2_LINKED_DELIVERABLE_FIXTURE_BODY,
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
    const seenBindings: Array<{ todolistId?: string; version?: number }> = [];
    const dispatcher: WakeRoundDispatcher = async (req) => {
      calls += 1;
      seenBindings.push({
        todolistId: req.planConfirmBinding?.todolistId,
        version: req.planConfirmBinding?.confirmedVersion,
      });
      expect(req.toAgentIds).toContain("bot-a");
      expect(req.planConfirmBinding?.todolistId).toBe(seeded.todolistId);
      expect(req.planConfirmBinding?.confirmedVersion).toBe(seeded.planVersion);
      return { ok: true, roundId: `ret-round-${calls}` };
    };
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

function viRespond() {
  const calls: unknown[][] = [];
  const fn = (...args: unknown[]) => {
    calls.push(args);
  };
  return Object.assign(fn, { calls });
}

// silence unused in case tree-shaking
void listPendingBoardEventRelays;
void sha256;
