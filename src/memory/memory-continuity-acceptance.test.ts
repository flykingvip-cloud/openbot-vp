/**
 * Synthetic closed-loop acceptance for memory safe-continuity landing.
 *
 * Backend under test: builtin (default). Does not flip privateMemoryPromote
 * or switch memory.backend to qmd.
 *
 * Permission sources (documented):
 * - DM/personal workspace: agent workspace dir isolation (separate manager /
 *   index / dataRoot per agent workspace).
 * - Group markdown: members.json via resolveMemoryContinuityAuthz
 *   (permissionSource members.json | governance.tenantId+members.json).
 * - Learning recall: active-only filter in buildLearningRecall; approve gate
 *   via personal-learning-write / capsule-governance.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildLearningRecall, readLearningRecall } from "../auto-reply/reply/learning-recall.js";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../config/config.js";
import type { OpenBotConfig } from "../config/config.js";
import { applyCapsuleGovernanceTransition } from "../gateway/collaboration-learning/capsule-governance.js";
import { promoteApprovedCapsuleIfEligible } from "../gateway/collaboration-learning/capsule-promotion.js";
import { buildMemoryFlushCandidateCapsule } from "../gateway/collaboration-learning/memory-flush-outcome-capsule.js";
import { createWorkspaceCollaborationStores } from "../gateway/collaboration-learning/shared.js";
import { resetEmbeddingMocks } from "./embedding.test-mocks.js";
import type { MemoryIndexManager as MemoryIndexManagerType } from "./index.js";
import { closeAllMemoryIndexManagers } from "./manager-runtime.js";
import { MemoryIndexManager } from "./manager.js";
import {
  assertMemoryContinuityPathAccess,
  resolveMemoryContinuityAuthz,
} from "./memory-continuity-authz.js";
import {
  approvePersonalLearningCandidate,
  readPersonalLearningRecall,
  revokePersonalLearningAsset,
  writePersonalLearningCandidate,
} from "./personal-learning-write.js";
import {
  getRequiredMemoryIndexManager,
  registerIsolatedTestV1Root,
} from "./test-manager-helpers.js";

const cleanup: string[] = [];
const envKeys = [
  "OPENBOT_STATE_DIR",
  "OPENBOT_CONFIG_PATH",
  "OPENCLAW_CONFIG_PATH",
  "OPENBOT_TENANTS_ROOT",
  "OPENCLAW_DISABLE_CONFIG_CACHE",
] as const;
const savedEnv: Record<string, string | undefined> = {};

function buildCfg(params: {
  workspaceDir: string;
  indexPath: string;
  collabRoot?: string;
}): OpenBotConfig {
  return {
    agents: {
      defaults: {
        workspace: params.workspaceDir,
        memorySearch: {
          provider: "openai",
          model: "mock-embed",
          store: { path: params.indexPath, vector: { enabled: false } },
          cache: { enabled: false },
          query: { minScore: 0, hybrid: { enabled: true, vectorWeight: 0, textWeight: 1 } },
          sync: { watch: false, onSessionStart: false, onSearch: false },
        },
      },
      list: [{ id: "main", default: true }],
    },
    ...(params.collabRoot ? { collaboration: { defaults: { workspace: params.collabRoot } } } : {}),
  } as OpenBotConfig;
}

async function writeMembers(
  groupDir: string,
  members: Array<{ userId: string; status: string }>,
): Promise<void> {
  await fs.mkdir(groupDir, { recursive: true });
  await fs.writeFile(
    path.join(groupDir, "members.json"),
    JSON.stringify(
      members.map((m, i) => ({
        memberId: `m-${i}`,
        memberKind: "human",
        userId: m.userId,
        governanceRole: "member",
        status: m.status,
        updatedAtMs: Date.now(),
      })),
    ),
    "utf8",
  );
}

async function withIsolatedEnv<T>(
  dirs: { stateDir: string; configPath: string; tenantsRoot?: string },
  run: () => Promise<T>,
): Promise<T> {
  for (const key of envKeys) {
    savedEnv[key] = process.env[key];
  }
  process.env.OPENBOT_STATE_DIR = dirs.stateDir;
  process.env.OPENBOT_CONFIG_PATH = dirs.configPath;
  process.env.OPENCLAW_CONFIG_PATH = dirs.configPath;
  process.env.OPENCLAW_DISABLE_CONFIG_CACHE = "1";
  if (dirs.tenantsRoot) {
    process.env.OPENBOT_TENANTS_ROOT = dirs.tenantsRoot;
  } else {
    delete process.env.OPENBOT_TENANTS_ROOT;
  }
  clearRuntimeConfigSnapshot();
  clearConfigCache();
  try {
    return await run();
  } finally {
    clearRuntimeConfigSnapshot();
    clearConfigCache();
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  }
}

describe("memory continuity acceptance (builtin)", () => {
  let managers: MemoryIndexManagerType[] = [];

  beforeEach(() => {
    resetEmbeddingMocks();
    managers = [];
  });

  afterEach(async () => {
    for (const manager of managers) {
      try {
        await manager.close();
      } catch {
        // ignore
      }
    }
    managers = [];
    await closeAllMemoryIndexManagers().catch(() => undefined);
    await Promise.all(cleanup.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it("DM loop: marker file → sync/index → search/get; second workspace denied", async () => {
    const marker = `DM_MARKER_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const aliceHome = await fs.mkdtemp(path.join(os.tmpdir(), "mem-dm-alice-"));
    const bobHome = await fs.mkdtemp(path.join(os.tmpdir(), "mem-dm-bob-"));
    cleanup.push(aliceHome, bobHome);

    const aliceWs = path.join(aliceHome, "workspace");
    const bobWs = path.join(bobHome, "workspace");
    await fs.mkdir(path.join(aliceWs, "memory"), { recursive: true });
    await fs.mkdir(path.join(bobWs, "memory"), { recursive: true });
    const relPath = "memory/continuity-dm.md";
    await fs.writeFile(path.join(aliceWs, relPath), `# note\n${marker}\n`, "utf8");

    const aliceCfg = buildCfg({
      workspaceDir: aliceWs,
      indexPath: path.join(aliceHome, "index.sqlite"),
    });
    const bobCfg = buildCfg({
      workspaceDir: bobWs,
      indexPath: path.join(bobHome, "index.sqlite"),
    });

    const alice = await getRequiredMemoryIndexManager({ cfg: aliceCfg, agentId: "main" });
    managers.push(alice);
    await alice.sync({ reason: "test", force: true });

    const hits = await alice.search(marker, { maxResults: 10, minScore: 0 });
    expect(hits.some((h) => h.path === relPath || h.snippet.includes(marker))).toBe(true);
    const got = await alice.readFile({ relPath });
    expect(got.path).toBe(relPath);
    expect(got.text).toContain(marker);

    const bob = await getRequiredMemoryIndexManager({ cfg: bobCfg, agentId: "main" });
    managers.push(bob);
    await bob.sync({ reason: "test", force: true });
    const bobHits = await bob.search(marker, { maxResults: 10, minScore: 0 });
    expect(bobHits.every((h) => !h.snippet.includes(marker))).toBe(true);
    const bobGot = await bob.readFile({ relPath });
    expect(bobGot.text).toBe("");
  });

  it("Group loop: member search/get OK; non-member deny; revoke deny; delete purge", async () => {
    const marker = `GROUP_MARKER_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "mem-group-state-"));
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "mem-group-ws-"));
    cleanup.push(stateDir, workspaceDir);

    const collabRoot = path.join(stateDir, "collab-workspace");
    const groupId = "continuity-group-1";
    const groupDir = path.join(collabRoot, "groups", encodeURIComponent(groupId));
    await writeMembers(groupDir, [{ userId: "member-alice", status: "active" }]);
    await fs.mkdir(path.join(groupDir, "memory"), { recursive: true });
    await fs.writeFile(
      path.join(groupDir, "memory", "group-note.md"),
      `# group\n${marker}\n`,
      "utf8",
    );
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });

    const configPath = path.join(stateDir, "openbot.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          defaults: { workspace: workspaceDir },
          list: [{ id: "main", default: true }],
        },
        collaboration: { defaults: { workspace: collabRoot } },
      }),
      "utf8",
    );

    await withIsolatedEnv({ stateDir, configPath }, async () => {
      const cfg = buildCfg({
        workspaceDir,
        indexPath: path.join(stateDir, "index.sqlite"),
        collabRoot,
      });

      const aliceAuthz = await resolveMemoryContinuityAuthz({
        cfg,
        authenticatedUserId: "member-alice",
        profile: "personal_local",
      });
      expect(aliceAuthz.permissionSource).toBe("members.json");
      expect(aliceAuthz.authorizedGroupIds.has(groupId)).toBe(true);

      const carolAuthz = await resolveMemoryContinuityAuthz({
        cfg,
        authenticatedUserId: "non-member-carol",
        profile: "personal_local",
      });
      expect(carolAuthz.authorizedGroupIds.has(groupId)).toBe(false);

      const collabRel = `collaboration/${groupId}/memory/group-note.md`;
      const aliceAccess = await assertMemoryContinuityPathAccess({
        relPath: collabRel,
        authz: aliceAuthz,
        cfg,
      });
      expect(aliceAccess.ok).toBe(true);

      const carolAccess = await assertMemoryContinuityPathAccess({
        relPath: collabRel,
        authz: carolAuthz,
        cfg,
      });
      expect(carolAccess.ok).toBe(false);
      if (!carolAccess.ok) {
        expect(carolAccess.reason).toBe("not authorized");
        expect(JSON.stringify(carolAccess)).not.toContain(marker);
      }

      const aliceManager = await MemoryIndexManager.get({
        cfg,
        agentId: "main",
        collaborationMemoryRoots: aliceAuthz.roots,
      });
      expect(aliceManager).not.toBeNull();
      registerIsolatedTestV1Root(aliceManager!);
      managers.push(aliceManager!);
      await aliceManager!.sync({ reason: "test", force: true });
      const aliceHits = await aliceManager!.search(marker, { maxResults: 10, minScore: 0 });
      expect(
        aliceHits.some(
          (h) => h.path.includes(`collaboration/${groupId}/`) && h.snippet.includes(marker),
        ),
      ).toBe(true);
      const aliceGot = await aliceManager!.readFile({ relPath: collabRel });
      expect(aliceGot.text).toContain(marker);

      const carolManager = await MemoryIndexManager.get({
        cfg,
        agentId: "main",
        collaborationMemoryRoots: carolAuthz.roots,
      });
      expect(carolManager).not.toBeNull();
      registerIsolatedTestV1Root(carolManager!);
      managers.push(carolManager!);
      await carolManager!.sync({ reason: "test", force: true });
      const carolHits = await carolManager!.search(marker, { maxResults: 10, minScore: 0 });
      expect(carolHits.every((h) => !h.snippet.includes(marker))).toBe(true);
      await expect(carolManager!.readFile({ relPath: collabRel })).rejects.toThrow(
        /not authorized/,
      );

      await writeMembers(groupDir, [{ userId: "member-alice", status: "revoked" }]);
      const revokedAuthz = await resolveMemoryContinuityAuthz({
        cfg,
        authenticatedUserId: "member-alice",
        profile: "personal_local",
      });
      expect(revokedAuthz.authorizedGroupIds.has(groupId)).toBe(false);
      const revokedAccess = await assertMemoryContinuityPathAccess({
        relPath: collabRel,
        authz: revokedAuthz,
        cfg,
      });
      expect(revokedAccess.ok).toBe(false);
      if (!revokedAccess.ok) {
        expect(revokedAccess.reasonCode).toBe("revoked_or_inactive");
        expect(JSON.stringify(revokedAccess)).not.toContain(marker);
      }

      // Restore membership, delete file, force sync → old snippets must purge.
      await writeMembers(groupDir, [{ userId: "member-alice", status: "active" }]);
      await fs.rm(path.join(groupDir, "memory", "group-note.md"), { force: true });
      await aliceManager!.sync({ reason: "test", force: true });
      const afterDelete = await aliceManager!.search(marker, { maxResults: 10, minScore: 0 });
      expect(afterDelete.every((h) => !h.snippet.includes(marker))).toBe(true);
    });
  });

  it("Learning loop: candidate not in recall; approve injectable; revoke stops inject", async () => {
    const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "mem-learn-state-"));
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "mem-learn-ws-"));
    cleanup.push(stateDir, workspaceDir);
    const configPath = path.join(stateDir, "openbot.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        agents: {
          list: [{ id: "bot-main" }],
          defaults: { workspace: workspaceDir },
        },
        collaboration: { defaults: { workspace: path.join(workspaceDir, "collab-root") } },
      }),
      "utf8",
    );

    await withIsolatedEnv({ stateDir, configPath }, async () => {
      const lessonMarker = `LESSON_${Date.now()}`;

      // Personal gated write path (does not open privateMemoryPromote).
      const written = await writePersonalLearningCandidate({
        botId: "bot-main",
        actorId: "operator-1",
        reason: lessonMarker,
        detail: "personal gated write",
      });
      expect(written.ok).toBe(true);
      if (!written.ok) {
        throw new Error(written.reason);
      }

      const before = await readPersonalLearningRecall({ botId: "bot-main" });
      expect(before.lessons.every((l) => !l.lesson.includes(lessonMarker))).toBe(true);
      expect(before.lessons.every((l) => l.assetId !== written.capsuleId)).toBe(true);

      const approved = await approvePersonalLearningCandidate({
        botId: "bot-main",
        capsuleId: written.capsuleId,
        actorId: "operator-1",
      });
      expect(approved.approved).toBe(true);
      // Hard personal path: approve → promote → active asset → recall inject.
      // privateMemoryPromote stays default OFF; this uses agent:<botId> scope only.
      expect(approved.promoted).toBe(true);
      expect(approved.assetId).toBeTruthy();
      expect(approved.reason).toBe("promoted");

      const after = await readPersonalLearningRecall({ botId: "bot-main" });
      expect(after.lessons.some((l) => l.assetId === approved.assetId)).toBe(true);
      expect(after.lessons.some((l) => l.lesson.includes(lessonMarker))).toBe(true);

      const revoked = await revokePersonalLearningAsset({
        botId: "bot-main",
        assetId: approved.assetId!,
        actorId: "operator-1",
      });
      expect(revoked.ok).toBe(true);
      const stopped = await readPersonalLearningRecall({ botId: "bot-main" });
      expect(stopped.lessons.every((l) => l.assetId !== approved.assetId)).toBe(true);

      // Group path (same gates): candidate → approve → asset → revoke.
      const groupId = "learn-group-1";
      const capsule = buildMemoryFlushCandidateCapsule({
        groupId,
        botId: "bot-main",
        participationId: `${groupId}::bot-main`,
        confidentialityTier: "internal",
        memoryFlushWritePath: "memory/2026-10-30.md",
        appendedMarkdown: `## Retro\n- ${lessonMarker}`,
        flushedAt: Date.now(),
        memoryCompactionCompleted: false,
        workspaceDir,
        sessionKey: "sk-learn",
      });
      expect(capsule?.status).toBe("candidate");
      const { learningStorage } = createWorkspaceCollaborationStores();
      await learningStorage.appendCapsule(groupId, capsule!);

      const preAssets = await learningStorage.readLearningAssets(groupId, "bot-main");
      expect(buildLearningRecall(preAssets).lessons).toHaveLength(0);

      const approvedCap = applyCapsuleGovernanceTransition(capsule!, "approved", {
        actor: "operator-1",
        reusability: "promotable",
      });
      const promotion = await promoteApprovedCapsuleIfEligible({
        groupId,
        capsule: approvedCap,
        targetBotId: "bot-main",
        actor: "operator-1",
        approvalMode: "approved",
        learningStorage,
      });
      expect(promotion.promoted).toBe(true);
      expect(promotion.assetId).toBeTruthy();

      const recall = await readLearningRecall({
        scopeId: groupId,
        botId: "bot-main",
      });
      expect(recall.lessons.some((l) => l.assetId === promotion.assetId)).toBe(true);

      const assets = await learningStorage.readLearningAssets(groupId, "bot-main");
      const next = assets.map((asset) =>
        asset.assetId === promotion.assetId
          ? { ...asset, status: "revoked" as const, updatedAt: Date.now() }
          : asset,
      );
      await learningStorage.writeLearningAssets(groupId, next);
      const afterRevoke = await readLearningRecall({
        scopeId: groupId,
        botId: "bot-main",
      });
      expect(afterRevoke.lessons.every((l) => l.assetId !== promotion.assetId)).toBe(true);
    });
  });
});
