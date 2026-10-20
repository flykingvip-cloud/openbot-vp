/**
 * C3 — Peer review gate unit tests.
 * Flag-off accept unchanged; flag-on rejects without peer review; one peer allows accept.
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
  loadBoardClaimItem,
  markBoardItemInProgress,
  publishBoardItem,
  submitBoardItemForReview,
} from "./claim-contract.js";
import {
  isCollabTaskRequirePeerReviewEnabled,
  peerReviewMustNotDriveAdmission,
  recordPeerReview,
} from "./peer-review-gate.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority, type RuntimeAuthority } from "./runtime-authority.js";

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
  opts: { claimContract: boolean; requirePeerReview: boolean },
): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: {
        claimContract: opts.claimContract,
        requirePeerReview: opts.requirePeerReview,
      },
    },
  } as OpenBotConfig;
}

async function useConfig(opts: {
  claimContract: boolean;
  requirePeerReview: boolean;
}): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-c3-peer-"));
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

function authority(cfg: OpenBotConfig, groupId = "grp_peer"): RuntimeAuthority {
  const snapshot = createRoundPolicySnapshot(
    { collaborationMode: "task_driven", finalDecisionMode: "human_required" },
    { now: 1, idGen: () => "pss_peer_test" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_peer",
    tenant: { tenantId: null, trust: "none" },
    groupId,
    profile: "personal_local",
    cfg,
  });
}

const seedTask: Task = {
  taskId: "task-peer-1",
  groupId: "grp_peer",
  title: "2030 strategy chapter",
  status: "in_progress",
  ownerMemberId: "human-ceo",
  assignedMemberIds: ["human-ceo"],
  createdBy: "human-ceo",
  updatedBy: "human-ceo",
  createdAtMs: 1,
  updatedAtMs: 1,
};

const SUBMISSION_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

async function reachSubmitted(
  auth: RuntimeAuthority,
  cfg: OpenBotConfig,
): Promise<{ itemId: string }> {
  const published = await publishBoardItem(
    auth,
    {
      groupId: "grp_peer",
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
  const { proposeTodolist, confirmTodolist } = await import("./executor-private-todolist.js");
  const proposed = await proposeTodolist(
    auth,
    {
      boardItemId: itemId,
      taskId: seedTask.taskId,
      groupId: auth.groupId,
      ownerMemberId: "bot-analyst",
      steps: [{ title: "draft" }, { title: "sources" }],
    },
    { cfg },
  );
  expect(proposed.ok).toBe(true);
  if (!proposed.ok) {
    throw new Error("proposeTodolist failed");
  }
  const confirmed = await confirmTodolist(
    auth,
    {
      taskId: seedTask.taskId,
      todolistId: proposed.value.todolistId,
      confirmerId: "bot-secretary",
    },
    { cfg, authorizedConfirmerIds: ["bot-secretary"] },
  );
  expect(confirmed.ok).toBe(true);
  await markBoardItemInProgress(
    auth,
    { taskId: seedTask.taskId, itemId, actorId: "bot-analyst" },
    { cfg },
  );
  const submitted = await submitBoardItemForReview(
    auth,
    {
      taskId: seedTask.taskId,
      itemId,
      actorId: "bot-analyst",
      submissionId: SUBMISSION_ID,
      artifactVersion: "v1.0.0",
      submissionSummary: "chapter v1",
    },
    { cfg },
  );
  expect(submitted.ok).toBe(true);
  return { itemId };
}

describe("C3 peer review gate", () => {
  test("requirePeerReview defaults off; drivesAdmission invariant", async () => {
    const { cfg } = await useConfig({ claimContract: true, requirePeerReview: false });
    expect(isCollabTaskRequirePeerReviewEnabled(cfg)).toBe(false);
    expect(peerReviewMustNotDriveAdmission()).toBe(true);
  });

  test("flag-off: accept unchanged without peer review", async () => {
    const { cfg } = await useConfig({ claimContract: true, requirePeerReview: false });
    const auth = authority(cfg);
    const { itemId } = await reachSubmitted(auth, cfg);
    const accepted = await acceptBoardItemSubmission(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "human-ceo",
        expectedSubmissionId: SUBMISSION_ID,
        reason: "peer-review gate accept",
        checkedAcceptanceCriteria: ["sources"],
      },
      { cfg },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      return;
    }
    expect(accepted.value.status).toBe("accepted");
  });

  test("flag-on: reject accept without peer review", async () => {
    const { cfg } = await useConfig({ claimContract: true, requirePeerReview: true });
    expect(isCollabTaskRequirePeerReviewEnabled(cfg)).toBe(true);
    const auth = authority(cfg);
    const { itemId } = await reachSubmitted(auth, cfg);
    const accepted = await acceptBoardItemSubmission(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "human-ceo",
        expectedSubmissionId: SUBMISSION_ID,
        reason: "peer-review gate accept",
        checkedAcceptanceCriteria: ["sources"],
      },
      { cfg },
    );
    expect(accepted.ok).toBe(false);
    if (!accepted.ok) {
      expect(accepted.reason).toBe("peer_review_required");
    }
  });

  test("flag-on: self-review forbidden; one non-author peer review allows accept", async () => {
    const { cfg } = await useConfig({ claimContract: true, requirePeerReview: true });
    const auth = authority(cfg);
    const { itemId } = await reachSubmitted(auth, cfg);

    const itemForSelf = await loadBoardClaimItem(auth, { taskId: seedTask.taskId, itemId });
    expect(itemForSelf).toBeTruthy();
    const self = await recordPeerReview(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        reviewerId: "bot-analyst",
        verdict: "approve",
        item: itemForSelf!,
      },
      { cfg },
    );
    expect(self.ok).toBe(false);
    if (!self.ok) {
      expect(self.reason).toBe("self_review_forbidden");
    }

    const stillBlocked = await acceptBoardItemSubmission(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "human-ceo",
        expectedSubmissionId: SUBMISSION_ID,
        reason: "peer-review gate accept",
        checkedAcceptanceCriteria: ["sources"],
      },
      { cfg },
    );
    expect(stillBlocked.ok).toBe(false);

    const itemForPeer = await loadBoardClaimItem(auth, { taskId: seedTask.taskId, itemId });
    expect(itemForPeer).toBeTruthy();
    const peer = await recordPeerReview(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        reviewerId: "bot-market",
        verdict: "approve",
        comment: "sources look solid",
        item: itemForPeer!,
      },
      { cfg },
    );
    expect(peer.ok).toBe(true);
    if (!peer.ok) {
      return;
    }
    expect(peer.value.drivesAdmission).toBe(false);
    expect(peer.value.authorId).toBe("bot-analyst");
    expect(peer.value.submissionId).toBe(SUBMISSION_ID);

    const accepted = await acceptBoardItemSubmission(
      auth,
      {
        taskId: seedTask.taskId,
        itemId,
        actorId: "human-ceo",
        expectedSubmissionId: SUBMISSION_ID,
        reason: "peer-review gate accept",
        checkedAcceptanceCriteria: ["sources"],
      },
      { cfg },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      return;
    }
    expect(accepted.value.status).toBe("accepted");
  });
});
