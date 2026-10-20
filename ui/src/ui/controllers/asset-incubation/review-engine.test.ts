import { describe, expect, it, beforeEach } from "vitest";
import { buildNormalizedIntentKey, intentKeyLabel } from "./intent-key.ts";
import {
  clearReviewDismissalsForTests,
  clusterSessionEvents,
  dismissReviewSuggestion,
  scheduleReview,
} from "./review-engine.ts";
import {
  clearSessionIncubationEventsForTests,
  saveSessionIncubationEvents,
} from "./session-event-store.ts";

describe("intent-key", () => {
  it("maps weekly report synonyms to the same bucket", () => {
    const a = buildNormalizedIntentKey({
      text: "帮我写周报",
      hasArtifact: false,
      hasStructuredOutput: false,
    });
    const b = buildNormalizedIntentKey({
      text: "整理本周工作，做周总结",
      hasArtifact: false,
      hasStructuredOutput: false,
    });
    expect(a).toBe("weekly-report");
    expect(b).toBe("weekly-report");
    expect(intentKeyLabel(a)).toBe("周报生成");
  });
});

describe("review-engine", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
        removeItem: (key: string) => {
          storage.delete(key);
        },
      },
    });
    clearSessionIncubationEventsForTests();
    clearReviewDismissalsForTests();
  });

  it("clusters events and surfaces L3 review suggestions at recurrence >= 3", () => {
    const now = Date.now();
    saveSessionIncubationEvents([
      {
        id: "weekly-report:s1:1",
        sessionKey: "agent:main:main",
        contextId: "artifact-1",
        intentKey: "weekly-report",
        clusterId: "weekly-report",
        label: "周报生成",
        suggestedAssetType: "template",
        occurredAt: now - 1_000,
      },
      {
        id: "weekly-report:s1:2",
        sessionKey: "agent:main:main",
        contextId: "artifact-2",
        intentKey: "weekly-report",
        clusterId: "weekly-report",
        label: "周报生成",
        suggestedAssetType: "template",
        occurredAt: now - 2_000,
      },
      {
        id: "weekly-report:s1:3",
        sessionKey: "agent:main:main",
        contextId: "artifact-3",
        intentKey: "weekly-report",
        clusterId: "weekly-report",
        label: "周报生成",
        suggestedAssetType: "template",
        occurredAt: now - 3_000,
      },
    ]);

    const result = scheduleReview({ now });
    expect(result.clusters).toHaveLength(1);
    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]?.decision.level).toBe("L3");
    expect(result.suggestions[0]?.summary).toContain("3 次");
  });

  it("respects dismissed fingerprints", () => {
    const now = Date.now();
    saveSessionIncubationEvents([
      {
        id: "weekly-report:s1:1",
        sessionKey: "agent:main:main",
        contextId: null,
        intentKey: "weekly-report",
        clusterId: "weekly-report",
        label: "周报生成",
        suggestedAssetType: "template",
        occurredAt: now - 1_000,
      },
      {
        id: "weekly-report:s1:2",
        sessionKey: "agent:main:main",
        contextId: null,
        intentKey: "weekly-report",
        clusterId: "weekly-report",
        label: "周报生成",
        suggestedAssetType: "template",
        occurredAt: now - 2_000,
      },
      {
        id: "weekly-report:s1:3",
        sessionKey: "agent:main:main",
        contextId: null,
        intentKey: "weekly-report",
        clusterId: "weekly-report",
        label: "周报生成",
        suggestedAssetType: "template",
        occurredAt: now - 3_000,
      },
    ]);
    dismissReviewSuggestion("weekly-report");
    const result = scheduleReview({ now });
    expect(result.suggestions).toHaveLength(0);
  });

  it("sorts clusters by recurrence count", () => {
    const clusters = clusterSessionEvents([
      {
        id: "a:1",
        sessionKey: "s1",
        contextId: null,
        intentKey: "weekly-report",
        clusterId: "weekly-report",
        label: "周报生成",
        suggestedAssetType: "template",
        occurredAt: 1,
      },
      {
        id: "b:1",
        sessionKey: "s2",
        contextId: null,
        intentKey: "competitive-analysis",
        clusterId: "competitive-analysis",
        label: "竞品分析",
        suggestedAssetType: "workflow",
        occurredAt: 2,
      },
      {
        id: "b:2",
        sessionKey: "s3",
        contextId: null,
        intentKey: "competitive-analysis",
        clusterId: "competitive-analysis",
        label: "竞品分析",
        suggestedAssetType: "workflow",
        occurredAt: 3,
      },
    ]);
    expect(clusters[0]?.fingerprint).toBe("competitive-analysis");
    expect(clusters[0]?.recurrenceCount).toBe(2);
  });

  it("drops knowledge review suggestions and keeps at most three organizable ones", () => {
    const now = Date.now();
    const events = [
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `knowledge-article:s1:${index}`,
        sessionKey: "agent:main:main",
        contextId: `knowledge-${index}`,
        intentKey: "knowledge-article",
        clusterId: "knowledge-article",
        label: "知识/报告产出",
        suggestedAssetType: "template" as const,
        occurredAt: now - index * 1_000,
      })),
      ...[
        "structured-output",
        "competitive-analysis",
        "customer-interview",
        "prd",
        "business-plan",
      ].flatMap((clusterId, clusterIndex) =>
        Array.from({ length: 3 }, (_, index) => ({
          id: `${clusterId}:s1:${index}`,
          sessionKey: "agent:main:main",
          contextId: `${clusterId}-${index}`,
          intentKey: clusterId,
          clusterId,
          label:
            clusterId === "structured-output"
              ? "结构化任务"
              : clusterId === "competitive-analysis"
                ? "竞品分析"
                : clusterId === "customer-interview"
                  ? "客户访谈整理"
                  : clusterId === "prd"
                    ? "产品需求文档"
                    : "商业计划",
          suggestedAssetType: clusterId === "prd" ? ("template" as const) : ("workflow" as const),
          occurredAt: now - (clusterIndex + 1) * 10_000 - index,
        })),
      ),
    ];
    saveSessionIncubationEvents(events);

    const result = scheduleReview({ now });
    expect(result.suggestions.map((entry) => entry.cluster.label)).toEqual([
      "结构化任务",
      "竞品分析",
      "客户访谈整理",
    ]);
    expect(result.suggestions).toHaveLength(3);
    expect(result.suggestions.some((entry) => entry.cluster.label.includes("知识"))).toBe(false);
  });
});
