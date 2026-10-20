// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { KnowledgeBaseSummary } from "../capability/knowledge-universe/workspace-endpoints.ts";
import type { WorkbenchKnowledgeSurface } from "../ports/employee/views/home-page-contracts.ts";
import {
  filterKnowledgeBasesByVisibility,
  listFavoriteFunnelEntries,
  partitionKnowledgeBasesForSidebar,
  supplyMetricForVisibility,
} from "./knowledge-universe-library-grouping.ts";

function kb(
  id: string,
  visibility: KnowledgeBaseSummary["visibility"],
  documentCount = 1,
): KnowledgeBaseSummary {
  return {
    id,
    title: id,
    description: "",
    documentCount,
    visibility,
    updatedAtMs: 1,
  };
}

function surface(overrides: Partial<WorkbenchKnowledgeSurface> = {}): WorkbenchKnowledgeSurface {
  return {
    knowledgeBases: [
      kb("kb-private", "private", 2),
      kb("kb-team", "team", 3),
      kb("kb-enterprise", "enterprise", 5),
    ],
    pinnedKnowledgeBaseIds: ["kb-team"],
    favoriteKnowledgeBaseIds: ["kb-private"],
    kbSearchQuery: "",
    selectedKnowledgeBaseId: null,
    ...overrides,
  } as WorkbenchKnowledgeSurface;
}

describe("knowledge-universe-library-grouping", () => {
  it("filters knowledge bases by visibility axis", () => {
    const bases = surface().knowledgeBases;
    expect(filterKnowledgeBasesByVisibility(bases, "private").map((item) => item.id)).toEqual([
      "kb-private",
    ]);
    expect(filterKnowledgeBasesByVisibility(bases, "team").map((item) => item.id)).toEqual([
      "kb-team",
    ]);
    expect(filterKnowledgeBasesByVisibility(bases, "enterprise").map((item) => item.id)).toEqual([
      "kb-enterprise",
    ]);
  });

  it("keeps reserved deliverable folders first in their visibility group", () => {
    const grouped = partitionKnowledgeBasesForSidebar(
      surface({
        knowledgeBases: [
          kb("kb-notes", "private"),
          {
            ...kb("kb-personal-out", "private"),
            title: "个人成果",
            reservedKind: "personal_deliverables",
          },
          kb("kb-project", "team"),
          {
            ...kb("kb-team-out", "team"),
            title: "团队成果",
            reservedKind: "team_deliverables",
          },
        ],
        pinnedKnowledgeBaseIds: [],
        favoriteKnowledgeBaseIds: [],
      }),
    );
    expect(grouped.privateSpaces.map((item) => item.id)).toEqual(["kb-personal-out", "kb-notes"]);
    expect(grouped.teamSpaces.map((item) => item.id)).toEqual(["kb-team-out", "kb-project"]);
  });

  it("partitions sidebar spaces into pinned, favorites, and visibility groups", () => {
    const grouped = partitionKnowledgeBasesForSidebar(surface());
    expect(grouped.pinned.map((item) => item.id)).toEqual(["kb-team"]);
    expect(grouped.favorites.map((item) => item.id)).toEqual(["kb-private"]);
    // Favorites stay in their visibility group so 收藏 is a file funnel, not a move.
    expect(grouped.privateSpaces.map((item) => item.id)).toEqual(["kb-private"]);
    expect(grouped.teamSpaces).toEqual([]);
    expect(grouped.enterpriseSpaces.map((item) => item.id)).toEqual(["kb-enterprise"]);
  });

  it("lists favorite-funnel documents across favorited spaces", () => {
    const entries = listFavoriteFunnelEntries(
      surface({
        treeDocumentsByKbId: {
          "kb-private": [
            { docId: "doc-1", title: "笔记", updatedAtMs: 1, contentType: null, indexed: true },
          ],
        },
      }),
    );
    expect(entries.map((item) => item.doc.docId)).toEqual(["doc-1"]);
    expect(entries[0]?.kb.id).toBe("kb-private");
  });

  it("aggregates supply metrics from the same knowledge base list", () => {
    const metric = supplyMetricForVisibility(surface().knowledgeBases, "team");
    expect(metric).toEqual({ count: 1, documentCount: 3 });
  });

  it("respects kb search query when partitioning", () => {
    const grouped = partitionKnowledgeBasesForSidebar(
      surface({
        kbSearchQuery: "enterprise",
        pinnedKnowledgeBaseIds: [],
        favoriteKnowledgeBaseIds: [],
      }),
    );
    expect(grouped.enterpriseSpaces.map((item) => item.id)).toEqual(["kb-enterprise"]);
    expect(grouped.privateSpaces).toEqual([]);
    expect(grouped.teamSpaces).toEqual([]);
  });
});
