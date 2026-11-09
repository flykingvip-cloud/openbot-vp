/**
 * Production acceptance loop: submitBoardItemForReview → returnBoardItemSubmission
 * → acceptBoardItemSubmission. Chat「完成」must not flip accepted; authorized
 * accept with a real rationale still succeeds.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, it } from "vitest";
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
import { submitCollaborationBoardItemForReview } from "./claim-contract-entry.js";
import {
  CHAT_COMPLETION_IS_NOT_ACCEPTANCE,
  isBareChatCompletionPhrase,
} from "./formal-delivery-acceptance.js";
import {
  recoverPendingBoardEventRelays,
  triggerPostSubmissionEventAdvance,
} from "./post-submission-event-advance.js";
import { trustedLocatorFromAuthority } from "./verify-linked-team-deliverable.js";
import {
  P2_LINKED_DELIVERABLE_FIXTURE_BODY,
  seedLinkedTeamDeliverableFixture,
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
        selfAdvance: { mode: "execute", executeGroupAllowlist: ["grp_formal_accept"] },
      },
    },
  } as OpenBotConfig;
}

async function useConfig(): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-formal-accept-"));
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
    { now: 1, idGen: () => "pss_formal_accept" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_formal_accept",
    tenant: { tenantId: "tenant-formal-accept", trust: "none" },
    groupId: "grp_formal_accept",
    profile: "personal_local",
    cfg,
  });
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
    deliverableId: opts?.deliverableId ?? "del-formal-accept",
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

async function seedInProgress(params: {
  auth: RuntimeAuthority;
  cfg: OpenBotConfig;
  taskId: string;
  claimant: string;
  reviewer: string;
}) {
  const seedTask: Task = {
    taskId: params.taskId,
    groupId: params.auth.groupId,
    title: "formal acceptance deliverable",
    status: "in_progress",
    ownerMemberId: params.reviewer,
    assignedMemberIds: [params.reviewer],
    createdBy: params.reviewer,
    updatedBy: params.reviewer,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
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
      steps: [{ title: "draft short md" }],
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

describe("formal delivery acceptance (production entries)", () => {
  it("isBareChatCompletionPhrase only matches bare completion claims", () => {
    expect(isBareChatCompletionPhrase("完成")).toBe(true);
    expect(isBareChatCompletionPhrase("闭环完成")).toBe(true);
    expect(isBareChatCompletionPhrase("meets acceptance criteria")).toBe(false);
    expect(CHAT_COMPLETION_IS_NOT_ACCEPTANCE).toBe("chat_completion_is_not_acceptance");
  });

  it("submit → return → revise → accept persists accepted; bare 完成 never writes", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-formal-accept-loop";
    const executorA = "bot-a";
    const reviewerB = "bot-b";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: executorA,
      reviewer: reviewerB,
    });
    const link = await seedLink(auth, taskId, { deliverableId: "del-formal-v1" });
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
        ...link,
      },
      { cfg, coordinatorBotId: reviewerB },
    );
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) {
      throw new Error(submitted.message);
    }
    expect(submitted.value.status).toBe("submitted_for_review");

    const chatRefuse = await acceptBoardItemSubmission(
      auth,
      {
        taskId,
        itemId: item.itemId,
        actorId: reviewerB,
        expectedSubmissionId: submissionId,
        reason: "完成",
        checkedAcceptanceCriteria: ["has title", "has body"],
      },
      { cfg },
    );
    expect(chatRefuse.ok).toBe(false);
    if (!chatRefuse.ok) {
      expect(chatRefuse.reason).toBe(CHAT_COMPLETION_IS_NOT_ACCEPTANCE);
    }
    expect(submitted.value.status).toBe("submitted_for_review");

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
    expect(returned.value.status).toBe("returned");

    const late = await acceptBoardItemSubmission(
      auth,
      {
        taskId,
        itemId: item.itemId,
        actorId: reviewerB,
        expectedSubmissionId: submissionId,
        reason: "late accept of returned version",
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
    const linkV2 = await seedLink(auth, taskId, {
      deliverableId: "del-formal-v2",
      version: 2,
      content: "# Draft v2\nrevised\n",
    });
    const submissionId2 = randomUUID();
    const revised = await submitBoardItemForReview(
      auth,
      {
        taskId,
        itemId: item.itemId,
        actorId: executorA,
        submissionId: submissionId2,
        artifactVersion: "art-v2",
        submissionSummary: "# Draft v2\nrevised",
        ...linkV2,
      },
      { cfg, coordinatorBotId: reviewerB },
    );
    expect(revised.ok).toBe(true);
    if (!revised.ok) {
      throw new Error(revised.message);
    }

    // Authorized accept with a real rationale (not a bare chat completion) must succeed.
    const accepted = await acceptBoardItemSubmission(
      auth,
      {
        taskId,
        itemId: item.itemId,
        actorId: reviewerB,
        expectedSubmissionId: submissionId2,
        reason: "meets acceptance criteria after revision",
        checkedAcceptanceCriteria: ["has title", "has body"],
      },
      { cfg },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      throw new Error(accepted.message);
    }
    expect(accepted.value.status).toBe("accepted");
    expect(accepted.value.acceptedSubmissionId).toBe(submissionId2);

    // Chat phrase still refused even after formal accept path proved.
    const chatAgain = await acceptBoardItemSubmission(
      auth,
      {
        taskId,
        itemId: item.itemId,
        actorId: reviewerB,
        expectedSubmissionId: submissionId2,
        reason: "闭环完成",
        checkedAcceptanceCriteria: ["has title", "has body"],
      },
      { cfg },
    );
    expect(chatAgain.ok).toBe(false);
    if (!chatAgain.ok) {
      expect(chatAgain.reason).toBe(CHAT_COMPLETION_IS_NOT_ACCEPTANCE);
    }
  });

  it("acceptBoardItemSubmission refuses bare chat completion before any write", async () => {
    const result = await acceptBoardItemSubmission({} as RuntimeAuthority, {
      taskId: "d2t-1a878cb6fbef8cd92109834f",
      itemId: "item-1",
      actorId: "human-ceo",
      reason: "闭环完成",
      expectedSubmissionId: "sub-1",
      checkedAcceptanceCriteria: ["有标题"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe(CHAT_COMPLETION_IS_NOT_ACCEPTANCE);
    }
  });

  it("member artifact stays unaccepted until review, and a failed group relay is not delivered twice", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const taskId = "task-group-delivery-loop";
    const executorA = "bot-a";
    const reviewerB = "bot-b";
    const { item } = await seedInProgress({
      auth,
      cfg,
      taskId,
      claimant: executorA,
      reviewer: reviewerB,
    });
    const link = await seedLink(auth, taskId, { deliverableId: "del-group-v1" });
    const submissionId = randomUUID();
    const submitted = await submitCollaborationBoardItemForReview({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      submissionId,
      artifactVersion: "art-v1",
      submissionSummary: "# Draft v1\nbody",
      ...link,
      actor: executorA,
      cfg,
      relayAdvance: false,
    });
    // Member submission is not group close, and the draft is not the accepted artifact.
    expect(submitted.item.status).toBe("submitted_for_review");
    expect(submitted.item.acceptedSubmissionId).toBeUndefined();
    expect(submitted.item.acceptedArtifactVersion).toBeUndefined();

    const trusted = trustedLocatorFromAuthority(auth);
    const failedRelay = await triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      actorId: reviewerB,
      cfg,
      trusted,
      roundDispatcher: async () => ({ ok: false, reason: "channel_offline" }),
    });
    expect(failedRelay.dispatched).toBe(false);
    expect(failedRelay.reason).toContain("dispatch_failed");
    const afterFail = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(afterFail?.status).toBe("submitted_for_review");
    expect(afterFail?.acceptedSubmissionId).toBeUndefined();
    // Unknown side effect is not recorded as delivered and is not auto-retried as success.
    expect(afterFail?.pendingEventRelay?.status).toBe("unknown");

    let relayCalls = 0;
    const recovered = await recoverPendingBoardEventRelays({
      groupId: auth.groupId,
      taskId,
      actorId: reviewerB,
      items: afterFail ? [afterFail] : [],
      cfg,
      authority: auth,
      trusted,
      roundDispatcher: async () => {
        relayCalls += 1;
        return { ok: true, roundId: "group-review-retry" };
      },
    });
    expect(recovered).toHaveLength(0);
    expect(relayCalls).toBe(0);
    const stillOpen = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(stillOpen?.status).toBe("submitted_for_review");
    expect(stillOpen?.acceptedSubmissionId).toBeUndefined();

    const accepted = await acceptBoardItemSubmission(
      auth,
      {
        taskId,
        itemId: item.itemId,
        actorId: reviewerB,
        expectedSubmissionId: submissionId,
        reason: "meets acceptance criteria after review",
        checkedAcceptanceCriteria: ["has title", "has body"],
      },
      { cfg },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      throw new Error(accepted.message);
    }
    expect(accepted.value.status).toBe("accepted");
    expect(accepted.value.acceptedSubmissionId).toBe(submissionId);

    const acceptAgain = await acceptBoardItemSubmission(
      auth,
      {
        taskId,
        itemId: item.itemId,
        actorId: reviewerB,
        expectedSubmissionId: submissionId,
        reason: "meets acceptance criteria after review",
        checkedAcceptanceCriteria: ["has title", "has body"],
      },
      { cfg },
    );
    expect(acceptAgain.ok).toBe(false);
    const afterAccept = await triggerPostSubmissionEventAdvance({
      groupId: auth.groupId,
      taskId,
      itemId: item.itemId,
      actorId: reviewerB,
      cfg,
      trusted,
      roundDispatcher: async () => {
        relayCalls += 1;
        throw new Error("must not re-run member or delivery work after accept");
      },
    });
    expect(afterAccept.dispatched).toBe(false);
    expect(relayCalls).toBe(0);
    const closed = await loadBoardClaimItem(auth, { taskId, itemId: item.itemId });
    expect(closed?.status).toBe("accepted");
    expect(closed?.acceptedSubmissionId).toBe(submissionId);
  });
});
