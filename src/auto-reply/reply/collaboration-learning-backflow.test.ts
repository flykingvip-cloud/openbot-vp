import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../../config/config.js";
import { applyCapsuleGovernanceTransition } from "../../gateway/collaboration-learning/capsule-governance.js";
import { promoteApprovedCapsuleIfEligible } from "../../gateway/collaboration-learning/capsule-promotion.js";
import { createWorkspaceCollaborationStores } from "../../gateway/collaboration-learning/shared.js";
import { runCollaborationLearningBackflow } from "./collaboration-learning-backflow.js";

vi.mock(
  "../../gateway/collaboration-learning/collaboration-satisfaction.js",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../gateway/collaboration-learning/collaboration-satisfaction.js")
      >();
    return {
      ...actual,
      recordMemoryFlushSatisfactionBestEffort: vi.fn(
        actual.recordMemoryFlushSatisfactionBestEffort,
      ),
    };
  },
);

const cleanupDirs: string[] = [];
let previousStateDir: string | undefined;
let previousOpenbotConfigPath: string | undefined;
let previousOpenclawConfigPath: string | undefined;
let previousDisableConfigCache: string | undefined;

async function withIsolatedCollaborationStores<T>(
  workspaceDir: string,
  run: () => Promise<T>,
): Promise<T> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-collab-backflow-state-"));
  cleanupDirs.push(stateDir);
  previousStateDir = process.env.OPENBOT_STATE_DIR;
  previousOpenbotConfigPath = process.env.OPENBOT_CONFIG_PATH;
  previousOpenclawConfigPath = process.env.OPENCLAW_CONFIG_PATH;
  previousDisableConfigCache = process.env.OPENCLAW_DISABLE_CONFIG_CACHE;
  const isolatedConfigPath = path.join(stateDir, "openbot.json");
  process.env.OPENBOT_STATE_DIR = stateDir;
  // OPENBOT_CONFIG_PATH wins over OPENCLAW_CONFIG_PATH — both must point at the isolated file.
  process.env.OPENBOT_CONFIG_PATH = isolatedConfigPath;
  process.env.OPENCLAW_CONFIG_PATH = isolatedConfigPath;
  process.env.OPENCLAW_DISABLE_CONFIG_CACHE = "1";
  await fs.mkdir(path.dirname(isolatedConfigPath), { recursive: true });
  await fs.writeFile(
    isolatedConfigPath,
    JSON.stringify({
      agents: {
        list: [{ id: "bot-reviewer" }, { id: "bot-ops" }],
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
    if (previousDisableConfigCache === undefined) {
      delete process.env.OPENCLAW_DISABLE_CONFIG_CACHE;
    } else {
      process.env.OPENCLAW_DISABLE_CONFIG_CACHE = previousDisableConfigCache;
    }
  }
}

describe("runCollaborationLearningBackflow", () => {
  afterEach(async () => {
    vi.clearAllMocks();
    await Promise.all(
      cleanupDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("creates candidate capsule only; promotion happens after governance approve", async () => {
    const workspaceDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "collaboration-learning-backflow-"),
    );
    cleanupDirs.push(workspaceDir);

    const memoryPath = path.join(workspaceDir, "memory", "2026-04-09.md");
    await fs.mkdir(path.dirname(memoryPath), { recursive: true });
    await fs.writeFile(
      memoryPath,
      [
        "## Release Retrospective",
        "- Reviewer bot learned to summarize release risks before approval.",
        "- Keep the final publish checklist explicit.",
      ].join("\n"),
      "utf-8",
    );

    const {
      result,
      capsule,
      projectionBefore,
      assetBefore,
      approvedPromotion,
      projectionAfter,
      assetAfter,
    } = await withIsolatedCollaborationStores(workspaceDir, async () => {
      const result = await runCollaborationLearningBackflow({
        result: {
          payloads: [],
          meta: {
            durationMs: 50,
            agentMeta: {
              sessionId: "session-1",
              provider: "anthropic",
              model: "claude-opus-4-1",
            },
          },
        },
        memoryFlushWritePath: "memory/2026-04-09.md",
        workspaceDir,
        memoryFlushFileSizeBefore: 0,
        flushedAt: 1_234,
        sessionKey: "session-key",
        sessionEntry: {
          sessionId: "session-1",
          updatedAt: 1_234,
          sessionFile: "sessions/session-1.jsonl",
          groupId: "group-1",
          collaborationGroupProfile: {
            groupId: "group-1",
            updatedAtMs: 1,
            confidentialityTier: "internal",
          },
          collaborationParticipationOverlay: {
            participationId: "group-1::bot-reviewer",
            groupId: "group-1",
            botId: "bot-reviewer",
            overlayCapabilities: [],
            confidentialityTier: "internal",
          },
        },
        memoryCompactionCompleted: false,
      });
      const { learningStorage } = createWorkspaceCollaborationStores();
      const capsules = await learningStorage.readCapsules("group-1");
      const capsule = capsules.find((entry) => entry.capsuleId === result.capsuleId);
      const projectionsBefore = await learningStorage.readProjections("group-1");
      const assetsBefore = await learningStorage.readLearningAssets("group-1", "bot-reviewer");

      let approvedPromotion:
        | Awaited<ReturnType<typeof promoteApprovedCapsuleIfEligible>>
        | undefined;
      if (capsule) {
        const approved = applyCapsuleGovernanceTransition(capsule, "approved", {
          actor: "operator-1",
          reusability: "promotable",
        });
        approvedPromotion = await promoteApprovedCapsuleIfEligible({
          groupId: "group-1",
          capsule: approved,
          targetBotId: "bot-reviewer",
          actor: "operator-1",
          approvalMode: "approved",
          learningStorage,
        });
      }

      const projectionsAfter = await learningStorage.readProjections("group-1");
      const assetsAfter = await learningStorage.readLearningAssets("group-1", "bot-reviewer");

      return {
        result,
        capsule,
        projectionBefore: projectionsBefore[0],
        assetBefore: assetsBefore[0],
        approvedPromotion,
        projectionAfter: projectionsAfter[0],
        assetAfter: assetsAfter[0],
      };
    });

    expect(result).toEqual(
      expect.objectContaining({
        capsuleId: expect.any(String),
      }),
    );
    expect(result.skipped).toBeUndefined();

    expect(capsule).toEqual(
      expect.objectContaining({
        groupId: "group-1",
        sourceType: "memory",
        capsuleType: "lesson",
        title: "Release Retrospective",
        status: "candidate",
        reusability: "group_only",
      }),
    );

    expect(projectionBefore).toBeUndefined();
    expect(assetBefore).toBeUndefined();

    expect(approvedPromotion).toEqual(
      expect.objectContaining({
        promoted: true,
        projectionId: expect.any(String),
        assetId: expect.any(String),
        targetBotId: "bot-reviewer",
      }),
    );
    expect(projectionAfter).toEqual(
      expect.objectContaining({
        targetBotId: "bot-reviewer",
        approvalStatus: "approved",
      }),
    );
    expect(assetAfter).toEqual(
      expect.objectContaining({
        botId: "bot-reviewer",
        status: "active",
      }),
    );

    const { recordMemoryFlushSatisfactionBestEffort: recordFlushSatisfaction } =
      await import("../../gateway/collaboration-learning/collaboration-satisfaction.js");
    expect(recordFlushSatisfaction).toHaveBeenCalledWith({
      botId: "bot-reviewer",
    });
  });

  it("keeps restricted memory as candidate without auto promotion", async () => {
    const workspaceDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "collaboration-learning-backflow-restricted-"),
    );
    cleanupDirs.push(workspaceDir);

    const memoryPath = path.join(workspaceDir, "memory", "2026-04-09.md");
    await fs.mkdir(path.dirname(memoryPath), { recursive: true });
    await fs.writeFile(memoryPath, "- Internal hiring rule draft", "utf-8");

    const { result, capsule } = await withIsolatedCollaborationStores(workspaceDir, async () => {
      const result = await runCollaborationLearningBackflow({
        result: {
          payloads: [],
          meta: {
            durationMs: 50,
            agentMeta: { sessionId: "session-2", provider: "anthropic", model: "claude-opus-4-1" },
          },
        },
        memoryFlushWritePath: "memory/2026-04-09.md",
        workspaceDir,
        memoryFlushFileSizeBefore: 0,
        flushedAt: 2_345,
        sessionKey: "session-key-2",
        sessionEntry: {
          sessionId: "session-2",
          updatedAt: 2_345,
          sessionFile: "sessions/session-2.jsonl",
          groupId: "group-2",
          collaborationGroupProfile: {
            groupId: "group-2",
            updatedAtMs: 1,
            confidentialityTier: "restricted",
          },
          collaborationParticipationOverlay: {
            participationId: "group-2::bot-ops",
            groupId: "group-2",
            botId: "bot-ops",
            overlayCapabilities: [],
            confidentialityTier: "restricted",
          },
        },
        memoryCompactionCompleted: false,
      });
      const { learningStorage } = createWorkspaceCollaborationStores();
      const capsules = await learningStorage.readCapsules("group-2");
      return {
        result,
        capsule: capsules.find((entry) => entry.capsuleId === result.capsuleId),
      };
    });

    expect(result).toEqual(
      expect.objectContaining({
        capsuleId: expect.any(String),
      }),
    );
    expect(result.skipped).toBeUndefined();
    expect(capsule).toEqual(
      expect.objectContaining({
        status: "candidate",
        sensitivity: "restricted",
        reusability: "group_only",
      }),
    );
  });
});
