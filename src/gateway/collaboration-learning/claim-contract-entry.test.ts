/**
 * P4b — production entry onto GroupBoardClaim publish → claim → apply.
 * Flag-off refuses; flag-on seeds assigned + responsibility and syncs operating state.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import { afterEach, describe, expect, test } from "vitest";
import {
  clearConfigCache,
  clearRuntimeConfigSnapshot,
  loadConfig,
  setRuntimeConfigSnapshot,
} from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import {
  applyCollaborationBoardClaim,
  claimCollaborationBoardItem,
  ClaimContractFlagOffError,
  listCollaborationBoardItems,
  oralDispatchCreatesBoardFact,
  markCollaborationBoardItemInProgress,
  returnCollaborationBoardItemSubmission,
  publishCollaborationBoardItem,
} from "./claim-contract-entry.js";
import { createWorkspaceCollaborationStores, readGroupOperatingState } from "./shared.js";

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

function flagConfig(root: string, claimContract: boolean): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: { claimContract },
    },
  } as OpenBotConfig;
}

async function useConfig(claimContract: boolean): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-p4b-entry-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  const cfg = flagConfig(root, claimContract);
  const configPath = path.join(root, "openbot.json");
  await fs.writeFile(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  process.env.OPENBOT_CONFIG_PATH = configPath;
  process.env.OPENCLAW_CONFIG_PATH = configPath;
  setRuntimeConfigSnapshot(cfg, cfg);
  clearConfigCache();
  return { root, cfg };
}

async function seedTask(groupId: string, task: Task): Promise<void> {
  const { objectStorage } = createWorkspaceCollaborationStores();
  await objectStorage.writeObject(groupId, "task", task.taskId, task);
}

const groupId = "grp_p4b";
const seed: Task = {
  taskId: "task-p4b-1",
  groupId,
  title: "2030 AI strategy PDF",
  status: "in_progress",
  ownerMemberId: "human-ceo",
  assignedMemberIds: ["human-ceo"],
  createdBy: "human-ceo",
  updatedBy: "human-ceo",
  createdAtMs: 1,
  updatedAtMs: 1,
};

describe("P4b claim contract production entry", () => {
  test("oral dispatch is never a board fact", () => {
    expect(oralDispatchCreatesBoardFact()).toBe(false);
  });

  test("flag-off: publish entry refuses", async () => {
    const { cfg } = await useConfig(false);
    await seedTask(groupId, seed);
    await expect(
      publishCollaborationBoardItem({
        groupId,
        taskId: seed.taskId,
        remainingWork: "tech chapter",
        acceptanceCriteria: ["sources"],
        intendedClaimantIds: ["bot-analyst"],
        actor: "bot-secretary",
        cfg,
      }),
    ).rejects.toBeInstanceOf(ClaimContractFlagOffError);
  });

  test("flag-off: markInProgress / returnSubmission entries refuse (C1 fail-closed)", async () => {
    const { cfg } = await useConfig(false);
    await expect(
      markCollaborationBoardItemInProgress({
        groupId: "grp_claim_entry",
        taskId: "task_1",
        itemId: "item_1",
        actor: "coord",
        cfg,
      }),
    ).rejects.toBeInstanceOf(ClaimContractFlagOffError);
    await expect(
      returnCollaborationBoardItemSubmission({
        groupId: "grp_claim_entry",
        taskId: "task_1",
        itemId: "item_1",
        actor: "coord",
        reason: "needs revision",
        expectedSubmissionId: "sub_missing",
        cfg,
      }),
    ).rejects.toBeInstanceOf(ClaimContractFlagOffError);
  });

  test("flag-on: publish → claim → apply updates assigned + currentTaskId", async () => {
    const { cfg } = await useConfig(true);
    expect(loadConfig().collaboration?.task?.claimContract).toBe(true);
    await seedTask(groupId, seed);

    const published = await publishCollaborationBoardItem({
      groupId,
      taskId: seed.taskId,
      remainingWork: "tech chapter with authoritative data",
      acceptanceCriteria: ["shared draft", "cite sources"],
      intendedClaimantIds: ["bot-analyst"],
      actor: "bot-secretary",
      cfg,
    });
    expect(published.status).toBe("published");

    const claimed = await claimCollaborationBoardItem({
      groupId,
      taskId: seed.taskId,
      itemId: published.itemId,
      claimantId: "bot-analyst",
      actor: "bot-analyst",
      cfg,
    });
    expect(claimed.status).toBe("claimed");

    const { task, item } = await applyCollaborationBoardClaim({
      groupId,
      taskId: seed.taskId,
      itemId: published.itemId,
      actor: "bot-analyst",
      cfg,
    });
    expect(item.status).toBe("applied");
    expect(task.assignedMemberIds).toContain("bot-analyst");
    expect(task.responsibility?.executors).toContain("bot-analyst");

    const { fileStore } = createWorkspaceCollaborationStores();
    const operating = await readGroupOperatingState({ fileStore, groupId });
    expect(operating?.activeContext.currentTaskId).toBe(seed.taskId);
  });

  test("flag-on: missing actor → actor_required; claimantId alone does not claim", async () => {
    const { cfg } = await useConfig(true);
    await seedTask(groupId, seed);
    const published = await publishCollaborationBoardItem({
      groupId,
      taskId: seed.taskId,
      remainingWork: "tech chapter with authoritative data",
      acceptanceCriteria: ["shared draft", "cite sources"],
      intendedClaimantIds: ["bot-analyst"],
      actor: "bot-secretary",
      cfg,
    });
    await expect(
      claimCollaborationBoardItem({
        groupId,
        taskId: seed.taskId,
        itemId: published.itemId,
        claimantId: "bot-analyst",
        // intentionally omit actor — must not backfill from claimantId
        cfg,
      }),
    ).rejects.toMatchObject({ code: "actor_required" });
    const listed = await listCollaborationBoardItems({ groupId, taskId: seed.taskId, cfg });
    const live = listed.find((row) => row.itemId === published.itemId);
    expect(live?.status).toBe("published");
    expect(live?.claimantId == null || live?.claimantId === "").toBe(true);
  });
});
