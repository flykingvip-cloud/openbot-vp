import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentLearningAsset } from "@openbot/collaboration-core";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const assetsByScope = new Map<string, AgentLearningAsset[]>();
const writes: Array<{ scopeId: string; assets: AgentLearningAsset[] }> = [];

// Asset state is mocked, but the lock path is a real temp dir so the cross-process
// file lock is genuinely exercised (it creates/removes a real `.lock` file).
const lockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-learning-lock-"));

vi.mock("../../gateway/collaboration-learning/shared.js", () => ({
  createWorkspaceCollaborationStores: () => ({
    groupRootDir: lockRoot,
    learningStorage: {
      readLearningAssets: async (groupId: string, botId?: string) => {
        const all = assetsByScope.get(groupId) ?? [];
        return botId ? all.filter((asset) => asset.botId === botId) : all;
      },
      writeLearningAssets: async (groupId: string, assets: AgentLearningAsset[]) => {
        assetsByScope.set(groupId, assets);
        writes.push({ scopeId: groupId, assets });
      },
    },
  }),
  resolveGroupStoreFilePath: (params: {
    groupRootDir: string;
    groupId: string;
    filename: string;
  }) => path.join(params.groupRootDir, encodeURIComponent(params.groupId), params.filename),
}));

afterAll(() => {
  fs.rmSync(lockRoot, { recursive: true, force: true });
});

const {
  buildLearningRecall,
  extractLessonFromAsset,
  rankLearningAssets,
  readLearningRecall,
  recordLearningReuse,
  resolvePersonalLearningScopeId,
} = await import("./learning-recall.js");

function makeAsset(overrides: Partial<AgentLearningAsset> = {}): AgentLearningAsset {
  return {
    assetId: "asset-1",
    botId: "bot-1",
    sourceGroupId: "grp-1",
    sourceCapsuleId: "cap-1",
    assetType: "lesson",
    status: "active",
    abstractedContent: { lesson: "部署前先跑迁移脚本" },
    ...overrides,
  };
}

beforeEach(() => {
  assetsByScope.clear();
  writes.length = 0;
});

describe("resolvePersonalLearningScopeId", () => {
  it("gives single-chat sessions a stable learning scope", () => {
    expect(resolvePersonalLearningScopeId("daibai")).toBe("agent:daibai");
  });
});

describe("extractLessonFromAsset", () => {
  it("prefers the lesson field", () => {
    expect(extractLessonFromAsset(makeAsset())).toBe("部署前先跑迁移脚本");
  });

  it("falls back to title/summary for legacy assets without lesson", () => {
    const asset = makeAsset({
      abstractedContent: { title: "迁移失败", summary: "缺少 migrate 步骤" },
    });
    expect(extractLessonFromAsset(asset)).toBe("迁移失败 — 缺少 migrate 步骤");
  });

  it("returns null when there is nothing recallable", () => {
    expect(extractLessonFromAsset(makeAsset({ abstractedContent: {} }))).toBeNull();
  });
});

describe("buildLearningRecall", () => {
  it("surfaces lesson text, not just capability names", () => {
    const recall = buildLearningRecall([
      makeAsset({
        assetId: "a1",
        abstractedContent: { lesson: "先跑迁移", capabilities: ["deploy"] },
      }),
    ]);
    expect(recall.lessons).toHaveLength(1);
    expect(recall.lessons[0]?.lesson).toBe("先跑迁移");
    expect(recall.capabilities).toEqual(["deploy"]);
  });

  it("skips non-active assets", () => {
    const recall = buildLearningRecall([
      makeAsset({ assetId: "a1", status: "revoked" }),
      makeAsset({ assetId: "a2", status: "expired" }),
    ]);
    expect(recall.lessons).toHaveLength(0);
  });

  it("marks anti-patterns", () => {
    const recall = buildLearningRecall([
      makeAsset({
        assetId: "a1",
        assetType: "pattern",
        abstractedContent: { lesson: "直接改生产库", capsuleType: "anti_pattern" },
      }),
    ]);
    expect(recall.lessons[0]?.isAntiPattern).toBe(true);
  });

  it("dedupes identical lessons and respects the limit", () => {
    const recall = buildLearningRecall(
      [
        makeAsset({ assetId: "a1", abstractedContent: { lesson: "同一条" } }),
        makeAsset({ assetId: "a2", abstractedContent: { lesson: "同一条" } }),
        makeAsset({ assetId: "a3", abstractedContent: { lesson: "另一条" } }),
      ],
      1,
    );
    expect(recall.lessons).toHaveLength(1);
  });
});

describe("rankLearningAssets", () => {
  it("orders by confidence, then reuse, then recency", () => {
    const ranked = rankLearningAssets([
      makeAsset({ assetId: "low", confidence: "low", reuseCount: 9 }),
      makeAsset({ assetId: "high", confidence: "high", reuseCount: 0 }),
      makeAsset({ assetId: "mid-reused", confidence: "medium", reuseCount: 5 }),
      makeAsset({ assetId: "mid", confidence: "medium", reuseCount: 1 }),
    ]);
    expect(ranked.map((asset) => asset.assetId)).toEqual(["high", "mid-reused", "mid", "low"]);
  });
});

describe("readLearningRecall", () => {
  it("reads assets scoped to the bot", async () => {
    assetsByScope.set("grp-1", [
      makeAsset({ assetId: "mine", botId: "bot-1" }),
      makeAsset({ assetId: "other", botId: "bot-2", abstractedContent: { lesson: "别人的" } }),
    ]);
    const recall = await readLearningRecall({ scopeId: "grp-1", botId: "bot-1" });
    expect(recall.lessons.map((entry) => entry.assetId)).toEqual(["mine"]);
  });

  it("returns empty for blank scope or bot", async () => {
    expect(await readLearningRecall({ scopeId: "", botId: "bot-1" })).toEqual({
      capabilities: [],
      lessons: [],
    });
  });
});

describe("recordLearningReuse", () => {
  it("increments reuse count only for injected assets", async () => {
    assetsByScope.set("grp-1", [
      makeAsset({ assetId: "used", reuseCount: 2 }),
      makeAsset({ assetId: "unused", reuseCount: 7 }),
    ]);

    await recordLearningReuse({ scopeId: "grp-1", assetIds: ["used"], atMs: 1234 });

    const stored = assetsByScope.get("grp-1") ?? [];
    expect(stored.find((asset) => asset.assetId === "used")?.reuseCount).toBe(3);
    expect(stored.find((asset) => asset.assetId === "used")?.lastReusedAt).toBe(1234);
    expect(stored.find((asset) => asset.assetId === "unused")?.reuseCount).toBe(7);
  });

  it("does not write when nothing matches", async () => {
    assetsByScope.set("grp-1", [makeAsset({ assetId: "a1" })]);
    await recordLearningReuse({ scopeId: "grp-1", assetIds: ["missing"] });
    expect(writes).toHaveLength(0);
  });

  it("does not write for an empty id list", async () => {
    await recordLearningReuse({ scopeId: "grp-1", assetIds: [] });
    expect(writes).toHaveLength(0);
  });

  it("does not lose increments when concurrent turns record reuse", async () => {
    // Read-modify-write over the whole asset file: without serialization two
    // concurrent turns both read reuseCount=0 and the second write clobbers the first.
    assetsByScope.set("grp-1", [makeAsset({ assetId: "hot", reuseCount: 0 })]);

    await Promise.all([
      recordLearningReuse({ scopeId: "grp-1", assetIds: ["hot"] }),
      recordLearningReuse({ scopeId: "grp-1", assetIds: ["hot"] }),
      recordLearningReuse({ scopeId: "grp-1", assetIds: ["hot"] }),
    ]);

    expect(assetsByScope.get("grp-1")?.[0]?.reuseCount).toBe(3);
  });
});
