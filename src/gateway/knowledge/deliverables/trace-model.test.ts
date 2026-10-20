// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { getWorkspaceDeliverableTrace } from "./trace-model.js";

const mocks = vi.hoisted(() => {
  const deliverable = {
    deliverableId: "del-1",
    groupId: "group-a",
    title: "Q2 Sales Report",
    description: "Quarterly sales summary",
    content: "Revenue grew 12% QoQ.",
    status: "published" as const,
    version: 1,
    createdAtMs: 1_000,
    updatedAtMs: 5_000,
    createdBy: "user-1",
    submittedAtMs: 2_000,
    submittedBy: "user-1",
    approvedAtMs: 3_000,
    approvedBy: "user-1",
    publishedAtMs: 4_000,
    publishedBy: "user-1",
    taskId: "task-1",
  };
  const task = {
    taskId: "task-1",
    groupId: "group-a",
    title: "Prepare Q2 report",
    description: "Compile sales metrics",
    status: "completed" as const,
    createdAtMs: 900,
    updatedAtMs: 1_500,
    startedAtMs: 950,
  };
  return {
    deliverable,
    task,
    listManagedSpaceGroupIds: vi.fn(async () => ["group-a"]),
    listWorkspaceCollaborationGroupIds: vi.fn(async () => ["group-a"]),
    readProfile: vi.fn(async () => ({ displayName: "Alpha Team" })),
    readMembers: vi.fn(async () => [
      {
        memberId: "m-1",
        memberKind: "human" as const,
        userId: "user-1",
        name: "Alice Chen",
        governanceRole: "member" as const,
        status: "active" as const,
        updatedAtMs: Date.now(),
      },
    ]),
    readObject: vi.fn(async (groupId: string, kind: string, id: string) => {
      if (kind === "deliverable" && id === "del-1") {
        return mocks.deliverable;
      }
      if (kind === "task" && id === "task-1") {
        return mocks.task;
      }
      return null;
    }),
    getDeliverableArchiveKnowledgeBaseId: vi.fn(() => null),
    getPersonalSkillAssetDetail: vi.fn(() => {
      throw new Error("not skill");
    }),
    getKnowledgeBase: vi.fn(() => null),
    openKnowledgeIndex: vi.fn(),
    retrieveKnowledgeFromIndex: vi.fn(async () => []),
  };
});

vi.mock("../../collaboration-learning/shared.js", () => ({
  createWorkspaceCollaborationStores: () => ({
    stateDir: "/tmp",
    groupRootDir: "/tmp/groups",
    groupStorage: {
      readProfile: mocks.readProfile,
      readMembers: mocks.readMembers,
    },
    objectStorage: {
      readObject: mocks.readObject,
    },
  }),
  listManagedSpaceGroupIds: mocks.listManagedSpaceGroupIds,
  listWorkspaceCollaborationGroupIds: mocks.listWorkspaceCollaborationGroupIds,
}));

vi.mock("./archive-store.js", () => ({
  getDeliverableArchiveKnowledgeBaseId: mocks.getDeliverableArchiveKnowledgeBaseId,
}));

vi.mock("../../skill-lifecycle-store.js", () => ({
  getPersonalSkillAssetDetail: mocks.getPersonalSkillAssetDetail,
}));

vi.mock("../knowledge-base-store.js", () => ({
  getKnowledgeBase: mocks.getKnowledgeBase,
}));

vi.mock("../kb-index.js", () => ({
  openKnowledgeIndex: mocks.openKnowledgeIndex,
  resolveKnowledgeIndexDbPath: vi.fn(() => "/tmp/index.db"),
  getKnowledgeDocument: vi.fn(() => null),
}));

vi.mock("../kb-retrieve.js", () => ({
  retrieveKnowledgeFromIndex: mocks.retrieveKnowledgeFromIndex,
}));

vi.mock("../kb-ingest.js", () => ({
  resolveKnowledgeIngestEmbeddingProvider: vi.fn(async () => null),
}));

vi.mock("../../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

vi.mock("../../../agents/agent-scope.js", () => ({
  listAgentIds: vi.fn(() => []),
}));

describe("getWorkspaceDeliverableTrace", () => {
  it("returns collaboration deliverable trace with lifecycle steps", async () => {
    const result = await getWorkspaceDeliverableTrace({
      userId: "user-1",
      deliverableId: "del-1",
    });
    expect(result).not.toBeNull();
    expect(result?.trace.deliverable.title).toBe("Q2 Sales Report");
    expect(result?.trace.steps.some((step) => step.kind === "task")).toBe(true);
    expect(result?.trace.steps.some((step) => step.kind === "review")).toBe(true);
    expect(result?.trace.previewText).toContain("Revenue grew");
    expect(result?.trace.dataSource).toBe("live");
  });

  it("returns null when deliverable is not found", async () => {
    const result = await getWorkspaceDeliverableTrace({
      userId: "user-1",
      deliverableId: "missing",
    });
    expect(result).toBeNull();
  });
});
