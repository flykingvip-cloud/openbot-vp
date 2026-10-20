// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const listWorkspaceDeliverablesMock = vi.hoisted(() => vi.fn());

vi.mock("./deliverables/read-model.js", () => ({
  listWorkspaceDeliverables: listWorkspaceDeliverablesMock,
}));

vi.mock("./context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(async () => ({
    userId: "user-1",
    seatId: null,
    tenantId: null,
    hasEnterpriseScope: false,
    teamLabel: null,
    roleCode: null,
    departmentId: null,
  })),
}));

const { searchWorkspace } = await import("./workspace-search.js");

describe("searchWorkspace integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listWorkspaceDeliverablesMock.mockResolvedValue({
      deliverables: [
        {
          deliverableId: "del-sales-q2",
          title: "销售季度分析报告",
          kind: "report" as const,
          source: "group" as const,
          creators: ["Alice"],
          groupTitle: "销售组",
          status: "published",
          updatedAtMs: 1,
        },
      ],
    });
  });

  it("aggregates live knowledge bundle, graph nodes, and deliverables without mocking searchWorkspace", async () => {
    const result = await searchWorkspace(null, { query: "销售", limitPerGroup: 5 });

    expect(result.query).toBe("销售");
    expect(result.totalCount).toBeGreaterThan(0);
    expect(result.groups.map((group) => group.group)).toEqual([
      "knowledge",
      "enterprise",
      "deliverables",
      "capabilities",
      "agents",
      "owners",
    ]);

    const deliverables = result.groups.find((group) => group.group === "deliverables");
    expect(deliverables?.hits.some((hit) => hit.deliverableId === "del-sales-q2")).toBe(true);

    const groupedHitCount = result.groups.reduce((sum, group) => sum + group.hits.length, 0);
    expect(groupedHitCount).toBe(result.totalCount);

    expect(listWorkspaceDeliverablesMock).toHaveBeenCalledWith({
      userId: "user-1",
      limit: 100,
    });
  });

  it("returns empty grouped payload for blank query", async () => {
    const result = await searchWorkspace(null, { query: "   ", limitPerGroup: 5 });
    expect(result.totalCount).toBe(0);
    expect(result.groups.every((group) => group.hits.length === 0)).toBe(true);
    expect(listWorkspaceDeliverablesMock).not.toHaveBeenCalled();
  });
});
