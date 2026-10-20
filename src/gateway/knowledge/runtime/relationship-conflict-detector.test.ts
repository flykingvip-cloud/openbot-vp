import { describe, expect, it } from "vitest";
import type { KnowledgeObject } from "../types.js";
import { detectRelationshipConflicts } from "./relationship-conflict-detector.js";

function object(
  overrides: Partial<KnowledgeObject> & Pick<KnowledgeObject, "id" | "title">,
): KnowledgeObject {
  return {
    source: "personal",
    kind: "document",
    summary: overrides.summary ?? "summary-a",
    tags: overrides.tags ?? [],
    updatedAt: 1,
    ...overrides,
  };
}

describe("detectRelationshipConflicts", () => {
  it("does not flag uploads that only share generic tags like pdf", () => {
    const left = object({
      id: "obj:a",
      title: "Report A",
      summary: "summary for A",
      tags: ["pdf", "上传文档"],
    });
    const right = object({
      id: "obj:b",
      title: "Report B",
      summary: "summary for B",
      tags: ["pdf", "上传文档"],
    });
    expect(detectRelationshipConflicts([left, right])).toEqual([]);
  });

  it("flags same-topic divergence when substantive tags overlap", () => {
    const left = object({
      id: "obj:a",
      title: "HR Policy A",
      summary: "policy version A",
      tags: ["HR", "制度", "pdf"],
    });
    const right = object({
      id: "obj:b",
      title: "HR Policy B",
      summary: "policy version B",
      tags: ["HR", "制度", "上传文档"],
    });
    const conflicts = detectRelationshipConflicts([left, right]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.reason).toBe("same-topic-divergent-summary");
  });

  it("flags marker-pair conflicts in title or summary", () => {
    const left = object({
      id: "obj:a",
      title: "营收增长预测",
      summary: "增长 10%",
      tags: [],
    });
    const right = object({
      id: "obj:b",
      title: "营收下降预警",
      summary: "下降 5%",
      tags: [],
    });
    const conflicts = detectRelationshipConflicts([left, right]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.reason).toBe("增长/下降");
  });
});
