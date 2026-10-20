// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../../i18n/index.ts";
import {
  buildKnowledgeDetailInsights,
  humanizeRelationReason,
  scoreToTrustLevel,
} from "./knowledge-universe-detail-insights.ts";

beforeAll(async () => {
  await i18n.setLocale("zh-CN");
});

describe("buildKnowledgeDetailInsights", () => {
  it("prioritizes conflict edge discoveries ahead of higher-scored related edges", () => {
    const insights = buildKnowledgeDetailInsights({
      object: {
        id: "a",
        title: "HR Policy",
        source: "enterprise",
        kind: "policy",
        summary: "s",
        tags: [],
        updatedAt: 1,
        relationshipSummary: { relatedCount: 3, conflictCount: 1, supportingCount: 2 },
      },
      objectTitle: "HR Policy",
      governance: { status: "conflict", conflictCount: 1, freshness: "stale" },
      graph: {
        nodes: [
          { id: "node:a", kind: "knowledge-object", title: "HR Policy", objectId: "a" },
          { id: "node:b", kind: "knowledge-object", title: "Comp Policy", objectId: "b" },
          { id: "node:c", kind: "knowledge-object", title: "Handbook", objectId: "c" },
        ],
        edges: [
          { sourceId: "node:a", targetId: "node:b", relationType: "conflicts", score: 66 },
          {
            sourceId: "node:a",
            targetId: "node:c",
            relationType: "related",
            score: 90,
            reasons: ["shared-tags:HR,制度"],
          },
        ],
      },
      selectedNodeId: "node:a",
      relatedGroups: null,
      focusActions: [],
    });

    expect(insights.discoveries[0]?.tone).toBe("warn");
    expect(insights.discoveries[0]?.headline).toContain("Comp Policy");
    expect(insights.discoveries.some((item) => item.headline.includes("Handbook"))).toBe(true);
  });

  it("humanizes conflict reason tokens on graph edges", () => {
    const insights = buildKnowledgeDetailInsights({
      object: {
        id: "a",
        title: "Doc A",
        source: "personal",
        kind: "document",
        summary: "s",
        tags: [],
        updatedAt: 1,
        relationshipSummary: { relatedCount: 1, conflictCount: 1, supportingCount: 0 },
      },
      objectTitle: "Doc A",
      governance: { status: "conflict", conflictCount: 1 },
      graph: {
        nodes: [
          { id: "node:a", kind: "knowledge-object", title: "Doc A", objectId: "a" },
          { id: "node:b", kind: "knowledge-object", title: "Doc B", objectId: "b" },
        ],
        edges: [
          {
            sourceId: "node:a",
            targetId: "node:b",
            relationType: "conflicts",
            score: 66,
            reasons: ["conflict:same-topic-divergent-summary"],
          },
        ],
      },
      selectedNodeId: "node:a",
      relatedGroups: null,
      focusActions: [],
    });

    expect(insights.discoveries[0]?.evidence[0]).toContain("摘要表述不一致");
  });

  it("maps governance actions into executable insight cards", () => {
    const insights = buildKnowledgeDetailInsights({
      object: {
        id: "a",
        title: "HR Policy",
        source: "enterprise",
        kind: "policy",
        summary: "s",
        tags: [],
        updatedAt: 1,
      },
      objectTitle: "HR Policy",
      governance: { status: "attention" },
      graph: null,
      selectedNodeId: "node:a",
      relatedGroups: null,
      focusActions: [
        {
          actionId: "merge-1",
          actionType: "merge_duplicate",
          title: "合并重复片段",
          reason: "治理引擎发现重复内容，合并后可提升检索质量",
          score: 91,
          context: { objectId: "a" },
          executable: true,
          evidence: ["检测到重复片段", "涉及 2 个相关片段"],
          trustLabel: "high",
        },
      ],
    });

    expect(insights.discoveries).toHaveLength(1);
    expect(insights.discoveries[0]?.action?.executable).toBe(true);
    expect(insights.discoveries[0]?.action?.label).toBeTruthy();
    expect(insights.discoveries[0]?.evidence.length).toBeGreaterThan(0);
  });
});

describe("humanizeRelationReason", () => {
  it("humanizes shared tag tokens", () => {
    const text = humanizeRelationReason("shared-tags:HR,制度");
    expect(text).toContain("HR");
    expect(text).toContain("制度");
  });

  it("humanizes conflict detector tokens", () => {
    expect(humanizeRelationReason("conflict:增长/下降")).toContain("增长/下降");
    expect(humanizeRelationReason("conflict:same-topic-divergent-summary")).toContain("摘要");
  });
});

describe("scoreToTrustLevel", () => {
  it("maps scores to trust bands", () => {
    expect(scoreToTrustLevel(90)).toBe("high");
    expect(scoreToTrustLevel(70)).toBe("medium");
    expect(scoreToTrustLevel(40)).toBe("low");
  });
});
