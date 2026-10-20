// @vitest-environment node
import type { Deliverable } from "@openbot/collaboration-core";
import { describe, expect, it, vi } from "vitest";
import { listWorkspaceDeliverables } from "./read-model.js";

const mocks = vi.hoisted(() => {
  const listManagedSpaceGroupIds = vi.fn(async () => ["group-a"]);
  const listWorkspaceCollaborationGroupIds = vi.fn(async () => ["group-a", "group-b"]);
  const readProfile = vi.fn(async (groupId: string) => ({
    displayName: groupId === "group-a" ? "Alpha Team" : "Beta Team",
  }));
  const readMembers = vi.fn(async (groupId: string) => [
    {
      memberId: "m-1",
      memberKind: "human" as const,
      userId: "user-1",
      name: "Alice Chen",
      governanceRole: "member" as const,
      status: "active" as const,
      updatedAtMs: Date.now(),
    },
    ...(groupId === "group-b"
      ? [
          {
            memberId: "m-2",
            memberKind: "human" as const,
            userId: "user-2",
            governanceRole: "member" as const,
            status: "active" as const,
            updatedAtMs: Date.now(),
          },
        ]
      : []),
  ]);
  const listObjects = vi.fn(async (groupId: string, kind: string): Promise<Deliverable[]> => {
    if (kind !== "deliverable") {
      return [];
    }
    if (groupId === "group-a") {
      return [
        {
          deliverableId: "del-1",
          groupId,
          title: "Q2 Sales Report",
          status: "published",
          version: 1,
          createdAtMs: 1,
          updatedAtMs: 100,
          submittedBy: "user-1",
        },
      ];
    }
    return [];
  });
  const listPersonalSkillAssets = vi.fn(() => [
    {
      id: "skill-1",
      profile: {
        name: "Agent Analysis",
        summary: "analysis",
        assetType: "knowledge",
        tags: [],
        category: "对话成果",
      },
      lifecycle: "active",
      health: {
        status: "healthy",
        successRate: 1,
        avgLatency: 0,
        lastVerifiedAt: null,
        failureReasons: [],
      },
      sourceRobot: { id: "agent-main", name: "Main Agent" },
      sourceLineageId: "agent:agent-main:main",
      usageCount: 1,
      lastUsedAt: 200,
      version: "1",
      versionCount: 1,
    },
    {
      id: "skill-upload-1",
      profile: {
        name: "中医可以培育洞察力",
        summary: "uploaded doc",
        assetType: "knowledge",
        tags: [],
        category: "上传文档",
      },
      lifecycle: "draft",
      health: {
        status: "healthy",
        successRate: 1,
        avgLatency: 0,
        lastVerifiedAt: null,
        failureReasons: [],
      },
      sourceRobot: { id: "agent-main", name: "Main Agent" },
      sourceLineageId: "agent:agent-main:main",
      usageCount: 0,
      lastUsedAt: 300,
      version: "1",
      versionCount: 1,
    },
  ]);
  return {
    listManagedSpaceGroupIds,
    listWorkspaceCollaborationGroupIds,
    readProfile,
    readMembers,
    listObjects,
    listPersonalSkillAssets,
  };
});

vi.mock("../../collaboration-learning/shared.js", () => ({
  createWorkspaceCollaborationStores: () => ({
    stateDir: "/tmp/state",
    groupRootDir: "/tmp/groups",
    groupStorage: {
      readProfile: mocks.readProfile,
      readMembers: mocks.readMembers,
    },
    objectStorage: { listObjects: mocks.listObjects },
  }),
  listManagedSpaceGroupIds: mocks.listManagedSpaceGroupIds,
  listWorkspaceCollaborationGroupIds: mocks.listWorkspaceCollaborationGroupIds,
}));

vi.mock("../../skill-lifecycle-store.js", () => ({
  listPersonalSkillAssets: mocks.listPersonalSkillAssets,
}));

describe("workspace deliverables read model", () => {
  it("aggregates collaboration deliverables for member groups and agent skill assets", async () => {
    const result = await listWorkspaceDeliverables({ userId: "user-1", limit: 10 });
    expect(result.deliverables.map((item) => item.deliverableId)).toEqual([
      "skill:skill-1",
      "del-1",
    ]);
    expect(result.deliverables.some((item) => item.deliverableId === "skill:skill-upload-1")).toBe(
      false,
    );
    expect(result.deliverables[1]?.groupTitle).toBe("Alpha Team");
    expect(result.deliverables[0]?.source).toBe("agent");
    expect(result.deliverables[0]?.sourceType).toBe("agent");
    expect(result.deliverables[0]?.primaryCreatorName).toBe("Main Agent");
    expect(result.deliverables[1]?.sourceType).toBe("collaboration");
    expect(result.deliverables[1]?.primaryCreatorName).toBe("Alice Chen");
  });

  it("filters by source when requested", async () => {
    const result = await listWorkspaceDeliverables({
      userId: "user-1",
      source: "group",
      limit: 10,
    });
    expect(result.deliverables).toHaveLength(1);
    expect(result.deliverables[0]?.deliverableId).toBe("del-1");
  });

  it("returns no group deliverables for non-member user", async () => {
    const result = await listWorkspaceDeliverables({ userId: "user-9", limit: 10 });
    expect(result.deliverables.filter((item) => item.source === "group")).toEqual([]);
  });

  it("restricts group scan to provided group ids", async () => {
    const result = await listWorkspaceDeliverables({
      userId: "user-1",
      limit: 10,
      groupIds: ["group-b"],
    });
    expect(result.deliverables.filter((item) => item.source === "group")).toEqual([]);
    expect(result.deliverables.some((item) => item.deliverableId === "skill:skill-1")).toBe(true);
  });

  it("includes agent skill assets only for visible agent ids when scoping is enabled", async () => {
    const visible = await listWorkspaceDeliverables({
      userId: "user-1",
      limit: 10,
      visibleAgentIds: ["agent-main"],
    });
    expect(visible.deliverables.some((item) => item.deliverableId === "skill:skill-1")).toBe(true);

    const scopedOut = await listWorkspaceDeliverables({
      userId: "user-1",
      limit: 10,
      visibleAgentIds: ["someone-elses-agent"],
    });
    expect(scopedOut.deliverables.some((item) => item.deliverableId === "skill:skill-1")).toBe(
      false,
    );
  });

  it("hides all agent skill assets for an actor that owns no agents (empty scope)", async () => {
    const result = await listWorkspaceDeliverables({
      userId: "user-1",
      limit: 10,
      visibleAgentIds: [],
    });
    expect(result.deliverables.some((item) => item.source === "agent")).toBe(false);
  });

  it("matches visible agent ids case-insensitively and ignoring surrounding whitespace", async () => {
    const result = await listWorkspaceDeliverables({
      userId: "user-1",
      limit: 10,
      visibleAgentIds: ["  Agent-Main  "],
    });
    expect(result.deliverables.some((item) => item.deliverableId === "skill:skill-1")).toBe(true);
  });

  it("surfaces the caller's own builtin-steward deliverable even though the steward id is excluded from visibleAgentIds", async () => {
    mocks.listPersonalSkillAssets.mockReturnValueOnce([
      {
        id: "steward-own",
        profile: {
          name: "Alice_爱丽_瑜伽老师简历.docx",
          summary: "optimized resume",
          assetType: "knowledge",
          tags: [],
          category: "对话成果",
        },
        lifecycle: "draft",
        health: {
          status: "healthy",
          successRate: 1,
          avgLatency: 0,
          lastVerifiedAt: null,
          failureReasons: [],
        },
        sourceRobot: { id: "main", name: "大白管家" },
        sourceLineageId: "agent:main:employee:user-1",
        usageCount: 0,
        lastUsedAt: 400,
        version: "1",
        versionCount: 1,
      },
    ]);
    const result = await listWorkspaceDeliverables({
      userId: "user-1",
      limit: 10,
      // The handler drops the steward id from the owned-agent set; owner-scoping
      // must still re-include the caller's own steward output.
      visibleAgentIds: ["bot-x"],
    });
    const item = result.deliverables.find((entry) => entry.deliverableId === "skill:steward-own");
    expect(item).toBeDefined();
    expect(item?.title).toBe("Alice_爱丽_瑜伽老师简历.docx");
  });

  it("hides builtin-steward deliverables captured in another user's or the global steward session", async () => {
    mocks.listPersonalSkillAssets.mockReturnValueOnce([
      {
        id: "steward-foreign",
        profile: {
          name: "别人的简历.docx",
          summary: "someone else",
          assetType: "knowledge",
          tags: [],
          category: "对话成果",
        },
        lifecycle: "draft",
        health: {
          status: "healthy",
          successRate: 1,
          avgLatency: 0,
          lastVerifiedAt: null,
          failureReasons: [],
        },
        sourceRobot: { id: "main", name: "大白管家" },
        sourceLineageId: "agent:main:employee:user-2",
        usageCount: 0,
        lastUsedAt: 400,
        version: "1",
        versionCount: 1,
      },
      {
        id: "steward-global",
        profile: {
          name: "全局成果.docx",
          summary: "global",
          assetType: "knowledge",
          tags: [],
          category: "对话成果",
        },
        lifecycle: "draft",
        health: {
          status: "healthy",
          successRate: 1,
          avgLatency: 0,
          lastVerifiedAt: null,
          failureReasons: [],
        },
        sourceRobot: { id: "main", name: "大白管家" },
        sourceLineageId: "agent:main:main",
        usageCount: 0,
        lastUsedAt: 400,
        version: "1",
        versionCount: 1,
      },
    ]);
    const result = await listWorkspaceDeliverables({
      userId: "user-1",
      limit: 10,
      visibleAgentIds: ["bot-x"],
    });
    expect(
      result.deliverables.some((entry) => entry.deliverableId.startsWith("skill:steward")),
    ).toBe(false);
  });

  it("surfaces only the FINAL version of a collaboration deliverable (drops superseded + chain)", async () => {
    mocks.listObjects.mockImplementation(
      async (groupId: string, kind: string): Promise<Deliverable[]> => {
        if (kind !== "deliverable" || groupId !== "group-a") {
          return [];
        }
        return [
          {
            deliverableId: "art-v1",
            groupId,
            title: "公众号文章",
            status: "superseded",
            version: 1,
            createdAtMs: 1,
            updatedAtMs: 100,
          },
          {
            deliverableId: "art-v2",
            groupId,
            title: "公众号文章",
            status: "in_review",
            version: 2,
            previousVersionId: "art-v1",
            createdAtMs: 2,
            updatedAtMs: 150,
          },
          {
            deliverableId: "art-v3",
            groupId,
            title: "公众号文章",
            status: "published",
            version: 3,
            previousVersionId: "art-v2",
            createdAtMs: 3,
            updatedAtMs: 200,
            submittedBy: "user-1",
          },
        ];
      },
    );
    const result = await listWorkspaceDeliverables({ userId: "user-1", limit: 10 });
    const groupRows = result.deliverables.filter(
      (item) => item.source === "group" || item.source === "task",
    );
    // v1 superseded (status), v2 superseded (chain-referenced by v3) => only v3 (final) remains.
    expect(groupRows.map((item) => item.deliverableId)).toEqual(["art-v3"]);
    mocks.listObjects.mockReset();
  });
});
