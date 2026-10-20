// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildKnowledgeUniverseSearchSuggestions } from "./knowledge-universe-search-suggestions.ts";

describe("buildKnowledgeUniverseSearchSuggestions", () => {
  const recentVisits = [
    { objectId: "obj:1", title: "最近文档 A", source: "personal" as const, visitedAt: 1 },
    { objectId: "obj:2", title: "最近文档 B", source: "enterprise" as const, visitedAt: 2 },
  ];
  const recommendations = [
    {
      object: {
        id: "obj:3",
        title: "推荐文档 C",
        source: "personal" as const,
        kind: "document" as const,
        summary: "",
        tags: [],
        updatedAt: 1,
      },
      score: 1,
      reason: "mock",
    },
  ];

  it("uses recent visits and recommendations for workspace scope", () => {
    const suggestions = buildKnowledgeUniverseSearchSuggestions({
      scope: "workspace",
      selectedKnowledgeBaseId: "kb-1",
      recentVisits,
      recommendations,
      kbSearchEvidence: [],
      kbSearchSubstringResults: [],
      workspaceSearchGroups: [],
    });
    expect(suggestions).toEqual(["最近文档 A", "最近文档 B", "推荐文档 C"]);
  });

  it("prioritizes in-library evidence and kb-linked workspace hits for library scope", () => {
    const suggestions = buildKnowledgeUniverseSearchSuggestions({
      scope: "library",
      selectedKnowledgeBaseId: "kb-1",
      recentVisits,
      recommendations,
      kbSearchEvidence: [
        {
          sourceKind: "knowledge",
          docId: "doc-1",
          docTitle: "库内制度",
          kbId: "kb-1",
          versionId: "v1",
          score: 0.9,
          chunkText: "正文",
          sourceUri: "file://a",
        },
        {
          sourceKind: "knowledge",
          docId: "doc-2",
          docTitle: "其他库文档",
          kbId: "kb-2",
          versionId: "v1",
          score: 0.8,
          chunkText: "正文",
          sourceUri: "file://b",
        },
      ],
      kbSearchSubstringResults: [
        {
          id: "obj:sub",
          title: "关键词命中",
          source: "personal",
          kind: "document",
          summary: "",
          tags: [],
          updatedAt: 1,
        },
      ],
      workspaceSearchGroups: [
        {
          group: "knowledge",
          hits: [
            {
              id: "doc:kb-1:playbook",
              group: "knowledge",
              title: "销售手册",
              kbId: "kb-1",
              docId: "doc-3",
            },
          ],
        },
      ],
    });

    expect(suggestions[0]).toBe("库内制度");
    expect(suggestions).toContain("关键词命中");
    expect(suggestions).toContain("销售手册");
    expect(suggestions).not.toContain("其他库文档");
    expect(suggestions).not.toContain("推荐文档 C");
  });
});
