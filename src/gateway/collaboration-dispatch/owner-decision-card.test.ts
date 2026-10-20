import { describe, expect, test } from "vitest";
import {
  buildOwnerDecisionCard,
  ensurePlanStepSemicolon,
  extractOwnerDecisionFenceBody,
  formatOwnerDecisionMessageText,
  looksLikeEmailAddress,
  ownerDecisionIdempotencyKey,
  parseOwnerDecisionCard,
  parseOwnerDecisionFence,
  resolveOwnerDecisionMentionLabel,
} from "./owner-decision-card.js";

describe("owner-decision-card", () => {
  test("builds a todolist confirm card with confirm/revise/later options", () => {
    const card = buildOwnerDecisionCard({
      groupId: "grp-a",
      taskId: "task-1",
      boardItemId: "board-1",
      todolistId: "td-1",
      steps: [{ title: "起草摘要", detail: "一页纸" }, { title: "交叉核对" }],
      mentionMemberIds: ["owner@example.com"],
      mentionDisplayNames: ["丹尼尔"],
      version: 2,
      decisionId: "owner-decision-fixed",
    });
    expect(card).not.toBeNull();
    expect(card?.kind).toBe("todolist_confirm");
    expect(card?.options.map((o) => o.id)).toEqual(["confirm", "revise", "later"]);
    expect(card?.summary[0]).toContain("起草摘要");
    expect(card?.summary[0]?.endsWith("；")).toBe(true);
    expect(card?.summary[1]?.endsWith("；")).toBe(true);
    expect(card?.mentionMemberIds).toEqual(["owner@example.com"]);
    expect(card?.mentionLabels).toEqual(["丹尼尔"]);
    expect(ownerDecisionIdempotencyKey(card!)).toBe("owner-decision:td-1:v2:owner-decision-fixed");
  });

  test("rejects cards without confirmer mentions or ids", () => {
    expect(
      buildOwnerDecisionCard({
        groupId: "grp-a",
        taskId: "task-1",
        boardItemId: "board-1",
        todolistId: "td-1",
        steps: [{ title: "x" }],
        mentionMemberIds: [],
      }),
    ).toBeNull();
    expect(
      buildOwnerDecisionCard({
        groupId: "",
        taskId: "task-1",
        boardItemId: "board-1",
        todolistId: "td-1",
        steps: [{ title: "x" }],
        mentionMemberIds: ["owner"],
      }),
    ).toBeNull();
  });

  test("formats @mention with display names and no email / no markdown bullets", () => {
    const card = buildOwnerDecisionCard({
      groupId: "grp-a",
      taskId: "task-1",
      boardItemId: "board-1",
      todolistId: "td-1",
      steps: [{ title: "步骤甲", detail: "细节" }],
      mentionMemberIds: ["daniel.hhd@gmail.com", "bot"],
      mentionDisplayNames: ["CEO", "高级秘书"],
      decisionId: "dec-1",
    });
    expect(card).not.toBeNull();
    expect(card?.mentionLabels).toEqual(["CEO", "高级秘书"]);
    const text = formatOwnerDecisionMessageText(card!, {
      mentionDisplayNames: ["CEO", "高级秘书"],
      includeFence: true,
    });
    expect(text).toContain("@CEO");
    expect(text).toContain("@高级秘书");
    expect(text).not.toContain("@daniel.hhd@gmail.com");
    expect(text).toContain("请确认执行计划");
    expect(text).toMatch(/1\. 步骤甲 — 细节；/);
    expect(text).not.toMatch(/^- \d+\./m);
    const fence = extractOwnerDecisionFenceBody(text);
    expect(fence).toBeTruthy();
    const parsed = parseOwnerDecisionFence(text);
    expect(parsed?.todolistId).toBe("td-1");
    expect(parsed?.decisionId).toBe("dec-1");
    expect(parsed?.mentionLabels).toEqual(["CEO", "高级秘书"]);
    expect(parseOwnerDecisionCard(parsed)).toEqual(parsed);
  });

  test("resolveOwnerDecisionMentionLabel never returns an email", () => {
    expect(looksLikeEmailAddress("daniel.hhd@gmail.com")).toBe(true);
    expect(resolveOwnerDecisionMentionLabel("daniel.hhd@gmail.com", "CEO")).toBe("CEO");
    expect(resolveOwnerDecisionMentionLabel("daniel.hhd@gmail.com", "a@b.com")).toBe("主答");
    expect(resolveOwnerDecisionMentionLabel("daniel.hhd@gmail.com")).toBe("主答");
    expect(resolveOwnerDecisionMentionLabel("bot", "高级秘书")).toBe("高级秘书");
    expect(ensurePlanStepSemicolon("1. 起草")).toBe("1. 起草；");
    expect(ensurePlanStepSemicolon("1. 已有；")).toBe("1. 已有；");
    expect(ensurePlanStepSemicolon("1. 英文;")).toBe("1. 英文；");
  });

  test("parseOwnerDecisionCard appends ； to summary lines from older payloads", () => {
    const parsed = parseOwnerDecisionCard({
      kind: "todolist_confirm",
      decisionId: "d2",
      groupId: "g",
      taskId: "t",
      boardItemId: "b",
      todolistId: "td",
      title: "确认",
      summary: ["1. 起草", "2. 已有；", "3. 英文;"],
      options: [{ id: "confirm", label: "确认计划", style: "primary" }],
      mentionMemberIds: ["owner"],
      mentionLabels: ["CEO"],
    });
    expect(parsed?.summary).toEqual(["1. 起草；", "2. 已有；", "3. 英文；"]);
  });

  test("parseOwnerDecisionCard tolerates owner_decision kind alias and sanitizes email labels", () => {
    const parsed = parseOwnerDecisionCard({
      kind: "owner_decision",
      decisionId: "d1",
      groupId: "g",
      taskId: "t",
      boardItemId: "b",
      todolistId: "td",
      title: "确认",
      summary: ["一步"],
      options: [{ id: "confirm", label: "确认计划", style: "primary" }],
      mentionMemberIds: ["owner@x.com"],
      mentionLabels: ["owner@x.com"],
    });
    expect(parsed?.kind).toBe("todolist_confirm");
    expect(parsed?.options[0]?.id).toBe("confirm");
    expect(parsed?.mentionLabels?.[0]).toBe("主答");
    expect(parsed?.mentionLabels?.[0]).not.toContain("@");
  });
});
