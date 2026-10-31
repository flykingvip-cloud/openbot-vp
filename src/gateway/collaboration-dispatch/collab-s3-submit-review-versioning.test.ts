/**
 * FINAL v3 S3 — Version-bound submit / accept / return closed loop.
 *
 * Inventory-first: claim-contract + submit-review-versioning (no second orchestrator).
 * Flags default OFF; tests enable claim only in fixture cfg. LIVE untouched.
 *
 * State-machine coverage:
 * - empty submit / no-increment / pure restatement refuse success
 * - submit binds submissionId + artifactVersion
 * - accept/return bind expectedSubmissionId (stale/wrong version refused)
 * - late accept after return refused
 * - accept without covering Acceptance criteria refused
 * - over-limit return escalates
 * - proxy accept records identity + basis
 * - accepted terminal; no auto advance
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
import {
  acceptBoardItemSubmission,
  applyClaim,
  claimBoardItem,
  isCollabTaskClaimContractEnabled,
  loadBoardClaimItem,
  markBoardItemInProgress,
  publishBoardItem,
  returnBoardItemSubmission,
  submitBoardItemForReview,
} from "./claim-contract.js";
import { confirmTodolist, proposeTodolist } from "./executor-private-todolist.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority, type RuntimeAuthority } from "./runtime-authority.js";
import {
  acceptanceCriteriaFullyChecked,
  assertAcceptanceProxyFields,
  boardSubmissionStateContract,
  isEmptySubmissionBody,
  isValidArtifactVersion,
  pendingSubmissionMatches,
  s3DoesNotOpenProductionGrayWrites,
  s3DoesNotTouchLiveOrDefaultFlagsOn,
} from "./submit-review-versioning.js";

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
  opts: { claimContract?: boolean; maxReturns?: number },
): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        ...(opts.claimContract !== undefined ? { claimContract: opts.claimContract } : {}),
        ...(opts.maxReturns !== undefined ? { acceptanceLoopMaxReturns: opts.maxReturns } : {}),
      },
    },
  } as OpenBotConfig;
}

async function useConfig(opts: {
  claimContract?: boolean;
  maxReturns?: number;
}): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-s3-srv-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  const cfg = flagConfig(root, opts);
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
    {
      collaborationMode: "task_driven",
      finalDecisionMode: "human_required",
      botMaySelfAdvanceWithoutHuman: false,
    },
    { now: 1, idGen: () => "pss_s3" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_s3",
    tenant: { tenantId: "001", trust: "membership" },
    groupId: "grp_s3",
    profile: "personal_local",
    cfg,
  });
}

const seedTask = {
  taskId: "task-s3-1",
  title: "S3 deliverable",
  status: "ready",
} as unknown as Task;

const SID_V1 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SID_V2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SID_V3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

async function confirmOwnerTodolist(params: {
  auth: RuntimeAuthority;
  cfg: OpenBotConfig;
  taskId: string;
  boardItemId: string;
  ownerMemberId: string;
}): Promise<void> {
  const proposed = await proposeTodolist(
    params.auth,
    {
      boardItemId: params.boardItemId,
      taskId: params.taskId,
      groupId: params.auth.groupId,
      ownerMemberId: params.ownerMemberId,
      steps: [{ title: "draft" }, { title: "ship" }],
    },
    { cfg: params.cfg },
  );
  expect(proposed.ok).toBe(true);
  if (!proposed.ok) {
    throw new Error("proposeTodolist failed");
  }
  const confirmed = await confirmTodolist(
    params.auth,
    {
      taskId: params.taskId,
      todolistId: proposed.value.todolistId,
      confirmerId: "bot-secretary",
    },
    { cfg: params.cfg, authorizedConfirmerIds: ["bot-secretary"] },
  );
  expect(confirmed.ok).toBe(true);
}

async function reachInProgress(
  auth: RuntimeAuthority,
  cfg: OpenBotConfig,
  criteria: readonly string[] = ["sources", "format"],
): Promise<{ itemId: string }> {
  const published = await publishBoardItem(
    auth,
    {
      groupId: "grp_s3",
      taskId: seedTask.taskId,
      remainingWork: "deliver chapter",
      acceptanceCriteria: [...criteria],
      publishedBy: "bot-secretary",
    },
    { cfg },
  );
  expect(published.ok).toBe(true);
  if (!published.ok) {
    throw new Error("publish failed");
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
  await confirmOwnerTodolist({
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
  return { itemId };
}

describe("FINAL v3 S3 submit/review versioning", () => {
  test("helpers + flags default OFF + LIVE untouched", () => {
    expect(s3DoesNotTouchLiveOrDefaultFlagsOn()).toBe(true);
    expect(s3DoesNotOpenProductionGrayWrites()).toBe(true);
    expect(isValidArtifactVersion("")).toBe(false);
    expect(isValidArtifactVersion("  ")).toBe(false);
    expect(isValidArtifactVersion("v1.2.3")).toBe(true);
    expect(isEmptySubmissionBody("")).toBe(true);
    expect(
      pendingSubmissionMatches({ currentSubmissionId: SID_V1, expectedSubmissionId: SID_V1 }).ok,
    ).toBe(true);
    expect(
      pendingSubmissionMatches({ currentSubmissionId: SID_V1, expectedSubmissionId: SID_V2 }).ok,
    ).toBe(false);
    const incomplete = acceptanceCriteriaFullyChecked({
      boardCriteria: ["sources", "format"],
      checkedCriteria: ["sources"],
    });
    expect(incomplete.ok).toBe(false);
    if (!incomplete.ok) {
      expect(incomplete.reason).toBe("acceptance_criteria_incomplete");
      expect(incomplete.missing).toContain("format");
    }
    expect(
      acceptanceCriteriaFullyChecked({
        boardCriteria: ["sources", "format"],
        checkedCriteria: ["Sources", "FORMAT"],
      }).ok,
    ).toBe(true);
    expect(assertAcceptanceProxyFields({ proxyForActorId: "owner", proxyBasis: "" }).ok).toBe(
      false,
    );
    expect(
      assertAcceptanceProxyFields({ proxyForActorId: "owner", proxyBasis: "群主授权代验" }).ok,
    ).toBe(true);
    expect(boardSubmissionStateContract("submitted_for_review").bindsSubmissionVersion).toBe(true);
    expect(boardSubmissionStateContract("returned").acceptsLatePriorVersion).toBe(false);
    expect(boardSubmissionStateContract("accepted").autoAdvanceAfter).toBe(false);
  });

  test("flag-off: submit/accept refuse (no gray writes)", async () => {
    const { cfg } = await useConfig({ claimContract: false });
    expect(isCollabTaskClaimContractEnabled(cfg, "grp_s3", "001")).toBe(false);
    const auth = authority(cfg);
    const submitted = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId: "item-x",
        actorId: "bot-analyst",
        submissionId: SID_V1,
        artifactVersion: "v1",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",

        submissionSummary: "body",
      },
      { cfg },
    );
    expect(submitted.ok).toBe(false);
    if (!submitted.ok) {
      expect(submitted.reason).toBe("flag_off");
    }
  });

  test("empty + missing artifactVersion + pure restatement refuse success", async () => {
    const { cfg } = await useConfig({ claimContract: true });
    const auth = authority(cfg);
    const { itemId } = await reachInProgress(auth, cfg);

    const noVersion = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId: SID_V1,
        artifactVersion: "  ",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",

        submissionSummary: "chapter v1",
      },
      { cfg },
    );
    expect(noVersion.ok).toBe(false);
    if (!noVersion.ok) {
      expect(noVersion.reason).toBe("invalid_artifact_version");
    }

    const empty = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId: SID_V1,
        artifactVersion: "v1.0.0",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",

        submissionSummary: "   ",
      },
      { cfg },
    );
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.reason).toBe("empty_submission");
    }

    const submitted = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId: SID_V1,
        artifactVersion: "v1.0.0",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",

        submissionSummary: "chapter v1 draft",
      },
      { cfg },
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) {
      return;
    }
    expect(submitted.value.submissionId).toBe(SID_V1);
    expect(submitted.value.artifactVersion).toBe("v1.0.0");

    const returned = await returnBoardItemSubmission(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "human-ceo",
        reason: "need sources",
        expectedSubmissionId: SID_V1,
      },
      { cfg, coordinatorBotId: "human-ceo" },
    );
    expect(returned.ok).toBe(true);
    if (!returned.ok) {
      return;
    }
    expect(returned.value.status).toBe("returned");
    expect(returned.value.submissionId).toBeUndefined();
    expect(returned.value.lastReturnedSubmissionId).toBe(SID_V1);
    expect(returned.value.lastReturnedArtifactVersion).toBe("v1.0.0");

    await markBoardItemInProgress(
      auth,
      { taskId: seedTask.taskId, itemId, actorId: "bot-analyst" },
      { cfg },
    );
    const restated = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId: SID_V2,
        artifactVersion: "v1.0.1",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",

        submissionSummary: "chapter v1 draft",
      },
      { cfg },
    );
    expect(restated.ok).toBe(false);
    if (!restated.ok) {
      expect(restated.reason).toBe("duplicate_submission");
    }
  });

  test("accept binds expectedSubmissionId; stale/wrong version + criteria skip refused", async () => {
    const { cfg } = await useConfig({ claimContract: true });
    const auth = authority(cfg);
    const { itemId } = await reachInProgress(auth, cfg, ["sources", "format"]);

    const submitted = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId: SID_V1,
        artifactVersion: "v2.0.0",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",

        submissionSummary: "deliverable with sources and format",
      },
      { cfg },
    );
    expect(submitted.ok).toBe(true);

    const wrongVersion = await acceptBoardItemSubmission(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "human-ceo",
        expectedSubmissionId: SID_V2,
        reason: "looks good",
        checkedAcceptanceCriteria: ["sources", "format"],
      },
      { cfg },
    );
    expect(wrongVersion.ok).toBe(false);
    if (!wrongVersion.ok) {
      expect(wrongVersion.reason).toBe("submission_version_mismatch");
    }

    const skipCriteria = await acceptBoardItemSubmission(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "human-ceo",
        expectedSubmissionId: SID_V1,
        reason: "主答说可以",
        checkedAcceptanceCriteria: ["sources"],
      },
      { cfg },
    );
    expect(skipCriteria.ok).toBe(false);
    if (!skipCriteria.ok) {
      expect(skipCriteria.reason).toBe("acceptance_criteria_incomplete");
    }

    const noReason = await acceptBoardItemSubmission(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "human-ceo",
        expectedSubmissionId: SID_V1,
        reason: "  ",
        checkedAcceptanceCriteria: ["sources", "format"],
      },
      { cfg },
    );
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) {
      expect(noReason.reason).toBe("acceptance_reason_required");
    }

    const proxyNoBasis = await acceptBoardItemSubmission(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-secretary",
        expectedSubmissionId: SID_V1,
        reason: "proxy accept attempt",
        checkedAcceptanceCriteria: ["sources", "format"],
        proxyForActorId: "human-ceo",
      },
      { cfg },
    );
    expect(proxyNoBasis.ok).toBe(false);
    if (!proxyNoBasis.ok) {
      expect(proxyNoBasis.reason).toBe("proxy_basis_required");
    }

    const accepted = await acceptBoardItemSubmission(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-secretary",
        expectedSubmissionId: SID_V1,
        reason: "Acceptance 全覆盖；代理群主验收",
        checkedAcceptanceCriteria: ["sources", "format"],
        proxyForActorId: "human-ceo",
        proxyBasis: "群主书面授权代验",
      },
      { cfg },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      return;
    }
    expect(accepted.value.status).toBe("accepted");
    expect(accepted.value.acceptedSubmissionId).toBe(SID_V1);
    expect(accepted.value.acceptedArtifactVersion).toBe("v2.0.0");
    expect(accepted.value.acceptanceReason).toContain("Acceptance");
    expect(accepted.value.checkedAcceptanceCriteria).toEqual(["sources", "format"]);
    expect(accepted.value.acceptanceVerdict).toBe("pass");
    expect(accepted.value.acceptanceProxyForActorId).toBe("human-ceo");
    expect(accepted.value.acceptanceProxyBasis).toBe("群主书面授权代验");
    expect(boardSubmissionStateContract(accepted.value.status).autoAdvanceAfter).toBe(false);

    const again = await acceptBoardItemSubmission(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "human-ceo",
        expectedSubmissionId: SID_V1,
        reason: "again",
        checkedAcceptanceCriteria: ["sources", "format"],
      },
      { cfg },
    );
    expect(again.ok).toBe(false);
    if (!again.ok) {
      expect(again.reason).toBe("invalid_status");
    }
  });

  test("late accept after return cannot cover old submission; concurrent stale refused", async () => {
    const { cfg } = await useConfig({ claimContract: true });
    const auth = authority(cfg);
    const { itemId } = await reachInProgress(auth, cfg);

    await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId: SID_V1,
        artifactVersion: "v1.0.0",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",

        submissionSummary: "first cut",
      },
      { cfg },
    );

    const returned = await returnBoardItemSubmission(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "human-ceo",
        reason: "revise",
        expectedSubmissionId: SID_V1,
      },
      { cfg },
    );
    expect(returned.ok).toBe(true);

    // Late accept of old version while returned / revising
    const lateAccept = await acceptBoardItemSubmission(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "human-ceo",
        expectedSubmissionId: SID_V1,
        reason: "late accept of v1",
        checkedAcceptanceCriteria: ["sources", "format"],
      },
      { cfg },
    );
    expect(lateAccept.ok).toBe(false);
    if (!lateAccept.ok) {
      expect(lateAccept.reason).toBe("invalid_status");
    }

    await markBoardItemInProgress(
      auth,
      { taskId: seedTask.taskId, itemId, actorId: "bot-analyst" },
      { cfg },
    );
    await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId: SID_V2,
        artifactVersion: "v1.1.0",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",

        submissionSummary: "second cut with sources",
      },
      { cfg },
    );

    // Stale accept still targeting v1 while v2 is pending
    const staleV1 = await acceptBoardItemSubmission(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "human-ceo",
        expectedSubmissionId: SID_V1,
        reason: "stale v1",
        checkedAcceptanceCriteria: ["sources", "format"],
      },
      { cfg },
    );
    expect(staleV1.ok).toBe(false);
    if (!staleV1.ok) {
      expect(staleV1.reason).toBe("submission_version_mismatch");
    }

    // Wrong return version
    const staleReturn = await returnBoardItemSubmission(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "human-ceo",
        reason: "stale return",
        expectedSubmissionId: SID_V1,
      },
      { cfg },
    );
    expect(staleReturn.ok).toBe(false);
    if (!staleReturn.ok) {
      expect(staleReturn.reason).toBe("submission_version_mismatch");
    }

    // Idempotent same submit
    const again = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId: SID_V2,
        artifactVersion: "v1.1.0",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",

        submissionSummary: "second cut with sources",
      },
      { cfg },
    );
    expect(again.ok).toBe(true);

    // Same id different artifactVersion clash
    const clash = await submitBoardItemForReviewSeeded(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "bot-analyst",
        submissionId: SID_V2,
        artifactVersion: "v9.9.9",
        linkedDeliverableId: "del-p2-test",
        linkedDeliverableVersion: 1,
        linkedContentSha256: "17fc254db0bd795757990fa86f50dca9c823b519536f3628873b9c2e751fb0f4",

        submissionSummary: "second cut with sources",
      },
      { cfg },
    );
    expect(clash.ok).toBe(false);
    if (!clash.ok) {
      expect(clash.reason).toBe("submission_version_clash");
    }

    const accepted = await acceptBoardItemSubmission(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "human-ceo",
        expectedSubmissionId: SID_V2,
        reason: "v2 passes Acceptance",
        checkedAcceptanceCriteria: ["sources", "format"],
      },
      { cfg },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      return;
    }
    expect(accepted.value.acceptedArtifactVersion).toBe("v1.1.0");
  });

  test("return over cap escalates; accepted is terminal", async () => {
    const { cfg } = await useConfig({ claimContract: true, maxReturns: 2 });
    const auth = authority(cfg);
    const { itemId } = await reachInProgress(auth, cfg, ["sources"]);

    for (let i = 0; i < 2; i += 1) {
      if (i > 0) {
        await markBoardItemInProgress(
          auth,
          { taskId: seedTask.taskId, itemId, actorId: "bot-analyst" },
          { cfg },
        );
      }
      const sid = i === 0 ? SID_V1 : SID_V3;
      const submitted = await submitBoardItemForReviewSeeded(
        auth,
        {
          taskId: seedTask.taskId,
          itemId,
          actorId: "bot-analyst",
          submissionId: sid,
          artifactVersion: `v1.${i}.0`,
          submissionSummary: `draft increment ${i}`,
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
          actorId: "human-ceo",
          reason: `revise ${i + 1}`,
          expectedSubmissionId: sid,
        },
        { cfg, coordinatorBotId: "human-ceo" },
      );
      expect(returned.ok).toBe(true);
      if (!returned.ok) {
        return;
      }
      expect(returned.value.returnCount).toBe(i + 1);
    }
    const loaded = await loadBoardClaimItem(auth, { taskId: seedTask.taskId, itemId });
    expect(loaded?.returnCount).toBe(2);
    expect(loaded?.status).toBe("returned");
    // P4/O4: cap hit clears return-revise relay (escalate-only).
    expect(loaded?.pendingEventRelay).toBeNull();
    expect(boardSubmissionStateContract("returned").acceptsLatePriorVersion).toBe(false);
  });
});
