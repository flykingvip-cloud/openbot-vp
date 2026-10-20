// @vitest-environment node
import { describe, expect, it } from "vitest";
import { groupKnowledgeBasesByIndexDb } from "./kb-index-groups.js";
import type { KnowledgeBase } from "./knowledge-base-store.js";

function fakeKb(
  over: Partial<KnowledgeBase> & Pick<KnowledgeBase, "id" | "ownerId">,
): KnowledgeBase {
  return {
    id: over.id,
    title: over.title ?? "KB",
    description: "",
    ownerId: over.ownerId,
    tenantId: over.tenantId ?? null,
    visibility: over.visibility ?? "private",
    backendKind: "personal",
    robotIds: [],
    tags: [],
    documentIds: [],
    recycledDocumentIds: [],
    documentCount: 0,
    createdAtMs: 1,
    updatedAtMs: 1,
  };
}

describe("groupKnowledgeBasesByIndexDb", () => {
  it("groups tenant knowledge bases into one sqlite index file", () => {
    const bases = [
      fakeKb({
        id: "kb_a",
        ownerId: "user-1",
        tenantId: "tenant-a",
        visibility: "team",
        title: "Team A",
      }),
      fakeKb({
        id: "kb_b",
        ownerId: "user-2",
        tenantId: "tenant-a",
        visibility: "team",
        title: "Team B",
      }),
    ];
    const groups = groupKnowledgeBasesByIndexDb(bases, "/tmp/kb-index-root");
    expect(groups.size).toBe(1);
    const group = [...groups.values()][0];
    expect(group.kbIds).toHaveLength(2);
    expect(group.dbPath).toContain("tenant/tenant-a.db");
  });

  it("keeps personal knowledge bases in separate owner index files", () => {
    const bases = [
      fakeKb({ id: "kb_1", ownerId: "user-1", title: "Mine" }),
      fakeKb({ id: "kb_2", ownerId: "user-2", title: "Theirs" }),
    ];
    const groups = groupKnowledgeBasesByIndexDb(bases, "/tmp/kb-index-root");
    expect(groups.size).toBe(2);
  });
});
