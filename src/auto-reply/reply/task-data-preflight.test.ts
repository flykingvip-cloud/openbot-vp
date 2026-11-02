import { describe, expect, it } from "vitest";
import {
  buildTaskDataPreflightPrompt,
  detectTaskDataPreflightGaps,
} from "./task-data-preflight.js";

describe("task-data-preflight", () => {
  it("detects project and directory gaps", () => {
    expect(detectTaskDataPreflightGaps("帮我看本周项目风险")).toEqual(["project_kb"]);
    expect(detectTaskDataPreflightGaps("列出协作组机器人列表")).toEqual(["bot_directory"]);
  });

  it("builds mandatory preflight prompt", () => {
    const prompt = buildTaskDataPreflightPrompt("给我发会议提醒");
    expect(prompt).toContain("Task data preflight");
    expect(prompt).toContain("timezone");
  });

  it("returns undefined for generic chat", () => {
    expect(buildTaskDataPreflightPrompt("你好")).toBeUndefined();
  });

  it("points 用友 warehouse questions at the knowledge feed, not 云电脑", () => {
    const prompt = buildTaskDataPreflightPrompt("帮我看用友T+仓库和存货");
    expect(prompt).toContain("knowledge_search");
    expect(prompt).toContain("001-用友T+仓库");
    expect(prompt).toContain("云电脑");
    expect(prompt).toContain("data_capability");
    expect(detectTaskDataPreflightGaps("打开云电脑看用友仓库")).not.toContain("enterprise_feed");
  });
});
