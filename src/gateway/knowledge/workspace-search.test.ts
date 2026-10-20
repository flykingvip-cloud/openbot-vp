import { describe, expect, it } from "vitest";
import { buildDefaultKnowledgeObjects } from "./mock-graph.js";
import type { RelationshipGraph } from "./types.js";
import { buildWorkspaceSearchGroups } from "./workspace-search.js";

const graph: RelationshipGraph = {
  nodes: [
    {
      id: "node:agent-budget",
      kind: "agent",
      title: "Budget Bot",
      summary: "Helps with budget analysis",
    },
    {
      id: "node:sales-bot",
      kind: "agent",
      title: "销售机器人",
      summary: "销售分析与报价助手",
    },
    {
      id: "node:owner-sales",
      kind: "owner",
      title: "销售负责人",
      summary: "Owns sales knowledge",
    },
    {
      id: "node:sales-policy",
      kind: "knowledge-object",
      title: "Sales Pricing Policy",
      objectId: "obj:sales-policy",
    },
  ],
  edges: [],
};

describe("buildWorkspaceSearchGroups", () => {
  it("returns grouped hits across knowledge, enterprise, deliverables, capabilities, and graph nodes", () => {
    const objects = buildDefaultKnowledgeObjects();
    const groups = buildWorkspaceSearchGroups({
      query: "销售",
      limitPerGroup: 5,
      graph,
      knowledgeObjects: objects,
      evidence: [
        {
          sourceKind: "knowledge",
          docId: "doc-1",
          docTitle: "Sales Playbook",
          kbId: "kb-1",
          versionId: "v1",
          score: 0.91,
          chunkText: "Sales pricing guidance for enterprise deals.",
          sourceUri: "ku://kb/kb-1/doc/doc-1@v1",
        },
      ],
      deliverables: [
        {
          deliverableId: "del-1",
          title: "销售 Q2 报告",
          kind: "report",
          source: "group",
          sourceType: "collaboration",
          artifactKind: "report",
          governanceStatus: "pending",
          creators: ["Alice"],
          groupTitle: "Sales Team",
          status: "published",
          updatedAtMs: 1,
        },
      ],
      dataCapabilities: [
        {
          id: "cap-sales",
          title: "销售 CRM",
          summary: "面向销售团队的客户与 pipeline 数据",
          sourceSystems: ["crm"],
          scenarios: ["pipeline review"],
          visibleAgents: ["agent-sales"],
          accessState: "granted",
        },
      ],
    });

    const byGroup = Object.fromEntries(groups.map((group) => [group.group, group.hits]));
    expect(byGroup.knowledge?.length).toBeGreaterThan(0);
    expect(byGroup.enterprise?.some((hit) => hit.title.includes("销售"))).toBe(true);
    expect(byGroup.deliverables?.[0]?.deliverableId).toBe("del-1");
    expect(byGroup.capabilities?.[0]?.capabilityId).toBe("cap-sales");
    expect(byGroup.agents?.some((hit) => hit.title.includes("销售"))).toBe(true);
    expect(byGroup.owners?.some((hit) => hit.title.includes("销售"))).toBe(true);
  });

  it("recalls deliverables from indexed evidence when title metadata does not match", () => {
    const groups = buildWorkspaceSearchGroups({
      query: "quarterly revenue breakdown",
      limitPerGroup: 5,
      graph,
      knowledgeObjects: [],
      evidence: [
        {
          sourceKind: "knowledge",
          docId: "skill-doc-42",
          docTitle: "Agent Report",
          kbId: "kb-archive",
          versionId: "v1",
          score: 0.88,
          chunkText: "Quarterly revenue breakdown by region for enterprise accounts.",
          sourceUri: "ku://kb/kb-archive/doc/skill-doc-42@v1",
        },
      ],
      deliverables: [
        {
          deliverableId: "skill:skill-doc-42",
          title: "Q2 Agent Report",
          kind: "report",
          source: "agent",
          sourceType: "personal",
          artifactKind: "knowledge",
          governanceStatus: "pending",
          creators: ["Alice"],
          status: "published",
          updatedAtMs: 1,
        },
      ],
      dataCapabilities: [],
    });
    const deliverables = groups.find((group) => group.group === "deliverables")?.hits ?? [];
    expect(deliverables).toHaveLength(1);
    expect(deliverables[0]?.deliverableId).toBe("skill:skill-doc-42");
    expect(deliverables[0]?.subtitle).toContain("Quarterly revenue breakdown");
  });

  it("maps governance trust state onto evidence and deliverable hits", () => {
    const groups = buildWorkspaceSearchGroups({
      query: "销售",
      limitPerGroup: 5,
      graph,
      knowledgeObjects: [
        {
          id: "obj-conflict",
          title: "销售冲突政策",
          source: "enterprise",
          kind: "policy",
          summary: "enterprise sales policy",
          tags: [],
          updatedAt: 1,
          relationshipSummary: { relatedCount: 2, conflictCount: 1, supportingCount: 0 },
        },
      ],
      evidence: [
        {
          sourceKind: "knowledge",
          docId: "doc-claim",
          docTitle: "Claim conflict doc",
          kbId: "kb-1",
          versionId: "v1",
          score: 0.77,
          chunkText: "销售返点 18%",
          sourceUri: "ku://kb/kb-1/doc/doc-claim@v1",
          governanceClaimConflict: true,
        },
      ],
      deliverables: [
        {
          deliverableId: "del-gov",
          title: "销售 Q2 报告",
          kind: "report",
          source: "group",
          sourceType: "collaboration",
          artifactKind: "report",
          governanceStatus: "conflict",
          creators: ["Alice"],
          status: "published",
          updatedAtMs: 1,
        },
      ],
      dataCapabilities: [],
    });
    const knowledgeHit = groups.find((group) => group.group === "knowledge")?.hits[0];
    const enterpriseHit = groups.find((group) => group.group === "enterprise")?.hits[0];
    const deliverableHit = groups.find((group) => group.group === "deliverables")?.hits[0];
    expect(knowledgeHit?.governanceStatus).toBe("conflict");
    expect(knowledgeHit?.governanceClaimConflict).toBe(true);
    expect(enterpriseHit?.governanceStatus).toBe("conflict");
    expect(deliverableHit?.governanceStatus).toBe("conflict");
  });

  it("returns empty groups for blank query", () => {
    const groups = buildWorkspaceSearchGroups({
      query: "   ",
      limitPerGroup: 5,
      graph,
      knowledgeObjects: buildDefaultKnowledgeObjects(),
      evidence: [],
      deliverables: [],
      dataCapabilities: [],
    });
    expect(groups.every((group) => group.hits.length === 0)).toBe(true);
  });
});
