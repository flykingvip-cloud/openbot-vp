/**
 * FINAL v3 — explicit unblock restores an executable board state.
 * Ordinary self-advance does not clear blocked. Cancel/accepted stay stopped.
 * Heartbeat only nudges; it does not call unblock.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { validateCollaborationTaskUnblockBoardItemParams } from "../protocol/index.js";
import {
  acceptBoardItemSubmission,
  applyClaim,
  blockBoardItem,
  cancelBoardItem,
  claimBoardItem,
  loadBoardClaimItem,
  markBoardItemInProgress,
  publishBoardItem,
  submitBoardItemForReview,
  unblockBoardItem,
} from "./claim-contract.js";
import { confirmTodolist, proposeTodolist } from "./executor-private-todolist.js";
import { planHeartbeatActionForItem } from "./group-task-heartbeat.js";
import { createRoundPolicySnapshot } from "./round-policy-snapshot.js";
import { createRuntimeAuthority, type RuntimeAuthority } from "./runtime-authority.js";
import { isSelfAdvanceActiveBoardItem, trySelfAdvance } from "./self-advance.js";

const GROUP_ID = "grp_unblock";
const TASK_ID = "task_unblock";

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

function flagConfig(root: string): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: { claimContract: true, wakeContract: true },
    },
  } as OpenBotConfig;
}

async function useConfig(): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-unblock-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
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
    {
      collaborationMode: "task_driven",
      finalDecisionMode: "human_required",
      botMaySelfAdvanceWithoutHuman: true,
    },
    { now: 1, idGen: () => "pss_unblock" },
  );
  return createRuntimeAuthority({
    snapshot,
    episodeId: "ep_unblock",
    tenant: { tenantId: null, trust: "none" },
    groupId: GROUP_ID,
    profile: "personal_local",
    cfg,
  });
}

const seedTask = {
  taskId: TASK_ID,
  title: "unblock",
  status: "open",
} as unknown as Task;

async function publishClaimApply(auth: RuntimeAuthority, cfg: OpenBotConfig, goal: string) {
  const published = await publishBoardItem(
    auth,
    {
      groupId: GROUP_ID,
      taskId: TASK_ID,
      remainingWork: goal,
      acceptanceCriteria: ["含来源"],
      goal,
      intendedClaimantIds: ["bot-analyst"],
      publishedBy: "bot-lead",
    },
    { cfg },
  );
  expect(published.ok).toBe(true);
  if (!published.ok) {
    throw new Error(published.message);
  }
  const itemId = published.value.itemId;
  const claimed = await claimBoardItem(
    auth,
    { taskId: TASK_ID, itemId, claimantId: "bot-analyst" },
    { cfg },
  );
  expect(claimed.ok).toBe(true);
  const applied = await applyClaim(
    auth,
    { taskId: TASK_ID, itemId },
    seedTask,
    auth.policy.effective,
    { cfg },
  );
  expect(applied.ok).toBe(true);
  return itemId;
}

async function confirmPlan(auth: RuntimeAuthority, cfg: OpenBotConfig, itemId: string) {
  const proposed = await proposeTodolist(
    auth,
    {
      boardItemId: itemId,
      taskId: TASK_ID,
      groupId: GROUP_ID,
      ownerMemberId: "bot-analyst",
      steps: [{ title: "推进当前步" }],
    },
    { cfg },
  );
  expect(proposed.ok).toBe(true);
  if (!proposed.ok) {
    throw new Error(proposed.message);
  }
  const confirmed = await confirmTodolist(
    auth,
    {
      taskId: TASK_ID,
      todolistId: proposed.value.todolistId,
      confirmerId: "bot-lead",
    },
    { cfg, authorizedConfirmerIds: ["bot-lead"] },
  );
  expect(confirmed.ok).toBe(true);
}

describe("blocked recovery", () => {
  test("schema requires an unblock reason and rejects extra fields", () => {
    expect(
      validateCollaborationTaskUnblockBoardItemParams({
        groupId: GROUP_ID,
        taskId: TASK_ID,
        itemId: "item-1",
        reason: "human cleared",
      }),
    ).toBe(true);
    expect(
      validateCollaborationTaskUnblockBoardItemParams({
        groupId: GROUP_ID,
        taskId: TASK_ID,
        itemId: "item-1",
      }),
    ).toBe(false);
    expect(
      validateCollaborationTaskUnblockBoardItemParams({
        groupId: GROUP_ID,
        taskId: TASK_ID,
        itemId: "item-1",
        reason: "human cleared",
        actorId: "spoof",
      }),
    ).toBe(false);
  });

  test("blocked refuses self-advance; authorized unblock resumes; cancel and accepted stay stopped", async () => {
    const { cfg } = await useConfig();
    const auth = authority(cfg);
    const itemId = await publishClaimApply(auth, cfg, "可恢复交付");
    await confirmPlan(auth, cfg, itemId);
    const inProg = await markBoardItemInProgress(
      auth,
      { taskId: TASK_ID, itemId, actorId: "bot-analyst" },
      { cfg },
    );
    expect(inProg.ok).toBe(true);

    const blocked = await blockBoardItem(
      auth,
      { taskId: TASK_ID, itemId, actorId: "human-reviewer", reason: "waiting input" },
      { cfg },
    );
    expect(blocked.ok).toBe(true);
    if (!blocked.ok) {
      return;
    }
    expect(blocked.value.status).toBe("blocked");
    expect(blocked.value.blockedFromStatus).toBe("in_progress");
    expect(blocked.value.blockedBy).toBe("human-reviewer");
    expect(isSelfAdvanceActiveBoardItem(blocked.value)).toBe(false);

    const refused = await trySelfAdvance(auth, {
      cfg,
      actorId: "bot-analyst",
      currentMission: "AI×能源研究与交付",
      dryRun: true,
      boardItems: [blocked.value],
    });
    expect(refused.ok).toBe(true);
    if (!refused.ok) {
      return;
    }
    expect(refused.advanced).toBe(false);
    expect(refused.executed).toBe(false);

    const selfClear = await unblockBoardItem(
      auth,
      {
        taskId: TASK_ID,
        itemId,
        actorId: "bot-analyst",
        reason: "executor tries to clear",
      },
      { cfg },
    );
    expect(selfClear.ok).toBe(false);
    if (!selfClear.ok) {
      expect(selfClear.reason).toBe("self_unblock_forbidden");
    }
    expect((await loadBoardClaimItem(auth, { taskId: TASK_ID, itemId }))?.status).toBe("blocked");

    const { collaborationLearningHandlers } =
      await import("../server-methods/collaboration-learning.js");
    const respond = vi.fn();
    await collaborationLearningHandlers["collaboration.task.unblockBoardItem"]({
      req: {} as never,
      params: {
        groupId: GROUP_ID,
        taskId: TASK_ID,
        itemId,
        reason: "human cleared the block",
      },
      respond: respond as never,
      context: {} as never,
      client: { connect: { user: "human-reviewer" } } as never,
      isWebchatConnect: () => false,
    });
    expect(respond.mock.calls[0]?.[0]).toBe(true);
    const recovered = await loadBoardClaimItem(auth, { taskId: TASK_ID, itemId });
    expect(recovered?.status).toBe("in_progress");
    expect(recovered?.unblockedBy).toBe("human-reviewer");
    expect(recovered?.unblockReason).toBe("human cleared the block");
    expect(recovered && isSelfAdvanceActiveBoardItem(recovered)).toBe(true);

    const resumed = await trySelfAdvance(auth, {
      cfg,
      actorId: "bot-analyst",
      currentMission: "AI×能源研究与交付",
      dryRun: true,
      boardItems: recovered ? [recovered] : [],
    });
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) {
      return;
    }
    expect(resumed.advanced).toBe(true);
    expect(resumed.execMode).toBe("delivery_exec");

    const stale = await publishBoardItem(
      auth,
      {
        groupId: GROUP_ID,
        taskId: TASK_ID,
        remainingWork: "stale smoke",
        acceptanceCriteria: ["含来源"],
        publishedBy: "bot-lead",
      },
      { cfg },
    );
    expect(stale.ok).toBe(true);
    if (!stale.ok) {
      return;
    }
    const cancelled = await cancelBoardItem(
      auth,
      {
        taskId: TASK_ID,
        itemId: stale.value.itemId,
        actorId: "human-reviewer",
        reason: "drop smoke",
      },
      { cfg },
    );
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) {
      return;
    }
    const unblockCancelled = await unblockBoardItem(
      auth,
      {
        taskId: TASK_ID,
        itemId: stale.value.itemId,
        actorId: "human-reviewer",
        reason: "should not revive",
      },
      { cfg },
    );
    expect(unblockCancelled.ok).toBe(false);
    const cancelAdvance = await trySelfAdvance(auth, {
      cfg,
      actorId: "bot-analyst",
      currentMission: "AI×能源研究与交付",
      dryRun: true,
      boardItems: [cancelled.value],
    });
    expect(cancelAdvance.ok).toBe(true);
    if (cancelAdvance.ok) {
      expect(cancelAdvance.advanced).toBe(false);
      expect(cancelAdvance.executed).toBe(false);
    }

    const terminalId = await publishClaimApply(auth, cfg, "终态交付");
    await confirmPlan(auth, cfg, terminalId);
    await markBoardItemInProgress(
      auth,
      { taskId: TASK_ID, itemId: terminalId, actorId: "bot-analyst" },
      { cfg },
    );
    const submissionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const submitted = await submitBoardItemForReview(
      auth,
      {
        taskId: TASK_ID,
        itemId: terminalId,
        actorId: "bot-analyst",
        submissionId,
        artifactVersion: "v1.0.0",
        submissionSummary: "final chapter",
      },
      { cfg },
    );
    expect(submitted.ok).toBe(true);
    const accepted = await acceptBoardItemSubmission(
      auth,
      {
        taskId: TASK_ID,
        itemId: terminalId,
        actorId: "human-reviewer",
        expectedSubmissionId: submissionId,
        reason: "meets acceptance",
        checkedAcceptanceCriteria: ["含来源"],
      },
      { cfg },
    );
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      return;
    }
    expect(accepted.value.status).toBe("accepted");
    const unblockAccepted = await unblockBoardItem(
      auth,
      {
        taskId: TASK_ID,
        itemId: terminalId,
        actorId: "human-reviewer",
        reason: "should not revive accepted",
      },
      { cfg },
    );
    expect(unblockAccepted.ok).toBe(false);
    const terminalAdvance = await trySelfAdvance(auth, {
      cfg,
      actorId: "bot-analyst",
      currentMission: "AI×能源研究与交付",
      dryRun: true,
      boardItems: [accepted.value],
    });
    expect(terminalAdvance.ok).toBe(true);
    if (terminalAdvance.ok) {
      expect(terminalAdvance.advanced).toBe(false);
    }
  });

  test("heartbeat nudge does not unblock", async () => {
    const source = await fs.readFile(
      fileURLToPath(new URL("./group-task-heartbeat.ts", import.meta.url)),
      "utf8",
    );
    expect(source).not.toContain("unblockBoardItem");
    const decision = planHeartbeatActionForItem({
      item: {
        itemId: "i-blocked",
        groupId: GROUP_ID,
        taskId: TASK_ID,
        status: "blocked",
        claimantId: "bot-analyst",
        blockedAt: 1,
      },
      nowMs: 10,
      escalateAfter: 2,
      escalateTo: ["human-reviewer"],
    });
    expect(["nudge", "escalate", "skip"]).toContain(decision.action);
    expect(decision.status).toBe("blocked");
  });
});
