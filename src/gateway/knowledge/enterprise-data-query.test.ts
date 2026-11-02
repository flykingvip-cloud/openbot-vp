import { describe, expect, it } from "vitest";
import {
  knowledgeObjectMatchesQuery,
  preferEnterpriseFeedMatches,
  textMentionsEnterpriseData,
} from "./enterprise-data-query.js";

describe("enterprise data query match", () => {
  const warehouse = {
    title: "001-用友T+仓库",
    summary: "warehouse",
    tags: ["erp-yonyou-tplus"],
    source: "enterprise" as const,
    kind: "document" as const,
  };
  const handbook = {
    title: "员工手册",
    summary: "考勤",
    tags: [],
    source: "personal" as const,
    kind: "document" as const,
  };

  it("matches 用友 warehouse questions that are not a full-title substring", () => {
    expect(textMentionsEnterpriseData("帮我看用友T+仓库和存货")).toBe(true);
    expect(textMentionsEnterpriseData("晚上好")).toBe(false);
    expect(knowledgeObjectMatchesQuery(warehouse, "帮我看用友T+仓库和存货")).toBe(true);
    expect(knowledgeObjectMatchesQuery(handbook, "帮我看用友T+仓库和存货")).toBe(false);
  });

  it("ranks enterprise feed objects ahead of unrelated documents", () => {
    const ranked = preferEnterpriseFeedMatches([handbook, warehouse], "用友仓库");
    expect(ranked.map((item) => item.title)).toEqual(["001-用友T+仓库", "员工手册"]);
    expect(
      preferEnterpriseFeedMatches([handbook, warehouse], "晚上好").map((item) => item.title),
    ).toEqual(["员工手册", "001-用友T+仓库"]);
  });
});
