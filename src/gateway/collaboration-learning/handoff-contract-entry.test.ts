/**
 * P4a — production entry onto existing proposeHandoff* APIs.
 * Flag-off keeps collaboration.task.handoff / handoffCollaborationTask shortcut.
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
  acceptCollaborationTaskHandoffContract,
  applyCollaborationTaskHandoffContract,
  approveCollaborationTaskHandoffContract,
  HandoffContractFlagOffError,
  proposeCollaborationTaskHandoffContract,
} from "./handoff-contract-entry.js";
import { createWorkspaceCollaborationStores } from "./shared.js";
import { handoffCollaborationTask } from "./state-machine.js";

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

function flagConfig(root: string, handoffContract: boolean): OpenBotConfig {
  return {
    agents: { defaults: { workspace: path.join(root, "agent-ws") } },
    gateway: { security: { profile: "personal_local" } },
    collaboration: {
      defaults: { workspace: path.join(root, "collaboration") },
      runtimeNamespace: true,
      task: { handoffContract },
    },
  } as OpenBotConfig;
}

async function useConfig(handoffContract: boolean): Promise<{ root: string; cfg: OpenBotConfig }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-p4a-handoff-"));
  tempDirs.push(root);
  process.env.OPENBOT_STATE_DIR = path.join(root, "state");
  delete process.env.OPENBOT_SECURITY_PROFILE;
  delete process.env.OPENCLAW_SECURITY_PROFILE;
  const cfg = flagConfig(root, handoffContract);
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

const groupId = "grp_p4a";
const seed: Task = {
  taskId: "task-p4a-1",
  groupId,
  title: "P4a contract entry",
  status: "in_progress",
  ownerMemberId: "bot-a",
  assignedMemberIds: ["bot-a"],
  createdBy: "bot-a",
  updatedBy: "bot-a",
  createdAtMs: 1,
  updatedAtMs: 1,
};

describe("P4a handoff contract production entry", () => {
  test("flag-off: propose entry refuses; shortcut handoffCollaborationTask still mutates", async () => {
    const { cfg } = await useConfig(false);
    await seedTask(groupId, seed);

    await expect(
      proposeCollaborationTaskHandoffContract({
        groupId,
        taskId: seed.taskId,
        from: "bot-a",
        to: "bot-b",
        remainingWork: "finish the review",
        acceptanceCriteria: ["signed off"],
        cfg,
      }),
    ).rejects.toBeInstanceOf(HandoffContractFlagOffError);

    const updated = await handoffCollaborationTask({
      groupId,
      taskId: seed.taskId,
      from: "bot-a",
      to: "bot-b",
      reason: "owner_transfer",
      remainingWork: "finish the review",
      acceptanceCriteria: ["signed off"],
      actor: "bot-a",
    });
    expect(updated.ownerMemberId).toBe("bot-b");
    expect(updated.responsibility?.owner).toBe("bot-b");
  });

  test("flag-on: propose→accept→approve→apply closes loop and updates learning task store", async () => {
    const { cfg } = await useConfig(true);
    expect(loadConfig().collaboration?.task?.handoffContract).toBe(true);
    await seedTask(groupId, seed);

    const proposed = await proposeCollaborationTaskHandoffContract({
      groupId,
      taskId: seed.taskId,
      from: "bot-a",
      to: "bot-b",
      kind: "owner_transfer",
      remainingWork: "finish the review",
      acceptanceCriteria: ["signed off"],
      completedArtifacts: ["draft"],
      actor: "bot-a",
      cfg,
    });
    expect(proposed.status).toBe("proposed");
    expect(proposed.handoffId).toBeTruthy();

    const accepted = await acceptCollaborationTaskHandoffContract({
      groupId,
      taskId: seed.taskId,
      handoffId: proposed.handoffId,
      actor: "bot-b",
      actorType: "bot",
      cfg,
    });
    expect(accepted.status).toBe("receiver_accepted");

    const approved = await approveCollaborationTaskHandoffContract({
      groupId,
      taskId: seed.taskId,
      handoffId: proposed.handoffId,
      actor: "owner-1",
      actorType: "human",
      cfg,
    });
    expect(approved.status).toBe("approved");

    const applied = await applyCollaborationTaskHandoffContract({
      groupId,
      taskId: seed.taskId,
      handoffId: proposed.handoffId,
      actor: "owner-1",
      cfg,
    });
    expect(applied.ownerMemberId).toBe("bot-b");
    expect(applied.responsibility?.owner).toBe("bot-b");
    // owner_transfer updates owner only; executors/assigned stay until a continue handoff
    expect(applied.responsibility?.executors).toEqual(["bot-a"]);

    const { objectStorage } = createWorkspaceCollaborationStores();
    const persisted = await objectStorage.readObject<Task>(groupId, "task", seed.taskId);
    expect(persisted?.ownerMemberId).toBe("bot-b");
    expect(persisted?.responsibility?.owner).toBe("bot-b");
  });

  test("flag-on: shortcut collaboration.task.handoff path still refused", async () => {
    const { cfg } = await useConfig(true);
    await seedTask(groupId, seed);
    await expect(
      handoffCollaborationTask({
        groupId,
        taskId: seed.taskId,
        from: "bot-a",
        to: "bot-b",
        reason: "owner_transfer",
        remainingWork: "finish the review",
        acceptanceCriteria: ["signed off"],
        actor: "bot-a",
      }),
    ).rejects.toThrow(/proposeHandoff → acceptHandoff → approveHandoff → applyApprovedHandoff/);
    expect(cfg.collaboration?.task?.handoffContract).toBe(true);
  });
});
