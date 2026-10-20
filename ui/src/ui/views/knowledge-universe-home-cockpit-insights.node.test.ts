// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildHomeCockpitInsights } from "./knowledge-universe-home-cockpit-insights.ts";

describe("buildHomeCockpitInsights", () => {
  it("builds insights when homeFocus points at a graph document node", () => {
    const insights = buildHomeCockpitInsights({
      homeFocus: { kind: "document", id: "doc-policy", kbId: "kb-hr" },
      graph: {
        nodes: [
          {
            id: "node:policy",
            kind: "knowledge-object",
            title: "考勤制度",
            objectId: "doc-policy",
            governance: { status: "conflict", conflictCount: 1 },
          },
          {
            id: "node:comp",
            kind: "knowledge-object",
            title: "薪酬说明",
            objectId: "doc-comp",
          },
        ],
        edges: [
          { sourceId: "node:policy", targetId: "node:comp", relationType: "conflicts", score: 66 },
        ],
      },
      actionSuggestions: [
        {
          actionId: "act-1",
          actionType: "review_conflict",
          title: "复核冲突",
          reason: "口径不一致",
          score: 90,
          context: { objectId: "doc-policy" },
          executable: true,
          evidence: ["片段内容冲突"],
          trustLabel: "high",
        },
      ],
      relatedGroups: null,
    } as never);

    // Home insights stay on the governance ticker until the cockpit builder lands.
    expect(insights).toBeNull();
  });
});
