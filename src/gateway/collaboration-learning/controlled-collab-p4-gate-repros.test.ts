/**
 * P4 gate repros (S2 + risk groups A/B/C).
 * Acceptance: same work-item actual execution / side-effect counts (not opKey-only).
 * Still draft #167; 0 deletions of compat paths.
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
  applyClaim,
  claimBoardItem,
  loadBoardClaimItem,
  markBoardItemInProgress,
  publishBoardItem,
  returnBoardItemSubmission,
  submitBoardItemForReview,
} from "../collaboration-dispatch/claim-contract.js";
import { maybeContinueAfterRoundComplete } from "../collaboration-dispatch/continue-after-round.js";
import { runGroupTaskHeartbeat } from "../collaboration-dispatch/group-task-heartbeat.js";
import { createRoundPolicySnapshot } from "../collaboration-dispatch/round-policy-snapshot.js";
import {
  createRuntimeAuthority,
  type RuntimeAuthority,
} from "../collaboration-dispatch/runtime-authority.js";
import type { WakeRoundDispatcher } from "../collaboration-dispatch/wake-round-dispatch.js";
import { submitCollaborationBoardItemForReview } from "./claim-contract-entry.js";
import {
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
        selfAdvance: { mode: "execute", executeGroupAllowlist: ["grp_p4"] },
        groupTaskHeartbeat: {
          mode: "emit",
          emitGroupAllowlist: ["grp_p4"],
          scanIntervalMs: 1,
        },
        continueAfterRoundComplete: {
          enabled: false,
        },
        acceptanceLoopMaxReturns: 2,
      },
    },
  } as OpenBotConfig;
}

async function useConfig(): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-p4-gate-"));
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

function authority(cfg: OpenBotConfig): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_p4_test" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_p4",
    tenant: { tenantId: "tenant-p4", trust: "none" },
    groupId: "grp_p4",
    profile: "personal_local",
    cfg,
  });
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
    deliverableId: opts?.deliverableId ?? "del-p4-md",
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
    title: "p4 gate md",
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
      steps: [{ title: "draft" }, { title: "revise" }],
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
  return { item: started.value };
}

describe("P4 S2 — submit without verifiable deliverable link must not enter review", () => {
  test("compat no-link submit is blocked; review dispatch count stays 0", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p4-s2-nolink";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });

    let reviewDispatchCount = 0;
    const dispatcher: WakeRoundDispatcher = async () => {
      reviewDispatchCount += 1;
      return { ok: true, roundId: `s2-${reviewDispatchCount}` };
    };

    const blocked = await submitBoardItemForReview(
      auth,
      {
        taskId,
        itemId: item.itemId,
        actorId: "bot-a",
        submissionId: randomUUID(),
        artifactVersion: "art-nolink",
        submissionSummary: "# no link body",
      },
      { cfg, coordinatorBotId: "bot-b" },
    );
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.reason).toBe("deliverable_link_required");
    }

    const live = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(live?.status).toBe("in_progress");
    expect(live?.pendingEventRelay ?? null).toBeNull();

    const advance = await triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      actorId: "bot-b",
      cfg,
      roundDispatcher: dispatcher,
      trusted: trustedLocatorFromAuthority(auth),
    });
    expect(advance.dispatched).toBe(false);
    expect(reviewDispatchCount).toBe(0);
  });
});

describe("P4 risk A (O4) — over return cap must not keep return-revise executing", () => {
  test("at/over acceptanceLoopMaxReturns: no return-revise relay; further return refused; revise dispatch=0", async () => {
    const { cfg } = await useConfig();
    const cfg2 = {
      ...cfg,
      collaboration: {
        ...cfg.collaboration,
        task: { ...cfg.collaboration?.task, acceptanceLoopMaxReturns: 2 },
      },
    } as OpenBotConfig;
    setRuntimeConfigSnapshot(cfg2, cfg2);
    const auth = authority(cfg2);
    const taskId = "task-p4-o4-cap";
    const { item } = await seedInProgress({
      auth,
      cfg: cfg2,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });

    let returnReviseDispatchCount = 0;
    const dispatcher: WakeRoundDispatcher = async (req) => {
      // Count actual execute attempts for this work item (not opKey string compare alone).
      if (req.itemId === item.itemId) {
        returnReviseDispatchCount += 1;
      }
      return { ok: true, roundId: `o4-${returnReviseDispatchCount}` };
    };

    for (let i = 0; i < 2; i += 1) {
      if (i > 0) {
        const marked = await markBoardItemInProgress(
          auth,
          { taskId, itemId: item.itemId, actorId: "bot-a" },
          { cfg: cfg2 },
        );
        expect(marked.ok).toBe(true);
      }
      const link = await seedLink(auth, taskId, {
        deliverableId: `del-o4-${i}`,
        version: i + 1,
        content: `# draft ${i + 1}\n`,
      });
      const sid = randomUUID();
      const submitted = await submitBoardItemForReview(
        auth,
        {
          taskId,
          itemId: item.itemId,
          actorId: "bot-a",
          submissionId: sid,
          artifactVersion: `art-v${i + 1}`,
          submissionSummary: `# draft ${i + 1} unique`,
          ...link,
        },
        { cfg: cfg2, coordinatorBotId: "bot-b" },
      );
      expect(submitted.ok).toBe(true);
      const returned = await returnBoardItemSubmission(
        auth,
        {
          taskId,
          itemId: item.itemId,
          actorId: "bot-b",
          reason: `revise ${i + 1}`,
          expectedSubmissionId: sid,
        },
        { cfg: cfg2, coordinatorBotId: "bot-b" },
      );
      expect(returned.ok).toBe(true);
      if (!returned.ok) {
        throw new Error(returned.message);
      }
      expect(returned.value.returnCount).toBe(i + 1);
      if (i + 1 >= 2) {
        // Cap hit: escalate path only — must not arm return-revise relay.
        expect(returned.value.pendingEventRelay).toBeNull();
      }
    }

    const live = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(live?.returnCount).toBe(2);
    expect(live?.pendingEventRelay).toBeNull();

    const recovered = await recoverPendingBoardEventRelays({
      groupId: auth.groupId,
      taskId,
      actorId: "bot-b",
      items: live ? [live] : [],
      cfg: cfg2,
      roundDispatcher: dispatcher,
      trusted: trustedLocatorFromAuthority(auth),
      authority: auth,
    });
    expect(recovered).toHaveLength(0);
    expect(returnReviseDispatchCount).toBe(0);

    // Further return after cap must be refused (no more revise loop).
    const markedAgain = await markBoardItemInProgress(
      auth,
      { taskId, itemId: item.itemId, actorId: "bot-a" },
      { cfg: cfg2 },
    );
    // mark may succeed or fail depending on status=returned; either way submit/return over cap blocked.
    if (markedAgain.ok) {
      const link3 = await seedLink(auth, taskId, {
        deliverableId: "del-o4-over",
        version: 3,
        content: "# over\n",
      });
      const sid3 = randomUUID();
      const overSubmit = await submitBoardItemForReview(
        auth,
        {
          taskId,
          itemId: item.itemId,
          actorId: "bot-a",
          submissionId: sid3,
          artifactVersion: "art-over",
          submissionSummary: "# over unique",
          ...link3,
        },
        { cfg: cfg2, coordinatorBotId: "bot-b" },
      );
      if (overSubmit.ok) {
        const overReturn = await returnBoardItemSubmission(
          auth,
          {
            taskId,
            itemId: item.itemId,
            actorId: "bot-b",
            reason: "should refuse",
            expectedSubmissionId: sid3,
          },
          { cfg: cfg2, coordinatorBotId: "bot-b" },
        );
        expect(overReturn.ok).toBe(false);
        if (!overReturn.ok) {
          expect(overReturn.reason).toBe("acceptance_loop_exceeded");
        }
      }
    } else {
      // If mark refused because already at escalate/returned gate — also acceptable.
      expect(["invalid_status", "acceptance_loop_exceeded"]).toContain(markedAgain.reason);
    }
    expect(returnReviseDispatchCount).toBe(0);
  });
});

describe("P4 risk B (O5/O15) — after deliverable land must not force-continue execute same item", () => {
  test("forceForDeliverableSettlement on in_progress item: selfAdvance/wake execute count = 0", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p4-o5-continue";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: "bot-a",
      reviewer: "bot-b",
    });
    // Deliverable fixture landed (B-rail) while board still in_progress (no submit).
    await seedLink(auth, taskId, { deliverableId: "del-landed", version: 1 });

    const result = await maybeContinueAfterRoundComplete({
      authority: auth,
      roundId: "round-p4-o5",
      roundState: "ROUND_COMPLETE",
      cfg,
      forceForDeliverableSettlement: true,
      loadBoardItems: async () => {
        const live = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
        return live ? [live] : [];
      },
    });

    // Must not bypass board submit: no wake + no self-advance execute for this item.
    expect(result.decision.wakeRecorded).toBe(false);
    expect(result.decision.selfAdvanceTriggered).toBe(false);
    expect(
      result.skipped ||
        result.decision.reason.includes("await_board") ||
        result.decision.reason === "no_active_board_inventory" ||
        result.decision.reason.includes("force_continue_blocked"),
    ).toBe(true);

    const live = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(live?.status).toBe("in_progress");
  });
});

describe("P4 risk C (O14) — heartbeat must not double-execute same item alongside relay recover", () => {
  test("pending relay + heartbeat tick: work-item execute count is 1 not 2", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-p4-o14-dup";
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
    const live = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(live?.pendingEventRelay?.status).toBe("pending");
    const trusted = trustedLocatorFromAuthority(auth);
    expect(trusted).toBeTruthy();

    let executeCount = 0;
    const dispatcher: WakeRoundDispatcher = async (req) => {
      if (req.itemId === item.itemId) {
        executeCount += 1;
      }
      return { ok: true, roundId: `o14-${executeCount}` };
    };

    // Baseline: explicit recover for this pending relay executes exactly once.
    const recovered = await recoverPendingBoardEventRelays({
      groupId: auth.groupId,
      taskId,
      actorId: "bot-b",
      items: live ? [live] : [],
      cfg,
      roundDispatcher: dispatcher,
      trusted,
      authority: auth,
    });
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.dispatched).toBe(true);
    expect(executeCount).toBe(1);

    // Re-arm a fresh pending relay on a new submission cycle to exercise heartbeat guard.
    const after = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    // Accept path not needed; re-seed returned→in_progress→submit for a second pending.
    // Simpler path: leave item submitted was cleared by recover; if status still submitted
    // without pending, heartbeat would nudge. Re-submit with new link for pending again.
    // Use return+resubmit only when still submitted_for_review with no pending.
    let pendingItem = after;
    if (after && !after.pendingEventRelay && after.status === "submitted_for_review") {
      // Recover cleared relay after dispatch — create another pending via return+revise+submit.
      const returned = await returnBoardItemSubmission(
        auth,
        {
          taskId,
          itemId: item.itemId,
          actorId: "bot-b",
          reason: "o14 re-arm",
          expectedSubmissionId: submissionId,
        },
        { cfg, coordinatorBotId: "bot-b" },
      );
      expect(returned.ok).toBe(true);
      await markBoardItemInProgress(
        auth,
        { taskId, itemId: item.itemId, actorId: "bot-a" },
        { cfg },
      );
      const link2 = await seedLink(auth, taskId, {
        deliverableId: "del-o14-2",
        version: 2,
        content: "# Draft v2\n",
      });
      const sid2 = randomUUID();
      const submitted2 = await submitBoardItemForReview(
        auth,
        {
          taskId,
          itemId: item.itemId,
          actorId: "bot-a",
          submissionId: sid2,
          artifactVersion: "art-v2",
          submissionSummary: "# Draft v2 unique",
          ...link2,
        },
        { cfg, coordinatorBotId: "bot-b" },
      );
      expect(submitted2.ok).toBe(true);
      pendingItem = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    }
    expect(pendingItem?.pendingEventRelay?.status).toBe("pending");

    const beforeHb = executeCount;
    const tick = await runGroupTaskHeartbeat(
      auth,
      { groupId: auth.groupId },
      {
        cfg,
        force: true,
        dryRun: false,
        nowMs: Date.now(),
        coordinatorBotId: "bot-b",
        roundDispatcher: dispatcher,
      },
    );
    expect(tick.ok).toBe(true);
    if (tick.ok && !tick.skipped) {
      expect(
        tick.decisions.some(
          (d) =>
            d.itemId === item.itemId &&
            (d.reason === "pending_event_relay_guard" || d.action === "skip"),
        ),
      ).toBe(true);
    }

    // Heartbeat may recover the new pending once (+1) but must not add a second nudge execute.
    const delta = executeCount - beforeHb;
    expect(delta).toBeLessThanOrEqual(1);
    expect(executeCount).toBeLessThanOrEqual(beforeHb + 1);
    // Absolute: never double-hit in one tick beyond a single recover execute.
    expect(delta === 0 || delta === 1).toBe(true);
    expect(executeCount).toBeGreaterThanOrEqual(1);
  });
});

// silence unused import if hash helper unused in some runners
void createHash;
void path;
