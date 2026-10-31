/**
 * P4b — GroupBoardClaim / ClaimContract unit tests.
 * Flag-off refuses writes; oral dispatch is never a board fact.
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
import { decideParticipantsForTest } from "./__fixtures__/runtime-authority-test-utils.js";
import {
  acceptBoardItemSubmission,
  applyClaim,
  boardItemGoal,
  cancelBoardItem,
  claimBoardItem,
  DEFAULT_ACCEPTANCE_LOOP_MAX_RETURNS,
  isAppliedBoardClaim,
  isCollabTaskClaimContractEnabled,
  isEmptySubmissionBody,
  isGroupOnClaimContractAllowlist,
  applyBoardKickoffMultiParticipant,
  collectActiveBoardIntendedClaimantIds,
  isBoardKickoffMultiParticipantEnabled,
  isPostClaimFanoutWakeEnabled,
  loadBoardClaimItem,
  markBoardItemInProgress,
  oralDispatchCreatesBoardFact,
  publishBoardItem,
  resolveAcceptanceLoopMaxReturns,
  resolveBoardKickoffMultiParticipantBots,
  resolvePostClaimFanoutTargets,
  returnBoardItemSubmission,
  submitBoardItemForReview,
} from "./claim-contract.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority, type RuntimeAuthority } from "./runtime-authority.js";
import type { CollaborationBotTarget, CollaborationDispatchScope } from "./types.js";
import { listWakeEvents } from "./wake-contract.js";

async function submitBoardItemForReviewSeeded(
  auth: RuntimeAuthority,
  input: Parameters<typeof submitBoardItemForReview>[1],
  options?: Parameters<typeof submitBoardItemForReview>[2],
) {
  let next = input;
  if (input.linkedDeliverableId) {
    const { seedLinkedTeamDeliverableFixture, P2_LINKED_DELIVERABLE_FIXTURE_BODY } =
      await import("../collaboration-learning/verify-linked-team-deliverable.js");
    const seeded = await seedLinkedTeamDeliverableFixture({
      authority: auth,
      taskId: input.taskId,
      deliverableId: input.linkedDeliverableId,
      version:
        typeof input.linkedDeliverableVersion === "number" ? input.linkedDeliverableVersion : 1,
      content: P2_LINKED_DELIVERABLE_FIXTURE_BODY,
    });
    if (!seeded.ok) {
      throw new Error(`seed linked deliverable failed: ${seeded.reason}`);
    }
    next = { ...input, linkedContentSha256: seeded.contentSha256 };
  }
  return submitBoardItemForReview(auth, next, options);
}

const tempDirs: string[] = [];
const savedStateDir = process.env.OPENBOT_STATE_DIR;
const savedOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
const savedOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;
const savedSecurityProfile = process.env.OPENBOT_SECURITY_PROFILE;
const savedLegacySecurityProfile = process.env.OPENCLAW_SECURITY_PROFILE;

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
  if (savedSecurityProfile === undefined) {
    delete process.env.OPENBOT_SECURITY_PROFILE;
  } else {
    process.env.OPENBOT_SECURITY_PROFILE = savedSecurityProfile;
  }
  if (savedLegacySecurityProfile === undefined) {
    delete process.env.OPENCLAW_SECURITY_PROFILE;
  } else {
    process.env.OPENCLAW_SECURITY_PROFILE = savedLegacySecurityProfile;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function flagConfig(
  root: string,
  claimContract: boolean,
  allowlist?: string[],
  taskExtras?: Record<string, unknown>,
): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        claimContract,
        ...(allowlist ? { claimContractGroupAllowlist: allowlist } : {}),
        ...taskExtras,
      },
    },
  } as OpenBotConfig;
}

async function useConfig(
  claimContract: boolean,
  allowlist?: string[],
  taskExtras?: Record<string, unknown>,
): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-p4b-claim-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  const cfg = flagConfig(root, claimContract, allowlist, taskExtras);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return { root, cfg };
}

function authority(cfg: OpenBotConfig, groupId = "grp_claim"): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_claim_test" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_claim",
    tenant: { tenantId: null, trust: "none" },
    groupId,
    profile: "personal_local",
    cfg,
  });
}

async function confirmOwnerTodolistForItem(params: {
  auth: RuntimeAuthority;
  cfg: OpenBotConfig;
  taskId: string;
  boardItemId: string;
  ownerMemberId: string;
  confirmerId?: string;
}): Promise<void> {
  const { proposeTodolist, confirmTodolist } = await import("./executor-private-todolist.js");
  const confirmerId = params.confirmerId ?? "bot-secretary";
  const proposed = await proposeTodolist(
    params.auth,
    {
      boardItemId: params.boardItemId,
      taskId: params.taskId,
      groupId: params.auth.groupId,
      ownerMemberId: params.ownerMemberId,
      steps: [{ title: "draft outline" }, { title: "fill sources" }],
    },
    { cfg: params.cfg },
  );
  expect(proposed.ok).toBe(true);
  if (!proposed.ok) {
    throw new Error(`proposeTodolist failed: ${proposed.reason}`);
  }
  const confirmed = await confirmTodolist(
    params.auth,
    { taskId: params.taskId, todolistId: proposed.value.todolistId, confirmerId },
    { cfg: params.cfg, authorizedConfirmerIds: [confirmerId] },
  );
  expect(confirmed.ok).toBe(true);
  if (!confirmed.ok) {
    throw new Error(`confirmTodolist failed: ${confirmed.reason}`);
  }
}

const seedTask: Task = {
  taskId: "task-claim-1",
  groupId: "grp_claim",
  title: "2030 strategy chapter",
  status: "in_progress",
  ownerMemberId: "human-ceo",
  assignedMemberIds: ["human-ceo"],
  createdBy: "human-ceo",
  updatedBy: "human-ceo",
  createdAtMs: 1,
  updatedAtMs: 1,
};

describe("P4b claim contract", () => {
  test("oral dispatch never creates a board fact", () => {
    expect(oralDispatchCreatesBoardFact()).toBe(false);
    expect(isAppliedBoardClaim(null)).toBe(false);
  });

  test("P1 gray allowlist enables claim for listed group without global flag", async () => {
    const gray = "grp-daniel-hhd-gmail-com-upbeyond";
    const { cfg } = await useConfig(false, [gray]);
    expect(isCollabTaskClaimContractEnabled(cfg)).toBe(false);
    expect(isCollabTaskClaimContractEnabled(cfg, gray)).toBe(true);
    expect(isCollabTaskClaimContractEnabled(cfg, "grp-other")).toBe(false);
    expect(isGroupOnClaimContractAllowlist({ groupId: gray, cfg })).toBe(true);

    const auth = authority(cfg, gray);
    const published = await publishBoardItem(
      auth,
      {
        groupId: gray,
        taskId: seedTask.taskId,
        title: "AI×能源 overnight report",
        remainingWork: "交付 AI×能源 overnight 报告",
        acceptanceCriteria: ["含来源", "主答可验收"],
        goal: "交付 AI×能源 overnight 报告",
        constraints: ["必须带来源", "不得口头派工当事实"],
        dueAtMs: 1_700_000_000_000,
        suggestedRole: "analyst",
        intendedClaimantIds: ["bot-analyst"],
        publishedBy: "bot-secretary",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    expect(published.value.goal).toBe("交付 AI×能源 overnight 报告");
    expect(published.value.constraints).toEqual(["必须带来源", "不得口头派工当事实"]);
    expect(published.value.dueAtMs).toBe(1_700_000_000_000);
    expect(published.value.suggestedRole).toBe("analyst");
    expect(boardItemGoal(published.value)).toBe("交付 AI×能源 overnight 报告");

    // Other group still fail-closed
    const otherAuth = authority(cfg, "grp-other");
    const refused = await publishBoardItem(
      otherAuth,
      {
        groupId: "grp-other",
        taskId: seedTask.taskId,
        remainingWork: "should refuse",
        acceptanceCriteria: ["x"],
        publishedBy: "bot-secretary",
      },
      { cfg },
    );
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.reason).toBe("flag_off");
    }
  });

  test("P1 rollback: empty allowlist + global false refuses writes", async () => {
    const { cfg } = await useConfig(false, []);
    expect(isCollabTaskClaimContractEnabled(cfg, "grp-daniel-hhd-gmail-com-upbeyond")).toBe(false);
  });

  test("flag defaults off", async () => {
    const { cfg } = await useConfig(false);
    expect(isCollabTaskClaimContractEnabled(cfg)).toBe(false);
  });

  test("flag-off: publish refuses and writes nothing", async () => {
    const { cfg } = await useConfig(false);
    const auth = authority(cfg);
    const result = await publishBoardItem(
      auth,
      {
        groupId: "grp_claim",
        taskId: seedTask.taskId,
        remainingWork: "draft tech chapter",
        acceptanceCriteria: ["sources cited"],
        publishedBy: "bot-secretary",
      },
      { cfg },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("flag_off");
    }
    await expect(fs.access(path.join(auth.namespace.root, "board-claims"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  test("flag-on: publish → claim → apply seeds responsibility + assigned", async () => {
    const { cfg } = await useConfig(true);
    expect(isCollabTaskClaimContractEnabled(cfg)).toBe(true);
    const auth = authority(cfg);

    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_claim",
        taskId: seedTask.taskId,
        title: seedTask.title,
        remainingWork: "draft tech chapter with authoritative sources",
        acceptanceCriteria: ["≥ sources", "shared workspace draft"],
        intendedClaimantIds: ["bot-analyst"],
        publishedBy: "bot-secretary",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    expect(published.value.status).toBe("published");
    expect(published.value.revision).toBe(1);

    const claimed = await claimBoardItem(
      auth,
      {
        taskId: seedTask.taskId,
        itemId: published.value.itemId,
        claimantId: "bot-analyst",
      },
      { cfg },
    );
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) {
      return;
    }
    expect(claimed.value.status).toBe("claimed");
    expect(claimed.value.claimantId).toBe("bot-analyst");
    expect(claimed.value.revision).toBe(2);

    const applied = await applyClaim(
      auth,
      { taskId: seedTask.taskId, itemId: published.value.itemId },
      seedTask,
      auth.policy.effective,
      { cfg },
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    expect(applied.value.item.status).toBe("applied");
    expect(isAppliedBoardClaim(applied.value.item)).toBe(true);
    expect(applied.value.assignedMemberIds).toContain("bot-analyst");
    expect(applied.value.responsibility.executors).toContain("bot-analyst");

    const loaded = await loadBoardClaimItem(auth, {
      taskId: seedTask.taskId,
      itemId: published.value.itemId,
    });
    expect(loaded?.status).toBe("applied");
  });

  test("flag-on: unintended claimant is refused", async () => {
    const { cfg } = await useConfig(true);
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_claim",
        taskId: seedTask.taskId,
        remainingWork: "market sizing",
        acceptanceCriteria: ["cite sources"],
        intendedClaimantIds: ["bot-market"],
        publishedBy: "bot-secretary",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const claimed = await claimBoardItem(
      auth,
      {
        taskId: seedTask.taskId,
        itemId: published.value.itemId,
        claimantId: "bot-panda",
      },
      { cfg },
    );
    expect(claimed.ok).toBe(false);
    if (!claimed.ok) {
      expect(claimed.reason).toBe("claimant_not_intended");
    }
  });
});

describe("Contract C1 concurrent claim (atomic RMW)", () => {
  test("exactly one of two concurrent claims succeeds; unique claimantId", async () => {
    const { cfg } = await useConfig(true);
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_claim",
        taskId: seedTask.taskId,
        remainingWork: "race claim target",
        acceptanceCriteria: ["one winner"],
        intendedClaimantIds: ["bot-a", "bot-b"],
        publishedBy: "bot-secretary",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    expect(published.value.revision).toBe(1);
    const itemId = published.value.itemId;

    const [a, b] = await Promise.all([
      claimBoardItem(auth, { taskId: seedTask.taskId, itemId, claimantId: "bot-a" }, { cfg }),
      claimBoardItem(auth, { taskId: seedTask.taskId, itemId, claimantId: "bot-b" }, { cfg }),
    ]);

    const successes = [a, b].filter((r) => r.ok);
    const failures = [a, b].filter((r) => !r.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    if (!successes[0]?.ok || failures[0]?.ok) {
      return;
    }
    expect(failures[0].reason).toBe("invalid_status");
    expect(successes[0].value.status).toBe("claimed");
    expect(successes[0].value.revision).toBe(2);
    expect(["bot-a", "bot-b"]).toContain(successes[0].value.claimantId);

    const loaded = await loadBoardClaimItem(auth, { taskId: seedTask.taskId, itemId });
    expect(loaded?.status).toBe("claimed");
    expect(loaded?.claimantId).toBe(successes[0].value.claimantId);
    expect(loaded?.revision).toBe(2);
    // Must not have two different winners
    expect(a.ok && b.ok && a.value.claimantId !== b.value.claimantId).toBe(false);
  });

  test("re-claim after winner fails (not published)", async () => {
    const { cfg } = await useConfig(true);
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_claim",
        taskId: seedTask.taskId,
        remainingWork: "second claim",
        acceptanceCriteria: ["done"],
        intendedClaimantIds: ["bot-a", "bot-b"],
        publishedBy: "bot-secretary",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const itemId = published.value.itemId;
    const first = await claimBoardItem(
      auth,
      { taskId: seedTask.taskId, itemId, claimantId: "bot-a" },
      { cfg },
    );
    expect(first.ok).toBe(true);
    const second = await claimBoardItem(
      auth,
      { taskId: seedTask.taskId, itemId, claimantId: "bot-b" },
      { cfg },
    );
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("invalid_status");
    }
  });

  test("expectedRevision mismatch → revision_conflict", async () => {
    const { cfg } = await useConfig(true);
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_claim",
        taskId: seedTask.taskId,
        remainingWork: "cas claim",
        acceptanceCriteria: ["done"],
        intendedClaimantIds: ["bot-a"],
        publishedBy: "bot-secretary",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const stale = await claimBoardItem(
      auth,
      {
        taskId: seedTask.taskId,
        itemId: published.value.itemId,
        claimantId: "bot-a",
        expectedRevision: 99,
      },
      { cfg },
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.reason).toBe("revision_conflict");
    }
    const ok = await claimBoardItem(
      auth,
      {
        taskId: seedTask.taskId,
        itemId: published.value.itemId,
        claimantId: "bot-a",
        expectedRevision: 1,
      },
      { cfg },
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.revision).toBe(2);
    }
  });

  test("C2: concurrent accept vs return — exactly one ok; accepted XOR returned; revision +1 once", async () => {
    const { cfg } = await useConfig(true);
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_claim",
        taskId: seedTask.taskId,
        remainingWork: "race accept/return",
        acceptanceCriteria: ["sources"],
        intendedClaimantIds: ["bot-analyst"],
        publishedBy: "bot-secretary",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const itemId = published.value.itemId;
    await claimBoardItem(
      auth,
      { taskId: seedTask.taskId, itemId, claimantId: "bot-analyst" },
      { cfg },
    );
    await applyClaim(auth, { taskId: seedTask.taskId, itemId }, seedTask, auth.policy.effective, {
      cfg,
    });
    await confirmOwnerTodolistForItem({
      auth,
      cfg,
      taskId: seedTask.taskId,
      boardItemId: itemId,
      ownerMemberId: "bot-analyst",
    });
    const inProg = await markBoardItemInProgress(
      auth,
      { taskId: seedTask.taskId, itemId, actorId: "bot-analyst" },
      { cfg },
    );
    expect(inProg.ok).toBe(true);
    if (!inProg.ok) {
      return;
    }
    const submissionId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const submitted = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId,
        submissionSummary: "race chapter v1",
        artifactVersion: "v1.0.0",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",
      },
      { cfg },
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) {
      return;
    }
    const preRaceRevision = submitted.value.revision ?? 0;
    expect(preRaceRevision).toBeGreaterThan(0);

    const [acceptResult, returnResult] = await Promise.all([
      acceptBoardItemSubmission(
        auth,
        {
          taskId: seedTask.taskId,
          itemId,
          actorId: "bot-secretary",
          expectedSubmissionId: submissionId,
          reason: "meets sources",
          checkedAcceptanceCriteria: ["sources"],
        },
        { cfg },
      ),
      returnBoardItemSubmission(
        auth,
        {
          taskId: seedTask.taskId,
          itemId,
          actorId: "bot-secretary",
          expectedSubmissionId: submissionId,
          reason: "needs more sources",
        },
        { cfg },
      ),
    ]);

    const successes = [acceptResult, returnResult].filter((r) => r.ok);
    const failures = [acceptResult, returnResult].filter((r) => !r.ok);
    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);
    if (!successes[0]?.ok || failures[0]?.ok) {
      return;
    }
    expect(failures[0].reason).toBe("invalid_status");
    expect(["accepted", "returned"]).toContain(successes[0].value.status);
    expect(successes[0].value.revision).toBe(preRaceRevision + 1);

    const loaded = await loadBoardClaimItem(auth, { taskId: seedTask.taskId, itemId });
    expect(loaded?.revision).toBe(preRaceRevision + 1);
    expect(["accepted", "returned"]).toContain(loaded?.status);
    // Exactly one winner status on the durable item
    expect(loaded?.status).toBe(successes[0].value.status);
    expect(acceptResult.ok && returnResult.ok).toBe(false);
  });

  test("C3: concurrent cancel vs submit from in_progress — ends cancelled; post-cancel submit refused", async () => {
    const { cfg } = await useConfig(true);
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_claim",
        taskId: seedTask.taskId,
        remainingWork: "race cancel/submit",
        acceptanceCriteria: ["done"],
        intendedClaimantIds: ["bot-analyst"],
        publishedBy: "bot-secretary",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const itemId = published.value.itemId;
    await claimBoardItem(
      auth,
      { taskId: seedTask.taskId, itemId, claimantId: "bot-analyst" },
      { cfg },
    );
    await applyClaim(auth, { taskId: seedTask.taskId, itemId }, seedTask, auth.policy.effective, {
      cfg,
    });
    await confirmOwnerTodolistForItem({
      auth,
      cfg,
      taskId: seedTask.taskId,
      boardItemId: itemId,
      ownerMemberId: "bot-analyst",
    });
    const inProg = await markBoardItemInProgress(
      auth,
      { taskId: seedTask.taskId, itemId, actorId: "bot-analyst" },
      { cfg },
    );
    expect(inProg.ok).toBe(true);
    if (!inProg.ok) {
      return;
    }
    const preRaceRevision = inProg.value.revision ?? 0;
    const submissionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    const [cancelResult, submitResult] = await Promise.all([
      cancelBoardItem(
        auth,
        {
          taskId: seedTask.taskId,
          itemId,
          actorId: "bot-secretary",
          reason: "drop in-flight",
        },
        { cfg },
      ),
      submitBoardItemForReviewSeeded(
        auth,
        {
          taskId: seedTask.taskId,
          itemId,
          actorId: "bot-analyst",
          submissionId,
          submissionSummary: "should not stick past cancel",
          artifactVersion: "v1.0.0",
          linkedDeliverableId: "del-p2-test",
          linkedDeliverableVersion: 1,
          linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",
        },
        { cfg },
      ),
    ]);

    // Lock serializes: cancel-first → submit fails; submit-first → cancel still applies from submitted.
    // Either way cancel succeeds and durable end state is cancelled (cancel ≠ block, terminal).
    expect(cancelResult.ok).toBe(true);
    if (!cancelResult.ok) {
      return;
    }
    expect(cancelResult.value.status).toBe("cancelled");

    const loaded = await loadBoardClaimItem(auth, { taskId: seedTask.taskId, itemId });
    expect(loaded?.status).toBe("cancelled");
    // revision bumped once (cancel only) or twice (submit then cancel)
    const rev = loaded?.revision ?? 0;
    expect(rev === preRaceRevision + 1 || rev === preRaceRevision + 2).toBe(true);
    if (submitResult.ok) {
      expect(rev).toBe(preRaceRevision + 2);
    } else {
      expect(submitResult.reason).toBe("invalid_status");
      expect(rev).toBe(preRaceRevision + 1);
    }

    // Post-cancel submit cannot advance.
    const after = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        submissionSummary: "after cancel",
        artifactVersion: "v1.0.1",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",
      },
      { cfg },
    );
    expect(after.ok).toBe(false);
    if (!after.ok) {
      expect(after.reason).toBe("invalid_status");
    }
  });

  test("C3 ordered: submit → cancel from submitted_for_review; then accept/re-submit refuse; revision matches", async () => {
    const { cfg } = await useConfig(true);
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_claim",
        taskId: seedTask.taskId,
        remainingWork: "ordered cancel after submit",
        acceptanceCriteria: ["done"],
        intendedClaimantIds: ["bot-analyst"],
        publishedBy: "bot-secretary",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const itemId = published.value.itemId;
    await claimBoardItem(
      auth,
      { taskId: seedTask.taskId, itemId, claimantId: "bot-analyst" },
      { cfg },
    );
    await applyClaim(auth, { taskId: seedTask.taskId, itemId }, seedTask, auth.policy.effective, {
      cfg,
    });
    await confirmOwnerTodolistForItem({
      auth,
      cfg,
      taskId: seedTask.taskId,
      boardItemId: itemId,
      ownerMemberId: "bot-analyst",
    });
    const inProg = await markBoardItemInProgress(
      auth,
      { taskId: seedTask.taskId, itemId, actorId: "bot-analyst" },
      { cfg },
    );
    expect(inProg.ok).toBe(true);
    if (!inProg.ok) {
      return;
    }
    const revInProgress = inProg.value.revision ?? 0;

    const submissionId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const submitted = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId,
        submissionSummary: "submit before ordered cancel",
        artifactVersion: "v2.0.0",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",
      },
      { cfg },
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) {
      return;
    }
    expect(submitted.value.status).toBe("submitted_for_review");
    expect(submitted.value.revision).toBe(revInProgress + 1);
    const revSubmitted = submitted.value.revision ?? 0;

    const cancelled = await cancelBoardItem(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-secretary",
        reason: "cancel after submit",
      },
      { cfg },
    );
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) {
      return;
    }
    expect(cancelled.value.status).toBe("cancelled");
    expect(cancelled.value.revision).toBe(revSubmitted + 1);

    const loaded = await loadBoardClaimItem(auth, { taskId: seedTask.taskId, itemId });
    expect(loaded?.status).toBe("cancelled");
    expect(loaded?.revision).toBe(revSubmitted + 1);

    // After cancel: accept and re-submit both fail (terminal).
    const acceptAfter = await acceptBoardItemSubmission(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-secretary",
        expectedSubmissionId: submissionId,
        reason: "too late",
        checkedAcceptanceCriteria: ["done"],
      },
      { cfg },
    );
    expect(acceptAfter.ok).toBe(false);
    if (!acceptAfter.ok) {
      expect(acceptAfter.reason).toBe("invalid_status");
    }

    const resubmit = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        submissionSummary: "re-submit after cancel",
        artifactVersion: "v2.0.1",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",
      },
      { cfg },
    );
    expect(resubmit.ok).toBe(false);
    if (!resubmit.ok) {
      expect(resubmit.reason).toBe("invalid_status");
    }

    const final = await loadBoardClaimItem(auth, { taskId: seedTask.taskId, itemId });
    expect(final?.status).toBe("cancelled");
    // No further successful transitions → revision unchanged after cancel.
    expect(final?.revision).toBe(revSubmitted + 1);
  });
});

describe("C1 claim progress states", () => {
  test("flag-off: markInProgress refuses", async () => {
    const { cfg } = await useConfig(false);
    const auth = authority(cfg);
    const result = await markBoardItemInProgress(
      auth,
      { taskId: seedTask.taskId, itemId: "x", actorId: "bot-analyst" },
      { cfg },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("flag_off");
    }
  });

  test("flag-on: apply → in_progress → submit(submission_id) → accept; illegal jumps refused", async () => {
    const {
      markBoardItemInProgress,
      submitBoardItemForReview,
      returnBoardItemSubmission,
      isBoardClaimSubmissionId,
    } = await import("./claim-contract.js");
    const { cfg } = await useConfig(true);
    const auth = authority(cfg);

    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_claim",
        taskId: seedTask.taskId,
        remainingWork: "chapter draft",
        acceptanceCriteria: ["sources"],
        intendedClaimantIds: ["bot-analyst"],
        publishedBy: "bot-secretary",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const itemId = published.value.itemId;

    // cannot submit from published
    const earlySubmit = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        artifactVersion: "v1.0.0",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",
      },
      { cfg },
    );
    expect(earlySubmit.ok).toBe(false);
    if (!earlySubmit.ok) {
      expect(earlySubmit.reason).toBe("invalid_status");
    }

    await claimBoardItem(
      auth,
      { taskId: seedTask.taskId, itemId, claimantId: "bot-analyst" },
      { cfg },
    );
    await applyClaim(auth, { taskId: seedTask.taskId, itemId }, seedTask, auth.policy.effective, {
      cfg,
    });

    // P2: without confirm, markInProgress is plan-gated
    const gated = await markBoardItemInProgress(
      auth,
      { taskId: seedTask.taskId, itemId, actorId: "bot-analyst" },
      { cfg },
    );
    expect(gated.ok).toBe(false);
    if (!gated.ok) {
      expect(gated.reason).toBe("plan_gate_unconfirmed");
    }

    await confirmOwnerTodolistForItem({
      auth,
      cfg,
      taskId: seedTask.taskId,
      boardItemId: itemId,
      ownerMemberId: "bot-analyst",
    });

    const inProg = await markBoardItemInProgress(
      auth,
      { taskId: seedTask.taskId, itemId, actorId: "bot-analyst" },
      { cfg },
    );
    expect(inProg.ok).toBe(true);
    if (!inProg.ok) {
      return;
    }
    expect(inProg.value.status).toBe("in_progress");

    const badId = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId: "not-a-uuid",
        artifactVersion: "v1.0.0",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",
      },
      { cfg },
    );
    expect(badId.ok).toBe(false);
    if (!badId.ok) {
      expect(badId.reason).toBe("invalid_submission_id");
    }
    expect(isBoardClaimSubmissionId("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")).toBe(true);

    const submissionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const submitted = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId,
        submissionSummary: "chapter v1",
        artifactVersion: "v1.0.0",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",
      },
      { cfg },
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) {
      return;
    }
    expect(submitted.value.status).toBe("submitted_for_review");
    expect(submitted.value.submissionId).toBe(submissionId);

    // idempotent same submissionId
    const again = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId,
        artifactVersion: "v1.0.0",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",
      },
      { cfg },
    );
    expect(again.ok).toBe(true);

    // different submissionId while open → refuse
    const clash = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        artifactVersion: "v1.0.0",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",
      },
      { cfg },
    );
    expect(clash.ok).toBe(false);
    if (!clash.ok) {
      expect(clash.reason).toBe("duplicate_open_submission");
    }

    const returned = await returnBoardItemSubmission(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-secretary",
        reason: "need more sources",
        expectedSubmissionId: submissionId,
      },
      { cfg },
    );
    expect(returned.ok).toBe(true);
    if (!returned.ok) {
      return;
    }
    expect(returned.value.status).toBe("returned");

    const resumed = await markBoardItemInProgress(
      auth,
      { taskId: seedTask.taskId, itemId, actorId: "bot-analyst" },
      { cfg },
    );
    expect(resumed.ok).toBe(true);

    const submissionId2 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const resubmitted = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId: submissionId2,
        artifactVersion: "v1.0.0",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",

        submissionSummary: "chapter v2 with sources",
      },
      { cfg },
    );
    expect(resubmitted.ok).toBe(true);

    const accepted = await acceptBoardItemSubmission(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "human-ceo",
        expectedSubmissionId: submissionId2,
        reason: "meets acceptance",
        checkedAcceptanceCriteria: ["sources"],
      },
      { cfg },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      return;
    }
    expect(accepted.value.status).toBe("accepted");
    expect(accepted.value.submissionId).toBe(submissionId2);
    expect(accepted.value.acceptedSubmissionId).toBe(submissionId2);
    expect(accepted.value.acceptedArtifactVersion).toBe("v1.0.0");

    // cannot accept again
    const acceptAgain = await acceptBoardItemSubmission(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "human-ceo",
        expectedSubmissionId: submissionId2,
        reason: "meets acceptance",
        checkedAcceptanceCriteria: ["sources"],
      },
      { cfg },
    );
    expect(acceptAgain.ok).toBe(false);
    if (!acceptAgain.ok) {
      expect(acceptAgain.reason).toBe("invalid_status");
    }
  });

  test("draft≠submitted: applied is active work, not submitted", async () => {
    const { cfg } = await useConfig(true);
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_claim",
        taskId: seedTask.taskId,
        remainingWork: "x",
        acceptanceCriteria: ["y"],
        publishedBy: "bot-secretary",
      },
      { cfg },
    );
    if (!published.ok) {
      return;
    }
    await claimBoardItem(
      auth,
      {
        taskId: seedTask.taskId,
        itemId: published.value.itemId,
        claimantId: "bot-analyst",
      },
      { cfg },
    );
    const applied = await applyClaim(
      auth,
      { taskId: seedTask.taskId, itemId: published.value.itemId },
      seedTask,
      auth.policy.effective,
      { cfg },
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) {
      return;
    }
    expect(applied.value.item.status).toBe("applied");
    expect(applied.value.item.submissionId).toBeUndefined();
  });
});

describe("P4 submit empty/duplicate + acceptance loop", () => {
  test("helpers: empty body and default loop cap", () => {
    expect(isEmptySubmissionBody("")).toBe(true);
    expect(isEmptySubmissionBody("   ")).toBe(true);
    expect(isEmptySubmissionBody("ok")).toBe(false);
    expect(DEFAULT_ACCEPTANCE_LOOP_MAX_RETURNS).toBe(3);
    expect(resolveAcceptanceLoopMaxReturns(undefined)).toBe(3);
  });

  test("empty submission is not success; duplicate returned body refused", async () => {
    const { cfg } = await useConfig(true);
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_claim",
        taskId: seedTask.taskId,
        remainingWork: "chapter",
        acceptanceCriteria: ["sources"],
        publishedBy: "bot-secretary",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const itemId = published.value.itemId;
    await claimBoardItem(
      auth,
      { taskId: seedTask.taskId, itemId, claimantId: "bot-analyst" },
      { cfg },
    );
    await applyClaim(auth, { taskId: seedTask.taskId, itemId }, seedTask, auth.policy.effective, {
      cfg,
    });
    await confirmOwnerTodolistForItem({
      auth,
      cfg,
      taskId: seedTask.taskId,
      boardItemId: itemId,
      ownerMemberId: "bot-analyst",
    });
    await markBoardItemInProgress(
      auth,
      { taskId: seedTask.taskId, itemId, actorId: "bot-analyst" },
      { cfg },
    );

    const empty = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        artifactVersion: "v1.0.0",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",

        submissionSummary: "  ",
      },
      { cfg },
    );
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.reason).toBe("empty_submission");
    }

    const submissionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const submitted = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId,
        submissionSummary: "draft v1",
        artifactVersion: "v1.0.0",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",
      },
      { cfg },
    );
    expect(submitted.ok).toBe(true);

    const returned = await returnBoardItemSubmission(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-secretary",
        reason: "need sources",
        expectedSubmissionId: submissionId,
      },
      { cfg, coordinatorBotId: "bot-secretary" },
    );
    expect(returned.ok).toBe(true);
    if (!returned.ok) {
      return;
    }
    expect(returned.value.returnCount).toBe(1);

    await markBoardItemInProgress(
      auth,
      { taskId: seedTask.taskId, itemId, actorId: "bot-analyst" },
      { cfg },
    );
    const dup = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        artifactVersion: "v1.0.0",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",

        submissionSummary: "draft v1",
      },
      { cfg },
    );
    expect(dup.ok).toBe(false);
    if (!dup.ok) {
      expect(dup.reason).toBe("duplicate_submission");
    }
  });

  test("acceptance loop over cap escalates (returnCount)", async () => {
    const { cfg } = await useConfig(true);
    // override max to 2 for faster test
    const cfg2 = {
      ...cfg,
      collaboration: {
        ...cfg.collaboration,
        task: { ...cfg.collaboration?.task, acceptanceLoopMaxReturns: 2 },
      },
    } as OpenBotConfig;
    setRuntimeConfigSnapshot(cfg2, cfg2);
    const auth = authority(cfg2);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_claim",
        taskId: seedTask.taskId,
        remainingWork: "chapter",
        acceptanceCriteria: ["sources"],
        publishedBy: "bot-secretary",
      },
      { cfg: cfg2 },
    );
    if (!published.ok) {
      return;
    }
    const itemId = published.value.itemId;
    await claimBoardItem(
      auth,
      { taskId: seedTask.taskId, itemId, claimantId: "bot-analyst" },
      { cfg: cfg2 },
    );
    await applyClaim(auth, { taskId: seedTask.taskId, itemId }, seedTask, auth.policy.effective, {
      cfg: cfg2,
    });
    await confirmOwnerTodolistForItem({
      auth,
      cfg: cfg2,
      taskId: seedTask.taskId,
      boardItemId: itemId,
      ownerMemberId: "bot-analyst",
    });

    for (let i = 0; i < 2; i += 1) {
      await markBoardItemInProgress(
        auth,
        { taskId: seedTask.taskId, itemId, actorId: "bot-analyst" },
        { cfg: cfg2 },
      );
      const sid = `cccccccc-cccc-4ccc-8ccc-${String(i).padStart(12, "0")}`;
      const submitted = await submitBoardItemForReviewSeeded(
        auth,
        {
          taskId: seedTask.taskId,
          itemId,
          actorId: "bot-analyst",
          submissionId: sid,
          artifactVersion: "v1.0.0",
          linkedDeliverableId: "del-p2-test",
          linkedDeliverableVersion: 1,
          linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",

          submissionSummary: `draft v${i + 1}`,
        },
        { cfg: cfg2 },
      );
      expect(submitted.ok).toBe(true);
      const returned = await returnBoardItemSubmission(
        auth,
        {
          taskId: seedTask.taskId,
          itemId,
          actorId: "human-ceo",
          reason: `revise ${i + 1}`,
          expectedSubmissionId: sid,
        },
        { cfg: cfg2, coordinatorBotId: "human-ceo" },
      );
      expect(returned.ok).toBe(true);
      if (!returned.ok) {
        return;
      }
      expect(returned.value.returnCount).toBe(i + 1);
    }
    const loaded = await loadBoardClaimItem(auth, { taskId: seedTask.taskId, itemId });
    expect(loaded?.returnCount).toBe(2);
  });
});

describe("Mode B post-claim intended fan-out wake", () => {
  test("resolvePostClaimFanoutTargets excludes claimant and dedupes", () => {
    expect(resolvePostClaimFanoutTargets(["bot", "bot-2", "panda", "bot"], "bot")).toEqual([
      "bot-2",
      "panda",
    ]);
    expect(resolvePostClaimFanoutTargets(["bot"], "bot")).toEqual([]);
    expect(resolvePostClaimFanoutTargets([], "bot")).toEqual([]);
    expect(resolvePostClaimFanoutTargets(["Bot-2", "bot"], "BOT")).toEqual(["Bot-2"]);
  });

  test("default off: claim wakes only claimant (no fan-out event)", async () => {
    const { cfg } = await useConfig(true, undefined, {
      wakeContract: true,
    });
    expect(isPostClaimFanoutWakeEnabled(cfg, "grp_claim")).toBe(false);
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_claim",
        taskId: seedTask.taskId,
        remainingWork: "collab draft",
        acceptanceCriteria: ["shared"],
        intendedClaimantIds: ["bot", "bot-2", "panda"],
        publishedBy: "bot-secretary",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const claimed = await claimBoardItem(
      auth,
      {
        taskId: seedTask.taskId,
        itemId: published.value.itemId,
        claimantId: "bot",
      },
      { cfg },
    );
    expect(claimed.ok).toBe(true);
    const events = await listWakeEvents(auth, { groupId: "grp_claim" });
    const claimWakes = events.filter((e) => e.source === "claim");
    expect(claimWakes).toHaveLength(1);
    expect(claimWakes[0]?.toAgentIds).toEqual(["bot"]);
    expect(claimWakes.some((e) => e.reason === "post_claim_intended_fanout")).toBe(false);
  });

  test("allowlisted claimed → non-claimants woken; claimant not in fan-out targets", async () => {
    const { cfg } = await useConfig(true, undefined, {
      wakeContract: true,
      postClaimFanoutWakeGroupAllowlist: ["grp_claim"],
    });
    expect(isPostClaimFanoutWakeEnabled(cfg, "grp_claim")).toBe(true);
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_claim",
        taskId: seedTask.taskId,
        remainingWork: "collab draft",
        acceptanceCriteria: ["shared"],
        intendedClaimantIds: ["bot", "bot-2", "bot-skill", "panda"],
        publishedBy: "bot-secretary",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const claimed = await claimBoardItem(
      auth,
      {
        taskId: seedTask.taskId,
        itemId: published.value.itemId,
        claimantId: "bot",
      },
      { cfg },
    );
    expect(claimed.ok).toBe(true);
    const events = await listWakeEvents(auth, { groupId: "grp_claim" });
    const claimWakes = events.filter((e) => e.source === "claim");
    expect(claimWakes).toHaveLength(2);
    const claimantWake = claimWakes.find((e) => !e.reason);
    const fanoutWake = claimWakes.find((e) => e.reason === "post_claim_intended_fanout");
    expect(claimantWake?.toAgentIds).toEqual(["bot"]);
    expect(fanoutWake?.toAgentIds).toEqual(["bot-2", "bot-skill", "panda"]);
    expect(fanoutWake?.toAgentIds).not.toContain("bot");
    expect(fanoutWake?.itemId).toBe(published.value.itemId);
  });

  test("empty intended → fan-out no-op even when allowlisted", async () => {
    const { cfg } = await useConfig(true, undefined, {
      wakeContract: true,
      postClaimFanoutWake: true,
    });
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_claim",
        taskId: seedTask.taskId,
        remainingWork: "open claim",
        acceptanceCriteria: ["done"],
        intendedClaimantIds: [],
        publishedBy: "bot-secretary",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const claimed = await claimBoardItem(
      auth,
      {
        taskId: seedTask.taskId,
        itemId: published.value.itemId,
        claimantId: "bot-analyst",
      },
      { cfg },
    );
    expect(claimed.ok).toBe(true);
    const events = await listWakeEvents(auth, { groupId: "grp_claim" });
    const claimWakes = events.filter((e) => e.source === "claim");
    expect(claimWakes).toHaveLength(1);
    expect(claimWakes[0]?.toAgentIds).toEqual(["bot-analyst"]);
    expect(claimWakes.some((e) => e.reason === "post_claim_intended_fanout")).toBe(false);
  });

  test("global postClaimFanoutWake=true enables without allowlist entry", async () => {
    const { cfg } = await useConfig(true, undefined, {
      wakeContract: true,
      postClaimFanoutWake: true,
    });
    expect(isPostClaimFanoutWakeEnabled(cfg, "grp_other")).toBe(true);
    const auth = authority(cfg, "grp_other");
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_other",
        taskId: seedTask.taskId,
        remainingWork: "global on",
        acceptanceCriteria: ["ok"],
        intendedClaimantIds: ["lead", "peer-a"],
        publishedBy: "bot-secretary",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const claimed = await claimBoardItem(
      auth,
      {
        taskId: seedTask.taskId,
        itemId: published.value.itemId,
        claimantId: "lead",
      },
      { cfg },
    );
    expect(claimed.ok).toBe(true);
    const events = await listWakeEvents(auth, { groupId: "grp_other" });
    const fanout = events.find((e) => e.reason === "post_claim_intended_fanout");
    expect(fanout?.toAgentIds).toEqual(["peer-a"]);
  });
});

describe("Mode B board-tied kickoff multi-participant", () => {
  function bot(agentId: string): CollaborationBotTarget {
    return {
      agentId,
      name: agentId,
      sessionKey: `agent:${agentId}:main:space:grp`,
      updatedAt: 1,
    };
  }

  function createScope(): CollaborationDispatchScope {
    return {
      groupId: "grp_kick",
      rawSessionKey: "space:grp_kick",
      title: "Kick Group",
      bots: [bot("bot"), bot("bot-2"), bot("bot-skill"), bot("panda")],
      members: {
        humans: [{ userId: "u1", name: "Owner", status: "active" }],
        bots: [
          { agentId: "bot", name: "高级秘书", status: "active" },
          { agentId: "bot-2", name: "Bot 2", status: "active" },
          { agentId: "bot-skill", name: "Skill", status: "active" },
          { agentId: "panda", name: "Panda", status: "active" },
        ],
      },
      operatingState: {
        groupId: "grp_kick",
        groupProfile: { displayName: "Kick Group", expectedOutputs: [], successCriteria: [] },
        governance: { adminUserIds: [], coordinatorBotId: "bot" },
        collaborationPolicy: {
          humanStartsNewRound: true,
          mentionBotMustRespond: true,
          mentionHumanNotifiesOnly: true,
          openDiscussionWithoutMention: true,
          maxVisibleBotRepliesPerRound: 5,
          botMaySelfAdvanceWithoutHuman: false,
          entersWaitingForHumanAfterVisibleTurnsExhausted: true,
        },
        memberRoleMap: [],
        activeContext: {
          currentOperatingPhase: "execute",
          currentMission: "2030 AI strategy",
          currentTaskId: "task-1",
          waitingForHuman: false,
          summary: "",
          updatedAtMs: 0,
        },
        onboardingStatus: { initialized: true },
        groupMemoryRefs: { latestCapsuleIds: [] },
        updatedAtMs: 0,
      },
    } as unknown as CollaborationDispatchScope;
  }

  test("default off", async () => {
    const { cfg } = await useConfig(true);
    expect(isBoardKickoffMultiParticipantEnabled(cfg, "grp_kick")).toBe(false);
  });

  test("allowlist enables without global true", async () => {
    const { cfg } = await useConfig(true, undefined, {
      boardKickoffMultiParticipantGroupAllowlist: ["grp_kick"],
    });
    expect(isBoardKickoffMultiParticipantEnabled(cfg, "grp_kick")).toBe(true);
    expect(isBoardKickoffMultiParticipantEnabled(cfg, "grp_other")).toBe(false);
  });

  test("resolveBoardKickoffMultiParticipantBots: mention lead then intended", () => {
    const group = [bot("bot"), bot("bot-2"), bot("bot-skill"), bot("panda")];
    expect(
      resolveBoardKickoffMultiParticipantBots({
        groupBots: group,
        mentionMatchedBots: [bot("bot")],
        intendedClaimantIds: ["bot", "bot-2", "bot-skill", "panda"],
      }).map((b) => b.agentId),
    ).toEqual(["bot", "bot-2", "bot-skill", "panda"]);
    expect(
      resolveBoardKickoffMultiParticipantBots({
        groupBots: group,
        mentionMatchedBots: [bot("bot")],
        intendedClaimantIds: [],
      }),
    ).toEqual([]);
  });

  test("collectActiveBoardIntendedClaimantIds skips accepted/cancelled", () => {
    expect(
      collectActiveBoardIntendedClaimantIds([
        { status: "accepted", intendedClaimantIds: ["old"] },
        { status: "published", intendedClaimantIds: ["bot", "bot-2"] },
        { status: "claimed", intendedClaimantIds: ["bot-2", "panda"] },
        { status: "cancelled", intendedClaimantIds: ["x"] },
      ]),
    ).toEqual(["bot", "bot-2", "panda"]);
  });

  test("allowlisted board kickoff → explicit_multi over intended", async () => {
    const { cfg } = await useConfig(true, undefined, {
      boardKickoffMultiParticipantGroupAllowlist: ["grp_kick"],
    });
    const baseline = decideParticipantsForTest({
      message: "@bot 请主持并挂板协作",
      scope: createScope(),
      roundId: "r-on",
    });
    expect(baseline.primaryMode).toBe("single");
    expect(baseline.primaryQueue).toEqual(["bot"]);

    const next = applyBoardKickoffMultiParticipant({
      decision: baseline,
      groupId: "grp_kick",
      groupBots: createScope().bots,
      intendedClaimantIds: ["bot", "bot-2", "bot-skill", "panda"],
      cfg,
    });
    expect(next.primaryMode).toBe("explicit_multi");
    expect(next.mentionMode).toBe("explicit_multi");
    expect(next.primaryQueue).toEqual(["bot", "bot-2", "bot-skill", "panda"]);
    expect(next.roundPlan.alerts?.some((a) => a.kind === "mode_b_board_lead")).toBe(true);
  });

  test("default off preserves single_primary today", async () => {
    const { cfg } = await useConfig(true);
    const baseline = decideParticipantsForTest({
      message: "@bot 请主持并挂板协作",
      scope: createScope(),
      roundId: "r-off",
    });
    const next = applyBoardKickoffMultiParticipant({
      decision: baseline,
      groupId: "grp_kick",
      groupBots: createScope().bots,
      intendedClaimantIds: ["bot", "bot-2", "panda"],
      cfg,
    });
    expect(next.primaryMode).toBe("single");
    expect(next.primaryQueue).toEqual(["bot"]);
  });

  test("non-board chat mention still overrides (no intended)", async () => {
    const { cfg } = await useConfig(true, undefined, {
      boardKickoffMultiParticipant: true,
    });
    const baseline = decideParticipantsForTest({
      message: "@bot-2 你怎么看",
      scope: createScope(),
      roundId: "r-chat",
    });
    const next = applyBoardKickoffMultiParticipant({
      decision: baseline,
      groupId: "grp_kick",
      groupBots: createScope().bots,
      intendedClaimantIds: [],
      cfg,
    });
    expect(next.primaryMode).toBe("single");
    expect(next.primaryQueue).toEqual(["bot-2"]);
  });
});

describe("P1 submit-for-review wakes reviewer (best-effort)", () => {
  test("wakeContract on: submit wakes coordinatorBotId when provided", async () => {
    const { cfg } = await useConfig(true, undefined, { wakeContract: true });
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_claim",
        taskId: seedTask.taskId,
        remainingWork: "chapter draft",
        acceptanceCriteria: ["sources"],
        intendedClaimantIds: ["bot-analyst", "bot-other"],
        publishedBy: "bot-publisher",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const itemId = published.value.itemId;
    await claimBoardItem(
      auth,
      { taskId: seedTask.taskId, itemId, claimantId: "bot-analyst" },
      { cfg },
    );
    await applyClaim(auth, { taskId: seedTask.taskId, itemId }, seedTask, auth.policy.effective, {
      cfg,
    });
    await confirmOwnerTodolistForItem({
      auth,
      cfg,
      taskId: seedTask.taskId,
      boardItemId: itemId,
      ownerMemberId: "bot-analyst",
    });
    await markBoardItemInProgress(
      auth,
      { taskId: seedTask.taskId, itemId, actorId: "bot-analyst" },
      { cfg },
    );
    const submissionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const submitted = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId,
        artifactVersion: "v1.0.0",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",

        submissionSummary: "chapter for review",
      },
      { cfg, coordinatorBotId: "bot-coordinator" },
    );
    expect(submitted.ok).toBe(true);
    const events = await listWakeEvents(auth, { groupId: "grp_claim", taskId: seedTask.taskId });
    const insightWakes = events.filter(
      (e) =>
        e.source === "insight" &&
        typeof e.reason === "string" &&
        e.reason.startsWith("submitted_for_review:"),
    );
    expect(insightWakes).toHaveLength(1);
    expect(insightWakes[0]?.fromAgentId).toBe("bot-analyst");
    expect(insightWakes[0]?.toAgentIds).toEqual(["bot-coordinator"]);
    // Must not wake intendedClaimant peers as reviewers.
    expect(insightWakes[0]?.toAgentIds).not.toContain("bot-other");
  });

  test("wakeContract on: without coordinatorBotId falls back to publishedBy", async () => {
    const { cfg } = await useConfig(true, undefined, { wakeContract: true });
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_claim",
        taskId: seedTask.taskId,
        remainingWork: "chapter draft",
        acceptanceCriteria: ["sources"],
        intendedClaimantIds: ["bot-analyst"],
        publishedBy: "bot-secretary",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const itemId = published.value.itemId;
    await claimBoardItem(
      auth,
      { taskId: seedTask.taskId, itemId, claimantId: "bot-analyst" },
      { cfg },
    );
    await applyClaim(auth, { taskId: seedTask.taskId, itemId }, seedTask, auth.policy.effective, {
      cfg,
    });
    await confirmOwnerTodolistForItem({
      auth,
      cfg,
      taskId: seedTask.taskId,
      boardItemId: itemId,
      ownerMemberId: "bot-analyst",
    });
    await markBoardItemInProgress(
      auth,
      { taskId: seedTask.taskId, itemId, actorId: "bot-analyst" },
      { cfg },
    );
    const submissionId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const submitted = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId,
        artifactVersion: "v1.0.0",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",

        submissionSummary: "chapter for review",
      },
      { cfg },
    );
    expect(submitted.ok).toBe(true);
    const events = await listWakeEvents(auth, { groupId: "grp_claim", taskId: seedTask.taskId });
    const insightWakes = events.filter(
      (e) =>
        e.source === "insight" &&
        typeof e.reason === "string" &&
        e.reason.startsWith("submitted_for_review:"),
    );
    expect(insightWakes).toHaveLength(1);
    expect(insightWakes[0]?.toAgentIds).toEqual(["bot-secretary"]);
  });

  test("wakeContract off: submit still succeeds without wake write", async () => {
    const { cfg } = await useConfig(true);
    const auth = authority(cfg);
    const published = await publishBoardItem(
      auth,
      {
        groupId: "grp_claim",
        taskId: seedTask.taskId,
        remainingWork: "chapter draft",
        acceptanceCriteria: ["sources"],
        intendedClaimantIds: ["bot-analyst"],
        publishedBy: "bot-secretary",
      },
      { cfg },
    );
    expect(published.ok).toBe(true);
    if (!published.ok) {
      return;
    }
    const itemId = published.value.itemId;
    await claimBoardItem(
      auth,
      { taskId: seedTask.taskId, itemId, claimantId: "bot-analyst" },
      { cfg },
    );
    await applyClaim(auth, { taskId: seedTask.taskId, itemId }, seedTask, auth.policy.effective, {
      cfg,
    });
    await confirmOwnerTodolistForItem({
      auth,
      cfg,
      taskId: seedTask.taskId,
      boardItemId: itemId,
      ownerMemberId: "bot-analyst",
    });
    await markBoardItemInProgress(
      auth,
      { taskId: seedTask.taskId, itemId, actorId: "bot-analyst" },
      { cfg },
    );
    const submissionId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const submitted = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId,
        artifactVersion: "v1.0.0",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",

        submissionSummary: "chapter for review",
      },
      { cfg, coordinatorBotId: "bot-coordinator" },
    );
    expect(submitted.ok).toBe(true);
    const events = await listWakeEvents(auth, { groupId: "grp_claim", taskId: seedTask.taskId });
    expect(events.filter((e) => e.source === "insight")).toHaveLength(0);
  });
});
