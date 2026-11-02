/**
 * Synthetic acceptance 1–9: coordinator / executor / reviewer duty separation.
 *
 * Production entrypoints under test (not mock model writing business state):
 * - publishCollaborationBoardItem (activate materialize needs full contract; publish is board authority)
 * - tryClaimAfterBoardPublish / claimCollaborationBoardItem / applyCollaborationBoardClaim
 * - ensureBoardActiveAfterConfirm / triggerPostPlanConfirmAdvance
 * - submitBoardItemForReview / returnBoardItemSubmission / acceptBoardItemSubmission
 * - triggerPostSubmissionEventAdvance
 *
 * Mock / stub boundaries (disclosed):
 * - plan gate: assertPlanGateAllowsDeliveryProgress stubbed only for progress mutate
 *   so submit/return/accept exercise claim-contract production writers.
 * - wake consume / Mode B dispatcher: recordNudgeWake + consumeWakeForRoundDispatch
 *   stubbed in post-plan tests that assert *target* only (not inventing business writes).
 * - No custom dispatcher that writes board/claim/plan state.
 * - No hardcoded people — synthetic bot:/human: ids only.
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
import {
  acceptBoardItemSubmission,
  applyClaim,
  claimBoardItem,
  markBoardItemInProgress,
  publishBoardItem,
  returnBoardItemSubmission,
  submitBoardItemForReview,
  type GroupBoardClaimItem,
} from "../collaboration-dispatch/claim-contract.js";
import { createRoundPolicySnapshot } from "../collaboration-dispatch/round-policy-snapshot.js";
import {
  createRuntimeAuthority,
  type RuntimeAuthority,
} from "../collaboration-dispatch/runtime-authority.js";
import {
  applyCollaborationBoardClaim,
  claimCollaborationBoardItem,
  ClaimContractEntryError,
  listCollaborationBoardItems,
  publishCollaborationBoardItem,
} from "./claim-contract-entry.js";
import { ensureBoardActiveAfterConfirm } from "./ensure-board-active-after-confirm.js";
import { triggerPostPlanConfirmAdvance } from "./post-plan-confirm-advance.js";
import { triggerPostSubmissionEventAdvance } from "./post-submission-event-advance.js";
import { createWorkspaceCollaborationStores } from "./shared.js";
import {
  resolvePostPublishClaimTarget,
  tryClaimAfterBoardPublish,
} from "./try-claim-after-board-publish.js";
import {
  P2_LINKED_DELIVERABLE_FIXTURE_BODY,
  seedLinkedTeamDeliverableFixture,
} from "./verify-linked-team-deliverable.js";

vi.mock("../collaboration-dispatch/executor-private-todolist.js", async () => {
  const actual = await vi.importActual<
    typeof import("../collaboration-dispatch/executor-private-todolist.js")
  >("../collaboration-dispatch/executor-private-todolist.js");
  return {
    ...actual,
    assertPlanGateAllowsDeliveryProgress: vi.fn(async () => ({ ok: true as const })),
  };
});

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;

const GROUP = "grp_role_duty";
const COORD = "bot-coord";
const EXEC = "bot-exec";
const EXEC_B = "bot-exec-b";
const HUMAN = "human:owner";

beforeEach(() => {
  vi.clearAllMocks();
});

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
  await Promise.all(tempDirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
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
        selfAdvance: { mode: "dry_run", executeGroupAllowlist: [GROUP] },
      },
    },
  } as OpenBotConfig;
}

async function useConfig(): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-role-duty-"));
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

function authority(cfg: OpenBotConfig, groupId = GROUP): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_role_duty" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_role_duty",
    tenant: { tenantId: null, trust: "none" },
    groupId,
    profile: "personal_local",
    cfg,
  });
}

async function seedTask(groupId: string, taskId: string, cfg: OpenBotConfig): Promise<Task> {
  const task: Task = {
    taskId,
    groupId,
    title: "role-duty synthetic",
    status: "in_progress",
    ownerMemberId: HUMAN,
    assignedMemberIds: [HUMAN],
    createdBy: HUMAN,
    updatedBy: HUMAN,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
  const { objectStorage } = createWorkspaceCollaborationStores(cfg);
  await objectStorage.writeObject(groupId, "task", taskId, task);
  return task;
}

async function seedLink(
  auth: RuntimeAuthority,
  taskId: string,
  opts?: { deliverableId?: string; version?: number; content?: string },
) {
  const content = opts?.content ?? P2_LINKED_DELIVERABLE_FIXTURE_BODY;
  const seeded = await seedLinkedTeamDeliverableFixture({
    authority: auth,
    taskId,
    deliverableId: opts?.deliverableId ?? "del-role-duty",
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

describe("role-duty separation acceptance (1–9)", () => {
  it("1+2: coordinator publish without suggested → not default claimant; intended ≠ claimed", async () => {
    const { cfg } = await useConfig();
    const taskId = "task-pub-1";
    await seedTask(GROUP, taskId, cfg);
    // Production publish entry — omit intendedClaimantIds (must NOT stamp publisher as claimant)
    const published = await publishCollaborationBoardItem({
      groupId: GROUP,
      taskId,
      remainingWork: "Market brief",
      acceptanceCriteria: ["sources"],
      actor: COORD,
      cfg,
    });
    expect(published.claimantId).toBeFalsy();
    expect(published.publishedBy).toBe(COORD);
    expect(published.status).toBe("published");
    expect(published.intendedClaimantIds ?? []).toEqual([]);
    const post = await tryClaimAfterBoardPublish({
      groupId: GROUP,
      taskId,
      item: published,
      actorId: COORD,
      authority: authority(cfg),
      cfg,
    });
    expect(post.outcome).toBe("blocked");
    expect(post.reason).toMatch(/no_single_legal_claimant/);
    expect(post.claimantId).toBeNull();
    const live = (await listCollaborationBoardItems({ groupId: GROUP, taskId, cfg }))[0];
    expect(live.claimantId).toBeFalsy();
  });

  it("2b: sole intended ≠ publisher → schedule handoff, publisher not claimed", async () => {
    const { cfg } = await useConfig();
    const taskId = "task-pub-2";
    await seedTask(GROUP, taskId, cfg);
    const published = await publishCollaborationBoardItem({
      groupId: GROUP,
      taskId,
      remainingWork: "draft",
      acceptanceCriteria: ["ok"],
      intendedClaimantIds: [EXEC],
      actor: COORD,
      cfg,
    });
    expect(published.claimantId).toBeFalsy();
    const post = await tryClaimAfterBoardPublish({
      groupId: GROUP,
      taskId,
      item: published,
      actorId: COORD,
      authority: authority(cfg),
      cfg,
      roundDispatcher: null,
    });
    expect(post.outcome).toBe("scheduled");
    if (post.outcome !== "scheduled") {
      return;
    }
    expect(post.claimantId).toBeNull();
    expect(post.scheduledClaimantId).toBe(EXEC);
    expect(post.wakeDispatcherAccepted).toBe(false);
    const live = (await listCollaborationBoardItems({ groupId: GROUP, taskId, cfg }))[0];
    expect(live.claimantId).toBeFalsy();
    expect(live.status).toBe("published");
  });

  it("3: claim only via actor's own identity (proxy claim refused)", async () => {
    const { cfg } = await useConfig();
    const taskId = "task-claim-1";
    await seedTask(GROUP, taskId, cfg);
    const published = await publishCollaborationBoardItem({
      groupId: GROUP,
      taskId,
      remainingWork: "x",
      acceptanceCriteria: ["a"],
      intendedClaimantIds: [EXEC],
      actor: COORD,
      cfg,
    });
    await expect(
      claimCollaborationBoardItem({
        groupId: GROUP,
        taskId,
        itemId: published.itemId,
        claimantId: EXEC,
        actor: COORD, // coordinator proxy
        cfg,
      }),
    ).rejects.toMatchObject({ code: "claim_actor_mismatch" });
    const claimed = await claimCollaborationBoardItem({
      groupId: GROUP,
      taskId,
      itemId: published.itemId,
      claimantId: EXEC,
      actor: EXEC,
      cfg,
    });
    expect(claimed.claimantId).toBe(EXEC);
    expect(claimed.status).toBe("claimed");
  });

  it("3b+6: ensureBoardActiveAfterConfirm — no proxy; self-claim path OK", async () => {
    const { cfg } = await useConfig();
    const taskId = "task-ens-1";
    await seedTask(GROUP, taskId, cfg);
    const published = await publishCollaborationBoardItem({
      groupId: GROUP,
      taskId,
      remainingWork: "x",
      acceptanceCriteria: ["a"],
      intendedClaimantIds: [EXEC],
      actor: COORD,
      cfg,
    });
    const refused = await ensureBoardActiveAfterConfirm({
      groupId: GROUP,
      taskId,
      item: published,
      planOwnerMemberId: EXEC,
      authorizingActorId: HUMAN,
      cfg,
    });
    expect(refused.activated).toBe(false);
    expect(refused.reason).toMatch(/awaiting_executor_self_claim/);
    expect(refused.item.claimantId).toBeFalsy();

    const self = await ensureBoardActiveAfterConfirm({
      groupId: GROUP,
      taskId,
      item: published,
      planOwnerMemberId: `bot:${EXEC}`,
      authorizingActorId: `bot:${EXEC}`,
      cfg,
    });
    expect(self.activated).toBe(true);
    expect(self.item.claimantId).toBe(EXEC);
    expect(self.authorizingActorId).toBe(`bot:${EXEC}`);
  });

  it("5: after lawful confirm on active board, execute wake targets claimant only", async () => {
    const { cfg } = await useConfig();
    const taskId = "task-wake-1";
    await seedTask(GROUP, taskId, cfg);
    const published = await publishCollaborationBoardItem({
      groupId: GROUP,
      taskId,
      remainingWork: "x",
      acceptanceCriteria: ["a"],
      intendedClaimantIds: [EXEC],
      actor: COORD,
      cfg,
    });
    await claimCollaborationBoardItem({
      groupId: GROUP,
      taskId,
      itemId: published.itemId,
      claimantId: EXEC,
      actor: EXEC,
      cfg,
    });
    await applyCollaborationBoardClaim({
      groupId: GROUP,
      taskId,
      itemId: published.itemId,
      actor: EXEC,
      cfg,
    });

    const executorTodolist = await import("../collaboration-dispatch/executor-private-todolist.js");
    const wakeContract = await import("../collaboration-dispatch/wake-contract.js");
    const wakeRound = await import("../collaboration-dispatch/wake-round-dispatch.js");
    vi.spyOn(executorTodolist, "loadExecutorTodolist").mockResolvedValue({
      todolistId: "td-1",
      taskId,
      boardItemId: published.itemId,
      groupId: GROUP,
      ownerMemberId: EXEC,
      status: "confirmed",
      version: 1,
      steps: [{ stepId: "s1", title: "step", status: "active" }],
      visibility: "executor_private",
    } as never);
    vi.spyOn(executorTodolist, "buildExecutionTaskBag").mockReturnValue({
      boardSummary: { itemId: published.itemId, goal: "g" },
      groupContextPointer: { groupId: GROUP, transcriptHint: "t" },
      todolistCurrentStep: { stepId: "s1", version: 1, title: "step" },
      planGate: { confirmed: true },
    } as never);
    const nudgeSpy = vi
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
      groupId: GROUP,
      taskId,
      boardItemId: published.itemId,
      todolistId: "td-1",
      confirmedVersion: 1,
      stepId: "s1",
      confirmerId: HUMAN,
      cfg,
    });
    expect(result.targetAgentIds).toEqual([EXEC]);
    expect(result.targetAgentIds).not.toContain(COORD);
    expect(result.targetAgentIds).not.toContain(HUMAN);
    expect(nudgeSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ toAgentIds: [EXEC] }),
      expect.anything(),
    );
    expect(result.wakeRecorded).toBe(true);
  });

  it("7: multi / none intended refuse — never list[0]", async () => {
    expect(
      resolvePostPublishClaimTarget({
        intendedClaimantIds: [EXEC, EXEC_B],
      } as unknown as GroupBoardClaimItem).ok,
    ).toBe(false);
    expect(
      resolvePostPublishClaimTarget({
        intendedClaimantIds: [],
      } as unknown as GroupBoardClaimItem).ok,
    ).toBe(false);
    const sole = resolvePostPublishClaimTarget({
      intendedClaimantIds: [EXEC],
    } as unknown as GroupBoardClaimItem);
    expect(sole).toEqual({ ok: true, claimantId: EXEC });
  });

  it("4+5+7+8: submit→review targets publisher; return→executor; late accept refused; accept stops exec wakes", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-rev-1";
    await seedTask(GROUP, taskId, cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: GROUP,
        taskId,
        title: "item",
        remainingWork: "deliver",
        acceptanceCriteria: ["crit-a"],
        intendedClaimantIds: [EXEC],
        publishedBy: COORD,
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const claimed = await claimBoardItem(
      auth,
      { taskId, itemId: published.value.itemId, claimantId: EXEC },
      { cfg },
    );
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) {
      return;
    }
    const task = (await createWorkspaceCollaborationStores(cfg).objectStorage.readObject(
      GROUP,
      "task",
      taskId,
    )) as Task;
    const applied = await applyClaim(
      auth,
      { taskId, itemId: published.value.itemId },
      task,
      auth.policy.effective,
      { cfg },
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }

    const inProg = await markBoardItemInProgress(
      auth,
      { taskId, itemId: published.value.itemId, actorId: EXEC },
      { cfg },
    );
    expect(inProg.ok).toBe(true);

    const link = await seedLink(auth, taskId, { deliverableId: "del-role-duty-v1" });
    const submissionId = "11111111-1111-4111-8111-111111111111";
    const submitted = await submitBoardItemForReview(
      auth,
      {
        taskId,
        itemId: published.value.itemId,
        actorId: EXEC,
        submissionId,
        artifactVersion: "v1",
        submissionSummary: "draft body for review",
        ...link,
      },
      { cfg, coordinatorBotId: COORD },
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) {
      return;
    }
    expect(submitted.value.status).toBe("submitted_for_review");
    expect(submitted.value.pendingEventRelay?.targetAgentIds).toEqual([COORD]);

    const returned = await returnBoardItemSubmission(
      auth,
      {
        taskId,
        itemId: published.value.itemId,
        actorId: COORD,
        reason: "needs sources",
        expectedSubmissionId: submissionId,
      },
      { cfg },
    );
    expect(returned.ok).toBe(true);
    if (!returned.ok) {
      return;
    }
    expect(returned.value.status).toBe("returned");
    expect(returned.value.pendingEventRelay?.targetAgentIds).toEqual([EXEC]);

    // Late accept of returned/old submission must fail
    const late = await acceptBoardItemSubmission(
      auth,
      {
        taskId,
        itemId: published.value.itemId,
        actorId: COORD,
        expectedSubmissionId: submissionId,
        reason: "late",
        checkedAcceptanceCriteria: ["crit-a"],
      },
      { cfg },
    );
    expect(late.ok).toBe(false);

    // Resubmit + accept → no further exec schedule
    const link2 = await seedLink(auth, taskId, {
      deliverableId: "del-role-duty-v2",
      version: 1,
      content: "# revised with sources\n",
    });
    const submissionId2 = "22222222-2222-4222-8222-222222222222";
    const resub = await submitBoardItemForReview(
      auth,
      {
        taskId,
        itemId: published.value.itemId,
        actorId: EXEC,
        submissionId: submissionId2,
        artifactVersion: "v2",
        submissionSummary: "revised with sources",
        ...link2,
      },
      { cfg, coordinatorBotId: COORD },
    );
    expect(resub.ok).toBe(true);
    if (!resub.ok) {
      return;
    }
    const accepted = await acceptBoardItemSubmission(
      auth,
      {
        taskId,
        itemId: published.value.itemId,
        actorId: COORD,
        expectedSubmissionId: submissionId2,
        reason: "meets criteria",
        checkedAcceptanceCriteria: ["crit-a"],
      },
      { cfg },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      return;
    }
    expect(accepted.value.status).toBe("accepted");

    const afterAccept = await triggerPostSubmissionEventAdvance({
      groupId: GROUP,
      taskId,
      itemId: published.value.itemId,
      actorId: COORD,
      cfg,
      roundDispatcher: async () => {
        throw new Error("must_not_dispatch_after_accept");
      },
    });
    expect(afterAccept.dispatched).toBe(false);
    expect(
      afterAccept.reason === "accepted_no_further_exec_schedule" ||
        String(afterAccept.reason ?? "").includes("accepted") ||
        String(afterAccept.businessEvent ?? "") === "accepted",
    ).toBe(true);
  });

  it("6+9: coordinator may self-claim a summary item only; parallel published item untouched", async () => {
    const { cfg } = await useConfig();
    const taskId = "task-sum-1";
    await seedTask(GROUP, taskId, cfg);
    const summary = await publishCollaborationBoardItem({
      groupId: GROUP,
      taskId,
      remainingWork: "write summary",
      acceptanceCriteria: ["complete"],
      intendedClaimantIds: [COORD],
      actor: COORD,
      cfg,
    });
    await seedTask(GROUP, "task-sum-2", cfg);
    const otherPub = await publishCollaborationBoardItem({
      groupId: GROUP,
      taskId: "task-sum-2",
      remainingWork: "parallel chapter",
      acceptanceCriteria: ["ok"],
      intendedClaimantIds: [EXEC],
      actor: COORD,
      cfg,
    });

    // Coordinator self-claim summary only
    const selfClaim = await tryClaimAfterBoardPublish({
      groupId: GROUP,
      taskId,
      item: summary,
      actorId: COORD,
      authority: authority(cfg),
      cfg,
    });
    expect(selfClaim.outcome).toBe("claimed");
    expect(selfClaim.claimantId).toBe(COORD);

    const parallel = await listCollaborationBoardItems({
      groupId: GROUP,
      taskId: "task-sum-2",
      cfg,
    });
    const parallelItem = parallel.find((i) => i.itemId === otherPub.itemId) ?? parallel[0];
    expect(parallelItem?.status).toBe("published");
    expect(parallelItem?.claimantId).toBeFalsy();
    // Accepting summary must not auto-claim parallel
  });

  it("7 misc: wrong-version / revoked-style actor mismatch / cross intended refuse", async () => {
    const { cfg } = await useConfig();
    const taskId = "task-rej-1";
    await seedTask(GROUP, taskId, cfg);
    const published = await publishCollaborationBoardItem({
      groupId: GROUP,
      taskId,
      remainingWork: "x",
      acceptanceCriteria: ["a"],
      intendedClaimantIds: [EXEC],
      actor: COORD,
      cfg,
    });
    // Non-intended cannot claim
    await expect(
      claimCollaborationBoardItem({
        groupId: GROUP,
        taskId,
        itemId: published.itemId,
        claimantId: EXEC_B,
        actor: EXEC_B,
        cfg,
      }),
    ).rejects.toBeInstanceOf(ClaimContractEntryError);

    // ensure plan owner not in intended
    const mismatch = await ensureBoardActiveAfterConfirm({
      groupId: GROUP,
      taskId,
      item: published,
      planOwnerMemberId: EXEC_B,
      authorizingActorId: EXEC_B,
      cfg,
    });
    expect(mismatch.activated).toBe(false);
    expect(mismatch.reason).toMatch(/plan_owner_not_in_intended/);
  });
});
