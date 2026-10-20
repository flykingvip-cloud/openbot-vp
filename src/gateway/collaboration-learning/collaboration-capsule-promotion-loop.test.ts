import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../../config/config.js";
import { applyCapsuleGovernanceTransition } from "./capsule-governance.js";
import { promoteApprovedCapsuleIfEligible } from "./capsule-promotion.js";
import { buildMemoryFlushCandidateCapsule } from "./memory-flush-outcome-capsule.js";
import { createWorkspaceCollaborationStores } from "./shared.js";

const cleanupDirs: string[] = [];
let previousStateDir: string | undefined;
let previousOpenbotConfigPath: string | undefined;
let previousOpenclawConfigPath: string | undefined;

async function withIsolatedCollaborationStores<T>(
  workspaceDir: string,
  run: () => Promise<T>,
): Promise<T> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-capsule-transition-"));
  cleanupDirs.push(stateDir);
  previousStateDir = process.env.OPENBOT_STATE_DIR;
  previousOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
  previousOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;
  const isolatedConfigPath = path.join(stateDir, "openbot.json");
  process.env.OPENBOT_STATE_DIR = stateDir;
  process.env.OPENBOT_CONFIG_PATH = isolatedConfigPath;
  process.env.OPENCLAW_CONFIG_PATH = isolatedConfigPath;
  process.env.OPENCLAW_DISABLE_CONFIG_CACHE = "1";
  await fs.mkdir(path.dirname(isolatedConfigPath), { recursive: true });
  await fs.writeFile(
    isolatedConfigPath,
    JSON.stringify({
      agents: {
        list: [{ id: "bot-reviewer" }],
        defaults: { workspace: workspaceDir },
      },
      collaboration: { defaults: { workspace: path.join(workspaceDir, "collab-root") } },
    }),
    "utf8",
  );
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  try {
    return await run();
  } finally {
    clearRuntimeConfigSnapshot();
    clearConfigCache();
    if (previousStateDir === undefined) {
      delete process.env.OPENBOT_STATE_DIR;
    } else {
      process.env.OPENBOT_STATE_DIR = previousStateDir;
    }
    if (previousOpenbotConfigPath === undefined) {
      delete process.env.OPENBOT_CONFIG_PATH;
    } else {
      process.env.OPENBOT_CONFIG_PATH = previousOpenbotConfigPath;
    }
    if (previousOpenclawConfigPath === undefined) {
      delete process.env.OPENCLAW_CONFIG_PATH;
    } else {
      process.env.OPENCLAW_CONFIG_PATH = previousOpenclawConfigPath;
    }
  }
}

describe("collaboration capsule approve → promote closed loop", () => {
  afterEach(async () => {
    await Promise.all(
      cleanupDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("promotes memory candidate to projection and learning asset after governance approve", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "capsule-promote-loop-"));
    cleanupDirs.push(workspaceDir);

    await withIsolatedCollaborationStores(workspaceDir, async () => {
      const capsule = buildMemoryFlushCandidateCapsule({
        groupId: "group-1",
        botId: "bot-reviewer",
        participationId: "group-1::bot-reviewer",
        confidentialityTier: "internal",
        memoryFlushWritePath: "memory/2026-04-09.md",
        appendedMarkdown: "## Retro\n- summarize risks before approval",
        flushedAt: 1_000,
        memoryCompactionCompleted: false,
        workspaceDir,
        sessionKey: "sk-1",
      });
      expect(capsule?.status).toBe("candidate");

      const { learningStorage } = createWorkspaceCollaborationStores();
      await learningStorage.appendCapsule("group-1", capsule!);

      const approved = applyCapsuleGovernanceTransition(capsule!, "approved", {
        actor: "operator-1",
        reusability: "promotable",
      });
      const promotion = await promoteApprovedCapsuleIfEligible({
        groupId: "group-1",
        capsule: approved,
        targetBotId: "bot-reviewer",
        actor: "operator-1",
        approvalMode: "approved",
        learningStorage,
      });

      expect(promotion).toEqual(
        expect.objectContaining({
          promoted: true,
          projectionId: expect.any(String),
          assetId: expect.any(String),
          targetBotId: "bot-reviewer",
        }),
      );

      const assets = await learningStorage.readLearningAssets("group-1", "bot-reviewer");
      expect(assets.some((asset) => asset.assetId === promotion.assetId)).toBe(true);
    });
  });
});
