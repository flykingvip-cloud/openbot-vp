import { describe, expect, it } from "vitest";
import type { SessionTaskBoard } from "../contracts/task.js";
import { formatTaskBoardProgressReply, isProgressStatusQuery } from "./task-status.js";

describe("mid-task-dialogue helpers", () => {
  it("detects narrow progress status queries", () => {
    expect(isProgressStatusQuery("进度如何")).toBe(true);
    expect(isProgressStatusQuery("做到哪了")).toBe(true);
    expect(isProgressStatusQuery("怎么样了？")).toBe(true);
    expect(isProgressStatusQuery("当前进度")).toBe(true);
    expect(isProgressStatusQuery("补充：只要国内安卓")).toBe(false);
    expect(isProgressStatusQuery("现在改做合同审查")).toBe(false);
  });

  it("formats progress from board projection without internal fields", () => {
    const board: SessionTaskBoard = {
      parked: [],
      current: {
        taskId: "task-a",
        title: "手机调研",
        goalText: "调研国内手机市场并写报告",
        unfinished: true,
        wakeSuppress: true,
        stop: { summary: "正在收集评测", workspacePaths: [] },
        createdAtMs: 1,
      },
      focusRevision: 2,
    };
    const text = formatTaskBoardProgressReply(board);
    expect(text).toContain("手机调研");
    expect(text).toContain("任务板最近记录");
    expect(text).toContain("未完成");
    expect(text).toContain("主人已暂停自动续跑");
    expect(text).toContain("正在收集评测");
    expect(text).not.toContain("wakeSuppress");
    expect(text).not.toContain("进行中");
    expect(text).not.toContain("请确认");
  });
});
