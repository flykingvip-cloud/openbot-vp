import { describe, expect, it } from "vitest";
import {
  DAIBAI_GUIDE_RETAINED_TEXT,
  DAIBAI_GUIDE_WELCOME_TEXT,
  latestDaibaiGuideCard,
  planDaibaiGuideAppend,
  readDaibaiGuideCard,
} from "./daibai-guide-card.js";

const teamState = {
  step: "page",
  path: "catalog",
  category: "all",
  selectedIds: ["docs", "email"],
  selectedLabels: ["文档专员", "邮件助理"],
  role: null,
  taskText: "每天改文档",
  proposedIds: [],
  customNames: [],
  created: [{ catalogId: "docs", agentId: "agt-docs", name: "文档专员" }],
};

describe("daibai guide card", () => {
  it("keeps the welcome line in Chinese and drops secret-shaped task text", () => {
    const welcome = planDaibaiGuideAppend({ slot: "welcome", now: 5 });
    expect(welcome?.text).toBe(DAIBAI_GUIDE_WELCOME_TEXT);
    expect(welcome?.card.slot).toBe("welcome");

    const leaked = planDaibaiGuideAppend({
      slot: "team",
      now: 6,
      state: {
        ...teamState,
        created: [],
        taskText: "Bearer aaa.bbb.ccc",
        token: "should-not-survive",
        oauth: { accessToken: "nope" },
      },
    });
    expect(leaked?.card.state?.taskText).toBe("");
    expect(JSON.stringify(leaked?.card)).not.toContain("Bearer");
    expect(JSON.stringify(leaked?.card)).not.toContain("should-not-survive");
    expect(JSON.stringify(leaked?.card)).not.toContain("accessToken");
  });

  it("reads the latest team card from history, including a success revision", () => {
    const first = planDaibaiGuideAppend({
      slot: "team",
      now: 1,
      state: { ...teamState, created: [] },
    });
    const success = planDaibaiGuideAppend({ slot: "team", now: 2, state: teamState });
    expect(success?.text).toContain("团队已就绪");
    expect(success?.text).toContain("文档专员");
    expect(success?.text).toContain(DAIBAI_GUIDE_RETAINED_TEXT);
    expect(success?.card.kind).toBe("success");

    const messages = [
      { role: "assistant", timestamp: 1, openclawDaibaiGuide: first?.card },
      { role: "assistant", timestamp: 2, openclawDaibaiGuide: success?.card },
      { role: "user", content: [{ type: "text", text: "普通消息" }] },
    ];
    const latest = latestDaibaiGuideCard(messages, "team");
    expect(latest?.kind).toBe("success");
    expect(latest?.state?.created.map((member) => member.name)).toEqual(["文档专员"]);
    expect(readDaibaiGuideCard(messages[2])).toBeNull();
  });
});
