// @vitest-environment jsdom
import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderKnowledgeUniverseSearchFeedback } from "./knowledge-universe-search-feedback.ts";

describe("renderKnowledgeUniverseSearchFeedback", () => {
  it("shows grouped hits when workspace search returns groups", () => {
    const container = document.createElement("div");
    render(
      renderKnowledgeUniverseSearchFeedback({
        query: "销售",
        loading: false,
        searchResults: [],
        workspaceSearchGroups: [
          {
            group: "knowledge",
            hits: [
              {
                id: "object:obj-1",
                group: "knowledge",
                title: "销售制度",
                subtitle: "销售流程与合规",
                objectId: "obj-1",
                nodeId: "node:obj-1",
              },
            ],
          },
          {
            group: "deliverables",
            hits: [
              {
                id: "deliverable:del-1",
                group: "deliverables",
                title: "销售 Q2 报告",
                deliverableId: "del-1",
              },
            ],
          },
        ],
        workspaceSearchTotalCount: 2,
        workspaceSearchMode: "mixed",
        selectedWorkspaceSearchHitId: "object:obj-1",
        graph: { nodes: [], edges: [] },
        onSelectHit: vi.fn(),
        onSelectNode: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toMatch(/命中|matched/i);
    expect(container.textContent).toContain("销售制度");
    expect(container.textContent).toContain("销售 Q2 报告");
    expect(container.querySelectorAll(".knowledge-universe__search-group").length).toBe(2);
  });

  it("marks the active workspace search hit", () => {
    const container = document.createElement("div");
    render(
      renderKnowledgeUniverseSearchFeedback({
        query: "销售",
        loading: false,
        searchResults: [],
        workspaceSearchGroups: [
          {
            group: "knowledge",
            hits: [
              {
                id: "object:obj-1",
                group: "knowledge",
                title: "销售制度",
                objectId: "obj-1",
              },
            ],
          },
        ],
        workspaceSearchTotalCount: 1,
        workspaceSearchMode: "substring",
        selectedWorkspaceSearchHitId: "object:obj-1",
        graph: { nodes: [], edges: [] },
        onSelectHit: vi.fn(),
        onSelectNode: vi.fn(),
      }),
      container,
    );

    expect(container.querySelector(".knowledge-universe__search-hit.is-selected")).toBeTruthy();
  });

  it("renders governance trust badges on grouped search hits", () => {
    const container = document.createElement("div");
    render(
      renderKnowledgeUniverseSearchFeedback({
        query: "销售",
        loading: false,
        searchResults: [],
        workspaceSearchGroups: [
          {
            group: "deliverables",
            hits: [
              {
                id: "deliverable:del-1",
                group: "deliverables",
                title: "销售 Q2 报告",
                deliverableId: "del-1",
                governanceStatus: "conflict",
                score: 0.9,
              },
            ],
          },
        ],
        workspaceSearchTotalCount: 1,
        workspaceSearchMode: "mixed",
        selectedWorkspaceSearchHitId: null,
        graph: { nodes: [], edges: [] },
        onSelectHit: vi.fn(),
        onSelectNode: vi.fn(),
      }),
      container,
    );

    expect(container.querySelector('[data-governance="conflict"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="ku-search-hit-score"]')).toBeTruthy();
  });

  it("shows empty feedback when there are no hits", () => {
    const container = document.createElement("div");
    render(
      renderKnowledgeUniverseSearchFeedback({
        query: "不存在",
        loading: false,
        searchResults: [],
        workspaceSearchGroups: [],
        workspaceSearchTotalCount: 0,
        workspaceSearchMode: null,
        selectedWorkspaceSearchHitId: null,
        graph: { nodes: [], edges: [] },
        onSelectHit: vi.fn(),
        onSelectNode: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toMatch(/未命中|No objects matched/i);
  });

  it("falls back to flat search results when grouped payload is absent", () => {
    const container = document.createElement("div");
    render(
      renderKnowledgeUniverseSearchFeedback({
        query: "销售",
        loading: false,
        searchResults: [
          {
            id: "obj:sales-policy",
            title: "销售制度",
            source: "enterprise",
            kind: "policy",
            summary: "mock",
            tags: [],
            updatedAt: 1,
          },
        ],
        workspaceSearchGroups: [],
        workspaceSearchTotalCount: 0,
        workspaceSearchMode: null,
        selectedWorkspaceSearchHitId: null,
        graph: {
          nodes: [
            {
              id: "node:sales-policy",
              kind: "knowledge-object",
              title: "销售制度",
              objectId: "obj:sales-policy",
            },
          ],
          edges: [],
        },
        onSelectHit: vi.fn(),
        onSelectNode: vi.fn(),
      }),
      container,
    );

    expect(container.textContent).toContain("销售制度");
    expect(container.querySelector(".knowledge-universe__search-feedback-list")).toBeTruthy();
  });
});
